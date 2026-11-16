# Optional native engine · Notable Reader 2.4.0

The normal extension and web app run without this daemon. This optional Linux
companion adds locally installed voices, native PDF integration and optional GPU
inference. Its original player is shared with the extension. Product version is
2.4.0; the API protocol remains 1. `build-info.json` binds the actual allowlisted
source bytes to the source commit. It is generated into the source archive.

## Supported bootstrap boundary

Python 3.12 with Tk/venv, Node.js 22+, mpv, OpenSSL, ffmpeg, systemd user services
and a Chromium-based browser with an explicitly configured local CDP endpoint
(default 127.0.0.1:9333; READER_CDP_ENDPOINT may explicitly select another local port) are required. This bootstrap is for Linux. Windows,
macOS, Flatpak browser integration, every GPU/driver combination and generic
desktop tab selection are not validated by this installer. Hyprland tab matching
has an explicit-target fallback; keep browser debugging local.

Use the complete verified canonical source ZIP, not an isolated copy of this
folder. It includes the one shared extension/vendor tree. First inspect:

```sh
python3.12 native/install.py --check
```

Choose a **new** installation prefix. Setup refuses an existing path, preserves
other installations, and never copies settings, positions, premium leases,
browser profiles, caches or Python environments. To install CPU dependencies:

```sh
python3.12 native/install.py --install --prefix "$HOME/.local/share/notable-reader/native-2.4.0"
```

This is an explicit network operation for pinned Python packages. It does not
download models, alter the browser or start playback. `--gpu` explicitly selects
optional ONNX Runtime CUDA/cuDNN packages and installs their wheel last. Driver
compatibility and memory requirements must be checked on the actual machine.

Models are a separate, deliberate user choice. To use already downloaded,
license-reviewed model files, pass `--models /path/to/existing/models` during
setup. The directory must contain `kokoro-full.onnx` and `voices.bin`; additional
voices are offered only when their local files exist. The installer links that
directory without changing it. Without models setup is not a usable speech
runtime. No automatic model fetch is hidden in startup or setup.

`--prepare-only` copies verified sources and the one shared UI/vendor tree but
installs no packages and makes no runtime-readiness claim. It is useful for
inspection, packaged environments and offline preparation.

After prerequisites, models and browser endpoint are deliberately configured,
`--enable-service` registers the new user service without starting playback.
That explicit option uses the standard brave-reader.service/launcher names and
refuses to replace an existing service or launcher.
Existing-user upgrades are handled separately: freshly back up settings,
positions and entitlement identity, wait for inactive playback, update only the
source allowlist, retain venv/models/cache, reload the extension and read back
its real version/ID and the native build metadata. See ../docs/install.md.

## Licenses and reproducibility

Own native code: AGPL-3.0-or-later. PyMuPDF/MuPDF is AGPL or commercially licensed;
phonemizer/eSpeak retain GPL terms. Full text and dependency details are beside
this file. A separate process or absence of piper1-gpl does not make this stack
MIT-only. No commercial license or entitlement is included.

`source-files.json` is the finite native allowlist. `buildHashFiles` is hashed
as a sorted UTF-8 JSON map of relative path to SHA256 (two-space indentation,
trailing newline), excluding build-info.json itself. Source ZIP metadata also
binds the complete canonical source tree. Never add model/runtime directories
to that list. Retain notices when reusing or distributing the sources.
