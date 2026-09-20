// Loads content.js into a VM with a mocked page so the watch loop itself is
// covered, not just the pure helpers in core.js.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const core = require('../core.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

function setup(options = {}) {
  let now = 10000, tick, loading = false, hasRows = true, dialog = null, waitVisible=false;
  const navigations=[], reloads = [], sent = [], clicks = [], entries = [];
  let activeTarget, nativeVerifier;
  const config = {
    from: '서울', to: '부산', date: '2026-09-16', people: '총 1명',
    matchMode: options.numbers ? 'trains' : 'time',
    start: '00:00', end: '23:59', numbers: options.numbers || '',
    cooldown: options.cooldown ?? 0, retryPolicy: 5, seat: 'gen',
    action: options.action || 'notify', autoNotice: true, useRequery: false, targetTickets:options.targetTickets||1, ...options.config
  };
  const store = seed => {
    const data = new Map(Object.entries(seed));
    return {getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k)};
  };
  const sessionStorage = store({'ktx-macro-v1': JSON.stringify(options.state || {running: true, config})});
  const localStorage = store({});

  const element = (extra = {}) => {
    const handlers=new Map();
    const el=Object.assign({
      value:'',textContent:'',className:'',style:{},hidden:false,disabled:false,
      addEventListener:(n,f)=>handlers.set(n,f), removeEventListener:n=>handlers.delete(n), append:()=>{},
      getClientRects:()=>[1],getBoundingClientRect:()=>({left:10,top:10,right:110,bottom:60}),
      getAttribute:()=>null,setAttribute:()=>{},removeAttribute:()=>{},contains:other=>other===el,
      scrollIntoView:()=>{activeTarget=el;},click:()=>{throw new Error('Synthetic click must not be called');},
      querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,isConnected:true,
      fire:()=>handlers.get('click')?.({isTrusted:true,defaultPrevented:false})
    },extra);
    return el;
  };

  // One KTX row. A bookable general seat is present only when asked for.
  const seatCell = element({
    className: options.seatOpen ? 'price_box fl-l gen' : options.waitOpen?'price_box fl-l wait':'price_box fl-l sold_out',
    querySelector: s => (s === 'a' ? seatLink : null)
  });
  const seatLink = element({textContent: options.waitOpen&&!options.seatOpen?'예약대기':'일반실 48,000원', closest: () => seatCell, getAttribute:n=>n==='title' && clicks.includes('seat')?'선택':null});
  const reserve=element({textContent:options.waitOpen&&!options.seatOpen?'예약대기신청':'예매'});
  const special=element({checked:false}),phone=element({checked:false}),waitSubmit=element({textContent:'대기신청'});
  const waitLayer=element({textContent:'예약대기 신청 일반실에 좌석이 없는 경우 특실로 예약하기 대기신청',querySelector:s=>s==='#specialSeatChecked'?special:s==='#phoneNumChangeChecked'?phone:s==='.password_pop.type_waiting.apply'?element():s==='h1,h2,h3,.tit'?element({textContent:'예약대기 신청'}):null,querySelectorAll:()=>[waitSubmit]});
  const reserveBar=element({querySelectorAll:()=>[reserve]});
  seatCell.querySelectorAll = s => (s === 'a' ? [seatLink] : []);
  const row = element({
    textContent: `KTX ${options.trainNumber || '031'}`,
    querySelector: s => {
      if (s === 'h3') return element({textContent: '서울 → 부산(13:13 ~ 16:33)'});
      if (s === '.num') return element({textContent: options.trainNumber || '031'});
      if (s === '.flag_wrap .blind') return element({textContent: options.type || 'KTX'});
      return null;
    },
    querySelectorAll: s => (s === '.price_box' ? [seatCell] : s === '.price_box a' ? [seatLink] : [])
  });

  const moreLink = element({textContent: '더보기', click: () => clicks.push('more')});
  const fields = {'#labelstart': config.from, '#labelend': config.to, '#startDate': config.date, '#labelple': config.people};
  const panel = new Map();
  const ui = {
    querySelector: s => ui.getElementById(s.slice(1)),
    getElementById: id => { if (!panel.has(id)) panel.set(id, element()); return panel.get(id); },
    querySelectorAll: () => []
  };
  const document = {
    readyState: 'complete',
    elementFromPoint:()=>options.covered?null:activeTarget,
    body: {innerText: '', append: host => { host.isConnected = true; }},
    createElement: () => element({attachShadow: () => ui}),
    querySelector: s => (s in fields ? {value: fields[s]} : null),
    querySelectorAll: s => {
      if (s === 'li.tckList') return hasRows ? [row] : [];
      if (s.includes('progressbar')) return loading ? [element()] : [];
      if (s === '#layerPopup, .layerPopup') return [...(dialog?[dialog]:[]),...(waitVisible?[waitLayer]:[])];
      if(s==='.ticket_reserv_wrap') return [reserveBar];
      if (s.includes('.tab_bar')) return [];
      if (s === 'a,button,[role="button"]' || s === 'a,button') return options.more ? [moreLink] : [];
      return [];
    },
    addEventListener: () => {}
  };
  class Clock extends Date { static now() { return now; } }

  const context = {
    globalThis: null, Date: Clock, document, sessionStorage, localStorage,
    crypto: {randomUUID: () => 'test-owner'},
    location: {origin:'https://www.korail.com',pathname: '/ticket/search/list', href: 'https://www.korail.com/ticket/search/list',assign:url=>navigations.push(url)},
    window: {confirm:()=>options.confirmReset===true,addEventListener: () => {}},
    navigator: {locks: {request: async (_n, _o, fn) => fn({})}},
    getComputedStyle: () => ({visibility: 'visible'}),
    setInterval: fn => { tick = fn; }, setTimeout: fn=>fn(), innerWidth:1000, innerHeight:800,
    performance: {timeOrigin: 0, now: () => now, getEntriesByType: () => entries},
    chrome: {runtime: {id: 'test', onMessage:{addListener:fn=>{nativeVerifier=fn;}}, sendMessage: message => {
      sent.push(message);
      if(message.type==='prepare-browser-input' && options.inputError) return Promise.resolve({ok:false,error:'입력 권한 없음'});
      if(message.type==='click-page-element') {
        let verified;
        nativeVerifier({...message,type:'verify-page-input'}, {id:'test'}, result=>{verified=result;});
        if(!verified?.ok) return Promise.resolve({ok:false,error:'문서 확인 실패'});
        clicks.push(message.step);activeTarget.fire();
        if(message.step==='dialog' && activeTarget===special) special.checked=!special.checked;
        else if(message.step==='dialog' && !options.stickyDialog) dialog=null;
      }
      if(message.type==='reload-search-tab') reloads.push(now);
      return Promise.resolve({ok:true});
    }}},
    AudioContext: function () { return {state: 'running', currentTime: 0, destination: {}, createOscillator: () => ({connect: () => {}, frequency: {}, start: () => {}, stop: () => {}}), createGain: () => ({connect: () => {}, gain: {setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}}}), resume: () => Promise.resolve()}; },
    console, URL, JSON, Math, String, Number, Object, Array, Set, Map, RegExp, Promise, Error,
    KtxMacroCore: core
  };
  context.globalThis = context;
  vm.runInNewContext(SOURCE, context);

  const read = () => JSON.parse(sessionStorage.getItem('ktx-macro-v1'));
  return {
    async at(t) { now = t; await tick(); },
    setWaitForm:v=>{waitVisible=v;},special,phone,waitSubmit,navigations,document, row, seatCell, element, entries, context, clicks, reserve, ui,
    setDialog: body => {
      const confirm=element({textContent:'확인',tagName:'BUTTON'});
      dialog=body?element({textContent:'이용안내 '+body+' 확인',querySelector:()=>element({textContent:'이용안내'}),querySelectorAll:()=>[confirm]}):null;
    },
    stop:()=>ui.getElementById('stop').onclick(),
    setRows: v => { hasRows = v; },
    setLoading: v => { loading = v; },
    reloads: () => reloads.length,
    moreClicks: () => clicks.filter(c => c === 'more').length,
    alarms: () => sent.filter(m => m.type === 'seat-found' || m.type === 'macro-stopped' || m.type==='wait-registered'),
    message: () => read().message || '',
    running: () => read().running === true,
    state: read
  };
}

