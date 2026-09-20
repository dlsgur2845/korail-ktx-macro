'use strict';
const $=id=>document.getElementById(id), origin={origins:['https://ntfy.sh/*']};
const say=text=>{$('status').textContent=text;};
const valid=topic=>/^[A-Za-z0-9_-]{20,80}$/.test(topic);
(async()=>{
  const {phone}=await chrome.storage.local.get('phone');
  $('topic').value=phone?.topic||'ktx-'+crypto.randomUUID().replaceAll('-','');
  $('enabled').checked=!!phone?.enabled;
  say(phone?.enabled?'휴대폰 알림 사용 중 · 아이폰 구독 후 테스트해주세요.':'아직 연결하지 않았습니다. 아이폰에서 구독 후 사용을 켜고 저장해주세요.');
})().catch(()=>say('설정을 불러오지 못했습니다. 확장 프로그램을 다시 로드해주세요.'));
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('topic').value);say('주제 이름을 복사했습니다. 아이폰 ntfy 앱에 붙여넣으세요.');}catch{say('복사할 수 없습니다. 주제 이름을 직접 선택해 복사해주세요.');}};
$('save').onclick=async()=>{
  const topic=$('topic').value.trim(),enabled=$('enabled').checked;
  if(!valid(topic))return say('주제 이름은 영문·숫자·하이픈·밑줄 20~80자로 입력해주세요.');
  $('save').disabled=true;
  try {
    // Request immediately inside the user's click; never during automatic runs.
    if(enabled && !await chrome.permissions.request(origin)) return say('ntfy.sh 연결 권한이 허용되지 않아 켜지 않았습니다.');
    await chrome.storage.local.set({phone:{enabled,topic}});
    say(enabled?'저장했습니다. 이제 테스트 알림을 보내 아이폰 수신을 확인하세요.':'휴대폰 알림을 껐습니다.');
  }catch{say('저장에 실패했습니다. 확장 프로그램을 다시 로드해주세요.');}
  finally{$('save').disabled=false;}
};
$('test').onclick=async()=>{
  $('test').disabled=true;say('테스트 알림 전송 중…');
  try {
    const result=await chrome.runtime.sendMessage({type:'test-phone-notification'});
    say(result?.ok?'ntfy 서버 전송 완료 · 아이폰에서 테스트 알림을 확인해주세요.':result?.error||'전송 결과를 확인하지 못했습니다.');
  }catch{say('전송에 실패했습니다. 확장 프로그램 연결을 확인해주세요.');}
  finally{$('test').disabled=false;}
};
