#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""반도체 브리핑 데이터 업데이터 (schema 2)

두 곳에서 실행됩니다.
  1) GitHub Actions: .github/workflows/daily_briefing_updater.yml (약 1시간 간격)
  2) 로컬 카톡 작업: fetch_and_send_kakao.py 가 12:00, 19:00에 update_data()를 호출

하는 일
  - Yahoo Finance 1년 일봉(보유 6종목, 비교 종목, 지수, 금리, 환율)
  - DRAMeXchange 현물가(DDR5/DDR4 칩, 모듈, GDDR, 낸드 웨이퍼)
  - FRED(접속될 때만): 미 2년·10년, 정책금리 상·하단, 하이일드 스프레드
  - Google News RSS(최근 7일)
  - 시장 스트레스 신호 계산, D램 현물가·스트레스 이력 누적(원격 JSON과 병합)
  - data/latest_briefing.json 저장 후 index.html 마커 사이에 시세와 data/research.json 삽입

수집이 실패하면 직전 값을 유지하고 stale 표시를 남깁니다. 지어낸 기본값은 쓰지 않습니다.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import statistics
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

KST = timezone(timedelta(hours=9))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, "data", "latest_briefing.json")
RESEARCH_PATH = os.path.join(BASE_DIR, "data", "research.json")
HTML_PATH = os.path.join(BASE_DIR, "index.html")
REMOTE_JSON = "https://raw.githubusercontent.com/dnrzoqs-byte/memory-briefing/main/data/latest_briefing.json"

HOLDINGS = ["005935.KS", "005930.KS", "353200.KS", "240810.KQ", "AMD", "CLS"]

# (심볼, 표시명, 그룹)
SYMBOLS = [
    ("005935.KS", "삼성전자우", "holding"),
    ("005930.KS", "삼성전자", "holding"),
    ("353200.KS", "대덕전자", "holding"),
    ("240810.KQ", "원익IPS", "holding"),
    ("AMD", "AMD", "holding"),
    ("CLS", "셀레스티카", "holding"),
    ("000660.KS", "SK하이닉스", "peer"),
    ("MU", "마이크론", "peer"),
    ("NVDA", "엔비디아", "peer"),
    ("^KS11", "코스피", "index"),
    ("^KQ11", "코스닥", "index"),
    ("^SOX", "필라델피아 반도체", "index"),
    ("^IXIC", "나스닥", "index"),
    ("^VIX", "VIX", "index"),
    ("^TNX", "미국 10년물", "rate"),
    ("^FVX", "미국 5년물", "rate"),
    ("^IRX", "미국 3개월물", "rate"),
    ("KRW=X", "원/달러", "fx"),
    ("CL=F", "WTI 유가", "commodity"),
    ("HYG", "하이일드 채권 ETF", "credit"),
]
RATE_SYMBOLS = {"^TNX", "^FVX", "^IRX"}

DX_ITEMS = [
    ("DDR5 16Gb (2Gx8) 4800/5600", "ddr5_16g", "DDR5 16Gb", "chip"),
    ("DDR5 16Gb (2Gx8) eTT", "ddr5_16g_ett", "DDR5 16Gb eTT", "chip"),
    ("DDR4 16Gb (2Gx8) 3200", "ddr4_16g", "DDR4 16Gb", "chip"),
    ("DDR4 8Gb (1Gx8) 3200", "ddr4_8g", "DDR4 8Gb", "chip"),
    ("DDR5 UDIMM 16GB 4800/5600", "ddr5_udimm_16gb", "DDR5 UDIMM 16GB", "module"),
    ("DDR5 RDIMM 32GB 4800/5600", "ddr5_rdimm_32gb", "DDR5 RDIMM 32GB", "module"),
    ("DDR4 UDIMM 16GB 3200", "ddr4_udimm_16gb", "DDR4 UDIMM 16GB", "module"),
    ("GDDR6 8Gb", "gddr6_8gb", "GDDR6 8Gb", "gddr"),
    ("512Gb TLC", "nand_tlc_512gb", "낸드 512Gb TLC 웨이퍼", "wafer"),
]
DX_STAMP_TITLES = [("DRAM Spot Price", "chip"), ("Module Spot Price", "module"),
                   ("GDDR Spot Price", "gddr"), ("Wafer Spot Price", "wafer")]
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