// The list has to hold still before it is read, and then a re-query goes out.
test('안정된 목록을 읽은 뒤 재조회를 요청한다', async () => {
  const h = setup();
  await h.at(10000);
  await h.at(10100);
  assert.equal(h.reloads(), 0, '안정화 전에는 요청하지 않는다');
  await h.at(10500);
  await h.at(10620);
  assert.equal(h.reloads(), 1);
  assert.equal(h.running(), true);
});

test('대기열 화면에서는 추가 요청을 보내지 않고 계속 실행한다', async () => {
  const h = setup();
  await h.at(10000);
  h.document.body.innerText = '서비스 연결대기';
  await h.at(11000);
  await h.at(12000);
  assert.equal(h.reloads(), 0);
  assert.equal(h.running(), true);
});

test('접근 제한 안내가 뜨면 정지하고 알린다', async () => {
  const h = setup();
  await h.at(10000);
  h.document.body.innerText = '접근이 제한';
  await h.at(11000);
  assert.equal(h.running(), false);
  assert.equal(h.reloads(), 0);
  assert.equal(h.alarms().length, 1, '조용히 멈추지 않는다');
  assert.equal(h.alarms()[0].type, 'macro-stopped');
});

test('로딩 중에는 목록이 있어도 요청하지 않는다', async () => {
  const h = setup();
  await h.at(10000);
  h.setLoading(true);
  await h.at(15000);
  assert.equal(h.reloads(), 0);
});

