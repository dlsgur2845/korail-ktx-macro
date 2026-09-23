(() => {
  'use strict';
  const C=globalThis.KtxHolidayCore;
  if(globalThis.KtxHoliday)return;
  let current=null;
  function mount(container,hooks={}) {
  if(current)return current.attach(container,hooks);
  const host=document.createElement('div');host.id='ktx-holiday-panel';
  host.style.cssText='display:block;width:100%';
  const ui=host.attachShadow({mode:'open'});
  ui.innerHTML=`<style>:host{font:13px system-ui;color:#19324a}*{box-sizing:border-box}[hidden]{display:none!important}section{background:#f6f9fc;border:1px solid #cad8e5;border-radius:14px;box-shadow:0 12px 40px #16324d40;max-height:calc(100dvh - 24px);overflow:auto}header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#112f49;color:white}h2{font-size:16px;margin:0}.body{padding:14px}p{line-height:1.6;margin:8px 0;overflow-wrap:anywhere}small{color:#587087}button,input{font:inherit;border:1px solid #b9cddd;border-radius:8px;padding:10px;background:white;color:#19324a}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}input{width:100%;margin:6px 0}label{display:block;margin-top:12px}.row{display:flex;gap:8px;margin-top:12px}.row button{flex:1}#arm{background:#1566b2;color:white}#close{padding:4px 10px}#status{padding:10px;background:#e9f1f8;border-radius:8px;white-space:pre-line}button:focus-visible,input:focus-visible{outline:3px solid #4c99dc;outline-offset:2px}</style><section aria-label="명절 정시 클릭"><header><h2>명절 정시 클릭 · 2.0.0</h2><button id="close" aria-label="정시 클릭 닫기">닫기</button></header><div class="body"><button id="pick">① 페이지에서 버튼 선택</button><p id="selection">선택한 버튼 없음</p><label for="target">② 시작 날짜·시각 (한국 시간)</label><input id="target" type="datetime-local" step="1"><button id="sync">서버 시각 확인</button><p id="clock">서버 시각 미확인</p><small>HTTP 응답 시각과 왕복 지연을 측정합니다. 시작 전 클릭 방지를 우선해 초 단위 오차 여유를 둡니다. 예약 서버의 정확한 개시 시각과 일치하거나 정각 도착함을 보장하지 않습니다.</small><div class="row"><button id="arm">③ 정시 클릭 준비</button><button id="cancel" disabled>취소</button></div><p id="status" role="status">선택 모드의 클릭은 버튼을 실행하지 않습니다. Esc로 선택을 취소할 수 있습니다.</p><small>이 탭을 화면에 유지하고 자동 절전 방지가 적용됩니다. 새로고침·페이지 이동 시 실행 예약이 취소됩니다.</small></div></section>`;
  const embeddedStyle=document.createElement('style');embeddedStyle.textContent='section{border:0;box-shadow:none;max-height:none;overflow:visible;border-radius:0;background:transparent}header{display:none}.body{padding:0}';ui.append(embeddedStyle);
  container.append(host);
  const get=id=>ui.getElementById(id),say=text=>{get('status').textContent=text;hooks.report?.(text,!!armed);};
  const suspend=()=>hooks.hide?.(),reopen=()=>hooks.show?.();
  const box=document.createElement('div');box.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #1384e5;background:#1384e51a;display:none';document.documentElement.append(box);
  const shield=document.createElement('div');shield.style.cssText='position:fixed;inset:0;z-index:2147483646;cursor:crosshair;display:none';document.documentElement.append(shield);
  let selected=null,identity=null,picking=false,hover=null,selectedAt=0,sample=null,syncing=false,armed=null,timer=null,syncController=null;
  let lastMono=performance.now(),lastWall=Date.now(),pickEnd=-Infinity;
  let documentURL=location.href;
  const normalRunning=()=>{try{return !!JSON.parse(sessionStorage.getItem('ktx-macro-v1'))?.running;}catch{return false;}};
  const label=el=>(el.getAttribute('aria-label')||el.textContent||el.getAttribute('value')||el.tagName).trim().replace(/\s+/g,' ').slice(0,100);
  const fingerprint=el=>JSON.stringify([el.tagName,el.id,label(el),el.getAttribute('href'),el.getAttribute('type')]);
  function log(step,details={}){chrome.runtime.sendMessage({type:'append-holiday-log',event:{step,version:'2.0.0',at:new Date().toISOString(),runId:armed?.nonce,...details}}).catch(()=>{});}
  function awake(){chrome.runtime.sendMessage({type:'keep-awake',source:'holiday',active:!!armed}).then(r=>{if(armed&&!r?.ok)cancel('절전 방지 권한을 확인해주세요.');}).catch(()=>{if(armed)cancel('절전 방지 연결이 끊겼습니다.');});}
  setInterval(()=>{if(armed)awake();},20000);
  function controls(){awake();for(const id of ['pick','target','sync','arm'])get(id).disabled=!!armed||syncing;get('cancel').disabled=!armed;}
  function point(){
    if(!selected?.isConnected || fingerprint(selected)!==identity || selected.disabled || selected.getAttribute('aria-disabled')==='true' || selected.closest('[inert]'))return null;
    const r=selected.getBoundingClientRect(),style=getComputedStyle(selected);
    if(r.width<=0||r.height<=0||style.visibility!=='visible'||style.display==='none')return null;
    const x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
    if(x<0||y<0||x>=innerWidth||y>=innerHeight)return null;
    const hit=document.elementFromPoint(x,y);return hit&&(selected===hit||selected.contains(hit))?{x,y}:null;
  }
  function cancel(reason){
    const previous=armed;armed=null;clearTimeout(timer);timer=null;
    if(previous){chrome.runtime.sendMessage({type:'holiday-release',nonce:previous.nonce}).catch(()=>{});log('holiday-cancelled',{reason,runId:previous.nonce});}
    controls();say(reason);
  }
  function endPick(){picking=false;box.style.display='none';shield.style.display='none';pickEnd=performance.now();reopen();}
  function candidate(event){
    const hit=document.elementsFromPoint(event.clientX,event.clientY).find(el=>el!==shield&&el!==box&&el!==host&&el.id!=='ktx-macro-panel');
    if(!hit||['IFRAME','HTML','BODY'].includes(hit.tagName))return null;
    const button=hit.closest('button,a[href],input[type=button],input[type=submit],input[type=image],[role=button],[onclick]');
    if(button)return button;
    return hit.matches('input,select,textarea')?null:hit;
  }
  function intercept(event){
    if(!picking){if(performance.now()-pickEnd<350&&!event.composedPath().includes(host)){event.preventDefault();event.stopImmediatePropagation();}return;}
    if(event.composedPath().includes(host))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.type==='click'){
      const el=candidate(event);
      if(!el){say('버튼 또는 링크를 선택해주세요. Esc로 돌아갑니다.');return;}
      selected=el;identity=fingerprint(el);selectedAt=performance.now();endPick();get('selection').textContent='선택: '+label(el);say('버튼을 선택했습니다. 날짜·시각을 입력하고 서버 시각을 확인해주세요.');
    }
  }
  // Capture the entire pointer sequence, not just click: sites can act on down/up.
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','auxclick','touchstart','touchend'])window.addEventListener(type,intercept,{capture:true,passive:false});
  window.addEventListener('pointermove',event=>{
    if(!picking)return;event.stopImmediatePropagation();hover=candidate(event);
    if(!hover){box.style.display='none';return;}const r=hover.getBoundingClientRect();Object.assign(box.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
  },true);
  window.addEventListener('keydown',event=>{if(picking){event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape'){endPick();say('버튼 선택을 취소했습니다.');}}},true);
  get('pick').onclick=()=>{if(normalRunning()){say('일반 잔여석 감시를 먼저 중지해주세요.');return;}documentURL=location.href;sample=null;get('clock').textContent='서버 시각 미확인';picking=true;suspend();shield.style.display='block';say('버튼을 가리킨 뒤 클릭하세요. Esc로 취소합니다.');};
  async function sync(){
    if(syncing)throw new Error('서버 시각을 확인 중입니다.');
    syncing=true;controls();const samples=[];const controller=new AbortController();syncController=controller;const timeout=setTimeout(()=>controller.abort(),7000);
    try {
      for(let i=0;i<3;i++){
        const start=performance.now();
        const response=await fetch(documentURL,{method:'HEAD',cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
        const end=performance.now();if(!response.ok)throw new Error('서버 시각 조회 실패: HTTP '+response.status);
        samples.push(C.sample(response.headers.get('Date'),response.headers.get('Age'),start,end));
      }
      const now=performance.now(),ranges=samples.map(s=>C.bounds(s,now));
      if(Math.max(...ranges.map(r=>r.low))>Math.min(...ranges.map(r=>r.high)))throw new Error('서버 시각 응답이 일치하지 않습니다.');
      sample=samples.reduce((best,s)=>s.rtt<best.rtt?s:best);
      const b=C.bounds(sample,now);get('clock').textContent='서버 추정 '+new Date((b.low+b.high)/2).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})+' · 왕복 '+Math.round(sample.rtt)+'ms · 오차 여유 약 ±'+((b.high-b.low)/2000).toFixed(2)+'초';
      log('holiday-clock-sync',{durationMs:Math.round(sample.rtt),waitMs:Math.round((b.high-b.low)/2)});
      return sample;
    }catch(error){sample=null;throw new Error(error.name==='AbortError'?'서버 시각 조회 시간이 초과되었습니다.':error.message);}
    finally{clearTimeout(timeout);syncController=null;syncing=false;controls();}
  }
  get('sync').onclick=()=>sync().then(()=>say('서버 시각을 확인했습니다. 준비를 누르면 다시 동기화한 뒤 대기합니다.')).catch(e=>say(e.message));
  async function tick(){
    const run=armed;if(!run)return;
    try{
      const now=performance.now(),wall=Date.now();
      if(now-lastMono>2500||Math.abs((wall-lastWall)-(now-lastMono))>1000)throw new Error('탭 지연·절전 또는 PC 시각 변경을 감지해 취소했습니다.');
      lastMono=now;lastWall=wall;
      if(location.href!==documentURL||!selected?.isConnected||fingerprint(selected)!==identity)throw new Error('페이지 또는 선택한 버튼이 변경되어 취소했습니다.');
      if(document.visibilityState!=='visible'||normalRunning())throw new Error('탭이 숨겨졌거나 일반 감시가 실행되어 취소했습니다.');
      const b=C.bounds(sample,now);
      if(b.low-run.target>5000)throw new Error('클릭 시각을 5초 이상 놓쳐 취소했습니다.');
      if(C.ready(sample,now,run.target)){
        suspend();
        const p=point();if(!p)throw new Error('버튼이 비활성 상태이거나 가려져 있어 클릭하지 않았습니다.');
        run.firing=true;say('지정 시각 도달 · 버튼 확인 중');
        let observed=false,eventAt=null,trusted=null;const capture=event=>{observed=true;eventAt=new Date().toISOString();trusted=event.isTrusted;};selected.addEventListener('click',capture,{capture:true,once:true});
        let response;try{response=await chrome.runtime.sendMessage({type:'holiday-click',nonce:run.nonce,...p});}finally{selected.removeEventListener('click',capture,true);}
        if(armed!==run)return;
        if(response?.ok&&!observed)response={ok:false,error:'클릭 이벤트를 확인하지 못했습니다. 페이지 결과를 직접 확인해주세요. 자동 재시도하지 않습니다.'};
        armed=null;controls();say(response?.ok?'버튼을 한 번 눌렀습니다. 페이지의 진행 결과를 직접 확인해주세요.':(response?.error||'클릭 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다.'));
        log('holiday-click-result',{runId:run.nonce,target:run.target,at:eventAt||new Date().toISOString(),observed,isTrusted:trusted,waitMs:Math.round(b.low-run.target),error:response?.error||''});return;
      }
      say('정시 클릭 대기 중\n시작 전 클릭 방지 기준까지 '+Math.max(0,(run.target-b.low)/1000).toFixed(1)+'초');
      if(now-sample.at>7000){await sync();if(armed!==run)return;lastMono=performance.now();lastWall=Date.now();}
      timer=setTimeout(tick,run.target-b.low<10000?50:500);
    }catch(error){if(armed===run)cancel(error.message);}
  }
  get('arm').onclick=async()=>{
    try{
      if(!selected||!selectedAt||!selected.isConnected||location.href!==documentURL)throw new Error('현재 페이지에서 버튼을 다시 선택해주세요.');
      if(normalRunning())throw new Error('일반 잔여석 감시를 먼저 중지해주세요.');
      if(document.visibilityState!=='visible')throw new Error('이 탭을 화면에 유지해주세요.');
      const target=C.parseTarget(get('target').value);
      const run={nonce:crypto.randomUUID(),target,firing:false};armed=run;controls();say('시각 동기화 및 입력 준비 중…');
      await sync();if(armed!==run)return;
      if(target-C.bounds(sample,performance.now()).high<3000)throw new Error('시작 시각을 최소 3초 이후로 설정해주세요.');
      selected.scrollIntoView({block:'center',inline:'nearest'});
      const response=await chrome.runtime.sendMessage({type:'holiday-prepare',nonce:run.nonce});
      if(armed!==run){chrome.runtime.sendMessage({type:'holiday-release',nonce:run.nonce}).catch(()=>{});return;}
      if(!response?.ok)throw new Error(response?.error||'클릭 준비에 실패했습니다.');
      suspend();lastMono=performance.now();lastWall=Date.now();log('holiday-armed',{target,runId:run.nonce,label:label(selected)});timer=setTimeout(tick,80);
    }catch(error){cancel(error.message);}
  };
  get('cancel').onclick=()=>cancel('사용자가 정시 클릭을 취소했습니다.');
  get('close').onclick=suspend;
  window.addEventListener('pagehide',()=>{cancel('페이지 이동으로 취소했습니다.');syncController?.abort();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'&&armed)cancel('탭이 숨겨져 취소했습니다.');});
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!['holiday-verify','holiday-verify-click'].includes(message?.type))return;
    let ok=!!armed&&armed.nonce===message.nonce&&location.href===documentURL&&document.visibilityState==='visible'&&!normalRunning();
    if(message.type==='holiday-verify-click'){
      try{const p=point(),now=performance.now(),b=C.bounds(sample,now);ok=ok&&armed.firing&&b.low>=armed.target&&b.low-armed.target<=5000&&now-lastMono<=2500&&Math.abs((Date.now()-lastWall)-(now-lastMono))<=1000&&!!p&&Math.abs(p.x-message.x)<1&&Math.abs(p.y-message.y)<1;}catch{ok=false;}
    }
    reply({ok,url:location.href});
  });
  current={open:reopen,cancel,isArmed:()=>!!armed,attach:(next,nextHooks)=>{next.append(host);hooks=nextHooks;return current;}};
  return current;
  }
  globalThis.KtxHoliday={mount,isArmed:()=>!!current?.isArmed(),cancel:reason=>current?.cancel(reason)};
})();
