/**
 * ZeroBounce MCP Server - Tool Registrations
 * 
 * All ZeroBounce API tools are registered here for reuse
 * by both stdio (index.ts) and HTTP (http-server.ts) transports.
 * 
 * API key resolution order:
 * 1. Per-tool `apiKey` parameter
 * 2. ZEROBOUNCE_API_KEY environment variable
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';

// Resolve API key from tool args or environment
function resolveApiKey(argsApiKey?: string): string {
  const key = argsApiKey || process.env.ZEROBOUNCE_API_KEY || '';
  if (!key) {
    throw new Error('ZeroBounce API key is required. Provide it via the apiKey parameter or set ZEROBOUNCE_API_KEY environment variable.');
  }
  return key;
}

// Standard error handler for axios errors
function formatError(error: unknown): string {
  if (axios.isAxiosError(error) && error.response) {
    return JSON.stringify({
      error: 'API request failed',
      status: error.response.status,
      data: error.response.data,
    });
  }
  return JSON.stringify({ error: 'An unexpected error occurred', details: String(error) });
}

export function registerZeroBounceTools(server: McpServer): void {

  // ============================================================================
  // Hello / Test Tool
  // ============================================================================
  server.tool(
    'hello',
    'A simple test tool to verify that the MCP server is working correctly',
    {},
    async () => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          message: 'Hello from ZeroBounce MCP Server!',
          version: '1.0.0',
          status: 'operational',
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    })
  );

  // ============================================================================
  // Email Validation
  // ============================================================================
  server.tool(
    'validate_email',
    'Validates an email address using the ZeroBounce API. Returns detailed validation results including status, sub-status, free email check, domain info, and more.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      email: z.string().describe('The email address to validate'),
      ipAddress: z.string().optional().describe('The IP address of the email sender (optional)'),
    },
    async ({ apiKey, email, ipAddress }) => {
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://api.zerobounce.net/v2/validate', {
          params: { api_key: key, email, ip_address: ipAddress },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // Email Finder
  // ============================================================================
  server.tool(
    'find_email',
    'Finds the email format for a given domain or company name. At least one of domain or companyName must be provided.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      domain: z.string().optional().describe('The email domain for which to find the email format'),
      companyName: z.string().optional().describe('The company name for which to find the email format'),
    },
    async ({ apiKey, domain, companyName }) => {
      if (!domain && !companyName) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Either domain or companyName must be provided.' }) }],
          isError: true,
        };
      }
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://api.zerobounce.net/v2/guessformat', {
          params: { api_key: key, domain, company_name: companyName },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // AI Scoring - Send File
  // ============================================================================
  server.tool(
    'scoring_send_file',
    'Submits a file for AI scoring. Returns a file ID that can be used to check status and retrieve results.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      filePath: z.string().describe('The path to the file to be scored'),
      emailAddressColumn: z.number().int().describe('The column index of the email address in the file (1-based)'),
      hasHeaderRow: z.boolean().optional().describe('Whether the file has a header row'),
    },
    async ({ apiKey, filePath, emailAddressColumn, hasHeaderRow }) => {
      try {
        const key = resolveApiKey(apiKey);
        const fs = await import('fs');
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('api_key', key);
        form.append('email_address_column', String(emailAddressColumn));
        if (hasHeaderRow !== undefined) {
          form.append('has_header_row', String(hasHeaderRow));
        }
        form.append('file', fs.createReadStream(filePath));

        const { data } = await axios.post('https://bulkapi.zerobounce.net/v2/scoring/sendfile', form, {
          headers: form.getHeaders(),
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // AI Scoring - File Status
  // ============================================================================
  server.tool(
    'scoring_file_status',
    'Gets the status of a submitted file for AI scoring.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      fileId: z.string().describe('The ID of the file to check'),
    },
    async ({ apiKey, fileId }) => {
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://bulkapi.zerobounce.net/v2/scoring/filestatus', {
          params: { api_key: key, file_id: fileId },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // AI Scoring - Get File Results
  // ============================================================================
  server.tool(
    'scoring_get_file',
    'Gets the results of a scored file.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      fileId: z.string().describe('The ID of the file to retrieve results for'),
    },
    async ({ apiKey, fileId }) => {
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://bulkapi.zerobounce.net/v2/scoring/getfile', {
          params: { api_key: key, file_id: fileId },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // AI Scoring - Delete File
  // ============================================================================
  server.tool(
    'scoring_delete_file',
    'Deletes a scored file from ZeroBounce.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      fileId: z.string().describe('The ID of the file to delete'),
    },
    async ({ apiKey, fileId }) => {
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://bulkapi.zerobounce.net/v2/scoring/deletefile', {
          params: { api_key: key, file_id: fileId },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // Activity Data
  // ============================================================================
  server.tool(
    'get_activity_data',
    'Gets activity data for an email address. Shows if the email has been active and engaged.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      email: z.string().describe('The email address to check activity for'),
    },
    async ({ apiKey, email }) => {
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://api.zerobounce.net/v2/activity', {
          params: { api_key: key, email },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // List Evaluator
  // ============================================================================
  server.tool(
    'list_evaluator',
    'Submits a file for list evaluation. Evaluates the quality and deliverability of an email list.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      filePath: z.string().describe('The path to the file to be evaluated'),
      emailAddressColumn: z.number().int().describe('The column index of the email address in the file (1-based)'),
    },
    async ({ apiKey, filePath, emailAddressColumn }) => {
      try {
        const key = resolveApiKey(apiKey);
        const fs = await import('fs');
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('api_key', key);
        form.append('email_address_column', String(emailAddressColumn));
        form.append('file', fs.createReadStream(filePath));

        const { data } = await axios.post('https://bulkapi.zerobounce.net/v2/listevaluator/', form, {
          headers: form.getHeaders(),
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // Get Credits
  // ============================================================================
  server.tool(
    'get_credits',
    'Gets the remaining credits balance for your ZeroBounce account.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
    },
    async ({ apiKey }) => {
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://api.zerobounce.net/v2/getcredits', {
          params: { api_key: key },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );

  // ============================================================================
  // API Usage
  // ============================================================================
  server.tool(
    'get_api_usage',
    'Gets the API usage statistics for your ZeroBounce account within a date range.',
    {
      apiKey: z.string().optional().describe('Your ZeroBounce API key (optional if ZEROBOUNCE_API_KEY env var is set)'),
      startDate: z.string().describe('Start date in YYYY-MM-DD format'),
      endDate: z.string().describe('End date in YYYY-MM-DD format'),
    },
    async ({ apiKey, startDate, endDate }) => {
      try {
        const key = resolveApiKey(apiKey);
        const { data } = await axios.get('https://api.zerobounce.net/v2/getapiusage', {
          params: { api_key: key, start_date: startDate, end_date: endDate },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    }
  );
}