FRED_IDS = ["DGS2", "DGS10", "DFEDTARU", "DFEDTARL", "BAMLH0A0HYM2"]

# 이력이 비어 있을 때만 넣는 시드: DRAMeXchange 수치를 인용한 보도 기준. 이후는 매 실행 실측값이 쌓입니다.
DRAM_SEED = [
    {"d": "2026-11-03", "ddr5_16g": 61.5, "seed": True},
    {"d": "2026-11-05", "ddr5_16g": 60.667, "seed": True},
    {"d": "2026-11-16", "ddr5_16g": 60.333, "seed": True},
]

NEWS_SECTOR = [
    ("D램 가격 HBM", "메모리 가격", "ko"),
    ("삼성전자 SK하이닉스 반도체 주가", "국내 반도체", "ko"),
    ("엔비디아 AI 반도체", "AI·엔비디아", "ko"),
    ("반도체 수출", "수출", "ko"),
    ("기준금리 연준 한국은행", "금리", "ko"),
    ("DRAM prices TrendForce", "글로벌 메모리", "en"),
    ("hyperscaler capex AI spending", "AI 투자", "en"),
]
NEWS_STOCK = {
    "005935.KS": ("삼성전자 우선주 배당", "ko"),
    "005930.KS": ("삼성전자 반도체 HBM", "ko"),
    "353200.KS": ("대덕전자", "ko"),
    "240810.KQ": ("원익IPS", "ko"),
    "AMD": ("AMD stock", "en"),
    "CLS": ("Celestica stock", "en"),
}
LANG = {"ko": ("ko", "KR", "KR:ko"), "en": ("en-US", "US", "US:en")}


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def http_get(url: str, timeout: float = 15, retries: int = 1, headers: dict | None = None) -> bytes:
    err: Exception | None = None
    for i in range(retries + 1):
        try:
            h = {"User-Agent": UA, "Accept": "*/*"}
            if headers:
                h.update(headers)
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            err = e
            if i < retries:
                time.sleep(1.2 * (i + 1))
    raise RuntimeError(f"GET failed {url[:90]}: {err}")


