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
 assert.deepEqual(Object.keys(body),['topic','title','message','priority']);
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
test('waitlist notification is distinct from a secured seat',async()=>{
 const h=setup();assert.equal((await h.ctx.sendPhone('wait-registered')).ok,true);
 const body=JSON.parse(h.calls[0].init.body);
 assert.match(body.message,/예약대기/);assert.match(body.message,/아직|미확보/);
});

test('상세 예약대기 알림은 여행 정보만 포함하고 아이콘 및 추가 식별정보는 보내지 않는다',async()=>{
 const h=setup();await h.ctx.sendPhone('wait-registered',{result:'wait',number:'21',date:'2026-09-24',from:'서울',to:'부산',time:'09:30',seat:'gen',attempt:5,reservationId:'SECRET123',cookie:'secret-cookie'});
 const body=JSON.parse(h.calls[0].init.body);
 assert.equal(body.title,'KTX 예약대기 접수');assert.match(body.message,/KTX 021/);assert.match(body.message,/서울 → 부산/);assert.match(body.message,/09:30/);assert.match(body.message,/5회/);
 assert.equal(body.tags,undefined);assert.doesNotMatch(JSON.stringify(body),/SECRET123|secret-cookie/);
});
test('중지 알림은 로그인 필요 사유를 전달하고 임의 원문은 전송하지 않는다',async()=>{
 const h=setup();await h.ctx.sendPhone('macro-stopped',{result:'stopped',reason:'로그인이 필요합니다.'});
 assert.match(JSON.parse(h.calls[0].init.body).message,/사유: 로그인이 필요/);
 await h.ctx.sendPhone('macro-stopped',{result:'stopped',reason:'예약번호 123456789 계정 개인정보'});
 assert.doesNotMatch(h.calls[1].init.body,/123456789|개인정보/);
});
