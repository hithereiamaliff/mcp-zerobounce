/**
 * Shared building blocks for tool definitions.
 *
 * Every tool is a plain ToolDefinition object. src/index.ts registers them in a
 * loop, and the same list feeds the server card, TOOLS.md and the tests — so
 * there is one source of truth for names, descriptions, costs and annotations.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZeroBounceClient } from '../zerobounce/client.js';
import { ZeroBounceError } from '../zerobounce/errors.js';
import type { ZeroBounceRegion } from '../zerobounce/regions.js';

export type ToolGroup = 'Account' | 'Validation' | 'Email Finder' | 'Filters' | 'Bulk files' | 'List Evaluator' | 'Utility';

/** Per-request context handed to every tool handler. */
export interface ToolContext {
  /** Returns the request's ZeroBounce client (throws a friendly error if no key is configured). */
  getClient(): ZeroBounceClient;
  region: ZeroBounceRegion;
  transport: 'http' | 'stdio';
  /** How the caller authenticated (shown by zerobounce_hello). */
  authMode: string;
  /** Only true in local CLI mode: enables file_path / save_to_path parameters. */
  allowLocalFiles: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  group: ToolGroup;
  description: string;
  /** Human-readable credit cost; appended to the description so the model can see it. */
  cost: string;
  inputSchema: z.ZodRawShape;
  /** Extra parameters only exposed when the server can read local files (CLI). */
  localInputSchema?: z.ZodRawShape;
  annotations: ToolAnnotations;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: ToolContext) => Promise<CallToolResult>;
}

/** Identity helper that keeps handler args typed against the schema. */
export function defineTool<S extends z.ZodRawShape, L extends z.ZodRawShape = Record<never, never>>(def: {
  name: string;
  title: string;
  group: ToolGroup;
  description: string;
  cost: string;
  inputSchema: S;
  localInputSchema?: L;
  annotations: ToolAnnotations;
  handler: (args: z.infer<z.ZodObject<S>> & Partial<z.infer<z.ZodObject<L>>>, ctx: ToolContext) => Promise<CallToolResult>;
}): ToolDefinition {
  return def as ToolDefinition;
}

// =============================================================================
// Annotation presets
// =============================================================================

/** Free, read-only calls to ZeroBounce (safe for clients to auto-approve). */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/**
 * Calls that spend credits or create something on ZeroBounce's side.
 * Deliberately NOT read-only, so clients like Claude ask before running them.
 */
export const SPENDS_CREDITS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Permanently removes something from the ZeroBounce account. */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

// =============================================================================
// Common schema pieces
// =============================================================================

export const responseFormatSchema = z
  .enum(['markdown', 'json'])
  .default('markdown')
  .describe('"markdown" (default) for a readable summary, or "json" for the raw ZeroBounce response.');

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .describe('Email address');

// =============================================================================
// Result helpers
// =============================================================================

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Raised for invalid tool input that zod can't express (e.g. "exactly one of"). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

// =============================================================================
// Local files (CLI only)
// =============================================================================

/** Largest local file the CLI will upload. */
export const MAX_LOCAL_FILE_BYTES = 50 * 1024 * 1024;

export async function readLocalFile(filePath: string, ctx: ToolContext): Promise<{ content: string; fileName: string }> {
  if (!ctx.allowLocalFiles) {
    // Defence in depth: the parameter isn't registered over HTTP, but never read files there.
    throw new ToolInputError('file_path is only available when running the server locally (CLI mode).');
  }
  const resolved = path.resolve(filePath);
  const stat = await fs.stat(resolved).catch(() => {
    throw new ToolInputError(`File not found: ${resolved}`);
  });
  if (!stat.isFile()) throw new ToolInputError(`Not a file: ${resolved}`);
  if (stat.size > MAX_LOCAL_FILE_BYTES) {
    throw new ToolInputError(`File is larger than ${MAX_LOCAL_FILE_BYTES / 1024 / 1024} MB: ${resolved}`);
  }
  return { content: await fs.readFile(resolved, 'utf-8'), fileName: path.basename(resolved) };
}

export async function writeLocalFile(filePath: string, content: string, ctx: ToolContext): Promise<string> {
  if (!ctx.allowLocalFiles) {
    throw new ToolInputError('save_to_path is only available when running the server locally (CLI mode).');
  }
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf-8');
  return resolved;
}

/** Turn any thrown error into a tool error result (never leaks stack traces). */
export function toErrorResult(error: unknown): CallToolResult {
  if (error instanceof ZeroBounceError || error instanceof ToolInputError) {
    return errorResult(error.message);
  }
  if (error instanceof Error && error.name === 'InvalidRegionError') {
    return errorResult(error.message);
  }
  console.error('Unexpected tool error:', error);
  return errorResult('Unexpected error while calling ZeroBounce. Please try again.');
}