def load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def fetch_remote_json() -> dict:
    try:
        raw = http_get(f"{REMOTE_JSON}?t={int(time.time())}", timeout=12, retries=1)
        return json.loads(raw.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log(f"[WARN] remote json: {e}")
        return {}


def rounder(symbol: str):
    if symbol.endswith(".KS") or symbol.endswith(".KQ"):
        return lambda v: None if v is None else int(round(float(v)))
    if symbol in RATE_SYMBOLS:
        return lambda v: None if v is None else round(float(v), 3)
    return lambda v: None if v is None else round(float(v), 2)


def r2(v, nd: int = 2):
    return None if v is None else round(float(v), nd)


def compact_series(dates: list, vals: list, rp) -> dict:
    s = datetime.strptime(dates[0], "%Y-%m-%d")
    return {
        "s": dates[0],
        "d": [(datetime.strptime(d, "%Y-%m-%d") - s).days for d in dates],
        "c": [rp(v) for v in vals],
    }


# ---------------------------------------------------------------- 장 상태
def _us_dst(now_utc: datetime) -> bool:
    """미국 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일(현지 02:00 기준, 근사)."""
    y = now_utc.year
    mar = datetime(y, 3, 8, tzinfo=timezone.utc)
    start = mar + timedelta(days=(6 - mar.weekday()) % 7)
    nov = datetime(y, 11, 1, tzinfo=timezone.utc)
    end = nov + timedelta(days=(6 - nov.weekday()) % 7)
    return start + timedelta(hours=7) <= now_utc < end + timedelta(hours=6)


def compute_market_status_label(now_kst: datetime) -> str:
    wd = now_kst.weekday()
    names = ["월", "화", "수", "목", "금", "토", "일"]
    prefix = f"{now_kst.year}.{now_kst.month:02d}.{now_kst.day:02d}({names[wd]}) {now_kst:%H:%M}"
    hm = now_kst.hour * 60 + now_kst.minute
    dst = _us_dst(now_kst.astimezone(timezone.utc))
    us_open, us_close = (22 * 60 + 30, 5 * 60) if dst else (23 * 60 + 30, 6 * 60)
    kr_open = wd < 5 and 9 * 60 <= hm <= 15 * 60 + 30
    us_open_now = (wd < 5 and hm >= us_open) or (0 < wd <= 5 and hm < us_close)
    if kr_open:
        return f"{prefix} 국내 정규장 거래 중"
    if us_open_now:
        return f"{prefix} 미국 정규장 거래 중"
    if wd >= 5:
        return f"{prefix} 주말 · 직전 거래일 종가"
    return f"{prefix} 장 마감 · 최근 종가"


# ---------------------------------------------------------------- Yahoo
def _ydate(ts: int, off: int) -> str:
    return datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d")


def fetch_yahoo(symbol: str):
    enc = urllib.parse.quote(symbol, safe="")
    res, err = None, None
    for host in ("query1", "query2"):
        try:
            raw = http_get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{enc}?interval=1d&range=1y",
                           timeout=15, retries=1)
            res = json.loads(raw.decode("utf-8"))["chart"]["result"][0]
            break
        except Exception as e:  # noqa: BLE001
            err = e
    if res is None:
        raise RuntimeError(f"yahoo {symbol}: {err}")
    meta = res.get("meta") or {}
    off = int(meta.get("gmtoffset") or 0)
    ts = res.get("timestamp") or []
    quote = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    by_date: dict = {}
    for t, c in zip(ts, closes):
        if c is None or (isinstance(c, float) and math.isnan(c)) or c <= 0:
            continue
        by_date[_ydate(t, off)] = float(c)
    price, mt = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
    if price is not None and mt and float(price) > 0:
        by_date[_ydate(mt, off)] = float(price)
    dates = sorted(by_date)
    if len(dates) < 2:
        raise RuntimeError(f"yahoo {symbol}: too few points")
    return meta, dates, [by_date[d] for d in dates]


def quote_stats(symbol: str, name: str, group: str, meta: dict, dates: list, vals: list) -> dict:
    rp = rounder(symbol)
    n = len(vals)
    last, prev = vals[-1], vals[-2]

    def back(k: int):
        return (last / vals[-1 - k] - 1) * 100 if n > k and vals[-1 - k] else None

    year = dates[-1][:4]
    base_ytd = None
    for d, v in zip(dates, vals):
        if d < f"{year}-01-01":
            base_ytd = v
        else:
            break
    hi, lo = max(vals), min(vals)
    mh, ml = meta.get("fiftyTwoWeekHigh"), meta.get("fiftyTwoWeekLow")
    if mh and symbol not in RATE_SYMBOLS:
        hi = max(hi, float(mh))
    if ml and float(ml) > 0 and symbol not in RATE_SYMBOLS:
        lo = min(lo, float(ml))

    def ma(k: int):
        return sum(vals[-k:]) / k if n >= k else None

    vol = None
    if symbol not in RATE_SYMBOLS and n >= 22:
        rets = [math.log(vals[i] / vals[i - 1]) for i in range(n - 20, n) if vals[i - 1] > 0 and vals[i] > 0]
        if len(rets) >= 10:
            vol = statistics.pstdev(rets) * math.sqrt(252) * 100
    mt = meta.get("regularMarketTime")
    tstr = datetime.fromtimestamp(mt, KST).strftime("%Y-%m-%d %H:%M KST") if mt else None
    return {
        "name": name, "group": group, "currency": meta.get("currency"),
        "price": rp(last), "prev": rp(prev),
        "chg": round(last - prev, 3) if symbol in RATE_SYMBOLS else rp(last - prev),
        "chg_pct": r2((last / prev - 1) * 100 if prev else None),
        "w1": r2(back(5)), "m1": r2(back(21)), "m3": r2(back(63)), "m6": r2(back(126)),
        "ytd": r2((last / base_ytd - 1) * 100 if base_ytd else None),
        "hi52": rp(hi), "lo52": rp(lo),
        "dd": r2((last / hi - 1) * 100 if hi else None),
        "from_lo": r2((last / lo - 1) * 100 if lo else None),
        "ma20": rp(ma(20)), "ma50": rp(ma(50)), "ma200": rp(ma(200)),
        "vol20": r2(vol, 1),
        "date": dates[-1], "time": tstr,
    }


