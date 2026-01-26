#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import logging
import math
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

YFINANCE_SPEC = importlib.util.find_spec("yfinance")
if YFINANCE_SPEC:
    import yfinance as yf
else:
    yf = None

MARKETS_PATH = Path(__file__).resolve().parents[1] / "public" / "markets.json"

TICKERS = [
    {"symbol": "^NSEI", "pretty": "NSE Nifty", "seed": 22000.00},
    {"symbol": "GC=F", "pretty": "Gold", "seed": 2000.00},
    {"symbol": "CL=F", "pretty": "Crude Oil", "seed": 62.24},
    {"symbol": "USDINR=X", "pretty": "USD/INR", "seed": 91.56},
]

LIVE_STATES = {"REGULAR", "OPEN", "TRADING"}

logging.basicConfig(level=logging.INFO, format="[markets] %(message)s")


def coerce_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def read_existing() -> Optional[Dict[str, Any]]:
    if not MARKETS_PATH.exists():
        return None
    try:
        return json.loads(MARKETS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def get_existing_quote(existing: Optional[Dict[str, Any]], symbol: str) -> Optional[Dict[str, Any]]:
    if not existing:
        return None
    quotes = existing.get("quotes") if isinstance(existing, dict) else None
    if not isinstance(quotes, list):
        return None
    for quote in quotes:
        if isinstance(quote, dict) and quote.get("symbol") == symbol:
            return quote
    return None


def extract_from_dict(source: Optional[Dict[str, Any]], keys: Tuple[str, ...]) -> Optional[float]:
    if not source:
        return None
    for key in keys:
        if key in source:
            value = coerce_number(source.get(key))
            if value is not None:
                return value
    return None


def extract_state(source: Optional[Dict[str, Any]]) -> Optional[str]:
    if not source:
        return None
    state = source.get("marketState") or source.get("market_state")
    return str(state).upper() if state else None


def fetch_symbol(symbol: str) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    if yf is None:
        logging.warning("yfinance unavailable; skipping fetch for %s", symbol)
        return None, None, None
    ticker = yf.Ticker(symbol)
    fast_info: Dict[str, Any] = {}
    info: Dict[str, Any] = {}
    try:
        fast_info = ticker.fast_info or {}
    except Exception as exc:  # pylint: disable=broad-except
        logging.warning("fast_info failed for %s: %s", symbol, exc)
    try:
        info = ticker.info or {}
    except Exception as exc:  # pylint: disable=broad-except
        logging.warning("info failed for %s: %s", symbol, exc)

    price = (
        extract_from_dict(fast_info, ("last_price", "regular_market_price", "regularMarketPrice"))
        or extract_from_dict(info, ("regularMarketPrice", "currentPrice"))
    )
    previous_close = (
        extract_from_dict(fast_info, ("previous_close", "regular_market_previous_close"))
        or extract_from_dict(info, ("previousClose", "regularMarketPreviousClose"))
    )
    market_state = extract_state(fast_info) or extract_state(info)
    return price, previous_close, market_state


def build_quote(
    cfg: Dict[str, Any],
    price: Optional[float],
    previous_close: Optional[float],
    market_state: Optional[str],
    existing: Optional[Dict[str, Any]],
    now_ms: int,
) -> Tuple[Dict[str, Any], bool]:
    valid_fresh = price is not None
    if price is None:
        existing_price = coerce_number(existing.get("price") if existing else None)
        price = existing_price if existing_price is not None else cfg["seed"]
        change = None
        change_percent = None
        status = "unavailable"
    else:
        if previous_close is None:
            change = None
            change_percent = None
        else:
            change = price - previous_close
            change_percent = (change / previous_close) * 100 if previous_close else None
        if market_state:
            status = "live" if market_state in LIVE_STATES else "closed"
        else:
            status = "live"

    quote = {
        "symbol": cfg["symbol"],
        "pretty": cfg["pretty"],
        "price": price,
        "change": change,
        "changePercent": change_percent,
        "status": status,
        "updatedAt": now_ms,
    }
    return quote, valid_fresh


def build_payload(quotes: list[Dict[str, Any]], now_ms: int) -> Dict[str, Any]:
    return {"updatedAt": now_ms, "quotes": quotes}


def build_seed_payload(now_ms: int) -> Dict[str, Any]:
    quotes = []
    for cfg in TICKERS:
        quotes.append(
            {
                "symbol": cfg["symbol"],
                "pretty": cfg["pretty"],
                "price": cfg["seed"],
                "change": None,
                "changePercent": None,
                "status": "unavailable",
                "updatedAt": now_ms,
            }
        )
    return build_payload(quotes, now_ms)


def write_payload(payload: Dict[str, Any]) -> None:
    MARKETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MARKETS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> int:
    now_ms = int(time.time() * 1000)
    existing = read_existing()
    quotes = []
    valid_prices = 0

    for cfg in TICKERS:
        price = None
        prev_close = None
        market_state = None
        try:
            price, prev_close, market_state = fetch_symbol(cfg["symbol"])
        except Exception as exc:  # pylint: disable=broad-except
            logging.warning("fetch failed for %s: %s", cfg["symbol"], exc)
        existing_quote = get_existing_quote(existing, cfg["symbol"])
        quote, valid_fresh = build_quote(
            cfg,
            price,
            prev_close,
            market_state,
            existing_quote,
            now_ms,
        )
        if valid_fresh:
            valid_prices += 1
        quotes.append(quote)

    if valid_prices >= 3:
        write_payload(build_payload(quotes, now_ms))
        logging.info("updated markets.json with %s fresh prices", valid_prices)
        return 0

    if existing:
        logging.warning(
            "only %s fresh prices; keeping existing markets.json unchanged", valid_prices
        )
        return 0

    logging.warning("no existing markets.json; writing seed payload")
    write_payload(build_seed_payload(now_ms))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
