"""Bootstrap refusal/integrity tests use a fresh isolated prefix, never pip/network."""
from pathlib import Path
import contextlib,importlib.util,json,tempfile,unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('native_setup',HERE.parent/'native/install.py');setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)

class BootstrapTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='reader-bootstrap-');self.base=Path(self.tmp.name);self.source=self.base/'source';self.root=self.source/'native';self.root.mkdir(parents=True);(self.source/'extension').mkdir();(self.source/'tools').mkdir()
  self.files={'engine.py':b'PROTOCOL=1\n','install.py':(HERE.parent/'native/install.py').read_bytes(),'premium-public.pem':(HERE.parent/'native/premium-public.pem').read_bytes()}
  for n,d in self.files.items():(self.root/n).write_bytes(d)
  self.manifest={'files':sorted(self.files),'buildHashFiles':sorted(self.files)};(self.root/'source-files.json').write_bytes(setup.encoded(self.manifest))
  hashes={n:setup.sha(d) for n,d in sorted(self.files.items())};self.info={'productVersion':'2.4.0','protocolVersion':1,'files':hashes,'buildHash':setup.sha(setup.encoded(hashes)),'sourceCommit':'a'*40};(self.root/'build-info.json').write_bytes(setup.encoded(self.info))
  (self.source/'extension/reader.js').write_text('one shared UI')
  inventory=sorted(['native/'+n for n in self.files]+['native/source-files.json','extension/reader.js','tools/release-files.json']);(self.source/'tools/release-files.json').write_bytes(setup.encoded({'files':inventory}))
  self.raw={n:setup.sha((self.source/n).read_bytes()) for n in inventory};(self.source/'SOURCE-FILES.json').write_bytes(setup.encoded(self.raw))
 def tearDown(self):self.tmp.cleanup()
 def test_prepare_real_files_without_dependencies_models_or_network(self):
  with patch.object(setup.subprocess,'run',side_effect=AssertionError('No subprocess allowed during prepare')):
   info=setup.prepare(self.base/'new',root=self.root)
  prefix=self.base/'new';self.assertEqual(info['buildHash'],self.info['buildHash']);self.assertEqual((prefix/'extension/reader.js').read_bytes(),b'one shared UI');self.assertFalse((prefix/'venv').exists());self.assertFalse((prefix/'models').exists());self.assertFalse(json.loads((prefix/'installation.json').read_text())['dependenciesInstalled']);self.assertEqual(setup.verify(prefix)[1]['productVersion'],'2.4.0')
 def test_real_prepare_only_cli_and_prerequisite_readback(self):
  import subprocess,sys
  process=subprocess.run([sys.executable,str(self.root/'install.py'),'--prepare-only','--prefix',str(self.base/'cli')],capture_output=True,text=True)
  self.assertEqual(process.returncode,0,process.stderr);value=json.loads(process.stdout);self.assertFalse(value['runtimeReady']);self.assertTrue(value['runtimeValidationRequired']);self.assertFalse(value['modelsDownloaded']);self.assertFalse(value['dependenciesInstalled']);self.assertFalse((self.base/'cli/venv').exists())
  second=subprocess.run([sys.executable,str(self.root/'install.py'),'--prepare-only','--prefix',str(self.base/'cli')],capture_output=True,text=True)
  self.assertNotEqual(second.returncode,0)
 def test_existing_prefix_symlink_and_tampered_sources_rejected(self):
  prefix=self.base/'existing';prefix.mkdir();(prefix/'sentinel').write_bytes(b'keep')
  with self.assertRaises(ValueError):setup.prepare(prefix,root=self.root)
  self.assertEqual((prefix/'sentinel').read_bytes(),b'keep')
  (self.base/'link').symlink_to(prefix,target_is_directory=True)
  with self.assertRaises(ValueError):setup.prepare(self.base/'link',root=self.root)
  (self.root/'engine.py').write_text('changed')
  with self.assertRaisesRegex(ValueError,'hash mismatch'):setup.prepare(self.base/'bad',root=self.root)
  self.assertFalse((self.base/'bad').exists())
 def test_extension_source_tamper_and_model_choice(self):
  (self.source/'extension/reader.js').write_text('tampered')
  with self.assertRaisesRegex(ValueError,'archive file hash mismatch'):setup.prepare(self.base/'bad',root=self.root)
  (self.source/'extension/reader.js').write_text('one shared UI');models=self.base/'chosen-models';models.mkdir();(models/'kokoro-full.onnx').write_bytes(b'user fixture');(models/'voices.bin').write_bytes(b'user fixture voices')
  before={x.name:x.read_bytes() for x in models.iterdir()};setup.prepare(self.base/'linked',root=self.root,models=models)
  self.assertTrue((self.base/'linked/models').is_symlink());self.assertEqual((self.base/'linked/models').resolve(),models);self.assertEqual(before,{x.name:x.read_bytes() for x in models.iterdir()})
 def test_prerequisite_probe_is_read_only_and_failures_are_honest(self):
  import subprocess
  checks=setup.prerequisites('/nonexistent/reader-python');self.assertFalse(checks['python312']);self.assertFalse(checks['tkinter'])
  with patch.object(setup.shutil,'which',return_value='/public/test/tool'),patch.object(setup.subprocess,'check_output',side_effect=['3.12\n','v22.1.0\n']),patch.object(setup.subprocess,'run',return_value=subprocess.CompletedProcess([],0)):
   self.assertTrue(all(setup.prerequisites('/public/test/python').values()))
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(BootstrapTests))
 if result.wasSuccessful():print('native bootstrap verification passed')
 raise SystemExit(0 if result.wasSuccessful() else 1)