# ---------------------------------------------------------------- DRAMeXchange
def _num(s: str):
    try:
        return float(s.replace(",", "").replace("$", "").strip())
    except ValueError:
        return None


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("&nbsp;", " ")).strip()


def fetch_dramexchange():
    html = http_get("https://www.dramexchange.com/", timeout=20, retries=1).decode("utf-8", "ignore")
    names = {a: (k, label, kind) for a, k, label, kind in DX_ITEMS}
    out: dict = {}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        cells = [_norm(re.sub(r"<[^>]+>", "", c)) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)]
        if len(cells) < 7:
            continue
        hit = names.get(_norm(cells[0]))
        if not hit or hit[0] in out:
            continue
        avg = _num(cells[5])
        if avg is None or avg <= 0:
            continue
        k, label, kind = hit
        m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", cells[6])
        out[k] = {"label": label, "kind": kind, "price": avg,
                  "chg_pct": float(m.group(1)) if m else None,
                  "hi": _num(cells[1]), "lo": _num(cells[2])}
    stamps: dict = {}
    for title, kind in DX_STAMP_TITLES:
        m = re.search(re.escape(title)
                      + r"\s*(?:</font>)?\s*<img.{0,4000}?Last Update:\s*([A-Za-z]{3})\.(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})",
                      html, re.S)
        if not m:
            continue
        mon = MONTHS.get(m.group(1).title())
        if not mon:
            continue
        t8 = datetime(int(m.group(3)), mon, int(m.group(2)), int(m.group(4)), int(m.group(5)),
                      tzinfo=timezone(timedelta(hours=8)))
        tk = t8.astimezone(KST)
        stamps[kind] = {"date": t8.strftime("%Y-%m-%d"), "time": tk.strftime("%Y-%m-%d %H:%M KST")}
    for v in out.values():
        st = stamps.get(v["kind"])
        if st:
            v["updated"] = st["time"]
    return out, stamps


# ---------------------------------------------------------------- FRED (접속될 때만)
def fetch_fred(start: str) -> dict:
    out: dict = {}
    for sid in FRED_IDS:
        try:
            raw = http_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}",
                           timeout=9, retries=0, headers={"Accept": "text/csv,*/*"})
        except Exception as e:  # noqa: BLE001
            log(f"[WARN] FRED {sid}: {e} (나머지 FRED 생략)")
            break
        rows = list(csv.reader(io.StringIO(raw.decode("utf-8", "ignore"))))
        pts = []
        for r in rows[1:]:
            if len(r) >= 2 and r[1] not in (".", ""):
                try:
                    pts.append((r[0], float(r[1])))
                except ValueError:
                    pass
        if len(pts) >= 2:
            dates = [p[0] for p in pts]
            vals = [p[1] for p in pts]
            ser = compact_series(dates, vals, lambda v: round(float(v), 3))
            out[sid] = {"last": vals[-1], "date": dates[-1], **ser}
    if out:
        out["_updated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    return out


# ---------------------------------------------------------------- 뉴스
def fetch_google_news_rss(query: str, hl: str, gl: str, ceid: str, max_items: int = 3) -> list:
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(f"{query} when:7d")
           + f"&hl={hl}&gl={gl}&ceid={ceid}")
    items = []
    try:
        root = ET.fromstring(http_get(url, timeout=10, retries=1))
        for it in root.findall("./channel/item"):
            title = (it.findtext("title") or "").strip()
            src_el = it.find("source")
            source = (src_el.text or "").strip() if src_el is not None and src_el.text else ""
            if source and title.endswith(" - " + source):
                title = title[: -len(" - " + source)].strip()
            elif " - " in title:
                title = title.rsplit(" - ", 1)[0].strip()
            try:
                ts = int(parsedate_to_datetime(it.findtext("pubDate") or "").timestamp())
            except Exception:  # noqa: BLE001
                ts = 0
            items.append({
                "title": title, "source": source or "뉴스", "ts": ts,
                "pubDate": datetime.fromtimestamp(ts, KST).strftime("%m/%d %H:%M") if ts else "",
                "link": (it.findtext("link") or "").strip(),
            })
    except Exception as e:  # noqa: BLE001
        log(f"[WARN] news '{query}': {e}")
    items.sort(key=lambda x: x["ts"], reverse=True)
    return items[:max_items]


