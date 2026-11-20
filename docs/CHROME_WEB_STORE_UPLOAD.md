# Chrome Web Store Upload Automation for Notable Reader

## Overview

This document describes how to automate uploading the Notable Reader extension (v2.x) to the Chrome Web Store using the Chrome Web Store Publish API.

## Current State (as of 2026-11-16)

- **Extension ID**: `hgkfghgifkifgmklfgglilnmjglojonm`
- **Developer Account**: `burakbascidev@gmail.com`
- **Publisher ID**: `12058d5f-4f0c-4794-9f25-6401a962b0e1`
- **Publisher Name**: `benotable – Burak Basci`
- **Current Public Version**: 2.2.1 (under review: 2.3.3)
- **Review Access**: Kept in the maintainer's private password manager (not in this repository)

## Manual Process (Current)

Currently, uploads are done manually via the Chrome Web Store Developer Dashboard:
1. Go to https://chromewebstore.google.com/u/0/developer/dashboard
2. Select the Notable Reader item
3. Click "Upload new package"
4. Select the ZIP file from `releases/vX.Y.Z/notable-reader-extension-X.Y.Z.zip`
5. Fill in release notes, update screenshots if needed
6. Save and submit for review

## Automated Process (New)

### Prerequisites

1. **Google Cloud Console Project** with Chrome Web Store API enabled
2. **OAuth 2.0 Client ID** (Web application type)
3. **Authorized Redirect URI**: `http://localhost:8080/callback`

### Setup (One-time)

```bash
# 1. Get OAuth credentials from Google Cloud Console
# 2. Run the OAuth flow to get a refresh token
python3 tools/get-cws-refresh-token.py --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET

# This creates .env.cws with:
# CWS_CLIENT_ID=...
# CWS_CLIENT_SECRET=...
# CWS_REFRESH_TOKEN=...
# CWS_EXTENSION_ID=hgkfghgifkifgmklfgglilnmjglojonm
```

### Usage

```bash
# Build the release first (creates ZIP in releases/vX.Y.Z/)
python3 tools/release.py --output-dir releases/v2.4.0

# Test upload (dry run)
python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip --dry-run

# Upload as draft (not published)
python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip

# Upload and publish to public
python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip --publish

# Upload and publish to trusted testers only
python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip --publish --target trustedTesters

# Check current extension status
python3 tools/upload-cws.py --status-only
```

### Integration with Release Workflow

```bash
# Full automated release + upload + publish
VERSION=2.4.0
python3 tools/release.py --output-dir releases/v$VERSION
python3 tools/upload-cws.py --zip-path releases/v$VERSION/notable-reader-extension-$VERSION.zip --publish
```

## Files Created

| File | Purpose |
|------|---------|
| `tools/upload-cws.py` | Main upload script using CWS Publish API |
| `tools/get-cws-refresh-token.py` | One-time OAuth flow to get refresh token |
| `docs/CHROME_WEB_STORE_UPLOAD.md` | This documentation |
| `.env.cws` | Credentials file (gitignored, permissions 600) |

## Security Notes

- `.env.cws` contains sensitive credentials - **never commit to git**
- Added to `.gitignore` automatically by the setup script
- File permissions set to 600 (owner read/write only)
- Refresh token is long-lived but can be revoked from Google Account settings
- Access tokens are short-lived (1 hour) and obtained automatically

## Troubleshooting

### "Invalid grant" error
The refresh token may have expired or been revoked. Re-run `get-cws-refresh-token.py`.

### "Insufficient permissions"
Ensure the OAuth client has the `https://www.googleapis.com/auth/chromewebstore` scope and the Chrome Web Store API is enabled in the Cloud Console project.

### "Extension not found"
Verify the extension ID in `.env.cws` matches `hgkfghgifkifgmklfgglilnmjglojonm`.

### Upload succeeds but changes not visible
The Chrome Web Store dashboard may need a manual refresh. The API upload creates a draft; publishing makes it live.

## References

- [Chrome Web Store Publish API Documentation](https://developer.chrome.com/docs/webstore/publish-api)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies)