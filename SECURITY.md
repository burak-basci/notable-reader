# Security

Report a reproducible security problem privately to burakbascidev@gmail.com.
Please omit real document contents and credentials; a minimal synthetic fixture
is sufficient. Do not attach confidential books or business documents.

Notable Reader never executes imported document scripts, embedded macros or
remote EPUB chapter links. Imported content is converted to plain text. PDF.js
is configured with `isEvalSupported: false`; PDF scripting is not enabled.
EPUB and DOCX ZIP metadata is checked before decompression. Archive limits and
supported formats are described in README.md. This reduces attack surface but
is not a guarantee that a parser has no defects. Keep the browser current.

The extension requests `activeTab`, `scripting` and `storage`, with no standing
host permission. Article access is granted by the user's action on the current
tab. The extension does not expose a web-message bridge or network upload API.

Local voices are filtered by the browser's `localService` flag. Online voices
require opt-in. This flag is a browser/provider assertion, not an independently
audited property of every installed voice. Sensitive documents should use an
appropriate local system voice on a trusted device.
