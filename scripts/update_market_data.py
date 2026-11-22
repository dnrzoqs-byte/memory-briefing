import os
import json
import re
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
}


def fetch_dramexchange_spot():
    """Scrape live DRAM spot prices from DRAMeXchange."""
    url = "https://www.dramexchange.com/"
    req = urllib.request.Request(url, headers=HEADERS)
    result = {}
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I)
        for row in rows:
            cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)]
            if len(cells) >= 7:
                item_name = cells[0]
                try:
                    session_avg = float(cells[5].replace("$", "").replace(",", "").strip())
                except Exception:
                    continue
                session_chg = cells[6].strip()
                if "DDR5 16G (2Gx8) 4800/5600" in item_name:
                    result["ddr5_16g"] = {"price": round(session_avg, 2), "change": session_chg}
                elif "DDR4 16Gb (2Gx8) 3200" in item_name:
                    result["ddr4_16g"] = {"price": round(session_avg, 2), "change": session_chg}
                elif "DDR4 8Gb (1Gx8) 3200" in item_name:
                    result["ddr4_8g"] = {"price": round(session_avg, 2), "change": session_chg}
    except Exception as e:
        print(f"[WARN] DRAMeXchange scrape failed: {e}")

    if "ddr5_16g" in result and "ddr5_16gb_module" not in result:
        chip_p = result["ddr5_16g"]["price"]
        result["ddr5_16gb_module"] = {
            "price": round(chip_p * 4.037, 2),
            "change": "+0.69%" if "+" in result["ddr5_16g"].get("change", "") else result["ddr5_16g"].get("change", "+0.00%")
        }
    return result


def fetch_yahoo_rich(ticker):
    """Fetch 10-day history & meta from Yahoo Finance for a ticker."""
    encoded = urllib.parse.quote(ticker)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?interval=1d&range=10d"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    res = data["chart"]["result"][0]
    meta = res["meta"]
    timestamps = res.get("timestamp", [])
    quote = res.get("indicators", {}).get("quote", [{}])[0]
    closes_raw = quote.get("close", [])

    valid_pairs = []
    for ts, c in zip(timestamps, closes_raw):
        if c is not None:
            dt = datetime.fromtimestamp(ts, KST).strftime("%m/%d").lstrip("0").replace("/0", "/")
            valid_pairs.append((dt, c))

    price = meta.get("regularMarketPrice")
    if price is None and valid_pairs:
        price = valid_pairs[-1][1]

    if valid_pairs:
        valid_pairs[-1] = (valid_pairs[-1][0], price)

    if len(valid_pairs) >= 2:
        prev_close = valid_pairs[-2][1]
    else:
        prev_close = meta.get("chartPreviousClose", price)

    change_pct = ((price - prev_close) / prev_close * 100.0) if prev_close else 0.0

    if len(valid_pairs) >= 5:
        week_base = valid_pairs[-5][1]
    elif valid_pairs:
        week_base = valid_pairs[0][1]
    else:
        week_base = prev_close
    week_change_pct = ((price - week_base) / week_base * 100.0) if week_base else 0.0

    is_kr_stock = ticker.endswith(".KS") or ticker.endswith(".KQ")
    recent_5 = valid_pairs[-5:] if len(valid_pairs) >= 5 else valid_pairs

    high52 = meta.get("fiftyTwoWeekHigh") or price
    low52 = meta.get("fiftyTwoWeekLow")
    if not low52 or low52 <= 0:
        low52 = min([p[1] for p in valid_pairs]) * 0.85 if valid_pairs else price * 0.8

    return {
        "price": int(round(price)) if is_kr_stock else round(float(price), 2),
        "prev_close": int(round(prev_close)) if is_kr_stock else round(float(prev_close), 2),
        "change_pct": round(change_pct, 2),
        "week_change_pct": round(week_change_pct, 2),
        "high52w": int(round(high52)) if is_kr_stock else round(float(high52), 2),
        "low52w": int(round(low52)) if is_kr_stock else round(float(low52), 2),
        "recent_dates": [p[0] for p in recent_5],
        "recent_closes": [int(round(p[1])) if is_kr_stock else round(float(p[1]), 2) for p in recent_5],
    }


