// Loads content.js into a VM with a mocked page so the watch loop itself is
// covered, not just the pure helpers in core.js.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const core = require('../core.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

function setup(options = {}) {
  let now = 10000, tick, loading = false, hasRows = true, dialog = null;
  const reloads = [], sent = [], clicks = [], entries = [];
  let activeTarget, nativeVerifier;
  const config = {
    from: '서울', to: '부산', date: '2026-09-16', people: '총 1명',
    matchMode: options.numbers ? 'trains' : 'time',
    start: '00:00', end: '23:59', numbers: options.numbers || '',
    cooldown: options.cooldown ?? 0, retryPolicy: 5, seat: 'gen',
    action: options.action || 'notify', autoNotice: true, useRequery: false
  };
  const store = seed => {
    const data = new Map(Object.entries(seed));
    return {getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k)};
  };
  const sessionStorage = store({'ktx-macro-v1': JSON.stringify({running: true, config})});
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
    className: options.seatOpen ? 'price_box fl-l gen' : 'price_box fl-l sold_out',
    querySelector: s => (s === 'a' ? seatLink : null)
  });
  const seatLink = element({textContent: '일반실 48,000원', closest: () => seatCell, getAttribute:n=>n==='title' && clicks.includes('seat')?'선택':null});
  const reserve=element({textContent:'예매'});
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
      if (s === '#layerPopup, .layerPopup') return dialog?[dialog]:[];
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
    location: {origin:'https://www.korail.com',pathname: '/ticket/search/list', href: 'https://www.korail.com/ticket/search/list'},
    window: {addEventListener: () => {}},
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
        if(message.step==='dialog' && !options.stickyDialog) dialog=null;
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
    document, row, seatCell, element, entries, context, clicks, reserve, ui,
    setDialog: body => {
      const confirm=element({textContent:'확인',tagName:'BUTTON'});
      dialog=body?element({textContent:'이용안내 '+body+' 확인',querySelector:()=>element({textContent:'이용안내'}),querySelectorAll:()=>[confirm]}):null;
    },
    stop:()=>ui.getElementById('stop').onclick(),
    setRows: v => { hasRows = v; },
    setLoading: v => { loading = v; },
    reloads: () => reloads.length,
    moreClicks: () => clicks.filter(c => c === 'more').length,
    alarms: () => sent.filter(m => m.type === 'seat-found' || m.type === 'macro-stopped'),
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
