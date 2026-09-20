const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
test('wait fare requires both exact token and waiting label, and respects fare column',()=>{
 assert.equal(C.waitOpen('price_box wait','예약대기','gen',0),true);
 assert.equal(C.waitOpen('price_box wait','예약대기','spe',0),false);
 assert.equal(C.waitOpen('price_box wait','예약대기','spe',1),true);
 assert.equal(C.waitOpen('price_box yms_wait','입석 + 좌석 예약대기','gen',0),true);
 for(const cls of ['price_box sold_out_wait','price_box sold_out','price_box gen']) assert.equal(C.waitOpen(cls,'예약대기','gen',0),false);
 assert.equal(C.waitOpen('price_box wait','매진','gen',0),false);
});
test('wait completion requires explicit registration success or status with reservation ID',()=>{
 for(const body of ['예약대기 신청이 완료되었습니다.','예약대기 접수가 되었습니다.','예약 상태: 예약대기 예약번호 123456789']) assert.equal(C.waitComplete(body),true,body);
 for(const body of ['예약이 완료되었습니다.','예약대기 신청','예약대기 신청이 실패했습니다.','이미 예약대기 신청 완료','예약 상태: 예약대기','예약대기 신청 완료 후 확인해주세요']) assert.equal(C.waitComplete(body),false,body);
});
