"""Reconstruct and verify the complete upstream preloaded-data source variant."""
from pathlib import Path
import hashlib,json,shutil,sys
root=Path(__file__).resolve().parents[1]/'third_party_sources'
delta=root/'espeak-ng-data-source'
manifest=json.loads((delta/'RECONSTRUCT.json').read_text())
target=Path(sys.argv[1]).resolve()
if target.exists():raise SystemExit('Destination must be new; existing files are never removed.')
shutil.copytree(root/'espeak-ng',target)
expected=manifest['sha256_by_path']
for p in target.rglob('*'):
 if p.is_file() and p.relative_to(target).as_posix() not in expected:p.unlink()
for relative in manifest['changed_files']:
 p=target/relative;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(delta/relative,p)
for relative,digest in expected.items():
 p=target/relative
 if hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise SystemExit('Source verification failed: '+relative)
actual={p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}
if actual!=set(expected):raise SystemExit('Source inventory mismatch')
print(json.dumps({'ok':True,'commit':manifest['source_commit'],'files':len(expected)}))
