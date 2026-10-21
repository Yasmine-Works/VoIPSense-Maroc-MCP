import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VoipSenseClient } from "./client.js";
import { clean, run } from "./util.js";

const BATCH_SIZE = 500;

const leadSchema = z
  .object({
    phone: z.string().describe("Phone number in any format (0612345678, +212612345678, 00212…). Normalized to E.164 at dial time."),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    company: z.string().optional(),
    city: z.string().optional(),
    customFields: z
      .record(z.string(), z.any())
      .optional()
      .describe('Free key/value fields, e.g. { "Service": "Implant, Blanchiment", "Source": "Site web" }. With updateIfExists, customFields are replaced entirely.'),
  })
  .passthrough();

const listTarget = {
  listId: z.string().optional().describe("Target list: UUID or the list number shown in the console (e.g. 101). Use listId OR listName."),
  listName: z.string().optional().describe("Target list by exact name. Combine with createList=true to create it if missing."),
  createList: z.boolean().optional().describe("Create the list named listName if it does not exist."),
  outboundLine: z
    .string()
    .optional()
    .describe("With createList: exact name or id of an active line (trunk) used for every call from this list. Always overrides the campaign line. 400 if unknown/inactive."),
  updateIfExists: z
    .boolean()
    .optional()
    .describe("Update fields of a contact already in the list instead of ignoring it (status/attempts/history are never touched)."),
};

const campaignTarget = {
  campaignId: z.string().optional().describe("Attach the list to an existing campaign by id."),
  campaignName: z.string().optional().describe("Attach the list to a campaign by name. Combine with createCampaign=true to create it."),
  createCampaign: z
    .boolean()
    .optional()
    .describe("Create campaignName if missing (OUTBOUND / PREVIEW / ACTIVE: the console serves leads to agents automatically)."),
  dialMethod: z
    .enum(["PREVIEW", "MANUAL", "PROGRESSIVE", "PREDICTIVE"])
    .optional()
    .describe("Dial mode for a newly created campaign. Default PREVIEW. MANUAL serves no leads; PROGRESSIVE/PREDICTIVE auto-dial."),
  agents: z
    .array(z.string())
    .optional()
    .describe('Explicit agents to enroll on the campaign: extension number, email or user id (e.g. ["111201","sara@client.ma"]). If none is valid → 400 and nothing is written.'),
  assignAllAgents: z.boolean().optional().describe("Enroll all active agents of the organization. Ignored if agents is provided."),
};

const READ = { readOnlyHint: true, openWorldHint: true } as const;

