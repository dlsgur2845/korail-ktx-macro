'use strict';
importScripts('holiday-core.js');
const holidaySessions=new Map(),holidayBusy=new Set();
function holidaySender(sender){return sender.id===chrome.runtime.id&&sender.frameId===0&&Number.isInteger(sender.tab?.id)&&typeof sender.documentId==='string'&&KtxHolidayCore.allowed(sender.url);}
async function holidayRelease(tabId,nonce){
  const session=holidaySessions.get(tabId);if(!session||session.nonce!==nonce)return;
  session.cancelled=true;holidaySessions.delete(tabId);
  // Do not detach somebody else's debugger when our attach failed.
  if(session.attached)try{await chrome.debugger.detach({tabId});}catch{}
}
async function holidayInput(m,s){
  const tabId=s.tab.id,target={tabId};
  if(holidayBusy.has(tabId))return {ok:false,error:'이 탭에서 클릭을 준비하거나 처리 중입니다.'};
  holidayBusy.add(tabId);let session=holidaySessions.get(tabId),prepared=false;
  try{
    if(m.type==='holiday-prepare'){
      if(session||inputSessions.has(tabId)||inputBusy.has(tabId))throw new Error('기존 자동 클릭을 먼저 중지해주세요.');
      const verified=await chrome.tabs.sendMessage(tabId,{type:'holiday-verify',nonce:m.nonce},{documentId:s.documentId});
      if(!verified?.ok||!KtxHolidayCore.allowed(verified.url)||new URL(verified.url).origin!==new URL(s.url).origin)throw new Error('정시 클릭 준비 상태를 확인하지 못했습니다.');
      session={nonce:m.nonce,documentId:s.documentId,url:verified.url,attached:false,cancelled:false};holidaySessions.set(tabId,session);
      await chrome.debugger.attach(target,'1.3');session.attached=true;
      if(session.cancelled){await chrome.debugger.detach(target);throw new Error('준비가 취소되었습니다.');}
    }else{
      if(!session||session.documentId!==s.documentId||session.nonce!==m.nonce)throw new Error('정시 클릭 준비가 취소되거나 문서가 바뀌었습니다.');
    }
    const {frameTree}=await chrome.debugger.sendCommand(target,'Page.getFrameTree');
    if(session.cancelled||frameTree?.frame?.url!==session.url)throw new Error('페이지가 변경되어 클릭하지 않았습니다.');
    if(m.type==='holiday-prepare'){prepared=true;return {ok:true};}
    if(!Number.isFinite(m.x)||!Number.isFinite(m.y)||m.x<0||m.y<0)throw new Error('잘못된 버튼 좌표입니다.');
    const {cssVisualViewport:v}=await chrome.debugger.sendCommand(target,'Page.getLayoutMetrics');
    if(!v||m.x>=v.clientWidth||m.y>=v.clientHeight)throw new Error('버튼이 화면 밖에 있습니다.');
    const verified=await chrome.tabs.sendMessage(tabId,{type:'holiday-verify-click',nonce:m.nonce,x:m.x,y:m.y},{documentId:s.documentId});
    if(!verified?.ok||verified.url!==session.url||session.cancelled)throw new Error('시각·버튼·실행 상태가 바뀌어 클릭하지 않았습니다.');
    if(session.used)throw new Error('이미 처리한 클릭입니다.');session.used=true;
    const params={x:m.x,y:m.y,button:'left',clickCount:1};
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{...params,type:'mousePressed',buttons:1});
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{...params,type:'mouseReleased',buttons:0});
    return {ok:true};
  }catch(error){return {ok:false,error:'정시 클릭 중단: '+String(error.message||error)};}
  finally{if(!prepared)await holidayRelease(tabId,m.nonce);holidayBusy.delete(tabId);}
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(!['holiday-prepare','holiday-click','holiday-release'].includes(m?.type))return;
  if(!holidaySender(s)||typeof m.nonce!=='string'||!m.nonce||m.nonce.length>100){reply({ok:false,error:'허용되지 않은 정시 클릭 요청입니다.'});return;}
  if(m.type==='holiday-release'){holidayRelease(s.tab.id,m.nonce).then(()=>reply({ok:true}));return true;}
  holidayInput(m,s).then(reply);return true;
});
chrome.debugger?.onDetach.addListener(s=>{const run=holidaySessions.get(s.tabId);if(run){run.cancelled=true;holidaySessions.delete(s.tabId);}});
chrome.tabs.onRemoved?.addListener(tabId=>holidaySessions.delete(tabId));
chrome.tabs.onUpdated?.addListener((tabId,change)=>{const run=holidaySessions.get(tabId);if(run&&(change.status==='loading'||(change.url&&change.url!==run.url)))void holidayRelease(tabId,run.nonce);});
