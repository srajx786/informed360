#!/usr/bin/env python3
import json, os, tempfile, shutil
from datetime import datetime, timezone
from urllib.request import Request, urlopen

ROOT=os.path.dirname(os.path.dirname(__file__))
SRC=os.path.join(ROOT,'data','election-sources-india.json')
OUT=os.path.join(ROOT,'public','data','elections')
os.makedirs(OUT,exist_ok=True)
UA='Informed360ElectionBot/1.0 (polite; contact: editorial@informed360.news)'

def now(): return datetime.now(timezone.utc).isoformat()

def read_json(path,default):
    try:
        with open(path) as f: return json.load(f)
    except Exception: return default

def atomic_write(path,obj):
    fd,tmp=tempfile.mkstemp(dir=os.path.dirname(path),prefix='.tmp-',suffix='.json')
    with os.fdopen(fd,'w') as f: json.dump(obj,f,indent=2)
    os.replace(tmp,path)

def standby(source,msg,election_type='unknown'):
    return {
      'generatedAt': now(), 'source': source, 'electionType': election_type, 'status':'standby','sample':False,
      'electionName':'', 'state':'', 'municipality':'', 'partySummary':[], 'alliances':[], 'constituencies':[],
      'wards':[], 'closeContests':[], 'lastSuccessfulFetchAt':'', 'message': msg
    }

def fetch_url(url):
    req=Request(url,headers={'User-Agent':UA})
    with urlopen(req,timeout=12) as r: return r.read().decode('utf-8','ignore')

def main():
    reg=read_json(SRC,{'sources':[]})
    eci=next((s for s in reg['sources'] if s.get('id')=='eci' and s.get('enabled')),None)
    eci_source={'name':'Election Commission of India','url':'https://results.eci.gov.in/','type':'official','disclaimer':'Official status page. Parsed conservatively.'}
    eci_data=standby(eci_source,'ECI standby: no active structured feed parsed.')
    if eci:
        try:
            html=fetch_url(eci['baseUrl'])
            status='live' if 'results' in html.lower() else 'standby'
            eci_data.update({'status':status,'electionName':'ECI Results Portal','lastSuccessfulFetchAt':now(),'message':'Status derived from portal availability; detailed rows require event-specific endpoints.'})
        except Exception:
            pass
    mun_source={'name':'State Election Commission','url':'','type':'official','disclaimer':'Configured municipal source required for live parsing.'}
    municipal=standby(mun_source,'Municipal standby: configure enabled state/municipal official source URL.', 'municipal_corporation')
    for s in reg['sources']:
        if s.get('type')=='state_or_municipal_official' and s.get('enabled') and s.get('baseUrl'):
            municipal['source']['name']=s.get('name')
            municipal['source']['url']=s.get('baseUrl')
            try:
                fetch_url(s['baseUrl'])
                municipal.update({'status':'live','lastSuccessfulFetchAt':now(),'message':'Municipal source reachable; parser template ready for state-specific format.'})
            except Exception:
                municipal['status']='unavailable'
            break
    india=eci_data.copy(); india['electionType']='lok_sabha'
    for name,data in [('eci-live-results.json',eci_data),('india-election-results.json',india),('municipal-election-results.json',municipal)]:
        path=os.path.join(OUT,name)
        prev=read_json(path,None)
        if prev and not data.get('status') and prev.get('status'): data=prev
        atomic_write(path,data)

if __name__=='__main__': main()
