"""Owned source/license disclosure checks. Runtime-owned core is integrated by root."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[1];NATIVE=ROOT/'native'
def main():
 required={'README.md','LICENSE','COPYING-AGPL-3.0','THIRD_PARTY_NOTICES.md','requirements.txt','install.py','service_manager.py','source-files.json','premium-public.pem'}
 assert all((NATIVE/n).is_file() for n in required)
 license=(NATIVE/'COPYING-AGPL-3.0').read_text();assert 'GNU AFFERO GENERAL PUBLIC LICENSE' in license and len(license)>30000
 assert 'AGPL-3.0-or-later' in (NATIVE/'LICENSE').read_text()
 assert 'PyMuPDF' in (NATIVE/'THIRD_PARTY_NOTICES.md').read_text() and 'GPL-3.0-or-later' in (ROOT/'THIRD_PARTY_NOTICES.md').read_text()
 assert 'onnxruntime-gpu' not in (NATIVE/'requirements.txt').read_text()
 key=(NATIVE/'premium-public.pem').read_bytes();assert key.startswith(b'-----BEGIN PUBLIC KEY-----') and b'PRIVATE' not in key
 assert subprocess.run(['openssl','pkey','-pubin','-in',str(NATIVE/'premium-public.pem'),'-noout'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
 inventory=json.loads((NATIVE/'source-files.json').read_text());runtime={'player.py','bridge.mjs','extension_api.py','capture.mjs','watch.mjs'}
 missing=[n for n in inventory['files'] if not (NATIVE/n).is_file()];assert set(missing)<=runtime
 assert not set(inventory['files'])&{'models','venv','premium.json','settings.json','positions.json','build-info.json'}
 assert all(not (NATIVE/n).exists() for n in ['models','venv','tmp','settings.json','positions.json','premium.json'])
 for f in NATIVE.rglob('*'):
  if not f.is_file() or '__pycache__' in f.parts:continue
  assert f.relative_to(NATIVE).as_posix() in set(inventory['files'])|{'source-files.json','build-info.json'}
 for n in ['README.md','CHANGELOG.md','docs/install.md','docs/releases.md']:
  text=(ROOT/n).read_text();assert '2.4.0' in text or n.endswith('releases.md')
 assert 'notable-reader-compatible-2.4.0.zip' in (ROOT/'README.md').read_text()
 print(json.dumps({'owned_native_files_present':len(inventory['files'])-len(missing),'runtime_owned_integration_pending':missing,'gnu_agpl_sha256':hashlib.sha256((NATIVE/'COPYING-AGPL-3.0').read_bytes()).hexdigest()}))
 print('release disclosure verification passed')
if __name__=='__main__':main()
