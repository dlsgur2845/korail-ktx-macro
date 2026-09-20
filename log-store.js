'use strict';
// Only this worker writes logs. Atomic close precedes deleting a rotated source.
class KtxFileLog {
  constructor(root, {maxBytes=10*1024*1024, now=()=>new Date()}={}) {
    this.root=root; this.maxBytes=maxBytes; this.now=now; this.queue=Promise.resolve();
  }
  run(action) { const result=this.queue.then(action); this.queue=result.catch(()=>{}); return result; }
  async dir() { return (await this.root()).getDirectoryHandle('korail-logs',{create:true}); }
  day() { return new Date(this.now().getTime()+9*3600000).toISOString().slice(0,10); }
  async files(dir) {
    const files=[];
    for await (const [name,handle] of dir.entries()) if(handle.kind==='file' && /^ktx-[\w-]+\.jsonl(?:\.gz)?$/.test(name)) files.push({name,handle});
    return files.sort((a,b)=>a.name.localeCompare(b.name));
  }
  async compress(dir,item) {
    const file=await item.handle.getFile();
    const target=await dir.getFileHandle(item.name+'.gz',{create:true});
    const out=await target.createWritable();
    try { await file.stream().pipeThrough(new CompressionStream('gzip')).pipeTo(out); }
    catch(error) { throw error; } // Source remains intact on failed/interrupted compression.
    await dir.removeEntry(item.name);
  }
  async rotate(dir) {
    const current=[];
    for(const item of await this.files(dir)) {
      if(!item.name.endsWith('.jsonl')) continue;
      const file=await item.handle.getFile();
      if(!item.name.startsWith('ktx-'+this.day()+'-') || file.size>=this.maxBytes) await this.compress(dir,item);
      else current.push(item);
    }
    // Recover multiple active segments after a worker restart without losing any.
    while(current.length>1) await this.compress(dir,current.shift());
    return current[0];
  }
  append(event) { return this.run(async()=>{
    const dir=await this.dir(); let item=await this.rotate(dir);
    const line=new TextEncoder().encode(JSON.stringify(event)+'\n');
    if(item && (await item.handle.getFile()).size+line.length>this.maxBytes) {await this.compress(dir,item);item=null;}
    if(!item) {const name='ktx-'+this.day()+'-'+crypto.randomUUID()+'.jsonl';item={name,handle:await dir.getFileHandle(name,{create:true})};}
    const file=await item.handle.getFile(), out=await item.handle.createWritable({keepExistingData:true});
    try {await out.seek(file.size);await out.write(line);await out.close();}
    catch(error) {try{await out.abort();}catch{} throw error;}
    if(file.size+line.length>=this.maxBytes) await this.compress(dir,item);
  }); }
  maintain() {return this.run(async()=>{await this.rotate(await this.dir());});}
  deleteFile(name) {return this.run(async()=>{
    if(typeof name!=='string' || !/^ktx-[\w-]+\.jsonl(?:\.gz)?$/.test(name)) throw new Error('잘못된 로그 파일 이름');
    const dir=await this.dir();
    // Verify a file, never remove directories or recursively delete anything.
    await dir.getFileHandle(name);
    await dir.removeEntry(name);
  });}
  list() {return this.run(async()=>{
    const dir=await this.dir();await this.rotate(dir);
    return Promise.all((await this.files(dir)).map(async item=>({name:item.name,size:(await item.handle.getFile()).size})));
  });}
}
if(typeof module!=='undefined') module.exports=KtxFileLog;
