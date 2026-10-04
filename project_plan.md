# ClassSync — Project Plan

**Status:** Planning — awaiting go-ahead for Phase 1
**Workspace audit:** `d:\Projects\classschedule` is empty (no git, no files). Greenfield monorepo build.

## 1. Product Summary

ClassSync is a web app (SaaS) that keeps a college student's timetable truthful in real time:

1. The student imports/enters an official timetable -> **Baseline**.
2. Chaos-prone messages mentioning schedule changes arrive through one or more **MessageSourceAdapters** (manual input + demo simulator now; optional Android notification scraper later). No official WhatsApp API is assumed.
3. A staged pipeline classifies, extracts, validates, scores, and applies changes -> the **Effective** timetable updates live over Socket.IO.

## 2. Core Architecture

### 2.1 Baseline vs Effective (the immutability contract)

- `TimetableEntry` documents are the **Baseline**: user-confirmed, **immutable** once locked. No pipeline code ever mutates them.
- The **Effective timetable** is a derived projection: `Effective = Baseline + applied ScheduleChanges (for a given occurrence date)`.
- Every mutation is expressed as a `ScheduleChange` (CANCEL, RESCHEDULE_TIME, CHANGE_ROOM, MARK_ONLINE, ...) carrying `oldValue` / `newValue`, confidence, and status.
- Apply service order: resolve affected `TimetableEntry` + occurrence date -> conflict check -> write immutable `AuditLog` (before/after snapshot) -> emit real-time event.
- **Revert** appends a new `AuditLog` entry marking the change reverted and recomputes the projection. History is never deleted; Baseline is never touched.

### 2.2 Message Adapter (decoupled ingestion)

`MessageSourceAdapter` interface (lives in `packages/shared`):

- `readonly id: string`
- `readonly kind: 'manual' | 'simulator' | 'android-scraper'`
- `start(emit: (event: MessageEvent) => void): Promise<void>`
- `stop(): Promise<void>`

All adapters normalize into a single **`MessageEvent`**: `{ sourceId, sourceKind, externalId?, timestamp, rawText, senderName?, groupName?, metadata }`.

- The pipeline consumes only `MessageEvent`; it never knows the origin.
- Planned adapters: `ManualInputAdapter` (REST `POST /api/messages`), `SimulatorAdapter` (demo panel), future `AndroidScraperAdapter`.
- Dedup: `hash = sha256(sourceId + externalId ?? senderName + timestamp + rawText)`, unique index on `RawMessage`.

### 2.3 Pipeline (staged, server-side)

1. **Normalization** — trim/collapse whitespace, keep original text verbatim for audit.
2. **Relevance classification (local)** — course-alias match + change-intent rules. Non-relevant -> stored as `IGNORED`, zero LLM cost.
3. **LLM extraction** — provider-agnostic via `LLMProvider`; output is `unknown` until **Zod-validated** into `ScheduleChangeDraft[]`.
4. **Validation & resolution** — resolve relative dates ("tomorrow", "kal") and times against `MessageEvent.timestamp` in the user's timezone (default Asia/Kolkata); fuzzy-match course against the alias index; never invent missing dates/times/rooms.
5. **Conflict check** — overlap with any other effective entry on the same date is flagged, never silently applied.
6. **Confidence scoring** — deterministic score from extraction certainty, alias-match strength, ambiguity cues, and conflict status.
7. **Decision** — `>= 0.90` auto-apply; `0.70–0.89` -> `PENDING_REVIEW`; `< 0.70` -> `REJECTED` (kept for audit).
8. **Apply + broadcast** — write AuditLog, emit Socket.IO events (`schedule:change-applied`, `review:queued`, `message:processing`).

### 2.4 Monorepo layout

```
classschedule/
  apps/
    web/      # React + TS + Vite + Tailwind + React Router + socket.io-client
    server/   # Node + Express + TS + Socket.IO + Mongoose + pipeline
  packages/
    shared/   # Zod schemas + inferred types, enums, MessageEvent, adapter
              # interface, confidence thresholds, Socket.IO event contract
```

`packages/shared` is the single source of truth for contracts consumed by both apps.

## 3. Data Models (MongoDB via Mongoose + Zod mirrors in shared)

