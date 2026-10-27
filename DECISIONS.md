# DECISIONS — foundry-run-watcher

Record of PM-owned decisions. Each decision resolves an ambiguity flagged in research/ before the architect or coder encounters it.

## D-A01 — Phase strip renders eleven cells (2026-10-26)

**Ambiguity:** BRIEF says "all ten LangGraph phases" but lists eleven slugs.

**Decision:** Render all **eleven** slugs as phase cells in order: `intake, research, spec, design, test_authoring, plan, build_loop, integration, release, retro, done`. The `/api/state.active_run.phase` field will take values from this list; the strip must have a cell to match every possible phase value. "ten" in BRIEF is treated as inexact.

**Impact:** R-01 acceptance locked to 11 cells. Test fixtures build on 11 cells.

## D-A02 — Timestamp and mtime formats (2026-10-26)

**Decision:**
- `now`, `active_run.created_at`, `pause.reset_at`, `runs[].created_at`, `queue[].created_at` are **ISO 8601 strings**.
- `artifacts[].mtime` is a **POSIX seconds number** (float allowed; sub-second precision not required).

**Rationale:** This is what Foundry's existing state endpoint emits (per cross-check against the current implementation surface). The dashboard uses `Date.parse()` for the ISO strings and plain `>` comparison for mtime.

**Impact:** R-02 countdown parsing, R-03 artifact diffing (path-based, not mtime-based), R-04 mtime refresh logic all lock to these formats.

## D-A03 — Status taxonomy for runs and active_run (2026-10-26)

**Decision:** The known enumerated status values are: `running`, `paused`, `done`, `failed`, `abandoned_user`, `abandoned_budget`. The dashboard renders each with a dedicated label and non-colour visual treatment. Any value outside this set renders verbatim with a neutral style — i.e. an unknown status does not crash the UI, it just gets no special styling.

**Impact:** R-05 acceptance, R-09 colour-blind pairings.

## D-A04 — /api/file content-type and binary handling (2026-10-26)

**Decision:** Assume `text/plain` responses. The dashboard scans the first 1 KiB (or whole body if shorter) of the response body for any 0x00 byte; if present, render "binary file — preview unavailable" instead of the raw bytes. No binary preview, no download button, no hex view in v1.

**Impact:** R-04 scope limited to text; one extra line in the acceptance test for the NUL-byte fallback.

## D-A05 — pause.kind is an opaque string (2026-10-26)

**Decision:** `pause.kind` is displayed verbatim. The dashboard does not hardcode any kind enum. No special styling per kind in v1.

**Impact:** R-02 is simpler — one banner shape handles every pause kind.

## D-A06 — queue entry shape (2026-10-26)

**Decision:** Minimum fields are `app_name` (required). If `created_at` is present, render it next to the app name. No other fields rendered.

## D-A07 — runs entry shape (2026-10-26)

**Decision:** Minimum fields per run: `run_id`, `app_name`, `status`, `created_at`, `phase`. If `phase` is absent on a terminal row, render `—`.

## D-CORS — architect must plan for Access-Control-Allow-Origin (2026-10-26)

Foundry today is CORS-open on localhost only. Before gh-pages or file:// clients can use the dashboard, Foundry's state endpoint must echo the request's `Origin` back as `Access-Control-Allow-Origin` for these three origins:
- `https://jawadayaz.github.io`
- `http://127.0.0.1:*` and `http://localhost:*`
- `null` (opaque origin for `file://`)

This is a Foundry-side change tracked under this project's build steps as an architect concern, not a dashboard code task. The dashboard assumes the endpoint will accept its origin by the time it ships.

## D-ARCH-01 — Stack choice: pure gh-pages, no proxy worker (2026-10-26)

**Decision:** The dashboard is a single HTML + JS + CSS triple deployed to GitHub Pages via `app-deploy foundry-run-watcher`. No Cloudflare Worker proxy; the browser talks straight to `http://127.0.0.1:7788` using an `?api=` query override when a non-localhost host is needed. A CF-worker would buy nothing — Foundry's CORS fix (D-CORS) is a one-line header, not traffic routing — and would violate the SPEC non-goal "No bundler, no npm runtime dependencies beyond Playwright for tests".

**Impact:** No wrangler config, no secrets, no `/api/health`. Release-agent smoke is a Playwright GET of `/api/state` plus a well-formed-body assertion, not an HTTP health probe.

## D-ARCH-02 — API base override via `?api=` query string, no localStorage (2026-10-26)

**Decision:** The default API base is a compile-time constant `http://127.0.0.1:7788`. The operator can override at runtime by appending `?api=http://host:port` to the page URL (useful for Tailscale/ngrok). No `localStorage` persistence in v1 — a reload with no query string reverts to the default. Keeps the dashboard stateless across sessions and avoids a surprise "stuck on wrong host" trap after a one-time test.

**Impact:** `resolveApiBase()` lives in app.js; tests pass `?api=` explicitly when needed. No env vars.

## D-ARCH-03 — No LLM, no third-party APIs in v1 (2026-10-26)

**Decision:** All UI logic is deterministic and lives in pure helpers (`diffPaths`, `countdownSeconds`, `isBinaryPreview`, `classifyPhase`, `classifyStatus`). No calls to Anthropic / Gemini / global-worker. The dashboard is a view over Foundry's local endpoint.

**Impact:** Satisfies the architect-rule "deterministic logic must be pure testable functions, separate from any LLM calls" trivially — there are no LLM calls to separate from.
