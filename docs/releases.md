# Canonical immutable releases

> Parts of this page still describe the 2.4 release process (premium-browser, entitlement). The current build steps are in the [README](../README.md#aus-dem-quelltext-bauen).

Version comes from extension/manifest.json and must equal package.json. Protocol
version remains 1 independently. The native product build metadata is generated
as native/build-info.json, not inserted as a hardcoded version in old code.

1. Integrate and independently test the complete feature source. Preserve the
   original native player and browser runtime; neither model/cache/configuration
   directories nor Python environments belong in this repository.
2. Inspect native/source-files.json and the complete source file list. Then run
   `python3 tools/release.py --freeze-inventory`. This explicit command discovers
   only approved source directories, rejects symlinks/private/runtime files and
   rejects native files outside its finite allowlist. Normal builds compare the
   frozen inventory exactly; they never silently add a file.
3. Commit the tested files and frozen inventory to a clean canonical Git checkout.
   Run `python3 tools/release.py --output-dir /path/to/new-release-A`. The output
   directory must not already exist. Git HEAD is included as sourceCommit;
   --source-commit may require an exact expected HEAD. A non-Git staging source
   may use --allow-unbound, but its output explicitly has no release provenance.
4. Repeat into a different new output directory using the same Python/zlib build
   environment. Compare every ZIP/metadata SHA256 and the webapp file manifest.
   Timestamps, ZIP modes, entry order, JSON encoding and relative output names are
   fixed. No build rewrites source files, old ZIPs, old tags or an output directory.
5. The outputs are notable-reader-extension-VERSION.zip (official ID),
   notable-reader-compatible-VERSION.zip (existing local ID), and
   notable-reader-source-VERSION.zip, plus daemon-free webapp/, SHA256SUMS,
   ASSET-MANIFEST.json, BUILD-METADATA.json and native-build-info.json.
   Both extension ZIPs differ only in manifest.key. CRC, member lists and every
   byte are checked during construction. SHA256SUMS covers ZIPs and release
   metadata; ASSET-MANIFEST contains every packaged file hash.
6. Source ZIP includes finite native sources/installer/tests and complete browser
   vendor/corresponding-source licenses. SOURCE-FILES.json binds all raw source
   bytes. BUILD-METADATA.json binds sourceTreeHash, sourceCommit and nativeBuildHash.
   Native buildHash is SHA256 of sorted relative-path→SHA256 JSON (UTF-8, two-space
   indentation, sorted keys, final newline) over native/source-files.json's
   buildHashFiles. Generated metadata is excluded from its own hash.
7. Rebuilding the extracted source ZIP verifies its source inventory and previous
   build metadata before constructing byte-identical packages. This proves source
   correspondence within the stated build environment. The claimed Git binding
   must additionally match the tag's actual clean source commit; do not treat
   an arbitrary manually edited metadata file as a trusted Git signature.
8. Publish only after independent acceptance, under a new version/tag. Never
   overwrite published assets or move an existing tag. Download the published
   packages again, verify SHA256SUMS, and install from those actual GitHub bytes.
   Record loaded browser ID/version, complete installed file hashes and native
   metadata, plus preserved user state. A locally built lookalike is not proof
   of installation from GitHub. Store review remains a separate process.

The web output is built from the browser document app and shared modules only.
A reviewed positive web file list preserves the shared premium-browser and
native-runtime selection modules; their website path does not invoke Chrome or
the native API. Native shell, backend adapters, reader-api, extension popup/focus/options/help and
manifest/background/content scripts are excluded. Its exact offline asset list
is generated from that web output. It requires no Python, CDP, native HTTP API,
installed native voices or GPU daemon.

For local staging before a canonical commit:

```sh
python3 tools/release.py --freeze-inventory
python3 tools/release.py --allow-unbound --output-dir /path/to/new-staging-A
python3 tools/release.py --allow-unbound --output-dir /path/to/new-staging-B
```

Those outputs are intentionally unbound and must be rebuilt from the final clean
Git commit before publication. Do not run the historical private package.sh as
the canonical combined builder: its old allowlist omits required current files.
