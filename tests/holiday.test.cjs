'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=name=>fs.readFileSync(require.resolve('../'+name),'utf8');
const ctx={URL,Date};vm.runInNewContext(source('holiday-core.js'),ctx);const C=ctx.KtxHolidayCore;
test('holiday domains and Korea target time are strict',()=>{
 assert.equal(C.allowed('https://bt2.korail.com/'),true);assert.equal(C.allowed('https://korail.com.evil.test'),false);assert.equal(C.allowed('http://bt2.korail.com'),false);
 assert.equal(C.parseTarget('2026-10-01T07:00:00'),Date.parse('2026-09-30T22:00:00Z'));
 for(const bad of ['','2026-02-30T07:00','2026-10-01T25:00'])assert.throws(()=>C.parseTarget(bad));
});
test('RTT never advances firing before conservative server bound',()=>{
 const date='Thu, 01 Oct 2026 00:00:00 GMT',epoch=Date.parse(date);
 for(const rtt of [0,50,500,2999]){
  const s=C.sample(date,null,0,rtt);
  assert.equal(C.ready(s,rtt,epoch),false);
  assert.equal(C.ready(s,rtt+1000,epoch),false);
  assert.equal(C.ready(s,rtt+1002,epoch),true);
  assert.equal(C.ready(s,rtt+500,epoch),false);
 }
});
test('missing, stale, slow and cached server samples fail closed',()=>{
 for(const args of [[null,null,0,10],['bad',null,0,10],['Thu, 01 Oct 2026 00:00:00 GMT','2',0,10],['Thu, 01 Oct 2026 00:00:00 GMT',null,0,3001]])assert.throws(()=>C.sample(...args));
 const s=C.sample('Thu, 01 Oct 2026 00:00:00 GMT',null,0,10);assert.throws(()=>C.bounds(s,16000));assert.throws(()=>C.bounds(s,9));
});
function setup(options={}){
 const commands=[],listeners=[],calls=[];let verified=options.verified!==false;
 const sender={id:'ext',frameId:0,documentId:'doc',url:'https://bt2.korail.com/',tab:{id:7}};
 const chrome={runtime:{id:'ext',onMessage:{addListener:f=>listeners.push(f)}},tabs:{sendMessage:async(id,m)=>({ok:verified,url:sender.url}),onRemoved:{addListener(){}},onUpdated:{addListener(){}}},debugger:{attach:async()=>{calls.push('attach');if(options.attachError)throw Error('busy');},detach:async()=>calls.push('detach'),onDetach:{addListener(){}},sendCommand:async(t,m,p)=>{commands.push({m,p});if(m==='Page.getFrameTree')return {frameTree:{frame:{url:options.pageURL||sender.url}}};if(m==='Page.getLayoutMetrics')return {cssVisualViewport:{clientWidth:1000,clientHeight:800}};if(options.dispatchError&&p.type==='mouseReleased')throw Error('unknown');}}};
 const context={chrome,URL,Date,inputSessions:new Map(),inputBusy:new Set(),importScripts(){},KtxHolidayCore:C};vm.runInNewContext(source('holiday-background.js'),context);
 return {commands,calls,setVerified:v=>verified=v,send:(m,patch={})=>new Promise(resolve=>{const handled=listeners[0](m,{...sender,...patch},resolve);if(!handled)resolve(null);})};
}
test('holiday input is single-use and revalidates time/target before dispatch',async()=>{
 const h=setup(),nonce='one';assert.equal((await h.send({type:'holiday-prepare',nonce})).ok,true);
 assert.equal((await h.send({type:'holiday-click',nonce,x:20,y:40})).ok,true);
 assert.equal((await h.send({type:'holiday-click',nonce,x:20,y:40})).ok,false);
 assert.deepEqual(h.commands.filter(c=>c.m==='Input.dispatchMouseEvent').map(c=>c.p.type),['mousePressed','mouseReleased']);
});
test('early or cancelled page state blocks dispatch and detaches',async()=>{
 const h=setup(),nonce='one';await h.send({type:'holiday-prepare',nonce});h.setVerified(false);
 assert.equal((await h.send({type:'holiday-click',nonce,x:20,y:40})).ok,false);assert.equal(h.commands.some(c=>c.m==='Input.dispatchMouseEvent'),false);assert.ok(h.calls.includes('detach'));
});
test('wrong sender, changed page, cancel and debugger failure cannot click',async()=>{
 for(const options of [{pageURL:'https://bt2.korail.com/other'},{attachError:true}]){const h=setup(options);assert.equal((await h.send({type:'holiday-prepare',nonce:'one'})).ok,false);assert.equal(h.commands.some(c=>c.m==='Input.dispatchMouseEvent'),false);if(options.attachError)assert.equal(h.calls.includes('detach'),false);else assert.ok(h.calls.includes('detach'));}
 const h=setup();assert.equal((await h.send({type:'holiday-prepare',nonce:'one'},{url:'https://evil.test'})).ok,false);await h.send({type:'holiday-prepare',nonce:'one'});await h.send({type:'holiday-release',nonce:'one'});assert.equal((await h.send({type:'holiday-click',nonce:'one',x:20,y:40})).ok,false);
});
test('uncertain input failure never retries the click',async()=>{
 const h=setup({dispatchError:true}),nonce='one';await h.send({type:'holiday-prepare',nonce});assert.equal((await h.send({type:'holiday-click',nonce,x:20,y:40})).ok,false);await h.send({type:'holiday-click',nonce,x:20,y:40});assert.equal(h.commands.filter(c=>c.p?.type==='mousePressed').length,1);
});
