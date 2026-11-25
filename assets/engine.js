/* 반도체 브리핑 · 오늘의 대응 엔진 (assets/engine.js)
   브라우저(app.js)와 Node(scripts/engine_cli.js, 카톡 문구)가 이 파일 하나를 함께 씁니다.
   입력: 일봉 종가(서버 1년치에 실시간 마지막 점을 더한 것), D램 현물가 기록, 외국인·기관 수급 기록,
         research.json 의 이익 전망·일정·보유 논리 상태, (있으면) 내 보유 수량.
   출력: 종목마다 오늘의 판단(분할 매수·매수 대기·보유·비중 점검·비중 축소), 점수(-100~100), 변수별 기여,
         이유 문장, 가격 계획(매수 시작가·분할 간격·차익 검토가), 최근 거래일 판단 추이.
   판단은 규칙으로 계산한 참고값입니다. 규칙과 숫자는 이 파일에만 있어 화면과 카톡이 늘 같은 답을 냅니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MBE = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2026-11-26';
  const DAY = 86400e3;
  const HOLD = ['005935.KS', '005930.KS', '353200.KS', '240810.KQ', 'AMD', 'CLS'];
  const NAME = { '005935.KS': '삼성전자우', '005930.KS': '삼성전자', '353200.KS': '대덕전자', '240810.KQ': '원익IPS', AMD: 'AMD', CLS: '셀레스티카' };
  const SHORT = { '005935.KS': '삼성우', '005930.KS': '삼성', '353200.KS': '대덕', '240810.KQ': '원익', AMD: 'AMD', CLS: 'CLS' };
  const MEMORY = new Set(['005930.KS', '005935.KS', '353200.KS', '240810.KQ']);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isKR = (s) => /\.(KS|KQ)$/.test(s);
  const clamp = (v, a = -1, b = 1) => (isNum(v) ? Math.max(a, Math.min(b, v)) : 0);
  const lin = (v, a, b) => Math.max(0, Math.min(100, ((v - a) / (b - a)) * 100));

  // ------------------------------------------------------------ 변수와 종목별 무게
  // 같은 변수라도 종목마다 주가에 주는 무게가 다릅니다. 줄마다 합계 1.
  const FACTORS = [
    { k: 'value', name: '가격 매력', desc: '이익·배당 대비 지금 가격' },
    { k: 'trend', name: '추세', desc: '20일·50일 평균선과 가격의 위치' },
    { k: 'stretch', name: '과매도·과열', desc: 'RSI와 20일선에서 벌어진 정도' },
    { k: 'flow', name: '외국인·기관', desc: '최근 5거래일 순매수' },
    { k: 'rel', name: '상대 강도', desc: '최근 20일 수익률을 기준 지수와 비교' },
    { k: 'memory', name: '메모리 가격', desc: 'DDR5 현물 4주·1주 변화' },
    { k: 'ai', name: 'AI 투자 심리', desc: '엔비디아·반도체지수 추세' },
    { k: 'rates', name: '금리', desc: '미국 10년물 수준과 20일 변화' },
    { k: 'fx', name: '환율', desc: '원/달러 수준과 20일 변화' },
    { k: 'korea', name: '한국 증시', desc: '코스피 추세' },
    { k: 'market', name: '시장 스트레스', desc: '7개 위험 신호 평균과 1주 변화' }
  ];
  // 두 축으로 판단합니다.
  //  가격 매력(V): 이익·배당 대비 가격에, 이익을 좌우하는 업황(메모리 가격 또는 AI 투자 심리)을 섞은 값
  //  흐름(T): 추세·과매도·수급·금리·환율·시장 분위기처럼 "지금 사도 되는 때인가"를 말하는 값
  // 줄마다 합계 1. 같은 변수라도 종목마다 주가에 주는 무게가 다릅니다.
  const VW = {
    '005930.KS': { value: 0.75, memory: 0.25 },
    '005935.KS': { value: 0.80, memory: 0.20 },
    '353200.KS': { value: 0.70, memory: 0.20, ai: 0.10 },
    '240810.KQ': { value: 0.65, memory: 0.35 },
    AMD: { value: 0.70, ai: 0.30 },
    CLS: { value: 0.60, ai: 0.40 }
  };
  const TW = {
    '005930.KS': { trend: 0.20, stretch: 0.14, flow: 0.12, rel: 0.05, ai: 0.15, rates: 0.08, fx: 0.06, korea: 0.08, market: 0.12 },
    '005935.KS': { trend: 0.20, stretch: 0.14, flow: 0.10, rel: 0.05, ai: 0.10, rates: 0.12, fx: 0.06, korea: 0.11, market: 0.12 },
    '353200.KS': { trend: 0.20, stretch: 0.14, flow: 0.11, rel: 0.05, ai: 0.18, rates: 0.07, fx: 0.08, korea: 0.07, market: 0.10 },
    '240810.KQ': { trend: 0.20, stretch: 0.14, flow: 0.11, rel: 0.05, ai: 0.12, rates: 0.07, fx: 0.06, korea: 0.12, market: 0.13 },
    AMD: { trend: 0.20, stretch: 0.14, rel: 0.06, ai: 0.26, rates: 0.18, fx: 0.05, market: 0.11 },
    CLS: { trend: 0.20, stretch: 0.14, rel: 0.06, ai: 0.30, rates: 0.14, fx: 0.05, market: 0.11 }
  };
  // 급락 국면(시장 스트레스 65 이상이거나 52주 고점 대비 -40% 아래)에서는 추세 신호가 자주 틀립니다(급반등).
  // 그래서 추세성 변수의 무게를 절반으로 줄이고 과매도 무게를 1.5배로 늘립니다.
  const MOMO = new Set(['trend', 'rel', 'korea', 'ai']);

  // 판단 단계와 구역. 가격 매력(V)과 흐름(T)이 함께 정합니다.
  const LEVELS = [
    { id: 'sell', name: '비중 축소', tone: 'trim', zone: '줄이는 구역', act: '반등 때 보유분의 일부를 줄입니다' },
    { id: 'trim', name: '비중 점검', tone: 'warn', zone: '점검 구역', act: '더 사지 않고, 오르면 일부 줄이는 쪽을 봅니다' },
    { id: 'hold', name: '보유', tone: 'hold', zone: '지키는 구역', act: '사지도 팔지도 않습니다' },
    { id: 'ready', name: '매수 대기', tone: 'wait', zone: '기다리는 구역', act: '정한 가격이나 조건이 오면 삽니다' },
    { id: 'buy', name: '분할 매수', tone: 'add', zone: '사는 구역', act: '계획 금액의 4분의 1을 삽니다' }
  ];
  const LIDX = { sell: 0, trim: 1, hold: 2, ready: 3, buy: 4 };
  // m 만큼 구역을 넓혀(+) 또는 좁혀(-) 봅니다. 한 번 정한 판단은 경계를 6점 넘게 지나야 바뀝니다(하루 흔들림 방지).
  const ZONES = {
    sell: (V, T, m) => V <= -50 + m && T <= -30 + m,
    buy: (V, T, m) => (V >= 35 - m && T >= -15 - m) || (V >= 65 - m && T >= -35 - m),
    ready: (V, T, m) => V >= 35 - m && T < -15 + m,
    trim: (V, T, m) => (V <= -25 + m && T < 30 + m) || (V < 35 + m && T <= -45 + m) || (V < 10 + m && T >= 60 - m),
    hold: (V, T, m) => V > -25 - m && V < 35 + m && T > -45 - m
  };
  const ZORDER = ['sell', 'buy', 'ready', 'trim', 'hold'];
  const HYST = 6;
  function zoneOf(V, T) { for (const z of ZORDER) if (ZONES[z](V, T, 0)) return z; return 'hold'; }
  function zoneHyst(V, T, prev) {
    const z = zoneOf(V, T);
    if (!prev || z === prev) return z;
    if (ZONES[prev](V, T, HYST) && !ZONES[z](V, T, -HYST)) return prev;
    return z;
  }
  const MAJOR_TAGS = new Set(['금리', '실적', 'AI 투자', '메모리']);

  // ------------------------------------------------------------ 계산 도구
  function prep(points) {
    const t = [], v = [];
    (points || []).forEach((p) => { if (p && isNum(p.t) && isNum(p.v)) { t.push(p.t); v.push(p.v); } });
    return { t, v };
  }
  function idxAt(S, t) {
    let lo = 0, hi = S.t.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (S.t[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  function sma(a, e, n) {
    if (e < n - 1) return null;
    let s = 0;
    for (let i = e - n + 1; i <= e; i++) s += a[i];
    return s / n;
  }
  function rsi(a, e, n = 14) {
    const st = Math.max(1, e - 150);
    if (e - st + 1 < n + 1) return null;
    let g = 0, l = 0;
    for (let i = st; i < st + n; i++) { const d = a[i] - a[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = st + n; i <= e; i++) { const d = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function vol(a, e, n = 20) {
    if (e < n) return null;
    let s = 0, s2 = 0;
    for (let i = e - n + 1; i <= e; i++) { const r = Math.log(a[i] / a[i - 1]); s += r; s2 += r * r; }
    const m = s / n;
    return Math.sqrt(Math.max(0, s2 / n - m * m));
  }
  const ret = (a, e, k) => (e - k >= 0 && a[e - k] ? a[e] / a[e - k] - 1 : null);
  function minIn(a, s, e) { let m = Infinity; for (let i = Math.max(0, s); i <= e; i++) if (a[i] < m) m = a[i]; return m; }
  function maxIn(a, s, e) { let m = -Infinity; for (let i = Math.max(0, s); i <= e; i++) if (a[i] > m) m = a[i]; return m; }

  // ------------------------------------------------------------ 글자
  const nf = (v, d = 0) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-');
  const sg = (v, d = 1, suf = '%') => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '-' : '') + nf(Math.abs(v), d) + suf : '-');
  const bpT = (dp) => (isNum(dp) ? (dp > 0 ? '+' : dp < 0 ? '-' : '') + nf(Math.abs(dp * 100), 0) + 'bp' : '-');
  function tick(v) { return v < 2000 ? 1 : v < 5000 ? 5 : v < 20000 ? 10 : v < 50000 ? 50 : v < 200000 ? 100 : v < 500000 ? 500 : 1000; }
  function roundPx(sym, v, mode) {
    if (!isNum(v)) return null;
    const f = mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round;
    if (isKR(sym)) { const k = tick(v); return f(v / k) * k; }
    return f(v * 2) / 2;
  }
  function px(sym, v) { return !isNum(v) ? '-' : isKR(sym) ? nf(v) + '원' : '$' + nf(v, 2); }
  function pxShort(sym, v) {
    if (!isNum(v)) return '-';
    if (!isKR(sym)) return '$' + nf(v, v >= 100 ? 0 : 1);
    if (v < 1e4) return nf(v) + '원';
    const m = v / 1e4;
    return nf(m, m >= 100 ? 0 : 1).replace(/\.0$/, '') + '만 원';
  }
  const TREND_TXT = {
    up: '20일선 위에서 오르는 추세',
    pullback: '오르는 추세 속 조정(20일선 아래, 50일선 위)',
    recover: '20일선과 50일선을 모두 되찾음',
    rebound: '20일선은 되찾았지만 50일선 아래',
    down: '20일선·50일선 아래, 내리는 추세',
    breakdown: '내리는 추세, 20일 최저가 근처',
    na: '추세를 볼 기록이 부족'
  };
  const TREND_SHORT = { up: '상승 추세', pullback: '상승 중 조정', recover: '추세 회복 시도', rebound: '반등 시도', down: '하락 추세', breakdown: '하락 추세(최저가 근처)', na: '기록 부족' };

  function trendOf(a, e) {
    const p = a[e], m20 = sma(a, e, 20), m50 = sma(a, e, 50);
    if (!isNum(m20) || !isNum(m50)) return { st: 'na', f: 0, m20, m50 };
    const m20p = sma(a, e - 5, 20), rising = isNum(m20p) && m20 > m20p;
    let st, f;
    if (p > m20 && m20 >= m50) { st = 'up'; f = rising ? 1 : 0.6; }
    else if (p <= m20 && p > m50) { st = 'pullback'; f = 0.2; }
    else if (p > m20 && p > m50) { st = 'recover'; f = 0.5; }
    else if (p > m20) { st = 'rebound'; f = 0; }
    else { const lo = minIn(a, e - 19, e - 1); st = p <= lo * 1.01 ? 'breakdown' : 'down'; f = st === 'breakdown' ? -1 : -0.7; }
    return { st, f, m20, m50, rising, gap50: (p / m50 - 1) * 100 };
  }

  // ------------------------------------------------------------ 맥락 만들기
  // input = { ser: {sym: [{t,v}]}, dram: [{t,v}], flows: {sym: [{t,f,o,v}]}, cns: {sym: {eps}}, research, pos, today, now }
  function makeCtx(input) {
    const S = {};
    Object.keys(input.ser || {}).forEach((k) => { S[k] = prep(input.ser[k]); });
    const D = prep(input.dram || []);
    const F = {};
    Object.keys(input.flows || {}).forEach((k) => {
      F[k] = (input.flows[k] || []).filter((x) => x && isNum(x.t)).sort((a, b) => a.t - b.t);
    });
    return { S, D, F, cns: input.cns || {}, R: input.research || {}, pos: input.pos || {}, today: input.today, now: input.now || Date.now(), _mk: new Map(), _st: new Map() };
  }
  function at(ctx, sym, t) {
    const S = ctx.S[sym];
    if (!S || !S.t.length) return null;
    const e = idxAt(S, t);
    return e >= 0 ? { a: S.v, e, t: S.t[e], v: S.v[e] } : null;
  }

  function dramAt(ctx, t) {
    const H = ctx.D, e = idxAt(H, t);
    if (e < 0 || (t - H.t[e]) / DAY > 12) return null;
    const lt = H.t[e], lv = H.v[e];
    let b28 = null, b7 = null, d28 = Infinity, d7 = Infinity;
    for (let i = 0; i < e; i++) {
      const age = Math.round((lt - H.t[i]) / DAY);
      if (age >= 14 && Math.abs(age - 28) < d28) { d28 = Math.abs(age - 28); b28 = { v: H.v[i], age }; }
      if (age >= 4 && age <= 12 && Math.abs(age - 7) < d7) { d7 = Math.abs(age - 7); b7 = { v: H.v[i], age }; }
    }
    return { v: lv, t: lt, m28: b28 ? (lv / b28.v - 1) * 100 : null, age28: b28 ? b28.age : null, m7: b7 ? (lv / b7.v - 1) * 100 : null };
  }

  // 시장 스트레스: 서버(scripts/update_market_data.py build_signals)와 같은 규칙을 그날까지의 기록으로 계산합니다.
  const SIG_RULES = [
    { id: 'vix', sym: '^VIX', kind: 'level', a: 14, b: 36, st: (v) => (v < 20 ? 'ok' : v < 28 ? 'watch' : 'warn') },
    { id: 'sox', sym: '^SOX', kind: 'gap', a: -6, b: 14, st: (g) => (g >= 0 ? 'ok' : g >= -8 ? 'watch' : 'warn') },
    { id: 'kospi', sym: '^KS11', kind: 'gap', a: -5, b: 12, st: (g) => (g >= 0 ? 'ok' : g >= -7 ? 'watch' : 'warn') },
    { id: 'nvda', sym: 'NVDA', kind: 'gap', a: -6, b: 20, st: (g) => (g >= 0 ? 'ok' : g >= -10 ? 'watch' : 'warn') },
    { id: 'us10y', sym: '^TNX', kind: 'level', a: 3.9, b: 5.2, st: (v) => (v < 4.3 ? 'ok' : v < 4.75 ? 'watch' : 'warn') },
    { id: 'credit', sym: 'HYG', kind: 'gap', a: -0.5, b: 4, st: (g) => (g >= -0.5 ? 'ok' : g >= -2 ? 'watch' : 'warn') }
  ];
  function stressAt(ctx, t) {
    const key = Math.round(t / 3600e3);
    if (ctx._st.has(key)) return ctx._st.get(key);
    const sig = [];
    SIG_RULES.forEach((r) => {
      const x = at(ctx, r.sym, t);
      if (!x) return;
      if (r.kind === 'level') { sig.push({ id: r.id, value: x.v, score: Math.round(lin(x.v, r.a, r.b)), status: r.st(x.v) }); return; }
      const m = sma(x.a, x.e, 50);
      if (!isNum(m) || !m) return;
      const g = (x.v / m - 1) * 100, k = r.id === 'credit' ? 100 : 10;
      sig.push({ id: r.id, value: Math.round(g * k) / k, score: Math.round(lin(-g, r.a, r.b)), status: r.st(g) });
    });
    const dm = dramAt(ctx, t);
    if (dm && isNum(dm.m28)) sig.push({ id: 'dram', value: Math.round(dm.m28 * 100) / 100, score: Math.round(lin(-dm.m28, -4, 6)), status: dm.m28 > 1 ? 'ok' : dm.m28 > -3 ? 'watch' : 'warn', age: dm.age28 });
    const sc = sig.map((s) => s.score);
    const score = sc.length >= 4 ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
    const out = { score, sig, level: levelName(score) };
    ctx._st.set(key, out);
    return out;
  }
  function levelName(score) { return !isNum(score) ? '데이터 없음' : score < 30 ? '안정' : score < 55 ? '긴장' : score < 75 ? '공포' : '극단적 공포'; }

  function marketAt(ctx, t) {
    const key = Math.round(t / 3600e3);
    if (ctx._mk.has(key)) return ctx._mk.get(key);
    const out = {};
    const y = at(ctx, '^TNX', t);
    if (y) {
      const L = y.v, L20 = y.e >= 20 ? y.a[y.e - 20] : null, D = isNum(L20) ? L - L20 : null, L1 = y.e >= 1 ? y.a[y.e - 1] : null;
      out.rates = { f: 0.6 * clamp(-(D || 0) / 0.30) + 0.4 * clamp((4.6 - L) / 0.5), L, D, D1: isNum(L1) ? L - L1 : null,
        txt: `미국 10년물 ${nf(L, 2)}%${isNum(D) ? ', 20일 ' + bpT(D) : ''}` };
    } else out.rates = { f: 0, na: true, txt: '금리 기록 없음' };
    const x = at(ctx, 'KRW=X', t);
    if (x) {
      const X = x.v, X20 = x.e >= 20 ? x.a[x.e - 20] : null, lo = minIn(x.a, x.e - 249, x.e), hi = maxIn(x.a, x.e - 249, x.e);
      out.fx = { X, dX: X20 ? X / X20 - 1 : null, lo, hi, pos: hi > lo ? (X - lo) / (hi - lo) : 0.5 };
    }
    const nv = at(ctx, 'NVDA', t), sx = at(ctx, '^SOX', t);
    const tn = nv ? trendOf(nv.a, nv.e) : null, ts = sx ? trendOf(sx.a, sx.e) : null, r20 = sx ? ret(sx.a, sx.e, 20) : null;
    if (tn || ts) {
      out.ai = { f: 0.4 * (tn ? tn.f : 0) + 0.4 * (ts ? ts.f : 0) + 0.2 * clamp((r20 || 0) / 0.15), tn, ts, r20,
        txt: `엔비디아 ${tn ? TREND_SHORT[tn.st] : '-'} · 반도체지수 ${ts ? TREND_SHORT[ts.st] + '(50일선 대비 ' + sg(ts.gap50, 0) + ')' : '-'}` };
    } else out.ai = { f: 0, na: true, txt: 'AI 투자 심리를 볼 기록 없음' };
    const dm = dramAt(ctx, t);
    if (dm && (isNum(dm.m28) || isNum(dm.m7))) {
      out.memory = { f: 0.6 * clamp((dm.m28 || 0) / 8) + 0.4 * clamp((dm.m7 || 0) / 3), v: dm.v, m28: dm.m28, m7: dm.m7, age: dm.age28,
        txt: `DDR5 현물 $${nf(dm.v, 2)}${isNum(dm.m28) ? ' · ' + dm.age28 + '일 ' + sg(dm.m28, 1) : ''}${isNum(dm.m7) ? ' · 1주 ' + sg(dm.m7, 1) : ''}` };
    } else out.memory = { f: 0, na: true, txt: '현물가 기록이 아직 부족' };
    const ks = at(ctx, '^KS11', t);
    if (ks) {
      const tk = trendOf(ks.a, ks.e), rk = ret(ks.a, ks.e, 20);
      out.korea = { f: 0.7 * tk.f + 0.3 * clamp((rk || 0) / 0.10), tk, rk, txt: `코스피 ${TREND_SHORT[tk.st]}, 20일 ${sg((rk || 0) * 100, 1)}` };
    } else out.korea = { f: 0, na: true, txt: '코스피 기록 없음' };
    const s0 = stressAt(ctx, t), s5 = stressAt(ctx, t - 7 * DAY);
    const S0 = s0.score, S5 = s5.score, dS = isNum(S0) && isNum(S5) ? S0 - S5 : null;
    // 높은 공포 자체보다 공포가 커지는 중인지가 때를 가릅니다. 극단(75 이상)에서 더 오르면 한 번 더 깎습니다.
    out.market = isNum(S0)
      ? { f: clamp(clamp(-(dS || 0) / 8) - (S0 >= 75 && (dS || 0) > 0 ? 0.3 : 0) - (S0 < 30 && (dS || 0) >= 0 ? 0.2 : 0)), S: S0, S5, dS, level: s0.level, sig: s0.sig,
        txt: `시장 스트레스 ${S0}(${s0.level})${isNum(S5) ? ', 1주 전 ' + S5 : ''}` }
      : { f: 0, na: true, txt: '스트레스 신호 부족', sig: s0.sig };
    ctx._mk.set(key, out);
    return out;
  }

  function fxFor(sym, fx) {
    if (!fx) return { f: 0, na: true, txt: '환율 기록 없음' };
    if (isKR(sym)) {
      let f = isNum(fx.dX) ? clamp(-fx.dX / 0.02) : 0, note = '';
      if (sym === '353200.KS' && fx.X < 1300) { f = clamp(f - 0.4); note = ' · 1,300원 아래 원화 강세는 수출 판가 부담'; }
      const dir = !isNum(fx.dX) || Math.abs(fx.dX) < 0.003 ? '제자리' : fx.dX < 0 ? '원화 강세, 외국인 매수에 우호' : '원화 약세, 외국인 매도 압력';
      return { f, X: fx.X, dX: fx.dX, kind: 'kr', txt: `원/달러 ${nf(fx.X, 0)}원, 20일 ${sg((fx.dX || 0) * 100, 1)}(${dir})${note}` };
    }
    const where = fx.pos < 0.34 ? '달러가 싼 편이라 원화로 사기 유리' : fx.pos > 0.66 ? '달러가 비싼 편이라 환율 부담' : '1년 범위의 가운데';
    return { f: clamp(1 - 2 * fx.pos), X: fx.X, pos: fx.pos, kind: 'us', txt: `원/달러 ${nf(fx.X, 0)}원, ${where}` };
  }

  function flowAt(ctx, sym, t) {
    const arr = ctx.F[sym];
    if (!arr || !arr.length) return { f: 0, na: true, txt: '수급 기록 없음' };
    const pts = arr.filter((x) => x.t <= t && x.t > t - 10 * DAY).slice(-5);
    if (pts.length < 3) return { f: 0, na: true, txt: '수급 기록이 아직 부족' };
    let net = 0, vv = 0, fr = 0;
    pts.forEach((x) => { net += (x.f || 0) + (x.o || 0); fr += x.f || 0; vv += x.v || 0; });
    const ratio = vv > 0 ? net / vv : 0;
    const sh = (n) => (Math.abs(n) >= 1e4 ? sg(n / 1e4, Math.abs(n) >= 1e6 ? 0 : 1, '만 주') : sg(n, 0, '주'));
    return { f: clamp(ratio / 0.10), net, fr, ratio, n: pts.length,
      txt: `외국인·기관 ${pts.length}거래일 ${sh(net)}(거래량의 ${sg(ratio * 100, 1)}) · 그중 외국인 ${sh(fr)}` };
  }

  function holding(ctx, sym) { return ((ctx.R || {}).holdings || {})[sym] || {}; }
  function valueOf(ctx, sym, p, t) {
    const H = holding(ctx, sym), V = H.val || {}, cns = ctx.cns[sym] || {};
    if (V.type === 'pref') {
      const c = at(ctx, '005930.KS', t);
      if (!c || !c.v) return { f: 0, na: true, txt: '보통주 가격 없음' };
      const disc = (1 - p / c.v) * 100;
      const dps = isNum(V.dps_exp) ? V.dps_exp : (V.dps_parts || []).reduce((s, x) => s + x, 0);
      const yld = dps > 0 ? (dps / p) * 100 : null;
      const f = 0.5 * clamp((disc - 20) / 5) + 0.5 * clamp(((yld || 0) - 5.5) / 2);
      return { f, disc, yld, dps, txt: `보통주보다 ${nf(disc, 1)}% 싸고, 올해 예상 배당 ${nf(dps)}원 기준 수익률 ${nf(yld, 1)}%` };
    }
    if (V.type === 'pe') {
      const eps = V.eps || [], base = eps[isNum(V.band) ? V.band : eps.length - 1] || eps[0];
      if (!base) return { f: 0, na: true, txt: '이익 전망 없음' };
      const useAuto = V.auto_eps && isNum(cns.eps) && cns.eps > 0;
      const e = useAuto ? cns.eps : base.v, y = base.y;
      const per = p / e, b = V.bands || [], lo = b[0], mid = b[1], hi = b[2];
      if (!isNum(lo) || !isNum(mid) || !isNum(hi)) return { f: 0, na: true, txt: `PER ${nf(per, 1)}배` };
      const band = (x, l, m, h) => (x <= l ? 1 : x <= m ? 1 - (x - l) / (m - l) : x <= h ? -(x - m) / (h - m) : -1);
      const zoneT = (f) => (f >= 0.6 ? '싼 쪽' : f <= -0.6 ? '비싼 쪽' : '가운데');
      const fPer = band(per, lo, mid, hi);
      let f = fPer, txt = `${y} 이익의 ${nf(per, 1)}배(기준 ${lo}·${mid}·${hi}배 중 ${zoneT(fPer)})`, pbr = null, fPbr = null;
      // 메모리처럼 이익이 크게 출렁이는 종목은 이익 정점에서 PER이 낮아 보입니다. 순자산 배수(PBR)를 절반 섞어 바닥을 함께 봅니다.
      const pb = V.pbr_bands, bps = isNum(cns.bps) && cns.bps > 0 ? cns.bps : V.bps;
      if (pb && isNum(bps) && bps > 0) {
        pbr = p / bps; fPbr = band(pbr, pb[0], pb[1], pb[2]);
        f = 0.5 * fPer + 0.5 * fPbr;
        txt += `, 순자산의 ${nf(pbr, 2)}배(기준 ${pb[0]}·${pb[1]}·${pb[2]}배 중 ${zoneT(fPbr)})`;
      }
      return { f, per, eps: e, y, lo, mid, hi, auto: useAuto, pbr, bps, fPer, fPbr, txt,
        cheapAt: e * lo, midAt: e * mid, richAt: e * hi };
    }
    return { f: 0, na: true, txt: '가치 기준 없음' };
  }

  // 한 종목의 그날 판단 재료. price 를 주면 마지막 가격만 바꿔 가정 계산을 합니다(매수 시작가 찾기).
  function stockAt(ctx, sym, t, mk, price) {
    const S = ctx.S[sym];
    if (!S) return null;
    const e0 = idxAt(S, t);
    if (e0 < 55) return null;
    let a = S.v, e = e0;
    if (isNum(price)) { a = S.v.slice(Math.max(0, e0 - 260), e0 + 1); e = a.length - 1; a[e] = price; }
    const p = a[e], fs = {};
    const hi52 = maxIn(a, e - 249, e), lo52 = minIn(a, e - 249, e), dd = hi52 > 0 ? p / hi52 - 1 : 0;
    fs.value = valueOf(ctx, sym, p, t);
    const tr = trendOf(a, e);
    fs.trend = { f: tr.f, st: tr.st, m20: tr.m20, m50: tr.m50, txt: TREND_TXT[tr.st] };
    const r = rsi(a, e), v20 = vol(a, e, 20), gap = isNum(tr.m20) ? p / tr.m20 - 1 : null;
    const m1 = isNum(r) ? clamp((50 - r) / 20) : 0, m2 = isNum(gap) && v20 ? clamp(-gap / (2 * v20 * Math.sqrt(5))) : 0;
    const head = isNum(r) && r <= 30 ? '과매도. ' : isNum(r) && r >= 70 ? '과열. ' : '';
    fs.stretch = { f: 0.5 * m1 + 0.5 * m2, rsi: r, gap, vol: v20, txt: `${head}RSI ${nf(r, 0)}, 20일선 대비 ${sg((gap || 0) * 100, 1)}` };
    const bench = isKR(sym) ? '^KS11' : '^SOX', B = at(ctx, bench, t), r20 = ret(a, e, 20), b20 = B ? ret(B.a, B.e, 20) : null;
    fs.rel = isNum(r20) && isNum(b20)
      ? { f: clamp((r20 - b20) / 0.10), r20, b20, txt: `20일 ${sg(r20 * 100, 1)}, ${isKR(sym) ? '코스피' : '반도체지수'} ${sg(b20 * 100, 1)}` }
      : { f: 0, na: true, txt: '비교 기록 부족' };
    fs.flow = isKR(sym) ? flowAt(ctx, sym, t) : { f: 0, na: true, skip: true, txt: '' };
    fs.memory = mk.memory; fs.ai = mk.ai; fs.rates = mk.rates; fs.korea = mk.korea; fs.market = mk.market;
    fs.fx = fxFor(sym, mk.fx);
    if (MEMORY.has(sym) && fs.value.f > 0 && mk.memory && !mk.memory.na && mk.memory.f <= -0.3) {
      fs.value = Object.assign({}, fs.value, { f: fs.value.f * 0.5, caveat: true, txt: fs.value.txt + ' · 현물가가 내려 낮은 배수를 절반만 믿음' });
    }
    const crash = (mk.market && isNum(mk.market.S) && mk.market.S >= 65) || dd <= -0.40;
    // 가격 매력(V)
    const vw = VW[sym] || {}, cv = {};
    let vs = 0, vws = 0;
    Object.keys(vw).forEach((k) => { const x = fs[k]; if (!x || x.na) return; vs += vw[k] * x.f; vws += vw[k]; cv[k] = vw[k] * x.f; });
    const V = vws > 0 ? (vs / vws) * 100 : 0;
    // 흐름(T)
    const tw = Object.assign({}, TW[sym] || {});
    if (crash) Object.keys(tw).forEach((k) => { if (MOMO.has(k)) tw[k] *= 0.5; else if (k === 'stretch') tw[k] *= 1.5; });
    const ct = {};
    let ts = 0, tws = 0;
    Object.keys(tw).forEach((k) => { const x = fs[k]; if (!tw[k] || !x || x.na) return; ts += tw[k] * x.f; tws += tw[k]; ct[k] = tw[k] * x.f; });
    const T = tws > 0 ? (ts / tws) * 100 : 0;
    // 점수 = 두 축의 평균. 변수별 기여는 그 점수를 나눠 가진 몫입니다.
    const contrib = {};
    Object.keys(cv).forEach((k) => { contrib[k] = (contrib[k] || 0) + 50 * cv[k] / vws; });
    Object.keys(ct).forEach((k) => { contrib[k] = (contrib[k] || 0) + 50 * ct[k] / tws; });
    return { sym, t, p, fs, V: Math.round(V), T: Math.round(T), score: Math.round((V + T) / 2), contrib, crash, dd,
      vol: v20, m20: tr.m20, m50: tr.m50, hi52, lo52 };
  }

  function dayOf(t) { const d = new Date(t + 9 * 3600e3); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function dUTC(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; }
  function eventsFor(ctx, sym, from, days) {
    return ((ctx.R || {}).calendar || []).filter((e) => {
      if (e.firm === false || e.approx) return false;
      if ((e.for || []).indexOf(sym) < 0 || !MAJOR_TAGS.has(e.tag)) return false;
      const d = dUTC(e.d);
      return d != null && d >= from && d <= from + days * DAY;
    });
  }
  function weightOf(ctx, sym, prices, fxv) {
    const pos = ctx.pos || {};
    let tot = 0, mine = 0;
    HOLD.forEach((s) => {
      const p = pos[s], q = prices[s];
      if (!p || !(p.qty > 0) || !isNum(q)) return;
      const v = p.qty * q * (isKR(s) ? 1 : fxv || 0);
      tot += v; if (s === sym) mine = v;
    });
    return tot > 0 && mine > 0 ? mine / tot : null;
  }

  function gate(ctx, sym, z, r, mk, dayT, wt) {
    let G = LIDX[z];
    const notes = [];
    const st = r.fs.trend.st, dS = mk.market ? mk.market.dS : null;
    if (G === 4 && (st === 'down' || st === 'breakdown') && isNum(dS) && dS >= 3) {
      G = 3; notes.push({ k: 'knife', t: `싼 구간이지만 시장 스트레스가 1주 새 ${dS}점 올라 하락이 멈추는 날을 기다립니다` });
    }
    const ev = eventsFor(ctx, sym, dayT, 1);
    if (ev.length && G === 4) { G = 3; notes.push({ k: 'event', t: `${ev[0].title} 결과를 보고 삽니다` }); }
    else if (ev.length && G === 3) notes.push({ k: 'event', t: `${ev[0].title} 결과가 먼저입니다` });
    const H = holding(ctx, sym);
    if (H.thesis_status === 'watch' && G > 2) { G = 2; notes.push({ k: 'thesis', t: H.thesis_note || '보유 논리를 점검하는 중이라 더 사지 않습니다' }); }
    if (H.thesis_status === 'broken') { G = Math.min(G, r.score <= -15 ? 0 : 1); notes.push({ k: 'thesis', t: H.thesis_note || '보유 논리가 깨져 비중을 줄입니다' }); }
    if (isNum(wt) && wt > 0.4 && G > 2) { G = 2; notes.push({ k: 'weight', t: `이 종목이 포트폴리오의 ${nf(wt * 100, 0)}%라 더 늘리지 않습니다` }); }
    return { G, notes, ev };
  }

  // 다른 변수는 그대로 두고 가격만 움직였을 때 구역이 바뀌는 가격을 찾습니다.
  //  buyLo: 더 내려 사는 구역에 드는 가격 / buyHi: 올라서 흐름이 돌아 사는 구역에 드는 가격
  //  trimHi: 올라서 점검 구역에 드는 가격(비싸지거나 과열) / trimLo: 더 내려 점검 구역에 드는 가격(경계선)
  function scan(ctx, sym, t, mk, p, dir, maxK, want) {
    for (let k = 1; k <= maxK; k++) {
      const q = p * (1 + dir * k * 0.005), x = stockAt(ctx, sym, t, mk, q);
      if (x && want.has(zoneOf(x.V, x.T))) return roundPx(sym, q, dir < 0 ? 'down' : 'up');
    }
    return null;
  }
  const BUYZ = new Set(['buy']), TRIMZ = new Set(['trim', 'sell']);
  function planOf(ctx, sym, t, mk, r, z) {
    const p = r.p;
    const buyNow = z === 'buy';
    const buyLo = buyNow ? p : scan(ctx, sym, t, mk, p, -1, 70, BUYZ);
    const buyHi = buyNow ? null : scan(ctx, sym, t, mk, p, 1, 60, BUYZ);
    const trimNow = TRIMZ.has(z);
    const trimHi = trimNow ? null : scan(ctx, sym, t, mk, p, 1, 120, TRIMZ);
    const trimLo = trimNow ? null : scan(ctx, sym, t, mk, p, -1, 50, TRIMZ);
    const sp = clamp((r.vol || 0.02) * Math.sqrt(5), 0.05, 0.12);
    const b0 = buyLo || null;
    const steps = b0 ? [b0, roundPx(sym, b0 * (1 - sp), 'down'), roundPx(sym, b0 * (1 - 2 * sp), 'down')] : [];
    const v = r.fs.value || {};
    return { buyLo, buyHi, trimHi, trimLo, buyNow, trimNow, sp, steps, m20: roundPx(sym, r.m20), m50: roundPx(sym, r.m50),
      cheapAt: roundPx(sym, v.cheapAt), richAt: roundPx(sym, v.richAt), lo52: r.lo52, hi52: r.hi52 };
  }

  function reasonsOf(r) {
    const list = FACTORS.map((F) => {
      const x = r.fs[F.k], c = r.contrib[F.k];
      if (!x || x.na || x.skip || !isNum(c)) return null;
      return { k: F.k, name: F.name, c, f: x.f, txt: x.txt };
    }).filter(Boolean);
    return list.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  }

  function sentence(sym, lv, plan, r, notes, reasons) {
    const P = (v) => pxShort(sym, v);
    const worst = (reasons || []).filter((x) => x.c < 0).sort((a, b) => a.c - b.c)[0];
    const block = worst ? ` ${worst.name}부터 나아져야 추가 매수 구간이 생깁니다.` : ' 지금 변수로는 추가 매수 구간이 보이지 않습니다.';
    const dist = (v) => sg((v / r.p - 1) * 100, 0);
    const n = notes && notes.length ? ' ' + notes[0].t + '.' : '';
    const lo = plan.buyLo && plan.buyLo < r.p ? `${P(plan.buyLo)}(${dist(plan.buyLo)})` : null;
    const hi = plan.buyHi ? `${P(plan.buyHi)}(${dist(plan.buyHi)})` : null;
    if (lv.id === 'buy') return `지금 가격에서 계획 금액의 4분의 1을 삽니다. 다음 회차는 ${P(plan.steps[1])}(${dist(plan.steps[1])}) 아래에서.${n}`;
    if (lv.id === 'ready') {
      if (n) return `싼 구간입니다.${n}${lo ? ` 그 뒤 ${lo} 아래면 4분의 1을 삽니다.` : ''}`;
      if (lo && hi) return `싸지만 아직 내리는 중입니다. ${lo} 아래로 더 내리거나, ${hi} 위로 회복해 흐름이 돌면 4분의 1을 삽니다.`;
      if (lo) return `싸지만 아직 내리는 중입니다. ${lo} 아래로 오면 4분의 1을 삽니다.`;
      if (hi) return `싸지만 아직 내리는 중입니다. ${hi} 위로 회복해 흐름이 돌면 4분의 1을 삽니다.`;
      return `싸지만 아직 내리는 중입니다.${worst ? ` ${worst.name}이 돌아서는 것을 먼저 확인합니다.` : ' 흐름이 돌아서는 것을 먼저 확인합니다.'}`;
    }
    if (lv.id === 'hold') {
      const a = lo ? ` 추가는 ${lo} 아래에서.` : hi ? ` 추가는 ${hi} 위로 흐름이 돌 때.` : block;
      const b = plan.trimHi ? ` ${P(plan.trimHi)}(${dist(plan.trimHi)}) 위에서는 일부 줄이기를 봅니다.` : '';
      const c = plan.trimLo ? ` ${P(plan.trimLo)}(${dist(plan.trimLo)}) 아래로 밀리면 비중을 점검합니다.` : '';
      return `사지도 팔지도 않습니다.${a}${b}${c}${n}`;
    }
    if (lv.id === 'trim') return `더 사지 않습니다. 반등하면 보유분의 일부(4분의 1 안팎)를 줄이는 쪽을 봅니다.${lo ? ` 반대로 ${lo} 아래까지 내리면 다시 사는 구간입니다.` : ''}${hi ? ` ${hi} 위로 흐름이 돌면 다시 봅니다.` : ''}${n}`;
    return `반등 때 보유분을 줄입니다. 보유 논리를 다시 확인한 뒤에만 다시 삽니다.${n}`;
  }

  // ------------------------------------------------------------ 실행
  function run(input, opt) {
    opt = opt || {};
    const ctx = makeCtx(input);
    const nTrail = opt.trail || 20;
    const today = isNum(ctx.today) ? ctx.today : dayOf(ctx.now);
    const items = {};
    const lastP = {};
    HOLD.forEach((s) => { const S = ctx.S[s]; if (S && S.v.length) lastP[s] = S.v[S.v.length - 1]; });
    const fxS = ctx.S['KRW=X'], fxNow = fxS && fxS.v.length ? fxS.v[fxS.v.length - 1] : null;
    HOLD.forEach((sym) => {
      const S = ctx.S[sym];
      if (!S || S.t.length < 70) return;
      const N = S.t.length, start = Math.max(60, N - nTrail - 12);
      const trail = [];
      let prev = null;
      for (let e = start; e < N; e++) {
        const t = S.t[e], mk = marketAt(ctx, t), r = stockAt(ctx, sym, t, mk);
        if (!r) continue;
        const z = zoneHyst(r.V, r.T, prev);
        prev = z;
        const g = gate(ctx, sym, z, r, mk, t, null);
        trail.push({ t, p: r.p, score: r.score, V: r.V, T: r.T, z, G: g.G, contrib: r.contrib });
      }
      if (!trail.length) return;
      const last = trail[trail.length - 1], t = last.t, mk = marketAt(ctx, t), r = stockAt(ctx, sym, t, mk);
      const wt = weightOf(ctx, sym, lastP, fxNow);
      const g = gate(ctx, sym, last.z, r, mk, Math.max(today, t), wt);
      last.G = g.G;
      const plan = planOf(ctx, sym, t, mk, r, last.z);
      const lv = LEVELS[g.G], base = LEVELS[LIDX[last.z]];
      const prevD = trail.length >= 2 ? trail[trail.length - 2] : null;
      let change = null;
      if (prevD) {
        const ks = Object.keys(Object.assign({}, r.contrib, prevD.contrib)).map((k) => ({ k, d: (r.contrib[k] || 0) - ((prevD.contrib || {})[k] || 0) }))
          .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
        change = { from: LEVELS[prevD.G], to: lv, changed: prevD.G !== g.G, dScore: r.score - prevD.score, prevT: prevD.t,
          top: ks.slice(0, 2).filter((x) => Math.abs(x.d) >= 1).map((x) => ({ k: x.k, name: (FACTORS.find((F) => F.k === x.k) || {}).name, d: x.d })) };
      }
      const tr = trail.slice(-nTrail);
      const flips = tr.reduce((n, x, i) => n + (i > 0 && tr[i - 1].G !== x.G ? 1 : 0), 0);
      const reasons = reasonsOf(r);
      items[sym] = {
        sym, name: NAME[sym], short: SHORT[sym], t, p: r.p, score: r.score, V: r.V, T: r.T, crash: r.crash, dd: r.dd,
        level: lv, base, notes: g.notes, events: g.ev, fs: r.fs, contrib: r.contrib, reasons, plan, weight: wt, change, flips,
        trail: tr.map((x) => ({ t: x.t, p: x.p, score: x.score, V: x.V, T: x.T, G: x.G, id: LEVELS[x.G].id })),
        line: sentence(sym, lv, plan, r, g.notes, reasons)
      };
    });
    const tMax = Math.max.apply(null, Object.keys(ctx.S).map((k) => { const S = ctx.S[k]; return S.t.length ? S.t[S.t.length - 1] : 0; }).concat([0]));
    const mk = marketAt(ctx, tMax);
    return { version: VERSION, today, items, market: mk, summary: summarize(items, mk), factors: FACTORS, levels: LEVELS, vw: VW, tw: TW };
  }

  function summarize(items, mk) {
    const list = HOLD.map((s) => items[s]).filter(Boolean);
    const by = (id) => list.filter((x) => x.level.id === id).map((x) => x.name);
    const buys = by('buy'), ready = by('ready'), trims = by('trim').concat(by('sell')), holds = by('hold');
    const parts = [];
    if (buys.length) parts.push(`${buys.join('·')}는 오늘 계획 금액의 4분의 1을 삽니다.`);
    const rd = list.filter((x) => x.level.id === 'ready');
    const evR = rd.filter((x) => (x.notes || []).some((n) => n.k === 'event')), knR = rd.filter((x) => evR.indexOf(x) < 0 && (x.notes || []).some((n) => n.k === 'knife'));
    const plainR = rd.filter((x) => evR.indexOf(x) < 0 && knR.indexOf(x) < 0);
    if (evR.length) parts.push(`${evR.map((x) => x.name).join('·')}는 싼 구간이지만 ${(evR[0].events[0] || {}).title || '큰 일정'} 결과를 본 뒤에 삽니다.`);
    if (knR.length) parts.push(`${knR.map((x) => x.name).join('·')}는 싸지만 공포가 커지는 중이라 하락이 멈추는 날을 기다립니다.`);
    if (plainR.length) parts.push(`${plainR.map((x) => x.name).join('·')}는 싸지만 아직 내리는 중이라 정해 둔 가격에 닿을 때만 삽니다.`);
    if (holds.length) parts.push(`${holds.join('·')}는 그대로 둡니다.`);
    if (trims.length) parts.push(`${trims.join('·')}는 더 사지 않고 반등 때 비중을 줄이는 쪽을 봅니다.`);
    const head = buys.length ? '오늘은 일부를 사는 날입니다.' : ready.length ? '오늘은 기다리는 날입니다.' : trims.length ? '오늘은 지키면서 줄일 곳을 보는 날입니다.' : '오늘은 그대로 두는 날입니다.';
    const bits = [];
    const m = mk.market;
    if (m && isNum(m.S)) bits.push(`시장 스트레스 ${m.S}(${m.level})${isNum(m.dS) && m.dS !== 0 ? ', 1주 새 ' + (m.dS > 0 ? '+' : '') + m.dS : ''}`);
    const R = mk.rates;
    if (R && isNum(R.L)) bits.push(`금리 ${isNum(R.D) && R.D <= -0.05 ? '하락' : isNum(R.D) && R.D >= 0.05 ? '상승' : '제자리'}(10년물 ${nf(R.L, 2)}%, 20일 ${bpT(R.D)})`);
    const A = mk.ai;
    if (A && A.ts) bits.push(`반도체 ${TREND_SHORT[A.ts.st]}(지수 50일선 대비 ${sg(A.ts.gap50, 0)})`);
    const D = mk.memory;
    if (D && !D.na && isNum(D.m28)) bits.push(`D램 현물 ${D.age}일 ${sg(D.m28, 1)}`);
    const X = mk.fx;
    if (X && isNum(X.X)) bits.push(`원/달러 ${nf(X.X, 0)}원`);
    const counts = {};
    LEVELS.forEach((L) => { counts[L.id] = list.filter((x) => x.level.id === L.id).length; });
    return { head, body: parts.join(' '), bits, counts };
  }

  return { run, VERSION, FACTORS, LEVELS, VW, TW, HOLD, ZONES, zoneOf, px, pxShort, sg, nf, TREND_SHORT };
}));
