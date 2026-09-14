const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new ApiError(status,message);};
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
async function initialize(db){if(await statement(db,'SELECT value FROM metadata WHERE key=?','seed-v1').first())return;
 const inserts=[];
 for(const s of SEED){for(const [position,c] of s.categories.entries())inserts.push(statement(db,'INSERT OR IGNORE INTO topics(id,space_id,name,thinking,position) VALUES(?,?,?,?,?)',c.id,s.id,c.name,c.thinking_text||'',position));}
 for(let i=0;i<inserts.length;i+=30)await db.batch(inserts.slice(i,i+30));
 const qs=[];for(const s of SEED)for(const q of s.questions)qs.push(statement(db,'INSERT OR IGNORE INTO questions(id,space_id,topic_id,number,payload) VALUES(?,?,?,?,?)',q.id,s.id,q.category_id,q.number,JSON.stringify(q)));
 for(let i=0;i<qs.length;i+=30)await db.batch(qs.slice(i,i+30));
 await statement(db,'INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)','seed-v1','complete').run();
}
async function content(db){const result=await db.batch([db.prepare('SELECT * FROM topics WHERE deleted=0 ORDER BY position,id'),db.prepare('SELECT q.* FROM questions q JOIN topics t ON q.topic_id=t.id WHERE q.deleted=0 AND t.deleted=0 ORDER BY q.number')]);
 return SEED.map(s=>{const questions=result[1].results.filter(q=>q.space_id===s.id).map(q=>({...JSON.parse(q.payload),id:q.id,category_id:q.topic_id,number:q.number,revision:q.revision}));const categories=result[0].results.filter(t=>t.space_id===s.id).map(t=>({id:t.id,name:t.name,thinking_text:t.thinking,revision:t.revision,total:questions.filter(q=>q.category_id===t.id).length}));return {...s,questions,categories,recap_count:questions.reduce((n,q)=>n+(q.reviews?.length||0),0)};});}
