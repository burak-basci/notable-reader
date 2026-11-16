#!/usr/bin/env python3
"""
Chrome Web Store Upload Automation for Notable Reader.

Uses the Chrome Web Store Publish API to upload and publish extension updates.
Requires OAuth 2.0 credentials (client_id, client_secret, refresh_token) stored securely.

Usage:
    python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip
    python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip --publish

Environment variables (or .env file):
    CWS_CLIENT_ID       - OAuth client ID from Google Cloud Console
    CWS_CLIENT_SECRET   - OAuth client secret from Google Cloud Console
    CWS_REFRESH_TOKEN   - Long-lived refresh token from OAuth flow
    CWS_EXTENSION_ID    - Extension ID (default: hgkfghgifkifgmklfgglilnmjglojonm)
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional


# Default extension ID for Notable Reader public extension
DEFAULT_EXTENSION_ID = "hgkfghgifkifgmklfgglilnmjglojonm"

# OAuth 2.0 endpoints
TOKEN_URL = "https://oauth2.googleapis.com/token"
CWS_UPLOAD_URL = "https://www.googleapis.com/upload/chromewebstore/v1.1/items"
CWS_PUBLISH_URL = "https://www.googleapis.com/chromewebstore/v1.1/items/{item_id}/publish"
CWS_STATUS_URL = "https://www.googleapis.com/chromewebstore/v1.1/items/{item_id}"


def load_env_file(env_path: Path) -> dict:
    """Load environment variables from .env file."""
    env = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
    return env


def get_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    """Exchange refresh token for access token."""
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    req = urllib.request.Request(
        TOKEN_URL,
        data=urllib.parse.urlencode(data).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode())
    return result["access_token"]


def upload_extension(
    access_token: str,
    extension_id: str,
    zip_path: Path,
) -> dict:
    """Upload extension ZIP to Chrome Web Store."""
    url = f"{CWS_UPLOAD_URL}/{extension_id}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-goog-api-version": "2",
    }

    # Read ZIP file
    zip_data = zip_path.read_bytes()

    req = urllib.request.Request(url, data=zip_data, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
        return result
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        raise RuntimeError(f"Upload failed ({e.code}): {error_body}")


def publish_extension(
    access_token: str,
    extension_id: str,
    target: str = "default",
) -> dict:
    """Publish uploaded extension to Chrome Web Store."""
    url = CWS_PUBLISH_URL.format(item_id=extension_id)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "x-goog-api-version": "2",
    }
    data = json.dumps({"target": target}).encode()

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
        return result
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        raise RuntimeError(f"Publish failed ({e.code}): {error_body}")


def get_extension_status(access_token: str, extension_id: str) -> dict:
    """Get current extension status from Chrome Web Store."""
    url = CWS_STATUS_URL.format(item_id=extension_id)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-goog-api-version": "2",
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode())
        return result
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        raise RuntimeError(f"Status check failed ({e.code}): {error_body}")


def main():
    parser = argparse.ArgumentParser(
        description="Upload Notable Reader extension to Chrome Web Store",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload only (draft)
  python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip

  # Upload and publish to default (public) track
  python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip --publish

  # Upload and publish to trusted testers track
  python3 tools/upload-cws.py --zip-path releases/v2.4.0/notable-reader-extension-2.4.0.zip --publish --target trustedTesters

  # Check current status
  python3 tools/upload-cws.py --status-only
        """,
    )
    parser.add_argument(
        "--zip-path",
        type=Path,
        help="Path to extension ZIP file (e.g., releases/v2.4.0/notable-reader-extension-2.4.0.zip)",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish after upload (default: upload as draft only)",
    )
    parser.add_argument(
        "--target",
        choices=["default", "trustedTesters"],
        default="default",
        help="Publish target (default: default/public)",
    )
    parser.add_argument(
        "--extension-id",
        default=DEFAULT_EXTENSION_ID,
        help=f"Chrome Web Store extension ID (default: {DEFAULT_EXTENSION_ID})",
    )
    parser.add_argument(
        "--status-only",
        action="store_true",
        help="Only check current extension status, don't upload",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=Path(".env.cws"),
        help="Path to .env file with CWS credentials (default: .env.cws in project root)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making API calls",
    )

    args = parser.parse_args()

    # Load credentials
    project_root = Path(__file__).resolve().parents[1]
    env_file = args.env_file if args.env_file.is_absolute() else project_root / args.env_file
    env = load_env_file(env_file)

    # Override with environment variables
    for key in ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN", "CWS_EXTENSION_ID"]:
        if key in os.environ:
            env[key] = os.environ[key]

    client_id = env.get("CWS_CLIENT_ID")
    client_secret = env.get("CWS_CLIENT_SECRET")
    refresh_token = env.get("CWS_REFRESH_TOKEN")
    extension_id = env.get("CWS_EXTENSION_ID", args.extension_id)

    if not all([client_id, client_secret, refresh_token]):
        print("ERROR: Missing Chrome Web Store credentials.", file=sys.stderr)
        print(f"Create {env_file} with:", file=sys.stderr)
        print("  CWS_CLIENT_ID=your-client-id", file=sys.stderr)
        print("  CWS_CLIENT_SECRET=your-client-secret", file=sys.stderr)
        print("  CWS_REFRESH_TOKEN=your-refresh-token", file=sys.stderr)
        print("  CWS_EXTENSION_ID=hgkfghgifkifgmklfgglilnmjglojonm  # optional", file=sys.stderr)
        print("\nGet credentials from:", file=sys.stderr)
        print("  1. Google Cloud Console -> APIs & Services -> Credentials", file=sys.stderr)
        print("  2. Create OAuth 2.0 Client ID (Web application)", file=sys.stderr)
        print("  3. Run OAuth flow to get refresh token:", file=sys.stderr)
        print("     python3 tools/get-cws-refresh-token.py", file=sys.stderr)
        return 1

    if args.status_only:
        if args.dry_run:
            print(f"DRY RUN: Would check status of extension {extension_id}")
            return 0
        print(f"Checking status of extension {extension_id}...")
        access_token = get_access_token(client_id, client_secret, refresh_token)
        status = get_extension_status(access_token, extension_id)
        print(json.dumps(status, indent=2))
        return 0

    if not args.zip_path:
        print("ERROR: --zip-path is required for upload", file=sys.stderr)
        return 1

    zip_path = args.zip_path
    if not zip_path.is_absolute():
        zip_path = project_root / zip_path

    if not zip_path.exists():
        print(f"ERROR: ZIP file not found: {zip_path}", file=sys.stderr)
        return 1

    print(f"Extension ID: {extension_id}")
    print(f"ZIP file: {zip_path} ({zip_path.stat().st_size:,} bytes)")

    if args.dry_run:
        print("DRY RUN: Would upload and" + (" publish" if args.publish else " keep as draft"))
        return 0

    # Get access token
    print("Obtaining access token...")
    access_token = get_access_token(client_id, client_secret, refresh_token)

    # Upload extension
    print("Uploading extension...")
    upload_result = upload_extension(access_token, extension_id, zip_path)
    print(f"Upload successful: {json.dumps(upload_result, indent=2)}")

    # Publish if requested
    if args.publish:
        print(f"Publishing to {args.target}...")
        publish_result = publish_extension(access_token, extension_id, args.target)
        print(f"Publish successful: {json.dumps(publish_result, indent=2)}")
    else:
        print("Uploaded as draft. Use --publish to publish.")

    return 0


if __name__ == "__main__":
    import urllib.parse
    sys.exit(main())