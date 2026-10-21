import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://app.voipsensemaroc.com/api/v1";

const ERROR_HINTS: Record<number, string> = {
  400: "Invalid or missing parameters",
  401: "API key missing or invalid (check VOIPSENSE_API_KEY)",
  403: "Insufficient permission for this API key (or plan quota reached)",
  404: "Not found: unknown recording, call already ended, or unknown extension/queue",
  409: "Conflict: tenant not provisioned, call not yet established, or no active channel left",
  422: "Destination unreachable from this call (outside the extension's dialing permissions)",
  429: "Rate limit exceeded (100 requests/minute). Wait before retrying",
  502: "Telephony failure (origination or transfer)",
};

export class VoipSenseError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    const hint = ERROR_HINTS[status] ?? "Unexpected error";
    const detail =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : typeof body === "string" && body
          ? body.slice(0, 500)
          : "";
    super(`VoIPSense API ${status}: ${hint}${detail ? ` — ${detail}` : ""}`);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export class VoipSenseClient {
  constructor(
    private apiKey: string,
    private baseUrl: string = DEFAULT_BASE_URL,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private url(pathname: string, query?: Query): string {
    const url = new URL(this.baseUrl + pathname);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private async raw(method: string, pathname: string, opts: { query?: Query; body?: unknown } = {}) {
    const headers: Record<string, string> = {
      "X-Api-Key": this.apiKey,
      Accept: "application/json",
      "User-Agent": "voipsense-maroc-mcp",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(this.url(pathname, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep text body
      }
      throw new VoipSenseError(res.status, parsed);
    }
    return res;
  }

  async request<T = unknown>(method: string, pathname: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const res = await this.raw(method, pathname, opts);
    const text = await res.text();
    if (!text) return { status: res.status } as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  /** Downloads a recording to disk and returns the written path and size. */
  async downloadRecording(file: string, outputPath: string): Promise<{ path: string; bytes: number; contentType: string | null }> {
    const res = await this.raw("GET", "/recordings/download", { query: { file } });
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buf);
    return { path: outputPath, bytes: buf.length, contentType: res.headers.get("content-type") };
  }
}
