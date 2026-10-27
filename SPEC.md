---
name: foundry-run-watcher
version: v01.00
sensitive: false
target: gh-pages
---

# Foundry Run Watcher

## Problem
Foundry — the solo-operator app factory running on this Mac — is a long-running multi-agent LangGraph pipeline. Today the only way to see what it is doing is to tail launchd logs in a terminal. The operator needs ambient awareness of the current phase, pauses with countdowns, the files being built, and the queue of pending work, visible on both desktop and phone, without opening a terminal or logging into any cloud service.

## Users
A single primary user: Jawad, operating Foundry from his desk or from an iPhone when away. The dashboard is read-only, consumes Foundry's existing local state endpoint, and never writes back. No other users; no auth.

## Requirements

- **R-01: Phase strip.** Render all eleven Foundry LangGraph phase slugs in a single ordered strip: **intake, research, spec, design, test_authoring, plan, build_loop, integration, release, retro, done**. For the active_run.phase value `pₖ`: phases before `pₖ` show as completed, `pₖ` as current, phases after `pₖ` as pending. Each state is distinguishable by at least a text label and a shape/background, not colour alone (WCAG 2.1 SC 1.4.1). — Acceptance: on first paint with a fixture whose `active_run.phase = "design"`, all 11 cells exist in the DOM in the specified order; the first 3 cells carry a `completed` state attribute, the 4th carries `current`, the remaining 7 carry `pending`; and the `current` cell differs from the others in both a text label and a non-colour visual property (e.g. a border or an icon).

- **R-02: Pause banner with live countdown.** When `/api/state.pause` is non-null, render a banner at the top of the page displaying the pause `kind`, the `node`, and the free-form `raw_preview`, with a countdown that ticks down **every second** between polls (not only on each poll). Countdown is computed from `Date.now()` against the parsed `reset_at`, falling back to `seconds_until_reset − elapsedSincePoll` if `reset_at` is missing. When `pause` returns null on a subsequent poll, the banner disappears on that poll. — Acceptance: with a two-poll fixture whose `pause.reset_at` is 30 s in the future, the countdown value in the DOM strictly decreases within a single poll interval (verified via Playwright `page.clock.fastForward(1000)`), and the banner disappears when `pause` is null in a later fixture.

- **R-03: Artifact tree with new-file flash.** Render all entries from `/api/state.artifacts` as a flat list showing path and size. Between consecutive polls, compute `newPaths = currentPaths − previousPaths` using a Set of path strings (do not diff content or size). Any path in `newPaths` receives a highlight class for approximately 1500 ms, after which it reverts to its default style. Removed paths disappear silently. — Acceptance: with a two-poll fixture where poll #2 adds a new path `src/foo.ts`, the row for `src/foo.ts` carries the `.flash` class within 100 ms of poll #2 and loses it within 100 ms of 1500 ms later; and a path removed between polls is absent from the DOM after poll #2.

- **R-04: File preview with mtime refresh.** Clicking any artifact row opens a side panel, issues `GET /api/file?path=<url-encoded rel>`, and renders the response body as plain text. For the file currently previewed, if a later poll's `artifact.mtime` for that same path is strictly greater than the mtime captured at preview time, the dashboard re-issues `/api/file` and replaces the preview content. Response bodies containing any 0x00 byte in the first 1 KiB are treated as binary and the panel renders "binary file — preview unavailable" instead. — Acceptance: a click on a known fixture path triggers one `/api/file` request with the correctly URL-encoded `path`; a subsequent poll with a bumped mtime for the same path triggers a second `/api/file` request; and a fixture body with a leading NUL byte renders the binary-file message instead of the raw bytes.

- **R-05: Queue and recent runs lists.** Render `/api/state.queue` as a short list of pending briefs (each entry shows at minimum `app_name`, plus `created_at` if present). Render the most recent ten entries from `/api/state.runs` as a list showing `run_id`, `app_name`, `status`, `created_at`, and `phase` (where `phase` is shown or `—` if absent). Known status values — **running, paused, done, failed, abandoned_user, abandoned_budget** — each receive a distinct text label and non-colour visual treatment; unknown values display verbatim with neutral styling. — Acceptance: with a fixture containing 15 runs, exactly 10 rows render; each row shows the five fields in the specified order; and the status label for `abandoned_user` differs from `done` in both label text and a non-colour attribute.

- **R-06: Launchd log tails.** Render `/api/state.launchd_err_tail` and `/api/state.launchd_out_tail` as two scrollable preformatted blocks, each clearly labelled, each independently scrollable, and each sized so a ~4 KiB tail is visible without blowing out the page layout. — Acceptance: both tails appear in the DOM; each uses `<pre>` or an element whose computed `white-space` preserves newlines; and each has `overflow-y: auto` with a bounded max-height.

