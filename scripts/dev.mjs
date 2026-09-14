import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2025-09-13',d1Databases:['DB'],d1Persist:'.wrangler/local'});
const db=await mf.getD1Database('DB');
// This preview owns a separate local database. The production migration journal is managed by Sites.
const existing=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='topics'").first();
if(!existing)for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const headers={...req.headers};if(process.env.LOCAL_ADMIN_PREVIEW==='1'){headers['oai-authenticated-user-id']='local-test-owner';headers['oai-authenticated-user-email']='tangylin1998@gmail.com';}const r=await mf.dispatchFetch('http://localhost:4173'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
server.listen(4173,'::',()=>console.log('Preview: http://localhost:4173'));
process.on('SIGINT',async()=>{server.close();await mf.dispose();process.exit(0);});
