'use strict';
// Only a fixed mouse-input operation is exposed. No arbitrary CDP command,
// script evaluation, cookie access, or network interception is accepted.
const inputSessions=new Map(), inputBusy=new Set();
function searchURL(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:' && ['www.korail.com','korail.com'].includes(u.hostname) && u.pathname==='/ticket/search/list';
  } catch {return false;}
}
function ticketDocument(value) {
  try {const u=new URL(value);return u.protocol==='https:' && ['www.korail.com','korail.com'].includes(u.hostname) && u.pathname.startsWith('/ticket/');} catch {return false;}
}
async function verifySearchDocument(sender) {
  const current=await chrome.tabs.sendMessage(sender.tab.id,{type:'verify-search-document'},{documentId:sender.documentId});
  return current?.ok===true && searchURL(current.url) && new URL(current.url).origin===new URL(sender.url).origin;
}
function inputSender(sender) {
  return sender.id===chrome.runtime.id && sender.frameId===0 &&
    Number.isInteger(sender.tab?.id) && sender.tab.id>=0 &&
    typeof sender.documentId==='string' && ticketDocument(sender.url);
}
async function releaseInput(tabId) {
  if(!inputSessions.has(tabId)) return;
  inputSessions.delete(tabId);
  try {await chrome.debugger.detach({tabId});} catch {}
}
async function pageStillAllowed(target,sender) {
  const {frameTree}=await chrome.debugger.sendCommand(target,'Page.getFrameTree');
  return searchURL(frameTree?.frame?.url) && new URL(frameTree.frame.url).origin===new URL(sender.url).origin;
}
async function browserInput(message,sender) {
  const tabId=sender.tab.id, target={tabId};
  if(inputBusy.has(tabId)) return {ok:false,error:'이 탭에서 다른 클릭을 처리 중입니다.'};
  inputBusy.add(tabId);
  let inputStage='validate',inputDetail='';
  try {
    if(message.type==='prepare-browser-input') {
      if(typeof holidaySessions!=='undefined'&&holidaySessions.has(tabId))throw new Error('명절 정시 클릭을 먼저 취소해주세요.');
      inputStage='verify-document';
      if(!await verifySearchDocument(sender)) throw new Error('현재 문서가 실행 중인 코레일 조회 화면이 아닙니다.');
      if(!chrome.debugger) throw new Error('브라우저 입력 권한이 없습니다. 확장 프로그램 업데이트와 권한을 확인해주세요.');
      if(!inputSessions.has(tabId)) {
        inputStage='attach-debugger';
        try {await chrome.debugger.attach(target,'1.3');}
        catch(cause) {inputDetail=String(cause.message||cause).slice(0,500);throw new Error('브라우저 입력 연결에 실패했습니다. 코레일 탭의 개발자 도구를 닫고 권한을 확인해주세요.');}
        inputSessions.set(tabId,sender.documentId);
      }
      if(!await pageStillAllowed(target,sender)) throw new Error('조회 페이지가 변경되어 클릭하지 않았습니다.');
      inputSessions.set(tabId,sender.documentId);
      return {ok:true};
    }
    if(inputSessions.get(tabId)!==sender.documentId) throw new Error('클릭할 문서의 연결이 변경됐습니다.');
    if(!['seat','reserve','dialog','more','requery'].includes(message.step) ||
      typeof message.id!=='string' || message.id.length>100 || !message.id ||
      !Number.isFinite(message.x) || !Number.isFinite(message.y) || message.x<0 || message.y<0)
      throw new Error('잘못된 클릭 요청입니다.');
    if(!await pageStillAllowed(target,sender)) throw new Error('조회 페이지가 변경되어 클릭하지 않았습니다.');
    const metrics=await chrome.debugger.sendCommand(target,'Page.getLayoutMetrics');
    const viewport=metrics.cssVisualViewport;
    if(!viewport || message.x>=viewport.clientWidth || message.y>=viewport.clientHeight)
      throw new Error('클릭 위치가 화면 밖으로 이동했습니다.');
    inputStage='verify-target';
    const verified=await chrome.tabs.sendMessage(tabId,
      {type:'verify-page-input',id:message.id,x:message.x,y:message.y},
      {documentId:sender.documentId});
    if(!verified?.ok) throw new Error('버튼이 이동했거나 실행이 중지되어 클릭하지 않았습니다.');
    const params={x:message.x,y:message.y,button:'left',clickCount:1};
    inputStage='mouse-pressed';
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{...params,type:'mousePressed',buttons:1});
    inputStage='mouse-released';
    await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{...params,type:'mouseReleased',buttons:0});
    return {ok:true};
  } catch(e) {
    await releaseInput(tabId);
    return {ok:false,inputStage,inputDetail:inputDetail||String(e.message||e).slice(0,500),error:e.message || '브라우저 입력이 중단됐습니다. 중복 클릭 없이 정지합니다.'};
  } finally {inputBusy.delete(tabId);}
}
chrome.debugger?.onDetach.addListener(source=>inputSessions.delete(source.tabId));
chrome.tabs.onRemoved?.addListener(tabId=>inputSessions.delete(tabId));
chrome.tabs.onUpdated?.addListener((tabId,change)=> {
  if(change.url && !searchURL(change.url)) void releaseInput(tabId);
});
chrome.runtime.onMessage.addListener((message,sender,reply)=> {
  if(!['prepare-browser-input','click-page-element','release-browser-input'].includes(message?.type)) return;
  // Release is also allowed after a reservation/login navigation, but only from
  // this extension's top-level document on the same Korail origin.
  if(message.type==='release-browser-input') {
    if(sender.id!==chrome.runtime.id || sender.frameId!==0 || !Number.isInteger(sender.tab?.id)) {reply({ok:false});return;}
    releaseInput(sender.tab.id).then(()=>reply({ok:true})); return true;
  }
  if(!inputSender(sender)) {reply({ok:false,error:'허용된 코레일 조회 문서가 아닙니다.'});return;}
  browserInput(message,sender).then(reply); return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type==='reload-search-tab') {
    // sender.url can retain the initial /search/general URL after SPA routing.
    // Check origin first, then ask that exact document for its current route.
    if(!inputSender(sender)) {sendResponse({ok:false,error:'허용된 코레일 문서가 아닙니다.'});return;}
    (async()=> {
      try {
        if(!await verifySearchDocument(sender)) {
          sendResponse({ok:false,error:'현재 문서가 실행 중인 조회 화면이 아니어서 새로고침하지 않았습니다.'});return;
        }
        if(typeof fileLog!=='undefined') await fileLog.queue;
        await chrome.tabs.reload(sender.tab.id,{bypassCache:false});
        sendResponse({ok:true});
      } catch(e) {
        sendResponse({ok:false,error:'브라우저 새로고침 처리 실패: '+String(e.message||e).slice(0,200)});
      }
    })();
    return true;
  }
  if(!message) return;
  // A stopped macro needs its own notification: silence there looks identical
  // to a run that is still watching.
  const ALERTS={'wait-registered':{slug:'wait',title:'KTX 예약대기 접수'},'seat-found':{slug:'seat', title:'KTX 잔여석 발견'},'macro-stopped':{slug:'halt', title:'KTX 매크로 정지'},'test-notification':{slug:'test',title:'KTX 알림 테스트'}};
  const alert=ALERTS[message.type];
  let origin;
  try {origin=new URL(sender.url);} catch {}
  if(!alert || sender.id!==chrome.runtime.id || sender.frameId!==0 ||
    !Number.isInteger(sender.tab?.id) || sender.tab.id<0 ||
    origin?.protocol!=='https:' || !['www.korail.com','korail.com'].includes(origin.hostname) ||
    typeof message.message!=='string') return;
  (async()=> {
    const phone=typeof sendPhone==='function'?sendPhone(message.type,message.details):Promise.resolve({ok:true,skipped:true});
    let desktop;
    try {
      const permission=await chrome.notifications.getPermissionLevel();
      if(permission!=='granted') {
        throw new Error('PC 알림 권한이 꺼져 있습니다. Chrome 및 PC 알림 설정에서 허용해주세요.');
      }
      await chrome.notifications.create(`ktx-${alert.slug}-${sender.tab.id}`, {
        type:'basic', iconUrl:chrome.runtime.getURL('icon.png'), title:alert.title,
        message:message.message.slice(0,500), requireInteraction:true, silent:true
      });
      // Creation does not prove that the OS displayed a banner (Focus/DND).
      desktop={ok:true};
    } catch(e) {
      desktop={ok:false,error:e.message?.startsWith('PC 알림 권한')?e.message:'PC 알림 생성에 실패했습니다. 확장 프로그램 권한과 PC의 Chrome 알림 설정을 확인해주세요.'};
    }
    const mobile=await phone;
    const errors=[desktop,mobile].filter(r=>!r.ok).map(r=>r.error);
    sendResponse({ok:!errors.length,error:errors.join(' '),desktop:desktop.ok,mobile:mobile.skipped?'off':mobile.ok?'sent':'failed'});
  })();
  return true;
});
chrome.notifications.onClicked.addListener(id => {
  const tabId=Number(String(id).split('-').pop());
  if(Number.isInteger(tabId)) chrome.tabs.update(tabId,{active:true}).catch(()=>{});
});

if(typeof importScripts==='function') importScripts('phone-background.js');

if(typeof importScripts==='function') importScripts('log-background.js');
if(typeof importScripts==='function') importScripts('holiday-background.js');

if(typeof importScripts==='function') importScripts('power-background.js');