def fetch_all_news() -> dict:
    bundle = {"updated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"), "sector": [], "stocks": {}}
    seen = set()
    for q, tag, lang in NEWS_SECTOR:
        for it in fetch_google_news_rss(q, *LANG[lang], max_items=3):
            key = re.sub(r"\W+", "", it["title"])[:40]
            if not key or key in seen:
                continue
            seen.add(key)
            it["tag"], it["lang"] = tag, lang
            bundle["sector"].append(it)
    bundle["sector"].sort(key=lambda x: x["ts"], reverse=True)
    for sym, (q, lang) in NEWS_STOCK.items():
        bundle["stocks"][sym] = fetch_google_news_rss(q, *LANG[lang], max_items=4)
    return bundle


# ---------------------------------------------------------------- 신호(시장 스트레스)
def _lin(v, a: float, b: float):
    if v is None:
        return None
    return max(0.0, min(100.0, (v - a) / (b - a) * 100.0))


def _gap(q: dict | None):
    if not q or not q.get("price") or not q.get("ma50"):
        return None
    return (q["price"] / q["ma50"] - 1) * 100


def dram_momentum(hist: list):
    """DDR5 16Gb 현물: 28일 전에 가장 가까운(최소 14일 전) 기록 대비 변화율."""
    pts = sorted((h["d"], h["ddr5_16g"]) for h in hist if h.get("ddr5_16g"))
    if len(pts) < 2:
        return None, None
    last_d, last_v = pts[-1]
    ld = datetime.strptime(last_d, "%Y-%m-%d")
    cands = []
    for d, v in pts[:-1]:
        age = (ld - datetime.strptime(d, "%Y-%m-%d")).days
        if age >= 14:
            cands.append((abs(age - 28), age, v))
    if not cands:
        return None, None
    _, age, base = min(cands)
    return (last_v / base - 1) * 100, age