- **R-07: Resilient to transient fetch errors.** On any failed poll (fetch promise rejection, `!response.ok`, or `AbortController` abort), the UI retains the last-known-good state in memory, continues rendering it, displays a subtle `stale (last update Xs ago)` indicator computed from `Date.now() − lastGoodPollMs`, and retries on the next 2 s tick without surfacing a user-facing error. The stale indicator clears on the next successful poll. — Acceptance: a Playwright fixture that fulfils poll #1 with a valid body and aborts polls #2–#5 keeps the poll #1 state visible in the DOM for the duration, shows an increasing stale-seconds counter, and clears the indicator after a successful poll #6.

- **R-08: 2-second polling cadence.** `/api/state` is polled every 2000 ms exactly. If a poll's fetch has not resolved by the time the next 2 s tick fires, the pending request is aborted via `AbortController.abort()` before the new one is issued. No WebSocket or SSE is used. — Acceptance: a Playwright run measuring request timestamps over 10 s records between 5 and 6 `/api/state` requests; and a fixture that delays its response past 2 s shows an abort on the stalled request before the next one begins.

- **R-09: Readable with colour blindness.** All text and image-of-text in the dashboard meets WCAG 2.1 SC 1.4.3 Level AA contrast (4.5:1 for normal text, 3:1 for large text). No status (phase state, run status, pause state) is conveyed by colour alone — each pairs its colour with either a text label or a non-colour visual property (icon, shape, border, pattern). Red/green are never the sole distinguishing pair for any status. — Acceptance: a Playwright snapshot assertion confirms that every status-carrying element in the fixture-driven DOM has either a text-label child or a non-colour-only CSS property distinguishing it from its peers (verified by a per-element test).

- **R-10: Mobile-friendly layout.** At viewport widths ≤ 767 px, panels stack vertically in a single column and the artifact tree collapses behind a toggle control that the user expands manually. At viewport widths ≥ 1280 px, a three-pane layout is in effect. The breakpoint is implemented via `@media (min-width: 1280px)`. — Acceptance: a Playwright run at 390×844 shows one column of stacked panels and the artifact tree hidden behind a toggle; a run at 1280×800 shows three distinct pane regions in the DOM.

- **R-11: Multi-run tracking with click-to-inspect.** The recent-runs list shows every run in `/api/state.runs`, each row clickable. Clicking a run row calls `GET /api/run/<run_id>` and displays that run's artifact tree and node history in the inspect pane, even if a different run is the currently active one. The currently-live run is distinguishable from historical rows by a text label (e.g. `live`). — Acceptance: a fixture with three runs (one active, one `abandoned_user`, one `done`) renders all three in the list; clicking the `abandoned_user` row issues one `/api/run/<that_run_id>` request and displays its artifacts + node history in the inspect pane while the live run's phase strip continues to update from `/api/state`.

- **R-12: Historical runs persist.** Runs with status `done`, `abandoned_user`, or `abandoned_budget` remain visible in the recent-runs list across polls — the Foundry sqlite index at `~/.foundry/foundry.db` persists them. The dashboard reads only from `/api/state.runs` and never maintains its own history or performs its own persistence. — Acceptance: a two-poll fixture where poll #1 contains three terminated runs and poll #2 returns the same three (identity by `run_id`) renders those three rows across both polls without duplication.

## Non-goals
- No authentication, no login, no user accounts. The dashboard is localhost-reach only.
- No write endpoints — the dashboard never mutates Foundry state.
- No historical persistence in the dashboard itself; Foundry's sqlite index is the source of truth.
- No notifications (Telegram pings are a Foundry concern).
- No multi-run comparison view in v1.
- No syntax highlighting in file preview — plain text only.
- No binary file preview (D-04 / R-04 fallback: show "binary file — preview unavailable").
- No bundler, no npm runtime dependencies beyond Playwright for tests. One HTML + one JS + one CSS file.

## Stack
_Filled by the architect after design._

## Build steps

1. **Scaffold + 2 s polling loop + stale-indicator resilience (R-07, R-08).**
   - Create `index.html`, `app.css`, `app.js` with a cache-busting `?v=` query on JS and CSS references.
   - Implement a polling loop using `setTimeout(tick, 2000)` chained inside `tick`, with an `AbortController` scoped per request and aborted before the next tick fires.
   - On a successful poll, store the response as `lastGoodState` and update `lastGoodPollMs = Date.now()`. On failure (rejection or `!response.ok`), retain `lastGoodState` and render it; show `stale (last update Xs ago)` computed off `Date.now()`.
   - Acceptance: automated Playwright test asserts cadence (5–6 requests in 10 s), abort behaviour, and stale indicator across fulfil/abort fixture sequences.

