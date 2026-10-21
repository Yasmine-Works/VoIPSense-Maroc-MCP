#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BASE_URL, VoipSenseClient } from "./client.js";
import { SessionClient } from "./session.js";
import { registerPublicTools } from "./tools.js";
import { registerSessionTools } from "./session-tools.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const env = (name: string) => process.env[name]?.trim() || undefined;

const apiKey = env("VOIPSENSE_API_KEY");
const email = env("VOIPSENSE_EMAIL");
const password = process.env.VOIPSENSE_PASSWORD || undefined;

if (!apiKey && !(email && password)) {
  console.error(
    "voipsense-maroc-mcp: no credentials.\n" +
      "Set VOIPSENSE_API_KEY (public API: Intégrations → API Keys → Nouvelle clé)\n" +
      "and/or VOIPSENSE_EMAIL + VOIPSENSE_PASSWORD (console tools: analytics, live status, CRM, inbox…).",
  );
  process.exit(1);
}
if (email && !password) console.error("voipsense-maroc-mcp: VOIPSENSE_EMAIL is set but VOIPSENSE_PASSWORD is missing; console tools disabled.");

const readOnly = /^(1|true|yes)$/i.test(env("VOIPSENSE_READ_ONLY") ?? "");
const baseUrl = env("VOIPSENSE_BASE_URL") ?? DEFAULT_BASE_URL;
const consoleApiRoot = `${new URL(baseUrl).origin}/api`;

const modes = [apiKey && "public API", email && password && "console"].filter(Boolean).join(" + ");

const server = new McpServer(
  { name: "voipsense-maroc", version },
  {
    instructions:
      "Tools for VoIPSense Cloud (VoIPSense Maroc), a cloud PBX and call center. " +
      (apiKey
        ? "Public API tools: make_call / transfer_call / hangup_call drive calls, list_calls and list_dispositions read call outcomes, " +
          "list_recordings + download_recording fetch audio, inject_leads_batch provisions lists, campaigns and agents in one step (100 requests/minute per key). "
        : "") +
      (email && password
        ? "Console tools: get_analytics for dashboards and reports, get_live_status for real-time extension/queue state, list_extensions, " +
          "list_pbx_config for queues/IVR/opening hours, CRM (crm_*) and omnichannel inbox (inbox_*) tools, and console_get for any other read. "
        : "") +
      "Dates are YYYY-MM-DD in the Africa/Casablanca timezone." +
      (readOnly ? " Read-only mode: write tools are disabled." : ""),
  },
);

if (apiKey) {
  registerPublicTools(server, new VoipSenseClient(apiKey, baseUrl), {
    readOnly,
    downloadDir: env("VOIPSENSE_DOWNLOAD_DIR"),
  });
}
if (email && password) {
  registerSessionTools(server, new SessionClient(consoleApiRoot, email, password), { readOnly });
}

await server.connect(new StdioServerTransport());
console.error(`voipsense-maroc-mcp v${version} running on stdio (${modes}${readOnly ? ", read-only" : ""})`);
