"""Native identity/focus/endpoint tests without Tk, inference, or browser startup."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
N=Path(os.environ.get('READER_NATIVE_SOURCE',str(Path.home()/'.local/share/brave-reader')))
sys.path.insert(0,str(N))
import player
from extension_api import EXTENSION_ORIGINS

class NativeIdentityTests(unittest.TestCase):
 def test_metadata_is_distinct_from_protocol(self):
  original=player.ROOT
  with tempfile.TemporaryDirectory()as d:
   player.ROOT=Path(d)
   try:
    self.assertEqual(player.product_metadata(),{'productVersion':'1.6.4','buildHash':None,'protocolVersion':1})
    data={'productVersion':'2.4.0','protocolVersion':1,'buildHash':'a'*64}
    (player.ROOT/'build-info.json').write_text(json.dumps(data));self.assertEqual(player.product_metadata(),data)
    for bad in [[],{},dict(data,protocolVersion=2),dict(data,buildHash='bad'),dict(data,productVersion='latest')]:
     (player.ROOT/'build-info.json').write_text(json.dumps(bad));self.assertIsNone(player.product_metadata()['buildHash'])
   finally:player.ROOT=original
 def test_focus_routes_only_validated_extension_id(self):
  sent=[];subject=SimpleNamespace(document={'fixture':True},view_manager=SimpleNamespace(response=lambda:None),bridge=SimpleNamespace(send=sent.append))
  for origin in EXTENSION_ORIGINS:
   self.assertTrue(player.Reader.open_focus(subject,origin));self.assertEqual(sent[-1]['extensionId'],origin.split('://')[1])
  old=len(sent);self.assertFalse(player.Reader.open_focus(subject,'https://example.invalid'));self.assertEqual(len(sent),old)
  self.assertTrue(player.Reader.open_focus(subject));self.assertNotIn('extensionId',sent[-1])
  subject._focus_extension_origin=sorted(EXTENSION_ORIGINS)[0];self.assertTrue(player.Reader.open_focus(subject));self.assertEqual(sent[-1]['extensionId'],subject._focus_extension_origin.split('://')[1])
 def test_environment_cdp_origin_is_tightly_bounded(self):
  for endpoint,good in [('http://127.0.0.1:9444',True),('http://127.0.0.1:65535',True),('http://localhost:9444',False),('http://127.0.0.1:65536',False),('https://127.0.0.1:9444',False),('http://127.0.0.1:9444/path',False),('http://127.0.0.1:0',False),('http://127.0.0.1:9444?x=1',False)]:
   with self.subTest(endpoint=endpoint):
    env={**os.environ,'READER_CDP_ENDPOINT':endpoint};result=subprocess.run(['node','--input-type=module','-e',f"await import({json.dumps((N/'watch.mjs').as_uri())})"],env=env,capture_output=True,timeout=5)
    self.assertEqual(result.returncode==0,good)
if __name__=='__main__':unittest.main()
