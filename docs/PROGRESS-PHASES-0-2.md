# AnyGen – Progress: Phases 0–2

Status: Phases 0 (scaffold), 1 (graph engine) and 2 (server) are implemented. 56 tests pass; lint, Prettier and typechecks for `core`, `nodes` and the Nitro server code are clean. The server was also exercised end-to-end over HTTP, SSE and WebSocket, under `nuxt dev` and from a built `.output`.

Not yet done: the first-workflow nodes (Load Image, Vision Structured Output, Save JSON), the editor UI (Phase 3), `nuxt typecheck` of the Vue part, and the quiz runner JSON format (still unknown).

## Commands

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `pnpm dev`       | Runs the Nuxt app (UI + server) from `app/`               |
| `pnpm build`     | Production build of the app                               |
| `pnpm test`      | Vitest, all packages and the server layer                 |
| `pnpm lint`      | ESLint (typescript-eslint + eslint-plugin-vue + Prettier) |
| `pnpm format`    | Prettier write (`format:check` to verify)                 |
| `pnpm typecheck` | `tsc` for `packages/core` and `packages/nodes`            |

## Phase 0 – Scaffold

- pnpm workspace: `packages/core`, `packages/nodes`, `app`.
- Nuxt **4.6** (Nitro 2.13, h3 1.15), Pinia, TypeScript 6, Zod 4, Vitest 4, ESLint 10, Prettier.
- The Nuxt project root is `app/` itself (`srcDir: '.'`), so `pages/`, `components/` and `server/` sit directly under `app/`, matching `PLAN.md`.
- Workspace packages export TypeScript source (no build step); Nuxt transpiles them.
- `nitro.experimental.websocket` is enabled.

## Phase 1 – Graph engine (`packages/core`)

| File          | Purpose                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ports.ts`    | Port types (`text`, `number`, `boolean`, `image`, `audio`, `video`, `json`, `any`, `list<T>`) and compatibility rules |
| `types.ts`    | Zod schemas for ports, params and node definitions; `defineNode`; `ExecutionContext`                                  |
| `graph.ts`    | Versioned graph schema (`{ version, nodes, edges }`), `parseGraph`, `topologicalSort`                                 |
| `registry.ts` | `NodeRegistry`, `registerNode`, JSON-safe `catalog()` (no `execute` functions)                                        |
| `validate.ts` | Unknown types/nodes/ports, duplicate ids, type mismatches, fan-in, missing required inputs, cycles                    |
| `cache.ts`    | `MemoryCache`, stable hashing of node type + version + inputs + params                                                |
| `events.ts`   | `run:start`, `node:start\|progress\|done\|error\|skipped\|cancelled`, `run:done`                                      |
| `executor.ts` | The executor                                                                                                          |
| `services.ts` | `AssetRef`, `AssetStore`, `SecretStore`, `getServices(ctx)`                                                           |

Executor behaviour:

- Independent branches run in parallel; optional `maxConcurrency`.
- Per-node caching (opt out with `cache: false`; bump a node's `version` to invalidate).
- Cancellation via `AbortSignal`; the run returns promptly even if a node ignores the signal.
- A failing node causes only its dependents to be skipped; sibling branches finish.
- `targets` runs the selected nodes plus their dependencies ("run selected").
- Cached nodes emit `node:done` with `cached: true` and no `node:start`.
- Listener exceptions never break a run.

## Phase 2 – Server (`app/server`)

### Layout

- `server/lib/` – framework-agnostic logic, built from factories so it is testable without Nuxt: `db`, `workflows`, `assets`, `secrets`, `settings`, `runs`, `ws-protocol`, `context`.
- `server/utils/` – `useAnyGen()` singleton and HTTP helpers (`defineApiHandler`, `readJson`, `notFound`), auto-imported by Nitro.
- `server/api/`, `server/routes/_ws.ts` – thin route handlers.

### Endpoints

| Area         | Routes                                                                              |
| ------------ | ----------------------------------------------------------------------------------- |
| Node catalog | `GET /api/nodes`                                                                    |
| Workflows    | `GET`/`POST /api/workflows`, `GET`/`PUT`/`DELETE /api/workflows/:id`                |
| Assets       | `POST /api/assets` (multipart), `GET /api/assets/:id`                               |
| Settings     | `GET`/`PUT /api/settings`, `PUT`/`DELETE /api/settings/keys/:provider`              |
| Runs         | `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel` |
| Run events   | `GET /api/runs/:id/events` (SSE fallback); WebSocket at `/_ws`                      |

`POST /api/runs` accepts `{ graph }` or `{ workflowId }`, plus optional `targets`. Invalid graphs return 422 with the validation issues; malformed bodies return 400.

### WebSocket protocol

Client → server:

```json
{ "type": "run", "graph": { }, "workflowId": "…", "targets": ["nodeId"], "requestId": "…" }
{ "type": "cancel", "runId": "…" }
```

Server → client: `accepted` (with `runId`, echoes `requestId`), `event` (any execution event), `cancelling` (`ok` flag), `error` (with `issues` for invalid graphs). A peer receives the events of runs it started. Closing the socket stops streaming but does not cancel the run; results are still persisted.

### Storage

SQLite via Node's built-in `node:sqlite` (no native module). Tables: `workflows`, `runs`, `run_node_results`, `assets`, `settings`. Runs left in `running` by a crashed process are marked `cancelled` on next start. The node result cache is in memory and resets on server restart; run history persists.

Data lives in `<repo>/data` (gitignored) unless `ANYGEN_DATA_DIR` is set.

### Assets

Content-addressed: the id is the SHA-256 of the bytes, so identical files produce identical references and cache keys stay stable. Ids are validated against `^[0-9a-f]{64}$` (path traversal returns 404). Uploads are limited to 100 MB. Downloads send `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` because uploaded content is untrusted.

### API keys

Resolution order: environment variable, then the encrypted stored key. Stored keys use AES-256-GCM with a local `secret.key` file in the data dir. The settings API only reports whether a provider is configured and its source (`env` or `stored`), never the key. See `app/.env.example`.

| Provider  | Env var               |
| --------- | --------------------- |
| anthropic | `ANTHROPIC_API_KEY`   |
| openai    | `OPENAI_API_KEY`      |
| replicate | `REPLICATE_API_TOKEN` |
| fal       | `FAL_KEY`             |

The only non-secret setting currently allowed is `ollamaBaseUrl`.

### Built-in nodes so far

`core/text` (Input) and `core/concat` (Utility), enough to run graphs end to end.

## Notes and caveats

- `node:sqlite` prints an "experimental" warning, and Nitro logs a harmless "could not be resolved, treating as external" notice during builds. The built server works.
- There is no authentication. This is fine for localhost; do not expose the server with `--host` without adding auth.
- Prettier was run over the whole repo, so `docs/` files were reformatted cosmetically.
- The Bash tool used in this environment fails on heredocs containing apostrophes; files were created with the Write tool instead.

## Next steps

1. Verify the current AI SDK structured-output API (`generateObject` vs `generateText` + `Output.object`) and pin versions.
2. Get the quiz runner's JSON format (or a sample file) from the user.
3. Implement Load Image, Vision Structured Output (Anthropic) and Save JSON in `packages/nodes`.
4. Phase 3: BaklavaJS editor, catalog-to-node factory, graph converter, run controls.
