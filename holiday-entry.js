(() => {
  'use strict';
  if(!KtxHolidayCore.allowed(location.href))return;
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!=='open-holiday-settings')return;
    if(typeof globalThis.ktxHolidayPanel!=='function'){reply({ok:false,error:'페이지 준비 중입니다. 잠시 후 다시 열어주세요.'});return;}
    globalThis.ktxHolidayPanel();reply({ok:true});
  });
  // Ordinary ticket pages mount the same feature inside their existing dialog.
  if(['korail.com','www.korail.com'].includes(location.hostname)&&location.pathname.startsWith('/ticket/'))return;
  const host=document.createElement('div');host.id='ktx-holiday-launcher';
  host.style.cssText='position:fixed;right:12px;top:12px;width:min(344px,calc(100% - 24px));z-index:2147483646';
  const ui=host.attachShadow({mode:'open'});
  ui.innerHTML=`<style>:host{font:13px system-ui;color:#19324a}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:1px solid #cad8e5;border-radius:9px;padding:9px 12px;background:white;color:#19324a}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:3px solid #4c99dc;outline-offset:2px}.launcher{height:184px;display:grid;grid-template-rows:24px minmax(0,1fr) 40px;gap:8px;padding:12px;background:#112f49;color:white;border-radius:14px;box-shadow:0 8px 24px #18324e26}h2,p{margin:0}h2{font-size:16px}p{font-size:12px;line-height:1.5;margin:8px 0;white-space:pre-line}#summary{min-height:0;overflow:auto;margin:0}.tools{display:flex;gap:8px}.tools button{flex:1}dialog{width:min(540px,calc(100% - 24px));height:min(660px,calc(100dvh - 24px));max-width:none;max-height:none;padding:0;margin:auto;border:1px solid #dae4ed;border-radius:18px;background:#f6f9fc;color:#19324a;box-shadow:0 24px 80px #132e4b40;overflow:hidden}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#0b23345e}header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#112f49;color:white;flex:none}header button{background:#ffffff15;color:white;border-color:#ffffff30}.body{padding:18px;overflow:auto;min-height:0;flex:1}footer{padding:12px 18px;background:white;border-top:1px solid #dae4ed;display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none}footer p{font-size:11px;color:#5a7085}#done{background:#1566b2;color:white;flex:none;white-space:nowrap}@media(max-height:500px){header,.body,footer{padding:10px 12px}}</style><section class="launcher" aria-label="KTX 명절 패널"><h2>KTX 예매 · 2.0.0</h2><p id="summary" role="status">명절 버튼과 시작 시각을 설정하세요.</p><div class="tools"><button id="open">명절 설정</button><button id="cancel" disabled>취소</button></div></section><dialog aria-labelledby="holidayTitle"><header><h2 id="holidayTitle">명절 정시 클릭</h2><button id="close" aria-label="설정 창 닫기">닫기</button></header><div class="body" id="content"></div><footer><p>닫아도 대기는 계속됩니다. 중단하려면 취소를 누르세요.</p><button id="done">완료</button></footer></dialog>`;
  document.documentElement.append(host);
  const get=id=>ui.getElementById(id),dialog=ui.querySelector('dialog');
  const show=()=>{if(!dialog.open)dialog.showModal();};
  const hide=()=>{if(dialog.open)dialog.close();};
  KtxHoliday.mount(get('content'),{show,hide,report:(message,armed)=>{get('summary').textContent=message;get('cancel').disabled=!armed;}});
  get('open').onclick=show;get('close').onclick=hide;get('done').onclick=hide;
  get('cancel').onclick=()=>KtxHoliday.cancel('사용자가 정시 클릭을 취소했습니다.');
  dialog.addEventListener('close',()=>get('open').focus());
  globalThis.ktxHolidayPanel=show;
})();
