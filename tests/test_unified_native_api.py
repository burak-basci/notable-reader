"""Isolated loopback protocol checks. No production reader/browser/model use."""
import http.client
import json
import os
from pathlib import Path
import queue
import sys
import threading
import unittest
sys.path.insert(0, os.environ.get('READER_NATIVE_SOURCE',str(Path.home()/'.local/share/brave-reader')))
from extension_api import ExtensionControl, EXTENSION_ORIGINS

class UnifiedNativeApiTests(unittest.TestCase):
 def setUp(self):
  self.events=queue.Queue();self.api=ExtensionControl(self.events,port=0);self.seen=[];self.stop=threading.Event()
  def serve():
   while not self.stop.is_set():
    try:_,_,request=self.events.get(timeout=.05)
    except queue.Empty:continue
    self.seen.append(request);self.api.complete(request['requestId'],True,'applied')
  self.worker=threading.Thread(target=serve);self.worker.start()
 def tearDown(self):self.stop.set();self.worker.join();self.api.close()
 def send(self,origins,path='/v1/control',body=None,host=None,method='POST'):
  if body is None:body={'version':1,'requestId':'a'*32,'command':'openFocus'}
  data=json.dumps(body).encode();connection=http.client.HTTPConnection('127.0.0.1',self.api.port,timeout=3)
  connection.putrequest(method,path,skip_host=True);connection.putheader('Host',host or f'127.0.0.1:{self.api.port}')
  for origin in origins:connection.putheader('Origin',origin)
  connection.putheader('Content-Type','application/json');connection.putheader('Content-Length',str(len(data)));connection.endheaders(data)
  response=connection.getresponse();raw=response.read();result=(response.status,dict(response.getheaders()),json.loads(raw)if raw else{});connection.close();return result
 def test_exact_origins_and_wire_identity(self):
  internal=[]
  for origin in sorted(EXTENSION_ORIGINS):
   status,headers,body=self.send([origin]);self.assertEqual(status,200);self.assertEqual(headers['Access-Control-Allow-Origin'],origin);self.assertEqual(body['requestId'],'a'*32)
   self.assertEqual(self.seen[-1]['_extensionOrigin'],origin);internal.append(self.seen[-1]['requestId'])
  self.assertNotEqual(*internal);self.assertEqual(len(self.seen),2)
 def test_idempotence_stays_with_origin(self):
  origin=sorted(EXTENSION_ORIGINS)[0]
  self.assertEqual(self.send([origin])[0],200);self.assertEqual(self.send([origin])[0],200);self.assertEqual(len(self.seen),1)
  self.assertEqual(self.send([origin],body={'version':1,'requestId':'a'*32,'command':'stop'})[0],409)
 def test_reject_unauthorized_missing_duplicate_origins(self):
  good=sorted(EXTENSION_ORIGINS)[0]
  for origins in [[],['https://example.invalid'],['chrome-extension://'+'a'*32],[good,good],[good,'https://example.invalid']]:
   with self.subTest(origins=origins):
    status,headers,_=self.send(origins);self.assertEqual(status,403);self.assertNotIn('Access-Control-Allow-Origin',headers)
 def test_reject_host_alias_and_port(self):
  for host in [f'localhost:{self.api.port}',f'127.0.0.1:{self.api.port+1}','evil.invalid']:
   with self.subTest(host=host):self.assertEqual(self.send([sorted(EXTENSION_ORIGINS)[0]],host=host)[0],403)
 def test_body_cannot_claim_origin(self):
  for field in ['_extensionOrigin','extensionId','_wireRequestId']:
   with self.subTest(field=field):self.assertEqual(self.send([sorted(EXTENSION_ORIGINS)[0]],body={'version':1,'requestId':'a'*32,'command':'openFocus',field:'forged'})[0],400)
 def test_preflight_origin_and_route(self):
  for origin in EXTENSION_ORIGINS:
   status,headers,_=self.send([origin],method='OPTIONS');self.assertEqual(status,204);self.assertEqual(headers['Access-Control-Allow-Origin'],origin)
  self.assertEqual(self.send([sorted(EXTENSION_ORIGINS)[0]],path='/v1/unknown',method='OPTIONS')[0],403)

if __name__=='__main__':unittest.main()
