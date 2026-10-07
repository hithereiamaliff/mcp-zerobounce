# ZeroBounce MCP Server

An MCP (Model Context Protocol) server for the [ZeroBounce](https://www.zerobounce.net/) email validation API. It lets Claude and other AI assistants validate email addresses, find business emails, score leads with AI, manage allow/block filters, run bulk jobs, and evaluate lists.

**21 tools** across validation, email finding, filters, bulk files and list evaluation. Run it hosted (multi-user, via [mcp-key-service](https://mcpkeys.techmavie.digital)) or locally over stdio.

**Hosted endpoint:** `https://mcp.techmavie.digital/zerobounce/mcp/usr_YOUR_KEY`

## Quick start

### Option 1: Hosted (recommended)

1. Sign in at **https://mcpkeys.techmavie.digital** and create a **ZeroBounce** connection with your ZeroBounce API key. Optionally set the region to `us` or `eu`.
2. Copy your personal key (`usr_...`).
3. Add the server to your MCP client:

   ```text
   https://mcp.techmavie.digital/zerobounce/mcp/usr_YOUR_KEY
   ```

   ```json
   {
     "mcpServers": {
       "zerobounce": {
         "type": "http",
         "url": "https://mcp.techmavie.digital/zerobounce/mcp/usr_YOUR_KEY"
       }
     }
   }
   ```

   `?api_key=usr_YOUR_KEY` on `/mcp` also works for clients that can't use the path form.

Your ZeroBounce key is stored encrypted in the key service and is never written to this server's disk or shared between users.

### Option 2: Local (stdio)

```json
{
  "mcpServers": {
    "zerobounce": {
      "command": "npx",
      "args": ["-y", "github:hithereiamaliff/mcp-zerobounce"],
      "env": {
        "ZEROBOUNCE_API_KEY": "your_zerobounce_api_key",
        "ZEROBOUNCE_REGION": ""
      }
    }
  }
}
```

In local mode the bulk tools can also read a CSV from your disk (`file_path`) and save results (`save_to_path`).

### Option 3: Self-hosted HTTP

Run your own instance (see [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md)) and authenticate with headers:

```bash
curl -X POST https://your-host/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: YOUR_MCP_API_KEY" \
  -H "X-ZeroBounce-Api-Key: YOUR_ZEROBOUNCE_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Authentication modes

| Mode | How | Notes |
|---|---|---|
| Hosted | `/mcp/usr_...` or `/mcp?api_key=usr_...` | Key resolved through mcp-key-service (cached 60s). |
| Hosted (header) | `/mcp` with `Authorization: Bearer usr_...` or `X-API-Key: usr_...` | Same as above, for clients that support custom headers. Keeps the key out of URLs. |
| Self-hosted | `X-API-Key: <MCP_API_KEY>` + `X-ZeroBounce-Api-Key` | Optional `X-ZeroBounce-Region`. Disabled unless `MCP_API_KEY` is set. Falls back to the server's `ZEROBOUNCE_API_KEY` if the header is absent. |
| Local CLI | `ZEROBOUNCE_API_KEY` env var | stdio transport. |

Raw ZeroBounce keys in the URL (`?apiKey=...`) and per-tool `apiKey` parameters from v1 are **no longer accepted**.

## Tools

Every tool description states its credit cost, and every tool carries MCP annotations: credit-spending tools are not marked read-only, and delete tools are marked destructive. Clients like Claude therefore ask before running them. Full parameter reference: **[TOOLS.md](TOOLS.md)**.

| Group | Tool | What it does | Cost |
|---|---|---|---|
| Utility | `zerobounce_hello` | Server status, connection mode, region | Free |
| Account | `zerobounce_get_credits` | Credit balance | Free |
| | `zerobounce_get_api_usage` | Usage by status/sub-status for a date range | Free |
| Validation | `zerobounce_validate_email` | Validate one address (verdict + details) | 1 credit (unknown free) |
| | `zerobounce_validate_batch` | Validate 1-100 addresses (de-duplicated) | 1 per email |
| | `zerobounce_get_activity_data` | When an address was last active | Free if not found (needs ZeroBounce ONE) |
| | `zerobounce_score_email` | AI quality score 0-10 | 1 credit |
| Email Finder | `zerobounce_find_email` | A person's email from name + domain/company | 20 per address found |
| | `zerobounce_domain_search` | A company's email format | 20 per format found |
| Filters | `zerobounce_list_filters` | List allow/block rules | Free |
| | `zerobounce_add_filter` | Add/update an allow or block rule | Free |
| | `zerobounce_delete_filter` | Delete a rule | Free |
| Bulk files | `zerobounce_bulk_validate` | Submit a list for validation | 1 per email |
| | `zerobounce_bulk_score` | Submit a list for AI scoring | 1 per email |
| | `zerobounce_bulk_find_emails` | Find emails for many contacts | 20 per address found |
| | `zerobounce_bulk_domain_search` | Find formats for many domains | 20 per format found |
| | `zerobounce_bulk_status` | Progress of a bulk file | Free |
| | `zerobounce_bulk_results` | Summary or paged rows of results | Free |
| | `zerobounce_bulk_delete` | Delete a bulk file | Free |
| List Evaluator | `zerobounce_evaluate_list` | Free risk estimate for a list (100+ emails) | Free |
| | `zerobounce_evaluate_list_status` | Evaluation results | Free |

### Verdicts

Validation results are summarised as:

| Verdict | ZeroBounce status | Meaning |
|---|---|---|
| **SAFE** | `valid` | OK to send |
| **RISKY** | `catch-all` | Domain accepts everything. `zerobounce_score_email` can help prioritise |
| **UNVERIFIED** | `unknown` | Couldn't verify right now. Not charged; retry later |
| **WILL BOUNCE** | `invalid` | Remove |
| **DO NOT SEND** | `do_not_mail`, `spamtrap`, `abuse` | Remove (the sub-status says why: disposable, role-based, toxic...) |

Pass `response_format: "json"` to any data tool for the raw ZeroBounce response.

### Testing without spending credits

ZeroBounce's sandbox addresses return fixed results and use no credits: `valid@example.com`, `invalid@example.com`, `catch_all@example.com`, `unknown@example.com`, `spamtrap@example.com`, `abuse@example.com`, `donotmail@example.com`, `disposable@example.com`, `toxic@example.com`, `role_based@example.com`, `possible_typo@example.com`.

### Bulk workflow

```text
zerobounce_bulk_validate (emails[] or csv_content)  →  file_id
zerobounce_bulk_status   (service, file_id)         →  Queued / Processing / Complete
zerobounce_bulk_results  (service, file_id)         →  summary, then view="rows" with filter/offset/limit
zerobounce_bulk_delete   (service, file_id)         →  optional clean-up
```

Results are never dumped in full: you get a summary (counts by status, score, found rate or format), then one page of rows at a time. The hosted server reads results files up to 20 MB (roughly 100k+ rows). Download bigger files from the ZeroBounce dashboard, or use the local CLI with `save_to_path`.

## API regions

| Region | Host | Processing |
|---|---|---|
| `default` (blank) | `api.zerobounce.net` | EU |
| `us` | `api-us.zerobounce.net` | United States only |
| `eu` | `api-eu.zerobounce.net` | European Union only |

Bulk file endpoints always use `bulkapi.zerobounce.net`. Regions are an allowlist: the server never sends a key to any other host.

## HTTP endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Server info |
| `/health` | GET | Health check |
| `/mcp/:userKey` | POST | MCP, hosted mode |
| `/mcp` | POST | MCP, `?api_key=usr_...` or self-hosted headers |
| `/.well-known/mcp/server-card.json` | GET | Discovery card listing all tools |
| `/analytics` | GET | Usage JSON (requires `X-API-Key`) |
| `/analytics/tools` | GET | Per-tool counts, errors, average latency (requires `X-API-Key`) |
| `/analytics/dashboard` | GET | Dashboard (asks for the API key) |
| `/mcp-debug/open` | POST | Diagnostics ping, only if `ENABLE_MCP_DIAGNOSTICS=true` |

The server is stateless: `GET`/`DELETE` on `/mcp` return 405.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `KEY_SERVICE_URL` | none | mcp-key-service resolve URL (hosted mode) |
| `KEY_SERVICE_TOKEN` | none | Bearer token; must match `zerobounce:<token>` in the key service |
| `MCP_API_KEY` | none | Enables self-hosted mode and analytics |
| `ZEROBOUNCE_API_KEY` | none | CLI key / self-hosted fallback |
| `ZEROBOUNCE_REGION` | `default` | `default`, `us` or `eu` (CLI / self-hosted) |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | HTTP listen address |
| `PUBLIC_BASE_PATH` | none | Path prefix added by nginx (e.g. `/zerobounce`) |
| `ANALYTICS_DIR` | `/app/data` | Where `analytics.json` is stored |
| `ALLOWED_ORIGINS` | `*` | CORS allowlist (comma-separated) |
| `MCP_BODY_LIMIT` | `10mb` | Max request size (inline bulk uploads) |
| `ZEROBOUNCE_MAX_RESULT_MB` | `20` | Largest bulk results file the HTTP server downloads and parses (CLI: 100) |
| `MCP_TRACE_HTTP` | `false` | Log one line per MCP request (no secrets) |
| `ENABLE_MCP_DIAGNOSTICS` | `false` | Enable `/mcp-debug/open` |

See [.env.sample](.env.sample) for a commented template.

## Local development

```bash
npm install
npm run build         # compile to dist/
npm test              # unit + HTTP integration tests (no network)
npm run dev:http      # HTTP server with tsx on :8080
npm run cli           # stdio server
npm run docs:tools    # regenerate TOOLS.md from the tool definitions

# Live check against ZeroBounce using sandbox addresses only (0 credits):
ZEROBOUNCE_API_KEY=... npm run smoke
```

## Project structure

```text
src/
├── index.ts              Server factory (shared by CLI and HTTP), tool registration
├── cli.ts                stdio entry point (npx)
├── http-server.ts        Streamable HTTP server: auth modes, routes, analytics
├── version.ts
├── zerobounce/
│   ├── client.ts         ZeroBounce API client (fetch, regions, retries)
│   ├── errors.ts         Normalises ZeroBounce's error formats
│   ├── regions.ts        Region → host allowlist
│   ├── statuses.ts       Status/sub-status meanings and verdicts
│   └── types.ts
├── tools/                One file per group: account, validation, finder, filters, bulk, list-evaluator, utility
└── utils/                key-service client, analytics, CSV, formatting, security helpers
tests/                    node:test suites (mocked API, in-memory MCP client, real HTTP server)
scripts/                  smoke-test.mjs (live, 0 credits), generate-tools-md.ts
deploy/                   DEPLOYMENT.md, nginx-mcp.conf
```

## Security notes

- **Per-request isolation:** every HTTP request gets a new MCP server instance holding only that caller's key. Keys are never written to `process.env` or disk.
- **No server file access over HTTP:** bulk uploads take lists or CSV text. `file_path`/`save_to_path` exist only in local CLI mode.
- **Keys out of URLs:** real-time ZeroBounce calls send the API key in a POST body. Raw keys are refused in this server's URLs, and logs/analytics mask `usr_` keys.
- **Fail closed:** self-hosted mode and analytics are disabled unless `MCP_API_KEY` is set. Key comparisons are constant-time.
- **Privacy-preserving analytics:** client IPs are stored only as truncated hashes.

## Compared with ZeroBounce's official MCP

ZeroBounce publishes its own stdio MCP server ([`@zerobounce/mcp`](https://github.com/zerobounce/zerobounce-mcp)). This server adds:

- hosted multi-user access, which works in Claude.ai web and mobile
- allow/block filters
- the List Evaluator
- single-email AI scoring
- bulk email finder and domain search
- regional endpoints
- summarised and paginated bulk results

## License

[MIT](LICENSE)
