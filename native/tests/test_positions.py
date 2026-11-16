"""Document bookmarks contain geometry and hashes, never source URLs or text."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from positions import Positions, pdf_identity

class PositionTests(unittest.TestCase):
    def test_identity_ignores_reload_and_secrets(self):
        a={'kind':'pdf','url':'https://Example.invalid/book.pdf?apiKey=private#page=2','targetId':'a'}
        b={**a,'url':'https://example.invalid/book.pdf?token=other#page=9','targetId':'new'}
        self.assertEqual(pdf_identity(a),pdf_identity(b))
        self.assertNotEqual(pdf_identity(a),pdf_identity({**a,'url':'https://example.invalid/other.pdf'}))
        html={'kind':'html','url':a['url']}
        self.assertEqual(pdf_identity(html),pdf_identity({**html,'url':b['url']}))
        self.assertNotEqual(pdf_identity(a),pdf_identity(html), 'HTML and PDF bookmarks have separate namespaces')
        self.assertIsNone(pdf_identity({'kind':'unsupported','url':a['url']}))
    def test_durable_private_geometry_only(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'private'/'positions.json'
            context={'kind':'pdf','url':'https://example.invalid/a.pdf?token=TOPSECRET'}
            anchor={'page':3,'bbox':[1,2,3,4],'pageWidth':600,'pageHeight':800,'text':'PRIVATE PROSE','start':92}
            store=Positions(path);store.remember(context,anchor,'a'*64,flush=True)
            saved=Positions(path).get(context,'a'*64)
            self.assertEqual(saved['page'],3)
            self.assertEqual(saved['bbox'],[1,2,3,4])
            self.assertIsNone(Positions(path).get(context,'b'*64))
            content=path.read_text()
            self.assertNotIn('TOPSECRET',content);self.assertNotIn('PRIVATE',content);self.assertNotIn('https:',content)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777,0o700)
            self.assertEqual(list(path.parent.glob('.positions-*')),[])
    def test_throttle_and_flush(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'positions.json';context={'kind':'pdf','url':'file:///book.pdf'}
            store=Positions(path,interval=600)
            word={'page':1,'bbox':[1,2,3,4],'pageWidth':600,'pageHeight':800}
            store.remember(context,word,'a'*64)
            initial=path.read_bytes();store.remember(context,{**word,'bbox':[4,5,6,7]},'a'*64)
            self.assertEqual(path.read_bytes(),initial)
            store.flush();self.assertNotEqual(path.read_bytes(),initial)
    def test_corrupt_and_invalid_are_safe(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'positions.json';path.write_text('{bad')
            store=Positions(path);context={'kind':'pdf','url':'file:///book.pdf'}
            for word in ({},{'page':True,'bbox':[1,2,3,4]}, {'page':1,'bbox':[1,float('nan'),3,4],'pageWidth':600,'pageHeight':800}):
                store.remember(context,word,'a'*64)
            store.flush();self.assertIsNone(store.get(context,'a'*64))

    def test_stale_fingerprint_with_plausible_geometry_is_returned_marked(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'positions.json';context={'kind':'pdf','url':'file:///book.pdf'}
            word={'page':176,'bbox':[50,60,150,80],'pageWidth':600,'pageHeight':800}
            store=Positions(path);store.remember(context,word,'old-fingerprint'.ljust(64,'0'),flush=True)
            # Exact match still works untouched.
            exact=store.get(context,'old-fingerprint'.ljust(64,'0'))
            self.assertEqual(exact['page'],176);self.assertNotIn('stale',exact)
            # Re-extraction changed the fingerprint but page 176 still exists
            # at the same size (within 1pt): the old spot is still plausible.
            pages={176:(600.4,799.6),200:(600,800)}
            weak=store.get(context,'new-fingerprint'.ljust(64,'1'),pages)
            self.assertIsNotNone(weak)
            self.assertEqual(weak['page'],176);self.assertEqual(weak['bbox'],[50,60,150,80])
            self.assertTrue(weak['stale'])

    def test_stale_fingerprint_rejected_when_geometry_implausible(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'positions.json';context={'kind':'pdf','url':'file:///book.pdf'}
            word={'page':176,'bbox':[50,60,150,80],'pageWidth':600,'pageHeight':800}
            store=Positions(path);store.remember(context,word,'old-fingerprint'.ljust(64,'0'),flush=True)
            new_fp='new-fingerprint'.ljust(64,'1')
            # Page no longer exists in the re-extracted document.
            self.assertIsNone(store.get(context,new_fp,{200:(600,800)}))
            # Page exists but was reflowed to a different size (more than 1pt off).
            self.assertIsNone(store.get(context,new_fp,{176:(300,400)}))
            # No pages mapping at all (caller could not derive page sizes).
            self.assertIsNone(store.get(context,new_fp))
            self.assertIsNone(store.get(context,new_fp,'not-a-dict'))
            # Defense in depth: even if a stored rectangle somehow lay outside
            # the (correctly sized) page, it must still be rejected.
            key=pdf_identity(context)
            store.entries[key]={'page':176,'bbox':[550,760,650,790],'pageWidth':600,'pageHeight':800,
                                'fingerprint':'old-fingerprint'.ljust(64,'0')}
            self.assertIsNone(store.get(context,new_fp,{176:(600,800)}))

if __name__=='__main__':unittest.main()
