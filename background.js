'use strict';
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'seat-found' || !sender.tab || typeof message.message !== 'string') return;
  chrome.notifications.create('ktx-seat-' + sender.tab.id, {
    type:'basic', iconUrl:'icon.png', title:'KTX 잔여석 발견',
    message:message.message.slice(0, 500), requireInteraction:true
  });
});
chrome.notifications.onClicked.addListener(id => {
  const tabId=Number(id.replace('ktx-seat-',''));
  if(Number.isInteger(tabId)) chrome.tabs.update(tabId,{active:true}).catch(()=>{});
});
