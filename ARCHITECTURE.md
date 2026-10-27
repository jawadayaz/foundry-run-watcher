# ARCHITECTURE — foundry-run-watcher

_Generated: 2026-10-26 · Architect pass_

## Target

**gh-pages** (static HTML + JS + CSS) deployed via **app-deploy foundry-run-watcher**. There is no bundler, no runtime npm dependency, and no backend code owned by this project. The dashboard talks directly to Foundry's existing local HTTP endpoint on **http://127.0.0.1:7788** from the browser.

Rationale: the SPEC explicitly bans a bundler, mandates a one-HTML + one-JS + one-CSS layout, and the read-only data source is already a running local service. A CF-worker proxy would add moving parts without buying anything — the only cross-origin concern is a one-line CORS header on the Foundry side (see **Known gaps** below), not a traffic re-route.

Reuse signal from **playbooks/stacks/gh-pages.md**: this is the user's standard pattern for a UI-only project, versioning is a visible footer, cache-busting is handled by a `?v=` query string on JS/CSS references. Same conventions apply here.

## Components

Three static files served from the gh-pages branch root. All logic lives in **app.js**.

```
┌────────────────────────────── index.html ──────────────────────────────┐
│  <link href="app.css?v=X">   <script defer src="app.js?v=X">           │
│  Semantic skeleton: pause-banner slot, phase-strip slot,               │
│  artifact-tree slot (with mobile toggle), file-preview slot,           │
│  queue slot, runs slot, inspect slot, launchd-err slot,                │
│  launchd-out slot, stale-indicator slot, version footer.               │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────── app.js ────────────────────────────────┐
│                                                                        │
│  ─ bootstrap()                                                         │
│      resolveApiBase() → window.API_BASE                                │
│      startPollLoop()                                                   │
│      startCountdownTicker()  (1 Hz, independent of poll)               │
│                                                                        │
│  ─ pollLoop (R-07, R-08)                                               │
│      setTimeout chained inside tick(); AbortController per request;    │
│      previous controller aborted before new fetch; keeps lastGoodState │
│      and lastGoodPollMs; updates staleIndicator on each tick           │
│                                                                        │
│  ─ render(state)         ← pure(ish) renderer; called on every poll    │
│      renderPhaseStrip(active_run.phase)              R-01, R-09        │
│      renderPauseBanner(pause)                        R-02              │
│      renderArtifactTree(artifacts)                   R-03              │
│      renderQueue(queue)                              R-05              │
│      renderRuns(runs, active_run.run_id)             R-05, R-11, R-12  │
│      renderLogTails(err_tail, out_tail)              R-06              │
│      maybeRefreshPreview(artifacts)                  R-04              │
│                                                                        │
│  ─ inspectPane (R-11)                                                  │
│      onRunClick(run_id) → fetch /api/run/<id> → renderInspect(...)     │
│                                                                        │
│  ─ previewPane (R-04)                                                  │
│      onArtifactClick(path) → fetch /api/file?path=…                    │
│      store {path, mtimeAtPreview}; binary-sniff first 1 KiB for 0x00   │
│                                                                        │
│  ─ pure helpers (unit-testable, no DOM)                                │
│      diffPaths(prev:Set, curr:Set) → Set<string>                       │
│      countdownSeconds(resetMs, now)                                    │
│      secondsUntilResetFallback(seconds_until_reset, pollReceivedAt)    │
│      isBinaryPreview(bytes:Uint8Array)                                 │
│      classifyPhase(index, activeIndex) → 'completed'|'current'|'pending'│
│      classifyStatus(status) → {label, icon, cls}                       │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────── Foundry (external) ────────────────────────┐
│  GET /api/state          — poll every 2 s                              │
│  GET /api/file?path=     — on artifact row click                       │
│  GET /api/run/<run_id>   — on run row click                            │
│  (Foundry process; not owned by this repo)                             │
└────────────────────────────────────────────────────────────────────────┘
```

Separation rules:
- The pure helpers above never touch the DOM — they are the functions the test suite covers directly and the render functions call.
- There is **no LLM in this product**. All logic is deterministic. The "pure testable functions, separate from any LLM calls" architect rule applies trivially.

## Data model

No persistence. All state is in-memory JavaScript inside **app.js**:

| Name | Type | Purpose |
|---|---|---|
| **lastGoodState** | object or null | last successful `/api/state` body, used for stale rendering (R-07) |
| **lastGoodPollMs** | number or null | `Date.now()` of last successful poll, drives stale-seconds indicator |
| **previousPaths** | `Set<string>` | artifact paths observed on previous poll, drives new-file flash (R-03) |
| **flashTimers** | `Map<path, timeoutId>` | per-row flash cleanup timers (1500 ms) |
| **currentController** | `AbortController` or null | aborted on next tick to cancel in-flight `/api/state` (R-08) |
| **previewState** | `{path, mtimeAtPreview}` or null | drives mtime-refresh (R-04) |
| **pauseState** | `{resetMs, secondsUntilReset, pollReceivedAt}` or null | countdown math (R-02) |
| **inspectedRun** | object or null | last `/api/run/<id>` response, keeps inspect pane stable across polls |

