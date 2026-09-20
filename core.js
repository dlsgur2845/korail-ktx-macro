(function (root) {
  'use strict';
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  const number = text => /^\d+$/.test(clean(text)) ? String(Number(clean(text))) : '';
  function minutes(text) {
    const m = /^(\d{2}):(\d{2})$/.exec(text);
    return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN;
  }
  function parseHeading(text) {
    const m = /^(.*?)\s*→\s*(.*?)\s*\((\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})\)$/.exec(clean(text));
    return m ? {from:clean(m[1]), to:clean(m[2]), time:m[3]} : null;
  }
  function available(label, price, kind) {
    label = clean(label);
    return (kind === 'gen' ? /^일반실(?:\(매진임박\))?$/.test(label) : /^특실(?:\(매진임박\))?$/.test(label)) && /^[\d,]+원$/.test(clean(price));
  }

  // Korail renders every seat cell as `price_box fl-l [active] <ticketType> ...`
  // and only emits the bare `gen` / `spe` / `yms` ticketType token when that
  // class of seat can actually be booked. Sold out, standing-only and
  // reservation-waiting cells carry other tokens (sold_out, stnd, wait,
  // yms_wait, yms_sold_out, lack_seat, no-data). Reading the token is steadier
  // than parsing the Korean label, which varies by train type and locale.
  function seatTokens(className) {
    return new Set(String(className || '').split(/\s+/).filter(Boolean));
  }
  function seatOpen(tokens, kind) { return tokens.has(kind); }
  function standingOpen(tokens) { return tokens.has('yms'); }

  function matches(row, config) {
    const route = parseHeading(row.heading);
    if (!route || !/^KTX(?:$|[-\s])/.test(clean(row.type))) return false;
    if (config.matchMode === 'trains') {
      // The route is deliberately not checked here. With '서울·용산 - 수서 함께
      // 보기' or '인접역 보기' on, Korail lists trains whose arrival or departure
      // station differs from the search fields, and requiring an exact match made
      // a hand-picked 수서 train impossible to ever find. The number came from
      // this very list, so the train itself is the user's choice.
      const wanted = (config.numbers || '').split(/[\s,]+/).filter(Boolean).map(number);
      return wanted.length > 0 && wanted.includes(number(row.number));
    }
    if (config.matchMode === 'time') {
      // Time mode selects by window rather than by train, so it stays strict:
      // otherwise it could book a different destination than the one searched.
      if (route.from !== config.from || route.to !== config.to) return false;
      return minutes(route.time) >= minutes(config.start) && minutes(route.time) <= minutes(config.end);
    }
    return false;
  }

  function needsMore(headings, config, batches, allTargetsSeen) {
    if(config.matchMode==='trains') return !allTargetsSeen && batches<3;
    if(config.matchMode==='time') {
      const times=headings.map(parseHeading).filter(Boolean).map(route=>minutes(route.time)).filter(Number.isFinite);
      // A following batch may contain more trains departing at the exact end time.
      return times.length>0 && Math.max(...times)<=minutes(config.end);
    }
    return false;
  }
  function combinedStanding(label) {
    return /^입석\s*\+\s*좌석$/.test(clean(label));
  }
  function retryDelay(minimumMs, responseMs, errors = 0) {
    const base = Math.max(3000, minimumMs);
    return errors ? Math.min(300000, Math.max(15000, base) * 2 ** errors) : base;
  }
  // The signed schedule request fails intermittently for ordinary users too, so
  // back off further than before instead of re-requesting every few seconds.
  function recoveryDelay(attempt) { return Math.min(60000, 5000 * 2 ** (attempt - 1)); }

  // Why the interval adapts instead of being a fixed number: nobody here knows
  // what Korail's real limit is. A headless test session started refusing every
  // schedule request after a few dozen queries and stayed that way, but a real
  // browser refreshing about once a second reportedly works fine, so that
  // measurement may say more about automation detection than about any rate
  // limit. Rather than guess a safe constant, run at whatever the user asked for
  // and let observed refusals decide when to ease off.
  const PACE_BACKOFF_FLOOR = 1000;
  function pollDelay(baseMs, level = 0) {
    const base = Math.max(0, Math.trunc(baseMs) || 0);
    const steps = Math.min(Math.max(Math.trunc(level) || 0, 0), PACE_MAX);
    if (steps === 0) return base;
    return Math.min(60000, Math.max(base, PACE_BACKOFF_FLOOR) * 2 ** steps);
  }
  // One level up per refusal, one level down per clean query. Because the level
  // cannot go below zero, a run of refusals pushes it up and it settles wherever
  // the site stops refusing, without ever pinning at the slowest setting.
  // Demanding several clean queries in a row to relax was tried and rejected: at
  // a 30% refusal rate three-in-a-row almost never happens, so the interval
  // climbed to the cap and the watch became useless. The cap is deliberately low
  // for the same reason.
  const PACE_RELAX_AFTER = 1, PACE_MAX = 4;
  function nextPace(pace, refused) {
    const level = Math.min(Math.max(Math.trunc(pace?.level) || 0, 0), PACE_MAX);
    const streak = Math.max(Math.trunc(pace?.streak) || 0, 0);
    if (refused) return {level: Math.min(PACE_MAX, level + 1), streak: 0};
    const next = streak + 1;
    return next >= PACE_RELAX_AFTER ? {level: Math.max(0, level - 1), streak: 0} : {level, streak: next};
  }
  // An occasional longer pause. Running flat out for an hour sends far more
  // requests than the watch actually needs, so every so often the loop waits
  // longer than usual. This lowers the average request rate; it is not an
  // attempt to make the traffic look human.
  function restDelay(checks, every, restMs) {
    const period = Math.trunc(every) || 0, rest = Math.trunc(restMs) || 0;
    if (period < 1 || rest < 1) return 0;
    const done = Math.max(Math.trunc(checks) || 0, 0);
    return done > 0 && done % period === 0 ? rest : 0;
  }
  const STABLE_MS = 300;
  function readiness({blocked, queued, loading, transientError, emptyResult, hasRows, stableMs}) {
    if (blocked) return 'blocked';
    if (queued) return 'queued';
    if (transientError) return 'transient-error';
    if (loading) return 'loading';
    if (!hasRows && emptyResult) return 'empty-result';
    if (!hasRows) return 'empty';
    return stableMs >= STABLE_MS ? 'ready' : 'loading';
  }

  // Korail raises its reservation notices through one shared layer popup, so the
  // only way to tell a harmless "check the arrival time" notice from one that
  // changes what is being bought is the wording. Anything unrecognised stays
  // 'unknown' and the caller hands the screen back to the user.
  function dialogKind(title, body) {
    const t = clean(title), b = clean(body), all = t + ' ' + b;
    if (/로그인\s*(?:해|하여|하시)/.test(all)) return 'login';
    if (/SR\s*홈페이지로\s*이동|SRT\s*홈페이지에서\s*예매/.test(all)) return 'srt';
    if (/잔여석이\s*없|예약\s*가능한\s*좌석이\s*없/.test(all)) return 'sold-out';
    if (/예약에\s*실패|좌석을\s*선택해\s*주세요/.test(all)) return 'fail';
    if (/좌석선택\s*또는\s*열차예매를\s*선택|열차예매를\s*진행합니다/.test(all)) return 'seatmap-choice';
    if (/지연승낙|지연\s*열차입니다|지연배상/.test(all)) return 'delay';
    if (/좌석이\s*선택\s*되지\s*않았습니다/.test(all)) return 'seat-auto';
    if (/위약금이\s*발생하지\s*않습니다/.test(all)) return 'group';
    if (/(?:우회|경유)하는\s*열차입니다/.test(all)) return 'detour';
    if (/정차하는\s*열차입니다|도착시간을\s*확인/.test(all)) return 'info';
    if (/2개\s*편성을\s*연결하여\s*운행/.test(all)) return 'info';
    if (/할인\s*적용\s*되었습니다/.test(all)) return 'info';
    if (/출발역은\s*\S{1,12}역이고\s*도착역은\s*\S{1,12}역입니다/.test(all)) return 'info';
    if (/결제\s*기한|결제기한/.test(all)) return 'info';
    return 'unknown';
  }

  // Which notices may be answered without asking the user. 'info' and
  // 'seatmap-choice' do not change the ticket; the rest do, so they are opt-in.
  const DIALOG_POLICY = {
    info:{auto:true, confirm:['확인','네','예'], note:'안내 확인'},
    'seatmap-choice':{auto:true, confirm:['열차예매'], note:'열차예매 선택'},
    delay:{option:'allowDelay', confirm:['네','확인'], note:'지연 열차 승낙'},
    detour:{option:'allowDetour', confirm:['네','확인'], note:'우회 운행 승낙'},
    group:{option:'allowGroup', confirm:['확인','네'], note:'단체 위약금 안내 확인'},
    'seat-auto':{option:'allowSeatAuto', confirm:['네','예'], note:'좌석 자동배정 동의'}
  };
  function dialogPlan(kind, config) {
    const policy = DIALOG_POLICY[kind];
    if (!policy) return {act:false, kind};
    if (policy.auto) return {act:config?.autoNotice !== false, kind, confirm:policy.confirm, note:policy.note, option:null};
    return {act:!!config?.[policy.option], kind, confirm:policy.confirm, note:policy.note, option:policy.option};
  }

  // A reservation-detail URL or HTTP 200 is not a receipt. Multi-ticket
  // continuation needs one distinct, seated, one-passenger reservation.
  function receipt(text, expected, now) {
    const body=clean(text);
    const ids=[...body.matchAll(/예약\s*번호\s*[:：]?\s*([0-9][0-9\s-]{5,35})/g)]
      .map(m=>m[1].replace(/\s/g,'').replace(/-$/,''));
    if(ids.length!==1 || !/^\d[\d-]{5,29}$/.test(ids[0])) return null;
    if(!/예약\s*(?:이\s*)?완료|예매\s*(?:가\s*)?완료|결제\s*기한/.test(body)) return null;
    if(/예약이\s*취소|취소되었습니다|취소\s*완료|예약\s*실패/.test(body)) return null;
    const trains=[...body.matchAll(/KTX(?:\s*[-–]?\s*(?:산천|청룡|이음))?\s*(\d{1,4})(?!\d)/gi)].map(m=>number(m[1]));
    if(!trains.length || trains.some(n=>n!==number(expected.number))) return null;
    const travelText=body.replace(/결제\s*기한\s*[:：]?\s*20\d{2}\s*[.년/-]\s*\d{1,2}\s*[.월/-]\s*\d{1,2}\s*일?/g,'');
    const dates=[...travelText.matchAll(/(20\d{2})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})\s*일?/g)]
      .map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
    const date=/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/.exec(expected.date||'');
    if(!date || !dates.includes(`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`)) return null;
    const route=parseHeading(expected.heading);
    if(!route || !body.includes(route.from) || !body.includes(route.to) || !body.includes(route.time)) return null;
    const counts=[...body.matchAll(/(?:총|승차\s*인원|예약\s*인원|인원)\s*[:：]?\s*(\d+)\s*명/g)].map(m=>+m[1]);
    if(!counts.length || counts.some(n=>n!==1)) return null;
    const seats=[...body.matchAll(/(\d{1,2})\s*호차\s*[,·:/-]?\s*(\d{1,3}\s*[A-Fa-f])(?:\s*(?:번|호))?/g)]
      .map(m=>m[1]+':'+m[2].replace(/\s/g,'').toUpperCase());
    if(new Set(seats).size!==1) return null;
    // The payment deadline is needed before leaving the first held ticket.
    const deadline=/결제\s*기한\s*[:：]?\s*(20\d{2})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})\s*일?\s*(?:\([^)]*\))?\s*(\d{1,2})\s*[:시]\s*(\d{2})(?:\s*[:분]\s*(\d{2}))?/.exec(body);
    let due=null;
    if(deadline) {
      const [,y,m,d,h,min,sec='00']=deadline;
      const value=Date.parse(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:${sec}+09:00`);
      if(Number.isFinite(value) && value>now) due=value;
    }
    return {id:ids[0].replace(/-/g,''),seat:seats[0],due};
  }
  function singlePassenger(value) { return /^(?:총\s*)?1\s*명$/.test(clean(value)); }
  const api = {receipt, singlePassenger, clean, number, minutes, parseHeading, available, seatTokens, seatOpen, standingOpen, matches, needsMore, combinedStanding, retryDelay, recoveryDelay, pollDelay, restDelay, nextPace, readiness, dialogKind, dialogPlan, DIALOG_POLICY, PACE_RELAX_AFTER, PACE_MAX, PACE_BACKOFF_FLOOR, STABLE_MS};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KtxMacroCore = api;
})(globalThis);