| Model | Purpose | Key fields | Indexes / rules |
|---|---|---|---|
| **User** | Auth + profile | email, passwordHash, name, college, timezone (default `Asia/Kolkata`), llmSettings | unique email |
| **Course** | Course catalog | name, code, **aliases[]** ("DBMS", "Database"), defaultRoom, defaultDurationMin, color | unique (userId, code); text index on name+aliases |
| **TimetableEntry** (Baseline) | Official timetable | userId, courseId, dayOfWeek (or explicit date), startTime, endTime, room, kind (LECTURE/LAB/TUTORIAL), baselineVersion, locked | compound (userId, dayOfWeek, startTime); **write-guard: no mutation once `locked=true`** |
| **RawMessage** | Ingested message | sourceId, sourceKind, externalId, timestamp, rawText, hash, status, processingErrors[], llmMeta | unique hash (dedup); (userId, timestamp desc) |
| **ScheduleChange** | One proposed/applied mutation | rawMessageId, targetEntryId, occurrenceDate, action, oldValue, newValue, confidence, confidenceFactors, status (PENDING_REVIEW / AUTO_APPLIED / APPLIED_MANUALLY / REJECTED / REVERTED), appliedBy, revertedByAuditId | (userId, occurrenceDate); (status) |
| **AuditLog** | Immutable trail | actor (AI/USER/SYSTEM), changeId, action, beforeSnapshot, afterSnapshot, reason, createdAt | append-only; no update/delete routes |

Supporting types (shared, Zod-first): `MessageEvent`, `ScheduleChangeDraft`, `ExtractedChange`, `PipelineStatus` state machine (`RECEIVED -> NORMALIZED -> CLASSIFIED -> EXTRACTING -> VALIDATED -> APPLIED | QUEUED | REJECTED | FAILED`).

## 4. Implementation Phases

Each phase ends in a verifiable demo + tests. Phases are dependency-ordered; UI is deliberately late because the pipeline contract must be frozen first.

### Phase 0 — Repo audit (DONE)
Workspace confirmed empty. Greenfield.

### Phase 1 — Monorepo & Tooling Skeleton ✅ done (2026-10-04)
**Result:** npm workspaces boot with `npm run dev` (server :4000 + web :5173 with `/api` proxy); strict TS typecheck, 19 Vitest tests, ESLint and production builds all green. Stack pinned: TS 6, Vite 8, React 19.3, Tailwind 4.3, Express 5.2, Vitest 5, ESLint 10.
**Goal:** One command boots everything; strict TS from day one.
- npm workspaces root `package.json`, root `tsconfig.base.json` (strict, noImplicitAny, strictNullChecks, noUncheckedIndexedAccess).
- `packages/shared` with Zod schemas stubs, enums, thresholds (`AUTO_APPLY=0.90`, `REVIEW=0.70`).
- `apps/server`: Express + TS (tsx watch), `/api/health`, env config validated by Zod (`.env.example`: `PORT`, `MONGODB_URI`, `JWT_SECRET`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `TZ_DEFAULT`).
- `apps/web`: Vite + React + TS + Tailwind + React Router shell with placeholder routes `/dashboard /timetable /review /messages /changes`.
- ESLint + Prettier; Vitest wired in all workspaces.
- **Acceptance:** `npm run dev` starts server + web; `npm run typecheck` and `npm run build` pass; health endpoint returns `{ ok: true }`.

### Phase 2 — Database Layer & Models ✅ done (2026-10-04)
**Result:** Six Mongoose 9 models + thin repositories + connection helper (retry/backoff, graceful shutdown) + in-memory-MongoDB integration suite: **54 server tests green**. Baseline write-guards and AuditLog append-only guards are enforced at the schema level.
**Goal:** All six models exist and are covered by integration tests.
- Mongoose schemas per Section 3 + repository modules (thin, typed, no business logic).
- Mongo connection helper with retry/backoff, graceful shutdown.
- Tests with `mongodb-memory-server`: CRUD per model, dedup unique index proven, TimetableEntry write-guard proven.
- **Acceptance:** `npm test` green; dedup rejects identical hash; baseline guard throws `BaselineImmutableError`.

### Phase 3 — Baseline Timetable (Import & Management)
**Goal:** A student can create, import, view, and lock their Baseline.
- Course CRUD + alias management (alias list feeds the Phase 6 relevance classifier).
- TimetableEntry CRUD; JSON/CSV import endpoint with Zod row validation + per-row error report (partial import is transactional or all-or-nothing — decide in implementation, default all-or-nothing).
- `POST /api/timetable/lock` -> `locked=true`; edits afterwards require explicit re-import flow (creates `baselineVersion+1`), never silent mutation.
- Server API returns the week grid for the `/timetable` view.
- **Acceptance:** sample CSV imports cleanly; invalid rows produce a readable error list; locked baseline rejects writes.

