'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{gunzipSync}=require('node:zlib');
const KtxFileLog=require('../log-store.js');
function disk() {
 const data=new Map(); let fail=false;
 const handle=name=>({kind:'file',getFile:async()=>new Blob([data.get(name)||new Uint8Array()]),createWritable:async(options={})=>{
   let bytes=options.keepExistingData?Buffer.from(data.get(name)||[]):Buffer.alloc(0),pos=0;
   const stream=new WritableStream({write(chunk){const b=Buffer.from(chunk);const next=Buffer.alloc(Math.max(bytes.length,pos+b.length));bytes.copy(next);b.copy(next,pos);bytes=next;pos+=b.length;},close(){if(fail && name.endsWith('.gz'))throw new Error('disk full');data.set(name,bytes);}});
   const writer=stream.getWriter();
   // pipeTo needs an unlocked stream, while file handles also expose direct writes.
   writer.releaseLock();
   stream.seek=async n=>{pos=n;};stream.write=async b=>{const w=stream.getWriter();await w.write(b);w.releaseLock();};
   stream.close=async()=>{const w=stream.getWriter();await w.close();w.releaseLock();};return stream;
 }});
 const dir={getDirectoryHandle:async()=>dir,getFileHandle:async(name,options={})=>{if(!data.has(name)){if(!options.create)throw new DOMException('missing','NotFoundError');data.set(name,Buffer.alloc(0));}return handle(name);},removeEntry:async name=>data.delete(name),async *entries(){for(const name of [...data.keys()])yield [name,handle(name)];}};
 return {data,root:async()=>dir,fail:v=>{fail=v;}};
}
test('serial append survives new worker and rotates by UTF-8 byte size with valid gzip',async()=>{
 const d=disk(),options={maxBytes:140,now:()=>new Date('2026-09-20T12:00:00Z')};let log=new KtxFileLog(d.root,options);
 await Promise.all(Array.from({length:20},(_,i)=>log.append({step:'test',i,text:'특실'})));
 log=new KtxFileLog(d.root,options);await log.append({step:'test',i:20,text:'특실'});
 const files=await log.list();assert.ok(files.some(f=>f.name.endsWith('.gz')));
 const events=[];for(const f of files){const raw=f.name.endsWith('.gz')?gunzipSync(d.data.get(f.name)):d.data.get(f.name);events.push(...raw.toString().trim().split('\n').map(JSON.parse));}
 assert.deepEqual(events.map(e=>e.i).sort((a,b)=>a-b),Array.from({length:21},(_,i)=>i));
});
test('Korea midnight rotates without a new log event',async()=>{
 const d=disk();let now=new Date('2026-09-20T14:59:59Z');const log=new KtxFileLog(d.root,{now:()=>now});
 await log.append({step:'test'});now=new Date('2026-09-20T15:00:00Z');await log.maintain();
 assert.ok((await log.list()).every(f=>f.name.startsWith('ktx-2026-09-20-')&&f.name.endsWith('.gz')));
});
test('compression failure keeps original and retry recovers without duplicate archive',async()=>{
 const d=disk();let now=new Date('2026-09-20T12:00:00Z');const log=new KtxFileLog(d.root,{now:()=>now});
 await log.append({step:'preserve'});d.fail(true);now=new Date('2026-09-21T12:00:00Z');
 await assert.rejects(log.maintain());assert.ok([...d.data.keys()].some(n=>n.endsWith('.jsonl')));
 d.fail(false);await log.maintain();const files=await log.list();assert.equal(files.length,1);assert.match(gunzipSync(d.data.get(files[0].name)).toString(),/preserve/);
});

test('delete is scoped to one log and concurrent later writes use a new file',async()=>{
 const d=disk(),log=new KtxFileLog(d.root);await log.append({step:'old'});
 const name=(await log.list())[0].name;
 await Promise.all([log.deleteFile(name),log.append({step:'new'})]);
 const files=await log.list();assert.equal(files.length,1);assert.notEqual(files[0].name,name);
 assert.match(d.data.get(files[0].name).toString(),/new/);assert.ok(!d.data.has(name));
 for(const bad of ['../secret','trash','ktx-bad.jsonl/child','',null])await assert.rejects(log.deleteFile(bad));
 await assert.rejects(log.deleteFile(name),{name:'NotFoundError'});assert.equal((await log.list()).length,1);
});
test('deleting a gzip archive leaves other files intact',async()=>{
 const d=disk();let now=new Date('2026-09-20T12:00:00Z');const log=new KtxFileLog(d.root,{now:()=>now});
 await log.append({step:'old'});now=new Date('2026-09-21T12:00:00Z');await log.append({step:'new'});
 const before=await log.list(),archive=before.find(f=>f.name.endsWith('.gz'));
 await log.deleteFile(archive.name);assert.equal((await log.list()).length,1);assert.ok(!d.data.has(archive.name));
});
