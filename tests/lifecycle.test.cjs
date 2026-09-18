// Loads content.js into a VM with a mocked page so the watch loop itself is
// covered, not just the pure helpers in core.js.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const core = require('../core.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

function setup(options = {}) {
  let now = 10000, tick, loading = false, hasRows = true;
  const reloads = [], sent = [], clicks = [];
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

  const element = (extra = {}) => Object.assign({
    value: '', textContent: '', className: '', style: {}, hidden: false, disabled: false,
    addEventListener: () => {}, removeEventListener: () => {}, append: () => {},
    getClientRects: () => [1], getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {},
    scrollIntoView: () => {}, click: () => {}, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, isConnected: true
  }, extra);

  // One KTX row. A bookable general seat is present only when asked for.
  const seatCell = element({
    className: options.seatOpen ? 'price_box fl-l gen' : 'price_box fl-l sold_out',
    querySelector: s => (s === 'a' ? seatLink : null)
  });
  const seatLink = element({textContent: '일반실 48,000원', closest: () => seatCell});
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
    body: {innerText: '', append: host => { host.isConnected = true; }},
    createElement: () => element({attachShadow: () => ui}),
    querySelector: s => (s in fields ? {value: fields[s]} : null),
    querySelectorAll: s => {
      if (s === 'li.tckList') return hasRows ? [row] : [];
      if (s.includes('progressbar')) return loading ? [element()] : [];
      if (s === '#layerPopup, .layerPopup') return [];
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
    location: {pathname: '/ticket/search/list', href: 'https://www.korail.com/ticket/search/list'},
    window: {addEventListener: () => {}},
    navigator: {locks: {request: async (_n, _o, fn) => fn({})}},
    getComputedStyle: () => ({visibility: 'visible'}),
    setInterval: fn => { tick = fn; },
    performance: {timeOrigin: 0, now: () => now, getEntriesByType: () => []},
    chrome: {runtime: {id: 'test', sendMessage: message => { sent.push(message); if (message.type === 'reload-search-tab') reloads.push(now); return Promise.resolve({ok: true}); }}},
    AudioContext: function () { return {state: 'running', currentTime: 0, destination: {}, createOscillator: () => ({connect: () => {}, frequency: {}, start: () => {}, stop: () => {}}), createGain: () => ({connect: () => {}, gain: {}}), resume: () => Promise.resolve()}; },
    console, JSON, Math, String, Number, Object, Array, Set, Map, RegExp, Promise, Error,
    KtxMacroCore: core
  };
  context.globalThis = context;
  vm.runInNewContext(SOURCE, context);

  const read = () => JSON.parse(sessionStorage.getItem('ktx-macro-v1'));
  return {
    async at(t) { now = t; await tick(); },
    document, row, seatCell, element,
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
