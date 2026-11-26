/* 반도체 브리핑 v5 · app.js (모바일 앱 구성: 오늘 · 종목 · 시장 · 일정)
   데이터
     window.__INITIAL_BRIEFING_PAYLOAD__ : 시세·현물가·신호 (scripts/update_market_data.py 가 index.html 에 삽입)
     window.__RESEARCH__                 : 분석·출처·일정 (data/research.json 을 같은 방식으로 삽입)
   갱신: 서버 데이터(data/latest_briefing.json)는 5분마다, 실시간 시세는 장이 열린 날 1분마다 다시 받습니다.
   실시간 시세는 브라우저가 TradingView에서 바로 받습니다(국내 20분·미국 15분 지연, 코스피·VIX·금리·환율 실시간, 장전·장후 포함).
   TradingView가 실패하면 CNBC 값을 서버 종가와 맞춰 본 뒤에만 쓰고, 둘 다 안 되면 서버 데이터를 그대로 씁니다. 문장 속 ==구절== 은 연한 형광펜으로 강조합니다.
   오늘의 대응: assets/engine.js(window.MBE)가 같은 데이터로 종목별 판단·가격 계획·이유를 계산합니다. 카톡 문구도 같은 파일을 씁니다. */
(() => {
  'use strict';

  // ================================================================ 0. 상수·상태
  const HOLD = ['005935.KS', '005930.KS', '353200.KS', '240810.KQ', 'AMD', 'CLS'];
  const NAME = {
    '005935.KS': '삼성전자우', '005930.KS': '삼성전자', '353200.KS': '대덕전자', '240810.KQ': '원익IPS',
    AMD: 'AMD', CLS: '셀레스티카', '000660.KS': 'SK하이닉스', MU: '마이크론', NVDA: '엔비디아',
    '^KS11': '코스피', '^KQ11': '코스닥', '^SOX': '반도체지수(SOX)', '^IXIC': '나스닥', '^VIX': 'VIX',
    '^TNX': '미국 10년물', '^FVX': '미국 5년물', '^IRX': '미국 3개월물', 'KRW=X': '원/달러', 'CL=F': 'WTI 유가',
    HYG: '하이일드 채권 ETF', KR_RATE: '한국은행 기준금리', US_RATE: '미국 정책금리', KR3Y: '국고채 3년'
  };
  const CODE = { '005935.KS': '005935', '005930.KS': '005930', '353200.KS': '353200', '240810.KQ': '240810', AMD: 'NASDAQ', CLS: 'NYSE' };
  const SLOT = { '005935.KS': 'var(--s1)', '005930.KS': 'var(--s2)', '353200.KS': 'var(--s3)', '240810.KQ': 'var(--s4)', AMD: 'var(--s5)', CLS: 'var(--s6)' };
  const SHORT = { '005935.KS': '삼성우', '005930.KS': '삼성', '353200.KS': '대덕', '240810.KQ': '원익', AMD: 'AMD', CLS: 'CLS' };
  const RATE = new Set(['^TNX', '^FVX', '^IRX', 'KR_RATE', 'US_RATE', 'KR3Y']);
  const VIEWS = [
    { id: 'today', label: '오늘', icon: '<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9.5v10h13v-10"/><path d="M10 19.5v-5h4v5"/>' },
    { id: 'stocks', label: '종목', icon: '<path d="M4 19.5h16"/><path d="M6.5 16v-5"/><path d="M11 16V6.5"/><path d="M15.5 16v-3.5"/><path d="M20 16V9"/>' },
    { id: 'market', label: '시장', icon: '<path d="M2.5 12h4l2.5-6.5 4 13 2.5-6.5h6"/>' },
    { id: 'agenda', label: '일정', icon: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' }
  ];
  const LEGACY = { dram: 'market', factcheck: 'market', overview5: 'stocks', rates: 'market', cycle: 'market', macro: 'market' };
  const KLABEL = { fact: '사실', forecast: '전망', view: '판단', report: '보도' };
  const ST_LABEL = { ok: '양호', watch: '주의', warn: '경고', on: '켜짐', half: '일부', off: '아직', buffer: '완충', na: '미확인' };

  const S = {
    P: window.__INITIAL_BRIEFING_PAYLOAD__ || {},
    R: window.__RESEARCH__ || {},
    view: 'today',
    stock: HOLD[0],
    direct: {},
    liveAt: 0,
    liveN: 0,
    liveCN: 0,
    liveTV: 0,
    liveErr: '',
    liveT: 0,
    busy: false,
    newsTab: 'all',
    editPos: false,
    pos: loadStore('mb.pos.v1', {})
  };

  // ================================================================ 1. 유틸
  function loadStore(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function saveStore(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isKR = (s) => /\.(KS|KQ)$/.test(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  function nf(v, d = 0) {
    if (!isNum(v)) return '-';
    return v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function sgn(v, d = 2, suf = '%') { return isNum(v) ? (v > 0 ? '+' : '') + nf(v, d) + suf : '-'; }
  function dir(v) { return !isNum(v) || Math.abs(v) < 1e-9 ? 'flat' : v > 0 ? 'up' : 'down'; }
  function px(sym, v) {
    if (!isNum(v)) return '-';
    if (isKR(sym)) return nf(v) + '원';
    if (sym === 'KRW=X') return nf(v, 1) + '원';
    if (RATE.has(sym)) return nf(v, 2) + '%';
    if (sym.charAt(0) === '^') return nf(v, 2);
    return '$' + nf(v, 2);
  }
  function bp(v) { return isNum(v) ? (v > 0 ? '+' : '') + nf(v * 100, 0) + 'bp' : '-'; }
  function chgText(sym, q) { return !q ? '-' : RATE.has(sym) ? bp(q.chg) : sgn(q.chg_pct); }
  function chgDir(sym, q) { return !q ? 'flat' : dir(RATE.has(sym) ? q.chg : q.chg_pct); }
  function krw(v) {
    if (!isNum(v)) return '-';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e12) return s + nf(a / 1e12, a >= 1e14 ? 0 : 1) + '조원';
    if (a >= 1e8) return s + nf(a / 1e8, 0) + '억원';
    if (a >= 1e4) return s + nf(a / 1e4, 0) + '만원';
    return s + nf(a) + '원';
  }
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function kst(ms) {
    const d = new Date(ms + 9 * 3600e3);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
  }
  function parseKST(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(str || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) - 9 * 3600e3 : null;
  }
  function dUTC(str) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  const hm = (ms) => { const k = kst(ms); return pad(k.h) + ':' + pad(k.mi); };
  const hms = (ms) => { const k = kst(ms); return pad(k.h) + ':' + pad(k.mi) + ':' + pad(k.s); };
  const mdw = (ms) => { const k = kst(ms); return k.m + '/' + k.d + '(' + WD[k.wd] + ')'; };
  const sdate = (t) => { const d = new Date(t); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
  const sdateY = (t) => { const d = new Date(t); return d.getUTCFullYear() + '.' + (d.getUTCMonth() + 1) + '.' + d.getUTCDate(); };
  const sdateYM = (t) => { const d = new Date(t); return String(d.getUTCFullYear()).slice(2) + '.' + (d.getUTCMonth() + 1); };
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 90) return '방금';
    if (s < 3600) return Math.round(s / 60) + '분 전';
    if (s < 172800) return Math.round(s / 3600) + '시간 전';
    return Math.round(s / 86400) + '일 전';
  }
  function ddays(dateStr) {
    const t = parseKST(dateStr);
    if (t == null) return null;
    const n = kst(Date.now());
    return Math.round((t - (Date.UTC(n.y, n.m - 1, n.d) - 9 * 3600e3)) / 86400e3);
  }
  function qTime(q) {
    if (!q) return '';
    if (q.src && q.at) {
      const open = q.mkt === 'kr' ? sessions().kr === '장중' : q.mkt === 'us' ? sessions().us === '장중' : true;
      return open ? (q.delay ? q.delay + '분 지연 · ' : '실시간 · ') + hm(q.at) : '마감 가격 · ' + hm(q.at) + ' 확인';
    }
    const t = parseKST(q.time);
    return t ? mdw(t) + ' ' + hm(t) + (q.stale ? ' · 이전 값' : '') : (q.date || '');
  }
  function usDST(ms) {
    const y = new Date(ms).getUTCFullYear();
    const mar = Date.UTC(y, 2, 8), nov = Date.UTC(y, 10, 1);
    const s = mar + ((7 - new Date(mar).getUTCDay()) % 7) * 86400e3 + 7 * 3600e3;
    const e = nov + ((7 - new Date(nov).getUTCDay()) % 7) * 86400e3 + 6 * 3600e3;
    return ms >= s && ms < e;
  }
  // 휴장일(확실한 날만). 국내: 성탄절·연말 휴장·신정. 미국: 추수감사절·성탄절·신정·마틴 루서 킹 데이·대통령의 날.
  const HOLI = { kr: new Set(['2026-12-25', '2026-12-31', '2027-01-01']), us: new Set(['2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15']) };
  const ymd = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  function sessions(ms = Date.now()) {
    const k = new Date(ms + 9 * 3600e3), km = k.getUTCHours() * 60 + k.getUTCMinutes(), kwd = k.getUTCDay();
    const e = new Date(ms - (usDST(ms) ? 4 : 5) * 3600e3), em = e.getUTCHours() * 60 + e.getUTCMinutes(), ewd = e.getUTCDay();
    const krOff = kwd === 0 || kwd === 6 || HOLI.kr.has(ymd(k)), usOff = ewd === 0 || ewd === 6 || HOLI.us.has(ymd(e));
    // 오늘 밤(한국 저녁) 미국 장은 한국 날짜와 같은 날짜의 미국 장입니다.
    const usTonightOff = kwd === 0 || kwd === 6 || HOLI.us.has(ymd(k));
    return {
      kr: krOff ? '휴장' : km >= 540 && km <= 930 ? '장중' : '마감',
      us: usOff ? '휴장' : em >= 570 && em < 960 ? '장중' : '마감',
      krOff, usOff, usTonightOff, km, em
    };
  }

  // ================================================================ 2. 데이터 접근
  // 서버 시세 위에 실시간 시세를 얹고, 고점 대비·기간 수익률을 실시간 가격으로 다시 계산합니다.
  function Q(sym) {
    const b = (S.P.quotes || {})[sym], d = S.direct[sym];
    if (!d) return b || null;
    if (!b) return d;
    const o = Object.assign({}, b, d), p = d.price, p0 = b.price;
    if (isNum(p) && isNum(p0) && p0 > 0 && !RATE.has(sym)) {
      ['w1', 'm1', 'm3', 'm6', 'ytd'].forEach((k) => { if (isNum(b[k]) && b[k] > -100) o[k] = (p / (p0 / (1 + b[k] / 100)) - 1) * 100; });
    }
    if (isNum(p) && isNum(b.hi52)) { o.hi52 = Math.max(b.hi52, p); o.dd = (p / o.hi52 - 1) * 100; }
    if (isNum(p) && isNum(b.lo52) && b.lo52 > 0) { o.lo52 = Math.min(b.lo52, p); o.from_lo = (p / o.lo52 - 1) * 100; }
    return o;
  }
  const serCache = new Map();
  function serBase(sym) {
    const raw = (S.P.series || {})[sym];
    if (!raw || !raw.d || !raw.s) return [];
    const key = sym + '|' + (S.P.updated_ts || 0);
    if (serCache.has(key)) return serCache.get(key);
    const t0 = dUTC(raw.s), out = [];
    for (let i = 0; i < raw.d.length; i++) if (isNum(raw.c[i])) out.push({ t: t0 + raw.d[i] * 86400e3, v: raw.c[i] });
    serCache.set(key, out);
    return out;
  }
  // 실시간 가격이 어느 거래일 값인지: 정규장이 열린 뒤면 오늘, 그 전이면 직전 거래일입니다.
  function prevBiz(t) { let x = t - 86400e3; while ([0, 6].includes(new Date(x).getUTCDay())) x -= 86400e3; return x; }
  function liveDay(d) {
    if (d.day) return dUTC(d.day);
    const now = Date.now();
    if (d.mkt === 'kr') {
      const k = kst(now), t = Date.UTC(k.y, k.m - 1, k.d);
      return k.wd >= 1 && k.wd <= 5 && k.h * 60 + k.mi >= 540 ? t : prevBiz(t);
    }
    const ny = new Date(now - (usDST(now) ? 4 : 5) * 3600e3), t = Date.UTC(ny.getUTCFullYear(), ny.getUTCMonth(), ny.getUTCDate());
    const wd = ny.getUTCDay(), m = ny.getUTCHours() * 60 + ny.getUTCMinutes();
    if (d.mkt === 'us') return wd >= 1 && wd <= 5 && m >= 570 ? t : prevBiz(t);
    return wd >= 1 && wd <= 5 ? t : prevBiz(t);
  }
  // 실시간 가격이 서버 마지막 종가의 다음 거래일이면 점을 하나 더하고, 같은 거래일이면 마지막 점을 바꿉니다.
  // 서버 기록이 하루 이상 늦으면 실시간의 전일 종가로 직전 거래일을 채운 뒤 현재가를 잇습니다(국내·미국 종목과 지수만).
  function SER(sym) {
    const base = serBase(sym), d = S.direct[sym], b = (S.P.quotes || {})[sym];
    if (!d || !isNum(d.price) || base.length < 2) return base;
    const last = base[base.length - 1];
    const near = (x, y) => isNum(x) && isNum(y) && Math.abs(x - y) <= Math.abs(y) * 6e-4 + 1e-9;
    if (near(d.price, last.v)) return base;
    // 환율·금리·유가·VIX처럼 거의 쉬지 않고 움직이는 지표는 실시간 값을 마지막 점의 현재 값으로 씁니다.
    // 시세 칸과 시장 공포 신호, 판단이 같은 숫자를 보도록 맞춥니다.
    if (d.mkt === 'fx' || sym === '^VIX') {
      if (Math.abs(d.price / last.v - 1) > 0.15) return base;
      const tc = liveDay(d);
      return tc && tc > last.t ? base.concat([{ t: tc, v: d.price, live: true }]) : base.slice(0, -1).concat([{ t: last.t, v: d.price, live: true }]);
    }
    const t = liveDay(d);
    if (near(d.prev, last.v)) return t && t > last.t ? base.concat([{ t, v: d.price, live: true }]) : base;
    if (b && near(d.prev, b.prev)) return base.slice(0, -1).concat([{ t: last.t, v: d.price, live: true }]);
    if ((d.mkt === 'kr' || d.mkt === 'us') && isNum(d.prev) && t && t > last.t && t - last.t <= 7 * 86400e3) {
      const pd = prevBiz(t);
      if (pd > last.t) return base.concat([{ t: pd, v: d.prev, fill: true }, { t, v: d.price, live: true }]);
    }
    return base;
  }
  const lastN = (a, n) => a.slice(Math.max(0, a.length - n));
  function backVal(sym, k) { const s = SER(sym); return s.length > k ? s[s.length - 1 - k].v : null; }
  function dramHist(key) {
    return (((S.P.history || {}).dram) || []).filter((h) => isNum(h[key])).map((h) => ({ t: dUTC(h.d), v: h[key], seed: !!h.seed }));
  }
  function srcLinks(ids, lead = '출처') {
    if (!ids || !ids.length) return '';
    const L = S.R.sources || {};
    const a = ids.filter((id) => L[id]).map((id) => `<a href="${esc(L[id].u)}" target="_blank" rel="noopener">${esc(L[id].n)}</a>`);
    return a.length ? `<div class="srcs">${lead} · ${a.join(' · ')}</div>` : '';
  }
  const tag = (k) => `<span class="tag ${esc(k)}">${esc(KLABEL[k] || k)}</span>`;

  function secVal() {
    const V = (S.R.cycle || {}).valuation, c = Q('005930.KS'), p = Q('005935.KS');
    if (!V || !c || !p) return null;
    const mcap = c.price * V.samsung_common_shares + p.price * V.samsung_pref_shares;
    return { mcap, op: V.samsung_op_q * 4, x: mcap / (V.samsung_op_q * 4) };
  }
  function hynixVal() {
    const V = (S.R.cycle || {}).valuation, h = Q('000660.KS');
    if (!V || !h) return null;
    const mcap = h.price * V.hynix_shares;
    return { mcap, op: V.hynix_op_q * 4, x: mcap / (V.hynix_op_q * 4) };
  }
  const TOKENS = {
    sox_dd: () => { const q = Q('^SOX'); return q && isNum(q.dd) ? nf(Math.abs(q.dd), 1) + '%' : null; },
    sec_x: () => { const v = secVal(); return v ? nf(v.x, 1) : null; },
    hynix_x: () => { const v = hynixVal(); return v ? nf(v.x, 1) : null; },
    per: (a) => { const [s, e] = String(a || '').split('|'), q = Q(s); return q && isNum(q.price) && +e > 0 ? nf(q.price / +e, 1) : null; },
    yld: (a) => { const [s, d] = String(a || '').split('|'), q = Q(s); return q && isNum(q.price) && +d > 0 ? nf((+d / q.price) * 100, 1) : null; },
    disc: () => { const c = Q('005930.KS'), p = Q('005935.KS'); return c && p && c.price ? nf((1 - p.price / c.price) * 100, 1) : null; }
  };
  // 오늘의 대응 엔진(assets/engine.js). 서버 1년 일봉에 실시간 점을 더한 기록으로 계산하고, 데이터가 바뀔 때만 다시 계산합니다.
  const ENG_SYMS = HOLD.concat(['^KS11', '^SOX', 'NVDA', '^VIX', '^TNX', 'HYG', 'KRW=X']);
  let engMemo = { key: '', out: null, at: 0 };
  function ENG() {
    if (!window.MBE || !window.MBE.run) return null;
    // 일정 관문은 시각에 따라 풀리므로 5분마다 다시 계산합니다.
    const key = [S.P.updated_ts || 0, S.liveAt || 0, S.R.version || '', S.R.as_of || '', JSON.stringify(S.pos || {}), Math.floor(Date.now() / 300e3)].join('|');
    if (engMemo.key === key) return engMemo.out;
    const ser = {};
    ENG_SYMS.forEach((x) => { ser[x] = SER(x); });
    const H = S.P.history || {};
    const dram = (H.dram || []).filter((h) => isNum(h.ddr5_16g)).map((h) => ({ t: dUTC(h.d), v: h.ddr5_16g }));
    const flows = {};
    Object.keys(H.flows || {}).forEach((k) => { flows[k] = (H.flows[k] || []).map((x) => ({ t: dUTC(x.d), f: x.f, o: x.o, v: x.v })); });
    const cns = {};
    Object.keys(S.P.naver || {}).forEach((k) => { const n = S.P.naver[k] || {}; cns[k] = { eps: n.eps, bps: n.bps }; });
    const k = kst(Date.now());
    let out = null;
    try { out = window.MBE.run({ ser, dram, flows, cns, research: S.R, pos: S.pos, today: Date.UTC(k.y, k.m - 1, k.d), now: Date.now() }); }
    catch (e) { if (window.console) console.error('engine', e); }
    engMemo = { key, out, at: Date.now() };
    return out;
  }
  const EI = (sym) => { const E = ENG(); return E && E.items ? E.items[sym] || null : null; };

  // research.json 문장: {{토큰}} 과 {{토큰:인자}} 는 실시간 값으로, ==구절== 은 연한 형광펜 강조로 바꿉니다.
  function tpl(text) {
    return esc(text)
      .replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (m, k, a) => { const v = TOKENS[k] ? TOKENS[k](a) : null; return v == null ? '…' : esc(v); })
      .replace(/==(.+?)==/g, '<mark class="hl">$1</mark>');
  }

  // ================================================================ 3. 아이콘·배지
  const ICON = {
    ok: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.7 8.3l2.2 2.1 4.4-4.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    watch: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.3l7.2 12.9H.8z" fill="currentColor"/><path d="M8 5.8v3.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.8" r="1" fill="#fff"/></svg>',
    warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor"/><path d="M8 4.2v4.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.4" r="1.1" fill="#fff"/></svg>',
    info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 7.2v4.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="4.7" r="1.05" fill="#fff"/></svg>',
    na: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
  };
  const ST_ICON = { ok: 'ok', watch: 'watch', warn: 'warn', on: 'warn', half: 'watch', off: 'ok', buffer: 'info', na: 'na' };
  const badge = (st) => `<span class="st ${esc(st)}">${ICON[ST_ICON[st] || 'na']}${esc(ST_LABEL[st] || st)}</span>`;

  // ================================================================ 4. 차트
  const CH = new Map();
  let chSeq = 0;
  function slot(spec) {
    const id = 'ch' + (++chSeq);
    CH.set(id, spec);
    return `<div class="chart" id="${id}" style="height:${spec.height || 220}px" role="img" aria-label="${esc(spec.aria || '')}"></div>`;
  }
  function mountCharts() {
    document.querySelectorAll('.chart').forEach((el) => {
      const spec = CH.get(el.id);
      if (!spec) return;
      try { DRAW[spec.type](el, spec); } catch (e) { console.error(e); el.innerHTML = '<div class="empty">차트를 그리지 못했습니다</div>'; }
    });
  }
  function niceStep(range, count) {
    const raw = range / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n >= 7.07 ? 10 : n >= 3.16 ? 5 : n >= 1.41 ? 2 : 1) * mag;
  }
  function ticks(lo, hi, count = 4) {
    if (!(hi > lo)) hi = lo + (Math.abs(lo) || 1);
    const st = niceStep(hi - lo, count), a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st, list = [];
    for (let v = a; v <= b + st * 1e-6; v += st) list.push(+v.toFixed(10));
    return { lo: a, hi: b, list };
  }
  function nearest(arr, t) {
    let lo = 0, hi = arr.length - 1;
    if (hi < 0) return null;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid].t < t) lo = mid; else hi = mid; }
    return Math.abs(arr[lo].t - t) <= Math.abs(arr[hi].t - t) ? arr[lo] : arr[hi];
  }
  const textW = (s, fs = 10.5) => { let w = 0; for (const ch of String(s)) w += /[ㄱ-힣]/.test(ch) ? fs * 0.98 : fs * 0.6; return w; };
  const T = (x, y, s, a = '') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${a}>${esc(s)}</text>`;
  const HALO = 'paint-order="stroke" stroke="var(--surface)" stroke-width="3" stroke-linejoin="round"';
  function roundTop(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x.toFixed(1)} ${(y + h).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + r).toFixed(1)}V${(y + h).toFixed(1)}Z`;
  }
  function roundBoth(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    return `M${x.toFixed(1)} ${(y + r).toFixed(1)}Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + r).toFixed(1)}V${(y + h - r).toFixed(1)}Q${(x + w).toFixed(1)} ${(y + h).toFixed(1)} ${(x + w - r).toFixed(1)} ${(y + h).toFixed(1)}H${(x + r).toFixed(1)}Q${x.toFixed(1)} ${(y + h).toFixed(1)} ${x.toFixed(1)} ${(y + h - r).toFixed(1)}Z`;
  }
  function roundRight(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h / 2, w));
    return `M${x.toFixed(1)} ${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + r).toFixed(1)}V${(y + h - r).toFixed(1)}Q${(x + w).toFixed(1)} ${(y + h).toFixed(1)} ${(x + w - r).toFixed(1)} ${(y + h).toFixed(1)}H${x.toFixed(1)}Z`;
  }
  function tipEl() { return document.getElementById('tip'); }
  function showTip(html, x, y) {
    const t = tipEl();
    if (!t) return;
    t.innerHTML = html;
    t.classList.add('on');
    const r = t.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    let L = x + 14, Tp = y + 14;
    if (L + r.width > vw - 8) L = x - r.width - 14;
    if (Tp + r.height > vh - 8) Tp = y - r.height - 14;
    t.style.left = Math.max(8, L) + 'px';
    t.style.top = Math.max(8, Tp) + 'px';
  }
  function hideTip() { const t = tipEl(); if (t) t.classList.remove('on'); }
  function bindTips(root) {
    root.querySelectorAll('[data-tip]').forEach((n) => {
      if (n.__tip) return;
      n.__tip = true;
      const show = (ev) => showTip(n.getAttribute('data-tip'), ev.clientX, ev.clientY);
      n.addEventListener('pointerenter', show);
      n.addEventListener('pointermove', show);
      n.addEventListener('pointerdown', show);
      n.addEventListener('pointerleave', hideTip);
    });
  }
  const tipRow = (val, name, color, box) => `<div class="tr"><b>${esc(val)}</b><span>${color ? `<i class="lk${box ? ' box' : ''}" style="background:${color}"></i>` : ''}${esc(name)}</span></div>`;

  function drawLine(el, sp) {
    const W = Math.max(260, el.clientWidth || 600), H = sp.height || 220;
    const series = sp.series.filter((s) => s.data && s.data.length >= 2);
    const m = { t: 12, r: sp.endLabels === false ? 10 : series.length > 1 ? 70 : 62, b: 22, l: 2 };
    if (!series.length) { el.innerHTML = '<div class="empty">데이터가 아직 충분하지 않습니다</div>'; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    series.forEach((s) => s.data.forEach((p) => { x0 = Math.min(x0, p.t); x1 = Math.max(x1, p.t); y0 = Math.min(y0, p.v); y1 = Math.max(y1, p.v); }));
    (sp.refs || []).forEach((r) => { if (isNum(r.v)) { y0 = Math.min(y0, r.v); y1 = Math.max(y1, r.v); } });
    if (sp.band) { y0 = Math.min(y0, sp.band.lo); y1 = Math.max(y1, sp.band.hi); }
    const yf = sp.yFmt || ((v) => nf(v));
    let TK;
    if (sp.yList) TK = { lo: sp.yList[0], hi: sp.yList[sp.yList.length - 1], list: sp.yList.slice() };
    else {
      const pd = (y1 - y0) * 0.08 || Math.abs(y1) * 0.04 || 1;
      // 반올림 때문에 같은 눈금 글자가 두 번 나오면 간격을 넓힙니다.
      for (let cnt = sp.yTicks || (H < 170 ? 3 : 4); cnt >= 1; cnt--) {
        TK = ticks(y0 - pd, y1 + pd, cnt);
        const labs = TK.list.map(yf);
        if (new Set(labs).size === labs.length) break;
      }
    }
    const X = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - TK.lo) / (TK.hi - TK.lo || 1)) * (H - m.t - m.b);
    m.l = Math.ceil(Math.max(...TK.list.map((v) => textW(yf(v))))) + 8;
    let g = '';
    const bandX = sp.band ? (sp.band.from ? Math.max(m.l, Math.min(W - m.r, X(sp.band.from))) : m.l) : 0;
    if (sp.band) g += `<rect x="${bandX.toFixed(1)}" y="${Y(sp.band.hi).toFixed(1)}" width="${Math.max(2, W - m.r - bandX).toFixed(1)}" height="${Math.max(1.5, Y(sp.band.lo) - Y(sp.band.hi)).toFixed(1)}" fill="var(--surface-3)"/>`;
    TK.list.forEach((v) => {
      const y = Y(v);
      g += `<line x1="${m.l}" x2="${(W - m.r).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    });
    // 가로축: 기간이 짧으면 눈금 수를 줄이고, 같은 날짜 글자는 한 번만 씁니다.
    const span = (x1 - x0) / 86400e3, nT = Math.max(1, Math.min(W < 420 ? 3 : 5, Math.round(span)));
    let lastLab = null;
    for (let i = 0; i <= nT; i++) {
      const t = x0 + ((x1 - x0) * i) / nT;
      const lab = sp.xFmt ? sp.xFmt(t) : span > 200 ? sdateYM(t) : sdate(t);
      if (lab === lastLab) continue;
      lastLab = lab;
      g += T(X(t), H - 5, lab, `font-size="10.5" fill="var(--muted)" text-anchor="${i === 0 ? 'start' : i === nT ? 'end' : 'middle'}"`);
    }
    (sp.refs || []).forEach((r) => {
      if (!isNum(r.v)) return;
      const y = Y(r.v);
      g += `<line x1="${m.l}" x2="${(W - m.r).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${r.color || 'var(--ink-2)'}" stroke-width="1"${r.color ? '' : ' stroke-dasharray="4 3"'} opacity="${r.color ? 0.9 : 0.55}"/>`;
    });
    const ends = [], pts = [];
    series.forEach((s) => {
      let d = '';
      s.data.forEach((p, i) => { const px = X(p.t), py = Y(p.v); d += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); pts.push([px, py]); });
      if (sp.area && series.length === 1) {
        const a = s.data[0], b = s.data[s.data.length - 1];
        g += `<path d="${d}L${X(b.t).toFixed(1)} ${(H - m.b).toFixed(1)}L${X(a.t).toFixed(1)} ${(H - m.b).toFixed(1)}Z" fill="${s.color}" opacity=".10"/>`;
      }
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (s.marks) s.data.forEach((p) => { if (p.seed) g += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3.2" fill="var(--surface)" stroke="${s.color}" stroke-width="1.6"/>`; });
      const lp = s.data[s.data.length - 1];
      ends.push({ x: X(lp.t), y: Y(lp.v), v: lp.v, s });
    });
    // 기준선 이름표는 선을 다 그린 뒤, 데이터와 덜 겹치는 자리(오른쪽 위, 왼쪽 위, 오른쪽 아래, 왼쪽 아래 순)에 둡니다.
    const labs = [];
    (sp.refs || []).forEach((r) => { if (isNum(r.v) && r.label) labs.push({ y: Y(r.v), text: r.label }); });
    if (sp.band && sp.band.label) labs.push({ y: Y(sp.band.hi), text: sp.band.label });
    const placed = [];
    labs.forEach((L) => {
      const w = textW(L.text) + 4;
      let best = null;
      [['r', -4], ['l', -4], ['r', 12], ['l', 12]].forEach(([side, dy], k) => {
        const by = L.y + dy, bx0 = side === 'r' ? W - m.r - 3 - w : m.l + 3, bx1 = bx0 + w;
        if (by - 10 < m.t - 4 || by > H - m.b - 1) return;
        let hit = 0;
        pts.forEach(([px, py]) => { if (px >= bx0 - 2 && px <= bx1 + 2 && py >= by - 12 && py <= by + 4) hit += 1; });
        placed.forEach((q) => { if (Math.abs(q.y - by) < 12 && bx1 > q.x0 && bx0 < q.x1) hit += 1000; });
        const score = hit * 10 + k;
        if (!best || score < best.score) best = { score, side, by, bx0, bx1 };
      });
      if (!best) best = { side: 'r', by: L.y - 4, bx0: W - m.r - 3 - w, bx1: W - m.r - 3 };
      placed.push({ y: best.by, x0: best.bx0, x1: best.bx1 });
      g += T(best.side === 'r' ? W - m.r - 3 : m.l + 3, best.by, L.text, `font-size="10.5" font-weight="600" fill="var(--ink-2)" text-anchor="${best.side === 'r' ? 'end' : 'start'}" ${HALO}`);
    });
    TK.list.forEach((v) => { g += T(m.l - 6, Y(v) + 3.5, yf(v), 'font-size="10.5" fill="var(--muted)" text-anchor="end"'); });
    // 끝 값 이름표: 서로 13px 넘게 떨어지도록 위아래로 밀어 둡니다. 자리가 모자라면 생략합니다.
    let labels = sp.endLabels !== false;
    const order = ends.slice().sort((a, b) => a.y - b.y);
    if (labels) {
      order.forEach((e, i) => { e.ly = Math.max(e.y, i ? order[i - 1].ly + 13 : m.t + 4); });
      for (let i = order.length - 1; i >= 0; i--) {
        const lim = i === order.length - 1 ? H - m.b : order[i + 1].ly - 13;
        if (order[i].ly > lim) order[i].ly = lim;
      }
      if (order.some((e, i) => (i && e.ly - order[i - 1].ly < 12.5) || e.ly < m.t)) labels = false;
    }
    ends.forEach((e) => {
      g += `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="4" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      if (labels && series.length > 1) g += `<rect x="${(e.x + 8).toFixed(1)}" y="${(e.ly - 3).toFixed(1)}" width="7" height="7" rx="2" fill="${e.s.color}"/>`;
      if (labels) g += T(e.x + (series.length > 1 ? 18 : 8), e.ly + 4, (e.s.endFmt || sp.tipFmt || yf)(e.v), 'font-size="11.5" font-weight="700" fill="var(--ink)"');
    });
    g += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-2)" stroke-width="1" opacity="0"/><g class="xd"></g>`;
    g += `<rect class="ov" x="${m.l}" y="0" width="${(W - m.l - m.r).toFixed(1)}" height="${H}" fill="transparent"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="touch-action:pan-y">${g}</svg>`;
    const svg = el.firstChild, xh = svg.querySelector('.xh'), xd = svg.querySelector('.xd'), ov = svg.querySelector('.ov');
    const tf = sp.tipFmt || yf;
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (W / r.width);
      const t = x0 + ((x - m.l) / (W - m.l - m.r)) * (x1 - x0);
      let rows = '', dots = '', tx = null, tt = null;
      series.forEach((s) => {
        const p = nearest(s.data, t);
        if (!p) return;
        if (tx == null) { tx = X(p.t); tt = p.t; }
        dots += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
        rows += tipRow((s.tipFmt || tf)(p.v), s.name + (p.live ? ' · 실시간' : ''), series.length > 1 ? s.color : null);
      });
      if (tx == null) return;
      xh.setAttribute('x1', tx); xh.setAttribute('x2', tx); xh.setAttribute('opacity', '.35');
      xd.innerHTML = dots;
      showTip(`<div class="tt">${esc(sdateY(tt))}</div>${rows}`, ev.clientX, ev.clientY);
    };
    const leave = () => { xh.setAttribute('opacity', '0'); xd.innerHTML = ''; hideTip(); };
    ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerdown', move);
    ov.addEventListener('pointerleave', leave);
  }


  const DRAW = { line: drawLine, quad: (el, sp) => drawQuad(el, sp) };

  function spark(data) {
    if (!data || data.length < 2) return '';
    const w = 120, h = 28, p = 3;
    let lo = Infinity, hi = -Infinity;
    data.forEach((d) => { lo = Math.min(lo, d.v); hi = Math.max(hi, d.v); });
    if (hi === lo) { hi += 1; lo -= 1; }
    const n = data.length, X = (i) => p + (i / (n - 1)) * (w - p * 2), Y = (v) => p + (1 - (v - lo) / (hi - lo)) * (h - p * 2);
    let d = '';
    data.forEach((q, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(q.v).toFixed(1); });
    const a = data[0].v, b = data[n - 1].v;
    const col = b > a ? 'var(--up)' : b < a ? 'var(--down)' : 'var(--muted)';
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--bench)" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><path d="M${X(n - 1).toFixed(1)} ${Y(b).toFixed(1)}l.01 0" stroke="${col}" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // ================================================================ 5. 앱 화면 공통 (v5, 모바일 우선)
  function vhead(title, sub) { return `<div class="vhead"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`; }
  function card(o) {
    const h = o.title ? `<header class="card-h"><div class="card-ht"><h2>${o.title}</h2>${o.sub ? `<p class="card-sub">${o.sub}</p>` : ''}</div>${o.right || ''}</header>` : '';
    return `<section class="card${o.cls ? ' ' + o.cls : ''}"${o.id ? ` id="${esc(o.id)}"` : ''}>${h}${o.body || ''}</section>`;
  }
  function footer() {
    const P = S.P;
    return `<footer class="foot">
      <p>시세 TradingView(국내 20분·미국 15분 지연, 지수·금리·환율 실시간) · 1년 차트 Yahoo Finance · 메모리 현물가 DRAMeXchange · 수급·컨센서스 네이버 증권</p>
      <p>서버 데이터 ${esc(P.updated_at || '-')}${P.failed && P.failed.length ? ` · 이번에 못 받은 항목 ${esc(P.failed.join(', '))}(이전 값 유지)` : ''} · 분석 ${esc(S.R.as_of_label || S.R.as_of || '-')}</p>
      <p>규칙으로 계산한 개인 참고용 판단이며 투자 권유가 아닙니다.</p>
    </footer>`;
  }
  const SHORT_NAME = { '005935.KS': '삼성전자우', '005930.KS': '삼성전자', '353200.KS': '대덕전자', '240810.KQ': '원익IPS', AMD: 'AMD', CLS: '셀레스티카' };

  // ---------------------------------------------------------------- 일정: 발표 시각과 결과
  function evInfo(e) {
    const m = window.MBE && window.MBE.evMoment ? window.MBE.evMoment(e) : parseKST(e.d);
    const end = e.end ? parseKST(e.end) : m;
    const firm = e.firm !== false && !e.approx, dd = ddays(e.d), now = Date.now();
    return { m, dd, firm, past: firm && end != null && now >= end, live: firm && m != null && end != null && now >= m && now < end };
  }
  function whenLabel(e, I) {
    if (!I.firm) return e.approx || sdate(dUTC(e.d)) + ' 무렵';
    const day = I.dd === 0 ? '오늘' : I.dd === 1 ? '내일' : I.dd === -1 ? '어제' : mdw(parseKST(e.d));
    return day + (e.at && !e.end ? ' ' + e.at : '');
  }
  function lastDecision(code) {
    const l = (S.R.calendar || []).filter((x) => x.auto === code && evInfo(x).past && ddays(x.d) >= -45);
    return l.length ? l[l.length - 1] : null;
  }
  function rateChg(q, code) {
    const e = lastDecision(code);
    if (!e) return '';
    const d = sdate(dUTC(e.d));
    if (q && isNum(q.chg) && Math.abs(q.chg) >= 0.01) return `${d} ${q.chg > 0 ? '+' : ''}${nf(q.chg, 2)}%p ${q.chg > 0 ? '인상' : '인하'}`;
    return `${d} 동결`;
  }
  function autoResult(e) {
    if (!e.auto) return '';
    const q = Q(e.auto === 'KRINTR' ? 'KR_RATE' : 'US_RATE');
    if (!q || !isNum(q.price)) return '';
    return e.auto === 'KRINTR' ? `지금 한국은행 기준금리 ${nf(q.price, 2)}%` : `지금 미국 정책금리 ${nf(q.price - 0.25, 2)}~${nf(q.price, 2)}%`;
  }
  function forChips(e) {
    const f = (e.for || []).filter((x) => SHORT[x]);
    if (!f.length) return '';
    return `<p class="ev-for">${f.length >= HOLD.length ? '내 종목 전체' : esc(f.map((x) => SHORT[x]).join(' · '))}</p>`;
  }
  function evRow(e, opt) {
    const I = evInfo(e), res = e.result || (I.past ? autoResult(e) : '');
    const st = I.past ? `<span class="evs ${res ? 'done' : ''}">${res ? '결과' : '지남'}</span>` : I.live ? '<span class="evs on">진행 중</span>' : '';
    const dday = I.firm && I.dd != null && I.dd > 1 ? `<span class="dd">D-${I.dd}</span>` : '';
    const note = !I.past && e.note && opt && opt.notes ? `<p class="ev-note">${tpl(e.note)}</p>` : '';
    return `<li class="ev${I.past ? ' past' : ''}">
      <div class="ev-when">${esc(whenLabel(e, I))}${dday}</div>
      <div class="ev-body">
        <div class="ev-t"><span>${esc(e.title)}</span>${st}</div>
        ${forChips(e)}
        ${res ? `<p class="ev-res">${tpl(res)}</p>${srcLinks(e.src)}` : note}
      </div>
    </li>`;
  }

  // ---------------------------------------------------------------- 오늘
  function heroCard(E) {
    const sm = E.summary || {}, c = sm.counts || {}, k = kst(Date.now());
    const pills = E.levels.slice().reverse().filter((L) => c[L.id]).map((L) => `<span class="cnt ${esc(L.tone)}"><i></i>${esc(L.name)} <b>${c[L.id]}</b></span>`).join('');
    return `<section class="hero">
      <p class="hero-d">${k.m}월 ${k.d}일 ${WD[k.wd]}요일 · ${esc(hm(engMemo.at || Date.now()))} 계산</p>
      <h1 class="hero-t">${esc(sm.head || '')}</h1>
      <p class="hero-s">${esc(sm.body || '')}</p>
      <p class="hero-n"><i class="dot ${sessions().kr === '장중' ? 'good' : ''}"></i><span>${esc(sessNote())}</span></p>
      <div class="cnts">${pills}</div>
    </section>`;
  }
  function sessNote() {
    const ss = sessions(), k = kst(Date.now()), m = k.h * 60 + k.mi;
    const usOpen = usDST(Date.now()) ? '밤 10시 30분' : '밤 11시 30분';
    let kr;
    if (ss.krOff) kr = '오늘은 국내 휴장이라 국내 종목 판단은 다음 거래일 기준입니다.';
    else if (ss.kr === '장중') kr = '국내 장중입니다. 국내 시세는 20분 늦게 들어옵니다.';
    else if (m < 540) kr = '국내 장 시작 전입니다.';
    else kr = '국내 장은 끝났습니다. 국내 종목 판단은 다음 거래일 기준입니다.';
    let us = '';
    if (ss.us === '장중') us = '미국은 장중입니다.';
    else if (m >= 540 && ss.usTonightOff) us = '오늘 밤 미국은 휴장입니다.';
    else if (m >= 930) us = `미국 장은 ${usOpen}에 열립니다.`;
    return [kr, us].filter(Boolean).join(' ');
  }
  function reasonChips(it) {
    const rs = (it.reasons || []).filter((x) => x.word && Math.abs(x.c) >= 1.5);
    const pos = rs.filter((x) => x.c > 0).slice(0, 2), neg = rs.filter((x) => x.c < 0).slice(0, 2);
    return pos.concat(neg).map((x) => `<span class="rc ${x.c > 0 ? 'pos' : 'neg'}">${esc(x.word)}</span>`).join('');
  }
  function holdRow(s, it) {
    const q = Q(s), c = it.change;
    const was = c && c.changed ? `<span class="was">어제 ${esc(c.from.name)}</span>` : '';
    return `<a class="hrow" href="#stocks/${esc(s)}" style="--slot:${SLOT[s]}">
      <span class="hr-n">${esc(NAME[s])}</span>
      <span class="hr-p num">${q ? px(s, q.price) : '-'}</span>
      <span class="hr-c"><span class="call ${esc(it.level.tone)}">${esc(it.level.name)}</span>${was}</span>
      <span class="hr-d num ${chgDir(s, q)}">${q ? chgText(s, q) : ''}</span>
      <span class="hr-a">${esc(it.act)}</span>
      <span class="hr-r">${reasonChips(it)}</span>
    </a>`;
  }
  function holdingsCard(E) {
    const rows = HOLD.map((s) => (E.items[s] ? holdRow(s, E.items[s]) : '')).join('');
    return card({ id: 'plan', title: '내 종목 대응', sub: '누르면 근거와 가격 계획이 나옵니다', right: tag('view'), body: `<div class="hlist">${rows || '<p class="empty">판단을 계산할 기록이 부족합니다</p>'}</div>` });
  }
  const STATE_WORD = { good: '우호', bad: '부담', mid: '중립' };
  function stateOf(f) { return !isNum(f) ? '' : f >= 0.15 ? 'good' : f <= -0.15 ? 'bad' : 'mid'; }
  function vtile(label, value, sub, st, href) {
    return `<a class="vt" href="${href || '#market'}"><span class="vt-l"><span>${esc(label)}</span>${st ? `<i class="sw ${st}">${STATE_WORD[st]}</i>` : ''}</span><span class="vt-v num">${value}</span><span class="vt-s">${sub || '&nbsp;'}</span></a>`;
  }
  function varsCard(E) {
    const mk = E.market || {}, st = mk.market || {}, R = mk.rates || {}, A = mk.ai || {}, D = mk.memory || {}, X = mk.fx || {};
    const kr = Q('KR_RATE'), bok = ((S.R.macro || {}).bok || {}), sox = Q('^SOX');
    const tiles = [
      vtile('시장 공포', isNum(st.S) ? `${st.S}<small>/100</small>` : '-', `${esc(st.level || '')}${isNum(st.dS) && st.dS !== 0 ? ` · 1주 ${st.dS > 0 ? '+' : ''}${st.dS}` : ''}`, stateOf(st.f), '#market/stress'),
      vtile('미국 금리 10년', isNum(R.L) ? nf(R.L, 2) + '%' : '-', isNum(R.D) ? `20일 ${bp(R.D)}` : '', stateOf(R.f), '#market/rates'),
      vtile('한국은행 기준금리', kr && isNum(kr.price) ? nf(kr.price, 2) + '%' : esc(bok.now || '-'), esc(rateChg(kr, 'KRINTR')), '', '#market/rates'),
      vtile('반도체지수', sox && isNum(sox.price) ? nf(sox.price, 0) : '-', A.ts ? `50일 평균 대비 ${sgn(A.ts.gap50, 0)}` : '', stateOf(A.f), '#market/prices'),
      vtile('D램 현물', isNum(D.v) ? '$' + nf(D.v, 2) : '-', isNum(D.m28) ? `${D.age}일간 ${sgn(D.m28, 1)}` : '기록 쌓는 중', stateOf(D.f), '#market/spot'),
      vtile('원/달러', isNum(X.X) ? nf(X.X, 0) + '원' : '-', isNum(X.dX) ? `20일 ${sgn(X.dX * 100, 1)}` : '', isNum(X.dX) ? stateOf(Math.max(-1, Math.min(1, -X.dX / 0.02))) : '', '#market/fx')
    ];
    return card({ title: '판단에 쓴 변수', sub: '우호·부담은 내 종목 기준', body: `<div class="vtiles">${tiles.join('')}</div>` });
  }
  function weekCard() {
    const list = (S.R.calendar || []).filter((e) => { const d = ddays(e.d); return d != null && d >= (e.result ? -1 : 0) && d <= 7; }).slice(0, 6);
    if (!list.length) return '';
    return card({ id: 'week', title: '이번 주 일정', sub: '한국 시간', right: '<a class="card-x" href="#agenda">전체 일정</a>', body: `<ul class="evlist">${list.map((e) => evRow(e)).join('')}</ul>` });
  }
  function mapCard(E) {
    if (!window.MBE || !window.MBE.zoneOf) return '';
    return card({ id: 'map', title: '한눈에 보기', sub: '가로 싼 정도, 세로 타이밍 · 꼬리는 최근 5거래일', body: slot({ type: 'quad', height: 300, E, aria: '종목별 싼 정도와 타이밍 지도' }) + '<p class="note">오른쪽 위로 갈수록 살 때, 왼쪽으로 갈수록 줄일 때입니다. 점을 누르면 숫자가 나옵니다.</p>' });
  }
  function trailCard(E) {
    const first = HOLD.map((s) => E.items[s]).find((x) => x && x.trail.length);
    if (!first) return '';
    const rows = HOLD.map((s) => { const it = E.items[s]; return it ? `<div class="trow"><span class="nm">${esc(SHORT[s])}</span><span class="cells">${trailCells(s, it, E)}</span></div>` : ''; }).join('');
    const lg = E.levels.slice().reverse().map((L) => `<span><i class="tc ${esc(L.tone)}"></i>${esc(L.name)}</span>`).join('');
    return card({ id: 'trail', title: '판단이 바뀌어 온 길', sub: '최근 20거래일 · 같은 규칙으로 날마다 다시 계산', body: `<div class="tlegend">${lg}</div><div class="trails">${rows}</div><div class="taxis"><span>${esc(sdate(first.trail[0].t))}</span><span>${esc(sdate(first.trail[first.trail.length - 1].t))}</span></div>` });
  }
  function howCard() {
    return `<details class="card more"><summary>판단은 이렇게 계산합니다</summary><div class="more-b">
      <p><b>싼 정도</b>는 이익·배당·순자산에 견준 지금 가격입니다. 메모리 종목은 D램 값, AI 종목은 AI 분위기를 함께 봅니다.</p>
      <p><b>타이밍</b>은 주가 방향, 단기 낙폭, 외국인·기관 매매, 미국 금리, 환율, 시장 공포를 종목마다 다른 무게로 합친 값입니다.</p>
      <p>둘 다 좋으면 분할 매수, 싸지만 타이밍이 나쁘면 매수 대기, 비싸지거나 흐름이 크게 무너지면 비중 점검입니다. 하루 흔들림에 바뀌지 않도록 경계를 분명히 넘어야 판단이 바뀝니다.</p>
      <p>급락이 이어질 때는 주가 방향 신호가 자주 틀려 그 무게를 줄입니다. 금리 결정이나 실적처럼 큰 일정이 있으면 발표 1시간 뒤까지는 사지 않고 결과를 봅니다.</p>
      <p>매수가는 다른 변수가 오늘과 같다고 보고 가격만 움직였을 때 사는 구역에 드는 가격입니다. 매일 다시 계산합니다.</p>
    </div></details>`;
  }
  function vToday() {
    const E = ENG();
    if (!E) return card({ body: '<p class="empty">판단을 계산하지 못했습니다. 위의 새로 고침을 눌러 주세요.</p>' });
    return heroCard(E) + holdingsCard(E) + varsCard(E) + weekCard() + mapCard(E) + trailCard(E) + howCard();
  }

  // ---------------------------------------------------------------- 종목
  function pfMini() {
    const pf = portfolio();
    if (!pf.rows.length) return `<div class="pf-cta"><span>보유 수량과 평균단가를 넣으면 손익과 비중까지 판단에 씁니다</span><button class="btn sm" data-act="pos-open">입력</button></div>`;
    return card({ cls: 'pf', body: `<div class="stats">
        <div class="stat"><span class="lb">평가금액</span><span class="vl num">${krw(pf.val)}</span></div>
        <div class="stat"><span class="lb">오늘</span><span class="vl num ${dir(pf.day)}">${pf.day > 0 ? '+' : ''}${krw(pf.day)}</span></div>
        <div class="stat"><span class="lb">손익</span><span class="vl num ${dir(pf.pl)}">${pf.pl != null ? sgn((pf.val / pf.cost - 1) * 100, 1) : '-'}</span></div>
      </div><div class="pf-ft"><span class="note">미국 종목은 원/달러 ${nf(pf.fx, 0)}원으로 환산</span><button class="btn sm" data-act="pos-open">수정</button></div>` });
  }
  function axRow(label, v, word) {
    const x = Math.max(-100, Math.min(100, isNum(v) ? v : 0)), w = Math.abs(x) / 2;
    return `<div class="ax"><span class="ax-l">${esc(label)}</span><span class="ax-bar"><i class="${x >= 0 ? 'pos' : 'neg'}" style="${x >= 0 ? 'left' : 'right'}:50%;width:${w.toFixed(1)}%"></i></span><span class="ax-w ${x >= 0 ? 'pos' : 'neg'}">${esc(word || '')}</span></div>`;
  }
  function goodBad(it) {
    const rs = (it.reasons || []).filter((x) => Math.abs(x.c) >= 1);
    const pos = rs.filter((x) => x.c > 0).slice(0, 3), neg = rs.filter((x) => x.c < 0).slice(0, 3);
    const li = (x) => `<li><b>${esc(x.word || x.name)}</b><span>${esc(x.say || '')}</span></li>`;
    return `<div class="gb">
      <div class="gb-c pos"><h3>사는 쪽 이유</h3><ul>${pos.map(li).join('') || '<li class="none">뚜렷한 것이 없습니다</li>'}</ul></div>
      <div class="gb-c neg"><h3>걸리는 이유</h3><ul>${neg.map(li).join('') || '<li class="none">뚜렷한 것이 없습니다</li>'}</ul></div>
    </div>`;
  }
  function verdictCard(sym, it) {
    if (!it) return '';
    const E = ENG(), c = it.change;
    const ch = c ? (c.changed ? `어제 ${c.from.name}에서 바뀜` : '어제와 같은 판단') : '';
    const extra = (it.notes || []).slice(1).map((n) => `<li>${esc(n.t)}</li>`).join('');
    const lg = E.levels.slice().reverse().map((L) => `<span><i class="tc ${esc(L.tone)}"></i>${esc(L.name)}</span>`).join('');
    return card({ id: 'verdict', title: '지금 판단', sub: `${esc(it.level.zone)} · ${esc(ch)}${it.crash ? ' · 급락 국면 보정' : ''}`, right: tag('view'), body: `
      <p class="vd-a">${esc(it.act)}</p>
      <p class="vd-l">${esc(it.line)}</p>
      <div class="axes">${axRow('싼 정도', it.V, it.vWord)}${axRow('타이밍', it.T, it.tWord)}</div>
      ${goodBad(it)}
      ${extra ? `<ul class="bul">${extra}</ul>` : ''}
      <div class="subh">최근 20거래일 판단</div>
      <div class="trow solo"><span class="cells">${trailCells(sym, it, E)}</span></div>
      <div class="tlegend sm">${lg}</div>` });
  }
  function ladder(sym, it, pos) {
    const P = it.plan, p = it.p, rows = [];
    const add = (v, label, cls) => { if (isNum(v) && v > 0) rows.push({ v, label, cls }); };
    add(P.trimHi, '일부 정리할 가격', 'trim');
    if (isNum(P.richAt) && P.richAt > p) add(P.richAt, '이익 대비 비싸지는 가격', 'band');
    if (isNum(P.m50) && P.m50 > p) add(P.m50, '50일 평균 가격', 'line');
    add(P.m20, '20일 평균 가격 · 되찾으면 하락이 멈춘 신호', 'line');
    add(P.buyHi, '회복하면 사는 가격', 'buy');
    if (P.buyLo && P.buyLo < p) { add(P.steps[0], '1차 매수', 'buy'); add(P.steps[1], '2차 매수', 'buy'); add(P.steps[2], '3차 매수', 'buy'); }
    else if (P.buyNow) { add(P.steps[1], '다음 매수', 'buy'); add(P.steps[2], '그다음 매수', 'buy'); }
    add(P.trimLo, '밀리면 비중 점검', 'trim');
    if (isNum(P.cheapAt) && P.cheapAt < p) add(P.cheapAt, '이익 대비 싸지는 가격', 'band');
    if (pos && pos.avg > 0) add(pos.avg, '내 평균단가', 'mine');
    const near = rows.filter((r) => r.cls === 'mine' || (r.v <= p * 1.7 && r.v >= p * 0.55)).sort((a, b) => b.v - a.v);
    const out = [];
    near.forEach((r) => { const pr = out[out.length - 1]; if (pr && Math.abs(pr.v / r.v - 1) < 0.004) { pr.label += ' · ' + r.label; return; } out.push(r); });
    let i = out.findIndex((r) => r.v < p);
    if (i < 0) i = out.length;
    out.splice(i, 0, { v: p, label: '지금', cls: 'now' });
    return `<ol class="ladder">${out.map((r) => `<li class="${r.cls}"><span class="lb">${esc(r.label)}</span><b class="num">${px(sym, r.v)}</b><span class="num ds ${r.cls === 'now' ? '' : dir(r.v / p - 1)}">${r.cls === 'now' ? '' : sgn((r.v / p - 1) * 100, 1)}</span></li>`).join('')}</ol>`;
  }
  function planCard(sym, it, q, H, pos) {
    const refs = [];
    if (pos.avg > 0) refs.push({ v: pos.avg, label: '내 평균단가 ' + shortPx(sym, pos.avg), color: 'var(--ink)' });
    if (it && it.plan) {
      if (it.plan.buyLo && it.plan.buyLo < q.price) refs.push({ v: it.plan.buyLo, label: '1차 매수 ' + shortPx(sym, it.plan.buyLo), color: 'var(--tone-add)' });
      if (it.plan.trimHi) refs.push({ v: it.plan.trimHi, label: '일부 정리 ' + shortPx(sym, it.plan.trimHi), color: 'var(--tone-trim)' });
    }
    const V = H.val || {}, nv = (S.P.naver || {})[sym] || {};
    const base = V.type === 'pe' ? (V.eps || [])[isNum(V.band) ? V.band : (V.eps || []).length - 1] : null;
    const epsB = base ? (V.auto_eps && isNum(nv.eps) && nv.eps > 0 ? nv.eps : base.v) : null;
    if (base && (V.bands || []).length) V.bands.forEach((m) => refs.push({ v: epsB * m, label: 'PER ' + m + '배 ' + shortPx(sym, epsB * m) }));
    const s = SER(sym);
    let lo = Infinity, hi = -Infinity;
    s.forEach((x) => { lo = Math.min(lo, x.v); hi = Math.max(hi, x.v); });
    const refsIn = refs.filter((r) => r.v >= lo * 0.8 && r.v <= hi * 1.2);
    return card({ id: 'price', title: '가격 계획', sub: '지금 가격에서 얼마나 떨어져 있는지 · 매일 다시 계산', body: (it ? ladder(sym, it, pos) : '') +
      '<div class="subh">1년 주가와 기준선</div>' +
      slot({ type: 'line', height: 220, area: true, yTicks: 4, series: [{ name: NAME[sym], color: SLOT[sym], data: s }], refs: refsIn, yFmt: (v) => shortPx(sym, v), tipFmt: (v) => px(sym, v), aria: NAME[sym] + ' 1년 주가' }) +
      '<p class="note">PER 기준선은 증권사 평균 이익 전망에 배수를 곱한 가격입니다.</p>' });
  }
  function driversCard(it) {
    if (!it) return '';
    const list = it.reasons || [], mx = Math.max(10, ...list.map((x) => Math.abs(x.c)));
    const rows = list.map((x) => `<li>
      <div class="fr-h"><span class="fr-n">${esc(x.name)}</span><span class="fr-w ${x.c >= 0 ? 'pos' : 'neg'}">${esc(x.state || x.word || '')}</span><b class="num">${x.c > 0.05 ? '+' : x.c < -0.05 ? '−' : ''}${nf(Math.abs(x.c), 1)}</b></div>
      <span class="fb"><i class="${x.c >= 0 ? 'pos' : 'neg'}" style="${x.c >= 0 ? 'left' : 'right'}:50%;width:${((Math.abs(x.c) / mx) * 50).toFixed(1)}%"></i></span>
      <p class="fr-s">${esc(x.say || '')}${x.term ? `<span class="fr-t"> · ${esc(x.term)}</span>` : ''}</p>
    </li>`).join('');
    return card({ id: 'drivers', title: '무엇이 판단을 움직였나', sub: '점수에 더하고 뺀 몫, 큰 순서', body: `<ul class="frs">${rows}</ul>` });
  }
  function profileCard(sym, H, it) {
    const P = H.profile;
    if (!P) return '';
    const drv = (P.drivers || []).map((k) => {
      const x = it && it.fs ? it.fs[k] : null, f = x && !x.na ? x.f : null, st = stateOf(f);
      const nm = ((ENG() || {}).factors || []).find((F) => F.k === k);
      return `<span class="drv ${st}">${esc(nm ? nm.name : k)}${st ? `<b>${STATE_WORD[st]}</b>` : ''}</span>`;
    }).join('');
    return card({ id: 'about', title: '어떤 회사인가', body: `
      <p class="ab-w">${tpl(P.what)}</p>
      <ul class="bul">${(P.biz || []).map((b) => `<li>${tpl(b.t || b)}${b.src ? srcLinks(b.src) : ''}</li>`).join('')}</ul>
      ${P.money ? `<p class="ab-m">${tpl(P.money)}</p>` : ''}
      ${drv ? `<div class="drvs"><span class="k">주가를 움직이는 변수 · 오늘</span>${drv}</div>` : ''}` });
  }
  function outlookCard(sym, H) {
    const st = H.strategy || {}, n = (S.P.naver || {})[sym] || {}, q = Q(sym) || {};
    const rows = [];
    if (isKR(sym)) {
      if (isNum(n.eps) && sym !== '005935.KS') rows.push(`<div class="val-row"><span>증권사 평균 올해 예상 주당순이익</span><b class="num">${nf(n.eps)}원</b></div>`);
      if (isNum(n.target) && isNum(q.price)) rows.push(`<div class="val-row"><span>증권사 평균 목표가${n.cns_date ? ` <span class="tiny muted">${esc(String(n.cns_date).slice(5).replace('-', '/'))}</span>` : ''}</span><b class="num">${px(sym, n.target)} <span class="tiny ${dir(n.target / q.price - 1)}">${sgn((n.target / q.price - 1) * 100, 0)}</span></b></div>`);
      if (isNum(n.recomm)) rows.push(`<div class="val-row"><span>애널리스트 평균 의견</span><b>${esc(opinion(n.recomm, 'naver'))} <span class="tiny muted">${nf(n.recomm, 2)}/5</span></b></div>`);
    } else {
      if (isNum(q.tgt) && isNum(q.price)) rows.push(`<div class="val-row"><span>애널리스트 평균 목표가</span><b class="num">${px(sym, q.tgt)} <span class="tiny ${dir(q.tgt / q.price - 1)}">${sgn((q.tgt / q.price - 1) * 100, 0)}</span></b></div>`);
      if (isNum(q.rec)) rows.push(`<div class="val-row"><span>애널리스트 평균 의견</span><b>${esc(opinion(q.rec, 'tv'))} <span class="tiny muted">${nf(q.rec, 2)}</span></b></div>`);
    }
    const out = (st.outlook || []).map((o) => `<div class="scn ${esc(o.id || '')}${o.weight ? ' weight' : ''}"><h3>${esc(o.name)}${o.weight ? '<span class="pill">지금 무게</span>' : ''}</h3><p>${tpl(o.t)}</p></div>`).join('');
    const nx = nextFor(sym, 4).filter((e) => !evInfo(e).past);
    return card({ id: 'outlook', title: '전망', right: tag('forecast'), body: `
      ${H.outlook_note ? `<p class="ab-m">${tpl(H.outlook_note)}</p>` : ''}
      ${rows.length ? `<div class="vals">${rows.join('')}</div><p class="note">목표가는 하락장에서 늦게 내려옵니다. 매도 기준이 아니라 시장 기대의 높이로만 봅니다.</p>` : ''}
      ${out ? `<div class="subh">2027년 시나리오 ${tag('view')}</div><div class="scns">${out}</div>` : ''}
      ${nx.length ? `<div class="subh">다음 확인 일정</div><ul class="evlist compact">${nx.map((e) => evRow(e)).join('')}</ul>` : ''}` });
  }
  function eventsIfCard(H) {
    const plan = (H.strategy && H.strategy.plan) || [];
    if (!plan.length) return '';
    return card({ id: 'ifthen', title: '판단을 바꿀 사건', sub: '이런 일이 생기면 이렇게 합니다', right: tag('view'), body: `<ul class="ift">${plan.map((x) => `<li><p class="ift-if">${tpl(x.if)}</p><p class="ift-then">${tpl(x.then)}</p></li>`).join('')}</ul>` });
  }
  function numbersCard(sym, q, H, pos) {
    const pl = pos.qty > 0 && pos.avg > 0 ? (q.price / pos.avg - 1) * 100 : null;
    const gap50 = isNum(q.ma50) ? (q.price / q.ma50 - 1) * 100 : null;
    return card({ id: 'numbers', title: '숫자로 보기', body: `<div class="kv">
        <div><span>1주</span><b class="num ${dir(q.w1)}">${sgn(q.w1, 1)}</b></div>
        <div><span>1개월</span><b class="num ${dir(q.m1)}">${sgn(q.m1, 1)}</b></div>
        <div><span>3개월</span><b class="num ${dir(q.m3)}">${sgn(q.m3, 1)}</b></div>
        <div><span>연초 대비</span><b class="num ${dir(q.ytd)}">${sgn(q.ytd, 1)}</b></div>
        <div><span>52주 최고 대비</span><b class="num ${dir(q.dd)}">${sgn(q.dd, 1)}</b></div>
        <div><span>50일 평균 대비</span><b class="num ${dir(gap50)}">${sgn(gap50, 1)}</b></div>
      </div>${pl != null ? `<p class="ab-m">내 평균단가 ${px(sym, pos.avg)} 대비 <b class="${dir(pl)}">${sgn(pl, 1)}</b> · ${nf(pos.qty)}주</p>` : ''}${valBlock(sym, q, H)}` });
  }
  function stockDetail(sym) {
    const q = Q(sym), H = (S.R.holdings || {})[sym] || {}, pos = S.pos[sym] || {}, it = EI(sym);
    if (!q) return card({ body: `<p class="empty">${esc(NAME[sym])} 시세를 아직 받지 못했습니다</p>` });
    const ex = extTxt(sym, q);
    const rng = isNum(q.hi52) && isNum(q.lo52) && q.hi52 > q.lo52 ? q.hi52 - q.lo52 : null;
    const at = (v) => (rng ? Math.max(0, Math.min(100, ((v - q.lo52) / rng) * 100)) : 50);
    const top = `<section class="card sk" style="--slot:${SLOT[sym]}">
      <div class="sk-top"><div class="sk-id"><h2>${esc(NAME[sym])}<span class="sk-code">${esc(CODE[sym])}</span></h2><p>${esc(H.role || '')}</p></div>${it ? `<span class="call lg ${esc(it.level.tone)}">${esc(it.level.name)}</span>` : ''}</div>
      <div class="sk-px"><b class="num">${px(sym, q.price)}</b><span class="num ${chgDir(sym, q)}">${chgText(sym, q)}</span></div>
      <p class="sk-m">${esc(qTime(q))}${ex ? ' · ' + ex : ''}</p>
      ${rng ? `<div class="range" aria-label="52주 범위"><div class="bar"></div>${pos.avg > 0 ? `<div class="rf" style="left:${at(pos.avg).toFixed(1)}%" title="내 평균단가"></div>` : ''}<div class="mk" style="left:${at(q.price).toFixed(1)}%"></div></div>
      <div class="range-lb"><span>52주 최저 ${px(sym, q.lo52)}</span><span>최고 ${px(sym, q.hi52)}</span></div>` : ''}
    </section>`;
    return top + verdictCard(sym, it) + planCard(sym, it, q, H, pos) + driversCard(it) + profileCard(sym, H, it) + outlookCard(sym, H) + eventsIfCard(H) + numbersCard(sym, q, H, pos);
  }
  function vStocks() {
    const sym = HOLD.includes(S.stock) ? S.stock : HOLD[0];
    const chips = HOLD.map((s) => { const q = Q(s), it = EI(s); return `<button class="chipbtn" aria-pressed="${s === sym}" data-stock="${esc(s)}">${it ? `<i class="tdot ${esc(it.level.tone)}"></i>` : ''}<span>${esc(SHORT_NAME[s])}</span>${q ? `<span class="num ${chgDir(s, q)}">${chgText(s, q)}</span>` : ''}</button>`; }).join('');
    return `<div class="chips" role="group" aria-label="종목 선택">${chips}</div>` + (S.editPos ? posEditor() : '') + pfMini() + stockDetail(sym);
  }

  // ---------------------------------------------------------------- 시장
  function policyCard() {
    const M = S.R.macro || {}, fed = M.fed || {}, bok = M.bok || {}, kr = Q('KR_RATE'), us = Q('US_RATE');
    const live = !!(kr || us);
    const row = (name, now, chg, o, nextTxt) => `<div class="pr">
      <div class="pr-h"><span class="pr-n">${esc(name)}</span><b class="pr-v num">${esc(now)}</b></div>
      ${chg ? `<p class="pr-c">${esc(chg)}</p>` : ''}
      ${o.t ? `<p class="pr-t">${tag('fact')} ${esc(o.t)}</p>` : ''}
      ${o.market ? `<p class="pr-t">${tag('forecast')} ${esc(o.market)}</p>` : ''}
      ${nextTxt ? `<p class="pr-x">${esc(nextTxt)}</p>` : ''}${srcLinks(o.src)}
    </div>`;
    const dd = ddays(fed.next);
    const fedNext = fed.next ? `다음 결정 ${mdw(parseKST(fed.next))}${isNum(dd) && dd >= 0 ? ' · D-' + dd : ''}` : '';
    const bokNext = bok.next ? `다음 결정 ${mdw(parseKST(bok.next))}` : bok.next_label ? `다음 결정 ${bok.next_label}` : '';
    return card({ id: 'rates', title: '정책금리', sub: live ? '실시간 값 · TradingView' : '분석 자료 기준', body:
      row('한국은행', kr && isNum(kr.price) ? nf(kr.price, 2) + '%' : bok.now || '-', rateChg(kr, 'KRINTR'), bok, bokNext) +
      row('미국 연준', us && isNum(us.price) ? `${nf(us.price - 0.25, 2)}~${nf(us.price, 2)}%` : fed.now || '-', rateChg(us, 'USINTR'), fed, fedNext) });
  }
  const SIG_PLAIN = { vix: '변동성 지수(VIX)', sox: '반도체지수, 50일 평균 대비', kospi: '코스피, 50일 평균 대비', nvda: '엔비디아, 50일 평균 대비', us10y: '미국 10년물 금리', credit: '하이일드 채권, 50일 평균 대비', dram: 'DDR5 현물, 약 4주 변화' };
  function stressCard() {
    const P = S.P, st = stressNow(), sig = st.sig || [], score = st.score, lc = levelCls(score);
    const rows = sig.map((x) => `<li class="sg">${badge(x.status)}<span class="sg-n">${esc(SIG_PLAIN[x.id] || x.label)}</span><b class="num">${fmtSig(x)}</b><span class="sg-r">${esc(x.rule || '')}</span></li>`).join('');
    const hist = ((P.history || {}).stress || []).filter((h) => isNum(h.v)).map((h) => ({ t: dUTC(h.d), v: h.v }));
    const chart = hist.length >= 3 ? '<div class="subh">최근 기록</div>' + slot({ type: 'line', height: 130, series: [{ name: '시장 공포', color: 'var(--s1)', data: hist }], yList: [0, 30, 55, 75, 100], yFmt: (v) => nf(v), aria: '시장 공포 지수 기록' }) : '';
    return card({ id: 'stress', title: '시장 공포', sub: '위험 신호 7개 평균 · 0 안정에서 100 극단', body: `
      <div class="meter-wrap">
        <div class="meter-top"><span class="meter-score num">${isNum(score) ? score : '-'}</span><span class="meter-level">${esc(st.level || '데이터 없음')}</span></div>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${isNum(score) ? score : 0}" aria-label="시장 공포"><i style="width:${isNum(score) ? score : 0}%;background:${LVCOLOR[lc]}"></i></div>
        <div class="meter-scale"><span>안정</span><span>긴장</span><span>공포</span><span>극단</span></div>
      </div>
      <ul class="sgs">${rows || '<li class="empty">신호 데이터가 없습니다</li>'}</ul>
      ${chart}
      <p class="note">높을수록 시장이 위험을 피하고 있다는 뜻입니다. 매매 신호가 아니라 속도를 조절하는 계기판으로 씁니다.</p>` });
  }
  const TILE_NAME = { '^KS11': '코스피', '^SOX': '반도체지수', '^IXIC': '나스닥', '^VIX': 'VIX(변동성)', '^TNX': '미국 10년물', 'KRW=X': '원/달러', 'CL=F': 'WTI 유가' };
  function tile(sym) {
    const q = Q(sym);
    if (!q) return '';
    let wk = '';
    if (RATE.has(sym)) { const b = backVal(sym, 5); wk = isNum(b) ? '1주 ' + bp(q.price - b) : ''; } else if (isNum(q.w1)) wk = '1주 ' + sgn(q.w1, 1);
    return `<div class="tile"><span class="lb">${esc(TILE_NAME[sym] || NAME[sym])}</span><span class="vl num">${px(sym, q.price)}</span><span class="dl num"><span class="${chgDir(sym, q)}">${chgText(sym, q)}</span><span class="muted">${wk ? ' · ' + esc(wk) : ''}</span></span><span class="sp">${spark(lastN(SER(sym), 63))}</span></div>`;
  }
  function pricesCard() {
    return card({ id: 'prices', title: '주요 시세', sub: '작은 선은 최근 3개월', body: `<div class="tiles">${['^KS11', '^SOX', '^IXIC', '^VIX', '^TNX', 'KRW=X', 'CL=F'].map(tile).join('')}${dramTile()}</div>` });
  }
  function heatCard(E) {
    const cols = HOLD.filter((s) => E.items[s]);
    const rows = E.factors.filter((F) => cols.some((s) => isNum(E.items[s].contrib[F.k])));
    const cell = (s, F) => {
      const v = E.items[s].contrib[F.k];
      if (!isNum(v)) return '<td class="na">·</td>';
      if (Math.abs(v) < 0.5) return '<td class="z">0</td>';
      const a = Math.min(1, Math.abs(v) / 25), x = E.items[s].fs[F.k] || {};
      return `<td class="${v >= 0 ? 'pos' : 'neg'}" style="--a:${(0.1 + a * 0.62).toFixed(2)}" title="${esc(NAME[s] + ' · ' + F.name + ': ' + (x.say || x.txt || ''))}">${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${nf(Math.abs(v), 0)}</td>`;
    };
    const body = rows.map((F) => `<tr><th scope="row">${esc(F.name)}</th>${cols.map((s) => cell(s, F)).join('')}</tr>`).join('');
    const foot = `<tr class="tot"><th scope="row">점수</th>${cols.map((s) => `<td>${E.items[s].score > 0 ? '+' : ''}${E.items[s].score}</td>`).join('')}</tr>`;
    return card({ id: 'heat', title: '변수가 종목을 미는 힘', sub: '초록은 사는 쪽, 주황은 파는 쪽 · 점수에 더한 몫', body: `<div class="tbl-wrap"><table class="heat"><thead><tr><th></th>${cols.map((s) => `<th scope="col">${esc(SHORT[s])}</th>`).join('')}</tr></thead><tbody>${body}${foot}</tbody></table></div>
      <p class="note">같은 변수라도 종목마다 무게가 다릅니다. 금리는 AMD에, D램 값은 원익IPS에 가장 크게 작동합니다.</p>` });
  }
  function ratesFxCard() {
    const fed = (S.R.macro || {}).fed || {};
    const a = slot({ type: 'line', height: 200, series: [
      { name: '10년물', color: 'var(--s1)', data: SER('^TNX') },
      { name: '5년물', color: 'var(--s2)', data: SER('^FVX') },
      { name: '3개월물', color: 'var(--s3)', data: SER('^IRX') }
    ], band: isNum(fed.lo) ? { lo: fed.lo, hi: fed.hi, from: dUTC('2026-10-28'), label: '연준 ' + (fed.now || '') } : null, yFmt: (v) => nf(v, 2) + '%', aria: '미국 국채 금리 1년' });
    const b = slot({ type: 'line', height: 170, area: true, series: [{ name: '원/달러', color: 'var(--s1)', data: SER('KRW=X') }], yFmt: (v) => nf(v), tipFmt: (v) => nf(v, 1) + '원', aria: '원달러 환율 1년' });
    return card({ id: 'fx', title: '금리와 환율 1년', body: `<div class="subh first">미국 국채 금리</div>
      <div class="legend"><span><i class="lk" style="background:var(--s1)"></i>10년물</span><span><i class="lk" style="background:var(--s2)"></i>5년물</span><span><i class="lk" style="background:var(--s3)"></i>3개월물</span></div>
      ${a}<p class="note">회색 띠는 연준 목표 범위입니다. 3개월물이 띠보다 위면 시장이 추가 인상을 예상한다는 뜻입니다.</p>
      <div class="subh">원/달러</div>${b}` });
  }
  function bgCard() {
    const st = S.R.stance || {};
    const pts = (st.points || []).map((x) => `<li>${tag(x.k)}<div>${tpl(x.t)}${srcLinks(x.src)}</div></li>`).join('');
    if (!pts) return '';
    return card({ id: 'bg', title: '배경 정리', sub: esc(S.R.as_of_label || ''), body: `${st.headline ? `<p class="ab-w">${tpl(st.headline)}</p>` : ''}<ul class="pts">${pts}</ul>` });
  }
  function vMarket() {
    const E = ENG();
    return vhead('시장', '판단에 쓰는 대내외 변수') + policyCard() + stressCard() + pricesCard() + (E ? heatCard(E) : '') + spotCard('') + checklistCard('') + ratesFxCard() + bgCard();
  }

  // ---------------------------------------------------------------- 일정
  function vAgenda() {
    const cal = S.R.calendar || [], srcs = S.R.sources || {};
    const up = [], past = [];
    cal.forEach((e) => { const I = evInfo(e); if (I.past || (I.dd != null && I.dd < 0)) past.push(e); else up.push(e); });
    past.reverse();
    const ev = (S.R.events || []).slice(0, 8);
    const gl = (S.R.glossary || []).map((g) => `<div class="gl-i"><dt>${esc(g.w)}</dt><dd>${esc(g.t)}</dd></div>`).join('');
    return vhead('일정', '내 종목에 영향을 주는 일정과 결과') +
      card({ id: 'upcoming', title: '다가오는 일정', sub: '한국 시간 · 관련 종목 표시', body: `<ul class="evlist">${up.map((e) => evRow(e, { notes: true })).join('') || '<li class="empty">예정된 일정이 없습니다</li>'}</ul>` }) +
      (past.length ? card({ id: 'past', title: '지난 일정과 결과', body: `<ul class="evlist">${past.slice(0, 8).map((e) => evRow(e)).join('')}</ul>` }) : '') +
      card({ id: 'events', title: '최근 사건', sub: '최신순 · 주가가 움직인 이유', body: `<ul class="tl">${ev.map((e) => `<li><span class="dt num">${esc(e.d)}</span><div><h3>${tag(e.k)} ${esc(e.title)}</h3><p>${tpl(e.body)}</p>${srcLinks(e.src)}</div></li>`).join('')}</ul>` }) +
      card({ id: 'glossary', title: '용어 풀이', body: `<dl class="gl">${gl}</dl><p class="note">${tag('fact')} 공시나 보도로 확인 ${tag('forecast')} 기관이나 회사의 전망 ${tag('view')} 이 페이지의 판단 ${tag('report')} 보도의 해석</p>` }) +
      `<details class="card more"><summary>출처 ${Object.keys(srcs).length}개</summary><ul class="src-list">${Object.keys(srcs).map((k) => `<li><a href="${esc(srcs[k].u)}" target="_blank" rel="noopener">${esc(srcs[k].n)}</a></li>`).join('')}</ul></details>`;
  }

  // ================================================================ 11. 렌더·라우팅
  function renderStatus() {
    const el = document.getElementById('statusBar');
    if (!el) return;
    const P = S.P, ts = P.updated_ts ? P.updated_ts * 1000 : parseKST(P.updated_at), ss = sessions();
    const liveOk = S.liveAt && Date.now() - S.liveAt < 15 * 60e3;
    const t = liveOk ? `시세 ${hm(S.liveAt)} · 국내 20분·미국 15분 지연` : `서버 ${ts ? mdw(ts) + ' ' + hm(ts) : '-'} 기준${S.liveErr ? ' · 실시간 연결 실패' : ''}`;
    el.innerHTML = `<span class="sl"><i class="dot ${liveOk ? 'good' : S.liveErr ? 'warn' : 'idle'}"></i>${esc(t)}</span><span class="sl">코스피 ${esc(ss.kr)} · 미국 ${esc(ss.us)}</span>`;
  }
  function render() {
    CH.clear();
    hideTip();
    const fn = { today: vToday, stocks: vStocks, market: vMarket, agenda: vAgenda }[S.view] || vToday;
    const main = document.getElementById('view');
    main.innerHTML = fn() + footer();
    mountCharts();
    bindTips(main);
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.getAttribute('data-view') === S.view)));
    document.title = ((VIEWS.find((v) => v.id === S.view) || {}).label || '오늘') + ' · 반도체 브리핑';
    renderStatus();
  }
  function parseHash() {
    const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    const i = h.indexOf('/');
    let v = i >= 0 ? h.slice(0, i) : h;
    const a = i >= 0 ? h.slice(i + 1) : null;
    if (v === 'today' && a === 'stress') v = 'market';
    v = LEGACY[v] || v;
    return { v: VIEWS.some((x) => x.id === v) ? v : null, a };
  }
  function applyRoute(scroll) {
    const r = parseHash();
    S.view = r.v || 'today';
    if (S.view === 'stocks' && r.a && HOLD.includes(r.a)) S.stock = r.a;
    render();
    if (r.a && S.view !== 'stocks') {
      const t = document.getElementById(r.a);
      if (t) { t.scrollIntoView({ block: 'start' }); window.scrollBy(0, -76); return; }
    }
    if (scroll) window.scrollTo(0, 0);
  }
  function go(hash) { if (location.hash === '#' + hash) applyRoute(true); else location.hash = hash; }

  // ---------------------------------------------------------------- 기존 조각(검증된 계산·표)
  function shortPx(sym, v) {
    if (!isNum(v)) return '-';
    if (!isKR(sym)) return '$' + nf(v, 0);
    if (v < 1e4) return nf(v);
    const m = v / 1e4;
    return nf(m, Math.abs(m - Math.round(m)) < 1e-9 ? 0 : 1) + '만';
  }
  function extTxt(sym, q) {
    if (!q || !q.ext || !isNum(q.ext.price)) return '';
    return `<span class="ext">${esc(q.ext.label)} ${px(sym, q.ext.price)} <b class="${dir(q.ext.pct)}">${sgn(q.ext.pct, 1)}</b></span>`;
  }
  function nextFor(sym, n) {
    return (S.R.calendar || []).filter((e) => (e.for || []).indexOf(sym) >= 0 && (ddays(e.d) == null || ddays(e.d) >= 0)).slice(0, n || 1);
  }
  function whenTxt(e) {
    const dd = ddays(e.d), firm = e.firm !== false && !e.approx;
    if (!firm) return e.approx || sdate(dUTC(e.d)) + ' 무렵';
    return (dd === 0 ? '오늘' : 'D-' + dd) + ' · ' + sdate(dUTC(e.d));
  }
  function portfolio() {
    const fx = (Q('KRW=X') || {}).price, rows = [];
    let val = 0, cost = 0, day = 0, hasCost = false;
    HOLD.forEach((s) => {
      const p = S.pos[s], q = Q(s);
      if (!p || !(p.qty > 0) || !q || !isNum(q.price)) return;
      const k = isKR(s) ? 1 : fx;
      if (!isNum(k)) return;
      const v = p.qty * q.price * k, d = isNum(q.prev) ? p.qty * (q.price - q.prev) * k : 0;
      const c0 = p.avg > 0 ? p.qty * p.avg * k : null;
      rows.push({ s, v, d, c: c0, pl: c0 != null ? v - c0 : null, plp: c0 ? (v / c0 - 1) * 100 : null });
      val += v; day += d;
      if (c0 != null) { cost += c0; hasCost = true; }
    });
    return { rows, val, day, cost: hasCost ? cost : null, pl: hasCost ? val - cost : null, fx };
  }
  function stressNow() {
    const P = S.P, base = P.signals || [], st0 = P.stress || {}, E = ENG(), mk = E && E.market ? E.market.market : null;
    if (!mk || !isNum(mk.S)) return Object.assign({}, st0, { sig: base, live: false });
    const by = {};
    (mk.sig || []).forEach((x) => { by[x.id] = x; });
    const sig = base.map((x) => {
      const y = by[x.id];
      if (!y || (x.id === 'credit' && x.unit !== '%')) return x;
      const o = Object.assign({}, x, { value: y.value, score: y.score, status: y.status, live: true });
      if (x.id === 'dram' && y.age) o.label = `DDR5 현물 ${y.age}일 변화`;
      return o;
    });
    const counts = { ok: 0, watch: 0, warn: 0 };
    sig.forEach((x) => { if (counts[x.status] != null) counts[x.status] += 1; });
    return { sig, score: mk.S, level: mk.level, counts, live: !!S.liveAt };
  }
  function dramTile() {
    const d = (S.P.dram || {}).ddr5_16g;
    if (!d) return '';
    const h = dramHist('ddr5_16g');
    return `<a class="tile" href="#market/spot">
      <span class="lb">DDR5 16Gb 현물</span>
      <span class="vl">$${nf(d.price, 2)}</span>
      <span class="dl ${dir(d.chg_pct)}">${sgn(d.chg_pct)}<span class="muted"> · 전일 대비</span></span>
      <span class="sp">${h.length >= 3 ? spark(h) : ''}</span>
      <span class="ft">DRAMeXchange ${d.updated ? esc(mdw(parseKST(d.updated))) : ''}${d.stale ? ' · 이전 값' : ''}</span>
    </a>`;
  }
  const SPOT_ORDER = ['ddr5_16g', 'ddr4_16g', 'ddr4_8g', 'ddr5_16g_ett', 'ddr5_udimm_16gb', 'ddr5_rdimm_32gb', 'ddr4_udimm_16gb', 'gddr6_8gb', 'nand_tlc_512gb'];
  function spotCard(c) {
    const D = S.P.dram || {};
    const rows = SPOT_ORDER.filter((k) => D[k]).map((k) => {
      const d = D[k], wk = d.kind !== 'chip';
      return `<tr><td class="l"><span class="nm">${esc(d.label)}</span>${k === 'ddr5_16g' ? ' <span class="pill">기준</span>' : ''}</td>
        <td>$${nf(d.price, d.price >= 100 ? 2 : 3)}</td>
        <td class="${dir(d.chg_pct)}">${sgn(d.chg_pct)}</td>
        <td class="hide-m">${wk ? '전주' : '전일'}</td>
        <td class="hide-m">${isNum(d.lo) && isNum(d.hi) ? '$' + nf(d.lo, 2) + '~' + nf(d.hi, 2) : '-'}</td></tr>`;
    }).join('');
    const ins = [];
    const d5 = D.ddr5_16g, d4 = D.ddr4_16g, rd = D.ddr5_rdimm_32gb;
    if (d5 && d4 && d4.price > d5.price) ins.push(`DDR4 16Gb($${nf(d4.price, 2)})가 DDR5 16Gb($${nf(d5.price, 2)})보다 비쌉니다. 단종을 앞둔 구형 제품의 품귀가 이어지고 있다는 뜻입니다.`);
    if (rd && isNum(rd.chg_pct) && rd.chg_pct <= -2) ins.push(`서버용 DDR5 RDIMM 32GB 모듈이 한 주 ${nf(rd.chg_pct, 2)}% 움직였습니다. 서버 쪽 현물 약세가 계약가로 번지는지 확인할 대목입니다.`);
    if (d5 && isNum(d5.hi) && isNum(d5.lo) && d5.hi / d5.lo > 1.3) ins.push(`DDR5 16Gb의 같은 날 거래 범위가 $${nf(d5.lo, 2)}~$${nf(d5.hi, 2)}로 넓습니다. 거래처마다 값 차이가 크다는 뜻이라 평균 하나로 단정하기 어렵습니다.`);
    const h = dramHist('ddr5_16g'), seeds = h.some((p) => p.seed);
    const chart = h.length >= 3 ? `<div class="subh">DDR5 16Gb 현물 기록</div>` + slot({ type: 'line', height: 170, area: true, series: [{ name: 'DDR5 16Gb', color: 'var(--s1)', data: h, marks: true }], yFmt: (v) => '$' + nf(v, 1), tipFmt: (v) => '$' + nf(v, 3), aria: 'DDR5 16Gb 현물가 기록' }) +
      `<p class="note">매 갱신마다 쌓입니다.${seeds ? ' 속이 빈 점은 DRAMeXchange 수치를 인용한 보도 기준 값입니다.' : ''}</p>` : `<p class="note mt12">현물가 기록은 갱신될 때마다 쌓이고, 3개 이상이 되면 추이를 그립니다.</p>`;
    const st = (S.P.dram_stamps || {});
    return `<section class="card ${c}" id="spot">
      <div class="ch"><h3>메모리 현물가</h3><span class="sub">DRAMeXchange · 칩 ${st.chip ? esc(mdw(parseKST(st.chip.time)) + ' ' + hm(parseKST(st.chip.time))) : '-'} · 모듈 ${st.module ? esc(mdw(parseKST(st.module.time))) : '-'}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>품목</th><th>평균가</th><th>변동</th><th class="hide-m">기준</th><th class="hide-m">거래 범위</th></tr></thead><tbody>${rows || '<tr><td class="l" colspan="5">현물가를 가져오지 못했습니다</td></tr>'}</tbody></table></div>
      ${ins.length ? `<ul class="facts mt12">${ins.map((t) => `<li>${tag('view')}<div>${esc(t)}</div></li>`).join('')}</ul>` : ''}
      ${chart}
      ${srcLinks(['dramx'])}
    </section>`;
  }
  function checklistCard(c) {
    const L = (S.R.cycle || {}).peak_checklist || [], D = S.P.dram || {};
    const on = L.filter((x) => x.status === 'on').length;
    return `<section class="card ${c}">
      <div class="ch"><h3>메모리 사이클 정점 신호</h3><span class="sub">${L.length}개 중 ${on}개 켜짐</span></div>
      <ul class="chk">${L.map((x) => {
        let live = '';
        if (x.live === 'dram' && D.ddr5_16g) live = ` 현재 DDR5 16Gb $${nf(D.ddr5_16g.price, 2)}(${sgn(D.ddr5_16g.chg_pct)}).`;
        const tt = String(x.t || '').trim(), dot = live && !/[.!?]$/.test(tt) ? '.' : '';
        return `<li>${badge(x.status)}<div><h4>${esc(x.item)}</h4><p>${tpl(tt)}${dot}${esc(live)}</p>${srcLinks(x.src)}</div></li>`;
      }).join('')}</ul>
      <p class="note mt8">켜짐은 정점 쪽 신호가 나타났다는 뜻, 완충은 하락 충격을 줄여 주는 요인입니다.</p>
    </section>`;
  }
  function valBlock(sym, q, H) {
    const V = H.val || {};
    if (V.type === 'pref') {
      const c = Q('005930.KS');
      const disc = c && c.price ? (1 - q.price / c.price) * 100 : null;
      const dps = (V.dps_parts || []).reduce((a, b) => a + b, 0);
      const per = (amt) => amt / V.shares_total;
      const rows = [0, 0.5, 1].map((r) => {
        const lo = per(V.remain_lo * r), hi = per(V.remain_hi * r);
        const tl = dps + lo, th = dps + hi;
        return `<tr><td class="l">${r === 0 ? '전부 자사주' : r === 1 ? '전부 배당' : '절반씩'}</td><td class="hide-m">${r === 0 ? '0원' : nf(lo) + '~' + nf(hi) + '원'}</td><td>${r === 0 ? nf(tl) : nf(tl) + '~' + nf(th)}원</td><td>${r === 0 ? nf((tl / q.price) * 100, 1) : nf((tl / q.price) * 100, 1) + '~' + nf((th / q.price) * 100, 1)}%</td></tr>`;
      }).join('');
      const cs = SER('005930.KS'), ps = SER('005935.KS'), cm = new Map(cs.map((p) => [p.t, p.v]));
      const dser = ps.filter((p) => cm.has(p.t)).map((p) => ({ t: p.t, v: (1 - p.v / cm.get(p.t)) * 100 }));
      const avg = dser.length ? dser.reduce((s, p) => s + p.v, 0) / dser.length : null;
      return `<div class="subh">우선주로 보는 숫자 <span class="tiny muted">실시간 계산</span></div>
        <div class="val-row"><span>보통주 대비 할인율</span><b>${isNum(disc) ? nf(disc, 1) + '%' : '-'}</b></div>
        <div class="val-row"><span>2026년 확정 배당 ${nf(dps)}원 기준 시가배당률</span><b>${nf((dps / q.price) * 100, 2)}%</b></div>
        ${dser.length > 20 ? `<div class="subh">할인율 1년 추이</div>` + slot({ type: 'line', height: 150, area: false, series: [{ name: '할인율', color: 'var(--s1)', data: dser }], refs: isNum(avg) ? [{ v: avg, label: '1년 평균 ' + nf(avg, 1) + '%' }] : [], yFmt: (v) => nf(v, 0) + '%', tipFmt: (v) => nf(v, 1) + '%', aria: '우선주 할인율 1년 추이' }) : ''}
        <div class="subh">1월 말 이사회 배분에 따른 2026년 배당 ${tag('view')}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>잔여 55~75조 배분</th><th class="hide-m">4분기 추가 배당</th><th>연간 배당</th><th>현재가 기준</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="note mt8">자사주를 뺀 보통주·우선주 합계 약 ${nf(V.shares_total / 1e8, 1)}억 주 기준 단순 계산입니다. 실제 배분은 회사가 정합니다.</p>`;
    }
    if (V.type === 'mcap_op') {
      const sv = secVal();
      const tg = (V.targets || []).map((t) => `<div class="val-row"><span>${esc(t.n)} 목표가 ${px(sym, t.p)} <span class="tiny muted">${esc(t.d)}</span></span><b class="${dir(t.p / q.price - 1)}">${sgn((t.p / q.price - 1) * 100, 1)}</b></div>`).join('');
      return `<div class="subh">밸류에이션 <span class="tiny muted">실시간 계산</span></div>
        <div class="val-row"><span>시가총액(보통주+우선주, 근사)</span><b>${sv ? krw(sv.mcap) : '-'}</b></div>
        <div class="val-row"><span>3분기 영업이익 × 4</span><b>${sv ? krw(sv.op) : '-'}</b></div>
        <div class="val-row"><span>시총 ÷ 연환산 영업이익</span><b>${sv ? nf(sv.x, 2) + '배' : '-'}</b></div>
        ${tg}
        <p class="note mt8">목표가는 기관 전망이며 2주 사이 크게 바뀌었습니다. 매도 기준이 아니라 시장 분위기를 읽는 참고로만 씁니다.</p>`;
    }
    if (V.type === 'pe') {
      const kr = isKR(sym), epsTxt = (v) => (kr ? nf(v) + '원' : '$' + nf(v, 2));
      const rows = (V.eps || []).map((e) => `<div class="val-row"><span>${esc(e.y)} 주당순이익 ${epsTxt(e.v)} 기준 PER</span><b>${nf(q.price / e.v, 1)}배</b></div>`).join('');
      const base = (V.eps || [])[isNum(V.band) ? V.band : (V.eps || []).length - 1] || (V.eps || [])[0];
      const bands = base ? (V.bands || []).map((m) => { const p = base.v * m; return `<div class="val-row"><span>${esc(base.y)} 이익의 ${m}배</span><b>${px(sym, p)} <span class="${dir(p / q.price - 1)} tiny">${sgn((p / q.price - 1) * 100, 1)}</span></b></div>`; }).join('') : '';
      let extra = '';
      if (V.mcap_op) { const sv = secVal(); if (sv) extra += `<div class="val-row"><span>시가총액(보통주+우선주) ÷ 3분기 영업이익×4</span><b>${nf(sv.x, 2)}배</b></div>`; }
      if (V.shares && V.cns && V.cns.op) extra += `<div class="val-row"><span>시가총액 ${krw(q.price * V.shares)} ÷ 올해 예상 영업이익 ${krw(V.cns.op)}</span><b>${nf((q.price * V.shares) / V.cns.op, 1)}배</b></div>`;
      if (V.cns && V.cns.q4op) extra += `<div class="val-row"><span>4분기 예상 영업이익 (3분기 실제 ${nf((((S.R.cycle || {}).valuation || {}).samsung_op_q || 0) / 1e12, 1)}조)</span><b>${nf(V.cns.q4op / 1e12, 1)}조원</b></div>`;
      (V.targets || []).forEach((t) => { extra += `<div class="val-row"><span>${esc(t.n)} 목표가 ${px(sym, t.p)} <span class="tiny muted">${esc(t.d)}</span></span><b class="${dir(t.p / q.price - 1)}">${sgn((t.p / q.price - 1) * 100, 1)}</b></div>`; });
      return `<div class="subh">밸류에이션 <span class="tiny muted">실시간 계산</span></div>${rows}${extra}
        <div class="subh">이익 배수로 본 가격대 ${tag('view')}</div>${bands}
        <p class="note mt8">${V.cns_note ? esc(V.cns_note) + ' ' : ''}전망이 바뀌면 이 숫자도 바뀝니다. 같은 배수를 주가 차트의 가로선으로 표시했습니다.</p>${V.band_src ? srcLinks([V.band_src], '전망 출처') : ''}`;
    }
    if (V.type === 'op') {
      return `<div class="subh">숫자로 보기</div>
        <div class="val-row"><span>3분기 영업이익 × 4 (연환산)</span><b>${krw(V.op_q * 4)}</b></div>
        <p class="note mt8">발행 주식 수를 확인하지 못해 배수는 계산하지 않았습니다.</p>`;
    }
    return '';
  }
  function posEditor() {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(S.pos))));
    return `<section class="card c12" id="posEditor">
      <div class="ch"><h3>보유 수량과 평균단가</h3><span class="sub">이 기기의 브라우저에만 저장됩니다</span></div>
      <div class="form-grid">
        <span class="hd2">종목</span><span class="hd2">수량(주)</span><span class="hd2">평균단가(원 또는 $)</span>
        ${HOLD.map((s) => { const p = S.pos[s] || {}; return `<span class="strong">${esc(NAME[s])}</span>
          <input class="inp" inputmode="decimal" data-sym="${esc(s)}" data-f="qty" value="${isNum(p.qty) ? p.qty : ''}" placeholder="0" aria-label="${esc(NAME[s])} 수량">
          <input class="inp" inputmode="decimal" data-sym="${esc(s)}" data-f="avg" value="${isNum(p.avg) ? p.avg : ''}" placeholder="${isKR(s) ? '원' : '$'}" aria-label="${esc(NAME[s])} 평균단가">`; }).join('')}
      </div>
      <div class="row-btns"><button class="btn primary" data-act="pos-save">저장</button><button class="btn" data-act="pos-close">닫기</button><button class="btn" data-act="pos-clear">모두 지우기</button></div>
      <div class="divider"></div>
      <div class="small strong">다른 기기로 옮기기</div>
      <p class="note">아래 코드를 복사해 다른 기기에서 붙여 넣고 불러오기를 누르세요.</p>
      <textarea class="inp mt8" id="posCode" readonly>${esc(code)}</textarea>
      <div class="row-btns"><button class="btn" data-act="pos-copy">코드 복사</button><input class="inp" id="posImport" placeholder="받은 코드 붙여넣기" style="flex:1;min-width:160px;width:auto"><button class="btn" data-act="pos-import">불러오기</button></div>
    </section>`;
  }
  function drawQuad(el, sp) {
    const E = sp.E, W = Math.max(280, el.clientWidth || 560), H = sp.height || 330, small = W < 420;
    const m = { t: 10, r: 10, b: 30, l: 10 };
    const X = (v) => m.l + ((v + 100) / 200) * (W - m.l - m.r), Y = (v) => m.t + (1 - (v + 100) / 200) * (H - m.t - m.b);
    const FILL = { buy: 'var(--zone-buy)', ready: 'var(--zone-ready)', trim: 'var(--zone-trim)', sell: 'var(--zone-sell)' };
    let g = '';
    const st = 5;
    for (let ty = 100; ty > -100; ty -= st) {
      let run = null;
      for (let vx = -100; vx <= 100; vx += st) {
        const z = vx < 100 ? window.MBE.zoneOf(vx + st / 2, ty - st / 2) : null;
        if (run && z === run.z) continue;
        if (run && FILL[run.z]) g += `<rect x="${X(run.x).toFixed(1)}" y="${Y(ty).toFixed(1)}" width="${(X(vx) - X(run.x)).toFixed(1)}" height="${(Y(ty - st) - Y(ty)).toFixed(1)}" fill="${FILL[run.z]}" shape-rendering="crispEdges"/>`;
        run = z ? { z, x: vx } : null;
      }
    }
    g += `<line x1="${X(0).toFixed(1)}" x2="${X(0).toFixed(1)}" y1="${m.t}" y2="${(H - m.b).toFixed(1)}" stroke="var(--line-2)" stroke-dasharray="3 3"/>`;
    g += `<line x1="${m.l}" x2="${(W - m.r).toFixed(1)}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="var(--line-2)" stroke-dasharray="3 3"/>`;
    g += `<rect x="${m.l}" y="${m.t}" width="${(W - m.l - m.r).toFixed(1)}" height="${(H - m.t - m.b).toFixed(1)}" fill="none" stroke="var(--line)"/>`;
    const zl = 'font-size="11" font-weight="700" fill="var(--muted)"';
    g += T(X(97), Y(93) + 2, '사는 구역', `${zl} text-anchor="end"`);
    g += T(X(97), Y(-93) + 4, '기다리는 구역', `${zl} text-anchor="end"`);
    g += T(X(-97), Y(-93) + 4, '줄이는 구역', zl);
    g += T(X(-97), Y(-12), '점검 구역', zl);
    g += T(X(-97), Y(93) + 2, '과열 점검', zl);
    g += T(X(-97), Y(48), '지키는 구역', zl);
    const ax = 'font-size="11" fill="var(--muted)"';
    g += T(m.l, H - 9, '← 비쌈', ax);
    g += T((m.l + W - m.r) / 2, H - 9, small ? '싼 정도' : '싼 정도(가로) · 타이밍(세로, 위가 좋음)', `${ax} text-anchor="middle"`);
    g += T(W - m.r, H - 9, '쌈 →', `${ax} text-anchor="end"`);
    const pts = HOLD.map((s) => E.items[s]).filter(Boolean);
    pts.forEach((it) => {
      const tr = it.trail.slice(-5);
      if (tr.length >= 2) {
        g += `<polyline points="${tr.map((x) => X(x.V).toFixed(1) + ',' + Y(x.T).toFixed(1)).join(' ')}" fill="none" stroke="${SLOT[it.sym]}" stroke-width="1.6" stroke-opacity=".55" stroke-linejoin="round" stroke-linecap="round"/>`;
        tr.slice(0, -1).forEach((x) => { g += `<circle cx="${X(x.V).toFixed(1)}" cy="${Y(x.T).toFixed(1)}" r="2" fill="${SLOT[it.sym]}" fill-opacity=".55"/>`; });
      }
    });
    // 이름표: 점과 다른 이름표를 피해 오른쪽·왼쪽·위·아래 중 빈 곳에 둡니다.
    const boxes = pts.map((it) => ({ x: X(it.V) - 7, y: Y(it.T) - 7, w: 14, h: 14 }));
    const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    pts.forEach((it) => {
      const x = X(it.V), y = Y(it.T), lab = SHORT[it.sym], w = textW(lab, 11.5) + 4, h = 14;
      const cand = [[x + 9, y - h / 2], [x - 9 - w, y - h / 2], [x - w / 2, y - 10 - h], [x - w / 2, y + 9],
        [x + 7, y - 7 - h], [x + 7, y + 7], [x - 7 - w, y - 7 - h], [x - 7 - w, y + 7]];
      let best = null;
      for (const c2 of cand) {
        const b = { x: c2[0], y: c2[1], w, h };
        if (b.x < m.l + 2 || b.x + w > W - m.r - 2 || b.y < m.t + 2 || b.y + h > H - m.b - 2) continue;
        if (!hit(b)) { best = c2; break; }
      }
      if (!best) best = cand.find((c2) => c2[0] >= m.l && c2[0] + w <= W - m.r) || cand[0];
      boxes.push({ x: best[0], y: best[1], w, h });
      const tip = `<div class="tt">${esc(it.name)} · ${esc(it.level.name)}</div>` + tipRow(`${it.vWord || ''} ${(it.V > 0 ? '+' : '') + it.V}`, '싼 정도') + tipRow(`${it.tWord || ''} ${(it.T > 0 ? '+' : '') + it.T}`, '타이밍') + tipRow(px(it.sym, it.p), '가격');
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${SLOT[it.sym]}" stroke="var(--surface)" stroke-width="2" data-tip="${esc(tip)}"/>`;
      g += T(best[0] + 2, best[1] + 10.5, lab, `font-size="11.5" font-weight="700" fill="var(--ink)" ${HALO}`);
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(sp.aria || '')}">${g}</svg>`;
    bindTips(el);
  }
  function trailCells(sym, it, E) {
    return it.trail.map((x) => {
      const L = E.levels[x.G];
      const tip = `<div class="tt">${sdate(x.t)} · ${esc(L.name)}</div>` + tipRow((x.score > 0 ? '+' : '') + x.score, '점수') + tipRow(px(sym, x.p), '종가');
      return `<i class="tc ${esc(L.tone)}" data-tip="${esc(tip)}"></i>`;
    }).join('');
  }
  function opinion(n, scale) {
    if (!isNum(n)) return '';
    if (scale === 'naver') return n >= 4.5 ? '강력 매수' : n >= 3.5 ? '매수' : n >= 2.5 ? '중립' : n >= 1.5 ? '매도' : '강력 매도';
    return n <= 1.5 ? '강력 매수' : n <= 2.5 ? '매수' : n <= 3.5 ? '중립' : n <= 4.5 ? '매도' : '강력 매도';
  }
  function fmtSig(s) {
    if (!isNum(s.value)) return '-';
    if (s.id === 'vix') return nf(s.value, 2);
    if (s.id === 'us10y') return nf(s.value, 2) + '%';
    if (s.unit === '%p') return nf(s.value, 2) + '%p';
    return sgn(s.value, s.id === 'credit' || s.id === 'dram' ? 2 : 1);
  }
  function levelCls(score) { return !isNum(score) ? 'idle' : score < 30 ? 'good' : score < 55 ? 'warn' : score < 75 ? 'serious' : 'crit'; }
  const LVCOLOR = { good: 'var(--good)', warn: 'var(--warn)', serious: 'var(--serious)', crit: 'var(--crit)', idle: 'var(--line-2)' };

  // ================================================================ 12. 데이터 새로고침
  // 서버 데이터: data/latest_briefing.json(1년 일봉·현물가·신호). 같은 주소와 GitHub 원본 중 새것을 씁니다.
  // 실시간 시세: TradingView 한 곳에서 같은 순간의 현재가와 등락을 함께 받습니다. CNBC는 전일 종가가 날짜별로 섞여 오는 경우가 있어
  //   TradingView가 실패한 종목에만, 그것도 전일 종가가 서버 값과 맞을 때만 씁니다.
  async function getJSON(url, ms, opt) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 8000);
    try {
      const r = await fetch(url, Object.assign({ cache: 'no-store', signal: c.signal }, opt || {}));
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function pull() {
    const now = Date.now();
    const urls = ['data/latest_briefing.json?t=' + now, 'https://raw.githubusercontent.com/dnrzoqs-byte/memory-briefing/main/data/latest_briefing.json?t=' + now];
    const res = await Promise.allSettled(urls.map((u) => getJSON(u)));
    let best = null, got = false;
    res.forEach((r) => {
      if (r.status === 'fulfilled' && r.value && r.value.schema === 2) { got = true; if (!best || (r.value.updated_ts || 0) > (best.updated_ts || 0)) best = r.value; }
    });
    let changed = false;
    if (best && (best.updated_ts || 0) > (S.P.updated_ts || 0)) { S.P = best; serCache.clear(); changed = true; }
    try {
      const r = await getJSON('data/research.json?t=' + now);
      if (r && r.as_of && (r.version !== S.R.version || r.as_of !== S.R.as_of)) { S.R = r; changed = true; }
    } catch (e) { /* 파일로 열었을 때 등 */ }
    return changed ? 'new' : got ? 'same' : 'fail';
  }

  const TV = {
    KR_RATE: 'ECONOMICS:KRINTR', US_RATE: 'ECONOMICS:USINTR', KR3Y: 'TVC:KR03Y',
    '005935.KS': 'KRX:005935', '005930.KS': 'KRX:005930', '353200.KS': 'KRX:353200', '240810.KQ': 'KRX:240810', '000660.KS': 'KRX:000660',
    '^KS11': 'KRX:KOSPI', '^KQ11': 'KRX:KOSDAQ', AMD: 'NASDAQ:AMD', CLS: 'NYSE:CLS', MU: 'NASDAQ:MU', NVDA: 'NASDAQ:NVDA',
    '^SOX': 'NASDAQ:SOX', '^IXIC': 'NASDAQ:IXIC', '^VIX': 'TVC:VIX', '^TNX': 'TVC:US10Y', '^FVX': 'TVC:US05Y', '^IRX': 'TVC:US03MY',
    'KRW=X': 'FX_IDC:USDKRW', 'CL=F': 'NYMEX:CL1!', HYG: 'AMEX:HYG'
  };
  const CN = {
    AMD: 'AMD', CLS: 'CLS', MU: 'MU', NVDA: 'NVDA', '^SOX': '.SOX', '^IXIC': '.IXIC', '^VIX': '.VIX', '^TNX': 'US10Y', '^FVX': 'US5Y', '^IRX': 'US3M',
    'KRW=X': 'KRW=', 'CL=F': '@CL.1', HYG: 'HYG', '^KS11': '.KS11', '^KQ11': '.KQ11'
  };
  const MKT = (s) => (isKR(s) || s === '^KS11' || s === '^KQ11' ? 'kr' : s === 'KRW=X' || RATE.has(s) || s === 'CL=F' ? 'fx' : 'us');
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    const t = String(v).replace(/[,%\s]/g, '');
    if (t === 'UNCH') return 0;
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }
  function usPhase(ms) {
    const et = new Date(ms - (usDST(ms) ? 4 : 5) * 3600e3), wd = et.getUTCDay(), mm = et.getUTCHours() * 60 + et.getUTCMinutes();
    if (wd === 0 || wd === 6) return 'closed';
    return mm >= 240 && mm < 570 ? 'pre' : mm >= 570 && mm < 960 ? 'reg' : mm >= 960 && mm < 1200 ? 'post' : 'closed';
  }
  async function fromTV() {
    const ids = Object.keys(TV), back = {};
    ids.forEach((x) => { back[TV[x]] = x; });
    const body = JSON.stringify({ symbols: { tickers: ids.map((x) => TV[x]), query: { types: [] } },
      columns: ['close', 'change', 'change_abs', 'update_mode', 'premarket_close', 'premarket_change', 'postmarket_close', 'postmarket_change', 'price_target_average', 'recommendation_mark'] });
    const j = await getJSON('https://scanner.tradingview.com/global/scan', 7000, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    const out = {}, now = Date.now(), krClosed = sessions(now).kr !== '장중', kh = kst(now).h, ph = usPhase(now);
    (j.data || []).forEach((r) => {
      const s = back[r.s], d = r.d || [], price = num(d[0]), chg = num(d[2]);
      if (!s || !isNum(price) || !isNum(chg)) return;
      const prev = price - chg, m = /delayed_streaming_(\d+)/.exec(String(d[3] || ''));
      const o = { price, prev, chg, chg_pct: prev ? (chg / prev) * 100 : num(d[1]), src: 'TradingView', delay: m ? Math.round(+m[1] / 60) : 0, mkt: MKT(s) };
      const pre = num(d[4]), post = num(d[6]);
      if (o.mkt === 'us' && HOLD.includes(s)) { o.tgt = num(d[8]); o.rec = num(d[9]); }
      if (o.mkt === 'kr' && isKR(s) && krClosed) {
        if (kh >= 8 && kh < 9 && isNum(pre) && Math.abs(pre - price) > 1e-9) o.ext = { price: pre, pct: num(d[5]), label: '장전' };
        else if (isNum(post) && Math.abs(post - price) > 1e-9) o.ext = { price: post, pct: num(d[7]), label: '시간외' };
      } else if (o.mkt === 'us') {
        if (ph === 'pre' && isNum(pre)) o.ext = { price: pre, pct: num(d[5]), label: '장전' };
        else if (ph !== 'reg' && ph !== 'pre' && isNum(post)) o.ext = { price: post, pct: num(d[7]), label: '장후' };
      }
      out[s] = o;
    });
    return out;
  }
  async function fromCNBC(only) {
    const ids = (only || Object.keys(CN)).filter((x) => CN[x]), back = {};
    if (!ids.length) return {};
    ids.forEach((x) => { back[CN[x]] = x; });
    const u = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' + encodeURIComponent(ids.map((x) => CN[x]).join('|')) +
      '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1';
    const j = await getJSON(u, 7000);
    let list = ((j || {}).FormattedQuoteResult || {}).FormattedQuote || [];
    if (!Array.isArray(list)) list = [list];
    const out = {}, base = S.P.quotes || {};
    const near = (x, y) => isNum(x) && isNum(y) && y !== 0 && Math.abs(x / y - 1) < 0.005;
    list.forEach((x) => {
      const s = back[x.symbol], price = num(x.last), prev = num(x.previous_day_closing), b = base[s];
      if (!s || !isNum(price) || !isNum(prev) || prev === 0) return;
      // 전일 종가가 서버가 아는 마지막 종가나 그 전날 종가와 맞을 때만 받습니다.
      if (!b || !(near(prev, b.price) || near(prev, b.prev))) return;
      const chg = price - prev;
      out[s] = { price, prev, chg, chg_pct: (chg / prev) * 100, src: 'CNBC', delay: x.realTime === 'true' ? 0 : 15, mkt: MKT(s), day: String(x.last_time || '').slice(0, 10) || null };
    });
    return out;
  }
  async function liveRefresh() {
    let tv = {}, cn = {};
    try { tv = await fromTV(); } catch (e) { tv = {}; }
    const missing = Object.keys(TV).filter((x) => !tv[x]);
    if (missing.length) { try { cn = await fromCNBC(missing); } catch (e) { cn = {}; } }
    const out = {}, at = Date.now(), base = S.P.quotes || {};
    Object.keys(TV).forEach((x) => {
      const pick = tv[x] || cn[x], b0 = base[x];
      // 서버 값과 40% 넘게 다르면 잘못 짝지어진 값으로 보고 버립니다.
      if (!pick || (b0 && isNum(b0.price) && b0.price > 0 && Math.abs(pick.price / b0.price - 1) > 0.4)) return;
      out[x] = Object.assign({ at }, pick);
    });
    const n = Object.keys(out).length;
    S.liveCN = Object.keys(cn).length;
    S.liveTV = Object.keys(tv).length;
    if (n) { S.direct = out; S.liveAt = at; S.liveN = n; S.liveErr = ''; } else S.liveErr = '실시간 시세를 받지 못했습니다';
    return { n };
  }

  function setBusy(on) {
    const b = document.getElementById('btnRefresh');
    if (!b) return;
    b.classList.toggle('busy', on);
    b.setAttribute('aria-busy', String(on));
    const l = b.querySelector('.lbl');
    if (l) l.textContent = on ? '받는 중' : '새로 고침';
  }
  function softRender() {
    const a = document.activeElement;
    if (S.editPos || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { renderStatus(); return; }
    const y = window.scrollY;
    render();
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  }
  async function refresh(manual) {
    if (S.busy) { if (manual) toast('받는 중입니다'); return; }
    S.busy = true;
    setBusy(true);
    let srv = 'fail', live = { n: 0 };
    try {
      const r = await Promise.all([pull().catch(() => 'fail'), liveRefresh().catch(() => ({ n: 0 }))]);
      srv = r[0];
      live = r[1];
    } finally {
      S.busy = false;
      setBusy(false);
    }
    if (live.n || srv === 'new') softRender(); else renderStatus();
    if (manual) {
      const msg = live.n ? `실시간 시세 ${live.n}개 반영 · ${hms(S.liveAt)}` : '실시간 시세를 받지 못했습니다. 서버 데이터를 씁니다';
      toast(msg + (srv === 'new' ? ' · 새 분석 반영' : ''));
    }
  }
  function liveDelay() {
    const k = kst(Date.now());
    return (k.wd >= 1 && k.wd <= 5) || (k.wd === 6 && k.h < 10) ? 60e3 : 10 * 60e3;
  }
  function scheduleLive() {
    clearTimeout(S.liveT);
    S.liveT = setTimeout(async () => {
      if (!document.hidden && !S.busy) {
        S.busy = true;
        try { const r = await liveRefresh(); if (r.n) softRender(); else renderStatus(); } catch (e) { renderStatus(); } finally { S.busy = false; }
      }
      scheduleLive();
    }, liveDelay());
  }

  // 새 버전이 배포되면 다시 불러옵니다(카톡 안 브라우저처럼 오래 열어 둔 화면이 예전 코드로 남지 않게).
  const BUILD = (/app\.js\?v=([\w.-]+)/.exec(((document.querySelector('script[src*="app.js"]') || {}).src) || '') || [])[1] || '';
  async function checkBuild() {
    if (!BUILD) return;
    try {
      const r = await fetch('index.html?b=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const m = /assets\/app\.js\?v=([\w.-]+)/.exec(await r.text());
      if (m && m[1] !== BUILD) {
        if (document.hidden) { S.reloadOnShow = true; return; }
        toast('새 버전을 불러옵니다');
        setTimeout(() => location.reload(), 1500);
      }
    } catch (e) { /* 연결 실패는 다음에 다시 봅니다 */ }
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ================================================================ 13. 이벤트
  function readPosForm() {
    const next = {};
    document.querySelectorAll('#posEditor input[data-sym]').forEach((inp) => {
      const s = inp.getAttribute('data-sym'), f = inp.getAttribute('data-f');
      const v = parseFloat(String(inp.value).replace(/[,\s원$]/g, ''));
      if (isNum(v) && v > 0) { next[s] = next[s] || {}; next[s][f] = v; }
    });
    Object.keys(next).forEach((s) => { if (!(next[s].qty > 0)) delete next[s]; });
    return next;
  }
  function onClick(ev) {
    const a = ev.target.closest('[data-act],[data-go],[data-stock],[data-news],[data-view]');
    if (!a) return;
    if (a.hasAttribute('data-view')) { ev.preventDefault(); go(a.getAttribute('data-view')); return; }
    if (a.hasAttribute('data-go')) { ev.preventDefault(); go(a.getAttribute('data-go')); return; }
    if (a.hasAttribute('data-stock')) { S.stock = a.getAttribute('data-stock'); history.replaceState(null, '', '#stocks/' + encodeURIComponent(S.stock)); render(); return; }
    if (a.hasAttribute('data-news')) { S.newsTab = a.getAttribute('data-news'); render(); return; }
    const act = a.getAttribute('data-act');
    if (act === 'pos-open') { ev.preventDefault(); S.editPos = true; if (S.view !== 'stocks') go('stocks'); else render(); setTimeout(() => { const e = document.getElementById('posEditor'); if (e) e.scrollIntoView({ block: 'start' }); }, 30); }
    else if (act === 'pos-close') { S.editPos = false; render(); }
    else if (act === 'pos-save') { S.pos = readPosForm(); saveStore('mb.pos.v1', S.pos); S.editPos = false; render(); toast('저장했습니다'); }
    else if (act === 'pos-clear') { if (confirm('입력한 수량과 단가를 모두 지울까요?')) { S.pos = {}; saveStore('mb.pos.v1', S.pos); render(); } }
    else if (act === 'pos-copy') {
      const t = document.getElementById('posCode');
      if (t) { t.select(); (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => toast('코드를 복사했습니다'), () => { document.execCommand('copy'); toast('코드를 복사했습니다'); }); }
    } else if (act === 'pos-import') {
      const v = (document.getElementById('posImport') || {}).value || '';
      try {
        const obj = JSON.parse(decodeURIComponent(escape(atob(v.trim()))));
        if (obj && typeof obj === 'object') { S.pos = obj; saveStore('mb.pos.v1', S.pos); S.editPos = false; render(); toast('불러왔습니다'); }
      } catch (e) { toast('코드를 읽지 못했습니다'); }
    }
  }
  function setTheme(t) {
    const root = document.documentElement;
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    try { if (t) localStorage.setItem('mb.theme', t); else localStorage.removeItem('mb.theme'); } catch (e) { /* 무시 */ }
    render();
  }
  function effectiveDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function buildNav() {
    const dock = document.getElementById('dock');
    if (dock) dock.innerHTML = VIEWS.map((v) => `<button type="button" data-view="${v.id}" aria-selected="false"><span class="ni"><svg viewBox="0 0 24 24" aria-hidden="true">${v.icon}</svg></span><span class="nl">${esc(v.label)}</span></button>`).join('');
  }

  function init() {
    buildNav();
    const q = new URLSearchParams(location.search).get('view');
    if (!location.hash && q) history.replaceState(null, '', location.pathname + location.search + '#' + (LEGACY[q] || (VIEWS.some((v) => v.id === q) ? q : 'today')));
    applyRoute(false);
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', () => applyRoute(true));
    const br = document.getElementById('btnRefresh');
    if (br) br.addEventListener('click', () => refresh(true));
    const bt = document.getElementById('btnTheme');
    if (bt) bt.addEventListener('click', () => setTheme(effectiveDark() ? 'light' : 'dark'));
    let rt = 0, lastW = window.innerWidth;
    window.addEventListener('resize', () => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(() => { mountCharts(); bindTips(document.getElementById('view')); }, 160); });
    window.addEventListener('scroll', hideTip, { passive: true });
    setInterval(() => { if (!document.hidden && !S.busy) pull().then((r) => { if (r === 'new') softRender(); }, () => {}); }, 5 * 60e3);
    setInterval(renderStatus, 30e3);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (S.reloadOnShow) { location.reload(); return; }
      refresh(false);
      checkBuild();
    });
    setInterval(() => { if (!document.hidden) checkBuild(); }, 20 * 60e3);
    setTimeout(checkBuild, 8000);
    setTimeout(() => refresh(false), 250);
    scheduleLive();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
