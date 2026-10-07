/**
 * Test helpers: a scriptable fake fetch and an in-memory MCP client.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createZeroBounceServer, type CreateServerOptions } from '../src/index.js';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  form?: URLSearchParams;
  multipart?: FormData;
}

type Responder = (req: RecordedRequest) => Response | Promise<Response>;

/** A fetch replacement that records requests and answers from a list of responders. */
export function fakeFetch(...responders: Responder[]) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    let body = '';
    let form: URLSearchParams | undefined;
    let multipart: FormData | undefined;
    if (typeof init.body === 'string') {
      body = init.body;
      if ((headers['content-type'] || '').includes('x-www-form-urlencoded')) form = new URLSearchParams(body);
    } else if (init.body instanceof FormData) {
      multipart = init.body;
    }
    const req: RecordedRequest = { url, method: init.method || 'GET', headers, body, form, multipart };
    requests.push(req);
    const responder = responders[Math.min(call, responders.length - 1)];
    call++;
    return responder(req);
  }) as typeof fetch;
  return { fetch: fn, requests };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function text(body: string, status = 200, contentType = 'text/plain'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

/** Connect an MCP client to a fresh server over an in-memory transport. */
export async function connect(options: Partial<CreateServerOptions> & { fetchImpl?: typeof fetch }) {
  const server = createZeroBounceServer({
    apiKey: 'zb-test-key-123456',
    transport: 'http',
    authMode: 'test',
    ...options,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    return { text: result.content.map(c => c.text).join('\n'), isError: Boolean(result.isError) };
  }

  return { client, server, call, close: () => client.close() };
}
