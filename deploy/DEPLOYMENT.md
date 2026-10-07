# ZeroBounce MCP: VPS deployment guide

Deploys the server behind nginx with Docker, mounted at:

```text
https://mcp.techmavie.digital/zerobounce
```

| Item | Value |
|---|---|
| Directory on VPS | `/opt/mcp-servers/zerobounce` |
| Container | `mcp-zerobounce` |
| Host port | `127.0.0.1:8095` (8087 is used by the Task List MCP) |
| Docker network | `mcp-network` (external, shared with `mcp-key-service`) |
| Key-service server ID | `zerobounce` |

## Auth modes

| Mode | Endpoint | Client sends |
|---|---|---|
| Hosted (recommended) | `POST /zerobounce/mcp/usr_...` | Personal key from mcpkeys.techmavie.digital in the path |
| Hosted (compatibility) | `POST /zerobounce/mcp?api_key=usr_...` | Personal key in the query string |
| Hosted (header) | `POST /zerobounce/mcp` | `Authorization: Bearer usr_...` or `X-API-Key: usr_...` |
| Self-hosted | `POST /zerobounce/mcp` | `X-API-Key: <MCP_API_KEY>` + `X-ZeroBounce-Api-Key` (optional `X-ZeroBounce-Region`) |
| Diagnostics | `POST /zerobounce/mcp-debug/open` | Nothing (only when `ENABLE_MCP_DIAGNOSTICS=true`) |

Raw ZeroBounce keys in the URL (`?apiKey=...`, v1 style) are refused with a 400, because URLs end up in proxy logs.

## One-time setup

Do these in order. Steps 1–2 register the server with mcp-key-service; without both halves the key service answers 401/403.

### 1. Create the key-service token

```bash
ssh <user>@<vps>
openssl rand -hex 32        # copy the output: this is ZB_TOKEN below
```

Append it to `INTERNAL_SERVER_TOKENS` in `/opt/mcp-key-service/.env` (comma-separated, keep the existing entries):

```env
INTERNAL_SERVER_TOKENS=...existing entries...,zerobounce:<ZB_TOKEN>
```

### 2. Deploy mcp-key-service with the `zerobounce` connector

Merge the mcp-key-service PR that adds the `zerobounce` connector. Its workflow redeploys the key service, which also picks up the new token from `.env`. (Or run `cd /opt/mcp-key-service && docker compose up -d --build` by hand.)

### 3. Create this server's `.env`

```bash
sudo mkdir -p /opt/mcp-servers/zerobounce
cd /opt/mcp-servers/zerobounce
git clone https://github.com/hithereiamaliff/mcp-zerobounce.git .
cp .env.sample .env
nano .env
```

```env
KEY_SERVICE_URL=http://mcp-key-service:8090/internal/resolve
KEY_SERVICE_TOKEN=<ZB_TOKEN>               # same value as in step 1
MCP_API_KEY=<openssl rand -hex 32>         # protects /analytics and self-hosted mode
```

Leave `ZEROBOUNCE_API_KEY` empty on the hosted server. Every user brings their own key through the key service.

### 4. Check the port is free and start the container

```bash
ss -tlnp | grep ':8095' || echo "8095 is free"
docker network inspect mcp-network >/dev/null 2>&1 || docker network create mcp-network
docker compose up -d --build
docker compose logs -f
```

### 5. Add the nginx location block

Copy [nginx-mcp.conf](./nginx-mcp.conf) into the `server { }` block for `mcp.techmavie.digital`:

```bash
sudo nano /etc/nginx/sites-available/mcp.techmavie.digital
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Enable auto-deploy

The workflow in `.github/workflows/deploy-vps.yml` deploys on every push to `main`. Add these repository secrets (same values as your other MCP repos):

| Secret | Value |
|---|---|
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USERNAME` | SSH user |
| `VPS_SSH_KEY` | Private SSH key |
| `VPS_PORT` | SSH port (optional, defaults to 22) |

## Verification sequence

```bash
BASE=https://mcp.techmavie.digital/zerobounce
```

1. Health:

   ```bash
   curl $BASE/health
   ```

2. Server card (lists all 21 tools):

   ```bash
   curl $BASE/.well-known/mcp/server-card.json
   ```

3. Missing auth should return 401 with instructions:

   ```bash
   curl -s -X POST $BASE/mcp -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

4. Hosted mode, after creating a ZeroBounce connection at https://mcpkeys.techmavie.digital:

   ```bash
   curl -s -X POST $BASE/mcp/usr_YOUR_KEY \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"zerobounce_get_credits","arguments":{}}}'
   ```

5. A sandbox validation (uses no credits):

   ```bash
   curl -s -X POST $BASE/mcp/usr_YOUR_KEY \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"zerobounce_validate_email","arguments":{"email":"valid@example.com"}}}'
   ```

6. Self-hosted headers:

   ```bash
   curl -s -X POST $BASE/mcp \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -H "X-API-Key: YOUR_MCP_API_KEY" -H "X-ZeroBounce-Api-Key: YOUR_ZEROBOUNCE_KEY" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

7. Analytics: the first call should return 401, the second should return 200:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" $BASE/analytics
   curl -s $BASE/analytics -H "X-API-Key: YOUR_MCP_API_KEY" | head -c 400
   ```

   Dashboard: https://mcp.techmavie.digital/zerobounce/analytics/dashboard

## Client configuration

Claude.ai / Claude Desktop (custom connector), Cursor, Windsurf and others:

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

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 missing_auth` | No usr_ key in the URL and no self-hosted headers. |
| `403 invalid_key` | The usr_ key is wrong, revoked, or suspended (for example, an expired subscription). Check the portal. |
| `503 service_unavailable` | The key service is unreachable **or rejected this server's token**. Check that `KEY_SERVICE_TOKEN` equals the `zerobounce:` entry in the key service's `INTERNAL_SERVER_TOKENS`, and that both containers are on `mcp-network` (`docker network inspect mcp-network`). |
| `400 invalid_region` | The region saved in the portal isn't `us`, `eu` or blank. Recreate the connection with a valid region. |
| Tool returns "ZeroBounce rejected the API key" | The ZeroBounce key is wrong or out of credits. |
| Tool returns "ZeroBounce refused the request (HTTP 403, API firewall)" | The ZeroBounce key has an IP allowlist that doesn't include the VPS IP, or too many bad requests were sent recently. |
| Container exits immediately | Read `docker compose logs`. A common cause is only one of `KEY_SERVICE_URL` / `KEY_SERVICE_TOKEN` being set. |
| Empty `initialize` responses in a client | Set `MCP_TRACE_HTTP=true`, restart, and check the logs. Enable `ENABLE_MCP_DIAGNOSTICS=true` to test transport with `/mcp-debug/open`. |

## Useful commands

```bash
cd /opt/mcp-servers/zerobounce
docker compose ps
docker compose logs -f --tail=100
docker compose restart
docker compose up -d --build          # rebuild after manual changes
docker volume inspect zerobounce_analytics-data
```
