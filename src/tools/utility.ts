/**
 * Utility tool: a no-cost health check that needs no ZeroBounce call.
 */

import { REGION_LABELS } from '../zerobounce/regions.js';
import { SANDBOX_EMAILS } from '../zerobounce/statuses.js';
import { defineTool, textResult } from './shared.js';
import { SERVER_VERSION } from '../version.js';

export const hello = defineTool({
  name: 'zerobounce_hello',
  title: 'Check the ZeroBounce MCP server',
  group: 'Utility',
  description:
    'Check that the ZeroBounce MCP server is reachable and see how it is configured (version, connection mode, API region). ' +
    'Makes no ZeroBounce API call. Also lists test addresses that validate without using credits.',
  cost: 'Free (no ZeroBounce API call)',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(_args, ctx) {
    return textResult(
      [
        `## ZeroBounce MCP Server v${SERVER_VERSION}`,
        '',
        `- **Status:** operational`,
        `- **Transport:** ${ctx.transport === 'http' ? 'Streamable HTTP' : 'stdio (local)'}`,
        `- **Connection mode:** ${ctx.authMode}`,
        `- **API region:** ${REGION_LABELS[ctx.region]}`,
        `- **Time:** ${new Date().toISOString()}`,
        '',
        `Test addresses (no credits used): ${SANDBOX_EMAILS.join(', ')}`,
        '',
        'Use zerobounce_get_credits to confirm the API key works.',
      ].join('\n'),
    );
  },
});

export const utilityTools = [hello];
