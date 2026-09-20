const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../phone-background.js'),'utf8');
function setup(options={}) {
 const calls=[],listeners=[];
 const ctx={chrome:{storage:{local:{setAccessLevel:async v=>{assert.equal(v.accessLevel,'TRUSTED_CONTEXTS');},get:async()=>({phone:options.phone||{enabled:true,topic:'ktx-abcdefghijklmnopqrstuvwxyz012345'}})}},permissions:{contains:async()=>!options.denied},runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener:f=>listeners.push(f)}}},fetch:async(url,init)=>{calls.push({url,init});if(options.throw)throw new Error('offline');return {ok:!options.status,status:options.status||200};},AbortSignal,URL,ticketDocument:u=>u?.startsWith('https://www.korail.com/ticket/')};
 vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,calls,listeners};
}
test('phone sends fixed generic status without reservation data to ntfy only',async()=>{
 const h=setup();const r=await h.ctx.sendPhone('seat-found');assert.equal(r.ok,true);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://ntfy.sh/');
 const req=h.calls[0].init,body=JSON.parse(req.body);
 assert.deepEqual(Object.keys(body),['topic','title','message','priority','tags']);
 assert.equal(req.credentials,'omit');assert.equal(req.redirect,'error');assert.ok(req.signal);
});
test('disabled, invalid topic or denied permission cannot publish',async()=>{
 for(const options of [{phone:{enabled:false}},{phone:{enabled:true,topic:'short'}},{denied:true}]){
  const h=setup(options);await h.ctx.sendPhone('seat-found');assert.equal(h.calls.length,0);
 }
});
test('HTTP and network failures reported without retries',async()=>{
 for(const options of [{status:429},{status:500},{throw:true}]){const h=setup(options);assert.equal((await h.ctx.sendPhone('macro-stopped')).ok,false);assert.equal(h.calls.length,1);}
});
test('only the extension settings document can request a phone test',async()=>{
 const h=setup();const listener=h.listeners[0];let reply;
 for(const sender of [{id:'evil',url:'chrome-extension://ext/phone.html'},{id:'ext',url:'https://www.korail.com/ticket/search/list'}])listener({type:'test-phone-notification'},sender,r=>reply=r);
 assert.equal(reply,undefined);assert.equal(h.calls.length,0);
 await new Promise(resolve=>listener({type:'test-phone-notification'},{id:'ext',url:'chrome-extension://ext/phone.html'},r=>{reply=r;resolve();}));
 assert.equal(reply.ok,true);assert.equal(h.calls.length,1);
});
