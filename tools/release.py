"""Immutable, explicitly inventoried Reader ZIP/PWA builder (stdlib only)."""
from pathlib import Path, PurePosixPath
import argparse, base64, hashlib, json, os, re, shutil, subprocess, sys, tempfile, zipfile
ROOT=Path(__file__).resolve().parents[1]
INVENTORY='tools/release-files.json'
OFFICIAL_ID='hgkfghgifkifgmklfgglilnmjglojonm'
COMPAT_ID='bbobdmpbadoijfffgfeefcenegbbjddd'
# Existing public manifest key; no private/signing key is used here.
COMPAT_KEY='MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAssLlFX/LlZ9+WtLqfQuDH5WzIKYHYBecX7L83XlTFxLlQzGk4LnyZfvqnqITmhrl6VpNmQKmCRG0oLXoqoXEMx+KGeO1R0UnKjdw46c3wlQ3e9bMTRIadyBqkdkUmaUUqKWSUsxJ6Mr9j07Hk6M4Na+o1Os6Nr23Ukgg3mzMO7fZ2LawFEV1b9rtxefWm1D5DItew679kUoSyZECKx6RwEm5e46hlyWknlzqjYywiKLcDG3FjmZJ6oN29SfYcmBQAsi3FgGUPTGoWuaJEZAg8qCRmj6uijQeoyU6c7GuSGezKrXQumDqEIi05365XQtuMzSvXr+cOGr9IWe09N4wVQIDAQAB'
TOP={'LICENSE','LICENSE-MIT','COPYING','README.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','package.json','.gitignore','SECURITY.md','PRIVACY.md'}
DIRS={'extension','tests','tools','third_party_sources','docs','native'}
EXCLUDED={'.git','.unlazy','__pycache__','node_modules','venv','models','cache','tmp','reports','releases','.DS_Store'}
GENERATED={'SOURCE-FILES.json','BUILD-METADATA.json','native/build-info.json'}
LICENSES=['LICENSE','LICENSE-MIT','COPYING','THIRD_PARTY_NOTICES.md']
SHELL={'service-worker.js','product-config.js','selects.js','i18n.js','file-player-transport.mjs','popup.html','popup.js','popup.css','options.html','help.html','focus.html','focus.css','focus.js','article-handoff.mjs','native-adapter.mjs','player-adapter.mjs','browser-runtime.mjs'}
WEB_ROOTS={'version.json','reader.html','reader.css','reader.js','core.js','app.webmanifest','sw.js','offline-assets.json','audio-export.js','formats.js','neural-models.js','neural-speech.js','neural-worker.js','browser-player.mjs','document-assets.mjs','pdf-appearance.mjs','player-surface.mjs','formatting.mjs','appearance.mjs','ui-locales.json','premium-browser.mjs','native-runtime.mjs','feedback.mjs','feedback.css'}|set(LICENSES)
WEB_EXCLUDED=SHELL|{'manifest.json','background.js','content-reader.js','vendor/Readability.js','vendor/READABILITY-LICENSE.md'}
def encoded(v):return (json.dumps(v,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8')
def digest(data):return hashlib.sha256(data).hexdigest()
def tree_hash(files):return digest(encoded({n:digest(d) for n,d in sorted(files.items())}))
def safe_path(name):
 p=PurePosixPath(name)
 if not name or '\\' in name or p.is_absolute() or '..' in p.parts or name!=p.as_posix():raise ValueError('Unsafe source path')
 # Only exclude top-level directories in EXCLUDED
 top_part = p.parts[0] if p.parts else ''
 if (top_part in EXCLUDED or (top_part.startswith('.') and top_part!='.gitignore' and not name.startswith('third_party_sources/'))):raise ValueError('Runtime/private path rejected: '+name)
 if p.name in {'settings.json','positions.json','premium.json','control.sock'} or p.suffix in {'.log','.pyc','.sqlite','.db','.jsonl'}:raise ValueError('Runtime/private file rejected: '+name)
 if p.suffix in {'.pem','.key'} and name!='native/premium-public.pem':raise ValueError('Non-public key rejected')
 return p

def read_source(root,name):
 p=safe_path(name);path=root.joinpath(*p.parts)
 if any(x.is_symlink() for x in [path,*list(path.parents)[:len(p.parts)-1]]):raise ValueError('Symlink source rejected: '+name)
 if not path.is_file() or root.resolve() not in path.resolve().parents:raise ValueError('Missing/escaped source: '+name)
 data=path.read_bytes()
 if re.search(br'(?m)^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',data):raise ValueError('Private key content rejected: '+name)
 if name=='native/premium-public.pem':
  if not data.startswith(b'-----BEGIN PUBLIC KEY-----') or b'PRIVATE' in data:raise ValueError('Invalid public verification key')
  subprocess.run(['openssl','pkey','-pubin','-in',str(path),'-noout'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 return data

def native_paths(root):
 v=json.loads((root/'native/source-files.json').read_text());names=v['files']
 if not isinstance(names,list) or len(set(names))!=len(names):raise ValueError('Invalid native allowlist')
 for n in names:safe_path('native/'+n)
 return names,v['buildHashFiles']

def discover(root):
 """Discovery never adds files to a normal build: the frozen list must match."""
 native,_=native_paths(root);allowed={'native/'+n for n in native}|{'native/source-files.json'}
 files=[n for n in sorted(TOP) if (root/n).is_file()]
 for directory in sorted(DIRS):
  for p in (root/directory).rglob('*'):
   n=p.relative_to(root).as_posix()
   # Exclude __pycache__ anywhere, other EXCLUDED only at top-level
   parts = p.relative_to(root).parts
   if '__pycache__' in parts:continue
   top_part = parts[0] if parts else ''
   if top_part in EXCLUDED or n in GENERATED:continue
   if p.is_symlink():raise ValueError('Symlink source rejected: '+n)
   if not p.is_file():continue
   if directory=='native' and n not in allowed:raise ValueError('Unallowlisted native source: '+n)
   read_source(root,n);files.append(n)
 return {'schema':1,'files':sorted(set(files)|{INVENTORY,'native/source-files.json'})}

def freeze(root):
 v=discover(root);(root/INVENTORY).write_bytes(encoded(v));return {'ok':True,'frozenSourceFiles':len(v['files'])}

def source_files(root):
 v=json.loads((root/INVENTORY).read_text())
 if v.get('schema')!=1 or len(set(v['files']))!=len(v['files']) or v!=discover(root):raise ValueError('Source inventory changed; inspect and run --freeze-inventory explicitly')
 files={n:read_source(root,n) for n in v['files']};native,hash_names=native_paths(root)
 if set(native)-{p.removeprefix('native/') for p in files if p.startswith('native/')}:raise ValueError('Incomplete native inventory')
 if not set(hash_names)<=set(native) or 'build-info.json' in hash_names:raise ValueError('Invalid native buildHash allowlist')
 if (root/'SOURCE-FILES.json').is_file() and json.loads((root/'SOURCE-FILES.json').read_text())!={n:digest(d) for n,d in sorted(files.items())}:raise ValueError('Source archive inventory hash mismatch')
 return files,hash_names

def commit_binding(root,requested=None,allow_unbound=False):
 probe=subprocess.run(['git','-C',str(root),'rev-parse','--show-toplevel'],capture_output=True,text=True);commit=None
 if probe.returncode==0 and Path(probe.stdout.strip()).resolve()==root.resolve():
  if subprocess.check_output(['git','-C',str(root),'status','--porcelain'],text=True).strip():raise ValueError('Git source must be clean before release')
  commit=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
 elif (root/'BUILD-METADATA.json').is_file():commit=json.loads((root/'BUILD-METADATA.json').read_text()).get('sourceCommit')
 if requested and (not re.fullmatch('[0-9a-f]{40}',requested) or requested!=commit):raise ValueError('Requested source commit does not match verified source metadata')
 if not commit and not allow_unbound:raise ValueError('No Git/source commit binding; --allow-unbound is local staging only')
 return commit

def extension_id(key):return ''.join(chr(97+int(c,16)) for c in digest(base64.b64decode(key))[:32])
def archive(path,files):
 with zipfile.ZipFile(path,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for n,data in sorted(files.items()):
   e=zipfile.ZipInfo(n,date_time=(2026,11,3,0,0,0));e.create_system=3;e.compress_type=zipfile.ZIP_DEFLATED;e.external_attr=0o100644<<16
   z.writestr(e,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
 with zipfile.ZipFile(path) as z:
  if z.testzip() or sorted(z.namelist())!=sorted(files) or any(z.read(n)!=d for n,d in files.items()):raise ValueError('ZIP CRC/inventory/byte verification failed')
 return {'file':path.name,'bytes':path.stat().st_size,'sha256':digest(path.read_bytes())}
def shell_file(n):return n in SHELL or PurePosixPath(n).name.startswith('backend')
def offline_assets(files,web=False):
 excluded=WEB_EXCLUDED|{'sw.js','offline-assets.json','neural-worker.js'}
 values=['./'+n for n in files if n not in excluded and not shell_file(n) and not n.startswith('vendor/neural/') and not n.endswith('lamejs-corresponding-source.tar.gz')]
 return encoded(sorted(set((['./','./index.html'] if web else [])+values)))

def publish_directory(source,target):
 # renameat2(RENAME_NOREPLACE) also rejects a concurrently created empty directory.
 if sys.platform.startswith('linux'):
  import ctypes
  libc=ctypes.CDLL(None,use_errno=True)
  rename=libc.renameat2;rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
  if rename(-100,os.fsencode(source),-100,os.fsencode(target),1)!=0:
   code=ctypes.get_errno();raise OSError(code,os.strerror(code))
 else:
  # Reserve destination exclusively; copy only into the newly owned directory.
  target.mkdir()
  for p in source.rglob('*'):
   relative=p.relative_to(source);dest=target/relative
   if p.is_dir():dest.mkdir()
   else:
    with dest.open('xb') as output:output.write(p.read_bytes())
  shutil.rmtree(source)

def build(root,output,requested=None,allow_unbound=False):
 if output.exists() or output.is_symlink():raise ValueError('Release output exists; immutable releases are never overwritten')
 files,hash_names=source_files(root);manifest=json.loads(files['extension/manifest.json']);version=manifest['version']
 if not re.fullmatch(r'\d+\.\d+\.\d+',version) or json.loads(files['package.json'])['version']!=version:raise ValueError('Product manifest/package version mismatch')
 if manifest['manifest_version']!=3 or extension_id(manifest['key'])!=OFFICIAL_ID or extension_id(COMPAT_KEY)!=COMPAT_ID:raise ValueError('Extension identity mismatch')
 # New architecture permissions (rc5/fable 5.2): i18n, side panel, commands, offscreen, COEP/COOP, file://
 expected_perms={'activeTab','scripting','storage','offscreen','unlimitedStorage'}
 if set(manifest['permissions'])!=expected_perms:raise ValueError(f'Unexpected permissions: got {set(manifest["permissions"])}, expected {expected_perms}')
 expected_host_perms=set()
 if set(manifest.get('host_permissions',[]))!=expected_host_perms:raise ValueError(f'Unexpected host_permissions: got {set(manifest.get("host_permissions",[]))}, expected {expected_host_perms}')
 expected_optional_host={'http://*/*','https://*/*'}
 if set(manifest.get('optional_host_permissions',[]))!=expected_optional_host:raise ValueError(f'Unexpected optional_host_permissions: got {set(manifest.get("optional_host_permissions",[]))}, expected {expected_optional_host}')
 # CSP for new architecture: huggingface.co for model downloads, no local API / premium endpoint in extension
 if 'https://huggingface.co' not in manifest['content_security_policy']['extension_pages']:raise ValueError('HuggingFace endpoint missing from CSP')
 commit=commit_binding(root,requested,allow_unbound);hashes={n:digest(d) for n,d in sorted(files.items())};native_hashes={n:digest(files['native/'+n]) for n in sorted(hash_names)}
 native_info={'productVersion':version,'protocolVersion':1,'buildHash':digest(encoded(native_hashes)),'sourceCommit':commit,'buildHashAlgorithm':'sha256(sorted-path-sha256-json-utf8-newline)','files':native_hashes}
 metadata={'schema':1,'productVersion':version,'sourceCommit':commit,'sourceTreeHash':tree_hash(files),'nativeBuildHash':native_info['buildHash'],'boundToGitCommit':bool(commit)}
 if (root/'BUILD-METADATA.json').is_file() and json.loads((root/'BUILD-METADATA.json').read_text())!=metadata:raise ValueError('Reconstructed source does not match build metadata')
 extension={n.removeprefix('extension/'):d for n,d in files.items() if n.startswith('extension/')}
 # New architecture: extension/tools/reader/ is intentional (not repo-root tools/ or native/)
 if any(n.startswith('native/') or (n.startswith('tools/') and not n.startswith('tools/reader/')) for n in extension): raise ValueError('Duplicated reader/native tree in extension')
 for n in LICENSES:extension[n]=files[n]
 extension['version.json']=encoded({'productVersion':version,'sourceCommit':commit})
 extension['offline-assets.json']=offline_assets(extension);extension['manifest.json']=encoded(manifest)
 compat=dict(extension);compat['manifest.json']=encoded({**manifest,'key':COMPAT_KEY})
 # New architecture: web app files are in tools/reader/
 web={}
 for n,d in extension.items():
  if n in WEB_ROOTS or n.startswith(('vendor/','icons/')):
   if n not in WEB_EXCLUDED and not shell_file(n):
    web[n]=d
  # Also include all tools/reader/ files for web app (maps to root)
  if n.startswith('tools/reader/'):
   web_name=n[len('tools/reader/'):]
   if web_name not in WEB_EXCLUDED and not shell_file(web_name):
    web[web_name]=d
 web['index.html']=web['reader.html'].replace(b'<title>',b'<link rel="canonical" href="https://reader.benotable.de/app/"><title>',1)
 web['WEB-SOURCE-NOTICE.md']=(f'# Notable Reader {version} – Web-App-Quellen\n\nDiese daemonfreie Web-App benötigt weder Python noch Nativecompanion. Dokumente und Audio bleiben lokal. Webdownloads kostenlos, Erweiterungsdownloads mit Premium.\n\nQuellen: https://github.com/burak-basci/notable-reader/releases/download/v{version}/notable-reader-source-{version}.zip\n\nReproduzieren: python3 tools/release.py --output-dir <neues-verzeichnis>. Browser GPL-3.0-or-later, eigene Browsermodule zusätzlich MIT; Nativequellen separat nach native/LICENSE und native/THIRD_PARTY_NOTICES.md.\n').encode('utf-8')
 web['offline-assets.json']=offline_assets(web,True)
 # A daemon-free entry still needs its shared entitlement/runtime-selection imports.
 for name,data in web.items():
  if name.startswith('vendor/') or name == 'sw.js' or not name.endswith(('.js','.mjs')):continue
  for spec in re.findall(r'''(?:from\s*|import\s*\()?["'](\./[^"']+)["']''',data.decode('utf-8',errors='ignore')):
   if not spec.endswith(('.js','.mjs')):continue
   target=(PurePosixPath(name).parent/spec).as_posix()
   if target == 'sw.js':continue
   if target not in web:raise ValueError('Missing web module: '+target)
 source={**files,'SOURCE-FILES.json':encoded(hashes),'BUILD-METADATA.json':encoded(metadata),'native/build-info.json':encoded(native_info)}
 output.parent.mkdir(parents=True,exist_ok=True);temp=Path(tempfile.mkdtemp(prefix='.reader-release-',dir=output.parent))
 try:
  records=[archive(temp/f'notable-reader-extension-{version}.zip',extension),archive(temp/f'notable-reader-compatible-{version}.zip',compat),archive(temp/f'notable-reader-source-{version}.zip',source)]
  for n,d in web.items():
   target=temp/'webapp'/n;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(d)
  assets={'schema':1,'productVersion':version,'officialId':OFFICIAL_ID,'compatibilityId':COMPAT_ID,**{label:{n:digest(d) for n,d in sorted(v.items())} for label,v in [('extension',extension),('compatibility',compat),('webapp',web),('source',source)]}}
  (temp/'ASSET-MANIFEST.json').write_bytes(encoded(assets));(temp/'BUILD-METADATA.json').write_bytes(encoded(metadata));(temp/'native-build-info.json').write_bytes(encoded(native_info));(temp/'release.json').write_bytes(encoded({'version':version,'artifacts':records,'webapp':'webapp',**metadata}))
  sums={p.name:digest(p.read_bytes()) for p in temp.iterdir() if p.is_file()};(temp/'SHA256SUMS').write_text(''.join(f'{h}  {n}\n' for n,h in sorted(sums.items())),encoding='utf-8')
  if output.exists():raise ValueError('Output appeared during build; refusing overwrite')
  publish_directory(temp,output)
 finally:
  if temp.exists():shutil.rmtree(temp)
 return {'ok':True,'version':version,'sourceCommit':commit,'sourceTreeHash':metadata['sourceTreeHash'],'nativeBuildHash':native_info['buildHash'],'artifacts':records,'output':str(output),'webapp':str(output/'webapp')}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output-dir',type=Path);p.add_argument('--freeze-inventory',action='store_true');p.add_argument('--source-commit');p.add_argument('--allow-unbound',action='store_true',help='Local staging only; no provenance claim');args=p.parse_args()
 try:
  if args.freeze_inventory:result=freeze(ROOT)
  else:
   version=json.loads((ROOT/'extension/manifest.json').read_text())['version'];result=build(ROOT,(args.output_dir or ROOT/'releases'/('v'+version)).absolute(),args.source_commit,args.allow_unbound)
  print(json.dumps(result));return 0
 except (OSError,ValueError,KeyError,subprocess.SubprocessError) as e:print('Release refused: '+str(e),file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
