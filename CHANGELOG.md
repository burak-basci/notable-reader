# Changelog

## 2.5.0 (2026-11-16)

- **Full i18n support** (6 locales: de, en, es, fr, it, pt) with `default_locale: "en"` and `__MSG_*` placeholders in manifest
- **Side Panel** integration (`side_panel.default_path: "sidebar.html"`) for persistent reader UI
- **Commands API** with keyboard shortcuts: Alt+Shift+V (open), Alt+Shift+K (play/pause), Alt+Shift+Left/Right (prev/next section)
- **Offscreen Documents** + **Unlimited Storage** permissions for background audio processing
- **Cross-Origin Isolation** (COEP/COOP) for secure neural model execution
- **File:// protocol support** for local PDF/HTML reading
- **Compatible key architecture** (official + compatible ZIPs from single source)
- Optional "Message to the developer" form in popup, settings and web app (six UI languages): mandatory public-issue confirmation, 2000 characters, at most 3 messages per rolling 10 minutes enforced by `server/feedback-service.mjs`, which creates the GitHub issue server-side. Only text and app version are sent.

## 2.4.0

- One canonical source release for the original paper/green extension controls,
  browser document reader and optional native companion; stable local/native
  upgrade ID and official extension ID from the same implementation.
- Official and compatible ZIPs differ only by the public manifest identity key.
- Allowlisted native source with AGPL disclosures and explicit Linux bootstrap;
  no bundled models, environments, private configuration or entitlement secrets.
- Immutable staged release directories, deterministic ZIP metadata, complete file
  hashes, source/Git binding and generated native product/protocol build metadata.
- Browser web/PWA build remains independent of the optional native daemon.

## 2.3.3

Visible donation links and consistent lifetime terms. Existing published ZIPs
and tags remain immutable; the store review has its own independently read state.

## 2.3.2

Cancelled or superseded PDF figure paints no longer leave a persistent error;
real current rendering errors remain visible and successful retries recover.