// The empty screen means the query failed, so it must not be read as sold out
// and it must not stop the watch.
test('빈 결과는 매진이 아니라 조회 실패로 다루고 계속 시도한다', async () => {
  const h = setup();
  h.setRows(false);
  h.document.body.innerText = '해당 스케줄에 운행하는 열차가 없습니다.';
  await h.at(10000);
  await h.at(13000);
  assert.equal(h.running(), true, '한 번의 빈 결과로 멈추지 않는다');
  assert.match(h.message() + h.state().lastRecovery, /조회 요청 실패|비어 있음/);
});

test('선택한 열차를 모두 확인했으면 더보기를 누르지 않는다', async () => {
  const h = setup({numbers: '031', more: true, trainNumber: '031'});
  await h.at(10000);
  await h.at(10500);
  await h.at(10620);
  assert.equal(h.moreClicks(), 0);
  assert.equal(h.running(), true);
});

test('선택한 열차가 첫 목록에 없으면 더보기를 누른다', async () => {
  const h = setup({numbers: '033', more: true, trainNumber: '031'});
  await h.at(10000);
  await h.at(10500);
  await h.at(10620);
  assert.equal(h.moreClicks(), 1);
  assert.equal(h.running(), true);
});

// Regression: a refused 더보기 wiped the already-loaded first batch, and the old
// build reported that as "no trains running" and burned its recovery budget.
test('더보기가 실패해 목록이 비어도 정지하지 않고 더보기를 중단한다', async () => {
  const h = setup({numbers: '033', more: true, trainNumber: '031'});
  await h.at(10000);
  await h.at(10500);
  await h.at(10620);
  assert.equal(h.moreClicks(), 1);
  h.setRows(false);
  h.document.body.innerText = '해당 스케줄에 운행하는 열차가 없습니다.';
  await h.at(11000);
  await h.at(14000);
  assert.match(h.state().lastRecovery || '', /더보기/, '빈 결과가 아니라 더보기 실패로 보고한다');
  assert.ok(Object.keys(h.state().moreFailures || {}).length > 0, '더보기 실패로 기록한다');
  assert.equal(h.running(), true, '더보기 실패만으로 감시를 끝내지 않는다');
});

// Regression: the highlight from an earlier run stayed on its row, so two
// different trains both looked selected.
test('좌석을 찾으면 알리고 정지하며 이전 강조를 지운다', async () => {
  const h = setup({numbers: '031', trainNumber: '031', seatOpen: true, action: 'notify'});
  const stale = h.element({style: {boxShadow: '0 0 0 3px #0865cb'}});
  const original = h.document.querySelectorAll;
  h.document.querySelectorAll = s => (s === 'li.tckList' ? [stale, h.row] : original(s));
  await h.at(10000);
  await h.at(10500);
  await h.at(10620);
  assert.equal(h.running(), false, '알림 후 정지 설정이면 멈춘다');
  assert.match(h.message(), /좌석 발견/);
  assert.equal(h.alarms().length, 1);
  assert.equal(h.alarms()[0].type, 'seat-found');
  assert.equal(stale.style.boxShadow, '', '이전 실행의 발견 강조가 남지 않는다');
  assert.equal(h.row.style.boxShadow, '0 0 0 3px #0865cb', '찾은 열차에 강조가 붙는다');
});

