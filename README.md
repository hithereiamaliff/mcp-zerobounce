# ZeroBounce MCP Server

[![smithery badge](https://smithery.ai/badge/zerobounce-mcp)](https://smithery.ai/server/zerobounce-mcp)

A Model Context Protocol (MCP) server for accessing ZeroBounce API endpoints, providing tools for email validation, email finding, AI scoring, activity data, and bulk list evaluation.

**MCP Endpoint:** `https://mcp.techmavie.digital/zerobounce/mcp`

**Analytics Dashboard:** [`https://mcp.techmavie.digital/zerobounce/analytics/dashboard`](https://mcp.techmavie.digital/zerobounce/analytics/dashboard)

## Features

- **Real-Time Email Validation** — Instantly verify email addresses to reduce bounce rates
- **Email Finder** — Discover email formats for specific domains or company names
- **AI-Powered Scoring** — Submit files for AI quality scoring of email lists
- **Activity Data** — Gain insights into the engagement activity of an email address
- **Bulk List Evaluation** — Process and evaluate entire email lists for quality and deliverability
- **Credits & Usage** — Check remaining API credits and usage statistics
- **Multi-Transport Support** — Both stdio (for MCP clients) and Streamable HTTP (for VPS hosting)
- **Analytics Dashboard** — Built-in visual dashboard with Chart.js for usage monitoring
- **VPS Deployment Ready** — Docker, Nginx, and GitHub Actions auto-deployment support

## Architecture

```
AI Assistant (Claude, Cursor, Windsurf, etc.)
    ↓ HTTPS
https://mcp.techmavie.digital/zerobounce/mcp
    ↓
Nginx (SSL termination + reverse proxy)
    ↓ HTTP
Docker Container (port 8087 → 8080)
    ↓
MCP Server (Streamable HTTP Transport)
    ↓
ZeroBounce API (api.zerobounce.net)
```

## Quick Start (Hosted Server)

The easiest way to use this MCP server is via the hosted endpoint. **No installation required!**

### Client Configuration

For Claude Desktop / Cursor / Windsurf, add to your MCP configuration:

```json
{
  "mcpServers": {
    "zerobounce": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/zerobounce/mcp?apiKey=YOUR_ZEROBOUNCE_API_KEY"
    }
  }
}
```

### Using with npx (stdio transport)

```json
{
  "mcpServers": {
    "zerobounce": {
      "command": "npx",
      "args": ["-y", "mcp-zerobounce"],
      "env": {
        "ZEROBOUNCE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Configuration

### API Key

A ZeroBounce API key is required. Get one at [zerobounce.net](https://www.zerobounce.net/).

The API key can be provided in multiple ways (in order of priority):

1. **Per-tool parameter** — Pass `apiKey` in each tool call
2. **URL query parameter** — `?apiKey=YOUR_KEY` (hosted server)
3. **HTTP header** — `X-API-Key: YOUR_KEY` (hosted server)
4. **Environment variable** — `ZEROBOUNCE_API_KEY`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ZEROBOUNCE_API_KEY` | — | ZeroBounce API key |
| `PORT` | `8080` | HTTP server port |
| `HOST` | `0.0.0.0` | HTTP server host |
| `ANALYTICS_DIR` | `/app/data` | Analytics data directory |
| `ANALYTICS_IMPORT_KEY` | — | Secret key for analytics import endpoint |

## Available Tools

| Tool | Description |
|------|-------------|
| `hello` | Test tool to verify server connectivity |
| `validate_email` | Validate a single email address |
| `find_email` | Find email format for a domain or company |
| `scoring_send_file` | Submit a file for AI scoring |
| `scoring_file_status` | Check status of a submitted scoring file |
| `scoring_get_file` | Get results of a scored file |
| `scoring_delete_file` | Delete a scored file |
| `get_activity_data` | Get activity data for an email address |
| `list_evaluator` | Submit a file for list evaluation |
| `get_credits` | Check remaining API credits |
| `get_api_usage` | Get API usage statistics for a date range |

For detailed schemas and descriptions, see [TOOLS.md](./TOOLS.md).

## AI Integration

When integrating with AI models:

1. **Start with validation** — Use `validate_email` before performing other actions
2. **Check credits** — Use `get_credits` to verify available balance
3. **Bulk operations workflow** — Submit file → check status → retrieve results
4. **Activity insights** — Use `get_activity_data` for engagement context on valid emails

## Installation

```bash
npm install
```

## Local Development

```bash
# Run HTTP server in development mode
npm run dev:http

# Or build and run production version
npm run build
npm run start:http

# Test health endpoint
curl http://localhost:8080/health

# Test MCP endpoint
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Self-Hosted VPS Deployment

### Quick Deploy

```bash
# On your VPS
cd /opt/mcp-servers
git clone https://github.com/hithereiamaliff/mcp-zerobounce.git zerobounce
cd zerobounce

# Create .env file
echo "ZEROBOUNCE_API_KEY=your_key_here" > .env

# Build and start
docker compose up -d --build

# Check logs
docker compose logs -f
```

### Deployment Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Container configuration (Node.js 20-alpine) |
| `docker-compose.yml` | Docker orchestration with analytics volume |
| `deploy/nginx-mcp.conf` | Nginx reverse proxy configuration |
| `.github/workflows/deploy-vps.yml` | GitHub Actions auto-deployment |

### GitHub Actions Secrets

Set these in your repository settings:

| Secret | Description |
|--------|-------------|
| `VPS_HOST` | VPS IP address |
| `VPS_USERNAME` | SSH username |
| `VPS_SSH_KEY` | Private SSH key |
| `VPS_PORT` | SSH port (usually `22`) |
| `ZEROBOUNCE_API_KEY` | ZeroBounce API key |

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info |
| `/health` | GET | Health check |
| `/mcp` | POST | MCP requests (JSON-RPC) |
| `/analytics` | GET | Analytics JSON data |
| `/analytics/dashboard` | GET | Visual analytics dashboard |
| `/analytics/tools` | GET | Tool usage statistics |

## Analytics Dashboard

The server includes a built-in analytics dashboard that tracks:

- Total requests and tool calls
- Tool usage distribution (doughnut chart)
- Hourly request trends (last 24 hours)
- Requests by endpoint (bar chart)
- Top clients by user agent
- Recent tool calls feed

Auto-refreshes every 30 seconds.

## Project Structure

```
src/
├── index.ts          # Main MCP server (stdio transport)
├── http-server.ts    # Streamable HTTP server for VPS deployment
└── tools.ts          # ZeroBounce tool registrations (shared)

deploy/
└── nginx-mcp.conf    # Nginx reverse proxy config

.github/
└── workflows/
    └── deploy-vps.yml  # GitHub Actions auto-deploy
```

## Troubleshooting

### Container Issues

```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f

# Restart container
docker compose restart

# Rebuild and restart
docker compose up -d --build
```

### Test MCP Connection

```bash
# List tools
curl -X POST https://mcp.techmavie.digital/zerobounce/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call hello tool
curl -X POST "https://mcp.techmavie.digital/zerobounce/mcp?apiKey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hello","arguments":{}}}'
```

## Contributing

1. Fork repository
2. Create feature branch
3. Commit changes
4. Create pull request

## License

[MIT](./LICENSE)