async function body(request){if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'请使用 JSON 提交内容。');if(Number(request.headers.get('content-length'))>200000)fail(413,'提交内容过长。');const raw=await request.text();if(raw.length>200000)fail(413,'提交内容过长。');try{return JSON.parse(raw);}catch{fail(400,'提交格式不正确。');}}
function required(v,label,max){if(typeof v!=='string'||!v.trim())fail(400,`请填写${label}。`);if(v.trim().length>max)fail(400,`${label}不能超过 ${max} 个字符。`);return v.trim();}
function revision(v){if(!Number.isInteger(v)||v<1)fail(400,'缺少有效的内容版本，请刷新后重试。');return v;}
function newId(v){if(typeof v!=='string'||!/^user-[a-f0-9-]{36}$/.test(v))fail(400,'请求编号无效。');return v;}
async function mutate(request,db,path){
 if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'请求来源不符，请在本站重试。');
 const b=await body(request);
 if(path==='/api/topics'&&request.method==='POST'){
  const id=newId(b.id),space=SEED.find(s=>s.id===b.space_id);if(!space)fail(400,'请选择有效的训练栏目。');const name=required(b.name,'主题名称',80);
  const prior=await statement(db,'SELECT * FROM topics WHERE id=?',id).first();if(prior){if(!prior.deleted&&prior.space_id===space.id&&prior.name===name)return json({id},200);fail(409,'该提交已处理，请刷新后重试。');}
  try{await statement(db,'INSERT INTO topics(id,space_id,name,position) VALUES(?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM topics WHERE space_id=?))',id,space.id,name,space.id).run();}catch(e){if(String(e).includes('UNIQUE'))fail(409,'这个栏目下已有同名主题。');throw e;}return json({id},201);
 }
 if(path==='/api/questions'&&request.method==='POST'){
  const id=newId(b.id),title=required(b.question_text,'问题',500),answer=required(b.current_answer,'答案',100000);const prior=await statement(db,'SELECT * FROM questions WHERE id=?',id).first();if(prior){const p=JSON.parse(prior.payload);if(!prior.deleted&&prior.topic_id===b.category_id&&p.question_text===title&&p.current_answer===answer)return json({id,space_id:prior.space_id});fail(409,'该提交已处理，请刷新后重试。');}
  const topic=await statement(db,'SELECT * FROM topics WHERE id=? AND deleted=0',b.category_id||'').first();if(!topic)fail(409,'所选主题已不存在，请重新选择。');
  const payload=JSON.stringify({question_text:title,current_answer:answer,thinking_text:'',source_text:'',flow_diagram:null});
  const r=await db.batch([statement(db,'INSERT INTO questions(id,space_id,topic_id,number,payload) SELECT ?,space_id,id,(SELECT COALESCE(MAX(number),0)+1 FROM questions WHERE space_id=t.space_id),? FROM topics t WHERE id=? AND deleted=0',id,payload,topic.id),statement(db,'UPDATE topics SET revision=revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM questions WHERE id=?)',topic.id,id)]);
  if(!r[0].meta.changes)fail(409,'主题已删除，问答未发布。');return json({id,space_id:topic.space_id},201);
 }
 const qmatch=path.match(/^\/api\/questions\/([^/]+)$/);
 if(qmatch){const id=qmatch[1],rev=revision(b.revision);const row=await statement(db,'SELECT q.* FROM questions q JOIN topics t ON q.topic_id=t.id WHERE q.id=? AND q.deleted=0 AND t.deleted=0',id).first();if(!row)fail(404,'题目已删除或不存在。');if(row.revision!==rev)fail(409,'答案已在其他窗口修改。你的草稿仍保留，请复制草稿后刷新再核对。');
  if(request.method==='PATCH'){const answer=required(b.current_answer,'答案',100000),payload=JSON.parse(row.payload);payload.current_answer=answer;payload.answer_origin='edited';const r=await statement(db,'UPDATE questions SET payload=?,revision=revision+1 WHERE id=? AND revision=? AND deleted=0 AND EXISTS(SELECT 1 FROM topics WHERE id=questions.topic_id AND deleted=0)',JSON.stringify(payload),id,rev).run();if(!r.meta.changes)fail(409,'题目已发生变化，草稿已保留，请刷新核对。');return json({id,revision:rev+1});}
  if(request.method==='DELETE'){const r=await db.batch([statement(db,'UPDATE questions SET deleted=1,revision=revision+1 WHERE id=? AND revision=? AND deleted=0',id,rev),statement(db,'UPDATE topics SET revision=revision+1 WHERE id=?',row.topic_id)]);if(!r[0].meta.changes)fail(409,'题目已发生变化，请刷新后重试。');return json({deleted:true});}
 }
 const tmatch=path.match(/^\/api\/topics\/([^/]+)$/);
 if(tmatch&&request.method==='DELETE'){const id=tmatch[1],rev=revision(b.revision);const topic=await statement(db,'SELECT * FROM topics WHERE id=? AND deleted=0',id).first();if(!topic)fail(404,'主题已删除或不存在。');if(b.confirm_name!==topic.name)fail(400,'请填写完整的主题名称确认删除。');
  const r=await db.batch([statement(db,'UPDATE topics SET deleted=1,revision=revision+1 WHERE id=? AND revision=? AND deleted=0',id,rev),statement(db,'UPDATE questions SET deleted=1,revision=revision+1 WHERE topic_id=? AND deleted=0 AND EXISTS(SELECT 1 FROM topics WHERE id=? AND deleted=1 AND revision=?)',id,id,rev+1)]);if(!r[0].meta.changes)fail(409,'主题中的题目已发生变化，请刷新后重新确认删除范围。');return json({deleted:true});
 }
 fail(404,'未找到这个操作。');
}
export default {async fetch(request,env){const url=new URL(request.url),path=url.pathname;
 try{
  if(path==='/api/session')return json({can_manage:true});
  if(path.startsWith('/api/')){if(!env.DB)fail(503,'内容存储暂时不可用，请稍后重试。');
   await initialize(env.DB);if(path==='/api/content'&&request.method==='GET')return json(await content(env.DB));return await mutate(request,env.DB,path);
  }
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
  const asset=ASSETS[path==='/manage'?'/':path];if(!asset)return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
 }catch(e){if(!(e instanceof ApiError))console.error('Request failed',path,e);return json({error:e instanceof ApiError?e.message:'保存或读取暂时失败，内容已保留，请稍后重试。'},e.status||503);}
}};