// Watched trains are marked so the user can see what the macro is looking at.
test('감시 대상 열차만 점선으로 표시하고 정지하면 지운다', async () => {
  // A cooldown keeps the loop from requesting a reload, which this mock cannot
  // follow, so the stop path stays reachable.
  const h = setup({numbers: '031', trainNumber: '031', cooldown: 5});
  const other = h.element({
    querySelector: s => h.element({textContent: s === 'h3' ? '서울 → 부산(15:00 ~ 18:00)' : s === '.num' ? '999' : 'KTX'}),
    querySelectorAll: () => []
  });
  const original = h.document.querySelectorAll;
  h.document.querySelectorAll = s => (s === 'li.tckList' ? [h.row, other] : original(s));
  await h.at(10000);
  await h.at(10500);
  await h.at(10620);
  assert.equal(h.row.style.outline, '2px dashed #94a3b8', '감시 대상에 표시가 붙는다');
  assert.equal(other.style.outline, '', '감시 대상이 아닌 열차에는 붙지 않는다');
  h.document.body.innerText = '접근이 제한';
  await h.at(11000);
  assert.equal(h.running(), false);
  assert.equal(h.row.style.outline, '', '정지하면 감시 표시를 지운다');
});

test('검색 조건이 바뀌면 정지하고 알린다', async () => {
  const h = setup();
  await h.at(10000);
  h.document.querySelector = s => (s === '#labelend' ? {value: '대전'} : {value: s === '#labelstart' ? '서울' : s === '#startDate' ? '2026-09-16' : '총 1명'});
  await h.at(11000);
  assert.equal(h.running(), false);
  assert.match(h.message(), /검색 조건/);
  assert.equal(h.alarms().length, 1);
});

async function toReserve(h) {
  await h.at(10000); await h.at(10500); await h.at(10620); await h.at(11500);
}
test('자동 예매는 합성 click 없이 브라우저 입력으로 좌석과 예매를 한 번씩 누른다',async()=>{
  const h=setup({seatOpen:true,action:'reserve'}); await toReserve(h);
  assert.deepEqual(h.clicks,['seat','reserve']);
  assert.equal(h.state().booking.phase,'confirming');
  assert.equal(h.state().trace.find(e=>e.step==='reserve-event').isTrusted,true);
  await h.at(13000); await h.at(15000);
  assert.deepEqual(h.clicks,['seat','reserve']);
});
test('HTTP 500 이후 예매를 반복하지 않고 중지한다',async()=>{
  const h=setup({seatOpen:true,action:'reserve'}); await toReserve(h);
  h.entries.push({initiatorType:'xmlhttprequest',name:'https://www.korail.com/web_r/example',startTime:11600,responseEnd:12000,responseStatus:500,duration:400});
  await h.at(12100); await h.at(12220);
  assert.equal(h.running(),false); assert.match(h.message(),/HTTP 500/);
  assert.deepEqual(h.clicks,['seat','reserve']);
});
test('수동 비교에서 본 로그인 화면 이동을 예매 성공으로 오판하지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve'}); await toReserve(h);
  h.context.location.pathname='/ticket/login'; await h.at(12000);
  assert.equal(h.running(),false); assert.match(h.message(),/로그인/);
});
test('브라우저 입력 권한이 없으면 합성 클릭으로 대체하지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',inputError:true}); await toReserve(h);
  assert.equal(h.running(),false); assert.deepEqual(h.clicks,[]); assert.match(h.message(),/권한/);
});
test('버튼이 가려졌으면 좌표 클릭을 보내지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',covered:true}); await toReserve(h);
  assert.equal(h.running(),false); assert.deepEqual(h.clicks,[]); assert.match(h.message(),/가려/);
});