2. **Phase strip (R-01, R-09).**
   - Render the 11 slugs in a fixed order. Derive each cell's state (completed / current / pending) from `active_run.phase`. Pair each state with a text label and a non-colour visual property.
   - Acceptance: Playwright snapshot across each possible `phase` value verifies cell count, order, and the state assignment for the active cell and its neighbours.

3. **Pause banner with live 1 s countdown (R-02).**
   - Render only while `state.pause` is non-null. Store the parsed `reset_at` epoch at poll time, then re-render the countdown on a 1 s `setInterval` using `max(0, round((resetMs − Date.now()) / 1000))`. Fall back to `seconds_until_reset − elapsedSincePoll` when `reset_at` is unparseable. Clear the interval and remove the banner the moment `pause` returns null.
   - Acceptance: Playwright with `page.clock.install()` + `page.clock.fastForward(1000)` observes the countdown decrement between polls.

4. **Artifact tree + new-file flash (R-03).**
   - Maintain `previousPaths` as a Set of path strings from the last poll. On each poll, compute `newPaths` and apply a `.flash` class for ~1500 ms (`setTimeout` cleanup).
   - Acceptance: two-poll Playwright fixture adds a new path on poll #2; assertion confirms the flash class is applied and later removed.

5. **File preview panel with mtime refresh (R-04).**
   - Click handler opens the side panel, issues `GET /api/file?path=<encodeURIComponent(path)>`, and renders the body as plain text in a `<pre>`. Capture the `mtime` observed at preview-fetch time. On subsequent polls, if `mtime` for that same path has increased, re-fetch and replace the body. Detect binary by scanning the first 1 KiB of the body for 0x00; render the binary fallback message if present.
   - Acceptance: click triggers exactly one `/api/file` request; mtime bump triggers a second one; a NUL-byte fixture body renders the binary fallback.

6. **Queue + recent runs with click-to-inspect (R-05, R-11, R-12).**
   - Render queue as a simple list from `state.queue` (showing `app_name` and optional `created_at`). Render up to 10 entries from `state.runs` as clickable rows, each showing `run_id`, `app_name`, `status`, `created_at`, `phase`. The active-run row (identity by `run_id`) carries a `live` label. Clicking any row calls `GET /api/run/<run_id>` and populates the inspect pane with that run's artifact tree + node history. Status label mapping handles the six known values with distinct label text and non-colour visual treatment; unknown values display verbatim.
   - Acceptance: three-run Playwright fixture (one live, one `abandoned_user`, one `done`) renders all three; a click on the `abandoned_user` row issues one `/api/run/<id>` call and populates the inspect pane while live polling continues.

7. **Launchd log tails (R-06).**
   - Render `launchd_err_tail` and `launchd_out_tail` in two labelled `<pre>` elements, each with bounded max-height and `overflow-y: auto`.
   - Acceptance: Playwright asserts both `<pre>` elements exist, preserve whitespace, and are scrollable.

8. **Responsive layout + accessibility pass (R-09, R-10).**
   - CSS: default (mobile) layout is a single stacked column with the artifact tree behind a toggle; `@media (min-width: 1280px)` switches to a three-pane layout. All status-carrying elements paired with text labels or non-colour visual properties. All text meets 4.5:1 contrast; large text 3:1.
   - Acceptance: Playwright runs at 390×844 and 1280×800 confirm the two layouts; a per-element accessibility assertion verifies no status is conveyed by colour alone.

9. **Playwright test suite with mocked fixtures (every R-XX).**
   - `tests/test_suite.js` using `page.route()` to intercept `/api/state`, `/api/file`, `/api/run/*`. Fixtures are indexed by a hit counter so poll N returns fixture[N] (D-34). Use `page.clock.install()` for countdown tests (D-36). Use `route.abort()` and `route.fulfill({status:500})` to simulate failure (D-35).
   - Acceptance: `app-deploy foundry-run-watcher test` runs the suite against the live gh-pages URL and all R-XX cases pass.

## Decisions log pointer
Decisions made during PM phase (ambiguity resolutions A-01 through A-07 from research/domain.md) are recorded in `DECISIONS.md` at the project root. Any later amendment to this SPEC that affects already-verified tasks must list the affected task IDs and invalidate their verify reports.
