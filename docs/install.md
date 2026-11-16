# Install or upgrade Notable Reader 2.4.0

Download the chosen ZIP and SHA256SUMS from the same canonical GitHub release.
Run `sha256sum -c SHA256SUMS --ignore-missing` in that download directory.
This verifies the downloaded bytes against the published digest; obtain the
checksum file from the trusted release, not an unrelated mirror.

The official ZIP preserves ID hgkfghgifkifgmklfgglilnmjglojonm. The compatible
ZIP preserves existing local ID bbobdmpbadoijfffgfeefcenegbbjddd. Everything
except the manifest public key is byte-identical. Pick the ID already installed.
Do not edit version numbers or replace keys manually to simulate an upgrade.

Fresh install: unzip the package to a persistent directory, enable developer
mode at chrome://extensions, and load that unpacked directory. The browser
engine and file reader work without a native daemon. Browser model downloads
are deliberate user actions. Website/PWA downloads are free; extension exports
require an actual signed entitlement.

Existing-user upgrade: freshly back up the installed directory and current
settings, reading positions and entitlement identity. Wait until playback is
inactive. Replace only the package's allowlisted program files in the same
installed extension path, reload it, and read back loaded version 2.4.0 and the
unchanged ID. Compare the complete installed file tree against the downloaded
ZIP, not only manifest.json. Do not write old test settings or change a browser
profile's theme, zoom or active tab.

The optional Linux native companion is documented in ../native/README.md.
Its bootstrap refuses an existing prefix. It never downloads models and does
not replace a venv, model directory, settings, positions or premium identity.
An explicit --models choice links preexisting local weights, preserving them.
An existing native installation must be upgraded by its operator using the
source allowlist with current backup and inactive playback; do not run the
fresh-prefix bootstrap over it. The root extension is the one shared UI/vendor
source; no second copy lives under native/ in the repository.

After native upgrade, read productVersion, protocolVersion=1, sourceCommit and
buildHash. Verify each hash in native/build-info.json against the installed
allowlisted native sources. Preserve that metadata from the downloaded source
ZIP. A 2.4.0 extension showing an old native runtime is not a proven complete
upgrade. Check original design, visible acknowledged document binding, reload/
tab recovery, settings/positions/entitlement preservation and both runtime paths
without autoplay. A developer/owner entitlement is not a fictitious paid sale.

A new GitHub release does not update the Chrome Web Store. Store review and
installation state remain independently verifiable; this procedure never
submits to or cancels a store review.