async function soldOut(h,t=12100) {
  h.entries.push({initiatorType:'xmlhttprequest',name:'https://www.korail.com/web_r/result',startTime:t-200,responseEnd:t-50,responseStatus:200,duration:150});
  h.setDialog('잔여석이 없습니다.');
  await h.at(t);await h.at(t+120);
}
test('잔여석 없음 이후 같은 열차의 예매만 반복하고 성공하면 멈춘다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',numbers:'031,145'});await toReserve(h);
  for(let i=0;i<4;i++) {
    const t=12100+i*4000;await soldOut(h,t);
    assert.equal(h.state().booking.phase,'retry-wait');
    await h.at(t+500);assert.equal(h.clicks.filter(x=>x==='reserve').length,i+1);
    await h.at(t+1200);await h.at(t+2100);
    assert.equal(h.clicks.filter(x=>x==='reserve').length,i+2);
    assert.equal(h.state().booking.number,'31');
  }
  assert.equal(h.clicks.filter(x=>x==='seat').length,1);assert.equal(h.reloads(),0);
  h.context.location.pathname='/ticket/reservation/detail';await h.at(29000);
  assert.equal(h.running(),false);
});
test('닫히지 않은 잔여석 안내와 로딩 중에는 예매를 다시 누르지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',stickyDialog:true});await toReserve(h);await soldOut(h);
  await h.at(16000);assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
  h.setDialog(null);h.setLoading(true);await h.at(17000);
  assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
  h.setLoading(false);await h.at(18000);await h.at(18900);
  assert.equal(h.clicks.filter(x=>x==='reserve').length,2);
});
test('일반 실패 안내와 HTTP 오류는 잔여석 없음 재시도로 처리하지 않는다',async()=>{
  for(const message of ['예약에 실패했습니다.','잔여석이 없습니다.']) {
    const h=setup({seatOpen:true,action:'reserve'});await toReserve(h);
    h.setDialog(message);
    h.entries.push({initiatorType:'xmlhttprequest',name:'https://www.korail.com/web_r/result',startTime:11600,responseEnd:12000,responseStatus:message.startsWith('잔여')?500:200,duration:400});
    await h.at(12100);await h.at(12220);await h.at(15000);
    assert.equal(h.running(),false);assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
  }
});
test('재시도 대기 중 사용자가 중지하면 추가 예매가 없다',async()=>{
  const h=setup({seatOpen:true,action:'reserve'});await toReserve(h);await soldOut(h);
  // Simulate the panel stop action via its handler.
  h.stop();await h.at(15000);await h.at(16000);
  assert.equal(h.running(),false);assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
});

test('설정을 접어도 대상 번호가 보이고 예매 중에는 한 열차에 집중 표시한다',async()=>{
 const h=setup({seatOpen:true,action:'reserve',numbers:'031,145'});
 await h.at(10000);
 assert.match(h.ui.getElementById('targetList').innerHTML,/KTX 031/);
 assert.match(h.ui.getElementById('targetList').innerHTML,/KTX 145/);
 assert.match(h.ui.getElementById('miniLabel').textContent,/031.*145/);
 await h.at(10500);await h.at(10620);
 assert.match(h.ui.getElementById('targetList').innerHTML,/집중 예매/);
 assert.doesNotMatch(h.ui.getElementById('targetList').innerHTML,/KTX 145/);
 assert.match(h.ui.getElementById('miniLabel').textContent,/집중 예매.*031/);
});


// Synthetic receipts exercise the state machine; they are not evidence that
// Korail's authenticated detail layout has been verified in a live booking.
const receiptText=(id='12345-67890',seat='12A',extra='')=>
  `예약이 완료되었습니다 예약번호 ${id} KTX 031 서울 → 부산 2026-09-16 13:13 총 1명 5호차 ${seat} 결제기한: 2026년 09월 16일 15:20:00 예약취소 ${extra}`;
