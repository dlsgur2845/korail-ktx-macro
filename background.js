'use strict';
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type==='reload-search-tab') {
    let url;
    try {url=new URL(sender.url);} catch {}
    const allowed=sender.id===chrome.runtime.id && Number.isInteger(sender.tab?.id) && sender.tab.id>=0 && sender.frameId===0 &&
      url?.protocol==='https:' && ['www.korail.com','korail.com'].includes(url.hostname) && url.pathname==='/ticket/search/list';
    if(!allowed) {sendResponse({ok:false,error:'허용된 코레일 조회 탭이 아닙니다.'});return;}
    // Use the sender's tab, never whichever tab happens to be active.
    chrome.tabs.reload(sender.tab.id,{bypassCache:false}).then(
      ()=>sendResponse({ok:true}),
      ()=>sendResponse({ok:false,error:'브라우저가 탭 새로고침 요청을 처리하지 못했습니다.'})
    );
    return true;
  }
  if(!message) return;
  // A stopped macro needs its own notification: silence there looks identical
  // to a run that is still watching.
  const ALERTS={'seat-found':{slug:'seat', title:'KTX 잔여석 발견'},'macro-stopped':{slug:'halt', title:'KTX 매크로 정지'}};
  const alert=ALERTS[message.type];
  if (!alert || !sender.tab || typeof message.message !== 'string') return;
  chrome.notifications.create(`ktx-${alert.slug}-${sender.tab.id}`, {
    type:'basic', iconUrl:'icon.png', title:alert.title,
    message:message.message.slice(0, 500), requireInteraction:true
  });
});
chrome.notifications.onClicked.addListener(id => {
  const tabId=Number(String(id).split('-').pop());
  if(Number.isInteger(tabId)) chrome.tabs.update(tabId,{active:true}).catch(()=>{});
});
