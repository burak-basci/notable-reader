# Changelog

## 2.5.0 (2026-11-16)

- Optional "Message to the developer" form in popup, settings and web app (six UI
  languages): mandatory public-issue confirmation, 2000 characters, at most 3 messages
  per rolling 10 minutes enforced by `server/feedback-service.mjs`, which creates the
  GitHub issue server-side. Only text and app version are sent.

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