Foundry owns durable state in `~/.foundry/foundry.db` (per R-12). The dashboard never reads or writes that file; it only reads `/api/state.runs` as the source of truth for history.

## API endpoints (consumed, not served)

The dashboard owns zero HTTP endpoints — it is a static page. Below is the contract it depends on, per **research/domain.md** D-01–D-04 and **DECISIONS.md** D-A02/D-A03/D-A06/D-A07.

| Method & path | Request | Response (shape the UI depends on) |
|---|---|---|
| **GET** `/api/state` | no params | `{ now:ISO, active_run:{run_id,app_name,status,phase,created_at}\|null, lock_pid:number\|null, pause:{kind,reset_at:ISO,node,run_id,seconds_until_reset:number,raw_preview}\|null, queue:[{app_name,created_at?}], runs:[{run_id,app_name,status,created_at,phase?}], artifacts:[{path,size,mtime:seconds}], app_dir, launchd_err_tail:string, launchd_out_tail:string }` |
| **GET** `/api/file?path=<rel>` | `path` URL-encoded, repo-relative | Raw file bytes (text/plain). Binary files sniff-detected client-side via leading 0x00 in first 1 KiB (D-A04). |
| **GET** `/api/run/<run_id>` | run_id as path segment | A single run detail object including that run's `artifacts` array and a `nodes`/`node_history` sequence (R-11). Exact shape is Foundry's; the UI reads `artifacts` as `[{path,size,mtime}]` and renders node history as an ordered list of `{node, status, started_at?, finished_at?}` entries. |

**No `GET /api/health` is defined for this project** — the gh-pages playbook requires none, and `/api/health` is a cf-worker convention. The dashboard does render a `stale (last update Xs ago)` indicator (R-07) which doubles as a liveness signal.

## Storage

None owned by the dashboard. All data at rest lives in Foundry's **~/.foundry/foundry.db** (sqlite), which Foundry serves via `/api/state.runs`. The dashboard holds only the in-memory structures listed in **Data model**.

- No KV, no R2, no D1, no Sheets, no Supabase.
- No `localStorage` or `sessionStorage` in v1 (the API base override uses a URL query param only; see **Required env vars**).

## Auth

**None.** The dashboard is read-only, served from gh-pages (public but harmless — no secrets), and the Foundry API is reachable only from the operator's own browser against his own machine. The `app-deploy secure <pwd>` flag is **not** applied; adding a login screen would protect nothing because the gh-pages URL contains no sensitive data on its own. If the operator later wants to prevent casual visitors from loading the dashboard while hitting a tunnelled Foundry endpoint, `app-deploy foundry-run-watcher secure <pwd>` can be run without any code change (SPEC Non-goal re-affirmed: no auth in v1).

## External APIs

Only the Foundry local endpoint. There are no third-party APIs, no LLM calls, no analytics, no CDN scripts beyond what GitHub Pages inherently serves.

| URL | Purpose | Rate limits |
|---|---|---|
| `http://127.0.0.1:7788/api/state` | per-poll run state | self-imposed 1 request / 2 s (R-08); no server-side quota |
| `http://127.0.0.1:7788/api/file?path=…` | preview + mtime-refresh | 1 request on click + up to 1 / 2 s on mtime bump |
| `http://127.0.0.1:7788/api/run/<id>` | historical run inspect | 1 request on run-row click |

## Required env vars

The dashboard is static — **no server-side env vars**. One compile-time constant is defined at the top of **app.js**:

```js
const DEFAULT_API_BASE = "http://127.0.0.1:7788";
// Override at runtime via ?api=http://host:port in the page URL.
```

`resolveApiBase()` returns `URL.searchParams.get("api") ?? DEFAULT_API_BASE`. This lets the operator point the gh-pages page at a tunnelled Foundry (e.g. a Tailscale address) without recompiling. No secrets ever enter JS.

The release agent has nothing to validate here — no secrets means no "stop at preview if missing" condition applies to this project.

## How each R-XX is satisfied

