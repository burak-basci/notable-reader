"""Device-bound signed Premium leases; no merchant key or payment data on client."""
from __future__ import annotations
import base64, json, os, re, subprocess, tempfile, threading, time, uuid
from pathlib import Path
from urllib import request, error

BASE_URL='https://reader-premium.benotable.de'
ROOT=Path(__file__).resolve().parent
PUBLIC_KEY=ROOT/'premium-public.pem'
CONFIG=Path(os.environ.get('XDG_CONFIG_HOME') or Path.home()/'.config')/'brave-reader'/'premium.json'
_LOCK=threading.RLock();_CACHE=None;_NEXT=0.;_BUSY=False
PRICE_LABEL='2,99 € / Monat'

def _load():
    try:
        value=json.loads(CONFIG.read_text())
        if not isinstance(value,dict):raise ValueError()
    except (OSError,ValueError):value={}
    if not re.fullmatch(r'[a-f0-9]{32}',str(value.get('device',''))):
        value={'device':uuid.uuid4().hex};_save(value)
    return value

def _save(value):
    CONFIG.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,name=tempfile.mkstemp(prefix='.premium-',dir=CONFIG.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w')as f:json.dump(value,f,separators=(',',':'));f.flush();os.fsync(f.fileno())
        os.replace(name,CONFIG)
    finally:
        try:os.unlink(name)
        except FileNotFoundError:pass

def _decode(value):
    if not isinstance(value,str)or not re.fullmatch(r'[A-Za-z0-9_-]+',value):raise ValueError('Invalid token')
    return base64.urlsafe_b64decode(value+'='*(-len(value)%4))

def verify_lease(token,device,now=None):
    if not isinstance(token,str)or len(token)>8192:raise ValueError('Invalid entitlement')
    parts=token.split('.')
    if len(parts)!=3 or parts[0]!='nrp1':raise ValueError('Invalid entitlement')
    payload,signature=_decode(parts[1]),_decode(parts[2]);value=json.loads(payload)
    if not isinstance(value,dict)or value.get('aud')!='notable-reader-premium' or value.get('kind')!='lease' or value.get('device')!=device:raise ValueError('Wrong entitlement')
    now=time.time()if now is None else now
    if type(value.get('exp'))not in(int,float)or type(value.get('iat'))not in(int,float)or not now<value['exp']<=value['iat']+90000 or value['iat']>now+120:raise ValueError('Expired entitlement')
    if value.get('tier')not in('subscription','lifetime','owner')or value.get('status')!='active' or not isinstance(value.get('license'),str):raise ValueError('Inactive entitlement')
    with tempfile.TemporaryDirectory(prefix='notable-entitlement-')as folder:
        message=Path(folder)/'message';sig=Path(folder)/'signature';message.write_bytes(payload);sig.write_bytes(signature)
        result=subprocess.run(['openssl','pkeyutl','-verify','-pubin','-inkey',str(PUBLIC_KEY),'-rawin','-in',str(message),'-sigfile',str(sig)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)
        if result.returncode:raise ValueError('Invalid entitlement signature')
    return value

def _post(path,value):
    req=request.Request(BASE_URL+path,data=json.dumps(value,separators=(',',':')).encode(),headers={'Content-Type':'application/json','User-Agent':'NotableReaderCompanion/1.4'},method='POST')
    try:
        with request.urlopen(req,timeout=5)as response:
            raw=response.read(32769)
            if len(raw)>32768:raise ValueError('Oversized entitlement response')
            result=json.loads(raw)
            if not isinstance(result,dict):raise ValueError('Invalid response')
            return result
    except error.HTTPError as exc:
        # A known denial revokes cached access; no raw server body/token is logged.
        if exc.code in(400,401,403,404,409):raise PermissionError('Premium konnte nicht bestätigt werden.')from None
        raise ConnectionError('Premiumdienst vorübergehend nicht erreichbar.')from None
    except (OSError,ValueError):raise ConnectionError('Premiumdienst vorübergehend nicht erreichbar.')from None

def _status(value):
    from urllib.parse import urlencode,quote
    device=value['device'];base={'enabled':False,'status':'free','tier':None,'priceLabel':PRICE_LABEL,'checkoutUrl':BASE_URL+'/checkout?'+urlencode({'device':device}),'lifetimeUrl':BASE_URL+'/support?'+urlencode({'device':device}),'portalUrl':None,'accountUrl':BASE_URL+'/account','donationUrl':'https://buy.stripe.com/cNi7sM72dbaU3w6eY7aVa00'}
    try:claims=verify_lease(value.get('lease'),device)
    except (OSError,ValueError,subprocess.SubprocessError):return base
    base.update(enabled=True,status='active',tier=claims['tier'],expires=claims['exp'])
    if claims['tier']=='subscription':base['portalUrl']=BASE_URL+'/manage#'+urlencode({'device':device,'lease':value['lease']})
    return base

def _refresh_background():
    global _CACHE,_NEXT,_BUSY
    try:
        with _LOCK:original=_load()
        candidate=dict(original)
        if original.get('lease'):
            try:
                result=_post('/api/renew',{'device':original['device'],'lease':original['lease']})
                verify_lease(result.get('lease'),original['device'])
                candidate['lease']=result['lease']
            except PermissionError:
                candidate.pop('lease',None)
            except (ConnectionError,ValueError):pass
        # Activation can complete while renew waits for the provider. Never let
        # that older response revoke or replace the newly activated license.
        with _LOCK:
            current=_load()
            if current.get('device')==original.get('device') and current.get('lease')==original.get('lease'):
                if candidate!=original:_save(candidate)
                current=candidate
            _CACHE=_status(current)
            _NEXT=time.monotonic()+300
    finally:
        with _LOCK:_BUSY=False

def get_status():
    """Fast cached status, never blocks the player/UI on HTTP or Tk calls."""
    global _CACHE,_BUSY
    with _LOCK:
        if _CACHE is None:_CACHE=_status(_load())
        if time.monotonic()>=_NEXT and not _BUSY:
            _BUSY=True;threading.Thread(target=_refresh_background,name='premium-refresh',daemon=True).start()
        return dict(_CACHE)

def require_export():
    """Cryptographic verification at the actual export boundary, not a UI flag."""
    with _LOCK:value=_load()
    try:claims=verify_lease(value.get('lease'),value['device'])
    except (OSError,ValueError,subprocess.SubprocessError):raise PermissionError('Für Downloads ist Reader Premium erforderlich.')from None
    # A signed lease expires within25h; authoritative server refresh runs independently.
    return claims

def activate(code):
    global _CACHE,_NEXT
    if not isinstance(code,str)or not 8<=len(code.strip())<=1800:raise PermissionError('Ungültiger Aktivierungscode.')
    with _LOCK:value=_load()
    result=_post('/api/activate',{'device':value['device'],'code':code.strip()});verify_lease(result.get('lease'),value['device']);value['lease']=result['lease']
    with _LOCK:_save(value);_CACHE=_status(value);_NEXT=time.monotonic()+300;return dict(_CACHE)
