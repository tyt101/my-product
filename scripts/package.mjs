import { mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const stage='work/release-package';
await rm(stage,{recursive:true,force:true});
await mkdir(stage+'/dist',{recursive:true});
await cp('dist/server',stage+'/dist/server',{recursive:true});
await cp('.openai',stage+'/.openai',{recursive:true});
// Sites consumes Drizzle migrations from the archive root.
await cp('drizzle',stage+'/drizzle',{recursive:true});
execFileSync('tar',['-czf','work/release.tar.gz','-C',stage,'.']);
const entries=execFileSync('tar',['-tzf','work/release.tar.gz'],{encoding:'utf8'});
for(const path of ['./dist/server/index.js','./.openai/hosting.json','./drizzle/meta/_journal.json','./drizzle/0000_overjoyed_marvel_apes.sql'])if(!entries.split('\n').includes(path))throw new Error('Missing release file: '+path);
console.log(entries);
