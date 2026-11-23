/* 반도체 브리핑 v2 · app.js
   데이터
     window.__INITIAL_BRIEFING_PAYLOAD__ : 시세·현물가·신호 (scripts/update_market_data.py 가 index.html 에 삽입)
     window.__RESEARCH__                 : 분석·출처·일정 (data/research.json 을 같은 방식으로 삽입)
   갱신: 5분마다, 그리고 화면으로 돌아올 때 data/latest_briefing.json 을 다시 읽습니다.
   '시세 직접 조회' 버튼은 공개 프록시를 거쳐 Yahoo 시세를 바로 받아 옵니다(실패하면 서버 데이터 유지). */
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
    { id: 'agenda', label: '일정·뉴스', short: '일정', icon: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>' }
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
    directAt: 0,
    directN: 0,
    directTotal: 0,
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
    if (q.direct && q.at) return '직접 조회 ' + hm(q.at);
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
  function sessions(ms = Date.now()) {
    const k = kst(ms), m = k.h * 60 + k.mi, wd = k.wd;
    const weekday = wd >= 1 && wd <= 5;
    const dst = usDST(ms), o = dst ? 1350 : 1410, c = dst ? 300 : 360;
    return {
      kr: weekday && m >= 540 && m <= 930 ? '장중' : '마감',
      us: (weekday && m >= o) || (wd >= 2 && wd <= 6 && m < c) ? '장중' : '마감'
    };
  }

  // ================================================================ 2. 데이터 접근
  function Q(sym) {
    const b = (S.P.quotes || {})[sym], d = S.direct[sym];
    if (b && d) return Object.assign({}, b, d);
    return b || d || null;
  }
  const serCache = new Map();
  function SER(sym) {
    const raw = (S.P.series || {})[sym];
    if (!raw || !raw.d || !raw.s) return [];
    const key = sym + '|' + (S.P.updated_ts || 0);
    if (serCache.has(key)) return serCache.get(key);
    const t0 = dUTC(raw.s), out = [];
    for (let i = 0; i < raw.d.length; i++) if (isNum(raw.c[i])) out.push({ t: t0 + raw.d[i] * 86400e3, v: raw.c[i] });
    serCache.set(key, out);
    return out;
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
    hynix_x: () => { const v = hynixVal(); return v ? nf(v.x, 1) : null; }
  };
  function tpl(text) {
    return esc(text).replace(/\{\{(\w+)\}\}/g, (m, k) => { const v = TOKENS[k] ? TOKENS[k]() : null; return v == null ? '…' : esc(v); });
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
    const m = { t: 12, r: sp.endLabels === false ? 10 : 62, b: 22, l: 2 };
    const series = sp.series.filter((s) => s.data && s.data.length >= 2);
    if (!series.length) { el.innerHTML = '<div class="empty">데이터가 아직 충분하지 않습니다</div>'; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    series.forEach((s) => s.data.forEach((p) => { x0 = Math.min(x0, p.t); x1 = Math.max(x1, p.t); y0 = Math.min(y0, p.v); y1 = Math.max(y1, p.v); }));
    (sp.refs || []).forEach((r) => { if (isNum(r.v)) { y0 = Math.min(y0, r.v); y1 = Math.max(y1, r.v); } });
    if (sp.band) { y0 = Math.min(y0, sp.band.lo); y1 = Math.max(y1, sp.band.hi); }
    const pd = (y1 - y0) * 0.08 || Math.abs(y1) * 0.04 || 1;
    const TK = ticks(y0 - pd, y1 + pd, sp.yTicks || (H < 170 ? 3 : 4));
    const X = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - TK.lo) / (TK.hi - TK.lo || 1)) * (H - m.t - m.b);
    const yf = sp.yFmt || ((v) => nf(v));
    m.l = Math.ceil(Math.max(...TK.list.map((v) => textW(yf(v))))) + 8;
    let g = '';
    if (sp.band) {
      const bx = sp.band.from ? Math.max(m.l, Math.min(W - m.r, X(sp.band.from))) : m.l;
      g += `<rect x="${bx.toFixed(1)}" y="${Y(sp.band.hi).toFixed(1)}" width="${Math.max(2, W - m.r - bx).toFixed(1)}" height="${Math.max(1.5, Y(sp.band.lo) - Y(sp.band.hi)).toFixed(1)}" fill="var(--surface-3)"/>`;
    }
    TK.list.forEach((v) => {
      const y = Y(v);
      g += `<line x1="${m.l}" x2="${(W - m.r).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    });
    const span = (x1 - x0) / 86400e3, nT = W < 420 ? 3 : 5;
    for (let i = 0; i <= nT; i++) {
      const t = x0 + ((x1 - x0) * i) / nT;
      const lab = sp.xFmt ? sp.xFmt(t) : span > 200 ? sdateYM(t) : sdate(t);
      g += T(X(t), H - 5, lab, `font-size="10.5" fill="var(--muted)" text-anchor="${i === 0 ? 'start' : i === nT ? 'end' : 'middle'}"`);
    }
    (sp.refs || []).forEach((r) => {
      if (!isNum(r.v)) return;
      const y = Y(r.v);
      g += `<line x1="${m.l}" x2="${(W - m.r).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${r.color || 'var(--ink-2)'}" stroke-width="1" opacity="${r.color ? 0.9 : 0.5}"/>`;
      g += T(W - m.r - 3, y - 4, r.label, `font-size="10.5" font-weight="600" fill="var(--ink-2)" text-anchor="end" ${HALO}`);
    });
    if (sp.band && sp.band.label) {
      const bx = sp.band.from ? Math.max(m.l, Math.min(W - m.r, X(sp.band.from))) : m.l;
      g += T(Math.max(m.l + 2, bx - 4), Y(sp.band.hi) - 5, sp.band.label, `font-size="10.5" font-weight="600" fill="var(--ink-2)" text-anchor="${bx > W / 2 ? 'end' : 'start'}" ${HALO}`);
    }
    const ends = [];
    series.forEach((s) => {
      let d = '';
      s.data.forEach((p, i) => { d += (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); });
      if (sp.area && series.length === 1) {
        const a = s.data[0], b = s.data[s.data.length - 1];
        g += `<path d="${d}L${X(b.t).toFixed(1)} ${(H - m.b).toFixed(1)}L${X(a.t).toFixed(1)} ${(H - m.b).toFixed(1)}Z" fill="${s.color}" opacity=".10"/>`;
      }
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (s.marks) s.data.forEach((p) => { if (p.seed) g += `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3.2" fill="var(--surface)" stroke="${s.color}" stroke-width="1.6"/>`; });
      const lp = s.data[s.data.length - 1];
      ends.push({ x: X(lp.t), y: Y(lp.v), v: lp.v, s });
    });
    TK.list.forEach((v) => { g += T(m.l - 6, Y(v) + 3.5, yf(v), 'font-size="10.5" fill="var(--muted)" text-anchor="end"'); });
    let labels = sp.endLabels !== false;
    if (labels) { const ys = ends.map((e) => e.y).sort((a, b) => a - b); for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] < 13) labels = false; }
    ends.forEach((e) => {
      g += `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="4" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      if (labels) g += T(e.x + 8, e.y + 4, (e.s.endFmt || sp.tipFmt || yf)(e.v), 'font-size="11.5" font-weight="700" fill="var(--ink)"');
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
        rows += tipRow((s.tipFmt || tf)(p.v), s.name, series.length > 1 ? s.color : null);
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
  const DRAW = { line: drawLine, cols: drawCols, range: drawRange, hbar: drawHBar };

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
      시세는 Yahoo Finance(지연될 수 있음), 메모리 현물가는 DRAMeXchange, 뉴스는 Google News에서 자동으로 가져옵니다.
      자동 갱신은 GitHub Actions(약 1시간 간격)와 PC 작업(12:00, 19:00)이 맡습니다.
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
    const R = S.R, st = R.stance || {};
    const pts = (st.points || []).map((p) => `<li>${tag(p.k)}<div>${tpl(p.t)}${srcLinks(p.src)}</div></li>`).join('');
    const hero = `<section class="card hero c12">
      <div class="eyebrow">오늘의 판단 · ${esc(R.as_of_label || '')}</div>
      <h2>${esc(st.headline || '분석 자료를 불러오는 중입니다')}</h2>
      ${st.label ? `<div class="stance"><i class="dot"></i>${esc(st.label)}</div>` : ''}
      <ul class="pts">${pts}</ul>
      <div class="dodont">
        <div class="box"><h4>할 일</h4><ul>${(st.do || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div class="box"><h4>하지 않을 일</h4><ul>${(st.dont || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </div>
      <p class="note mt12">${esc(R.note || '')}</p>
    </section>`;
    return head('오늘', esc(S.P.market_date || '')) +
      `<div class="grid">${hero}</div>
       <div class="grid">${stressCard('c5')}<div class="c7 stack">${tilesCard('')}${upcomingCard('')}</div></div>
       <div class="grid">${holdingsCard('c12')}</div>
       <div class="grid">${eventsCard('c7')}${scenarioCard('c5', true)}</div>`;
  }

  function stressCard(c) {
    const P = S.P, st = P.stress || {}, sig = P.signals || [], score = st.score, lc = levelCls(score);
    const rows = sig.map((s) => `<div class="sig">${badge(s.status)}<div class="nm">${esc(s.label)}</div><div class="vl num">${fmtSig(s)}</div><div class="rl">${esc(s.rule)}${s.note ? ' · ' + esc(s.note) : ''}</div></div>`).join('');
    const hist = ((P.history || {}).stress || []).filter((h) => isNum(h.v)).map((h) => ({ t: dUTC(h.d), v: h.v }));
    const histChart = hist.length >= 3 ? `<div class="subh">스트레스 지수 추이</div>` + slot({ type: 'line', height: 120, series: [{ name: '시장 스트레스', color: 'var(--s1)', data: hist }], yFmt: (v) => nf(v), aria: '시장 스트레스 지수 추이' }) : '';
    return `<section class="card ${c}" id="stress">
      <div class="ch"><h3>시장 스트레스</h3><span class="sub">신호 ${sig.length}개 평균 · 0 안정 ~ 100 극단</span></div>
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

  function holdingsCard(c) {
    const pf = portfolio(), byS = {};
    pf.rows.forEach((r) => { byS[r.s] = r; });
    const hasPos = pf.rows.length > 0;
    const rows = HOLD.map((s) => {
      const q = Q(s);
      if (!q) return '';
      const r = byS[s];
      return `<tr class="click" data-go="stocks/${esc(s)}">
        <td class="l"><span class="nm">${esc(NAME[s])}</span><span class="cd">${esc(CODE[s])}</span></td>
        <td>${px(s, q.price)}</td>
        <td class="${chgDir(s, q)}">${chgText(s, q)}</td>
        <td class="${dir(q.w1)} hide-m">${sgn(q.w1, 1)}</td>
        <td class="${dir(q.dd)}">${sgn(q.dd, 1)}</td>
        ${hasPos ? `<td class="${dir(r && r.pl)}">${r && r.pl != null ? sgn(r.plp, 1) : '-'}</td>` : ''}
        <td class="spk hide-m">${spark(lastN(SER(s), 63))}</td>
      </tr>`;
    }).join('');
    const sum = hasPos ? `<div class="stats mt16">
        <div class="stat"><span class="lb">평가금액</span><span class="vl">${krw(pf.val)}</span><span class="ds">미국 종목은 원/달러 ${nf(pf.fx, 1)}원으로 환산</span></div>
        <div class="stat"><span class="lb">오늘 변동</span><span class="vl ${dir(pf.day)}">${pf.day > 0 ? '+' : ''}${krw(pf.day)}</span><span class="ds">전 거래일 종가 대비</span></div>
        <div class="stat"><span class="lb">평가손익</span><span class="vl ${dir(pf.pl)}">${pf.pl != null ? (pf.pl > 0 ? '+' : '') + krw(pf.pl) : '-'}</span><span class="ds">${pf.cost ? sgn((pf.val / pf.cost - 1) * 100, 1) + ' · 평균단가 입력 종목 기준' : '평균단가를 넣으면 계산합니다'}</span></div>
      </div>` : '';
    return `<section class="card ${c}">
      <div class="ch"><h3>내 종목</h3><span class="sub">${hasPos ? '' : '보유 수량을 넣으면 손익과 비중을 계산합니다 · '}<a href="#stocks" data-act="pos-open">수량·단가 입력</a></span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>종목</th><th>현재가</th><th>전일 대비</th><th class="hide-m">1주</th><th>52주 고점 대비</th>${hasPos ? '<th>손익률</th>' : ''}<th class="hide-m">3개월</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${sum}
    </section>`;
  }

  function eventsCard(c) {
    const ev = S.R.events || [];
    return `<section class="card ${c}">
      <div class="ch"><h3>최근 3주에 무슨 일이 있었나</h3><span class="sub">최신순</span></div>
      <ul class="tl">${ev.map((e) => `<li><span class="dt">${esc(e.d)}</span><div><h4>${tag(e.k)} ${esc(e.title)}</h4><p>${esc(e.body)}</p>${srcLinks(e.src)}</div></li>`).join('')}</ul>
    </section>`;
  }
  function calItem(e) {
    const dd = ddays(e.d), firm = e.firm !== false && !e.approx;
    const dtxt = dd == null ? '' : dd === 0 ? 'D-DAY' : dd > 0 ? 'D-' + dd : '지남';
    const when = e.approx ? esc(e.approx) + '(예상)' : mdw(parseKST(e.d)) + (e.t ? ' ' + esc(e.t) : '');
    return `<li><span class="dday ${dd != null && dd >= 0 && dd <= 3 ? 'soon' : ''} ${dd != null && dd < 0 ? 'past' : ''}"><b>${firm ? dtxt : '예정'}</b><span>${firm ? esc(mdw(parseKST(e.d))) : esc(e.approx || '')}</span></span>
      <div><h4>${esc(e.title)}</h4><div class="meta">${when} · <span class="pill">${esc(e.tag || '')}</span>${firm ? '' : ' · 날짜 미확정'}</div><p>${esc(e.note || '')}</p></div></li>`;
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
        <dl><dt>조건</dt><dd>${esc(s.cond)}</dd><dt>예상 흐름</dt><dd>${esc(s.result)}</dd><dt>먼저 볼 것</dt><dd>${esc(s.watch)}</dd></dl></div>`).join('')}</div>
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
      ], refs: [{ v: 100, label: '6개월 전' }], yFmt: (v) => nf(v), tipFmt: (v) => nf(v, 1), aria: '메모리 3사와 SOX 6개월 상대 성과' })}
      <div class="tbl-wrap mt12"><table class="tbl"><thead><tr><th>종목</th><th>현재가</th><th>6개월</th><th class="hide-m">연초 대비</th><th>52주 고점 대비</th></tr></thead><tbody>
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
        return `<li>${badge(x.status)}<div><h4>${esc(x.item)}</h4><p>${tpl(x.t)}${esc(live)}</p>${srcLinks(x.src)}</div></li>`;
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
        <p class="note mt8">주식 수 약 ${nf(V.shares_total / 1e8, 1)}억 주(3분기 배당 총액에서 역산) 기준 단순 계산입니다. 실제 배분은 회사가 정합니다.</p>`;
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
      const rows = (V.eps || []).map((e) => `<div class="val-row"><span>${esc(e.y)} 주당순이익 $${nf(e.v, 2)} 기준 PER</span><b>${nf(q.price / e.v, 1)}배</b></div>`).join('');
      const base = (V.eps || [])[(V.eps || []).length - 1] || (V.eps || [])[0];
      const bands = base ? (V.bands || []).map((m) => { const p = base.v * m; return `<div class="val-row"><span>${esc(base.y)} 이익의 ${m}배</span><b>$${nf(p, 0)} <span class="${dir(p / q.price - 1)} tiny">${sgn((p / q.price - 1) * 100, 1)}</span></b></div>`; }).join('') : '';
      return `<div class="subh">밸류에이션 <span class="tiny muted">실시간 계산</span></div>${rows}
        <div class="subh">이익 배수로 본 가격대 ${tag('view')}</div>${bands}
        <p class="note mt8">회사 가이던스나 컨센서스가 바뀌면 이 숫자도 바뀝니다. 같은 배수를 주가 차트의 가로선으로 표시했습니다.</p>`;
    }
    if (V.type === 'op') {
      return `<div class="subh">숫자로 보기</div>
        <div class="val-row"><span>3분기 영업이익 × 4 (연환산)</span><b>${krw(V.op_q * 4)}</b></div>
        <p class="note mt8">발행 주식 수를 확인하지 못해 배수는 계산하지 않았습니다.</p>`;
    }
    return '';
  }

  function stockDetail(sym) {
    const q = Q(sym), H = (S.R.holdings || {})[sym] || {}, pos = S.pos[sym] || {};
    if (!q) return `<section class="card c12"><div class="empty">${esc(NAME[sym])} 시세를 아직 받지 못했습니다</div></section>`;
    const refs = [];
    if (pos.avg > 0) refs.push({ v: pos.avg, label: '내 평균단가 ' + px(sym, pos.avg), color: 'var(--ink)' });
    const V = H.val || {};
    (V.targets || []).forEach((t) => refs.push({ v: t.p, label: t.n + ' ' + px(sym, t.p) }));
    if (V.type === 'pe') {
      const base = (V.eps || [])[(V.eps || []).length - 1];
      if (base) (V.bands || []).forEach((m) => refs.push({ v: base.v * m, label: m + '배 $' + nf(base.v * m, 0) }));
    }
    const s = SER(sym);
    const rng = isNum(q.hi52) && isNum(q.lo52) && q.hi52 > q.lo52 ? q.hi52 - q.lo52 : null;
    const at = (v) => rng ? Math.max(0, Math.min(100, ((v - q.lo52) / rng) * 100)) : 50;
    const gap50 = isNum(q.ma50) ? (q.price / q.ma50 - 1) * 100 : null;
    const pl = pos.qty > 0 && pos.avg > 0 ? (q.price / pos.avg - 1) * 100 : null;
    const news = (((S.P.live_news || {}).stocks || {})[sym] || []).slice(0, 4);
    return `<section class="card c12">
      <div class="grid" style="gap:22px">
        <div class="c7">
          <div class="sh-head">
            <div><div><span class="sh-name">${esc(NAME[sym])}</span><span class="sh-code">${esc(CODE[sym])}</span></div><div class="role">${esc(H.role || '')}</div></div>
            <div style="text-align:right"><div class="sh-price">${px(sym, q.price)}</div><div class="sh-chg ${chgDir(sym, q)}">${chgText(sym, q)} <span class="muted small">${esc(qTime(q))}</span></div></div>
          </div>
          <div class="mt16">${slot({ type: 'line', height: 250, area: true, series: [{ name: NAME[sym], color: 'var(--s1)', data: s }], refs, yFmt: (v) => isKR(sym) ? (v >= 10000 ? nf(v / 10000, (v / 10000) % 1 === 0 ? 0 : 1) + '만' : nf(v)) : '$' + nf(v, 0), tipFmt: (v) => px(sym, v), aria: NAME[sym] + ' 1년 주가' })}</div>
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
          <ul class="facts">${(H.facts || []).map((f) => `<li>${tag(f.k)}<div>${esc(f.t)}${srcLinks(f.src)}</div></li>`).join('')}</ul>
          ${H.thesis ? `<div class="subh">보유 논리 ${tag('view')}</div><p class="lead">${esc(H.thesis)}</p>` : ''}
          ${H.risks ? `<div class="subh">이럴 때 다시 점검</div><ul class="bul">${H.risks.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          ${H.next ? `<div class="subh">다음 확인 일정</div><ul class="bul">${H.next.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          <div class="subh">최근 뉴스</div>
          ${news.length ? `<ul class="news">${news.map(newsItem).join('')}</ul>` : '<p class="note">최근 7일 뉴스가 없습니다</p>'}
        </div>
      </div>
    </section>`;
  }

  function vStocks() {
    const sym = HOLD.includes(S.stock) ? S.stock : HOLD[0];
    const chips = HOLD.map((s) => { const q = Q(s); return `<button class="chipbtn" aria-pressed="${s === sym}" data-stock="${esc(s)}">${esc(NAME[s])}${q ? ` <span class="num ${chgDir(s, q)}">${chgText(s, q)}</span>` : ''}</button>`; }).join('');
    return head('내 종목', '숫자는 실시간으로 다시 계산합니다') +
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

  // ================================================================ 10. 일정·뉴스
  const KW = [[/가격|price|계약가|현물/i, '가격'], [/실적|earnings|매출|영업이익|revenue|guidance|가이던스/i, '실적'], [/목표가|target/i, '목표가'], [/금리|연준|fed|rate|금통위/i, '금리'], [/수출|export/i, '수출'], [/hbm/i, 'HBM'], [/관세|tariff|규제|통제|sec\b|probe|조사/i, '정책·규제'], [/외국인|순매도|순매수|수급/i, '수급'], [/capex|설비투자|투자 계획|spending/i, 'AI 투자']];
  function newsItem(n) {
    const kws = [];
    KW.forEach(([re, l]) => { if (kws.length < 2 && l !== n.tag && re.test(n.title || '')) kws.push(l); });
    const t = n.ts ? n.ts * 1000 : null;
    return `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <div class="meta"><span>${esc(n.source || '')}</span><span>${t ? esc(mdw(t) + ' ' + hm(t)) + ' · ' + ago(t) : esc(n.pubDate || '')}</span>${n.tag ? `<span class="pill">${esc(n.tag)}</span>` : ''}${kws.map((k) => `<span class="kw">${esc(k)}</span>`).join('')}</div></li>`;
  }
  function vAgenda() {
    const cal = S.R.calendar || [];
    const N = S.P.live_news || {};
    let list = [];
    if (S.newsTab === 'all') {
      list = (N.sector || []).slice();
      HOLD.forEach((s) => ((N.stocks || {})[s] || []).forEach((n) => list.push(Object.assign({ tag: NAME[s] }, n))));
      const seen = new Set();
      list = list.filter((n) => { const k = (n.title || '').replace(/\W+/g, '').slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; });
      list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      list = list.slice(0, 30);
    } else if (S.newsTab === 'sector') list = N.sector || [];
    else list = ((N.stocks || {})[S.newsTab] || []).map((n) => Object.assign({ tag: NAME[S.newsTab] }, n));
    const tabs = [['all', '전체'], ['sector', '시장·업황']].concat(HOLD.map((s) => [s, NAME[s]]));
    const upd = parseKST(N.updated_at);
    const srcs = S.R.sources || {};
    return head('일정·뉴스', '날짜가 정해진 일정은 D-day로, 통상 일정은 예상 시기로 표시합니다') +
      `<div class="grid">
        <section class="card c7"><div class="ch"><h3>주요 일정</h3><span class="sub">한국 시간 기준</span></div><ul class="cal">${cal.map(calItem).join('')}</ul></section>
        <section class="card c5"><div class="ch"><h3>뉴스</h3><span class="sub">최근 7일 · ${upd ? esc(hm(upd)) + ' 수집' : ''}</span></div>
          <div class="chips" role="group" aria-label="뉴스 분류">${tabs.map(([k, l]) => `<button class="chipbtn" style="height:30px;padding:0 11px;font-size:12.5px" aria-pressed="${S.newsTab === k}" data-news="${esc(k)}">${esc(l)}</button>`).join('')}</div>
          <ul class="news mt12">${list.length ? list.map(newsItem).join('') : '<li class="empty">뉴스가 없습니다</li>'}</ul>
        </section>
      </div>
      <div class="grid">
        <section class="card c7"><div class="ch"><h3>출처</h3><span class="sub">분석에 쓴 공시·보도</span></div>
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
    const age = ts ? (Date.now() - ts) / 60000 : null;
    const fresh = age == null ? 'idle' : age < 100 ? 'good' : age < 360 ? 'warn' : 'crit';
    const ss = sessions(), st = P.stress || {};
    let h = `<span class="chipline"><i class="dot ${fresh}"></i>시세 ${ts ? esc(mdw(ts) + ' ' + hm(ts)) : '-'} 기준${ts ? ' · ' + ago(ts) : ''}${fresh === 'crit' ? ' · 자동 갱신 지연' : ''}</span>`;
    if (S.directAt) h += `<span class="sep"></span><span class="chipline">직접 조회 ${hms(S.directAt)} · ${S.directN}/${S.directTotal}</span>`;
    h += `<span class="sep"></span><span class="chipline">코스피 ${ss.kr} · 미국 ${ss.us}</span>`;
    if (isNum(st.score)) h += `<span class="sep"></span><a class="chipline stress-chip" href="#today/stress">시장 스트레스 ${st.score} · ${esc(st.level)}</a>`;
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
  async function getJSON(url, ms = 8000) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, { cache: 'no-store', signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
  }
  async function pull(manual) {
    const now = Date.now();
    const urls = ['data/latest_briefing.json?t=' + now, 'https://raw.githubusercontent.com/dnrzoqs-byte/memory-briefing/main/data/latest_briefing.json?t=' + now];
    const res = await Promise.allSettled(urls.map((u) => getJSON(u)));
    let best = null;
    res.forEach((r) => { if (r.status === 'fulfilled' && r.value && r.value.schema === 2 && (!best || (r.value.updated_ts || 0) > (best.updated_ts || 0))) best = r.value; });
    let changed = false;
    if (best && (best.updated_ts || 0) > (S.P.updated_ts || 0)) { S.P = best; serCache.clear(); changed = true; }
    try {
      const r = await getJSON('data/research.json?t=' + now);
      if (r && r.as_of && (r.version !== S.R.version || r.as_of !== S.R.as_of)) { S.R = r; changed = true; }
    } catch (e) { /* 로컬 파일 열기 등 */ }
    if (changed) { render(); toast('새 데이터를 반영했습니다 · ' + (S.P.updated_at || '').slice(11, 16)); } else { renderStatus(); if (manual) toast('이미 최신 데이터입니다'); }
  }

  const DIRECT_SYMS = HOLD.concat(['000660.KS', 'MU', 'NVDA', '^KS11', '^SOX', '^IXIC', '^VIX', '^TNX', 'KRW=X']);
  const PROXIES = [
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
  ];
  let proxyFirst = 0;
  async function directOne(sym) {
    const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d&_=${Date.now()}`;
    const order = [proxyFirst].concat([0, 1, 2].filter((i) => i !== proxyFirst));
    for (const i of order) {
      try {
        const j = await getJSON(PROXIES[i](target), 6000);
        const res = j && j.chart && j.chart.result && j.chart.result[0], m = res && res.meta;
        if (!m || !isNum(m.regularMarketPrice)) continue;
        const off = m.gmtoffset || 0, by = new Map();
        const ts = res.timestamp || [], cl = ((res.indicators || {}).quote || [{}])[0].close || [];
        const dk = (sec) => new Date((sec + off) * 1000).toISOString().slice(0, 10);
        ts.forEach((t, k) => { if (isNum(cl[k]) && cl[k] > 0) by.set(dk(t), cl[k]); });
        if (m.regularMarketTime) by.set(dk(m.regularMarketTime), m.regularMarketPrice);
        const keys = [...by.keys()].sort();
        if (keys.length < 2) continue;
        const price = by.get(keys[keys.length - 1]), prev = by.get(keys[keys.length - 2]);
        proxyFirst = i;
        return { price, prev, chg: price - prev, chg_pct: (price / prev - 1) * 100, direct: true, at: Date.now(), time: null };
      } catch (e) { /* 다음 프록시 */ }
    }
    return null;
  }
  async function directRefresh() {
    if (S.busy) return;
    S.busy = true;
    const btn = document.getElementById('btnDirect');
    if (btn) { btn.disabled = true; btn.textContent = '조회 중'; }
    const out = {}, queue = DIRECT_SYMS.slice();
    let ok = 0;
    const worker = async () => { while (queue.length) { const s = queue.shift(); const r = await directOne(s); if (r) { out[s] = r; ok++; } } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    S.direct = out;
    S.directAt = Date.now(); S.directN = ok; S.directTotal = DIRECT_SYMS.length;
    S.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = '시세 직접 조회'; }
    render();
    toast(ok ? `직접 조회 ${ok}/${DIRECT_SYMS.length} 종목 반영` : '직접 조회에 실패했습니다 · 서버 데이터를 유지합니다');
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
    const bd = document.getElementById('btnDirect');
    if (bd) bd.addEventListener('click', directRefresh);
    const bt = document.getElementById('btnTheme');
    if (bt) bt.addEventListener('click', () => setTheme(effectiveDark() ? 'light' : 'dark'));
    let rt = 0, lastW = window.innerWidth;
    window.addEventListener('resize', () => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(rt); rt = setTimeout(mountCharts, 160); });
    window.addEventListener('scroll', hideTip, { passive: true });
    setInterval(() => { if (!document.hidden) pull(false); }, 5 * 60e3);
    setInterval(renderStatus, 60e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(false); });
    setTimeout(() => pull(false), 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
