(() => {
  'use strict';
  const C = globalThis.KtxMacroCore;
  const KEY = 'ktx-macro-v1';
  const MINIMIZED_KEY='ktx-macro-minimized-v1';
  const DRAFT_KEY='ktx-macro-draft-v2';
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const owner = crypto.randomUUID();
  const LEASE = 'ktx-macro-lease-v1';
  const VERSION = '2.0.0';
  const MIN_COOLDOWN = 0, DEFAULT_COOLDOWN = 0;
  const BUTTON_STABLE_MS = 120;
  const SELECT_MS = 25000, CONFIRM_MS = 40000, RESULT_MS = 45000, MAX_RECOVERY = 12;
  let state = read(), busy = false, host, ui, next = 0, waitingSince = 0, emptyResultSince = null, reloadRequestedAt = null;
  if(state.config && ((state.config.targetTickets||1)>1 || !C.singlePassenger(state.config.people))) {
    state.running=false;state.config.targetTickets=1;
    state.message='이제 한 번에 1명만 시도합니다. 기존 예약 내역과 웹 조회 인원을 확인한 뒤 시작해주세요.';
    sessionStorage.setItem(KEY,JSON.stringify(state));
  }
  // Bumped whenever a stored setting has to be re-defaulted. Version 3 forced
  // the interval up to 5s; version 4 hands it back to the user's choice.
  if (state.config && state.config.retryPolicy !== 5) {
    state.running = false;
    state.config.cooldown = DEFAULT_COOLDOWN;
    state.config.retryPolicy = 5;
    state.message = '조회 대기를 0초로 되돌리고 고정 지연을 줄였습니다. 설정을 확인하고 다시 시작해주세요.';
  }
  if(state.config?.action==='select') {
    state.config.action='reserve'; state.running=false;
    state.message='예매 버튼까지 진행하도록 변경했습니다. 로그인과 설정을 확인하고 시작해주세요.';
  }
  if(state.config && !state.config.matchMode) {
    state.config.matchMode=state.config.numbers?.trim()?'trains':'time';
    state.running=false; state.message='감시 기준을 분리했습니다. 기준을 확인하고 시작해주세요.';
  }
  delete state.expires;
  function trace(step, detail={}) {
    state.trace=state.trace||[];
    state.logRunId ||= crypto.randomUUID();
    state.logSeq=(state.logSeq||0)+1;
    const event={at:new Date().toISOString(),step,runId:state.logRunId,documentId:owner,sequence:state.logSeq,
      phase:state.booking?.phase||'watching',seatKind:state.booking?.kind||state.config?.seat||null,
      trainNumber:state.booking?.number||null,requestSeen:!!state.booking?.requestSeen,
      phaseElapsedMs:state.booking?Math.max(0,Date.now()-state.booking.at):null,...detail};
    state.trace.push(event);
    persistLog({...event,version:VERSION,phase:state.booking?.phase||'watching'});
    state.trace=state.trace.slice(-30);save();
    renderTrace();
  }
  function persistLog(event) {
    try {
      chrome.runtime.sendMessage({type:'append-file-log',event}).then(result=>{
        if(result?.ok===false) {state.fileLogError=result.error;save();if(ui) ui.getElementById('logStatus').textContent=result.error;}
      }).catch(()=>{if(ui) ui.getElementById('logStatus').textContent='로그 저장 연결이 끊겼습니다. 확장 프로그램과 탭을 새로고침해주세요.';});
    }catch {if(ui) ui.getElementById('logStatus').textContent='로그 저장 연결 실패';}
  }
  function renderTrace() {
    if(ui && state.fileLogError) ui.getElementById('logStatus').textContent=state.fileLogError;
    if(ui) ui.getElementById('traceOutput').value=JSON.stringify({version:VERSION,phase:state.booking?.phase||'watching',lastError:state.lastError||null,events:state.trace||[]},null,2);
  }
  function rememberError(error) {
    state.lastError={at:new Date().toISOString(),version:VERSION,message:String(error?.message||error).slice(0,1000),
      phase:state.booking?.phase||'watching',kind:state.booking?.kind||null,
      events:(state.trace||[]).map(event=>({...event}))};
    save();renderTrace();
    trace('internal-error',{error:state.lastError.message,errorName:error?.name||'Error',
      codeLocations:(String(error?.stack||'').match(/(?:content\.js|background\.js|core\.js|evalmachine\.<anonymous>):\d+:\d+/g)||[]).slice(0,8).join(' | '),
      ...diagnosticSnapshot()});
  }
  // Read a small bounded snapshot only on failure/stop, never whole page HTML.
  function diagnosticSnapshot() {
    try {
      const popup=[...document.querySelectorAll('#layerPopup, .layerPopup')].find(visible);
      const title=popup?text(popup.querySelector('h1,h2,h3,.tit,[role="heading"]')):'';
      const body=popup?text(popup).slice(0,1200):'';
      const actions=popup?[...popup.querySelectorAll('button,a,[role="button"]')].filter(visible).map(el=>text(el)).slice(0,8):[];
      const path=location.pathname;
      const page=path==='/ticket/search/list'?'search':path.includes('/login')?'login':path.includes('/reservation/')?'reservation':path.includes('/cart')?'cart':'other';
      return {page,readyState:document.readyState,loading:busyIndicator(),rowCount:list().length,
        dialogKind:popup?C.dialogKind(title,body):null,dialogTitle:title,dialogBody:body,dialogActions:actions.join(' | '),
        lastQueryStatus:state.lastQuery?.httpStatus??null,responseError:state.booking?.responseError??null};
    }catch{return {snapshotError:true};}
  }
  function inputSnapshot(element) {
    try {
      const rect=element.getBoundingClientRect(),x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2;
      const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,x)),Math.max(0,Math.min(innerHeight-1,y)));
      return {tag:element.tagName||'unknown',label:text(element).slice(0,160),connected:!!element.isConnected,
        enabled:enabled(element),targetRect:[rect.left,rect.top,rect.right,rect.bottom].map(Math.round).join(','),
        viewport:innerWidth+'x'+innerHeight,hitTag:hit?.tagName||'none',coveredByPanel:!!host&&hit===host,
        hitMatches:!!hit&&(hit===element||element.contains(hit))};
    }catch{return {snapshotError:true};}
  }
  let pendingInput=null;
  function inputPoint(element) {
    if(!state.running || !element?.isConnected || !enabled(element)) return null;
    const rect=element.getBoundingClientRect();
    const left=Math.max(0,rect.left), right=Math.min(innerWidth,rect.right);
    const top=Math.max(0,rect.top), bottom=Math.min(innerHeight,rect.bottom);
    if(right<=left || bottom<=top) return null;
    const x=(left+right)/2, y=(top+bottom)/2;
    const hit=document.elementFromPoint(x,y);
    return hit && (hit===element || element.contains(hit)) ? {x,y} : null;
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=> {
    if(sender.id!==chrome.runtime.id) return;
    if(message?.type==='verify-search-document') {
      reply({ok:!!state.running && location.pathname==='/ticket/search/list',url:location.origin+location.pathname});return;
    }
    if(message?.type!=='verify-page-input') return;
    const pending=pendingInput;
    const point=pending && inputPoint(pending.element);
    reply({ok:!!point && pending.run===state && pending.id===message.id &&
      Math.abs(point.x-message.x)<1 && Math.abs(point.y-message.y)<1});
  });
  async function clickTracked(element, step) {
    const run=state;
    let event=null,stage='prepare';
    trace('input-begin',{action:step,...inputSnapshot(element)});
    try {
    const prepared=await chrome.runtime.sendMessage({type:'prepare-browser-input'});
    if(!prepared?.ok) {trace('input-backend-failed',{action:step,backendStage:prepared?.inputStage||'unknown',errorDetail:prepared?.inputDetail||'',error:prepared?.error||''});throw new Error(prepared?.error || '브라우저 입력 연결에 실패했습니다.');}
    if(!state.running || state!==run) {await chrome.runtime.sendMessage({type:'release-browser-input'});return;}
    // A modal makes the underlying page inert even outside its visible bounds.
    const settingsDialog=ui?.getElementById('workspaceDialog');
    if(settingsDialog?.open) settingsDialog.close();
    // Attach can display a Chrome banner and resize the viewport. Measure only
    // afterwards, and let the layout settle before checking the actual hit target.
    stage='locate';
    element.scrollIntoView({block:'center',inline:'nearest'});
    await new Promise(resolve=>setTimeout(resolve,80));
    if(!state.running || state!==run) return;
    let point=inputPoint(element);
    if(!point && host && document.elementFromPoint(
      Math.min(innerWidth-1,Math.max(0,(element.getBoundingClientRect().left+element.getBoundingClientRect().right)/2)),
      Math.min(innerHeight-1,Math.max(0,(element.getBoundingClientRect().top+element.getBoundingClientRect().bottom)/2)))===host) {
      minimize(true);
      await new Promise(resolve=>setTimeout(resolve,0));
      point=inputPoint(element);
    }
    if(!point) throw new Error('클릭할 버튼이 가려졌거나 변경됐습니다. 화면을 확인해주세요.');
    const capture=e=>{event=e;};
    const id=crypto.randomUUID();
    pendingInput={id,element,run};
    stage='dispatch';
    trace(step+'-call',{action:step,...inputSnapshot(element),method:'browser-input'});
    element.addEventListener('click',capture,{capture:true,once:true});
    try {
      const result=await chrome.runtime.sendMessage({type:'click-page-element',id,step,...point});
      if(!result?.ok) {trace('input-backend-failed',{action:step,backendStage:result?.inputStage||'unknown',errorDetail:result?.inputDetail||'',error:result?.error||''});throw new Error(result?.error || '브라우저 클릭 결과를 확인하지 못했습니다. 재시도하지 않습니다.');}
      stage='verify-event';
      if(!event) throw new Error('버튼의 클릭 이벤트를 확인하지 못했습니다. 중복 클릭 없이 정지합니다.');
    } finally {
      pendingInput=null;
      element.removeEventListener('click',capture,true);
      trace(step+'-event',{observed:!!event,isTrusted:event?.isTrusted??null,defaultPrevented:event?.defaultPrevented??null});
    }
    }catch(error) {trace('input-failed',{action:step,inputStage:stage,error:String(error.message||error),...inputSnapshot(element)});throw error;}
  }
  let bookingLink=null, readyButton=null;
  const observedResponses=new Set();
  // Read browser-provided timing only; never replace site networking functions.
  function observeBookingResponses() {
    if(!globalThis.performance?.getEntriesByType) return;
    const booking=state.booking;
    for(const entry of performance.getEntriesByType('resource')) {
      if(!['fetch','xmlhttprequest'].includes(entry.initiatorType)) continue;
      const started=performance.timeOrigin+entry.startTime;
      if(started<(booking.networkSince??booking.at) || !entry.responseEnd) continue;
      let url;
      try {url=new URL(entry.name);} catch {continue;}
      if(url.origin!==location.origin || !url.pathname.startsWith('/web_r/')) continue;
      const key=entry.startTime+':'+entry.responseEnd;
      if(observedResponses.has(key)) continue;
      observedResponses.add(key);
      const httpStatus=Number.isInteger(entry.responseStatus)&&entry.responseStatus>0?entry.responseStatus:null;
      // A /web_r/ call after the reserve click means the request really left the
      // browser. Without this the macro cannot tell a silently dropped request
      // (queue block, unanswered notice) from one that was sent and failed.
      booking.requestSeen=true;
      trace('request-response',{httpStatus,durationMs:Math.round(entry.duration)});
      // Opaque paths cannot identify the business operation. Do not infer booking success.
      if(httpStatus>=400) booking.responseError=httpStatus;
    }
  }
  let querySince = 0;
  const observedQueries = new Set();
  // Same browser-provided timing as the booking watcher, applied to the
  // schedule query. Reading the real HTTP status beats inferring a failure from
  // the empty-list screen.
  function observeQueryResponses() {
    if(!globalThis.performance?.getEntriesByType) return null;
    let result=null;
    for(const entry of performance.getEntriesByType('resource')) {
      if(!['fetch','xmlhttprequest'].includes(entry.initiatorType)) continue;
      const started=performance.timeOrigin+entry.startTime;
      if(started<querySince || !entry.responseEnd) continue;
      let url;
      try {url=new URL(entry.name);} catch {continue;}
      if(url.origin!==location.origin || !url.pathname.startsWith('/web_s/')) continue;
      const key=entry.startTime+':'+entry.responseEnd;
      if(observedQueries.has(key)) continue;
      observedQueries.add(key);
      const httpStatus=Number.isInteger(entry.responseStatus)&&entry.responseStatus>0?entry.responseStatus:null;
      result={httpStatus,durationMs:Math.round(entry.duration)};
      if(!state.lastQuery || entry.responseEnd>=(state.lastQuery.responseEnd??0)) state.lastQuery={httpStatus,responseEnd:entry.responseEnd,at:Date.now()};
      trace('query-response',result);
      if(observedQueries.size>200) observedQueries.clear();
    }
    return result;
  }
  // Shown in the panel so the schedule query's real status never has to be dug
  // out of the diagnostic log.
  function queryNote() {
    const last=state.lastQuery;
    if(!last||!Number.isInteger(last.httpStatus)) return '';
    const age=Math.round((Date.now()-last.at)/1000);
    return `\n마지막 조회 응답: HTTP ${last.httpStatus}${age>5?` (${age}초 전)`:''}`;
  }
  let requestAt = Date.now(), signature = '', stableAt = Date.now(), responseMs = 0;
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const query = s => document.querySelector(s);
  const value = s => query(s)?.value || '';
  const text = el => C.clean(el?.textContent);
  const fields = () => ({from:value('#labelstart'), to:value('#labelend'), date:value('#startDate'), people:value('#labelple')});
  const list = () => [...document.querySelectorAll('li.tckList')].filter(visible);
  const rowKey = row => [text(row.querySelector('.num')),text(row.querySelector('h3'))].join('|');
  function rangeSummary(rows) {
    const times=rows.map(row=>C.parseHeading(text(row.querySelector('h3')))?.time).filter(Boolean).sort();
    return times.length?`${times[0]}~${times[times.length-1]}`:'출발 시각 미확인';
  }
  function status(message) {
    if(!ui) return;
    ui.querySelector('#status').textContent=message;
    ui.getElementById('restore').title=message;
    updateMini();
  }
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function displayConfig() {
    if(state.running || !ui) return state.config||{};
    const get=(id,fallback)=>ui.getElementById(id).value||fallback;
    return {...state.config,...fields(),matchMode:get('matchMode','trains'),numbers:ui.getElementById('numbers').value,
      start:get('fromTime','00:00'),end:get('toTime','23:59'),seat:get('seat','gen'),action:get('action','reserve'),targetTickets:1};
  }
  function updateMini() {
    if(!ui) return;
    const c=displayConfig(), focus=state.running&&(state.booking||state.focusTrain);
    const numbers=[...new Set((c.numbers||'').split(/[\s,]+/).map(C.number).filter(Boolean))];
    const label=focus?(focus.mode==='wait'?'예약대기 신청':'집중 예매'):state.running?'감시 중':state.waitlisted?'예약대기 접수':'대기';
    const compact=focus?`KTX ${focus.number.padStart(3,'0')}`:c.matchMode==='time'?`${c.start}–${c.end}`:numbers.map(n=>n.padStart(3,'0')).join(' · ')||'대상 미설정';
    ui.getElementById('miniLabel').textContent=`${label} · ${compact}`;
    ui.getElementById('restore').title=`${label} · ${compact}`;
    ui.getElementById('miniStop').disabled=!state.running;
    ui.getElementById('runBadge').textContent=label;
    ui.getElementById('runBadge').setAttribute('data-running',String(!!state.running));
    ui.getElementById('targetTitle').textContent=focus?'지금 집중하는 열차':c.matchMode==='time'?'감시 시간대':`${state.running?'감시 중인':'감시할'} 열차 · ${numbers.length}개`;
    ui.getElementById('bookingProgress').textContent=progressText(c);
    ui.getElementById('targetPolicy').textContent=({gen:'일반실',spe:'특실',either:'일반실 우선 · 특실 허용'}[c.seat]||'일반실')+' / '+(c.action==='notify'?'발견 시 알림':'자동 예매 · 예약대기');
    const rows=list().map(row=>({number:C.number(text(row.querySelector('.num'))),heading:text(row.querySelector('h3')),type:text(row.querySelector('.flag_wrap .blind'))}));
    const card=(number,heading,active=false)=> {
      const parsed=C.parseHeading(heading);
      return `<div class="target-card ${active?'focused':''}"><div><strong>KTX ${escapeHTML(number.padStart(3,'0'))}</strong><span class="target-time">${escapeHTML(parsed?.time||'시각 확인 중')}</span></div><small>${escapeHTML(parsed?parsed.from+' → '+parsed.to:'현재 조회 목록 밖')} ${active?'· 집중 예매':''}</small></div>`;
    };
    let markup;
    if(focus) markup=card(focus.number,focus.heading,true)+`<p class="target-note">다른 열차 탐색을 멈추고 이 열차만 시도합니다. 재시도 ${focus.retryCount||0}회</p>`;
    else if(c.matchMode==='time') {
      const matched=rows.filter(r=>C.matches(r,c));
      markup=`<div class="time-window">${escapeHTML(c.start)} <span>—</span> ${escapeHTML(c.end)}</div><p class="target-note">출발 시각 기준 · 현재 목록에서 ${matched.length}개 열차</p>`+matched.map(r=>card(r.number,r.heading)).join('');
    } else markup=numbers.map(n=>card(n,rows.find(r=>r.number===n)?.heading)).join('')||'<p class="empty-target">조회 설정에서 원하는 열차를 선택해주세요.</p>';
    const target=ui.getElementById('targetList');if(target.innerHTML!==markup) target.innerHTML=markup;
  }
  function minimize(value) {
    sessionStorage.setItem(MINIMIZED_KEY,String(value));
    if(value && ui.getElementById('workspaceDialog').open) ui.getElementById('workspaceDialog').close();
    ui.getElementById('mainPanel').hidden=value;
    ui.getElementById('miniPanel').hidden=!value;
    host.style.width=value?'auto':'min(344px,calc(100% - 24px))';
    updateMini();
  }
  function stop(message) { trace('run-stopped',{reason:message,...diagnosticSnapshot()}); pendingInput=null; try {chrome.runtime.sendMessage({type:'release-browser-input'}).catch(()=>{});} catch {} releaseLease(); state.running = false; state.message = message; save(); clearWatchMarks(); status(message); controls(); }
  function controls() {
    if (!ui) return;
    ui.querySelectorAll('input,select').forEach(el => { el.disabled = !!state.running; });
    ui.getElementById('nextPerson').disabled=!!state.running;
    ui.getElementById('nextPerson').hidden=!state.booking && !state.waitlisted && !(state.reservations||[]).length;
    ui.querySelector('#start').disabled = !!state.running;
    ui.querySelector('#stop').disabled = !state.running;
    ui.querySelector('#loadTrains').disabled = !!state.running;
    ui.getElementById('settingsLock').textContent=state.running?'감시 중입니다. 조회 설정을 바꾸려면 메인 화면에서 중지해주세요.':'설정은 이 탭에 자동 저장됩니다. 닫은 뒤 감시 시작을 눌러주세요.';
    updateMode(); updateMini();
  }
  function updateMode() {
    if(!ui) return;
    const byTrain=ui.getElementById('matchMode').value==='trains';
    ui.getElementById('timeFields').hidden=byTrain;
    ui.getElementById('trainFields').hidden=!byTrain;
    ui.getElementById('modeHelp').textContent=byTrain?'열차 번호만 적용':'시간대만 적용';
  }
  // 'seat' is the good news; 'halt' means the run ended and nobody is watching
  // any more. They get different titles, sounds and notifications so a stopped
  // macro is not mistaken for a found seat.
  const ALERTS = {
    seat:{title:'KTX 좌석 알림', type:'seat-found', notes:[523.25,659.25,783.99]},
    wait:{title:'KTX 예약대기 접수',type:'wait-registered',notes:[523.25,659.25,783.99]},
    halt:{title:'KTX 매크로 정지', type:'macro-stopped', notes:[523.25,392]},
    test:{title:'KTX 알림 테스트', type:'test-notification', notes:[523.25,659.25,783.99]}
  };
  function notify(message, kind='seat', found=null) {
    const alert=ALERTS[kind]||ALERTS.seat;
    document.title = alert.title;
    const problems=[];
    try {
      const c=state.config||{}, booking=found||state.booking||state.waitlisted;
      const route=C.parseHeading(booking?.heading||'');
      const result=kind==='wait'?'wait':kind==='halt'?'stopped':kind==='test'?'test':/예약.*완료|예매.*완료/.test(message)?'reserved':c.action==='notify'?'found':'check';
      const reason=kind!=='halt'?'':/로그인/.test(message)?'로그인이 필요합니다.':/HTTP\s*\d{3}/.test(message)?message.match(/HTTP\s*\d{3}/)[0]+' 응답 오류':/클릭|버튼|가려/.test(message)?'클릭 또는 버튼 상태를 확인하지 못했습니다.':/인증|차단|접근 제한/.test(message)?'인증 또는 접근 제한 안내가 표시됐습니다.':/조회|새로고침|목록/.test(message)?'열차 조회를 진행하지 못했습니다.':/결과|응답/.test(message)?'신청 결과 또는 응답을 확인하지 못했습니다.':'진행을 멈췄습니다. PC에서 상세 안내를 확인해주세요.';
      const details={result,reason,number:booking?.number||'',date:c.date||'',from:route?.from||c.from||'',to:route?.to||c.to||'',time:route?.time||'',seat:booking?.kind||c.seat||'',attempt:state.booking?.retryCount||0};
      const sending=chrome.runtime.sendMessage({type:alert.type, message,details});
      if(sending?.then) sending.then(result=>{
        if(!result?.ok) noteAlarmProblem(result?.error||'브라우저 알림 결과를 확인하지 못했습니다. 확장 프로그램을 다시 로드해주세요.');
        else if(kind==='test') ui.getElementById('alarmStatus').textContent='Chrome 알림 생성 완료. 보이지 않으면 PC 설정의 Chrome 알림 허용·집중 모드를 확인해주세요.';
      }).catch(()=>{noteAlarmProblem('브라우저 알림을 보내지 못했습니다. 코레일 탭을 새로고침해주세요.');});
    } catch { problems.push('확장 프로그램 연결이 끊겨 브라우저 알림을 보내지 못했습니다. 코레일 탭을 새로고침해주세요.'); }
    // A reload wipes the AudioContext, so rebuild it here. Without prior user
    // activation the browser keeps it suspended and no sound is possible.
    if(!audio) { try { audio=new AudioContext(); } catch {} }
    if(audio?.state==='suspended') { try { audio.resume().catch(()=>{}); } catch {} }
    if(!audio) problems.push('이 탭에서 소리를 낼 수 없습니다.');
    else if(audio.state!=='running') problems.push('새로고침 이후 소리가 차단되어 알림음이 나지 않을 수 있습니다.');
    status(problems.length?message+'\n⚠ '+problems.join(' '):message);
    // User gesture at Start unlocks audio when the browser permits it.
    if (audio) {
      alert.notes.forEach((hz,i)=> {
        const oscillator=audio.createOscillator(), gain=audio.createGain();
        const at=audio.currentTime+i*.22;
        oscillator.type='sine'; oscillator.frequency.value=hz;
        oscillator.connect(gain); gain.connect(audio.destination);
        gain.gain.setValueAtTime(0,at);
        gain.gain.linearRampToValueAtTime(.065,at+.025);
        gain.gain.exponentialRampToValueAtTime(.001,at+.65);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
        oscillator.start(at); oscillator.stop(at+.7);
      });
    }
  }
  function noteAlarmProblem(text) {
    state.message=(state.message||'')+'\n⚠ '+text; save(); status(state.message);
    if(ui) ui.getElementById('alarmStatus').textContent=text;
  }
  // Ends a run that the user did not end themselves, and says so out loud.
  // Silent on a stop that happens when nothing was running.
  function abort(message) {
    const wasRunning=!!state.running;
    stop(message);
    if(wasRunning) {trace('run-aborted');notify(message,'halt');}
  }
  const WATCH_RING='2px dashed #94a3b8', FOUND_RING='0 0 0 3px #0865cb';
  function clearWatchMarks() {
    for(const el of document.querySelectorAll('li.tckList')) {
      el.style.outline=''; el.style.outlineOffset='';
      el.removeAttribute?.('title');
    }
  }
  function clearFoundMarks() {
    for(const el of document.querySelectorAll('li.tckList')) el.style.boxShadow='';
  }
  // Re-applied on every pass because each re-query replaces these rows.
  function markWatched(rows, config) {
    for(const row of rows) {
      const data={heading:text(row.querySelector('h3')),type:text(row.querySelector('.flag_wrap .blind')),number:text(row.querySelector('.num'))};
      if(C.matches(data,config)) {
        row.style.outline=WATCH_RING; row.style.outlineOffset='2px';
        row.setAttribute?.('title','KTX 매크로가 감시 중인 열차입니다.');
      } else {
        row.style.outline=''; row.style.outlineOffset='';
        row.removeAttribute?.('title');
      }
    }
  }
  let audio;
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'ktx-macro-panel';
    host.style.cssText='display:block;box-sizing:border-box;height:auto;min-height:0;min-width:0;padding:0;margin:0;border:0;background:transparent;position:fixed;right:12px;top:12px;max-width:calc(100% - 24px);width:min(344px,calc(100% - 24px));z-index:2147483646;';
    ui = host.attachShadow({mode:'open'});
    ui.innerHTML = `<style>
:host{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#19324a;--ink:#19324a;--muted:#5a7085;--line:#dae4ed;--accent:#1566b2}*{box-sizing:border-box}[hidden]{display:none!important}
button,input,select,textarea{font:inherit}button{cursor:pointer;border:1px solid var(--line);background:white;color:var(--ink);border-radius:10px;min-height:36px;padding:8px 12px;font-weight:650}button:hover:not(:disabled){background:#edf5fc;border-color:#98bbdc}button:disabled{opacity:.46;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,textarea:focus-visible{outline:3px solid #4c99dc;outline-offset:2px}h2,h3,p{margin:0}p{line-height:1.55;color:var(--muted)}
#mainPanel{width:100%;height:min(520px,calc(100vh - 24px));height:min(520px,calc(100dvh - 24px));display:grid;grid-template-rows:60px minmax(0,1fr) 88px 104px;background:#f6f9fc;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 14px 45px #16324d30}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;background:#112f49;color:white}header h2{font-size:16px;letter-spacing:-.4px}header small{font-size:10px;font-weight:500;color:#bbcedf;margin-left:6px}#minimize{min-height:32px;width:32px;padding:0;background:#ffffff12;color:white;border-color:transparent;font-size:20px}
.overview{min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px 16px;display:flex;flex-direction:column;gap:10px}#route{font-size:11px;min-height:34px;overflow-wrap:anywhere}.target-heading{display:flex;align-items:center;justify-content:space-between;gap:6px}#targetTitle{font-size:12px;font-weight:750}#runBadge{font-size:11px;border-radius:20px;background:#e5edf5;color:#4e6680;padding:5px 9px;white-space:nowrap}#runBadge[data-running=true]{background:#d9f1e7;color:#086a48}#targetList{display:grid;gap:7px;flex:1;min-height:56px;overflow:auto;overscroll-behavior:contain}.overview>p,.target-heading,#nextPerson{flex:none}.target-card{background:white;border:1px solid var(--line);border-radius:11px;padding:10px 12px}.target-card>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px}.target-card strong,.target-time{font-size:15px}.target-time{font-weight:700;color:var(--accent)}.target-card small{display:block;color:var(--muted);font-size:11px;margin-top:4px}.target-card.focused{border-color:#53ae8b;background:#edf9f3}.empty-target{padding:16px 12px;border:1px dashed #b8cadb;border-radius:11px;background:white;font-size:12px}.target-note{font-size:11px}.time-window{font-size:24px;font-weight:700}.time-window span{color:#7890a5}#targetPolicy{font-size:11px}#bookingProgress{font-size:11px;font-weight:700;color:#08734c}
#status{margin:0;padding:12px 16px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#edf4fa;white-space:pre-wrap;font-size:12px;overflow:auto;overscroll-behavior:contain;min-height:0}
.actions{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:32px 40px;gap:8px;padding:12px 16px;background:white}.toolbar{grid-column:1/-1;display:flex;gap:6px}.toolbar button{min-height:30px;font-size:11px;padding:4px 8px;flex:1}#start{background:var(--accent);border-color:var(--accent);color:white}#start:hover:not(:disabled){background:#0c5598}#stop{color:#ab3746;border-color:#ecccd1}#nextPerson{width:100%;margin-top:8px;background:#edf4fb;color:#135e9e;font-size:12px}.footnote{font-size:11px;text-align:center;margin-top:12px}
#miniPanel{display:flex;align-items:center;gap:4px;border:1px solid #cedce8;background:white;border-radius:14px;padding:5px;box-shadow:0 8px 24px #18324e26;max-width:100%}#restore{min-width:0;background:#112f49;color:white;max-width:280px;flex:1}#miniLabel{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}#miniStop{flex:none}
#workspaceDialog{width:min(540px,calc(100% - 24px));height:min(660px,calc(100vh - 24px));max-width:none;max-height:none;padding:0;margin:auto;border:1px solid var(--line);border-radius:18px;background:#f6f9fc;color:var(--ink);box-shadow:0 24px 80px #132e4b40;overflow:hidden}#workspaceDialog[open]{display:flex;flex-direction:column}#workspaceDialog::backdrop{background:#0b23345e}#workspaceDialog header{flex:none;min-height:64px}#closeDialog{background:#ffffff15;border-color:#ffffff30;color:white;font-size:12px}.dialog-tabs{display:flex;gap:4px;padding:10px 14px;background:white;border-bottom:1px solid var(--line);flex:none}.dialog-tabs button{flex:1;font-size:12px}.dialog-tabs button[aria-selected=true]{background:#e6f1fc;border-color:#81afd8;color:#0d579b}.dialog-body{min-height:0;overflow:auto;overscroll-behavior:contain;padding:18px;flex:1}.dialog-footer{flex:none;padding:12px 18px;background:white;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}.dialog-footer p{font-size:11px}#doneDialog{background:var(--accent);color:white;border-color:var(--accent)}.panel-scroll{padding:0}
#settingsLock{font-size:12px;padding:10px 12px;background:#edf4fb;border-radius:10px;margin-bottom:14px}details{margin:0 0 14px}summary{cursor:pointer;font-size:13px;font-weight:750;padding:10px 0}#querySettings>summary{display:none}#traceDetails>summary{display:none}label{display:block;font-size:12px;font-weight:650;margin:14px 0 6px}input:not([type=checkbox]),select,textarea{width:100%;border:1px solid #becedf;border-radius:9px;background:white;color:var(--ink);padding:10px;min-height:42px}input:disabled,select:disabled{background:#edf1f5;color:#617387}.times{display:grid;grid-template-columns:1fr 1fr;gap:8px}.times input{min-width:0}.panel-scroll p{font-size:12px;margin:8px 0 12px}.panel-scroll details details{background:#edf3f8;border-radius:12px;padding:2px 12px 12px;margin-top:16px}#loadTrains{margin-top:8px}#trainPicker{max-height:220px;overflow:auto;margin-top:8px}label.check,#trainPicker label{display:flex;gap:8px;align-items:flex-start;line-height:20px;font-weight:400}label.check input[type=checkbox],#trainPicker input[type=checkbox]{appearance:auto;flex:0 0 16px;width:16px;height:16px;margin:2px 0 0;accent-color:var(--accent)}#alarmSettings>summary{display:none}#testAlarm,#phoneSetup,#fileLogs{display:block;width:100%;margin:10px 0}#traceOutput{min-height:210px;font:11px ui-monospace,monospace;resize:vertical}#modeHelp{font-size:11px}#selectionInfo{font-size:12px}
@media(max-height:500px){#mainPanel{grid-template-rows:48px minmax(0,1fr) 68px 96px}header{padding:8px 12px}.overview{padding:10px 12px;gap:8px}.actions{padding:8px 12px}#status{padding:8px 12px}.dialog-body{padding:12px}.dialog-footer{padding:8px 12px}#workspaceDialog header{min-height:48px}}
@media(max-width:380px){.dialog-tabs{gap:3px;padding:8px}.dialog-tabs button{padding:7px 4px}.dialog-footer{gap:6px}.dialog-footer p{max-width:65%}}
</style>
      <div id="miniPanel" hidden><button id="restore" aria-label="패널 펼치기"><span id="miniLabel">KTX</span> ↗</button><button id="miniStop" aria-label="감시 중지">중지</button></div>
      <section id="mainPanel" aria-label="KTX 감시 패널"><header><h2>KTX 예매 <small>${VERSION}</small></h2><button id="minimize" aria-label="패널 최소화" title="최소화">−</button></header><div class="overview"><p id="route">웹에서 날짜·구간·인원을 선택하고 조회하세요.</p><div class="target-heading"><span id="targetTitle">감시할 열차</span><span id="runBadge">대기</span></div><div id="targetList"></div><p id="targetPolicy"></p><p id="bookingProgress" role="status"></p><button id="nextPerson" type="button" hidden>기존 접수 유지하고 다음 1명 시작</button></div><p id="status" role="status" aria-live="polite">대기 중</p><div class="actions"><nav class="toolbar" aria-label="패널 도구"><button id="openSettings" type="button">조회 설정</button><button id="openHoliday" type="button">명절</button><button id="openAlerts" type="button">알림</button><button id="openDiagnostics" type="button">기록</button></nav><button id="start">감시 시작</button><button id="stop">중지</button></div></section>
      <dialog id="workspaceDialog" aria-labelledby="dialogTitle"><header><div><h2 id="dialogTitle">감시 설정</h2><small>한 번에 1명 · 결제는 직접 진행</small></div><button id="closeDialog" type="button" aria-label="설정 창 닫기">닫기</button></header><nav class="dialog-tabs" role="tablist" aria-label="설정 메뉴"><button id="tabSettings" role="tab" aria-controls="paneSettings">조회 설정</button><button id="tabHoliday" role="tab" aria-controls="paneHoliday">명절</button><button id="tabAlerts" role="tab" aria-controls="paneAlerts">알림</button><button id="tabDiagnostics" role="tab" aria-controls="paneDiagnostics">진단 기록</button></nav><div id="dialogBody" class="dialog-body"><p id="settingsLock">설정은 이 탭에 자동 저장됩니다. 닫은 뒤 감시 시작을 눌러주세요.</p><div class="panel-scroll"><div id="paneSettings" role="tabpanel" aria-labelledby="tabSettings">
      <details id="querySettings"><summary>조회 설정</summary>
      <label for="matchMode">감시 기준</label><select id="matchMode"><option value="trains">특정 열차 기준</option><option value="time">시간대 기준</option></select><p id="modeHelp"></p>
      <div id="timeFields"><label>출발 시간대</label><div class="times"><input id="fromTime" type="time" value="00:00" aria-label="시작 시간"><input id="toTime" type="time" value="23:59" aria-label="종료 시간"></div></div>
      <div id="trainFields"><label for="numbers">열차 번호</label><input id="numbers" placeholder="예: 031 또는 031, 033"><button id="loadTrains" type="button">목록에서 선택</button><div id="trainPicker"></div><p id="selectionInfo">열차를 한 개 이상 선택해주세요.</p></div>
      <label for="seat">좌석</label><select id="seat"><option value="gen">일반실</option><option value="spe">특실</option><option value="either">일반실 우선, 특실도 허용</option></select>
      <p>한 번에 1명분만 시도합니다. 코레일 조회 인원도 1명으로 설정해주세요.</p>
      <details><summary>추가 설정</summary><label class="check"><input id="includeStanding" type="checkbox">입석+좌석 포함</label>
      <label for="rest">쉬어가기</label><select id="rest"><option value="0:0">사용 안 함</option><option value="20:8">20회마다 8초</option><option value="10:15">10회마다 15초</option><option value="5:30">5회마다 30초</option></select><p>가끔 한 번씩 더 길게 쉬어 전체 요청량을 줄입니다.</p>
      <label for="cooldown">조회 후 대기 (초)</label><input id="cooldown" type="number" min="${MIN_COOLDOWN}" max="60" value="${DEFAULT_COOLDOWN}"><p id="cooldownHelp">0은 목록을 읽는 즉시 재조회합니다. 실제 주기는 페이지 새로고침 시간이 결정합니다. 거부가 나오면 자동으로 간격을 늘리고 정상화되면 되돌립니다.</p>
</details>
      <label for="action">좌석 발견 시</label><select id="action"><option value="reserve">예매 · 예약대기 신청</option><option value="notify">알림 후 정지</option></select>
      </details>
      </div><div id="paneHoliday" role="tabpanel" aria-labelledby="tabHoliday" hidden></div><div id="paneAlerts" role="tabpanel" aria-labelledby="tabAlerts" hidden><details id="alarmSettings" open><summary>알림 설정</summary><button id="testAlarm" type="button">소리·PC 알림 테스트</button><button id="phoneSetup" type="button">휴대폰 알림 연결 · ntfy</button><p id="alarmStatus" role="status">PC 설정에서 Chrome 알림을 허용해주세요. 집중 모드에서는 배너가 숨겨질 수 있습니다.</p></details>
      </div><div id="paneDiagnostics" role="tabpanel" aria-labelledby="tabDiagnostics" hidden><details id="traceDetails" open><summary>진행 기록 (진단용)</summary><button id="fileLogs" type="button">로그 파일 · 내려받기</button><p id="logStatus" role="status">파일 자동 보관 · 날짜 변경 / 10 MiB마다 gzip 압축</p><p>문제가 생기면 로그를 내려받아 전달해주세요. URL·쿠키·요청 내용은 수집하지 않습니다.</p><textarea id="traceOutput" readonly aria-label="진행 기록" style="box-sizing:border-box;width:100%;height:120px;font:11px monospace"></textarea></details>
      </div></div></div><footer class="dialog-footer"><p id="dialogFooterHelp">실행 중에는 조회 설정을 바꿀 수 없습니다.</p><button id="doneDialog" type="button">완료</button></footer></dialog>`;
    ui.getElementById('querySettings').open=true;
    const dialog=ui.getElementById('workspaceDialog');
    const panes=['Settings','Holiday','Alerts','Diagnostics'];
    let returnFocus=null;
    const selectPane=name=>{
      for(const pane of panes) {
        ui.getElementById('pane'+pane).hidden=pane!==name;
        const tab=ui.getElementById('tab'+pane);tab.setAttribute('aria-selected',String(pane===name));tab.tabIndex=pane===name?0:-1;
      }
      ui.getElementById('dialogTitle').textContent=({Settings:'감시 설정',Holiday:'명절 정시 클릭',Alerts:'알림 연결',Diagnostics:'진단 기록'})[name];
      ui.getElementById('settingsLock').hidden=name!=='Settings';
      ui.getElementById('dialogFooterHelp').textContent=name==='Holiday'?'닫아도 정시 클릭 대기는 계속됩니다. 중단하려면 취소를 누르세요.':'실행 중에는 조회 설정을 바꿀 수 없습니다.';
      ui.getElementById('dialogBody').scrollTop=0;
    };
    const closeDialog=()=>{if(dialog.open)dialog.close();returnFocus?.focus?.();};
    for(const pane of panes) {
      const opener=ui.getElementById('open'+(pane==='Diagnostics'?'Diagnostics':pane));
      opener.onclick=()=>{selectPane(pane);returnFocus=opener;dialog.showModal();ui.getElementById('tab'+pane).focus?.();};
      ui.getElementById('tab'+pane).onclick=()=>selectPane(pane);
      ui.getElementById('tab'+pane).addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const index=panes.indexOf(pane);
        const target=event.key==='Home'?0:event.key==='End'?panes.length-1:(index+(event.key==='ArrowRight'?1:panes.length-1))%panes.length;
        selectPane(panes[target]);ui.getElementById('tab'+panes[target]).focus?.();
      });
    }
    ui.getElementById('closeDialog').onclick=closeDialog;
    ui.getElementById('doneDialog').onclick=closeDialog;
    dialog.addEventListener('close',()=>returnFocus?.focus?.());
    selectPane('Settings');
    globalThis.KtxHoliday?.mount(ui.getElementById('paneHoliday'),{
      hide:()=>{if(dialog.open)dialog.close();},
      show:()=>{selectPane('Holiday');returnFocus=ui.getElementById('openHoliday');if(!dialog.open)dialog.showModal();ui.getElementById('tabHoliday').focus?.();},
      report:(message,armed)=>{ui.getElementById('openHoliday').textContent=armed?'명절 대기':'명절';if(!state.running)ui.getElementById('status').textContent=message;}
    });
    globalThis.ktxHolidayPanel=()=>ui.getElementById('openHoliday').onclick();
    document.body.append(host);
    ui.getElementById('fileLogs').onclick=()=>chrome.runtime.sendMessage({type:'open-file-logs'}).catch(()=>{ui.getElementById('logStatus').textContent='로그 화면을 열지 못했습니다.';});
    ui.getElementById('phoneSetup').onclick=()=>chrome.runtime.sendMessage({type:'open-phone-settings'}).catch(()=>noteAlarmProblem('확장 프로그램을 다시 로드해주세요.'));
    ui.getElementById('testAlarm').onclick=()=>notify('KTX 소리·PC 알림 테스트입니다.','test');
    ui.getElementById('minimize').onclick=()=>minimize(true);
    ui.getElementById('restore').onclick=()=>minimize(false);
    ui.getElementById('miniStop').onclick=()=>stop('사용자가 중지했습니다.');
    minimize(sessionStorage.getItem(MINIMIZED_KEY)==='true');
    let draft=null;try{draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY));}catch{}
    const c = state.running?state.config:(draft||state.config);
    if(c) for(const [id,key] of Object.entries({matchMode:'matchMode',fromTime:'start',toTime:'end',numbers:'numbers',seat:'seat',cooldown:'cooldown',action:'action'})) ui.getElementById(id).value=c[key];
    if(c) ui.getElementById('rest').value=`${c.restEvery??20}:${c.restSeconds??8}`;
    if(!c) ui.getElementById('matchMode').value='trains';
    ui.getElementById('matchMode').addEventListener('change',updateMode);
    ui.getElementById('includeStanding').checked = !!c?.includeStanding;
    const selectedNumbers = () => new Set(ui.getElementById('numbers').value.split(/[\s,]+/).filter(Boolean).map(C.number).filter(Boolean));
    function updateSelectionInfo() {
      const selected=selectedNumbers();
      ui.getElementById('selectionInfo').textContent=selected.size ? `${selected.size}개 선택 · ${[...selected].join(', ')}` : '열차를 한 개 이상 선택해주세요.';
      ui.querySelectorAll('#trainPicker input').forEach(input=>input.checked=selected.has(input.value));
      updateMini();saveDraft();
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
    for(const id of ['matchMode','numbers','fromTime','toTime','seat','action']) ui.getElementById(id).addEventListener('change',updateMini);
    ui.getElementById('numbers').addEventListener('input',updateMini);
    function saveDraft() {
      if(state.running)return;
      const [restEvery,restSeconds]=ui.getElementById('rest').value.split(':').map(Number);
      sessionStorage.setItem(DRAFT_KEY,JSON.stringify({...displayConfig(),cooldown:Number(ui.getElementById('cooldown').value),restEvery,restSeconds,includeStanding:ui.getElementById('includeStanding').checked}));
    }
    for(const id of ['matchMode','numbers','fromTime','toTime','seat','action','cooldown','rest','includeStanding']) {
      ui.getElementById(id).addEventListener('input',saveDraft);ui.getElementById(id).addEventListener('change',saveDraft);
    }
    ui.getElementById('stop').onclick=()=>stop('사용자가 중지했습니다.');
    ui.getElementById('start').onclick=()=>startRun(false);
    ui.getElementById('nextPerson').onclick=()=>startRun(true);
    function startRun(nextPerson) {
      if(globalThis.KtxHoliday?.isArmed())return status('명절 정시 클릭을 먼저 취소해주세요.');
      if(state.running) return;
      const f=fields(), get=id=>ui.getElementById(id).value;
      if(location.pathname!='/ticket/search/list' || !f.from || !f.to || !f.date || !f.people) return status('웹에서 날짜·구간·인원을 지정하고 조회해주세요.');
      if(!list().length && !['empty-result','transient-error'].includes(observe())) return status('열차 조회 결과 또는 조회 오류 안내가 표시된 뒤 시작해주세요.');
      if(query('#rtYn')?.checked) return status('편도 조회에서 사용해주세요.');
      const matchMode=get('matchMode'), start=get('fromTime'), end=get('toTime'), numbers=get('numbers').trim();
      if(!['time','trains'].includes(matchMode)) return status('감시 기준을 선택해주세요.');
      if(matchMode==='time' && (!Number.isFinite(C.minutes(start)) || !Number.isFinite(C.minutes(end)) || C.minutes(start)>C.minutes(end))) return status('올바른 시간대를 입력해주세요.');
      if(matchMode==='trains' && !numbers) return status('감시할 열차를 한 개 이상 선택하거나 번호를 입력해주세요.');
      if(matchMode==='trains' && numbers && !/^\d+(?:[\s,]+\d+)*$/.test(numbers)) return status('열차 번호는 숫자와 쉼표로 입력해주세요.');
      const [restEvery,restSeconds]=get('rest').split(':').map(Number);
      if(!Number.isInteger(restEvery)||!Number.isInteger(restSeconds)||restEvery<0||restSeconds<0) return status('쉬어가기 설정을 다시 선택해주세요.');
      const cooldown=Number(get('cooldown'));
      if(!Number.isInteger(cooldown)||cooldown<MIN_COOLDOWN||cooldown>60) return status(`조회 후 대기는 ${MIN_COOLDOWN}~60초로 입력해주세요.`);
      if(!C.singlePassenger(f.people)) return status('코레일 웹 조회 인원을 1명으로 설정해주세요. 한 번에 1명만 시도합니다.');
      const targetTickets=1;
      const previous=state.waitlisted || state.booking;
      if(nextPerson) {
        if(!previous && !(state.reservations||[]).length) return status('이전 시도 기록이 없습니다. 감시 시작을 눌러주세요.');
        if(!window.confirm('코레일 내역에서 이전 예약·예약대기 결과를 확인했나요? 기존 접수는 유지하며 현재 감시 조건으로 추가 1명을 시도합니다. 같은 열차가 필요하면 열차 번호를 하나만 선택하세요. 계속할까요?')) return;
      } else if(state.waitlisted || (state.reservations||[]).length || (state.booking && ['confirming','submitted','receipt-check','returning','wait-form','wait-submitted'].includes(state.booking.phase))) {
        return status('이전 예약·예약대기 내역을 확인한 뒤 「기존 접수 유지하고 다음 1명 시작」을 눌러주세요.');
      }
      const goalKey=JSON.stringify([f,matchMode,start,end,numbers,get('seat'),get('action'),targetTickets]);
      const reservations=[],focusTrain=undefined;
      const checked=id=>ui.getElementById(id).checked;
      clearWatchMarks(); clearFoundMarks();
      state={running:true, logRunId:crypto.randomUUID(),logSeq:0,lastError:state.lastError, reservations,focusTrain,goalKey, config:{...f,targetTickets,matchMode,start,end,numbers,cooldown,retryPolicy:5,
        includeStanding:checked('includeStanding'),restEvery,restSeconds,
        seat:get('seat'),action:get('action')}};
      sessionStorage.setItem(DRAFT_KEY,JSON.stringify(state.config));
      trace('run-started',{kind:state.config.seat,action:state.config.action,target:targetTickets,cooldownMs:cooldown*1000,restEvery,restSeconds,matchMode});
      observedResponses.clear();
      save(); controls(); next=Date.now(); waitingSince=0; emptyResultSince=null; querySince=0; observedQueries.clear(); delete state.lastQuery; reloadRequestedAt=null; reloadPending=false; recoveryPending=false; batches=1; awaitingMore=null; seenTargets.clear(); requestAt=Date.now(); signature=''; stableAt=Date.now(); responseMs=0;
      loginMenuSince=null;lastAuthMarker=null;
      state.message='조회 상태를 확인하는 중';save();status(state.message);
      try { audio=new AudioContext(); audio.resume().catch(()=>{}); } catch {}
    };
    renderTrace();
    controls(); status(state.message || (state.running?'조회 재개 준비 중':'대기 중'));
  }
  let loginMenuSince=null, lastAuthMarker=null;
  function loginGate() {
    const dialog=layerDialog();
    if(location.pathname.includes('/login') || dialog?.kind==='login') {
      trace('login-required',{reason:location.pathname.includes('/login')?'로그인 화면':'로그인 안내'});
      abort('로그인이 필요합니다. 재로그인 후 기존 예약 내역을 확인하고 다시 시작해주세요.');return false;
    }
    if(document.readyState!=='complete' || busyIndicator()) {loginMenuSince=null;return true;}
    // Read only visible navigation labels, never cookies or account details.
    const labels=[...document.querySelectorAll('header a,header button,nav a,nav button,[role="navigation"] a,[role="navigation"] button')].filter(visible).map(text);
    const marker=labels.includes('로그아웃')?'signed-in':labels.includes('로그인')?'signed-out':'unknown';
    if(marker!==lastAuthMarker) {lastAuthMarker=marker;trace('login-ui-state',{reason:marker});}
    if(marker!=='signed-out') {loginMenuSince=null;return true;}
    loginMenuSince??=Date.now();
    if(Date.now()-loginMenuSince<3000) {status('로그인 상태 확인 중 · 조회를 잠시 멈춥니다.');return false;}
    trace('login-required',{reason:'로그인 메뉴 3초 지속'});
    abort('로그인 메뉴가 표시되어 감시를 중지했습니다. 재로그인 후 기존 예약 내역을 확인하고 다시 시작해주세요.');return false;
  }
  function guard() {
    if(location.pathname!='/ticket/search/list') { abort('페이지가 변경되어 중지했습니다.'); return false; }
    const f=fields(), c=state.config;
    if(!f.date) return false;
    if(!C.singlePassenger(f.people)) {abort('웹 조회 인원이 1명이 아니어서 중지했습니다.');return false;}
    if(['from','to','date','people'].some(k=>f[k]!==c[k])) { abort('검색 조건이 변경되어 중지했습니다. 다시 시작해주세요.'); return false; }
    if(query('#rtYn')?.checked) {abort('왕복으로 변경되어 중지했습니다.'); return false;}
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
      transientError:/조회\s*(?:중\s*)?(?:오류|실패)|조회.{0,15}오류가\s*발생|통신\s*오류|서버\s*오류|일시적인?\s*오류/.test(body),
      // Korail shows this whenever the result list is empty, and every schedule
      // request failure empties the list. It does not mean "no trains run".
      emptyResult:/해당\s*스케줄에\s*운행하는\s*열차가\s*없습니다/.test(body),
      hasRows:rows.length>0, stableMs:Date.now()-stableAt
    });
    if(kind==='ready' && !responseMs && (!awaitingMore || rows.some(row=>!awaitingMore.keys.has(rowKey(row))))) responseMs=Date.now()-requestAt;
    return kind;
  }
  function beginRequest() { requestAt=Date.now(); responseMs=0; stableAt=Date.now(); }
  async function scan() {
    if(!guard()) return;
    const rows=list();
    if(!rows.length) {
      waitingSince ||= Date.now();
      if(Date.now()-waitingSince<60000) { status('열차 목록을 기다리는 중'); next=Date.now()+500; return; }
      recover('열차 목록이 60초 동안 표시되지 않음'); return;
    }
    waitingSince=0;
    state.pace=C.nextPace(state.pace,false);
    if(awaitingMore) {
      const added=rows.some(row=>!awaitingMore.keys.has(rowKey(row)));
      if(!added) {
        if(Date.now()-awaitingMore.at>60000) {recover('더보기 후 새 열차가 60초 동안 표시되지 않음');return;}
        status(`더보기 결과 대기 중 · 현재 ${rows.length}개 (${rangeSummary(rows)})`);
        next=Date.now()+500;return;
      }
      trace('more-result',{batch:batches,rows:rows.length,range:rangeSummary(rows)});
      awaitingMore=null;
    }
    const c=state.config;
    const matching=state.focusTrain?{...c,matchMode:'trains',numbers:state.focusTrain.number}:c;
    const wanted=new Set(matching.matchMode==='trains'?matching.numbers.split(/[\s,]+/).filter(Boolean).map(C.number):[]);
    markWatched(rows,matching);
    let waiting=null;
    watchedCount=rows.filter(row=>C.matches({heading:text(row.querySelector('h3')),type:text(row.querySelector('.flag_wrap .blind')),number:text(row.querySelector('.num'))},matching)).length;
    for(const row of rows) {
      const data={heading:text(row.querySelector('h3')),type:text(row.querySelector('.flag_wrap .blind')),number:text(row.querySelector('.num'))};
      if(!C.matches(data,matching) || (state.focusTrain && (C.number(data.number)!==state.focusTrain.number || data.heading!==state.focusTrain.heading))) continue;
      seenTargets.add(C.number(data.number));
      const cells=[...row.querySelectorAll('.price_box')];
      const clickable=el=>enabled(el);
      if(c.action==='reserve' && !waiting) {
        for(const kind of c.seat==='either'?['gen','spe']:[c.seat]) {
          const box=cells.find((box,index)=>clickable(box.querySelector('a')) && C.waitOpen(box.className,text(box.querySelector('a')),kind,index));
          if(box) {waiting={row,data,kind,link:box.querySelector('a')};break;}
        }
      }
      for(const kind of c.seat==='either'?['gen','spe']:[c.seat]) {
        let link=null, via='';
        for(const box of cells) {
          const anchor=box.querySelector('a');
          if(!clickable(anchor)) continue;
          // The cell's ticketType class is the site's own verdict on whether
          // this seat class is bookable; the label text is only a fallback.
          if(C.seatOpen(C.seatTokens(box.className),kind)) {link=anchor;via='class';break;}
          if(C.available(text(box.querySelector('.txt_ch')),text(box.querySelector('.txt_price')),kind)) {link=anchor;via='label';break;}
        }
        if(!link && c.includeStanding && kind==='gen') {
          for(const box of cells) {
            const anchor=box.querySelector('a');
            if(!clickable(anchor)) continue;
            if(C.standingOpen(C.seatTokens(box.className))||C.combinedStanding(text(anchor))) {link=anchor;via='standing';break;}
          }
        }
        if(!link) continue;
        const message=`좌석 발견: ${data.type} ${data.number}\n${data.heading}\n${text(link)}`;
        clearFoundMarks(); clearWatchMarks();
        row.scrollIntoView({block:'center'}); row.style.boxShadow=FOUND_RING;
        trace('seat-found',{number:C.number(data.number),kind,via});
        if(c.action==='notify') {stop(message);notify(message,'seat',{...data,kind});return;}
        reloadPending=false; recoveryPending=false; awaitingMore=null;
        state.booking={phase:'selecting',at:Date.now(),number:C.number(data.number),heading:data.heading,kind,seatText:text(link),dialogs:[],requestSeen:false};
        bookingLink=link; readyButton=null; state.message=message+'\n좌석 선택 중';save();status(state.message);
        await clickTracked(link,'seat');
        return;
      }
    }
    // Prefer any available seat in this loaded list over waiting. Only then
    // select the first eligible waiting candidate, never a sold-out link.
    if(waiting) {
      const {row,data,kind,link}=waiting;
      clearFoundMarks();clearWatchMarks();row.scrollIntoView({block:'center'});row.style.boxShadow=FOUND_RING;
      reloadPending=false;recoveryPending=false;awaitingMore=null;
      state.booking={mode:'wait',phase:'selecting',at:Date.now(),number:C.number(data.number),heading:data.heading,kind,seatText:text(link),dialogs:[],requestSeen:false};
      bookingLink=link;readyButton=null;state.message=`${data.number} 열차 예약대기 선택 중 · 좌석 확보 전`;
      save();status(state.message);trace('wait-found',{number:C.number(data.number),kind});
      await clickTracked(link,'seat');return;
    }
    state.errors=0; save();
    const more=[...document.querySelectorAll('a,button,[role="button"]')].find(el=>visible(el)&&text(el).replace(/\s+/g,'')==='더보기');
    const allTargetsSeen=wanted.size>0 && [...wanted].every(number=>seenTargets.has(number));
    if(more && !state.moreBlocked && !(state.focusTrain && allTargetsSeen) && C.needsMore(rows.map(row=>text(row.querySelector('h3'))),c,batches,allTargetsSeen)) {
      if(!enabled(more)) {abort('더보기 버튼이 비활성화되어 중지했습니다. 설정한 전체 범위를 확인하지 못했습니다.');return;}
      batches++; awaitingMore={count:rows.length,keys:new Set(rows.map(rowKey)),frontier:rowKey(rows[rows.length-1]),at:Date.now()}; beginRequest(); state.lastAction='더보기 '+batches+'번째 묶음'; save();
      trace('more-request',{batch:batches,rows:rows.length,range:rangeSummary(rows),end:c.matchMode==='time'?c.end:null});
      await clickTracked(more,'more'); next=Date.now()+500; status(c.matchMode==='time'?`현재 ${rangeSummary(rows)} · ${c.end} 출발 열차까지 더보기 조회 중 (${batches}번째 목록)`:`선택 열차 찾는 중 (더보기 ${batches-1}/2)`); return;
    }
    if(state.moreBlocked && c.matchMode==='trains' && !allTargetsSeen) {
      abort('더보기 조회가 실패해 선택한 열차를 목록에서 볼 수 없습니다.\n웹에서 조회 시작 시각을 감시할 열차 출발 시각 근처로 맞춘 뒤 다시 시작해주세요.');
      return;
    }
    if(!state.moreBlocked) state.moreFailures={};
    save();
    state.checks=(state.checks||0)+1;
    const rest=C.restDelay(state.checks,c.restEvery,c.restSeconds*1000);
    const delay=Math.max(C.pollDelay(c.cooldown*1000,state.pace?.level),rest);
    // Summary only. The countdown line is appended by whoever calls status(),
    // because it ticks down; baking it in here printed it twice.
    pendingSummary=`${rows.length}개 열차 확인 (${rangeSummary(rows)}) · 감시 대상 ${watchedCount}개: 조건에 맞는 좌석 없음`
      +(state.pace?.level?`\n조회 거부 ${state.pace.level}단계 · 간격 ${Math.round(delay/1000)}초로 조정`:'')
      +(state.moreBlocked?'\n더보기 중단됨 · 첫 목록만 감시 중':'')
      +(rest?`\n${state.checks}번째 조회 · 잠시 쉬어갑니다`:'');
    status(pendingSummary+`\n${Math.ceil(delay/1000)}초 후 재조회`+queryNote());
    next=Date.now()+delay; pendingSignature=signature; reloadPending=true;
  }
  let watchedCount=0, batches=1, reloadPending=false, awaitingMore=null, pendingSignature='', pendingSummary='', recoveryPending=false;
  const seenTargets=new Set();
  function enabled(el) { return visible(el) && !el.disabled && el.getAttribute('aria-disabled')!=='true'; }
  function buttons(root,label) { return [...root.querySelectorAll('button,a,[role="button"]')].filter(el=>enabled(el)&&text(el)===label); }
  function progressText() {
    return state.waitlisted?'예약대기 1명 접수 · 배정 대기':'한 번에 1명 · 접수 후 정지';
  }
  function siteText() {
    // Never interpret our own progress/status copy as a receipt.
    const body=document.body.innerText;
    const panel=host?.innerText;
    return panel?body.replace(panel,''):body;
  }
  function finishBooking(message,kind='halt') { trace('booking-ended',{outcome:kind,reason:message,...diagnosticSnapshot()});stop(message);notify(message,kind); }
  const CLOSE_LABELS=['닫기','취소','아니오','아니요','레이어닫기'];
  // Korail renders every reservation notice into one shared layer popup.
  function layerDialog() {
    for(const box of [...document.querySelectorAll('#layerPopup, .layerPopup')].filter(visible)) {
      const full=text(box);
      if(!full || full.length>1200) continue;
      const title=text(box.querySelector('h1,h2,h3,.tit,[role="heading"]'));
      const actions=[...box.querySelectorAll('button,a,[role="button"]')].filter(el=>enabled(el)&&text(el));
      if(!actions.some(el=>!CLOSE_LABELS.includes(text(el)))) continue;
      const body=full.startsWith(title)?full.slice(title.length).trim():full;
      return {box,title,body,actions,kind:C.dialogKind(title,body)};
    }
    return null;
  }
  function pickAction(actions,labels) {
    for(const label of labels) {
      const hit=actions.find(el=>text(el)===label);
      if(hit) return hit;
    }
    return null;
  }
  // Only an explicit no-seats result authorizes another attempt. Generic
  // failure, HTTP error and uncertain outcomes must never be replayed.
  async function retrySoldOut(booking,dialog) {
    if(location.pathname!=='/ticket/search/list' || !['confirming','submitted'].includes(booking.phase)) {
      finishBooking('좌석 선택 중 잔여석 없음 안내가 표시됐습니다. 선택 상태를 직접 확인해주세요.');return;
    }
    const confirm=pickAction(dialog.actions,['확인','닫기']);
    if(!confirm) {finishBooking('잔여석 없음 안내를 닫을 수 없어 정지했습니다.');return;}
    booking.phase='retry-wait'; booking.at=Date.now();
    booking.retryCount=(booking.retryCount||0)+1;
    booking.retryAfter=Date.now()+Math.max(1000,(state.config.cooldown||0)*1000);
    booking.readyAt=null; readyButton=null; booking.dialogs=[];
    booking.requestSeen=false; delete booking.responseError;
    observedResponses.clear(); save();
    trace(dialog.kind==='wait-capacity'?'wait-capacity-retry':'sold-out-retry',{number:booking.number,attempt:booking.retryCount});
    await clickTracked(confirm,'dialog');
    status(`${booking.number} 열차 ${dialog.kind==='wait-capacity'?'예약대기 한도 초과 · 같은 열차 예약대기 재시도':'잔여석 없음 · 선택 유지 후 예매 재시도'} (${booking.retryCount})`);
  }
  // Other notices complete the current attempt without resubmitting it.
  async function handleDialog(booking,dialog) {
    trace('dialog-seen',{dialogKind:dialog.kind,dialogTitle:dialog.title,dialogBody:dialog.body,dialogActions:dialog.actions.map(text).join(' | ')});
    if(dialog.kind==='wait-capacity' && booking.mode==='wait') {await retrySoldOut(booking,dialog);return;}
    if(dialog.kind==='sold-out' && booking.mode==='wait') {finishBooking('예약대기 신청 중 잔여석 없음 안내가 표시됐습니다. 중복 신청 없이 정지했습니다. 내역을 확인해주세요.');return;}
    if(dialog.kind==='sold-out') {await retrySoldOut(booking,dialog);return;}
    const signature=dialog.kind+'|'+dialog.body.slice(0,120);
    booking.dialogs=booking.dialogs||[];
    const repeats=booking.dialogs.filter(entry=>entry.signature===signature).length;
    if(repeats>=3) {finishBooking(`같은 안내창이 반복되어 정지했습니다.\n${dialog.title} ${dialog.body}`.slice(0,300));return;}
    if(dialog.kind==='login') {finishBooking('로그인이 필요하다는 안내가 표시됐습니다. 다시 로그인한 뒤 시작해주세요.');return;}
    if(dialog.kind==='fail') {finishBooking(`예매가 진행되지 않았습니다.\n${dialog.body}`.slice(0,300));return;}
    if(dialog.kind==='srt') {finishBooking('SRT 홈페이지로 이동하는 안내입니다. 자동으로 진행하지 않습니다. 직접 확인해주세요.');return;}
    const plan=C.dialogPlan(dialog.kind,state.config);
    if(!plan.act) {
      const reason='자동 처리하지 않는 안내입니다.';
      finishBooking(`${reason}\n${dialog.title} ${dialog.body}`.slice(0,300));return;
    }
    const confirm=pickAction(dialog.actions,plan.confirm);
    if(!confirm) {finishBooking(`안내창에서 확인 버튼을 찾지 못했습니다.\n${dialog.title} ${dialog.body}`.slice(0,300));return;}
    booking.dialogs.push({signature,at:Date.now()});
    booking.dialogs=booking.dialogs.slice(-10);
    booking.readyAt=null; readyButton=null;
    save();
    trace('dialog-confirm',{kind:dialog.kind,label:text(confirm),note:plan.note});
    await clickTracked(confirm,'dialog');
    status(`안내 확인: ${plan.note}`);
  }
  // The bar shows '입석+좌석 예매' instead of '예매' when a standing+seat fare is
  // selected. Waiting uses its own button and state, never the seat counter.
  const RESERVE_LABELS=['예매','입석+좌석 예매'];
  function reservationButton(mode) {
    const labels=mode==='wait'?['예약대기신청','예약대기 신청']:RESERVE_LABELS;
    const seatLinks=[...document.querySelectorAll('a,button')].filter(el=>visible(el)&&text(el)==='좌석선택');
    for(const link of seatLinks) {
      let box=link.parentElement;
      while(box && box!==document.body) {
        if(box.querySelector('li.tckList')) break;
        if(text(box).includes('열차시각')&&text(box).includes('운임요금')) {
          for(const label of labels) {
            const candidates=buttons(box,label);
            if(candidates.length===1) return candidates[0];
          }
        }
        box=box.parentElement;
      }
    }
    // Fallback: reservbtn belongs to the bottom reservation bar, so this cannot
    // match the 예매 entry in the top navigation.
    for(const box of [...document.querySelectorAll('.ticket_reserv_wrap')].filter(visible)) {
      const found=[...box.querySelectorAll('button.reservbtn')].filter(el=>enabled(el)&&labels.includes(text(el)));
      if(found.length===1) return found[0];
    }
    return null;
  }
  function waitForm() {
    return [...document.querySelectorAll('#layerPopup, .layerPopup')].find(box=>visible(box)
      && text(box.querySelector('h1,h2,h3,.tit')).replace(/\s/g,'')==='예약대기신청'
      && box.querySelector('.password_pop.type_waiting.apply'));
  }
  async function advanceWait(booking) {
    if(!['confirming','submitted','wait-form','wait-submitted'].includes(booking.phase)) return false;
    const body=siteText();
    observeBookingResponses();
    if(booking.responseError) {finishBooking(`예약대기 요청이 HTTP ${booking.responseError} 오류로 실패했습니다. 내역 확인 후 다시 시작해주세요.`);return true;}
    if(location.pathname.includes('/login')) {finishBooking('예약대기 신청에는 로그인이 필요합니다. 로그인 후 내역을 확인해주세요.');return true;}
    const form=waitForm();
    if(booking.phase==='wait-submitted') {
      if(!form && C.waitComplete(body)) {
        state.waitlisted={number:booking.number,heading:booking.heading,date:state.config.date,people:state.config.people};
        trace('wait-completed',{number:booking.number});
        finishBooking(`예약대기 신청 완료: KTX ${booking.number}\n${booking.heading} · ${state.config.people}\n좌석은 아직 확보되지 않았습니다. 코레일 예약대기 내역에서 배정과 결제 기한을 확인해주세요.`,'wait');return true;
      }
      if(Date.now()-booking.at>RESULT_MS || (!form && location.pathname!=='/ticket/search/list' && !location.pathname.includes('/reservation/detail'))) {
        finishBooking('예약대기 신청 결과를 확인하지 못했습니다. 중복 신청 없이 정지했습니다. 코레일 예약대기 내역을 확인해주세요.');return true;
      }
      status('예약대기 접수 결과 확인 중 · 좌석 확보와 별개입니다.');return true;
    }
    if(form) {
      if(booking.phase!=='wait-form') {booking.phase='wait-form';booking.at=Date.now();save();}
      if(Date.now()-booking.at>SELECT_MS) {finishBooking('예약대기 신청창을 처리하지 못했습니다. 내역을 직접 확인해주세요.');return true;}
      if(busyIndicator()) {booking.readyAt=null;readyButton=null;return true;}
      const special=form.querySelector('#specialSeatChecked');
      const allowSpecial=state.config.seat==='either';
      if(!special) {finishBooking('예약대기 좌석 등급 설정을 확인하지 못했습니다. 직접 확인해주세요.');return true;}
      if(special.checked!==allowSpecial) {
        booking.readyAt=null;readyButton=null;
        // Korail visually hides the native input (1px) beneath its label.
        // Click the associated visible label and verify checked on the next pass.
        if(special.disabled || special.getAttribute('aria-disabled')==='true') {finishBooking('예약대기 좌석 등급 설정이 비활성화되어 정지했습니다. 직접 확인해주세요.');return true;}
        const label=form.querySelector('label[for="specialSeatChecked"]');
        await clickTracked(label && visible(label)?label:special,'dialog');return true;
      }
      // Leave the site's optional SMS/phone consent untouched. Never copy a
      // member phone number or accept privacy consent automatically.
      const phone=form.querySelector('#phoneNumChangeChecked');
      if(phone?.checked) {finishBooking('예약대기 휴대폰 안내 입력이 켜져 있습니다. 번호·동의를 직접 확인하고 대기신청을 완료해주세요.');return true;}
      const submit=buttons(form,'대기신청');
      if(submit.length!==1) {finishBooking('예약대기 신청 버튼을 확인하지 못했습니다. 직접 확인해주세요.');return true;}
      if(readyButton!==submit[0] || booking.readyAt==null) {readyButton=submit[0];booking.readyAt=Date.now();return true;}
      if(Date.now()-booking.readyAt<BUTTON_STABLE_MS) return true;
      booking.phase='wait-submitted';booking.at=Date.now();booking.requestSeen=false;
      observedResponses.clear();booking.networkSince=performance.timeOrigin+performance.now();save();
      trace('wait-submit');await clickTracked(submit[0],'reserve');status('예약대기 신청 전송 · 접수 결과 확인 중');return true;
    }
    if(booking.phase==='wait-form' || location.pathname!=='/ticket/search/list') {
      finishBooking('예약대기 신청 흐름이 변경됐습니다. 예약대기 내역을 직접 확인해주세요.');return true;
    }
    // Known notices may precede the form; existing booking code handles them.
    const dialog=layerDialog();
    if(dialog) {await handleDialog(booking,dialog);return true;}
    if(Date.now()-booking.at>CONFIRM_MS) {finishBooking('예약대기 신청창 또는 결과를 확인하지 못했습니다. 내역 확인 없이 재신청하지 않습니다.');return true;}
    status('예약대기 신청창 대기 중');return true;
  }
  function busyIndicator() {
    return document.readyState!=='complete' || [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(visible);
  }
  // Reached only once a /web_r/ reservation request has actually been sent.
  // Retry only a confirmed no-seats dialog, never an ambiguous result.
  async function resolveSubmitted(booking) {
    observeBookingResponses();
    const body=document.body.innerText;
    if(/예약이 완료되었습니다|예매가 완료되었습니다|승차권 예약 완료/.test(body)) {finishBooking('예매 완료 문구를 확인했습니다. 예약 내역과 결제 기한을 확인해주세요.','seat');return;}
    // On success the site routes to the reservation detail screen.
    if(location.pathname.includes('/reservation/detail')) {finishBooking('예약 상세 화면으로 이동했습니다. 예약이 접수된 것으로 보입니다. 결제 기한을 확인하고 직접 결제해주세요.','seat');return;}
    if(location.pathname.includes('/cart')) {finishBooking('장바구니 화면으로 이동했습니다. 예약 내역을 직접 확인해주세요.','seat');return;}
    if(location.pathname.includes('/login')) {finishBooking('로그인 화면으로 이동했습니다. 세션이 만료된 것 같습니다. 예약 내역을 확인한 뒤 다시 로그인해주세요.');return;}
    if(location.pathname!='/ticket/search/list') {finishBooking('예매 요청 후 페이지가 이동했습니다. 예약 내역을 직접 확인해주세요. 결제는 진행하지 않았습니다.');return;}
    if(booking.responseError) {finishBooking(`예매 요청이 HTTP ${booking.responseError} 오류로 실패했습니다. 예약 내역을 직접 확인해주세요.`);return;}
    const dialog=layerDialog();
    if(dialog?.kind==='sold-out') {await retrySoldOut(booking,dialog);return;}
    if(dialog && dialog.kind!=='info') {finishBooking(`예매 요청 후 안내가 표시됐습니다. 예약 내역을 직접 확인해주세요.\n${dialog.title} ${dialog.body}`.slice(0,300));return;}
    if(Date.now()-booking.at>RESULT_MS) {trace('result-timeout');finishBooking('예매 처리 결과를 확인하지 못했습니다. 진행 기록을 확인해주세요. 중복 요청 없이 정지했습니다.');return;}
    status('예매 요청 전송됨 — 결과 확인 중');
  }
  async function advanceBooking() {
    const booking=state.booking;
    const body=document.body.innerText;
    if(/자동입력 방지|보안문자|비정상적인 접근|접근이 제한|접속이 차단/.test(body)) {finishBooking('예매 중 인증·접근 제한 안내가 있습니다. 직접 확인해주세요.');return;}
    if(/반복된 요청으로 차단되었습니다|사용자 매크로 제약에 감지/.test(body)) {finishBooking('코레일이 반복 요청으로 차단했습니다. 한동안 기다린 뒤 브라우저에서 직접 확인해주세요.');return;}
    if(booking.mode==='wait' && await advanceWait(booking)) return;
    if(booking.phase==='submitted') {await resolveSubmitted(booking);return;}
    if(booking.phase==='retry-wait') {
      if(!guard()) return;
      if(Date.now()-booking.at>SELECT_MS) {finishBooking('잔여석 안내가 닫히지 않거나 예매 화면이 준비되지 않아 중지했습니다.');return;}
      if(layerDialog() || busyIndicator() || /서비스 연결대기|현재 사용자가 많아 대기/.test(body) || Date.now()<booking.retryAfter) return;
      booking.phase='selecting';booking.at=Date.now();booking.readyAt=null;readyButton=null;save();
    }
    const resetReady=()=>{booking.readyAt=null;readyButton=null;};
    // 'confirming' means the reserve button was clicked but Korail has not sent
    // the reservation request yet. It first waits for its own notice dialogs,
    // which is why the old build sat on a spinner until it timed out.
    if(booking.phase==='confirming') {
      observeBookingResponses();
      if(booking.requestSeen) {
        booking.phase='submitted';booking.at=Date.now();save();
        trace('request-sent');
        status('예매 요청 전송 확인 — 결과 확인 중');return;
      }
      if(location.pathname.includes('/login')) {finishBooking('예매 도중 로그인 화면으로 이동했습니다. 세션이 만료된 것 같습니다. 다시 로그인한 뒤 시작해주세요.');return;}
      if(location.pathname.includes('/reservation/')) {finishBooking('예약 화면으로 이동했습니다. 예약 내역을 직접 확인해주세요.','seat');return;}
      if(Date.now()-booking.at>CONFIRM_MS) {
        trace('confirm-timeout');
        finishBooking('예매 클릭 후 예약 요청의 응답을 확인하지 못했습니다. 처리 중일 수도 있으므로 다시 누르지 말고 화면과 예약 내역을 확인해주세요.');return;
      }
    }
    if(/서비스 연결대기|현재 사용자가 많아 대기/.test(body)) {resetReady();status('예매 진행 중 접속 대기 — 추가 요청 없이 기다립니다.');return;}
    const dialog=layerDialog();
    if(dialog) {resetReady();await handleDialog(booking,dialog);return;}
    if(busyIndicator()) {
      resetReady();
      status(booking.phase==='confirming'?'예매 처리 중 — 응답을 기다립니다.':'좌석 선택 처리 중 — 로딩이 끝나기를 기다립니다.');return;
    }
    if(booking.phase==='confirming') {status('예매 요청 전송 대기 중 — 안내창과 대기열을 확인합니다.');return;}
    if(!guard()) return;
    if(Date.now()-booking.at>SELECT_MS) {finishBooking('좌석 선택 또는 예매 버튼 표시를 확인하지 못해 정지했습니다. 화면을 직접 확인해주세요.');return;}
    const row=list().find(row=>C.number(text(row.querySelector('.num')))===booking.number && text(row.querySelector('h3'))===booking.heading);
    if(!row) {finishBooking('선택한 열차가 목록에서 변경되어 예매를 중지했습니다.');return;}
    if(!bookingLink || !bookingLink.isConnected) {
      bookingLink=[...row.querySelectorAll('.price_box a')].find(el=>visible(el)&&text(el)===booking.seatText)
        || [...row.querySelectorAll('.price_box')].filter(box=>C.seatTokens(box.className).has('active')).map(box=>box.querySelector('a')).find(el=>visible(el))
        || null;
      if(!bookingLink) {finishBooking('선택 상태가 유지되지 않아 중지했습니다. 다시 시작해주세요.');return;}
    }
    // The site marks the chosen fare with title="선택" and an 'active' cell class.
    const cell=bookingLink.closest('.price_box');
    const selected=bookingLink.getAttribute('title')==='선택'||bookingLink.getAttribute('aria-selected')==='true'||bookingLink.getAttribute('aria-pressed')==='true'||(!!cell&&C.seatTokens(cell.className).has('active'));
    if(!selected) {resetReady();status('해당 열차의 좌석 선택 표시를 확인하는 중');return;}
    const reserve=reservationButton(booking.mode);
    if(!reserve) {resetReady();status('하단 예매 버튼이 활성화되기를 기다리는 중');return;}
    if(readyButton!==reserve || booking.readyAt==null) {readyButton=reserve;booking.readyAt=Date.now();}
    if(Date.now()-booking.readyAt<BUTTON_STABLE_MS) {status('좌석 선택 완료 — 버튼 상태 확인 후 바로 예매합니다.');return;}
    booking.phase='confirming';booking.at=Date.now();booking.requestSeen=false;delete booking.responseError;state.lastAction='예매 버튼 클릭';
    if(globalThis.performance?.now) booking.networkSince=performance.timeOrigin+performance.now();
    // State is saved before the click so reload/navigation cannot duplicate submission.
    save();
    await clickTracked(reserve,'reserve');status('예매 버튼 클릭 — 안내창과 요청을 확인합니다.');
  }
  function recover(reason, refused=true) {
    if(!recoveryPending) {
      if(refused) state.pace=C.nextPace(state.pace,true);
      if(awaitingMore) {
        state.moreFailures=state.moreFailures||{};
        const count=(state.moreFailures[awaitingMore.frontier]||0)+1;
        state.moreFailures[awaitingMore.frontier]=count;
        trace('more-failure',{attempt:count,reason});
        awaitingMore=null;
        if(count>=2 && !state.moreBlocked) {state.moreBlocked=true;trace('more-blocked');}
        state.lastRecovery=state.moreBlocked
          ? '더보기 조회가 반복 실패해 더보기를 중단했습니다. 첫 목록만 감시합니다.'
          : '더보기 조회가 실패해 목록이 지워졌습니다. 다시 조회합니다.';
        save();
        // The base query was fine, so this is not a refused search: re-query now
        // instead of serving the exponential recovery wait.
        next=Date.now(); recoveryPending=false; reloadPending=true;
        status(state.lastRecovery); return;
      }
      state.errors=(state.errors||0)+1;
      if(state.errors>MAX_RECOVERY) {abort('반복 재조회로도 목록을 받지 못해 중지했습니다.\n'+reason+'\n웹에서 직접 확인해주세요.');return;}
      state.lastRecovery=reason; save();
      trace('query-recovery-scheduled',{reason,attempt:state.errors,waitMs:C.recoveryDelay(state.errors)});
      next=Date.now()+C.recoveryDelay(state.errors);
      recoveryPending=true; reloadPending=false;
    }
    status(`${state.lastRecovery}\n${Math.max(0,Math.ceil((next-Date.now())/1000))}초 후 재조회 (${state.errors}/${MAX_RECOVERY})`+queryNote());
    if(Date.now()>=next) {
      reloadSearch('오류 복구 새로고침');
    }
  }
  function reloadSearch(reason) {
    if(reloadRequestedAt!==null || !state.running || state.booking) return;
    reloadRequestedAt=Date.now();state.lastAction=reason;
    const requestedAt=reloadRequestedAt;
    trace('browser-reload-request',{reason});releaseLease();
    status('브라우저에 일반 새로고침을 요청하는 중');
    try {
      chrome.runtime.sendMessage({type:'reload-search-tab'}).then(result=>{
        if(reloadRequestedAt!==requestedAt || !state.running) return;
        if(result?.ok===false) {
          reloadRequestedAt=null;trace('browser-reload-error',{error:result.error||'원인 미확인'});
          abort('브라우저 새로고침 요청에 실패했습니다.\n'+(result.error||'확장 프로그램 연결을 확인해주세요.'));
        }
      }).catch(()=>{
        // Navigation can close this message channel before the reply arrives.
        // Keep saved running state; only stop if this document is still here after 10s.
      });
    } catch {
      reloadRequestedAt=null;trace('browser-reload-error');
      abort('확장 프로그램 연결을 확인할 수 없습니다. 확장 프로그램과 코레일 탭을 새로고침해주세요.');
    }
  }
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
  let documentLogged=false;
  async function tick() {
    mount();
    if(state.running && !documentLogged) {documentLogged=true;trace('document-resumed',{...diagnosticSnapshot()});}
    const f=fields(); ui.getElementById('route').textContent=f.from?`${f.from} → ${f.to} · ${f.date} · ${f.people}`:'웹에서 날짜·구간·인원을 선택하고 조회하세요.';
    updateMini();
    if(!state.running||busy) return;
    if(reloadRequestedAt!==null) {
      if(Date.now()-reloadRequestedAt>=10000) {
        reloadRequestedAt=null;trace('browser-reload-timeout');
        abort('새로고침 요청 후 10초 동안 페이지 이동을 확인하지 못해 정지했습니다. 브라우저에서 직접 새로고침해주세요.');
      }
      return;
    }
    busy=true;
    try {
      // The browser lock prevents two tabs from issuing macro actions simultaneously.
      if(!navigator.locks) {abort('이 브라우저는 중복 실행 방지 기능을 지원하지 않습니다.'); return;}
      await navigator.locks.request('korail-ktx-macro', {ifAvailable:true}, async lock=> {
        if(!lock) return;
        if(!claimLease()) {abort('다른 코레일 탭의 매크로가 실행 중입니다.');return;}
        if(!loginGate()) return;
        if(state.booking) {await advanceBooking();return;}
        if(!guard()) return;
        observeQueryResponses();
        const kind=observe();
        if(kind!=='empty-result') emptyResultSince=null;
        if(kind==='blocked') {abort('사이트의 인증·접근 제한 안내가 있습니다. 직접 확인해주세요.');return;}
        if(kind==='empty-result') {
          emptyResultSince??=Date.now();
          if(Date.now()-emptyResultSince<2500) {status('빈 결과 확인 중 — 목록이 다시 표시되는지 기다립니다.');return;}
        }
        if(kind==='empty-result' || kind==='transient-error') {
          recover(kind==='empty-result'?'조회 결과가 비어 있음 (조회 요청 실패이거나 실제 운행 없음)':'조회 오류 안내 감지');return;
        }
        if(kind==='queued') {
          status('코레일 접속 대기 중 — 추가 요청 없이 기다립니다.');
          beginRequest(); waitingSince=0; return;
        }
        if(kind==='loading') {
          status('목록 갱신 중 — 완료되는 대로 검사합니다.');
          if(Date.now()-requestAt>60000) recover('화면 로딩이 60초 이상 끝나지 않음',false);
          return;
        }
        if(recoveryPending) {
          if(kind==='ready' && (!awaitingMore || list().some(row=>!awaitingMore.keys.has(rowKey(row))))) {recoveryPending=false;next=0;}
          else {recover(state.lastRecovery);return;}
        }
        if(reloadPending && signature!==pendingSignature && kind==='ready') {reloadPending=false;next=0;}
        if(Date.now()<next) {
          if(reloadPending) status(pendingSummary+`\n${Math.ceil((next-Date.now())/1000)}초 후 재조회`+queryNote());
          return;
        }
        if(reloadPending) {
          if(!guard()) return;
          reloadPending=false;
          reloadSearch('페이지 새로고침');
          return;
        }
        await scan();
      });
    } catch(e) { if(state.running) {rememberError(e);abort('오류로 중지했습니다: '+e.message);} }
    finally {busy=false;}
  }
  setInterval(tick,120);
})();
