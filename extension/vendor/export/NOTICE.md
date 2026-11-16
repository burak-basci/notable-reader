# MP3 export encoder

Notable Reader uses **@breezystack/lamejs 1.2.7**, a JavaScript port/fork of
the LAME MP3 encoder by Alex Zhukov and the lamejs/LAME contributors.
License: **LGPL-3.0** (upstream package declaration). The unchanged, separately
loaded ES module is `lamejs.js`; it is not proprietary Notable Reader code.
The Notable Reader adapter in `../../audio-export.js` is MIT; the combined
public Reader distribution remains GPL-3.0-or-later because of its separately
documented neural phonemizer dependencies. No restriction on replacing,
debugging, or modifying this encoder is imposed.

Primary sources, checked 2026-11-03:

- Published package: https://registry.npmjs.org/@breezystack/lamejs/1.2.7
- Repository (redirect of the package's original shijinyu repository):
  https://github.com/gideonstele/lamejs
- Original encoder: https://github.com/zhuker/lamejs
- LAME project: https://lame.sourceforge.io/

`provenance.json` records the npm SHA-512 integrity, exact source revision
`1fb0ef5fa177413107e2e107d054a9b994e3f79c`, source archive SHA-256, and module
SHA-256. The npm tarball was verified against its integrity before copying
`package/dist/lamejs.js` byte-for-byte. No remote code is loaded at runtime.

## Corresponding source and replacement

The complete exact upstream source tree is supplied in
`lamejs-corresponding-source.tar.gz` (159 archive members), including the
JavaScript encoder sources, build configuration, upstream license and lockfile.
The original short upstream license notice is `UPSTREAM-LICENSE`; the full
LGPLv3 and GPLv3 texts are `LGPL-3.0.txt` and `GPL-3.0.txt`.

To build the upstream source using its declared tools:

1. Extract `lamejs-corresponding-source.tar.gz` into a separate directory.
2. In that source directory use pnpm 8 with the supplied `pnpm-lock.yaml`:
   `pnpm install --frozen-lockfile`, then `pnpm build`.
3. Replace this directory's `lamejs.js` with the resulting `dist/lamejs.js`.
   It must export the compatible `Mp3Encoder` constructor with `encodeBuffer`
   and `flush`. The application imports it dynamically from this stable local
   path. No application-code change or external service is needed.

This is the upstream build recipe. The distributed module is the verified
published artifact, not a claim of a locally reproduced byte-identical build.
