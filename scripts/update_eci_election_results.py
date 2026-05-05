#!/usr/bin/env python3
import json, os, re, tempfile, shutil
from datetime import datetime, timezone
from pathlib import Path
import requests

BASE_URL = os.getenv('ECI_RESULTS_BASE_URL', 'https://results.eci.gov.in').rstrip('/')
INDEX_URL = os.getenv('ECI_RESULTS_INDEX_URL', f'{BASE_URL}/')
OUT = Path('public/data/elections/eci-live-results.json')
UA = 'Informed360-ECI-Snapshot/1.0 (+https://www.informed360.news/)'
DISCLAIMER = 'ECI displays information as filled in the system by Returning Officers from their respective Counting Centres. Final data for each AC/PC is shared in Form-20.'

def now(): return datetime.now(timezone.utc).isoformat()

def standby(msg):
    return {
      'generatedAt': now(),'source': {'name':'Election Commission of India','url':BASE_URL+'/', 'disclaimer':DISCLAIMER},
      'status':'standby','sample':False,'electionName':'','states':[],'partySummary':[],'alliances':[],'constituencies':[],
      'closeContests':[],'lastSuccessfulFetchAt':'','message':msg
    }

def valid(d):
    return isinstance(d, dict) and d.get('generatedAt') and d.get('source',{}).get('name') and d.get('status') and isinstance(d.get('partySummary'), list) and isinstance(d.get('constituencies'), list)

def fetch(url):
    for i in range(3):
        try:
            return requests.get(url, headers={'User-Agent':UA}, timeout=12)
        except Exception:
            if i == 2: raise

def parse(html):
    title = re.search(r'<title>(.*?)</title>', html, re.I|re.S)
    election = (title.group(1).strip() if title else '').replace('\n',' ')
    status = 'live' if re.search(r'leading|won|result', html, re.I) else 'standby'
    return {'electionName': election, 'status': status}

def atomic_write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', delete=False, dir=str(path.parent), encoding='utf-8') as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tname = tmp.name
    shutil.move(tname, path)

def main():
    prev = None
    if OUT.exists():
        try: prev = json.loads(OUT.read_text(encoding='utf-8'))
        except Exception: prev = None
    try:
        res = fetch(INDEX_URL)
        res.raise_for_status()
        parsed = parse(res.text)
        payload = standby('ECI snapshot fetched. Constituency and party breakdown unavailable from configured page.')
        payload.update(parsed)
        payload['generatedAt'] = now()
        payload['lastSuccessfulFetchAt'] = payload['generatedAt']
        payload['status'] = parsed.get('status') or 'standby'
    except Exception as e:
        payload = standby('No live ECI result feed configured right now. Election mode is ready.')
        payload['status'] = 'unavailable'
        payload['message'] = f'ECI fetch unavailable: {e.__class__.__name__}'

    if (not payload.get('partySummary') and prev and valid(prev) and prev.get('partySummary')):
        payload = prev
        payload['generatedAt'] = now()
        payload['message'] = 'Retained previous valid ECI snapshot because latest parse was empty.'

    if not valid(payload):
        payload = prev if (prev and valid(prev)) else standby('No live ECI result feed configured right now. Election mode is ready.')

    atomic_write(OUT, payload)
    print(f'Wrote {OUT}')

if __name__ == '__main__':
    main()
