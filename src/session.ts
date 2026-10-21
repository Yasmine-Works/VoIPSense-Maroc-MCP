import { VoipSenseError } from "./client.js";

type Query = Record<string, string | number | boolean | undefined>;

/**
 * Client for the VoIPSense web console API (`/api/...`), authenticated as a console user.
 *
 * This is the API the VoIPSense web app itself uses. It is not part of the documented public API,
 * so routes may change without notice. Auth flow (as used by the console):
 *   POST /api/auth/login { email, password } → { accessToken (JWT, 24h), user } + `refreshToken` cookie (30 days)
 *     or { requires2FA: true, userId } when two-factor auth is enabled
 *   POST /api/auth/refresh (refreshToken cookie) → { accessToken }
 */
export class SessionClient {
  private accessToken: string | null = null;
  private accessExp = 0;
  private refreshCookie: string | null = null;
  private pending: Promise<void> | null = null;

  constructor(
    private apiRoot: string,
    private email: string,
    private password: string,
  ) {
    this.apiRoot = apiRoot.replace(/\/+$/, "");
  }

  private async post(pathname: string, body: unknown, cookie?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "voipsense-maroc-mcp",
    };
    if (cookie) headers.Cookie = cookie;
    return fetch(this.apiRoot + pathname, { method: "POST", headers, body: JSON.stringify(body) });
  }

  private captureRefreshCookie(res: Response) {
    const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
    for (const c of cookies) {
      const m = /(?:^|,\s*)refreshToken=([^;]*)/.exec(c);
      if (m && m[1]) this.refreshCookie = `refreshToken=${m[1]}`;
    }
  }

  private setToken(token: string) {
    this.accessToken = token;
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: number };
      this.accessExp = (payload.exp ?? 0) * 1000;
    } catch {
      this.accessExp = Date.now() + 60 * 60 * 1000;
    }
  }

  private async login() {
    const res = await this.post("/auth/login", { email: this.email, password: this.password });
    const data = (await res.json().catch(() => ({}))) as { accessToken?: string; requires2FA?: boolean; message?: string };
    if (!res.ok) {
      throw new Error(`VoIPSense console login failed (${res.status})${data.message ? `: ${data.message}` : ""}. Check VOIPSENSE_EMAIL / VOIPSENSE_PASSWORD.`);
    }
    if (data.requires2FA) {
      throw new Error("This VoIPSense account has two-factor authentication enabled. Use a dedicated account without 2FA for the MCP server.");
    }
    if (!data.accessToken) throw new Error("VoIPSense console login returned no access token.");
    this.captureRefreshCookie(res);
    this.setToken(data.accessToken);
  }

  private async refresh(): Promise<boolean> {
    if (!this.refreshCookie) return false;
    const res = await this.post("/auth/refresh", {}, this.refreshCookie);
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as { accessToken?: string };
    if (!data.accessToken) return false;
    this.captureRefreshCookie(res);
    this.setToken(data.accessToken);
    return true;
  }

  /** Ensures a valid token; concurrent callers share one login/refresh. */
  private async authenticate(force = false) {
    if (!force && this.accessToken && Date.now() < this.accessExp - 60_000) return;
    this.pending ??= (async () => {
      try {
        if (!(await this.refresh().catch(() => false))) await this.login();
      } finally {
        this.pending = null;
      }
    })();
    await this.pending;
  }

  async request<T = unknown>(method: string, pathname: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    await this.authenticate();
    const url = new URL(this.apiRoot + pathname);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }

    const send = () => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "User-Agent": "voipsense-maroc-mcp",
      };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      return fetch(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    };

    let res = await send();
    if (res.status === 401) {
      await this.authenticate(true);
      res = await send();
    }

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : { status: res.status };
    } catch {
      // keep raw text
    }
    if (!res.ok) throw new VoipSenseError(res.status, parsed);
    return parsed as T;
  }
}