def build_signals(quotes: dict, dram: dict, dram_hist: list, fred: dict):
    sig: list = []

    def add(sid, label, value, unit, score, status, rule, note=""):
        sig.append({"id": sid, "label": label, "value": value, "unit": unit,
                    "score": None if score is None else int(round(score)),
                    "status": status, "rule": rule, "note": note})

    vix = (quotes.get("^VIX") or {}).get("price")
    if vix is not None:
        st = "ok" if vix < 20 else ("watch" if vix < 28 else "warn")
        add("vix", "VIX 공포지수", vix, "", _lin(vix, 14, 36), st, "20 미만 양호 · 28 이상 경고")

    for sid, sym, label, a, b, warn_at in (
        ("sox", "^SOX", "반도체지수(SOX) 50일선 대비", -6, 14, -8),
        ("kospi", "^KS11", "코스피 50일선 대비", -5, 12, -7),
        ("nvda", "NVDA", "엔비디아 50일선 대비", -6, 20, -10),
    ):
        g = _gap(quotes.get(sym))
        if g is None:
            continue
        st = "ok" if g >= 0 else ("watch" if g >= warn_at else "warn")
        add(sid, label, round(g, 1), "%", _lin(-g, a, b), st, f"50일 평균선 위 양호 · {abs(warn_at)}% 넘게 아래면 경고")

    y = (quotes.get("^TNX") or {}).get("price")
    if y is not None:
        st = "ok" if y < 4.3 else ("watch" if y < 4.75 else "warn")
        add("us10y", "미국 10년물 금리", y, "%", _lin(y, 3.9, 5.2), st, "4.3% 미만 양호 · 4.75% 이상 경고")

    oas = (fred.get("BAMLH0A0HYM2") or {}).get("last") if fred else None
    if oas is not None:
        st = "ok" if oas < 3.5 else ("watch" if oas < 4.5 else "warn")
        add("credit", "하이일드 스프레드", oas, "%p", _lin(oas, 2.8, 5.5), st, "3.5%p 미만 양호 · 4.5%p 이상 경고")
    else:
        g = _gap(quotes.get("HYG"))
        if g is not None:
            st = "ok" if g >= -0.5 else ("watch" if g >= -2 else "warn")
            add("credit", "하이일드 채권(HYG) 50일선 대비", round(g, 2), "%", _lin(-g, -0.5, 4), st,
                "-0.5% 위 양호 · -2% 아래면 경고", "신용 위험이 커지면 하이일드 채권 가격이 먼저 밀립니다")

    mom, age = dram_momentum(dram_hist)
    if mom is not None:
        st = "ok" if mom > 1 else ("watch" if mom > -3 else "warn")
        add("dram", f"DDR5 현물 {age}일 변화", round(mom, 2), "%", _lin(-mom, -4, 6), st,
            "+1% 초과 양호 · -3% 이하 경고")
    elif (dram.get("ddr5_16g") or {}).get("chg_pct") is not None:
        c = dram["ddr5_16g"]["chg_pct"]
        st = "ok" if c > 0.3 else ("watch" if c > -1 else "warn")
        add("dram", "DDR5 현물 전일 대비", c, "%", _lin(-c, -1, 2), st, "이력이 쌓이면 4주 변화로 바뀝니다", "이력 축적 중")

    scores = [s["score"] for s in sig if s["score"] is not None]
    score = int(round(sum(scores) / len(scores))) if scores else None
    if score is None:
        level = "데이터 없음"
    elif score < 30:
        level = "안정"
    elif score < 55:
        level = "긴장"
    elif score < 75:
        level = "공포"
    else:
        level = "극단적 공포"
    counts = {k: sum(1 for s in sig if s["status"] == k) for k in ("ok", "watch", "warn")}
    return sig, {"score": score, "level": level, "counts": counts}


# ---------------------------------------------------------------- 네이버 증권(국내 종목 수급·컨센서스)
NAVER = {"005930.KS": "005930", "005935.KS": "005935", "353200.KS": "353200", "240810.KQ": "240810", "000660.KS": "000660"}


def _nnum(v):
    """'-5,763,083' · '+2,348,072' · '45,515원' · '3.67배' · '45.80%' → float"""
    if v is None:
        return None
    m = re.search(r"[-+]?\d[\d,]*\.?\d*", str(v))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def fetch_naver(code: str):
    raw = http_get(f"https://m.stock.naver.com/api/stock/{code}/integration", timeout=12, retries=1,
                   headers={"Referer": "https://m.stock.naver.com/"})
    j = json.loads(raw.decode("utf-8"))
    info = {x.get("code"): x.get("value") for x in (j.get("totalInfos") or [])}
    out = {
        "eps": _nnum(info.get("cnsEps")), "per_cns": _nnum(info.get("cnsPer")), "eps_ttm": _nnum(info.get("eps")),
        "bps": _nnum(info.get("bps")), "pbr": _nnum(info.get("pbr")), "dps": _nnum(info.get("dividend")),
        "foreign_rate": _nnum(info.get("foreignRate")),
    }
    c = j.get("consensusInfo") or {}
    out["target"] = _nnum(c.get("priceTargetMean"))
    out["recomm"] = _nnum(c.get("recommMean"))
    out["cns_date"] = c.get("createDate")
    flows = []
    for x in (j.get("dealTrendInfos") or []):
        d = str(x.get("bizdate") or "")
        if len(d) != 8:
            continue
        flows.append({"d": f"{d[:4]}-{d[4:6]}-{d[6:]}", "f": _nnum(x.get("foreignerPureBuyQuant")),
                      "o": _nnum(x.get("organPureBuyQuant")), "i": _nnum(x.get("individualPureBuyQuant")),
                      "v": _nnum(x.get("accumulatedTradingVolume"))})
    if not any(v is not None for v in out.values()) and not flows:
        raise RuntimeError("빈 응답")
    return out, flows


