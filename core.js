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
  function matches(row, config) {
    const route = parseHeading(row.heading);
    const wanted = config.numbers.split(/[\s,]+/).filter(Boolean).map(number);
    return !!route && /^KTX(?:$|[-\s])/.test(clean(row.type)) &&
      route.from === config.from && route.to === config.to &&
      minutes(route.time) >= minutes(config.start) && minutes(route.time) <= minutes(config.end) &&
      (!wanted.length || wanted.includes(number(row.number)));
  }
  function combinedStanding(label) {
    return /^입석\s*\+\s*좌석$/.test(clean(label));
  }
  function retryDelay(minimumMs, responseMs, errors = 0) {
    const base = Math.max(minimumMs, Math.min(30000, responseMs * 2));
    return errors ? Math.min(300000, Math.max(15000, base) * 2 ** errors) : base;
  }
  function readiness({blocked, queued, loading, noSchedule, hasRows, stableMs}) {
    if (blocked) return 'blocked';
    if (queued) return 'queued';
    if (loading) return 'loading';
    if (!hasRows && noSchedule) return 'no-schedule';
    if (!hasRows) return 'empty';
    return stableMs >= 750 ? 'ready' : 'loading';
  }
  const api = {clean, number, minutes, parseHeading, available, matches, combinedStanding, retryDelay, readiness};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KtxMacroCore = api;
})(globalThis);