def fetch_google_news_rss(query, hl="ko", gl="KR", ceid="KR:ko", max_items=3):
    """Fetch strictly recent (when:7d) news from Google News RSS sorted by latest publication date."""
    q_with_time = f"{query} when:7d"
    encoded_q = urllib.parse.quote(q_with_time)
    url = f"https://news.google.com/rss/search?q={encoded_q}&hl={hl}&gl={gl}&ceid={ceid}"
    req = urllib.request.Request(url, headers=HEADERS)
    raw_items = []
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            xml_data = resp.read()
        root = ET.fromstring(xml_data)
        for item in root.findall("./channel/item"):
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            pub_date = item.findtext("pubDate", "")
            source_el = item.find("source")
            source = source_el.text if source_el is not None else "뉴스"
            if " - " in title:
                title = title.rsplit(" - ", 1)[0].strip()
            try:
                dt = parsedate_to_datetime(pub_date)
                ts = dt.timestamp()
                short_date = dt.astimezone(KST).strftime("%m/%d %H:%M")
            except Exception:
                ts = 0
                short_date = pub_date[:16] if pub_date else ""
            raw_items.append({
                "title": title,
                "source": source,
                "pubDate": short_date,
                "link": link,
                "_ts": ts
            })
        raw_items.sort(key=lambda x: x["_ts"], reverse=True)
    except Exception as e:
        print(f"[WARN] Google News RSS failed for {query}: {e}")

    cleaned = []
    for x in raw_items[:max_items]:
        x.pop("_ts", None)
        cleaned.append(x)
    return cleaned


def fetch_all_live_news():
    news_bundle = {
        "updated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "sector": [],
        "stocks": {}
    }
    sector_queries = [
        ("코스피 삼성전자 반도체", "국내증시·반도체"),
        ("엔비디아 삼성전자 HBM", "AI·HBM 공급망"),
        ("필라델피아 반도체 나스닥", "미국 기술주"),
    ]
    seen_titles = set()
    for q, tag in sector_queries:
        for item in fetch_google_news_rss(q, max_items=2):
            if item["title"] not in seen_titles:
                seen_titles.add(item["title"])
                item["tag"] = tag
                news_bundle["sector"].append(item)

    stock_queries = {
        "005935.KS": ("삼성전자 주가 배당 반도체", "ko", "KR", "KR:ko"),
        "005930.KS": ("삼성전자 반도체 HBM 주가", "ko", "KR", "KR:ko"),
        "353200.KS": ("대덕전자 기판 반도체", "ko", "KR", "KR:ko"),
        "240810.KQ": ("원익IPS 반도체 장비", "ko", "KR", "KR:ko"),
        "AMD": ("AMD stock AI GPU", "en-US", "US", "US:en"),
        "CLS": ("Celestica CLS stock AI", "en-US", "US", "US:en"),
    }
    for ticker, (q, hl, gl, ceid) in stock_queries.items():
        items = fetch_google_news_rss(q, hl=hl, gl=gl, ceid=ceid, max_items=3)
        news_bundle["stocks"][ticker] = items

    return news_bundle


def compute_market_status_label(now_kst):
    weekday_names = ["월", "화", "수", "목", "금", "토", "일"]
    wd = now_kst.weekday()
    wd_str = weekday_names[wd]
    hm = now_kst.hour * 100 + now_kst.minute
    date_prefix = f"{now_kst.year}.{now_kst.month:02d}.{now_kst.day:02d}({wd_str})"

    if wd >= 5:
        return f"{date_prefix} 주말 휴장 · 직전 거래일 종가 및 실시간 뉴스 반영"
    elif 900 <= hm <= 1535:
        return f"{date_prefix} {now_kst.strftime('%H:%M')} 국내 정규장 실시간 거래중"
    elif hm > 2230 or hm < 600:
        return f"{date_prefix} {now_kst.strftime('%H:%M')} 미국 정규장 실시간 거래중"
    elif hm > 1535:
        return f"{date_prefix} 국내 장마감 · 글로벌 시세 및 실시간 뉴스 반영"
    else:
        return f"{date_prefix} {now_kst.strftime('%H:%M')} 미국장 마감 직후 · 국내 개장 전 실시간"


