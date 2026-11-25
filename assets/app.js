/* 반도체 브리핑 v4 · app.js
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
    HYG: '하이일드 채권 ETF'
  };
  const CODE = { '005935.KS': '005935', '005930.KS': '005930', '353200.KS': '353200', '240810.KQ': '240810', AMD: 'NASDAQ', CLS: 'NYSE' };
  const SLOT = { '005935.KS': 'var(--s1)', '005930.KS': 'var(--s2)', '353200.KS': 'var(--s3)', '240810.KQ': 'var(--s4)', AMD: 'var(--s5)', CLS: 'var(--s6)' };
  const SHORT = { '005935.KS': '삼성우', '005930.KS': '삼성', '353200.KS': '대덕', '240810.KQ': '원익', AMD: 'AMD', CLS: 'CLS' };
  const RATE = new Set(['^TNX', '^FVX', '^IRX']);
  const VIEWS = [
    { id: 'today', label: '오늘', icon: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>' },
    { id: 'cycle', label: '메모리 사이클', short: '사이클', icon: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3.5v5h-5"/>' },
    { id: 'stocks', label: '내 종목', icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>' },
    { id: 'macro', label: '대내외 변수', short: '변수', icon: '<path d="M2 12h4l3-8 4 16 3-8h6"/>' },
    { id: 'agenda', label: '일정·근거', short: '일정', icon: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>' }
  ];
  const LEGACY = { dram: 'today', factcheck: 'cycle', overview5: 'stocks', rates: 'macro' };
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
    const key = [S.P.updated_ts || 0, S.liveAt || 0, S.R.version || '', S.R.as_of || '', JSON.stringify(S.pos || {})].join('|');
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
  function drawCols(el, sp) {
    const W = Math.max(240, el.clientWidth || 500), H = sp.height || 220, m = { t: 22, r: 2, b: 26, l: 2 };
    const ns = sp.series.length, nc = sp.cats.length;
    let ymax = 0;
    sp.series.forEach((s) => s.vals.forEach((v) => { if (isNum(v)) ymax = Math.max(ymax, v); }));
    const TK = ticks(0, ymax * 1.08, 4);
    const Y = (v) => m.t + (1 - v / TK.hi) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / nc, bw = Math.max(8, Math.min(24, (band * 0.62 - (ns - 1) * 2) / ns)), gw = bw * ns + (ns - 1) * 2;
    let g = '';
    TK.list.forEach((v) => { if (v > 0) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)"/>`; });
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="var(--line-2)"/>`;
    const vf = sp.valFmt || ((v) => nf(v));
    sp.cats.forEach((c, ci) => {
      const gx = m.l + band * ci + (band - gw) / 2;
      sp.series.forEach((s, si) => {
        const v = s.vals[ci];
        if (!isNum(v)) return;
        const x = gx + si * (bw + 2), y = Y(v), h = Y(0) - y;
        const tip = `<div class="tt">${esc(c)}</div>${tipRow(vf(v) + (sp.unit || ''), s.name, s.color, true)}`;
        g += `<path d="${roundTop(x, y, bw, h, 4)}" fill="${s.color}"/>`;
        g += T(x + bw / 2, y - 6, vf(v), 'font-size="11" font-weight="700" fill="var(--ink)" text-anchor="middle"');
        g += `<rect x="${(x - 1).toFixed(1)}" y="${m.t}" width="${(bw + 2).toFixed(1)}" height="${(H - m.t - m.b).toFixed(1)}" fill="transparent" data-tip="${esc(tip)}"/>`;
      });
      g += T(m.l + band * ci + band / 2, H - 7, c, 'font-size="11.5" font-weight="600" fill="var(--ink-2)" text-anchor="middle"');
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
    bindTips(el);
  }

  function drawRange(el, sp) {
    const W = Math.max(240, el.clientWidth || 500), H = sp.height || 200, m = { t: 26, r: 2, b: 26, l: 34 };
    const it = sp.items || [];
    const hi = Math.max(1, ...it.map((i) => i.hi));
    const TK = ticks(0, hi * 1.12, 3);
    const Y = (v) => m.t + (1 - v / TK.hi) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / it.length, bw = Math.min(24, band * 0.5);
    let g = '';
    TK.list.forEach((v) => {
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${v === 0 ? 'var(--line-2)' : 'var(--line)'}"/>`;
      g += T(m.l - 6, Y(v) + 3.5, v + '%', 'font-size="10.5" fill="var(--muted)" text-anchor="end"');
    });
    it.forEach((d, i) => {
      const cx = m.l + band * i + band / 2, x = cx - bw / 2;
      const yH = Y(d.hi), yL = Y(d.lo), h = Math.max(3, yL - yH);
      const path = d.lo <= 0 ? roundTop(x, yH, bw, h, 4) : roundBoth(x, yH, bw, h, 4);
      g += `<path d="${path}" fill="${sp.color || 'var(--s1)'}" opacity="${sp.fade ? Math.max(0.45, 1 - i * 0.12) : 1}"/>`;
      const lab = (d.lo > 0 ? '+' : '') + d.lo + '~' + d.hi + '%';
      g += T(cx, yH - 7, lab, 'font-size="11.5" font-weight="700" fill="var(--ink)" text-anchor="middle"');
      g += T(cx, H - 7, d.q, 'font-size="11.5" font-weight="600" fill="var(--ink-2)" text-anchor="middle"');
      const tip = `<div class="tt">${esc(d.q)} 전 분기 대비</div>${tipRow(lab, d.note || '전망 범위', sp.color || 'var(--s1)', true)}`;
      g += `<rect x="${(m.l + band * i).toFixed(1)}" y="${m.t}" width="${band.toFixed(1)}" height="${(H - m.t - m.b).toFixed(1)}" fill="transparent" data-tip="${esc(tip)}"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
    bindTips(el);
  }

  function drawHBar(el, sp) {
    const W = Math.max(260, el.clientWidth || 500), items = sp.items || [], rowH = sp.rowH || 26;
    const H = items.length * rowH + 6;
    el.style.height = H + 'px';
    const labW = Math.min(sp.labW || 150, W * 0.42), valW = sp.valW || 64;
    const max = sp.max || Math.max(...items.map((i) => Math.abs(i.v))) || 1;
    const bh = Math.min(sp.bar || 14, rowH - 8);
    let g = '';
    items.forEach((d, i) => {
      const y = 3 + i * rowH, cy = y + rowH / 2;
      const w = Math.max(2, (Math.abs(d.v) / max) * (W - labW - valW));
      g += T(0, cy + 4, d.label, `font-size="12" fill="${d.hl ? 'var(--ink)' : 'var(--ink-2)'}" font-weight="${d.hl ? 800 : 500}"`);
      g += `<path d="${roundRight(labW, cy - bh / 2, w, bh, 4)}" fill="${d.hl ? (sp.hlColor || 'var(--s1)') : (sp.color || 'var(--bench)')}"/>`;
      g += T(labW + w + 6, cy + 4, d.vlabel || nf(d.v), `font-size="11.5" font-weight="${d.hl ? 800 : 600}" fill="var(--ink)"`);
      if (d.tip) g += `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent" data-tip="${esc(d.tip)}"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg>`;
    bindTips(el);
  }
  const DRAW = { line: drawLine, cols: drawCols, range: drawRange, hbar: drawHBar, quad: (el, sp) => drawQuad(el, sp) };

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

  // ================================================================ 5. 공통 조각
  function head(title, sub) { return `<div class="view-head"><h1>${esc(title)}</h1>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`; }
  function footer() {
    const P = S.P;
    return `<footer class="foot">
      실시간 시세는 TradingView(국내 20분·미국 15분 지연, 지수·금리·환율 실시간), 1년 차트는 Yahoo Finance, 메모리 현물가는 DRAMeXchange에서 가져옵니다.
      서버 데이터는 GitHub Actions(실행 간격이 일정하지 않음)와 PC 작업(12:00, 19:00)이 갱신합니다.
      ${P.failed && P.failed.length ? `이번 갱신에서 가져오지 못한 항목: ${esc(P.failed.join(', '))}(이전 값 유지).` : ''}<br>
      분석 기준일 ${esc(S.R.as_of || '-')}. 이 페이지는 개인 참고용이며 투자 권유가 아닙니다.
    </footer>`;
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

  // ================================================================ 6. 오늘
  function vToday() {
    const E = ENG();
    return head('오늘', esc(S.P.market_date || '')) +
      `<div class="grid">${actionHero(E)}</div>
       <div class="grid">${boardCard(E, 'c12')}</div>
       <div class="grid">${mapCard(E, 'c7')}${heatCard(E, 'c5')}</div>
       <div class="grid">${trailCard(E, 'c12')}</div>
       <div class="grid">${stressCard('c5')}<div class="c7 stack">${tilesCard('')}${upcomingCard('')}</div></div>
       <div class="grid">${bgCard('c12')}</div>
       <div class="grid">${scenarioCard('c12')}</div>`;
  }

  // ---------------------------------------------------------------- 오늘의 대응
  function sessionLine() {
    const ss = sessions(), k = kst(Date.now()), m = k.h * 60 + k.mi;
    const us = [['^SOX', '반도체지수'], ['NVDA', '엔비디아'], ['MU', '마이크론']].map(([x, n]) => { const q = Q(x); return q && isNum(q.chg_pct) ? `${n} ${sgn(q.chg_pct, 1)}` : null; }).filter(Boolean).join(' · ');
    const qk = Q('^KS11'), kr = qk && isNum(qk.chg_pct) ? `코스피 ${sgn(qk.chg_pct, 1)}` : '';
    const tonight = ss.usTonightOff ? '오늘 밤 미국은 휴장입니다' : '';
    if (ss.kr === '장중') return `국내 장중(시세 20분 지연) · ${kr}. 밤사이 미국 ${us}.${tonight ? ' ' + tonight + '.' : ''}`;
    if (!ss.krOff && m < 540) return `국내 장 시작 전. 밤사이 미국 ${us}.${tonight ? ' ' + tonight + '.' : ''}`;
    if (ss.us === '장중') return `미국 장중(시세 15분 지연) · ${us}. 오늘 국내 ${kr}.`;
    if (ss.krOff && ss.usOff) return `국내·미국 모두 쉬는 날. 마지막 거래일 미국 ${us}.`;
    return `국내 장 마감 · ${kr}. ${tonight || '오늘 밤 미국 장 전'}. 직전 미국 ${us}.`;
  }
  function evSoon(days) {
    return (S.R.calendar || []).filter((e) => { const d = ddays(e.d); return d != null && d >= 0 && d <= days && e.firm !== false && !e.approx; });
  }
  function actionHero(E) {
    if (!E) return `<section class="card hero c12"><div class="eyebrow">오늘의 대응</div><h2>판단 엔진을 불러오지 못했습니다</h2><p class="note">새로 고침을 눌러 주세요.</p></section>`;
    const sm = E.summary || {}, evs = evSoon(1);
    const evh = evs.length ? `<ul class="soon">${evs.map((e) => `<li><span class="when">${ddays(e.d) === 0 ? '오늘' : '내일'}${e.t ? ' ' + esc(e.t) : ''}</span><span>${esc(e.title)}${forTxt(e)}</span></li>`).join('')}</ul>` : '';
    return `<section class="card hero act-hero c12">
      <div class="eyebrow">오늘의 대응 · ${esc(mdw(Date.now()))} ${esc(hm(engMemo.at || Date.now()))} 계산 ${tag('view')}</div>
      <h2>${esc(sm.head || '')}</h2>
      <p class="lead">${esc(sm.body || '')}</p>
      <div class="bits">${(sm.bits || []).map((b) => `<span class="bit">${esc(b)}</span>`).join('')}</div>
      <p class="sess"><i class="dot"></i>${esc(sessionLine())}</p>
      ${evh}
      <details class="how"><summary>이 판단은 이렇게 나옵니다</summary>
        <p>종목마다 두 값을 -100~100으로 계산합니다. <b>가격 매력</b>은 이익·배당·순자산 대비 지금 가격에 업황(메모리 가격, AI 투자 심리)을 섞은 값이고, <b>흐름</b>은 추세·과매도·외국인 수급·금리·환율·시장 스트레스를 종목별 무게로 합친 값입니다.</p>
        <p>두 값이 놓인 구역이 판단이 됩니다. 가격 매력 35 이상이면서 흐름 -15 이상이면 분할 매수, 가격 매력은 높은데 흐름이 나쁘면 매수 대기, 가격 매력이 -25 아래로 비싸지거나 흐름이 -45 아래로 무너지면 비중 점검입니다. 판단은 경계를 6점 넘게 지나야 바뀌어 하루의 흔들림에 휘둘리지 않습니다.</p>
        <p>급락 국면(시장 스트레스 65 이상이거나 고점 대비 -40% 아래)에서는 추세 신호가 자주 틀리므로 추세 무게를 절반으로 줄이고 과매도 무게를 늘립니다. 금리 결정이나 실적 같은 큰 일정 하루 전에는 사지 않고 결과를 봅니다. 매수 시작가는 다른 변수를 그대로 두고 가격만 움직였을 때 사는 구역에 드는 가격입니다.</p>
        <p>규칙으로 계산한 참고 판단입니다. 주문은 직접 정합니다.</p>
      </details>
    </section>`;
  }
  function axBar(label, v) {
    const x = Math.max(-100, Math.min(100, isNum(v) ? v : 0)), w = Math.abs(x) / 2;
    return `<div class="ax"><span class="ax-l">${esc(label)}</span><span class="ax-bar"><i class="${x >= 0 ? 'pos' : 'neg'}" style="${x >= 0 ? 'left' : 'right'}:50%;width:${w.toFixed(1)}%"></i></span><b class="num">${isNum(v) ? (v > 0 ? '+' : '') + Math.round(v) : '-'}</b></div>`;
  }
  function chTxt(it) {
    const c = it.change;
    if (!c) return '';
    const why = (c.top || []).map((x) => `${x.name} ${x.d > 0 ? '+' : '−'}${nf(Math.abs(x.d), 0)}`).join(', ');
    if (c.changed) return `<span class="chg-b on">어제 ${esc(c.from.name)} → 오늘 ${esc(c.to.name)}</span>${why ? `<span class="muted">${esc(why)}</span>` : ''}`;
    return `<span class="chg-b">어제와 같은 판단</span><span class="muted">점수 ${c.dScore > 0 ? '+' : ''}${c.dScore}${why ? ' · ' + esc(why) : ''}</span>`;
  }
  function boardCard(E, c) {
    const pf = portfolio(), byS = {};
    pf.rows.forEach((r) => { byS[r.s] = r; });
    const items = HOLD.map((s) => {
      const it = E && E.items[s], q = Q(s), r = byS[s];
      if (!it) return '';
      const why = (it.reasons || []).slice(0, 3).map((x) => `<li class="${x.c >= 0 ? 'pos' : 'neg'}"><b>${esc(x.name)}</b>${esc(x.txt)}</li>`).join('');
      const mine = r && r.plp != null ? `<span class="num">내 손익 <b class="${dir(r.pl)}">${sgn(r.plp, 1)}</b></span>` : '';
      const ex = extTxt(s, q);
      return `<a class="plan act" href="#stocks/${esc(s)}" style="--slot:${SLOT[s]}">
        <div class="plan-top"><span class="nm">${esc(NAME[s])}</span><span class="call ${esc(it.level.tone)}">${esc(it.level.name)}</span></div>
        <div class="plan-px"><b class="num">${q ? px(s, q.price) : '-'}</b><span class="num ${chgDir(s, q)}">${q ? chgText(s, q) : ''}</span>${q && isNum(q.dd) ? `<span class="num muted">고점 대비 ${sgn(q.dd, 0)}</span>` : ''}</div>
        ${ex || mine ? `<div class="plan-sub">${ex}${mine}</div>` : ''}
        <div class="axes">${axBar('가격 매력', it.V)}${axBar('흐름', it.T)}</div>
        <p class="act-line">${esc(it.line)}</p>
        <ul class="why">${why}</ul>
        <div class="plan-ft">${chTxt(it)}</div>
      </a>`;
    }).join('');
    const sum = pf.rows.length ? `<div class="stats mt16">
        <div class="stat"><span class="lb">평가금액</span><span class="vl">${krw(pf.val)}</span><span class="ds">미국 종목은 원/달러 ${nf(pf.fx, 1)}원으로 환산</span></div>
        <div class="stat"><span class="lb">오늘 변동</span><span class="vl ${dir(pf.day)}">${pf.day > 0 ? '+' : ''}${krw(pf.day)}</span><span class="ds">전 거래일 종가 대비</span></div>
        <div class="stat"><span class="lb">평가손익</span><span class="vl ${dir(pf.pl)}">${pf.pl != null ? (pf.pl > 0 ? '+' : '') + krw(pf.pl) : '-'}</span><span class="ds">${pf.cost ? sgn((pf.val / pf.cost - 1) * 100, 1) + ' · 평균단가 입력 종목 기준' : '평균단가를 넣으면 계산합니다'}</span></div>
      </div>` : '';
    return `<section class="card ${c}" id="plan">
      <div class="ch"><h3>종목별 대응</h3><span class="sub">${tag('view')} 매일 변수로 다시 계산 · 이유는 점수를 가장 크게 움직인 변수 순 · <a href="#stocks" data-act="pos-open">수량·단가 입력</a></span></div>
      <div class="plans">${items || '<div class="empty">판단을 계산할 기록이 부족합니다</div>'}</div>
      ${sum}
    </section>`;
  }

  // 가격 매력(가로)과 흐름(세로) 지도. 구역은 엔진의 규칙을 그대로 칠합니다.
  function mapCard(E, c) {
    if (!E || !window.MBE.zoneOf) return '';
    return `<section class="card ${c}" id="map">
      <div class="ch"><h3>가격 매력과 흐름</h3><span class="sub">점은 오늘, 꼬리는 최근 5거래일</span></div>
      ${slot({ type: 'quad', height: 330, E, aria: '종목별 가격 매력과 흐름 지도' })}
      <p class="note mt8">가로는 가격 매력(오른쪽일수록 이익·배당 대비 쌈), 세로는 흐름(위쪽일수록 지금 사도 되는 때)입니다. 오른쪽 위가 사는 구역, 오른쪽 아래가 기다리는 구역, 왼쪽이 점검 구역입니다. 점에 손가락을 올리면 숫자가 나옵니다.</p>
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
    g += T((m.l + W - m.r) / 2, H - 9, small ? '가격 매력' : '가격 매력(가로) · 흐름(세로, 위가 좋음)', `${ax} text-anchor="middle"`);
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
      const tip = `<div class="tt">${esc(it.name)} · ${esc(it.level.name)}</div>` + tipRow((it.V > 0 ? '+' : '') + it.V, '가격 매력') + tipRow((it.T > 0 ? '+' : '') + it.T, '흐름') + tipRow(px(it.sym, it.p), '가격');
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${SLOT[it.sym]}" stroke="var(--surface)" stroke-width="2" data-tip="${esc(tip)}"/>`;
      g += T(best[0] + 2, best[1] + 10.5, lab, `font-size="11.5" font-weight="700" fill="var(--ink)" ${HALO}`);
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(sp.aria || '')}">${g}</svg>`;
    bindTips(el);
  }

  function heatCard(E, c) {
    if (!E) return '';
    const cols = HOLD.filter((s) => E.items[s]);
    const rows = E.factors.filter((F) => cols.some((s) => isNum(E.items[s].contrib[F.k])));
    const cell = (s, F) => {
      const v = E.items[s].contrib[F.k];
      if (!isNum(v)) return '<td class="na">·</td>';
      const a = Math.min(1, Math.abs(v) / 25), x = E.items[s].fs[F.k] || {};
      return `<td class="${v >= 0 ? 'pos' : 'neg'}" style="--a:${(0.1 + a * 0.62).toFixed(2)}" title="${esc(NAME[s] + ' · ' + F.name + ': ' + (x.txt || ''))}">${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${nf(Math.abs(v), 0)}</td>`;
    };
    const body = rows.map((F) => `<tr><th scope="row" title="${esc(F.desc)}">${esc(F.name)}</th>${cols.map((s) => cell(s, F)).join('')}</tr>`).join('');
    const foot = `<tr class="tot"><th scope="row">점수</th>${cols.map((s) => `<td>${E.items[s].score > 0 ? '+' : ''}${E.items[s].score}</td>`).join('')}</tr>`;
    return `<section class="card ${c}" id="heat">
      <div class="ch"><h3>변수가 종목을 미는 힘</h3><span class="sub">초록은 사는 쪽, 주황은 파는 쪽</span></div>
      <div class="tbl-wrap"><table class="heat"><thead><tr><th></th>${cols.map((s) => `<th scope="col">${esc(SHORT[s])}</th>`).join('')}</tr></thead><tbody>${body}${foot}</tbody></table></div>
      <p class="note mt8">숫자는 그 변수가 오늘 점수를 얼마나 올렸거나(+) 내렸는지입니다. 같은 변수라도 종목마다 무게가 달라 금리는 AMD에, 메모리 가격은 원익IPS에 가장 크게 작동합니다. 칸을 누르면 근거 숫자가 나옵니다.</p>
    </section>`;
  }

  function trailCells(sym, it, E) {
    return it.trail.map((x) => {
      const L = E.levels[x.G];
      const tip = `<div class="tt">${sdate(x.t)} · ${esc(L.name)}</div>` + tipRow((x.score > 0 ? '+' : '') + x.score, '점수') + tipRow(px(sym, x.p), '종가');
      return `<i class="tc ${esc(L.tone)}" data-tip="${esc(tip)}"></i>`;
    }).join('');
  }
  function trailCard(E, c) {
    if (!E) return '';
    const first = HOLD.map((s) => E.items[s]).find((x) => x && x.trail.length);
    if (!first) return '';
    const rows = HOLD.map((s) => {
      const it = E.items[s];
      return it ? `<div class="trow"><span class="nm">${esc(SHORT[s])}</span><span class="cells">${trailCells(s, it, E)}</span><span class="call ${esc(it.level.tone)}">${esc(it.level.name)}</span></div>` : '';
    }).join('');
    const lg = E.levels.slice().reverse().map((L) => `<span><i class="tc ${esc(L.tone)}"></i>${esc(L.name)}</span>`).join('');
    return `<section class="card ${c}" id="trail">
      <div class="ch"><h3>최근 20거래일 판단</h3><span class="sub">같은 규칙을 그날까지의 기록으로 다시 계산</span></div>
      <div class="tlegend">${lg}</div>
      <div class="trails">${rows}</div>
      <div class="taxis"><span>${esc(sdate(first.trail[0].t))}</span><span>${esc(sdate(first.trail[first.trail.length - 1].t))}</span></div>
      <p class="note mt8">판단이 언제 바뀌었는지 보여 줍니다. 칸에 손가락이나 마우스를 올리면 그날 점수와 종가가 나옵니다.</p>
    </section>`;
  }

  function bgCard(c) {
    const st = S.R.stance || {};
    const pts = (st.points || []).map((x) => `<li>${tag(x.k)}<div>${tpl(x.t)}${srcLinks(x.src)}</div></li>`).join('');
    if (!pts) return '';
    return `<section class="card ${c}" id="bg">
      <div class="ch"><h3>배경 정리</h3><span class="sub">${esc(S.R.as_of_label || '')} · 사람이 정리한 사실과 판단</span></div>
      ${st.headline ? `<p class="lead">${tpl(st.headline)}</p>` : ''}
      <ul class="pts mt12">${pts}</ul>
    </section>`;
  }

  // ---------------------------------------------------------------- 내 종목 전략
  function nextFor(sym, n) {
    return (S.R.calendar || []).filter((e) => (e.for || []).indexOf(sym) >= 0 && (ddays(e.d) == null || ddays(e.d) >= 0)).slice(0, n || 1);
  }
  function whenTxt(e) {
    const dd = ddays(e.d), firm = e.firm !== false && !e.approx;
    if (!firm) return e.approx || sdate(dUTC(e.d)) + ' 무렵';
    return (dd === 0 ? '오늘' : 'D-' + dd) + ' · ' + sdate(dUTC(e.d));
  }
  function extTxt(sym, q) {
    if (!q || !q.ext || !isNum(q.ext.price)) return '';
    return `<span class="ext">${esc(q.ext.label)} ${px(sym, q.ext.price)} <b class="${dir(q.ext.pct)}">${sgn(q.ext.pct, 1)}</b></span>`;
  }
  // 시장 스트레스: 엔진이 서버와 같은 규칙으로, 실시간 점을 더한 기록에서 다시 계산한 값을 씁니다(오늘의 대응과 같은 숫자).
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

  function stressCard(c) {
    const P = S.P, st = stressNow(), sig = st.sig || [], score = st.score, lc = levelCls(score);
    const rows = sig.map((s) => `<div class="sig">${badge(s.status)}<div class="nm">${esc(s.label)}</div><div class="vl num">${fmtSig(s)}</div><div class="rl">${esc(s.rule)}${s.note ? ' · ' + esc(s.note) : ''}</div></div>`).join('');
    const hist = ((P.history || {}).stress || []).filter((h) => isNum(h.v)).map((h) => ({ t: dUTC(h.d), v: h.v }));
    const histChart = hist.length >= 3 ? `<div class="subh">스트레스 지수 추이</div>` + slot({ type: 'line', height: 140, series: [{ name: '시장 스트레스', color: 'var(--s1)', data: hist }], yList: [0, 30, 55, 75, 100], yFmt: (v) => nf(v), aria: '시장 스트레스 지수 추이' }) + `<p class="note">가로선 30·55·75는 긴장·공포·극단 단계가 시작되는 점수입니다.</p>` : '';
    return `<section class="card ${c}" id="stress">
      <div class="ch"><h3>시장 스트레스</h3><span class="sub">신호 ${sig.length}개 평균 · 0 안정 ~ 100 극단${st.live ? ' · 실시간 반영' : ''}</span></div>
      <div class="meter-wrap">
        <div class="meter-top"><span class="meter-score">${isNum(score) ? score : '-'}</span><span class="meter-level">${esc(st.level || '데이터 없음')}</span></div>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${isNum(score) ? score : 0}" aria-label="시장 스트레스"><i style="width:${isNum(score) ? score : 0}%;background:${LVCOLOR[lc]}"></i></div>
        <div class="meter-scale"><span style="left:15%">안정</span><span style="left:42.5%">긴장</span><span style="left:65%">공포</span><span style="left:87.5%">극단</span></div>
      </div>
      ${rows || '<div class="empty">신호 데이터가 없습니다</div>'}
      ${histChart}
      <p class="note mt12">각 신호를 0~100 점수로 바꿔 평균했습니다. 높을수록 시장이 위험을 피하고 있다는 뜻입니다. 매매 신호가 아니라 속도 조절용 계기판으로 씁니다. 70을 넘을 때는 한 번에 사지 않고, 지수가 꺾이는 것을 확인한 뒤 나눠서 접근합니다.</p>
    </section>`;
  }

  function tile(sym, note) {
    const q = Q(sym);
    if (!q) return '';
    const s = SER(sym), data = lastN(s, 63);
    let wk = '';
    if (RATE.has(sym)) { const b = backVal(sym, 5); wk = isNum(b) ? '1주 ' + bp(q.price - b) : ''; } else if (isNum(q.w1)) wk = '1주 ' + sgn(q.w1, 1);
    return `<a class="tile" href="#${sym.charAt(0) === '^' || sym === 'KRW=X' || sym === 'CL=F' ? 'macro' : 'cycle'}">
      <span class="lb">${esc(NAME[sym])}</span>
      <span class="vl">${px(sym, q.price)}</span>
      <span class="dl ${chgDir(sym, q)}">${chgText(sym, q)}<span class="muted"> · ${esc(wk)}</span></span>
      <span class="sp">${spark(data)}</span>
      <span class="ft">${esc(note || qTime(q))}</span>
    </a>`;
  }
  function dramTile() {
    const d = (S.P.dram || {}).ddr5_16g;
    if (!d) return '';
    const h = dramHist('ddr5_16g');
    return `<a class="tile" href="#cycle/spot">
      <span class="lb">DDR5 16Gb 현물</span>
      <span class="vl">$${nf(d.price, 2)}</span>
      <span class="dl ${dir(d.chg_pct)}">${sgn(d.chg_pct)}<span class="muted"> · 전일 대비</span></span>
      <span class="sp">${h.length >= 3 ? spark(h) : ''}</span>
      <span class="ft">DRAMeXchange ${d.updated ? esc(mdw(parseKST(d.updated))) : ''}${d.stale ? ' · 이전 값' : ''}</span>
    </a>`;
  }
  function tilesCard(c) {
    return `<section class="card ${c}">
      <div class="ch"><h3>시장 한눈에</h3><span class="sub">작은 선은 최근 3개월</span></div>
      <div class="tiles">${['^KS11', '^SOX', '^IXIC', '^VIX', '^TNX', 'KRW=X', 'CL=F'].map((s) => tile(s)).join('')}${dramTile()}</div>
    </section>`;
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

  function eventsCard(c) {
    const ev = S.R.events || [];
    return `<section class="card ${c}">
      <div class="ch"><h3>최근 3주 사건</h3><span class="sub">최신순 · 주가가 움직인 이유</span></div>
      <ul class="tl">${ev.map((e) => `<li><span class="dt">${esc(e.d)}</span><div><h4>${tag(e.k)} ${esc(e.title)}</h4><p>${tpl(e.body)}</p>${srcLinks(e.src)}</div></li>`).join('')}</ul>
    </section>`;
  }
  function forTxt(e) {
    const f = (e.for || []).filter((x) => SHORT[x]);
    if (!f.length) return '';
    return ` · <span class="for">${f.length >= HOLD.length ? '전 종목' : esc(f.map((x) => SHORT[x]).join('·'))}</span>`;
  }
  function calItem(e) {
    const dd = ddays(e.d), firm = e.firm !== false && !e.approx;
    const dtxt = dd == null ? '' : dd === 0 ? 'D-DAY' : dd > 0 ? 'D-' + dd : '지남';
    const when = e.approx ? esc(e.approx) + '(예상)' : mdw(parseKST(e.d)) + (e.t ? ' ' + esc(e.t) : '');
    return `<li><span class="dday ${dd != null && dd >= 0 && dd <= 3 ? 'soon' : ''} ${dd != null && dd < 0 ? 'past' : ''}"><b>${firm ? dtxt : '예정'}</b><span>${firm ? esc(mdw(parseKST(e.d))) : esc(e.approx || sdate(dUTC(e.d)) + ' 무렵')}</span></span>
      <div><h4>${esc(e.title)}</h4><div class="meta">${when} · <span class="pill">${esc(e.tag || '')}</span>${firm ? '' : ' · 날짜 미확정'}${forTxt(e)}</div><p>${tpl(e.note || '')}</p></div></li>`;
  }
  function upcomingCard(c) {
    const list = (S.R.calendar || []).filter((e) => { const d = ddays(e.d); return d == null || d >= 0; }).slice(0, 5);
    return `<section class="card ${c}">
      <div class="ch"><h3>다가오는 일정</h3><a class="sub" href="#agenda">전체 일정</a></div>
      <ul class="cal">${list.map(calItem).join('') || '<li class="empty">예정된 일정이 없습니다</li>'}</ul>
    </section>`;
  }
  function scenarioCard(c, one) {
    const sc = S.R.scenarios || [];
    return `<section class="card ${c}">
      <div class="ch"><h3>2027년 시나리오와 확인할 신호</h3><span class="sub">${tag('view')} 이 페이지의 판단</span></div>
      <div class="scn${one ? ' one' : ''}">${sc.map((s) => `<div class="box ${s.weight ? 'weight' : ''}"><h4>${esc(s.name)}${s.weight ? '<span class="pill">현재 무게</span>' : ''}</h4>
        <dl><dt>조건</dt><dd>${tpl(s.cond)}</dd><dt>예상 흐름</dt><dd>${tpl(s.result)}</dd><dt>먼저 볼 것</dt><dd>${tpl(s.watch)}</dd></dl></div>`).join('')}</div>
    </section>`;
  }

  // ================================================================ 7. 메모리 사이클
  function idx(sym, n) {
    const s = lastN(SER(sym), n);
    if (s.length < 2) return [];
    const b = s[0].v;
    return s.map((p) => ({ t: p.t, v: (p.v / b) * 100 }));
  }
  function vCycle() {
    const C = S.R.cycle || {}, E = C.earnings || {};
    const why = `<section class="card c12"><div class="grid" style="gap:20px">
      <div class="c5">
        <div class="eyebrow">핵심 질문</div>
        <h3 style="font-size:19px;font-weight:800;letter-spacing:-0.03em;margin-top:4px">이익은 최대인데 주가는 왜 반토막인가</h3>
        <p class="lead mt12">메모리 주가는 가격의 높이보다 오름폭의 변화에 먼저 반응합니다. 가격이 계속 올라도 오름폭이 줄기 시작하면 시장은 그 끝에 오는 하락을 미리 계산합니다.</p>
        <p class="lead mt8">지금 전망 경로가 그렇습니다. 계약가는 내년에도 오르지만 오름폭이 분기마다 줄고, 2028년 중반에는 하락으로 돌아선다는 것입니다. 그 사이 이익은 사상 최대를 이어가겠지만 주가는 그 다음을 봅니다.</p>
        <p class="note mt12">${tag('fact')} ${esc(C.history_note || '')}</p>
      </div>
      <div class="c7">
        <div class="ch"><h3>범용 D램 계약가, 전 분기 대비 상승률 전망</h3><span class="sub">${tag('forecast')}</span></div>
        ${slot({ type: 'range', height: 220, items: C.contract_qoq || [], color: 'var(--s1)', fade: true, aria: '범용 D램 계약가 분기별 상승률 전망 범위' })}
        <p class="note mt8">${esc(C.contract_note || '')}</p>${srcLinks(C.contract_src)}
      </div>
    </div></section>`;

    const sv = secVal(), hv = hynixVal(), sox = Q('^SOX');
    const val = `<section class="card c5">
      <div class="ch"><h3>시장이 가격에 넣은 것</h3><span class="sub">실시간 계산</span></div>
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat"><span class="lb">삼성전자 시총 ÷ 연환산 영업이익</span><span class="vl">${sv ? nf(sv.x, 2) + '배' : '-'}</span><span class="ds">시총 약 ${sv ? krw(sv.mcap) : '-'}</span></div>
        <div class="stat"><span class="lb">SK하이닉스 시총 ÷ 연환산 영업이익</span><span class="vl">${hv ? nf(hv.x, 2) + '배' : '-'}</span><span class="ds">시총 약 ${hv ? krw(hv.mcap) : '-'}</span></div>
        <div class="stat"><span class="lb">SOX 52주 고점 대비</span><span class="vl ${dir(sox && sox.dd)}">${sox ? sgn(sox.dd, 1) : '-'}</span><span class="ds">1995년 이후 하락장 중앙값 약 -35%</span></div>
        <div class="stat"><span class="lb">SK하이닉스 52주 고점 대비</span><span class="vl ${dir((Q('000660.KS') || {}).dd)}">${Q('000660.KS') ? sgn(Q('000660.KS').dd, 1) : '-'}</span><span class="ds">현재가 ${px('000660.KS', (Q('000660.KS') || {}).price)}</span></div>
      </div>
      <p class="lead mt16">${tag('forecast')} ${esc((C.valuation || {}).gs_view || '')}</p>
      <p class="note mt8">${esc((C.valuation || {}).note || '')}</p>
      ${srcLinks(['gs_cut'])}
    </section>`;

    const earn = `<section class="card c7">
      <div class="ch"><h3>분기 영업이익</h3><span class="sub">단위 조 원 ${tag('fact')}</span></div>
      <div class="legend"><span><i class="lk box" style="background:var(--s1)"></i>삼성전자</span><span><i class="lk box" style="background:var(--s2)"></i>SK하이닉스</span></div>
      ${slot({ type: 'cols', height: 220, cats: E.quarters || [], unit: '조', series: [{ name: '삼성전자', color: 'var(--s1)', vals: E.samsung || [] }, { name: 'SK하이닉스', color: 'var(--s2)', vals: E.hynix || [] }], valFmt: (v) => nf(v, 1), aria: '삼성전자와 SK하이닉스 분기 영업이익' })}
      <p class="note mt8">${esc(E.note || '')}</p>${srcLinks(E.src)}
      <div class="divider"></div>
      <ul class="facts">${(C.q3_facts || []).map((f) => `<li>${tag('fact')}<div><b>${esc(f.n)}</b> · ${esc(f.t)}${srcLinks(f.src)}</div></li>`).join('')}</ul>
    </section>`;

    const perf = `<section class="card c12">
      <div class="ch"><h3>메모리 3사와 반도체지수, 최근 6개월</h3><span class="sub">6개월 전 = 100으로 맞춘 값</span></div>
      <div class="legend"><span><i class="lk" style="background:var(--s1)"></i>삼성전자</span><span><i class="lk" style="background:var(--s2)"></i>SK하이닉스</span><span><i class="lk" style="background:var(--s3)"></i>마이크론</span><span><i class="lk" style="background:var(--bench)"></i>SOX</span></div>
      ${slot({ type: 'line', height: 260, series: [
        { name: '삼성전자', color: 'var(--s1)', data: idx('005930.KS', 126) },
        { name: 'SK하이닉스', color: 'var(--s2)', data: idx('000660.KS', 126) },
        { name: '마이크론', color: 'var(--s3)', data: idx('MU', 126) },
        { name: 'SOX', color: 'var(--bench)', width: 1.5, data: idx('^SOX', 126) }
      ], refs: [{ v: 100, label: '6개월 전 = 100' }], yFmt: (v) => nf(v), tipFmt: (v) => nf(v, 1), aria: '메모리 3사와 SOX 6개월 상대 성과' })}
      <div class="tbl-wrap mt12"><table class="tbl"><thead><tr><th>종목</th><th>현재가</th><th>6개월</th><th class="hide-m">연초 대비</th><th>고점 대비</th></tr></thead><tbody>
        ${['005930.KS', '000660.KS', 'MU', '^SOX'].map((s) => { const q = Q(s); return q ? `<tr><td class="l"><span class="nm">${esc(NAME[s])}</span></td><td>${px(s, q.price)}</td><td class="${dir(q.m6)}">${sgn(q.m6, 1)}</td><td class="${dir(q.ytd)} hide-m">${sgn(q.ytd, 1)}</td><td class="${dir(q.dd)}">${sgn(q.dd, 1)}</td></tr>` : ''; }).join('')}
      </tbody></table></div>
    </section>`;

    return head('메모리 사이클', '가격의 방향, 이익의 높이, 주가의 선반영') +
      `<div class="grid">${why}</div>
       <div class="grid">${earn}${val}</div>
       <div class="grid">${perf}</div>
       <div class="grid">${spotCard('c7')}${checklistCard('c5')}</div>
       <div class="grid">${hbmCard('c5')}${soxCard('c7')}</div>`;
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
      <div class="ch"><h3>사이클 정점 신호 점검</h3><span class="sub">${L.length}개 중 ${on}개 켜짐</span></div>
      <ul class="chk">${L.map((x) => {
        let live = '';
        if (x.live === 'dram' && D.ddr5_16g) live = ` 현재 DDR5 16Gb $${nf(D.ddr5_16g.price, 2)}(${sgn(D.ddr5_16g.chg_pct)}).`;
        const tt = String(x.t || '').trim(), dot = live && !/[.!?]$/.test(tt) ? '.' : '';
        return `<li>${badge(x.status)}<div><h4>${esc(x.item)}</h4><p>${tpl(tt)}${dot}${esc(live)}</p>${srcLinks(x.src)}</div></li>`;
      }).join('')}</ul>
      <p class="note mt8">켜짐은 정점 쪽 신호가 나타났다는 뜻, 완충은 하락 충격을 줄여 주는 요인입니다.</p>
    </section>`;
  }
  function hbmCard(c) {
    const C = S.R.cycle || {}, hp = C.hbm4_price || {};
    return `<section class="card ${c}">
      <div class="ch"><h3>HBM 시장 규모 전망</h3><span class="sub">억 달러 ${tag('forecast')}</span></div>
      ${slot({ type: 'cols', height: 190, cats: (C.hbm_market || []).map((d) => d.y), unit: '억 달러', series: [{ name: 'HBM 시장', color: 'var(--s1)', vals: (C.hbm_market || []).map((d) => d.v) }], valFmt: (v) => nf(v), aria: 'HBM 시장 규모 전망' })}
      <p class="note mt8">${esc(C.hbm_note || '')}</p>
      <div class="divider"></div>
      <div class="stat"><span class="lb">HBM4 기가비트당 가격</span><span class="vl">$${nf(hp.now, 2)} → $${nf(hp.lo, 1)}~${nf(hp.hi, 1)}</span><span class="ds">${esc(hp.note || '')}</span></div>
      ${srcLinks(['gs_cut'].concat(hp.src || []))}
    </section>`;
  }
  function soxCard(c) {
    const B = S.R.sox_bears || [], sox = Q('^SOX');
    const items = B.map((b) => {
      const v = b.open && sox && isNum(sox.dd) ? sox.dd : b.dd;
      const tip = `<div class="tt">${esc(b.n)}</div>${tipRow(sgn(v, 1), (b.peak || '').replace('-', '.') + ' 고점 → ' + (b.trough ? b.trough.replace('-', '.') : '진행 중'))}${tipRow(b.down + '개월', '하락 기간')}${b.back != null ? tipRow(b.back + '개월', '전고점 회복') : ''}`;
      return { label: (b.peak || '').slice(0, 4) + ' ' + b.n.replace(/^[\d~]+\s*/, ''), v, vlabel: sgn(v, 1) + (b.open ? ' 진행 중' : ''), hl: !!b.open, tip };
    });
    return `<section class="card ${c}">
      <div class="ch"><h3>반도체지수(SOX) 역대 하락장</h3><span class="sub">고점 대비 최대 하락률 ${tag('fact')}</span></div>
      ${slot({ type: 'hbar', items, labW: 170, valW: 92, rowH: 25, hlColor: 'var(--s1)', color: 'var(--bench)', aria: 'SOX 역대 하락장 비교' })}
      <p class="note mt8">${esc(S.R.sox_note || '')} 2026년 막대는 현재 지수로 다시 계산합니다.</p>
      ${srcLinks(['sox_bears'])}
    </section>`;
  }

  // ================================================================ 8. 내 종목
  function weekly(sym) {
    const s = SER(sym), wk = new Map();
    s.forEach((p) => { wk.set(Math.floor((p.t / 86400e3 + 3) / 7), p.v); });
    const keys = [...wk.keys()].sort((a, b) => a - b), r = new Map();
    for (let i = 1; i < keys.length; i++) r.set(keys[i], wk.get(keys[i]) / wk.get(keys[i - 1]) - 1);
    return r;
  }
  function corr(a, b) {
    const ks = [...a.keys()].filter((k) => b.has(k)).slice(-52);
    if (ks.length < 12) return null;
    const xa = ks.map((k) => a.get(k)), xb = ks.map((k) => b.get(k));
    const ma = xa.reduce((s, v) => s + v, 0) / ks.length, mb = xb.reduce((s, v) => s + v, 0) / ks.length;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < ks.length; i++) { const da = xa[i] - ma, db = xb[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
  }
  function corrCard(c) {
    const W = HOLD.map(weekly), M = [];
    let sum = 0, n = 0;
    for (let i = 0; i < HOLD.length; i++) {
      M.push([]);
      for (let j = 0; j < HOLD.length; j++) {
        const v = i === j ? 1 : corr(W[i], W[j]);
        M[i].push(v);
        if (j > i && isNum(v)) { sum += v; n++; }
      }
    }
    const avg = n ? sum / n : null;
    const cls = (v) => !isNum(v) ? 'z0' : v < 0.15 ? 'q0' : v < 0.3 ? 'q1' : v < 0.45 ? 'q2' : v < 0.6 ? 'q3' : v < 0.75 ? 'q4' : 'q5';
    const body = HOLD.map((s, i) => `<tr><th class="rh">${esc(SHORT[s])}</th>${HOLD.map((t, j) => i === j ? '<td class="self">·</td>' : `<td class="${cls(M[i][j])}" data-tip="${esc(`<div class="tt">${NAME[s]} · ${NAME[t]}</div>${tipRow(isNum(M[i][j]) ? nf(M[i][j], 2) : '-', '주간 수익률 상관계수')}`)}">${isNum(M[i][j]) ? nf(M[i][j], 2) : '-'}</td>`).join('')}</tr>`).join('');
    const msg = !isNum(avg) ? '' : avg >= 0.5 ? '여섯 종목이 서로 다른 회사지만 같은 변수에 묶여 함께 움직입니다. 종목 수만큼 분산된 것이 아니라 AI·반도체 한 축에 집중된 포트폴리오에 가깝습니다.' : avg >= 0.3 ? '종목끼리 어느 정도 같이 움직입니다. 큰 충격이 오면 상관관계는 보통 더 높아집니다.' : '종목끼리 따로 움직이는 편입니다.';
    return `<section class="card ${c}">
      <div class="ch"><h3>종목끼리 얼마나 같이 움직이나</h3><span class="sub">최근 52주 주간 수익률 상관계수</span></div>
      <div class="tbl-wrap"><table class="hm"><thead><tr><th></th>${HOLD.map((s) => `<th>${esc(SHORT[s])}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="hm-legend"><span><i style="background:var(--seq-0)"></i>낮음</span><span><i style="background:var(--seq-2)"></i>중간</span><span><i style="background:var(--seq-5)"></i>높음(1에 가까움)</span></div>
      <p class="lead mt12">${tag('fact')} 평균 상관계수 <b>${isNum(avg) ? nf(avg, 2) : '-'}</b>. ${esc(msg)}</p>
    </section>`;
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

  function portfolioCard(c) {
    const pf = portfolio();
    if (!pf.rows.length) {
      return `<section class="card ${c}"><div class="ch"><h3>내 포트폴리오</h3></div>
        <div class="empty">보유 수량과 평균단가를 넣으면 평가손익, 오늘 변동, 종목·테마 비중을 계산합니다.<div class="row-btns" style="justify-content:center"><button class="btn primary" data-act="pos-open">입력하기</button></div></div></section>`;
    }
    const segs = pf.rows.map((r) => `<i style="width:${((r.v / pf.val) * 100).toFixed(2)}%;background:${SLOT[r.s]}" data-tip="${esc(`<div class="tt">${NAME[r.s]}</div>${tipRow(nf((r.v / pf.val) * 100, 1) + '%', krw(r.v))}`)}"></i>`).join('');
    const theme = {};
    pf.rows.forEach((r) => { const th = ((S.R.holdings || {})[r.s] || {}).theme || '기타'; theme[th] = (theme[th] || 0) + r.v; });
    return `<section class="card ${c}">
      <div class="ch"><h3>내 포트폴리오</h3><a class="sub" href="#stocks" data-act="pos-open">수정</a></div>
      <div class="stats">
        <div class="stat"><span class="lb">평가금액</span><span class="vl">${krw(pf.val)}</span><span class="ds">원/달러 ${nf(pf.fx, 1)}원 환산</span></div>
        <div class="stat"><span class="lb">오늘 변동</span><span class="vl ${dir(pf.day)}">${pf.day > 0 ? '+' : ''}${krw(pf.day)}</span><span class="ds">전 거래일 종가 대비</span></div>
        <div class="stat"><span class="lb">평가손익</span><span class="vl ${dir(pf.pl)}">${pf.pl != null ? (pf.pl > 0 ? '+' : '') + krw(pf.pl) : '-'}</span><span class="ds">${pf.cost ? sgn((pf.val / pf.cost - 1) * 100, 1) : '평균단가 미입력'}</span></div>
      </div>
      <div class="subh">종목 비중</div>
      <div class="seg" role="img" aria-label="종목 비중">${segs}</div>
      <div class="seg-lg">${pf.rows.map((r) => `<span><i class="lk box" style="background:${SLOT[r.s]}"></i>${esc(NAME[r.s])} ${nf((r.v / pf.val) * 100, 1)}%</span>`).join('')}</div>
      <p class="note mt12">테마별: ${Object.keys(theme).map((k) => `${esc(k)} ${nf((theme[k] / pf.val) * 100, 0)}%`).join(' · ')}. 미국 종목 원가는 매수 당시가 아닌 현재 환율로 환산했습니다.</p>
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

  function shortPx(sym, v) {
    if (!isNum(v)) return '-';
    if (!isKR(sym)) return '$' + nf(v, 0);
    if (v < 1e4) return nf(v);
    const m = v / 1e4;
    return nf(m, Math.abs(m - Math.round(m)) < 1e-9 ? 0 : 1) + '만';
  }
  const DRV_NAME = { value: '가격 매력', trend: '추세', stretch: '과매도·과열', flow: '외국인·기관', rel: '상대 강도', memory: '메모리 가격', ai: 'AI 투자 심리', rates: '금리', fx: '환율', korea: '한국 증시', market: '시장 스트레스' };
  function profileBlock(sym, H, it) {
    const P = H.profile;
    if (!P) return '';
    const drv = (P.drivers || []).map((k) => {
      const x = it && it.fs ? it.fs[k] : null, f = x && !x.na ? x.f : null;
      const d = !isNum(f) ? '' : f >= 0.15 ? 'pos' : f <= -0.15 ? 'neg' : 'flat';
      const w = d === 'pos' ? '우호' : d === 'neg' ? '부담' : d === 'flat' ? '중립' : '';
      return `<span class="drv ${d}" title="${esc(x ? x.txt || '' : '')}">${esc(DRV_NAME[k] || k)}${w ? ` <b>${w}</b>` : ''}</span>`;
    }).join('');
    return `<div class="prof">
      <div class="subh" style="margin-top:0">어떤 회사인가</div>
      <p class="prof-what">${tpl(P.what)}</p>
      <ul class="bul">${(P.biz || []).map((b) => `<li>${tpl(b.t || b)}${b.src ? srcLinks(b.src) : ''}</li>`).join('')}</ul>
      ${P.money ? `<p class="lead mt8">${tpl(P.money)}</p>` : ''}
      ${drv ? `<div class="drvs"><span class="k">주가를 움직이는 변수 · 오늘</span>${drv}</div>` : ''}
    </div>`;
  }
  function opinion(n, scale) {
    if (!isNum(n)) return '';
    if (scale === 'naver') return n >= 4.5 ? '강력 매수' : n >= 3.5 ? '매수' : n >= 2.5 ? '중립' : n >= 1.5 ? '매도' : '강력 매도';
    return n <= 1.5 ? '강력 매수' : n <= 2.5 ? '매수' : n <= 3.5 ? '중립' : n <= 4.5 ? '매도' : '강력 매도';
  }
  function outlookBlock(sym, H) {
    const st = H.strategy || {}, n = (S.P.naver || {})[sym] || {}, q = Q(sym) || {};
    const rows = [];
    if (isKR(sym)) {
      if (isNum(n.eps) && sym !== '005935.KS') rows.push(`<div class="val-row"><span>증권사 평균 올해 예상 주당순이익</span><b>${nf(n.eps)}원</b></div>`);
      if (isNum(n.target) && isNum(q.price)) rows.push(`<div class="val-row"><span>증권사 평균 목표가${n.cns_date ? ` <span class="tiny muted">${esc(String(n.cns_date).slice(5).replace('-', '/'))}</span>` : ''}</span><b>${px(sym, n.target)} <span class="tiny ${dir(n.target / q.price - 1)}">${sgn((n.target / q.price - 1) * 100, 0)}</span></b></div>`);
      if (isNum(n.recomm)) rows.push(`<div class="val-row"><span>애널리스트 평균 의견</span><b>${esc(opinion(n.recomm, 'naver'))} <span class="tiny muted">${nf(n.recomm, 2)}/5</span></b></div>`);
    } else {
      if (isNum(q.tgt) && isNum(q.price)) rows.push(`<div class="val-row"><span>애널리스트 평균 목표가</span><b>${px(sym, q.tgt)} <span class="tiny ${dir(q.tgt / q.price - 1)}">${sgn((q.tgt / q.price - 1) * 100, 0)}</span></b></div>`);
      if (isNum(q.rec)) rows.push(`<div class="val-row"><span>애널리스트 평균 의견</span><b>${esc(opinion(q.rec, 'tv'))} <span class="tiny muted">${nf(q.rec, 2)} · 1 강력 매수~5 강력 매도</span></b></div>`);
    }
    const out = (st.outlook || []).map((o) => `<div class="box ${esc(o.id || '')}${o.weight ? ' weight' : ''}"><h5>${esc(o.name)}${o.weight ? '<span class="pill">현재 무게</span>' : ''}</h5><p>${tpl(o.t)}</p></div>`).join('');
    const nx = nextFor(sym, 4);
    return `<div class="outlk">
      <div class="subh" style="margin-top:0">전망 ${tag('forecast')}</div>
      ${H.outlook_note ? `<p class="lead">${tpl(H.outlook_note)}</p>` : ''}
      ${rows.join('')}
      ${rows.length ? '<p class="note mt8">목표가는 하락장에서 늦게 내려옵니다. 매도 기준으로 쓰지 않고 시장 기대의 높이로만 봅니다.</p>' : ''}
      ${out ? `<div class="subh">2027년 시나리오 ${tag('view')}</div><div class="outlook">${out}</div>` : ''}
      ${nx.length ? `<div class="subh">다음 확인 일정</div><ul class="nx">${nx.map((e) => `<li><span class="when">${esc(whenTxt(e))}</span><span>${esc(e.title)}</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }
  function ladder(sym, it, pos) {
    const P = it.plan, p = it.p, rows = [];
    const add = (v, label, cls) => { if (isNum(v) && v > 0) rows.push({ v, label, cls }); };
    add(P.trimHi, '차익 검토가 · 오르면 일부 줄이기', 'trim');
    if (isNum(P.richAt) && P.richAt > p) add(P.richAt, '이익 대비 비싼 구간 시작', 'band');
    if (isNum(P.m50) && P.m50 > p) add(P.m50, '50일선', 'line');
    add(P.m20, '20일선 · 하락이 멈췄는지 보는 선', 'line');
    add(P.buyHi, '흐름 회복 매수가 · 이 위로 회복하면 매수', 'buy');
    if (P.buyLo && P.buyLo < p) { add(P.steps[0], '1차 매수가', 'buy'); add(P.steps[1], '2차 매수가', 'buy'); add(P.steps[2], '3차 매수가', 'buy'); }
    else if (P.buyNow) { add(P.steps[1], '다음 회차 매수가', 'buy'); add(P.steps[2], '그다음 회차', 'buy'); }
    add(P.trimLo, '경계선 · 밀리면 비중 점검', 'trim');
    if (isNum(P.cheapAt) && P.cheapAt < p) add(P.cheapAt, '이익 대비 싼 구간 시작', 'band');
    if (pos && pos.avg > 0) add(pos.avg, '내 평균단가', 'mine');
    const near = rows.filter((r) => r.cls === 'mine' || (r.v <= p * 1.7 && r.v >= p * 0.55));
    near.sort((a, b) => b.v - a.v);
    const out = [];
    near.forEach((r) => { const pr = out[out.length - 1]; if (pr && Math.abs(pr.v / r.v - 1) < 0.004) { pr.label += ' · ' + r.label; return; } out.push(r); });
    let i = out.findIndex((r) => r.v < p);
    if (i < 0) i = out.length;
    out.splice(i, 0, { v: p, label: '지금', cls: 'now' });
    return `<ol class="ladder">${out.map((r) => `<li class="${r.cls}"><span class="lb">${esc(r.label)}</span><b class="num">${px(sym, r.v)}</b><span class="num ${r.cls === 'now' ? 'muted' : dir(r.v / p - 1)}">${r.cls === 'now' ? esc(it.level.name) : sgn((r.v / p - 1) * 100, 1)}</span></li>`).join('')}</ol>`;
  }
  function factorBars(it) {
    const list = it.reasons || [], mx = Math.max(10, ...list.map((x) => Math.abs(x.c)));
    return `<ul class="fbars">${list.map((x) => `<li><span class="fn">${esc(x.name)}</span><span class="fb"><i class="${x.c >= 0 ? 'pos' : 'neg'}" style="${x.c >= 0 ? 'left' : 'right'}:50%;width:${((Math.abs(x.c) / mx) * 50).toFixed(1)}%"></i></span><b class="num">${x.c > 0.05 ? '+' : x.c < -0.05 ? '−' : ''}${nf(Math.abs(x.c), 1)}</b><span class="ft">${esc(x.txt)}</span></li>`).join('')}</ul>`;
  }
  function verdictBlock(sym, it, H, pos) {
    if (!it) return '';
    const E = ENG(), plan = (H.strategy && H.strategy.plan) || [];
    const notes = (it.notes || []).slice(1).map((n) => `<li>${esc(n.t)}</li>`).join('');
    return `<div class="strat verdict">
      <div class="strat-head"><span class="call ${esc(it.level.tone)}">${esc(it.level.name)}</span>${tag('view')}<span class="muted small">${esc(it.level.zone)} · 점수 ${it.score > 0 ? '+' : ''}${it.score}${it.crash ? ' · 급락 국면 보정 적용' : ''}</span></div>
      <p class="strat-line">${esc(it.line)}</p>
      <div class="axes wide">${axBar('가격 매력', it.V)}${axBar('흐름', it.T)}</div>
      ${notes ? `<ul class="bul mt8">${notes}</ul>` : ''}
      <div class="strat-grid">
        <div><div class="subh">가격 계획</div>${ladder(sym, it, pos)}<p class="note mt8">매수가는 다른 변수가 오늘과 같다고 보고 가격만 움직였을 때 사는 구역에 드는 가격입니다. 변수가 바뀌면 매일 다시 계산합니다.</p></div>
        <div><div class="subh">변수별 기여</div>${factorBars(it)}</div>
      </div>
      <div class="subh">최근 20거래일 판단</div>
      <div class="trow solo"><span class="cells">${trailCells(sym, it, E)}</span></div>
      ${plan.length ? `<div class="subh">판단을 바꿀 사건 ${tag('view')}</div><ul class="ifthen">${plan.map((x) => `<li><div class="if"><span class="k">이럴 때</span>${tpl(x.if)}</div><div class="then"><span class="k">이렇게</span>${tpl(x.then)}</div></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function stockDetail(sym) {
    const q = Q(sym), H = (S.R.holdings || {})[sym] || {}, pos = S.pos[sym] || {}, it = EI(sym);
    if (!q) return `<section class="card c12"><div class="empty">${esc(NAME[sym])} 시세를 아직 받지 못했습니다</div></section>`;
    const refs = [];
    if (pos.avg > 0) refs.push({ v: pos.avg, label: '내 평균단가 ' + shortPx(sym, pos.avg), color: 'var(--ink)' });
    if (it && it.plan) {
      if (it.plan.buyLo && it.plan.buyLo < q.price) refs.push({ v: it.plan.buyLo, label: '1차 매수 ' + shortPx(sym, it.plan.buyLo), color: 'var(--call-add)' });
      if (it.plan.trimHi) refs.push({ v: it.plan.trimHi, label: '차익 검토 ' + shortPx(sym, it.plan.trimHi), color: 'var(--call-trim)' });
    }
    const V = H.val || {}, nv = (S.P.naver || {})[sym] || {};
    const base = V.type === 'pe' ? (V.eps || [])[isNum(V.band) ? V.band : (V.eps || []).length - 1] : null;
    const epsB = base ? (V.auto_eps && isNum(nv.eps) && nv.eps > 0 ? nv.eps : base.v) : null;
    if (base && (V.bands || []).length) V.bands.forEach((m) => refs.push({ v: epsB * m, label: 'PER ' + m + '배 ' + shortPx(sym, epsB * m) }));
    else (V.targets || []).forEach((t) => refs.push({ v: t.p, label: t.n + ' ' + shortPx(sym, t.p) }));
    const s = SER(sym);
    // 주가 범위에서 너무 먼 기준선은 빼서 주가 선이 눌리지 않게 합니다.
    let sLo = Infinity, sHi = -Infinity;
    s.forEach((x) => { sLo = Math.min(sLo, x.v); sHi = Math.max(sHi, x.v); });
    const refsIn = refs.filter((r) => r.v >= sLo * 0.8 && r.v <= sHi * 1.2);
    const rng = isNum(q.hi52) && isNum(q.lo52) && q.hi52 > q.lo52 ? q.hi52 - q.lo52 : null;
    const at = (v) => (rng ? Math.max(0, Math.min(100, ((v - q.lo52) / rng) * 100)) : 50);
    const gap50 = isNum(q.ma50) ? (q.price / q.ma50 - 1) * 100 : null;
    const pl = pos.qty > 0 && pos.avg > 0 ? (q.price / pos.avg - 1) * 100 : null;
    const ex = extTxt(sym, q);
    return `<section class="card c12 stock-card" style="--slot:${SLOT[sym]}">
      <div class="sh-head">
        <div><div><span class="sh-name">${esc(NAME[sym])}</span><span class="sh-code">${esc(CODE[sym])}</span></div><div class="role">${esc(H.role || '')}</div></div>
        <div class="sh-right"><div class="sh-price num">${px(sym, q.price)}</div><div class="sh-chg ${chgDir(sym, q)}">${chgText(sym, q)} <span class="muted small">${esc(qTime(q))}</span></div>${ex ? `<div class="small">${ex}</div>` : ''}</div>
      </div>
      ${verdictBlock(sym, it, H, pos)}
      <div class="grid mt20 detail-top">
        <div class="c6">${profileBlock(sym, H, it)}</div>
        <div class="c6">${outlookBlock(sym, H)}</div>
      </div>
      <div class="grid mt20 detail-grid">
        <div class="c7">
          <div class="subh" style="margin-top:0">1년 주가와 기준선</div>
          ${slot({ type: 'line', height: 250, area: true, yTicks: 5, series: [{ name: NAME[sym], color: SLOT[sym], data: s }], refs: refsIn, yFmt: (v) => shortPx(sym, v), tipFmt: (v) => px(sym, v), aria: NAME[sym] + ' 1년 주가' })}
          <div class="range mt12" aria-label="52주 범위">
            <div class="bar"></div>
            ${pos.avg > 0 && rng ? `<div class="rf" style="left:${at(pos.avg).toFixed(1)}%" title="내 평균단가"></div>` : ''}
            <div class="mk" style="left:${at(q.price).toFixed(1)}%"></div>
          </div>
          <div class="range-lb"><span>52주 저가 ${px(sym, q.lo52)}</span><span>52주 고가 ${px(sym, q.hi52)}</span></div>
          <div class="kv mt16">
            <div><span>1주</span><b class="${dir(q.w1)}">${sgn(q.w1, 1)}</b></div>
            <div><span>1개월</span><b class="${dir(q.m1)}">${sgn(q.m1, 1)}</b></div>
            <div><span>3개월</span><b class="${dir(q.m3)}">${sgn(q.m3, 1)}</b></div>
            <div><span>연초 대비</span><b class="${dir(q.ytd)}">${sgn(q.ytd, 1)}</b></div>
            <div><span>52주 고점 대비</span><b class="${dir(q.dd)}">${sgn(q.dd, 1)}</b></div>
            <div><span>52주 저점 대비</span><b class="${dir(q.from_lo)}">${sgn(q.from_lo, 1)}</b></div>
            <div><span>50일 평균선 대비</span><b class="${dir(gap50)}">${sgn(gap50, 1)}</b></div>
            <div><span>20일 변동성(연율)</span><b>${isNum(q.vol20) ? nf(q.vol20, 0) + '%' : '-'}</b></div>
          </div>
          ${pl != null ? `<p class="lead mt12">내 평균단가 ${px(sym, pos.avg)} 대비 <b class="${dir(pl)}">${sgn(pl, 1)}</b>, ${nf(pos.qty)}주 보유.</p>` : ''}
          ${valBlock(sym, q, H)}
        </div>
        <div class="c5">
          <div class="subh" style="margin-top:0">확인된 사실과 전망</div>
          <ul class="facts">${(H.facts || []).map((f) => `<li>${tag(f.k)}<div>${tpl(f.t)}${srcLinks(f.src)}</div></li>`).join('')}</ul>
          ${H.thesis ? `<div class="subh">보유 논리 ${tag('view')}</div><p class="lead">${tpl(H.thesis)}</p>` : ''}
          ${H.risks ? `<div class="subh">이럴 때 다시 점검</div><ul class="bul">${H.risks.map((r) => `<li>${tpl(r)}</li>`).join('')}</ul>` : ''}
          ${H.next && !H.strategy ? `<div class="subh">다음 확인 일정</div><ul class="bul">${H.next.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    </section>`;
  }

  function vStocks() {
    const sym = HOLD.includes(S.stock) ? S.stock : HOLD[0];
    const chips = HOLD.map((s) => { const q = Q(s), it = EI(s); return `<button class="chipbtn" aria-pressed="${s === sym}" data-stock="${esc(s)}">${it ? `<i class="tdot ${esc(it.level.tone)}" title="${esc(it.level.name)}"></i>` : ''}${esc(NAME[s])}${q ? ` <span class="num ${chgDir(s, q)}">${chgText(s, q)}</span>` : ''}</button>`; }).join('');
    return head('내 종목', '어떤 회사인지, 전망, 지금 판단 · 숫자는 실시간 가격으로 다시 계산합니다') +
      (S.editPos ? `<div class="grid">${posEditor()}</div>` : '') +
      `<div class="grid"><div class="c12"><div class="chips" role="group" aria-label="종목 선택">${chips}</div></div></div>
       <div class="grid">${stockDetail(sym)}</div>
       <div class="grid">${portfolioCard('c6')}${corrCard('c6')}</div>`;
  }

  // ================================================================ 9. 대내외 변수
  function vMacro() {
    const M = S.R.macro || {}, fed = M.fed || {}, bok = M.bok || {};
    const rates = `<section class="card c7">
      <div class="ch"><h3>미국 금리</h3><span class="sub">국채 금리 1년 · 회색 띠는 현재 연준 목표 범위</span></div>
      <div class="legend"><span><i class="lk" style="background:var(--s1)"></i>10년물</span><span><i class="lk" style="background:var(--s2)"></i>5년물</span><span><i class="lk" style="background:var(--s3)"></i>3개월물</span></div>
      ${slot({ type: 'line', height: 240, series: [
        { name: '10년물', color: 'var(--s1)', data: SER('^TNX') },
        { name: '5년물', color: 'var(--s2)', data: SER('^FVX') },
        { name: '3개월물', color: 'var(--s3)', data: SER('^IRX') }
      ], band: isNum(fed.lo) ? { lo: fed.lo, hi: fed.hi, from: dUTC('2026-10-28'), label: '연준 ' + (fed.now || '') } : null, yFmt: (v) => nf(v, 2) + '%', aria: '미국 국채 금리 1년' })}
      <p class="note mt8">3개월물이 정책금리 범위보다 높게 있으면 시장이 추가 인상을 가격에 넣고 있다는 뜻입니다.</p>
    </section>`;
    const cb = (t, o) => {
      const dd = ddays(o.next);
      return `<div class="box" style="border:1px solid var(--line);border-radius:12px;padding:14px">
        <div class="eyebrow">${esc(t)}</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.03em">${esc(o.now || '-')}</div>
        <p class="small ink2 mt8">${tag('fact')} ${esc(o.t || '')}</p>
        <p class="small ink2 mt8">${tag('forecast')} ${esc(o.market || '')}</p>
        <div class="meta tiny muted mt8">다음 결정 ${o.next ? esc(mdw(parseKST(o.next))) : '-'}${isNum(dd) && dd >= 0 ? ' · D-' + dd : ''}</div>
        ${srcLinks(o.src)}
      </div>`;
    };
    const banks = `<section class="card c5"><div class="ch"><h3>정책금리</h3><span class="sub">긴축 국면</span></div>
      <div style="display:grid;gap:12px">${cb('미국 연준', fed)}${cb('한국은행', bok)}</div></section>`;
    const fxQ = Q('KRW=X'), fxS = SER('KRW=X');
    const fx1y = fxS.length > 2 ? (fxS[fxS.length - 1].v / fxS[0].v - 1) * 100 : null;
    const krwM = M.krw || {};
    const fx = `<section class="card c6">
      <div class="ch"><h3>원/달러</h3><span class="sub">${fxQ ? px('KRW=X', fxQ.price) + ' · ' + chgText('KRW=X', fxQ) : ''}</span></div>
      ${slot({ type: 'line', height: 200, area: true, series: [{ name: '원/달러', color: 'var(--s1)', data: fxS }], refs: [{ v: krwM.q2, label: '2분기 평균 ' + nf(krwM.q2) }, { v: krwM.q3, label: '3분기 평균 ' + nf(krwM.q3) }].filter((r) => isNum(r.v)), yFmt: (v) => nf(v), tipFmt: (v) => nf(v, 1) + '원', aria: '원달러 환율 1년' })}
      <p class="lead mt12">${tag('fact')} ${esc(krwM.t || '')}</p>
      ${isNum(fx1y) ? `<p class="lead mt8">${tag('view')} 원/달러가 1년 전보다 ${nf(Math.abs(fx1y), 1)}% ${fx1y < 0 ? '내려 미국 종목의 원화 환산 수익이 그만큼 줄었습니다' : '올라 미국 종목의 원화 환산 수익이 그만큼 늘었습니다'}.</p>` : ''}
      <p class="note mt8">${esc(krwM.extra || '')}</p>${srcLinks(krwM.src)}
    </section>`;
    const fr = S.P.fred || {}, oas = fr.BAMLH0A0HYM2;
    let creditChart;
    if (oas && oas.d) {
      const t0 = dUTC(oas.s);
      creditChart = slot({ type: 'line', height: 200, area: true, series: [{ name: '하이일드 스프레드', color: 'var(--s1)', data: oas.d.map((d, i) => ({ t: t0 + d * 86400e3, v: oas.c[i] })) }], yFmt: (v) => nf(v, 1) + '%p', tipFmt: (v) => nf(v, 2) + '%p', aria: '하이일드 스프레드' });
    } else {
      const hq = Q('HYG');
      creditChart = slot({ type: 'line', height: 200, area: true, series: [{ name: 'HYG', color: 'var(--s1)', data: SER('HYG') }], refs: hq && isNum(hq.ma50) ? [{ v: hq.ma50, label: '50일 평균 $' + nf(hq.ma50, 2) }] : [], yFmt: (v) => '$' + nf(v, 0), tipFmt: (v) => '$' + nf(v, 2), aria: '하이일드 채권 ETF 가격' });
    }
    const credit = `<section class="card c6">
      <div class="ch"><h3>신용 시장</h3><span class="sub">${oas ? 'FRED 하이일드 스프레드' : '하이일드 채권 ETF(HYG) 1년'}</span></div>
      ${creditChart}
      <p class="lead mt12">${tag('view')} AI 설비투자의 상당 부분이 빚으로 조달됩니다. 하이일드 채권이 밀리기 시작하면 투자 계획보다 먼저 자금 조달이 막힐 수 있다는 신호로 봅니다.</p>
    </section>`;
    const cap = M.capex || {};
    const capex = `<section class="card c6">
      <div class="ch"><h3>빅테크 2026년 설비투자 계획</h3><span class="sub">억 달러 ${tag('fact')}</span></div>
      ${slot({ type: 'hbar', items: (cap.items || []).map((d) => ({ label: d.n, v: d.v, vlabel: '$' + nf(d.v * 10) + '억', tip: `<div class="tt">${esc(d.n)}</div>${tipRow(d.t, '2026년 계획')}` })), labW: 96, valW: 76, rowH: 30, bar: 16, color: 'var(--s1)', aria: '빅테크 설비투자 계획' })}
      <p class="lead mt12">${esc(cap.t || '')}</p>${srcLinks(cap.src)}
      <div class="divider"></div>
      <div class="subh" style="margin-top:0">엔비디아</div>
      <p class="lead">${esc((M.nvidia || {}).t || '')}</p>${srcLinks((M.nvidia || {}).src)}
    </section>`;
    const ex = M.exports || {}, fl = M.flows || {};
    const exp = `<section class="card c6">
      <div class="ch"><h3>수출과 수급</h3><span class="sub">${esc(ex.t || '')}</span></div>
      <div class="stats">
        <div class="stat"><span class="lb">전체 수출</span><span class="vl">${nf(ex.total)}<span class="u">억 달러</span></span><span class="ds up">${sgn(ex.total_yoy, 1)} 전년 대비</span></div>
        <div class="stat"><span class="lb">반도체 수출</span><span class="vl">${nf(ex.semi, 1)}<span class="u">억 달러</span></span><span class="ds up">${sgn(ex.semi_yoy, 1)} 전년 대비</span></div>
        <div class="stat"><span class="lb">반도체 비중</span><span class="vl">${nf(ex.share, 1)}%</span><span class="ds">전체 수출 중</span></div>
      </div>
      ${srcLinks(ex.src)}
      <div class="divider"></div>
      <div class="subh" style="margin-top:0">외국인 수급</div>
      <p class="lead">${tag('fact')} ${esc(fl.t || '')}</p>${srcLinks(fl.src)}
      <p class="lead mt8">${tag('view')} 실적과 수출이 사상 최대인데 외국인이 파는 것은 지금이 아니라 다음 사이클을 팔고 있다는 뜻입니다. 외국인 매도가 멈추는 시점이 주가 바닥과 겹친 경우가 많았습니다.</p>
    </section>`;
    const pol = `<section class="card c6"><div class="ch"><h3>정책·규제</h3></div>
      <ul class="facts">${(M.policy || []).map((p) => `<li>${tag('fact')}<div><b>${esc(p.n)}</b> · ${esc(p.t)}${srcLinks(p.src)}</div></li>`).join('')}</ul></section>`;
    const sup = `<section class="card c6"><div class="ch"><h3>공급 쪽 변화</h3></div>
      <ul class="facts">${(M.supply || []).map((p) => `<li>${tag('fact')}<div><b>${esc(p.n)}</b> · ${esc(p.t)}${srcLinks(p.src)}</div></li>`).join('')}</ul></section>`;
    return head('대내외 변수', '금리·환율·수급·AI 투자·정책·공급') +
      `<div class="grid">${rates}${banks}</div>
       <div class="grid">${fx}${credit}</div>
       <div class="grid">${capex}${exp}</div>
       <div class="grid">${pol}${sup}</div>
       <div class="grid">${sensCard('c12')}</div>`;
  }

  function sensCard(c) {
    const SN = S.R.sensitivity || {}, cols = SN.cols || HOLD;
    const cell = (v, why, rowName, sym) => {
      const cls = v === 'm' ? 'mx' : v >= 2 ? 'p2' : v === 1 ? 'p1' : v === 0 ? 'z0' : v === -1 ? 'n1' : 'n2';
      const txt = v === 'm' ? '±' : v > 0 ? '+'.repeat(v) : v < 0 ? '-'.repeat(-v) : '0';
      const tip = `<div class="tt">${esc(rowName)} → ${esc(NAME[sym])}</div><div>${esc(why || '')}</div>`;
      return `<td class="${cls}" data-tip="${esc(tip)}" aria-label="${esc(NAME[sym] + ' ' + txt + ' ' + (why || ''))}">${txt}</td>`;
    };
    const rows = (SN.rows || []).map((r) => `<tr><th class="rh">${esc(r.n)}</th>${r.v.map((v, i) => cell(v, (r.why || [])[i], r.n, cols[i])).join('')}</tr>`).join('');
    return `<section class="card ${c}">
      <div class="ch"><h3>변수가 내 종목에 주는 영향</h3><span class="sub">${tag('view')} 칸을 누르면 이유가 나옵니다</span></div>
      <div class="tbl-wrap"><table class="hm"><thead><tr><th></th>${cols.map((s) => `<th title="${esc(NAME[s])}">${esc(SHORT[s] || NAME[s])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="hm-legend"><span><i style="background:var(--up-strong)"></i>++ 크게 우호</span><span><i style="background:var(--up-soft);border:1px solid var(--line)"></i>+ 우호</span><span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>0 영향 작음</span><span><i style="background:var(--down-soft);border:1px solid var(--line)"></i>- 부담</span><span><i style="background:var(--down-strong)"></i>-- 큰 부담</span><span><i style="background:var(--surface-3)"></i>± 엇갈림</span></div>
      <p class="note mt8">${esc(SN.note || '')} 색은 한국 시장 관례(오름 빨강, 내림 파랑)를 따릅니다.</p>
    </section>`;
  }

  // ================================================================ 10. 일정·근거
  function vAgenda() {
    const cal = S.R.calendar || [], srcs = S.R.sources || {};
    const up = cal.filter((e) => { const d = ddays(e.d); return d == null || d >= 0; });
    const past = cal.filter((e) => { const d = ddays(e.d); return d != null && d < 0; });
    return head('일정·근거', '내 종목에 영향을 주는 일정과 이 페이지가 쓴 근거') +
      `<div class="grid">
        <section class="card c7"><div class="ch"><h3>다가오는 일정</h3><span class="sub">한국 시간 · 관련 종목 표시</span></div>
          <ul class="cal">${up.map(calItem).join('') || '<li class="empty">예정된 일정이 없습니다</li>'}</ul>
          ${past.length ? `<details class="past mt12"><summary>지난 일정 ${past.length}개</summary><ul class="cal mt8">${past.map(calItem).join('')}</ul></details>` : ''}
        </section>
        ${eventsCard('c5')}
      </div>
      <div class="grid">
        <section class="card c7"><div class="ch"><h3>출처</h3><span class="sub">분석에 쓴 공시·보도·전망</span></div>
          <ul class="src-list">${Object.keys(srcs).map((k) => `<li><a href="${esc(srcs[k].u)}" target="_blank" rel="noopener">${esc(srcs[k].n)}</a></li>`).join('')}</ul></section>
        <section class="card c5"><div class="ch"><h3>용어</h3></div><dl class="gl">${(S.R.glossary || []).map((g) => `<dt>${esc(g.w)}</dt><dd>${esc(g.t)}</dd>`).join('')}</dl>
          <div class="divider"></div><p class="note">${tag('fact')} 공시나 보도로 확인한 내용 ${tag('forecast')} 기관이나 회사의 전망 ${tag('view')} 이 페이지의 해석 ${tag('report')} 한 곳의 보도로만 확인된 내용</p></section>
      </div>`;
  }

  // ================================================================ 11. 렌더·라우팅
  function renderStatus() {
    const el = document.getElementById('statusBar');
    if (!el) return;
    const P = S.P, ts = P.updated_ts ? P.updated_ts * 1000 : parseKST(P.updated_at);
    const ss = sessions(), sn = stressNow();
    const liveOk = S.liveAt && Date.now() - S.liveAt < 15 * 60e3;
    let h;
    if (liveOk) {
      h = `<span class="chipline"><i class="dot good"></i>시세 ${hms(S.liveAt)} · 국내 20분·미국 15분 지연</span>`;
      if (ts) h += `<span class="sep"></span><span class="chipline">차트·현물가 ${esc(mdw(ts) + ' ' + hm(ts))}</span>`;
    } else {
      const age = ts ? (Date.now() - ts) / 60000 : null;
      const fresh = age == null ? 'idle' : age < 100 ? 'good' : age < 360 ? 'warn' : 'crit';
      h = `<span class="chipline"><i class="dot ${S.liveErr ? 'warn' : fresh}"></i>시세 ${ts ? esc(mdw(ts) + ' ' + hm(ts)) : '-'} 기준${ts ? ' · ' + ago(ts) : ''}${S.liveErr ? ' · 실시간 연결 실패' : ''}</span>`;
    }
    h += `<span class="sep"></span><span class="chipline">코스피 ${ss.kr} · 미국 ${ss.us}</span>`;
    if (isNum(sn.score)) h += `<span class="sep"></span><a class="chipline stress-chip" href="#today/stress">시장 스트레스 ${sn.score} · ${esc(sn.level)}</a>`;
    el.innerHTML = h;
  }
  function render() {
    CH.clear();
    hideTip();
    const fn = { today: vToday, cycle: vCycle, stocks: vStocks, macro: vMacro, agenda: vAgenda }[S.view] || vToday;
    const main = document.getElementById('view');
    main.innerHTML = fn() + footer();
    mountCharts();
    bindTips(main);
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.getAttribute('data-view') === S.view)));
    document.title = (VIEWS.find((v) => v.id === S.view) || {}).label + ' · 반도체 브리핑';
    renderStatus();
  }
  function parseHash() {
    const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    const i = h.indexOf('/'), v = i >= 0 ? h.slice(0, i) : h, a = i >= 0 ? h.slice(i + 1) : null;
    return { v: VIEWS.some((x) => x.id === v) ? v : null, a };
  }
  function applyRoute(scroll) {
    const r = parseHash();
    S.view = r.v || 'today';
    if (S.view === 'stocks' && r.a && HOLD.includes(r.a)) S.stock = r.a;
    render();
    if (r.a && S.view !== 'stocks') {
      const t = document.getElementById(r.a);
      if (t) { t.scrollIntoView({ block: 'start' }); window.scrollBy(0, -130); return; }
    }
    if (scroll) window.scrollTo(0, 0);
  }
  function go(hash) { if (location.hash === '#' + hash) applyRoute(true); else location.hash = hash; }

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
    const tabs = document.getElementById('tabs'), dock = document.getElementById('dock');
    if (tabs) tabs.innerHTML = VIEWS.map((v) => `<button class="tab" role="tab" data-view="${v.id}" aria-selected="false">${esc(v.label)}</button>`).join('');
    if (dock) dock.innerHTML = VIEWS.map((v) => `<button data-view="${v.id}" aria-selected="false" aria-label="${esc(v.label)}"><svg viewBox="0 0 24 24">${v.icon}</svg>${esc(v.short || v.label)}</button>`).join('');
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
    window.addEventListener('resize', () => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(mountCharts, 160); });
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