### Phase 4 — Message Adapter Layer & Ingestion
**Goal:** Messages flow in via adapters and persist as `RawMessage` with a live status machine.
- `MessageSourceAdapter` interface + `ManualInputAdapter` (REST) + `SimulatorAdapter`.
- Typed internal EventBus (`emit('message:received', MessageEvent)`) decoupled from Express.
- Ingestion service: hash -> dedup check -> persist -> kick pipeline (fire-and-forget worker function with per-message error isolation).
- Processing status transitions persisted on `RawMessage`.
- **Acceptance:** POST a message -> `RawMessage` appears with `RECEIVED` then advances; duplicate ignored; a pipeline failure on one message leaves others unaffected.

### Phase 5 — Core Scheduling Engine (Effective Projection)
**Goal:** Correct Effective timetable + audit + revert, fully unit-tested, with no AI involved.
- **Date/time resolution module**: relative terms ("tomorrow", "kal", "aaj", "day after tomorrow") resolve against `MessageEvent.timestamp` in the user's timezone — never `Date.now()`. Time parsing supports "11:30 AM", "11:30", "11-12:45" ranges; duration changes are only accepted when explicit.
- **Effective resolver**: `getEffectiveDay(userId, date)` = Baseline occurrences merged with applied changes; deterministic and pure for testability.
- **Conflict detector**: flags overlap (time), duplicate application, unknown course/entry, past-date changes.
- **Apply service**: transactional-ish flow (Session when Mongo replica set available, otherwise ordered writes + rollback on failure) writing AuditLog before projection.
- **Revert endpoint**: `POST /api/changes/:id/revert` -> new AuditLog entry, status `REVERTED`, projection recomputed; original history intact.
- **Acceptance:** tests for "tomorrow"/"kal" resolution, range parsing, conflict flagging, and revert-restores-previous-state-keeps-history.

### Phase 6 — AI Pipeline (LLM Abstraction, Extraction, Confidence)
**Goal:** Genuine prompt-based extraction that degrades gracefully and never over-trusts the LLM.
- **`LLMProvider` interface**: `extract(promptPayload) -> Promise<unknown>`; implementation **`GeminiProvider`** using the official `@google/genai` package (e.g. `gemini-1.5-flash`, Google AI Studio free tier), plus `StubProvider` for tests/dev (optional `OpenAIProvider`/`AnthropicProvider` later). Timeout + bounded retry with backoff; failures set `RawMessage.status=FAILED` with reason.
- **Prompt design**: system prompt pins output to a strict JSON schema, forbids invention of dates/times/rooms, requires an `ambiguity` signal ("I think DBMS is cancelled" -> `ambiguous: true`) and a `certainty` field per change; includes course alias list + target date context. (Prompt lives in one versioned module, no hardcoded string matching.)
- **Validation**: Zod parse of raw LLM output; on failure one repair pass (re-prompt with validation errors) then reject gracefully — malformed JSON can never crash the pipeline.
- **Local relevance classifier**: alias + intent rules run pre-LLM; classification reasoning stored on `RawMessage`.
- **Confidence scorer** (deterministic, factors stored): certainty × alias-match strength × ambiguity penalty × conflict penalty, clamped 0–1.
- **Decision router**: >=0.90 AUTO_APPLIED (through Phase 5 apply service); 0.70–0.89 PENDING_REVIEW; <0.70 REJECTED.
- **Acceptance:** golden-set tests with scripted StubProvider: "DBMS is cancelled" auto-applies; "I think DBMS is cancelled" queues for review; invented/invalid JSON is rejected without crash; LLM timeout surfaces as FAILED status not a 500.

### Phase 7 — Real-time Layer (Socket.IO)
**Goal:** Every state change fans out instantly; web UI needs zero refresh.
- Socket.IO server with auth handshake (JWT), per-user rooms (`user:<id>`).
- Shared event contract in `packages/shared` (typed payloads): `message:received`, `message:processing`, `schedule:change-applied`, `schedule:change-updated`, `review:queued`, `timetable:changed`.
- Web client `SocketProvider` + typed hooks that patch store state.
- **Acceptance:** simulator message -> auto-apply -> open dashboard updates the affected class within ~1s.

### Phase 8 — Frontend UI (All Required Views)
**Goal:** Clean, minimal, mobile-first UI covering the full loop.
- `/dashboard`: today's effective schedule (with status chips: cancelled/rescheduled/online), recent changes, pending review count.
- `/timetable`: weekly/daily toggle grid; per-entry status; change provenance tooltip ("auto-applied from message #..."), revert action.
- `/review`: queue of PENDING_REVIEW changes; side-by-side raw message + extracted JSON; editable fields (course/time/room/date/action) with Zod validation; Approve / Edit+Approve / Reject.
- `/messages`: raw message stream + pipeline status timeline per message.
- `/changes`: audit log (filterable) with revert actions.
- **Simulator panel** (global drawer): textarea + source picker ("Manual" / "Simulated WhatsApp group") + fake sender/timestamp controls -> POSTs to adapter -> watch pipeline stages animate live.
- **Acceptance:** end-to-end demo: import baseline -> type "kal DBMS cancel hai" in simulator -> watch processing -> see class cancelled on timetable/dashboard.

