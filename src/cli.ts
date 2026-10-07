#!/usr/bin/env node

/**
 * ZeroBounce MCP Server - local stdio entry point.
 *
 * Usage (e.g. in Claude Desktop / Cursor config):
 *   command: npx, args: ["-y", "mcp-zerobounce"]
 *   env: { "ZEROBOUNCE_API_KEY": "...", "ZEROBOUNCE_REGION": "us" }   // region optional
 *
 * In this mode the server runs on your own machine, so tools may also read and
 * write local files (file_path / save_to_path). The hosted HTTP server never can.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createZeroBounceServer } from './index.js';
import { parseRegion, type ZeroBounceRegion } from './zerobounce/regions.js';
import { SERVER_VERSION } from './version.js';

async function main(): Promise<void> {
  // stdout is reserved for the MCP protocol, so all logging goes to stderr.
  const apiKey = process.env.ZEROBOUNCE_API_KEY?.trim() || undefined;

  let region: ZeroBounceRegion;
  try {
    region = parseRegion(process.env.ZEROBOUNCE_REGION);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (!apiKey) {
    console.error('Warning: ZEROBOUNCE_API_KEY is not set. Tools will return an error until it is configured.');
  }

  const server = createZeroBounceServer({
    apiKey,
    region,
    transport: 'stdio',
    authMode: 'local CLI (ZEROBOUNCE_API_KEY)',
    allowLocalFiles: true,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`ZeroBounce MCP Server v${SERVER_VERSION} running on stdio (region: ${region})`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
