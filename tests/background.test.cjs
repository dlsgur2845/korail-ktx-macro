// Loads background.js against a stubbed chrome API and checks both the
// notification routing and the sender checks on the tab-reload message.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
}
const tick = () => new Promise(r => setImmediate(r));

const EXT_ID = 'test-extension-id';
function load() {
  const calls = {notifications: [], reloads: [], updates: []};
  let onMessage = null, onClicked = null;
  const chrome = {
    runtime: {id: EXT_ID, onMessage: {addListener: fn => { onMessage = fn; }}},
    notifications: {
      create: (id, options) => calls.notifications.push({id, options}),
      onClicked: {addListener: fn => { onClicked = fn; }}
    },
    tabs: {
      reload: (id, options) => { calls.reloads.push({id, options}); return Promise.resolve(); },
      update: (id, options) => { calls.updates.push({id, options}); return Promise.resolve(); }
    }
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  new Function('chrome', src)(chrome);
  return {calls, send: (...a) => onMessage(...a), click: id => onClicked(id)};
}
const senderOn = (url, over = {}) => Object.assign({id: EXT_ID, url, tab: {id: 42}, frameId: 0}, over);
const LIST = 'https://www.korail.com/ticket/search/list';

// ---- notifications ---------------------------------------------------------
{
  const {calls, send} = load();
  send({type: 'seat-found', message: '좌석 발견: KTX 031'}, senderOn(LIST), () => {});
  eq(calls.notifications.length, 1, 'seat-found raises one notification');
  eq(calls.notifications[0].id, 'ktx-seat-42', 'seat notification id carries the tab');
  eq(calls.notifications[0].options.title, 'KTX 잔여석 발견', 'seat notification title');
  eq(calls.notifications[0].options.requireInteraction, true, 'seat notification persists');
}
{
  const {calls, send} = load();
  send({type: 'macro-stopped', message: '반복 재조회로도 목록을 받지 못해 중지했습니다.'}, senderOn(LIST), () => {});
  eq(calls.notifications.length, 1, 'macro-stopped raises one notification');
  eq(calls.notifications[0].id, 'ktx-halt-42', 'halt notification id carries the tab');
  eq(calls.notifications[0].options.title, 'KTX 매크로 정지', 'halt notification title');
  eq(calls.notifications[0].options.message, '반복 재조회로도 목록을 받지 못해 중지했습니다.', 'halt message passed through');
}
{
  const {calls, send} = load();
  send({type: 'seat-found', message: 'x'.repeat(900)}, senderOn(LIST), () => {});
  eq(calls.notifications[0].options.message.length, 500, 'long message truncated to 500');
}
{
  const {calls, send} = load();
  send({type: 'something-else', message: 'hi'}, senderOn(LIST), () => {});
  send({type: 'seat-found', message: 'hi'}, {id: EXT_ID, url: LIST, frameId: 0}, () => {});
  send({type: 'seat-found', message: {not: 'a string'}}, senderOn(LIST), () => {});
  send(null, senderOn(LIST), () => {});
  eq(calls.notifications.length, 0, 'unknown type, missing tab, non-string and null are ignored');
}

// ---- notification click focuses the originating tab ------------------------
{
  const {calls, click} = load();
  click('ktx-seat-7');
  click('ktx-halt-42');
  eq(calls.updates, [{id: 7, options: {active: true}}, {id: 42, options: {active: true}}], 'both notification kinds focus their tab');
}
{
  const {calls, click} = load();
  click('unrelated-notification');
  eq(calls.updates.length, 0, 'unrelated notification id is ignored');
}

// ---- tab reload: only the sending Korail search tab ------------------------
async function reload(url, over) {
  const {calls, send} = load();
  let reply = null;
  send({type: 'reload-search-tab'}, senderOn(url, over), r => { reply = r; });
  await tick();
  return {calls, reply};
}
(async () => {
  let r = await reload(LIST);
  eq(r.calls.reloads, [{id: 42, options: {bypassCache: false}}], 'allowed tab is reloaded without bypassing cache');
  eq(r.reply, {ok: true}, 'allowed tab replies ok');

  r = await reload('https://korail.com/ticket/search/list');
  eq(r.calls.reloads.length, 1, 'bare korail.com host is allowed');

  for (const [url, label] of [
    ['http://www.korail.com/ticket/search/list', 'plain http rejected'],
    ['https://evil.example.com/ticket/search/list', 'other host rejected'],
    ['https://www.korail.com/ticket/reservation/detail', 'other path rejected'],
    ['not a url', 'unparseable url rejected']
  ]) {
    r = await reload(url);
    eq(r.calls.reloads.length, 0, label);
    eq(r.reply && r.reply.ok, false, label + ' replies not ok');
  }

  for (const [over, label] of [
    [{frameId: 1}, 'subframe rejected'],
    [{id: 'other-extension'}, 'foreign sender id rejected'],
    [{tab: undefined}, 'missing tab rejected'],
    [{tab: {id: -1}}, 'negative tab id rejected']
  ]) {
    r = await reload(LIST, over);
    eq(r.calls.reloads.length, 0, label);
    eq(r.reply && r.reply.ok, false, label + ' replies not ok');
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
