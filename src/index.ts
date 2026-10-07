/**
 * ZeroBounce MCP Server - shared server factory.
 *
 * Used by both entry points:
 *   - src/cli.ts          stdio transport for local use (npx mcp-zerobounce)
 *   - src/http-server.ts  Streamable HTTP for the hosted VPS deployment
 *
 * createZeroBounceServer() builds a fresh McpServer for ONE caller. The API key
 * is captured in a closure for that server only — it is never written to
 * process.env or any other shared state, so concurrent users can't mix keys.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZeroBounceClient } from './zerobounce/client.js';
import { ZeroBounceError } from './zerobounce/errors.js';
import type { ZeroBounceRegion } from './zerobounce/regions.js';
import { toErrorResult, type ToolContext, type ToolDefinition } from './tools/shared.js';
import { utilityTools } from './tools/utility.js';
import { accountTools } from './tools/account.js';
import { validationTools } from './tools/validation.js';
import { finderTools } from './tools/finder.js';
import { filterTools } from './tools/filters.js';
import { bulkTools } from './tools/bulk.js';
import { listEvaluatorTools } from './tools/list-evaluator.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export { SERVER_NAME, SERVER_VERSION };
export { ZeroBounceClient } from './zerobounce/client.js';
export { parseRegion, type ZeroBounceRegion } from './zerobounce/regions.js';

/** Every tool, in the order they are listed to clients. */
export const ALL_TOOLS: ToolDefinition[] = [
  ...utilityTools,
  ...accountTools,
  ...validationTools,
  ...finderTools,
  ...filterTools,
  ...bulkTools,
  ...listEvaluatorTools,
];

/** Guidance sent to the model when it connects (MCP "instructions"). */
export const SERVER_INSTRUCTIONS = [
  'ZeroBounce email validation and email-finding tools.',
  '- One address: zerobounce_validate_email. Up to 100: zerobounce_validate_batch. Larger lists: zerobounce_bulk_validate.',
  '- Each tool description states its credit cost. Check zerobounce_get_credits before large jobs.',
  '- Bulk jobs run in the background: submit, then zerobounce_bulk_status, then zerobounce_bulk_results (summary first, then rows).',
  '- Verdicts: SAFE = ok to send; RISKY = catch-all (zerobounce_score_email can help prioritise); UNVERIFIED = retry later (not charged); WILL BOUNCE / DO NOT SEND = remove.',
  '- Test addresses like valid@example.com, invalid@example.com or catch_all@example.com return fixed results without using credits.',
].join('\n');

export interface CreateServerOptions {
  /** The caller's ZeroBounce API key. Optional so tools/list works without one. */
  apiKey?: string;
  region?: ZeroBounceRegion;
  transport: 'http' | 'stdio';
  /** Shown by zerobounce_hello, e.g. "hosted (mcp-key-service)". */
  authMode: string;
  /** Enables file_path / save_to_path. Only ever true for the local CLI. */
  allowLocalFiles?: boolean;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Largest bulk results file to download and parse (bytes). Defaults to 20 MB
   * over HTTP (a shared server) and 100 MB for the local CLI.
   */
  maxResultBytes?: number;
  /** Called after every tool call (used for analytics). */
  onToolComplete?: (event: { tool: string; isError: boolean; durationMs: number }) => void;
}

/** Tool description as sent to clients: the description plus its credit cost. */
export function describeTool(def: ToolDefinition): string {
  return `${def.description}\n\nCost: ${def.cost}.`;
}

/** Input schema for a tool, including local-only parameters when allowed. */
export function toolInputShape(def: ToolDefinition, allowLocalFiles: boolean) {
  return allowLocalFiles && def.localInputSchema ? { ...def.inputSchema, ...def.localInputSchema } : def.inputSchema;
}

export function registerAllTools(
  server: McpServer,
  ctx: ToolContext,
  onToolComplete?: CreateServerOptions['onToolComplete'],
): void {
  for (const def of ALL_TOOLS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: describeTool(def),
        inputSchema: toolInputShape(def, ctx.allowLocalFiles),
        annotations: { title: def.title, ...def.annotations },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const started = Date.now();
        let result: CallToolResult;
        try {
          result = await def.handler(args, ctx);
        } catch (error) {
          result = toErrorResult(error);
        }
        onToolComplete?.({ tool: def.name, isError: Boolean(result.isError), durationMs: Date.now() - started });
        return result;
      },
    );
  }
}

export function createZeroBounceServer(options: CreateServerOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  let client: ZeroBounceClient | undefined;
  const region = options.region ?? 'default';

  const ctx: ToolContext = {
    getClient() {
      if (!options.apiKey) {
        throw new ZeroBounceError(
          'auth',
          options.transport === 'stdio'
            ? 'No ZeroBounce API key is configured. Set the ZEROBOUNCE_API_KEY environment variable and restart the server.'
            : 'No ZeroBounce API key is configured for this connection.',
        );
      }
      client ??= new ZeroBounceClient({
        apiKey: options.apiKey,
        region,
        fetchImpl: options.fetchImpl,
        maxResultBytes: options.maxResultBytes ?? (options.transport === 'http' ? 20 : 100) * 1024 * 1024,
      });
      return client;
    },
    region,
    transport: options.transport,
    authMode: options.authMode,
    allowLocalFiles: options.allowLocalFiles ?? false,
  };

  registerAllTools(server, ctx, options.onToolComplete);
  return server;
}
