# AGENTS.md

Operating guide for AI coding agents working in this repository. Read this
before making changes. Pair it with [`README.md`](README.md) for the full
project overview and [`spec.md`](spec.md) for product intent.

---

## Golden rules (non-negotiable)

These constraints take precedence over convenience. Do not violate them.

1. **Plan, then wait for approval.** For any non-trivial change, present a short
   plan and get explicit approval **before** implementing. Fixing a clearly
   described bug directly is acceptable; new features and structural changes are not.
2. **No new Markdown files unless explicitly requested.** Do not create `.md`
   files, changelogs, or docs on your own initiative. Instead, **update the
   existing `README.md`** (and relevant design docs) when your change alters the
   public API or architecture.
3. **No tests unless explicitly requested.** Do not add or generate unit/integration
   tests unless the user asks for them.
4. **Stick to the approved stack.**
   - Web: **React + Vite + TypeScript** (shadcn/ui is in use and fine).
   - If/when an AI agent is added: **Strands Agents + TypeScript**, and the model
     **must be Claude Haiku 4.5 on Amazon Bedrock**. Do not substitute models.
5. **Never hardcode secrets or identifiers.** No client secrets, API keys, client
   IDs, or resource IDs in source. Use env vars / AWS Secrets Manager. Reference
   secrets by name, never echo their values.
6. **Commit discipline.**
   - One logical purpose per commit; keep commits **under 150 lines** of source.
     Split larger work into sequential commits.
   - Message format: a **single-sentence summary**, a blank line, then a detailed
     explanation (**max 20 lines**) covering the change and how it was verified.
   - Attribute authorship to Kiro:
     ```bash
     git commit --author="[Git Username] (Kiro) <[User Email]>"
     ```
   - Only commit when asked. Stage specific files (avoid `git add .`). Never force-push.

---

## What this project is

A config-driven, multi-sport fantasy league engine. Competitions are **data, not
code** — the generic engine runs any sport from a `Competition` record (roster
config, transfer rules, scoring ruleset, chips). Launch target: World Cup 2026.

- Frontend: `apps/web` (React 18 + Vite + Tailwind v3 + shadcn/ui + TanStack Query + Zustand).
- Backend: `services/*` Lambda services behind one API Gateway dispatcher.
- Shared code: `packages/shared` (`@fantasy/shared`) — types, Zod schemas, DB layer, middleware.
- Infra: `infra/cdk` — AWS CDK v2 app (`FantasyLeague-<stage>`).

---

## Repo map (where to make changes)

| You want to change…                      | Edit here                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| A page or UI component                   | `apps/web/src/pages`, `apps/web/src/components` (kit in `components/ui`) |
| Frontend data fetching                   | `apps/web/src/hooks/use-api.ts`, `apps/web/src/lib/api-client.ts`        |
| Domain types / Zod schemas               | `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`         |
| DynamoDB keys / repository               | `packages/shared/src/db`                                                 |
| API middleware (auth, envelope, logging) | `packages/shared/src/middleware`                                         |
| Business logic for a domain              | `services/<name>/src/<name>-service.ts`                                  |
| A Lambda's HTTP routing                  | `services/<name>/src/handler.ts`                                         |
| Which service owns a path                | `services/api-gateway/src/handler.ts` (dispatcher)                       |
| Infrastructure / resources               | `infra/cdk/src/lib/*.ts`, wired in `root-stack.ts`                       |
| Deploy stages                            | `infra/cdk/src/config/environments.ts`                                   |
| Seed data                                | `scripts/seed-*.ts`                                                      |

---

## Essential commands

Run from the repo root unless noted. Node ≥ 20.

```bash
npm install                                   # install all workspaces
npm run build                                 # build every workspace (shared first)
npm run build --workspace=apps/web            # build one workspace
npm run lint                                  # eslint (.ts/.tsx)
npm run format:check                          # prettier check (use `npm run format` to write)
npm run dev --workspace=apps/web              # web dev server, http://localhost:3000
npm run seed:worldcup                         # seed World Cup data into DynamoDB

cd infra/cdk && npx cdk deploy -c stage=dev   # deploy backend (dev stage)
```

There is no standalone `typecheck` script. Type-checking happens during builds:
the web app build runs `tsc --noEmit && vite build`; services and `shared`
compile with `tsc`.

---

## Architecture conventions you must respect

- **Dispatcher routing.** All REST traffic enters one Lambda
  (`services/api-gateway`) that routes by **path prefix** to the owning service.
  When you add an endpoint, wire its prefix in the dispatcher and keep the
  ordering rule: **specific patterns before generic ones**.
