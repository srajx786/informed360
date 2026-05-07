#!/usr/bin/env python3
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from html import unescape
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(__file__))
REGISTRY_PATH = os.path.join(ROOT, "data", "election-sources-india.json")
OUT_DIR = os.path.join(ROOT, "public", "data", "elections")
os.makedirs(OUT_DIR, exist_ok=True)
USER_AGENT = "Informed360ElectionBot/1.0 (+https://informed360.news; polite polling)"
ECI_DISCLAIMER = (
    "ECI is displaying the information as being filled in the system by the Returning Officers "
    "from their respective Counting Centres. The final data for each AC/PC will be shared in Form-20."
)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def atomic_write_json(path, payload):
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def fetch_html(url, retries=2, timeout=15):
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", "ignore")
        except Exception as err:
            last_err = err
            if attempt < retries:
                time.sleep(1.0)
    raise last_err


def strip_tags(raw):
    text = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    return text


def parse_eci_results_portal(html, source):
    plain = strip_tags(html)
    title_match = re.search(
        r"General Election to Assembly Constituencies: Trends\s*&\s*Results\s*May-2026",
        plain,
        flags=re.I,
    )
    election_name = title_match.group(0) if title_match else "General Election to Assembly Constituencies"

    ts_match = re.search(r"Last\s*Updated\s*[:\-]?\s*([0-9]{1,2}[^A-Za-z0-9]{0,3}[A-Za-z]{3}[^\n]{0,40})", plain, re.I)
    last_updated = ts_match.group(1).strip() if ts_match else ""

    rows = []
    row_regex = re.compile(
        r"([A-Za-z][A-Za-z &().\-]{1,60})\s+(\d{1,4})\s+(\d{1,4})(?:\s+(\d{1,4}))?",
        re.I,
    )
    for m in row_regex.finditer(plain):
        party = re.sub(r"\s+", " ", m.group(1)).strip()
        leading = int(m.group(2))
        won = int(m.group(3))
        total = int(m.group(4)) if m.group(4) else leading + won
        if party.lower() in {"last updated", "assembly constituencies"}:
            continue
        if len(rows) >= 24:
            break
        rows.append({"party": party, "leading": leading, "won": won, "total": total})

    status = "live" if rows else "standby"
    message = (
        "Official ECI page parsed successfully."
        if rows
        else "No structured party rows found on active page; keeping standby state."
    )

    return {
        "generatedAt": now_iso(),
        "source": {
            "name": source.get("name", "Election Commission of India"),
            "url": source.get("indexUrl") or source.get("baseUrl", ""),
            "type": "official",
            "disclaimer": ECI_DISCLAIMER,
        },
        "electionType": "vidhan_sabha",
        "status": status,
        "sample": False,
        "electionName": election_name,
        "state": "",
        "municipality": "",
        "partySummary": rows,
        "alliances": [],
        "constituencies": [],
        "wards": [],
        "closeContests": [],
        "lastSuccessfulFetchAt": now_iso(),
        "lastUpdatedText": last_updated,
        "message": message,
    }


def standby_snapshot(source_name, source_url, election_type, message):
    return {
        "generatedAt": now_iso(),
        "source": {
            "name": source_name,
            "url": source_url,
            "type": "official",
            "disclaimer": ECI_DISCLAIMER if "Election Commission" in source_name else "Official source standby.",
        },
        "electionType": election_type,
        "status": "standby",
        "sample": False,
        "electionName": "",
        "state": "",
        "municipality": "",
        "partySummary": [],
        "alliances": [],
        "constituencies": [],
        "wards": [],
        "closeContests": [],
        "lastSuccessfulFetchAt": "",
        "message": message,
    }


def write_snapshot(path, payload):
    previous = read_json(path, default=None)
    # Never replace previous useful non-empty row data with empty payload due parser/network miss.
    if previous and previous.get("partySummary") and not payload.get("partySummary") and payload.get("status") != "live":
        payload = previous
    atomic_write_json(path, payload)


def main():
    registry = read_json(REGISTRY_PATH, default={"sources": []})
    sources = registry.get("sources", [])

    eci_source = next((s for s in sources if s.get("enabled") and s.get("parser") == "eci_results_portal"), None)
    eci_payload = standby_snapshot(
        "Election Commission of India",
        "https://results.eci.gov.in/ResultAcGenMay2026/index.htm",
        "vidhan_sabha",
        "Standby: ECI source unavailable or not configured.",
    )

    if eci_source:
        try:
            html = fetch_html(eci_source.get("indexUrl") or eci_source.get("baseUrl"))
            eci_payload = parse_eci_results_portal(html, eci_source)
        except Exception as err:
            eci_payload["status"] = "unavailable"
            eci_payload["message"] = f"ECI fetch failed: {err}"

    municipal_payload = standby_snapshot(
        "State Election Commission Template",
        "",
        "municipal_corporation",
        "No live official election feed configured.",
    )
    for src in sources:
        if src.get("type") != "state_or_municipal_official" or not src.get("enabled"):
            continue
        if not src.get("indexUrl") and not src.get("baseUrl"):
            continue
        municipal_payload["source"]["name"] = src.get("name", municipal_payload["source"]["name"])
        municipal_payload["source"]["url"] = src.get("indexUrl") or src.get("baseUrl")
        try:
            fetch_html(municipal_payload["source"]["url"])
            municipal_payload["status"] = "live"
            municipal_payload["lastSuccessfulFetchAt"] = now_iso()
            municipal_payload["message"] = "Configured official municipal source reachable; parser pending source-specific schema."
        except Exception as err:
            municipal_payload["status"] = "unavailable"
            municipal_payload["message"] = f"Municipal source fetch failed: {err}"
        break

    india_payload = dict(eci_payload)
    india_payload["electionType"] = eci_payload.get("electionType") or "vidhan_sabha"

    write_snapshot(os.path.join(OUT_DIR, "eci-live-results.json"), eci_payload)
    write_snapshot(os.path.join(OUT_DIR, "india-election-results.json"), india_payload)
    write_snapshot(os.path.join(OUT_DIR, "municipal-election-results.json"), municipal_payload)


if __name__ == "__main__":
    main()
