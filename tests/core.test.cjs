// Pure-logic checks for core.js. The notice texts and seat-cell class names
// below are taken from Korail's own bundle, so the classifiers are checked
// against what the site actually renders.
'use strict';
const C = require('../core.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}

// ---- dialogKind: real notice texts from the reservation flow ----------------
const kind = (title, body) => C.dialogKind(title, body);

eq(kind('이용안내', '서대구, 구포 정차하는 열차입니다. 도착시간을 확인하시기 바랍니다. 확인'), 'info', 'stop notice');
eq(kind('이용안내', '선택하신 열차는 ITX-마음 2개 편성을 연결하여 운행하는 열차로서, 반드시 열차번호와 해당호차를 확인하시고 승차하시기 바랍니다.'), 'info', 'consist notice');
eq(kind('이용안내', '이 열차는 고속철도 통합 교차운행 시범열차로 KTX 운임이 약 10% 할인 적용 되었습니다.'), 'info', 'discount notice');
eq(kind('이용안내', '선택하신 열차는 출발역은 동대구역이고 도착역은 서울역입니다.'), 'info', 'adjacent station notice');
eq(kind('안내메세지', '결제기한: 2026년 09월 20일 15:20:00'), 'info', 'payment deadline notice');

eq(kind('지연승낙 안내', '선택하신 열차는 지연 열차입니다. 열차운행 사항을 확인하시고 구입하시기 바랍니다. 승차권 구입 시 열차지연에 따른 지연배상을 하지 않습니다. 계속 진행하시겠습니까?'), 'delay', 'delay consent');
eq(kind('이용안내', '선택하신 날짜는 2026년 09월 20일 입니다. * 구입 후 10분 이내 환불 시 위약금이 발생하지 않습니다.'), 'group', 'group penalty notice');
eq(kind('이용안내', '동대구 우회하는 열차입니다. 도착시간을 확인하시기 바랍니다.'), 'detour', 'detour notice beats info');
eq(kind('이용안내', '좌석이 선택 되지 않았습니다. 자동으로 좌석을 배정 받으시고 예약 진행 하시겠습니까?'), 'seat-auto', 'auto seat assignment');

eq(kind('이용안내', '좌석선택 또는 열차예매를 선택해주세요.'), 'seatmap-choice', 'addConfirm choice');
eq(kind('이용안내', '열차예매를 진행합니다.'), 'seatmap-choice', 'confirm choice');

eq(kind('이용안내', '출발역은 동대구역이고 도착역은 서울역입니다. SRT열차는 SRT홈페이지에서 예매가 가능합니다. SR홈페이지로 이동하시겠습니까?'), 'srt', 'SRT hand-off outranks info');
eq(kind('안내메세지', '로그인 해주시길 바랍니다.'), 'login', 'login required');
eq(kind('안내 메세지', '좌석을 선택해 주세요.'), 'fail', 'nothing selected');
eq(kind('안내메세지', '잔여석이 없습니다.'), 'sold-out', 'sold out');
eq(kind('이용안내', '처음 보는 안내 문구입니다.'), 'unknown', 'unrecognised notice stays unknown');
eq(kind('', ''), 'unknown', 'empty dialog stays unknown');

// ---- dialogPlan: only harmless notices are answered by default -------------
eq(C.dialogPlan('info', {}).act, true, 'info auto by default');
eq(C.dialogPlan('info', {autoNotice: false}).act, false, 'info respects opt-out');
eq(C.dialogPlan('seatmap-choice', {}).confirm, ['열차예매'], 'choice picks 열차예매');
eq(C.dialogPlan('delay', {}).act, false, 'delay needs opt-in');
eq(C.dialogPlan('delay', {allowDelay: true}).act, true, 'delay opt-in honoured');
eq(C.dialogPlan('detour', {allowDetour: true}).act, true, 'detour opt-in honoured');
eq(C.dialogPlan('group', {allowGroup: true}).act, true, 'group opt-in honoured');
eq(C.dialogPlan('seat-auto', {allowSeatAuto: true}).act, true, 'seat-auto opt-in honoured');
eq(C.dialogPlan('delay', {allowDetour: true}).act, false, 'opt-ins do not leak across kinds');
eq(C.dialogPlan('unknown', {}).act, false, 'unknown never auto-answered');
eq(C.dialogPlan('srt', {}).act, false, 'SRT never auto-answered');
eq(C.dialogPlan('login', {}).act, false, 'login never auto-answered');
eq(C.dialogPlan('fail', {}).act, false, 'failure never auto-answered');

// ---- seat cell tokens: the site puts the ticketType in the cell class ------
const open = (cls, k) => C.seatOpen(C.seatTokens(cls), k);
const standing = cls => C.standingOpen(C.seatTokens(cls));

eq(open('price_box fl-l  gen ', 'gen'), true, 'general seat bookable');
eq(open('price_box fl-l  gen ', 'spe'), false, 'general cell is not a first-class cell');
eq(open('price_box fl-l active gen', 'gen'), true, 'selected general seat still bookable');
eq(open('price_box fl-l  spe  sold_out_soon', 'spe'), true, 'almost sold out is still bookable');
eq(open('price_box fl-l  sold_out ', 'gen'), false, 'sold out not bookable');
eq(open('price_box fl-l  lack_seat ', 'gen'), false, 'not enough seats not bookable');
eq(open('price_box fl-l  no-data ', 'gen'), false, 'no-data not bookable');
eq(open('price_box fl-l  wait ', 'gen'), false, 'reservation-waiting not bookable');
eq(open('price_box fl-l  sold_out_seat ', 'gen'), false, 'standing-only cell not a seat');

eq(standing('price_box fl-l  yms '), true, 'standing+seat bookable');
eq(standing('price_box fl-l  yms_wait '), false, 'yms_wait must not match yms');
eq(standing('price_box fl-l  yms_sold_out '), false, 'yms_sold_out must not match yms');
eq(standing('price_box fl-l  gen '), false, 'plain seat is not standing+seat');
eq(open('price_box fl-l  yms_sold_out ', 'gen'), false, 'yms_sold_out is not a general seat');

// ---- readiness: an empty list is not proof that no trains run --------------
const ready = o => C.readiness(Object.assign({blocked: false, queued: false, loading: false, transientError: false, emptyResult: false, hasRows: false, stableMs: 5000}, o));
eq(ready({emptyResult: true}), 'empty-result', 'empty list reported as empty-result');
eq(ready({hasRows: true}), 'ready', 'stable rows are ready');
eq(ready({hasRows: true, stableMs: 100}), 'loading', 'unstable rows still loading');
eq(ready({hasRows: true, stableMs: 320}), 'ready', 'rows are read after a short settle');
eq(ready({hasRows: true, emptyResult: true}), 'ready', 'rows win over a stale empty notice');
eq(ready({blocked: true, hasRows: true}), 'blocked', 'blocked outranks rows');
eq(ready({queued: true, emptyResult: true}), 'queued', 'queue outranks empty');
eq(ready({transientError: true}), 'transient-error', 'query error detected');
eq(ready({}), 'empty', 'no rows and no notice is plain empty');

// ---- pacing ----------------------------------------------------------------
eq(C.retryDelay(1000, 0), 3000, 'cooldown floor raised to 3s');
eq(C.retryDelay(5000, 0), 5000, 'configured cooldown kept');
eq(C.recoveryDelay(1), 5000, 'first retry after 5s');
eq(C.recoveryDelay(2), 10000, 'second retry after 10s');
eq(C.recoveryDelay(4), 40000, 'fourth retry after 40s');
eq(C.recoveryDelay(6), 60000, 'retry delay capped at 60s');

// Adaptive interval: fast while the site answers, slower as it refuses.
eq(C.pollDelay(3000, 0), 3000, 'healthy session polls at the configured rate');
eq(C.pollDelay(3000, 1), 6000, 'one refusal doubles the gap');
eq(C.pollDelay(3000, 2), 12000, 'two refusals quadruple the gap');
eq(C.pollDelay(3000, 3), 24000, 'three refusals reach 24s');
eq(C.pollDelay(3000, 5), 48000, 'level is capped, so a 3s base tops out at 48s');
eq(C.pollDelay(8000, 4), 60000, 'a longer base still stops at the 60s ceiling');
eq(C.pollDelay(0, 0), 0, 'a zero cooldown re-queries immediately');
eq(C.pollDelay(0, 1), 2000, 'a zero cooldown still backs off once refused');
eq(C.pollDelay(0, 3), 8000, 'the backoff ladder works from a zero base');
eq(C.pollDelay(1000, 0), 1000, 'a 1s base is kept');
eq(C.pollDelay(1000, 2), 4000, 'a 1s base backs off to 4s at level 2');
eq(C.pollDelay(-5, 0), 0, 'a negative base is treated as zero');
eq(C.pollDelay(30000, 2), 60000, 'long configured gap still capped at 60s');
eq(C.pollDelay(3000, -3), 3000, 'negative throttle treated as healthy');
eq(C.pollDelay(3000), 3000, 'missing throttle treated as healthy');

eq(C.nextPace({level: 0, streak: 0}, true), {level: 1, streak: 0}, 'refusal costs a level');
eq(C.nextPace({level: 3, streak: 0}, true), {level: 4, streak: 0}, 'repeated refusal keeps climbing');
eq(C.nextPace({level: 4, streak: 0}, true), {level: 4, streak: 0}, 'level stops at the cap');
eq(C.nextPace({level: 2, streak: 0}, false), {level: 1, streak: 0}, 'a clean query wins a level back');
eq(C.nextPace({level: 0, streak: 0}, false), {level: 0, streak: 0}, 'level never goes below zero');
eq(C.nextPace(undefined, true), {level: 1, streak: 0}, 'missing pace starts from zero');
eq(C.nextPace(undefined, false), {level: 0, streak: 0}, 'missing pace stays at full speed');
eq(C.nextPace({level: 99, streak: -5}, true), {level: 4, streak: 0}, 'out-of-range pace is clamped');

eq(C.pollDelay(3000, 0), 3000, 'level 0 runs at the configured rate');
eq(C.pollDelay(3000, 1), 6000, 'level 1 doubles');
eq(C.pollDelay(3000, 2), 12000, 'level 2 quadruples');
eq(C.pollDelay(3000, 4), 48000, 'level 4 is the slowest step at a 3s base');
eq(C.pollDelay(3000, 9), 48000, 'level cannot exceed the cap');

// The interval has to degrade gracefully, not collapse. A watch that backs off
// to a minute at a moderate refusal rate would miss the seat it is waiting for.
function settle(rate, seed) {
  let pace = {level: 0, streak: 0}, rnd = seed, levels = [];
  const next = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 4000; i++) { pace = C.nextPace(pace, next() < rate); levels.push(pace.level); }
  const tail = levels.slice(-1200);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
eq(settle(0, 7) === 0, true, 'a clean session never slows down');
eq(settle(0.3, 7) < 2.2, true, `a 30% refusal rate stays under level 2.2 (got ${settle(0.3, 7).toFixed(2)})`);
eq(settle(0.5, 7) < 3.2, true, `a 50% refusal rate stays under level 3.2 (got ${settle(0.5, 7).toFixed(2)})`);
eq(settle(0.9, 7) > 2.5, true, `a 90% refusal rate does back well off (got ${settle(0.9, 7).toFixed(2)})`);

// ---- existing behaviour must not regress -----------------------------------
eq(C.parseHeading('동대구 → 서울 (15:04~16:47)'), {from: '동대구', to: '서울', time: '15:04'}, 'heading parsed');
eq(C.number(' 031 '), '31', 'train number normalised');
eq(C.available('일반실', '43,500원', 'gen'), true, 'label fallback still works');
eq(C.available('매진', '43,500원', 'gen'), false, 'sold out label rejected');
eq(C.combinedStanding('입석 + 좌석'), true, 'standing label still works');
eq(C.matches({heading: '동대구 → 서울 (15:04~16:47)', type: 'KTX-산천', number: '031'}, {from: '동대구', to: '서울', matchMode: 'trains', numbers: '031'}), true, 'train-number match');
eq(C.matches({heading: '동대구 → 서울 (15:04~16:47)', type: 'KTX', number: '031'}, {from: '동대구', to: '서울', matchMode: 'time', start: '15:00', end: '16:00'}), true, 'time-window match');
eq(C.matches({heading: '동대구 → 서울 (15:04~16:47)', type: 'ITX-새마을', number: '031'}, {from: '동대구', to: '서울', matchMode: 'time', start: '15:00', end: '16:00'}), false, 'non-KTX rejected');
eq(C.matches({heading: '대전 → 서울 (15:04~16:47)', type: 'KTX', number: '031'}, {from: '동대구', to: '서울', matchMode: 'time', start: '15:00', end: '16:00'}), false, 'adjacent-station train rejected');

// '서울·용산 - 수서 함께 보기' and '인접역 보기' put trains in the list whose
// stations differ from the search fields. A hand-picked train number must still
// be findable; a time window must not silently switch destination.
const SUSEO = {heading: '밀양 → 수서(07:54 ~ 10:17)', type: 'KTX-산천', number: '310'};
const SEOUL = {heading: '밀양 → 서울(07:17 ~ 09:52)', type: 'KTX-산천', number: '204'};
const trainsCfg = n => ({from: '밀양', to: '서울', matchMode: 'trains', numbers: n});
eq(C.matches(SUSEO, trainsCfg('310')), true, 'a chosen 수서 train matches in train-number mode');
eq(C.matches(SEOUL, trainsCfg('204')), true, 'a chosen 서울 train still matches');
eq(C.matches(SUSEO, trainsCfg('204')), false, 'a train that was not chosen is ignored');
eq(C.matches({heading: '밀양 → 수서(07:54 ~ 10:17)', type: 'ITX-새마을', number: '310'}, trainsCfg('310')), false, 'non-KTX is still rejected in train-number mode');
eq(C.matches(SUSEO, {from: '밀양', to: '서울', matchMode: 'time', start: '07:00', end: '11:00'}), false, 'time mode still refuses a different destination');
eq(C.matches(SEOUL, {from: '밀양', to: '서울', matchMode: 'time', start: '07:00', end: '11:00'}), true, 'time mode accepts the searched destination');
eq(C.matches(SEOUL, {from: '밀양', to: '서울', matchMode: 'trains', numbers: ''}), false, 'no chosen train matches nothing');

// ---- the occasional longer pause -------------------------------------------
eq(C.restDelay(1, 20, 8000), 0, 'an ordinary check is not a rest');
eq(C.restDelay(19, 20, 8000), 0, 'the check before the rest is ordinary');
eq(C.restDelay(20, 20, 8000), 8000, 'every 20th check rests');
eq(C.restDelay(40, 20, 8000), 8000, 'and the one after that');
eq(C.restDelay(21, 20, 8000), 0, 'the rest does not stick');
eq(C.restDelay(0, 20, 8000), 0, 'nothing rests before the first check');
eq(C.restDelay(20, 0, 8000), 0, 'a zero period turns the rest off');
eq(C.restDelay(20, 20, 0), 0, 'a zero pause turns the rest off');
eq(C.restDelay(20, -5, 8000), 0, 'a negative period turns the rest off');
eq(C.restDelay(undefined, 20, 8000), 0, 'a missing count never rests');
// Over 100 checks at 20/8s the rest adds 40s, so the average stays close to the
// configured rate rather than dominating it.
eq([...Array(100)].reduce((sum, _, i) => sum + C.restDelay(i + 1, 20, 8000), 0), 40000, 'five rests in a hundred checks');

// ---- carried over from the 1.1.4 suite -------------------------------------
eq(C.available('특실(매진임박)', '70,000원', 'spe'), true, 'almost sold out first class is bookable');
eq(C.available('일반실', '', 'gen'), false, 'a seat with no price is not bookable');
for (const label of ['매진', '입석 + 좌석', '예약대기', '특실']) {
  eq(C.available(label, '48,000원', 'gen'), false, `${label} is not a general seat`);
}
eq(Number.isNaN(C.minutes('24:00')), true, 'hour 24 is not a time');
eq(Number.isNaN(C.minutes('12:60')), true, 'minute 60 is not a time');
eq(Number.isNaN(C.minutes('')), true, 'empty is not a time');
eq(C.minutes('13:13'), 793, 'a valid time converts to minutes');
eq(C.parseHeading('화면 구조 변경'), null, 'an unparseable heading yields nothing');
eq(C.matches({heading: '화면 구조 변경', type: 'KTX', number: '031'}, {from: '서울', to: '부산', matchMode: 'trains', numbers: '031'}), false, 'an unparseable heading never matches');
for (const label of ['입석 + 좌석', '입석+좌석', '입석  +  좌석']) {
  eq(C.combinedStanding(label), true, `${label} is standing plus seat`);
}
for (const label of ['입석', '매진', '예약대기', '입석 + 좌석 매진']) {
  eq(C.combinedStanding(label), false, `${label} is not standing plus seat`);
}
eq(C.number('37'), '37', 'a bare number is kept');
eq(C.number('037'), '37', 'a leading zero is normalised');
eq(C.number('abc'), '', 'a non-number yields nothing');
eq(C.retryDelay(3000, 1000, 1), 30000, 'one error doubles from the 15s floor');
eq(C.retryDelay(3000, 1000, 2), 60000, 'two errors double again');
eq(C.retryDelay(3000, 1000, 8), 300000, 'the error backoff is capped at 5 minutes');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
