'use strict';
// Keep the topic out of content scripts and the site, and never sync it.
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function sendPhone(kind,details) {
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
    let [title,message]=messages[kind];
    if(details && typeof details==='object' && !kind.startsWith('test-')) {
      const outcomes={wait:['KTX 예약대기 접수','예약대기 1명 접수. 코레일에서 배정 여부를 확인해주세요.'],reserved:['KTX 예약 완료 안내','예약 완료 문구를 확인했습니다. 예약 내역과 결제 기한을 확인하고 직접 결제해주세요.'],found:['KTX 좌석 발견','좌석을 발견했습니다. 알림 전용 모드이므로 직접 예매해주세요.'],check:['KTX 예약 결과 확인 필요','예약 화면이 변경됐습니다. 접수 여부와 결제 기한을 코레일에서 확인해주세요.'],stopped:['KTX 자동 감시 중지','자동 감시를 멈췄습니다. PC에서 확인 후 다시 시작해주세요.']};
      const permitted=kind==='wait-registered'?['wait']:kind==='macro-stopped'?['stopped']:['reserved','found','check'];
      const result=permitted.includes(details.result)?outcomes[details.result]:null;
      if(result) {
        title=result[0];const lines=[result[1]];
        if(typeof details.number==='string' && /^\d{1,4}$/.test(details.number)) lines.push('열차: KTX '+details.number.padStart(3,'0'));
        const station=v=>typeof v==='string' && /^[가-힣a-zA-Z ()·-]{1,30}$/.test(v)?v:'';
        if(station(details.from)&&station(details.to)) lines.push('구간: '+details.from+' → '+details.to);
        const date=typeof details.date==='string'?details.date.match(/20\d{2}-\d{2}-\d{2}/)?.[0]:null;
        if(date) lines.push('출발일: '+date);
        if(typeof details.time==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(details.time)) lines.push('출발시각: '+details.time);
        const seats={gen:'일반실',spe:'특실',either:'일반실 우선 · 특실 허용'};
        if(seats[details.seat]) lines.push('좌석: '+seats[details.seat]+' · 1명');
        if(Number.isInteger(details.attempt)&&details.attempt>0) lines.push('재시도: '+Math.min(details.attempt,999999)+'회');
        const reasons=['로그인이 필요합니다.','클릭 또는 버튼 상태를 확인하지 못했습니다.','인증 또는 접근 제한 안내가 표시됐습니다.','열차 조회를 진행하지 못했습니다.','신청 결과 또는 응답을 확인하지 못했습니다.','진행을 멈췄습니다. PC에서 상세 안내를 확인해주세요.'];
        if(kind==='macro-stopped' && (reasons.includes(details.reason)||/^HTTP \d{3} 응답 오류$/.test(details.reason||''))) lines.push('사유: '+details.reason);
        message=lines.join('\n');
      }
    }
    const response=await fetch('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic:phone.topic,title,message,priority:4}),
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