export function registerPublicTools(server: McpServer, api: VoipSenseClient, opts: { readOnly: boolean; downloadDir?: string }) {
  // ───────────────────────────── Read tools ─────────────────────────────

  server.registerTool(
    "list_calls",
    {
      title: "List calls / call results (CDR)",
      description:
        "GET /v1/calls (permission cdr:read). Unified call history (auto-dialer, manual, inbound) with agent dispositions. Use to read call outcomes back into a CRM/ERP.",
      inputSchema: {
        campaignId: z.string().optional(),
        agentId: z.string().optional(),
        status: z.string().optional().describe("e.g. ANSWERED, NO ANSWER, BUSY, FAILED"),
        direction: z.enum(["inbound", "outbound", "internal"]).optional(),
        dateFrom: z.string().optional().describe("YYYY-MM-DD"),
        dateTo: z.string().optional().describe("YYYY-MM-DD"),
        search: z.string().optional().describe("Free text search (phone number, contact name…)"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: READ,
    },
    (args) => run(() => api.request("GET", "/calls", { query: args })),
  );

  server.registerTool(
    "list_recordings",
    {
      title: "List call recordings",
      description:
        "GET /v1/recordings (permission recordings:read). Returns { total, page, limit, recordings: [{ filename, date, duration, src, dst, direction, disposition, format }] }. Pass `filename` to download_recording.",
      inputSchema: {
        startDate: z.string().optional().describe("YYYY-MM-DD"),
        endDate: z.string().optional().describe("YYYY-MM-DD"),
        number: z.string().optional().describe("Caller or callee number"),
        direction: z.enum(["inbound", "outbound", "internal"]).optional(),
        page: z.number().int().min(1).optional().describe("Default 1"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 50, max 500"),
      },
      annotations: READ,
    },
    (args) => run(() => api.request("GET", "/recordings", { query: args })),
  );

  server.registerTool(
    "download_recording",
    {
      title: "Download a call recording",
      description:
        "GET /v1/recordings/download (permission recordings:read). Saves the audio file to disk and returns its local path. `file` is the `filename` field from list_recordings (or from a call.ended webhook).",
      inputSchema: {
        file: z.string().describe('Recording filename, e.g. "2026-06/manual_11151_0612345678_..._101500.mp3"'),
        outputPath: z
          .string()
          .optional()
          .describe("Absolute path to write the file to. Defaults to VOIPSENSE_DOWNLOAD_DIR or ~/Downloads/voipsense/<basename>."),
      },
      annotations: { ...READ, readOnlyHint: false, destructiveHint: false },
    },
    ({ file, outputPath }) =>
      run(() => {
        const dir = opts.downloadDir ?? path.join(os.homedir(), "Downloads", "voipsense");
        const target = outputPath ? path.resolve(outputPath) : path.join(dir, path.basename(file));
        return api.downloadRecording(file, target);
      }),
  );

  server.registerTool(
    "list_lists",
    {
      title: "List contact lists",
      description:
        "GET /v1/lists (permission callcenter:read). Returns each list's id, number, name, volume and own outbound line (outboundLine: { id, name } or null = follows the campaign).",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => api.request("GET", "/lists")),
  );

  server.registerTool(
    "list_campaigns",
    {
      title: "List campaigns",
      description:
        "GET /v1/campaigns (permission callcenter:read). Campaigns with status, dialMethod, number of lists and agents, and outbound routing (outboundLine, lineSelectionMode FIXED|FIRST_FREE, linePool).",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => api.request("GET", "/campaigns")),
  );

  server.registerTool(
    "list_dispositions",
    {
      title: "List dispositions (call outcome codes)",
      description:
        "GET /v1/dispositions (permission callcenter:read). Outcome codes agents set on calls: [{ id, code, name, category, isSystem }]. Optional campaignId adds campaign-specific dispositions.",
      inputSchema: {
        campaignId: z.string().optional(),
      },
      annotations: READ,
    },
    (args) => run(() => api.request("GET", "/dispositions", { query: args })),
  );

  server.registerTool(
    "ghl_list_subaccounts",
    {
      title: "List linked GoHighLevel sub-accounts",
      description:
        "GET /v1/ghl/subaccounts (permission callcenter:read or callcenter:write). Returns [{ locationId, name, services: [...] }] for each linked GoHighLevel sub-account.",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => api.request("GET", "/ghl/subaccounts")),
  );

  if (opts.readOnly) return;

  // ───────────────────────────── Write tools ─────────────────────────────

  const connectTarget = z.object({
    type: z.enum(["extension", "queue", "ivr"]),
    value: z.string().describe("Extension number, queue number or IVR id"),
  });

  server.registerTool(
    "make_call",
    {
      title: "Place an outbound call (click-to-call)",
      description:
        "POST /v1/calls (permission pbx:write). connectTo.type=extension: rings the agent first, then dials `to` and bridges (click-to-call). queue: dials `to` then connects to a queue. ivr: dials `to` then connects to an IVR menu. Returns { callId, status: 'initiated', … }; keep callId to transfer/hang up.",
      inputSchema: {
        to: z.string().describe("External number to call, e.g. 0612345678"),
        connectTo: connectTarget,
        callerId: z
          .string()
          .optional()
          .describe("Number presented to the callee. Priority: trunk-enforced number > callerId > extension's presented number. Must belong to the line."),
        timeout: z.number().int().min(5).max(120).optional().describe("Ring time in seconds (5–120, default 30)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) => run(() => api.request("POST", "/calls", { body: clean(args) })),
  );

  server.registerTool(
    "hangup_call",
    {
      title: "Hang up a call",
      description:
        "DELETE /v1/calls/{callId} (permission pbx:write). Ends all legs of the call (normal clearing). Fires the call.ended webhook. 404 = unknown or already ended; 409 = no active channel.",
      inputSchema: {
        callId: z.string().describe("callId returned by make_call or received via webhook"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ callId }) => run(() => api.request("DELETE", `/calls/${encodeURIComponent(callId)}`)),
  );

  server.registerTool(
    "transfer_call",
    {
      title: "Transfer the remote party",
      description:
        "POST /v1/calls/{callId}/transfer (permission pbx:write). Blind-transfers the remote party to an extension, queue or external number. The agent's extension is released; the call keeps its callId. Call must be established (else 409). 400 invalid target · 404 not found · 422 destination unreachable.",
      inputSchema: {
        callId: z.string(),
        to: z.object({
          type: z.enum(["extension", "queue", "number"]),
          value: z.string().describe("Extension number, queue number or external phone number"),
        }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ callId, to }) => run(() => api.request("POST", `/calls/${encodeURIComponent(callId)}/transfer`, { body: { to } })),
  );

  server.registerTool(
    "inject_lead",
    {
      title: "Inject a single lead",
      description:
        "POST /v1/leads (permission callcenter:write). Adds one contact to a list (by listId or listName). Idempotent: a number already in the list returns duplicate=true without creating a duplicate. Returns { id, phone, created, duplicate, listId, listNumber, listName, … }.",
      inputSchema: {
        ...listTarget,
        ...leadSchema.shape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => run(() => api.request("POST", "/leads", { body: clean(args) })),
  );

  server.registerTool(
    "inject_leads_batch",
    {
      title: "Inject leads in bulk (auto-chunked by 500)",
      description:
        "POST /v1/leads/batch (permission callcenter:write). End-to-end provisioning in one call: create/reuse a list, attach it to a campaign (create it if needed), enroll agents, and inject leads. More than 500 leads are automatically split into batches of 500 and the totals are aggregated. Idempotent by phone number per list: safe to resend the full file every cycle. Without any campaign field the leads go to a plain list (\"Mes listes\" mode).",
      inputSchema: {
        ...listTarget,
        ...campaignTarget,
        leads: z.array(leadSchema).min(1).describe("Leads to inject. Any size; sent in batches of 500."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ leads, ...rest }) =>
      run(async () => {
        const base = clean(rest);
        const totals = { batches: 0, received: 0, created: 0, duplicates: 0, updated: 0, errors: [] as unknown[], warnings: [] as unknown[] };
        let last: Record<string, unknown> = {};
        for (let i = 0; i < leads.length; i += BATCH_SIZE) {
          let res: Record<string, unknown>;
          try {
            res = await api.request<Record<string, unknown>>("POST", "/leads/batch", { body: { ...base, leads: leads.slice(i, i + BATCH_SIZE) } });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
              totals.batches
                ? `${msg}\nPartial progress before failure (leads ${i + 1}+ not sent): ${JSON.stringify(totals)}`
                : msg,
            );
          }
          totals.batches++;
          for (const k of ["received", "created", "duplicates", "updated"] as const) {
            if (typeof res[k] === "number") totals[k] += res[k] as number;
          }
          if (Array.isArray(res.errors)) totals.errors.push(...res.errors);
          if (res.warning) totals.warnings.push(res.warning);
          last = res;
        }
        // Keep list/campaign metadata from the last batch, replace counters with aggregated totals.
        const meta = { ...last };
        for (const k of ["received", "created", "duplicates", "updated", "errors", "warning"]) delete meta[k];
        return { ...meta, ...totals, warnings: totals.warnings.length ? totals.warnings : undefined };
      }),
  );

  server.registerTool(
    "ghl_set_services",
    {
      title: "Set GoHighLevel contact service(s)",
      description:
        "POST /v1/ghl/services (permission callcenter:write). Tells VoIPSense which service(s) a GoHighLevel contact asked for; the agent sees it preselected during the call and the GHL call note gets a 'Service: …' line. Send a single contact (phone + service/services) or up to 500 `items`. Returns { received, saved, services, errors }.",
      inputSchema: {
        locationId: z.string().optional().describe("GoHighLevel sub-account (once for the batch, or per item)"),
        phone: z.string().optional().describe("Contact phone, any format"),
        service: z.string().optional().describe("Service name (case, accents and spaces ignored when matching)"),
        services: z.array(z.string()).optional(),
        replace: z.boolean().optional().describe("true: the contact keeps only these service(s) in this sub-account"),
        items: z
          .array(
            z
              .object({
                phone: z.string(),
                service: z.string().optional(),
                services: z.array(z.string()).optional(),
                locationId: z.string().optional(),
                replace: z.boolean().optional(),
              })
              .passthrough(),
          )
          .max(500)
          .optional()
          .describe("Batch of up to 500 contacts; rejected rows are listed in `errors`"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => run(() => api.request("POST", "/ghl/services", { body: clean(args) })),
  );
}