- **R-01 Phase strip** — `renderPhaseStrip(active_run.phase)` emits 11 `<li>` cells in the fixed slug order from DECISIONS.md D-A01. Each cell has `data-state="completed|current|pending"` plus a visible text label (slug name) and a non-colour attribute (left border width for `current`, strikethrough for `completed`, dashed outline for `pending`). Covers R-01 + R-09 colour-blind pairing.
- **R-02 Pause banner + 1 Hz countdown** — `renderPauseBanner(pause)` either hides the banner (null) or writes `kind`, `node`, `raw_preview` into it. `startCountdownTicker()` runs a 1 Hz `setInterval` that reads `pauseState.resetMs` and recomputes `secondsRemaining = max(0, round((resetMs - Date.now()) / 1000))`. If `reset_at` is unparseable, falls back to `seconds_until_reset − elapsedSincePoll`. Banner disappears the moment a poll returns `pause === null`.
- **R-03 Artifact tree + flash** — `renderArtifactTree(artifacts)` computes `newPaths = currPaths \ previousPaths` using Sets of path strings only; each new row is given a `.flash` class and a `setTimeout(..., 1500)` strips it. Removed paths are not rendered.
- **R-04 File preview + mtime refresh** — Click handler on artifact rows calls `fetch(API_BASE + "/api/file?path=" + encodeURIComponent(path))`. The response arrives as `ArrayBuffer`, the first 1 KiB is sniffed for 0x00 → binary fallback message; otherwise decoded as UTF-8 and shown in `<pre>`. `previewState = {path, mtimeAtPreview}` is captured at fetch resolve. On every subsequent poll, `maybeRefreshPreview(artifacts)` finds the matching artifact and re-fetches when `artifact.mtime > mtimeAtPreview`.
- **R-05 Queue + recent runs** — `renderQueue(queue)` outputs a flat list of `app_name` + optional `created_at`. `renderRuns(runs, active_run.run_id)` slices to 10 entries, outputs clickable rows with `run_id`, `app_name`, status pill (via `classifyStatus`), `created_at`, `phase` (or `—`). `classifyStatus` maps the six known values to `{label, icon, cls}` triples; unknown values use `{label: raw, icon: "·", cls: "status-unknown"}` for neutral display (DECISIONS.md D-A03).
- **R-06 Launchd log tails** — `renderLogTails(err, out)` writes into two labelled `<pre class="log-tail">` nodes. CSS sets `white-space: pre` + `overflow-y: auto` + `max-height: 30vh`.
- **R-07 Resilience** — The poll loop's `try/catch` around `fetch(...)` plus `response.ok` check preserves `lastGoodState` on any failure, re-renders it, and shows the stale indicator computed from `Date.now() − lastGoodPollMs`. On the next successful poll the indicator clears.
- **R-08 2 s cadence + abort** — `tick()` creates a new `AbortController`, aborts `currentController` from the previous tick first, issues the fetch, then schedules `setTimeout(tick, 2000)`. The chained-setTimeout pattern gives a strict 2 s floor between tick starts even if a response is slow (the slow one is aborted when the next tick fires).
- **R-09 Accessibility** — Each status-carrying element has both a text label and a non-colour visual property (icon glyph on run status, border style on phase cell, pattern on pause banner edge). CSS enforces contrast via explicit `color` and `background` pairs chosen from the user's standard dashboard palette; no red/green pair is the sole status discriminator. The spec's Playwright assertion is satisfied by making the non-colour property a `data-icon` or `data-shape` attribute visible to the test.
- **R-10 Responsive layout** — Default CSS is single-column, with `#artifact-tree` wrapped in `<details>` so it collapses behind a `<summary>` toggle. `@media (min-width: 1280px)` switches `.app` to a 3-column CSS grid: left pane phase+pause+inspect, middle pane artifacts+preview, right pane queue+runs+logs. 390×844 test lands in the first branch, 1280×800 in the second.
- **R-11 Click-to-inspect** — Run rows have an `onclick` that calls `inspectRun(run_id)` → `fetch(API_BASE + "/api/run/" + run_id)` → renders artifacts + node history into `#inspect-pane`. The live run's row carries a `live` label; the phase strip continues to update from `/api/state` independently (inspect pane is a separate DOM region).
- **R-12 Historical runs persist** — The dashboard renders whatever `/api/state.runs` returns, keyed by `run_id`. Terminal statuses (`done`, `abandoned_user`, `abandoned_budget`) stay visible as long as Foundry returns them, which per SPEC it will. The dashboard does zero deduplication logic beyond rendering the array in order — if Foundry stops returning a run_id, the row disappears, which is correct.

## Known gaps

- **CORS on Foundry's endpoint is a Foundry-side change, not owned by this project.** DECISIONS.md D-CORS captures this. The release agent must verify (as part of smoke) that `curl -H 'Origin: https://jawadayaz.github.io' …/api/state -i` returns `Access-Control-Allow-Origin` echoing the origin before marking a gh-pages deploy green. If Foundry has not shipped the CORS change by release time, the fallback is to open the dashboard from `http://127.0.0.1:<port>` (local `python3 -m http.server` served from the gh-pages checkout) and the `null` origin for `file://` opens. The dashboard itself needs no change for either path.
- **No `/api/run/<id>` shape spec.** DECISIONS.md does not pin the response shape, only its presence (SPEC R-11). The architect assumes `{run_id, app_name, status, artifacts:[{path,size,mtime}], nodes:[{node,status,started_at?,finished_at?}]}`. If Foundry's actual shape differs, the UI agent should file an **info_gap** escalation rather than guessing a mapping.
- **No `/api/health` endpoint in the Foundry contract.** The release agent's standard health-check pattern (per cf-worker playbook) does not apply here. The stale-indicator is the operational liveness signal; the release smoke should instead assert that `/api/state` returns a well-formed JSON body with the keys listed in D-02.
- **Playbook coverage gap**: `playbooks/stacks/gh-pages.md` says nothing about Playwright fixture patterns for a mocked-endpoint SPA — the SPEC's build-step 9 lists the pattern inline (page.route, hit counter, page.clock) which is adequate, but future gh-pages projects would benefit from a shared `playbooks/fixtures.md`.
