(() => {
  'use strict';
  const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='korail.com'||u.hostname.endsWith('.korail.com'));}catch{return false;}};
  function sample(date,age,start,end) {
    const epoch=Date.parse(date),rtt=end-start;
    if(!date || !Number.isFinite(epoch) || !Number.isFinite(rtt) || rtt<0 || rtt>3000 || (age!==null && (!Number.isFinite(Number(age)) || Number(age)!==0))) throw new Error('신선한 서버 시각 응답을 확인하지 못했습니다.');
    // Date is an approximate, whole-second HTTP timestamp. Do not subtract
    // half the RTT from the firing time: asymmetric latency can cause an early click.
    return {epoch,at:end,rtt,low:epoch-1000,high:epoch+1000+rtt};
  }
  function bounds(s,now) {
    const elapsed=now-s.at;
    if(elapsed<0 || elapsed>15000) throw new Error('서버 시각 측정이 만료되었습니다.');
    const drift=elapsed*.001;
    return {low:s.low+elapsed-drift,high:s.high+elapsed+drift};
  }
  function parseTarget(value) {
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('시작 날짜와 한국 시각을 입력해주세요.');
    const epoch=Date.parse(value+'+09:00');
    if(!Number.isFinite(epoch) || new Date(epoch+9*3600000).toISOString().slice(0,value.length)!==value) throw new Error('올바른 날짜와 시각을 입력해주세요.');
    return epoch;
  }
  function ready(s,now,target) {return bounds(s,now).low>=target;}
  globalThis.KtxHolidayCore={allowed,sample,bounds,parseTarget,ready};
})();
