const {test}=require('node:test');
const assert=require('node:assert/strict');
const {receipt,singlePassenger}=require('../core.js');
const expected={number:'31',date:'2026-09-16(수) 13:00',heading:'서울 → 부산(13:13 ~ 16:33)'};
const now=Date.parse('2026-09-15T12:00:00+09:00');
const body='예약이 완료되었습니다 예약번호 12345-67890 KTX 031 서울 부산 2026.09.16 13:13 총 1명 5호차 12A 결제기한: 2026년 09월 15일 15:20:00 예약취소';
test('one-person receipt with explicit reservation and seat is parsed, deadline uses Korea time',()=>{
  assert.deepEqual(receipt(body,expected,now),{id:'1234567890',seat:'5:12A',due:Date.parse('2026-09-15T15:20:00+09:00')});
});
test('missing, different or ambiguous receipt cannot authorize another reservation',()=>{
  for(const invalid of [
    body.replace('예약번호 12345-67890',''),body.replace('5호차 12A',''),
    body.replace('KTX 031','KTX 145'),body.replace('2026.09.16','2026.09.17'),
    body.replace('총 1명','총 2명'),body.replace('총 1명',''),body.replace('13:13','14:13'),
    body.replace('서울 부산','서울 대구'),body+' 예약번호 11111-22222',body+' 5호차 13B',
    body+' 예약이 취소되었습니다',body.replace('2026.09.16','').replace('09월 15일','09월 16일')
  ]) assert.equal(receipt(invalid,expected,now),null,invalid);
});
test('absent or expired deadline cannot authorize automatic continuation',()=>{
  assert.equal(receipt(body,expected,Date.parse('2026-09-15T16:00:00+09:00')).due,null);
  assert.equal(receipt(body.replace(/결제기한:.*/,''),expected,now).due,null);
});
test('multi-ticket searches require a single passenger',()=>{
  for(const value of ['총 1명','1명','총1명']) assert.equal(singlePassenger(value),true);
  for(const value of ['총 2명','11명','','어른 1명 어린이 1명']) assert.equal(singlePassenger(value),false);
});
