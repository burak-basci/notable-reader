# Optional native companion: third-party notices

The own native source is AGPL-3.0-or-later (LICENSE, COPYING-AGPL-3.0).
This is a source/bootstrap distribution, not a prebuilt Python environment.
The browser distribution keeps its separate GPL-3.0-or-later/MIT notices.

| Separately installed component | Pin | License / upstream |
|---|---|---|
| PyMuPDF / MuPDF | 1.28.2 | AGPL-3.0 or Artifex commercial; https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright |
| phonemizer | 3.4.0 | GPL-3.0-or-later; https://github.com/bootphon/phonemizer |
| kokoro-onnx | 0.6.1 | MIT; https://github.com/thewh1teagle/kokoro-onnx |
| ONNX Runtime CPU / optional GPU | 1.31.0 | MIT; https://github.com/microsoft/onnxruntime |
| espeakng-loader / embedded eSpeak NG | 0.2.4 | Preserve package and embedded eSpeak NG GPL-3.0-or-later notices; https://github.com/thewh1teagle/espeakng-loader |
| NumPy | 2.5.4 | BSD-3-Clause with retained bundled component licenses |
| soundfile / separately supplied libsndfile | 0.14.0 | soundfile BSD-3-Clause; libsndfile LGPL-2.1-or-later |

The full pinned Python dependency list is requirements.txt. Its packages retain
all their upstream notices and bundled licenses. Optional NVIDIA/CUDA/cuDNN
packages are not part of this source archive and have their own terms; install
only via the explicit --gpu option on a compatible Linux machine.

System Python/Tk, Node.js, mpv, OpenSSL and ffmpeg are supplied separately.
FFmpeg/mpv licensing depends on the system build; no such binaries are bundled.
The native exporter invokes the installed ffmpeg program. The browser's separate
LGPL MP3 module and complete corresponding source remain under extension/vendor/export.

No voice/model weights are included or downloaded by the bootstrap. Existing
user-selected models may be linked with --models. Kokoro82M/Bella is Apache-2.0;
Piper Thorsten model repository is MIT with CC0 dataset as its model card states.
Other locally installed voices, including German Kokoro fine-tunes, need their
own model cards, provenance, redistribution and dataset checks before public
model distribution; a local installation is not permission to redistribute.

The public premium-public.pem verifies device-bound signed entitlements. It is
not a merchant/signing secret and grants no paid or developer access by itself.

Sources and exact build inventory for this native companion accompany the
canonical Notable Reader source archive. When distributing dependency binaries
or operating a modified covered network service, assess and fulfill the actual
corresponding-source and license obligations; this file is not an exemption.
