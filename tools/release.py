"""Create deterministic, allowlisted extension/source ZIPs and a static PWA."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'extension/manifest.json').read_text())['version']
OUT=ROOT/'releases'
OUT.mkdir(exist_ok=True)

def archive(path,files):
 with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as out:
  for relative,data in sorted(files):
   entry=zipfile.ZipInfo(relative,date_time=(2026,11,3,0,0,0))
   entry.compress_type=zipfile.ZIP_DEFLATED
   entry.external_attr=0o644<<16
   out.writestr(entry,data)
 return {'file':path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

extension=ROOT/'extension'
for name in ['LICENSE','LICENSE-MIT','COPYING','THIRD_PARTY_NOTICES.md']:
 shutil.copyfile(ROOT/name,extension/name)
# Explicit assets keep offline caching within this app's public source tree.
assets=['./'+f.relative_to(extension).as_posix() for f in extension.rglob('*') if f.is_file() and f.name not in ['manifest.json','background.js','popup.js','popup.html','content-reader.js','sw.js','offline-assets.json','neural-worker.js'] and '/vendor/neural/' not in str(f) and f.name!='lamejs-corresponding-source.tar.gz']
(extension/'offline-assets.json').write_text(json.dumps(sorted(assets),indent=2)+'\n')
extension_files=[(file.relative_to(extension).as_posix(),file.read_bytes()) for file in extension.rglob('*') if file.is_file()]
manifest=json.loads((extension/'manifest.json').read_text())
assert manifest['manifest_version']==3
assert set(manifest['permissions'])=={'activeTab','scripting','storage'}
assert set(manifest.get('host_permissions',[]))=={'https://reader-premium.benotable.de/*'}
assert 'https://reader-premium.benotable.de' in manifest['content_security_policy']['extension_pages']
assert all(not f.startswith('.') and '..' not in Path(f).parts for f,_ in extension_files)
records=[archive(OUT/f'notable-reader-extension-{VERSION}.zip',extension_files)]

web=OUT/'webapp'
if web.exists():shutil.rmtree(web)
web.mkdir()
excluded={'background.js','manifest.json','popup.html','popup.js','content-reader.js','vendor/Readability.js','vendor/READABILITY-LICENSE.md'}
for name,data in extension_files:
 if name in excluded:continue
 target=web/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
index=(web/'reader.html').read_text()
index=index.replace('<title>', '<link rel="canonical" href="https://reader.benotable.de/app/"><title>',1)
(web/'index.html').write_text(index)
# Match the web-app cache list to the webapp allowlist exactly.
web_assets=['./','./index.html']+['./'+f.relative_to(web).as_posix() for f in web.rglob('*') if f.is_file() and f.name not in ['sw.js','offline-assets.json','index.html','neural-worker.js'] and '/vendor/neural/' not in str(f) and f.name!='lamejs-corresponding-source.tar.gz']
(web/'offline-assets.json').write_text(json.dumps(sorted(web_assets),indent=2)+'\n')

source=[]
for relative in ['LICENSE','LICENSE-MIT','README.md','THIRD_PARTY_NOTICES.md','package.json','.gitignore','SECURITY.md','PRIVACY.md','COPYING']:
 file=ROOT/relative
 if file.exists():source.append((relative,file.read_bytes()))
for dirname in ['extension','tests','tools','third_party_sources']:
 for file in (ROOT/dirname).rglob('*'):
  if file.is_file() and '__pycache__' not in file.parts:
   source.append((file.relative_to(ROOT).as_posix(),file.read_bytes()))
records.append(archive(OUT/f'notable-reader-source-{VERSION}.zip',source))
(OUT/'SHA256SUMS').write_text(''.join(f"{r['sha256']}  {r['file']}\n" for r in records))
(OUT/'release.json').write_text(json.dumps({'version':VERSION,'artifacts':records,'webapp':str(web)},indent=2)+'\n')
print(json.dumps({'ok':True,'version':VERSION,'artifacts':records,'webapp':str(web)}))
