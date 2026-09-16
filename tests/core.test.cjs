const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
const config={from:'서울',to:'부산',start:'13:00',end:'14:00',numbers:'037, 105'};
const row={type:'KTX',number:' 105 ',heading:'서울 → 부산(13:13 ~ 16:33)'};
test('현재 카드의 구간·시간·열차 번호 일치',()=>assert.equal(C.matches(row,config),true));
test('번호 앞 0 정규화',()=>assert.equal(C.matches({...row,number:'37'},config),true));
test('다른 열차·구간·시간 제외',()=>{
 for(const change of [{type:'ITX-새마을'},{number:'039'},{heading:'용산 → 부산(13:13 ~ 16:33)'},{heading:'서울 → 부산(14:01 ~ 16:33)'}]) assert.equal(C.matches({...row,...change},config),false);
});
test('일반실과 매진임박 특실은 구매 가능한 가격이 필요',()=>{
 assert.equal(C.available('일반실','48,000원','gen'),true);
 assert.equal(C.available('특실(매진임박)','70,000원','spe'),true);
 assert.equal(C.available('일반실','','gen'),false);
});
test('매진·입석·예약대기를 잔여석으로 오인하지 않음',()=>{
 for(const label of ['매진','입석 + 좌석','예약대기','특실']) assert.equal(C.available(label,'48,000원','gen'),false);
});
test('깨진 시간·카드는 제외',()=>{
 assert.ok(Number.isNaN(C.minutes('24:00')));
 assert.ok(Number.isNaN(C.minutes('12:60')));
 assert.equal(C.matches({...row,heading:'화면 구조 변경'},config),false);
});
test('번호 미지정 시 모든 KTX 종류 허용',()=>assert.equal(C.matches({...row,type:'KTX-산천',number:'999'},{...config,numbers:''}),true));
test('응답이 빠르면 최소 대기, 느리면 대기 증가',()=>{
 assert.equal(C.retryDelay(3000,800),3000);
 assert.equal(C.retryDelay(3000,4000),8000);
 assert.equal(C.retryDelay(3000,30000),30000);
});
test('오류 재시도는 지수 백오프 및 상한 적용',()=>{
 assert.equal(C.retryDelay(3000,1000,1),30000);
 assert.equal(C.retryDelay(3000,1000,2),60000);
 assert.equal(C.retryDelay(3000,1000,8),300000);
});
test('안정된 목록이어도 대기열·로딩·차단이 우선',()=>{
 const ready={hasRows:true,stableMs:1000};
 assert.equal(C.readiness(ready),'ready');
 assert.equal(C.readiness({...ready,stableMs:500}),'loading');
 assert.equal(C.readiness({...ready,loading:true}),'loading');
 assert.equal(C.readiness({...ready,queued:true}),'queued');
 assert.equal(C.readiness({...ready,queued:true,blocked:true}),'blocked');
 assert.equal(C.readiness({...ready,hasRows:false}),'empty');
});
test('한 개 지정 시 다른 열차는 제외',()=>{
 assert.equal(C.matches(row,{...config,numbers:'105'}),true);
 assert.equal(C.matches({...row,number:'037'},{...config,numbers:'105'}),false);
});
test('여러 개 지정 시 선택한 어느 번호든 허용',()=>{
 for(const number of ['031','033','105']) assert.equal(C.matches({...row,number},{...config,numbers:'031, 033, 105'}),true);
 assert.equal(C.matches({...row,number:'037'},{...config,numbers:'031, 033, 105'}),false);
});
test('입석+좌석만 정확하게 구분',()=>{
 for(const label of ['입석 + 좌석','입석+좌석','입석  +  좌석']) assert.equal(C.combinedStanding(label),true);
 for(const label of ['입석','매진','예약대기','입석 + 좌석 매진']) assert.equal(C.combinedStanding(label),false);
});