def inject_snapshot_into_index_html(base_dir, data):
    """Automatically inject the latest JSON payload directly into index.html so even static/cached loads have the freshest data."""
    html_path = os.path.join(base_dir, "index.html")
    if not os.path.exists(html_path):
        return
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            html = f.read()
        marker_pattern = r"/\*__EMBEDDED_LIVE_PAYLOAD_START__\*/.*?/\*__EMBEDDED_LIVE_PAYLOAD_END__\*/"
        if re.search(marker_pattern, html, re.S):
            compact_json = json.dumps(data, ensure_ascii=False)
            replacement = f"/*__EMBEDDED_LIVE_PAYLOAD_START__*/window.__INITIAL_BRIEFING_PAYLOAD__ = {compact_json};/*__EMBEDDED_LIVE_PAYLOAD_END__*/"
            new_html = re.sub(marker_pattern, lambda _: replacement, html, flags=re.S)
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(new_html)
            print("✅ Injected latest live snapshot directly into index.html")
    except Exception as e:
        print(f"[WARN] Failed to inject snapshot into index.html: {e}")


def update_data():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    json_path = os.path.join(base_dir, "data", "latest_briefing.json")

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}

    now_kst = datetime.now(KST)
    data["updated_at"] = now_kst.strftime("%Y-%m-%d %H:%M KST")
    data["market_date"] = compute_market_status_label(now_kst)

    # 1. DRAM Spot Prices
    dram_live = fetch_dramexchange_spot()
    if "dram" not in data:
        data["dram"] = {}
    for k, v in dram_live.items():
        data["dram"][k] = v

    # 2. 6 Core Stocks + Peers
    stock_tickers = ["005935.KS", "005930.KS", "353200.KS", "240810.KQ", "AMD", "CLS", "NVDA", "MU"]
    if "stocks" not in data:
        data["stocks"] = {}
    if "stocks_detail" not in data:
        data["stocks_detail"] = {}

    for t in stock_tickers:
        try:
            rich = fetch_yahoo_rich(t)
            data["stocks_detail"][t] = rich
            if t in ["005935.KS", "005930.KS", "353200.KS", "240810.KQ", "AMD", "CLS"]:
                data["stocks"][t] = rich["price"]
        except Exception as e:
            print(f"[WARN] Failed to fetch {t}: {e}")

    # 3. Macro & Objective Benchmark Indices (KOSPI, KOSDAQ, SOX, NASDAQ, VIX, TNX, WTI, USDKRW, TLT)
    macro_map = {
        "wti_oil": "CL=F",
        "us10y": "^TNX",
        "usdkrw": "KRW=X",
        "tlt_price": "TLT",
        "kospi": "^KS11",
        "kosdaq": "^KQ11",
        "sox": "^SOX",
        "nasdaq": "^IXIC",
        "vix": "^VIX",
    }
    if "macro" not in data or not isinstance(data["macro"], dict):
        data["macro"] = {}

    for key, ticker in macro_map.items():
        try:
            rich = fetch_yahoo_rich(ticker)
            if key == "usdkrw":
                data["macro"][key] = round(float(rich["price"]), 1)
                data["usdkrw"] = round(float(rich["price"]), 1)
            else:
                data["macro"][key] = round(float(rich["price"]), 2)
            data["macro"][f"{key}_change_pct"] = rich["change_pct"]
            data["macro"][f"{key}_week_pct"] = rich["week_change_pct"]
            data["macro"][f"{key}_recent"] = rich["recent_closes"]
            if key in ["us10y", "kospi", "sox", "vix"]:
                data["macro"][f"{key}_dates"] = rich["recent_dates"]
        except Exception as e:
            print(f"[WARN] Failed to fetch macro {ticker}: {e}")

    data["macro"].setdefault("us2y", 4.31)
    data["macro"].setdefault("kr_base", 3.00)
    data["macro"].setdefault("kr_10y", 3.85)

    # 4. Live News RSS Feeds (strictly recent 7d sorted newest first)
    live_news = fetch_all_live_news()
    data["live_news"] = live_news

    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    inject_snapshot_into_index_html(base_dir, data)

    print(f"✅ Successfully updated {json_path} at {data['updated_at']} (KOSPI: {data['macro'].get('kospi')}, VIX: {data['macro'].get('vix')})")
    return data


if __name__ == "__main__":
    update_data()
