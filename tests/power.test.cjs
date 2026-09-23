const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(saved={}){
 let listener,alarm,removed,updated,now=1000;const calls=[],data=saved;
 class Clock extends Date{static now(){return now;}}
 const ctx={Date:Clock,URL,chrome:{runtime:{id:'ext',onMessage:{addListener:f=>listener=f}},storage:{session:{get:async()=>data,set:async v=>Object.assign(data,v)}},power:{requestKeepAwake:l=>calls.push(l),releaseKeepAwake:()=>calls.push('release')},alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener:f=>alarm=f}},tabs:{onRemoved:{addListener:f=>removed=f},onUpdated:{addListener:f=>updated=f}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../power-background.js'),'utf8'),ctx);
 const sender={id:'ext',frameId:0,tab:{id:1},documentId:'a',url:'https://www.korail.com/ticket/search/list'};
 return {calls,data,send:(active,over={},source='normal')=>new Promise(r=>listener({type:'keep-awake',source,active},{...sender,...over},r)),expire:async()=>{now+=100000;alarm({name:'ktx-power-maintenance'});await vm.runInContext('powerQueue',ctx);},remove:async()=>{removed(1);await vm.runInContext('powerQueue',ctx);},ready:()=>vm.runInContext('powerQueue',ctx)};
}
test('display awake while running; stopping one tab preserves another tab',async()=>{
 const h=setup();await h.ready();await h.send(true);assert.equal(h.calls.at(-1),'display');
 await h.send(true,{tab:{id:2}});await h.send(false);assert.equal(h.calls.at(-1),'display');
 await h.send(false,{tab:{id:2}});assert.equal(h.calls.at(-1),'release');
});
test('reload replaces document lease and an old document cannot release it',async()=>{
 const h=setup();await h.send(true);await h.send(true,{documentId:'b'});await h.send(false);assert.equal(h.calls.at(-1),'display');
 await h.expire();assert.equal(h.calls.at(-1),'release');
});
test('closed tabs release normal and holiday leases',async()=>{
 const h=setup();await h.send(true);await h.send(true,{},'holiday');await h.remove();assert.equal(h.calls.at(-1),'release');
});
test('worker restart restores a live lease; invalid senders cannot request power',async()=>{
 const h=setup({ktxPowerLeases:{'1:normal':{tab:1,document:'a',until:90000}}});await h.ready();assert.equal(h.calls.at(-1),'display');
 for(const over of [{id:'other'},{frameId:1},{url:'https://evil.example'}])assert.equal((await h.send(true,over)).ok,false);
});
