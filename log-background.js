'use strict';
importScripts('log-store.js');
const fileLog=new KtxFileLog(()=>navigator.storage.getDirectory());
const logPage=chrome.runtime.getURL('logs.html');
function logSender(sender) {
  try {const u=new URL(sender.url);return sender.id===chrome.runtime.id && sender.frameId===0 && Number.isInteger(sender.tab?.id) && u.protocol==='https:' && ['korail.com','www.korail.com'].includes(u.hostname) && u.pathname.startsWith('/ticket/');}catch{return false;}
}
function cleanLogEvent(event,sender) {
  if(!event || typeof event.step!=='string' || !/^[a-z-]{1,60}$/.test(event.step)) throw new Error('잘못된 기록 형식');
  const result={at:new Date().toISOString(),tab:sender.tab.id,step:event.step};
  if(typeof event.at==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at)) result.eventAt=event.at;
  // Bounded diagnostics only: no cookies, request bodies or whole-page capture.
  const keys=['version','phase','kind','number','via','tag','method','observed','isTrusted','defaultPrevented','httpStatus','durationMs','reason','attempt','waitMs','batch','rows','count','target','error','runId','documentId','sequence','phaseElapsedMs','seatKind','trainNumber','requestSeen','page','readyState','loading','rowCount','dialogKind','dialogTitle','dialogBody','dialogActions','lastQueryStatus','responseError','snapshotError','label','note','connected','enabled','targetRect','viewport','hitTag','coveredByPanel','hitMatches','action','inputStage','outcome','errorName','codeLocations','backendStage','errorDetail','cooldownMs','restEvery','restSeconds','matchMode'];
  for(const key of keys) {
    const value=event[key];
    if(typeof value==='string') result[key]=value.replace(/(?:https?|chrome-extension):\/\/\S+/g,'[URL]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]')
      .replace(/\b0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}\b/g,'[PHONE]')
      .replace(/(예약\s*번호\s*[:：]?\s*)[\d -]{6,}/g,'$1[REDACTED]')
      .slice(0,['error','errorDetail','reason','dialogBody','codeLocations'].includes(key)?1200:200);
    else if(typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value)) || value===null) result[key]=value;
  }
  return result;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type==='append-holiday-log') {
    let allowed=false;try{const u=new URL(sender.url);allowed=sender.id===chrome.runtime.id&&sender.frameId===0&&Number.isInteger(sender.tab?.id)&&u.protocol==='https:'&&(u.hostname==='korail.com'||u.hostname.endsWith('.korail.com'));}catch{}
    if(!allowed||!message.event?.step?.startsWith('holiday-')){reply({ok:false});return;}
    let event;try{event=cleanLogEvent(message.event,sender);}catch{reply({ok:false});return;}
    fileLog.append(event).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
  }
  if(message?.type==='append-file-log') {
    if(!logSender(sender)) {reply({ok:false,error:'로그 발신자 확인 실패'});return;}
    let event;try{event=cleanLogEvent(message.event,sender);}catch{reply({ok:false,error:'잘못된 기록 형식'});return;}
    fileLog.append(event).then(()=>reply({ok:true}),()=>reply({ok:false,error:'로그 파일 저장 실패. 저장 공간과 확장 프로그램 상태를 확인해주세요.'}));return true;
  }
  if(message?.type==='open-file-logs' && logSender(sender)) {chrome.tabs.create({url:logPage});return;}
  if(message?.type==='delete-file-log') {
    if(sender.id!==chrome.runtime.id || sender.url!==logPage || sender.frameId!==0) {reply({ok:false,error:'허용되지 않은 로그 삭제 요청'});return;}
    fileLog.deleteFile(message.name).then(()=>reply({ok:true}),error=>reply({ok:false,error:error.name==='NotFoundError'?'파일이 변경되었습니다. 목록을 새로고침해주세요.':error.message||'로그 삭제 실패'}));return true;
  }
  if(message?.type==='list-file-logs' && sender.id===chrome.runtime.id && sender.url===logPage) {
    fileLog.list().then(files=>reply({ok:true,files}),()=>reply({ok:false,error:'로그 파일을 읽지 못했습니다.'}));return true;
  }
});
// Rotate old files even when no train search is running; catch up on next startup.
chrome.alarms.create('rotate-file-logs',{periodInMinutes:60});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='rotate-file-logs') fileLog.maintain().catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>fileLog.maintain().catch(()=>{}));
