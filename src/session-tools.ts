import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionClient } from "./session.js";
import { clean, run, scrub, today } from "./util.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

const ANALYTICS_REPORTS = {
  kpis: "/analytics/kpis",
  hourly: "/analytics/hourly",
  dispositions: "/analytics/dispositions",
  queues: "/analytics/queues",
  "agent-performance": "/analytics/agent-performance",
  "agent-overview": "/analytics/agent-overview",
  "abandoned-calls": "/analytics/abandoned-calls",
  "top-agents": "/analytics/top-agents",
  campaigns: "/analytics/reports/campaigns",
  lists: "/analytics/reports/lists",
  "by-line": "/analytics/reports/by-line",
} as const;

const PBX_CONFIG = {
  queues: "/pbx/queues",
  "ring-groups": "/pbx/ring-groups",
  ivr: "/pbx/ivr",
  "ivr-destinations": "/pbx/ivr-destinations",
  "time-conditions": "/pbx/time-conditions",
  conferences: "/pbx/conferences",
  announcements: "/pbx/announcements",
  "paging-groups": "/pbx/paging-groups",
  "class-of-service": "/pbx/cos",
  "outbound-routing": "/pbx/routing/outbound",
  "caller-id-numbers": "/pbx/callerid/numbers",
  directory: "/pbx/directory",
  "transfer-shortcuts": "/pbx/transfer-shortcuts",
  "break-types": "/callcenter/break-types/active",
  skills: "/callcenter/skills",
} as const;

type Extension = Record<string, unknown> & { number?: string };