# ---------------------------------------------------------------- 이력 병합
def merge_history(*hists, limit: int = 500) -> list:
    merged: dict = {}
    for h in hists:
        for p in (h or []):
            d = p.get("d")
            if not d:
                continue
            cur = merged.get(d)
            if cur is not None and not cur.get("seed") and p.get("seed"):
                continue  # 실측값이 시드보다 우선
            if cur is None or cur.get("seed") or p.get("ts", 0) >= cur.get("ts", 0):
                merged[d] = p
    return [merged[d] for d in sorted(merged)][-limit:]


# ---------------------------------------------------------------- index.html 삽입
def _js_literal(obj) -> str:
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return (s.replace("</", "<\\/").replace("<!--", "<\\!--")
             .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def inject_into_index_html(data: dict) -> None:
    try:
        with open(HTML_PATH, "r", encoding="utf-8") as f:
            html = f.read()
    except FileNotFoundError:
        return
    blocks = [("EMBEDDED_LIVE_PAYLOAD", "window.__INITIAL_BRIEFING_PAYLOAD__ = ", data)]
    research = load_json(RESEARCH_PATH)
    if research:
        blocks.append(("EMBEDDED_RESEARCH", "window.__RESEARCH__ = ", research))
    changed = False
    for marker, prefix, obj in blocks:
        pat = re.compile(r"/\*__" + marker + r"_START__\*/.*?/\*__" + marker + r"_END__\*/", re.S)
        if not pat.search(html):
            log(f"[WARN] index.html 에 {marker} 마커가 없습니다")
            continue
        repl = f"/*__{marker}_START__*/{prefix}{_js_literal(obj)};/*__{marker}_END__*/"
        html = pat.sub(lambda _m: repl, html, count=1)
        changed = True
    if changed:
        tmp = HTML_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(html)
        os.replace(tmp, HTML_PATH)
        log("✅ index.html 에 시세·리서치 삽입")


# ---------------------------------------------------------------- 메인
def _newer(a: dict | None, b: dict | None, field: str = "date"):
    if not a:
        return b
    if not b:
        return a
    return a if str(a.get(field, "")) >= str(b.get(field, "")) else b


def update_data() -> dict:
    t0 = time.time()
    now = datetime.now(KST)
    prev = load_json(JSON_PATH)
    remote = fetch_remote_json()
    prev2 = prev if prev.get("schema") == 2 else {}
    remote2 = remote if remote.get("schema") == 2 else {}

    data: dict = {
        "schema": 2,
        "updated_at": now.strftime("%Y-%m-%d %H:%M KST"),
        "updated_ts": int(now.timestamp()),
        "market_date": compute_market_status_label(now),
    }

    # 1) 시세·1년 일봉
    quotes, series, failed = {}, {}, []
    pq, ps = prev2.get("quotes") or {}, prev2.get("series") or {}
    rq, rs = remote2.get("quotes") or {}, remote2.get("series") or {}
    for sym, name, group in SYMBOLS:
        try:
            meta, dates, vals = fetch_yahoo(sym)
            quotes[sym] = quote_stats(sym, name, group, meta, dates, vals)
            series[sym] = compact_series(dates, vals, rounder(sym))
        except Exception as e:  # noqa: BLE001
            failed.append(sym)
            log(f"[WARN] {e}")
            old = _newer(pq.get(sym), rq.get(sym))
            if old:
                quotes[sym] = dict(old, stale=True)
            s_old = ps.get(sym) or rs.get(sym)
            if s_old:
                series[sym] = s_old
        time.sleep(0.2)
    data["quotes"], data["series"] = quotes, series

    # 2) D램 현물
    try:
        dram, stamps = fetch_dramexchange()
    except Exception as e:  # noqa: BLE001
        log(f"[WARN] DRAMeXchange: {e}")
        dram, stamps = {}, {}
    if not dram:
        cand = [x for x in (prev2, remote2) if x.get("dram")]
        if cand:
            best = max(cand, key=lambda x: x.get("updated_ts", 0))
            dram = {k: dict(v, stale=True) for k, v in best["dram"].items()}
            stamps = best.get("dram_stamps") or {}
        failed.append("DRAMeXchange")
    data["dram"], data["dram_stamps"] = dram, stamps

    # 3) FRED (선택)
    fred = fetch_fred((now - timedelta(days=400)).strftime("%Y-%m-%d"))
    if not fred:
        cand = [x.get("fred") for x in (prev2, remote2) if isinstance(x.get("fred"), dict) and x["fred"].get("_updated")]
        fred = max(cand, key=lambda f: f.get("_updated", "")) if cand else {}
    data["fred"] = fred

    # 4) 이력(원격과 병합) + 신호
    hp, hr = prev2.get("history") or {}, remote2.get("history") or {}
    dram_today = []
    if dram and not any(v.get("stale") for v in dram.values()):
        pt = {"d": (stamps.get("chip") or {}).get("date") or now.strftime("%Y-%m-%d"), "ts": int(now.timestamp())}
        for k, v in dram.items():
            pt[k] = v["price"]
        dram_today = [pt]
    seeds = DRAM_SEED if not (hp.get("dram") or hr.get("dram")) else []
    dram_hist = merge_history(seeds, hp.get("dram"), hr.get("dram"), dram_today, limit=600)
    signals, stress = build_signals(quotes, dram, dram_hist, fred)
    stress_today = ([{"d": now.strftime("%Y-%m-%d"), "ts": int(now.timestamp()), "v": stress["score"]}]
                    if stress["score"] is not None else [])
    stress_hist = merge_history(hp.get("stress"), hr.get("stress"), stress_today, limit=400)
    data["signals"], data["stress"] = signals, stress
    data["history"] = {"dram": dram_hist, "stress": stress_hist}

    # 4-2) 네이버 증권: 국내 종목 수급(외국인·기관)과 컨센서스. GitHub 러너에서 막히면 PC 작업이 채웁니다.
    naver, flows_hist = {}, {}
    pn, rn = prev2.get("naver") or {}, remote2.get("naver") or {}
    pf, rf = hp.get("flows") or {}, hr.get("flows") or {}
    for sym, code in NAVER.items():
        new_flows = []
        try:
            info, new_flows = fetch_naver(code)
            naver[sym] = dict(info, updated=now.strftime("%Y-%m-%d %H:%M"))
        except Exception as e:  # noqa: BLE001
            log(f"[WARN] naver {code}: {e}")
            old = pn.get(sym) or rn.get(sym)
            if old:
                naver[sym] = dict(old, stale=True)
            if "naver" not in failed:
                failed.append("naver")
        flows_hist[sym] = merge_history(pf.get(sym), rf.get(sym), new_flows, limit=60)
        time.sleep(0.15)
    data["naver"] = naver
    data["history"]["flows"] = flows_hist

    # 5) 뉴스
    news = fetch_all_news()
    if not news["sector"] and not any(news["stocks"].values()):
        news = prev.get("live_news") or remote.get("live_news") or news
        failed.append("news")
    data["live_news"] = news

    # 6) 예전 화면·스크립트 호환 키
    data["stocks"] = {s: quotes[s]["price"] for s in HOLDINGS if s in quotes}
    macro: dict = {}
    for key, sym in (("kospi", "^KS11"), ("sox", "^SOX"), ("vix", "^VIX"), ("us10y", "^TNX"),
                     ("usdkrw", "KRW=X"), ("wti_oil", "CL=F"), ("nasdaq", "^IXIC")):
        if sym in quotes:
            macro[key] = quotes[sym]["price"]
            macro[key + "_change_pct"] = quotes[sym]["chg_pct"]
    data["macro"] = macro
    data["usdkrw"] = macro.get("usdkrw")
    data["failed"] = failed
    data["elapsed_sec"] = round(time.time() - t0, 1)

    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    inject_into_index_html(data)

    k = quotes.get("^KS11", {}).get("price")
    s = quotes.get("^SOX", {}).get("price")
    d5 = (dram.get("ddr5_16g") or {}).get("price")
    log(f"✅ {data['updated_at']} 저장 · 코스피 {k} · SOX {s} · DDR5 {d5} · 스트레스 {stress['score']}"
        f"({stress['level']}) · 실패 {failed or '없음'} · {data['elapsed_sec']}s")
    return data


if __name__ == "__main__":
    update_data()
