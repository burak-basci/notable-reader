# Feedback service

`feedback-service.mjs` is a dependency-free Node service (>= 20) behind
`POST /v1/feedback`. It validates a message, enforces the rate limit and creates **one
public GitHub issue** in `burak-basci/notable-reader` through the GitHub REST API.
Nothing starts on import; `node server/feedback-service.mjs` starts it.

## Contract

Request: `Content-Type: application/json`, at most 8 KiB,
`{"message": "<5-2000 characters>", "consent": true, "version": "2.4.0"}`.
`consent` must be the boolean `true`; `version` is optional (`x.y.z`); any other field is
rejected (400, no URL/title/document data). Answers: `201 {ok,issue,url}`, `400`
(`consent_required`, `message_too_short`, `message_too_long`, `invalid_*`), `403`
(origin), `413`, `415`, `429 {retryAfterSeconds,limit,windowSeconds}` with `Retry-After`,
`502/503 feedback_unavailable` (GitHub or token problem; never GitHub's own text).

## Limits (server side, not bypassable by the client)

- 3 issues per rolling 10 minutes per client. The client is the socket address or, behind
  our own proxy, the entry that proxy appended to `X-Forwarded-For`
  (`READER_FEEDBACK_PROXY_HOPS=1`); client-supplied headers cannot change it. IPv6 is
  bucketed by /64. Slots are reserved before the GitHub call, failed GitHub calls free them.
- 40 issues per hour for the whole service, 30 requests per 10 minutes per client of any kind.
- Optional `READER_FEEDBACK_STATE=<file>` keeps the counters over restarts (0600, only
  HMAC hashes of clients with a random salt and timestamps).

## Configuration (environment)

| Variable | Meaning |
| --- | --- |
| `READER_FEEDBACK_GITHUB_TOKEN` or `..._TOKEN_FILE` | fine-grained token, only this repo, permission "Issues: write". Start aborts without it. |
| `READER_FEEDBACK_PORT` / `READER_FEEDBACK_HOST` | default `43190` / `127.0.0.1` |
| `READER_FEEDBACK_PROXY_HOPS` | number of trusted proxies in front (0 = none) |
| `READER_FEEDBACK_ORIGINS` | extra allowed CORS origins (website and official extension ID are built in) |
| `READER_FEEDBACK_STATE` | state file for the rate counters |

Recommended: `READER_FEEDBACK_GITHUB_TOKEN_FILE=/path/to/notable-reader-feedback-token` (file mode 0600, content = token only, never in the repo). On the workstation the prepared file location is `~/.claude/secrets/notable-reader-feedback-token`.

The token is never logged or returned. Logs contain only event names, status codes and
issue numbers.

## Tests

`node tests/feedback-service.mjs` (GitHub mocked, simulated clock, no network) and
`node tests/feedback-ui.cjs` (real extension popup/options/web page in headless Chromium,
mocked endpoint).