export function registerSessionTools(server: McpServer, api: SessionClient, opts: { readOnly: boolean }) {
  const get = (path: string, query?: Record<string, string | number | boolean | undefined>) =>
    api.request("GET", path, { query }).then(scrub);

  // ───────────────────────────── Reporting ─────────────────────────────

  server.registerTool(
    "get_analytics",
    {
      title: "Call center analytics & reports",
      description:
        "Dashboard statistics from the VoIPSense console. Reports: kpis (totals, answer rate, inbound/outbound), hourly (calls per hour, uses `date`), " +
        "dispositions (outcome breakdown), queues (SLA, waiting, abandoned per queue), agent-performance (calls/talk time/answer rate per agent), " +
        "agent-overview (logged-in user's own stats), abandoned-calls (abandon rate, wait brackets, details), top-agents, campaigns, lists, " +
        "by-line (per DID / trunk line). Dates default to today (Africa/Casablanca).",
      inputSchema: {
        report: z.enum(Object.keys(ANALYTICS_REPORTS) as [keyof typeof ANALYTICS_REPORTS, ...(keyof typeof ANALYTICS_REPORTS)[]]),
        dateFrom: z.string().optional().describe("YYYY-MM-DD (default today)"),
        dateTo: z.string().optional().describe("YYYY-MM-DD (default = dateFrom)"),
        direction: z.enum(["inbound", "outbound"]).optional().describe("dispositions report only"),
        source: z.string().optional().describe("Optional source filter used by the console (e.g. pbx, callcenter)"),
        limit: z.number().int().min(1).max(100).optional().describe("top-agents only (default 5)"),
      },
      annotations: READ,
    },
    ({ report, dateFrom, dateTo, direction, source, limit }) =>
      run(() => {
        const from = dateFrom ?? today();
        const query =
          report === "hourly"
            ? { date: from, dateFrom: from, dateTo: dateTo ?? from, source }
            : { dateFrom: from, dateTo: dateTo ?? from, direction, source, limit: report === "top-agents" ? (limit ?? 5) : undefined };
        return get(ANALYTICS_REPORTS[report], query);
      }),
  );

  server.registerTool(
    "get_account_overview",
    {
      title: "Account overview, quotas and alerts",
      description:
        "Tenant profile: plan, status, SIP server info, resource summary (extensions, users, agents, campaigns, trunks, queues…), quota usage and active alerts (e.g. limits reached).",
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => get("/admin/tenants/my-profile")),
  );

  // ───────────────────────────── Live PBX ─────────────────────────────

  server.registerTool(
    "get_live_status",
    {
      title: "Live switchboard status",
      description:
        "Real-time operator view: every extension with its state (OFFLINE, IDLE, RINGING, INUSE…) and DND flag, active call lines, " +
        "queues with waiting callers, and parked calls. Use to answer 'who is available right now?' or 'is anyone waiting in queue?'.",
      inputSchema: {
        ext: z.string().optional().describe("Operator extension to view from (defaults to the logged-in user's extension)"),
      },
      annotations: READ,
    },
    ({ ext }) => run(() => get("/pbx/operator/state", { ext })),
  );

  server.registerTool(
    "list_extensions",
    {
      title: "List extensions (postes) with registration status",
      description:
        "All PBX extensions with name, type (SIP/WEBRTC), live registration status, caller ID, voicemail, call forwarding and recording policy. SIP secrets are never returned.",
      inputSchema: {},
      annotations: READ,
    },
    () =>
      run(async () => {
        const [exts, status] = await Promise.all([
          api.request<Extension[]>("GET", "/pbx/extensions"),
          api.request<Record<string, { status?: string; peerIp?: string | null }>>("GET", "/pbx/extensions/status").catch(() => ({}) as Record<string, never>),
        ]);
        return (Array.isArray(exts) ? exts : []).map((e) => ({
          id: e.id,
          number: e.number,
          name: e.name,
          type: e.type,
          status: (e.number && status[e.number]?.status) || e.status,
          callerIdName: e.callerIdName,
          callerIdNumber: e.callerIdNumber,
          voicemailEnabled: e.voicemailEnabled,
          callForwarding: scrub(e.callForwarding),
          recordingPolicy: e.recordingPolicy,
          recordInbound: e.recordInbound,
          recordOutbound: e.recordOutbound,
        }));
      }),
  );

  server.registerTool(
    "list_pbx_config",
    {
      title: "Read PBX / call center configuration",
      description:
        "Reads one configuration collection: queues, ring-groups, ivr, ivr-destinations, time-conditions (opening hours), conferences, announcements, " +
        "paging-groups, class-of-service (dialing permissions), outbound-routing, caller-id-numbers, directory, transfer-shortcuts, break-types (pause codes), skills.",
      inputSchema: {
        kind: z.enum(Object.keys(PBX_CONFIG) as [keyof typeof PBX_CONFIG, ...(keyof typeof PBX_CONFIG)[]]),
      },
      annotations: READ,
    },
    ({ kind }) => run(() => get(PBX_CONFIG[kind])),
  );

  server.registerTool(
    "list_agents",
    {
      title: "List call center agents",
      description: "Agents with email, extension(s), active flag and enrolled campaigns. Pass `users: true` to list every console user instead (all roles, last login, 2FA).",
      inputSchema: {
        users: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ users }) => run(() => get(users ? "/users" : "/callcenter/agents")),
  );

  server.registerTool(
    "list_callback_requests",
    {
      title: "List callback requests",
      description: "Pending callback requests left by callers (status PENDING, DONE, CANCELLED, EXPIRED, FAILED). `all: true` includes processed ones.",
      inputSchema: { all: z.boolean().optional() },
      annotations: READ,
    },
    ({ all }) => run(() => get("/pbx/callback-requests", { all: all ? "1" : undefined })),
  );

  server.registerTool(
    "list_voicemail",
    {
      title: "List voicemail boxes",
      description: "Voicemail boxes with new/old message counts. scope=own (default) for the logged-in user's mailbox; other values are passed to the console as-is.",
      inputSchema: { scope: z.string().optional().describe('Default "own"') },
      annotations: READ,
    },
    ({ scope }) => run(() => get("/pbx/voicemail/mailboxes", { scope: scope ?? "own" })),
  );

  server.registerTool(
    "list_blocked_numbers",
    {
      title: "List blocked numbers",
      description: "Phone numbers blocked on the PBX (blacklist), with direction, reason and expiry.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ,
    },
    ({ page, limit }) => run(() => get("/pbx/blocked-numbers", { page: page ?? 1, limit: limit ?? 50 })),
  );

  server.registerTool(
    "list_notifications",
    {
      title: "List console notifications",
      description: "Console notifications (new users, quota alerts, system events…) with read status.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    ({ page, pageSize }) => run(() => get("/notifications", { page: page ?? 1, pageSize: pageSize ?? 20 })),
  );

  // ───────────────────────────── CRM ─────────────────────────────

  server.registerTool(
    "crm_search_contacts",
    {
      title: "Search CRM contacts",
      description: "Searches the built-in VoIPSense CRM. Returns { contacts, total, page, totalPages, facets }.",
      inputSchema: {
        q: z.string().optional().describe("Free text: name, phone, email, company"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        sortBy: z.string().optional().describe("e.g. updatedAt, createdAt, score"),
        sortDir: z.enum(["asc", "desc"]).optional(),
        includeDialerLists: z.boolean().optional().describe("Also include contacts coming from dialer lists"),
      },
      annotations: READ,
    },
    ({ includeDialerLists, ...q }) =>
      run(() => get("/crm-module/contacts", { page: 1, limit: 50, sortBy: "updatedAt", sortDir: "desc", ...clean(q), includeDialerLists: includeDialerLists ? "true" : undefined })),
  );

  server.registerTool(
    "crm_get_contact",
    {
      title: "Get a CRM contact with history",
      description: "Full CRM contact plus optional notes, timeline (calls, messages, status changes), AI summary and tasks.",
      inputSchema: {
        contactId: z.string(),
        include: z.array(z.enum(["notes", "timeline", "summary", "tasks"])).optional().describe("Default: notes + timeline"),
      },
      annotations: READ,
    },
    ({ contactId, include }) =>
      run(async () => {
        const id = encodeURIComponent(contactId);
        const parts = include ?? ["notes", "timeline"];
        const [contact, ...extras] = await Promise.all([
          get(`/crm-module/contacts/${id}`),
          ...parts.map((p) =>
            (p === "tasks" ? get("/crm-module/tasks", { contactId }) : get(`/crm-module/contacts/${id}/${p}`)).catch((e: Error) => ({ error: e.message })),
          ),
        ]);
        return { contact, ...Object.fromEntries(parts.map((p, i) => [p, extras[i]])) };
      }),
  );

  server.registerTool(
    "crm_list_tasks_and_deals",
    {
      title: "List CRM tasks or deals",
      description: "Lists CRM tasks (optionally for one contact) or deals.",
      inputSchema: {
        kind: z.enum(["tasks", "deals"]),
        contactId: z.string().optional().describe("tasks only"),
      },
      annotations: READ,
    },
    ({ kind, contactId }) => run(() => get(`/crm-module/${kind}`, kind === "tasks" ? { contactId } : undefined)),
  );

  // ───────────────────────────── Omnichannel inbox ─────────────────────────────

  server.registerTool(
    "inbox_list_conversations",
    {
      title: "List inbox conversations (WhatsApp, email…)",
      description: "Omnichannel inbox conversations plus inbox stats. Default status filter: OPEN,ASSIGNED,PENDING.",
      inputSchema: {
        status: z.string().optional().describe("Comma-separated: OPEN, ASSIGNED, PENDING, RESOLVED"),
        channelId: z.string().optional(),
      },
      annotations: READ,
    },
    ({ status, channelId }) =>
      run(async () => {
        const [stats, channels, conversations] = await Promise.all([
          get("/omnichannel/inbox/stats"),
          get("/omnichannel/channels"),
          get("/omnichannel/conversations", { status: status ?? "OPEN,ASSIGNED,PENDING", channelId }),
        ]);
        return { stats, channels, conversations };
      }),
  );

  server.registerTool(
    "inbox_get_messages",
    {
      title: "Read a conversation's messages",
      description: "Messages of one omnichannel conversation (most recent `limit`).",
      inputSchema: {
        conversationId: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ,
    },
    ({ conversationId, limit }) => run(() => get(`/omnichannel/conversations/${encodeURIComponent(conversationId)}/messages`, { limit: limit ?? 25 })),
  );

  // ───────────────────────────── Escape hatch ─────────────────────────────

  server.registerTool(
    "console_get",
    {
      title: "Raw GET on the VoIPSense console API",
      description:
        "Read-only escape hatch for console routes without a dedicated tool, e.g. /pbx/parked-calls, /pbx/recordings/stats, /callcenter/lists, " +
        "/callcenter/campaigns, /callcenter/dispositions, /crm-module/search (query { q }), /admin/tenants/quota/usage, /pbx/numbers/availability. " +
        "Path is relative to /api. GET only; credentials are scrubbed from responses.",
      inputSchema: {
        path: z.string().regex(/^\/[A-Za-z0-9/_\-.]*$/, "Path must start with / and contain no query string").refine((p) => !p.includes(".."), "Invalid path"),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      },
      annotations: READ,
    },
    ({ path, query }) => run(() => get(path.startsWith("/api/") ? path.slice(4) : path, query)),
  );

  if (opts.readOnly) return;

  // ───────────────────────────── Writes ─────────────────────────────

  server.registerTool(
    "block_number",
    {
      title: "Block a phone number",
      description: "Adds a number to the PBX blacklist.",
      inputSchema: {
        phone: z.string(),
        direction: z.enum(["BOTH", "INBOUND", "OUTBOUND"]).optional().describe("Default BOTH"),
        reason: z.string().optional(),
        expiresAt: z.string().optional().describe("ISO date/time after which the block is lifted"),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    ({ phone, direction, reason, expiresAt }) =>
      run(() => api.request("POST", "/pbx/blocked-numbers", { body: { phoneRaw: phone.trim(), direction: direction ?? "BOTH", reason: reason ?? null, expiresAt: expiresAt ?? null } })),
  );

  server.registerTool(
    "unblock_number",
    {
      title: "Unblock a phone number",
      description: "Removes an entry from the PBX blacklist by its id (from list_blocked_numbers).",
      inputSchema: { id: z.string() },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    ({ id }) => run(() => api.request("DELETE", `/pbx/blocked-numbers/${encodeURIComponent(id)}`)),
  );

  server.registerTool(
    "cancel_callback_request",
    {
      title: "Cancel a callback request",
      description: "Deletes a pending callback request by id (from list_callback_requests).",
      inputSchema: { id: z.string() },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    ({ id }) => run(() => api.request("DELETE", `/pbx/callback-requests/${encodeURIComponent(id)}`)),
  );

  server.registerTool(
    "crm_add_note",
    {
      title: "Add a note to a CRM contact",
      description: "Appends a note to a CRM contact.",
      inputSchema: { contactId: z.string(), content: z.string().min(1) },
      annotations: WRITE,
    },
    ({ contactId, content }) => run(() => api.request("POST", `/crm-module/contacts/${encodeURIComponent(contactId)}/notes`, { body: { content: content.trim() } })),
  );

  server.registerTool(
    "crm_create_task",
    {
      title: "Create a CRM task",
      description: "Creates a CRM task, optionally linked to a contact.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().describe("Default MEDIUM"),
        dueDate: z.string().optional().describe("YYYY-MM-DD or ISO date/time"),
        contactId: z.string().optional(),
      },
      annotations: WRITE,
    },
    (args) => run(() => api.request("POST", "/crm-module/tasks", { body: clean({ ...args, priority: args.priority ?? "MEDIUM" }) })),
  );

  server.registerTool(
    "crm_schedule_callback",
    {
      title: "Schedule a callback for a CRM contact",
      description: "Schedules a callback (rappel) on a contact, optionally assigned to an agent (user id from list_agents).",
      inputSchema: {
        contactId: z.string(),
        dueDate: z.string().describe("Date/time of the callback, ISO 8601 (e.g. 2026-10-22T10:30:00+01:00)"),
        reason: z.string().optional(),
        assignedTo: z.string().optional().describe("Agent user id"),
        priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      },
      annotations: WRITE,
    },
    ({ contactId, dueDate, ...rest }) =>
      run(() => api.request("POST", `/crm-module/contacts/${encodeURIComponent(contactId)}/callback`, { body: clean({ dueDate: new Date(dueDate).toISOString(), ...rest }) })),
  );

  server.registerTool(
    "inbox_send_message",
    {
      title: "Send a message in an inbox conversation",
      description:
        "Sends a text message to the customer in an existing omnichannel conversation (WhatsApp, email…). This reaches the customer immediately: confirm the content with the user first.",
      inputSchema: {
        conversationId: z.string(),
        content: z.string().min(1),
        quotedMessageId: z.string().optional().describe("Reply to a specific message"),
      },
      annotations: { ...WRITE, idempotentHint: false },
    },
    ({ conversationId, content, quotedMessageId }) =>
      run(() => api.request("POST", `/omnichannel/conversations/${encodeURIComponent(conversationId)}/messages`, { body: clean({ content, type: "TEXT", quotedMessageId }) })),
  );

  server.registerTool(
    "agent_set_pause",
    {
      title: "Start or end a pause (logged-in agent)",
      description: "Puts the logged-in user's extension on pause with a break code (see list_pbx_config kind=break-types, e.g. LUNCH, COFFEE), or ends the pause when `code` is omitted.",
      inputSchema: { code: z.string().optional() },
      annotations: { ...WRITE, idempotentHint: true },
    },
    ({ code }) =>
      run(() =>
        code
          ? api.request("POST", "/callcenter/agent/pause-console", { body: { code } })
          : api.request("POST", "/callcenter/agent/pause-console/fin", { body: {} }),
      ),
  );

  server.registerTool(
    "mark_notifications_read",
    {
      title: "Mark notifications as read",
      description: "Marks one notification (by id) or all notifications as read.",
      inputSchema: { id: z.string().optional().describe("Omit to mark all as read") },
      annotations: { ...WRITE, idempotentHint: true },
    },
    ({ id }) => run(() => api.request("POST", id ? `/notifications/${encodeURIComponent(id)}/read` : "/notifications/read-all", { body: {} })),
  );
}
