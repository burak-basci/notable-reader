#!/usr/bin/env python3
"""Explicit Linux-only bootstrap. Never downloads models or replaces an installation."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile
ROOT=Path(__file__).resolve().parent

def encoded(value):return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8')
def sha(data):return hashlib.sha256(data).hexdigest()
def safe(root,name):
 p=PurePosixPath(name)
 if p.is_absolute() or '..' in p.parts or '\\' in name:raise ValueError('Unsafe package path')
 f=root.joinpath(*p.parts)
 if any(x.is_symlink() for x in [f,*list(f.parents)[:len(p.parts)-1]]) or not f.is_file() or root.resolve() not in f.resolve().parents:raise ValueError('Missing or unsafe package source: '+name)
 return f

def verify(root=ROOT):
 manifest=json.loads((root/'source-files.json').read_text());info=json.loads((root/'build-info.json').read_text());files=manifest['files']
 if len(files)!=len(set(files)) or not set(manifest['buildHashFiles'])<=set(files):raise ValueError('Invalid native allowlist')
 hashes={n:sha(safe(root,n).read_bytes()) for n in sorted(manifest['buildHashFiles'])}
 if info['protocolVersion']!=1 or info['buildHash']!=sha(encoded(hashes)) or info.get('files')!=hashes:raise ValueError('Native source/build hash mismatch')
 key=safe(root,'premium-public.pem').read_bytes()
 if not key.startswith(b'-----BEGIN PUBLIC KEY-----') or b'PRIVATE' in key:raise ValueError('Invalid public verification key')
 for n in files:safe(root,n)
 return manifest,info

def prerequisites(python):
 result={'linux':sys.platform.startswith('linux'),'python312':False,'tkinter':False}
 for name in ['node','mpv','openssl','ffmpeg','systemctl']:result[name]=shutil.which(name) is not None
 try:
  v=subprocess.check_output([python,'-c','import sys;print(str(sys.version_info.major)+"."+str(sys.version_info.minor))'],text=True,stderr=subprocess.DEVNULL).strip();result['python312']=v=='3.12'
  result['tkinter']=subprocess.run([python,'-c','import tkinter'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
  if result['node']:
   result['node']=int(subprocess.check_output(['node','--version'],text=True).strip().lstrip('v').split('.')[0])>=22
 except (OSError,ValueError,subprocess.SubprocessError):pass
 return result

def prepare(prefix,root=ROOT,models=None):
 if prefix.exists() or prefix.is_symlink():raise ValueError('Prefix already exists; existing installations are never changed')
 manifest,info=verify(root);source=root.parent
 hashes=json.loads((source/'SOURCE-FILES.json').read_text())
 if not isinstance(hashes,dict):raise ValueError('Source archive inventory missing')
 for name,expected in hashes.items():
  if sha(safe(source,name).read_bytes())!=expected:raise ValueError('Source archive file hash mismatch')
 inventory=json.loads((source/'tools/release-files.json').read_text())['files']
 if set(inventory)!=set(hashes):raise ValueError('Source file inventory mismatch')
 ext=[n for n in inventory if n.startswith('extension/')]
 if not ext:raise ValueError('Shared extension source missing from source archive')
 if models:
  models=models.expanduser().resolve(strict=True)
  if not models.is_dir():raise ValueError('Model directory does not exist')
  # Existing user-selected model directory is linked, never modified or downloaded.
  if not (models/'kokoro-full.onnx').is_file() or not (models/'voices.bin').is_file():raise ValueError('Selected directory lacks base Kokoro model or voices')
 prefix.parent.mkdir(parents=True,exist_ok=True)
 temp=Path(tempfile.mkdtemp(prefix='.reader-native-',dir=prefix.parent))
 try:
  for name in manifest['files']:
   target=temp/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(safe(root,name).read_bytes())
  (temp/'source-files.json').write_bytes((root/'source-files.json').read_bytes());(temp/'build-info.json').write_bytes((root/'build-info.json').read_bytes())
  # Exactly one installed shared UI/vendor tree, no native/extension source duplicate.
  for name in ext:
   target=temp/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(safe(source,name).read_bytes())
  if models:(temp/'models').symlink_to(models,target_is_directory=True)
  (temp/'installation.json').write_bytes(encoded({'productVersion':info['productVersion'],'protocolVersion':1,'sourceCommit':info.get('sourceCommit'),'buildHash':info['buildHash'],'modelsLinked':bool(models),'dependenciesInstalled':False}))
  if prefix.exists():raise ValueError('Prefix appeared during preparation')
  temp.rename(prefix)
 finally:
  if temp.exists():shutil.rmtree(temp)
 return info

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 mode=parser.add_mutually_exclusive_group();mode.add_argument('--check',action='store_true');mode.add_argument('--install',action='store_true');mode.add_argument('--prepare-only',action='store_true',help='Copy verified source only; does not claim a ready runtime')
 parser.add_argument('--prefix',type=Path);parser.add_argument('--python',default=sys.executable);parser.add_argument('--models',type=Path,help='Existing explicitly chosen local model directory; no model downloads')
 parser.add_argument('--gpu',action='store_true',help='Explicitly install the optional NVIDIA/CUDA wheel last')
 parser.add_argument('--enable-service',action='store_true',help='Explicitly register a user service, without starting playback')
 args=parser.parse_args()
 try:
  _,info=verify();checks=prerequisites(args.python)
  if not args.install and not args.prepare_only:
   print(json.dumps({'ok':all(checks.values()),'productVersion':info['productVersion'],'protocolVersion':1,'buildHash':info['buildHash'],'requirements':checks,'modelsDownloaded':False}));return 0 if all(checks.values()) else 1
  if not sys.platform.startswith('linux'):raise ValueError('Bootstrap supports Linux only')
  if args.prepare_only and (args.gpu or args.enable_service):raise ValueError('Prepare-only cannot install GPU libraries or register a service')
  if args.install and not all(checks.values()):raise ValueError('Missing prerequisites; run --check with a Python 3.12 interpreter')
  if args.enable_service:
   config=Path(os.environ.get('XDG_CONFIG_HOME') or Path.home()/'.config')
   existing=[config/'systemd/user/brave-reader.service',Path.home()/'.local/bin/brave-read']
   if any(p.exists() or p.is_symlink() for p in existing):raise ValueError('Existing service/launcher must not be replaced')
  prefix=(args.prefix or Path.home()/'.local/share/notable-reader'/('native-'+info['productVersion'])).expanduser().absolute()
  prepare(prefix,models=args.models)
  if args.install:
   subprocess.run([args.python,'-m','venv',str(prefix/'venv')],check=True)
   python=prefix/'venv/bin/python';subprocess.run([str(python),'-m','pip','install','-r',str(prefix/'requirements.txt')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   if args.gpu:subprocess.run([str(python),'-m','pip','install','--force-reinstall','onnxruntime-gpu[cuda,cudnn]==1.31.0'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   state=json.loads((prefix/'installation.json').read_text());state['dependenciesInstalled']=True;(prefix/'installation.json').write_bytes(encoded(state))
   if args.enable_service:subprocess.run([str(python),str(prefix/'service_manager.py'),'install'],check=True)
  print(json.dumps({'ok':True,'prepared':True,'dependenciesInstalled':bool(args.install),'modelsDownloaded':False,'modelsLinked':bool(args.models),'productVersion':info['productVersion'],'protocolVersion':1,'buildHash':info['buildHash'],'runtimeReady':False,'runtimeValidationRequired':True}));return 0
 except (OSError,ValueError,KeyError,subprocess.SubprocessError):
  # Do not print exceptions: pip/service errors can contain personal paths/URLs.
  print('Native setup refused or incomplete; existing installations were not replaced. Check prerequisites, source integrity and choose a new prefix.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