- **Self-enforced auth.** The proxy route is `authorizationType: NONE`. Each
  service enforces auth itself via the shared `createHandler({ requireAuth: true })`
  middleware (JWT verified with `aws-jwt-verify`). Do not assume an API Gateway
  authorizer populated the context.
- **Path parameters.** The REST API uses a catch-all `{proxy+}`, so only the
  `proxy` param is populated. Services that need path params **parse the path
  segments themselves** (see existing handlers for the pattern). Follow suit.
- **Response envelope.** Always return the standard envelope
  (`{ success, data, meta }` / `{ success, error, meta }`). Use the shared
  `success()` / `error()` / `AppError` helpers — don't hand-roll responses.
- **Single-table DynamoDB.** One table, access-pattern-first. Build keys with the
  helpers in `packages/shared/src/db`; never invent ad-hoc key formats. Conventional
  attributes: `PK`, `SK`, `GSI1PK`, `GSI1SK`, …
- **Config-driven competitions.** Do not hardcode competition- or sport-specific
  logic in shared services. Behavior comes from the `Competition` record
  (`rosterConfig`, `transferRules`, `scoringRulesetId`, `chips`). Adding a sport
  should not require touching the frontend.
- **Shared types are the contract.** Import domain types and schemas from
  `@fantasy/shared` on both ends. If you change a shared type, rebuild `shared`
  before dependents and update both the service and the web usage.

---

## Code style

- **TypeScript strict** everywhere. Avoid `any` (lint warns on it).
- **Prettier**, ~100-char width — run `npm run format` before finishing.
- **Naming**: files `kebab-case.ts` / `PascalCase.tsx` (components); `camelCase`
  for vars/functions; `PascalCase` for types/interfaces; `SCREAMING_SNAKE_CASE`
  for constants; `PK`/`SK`/`GSI*` for DynamoDB keys.
- **Frontend**: server state via TanStack Query (the `useApiQuery` / `useApiMutation`
  hooks); client state via Zustand; lazy-load routes; only memoize when warranted.
  Use the brand tokens (`bg-primary`, `text-muted-foreground`, `bg-success`,
  `bg-destructive`, `font-display`, `font-mono` + `tabular-nums`) — no raw
  `text-blue-600`-style color utilities.
- **Backend**: thin handler → service → repository. Keep Lambdas idempotent; log
  with the shared structured logger (correlation/request IDs).

---

## Before you call a task done

1. `npm run build` (or at least the affected workspaces) — must pass.
2. `npm run lint` and `npm run format:check` — must pass.
3. For frontend work, confirm the web build (`npm run build --workspace=apps/web`)
   succeeds; render-verify if a dev server is available.
4. State what you verified and what you couldn't. A clean compile is not proof a
   feature works.

---

## Change boundaries

**Ask first before:**

- Adding a new npm dependency.
- Changing the DynamoDB schema or GSI definitions.
- Modifying CDK stacks / infrastructure.
- Altering the scoring engine algorithm.
- Changing authentication flows or token handling.
- Adding a new data-provider integration.

**Never:**

- Commit secrets, credentials, or resource IDs.
- Edit `node_modules/` or lock files by hand.
- Deploy directly to `prod` outside the `main` flow.
- Hardcode competition-specific logic into shared services.
- Add tests or new Markdown files unless explicitly asked.

---

## Known gotchas

- **Cognito drift on redeploy.** Redeploying the Auth stack can reset
  `AllowAdminCreateUserOnly` back to `true`, which breaks self sign-up. If sign-up
  starts failing after an infra deploy, re-check that user-pool setting.
- **Auth token storage.** The web app stores tokens in the Zustand auth store
  (persist key `fantasy_auth`); the API client reads
  `useAuthStore.getState().tokens?.accessToken`. Don't reach for
  `localStorage['access_token']`.
- **`VITE_API_URL`.** The frontend's API base URL comes from this env var
  (`apps/web/.env.local`). If it's empty, requests go to a relative path.
- **Scoring is implemented but not fully operational.** The compute engine exists
  (`services/scoring`), but there's no full per-player stats feed yet — only a
  goals-based approximation runs via the daily World Cup sync. Team scores and
  standings can therefore read 0. Don't assume live points are flowing end-to-end.
- **Build order matters.** `@fantasy/shared` must be built before services and the
  web app that import it (`npm run build` handles ordering across workspaces).