async function showReceipt(h,id,seat,t) {
  h.context.location.pathname='/ticket/reservation/detail';
  h.document.body.innerText=receiptText(id,seat);
  await h.at(t);
}
async function backToList(h,t) {
  h.context.location.pathname='/ticket/search/list';h.document.body.innerText='';
  await h.at(t);await h.at(t+500);await h.at(t+1000);await h.at(t+1120);await h.at(t+2000);
}
test('2장 목표: 한 장 확인 후 같은 열차를 다시 예약하고 두 장에서 정지한다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2,numbers:'031,145'});
  await toReserve(h);await showReceipt(h,'12345-67890','12A',12000);
  assert.equal(h.state().reservations.length,1);assert.equal(h.running(),true);
  assert.equal(h.state().booking.phase,'returning');
  assert.equal(h.navigations.length,1);assert.equal(h.state().focusTrain.number,'31');
  await backToList(h,13000);
  assert.equal(h.clicks.filter(x=>x==='reserve').length,2);
  await showReceipt(h,'12345-67891','19D',16000);
  assert.equal(h.state().reservations.length,2);assert.equal(h.running(),false);
  assert.match(h.message(),/목표 달성/);assert.match(h.ui.getElementById('bookingProgress').textContent,/2\/2장/);
  await h.at(18000);assert.equal(h.clicks.filter(x=>x==='reserve').length,2);
  assert.equal(h.navigations.length,1);assert.equal(h.alarms().length,2);
  assert.ok(!JSON.stringify(h.state().trace).includes('12345'),'진단 기록에 예약번호 없음');
});
test('예약번호 또는 배정 좌석이 중복이면 수량을 늘리거나 재조회하지 않는다',async()=>{
  for(const [id,seat] of [['12345-67890','19D'],['12345-67891','12A']]) {
    const h=setup({seatOpen:true,action:'reserve',targetTickets:2});await toReserve(h);
    await showReceipt(h,'12345-67890','12A',12000);await backToList(h,13000);
    await showReceipt(h,id,seat,16000);
    assert.equal(h.state().reservations.length,1);assert.equal(h.running(),false);
    assert.match(h.message(),/중복/);assert.equal(h.navigations.length,1);
  }
});
test('예약 상세 경로만으로 여러 장 성공을 집계하지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2});await toReserve(h);
  h.context.location.pathname='/ticket/reservation/detail';await h.at(12000);await h.at(58000);
  assert.equal(h.running(),false);assert.equal(h.state().reservations?.length||0,0);
  assert.equal(h.navigations.length,0);assert.match(h.message(),/확인하지 못/);
});
test('첫 예약 뒤에는 다른 후보 열차를 클릭하지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2,numbers:'031,145'});await toReserve(h);
  await showReceipt(h,'12345-67890','12A',12000);
  const original=h.row.querySelector;
  h.row.querySelector=s=>s==='.num'?h.element({textContent:'145'}):original(s);
  await backToList(h,13000);
  assert.equal(h.clicks.filter(x=>x==='seat').length,1);
});
test('새 문서로 돌아와도 예약 집계와 고정 열차를 유지한다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2});await toReserve(h);
  await showReceipt(h,'12345-67890','12A',12000);
  const fresh=setup({seatOpen:true,action:'reserve',targetTickets:2,state:h.state()});
  await fresh.at(13000);
  assert.equal(fresh.state().reservations.length,1);assert.equal(fresh.state().booking,undefined);
  assert.equal(fresh.state().focusTrain.number,'31');assert.equal(fresh.navigations.length,0);
});
test('먼저 예약한 표의 결제 기한이 2분 이내면 추가 예매를 멈춘다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2});await toReserve(h);
  await showReceipt(h,'12345-67890','12A',12000);
  const deadline=h.state().reservations[0].due;await h.at(deadline-120000);
  assert.equal(h.running(),false);assert.match(h.message(),/결제 기한이 임박/);
  assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
});
test('결제 기한이 읽히지 않으면 첫 장은 집계하되 추가 예약을 멈춘다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2});await toReserve(h);
  h.context.location.pathname='/ticket/reservation/detail';
  h.document.body.innerText=receiptText().replace(/결제기한:.*예약취소/,'');await h.at(12000);
  assert.equal(h.state().reservations.length,1);assert.equal(h.running(),false);
  assert.equal(h.navigations.length,0);assert.match(h.message(),/기한을 읽지/);
});
test('초기화는 명시적으로 확인할 때만 로컬 집계를 지운다',async()=>{
  for(const confirmReset of [false,true]) {
    const h=setup({seatOpen:true,action:'reserve',targetTickets:2,confirmReset});await toReserve(h);
    await showReceipt(h,'12345-67890','12A',12000);h.stop();
    h.ui.getElementById('resetTickets').onclick();
    assert.equal(h.state().reservations?.length||0,confirmReset?0:1);
    assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
  }
});
test('여러 장 시작 시 웹 조회 인원 2명 또는 알림 전용 동작은 거절한다',async()=>{
  for(const options of [{config:{people:'총 2명'},action:'reserve'},{action:'notify'}]) {
    const h=setup({targetTickets:2,...options});await h.at(10000);h.stop();
    h.ui.getElementById('start').onclick();
    assert.equal(h.running(),false);assert.match(h.ui.getElementById('status').textContent,/웹 조회 인원 1명/);
  }
});
test('첫 예약 뒤 복귀한 화면의 조회 구간이 다르면 추가 예약하지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2});await toReserve(h);
  await showReceipt(h,'12345-67890','12A',12000);
  const original=h.document.querySelector;
  h.document.querySelector=s=>s==='#labelend'?{value:'대전'}:original(s);
  await backToList(h,13000);
  assert.equal(h.running(),false);assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
});
test('연속 예약의 HTTP 오류는 상세 화면 문구가 있어도 성공 집계하지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2});await toReserve(h);
  h.entries.push({initiatorType:'xmlhttprequest',name:'https://www.korail.com/web_r/result',startTime:11600,responseEnd:12000,responseStatus:500,duration:400});
  await h.at(12100);await showReceipt(h,'12345-67890','12A',12220);
  assert.equal(h.running(),false);assert.equal(h.state().reservations?.length||0,0);
  assert.equal(h.navigations.length,0);assert.match(h.message(),/HTTP 500/);
});
test('시간대 모드의 고정 열차가 뒤쪽에 있으면 더보기 2회에 제한되지 않는다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',targetTickets:2,more:true});await toReserve(h);
  await showReceipt(h,'12345-67890','12A',12000);
  let hour=1;
  const original=h.row.querySelector;
  h.row.querySelector=s=>s==='.num'?h.element({textContent:'145'}):s==='h3'?h.element({textContent:`서울 → 부산(${String(hour).padStart(2,'0')}:00 ~ 16:33)`}):original(s);
  h.context.location.pathname='/ticket/search/list';h.document.body.innerText='';
  await h.at(13000);
  for(let i=0;i<5;i++) {
    hour=i+1;h.row.textContent='KTX 145 '+hour;
    await h.at(14000+i*2000);await h.at(14500+i*2000);await h.at(15100+i*2000);
  }
  assert.ok(h.moreClicks()>=3);assert.equal(h.clicks.filter(x=>x==='reserve').length,1);
});
test('이전 탭 재조회 설정이 남아 있어도 브라우저 새로고침을 사용한다',async()=>{
  const h=setup({config:{useRequery:true}});
  await h.at(10000);await h.at(10500);await h.at(10620);
  assert.equal(h.reloads(),1);assert.ok(!h.clicks.includes('requery'));
});
test('이전 안내 자동 확인 해제 값이 남아 있어도 알려진 안내를 확인한다',async()=>{
  const h=setup({seatOpen:true,action:'reserve',config:{autoNotice:false,allowDetour:false}});
  await toReserve(h);h.setDialog('동대구 우회하는 열차입니다. 도착시간을 확인하시기 바랍니다.');
  await h.at(12000);
  assert.ok(h.clicks.includes('dialog'));assert.equal(h.running(),true);
});


