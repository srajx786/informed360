#!/usr/bin/env python3
import json
import os
import tempfile
import time
from datetime import datetime, timezone
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(__file__))
SRC = os.path.join(ROOT, 'data', 'election-sources-india.json')
OUT = os.path.join(ROOT, 'public', 'data', 'elections')
os.makedirs(OUT, exist_ok=True)
UA = 'Informed360ElectionBot/1.0 (polite; contact: editorial@informed360.news)'
TIMEOUT = 12
MAX_RETRY = 2


def now(): return datetime.now(timezone.utc).isoformat()


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def atomic_write(path, obj):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.tmp-', suffix='.json')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


def standby(source, msg, election_type='unknown'):
    return {
        'generatedAt': now(), 'source': source, 'electionType': election_type,
        'status': 'standby', 'sample': False, 'electionName': '', 'state': '', 'municipality': '',
        'partySummary': [], 'alliances': [], 'constituencies': [], 'wards': [],
        'statusMeta': {'retried': 0}, 'lastSuccessfulFetchAt': '', 'message': msg
    }


def fetch_url(url):
    req = Request(url, headers={'User-Agent': UA})
    last_err = None
    for attempt in range(MAX_RETRY + 1):
        try:
            with urlopen(req, timeout=TIMEOUT) as r:
                return r.read().decode('utf-8', 'ignore'), attempt
        except (URLError, HTTPError, TimeoutError) as err:
            last_err = err
            if attempt < MAX_RETRY:
                time.sleep(0.7)
    raise last_err


def preserve_previous(path, candidate):
    prev = read_json(path, None)
    if not prev:
        return candidate
    if candidate.get('status') in ('standby', 'unavailable') and prev.get('status') == 'live':
        prev['message'] = f"Previous-good snapshot preserved at {now()} due to fetch/parser fallback."
        prev['generatedAt'] = now()
        return prev
    return candidate


def main():
    reg = read_json(SRC, {'sources': []})
    eci = next((s for s in reg['sources'] if s.get('id') == 'eci' and s.get('enabled')), None)

    eci_source = {'name': 'Election Commission of India', 'url': 'https://results.eci.gov.in/', 'type': 'official'}
    eci_data = standby(eci_source, 'ECI standby: no active structured feed parsed.')

    if eci:
        try:
            html, retries = fetch_url(eci['baseUrl'])
            status = 'live' if 'result' in html.lower() else 'standby'
            eci_data.update({'status': status, 'electionName': 'ECI Results Portal', 'lastSuccessfulFetchAt': now(), 'statusMeta': {'retried': retries}, 'message': 'Portal reachable; structured parser remains conservative until event-specific endpoints are configured.'})
        except Exception as err:
            eci_data.update({'status': 'unavailable', 'message': f'ECI fetch failed; standby used ({err.__class__.__name__}).'})

    municipal = standby({'name': 'State Election Commission', 'url': '', 'type': 'official'}, 'Municipal standby: configure enabled state/municipal official source URL.', 'municipal')
    for source in reg['sources']:
        if source.get('type') == 'state_or_municipal_official' and source.get('enabled') and source.get('baseUrl'):
            municipal['source'].update({'name': source.get('name', 'State Election Commission'), 'url': source.get('baseUrl', '')})
            municipal['state'] = source.get('state', '')
            try:
                _, retries = fetch_url(source['baseUrl'])
                municipal.update({'status': 'live', 'lastSuccessfulFetchAt': now(), 'statusMeta': {'retried': retries}, 'message': 'Source reachable; parser template ready for state-specific format.'})
            except Exception as err:
                municipal.update({'status': 'unavailable', 'message': f'Source unavailable ({err.__class__.__name__}); standby retained.'})
            break

    india = dict(eci_data)
    india['electionType'] = 'national_or_state'

    payloads = {
        'eci-live-results.json': eci_data,
        'india-election-results.json': india,
        'municipal-election-results.json': municipal
    }
    for filename, data in payloads.items():
        path = os.path.join(OUT, filename)
        atomic_write(path, preserve_previous(path, data))


if __name__ == '__main__':
    main()
