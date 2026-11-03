"""Synthetic, redistributable PDF fixtures. No user documents or credentials."""
from pathlib import Path
import sys
import fitz
import zipfile
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
doc=fitz.open()
for n in (1,2,3):
 page=doc.new_page()
 page.insert_text((60,80), f'Notable Reader public test. Page {n}.', fontsize=18)
 page.insert_textbox(fitz.Rect(60,120,520,650), ('This is a public reading test. Local PDFs stay on this device. '
  'The reader follows the current sentence. Pause, continue and choose your own reading speed.\n\n')*5, fontsize=12)
doc.save(out/'public-reading-test.pdf')
doc.save(out/'protected-reading-test.pdf',encryption=fitz.PDF_ENCRYPT_AES_256,user_pw='public-test-password',owner_pw='public-owner-password')
doc.close()
blank=fitz.open();blank.new_page();blank.save(out/'scan-without-text.pdf');blank.close()
(out/'public-reading-test.txt').write_text('Dies ist ein öffentlicher Lesetest. Der Text bleibt auf diesem Gerät.\n\nDein Tempo gehört dir. Eine weitere Textstelle zum Springen.',encoding='utf-8')
def zipped(name,files):
 with zipfile.ZipFile(out/name,'w',compression=zipfile.ZIP_DEFLATED) as archive:
  for path,content in files.items():archive.writestr(path,content)
epub={
 'mimetype':'application/epub+zip',
 'META-INF/container.xml':'<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="BOOK/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
 'BOOK/package.opf':'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Public EPUB Test</dc:title><dc:language>en</dc:language></metadata><manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="second"/><itemref idref="first"/></spine></package>',
 'BOOK/first.xhtml':'<html><body><h1>Chapter One</h1><p>This comes second in the declared spine.</p><script>window.epubExecuted=true</script><img src="https://example.invalid/do-not-fetch"/></body></html>',
 'BOOK/second.xhtml':'<html><body><h1>Chapter Two</h1><p>This comes first in the declared spine.</p></body></html>'}
zipped('public-reading-test.epub',epub)
zipped('protected-book.epub',{**epub,'META-INF/encryption.xml':'<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></encryption>'})
zipped('public-reading-test.docx',{'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Public DOCX test.</w:t></w:r></w:p><w:p><w:r><w:t>A second paragraph.</w:t></w:r><w:del><w:r><w:t>Deleted secret text.</w:t></w:r></w:del></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell one.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Table cell two.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'})
zipped('zip-bomb.epub',{'bomb.txt':'A'*(2*1024*1024)})
zipped('unsafe-path.epub',{'../outside.txt':'A harmless public fixture with an unsafe path.'})
(out/'public-reading-test.md').write_text('# Public Markdown\n\nPlain text remains **readable**.\n\nA second paragraph.',encoding='utf-8')
(out/'public-reading-test.html').write_text('<!doctype html><html><body><h1>Public HTML</h1><p>Only the readable text remains.</p><script>window.htmlExecuted=true</script><iframe src="https://example.invalid/never-load"></iframe><img src="https://example.invalid/never-load.png"></body></html>',encoding='utf-8')
(out/'legacy.doc').write_bytes(b'not a supported legacy binary document')
print('public fixtures created')
