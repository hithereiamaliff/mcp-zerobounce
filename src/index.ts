#!/usr/bin/env node

/**
 * ZeroBounce MCP Server - Main Entry Point (stdio transport)
 * 
 * Provides tools for email validation, email finding, AI scoring,
 * activity data, and bulk list evaluation via ZeroBounce API.
 * 
 * API key can be provided via:
 * - ZEROBOUNCE_API_KEY environment variable
 * - Per-tool `apiKey` parameter (overrides env var)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerZeroBounceTools } from './tools.js';

// Create MCP server
const server = new McpServer({
  name: 'mcp-zerobounce',
  version: '1.0.0',
  capabilities: {
    tools: {},
    logging: {},
  },
});

// Register all ZeroBounce tools
registerZeroBounceTools(server);

// Start with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ZeroBounce MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});