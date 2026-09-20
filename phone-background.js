'use strict';
// Keep the topic out of content scripts and the site, and never sync it.
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function sendPhone(kind) {
  try {
    const {phone}=await chrome.storage.local.get('phone');
    if(!phone?.enabled) return {ok:true,skipped:true};
    if(!/^[A-Za-z0-9_-]{20,80}$/.test(phone.topic||''))return {ok:false,error:'휴대폰 알림 주제 설정을 확인해주세요.'};
    if(!await chrome.permissions.contains({origins:['https://ntfy.sh/*']}))return {ok:false,error:'ntfy.sh 연결 권한이 없습니다. 휴대폰 알림 설정에서 다시 저장해주세요.'};
    const messages={
      'wait-registered':['KTX 예약대기 접수','예약대기를 신청했습니다. 좌석 확보는 아직 아닙니다. 코레일에서 배정 여부와 결제 기한을 확인해주세요.'],
      'seat-found':['KTX 좌석 알림','좌석을 발견했거나 예매 화면이 변경되었습니다. PC에서 예약 상태와 결제 기한을 확인해주세요.'],
      'macro-stopped':['KTX 감시 중지','자동 감시가 중지되었습니다. PC에서 안내를 확인해주세요.'],
      'test-notification':['KTX 연결 테스트','휴대폰 알림이 연결되었습니다.'],
      'test-phone-notification':['KTX 연결 테스트','휴대폰 알림이 연결되었습니다.']
    };
    if(!messages[kind])return {ok:false,error:'지원하지 않는 알림입니다.'};
    const [title,message]=messages[kind];
    const response=await fetch('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic:phone.topic,title,message,priority:4,tags:['train']}),
      credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return {ok:false,error:`휴대폰 알림 전송 실패 (HTTP ${response.status}). 알림 설정을 확인해주세요.`};
    return {ok:true};
  } catch {return {ok:false,error:'휴대폰 알림 전송에 실패했습니다. 네트워크와 ntfy 설정을 확인해주세요.'};}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message?.type==='open-phone-settings' && sender.frameId===0 && ticketDocument(sender.url)) {
    chrome.runtime.openOptionsPage().then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
  }
  if(message?.type==='test-phone-notification' && sender.url===chrome.runtime.getURL('phone.html')) {
    sendPhone(message.type).then(result=>reply(result.skipped?{ok:false,error:'휴대폰 알림 사용을 켜고 먼저 저장해주세요.'}:result));return true;
  }
});
