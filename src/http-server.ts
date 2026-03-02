#!/usr/bin/env node

/**
 * ZeroBounce MCP Server - HTTP Server Entry Point
 * For self-hosting on VPS with nginx reverse proxy
 * Uses Streamable HTTP transport
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerZeroBounceTools } from './tools.js';

// Configuration
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ANALYTICS_DATA_DIR = process.env.ANALYTICS_DIR || '/app/data';
const ANALYTICS_FILE = path.join(ANALYTICS_DATA_DIR, 'analytics.json');
const SAVE_INTERVAL_MS = 60000; // Save every 60 seconds
const MAX_RECENT_CALLS = 100;

// ============================================================================
// Analytics Tracking with File Persistence
// ============================================================================
interface Analytics {
  serverStartTime: string;
  totalRequests: number;
  totalToolCalls: number;
  requestsByMethod: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  toolCalls: Record<string, number>;
  recentToolCalls: Array<{
    tool: string;
    timestamp: string;
    clientIp: string;
    userAgent: string;
  }>;
  clientsByIp: Record<string, number>;
  clientsByUserAgent: Record<string, number>;
  hourlyRequests: Record<string, number>;
}

// Initialize analytics
let analytics: Analytics = {
  serverStartTime: new Date().toISOString(),
  totalRequests: 0,
  totalToolCalls: 0,
  requestsByMethod: {},
  requestsByEndpoint: {},
  toolCalls: {},
  recentToolCalls: [],
  clientsByIp: {},
  clientsByUserAgent: {},
  hourlyRequests: {},
};

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(ANALYTICS_DATA_DIR)) {
    fs.mkdirSync(ANALYTICS_DATA_DIR, { recursive: true });
    console.log(`📁 Created analytics data directory: ${ANALYTICS_DATA_DIR}`);
  }
}

// Load analytics from disk on startup
function loadAnalytics(): void {
  try {
    ensureDataDir();
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = fs.readFileSync(ANALYTICS_FILE, 'utf-8');
      const loaded = JSON.parse(data) as Analytics;
      analytics = {
        ...loaded,
        serverStartTime: loaded.serverStartTime || new Date().toISOString(),
        requestsByMethod: loaded.requestsByMethod || {},
        requestsByEndpoint: loaded.requestsByEndpoint || {},
        toolCalls: loaded.toolCalls || {},
        recentToolCalls: loaded.recentToolCalls || [],
        clientsByIp: loaded.clientsByIp || {},
        clientsByUserAgent: loaded.clientsByUserAgent || {},
        hourlyRequests: loaded.hourlyRequests || {},
      };
      console.log(`📊 Loaded analytics from ${ANALYTICS_FILE}`);
      console.log(`   Total requests: ${analytics.totalRequests}`);
    } else {
      console.log(`📊 No existing analytics file, starting fresh`);
    }
  } catch (error) {
    console.error(`⚠️ Failed to load analytics:`, error);
  }
}

// Save analytics to disk
function saveAnalytics(): void {
  try {
    ensureDataDir();
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
    console.log(`💾 Saved analytics to ${ANALYTICS_FILE}`);
  } catch (error) {
    console.error(`⚠️ Failed to save analytics:`, error);
  }
}

// Track HTTP request
function trackRequest(req: Request, endpoint: string): void {
  analytics.totalRequests++;

  const method = req.method;
  analytics.requestsByMethod[method] = (analytics.requestsByMethod[method] || 0) + 1;

  analytics.requestsByEndpoint[endpoint] = (analytics.requestsByEndpoint[endpoint] || 0) + 1;

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  analytics.clientsByIp[clientIp] = (analytics.clientsByIp[clientIp] || 0) + 1;

  const userAgent = req.headers['user-agent'] || 'unknown';
  const shortAgent = userAgent.substring(0, 50);
  analytics.clientsByUserAgent[shortAgent] = (analytics.clientsByUserAgent[shortAgent] || 0) + 1;

  const hour = new Date().toISOString().substring(0, 13);
  analytics.hourlyRequests[hour] = (analytics.hourlyRequests[hour] || 0) + 1;
}

// Track tool call
function trackToolCall(toolName: string, req: Request): void {
  analytics.totalToolCalls++;
  analytics.toolCalls[toolName] = (analytics.toolCalls[toolName] || 0) + 1;

  const toolCall = {
    tool: toolName,
    timestamp: new Date().toISOString(),
    clientIp: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown',
    userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 50),
  };

  analytics.recentToolCalls.unshift(toolCall);
  if (analytics.recentToolCalls.length > MAX_RECENT_CALLS) {
    analytics.recentToolCalls.pop();
  }
}

// Calculate uptime
function getUptime(): string {
  const start = new Date(analytics.serverStartTime).getTime();
  const now = Date.now();
  const diff = now - start;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Load analytics on startup
loadAnalytics();

// Periodic save
const saveInterval = setInterval(() => {
  saveAnalytics();
}, SAVE_INTERVAL_MS);

// ============================================================================
// MCP Server Factory
// ============================================================================

function createMcpServer(apiKey?: string): McpServer {
  // Set the API key in environment if provided via query param
  if (apiKey) {
    process.env.ZEROBOUNCE_API_KEY = apiKey;
  }

  const server = new McpServer({
    name: 'mcp-zerobounce',
    version: '1.0.0',
    capabilities: {
      tools: {},
      logging: {},
    },
  });

  registerZeroBounceTools(server);
  return server;
}

// ============================================================================
// Express App
// ============================================================================

const app = express();
app.use(express.json());

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'Accept',
    'Accept-Encoding',
    'Cache-Control',
    'Connection',
    'User-Agent',
    'X-Requested-With',
  ],
  exposedHeaders: ['Content-Type', 'Cache-Control'],
  credentials: false,
  maxAge: 86400,
}));

app.options('*', cors());

// ============================================================================
// Endpoints
// ============================================================================

// Root - server info
app.get('/', (req: Request, res: Response) => {
  trackRequest(req, '/');
  res.json({
    name: 'ZeroBounce MCP Server',
    version: '1.0.0',
    description: 'MCP server for ZeroBounce email validation API',
    transport: 'streamable-http',
    endpoints: {
      mcp: '/mcp',
      health: '/health',
      analytics: '/analytics',
      dashboard: '/analytics/dashboard',
    },
  });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  trackRequest(req, '/health');
  res.json({
    status: 'healthy',
    server: 'ZeroBounce MCP Server',
    version: '1.0.0',
    transport: 'streamable-http',
    uptime: getUptime(),
    timestamp: new Date().toISOString(),
  });
});

// Analytics JSON
app.get('/analytics', (req: Request, res: Response) => {
  trackRequest(req, '/analytics');
  res.json({
    ...analytics,
    uptime: getUptime(),
    currentTime: new Date().toISOString(),
  });
});

// Analytics - Tool usage stats
app.get('/analytics/tools', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/tools');

  const toolStats = Object.entries(analytics.toolCalls)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    totalToolCalls: analytics.totalToolCalls,
    tools: toolStats,
    recentCalls: analytics.recentToolCalls.slice(0, 20),
  });
});

// Analytics Dashboard (HTML)
app.get('/analytics/dashboard', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/dashboard');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZeroBounce MCP Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { font-size: 24px; color: #38bdf8; }
    .header p { color: #94a3b8; font-size: 14px; margin-top: 5px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .stat-card { background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #334155; }
    .stat-card .value { font-size: 32px; font-weight: bold; color: #38bdf8; }
    .stat-card .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .chart-card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
    .chart-card h3 { color: #38bdf8; margin-bottom: 15px; font-size: 16px; }
    .recent-calls { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
    .recent-calls h3 { color: #38bdf8; margin-bottom: 15px; }
    .call-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; font-size: 13px; }
    .call-item:last-child { border-bottom: none; }
    .call-tool { color: #a78bfa; font-weight: 500; }
    .call-time { color: #94a3b8; }
    .refresh-note { text-align: center; color: #64748b; font-size: 12px; margin-top: 20px; }
    canvas { max-height: 300px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ZeroBounce MCP Server - Analytics Dashboard</h1>
    <p>Real-time server metrics and usage statistics</p>
  </div>

  <div class="stats-grid">
    <div class="stat-card"><div class="value" id="totalRequests">-</div><div class="label">Total Requests</div></div>
    <div class="stat-card"><div class="value" id="totalToolCalls">-</div><div class="label">Tool Calls</div></div>
    <div class="stat-card"><div class="value" id="uptime">-</div><div class="label">Uptime</div></div>
    <div class="stat-card"><div class="value" id="uniqueClients">-</div><div class="label">Unique Clients</div></div>
  </div>

  <div class="charts-grid">
    <div class="chart-card">
      <h3>Tool Usage Distribution</h3>
      <canvas id="toolChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Hourly Requests (Last 24h)</h3>
      <canvas id="hourlyChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Requests by Endpoint</h3>
      <canvas id="endpointChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Top Clients by User Agent</h3>
      <canvas id="clientChart"></canvas>
    </div>
  </div>

  <div class="recent-calls">
    <h3>Recent Tool Calls</h3>
    <div id="recentCallsList"></div>
  </div>

  <p class="refresh-note">Auto-refreshes every 30 seconds</p>

  <script>
    let toolChart, hourlyChart, endpointChart, clientChart;

    const chartColors = ['#38bdf8', '#a78bfa', '#34d399', '#fb923c', '#f87171', '#fbbf24', '#818cf8', '#2dd4bf', '#e879f9', '#f472b6'];

    async function fetchAnalytics() {
      const basePath = window.location.pathname.replace(/\\/analytics\\/dashboard\\/?$/, '');
      const res = await fetch(basePath + '/analytics');
      return res.json();
    }

    function updateStats(data) {
      document.getElementById('totalRequests').textContent = data.totalRequests.toLocaleString();
      document.getElementById('totalToolCalls').textContent = data.totalToolCalls.toLocaleString();
      document.getElementById('uptime').textContent = data.uptime;
      document.getElementById('uniqueClients').textContent = Object.keys(data.clientsByIp || {}).length;
    }

    function updateToolChart(data) {
      const entries = Object.entries(data.toolCalls || {}).sort((a, b) => b[1] - a[1]);
      const labels = entries.map(e => e[0]);
      const values = entries.map(e => e[1]);

      if (toolChart) toolChart.destroy();
      toolChart = new Chart(document.getElementById('toolChart'), {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: chartColors }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } } }
      });
    }

    function updateHourlyChart(data) {
      const now = new Date();
      const hours = [];
      for (let i = 23; i >= 0; i--) {
        const d = new Date(now - i * 3600000);
        hours.push(d.toISOString().substring(0, 13));
      }
      const labels = hours.map(h => h.substring(11) + ':00');
      const values = hours.map(h => (data.hourlyRequests || {})[h] || 0);

      if (hourlyChart) hourlyChart.destroy();
      hourlyChart = new Chart(document.getElementById('hourlyChart'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Requests', data: values, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', fill: true, tension: 0.4 }] },
        options: { responsive: true, scales: { x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }, y: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: '#1e293b' } } }, plugins: { legend: { display: false } } }
      });
    }

    function updateEndpointChart(data) {
      const entries = Object.entries(data.requestsByEndpoint || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const labels = entries.map(e => e[0]);
      const values = entries.map(e => e[1]);

      if (endpointChart) endpointChart.destroy();
      endpointChart = new Chart(document.getElementById('endpointChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Requests', data: values, backgroundColor: '#a78bfa' }] },
        options: { responsive: true, indexAxis: 'y', scales: { x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
      });
    }

    function updateClientChart(data) {
      const entries = Object.entries(data.clientsByUserAgent || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const labels = entries.map(e => e[0]);
      const values = entries.map(e => e[1]);

      if (clientChart) clientChart.destroy();
      clientChart = new Chart(document.getElementById('clientChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Requests', data: values, backgroundColor: '#34d399' }] },
        options: { responsive: true, indexAxis: 'y', scales: { x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } } }, plugins: { legend: { display: false } } }
      });
    }

    function updateRecentCalls(data) {
      const list = document.getElementById('recentCallsList');
      const calls = (data.recentToolCalls || []).slice(0, 15);
      if (calls.length === 0) {
        list.innerHTML = '<p style="color:#64748b;text-align:center">No tool calls yet</p>';
        return;
      }
      list.innerHTML = calls.map(c => {
        const time = new Date(c.timestamp).toLocaleString();
        return '<div class="call-item"><span class="call-tool">' + c.tool + '</span><span class="call-time">' + time + '</span></div>';
      }).join('');
    }

    async function refresh() {
      try {
        const data = await fetchAnalytics();
        updateStats(data);
        updateToolChart(data);
        updateHourlyChart(data);
        updateEndpointChart(data);
        updateClientChart(data);
        updateRecentCalls(data);
      } catch (e) {
        console.error('Failed to fetch analytics:', e);
      }
    }

    refresh();
    setInterval(refresh, 30000);
  </script>
</body>
</html>`;

  res.type('html').send(html);
});

// Analytics import endpoint
app.post('/analytics/import', (req: Request, res: Response) => {
  trackRequest(req, '/analytics/import');
  const importKey = process.env.ANALYTICS_IMPORT_KEY;
  if (!importKey) {
    res.status(403).json({ error: 'Import endpoint is disabled' });
    return;
  }
  const providedKey = req.headers['x-import-key'] as string || req.query.key as string;
  if (providedKey !== importKey) {
    res.status(403).json({ error: 'Invalid import key' });
    return;
  }
  try {
    const importData = req.body;
    if (importData.totalRequests) analytics.totalRequests += importData.totalRequests;
    if (importData.totalToolCalls) analytics.totalToolCalls += importData.totalToolCalls;
    saveAnalytics();
    res.json({
      message: 'Analytics imported successfully',
      currentStats: {
        totalRequests: analytics.totalRequests,
        totalToolCalls: analytics.totalToolCalls,
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Failed to import analytics', details: String(error) });
  }
});

// ============================================================================
// MCP Endpoint
// ============================================================================

app.all('/mcp', async (req: Request, res: Response) => {
  // Fix Accept header for MCP SDK compatibility
  const acceptHeader = req.headers['accept'] || '';
  if (!acceptHeader.includes('text/event-stream')) {
    req.headers['accept'] = acceptHeader ? `${acceptHeader}, text/event-stream` : 'text/event-stream';
  }

  trackRequest(req, '/mcp');

  // Track tool calls
  if (req.body && req.body.method === 'tools/call' && req.body.params?.name) {
    trackToolCall(req.body.params.name, req);
  }

  try {
    // Resolve API key from query param, header, or environment
    const apiKey = req.query.apiKey as string
      || req.headers['x-api-key'] as string
      || process.env.ZEROBOUNCE_API_KEY
      || '';

    // Create MCP server with resolved API key
    const mcpServer = createMcpServer(apiKey);

    // Create a NEW transport for EACH request (stateless mode)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Clean up transport after response is sent
    res.on('close', () => {
      transport.close();
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', details: String(error) });
    }
  }
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  clearInterval(saveInterval);
  saveAnalytics();
  console.log('Analytics saved. Goodbye!');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 ZeroBounce MCP Server (HTTP) running on http://${HOST}:${PORT}`);
  console.log(`   Health:    http://${HOST}:${PORT}/health`);
  console.log(`   MCP:       http://${HOST}:${PORT}/mcp`);
  console.log(`   Analytics: http://${HOST}:${PORT}/analytics`);
  console.log(`   Dashboard: http://${HOST}:${PORT}/analytics/dashboard`);
  console.log(`\n📊 Analytics saved to: ${ANALYTICS_FILE}`);
});
