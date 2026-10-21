#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BASE_URL, VoipSenseClient } from "./client.js";
import { registerTools } from "./tools.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const apiKey = process.env.VOIPSENSE_API_KEY?.trim();
if (!apiKey) {
  console.error(
    "voipsense-maroc-mcp: VOIPSENSE_API_KEY is not set.\n" +
      "Create a key in the VoIPSense console (Intégrations → API Keys → Nouvelle clé) and pass it as an environment variable.",
  );
  process.exit(1);
}

const readOnly = /^(1|true|yes)$/i.test(process.env.VOIPSENSE_READ_ONLY ?? "");
const client = new VoipSenseClient(apiKey, process.env.VOIPSENSE_BASE_URL || DEFAULT_BASE_URL);

const server = new McpServer(
  { name: "voipsense-maroc", version },
  {
    instructions:
      "Tools for the VoIPSense Cloud public API (VoIPSense Maroc). Use make_call / transfer_call / hangup_call to drive calls, " +
      "list_calls and list_dispositions to read call outcomes, list_recordings + download_recording for audio, and inject_leads_batch " +
      "to provision lists, campaigns and agents in one step. Rate limit: 100 requests/minute per key." +
      (readOnly ? " This server runs in read-only mode: write tools are disabled." : ""),
  },
);

registerTools(server, client, { readOnly, downloadDir: process.env.VOIPSENSE_DOWNLOAD_DIR || undefined });

await server.connect(new StdioServerTransport());
console.error(`voipsense-maroc-mcp v${version} running on stdio${readOnly ? " (read-only)" : ""}`);
