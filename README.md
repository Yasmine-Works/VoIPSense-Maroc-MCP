# VoIPSense Maroc MCP Server

[![npm](https://img.shields.io/npm/v/voipsense-maroc-mcp.svg)](https://www.npmjs.com/package/voipsense-maroc-mcp)
[![CI](https://github.com/Yasmine-Works/VoIPSense-Maroc-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/Yasmine-Works/VoIPSense-Maroc-MCP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for the **[VoIPSense Cloud](https://app.voipsensemaroc.com) public API**.
It lets Claude (and any MCP client) place and control calls, read call results, fetch recordings and push leads into your call center, all in plain language.

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
| `VOIPSENSE_API_KEY` | ✅ | | Your `vsk_…` API key |
| `VOIPSENSE_READ_ONLY` | | `false` | `true` to expose only read tools (no calls, no lead injection) |
| `VOIPSENSE_DOWNLOAD_DIR` | | `~/Downloads/voipsense` | Where `download_recording` saves files |
| `VOIPSENSE_BASE_URL` | | `https://app.voipsensemaroc.com/api/v1` | API base URL (for staging or a white-label host) |

Tip: for reporting-only use, create a key with just `cdr:read` / `recordings:read` / `callcenter:read` **and** set `VOIPSENSE_READ_ONLY=true`.

---

## Example prompts

- *"Call 0612345678 and connect it to extension 11151 with caller ID 0520123456."*
- *"Transfer call api-lq2x9-12345 to queue 8001."* / *"Hang up that call."*
- *"Show me all outbound answered calls since June 1st, grouped by disposition."*
- *"Find the recordings for 0612345678 this month and download the latest one."*
- *"Create the list 'Leads Site Web : Août' on a new 'Prospection Web' campaign, assign all agents, and inject these 1,200 leads from leads.csv."*
- *"Which outbound line does each campaign use?"*
- *"Tag contact 0600000000 in the Clinique Atlas sub-account with the services Implant and Blanchiment."*

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

Mode lecture seule : ajoutez `"VOIPSENSE_READ_ONLY": "true"` dans `env`.
Support VoIPSense : contact@voipsensemaroc.com

---

## License

[MIT](LICENSE). This is a community integration and is not an official VoIPSense product.
