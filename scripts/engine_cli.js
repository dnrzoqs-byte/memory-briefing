#!/usr/bin/env node
/* 오늘의 대응 엔진을 서버 데이터로 실행합니다(카톡 문구·점검용).
   사용: node scripts/engine_cli.js [data/latest_briefing.json] [data/research.json] [--full]
   출력: 종목별 판단 JSON 한 줄. --full 이면 엔진 결과 전체(이유·가격 계획·추이 포함). */
'use strict';
const fs = require('fs');
const path = require('path');
const MBE = require(path.join(__dirname, '..', 'assets', 'engine.js'));

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const full = process.argv.includes('--full');
// 점검용: --now=2026-11-26T09:00+09:00 처럼 시각을 바꿔 실행할 수 있습니다.
const nowArg = (process.argv.find((a) => a.startsWith('--now=')) || '').slice(6);
const NOW = nowArg ? Date.parse(nowArg) : Date.now();
const base = path.join(__dirname, '..');
const P = JSON.parse(fs.readFileSync(args[0] || path.join(base, 'data', 'latest_briefing.json'), 'utf8'));
const R = JSON.parse(fs.readFileSync(args[1] || path.join(base, 'data', 'research.json'), 'utf8'));

const dUTC = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
function inputFrom(P, R) {
  const ser = {};
  Object.keys(P.series || {}).forEach((k) => {
    const raw = P.series[k];
    if (!raw || !raw.d || !raw.s) return;
    const t0 = dUTC(raw.s);
    ser[k] = raw.d.map((d, i) => ({ t: t0 + d * 86400e3, v: raw.c[i] })).filter((p) => typeof p.v === 'number');
  });
  const H = P.history || {};
  const dram = (H.dram || []).filter((h) => typeof h.ddr5_16g === 'number').map((h) => ({ t: dUTC(h.d), v: h.ddr5_16g }));
  const flows = {};
  Object.keys(H.flows || {}).forEach((k) => { flows[k] = (H.flows[k] || []).map((x) => ({ t: dUTC(x.d), f: x.f, o: x.o, v: x.v })); });
  const cns = {};
  Object.keys(P.naver || {}).forEach((k) => { const n = P.naver[k] || {}; cns[k] = { eps: n.eps, bps: n.bps }; });
  const k = new Date(NOW + 9 * 3600e3);
  return { ser, dram, flows, cns, research: R, today: Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()), now: NOW };
}

const out = MBE.run(inputFrom(P, R));
if (full) { process.stdout.write(JSON.stringify(out)); process.exit(0); }

// 카톡 한 줄: "삼성우 보유 · 13.4만 원 이하 추가, 15.1만 원 이상 일부 차익"
function kakaoLine(s, it, unit) {
  const px = (v) => MBE.pxShort(s, v), bits = [], pl = it.plan || {}, id = it.level.id;
  const ev = (it.notes || []).find((n) => n.k === 'event');
  if (id === 'buy') bits.push('지금 ' + (unit || '4분의 1'));
  if (ev && it.events && it.events[0]) bits.push(it.events[0].title + ' 뒤');
  if (id === 'trim' || id === 'sell') {
    bits.push('반등 때 일부 줄이기');
    if (pl.buyLo && pl.buyLo < it.p) bits.push(px(pl.buyLo) + ' 아래면 다시 매수 구간');
  } else {
    if (pl.buyLo && pl.buyLo < it.p) bits.push(px(pl.buyLo) + ' 이하 추가');
    else if (pl.buyHi && id !== 'buy') bits.push(px(pl.buyHi) + ' 회복 시 추가');
    if (id === 'hold' && pl.trimHi) bits.push(px(pl.trimHi) + ' 이상 일부 차익');
  }
  const ch = it.change && it.change.changed ? `(어제 ${it.change.from.name})` : '';
  return `${it.short} ${it.level.name}${ch}${bits.length ? ' · ' + bits.join(', ') : ''}`;
}

const items = {};
Object.keys(out.items).forEach((s) => {
  const it = out.items[s];
  items[s] = { level: it.level.name, id: it.level.id, score: it.score, V: it.V, T: it.T,
    buyLo: it.plan.buyLo, buyHi: it.plan.buyHi, trimHi: it.plan.trimHi,
    changed: it.change ? it.change.changed : false, from: it.change ? it.change.from.name : null,
    line: it.line, act: it.act, kakao: kakaoLine(s, it, (out.risk || {}).unit) };
});
const rk = out.risk || {};
const risk = rk.lv ? { lv: rk.lv, name: rk.name, cash: rk.cash, unit: rk.unit, pts: rk.pts, max: rk.max, warn: rk.warn,
  kakao: `${rk.lv}단계 ${rk.name}(${rk.pts}/${rk.max}점) · 현금 ${rk.cash} · 한 번에 ${rk.unit}` } : null;
process.stdout.write(JSON.stringify({ head: out.summary.head, body: out.summary.body, risk, items }));