async function submitWait(h) {
  await toReserve(h);
  h.setWaitForm(true);await h.at(12000);await h.at(12500);await h.at(13400);
}
test('예약대기 선택→하단 신청→신청창 대기신청→접수 알림 후 정지, 좌석 집계는 그대로',async()=>{
  const h=setup({waitOpen:true,action:'reserve',targetTickets:2});await submitWait(h);
  assert.equal(h.state().booking.mode,'wait');assert.equal(h.state().booking.phase,'wait-submitted');
  assert.deepEqual(h.clicks,['seat','reserve','reserve']);
  h.setWaitForm(false);h.context.location.pathname='/ticket/reservation/detail';
  h.document.body.innerText='예약대기 신청이 완료되었습니다.';await h.at(14000);
  assert.equal(h.running(),false);assert.equal(h.state().reservations?.length||0,0);
  assert.equal(h.state().waitlisted.number,'31');assert.equal(h.alarms().at(-1).type,'wait-registered');
  assert.match(h.ui.getElementById('bookingProgress').textContent,/좌석 미확보/);
  await h.at(15000);assert.deepEqual(h.clicks,['seat','reserve','reserve']);
});
test('알림 전용 모드는 예약대기를 신청하지 않는다',async()=>{
  const h=setup({waitOpen:true,action:'notify'});await toReserve(h);
  assert.equal(h.clicks.length,0);assert.equal(h.state().booking,undefined);
});
test('예약대기보다 현재 목록의 즉시 예매 좌석을 우선한다',async()=>{
  const h=setup({waitOpen:true,action:'reserve'});
  const seat=h.element({textContent:'일반실 48,000원'});
  const box=h.element({className:'price_box gen',querySelector:()=>seat});
  const extra=h.element({textContent:'KTX 145',querySelector:s=>s==='.num'?h.element({textContent:'145'}):h.row.querySelector(s),querySelectorAll:()=>[box]});
  const original=h.document.querySelectorAll;
  h.document.querySelectorAll=s=>s==='li.tckList'?[h.row,extra]:original(s);
  await h.at(10000);await h.at(10500);
  assert.equal(h.state().booking.number,'145');assert.notEqual(h.state().booking.mode,'wait');
});
test('예약대기 접수는 화면 이동이나 HTTP 200만으로 성공 처리하지 않는다',async()=>{
  const h=setup({waitOpen:true,action:'reserve'});await submitWait(h);
  h.setWaitForm(false);h.context.location.pathname='/ticket/reservation/detail';
  h.document.body.innerText='예약이 완료되었습니다';await h.at(14000);await h.at(60000);
  assert.equal(h.running(),false);assert.equal(h.state().waitlisted,undefined);
  assert.match(h.message(),/확인하지 못/);assert.equal(h.alarms().at(-1).type,'macro-stopped');
});
test('예약대기 신청 시 특실 허용은 설정대로, 전화번호 전송 동의는 자동으로 켜지 않는다',async()=>{
  const h=setup({waitOpen:true,action:'reserve',config:{seat:'either'}});await submitWait(h);
  assert.equal(h.special.checked,true);assert.equal(h.phone.checked,false);
  assert.equal(h.state().booking.phase,'wait-submitted');
});
test('예약대기 요청 오류는 재전송하지 않고 정지한다',async()=>{
  const h=setup({waitOpen:true,action:'reserve'});await submitWait(h);
  h.entries.push({initiatorType:'fetch',name:'https://www.korail.com/web_r/wait',startTime:13400,responseEnd:13500,responseStatus:500,duration:100});
  await h.at(14000);await h.at(15000);
  assert.equal(h.running(),false);assert.equal(h.state().waitlisted,undefined);
  assert.match(h.message(),/HTTP 500/);assert.deepEqual(h.clicks,['seat','reserve','reserve']);
});
test('예약대기 신청 버튼 클릭 후 새 문서에서도 중복 신청하지 않는다',async()=>{
  const h=setup({waitOpen:true,action:'reserve'});await submitWait(h);
  const fresh=setup({waitOpen:true,action:'reserve',state:h.state()});
  fresh.context.location.pathname='/ticket/reservation/detail';fresh.document.body.innerText='예약대기 신청 완료';
  await fresh.at(14000);
  assert.equal(fresh.running(),false);assert.equal(fresh.state().waitlisted.number,'31');assert.equal(fresh.clicks.length,0);
});
test('휴대폰 입력이 켜진 예약대기 신청창은 자동 제출하지 않는다',async()=>{
 const h=setup({waitOpen:true,action:'reserve'});await toReserve(h);
 h.phone.checked=true;h.setWaitForm(true);await h.at(12000);
 assert.equal(h.running(),false);assert.deepEqual(h.clicks,['seat','reserve']);
 assert.match(h.message(),/번호·동의/);
});