### Phase 9 — Hardening, Tests & Demo Polish
- Error-handling audit per pipeline stage (Stage -> Failure behavior table checked into docs).
- Rate limiting (`express-rate-limit`) on ingestion + LLM endpoints; request size caps.
- Structured logging (pino) with correlation ids (rawMessageId) threaded through the pipeline.
- Seed script: demo user + sample course catalog + baseline timetable so the app is demo-ready in one command.
- Test coverage for pipeline happy paths and failure injection (LLM timeout, invalid JSON, DB error mid-apply).
- README with setup, env table, architecture diagram (mermaid), and demo script.

## 5. Cross-Cutting Concerns

- **TypeScript strict everywhere**; `any` banned (lint rule); Zod at every boundary (HTTP body, LLM output, import rows, env, socket payloads).
- **Error isolation:** each `RawMessage` runs in its own async task; failures write `status=FAILED` + `processingErrors[]` and can be retried via `POST /api/messages/:id/retry`.
- **Timezones:** store all instants in UTC; resolve/render in `User.timezone` (default `Asia/Kolkata`). Relative-date resolution always takes `MessageEvent.timestamp` as anchor.
- **Never invent data:** missing date/time/room stays `null` -> routed to review, never defaulted from "context memory".
- **Idempotency:** message hash dedup + per-change idempotency key `(rawMessageId, action, targetEntryId, occurrenceDate)` prevents double-apply on retries.
- **Auth:** JWT (short-lived access token) via middleware on REST + socket handshake. Phase 1–8 may optionally run a `DEV_SINGLE_USER` flag to skip login for fast iteration; real auth lands in Phase 9 hardening (flag removed then).
- **Security:** helmet, CORS allowlist, bcrypt password hashing, no secrets in client bundle.

## 6. Milestones (dependency order)

| # | Milestone | Depends on | Demo |
|---|---|---|---|
| M1 | Monorepo boots (`npm run dev`) | — | health check + placeholder web |
| M2 | Models + DB tests green | M1 | integration tests pass |
| M3 | Baseline importable & lockable | M2 | import sample CSV, view grid |
| M4 | Messages ingest via adapters | M2 | POST/duplicate handling |
| M5 | Effective projection + revert | M3, M4 | cancel/reschedule a class via API, revert it |
| M6 | AI pipeline live (real LLM) | M5 | real message -> auto-apply / review |
| M7 | Real-time UI updates | M6 | socket pushes visible in browser |
| M8 | Full UI demo | M7 | end-to-end simulator demo |

## 7. Assumptions & Open Questions

**Assumptions**
1. Single-student scope initially (multi-user SaaS later); all data is scoped by `userId` from day one.
2. MongoDB available locally or via Atlas (`MONGODB_URI`); tests use `mongodb-memory-server`.
3. At least one LLM API key available for Phase 6; `StubProvider` keeps development unblocked without keys.
4. Timeline/tz library choice (proposed: **Luxon**, IANA-zone aware) is finalized in Phase 1.

**Decisions locked (2026-10-04)**
1. **Auth:** standard JWT authentication end-to-end (register/login -> access token -> REST + socket handshake). **No `DEV_SINGLE_USER` bypass** - real auth is required from Phase 3 onwards.
2. **LLM:** **Google Gemini** via the official `@google/genai` npm package (e.g. `gemini-1.5-flash`, Google AI Studio free tier), always accessed through the `LLMProvider` interface. `LLM_PROVIDER=gemini` is accepted by the env schema.
3. **Timetable import:** **CSV + JSON + image parsing** (Gemini native multimodal) for Phase 3.
4. **Android scraper:** stays **optional / last** - it is only ever another `MessageSourceAdapter`.

## 8. Explicitly Out of Scope (for now)

- Official WhatsApp API / Business API (unavailable by constraint).
- Android app as main product (optional scraper only, behind the adapter).
- Push notifications, multi-user groups, payment/billing, production deployment.

## 9. Working Agreement

- Build **incrementally, one phase per session**, ending each with a runnable check + tests.
- No hidden state: every applied change is visible in `/changes` and revertible.
- No faking: no hardcoded message parsing, no hardcoded personal timetable; only the genuine prompt-based LLM pipeline + user-provided data.

---

**Next action:** Await your command to begin **Phase 1 — Monorepo & Tooling Skeleton**.



