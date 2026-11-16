"""Independent small-source release contract checks; no browser/network/publishing."""
from pathlib import Path
import importlib.util,json,shutil,subprocess,tempfile,unittest,zipfile
SPEC=importlib.util.spec_from_file_location('release_builder',Path(__file__).with_name('release.py'))
release=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(release)

def fixture(root):
 (root/'tools').mkdir(parents=True);(root/'extension').mkdir();(root/'native').mkdir()
 for name in release.LICENSES:(root/name).write_text('Public license fixture\n')
 (root/'tools/release.py').write_bytes(Path(__file__).with_name('release.py').read_bytes())
 official=json.loads((release.ROOT/'extension/manifest.json').read_text())
 official.update(version='2.4.0',permissions=['activeTab','scripting','storage'],host_permissions=['https://reader-premium.benotable.de/*'],optional_host_permissions=['http://127.0.0.1/*'])
 (root/'extension/manifest.json').write_bytes(release.encoded(official));(root/'package.json').write_bytes(release.encoded({'version':'2.4.0'}))
 for name,data in {'reader.html':'<!doctype html><title>Reader</title>','reader.js':'export const browserOnly=true;','sw.js':'const CACHE="2.4.0";','offline-assets.json':'[]','popup.html':'Native shell','reader-api.js':'local native adapter','backend-native.mjs':'native code','backend-browser.mjs':'shell selector','player-adapter.mjs':'native SDK'}.items():(root/'extension'/name).write_text(data)
 (root/'extension/vendor').mkdir();(root/'extension/vendor/runtime.wasm').write_bytes(b'public binary')
 (root/'native/engine.py').write_text('PROTOCOL=1\n')
 (root/'native/premium-public.pem').write_bytes((release.ROOT/'native/premium-public.pem').read_bytes())
 (root/'native/source-files.json').write_bytes(release.encoded({'files':['engine.py','premium-public.pem'],'buildHashFiles':['engine.py','premium-public.pem']}))
 release.freeze(root)
 return root

def contents(path):
 with zipfile.ZipFile(path) as z:
  assert z.testzip() is None
  return {n:z.read(n) for n in z.namelist()}

class ReleaseTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='reader-release-contract-');self.base=Path(self.temp.name);self.root=fixture(self.base/'source')
 def tearDown(self):self.temp.cleanup()
 def build(self,name='A',**kw):return release.build(self.root,self.base/name,**{'allow_unbound':True,**kw})
 def test_reproducibility_and_reconstruct_source(self):
  before={str(f.relative_to(self.root)):release.digest(f.read_bytes()) for f in self.root.rglob('*') if f.is_file()}
  self.build('A');self.build('B')
  for p in (self.base/'A').rglob('*'):
   if p.is_file():self.assertEqual(p.read_bytes(),(self.base/'B'/p.relative_to(self.base/'A')).read_bytes())
  after={str(f.relative_to(self.root)):release.digest(f.read_bytes()) for f in self.root.rglob('*') if f.is_file()};self.assertEqual(before,after)
  rebuilt=self.base/'unpacked';rebuilt.mkdir()
  with zipfile.ZipFile(self.base/'A/notable-reader-source-2.4.0.zip') as z:z.extractall(rebuilt)
  release.build(rebuilt,self.base/'C',allow_unbound=True)
  for p in (self.base/'A').glob('*.zip'):self.assertEqual(p.read_bytes(),(self.base/'C'/p.name).read_bytes())
 def test_only_manifest_key_differs_and_crc(self):
  self.build();a=contents(self.base/'A/notable-reader-extension-2.4.0.zip');b=contents(self.base/'A/notable-reader-compatible-2.4.0.zip')
  self.assertEqual(set(a),set(b));self.assertEqual([n for n in a if a[n]!=b[n]],['manifest.json'])
  am=json.loads(a['manifest.json']);bm=json.loads(b['manifest.json']);self.assertEqual(release.extension_id(am.pop('key')),release.OFFICIAL_ID);self.assertEqual(release.extension_id(bm.pop('key')),release.COMPAT_ID);self.assertEqual(am,bm);self.assertEqual(am['version'],'2.4.0')
 def test_native_source_and_daemon_free_web_asset_manifest(self):
  self.build();out=self.base/'A';source=contents(out/'notable-reader-source-2.4.0.zip');info=json.loads(source['native/build-info.json'])
  self.assertEqual(info['productVersion'],'2.4.0');self.assertEqual(info['protocolVersion'],1);self.assertEqual(info['buildHash'],release.digest(release.encoded(info['files'])));self.assertNotIn('build-info.json',info['files'])
  assets=json.loads((out/'ASSET-MANIFEST.json').read_text())
  for group,filename in [('source','notable-reader-source-2.4.0.zip'),('extension','notable-reader-extension-2.4.0.zip'),('compatibility','notable-reader-compatible-2.4.0.zip')]:self.assertEqual(assets[group],{n:release.digest(d) for n,d in contents(out/filename).items()})
  web={p.relative_to(out/'webapp').as_posix() for p in (out/'webapp').rglob('*') if p.is_file()};self.assertFalse(web & release.WEB_EXCLUDED);self.assertFalse(any(release.shell_file(n) for n in web));self.assertIn('reader.js',web)
  self.assertEqual(json.loads((out/'webapp/version.json').read_text())['productVersion'],'2.4.0');self.assertIn('./version.json',json.loads((out/'webapp/offline-assets.json').read_text()))
  cache=json.loads((out/'webapp/offline-assets.json').read_text());self.assertTrue(all(x in ['./','./index.html'] or x.removeprefix('./') in web for x in cache))
  for line in (out/'SHA256SUMS').read_text().splitlines():
   sha,name=line.split('  ');self.assertEqual(sha,release.digest((out/name).read_bytes()))
 def test_existing_output_and_old_release_never_change(self):
  old=self.root/'releases';old.mkdir();(old/'2.3.3.zip').write_bytes(b'old immutable bytes');self.build();before=(self.base/'A/SHA256SUMS').read_bytes()
  with self.assertRaisesRegex(ValueError,'never overwritten'):self.build()
  self.assertEqual(before,(self.base/'A/SHA256SUMS').read_bytes());self.assertEqual((old/'2.3.3.zip').read_bytes(),b'old immutable bytes')
  empty=self.base/'occupied';empty.mkdir()
  with self.assertRaises((ValueError,OSError)):release.publish_directory(self.base/'A',empty)
  self.assertTrue((self.base/'A').is_dir())
 def test_normal_build_refuses_unfrozen_and_native_runtime_files(self):
  (self.root/'extension/new.mjs').write_text('unfrozen')
  with self.assertRaisesRegex(ValueError,'inventory changed'):self.build()
  (self.root/'extension/new.mjs').unlink();(self.root/'native/premium.json').write_text('{}')
  with self.assertRaisesRegex(ValueError,'Unallowlisted native'):release.freeze(self.root)
 def test_symlinks_private_keys_and_mismatched_versions_rejected(self):
  (self.root/'extension/link').symlink_to(self.root/'package.json')
  with self.assertRaisesRegex(ValueError,'Symlink'):release.freeze(self.root)
  (self.root/'extension/link').unlink();(self.root/'extension/secret.txt').write_text('-----BEGIN '+'PRIVATE KEY-----\nfixture only\n')
  with self.assertRaisesRegex(ValueError,'Private key content'):release.freeze(self.root)
  (self.root/'extension/secret.txt').unlink();(self.root/'package.json').write_bytes(release.encoded({'version':'9.9.9'}))
  with self.assertRaisesRegex(ValueError,'version mismatch'):self.build()
 def test_shared_web_runtime_import_is_preserved_and_missing_import_refused(self):
  (self.root/'extension/premium-browser.mjs').write_text("import {runtime} from './native-runtime.mjs'; export const websiteSafe=true;")
  (self.root/'extension/native-runtime.mjs').write_text('export const runtime=null;')
  (self.root/'extension/reader.js').write_text("import './premium-browser.mjs';")
  release.freeze(self.root);self.build()
  self.assertTrue((self.base/'A/webapp/native-runtime.mjs').is_file());self.assertTrue((self.base/'A/webapp/premium-browser.mjs').is_file())
  (self.root/'extension/native-runtime.mjs').unlink();release.freeze(self.root)
  with self.assertRaisesRegex(ValueError,'Missing web module'):self.build('missing')
 def test_commit_binding_and_tampered_source_rejected(self):
  with self.assertRaisesRegex(ValueError,'No Git/source'):release.build(self.root,self.base/'unbound')
  subprocess.run(['git','init','-q',str(self.root)],check=True)
  subprocess.run(['git','-C',str(self.root),'add','.'],check=True)
  subprocess.run(['git','-C',str(self.root),'-c','user.name=Public test','-c','user.email=test@example.invalid','commit','-qm','Fixture'],check=True)
  head=subprocess.check_output(['git','-C',str(self.root),'rev-parse','HEAD'],text=True).strip();result=release.build(self.root,self.base/'bound',requested=head)
  self.assertEqual(result['sourceCommit'],head)
  with self.assertRaisesRegex(ValueError,'does not match'):release.build(self.root,self.base/'wrong',requested='0'*40)
  (self.root/'extension/reader.js').write_text('modified')
  with self.assertRaisesRegex(ValueError,'clean'):release.build(self.root,self.base/'dirty')
  unpacked=self.base/'tampered';unpacked.mkdir()
  with zipfile.ZipFile(self.base/'bound/notable-reader-source-2.4.0.zip') as z:z.extractall(unpacked)
  (unpacked/'native/engine.py').write_text('tampered')
  with self.assertRaisesRegex(ValueError,'hash mismatch'):release.build(unpacked,self.base/'tampered-build')
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReleaseTests))
 if result.wasSuccessful():print('release builder verification passed')
 raise SystemExit(0 if result.wasSuccessful() else 1)
