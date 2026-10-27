// R-08 — 2-second polling cadence + in-flight abort.
//
// Measure the number of /api/state requests over 10 s (expect 5–6, since the
// first one fires immediately on load and subsequent ones every 2 s). A poll
// still in flight when the next tick fires must be aborted via
// AbortController.abort() before the new request is issued.
//
// R-08 also bans WebSocket / SSE — verified separately by inspecting
// network traffic.

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState } = require("./_fixtures");

test.describe("R-08 polling cadence", () => {
  test("5–6 /api/state requests over 10 seconds", async ({ page }) => {
    const timestamps = [];
    page.on("request", (r) => {
      if (/\/api\/state(\?.*)?$/.test(r.url())) timestamps.push(Date.now());
    });
    await installStateRoute(page, [makeState()]);
    await page.goto("/");
    const t0 = Date.now();
    // Measure for 10 seconds from navigation.
    await page.waitForTimeout(10_000);
    // Only count timestamps after goto resolved — crude filter.
    const inWindow = timestamps.filter((t) => t >= t0 - 500);
    expect(inWindow.length).toBeGreaterThanOrEqual(5);
    expect(inWindow.length).toBeLessThanOrEqual(6);
  });

  test("stalled poll is aborted before the next 2 s tick fires", async ({ page }) => {
    const aborted = [];
    page.on("requestfailed", (r) => {
      if (/\/api\/state(\?.*)?$/.test(r.url())) aborted.push(r.failure()?.errorText || "fail");
    });

    // The first poll stalls for 5 s. The dashboard should abort it when
    // the next 2 s tick fires. Later polls are fast and succeed.
    await installStateRoute(page, [
      { kind: "stall", ms: 5000, body: makeState() },
      makeState(),
      makeState()
    ]);
    await page.goto("/");
    await page.waitForTimeout(6_000);
    // At least one request to /api/state must have been aborted/cancelled.
    expect(aborted.length).toBeGreaterThanOrEqual(1);
  });

  test("no WebSocket or SSE connection is opened", async ({ page }) => {
    const wsOpened = [];
    page.on("websocket", (ws) => wsOpened.push(ws.url()));
    const sseRequests = [];
    page.on("request", (r) => {
      const accept = r.headers()["accept"] || "";
      if (accept.includes("text/event-stream")) sseRequests.push(r.url());
    });
    await installStateRoute(page, [makeState()]);
    await page.goto("/");
    await page.waitForTimeout(5_000);
    expect(wsOpened).toEqual([]);
    expect(sseRequests).toEqual([]);
  });
});
