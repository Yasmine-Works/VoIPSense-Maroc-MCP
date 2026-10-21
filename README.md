# VoIPSense Maroc MCP Server

[![npm](https://img.shields.io/npm/v/voipsense-maroc-mcp.svg)](https://www.npmjs.com/package/voipsense-maroc-mcp)
[![CI](https://github.com/Yasmine-Works/VoIPSense-Maroc-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/Yasmine-Works/VoIPSense-Maroc-MCP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for the **[VoIPSense Cloud](https://app.voipsensemaroc.com) public API**.
It lets Claude (and any MCP client) place and control calls, read call results, fetch recordings and push leads into your call center, all in plain language.
An optional **console mode** adds dashboards, live switchboard status, PBX configuration, the built-in CRM and the omnichannel inbox.

> "Call 0612345678 from extension 11151, then send me yesterday's answered calls for the *Prospection Web* campaign."

🇫🇷 [Version française plus bas](#-démarrage-rapide-français)

---

## Features

| Tool | API endpoint | Permission | What it does |
|---|---|---|---|
| `make_call` | `POST /v1/calls` | `pbx:write` | Click-to-call (ring an extension, then dial out) or dial out and connect to a queue / IVR |
| `transfer_call` | `POST /v1/calls/{callId}/transfer` | `pbx:write` | Blind-transfer the remote party to an extension, queue or external number |
| `hangup_call` | `DELETE /v1/calls/{callId}` | `pbx:write` | Hang up every leg of a call |
| `list_calls` | `GET /v1/calls` | `cdr:read` | Call history and agent dispositions (filters: campaign, agent, status, direction, dates, search) |
| `list_recordings` | `GET /v1/recordings` | `recordings:read` | Search recordings by date, number, direction |
| `download_recording` | `GET /v1/recordings/download` | `recordings:read` | Save a recording (mp3) to disk |
| `inject_lead` | `POST /v1/leads` | `callcenter:write` | Add one contact to a list (idempotent) |
| `inject_leads_batch` | `POST /v1/leads/batch` | `callcenter:write` | Create list + campaign + enroll agents + inject leads in one step. **Any number of leads**: automatically split into batches of 500 |
| `list_lists` | `GET /v1/lists` | `callcenter:read` | Contact lists and their outbound line |
| `list_campaigns` | `GET /v1/campaigns` | `callcenter:read` | Campaigns, dial mode, agents, line routing |
| `list_dispositions` | `GET /v1/dispositions` | `callcenter:read` | Outcome codes agents set on calls |
| `ghl_list_subaccounts` | `GET /v1/ghl/subaccounts` | `callcenter:read` | Linked GoHighLevel sub-accounts and their services |
| `ghl_set_services` | `POST /v1/ghl/services` | `callcenter:write` | Set the service(s) requested by GoHighLevel contacts |

### Console mode tools (optional, `VOIPSENSE_EMAIL` + `VOIPSENSE_PASSWORD`)

These use the same API as the VoIPSense web console, authenticated as a console user. See [Console mode](#console-mode-optional) before enabling it.

| Tool | What it does |
|---|---|
| `get_analytics` | Dashboards: `kpis`, `hourly`, `dispositions`, `queues` (SLA), `agent-performance`, `agent-overview`, `abandoned-calls`, `top-agents`, `campaigns`, `lists`, `by-line` |
| `get_live_status` | Real-time state of every extension, active lines, callers waiting in queues, parked calls |
| `list_extensions` | Extensions with live registration status, caller ID, forwarding, recording policy (SIP secrets never returned) |
| `list_pbx_config` | Queues, ring groups, IVRs, opening hours (time conditions), conferences, announcements, class of service, outbound routing, directory, pause codes, skills… |
| `list_agents` | Call center agents (or all console users) |
| `get_account_overview` | Plan, resource summary, quota usage and alerts |
| `list_callback_requests` / `cancel_callback_request` | Callback requests left by callers |
| `list_blocked_numbers` / `block_number` / `unblock_number` | PBX blacklist |
| `list_voicemail` | Voicemail boxes and message counts |
| `crm_search_contacts` / `crm_get_contact` | Built-in CRM search, contact with notes, timeline, summary, tasks |
| `crm_list_tasks_and_deals` / `crm_create_task` / `crm_add_note` / `crm_schedule_callback` | CRM follow-up |
| `inbox_list_conversations` / `inbox_get_messages` / `inbox_send_message` | Omnichannel inbox (WhatsApp, email…) |
| `agent_set_pause` | Start/end a pause for the logged-in user |
| `list_notifications` / `mark_notifications_read` | Console notifications |
| `console_get` | Read-only escape hatch: GET any other console route (e.g. `/pbx/parked-calls`, `/callcenter/campaigns`) |

Write tools carry MCP annotations (`destructiveHint`, `idempotentHint`…) so clients like Claude ask for confirmation appropriately. A **read-only mode** removes every write tool (see [Configuration](#configuration)).

---

## 1. Get an API key

In the VoIPSense console: **Intégrations → API Keys → Nouvelle clé**.
Tick only the permissions you need (table above). The key (`vsk_…`) is shown **once**, so store it safely.

> Rate limit: **100 requests / minute** per key (HTTP 429 beyond that).

Requirements: **Node.js 18+** (`node -v`). Nothing else to install: `npx` downloads the server on first run.

---

## 2. Add it to Claude

### Claude Desktop

1. Open **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Add the server:

```json
{
  "mcpServers": {
    "voipsense": {
      "command": "npx",
      "args": ["-y", "voipsense-maroc-mcp"],
      "env": {
        "VOIPSENSE_API_KEY": "vsk_your_key_here"
      }
    }
  }
}
```

3. Quit Claude Desktop completely and reopen it. The VoIPSense tools appear under the 🔨 / connectors menu.

<details>
<summary>Windows: "npx not found" or the server doesn't start</summary>

Use `cmd` as the command:

```json
"voipsense": {
  "command": "cmd",
  "args": ["/c", "npx", "-y", "voipsense-maroc-mcp"],
  "env": { "VOIPSENSE_API_KEY": "vsk_your_key_here" }
}
```
</details>

### Claude Code (CLI)

```bash
claude mcp add voipsense --scope user -e VOIPSENSE_API_KEY=vsk_your_key_here -- npx -y voipsense-maroc-mcp
```

Check it with `claude mcp list`, or `/mcp` inside a session.
To share it with a team through the repo, use `--scope project`: this writes a `.mcp.json` file. Keep the key out of git by referencing an environment variable:

```json
{
  "mcpServers": {
    "voipsense": {
      "command": "npx",
      "args": ["-y", "voipsense-maroc-mcp"],
      "env": { "VOIPSENSE_API_KEY": "${VOIPSENSE_API_KEY}" }
    }
  }
}
```

### Claude.ai (web) and mobile

Claude.ai custom connectors need a **remote** (HTTP) MCP server. This package runs locally over stdio, so use Claude Desktop or Claude Code.

### Other MCP clients

<details>
<summary>Cursor</summary>

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "voipsense": {
      "command": "npx",
      "args": ["-y", "voipsense-maroc-mcp"],
      "env": { "VOIPSENSE_API_KEY": "vsk_your_key_here" }
    }
  }
}
```
</details>

<details>
<summary>VS Code (GitHub Copilot agent mode)</summary>

`.vscode/mcp.json`. The key is prompted once and stored securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "voipsense-key", "description": "VoIPSense API key", "password": true }
  ],
  "servers": {
    "voipsense": {
      "command": "npx",
      "args": ["-y", "voipsense-maroc-mcp"],
      "env": { "VOIPSENSE_API_KEY": "${input:voipsense-key}" }
    }
  }
}
```
</details>

<details>
<summary>Windsurf, Cline, Zed, others</summary>

Any client that supports stdio MCP servers works. Command: `npx`, args: `["-y", "voipsense-maroc-mcp"]`, env: `VOIPSENSE_API_KEY`.
</details>

---

## Configuration

| Environment variable | Required | Default | Description |
|---|---|---|---|
| `VOIPSENSE_API_KEY` | ✅ * | | Your `vsk_…` API key (public API tools) |
| `VOIPSENSE_EMAIL` | ✅ * | | Console user email (console mode) |
| `VOIPSENSE_PASSWORD` | ✅ * | | Console user password (console mode) |
| `VOIPSENSE_READ_ONLY` | | `false` | `true` to expose only read tools (no calls, no lead injection) |
| `VOIPSENSE_DOWNLOAD_DIR` | | `~/Downloads/voipsense` | Where `download_recording` saves files |
| `VOIPSENSE_BASE_URL` | | `https://app.voipsensemaroc.com/api/v1` | API base URL (for staging or a white-label host) |

\* Set the API key, the console credentials, or both. Each set enables its own group of tools.

Tip: for reporting-only use, create a key with just `cdr:read` / `recordings:read` / `callcenter:read` **and** set `VOIPSENSE_READ_ONLY=true`.

---

## Console mode (optional)

Console mode signs in to the VoIPSense web console with an email and password, exactly like the browser does
(`POST /api/auth/login` → 24h access token, renewed automatically with the 30-day refresh cookie). It unlocks the console tools listed above.

```json
"env": {
  "VOIPSENSE_API_KEY": "vsk_your_key_here",
  "VOIPSENSE_EMAIL": "mcp-bot@your-company.ma",
  "VOIPSENSE_PASSWORD": "a-strong-password"
}
```

Before enabling it:

- **Create a dedicated user** for the MCP server (Paramètres → Utilisateurs) with the lowest role that covers your needs (`SUPERVISOR` for reporting, `ADMIN` only if required). Don't use your personal admin account: everything the tools do is done as that user.
- **Two-factor authentication is not supported**: the dedicated user must not have 2FA enabled.
- **The password sits in your MCP config file** in plain text, like the API key. Keep that file private, and prefer `${VOIPSENSE_PASSWORD}` environment references in shared `.mcp.json` files.
- **This API is not the documented public API.** Routes were mapped from the web console and may change without notice. If a console tool breaks, the public API tools keep working.
- Use `VOIPSENSE_READ_ONLY=true` to keep console mode to reads only.

---

## Example prompts

- *"Call 0612345678 and connect it to extension 11151 with caller ID 0520123456."*
- *"Transfer call api-lq2x9-12345 to queue 8001."* / *"Hang up that call."*
- *"Show me all outbound answered calls since June 1st, grouped by disposition."*
- *"Find the recordings for 0612345678 this month and download the latest one."*
- *"Create the list 'Leads Site Web : Août' on a new 'Prospection Web' campaign, assign all agents, and inject these 1,200 leads from leads.csv."*
- *"Which outbound line does each campaign use?"*
- *"Tag contact 0600000000 in the Clinique Atlas sub-account with the services Implant and Blanchiment."*
- *(console)* *"Who is available right now, and is anyone waiting in a queue?"*
- *(console)* *"Compare this week's answer rate per agent and per line, and list abandoned calls over 30 s."*
- *(console)* *"Block 0522000000 for outbound calls until the end of the month."*
- *(console)* *"Show open WhatsApp conversations and summarize the last messages of each."*

---

## Good to know (from the VoIPSense API guide)

- **Leads are idempotent** per phone number and list: resending the same file creates no duplicates (`duplicates` counter). Add `updateIfExists: true` to update existing contacts (their `customFields` are then fully replaced).
- **A list without a campaign is invisible to agents**, and a campaign without enrolled agents shows an empty console. `inject_leads_batch` with `campaignName` + `createCampaign` + `assignAllAgents` (or `agents`) handles both in one step.
- API-created campaigns are `PREVIEW` / `ACTIVE`: agents receive leads as soon as they're "ready". `MANUAL` serves no leads.
- **Outbound line priority**: list line (`outboundLine`, set at list creation) → campaign line → first active / first free line.
- Unknown agents in `agents` → `400` and nothing is written; partially valid → `agentsNotFound` + `warning` in the response.
- Real-time webhooks (`call.started`, `call.ended`, `disposition.submitted`…) and CRM sync are configured in the console, not through this server.

### Error codes

| Code | Meaning |
|---|---|
| 400 | Invalid or missing parameters |
| 401 | Missing or invalid API key |
| 403 | Permission missing for this key (or plan quota reached) |
| 404 | Not found: recording, unknown or ended call, extension or queue |
| 409 | Tenant not provisioned · call not yet established (transfer) · no active channel (hangup) |
| 422 | Destination unreachable from this call |
| 429 | Rate limit exceeded (100/min) |
| 502 | Telephony failure (origination, transfer) |

---

## Development

```bash
git clone https://github.com/Yasmine-Works/VoIPSense-Maroc-MCP.git
cd VoIPSense-Maroc-MCP
npm install
npm run build
VOIPSENSE_API_KEY=vsk_... npm run inspect   # opens the MCP Inspector
```

Run your local build from Claude Code:

```bash
claude mcp add voipsense-dev -e VOIPSENSE_API_KEY=vsk_... -- node /absolute/path/to/VoIPSense-Maroc-MCP/dist/index.js
```

### Releasing

1. Bump the version: `npm version patch` (or `minor` / `major`).
2. `git push --follow-tags`.
3. Create a GitHub Release for the tag. The **Publish** workflow publishes to npm with provenance. It needs an `NPM_TOKEN` repository secret (npm granular access token with publish rights on `voipsense-maroc-mcp`).

---

## 🇫🇷 Démarrage rapide (français)

Serveur MCP pour l'**API publique VoIPSense Cloud** : lancer / transférer / raccrocher des appels, lire les résultats et dispositions, télécharger les enregistrements, injecter des leads (liste + campagne + agents en un seul appel) et gérer les services GoHighLevel, directement depuis Claude.

1. **Clé API** : Console VoIPSense → **Intégrations → API Keys → Nouvelle clé**. Cochez les permissions utiles (`pbx:write`, `cdr:read`, `recordings:read`, `callcenter:read`, `callcenter:write`). La clé n'est affichée qu'une seule fois.
2. **Claude Desktop** : Réglages → Développeur → Modifier la config, puis ajoutez :

   ```json
   {
     "mcpServers": {
       "voipsense": {
         "command": "npx",
         "args": ["-y", "voipsense-maroc-mcp"],
         "env": { "VOIPSENSE_API_KEY": "vsk_votre_cle_ici" }
       }
     }
   }
   ```

   Redémarrez Claude Desktop.
3. **Claude Code** :

   ```bash
   claude mcp add voipsense --scope user -e VOIPSENSE_API_KEY=vsk_votre_cle_ici -- npx -y voipsense-maroc-mcp
   ```

4. Demandez par exemple : *« Appelle le 0612345678 depuis le poste 11151 »*, *« Liste les appels répondus de la campagne Prospection Web depuis le 1er juin »*, *« Injecte ces leads dans la liste "Leads Site Web : Août" sur la campagne "Prospection Web" et inscris tous les agents »*.

Mode console (optionnel) : ajoutez `VOIPSENSE_EMAIL` et `VOIPSENSE_PASSWORD` d'un **utilisateur dédié sans 2FA** pour débloquer statistiques, état en direct des postes et files, configuration PBX, CRM et boîte de réception omnicanale. Cette API est celle de la console web (non documentée) : elle peut évoluer sans préavis.

Mode lecture seule : ajoutez `"VOIPSENSE_READ_ONLY": "true"` dans `env`.
Support VoIPSense : contact@voipsensemaroc.com

---

## License

[MIT](LICENSE). This is a community integration and is not an official VoIPSense product.
