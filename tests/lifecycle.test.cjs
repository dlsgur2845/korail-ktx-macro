const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const core=require('../core.js');
function setup(options={}) {
 let now=10000,tick,reloads=0,loading=false, hasRows=true, moreClicks=0;
 const config={from:'서울',to:'부산',date:'2026-09-16',people:'총 1명',start:'00:00',end:'23:59',numbers:options.numbers||'',cooldown:3,pages:options.pages||1,hours:12,seat:'gen',action:'notify'};
 const initial={running:true,expires:999999,config};
 const store=initial=>{const data=new Map(Object.entries(initial));return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
 const sessionStorage=store({'ktx-macro-v1':JSON.stringify(initial)}),localStorage=store({});
 const controls=new Map();
 const element=()=>({value:'',textContent:'',addEventListener:()=>{},style:{},getClientRects:()=>[1]});
 const ui={querySelector:s=>ui.getElementById(s.slice(1)),getElementById:id=>{if(!controls.has(id)) controls.set(id,element());return controls.get(id);},querySelectorAll:()=>[]};
 const fields={'#labelstart':config.from,'#labelend':config.to,'#startDate':config.date,'#labelple':config.people};
 const row={...element(),textContent:'KTX 031 매진',querySelector:s=>s.startsWith('.price_box')?null:({textContent:s==='h3'?'서울 → 부산(13:13 ~ 16:33)':s==='.num'?'031':s==='.flag_wrap .blind'?(options.type||'ITX-새마을'):''})};
 const document={readyState:'complete',body:{innerText:'',append:h=>h.isConnected=true},createElement:()=>({...element(),attachShadow:()=>ui}),querySelector:s=>s in fields?{value:fields[s]}:null,querySelectorAll:s=>s==='li.tckList'?(hasRows?[row]:[]):s==='a'&&options.more?[{...element(),textContent:'더보기',getAttribute:()=>null,click:()=>moreClicks++}]:s.includes('progressbar')&&loading?[element()]:[]};
 class Clock extends Date {static now(){return now}}
 const context={globalThis:null,Date:Clock,document,sessionStorage,localStorage,crypto:{randomUUID:()=> 'test-owner'},location:{pathname:'/ticket/search/list',reload:()=>reloads++},window:{addEventListener:()=>{}},navigator:{locks:{request:async(_n,_o,fn)=>fn({})}},getComputedStyle:()=>({visibility:'visible'}),setInterval:fn=>tick=fn,KtxMacroCore:core};
 context.globalThis=context;
 vm.runInNewContext(fs.readFileSync('content.js','utf8'),context);
 return {async at(t){now=t;await tick()},document,setRows:v=>hasRows=v,moreClicks:()=>moreClicks,message:()=>JSON.parse(sessionStorage.getItem('ktx-macro-v1')).message,setLoading:v=>loading=v,reloads:()=>reloads,running:()=>JSON.parse(sessionStorage.getItem('ktx-macro-v1')).running};
}
test('목록 안정화 후 최소 대기가 끝나야 새로고침',async()=>{
 const h=setup();await h.at(10000);await h.at(11000);await h.at(13999);assert.equal(h.reloads(),0);await h.at(14000);assert.equal(h.reloads(),1);
});
test('재조회 예정 시각이 지나도 대기열이면 요청 금지',async()=>{
 const h=setup();await h.at(10000);await h.at(11000);h.document.body.innerText='서비스 연결대기';await h.at(15000);assert.equal(h.reloads(),0);assert.equal(h.running(),true);
});
test('대기 중 차단 안내가 표시되면 즉시 정지',async()=>{
 const h=setup();await h.at(10000);await h.at(11000);h.document.body.innerText='접근이 제한';await h.at(12000);assert.equal(h.reloads(),0);assert.equal(h.running(),false);
});
test('로딩 중에는 기존 목록이 있어도 새 요청 금지',async()=>{
 const h=setup();await h.at(10000);await h.at(11000);h.setLoading(true);await h.at(15000);assert.equal(h.reloads(),0);
});
test('운행 열차 없음 안내를 로딩으로 오인하거나 재조회하지 않음',async()=>{
 const h=setup();h.setRows(false);h.document.body.innerText='해당 스케줄에 운행하는 열차가 없습니다.';await h.at(10000);
 assert.equal(h.running(),false);assert.equal(h.reloads(),0);assert.match(h.message(),/매진으로 판정한 것이 아닙니다/);
});
test('선택한 열차를 모두 확인했으면 더보기 요청하지 않음',async()=>{
 const h=setup({numbers:'031',pages:3,more:true,type:'KTX'});await h.at(10000);await h.at(11000);
 assert.equal(h.moreClicks(),0);assert.equal(h.running(),true);
});
test('선택 열차가 아직 없으면 더보기 수행',async()=>{
 const h=setup({numbers:'033',pages:3,more:true,type:'KTX'});await h.at(10000);await h.at(11000);assert.equal(h.moreClicks(),1);
 h.setRows(false);h.document.body.innerText='해당 스케줄에 운행하는 열차가 없습니다.';await h.at(12000);
 assert.equal(h.running(),false);assert.match(h.message(),/더보기 2번째/);
});
