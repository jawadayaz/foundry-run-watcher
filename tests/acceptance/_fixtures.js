// Shared fixtures and helpers for the acceptance suite.
//
// Every requirement test mounts a `page.route(...)` handler against the three
// Foundry endpoints and swaps responses between polls using a hit counter
// (D-34). The dashboard is a plain static page served from the project root,
// so navigation is just `page.goto("/")`.

const PHASES = [
  "intake",
  "research",
  "spec",
  "design",
  "test_authoring",
  "plan",
  "build_loop",
  "integration",
  "release",
  "retro",
  "done"
];

/**
 * Build a minimal, schema-valid /api/state response.
 * All fields default to safe empties; override via `overrides`.
 */
function makeState(overrides = {}) {
  const base = {
    now: new Date().toISOString(),
    active_run: null,
    lock_pid: null,
    pause: null,
    queue: [],
    runs: [],
    artifacts: [],
    app_dir: "/tmp/foundry/sample-app",
    launchd_err_tail: "",
    launchd_out_tail: ""
  };
  return { ...base, ...overrides };
}

function makeActiveRun(overrides = {}) {
  return {
    run_id: "run_active_001",
    app_name: "sample-app",
    status: "running",
    phase: "design",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides
  };
}

function makeArtifact(path, overrides = {}) {
  return {
    path,
    size: 128,
    mtime: 1_700_000_000 + path.length,
    ...overrides
  };
}

function makeRun(overrides = {}) {
  return {
    run_id: "run_x",
    app_name: "example",
    status: "done",
    created_at: "2026-10-26T10:00:00Z",
    phase: "done",
    ...overrides
  };
}

function makePause(resetMsFromNow = 30_000, overrides = {}) {
  const resetAt = new Date(Date.now() + resetMsFromNow).toISOString();
  return {
    kind: "human-in-the-loop",
    reset_at: resetAt,
    node: "spec",
    run_id: "run_active_001",
    seconds_until_reset: Math.round(resetMsFromNow / 1000),
    raw_preview: "Awaiting operator confirmation",
    ...overrides
  };
}

/**
 * Install a hit-counter-indexed /api/state responder.
 * `responses` is an array of either:
 *   - a plain state object (fulfilled with status 200 and that JSON body)
 *   - { kind: "abort" }      (route.abort())
 *   - { kind: "fail", status: 500 }  (route.fulfill with HTTP error)
 *   - { kind: "stall", ms: 5000, body: state } (delayed fulfill — tests R-08 abort)
 * After the array is exhausted, the last entry repeats.
 */
async function installStateRoute(page, responses, options = {}) {
  const counter = { n: 0 };
  await page.route(/\/api\/state(\?.*)?$/, async (route) => {
    const i = Math.min(counter.n, responses.length - 1);
    counter.n += 1;
    const r = responses[i];
    if (r && r.kind === "abort") {
      await route.abort("failed");
      return;
    }
    if (r && r.kind === "fail") {
      await route.fulfill({ status: r.status || 500, body: "err" });
      return;
    }
    if (r && r.kind === "stall") {
      await new Promise((res) => setTimeout(res, r.ms));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(r.body || makeState())
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(r)
    });
  });
  if (options.expose) {
    // Allow a test to inspect how many polls have fired.
    options.expose.counter = counter;
  }
  return counter;
}

/**
 * Install a route for /api/file. `bodiesByPath` maps repo-relative path →
 * Buffer | string (plain text) or { body, status, contentType }.
 */
async function installFileRoute(page, bodiesByPath, options = {}) {
  const seen = [];
  await page.route(/\/api\/file(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") || "";
    seen.push(path);
    const spec = bodiesByPath[path];
    if (spec === undefined) {
      await route.fulfill({ status: 404, body: "not found" });
      return;
    }
    if (typeof spec === "string") {
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: spec
      });
      return;
    }
    if (spec && typeof spec === "object" && "body" in spec) {
      await route.fulfill({
        status: spec.status || 200,
        contentType: spec.contentType || "text/plain; charset=utf-8",
        body: spec.body
      });
      return;
    }
    // Treat as Buffer-like
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: spec
    });
  });
  if (options.expose) options.expose.seen = seen;
  return seen;
}

/**
 * Install a route for /api/run/<id>. `byRunId` maps run_id → run detail body.
 */
async function installRunRoute(page, byRunId, options = {}) {
  const seen = [];
  await page.route(/\/api\/run\/[^?]+$/, async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const runId = parts[parts.length - 1];
    seen.push(runId);
    const detail = byRunId[runId];
    if (!detail) {
      await route.fulfill({ status: 404, body: "unknown run" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail)
    });
  });
  if (options.expose) options.expose.seen = seen;
  return seen;
}

/**
 * Build a response body with a 0x00 byte at the given index, padded to
 * `byteCount` bytes using filler char 'A'.
 */
function bytesWithNul(byteCount, nulAt) {
  const buf = Buffer.alloc(byteCount, 0x41); // 'A'
  if (nulAt !== null && nulAt !== undefined && nulAt >= 0 && nulAt < byteCount) {
    buf[nulAt] = 0x00;
  }
  return buf;
}

module.exports = {
  PHASES,
  makeState,
  makeActiveRun,
  makeArtifact,
  makeRun,
  makePause,
  installStateRoute,
  installFileRoute,
  installRunRoute,
  bytesWithNul
};
