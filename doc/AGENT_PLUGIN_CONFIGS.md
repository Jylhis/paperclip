# Agent Plugin Configs API

Per-agent MCP/LSP server configuration — lifecycle contracts, validation rules, and endpoint reference.

## Overview

Each agent can have zero or more plugin configs. A config defines how to launch an MCP or LSP server on the agent's behalf: the binary, arguments, environment, working directory, timeout, restart policy, and workspace scope.

All reads and writes are **company-scoped**: a request authenticated as companyA cannot access configs belonging to companyB's agents.

---

## Data Model

| Field            | Type                                    | Default        | Description                                                    |
|------------------|-----------------------------------------|----------------|----------------------------------------------------------------|
| `id`             | UUID                                    | auto           | Primary key                                                    |
| `agentId`        | UUID (FK → agents)                      | required       | Owning agent                                                   |
| `companyId`      | UUID (FK → companies)                   | required       | Company scope (cascade delete)                                 |
| `kind`           | `"mcp"` \| `"lsp"`                      | required       | Protocol kind                                                  |
| `name`           | string (1–256)                          | required       | Human-readable name, unique per agent                          |
| `serverBinary`   | string (1–512)                          | required       | Absolute path or plain command name (see validation rules)     |
| `args`           | string[] (max 64)                       | `[]`           | Arguments passed to the server binary                          |
| `env`            | Record<string, string>                  | `{}`           | Environment variables; secrets are redacted on reads           |
| `cwd`            | string \| null                          | `null`         | Working directory override                                     |
| `timeoutSec`     | integer (1–3600)                        | `30`           | Startup / idle timeout in seconds                              |
| `restartPolicy`  | `"never"` \| `"on_failure"` \| `"always"` | `"on_failure"` | When to restart the server after exit                          |
| `workspaceScope` | `"agent"` \| `"execution_workspace"`   | `"agent"`      | Whether the server is shared across the agent or per-workspace |
| `enabled`        | boolean                                 | `true`         | Whether the config is active                                   |
| `createdAt`      | timestamp                               | auto           |                                                                |
| `updatedAt`      | timestamp                               | auto           |                                                                |

### Unique constraint

`(agentId, name)` — one config per name per agent.

---

## Validation Rules

### `serverBinary`

The binary field is validated before any execution attempt:

- Must not be empty or exceed 512 characters.
- Must not contain `..` path segments (rejects traversal like `../../etc/evil`).
- Must not contain shell metacharacters: `;`, `|`, `&`, `` ` ``, `$`, `~`, `<`, `>`, `'`, `"`, `\`.
- Must be either an **absolute path** (starts with `/`) or a **plain command name** (alphanumeric, dots, hyphens — no spaces or slashes).

Valid examples: `/usr/bin/node`, `/home/user/.local/bin/mcp-server`, `node`, `npx`

Invalid examples: `../../etc/evil`, `/bin/sh;rm -rf /`, `$(evil)`, `path with spaces`

### `env` keys

Environment variable names must match `^[A-Za-z_][A-Za-z0-9_]*$`. Invalid names like `invalid-key` or `123_START` are rejected.

### Secret redaction

`env` values are **redacted** (replaced with `"[REDACTED]"`) in API responses when the key name matches any of these patterns (case-insensitive):

- ends with `_TOKEN`, `_SECRET`, `_PASSWORD`, `_PASS`, `_KEY`, `_CREDENTIAL`, `_CREDENTIALS`, `_AUTH`, `_APIKEY`
- starts with `PRIVATE_`

Stored values are never altered; redaction is read-time only.

---

## Endpoints

All endpoints are scoped to the authenticated company. The `agentId` must belong to the caller's company.

### List plugin configs

```
GET /api/agents/:agentId/plugin-configs
```

Returns all configs for the agent (env secrets redacted).

**Response:** `200 OK` — array of `AgentPluginConfig`

---

### Create plugin config

```
POST /api/agents/:agentId/plugin-configs
Content-Type: application/json
```

**Body:** `CreateAgentPluginConfig` (see schema below)

**Response:** `201 Created` — created `AgentPluginConfig` (env secrets redacted)

**Errors:**
- `404` — agent not found
- `409` — name already exists for this agent
- `422` — validation failure (invalid binary, env key, etc.)

---

### Update plugin config

```
PATCH /api/agents/:agentId/plugin-configs/:configId
Content-Type: application/json
```

Partial update — at least one field must be provided.

**Response:** `200 OK` — updated `AgentPluginConfig` (env secrets redacted)

**Errors:**
- `404` — config or agent not found
- `409` — rename collision
- `422` — empty body or validation failure

---

### Delete plugin config

```
DELETE /api/agents/:agentId/plugin-configs/:configId
```

**Response:** `200 OK` — `{ id: string }`

**Errors:**
- `404` — config or agent not found

---

## Route Constants

```typescript
import { API } from "@paperclipai/shared";

API.agentPluginConfigs  // "/api/agents/:agentId/plugin-configs"
```

---

## Migration

Added in migration `0095_agent_plugin_configs` — creates the `agent_plugin_configs` table with FK cascades on both `agent_id` and `company_id`.
