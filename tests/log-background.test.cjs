'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
 let listener;const calls=[];
 const chrome={runtime:{id:'ext',getURL:p=>'chrome-extension://ext/'+p,onMessage:{addListener:f=>listener=f},onStartup:{addListener(){}}},tabs:{create:o=>calls.push(o)},alarms:{create(){},onAlarm:{addListener(){}}}};
 const context={chrome,URL,Date,Number,importScripts(){},navigator:{storage:{}},KtxFileLog:class{deleteFile(name){calls.push(name);return Promise.resolve();}append(e){calls.push(e);return Promise.resolve();}list(){return Promise.resolve([]);}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../log-background.js'),'utf8'),context);
 return {calls,send:(m,s)=>new Promise(resolve=>{const handled=listener(m,s,resolve);if(handled!==true)resolve(null);})};
}
const sender={id:'ext',frameId:0,tab:{id:1},url:'https://www.korail.com/ticket/search/list'};
test('log endpoint checks sender and strips unlisted sensitive fields',async()=>{
 const h=setup();const event={step:'internal-error',error:'failed https://example.com/token',cookie:'secret',reservationId:'12345',kind:'spe'};
 assert.equal((await h.send({type:'append-file-log',event},sender)).ok,true);
 assert.equal(h.calls[0].cookie,undefined);assert.equal(h.calls[0].reservationId,undefined);assert.equal(h.calls[0].error,'failed [URL]');
 for(const patch of [{id:'foreign'},{frameId:1},{url:'https://evil.test/ticket/list'}])assert.equal((await h.send({type:'append-file-log',event},{...sender,...patch})).ok,false);
 assert.equal(h.calls.length,1);
});
test('only extension log page can list files',async()=>{
 const h=setup();assert.equal(await h.send({type:'list-file-logs'},sender),null);
 assert.equal((await h.send({type:'list-file-logs'},{id:'ext',url:'chrome-extension://ext/logs.html'})).ok,true);
});

test('only top-level extension log page can delete a log',async()=>{
 const h=setup(),message={type:'delete-file-log',name:'ktx-example.jsonl'};
 for(const s of [sender,{id:'foreign',frameId:0,url:'chrome-extension://ext/logs.html'},{id:'ext',frameId:1,url:'chrome-extension://ext/logs.html'}])assert.equal((await h.send(message,s)).ok,false);
 assert.equal(h.calls.length,0);
 assert.equal((await h.send(message,{id:'ext',frameId:0,url:'chrome-extension://ext/logs.html'})).ok,true);assert.deepEqual(h.calls,['ktx-example.jsonl']);
});

test('diagnostic context survives file allowlist while common identifiers are redacted',async()=>{
 const h=setup();await h.send({type:'append-file-log',event:{step:'booking-ended',runId:'run-a',documentId:'doc-a',sequence:7,seatKind:'spe',inputStage:'dispatch',label:'열차예매',codeLocations:'content.js:88:12',reason:'HTTP 오류로 중지',dialogBody:'오류 E123 연락처 010-1234-5678 abc@example.com 예약번호 12345-67890',cookie:'secret'}},sender);
 const e=h.calls[0];assert.equal(e.label,'열차예매');assert.equal(e.inputStage,'dispatch');assert.equal(e.codeLocations,'content.js:88:12');assert.equal(e.sequence,7);assert.match(e.reason,/HTTP/);assert.match(e.dialogBody,/E123/);
 assert.ok(!e.dialogBody.includes('010-1234'));assert.ok(!e.dialogBody.includes('abc@'));assert.ok(!e.dialogBody.includes('12345-67890'));assert.equal(e.cookie,undefined);
});
