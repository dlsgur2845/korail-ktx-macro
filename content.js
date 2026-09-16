(() => {
  'use strict';
  const C = globalThis.KtxMacroCore;
  const KEY = 'ktx-macro-v1';
  const SETTINGS_OPEN_KEY = 'ktx-macro-settings-open-v1';
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const owner = crypto.randomUUID();
  const LEASE = 'ktx-macro-lease-v1';
  let state = read(), busy = false, host, ui, next = 0, waitingSince = 0;
  if (state.config && !('cooldown' in state.config)) {
    state.running = false;
    state.config.cooldown = 3;
    state.message = '응답 기반 조회로 업데이트했습니다. 설정을 확인하고 다시 시작해주세요.';
  }
  let requestAt = Date.now(), signature = '', stableAt = Date.now(), responseMs = 0;
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const query = s => document.querySelector(s);
  const value = s => query(s)?.value || '';
  const text = el => C.clean(el?.textContent);
  const fields = () => ({from:value('#labelstart'), to:value('#labelend'), date:value('#startDate'), people:value('#labelple')});
  const list = () => [...document.querySelectorAll('li.tckList')].filter(visible);
  function status(message) { if (ui) ui.querySelector('#status').textContent = message; }
  function stop(message) { releaseLease(); state.running = false; state.message = message; save(); status(message); controls(); }
  function controls() {
    if (!ui) return;
    ui.querySelectorAll('input,select').forEach(el => { el.disabled = !!state.running; });
    ui.querySelector('#start').disabled = !!state.running;
    ui.querySelector('#stop').disabled = !state.running;
    ui.querySelector('#loadTrains').disabled = !!state.running;
  }
  function notify(message) {
    document.title = '🔔 KTX 좌석 발견';
    chrome.runtime.sendMessage({type:'seat-found', message}).catch(()=>{});
    status(message);
    // User gesture at Start unlocks audio when the browser permits it.
    if (audio) {
      for (let i=0; i<3; i++) {
        const oscillator=audio.createOscillator(), gain=audio.createGain();
        oscillator.connect(gain); gain.connect(audio.destination); gain.gain.value=.12;
        oscillator.frequency.value=880; oscillator.start(audio.currentTime+i*.45);
        oscillator.stop(audio.currentTime+i*.45+.2);
      }
    }
  }
  let audio;
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'ktx-macro-panel';
    host.style.cssText='position:fixed;right:16px;top:min(100px,8vh);width:min(328px,calc(100vw - 32px));z-index:2147483646;';
    ui = host.attachShadow({mode:'open'});
    ui.innerHTML = `<style>
      :host{font:14px system-ui;color:#192b40}section{box-sizing:border-box;width:100%;max-height:calc(100vh - min(100px,8vh) - 16px);max-height:calc(100dvh - min(100px,8vh) - 16px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;background:#fff;border:1px solid #ccd5e0;border-radius:14px;box-shadow:0 8px 32px #0003;padding:18px}.actions{position:sticky;bottom:-18px;background:#fff;padding:10px 0;margin-top:8px;border-top:1px solid #e0e6ed;z-index:1}h2{font-size:18px;margin:0 0 10px}p{font-size:12px;line-height:1.5;color:#59667a}label{display:block;margin:10px 0 4px}input,select,button{box-sizing:border-box;font:inherit;padding:8px;border:1px solid #b8c6d6;border-radius:6px}input,select{width:100%;background:white;color:#192b40}.times{display:flex;gap:8px}.times input{width:50%}button{cursor:pointer;background:#0865cb;color:white}button:disabled{opacity:.45;cursor:default}#stop{background:#fff;color:#192b40}#status{white-space:pre-wrap;background:#eef4fa;padding:10px;border-radius:8px;font-size:12px;line-height:1.5;max-height:150px;overflow:auto}details summary{cursor:pointer}#trainPicker{max-height:180px;overflow:auto}#trainPicker label{display:flex;align-items:flex-start;gap:7px;font-size:12px}#trainPicker input{width:auto;margin-top:3px}#loadTrains{margin-top:8px;font-size:12px}#route{overflow-wrap:anywhere}</style>
      <section><h2>KTX 잔여석 매크로</h2><p id="route">웹에서 날짜·구간·인원을 선택하고 조회하세요.</p>
      <details id="querySettings"><summary>조회 설정</summary>
      <label>출발 시간대</label><div class="times"><input id="fromTime" type="time" value="00:00" aria-label="시작 시간"><input id="toTime" type="time" value="23:59" aria-label="종료 시간"></div>
      <label for="numbers">감시할 열차 번호 (하나 또는 여러 개)</label><input id="numbers" placeholder="예: 031 또는 031, 033"><button id="loadTrains" type="button">현재 조회 열차에서 선택</button><div id="trainPicker"></div><p id="selectionInfo">열차를 한 개 이상 선택해주세요.</p>
      <label for="seat">좌석</label><select id="seat"><option value="gen">일반실</option><option value="spe">특실</option><option value="either">일반실 우선, 특실도 허용</option></select>
      <label style="display:flex;gap:8px;align-items:center"><input id="includeStanding" type="checkbox" style="width:auto">입석+좌석도 포함 (일반실 선택 시)</label>
      <label for="cooldown">응답 완료 후 최소 대기 (초)</label><input id="cooldown" type="number" min="2" max="60" value="3"><p>목록 갱신이 끝나면 다음 조회를 준비합니다. 응답이 느리면 대기도 길어집니다.</p>
      <label for="hours">실행 시간 (1~24시간)</label><input id="hours" type="number" min="1" max="24" value="12">
      <label for="pages">조회 범위 (더보기 포함, 최대 10묶음)</label><input id="pages" type="number" min="1" max="10" value="3">
      <label for="action">좌석 발견 시</label><select id="action"><option value="notify">알림 후 정지</option><option value="select">좌석 선택 후 정지</option></select>
      </details><p>설정한 시간 동안 반복 조회합니다. 예매·결제는 직접 완료하세요.</p>
      <p id="status" role="status" aria-live="polite">대기 중</p>
      <div class="actions"><button id="start">시작</button> <button id="stop">중지</button></div></section>`;
    const settings = ui.getElementById('querySettings');
    settings.open = sessionStorage.getItem(SETTINGS_OPEN_KEY) !== 'false';
    settings.addEventListener('toggle', () => {
      sessionStorage.setItem(SETTINGS_OPEN_KEY, String(settings.open));
    });
    document.body.append(host);
    const c = state.config;
    if(c) for(const [id,key] of Object.entries({fromTime:'start',toTime:'end',numbers:'numbers',seat:'seat',cooldown:'cooldown',hours:'hours',pages:'pages',action:'action'})) ui.getElementById(id).value=c[key];
    ui.getElementById('includeStanding').checked = !!c?.includeStanding;
    const selectedNumbers = () => new Set(ui.getElementById('numbers').value.split(/[\s,]+/).filter(Boolean).map(C.number).filter(Boolean));
    function updateSelectionInfo() {
      const selected=selectedNumbers();
      ui.getElementById('selectionInfo').textContent=selected.size ? `${selected.size}개 열차 선택 · ${[...selected].join(', ')} (목록 밖 번호도 유지)` : '열차를 한 개 이상 선택해주세요.';
      ui.querySelectorAll('#trainPicker input').forEach(input=>input.checked=selected.has(input.value));
    }
    ui.getElementById('numbers').addEventListener('input',updateSelectionInfo);
    ui.getElementById('loadTrains').onclick=()=> {
      const picker=ui.getElementById('trainPicker');
      picker.replaceChildren();
      const seen=new Set();
      for(const row of list()) {
        const type=text(row.querySelector('.flag_wrap .blind')), rawNumber=text(row.querySelector('.num')), number=C.number(rawNumber), heading=text(row.querySelector('h3'));
        if(!/^KTX(?:$|[-\s])/.test(type)||!number||seen.has(number)) continue;
        seen.add(number);
        const label=document.createElement('label'), input=document.createElement('input'), caption=document.createElement('span');
        input.type='checkbox'; input.value=number;
        caption.textContent=`${type} ${rawNumber} · ${heading}`;
        input.addEventListener('change',()=> {
          const selected=selectedNumbers();
          if(input.checked) selected.add(number); else selected.delete(number);
          ui.getElementById('numbers').value=[...selected].join(', ');
          updateSelectionInfo();
        });
        label.append(input,caption); picker.append(label);
      }
      if(!seen.size) picker.textContent='현재 조회 결과에 KTX가 없습니다. 웹에서 먼저 조회해주세요.';
      updateSelectionInfo();
    };
    updateSelectionInfo();
    ui.getElementById('stop').onclick=()=>stop('사용자가 중지했습니다.');
    ui.getElementById('start').onclick=()=> {
      const f=fields(), get=id=>ui.getElementById(id).value;
      if(location.pathname!='/ticket/search/list' || !f.from || !f.to || !f.date || !list().length) return status('열차 조회 결과를 먼저 표시해주세요.');
      if(query('#rtYn')?.checked) return status('편도 조회에서 사용해주세요.');
      const start=get('fromTime'), end=get('toTime'), numbers=get('numbers').trim();
      if(!Number.isFinite(C.minutes(start)) || !Number.isFinite(C.minutes(end)) || C.minutes(start)>C.minutes(end)) return status('올바른 시간대를 입력해주세요.');
      if(!numbers) return status('감시할 열차를 한 개 이상 선택하거나 번호를 입력해주세요.');
      if(numbers && !/^\d+(?:[\s,]+\d+)*$/.test(numbers)) return status('열차 번호는 숫자와 쉼표로 입력해주세요.');
      const cooldown=Number(get('cooldown')), pages=Number(get('pages')), hours=Number(get('hours'));
      if(!Number.isInteger(cooldown)||cooldown<2||cooldown>60||!Number.isInteger(pages)||pages<1||pages>10||!Number.isInteger(hours)||hours<1||hours>24) return status('최소 대기 2~60초, 실행 1~24시간, 조회 범위 1~10묶음을 입력해주세요.');
      state={running:true, expires:Date.now()+hours*3600000, config:{...f,start,end,numbers,cooldown,pages,hours,includeStanding:ui.getElementById('includeStanding').checked,seat:get('seat'),action:get('action')}};
      save(); controls(); next=Date.now(); waitingSince=0; reloadPending=false; batches=1; awaitingMore=null; seenTargets.clear(); requestAt=Date.now(); signature=''; stableAt=Date.now(); responseMs=0;
      try { audio=new AudioContext(); audio.resume().catch(()=>{}); } catch {}
    };
    controls(); status(state.message || (state.running?'조회 재개 준비 중':'대기 중'));
  }
  function guard() {
    if(Date.now()>state.expires) { stop('설정한 실행 시간이 끝났습니다.'); return false; }
    if(location.pathname!='/ticket/search/list') { stop('페이지가 변경되어 중지했습니다.'); return false; }
    const f=fields(), c=state.config;
    if(!f.date) return false;
    if(['from','to','date','people'].some(k=>f[k]!==c[k])) { stop('검색 조건이 변경되어 중지했습니다. 다시 시작해주세요.'); return false; }
    if(query('#rtYn')?.checked) {stop('왕복으로 변경되어 중지했습니다.'); return false;}
    return true;
  }
  function observe() {
    const body = document.body.innerText;
    const rows = list();
    const current = rows.map(row => row.textContent).join('\n');
    if (current !== signature) { signature=current; stableAt=Date.now(); }
    const kind = C.readiness({
      blocked:/자동입력 방지|보안문자|비정상적인 접근|접근이 제한|접속이 차단/.test(body),
      queued:/서비스 연결대기|현재 사용자가 많아 대기/.test(body),
      loading:document.readyState !== 'complete' || [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(visible),
      noSchedule:/해당\s*스케줄에\s*운행하는\s*열차가\s*없습니다/.test(body),
      hasRows:rows.length>0, stableMs:Date.now()-stableAt
    });
    if(kind==='ready' && !responseMs && (!awaitingMore || rows.length>awaitingMore.count)) responseMs=Date.now()-requestAt;
    return kind;
  }
  function beginRequest() { requestAt=Date.now(); responseMs=0; stableAt=Date.now(); }
  async function scan() {
    if(!guard()) return;
    const rows=list();
    if(!rows.length) {
      waitingSince ||= Date.now();
      if(Date.now()-waitingSince<60000) { status('열차 목록을 기다리는 중'); next=Date.now()+500; return; }
      state.errors=(state.errors||0)+1; save();
      if(state.errors>=3) {stop('조회 결과가 반복해서 표시되지 않아 중지했습니다.'); return;}
      const delay=C.retryDelay(state.config.cooldown*1000,responseMs,state.errors);
      status(`조회 실패 ${state.errors}회 — ${Math.ceil(delay/1000)}초 뒤 재시도`);
      next=Date.now()+delay; pendingSignature=signature; reloadPending=true; return;
    }
    waitingSince=0; state.errors=0; save();
    const c=state.config;
    const wanted=new Set(c.numbers.split(/[\s,]+/).filter(Boolean).map(C.number));
    for(const row of rows) {
      const data={heading:text(row.querySelector('h3')),type:text(row.querySelector('.flag_wrap .blind')),number:text(row.querySelector('.num'))};
      if(!C.matches(data,c)) continue;
      seenTargets.add(C.number(data.number));
      for(const kind of c.seat==='either'?['gen','spe']:[c.seat]) {
        const box=row.querySelector('.price_box.'+kind);
        let link=box?.querySelector('a');
        const enabled=el=>visible(el)&&el.getAttribute('aria-disabled')!=='true';
        const seated=enabled(link)&&C.available(text(box?.querySelector('.txt_ch')),text(box?.querySelector('.txt_price')),kind);
        if(!seated) {
          link=c.includeStanding && kind==='gen' ? [...row.querySelectorAll('a')].find(el=>enabled(el)&&C.combinedStanding(text(el))) : null;
          if(!link) continue;
        }
        const message=`좌석 발견: ${data.type} ${data.number}\n${data.heading}\n${text(link)}\n${c.action==='select'?'좌석을 선택합니다. 안내창 확인 및 예매는 직접 진행하세요.':'원하는 좌석을 직접 선택해주세요.'}`;
        stop(message); notify(message); row.scrollIntoView({block:'center'}); row.style.outline='3px solid #0865cb';
        if(c.action==='select') link.click();
        return;
      }
    }
    if(awaitingMore) {
      if(rows.length<=awaitingMore.count) {
        if(Date.now()-awaitingMore.at>60000) {stop('더보기 응답이 없어 중지했습니다.');return;}
        next=Date.now()+500; return;
      }
      awaitingMore=null;
    }
    const more=[...document.querySelectorAll('a')].find(el=>visible(el)&&text(el)==='더보기');
    const allTargetsSeen=wanted.size>0 && [...wanted].every(number=>seenTargets.has(number));
    if(more && batches<c.pages && !allTargetsSeen) {
      if(more.getAttribute('aria-disabled')==='true') {stop('더보기 버튼이 비활성화되어 중지했습니다.');return;}
      batches++; awaitingMore={count:rows.length,at:Date.now()}; beginRequest(); state.lastAction='더보기 '+batches+'번째 묶음'; save(); more.click(); next=Date.now()+500; status(`더보기 조회 중 (${batches}/${c.pages})`); return;
    }
    const delay=C.retryDelay(c.cooldown*1000,responseMs);
    status(`${rows.length}개 열차 확인: 조건에 맞는 좌석 없음\n화면 응답 ${Math.ceil(responseMs/1000)}초 · ${Math.ceil(delay/1000)}초 후 재조회 준비`);
    next=Date.now()+delay; pendingSignature=signature; reloadPending=true;
  }
  let batches=1, reloadPending=false, awaitingMore=null, pendingSignature='';
  const seenTargets=new Set();
  function releaseLease() {
    try { const lease=JSON.parse(localStorage.getItem(LEASE)||'null'); if(lease?.owner===owner) localStorage.removeItem(LEASE); } catch {}
  }
  function claimLease() {
    const lease=JSON.parse(localStorage.getItem(LEASE)||'null');
    if(lease && lease.owner!==owner && lease.until>Date.now()) return false;
    localStorage.setItem(LEASE,JSON.stringify({owner,until:Date.now()+15000}));
    return true;
  }
  window.addEventListener('pagehide',releaseLease);
  async function tick() {
    mount();
    const f=fields(); ui.getElementById('route').textContent=f.from?`${f.from} → ${f.to} · ${f.date} · ${f.people}`:'웹에서 날짜·구간·인원을 선택하고 조회하세요.';
    if(!state.running||busy) return;
    busy=true;
    try {
      // The browser lock prevents two tabs from issuing macro actions simultaneously.
      if(!navigator.locks) {stop('이 브라우저는 중복 실행 방지 기능을 지원하지 않습니다.'); return;}
      await navigator.locks.request('korail-ktx-macro', {ifAvailable:true}, async lock=> {
        if(!lock) return;
        if(!claimLease()) {stop('다른 코레일 탭의 매크로가 실행 중입니다.');return;}
        if(!guard()) return;
        const kind=observe();
        if(kind==='blocked') {stop('사이트의 인증·접근 제한 안내가 있습니다. 직접 확인해주세요.');return;}
        if(kind==='no-schedule') {
          stop('코레일이 ‘운행하는 열차가 없습니다’라고 표시해 중지했습니다.\n직전 동작: '+(state.lastAction||'현재 목록 확인')+'\n매진으로 판정한 것이 아닙니다. 웹에서 구간·날짜로 다시 조회한 뒤 시작해주세요.');
          return;
        }
        if(kind==='queued') {
          status('코레일 접속 대기 중 — 추가 요청 없이 기다립니다.');
          beginRequest(); waitingSince=0; return;
        }
        if(kind==='loading') {
          if(Date.now()-requestAt>60000) stop('화면 로딩이 60초 이상 끝나지 않아 중지했습니다.');
          return;
        }
        if(reloadPending && signature!==pendingSignature && kind==='ready') {reloadPending=false;next=0;}
        if(Date.now()<next) return;
        if(reloadPending) {
          if(!guard()) return;
          reloadPending=false; state.lastAction='페이지 새로고침'; save(); releaseLease(); location.reload(); return;
        }
        await scan();
      });
    } catch(e) { stop('오류로 중지했습니다: '+e.message); }
    finally {busy=false;}
  }
  setInterval(tick,500);
})();
