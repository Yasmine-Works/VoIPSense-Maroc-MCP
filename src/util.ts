import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const MAX_TEXT = 80_000;

export function ok(data: unknown): CallToolResult {
  let text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (text.length > MAX_TEXT) {
    text = `${text.slice(0, MAX_TEXT)}\n…[truncated: ${text.length} chars total. Narrow the query (dates, filters, page/limit).]`;
  }
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
}

export async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

/** Drops undefined values so we never send `"key": null`-ish noise to the API. */
export function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const SENSITIVE_KEY = /(secret|password|passwd|token|apikey|api_key|dialplan)/i;

/** Recursively removes credentials (SIP secrets, tokens…) and raw dialplans before anything reaches the model. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE_KEY.test(k))
        .map(([k, v]) => [k, scrub(v)]),
    );
  }
  return value;
}

/** Today's date (YYYY-MM-DD) in Morocco, the platform's reference timezone. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
}
