'use strict';
document.getElementById('open').onclick=async()=>{
  const status=document.getElementById('status');
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!KtxHolidayCore.allowed(tab?.url)) throw new Error('HTTPS 코레일(korail.com) 페이지에서 열어주세요.');
    const response=await chrome.tabs.sendMessage(tab.id,{type:'open-holiday-settings'});
    if(!response?.ok)throw new Error(response?.error||'코레일 페이지를 새로고침한 뒤 다시 열어주세요.');
    window.close();
  }catch(error){status.textContent=error.message;}
};
