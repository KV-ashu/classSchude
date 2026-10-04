# ClassSync

AI-powered college schedule assistant. Extracts schedule changes from messages (via pluggable adapters),
validates them with an LLM pipeline, and keeps a student's **effective** timetable in sync in real time —
while the confirmed **baseline** timetable stays immutable.

See [`project_plan.md`](./project_plan.md) for the full phased roadmap.

## Stack

- **Monorepo:** npm workspaces — `apps/web`, `apps/server`, `packages/shared`
- **Web:** React + TypeScript + Vite + TailwindCSS + React Router (+ Socket.IO client)
- **Server:** Node.js + Express + TypeScript + Socket.IO
- **Database:** MongoDB via Mongoose
- **Validation / AI:** Zod, LLM provider abstraction (Google Gemini via `@google/genai`)

## Requirements

- Node.js >= 20.19 (developed on Node 24)
- On Windows: if `npm` is blocked by PowerShell execution policy, use `npm.cmd` (all scripts work the same).

## Getting started

```bash
npm install

# optional - defaults are dev-friendly; copy to override
copy apps\server\.env.example apps\server\.env

npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/api/health (the web dev server proxies `/api` to it)

## Root scripts

| Script                | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Runs server + web in watch mode (concurrently)     |
| `npm run build`       | Builds every workspace (`tsup` / `vite build`)     |
| `npm run typecheck`   | Strict TypeScript check in every workspace         |
| `npm test`            | Runs Vitest suite in every workspace               |
| `npm run lint`        | ESLint (flat config, type-aware rules off by default) |
| `npm run format`      | Prettier write                                     |

## Workspace layout

```
apps/
  web/      React client (Vite) - dashboard, timetable, review, messages, changes
  server/   Express API + real-time layer + AI pipeline (phases 2-7)
packages/
  shared/   Zod schemas, enums, MessageEvent + MessageSourceAdapter contracts,
            confidence thresholds, Socket.IO event names (imported by both apps)
```

## Configuration notes

- All server config is parsed and validated with Zod in `apps/server/src/config/env.ts`.
- `LLM_PROVIDER=stub` runs the pipeline without any API key (used until Phase 6 wiring).
- Default timezone: `Asia/Kolkata` (`TZ_DEFAULT`).

## Status

Phase 4 complete (MessageSourceAdapters + ingestion/dedup + message API).
Next: Phase 5 — processing pipeline (relevance classification, Gemini extraction, change review & apply).
