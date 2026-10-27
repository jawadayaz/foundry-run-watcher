// R-02 — Pause banner with live countdown.
//
// Behaviour:
//   - When /api/state.pause is non-null, render a visible banner showing
//     kind, node, raw_preview, and a countdown.
//   - The countdown ticks every second between polls (not only on poll).
//   - When pause returns null on a later poll, the banner disappears.
//
// Uses page.clock.install() + fastForward() per D-36.

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeActiveRun, makePause } = require("./_fixtures");

test.describe("R-02 pause banner", () => {
  test("renders banner with kind, node, raw_preview when pause is non-null", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        active_run: makeActiveRun({ status: "paused" }),
        pause: makePause(30_000, {
          kind: "human-in-the-loop",
          node: "spec",
          raw_preview: "Awaiting operator confirmation"
        })
      })
    ]);
    await page.goto("/");
    const banner = page.locator("#pause-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("human-in-the-loop");
    await expect(banner).toContainText("spec");
    await expect(banner).toContainText("Awaiting operator confirmation");
  });

  test("countdown decrements every second between polls (virtual clock)", async ({ page }) => {
    // Install the virtual clock BEFORE navigation so setInterval and
    // Date.now() both resolve against it.
    const t0 = Date.UTC(2026, 9, 26, 12, 0, 0);
    await page.clock.install({ time: new Date(t0) });

    // One single state response — poll interval is 2 s but we drive the
    // clock forward in 1-second steps and watch the banner's own ticker.
    const resetAt = new Date(t0 + 30_000).toISOString();
    await installStateRoute(page, [
      makeState({
        active_run: makeActiveRun({ status: "paused" }),
        pause: makePause(30_000, { reset_at: resetAt, seconds_until_reset: 30 })
      })
    ]);
    await page.goto("/");
    const countdown = page.locator("#pause-countdown");
    await expect(countdown).toBeVisible();

    const read = async () => {
      const txt = await countdown.textContent();
      const m = (txt || "").match(/-?\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    };

    const first = await read();
    expect(first, "initial countdown must parse to a number").not.toBeNaN();
    expect(first).toBeGreaterThanOrEqual(29);
    expect(first).toBeLessThanOrEqual(30);

    // Advance 1 virtual second — the 1 Hz ticker should fire regardless of
    // whether a new poll has landed.
    await page.clock.fastForward(1_000);
    const second = await read();
    expect(second).toBeLessThan(first);

    // Advance 5 more virtual seconds — strict monotonic decrease.
    await page.clock.fastForward(5_000);
    const third = await read();
    expect(third).toBeLessThan(second);
  });

  test("banner disappears on a later poll where pause returns to null", async ({ page }) => {
    await installStateRoute(page, [
      makeState({ pause: makePause(30_000) }),
      makeState({ pause: null }), // second poll clears it
      makeState({ pause: null })
    ]);
    await page.goto("/");
    const banner = page.locator("#pause-banner");
    await expect(banner).toBeVisible();
    // 2 s poll cadence per R-08; wait up to 6 s for the clearing poll.
    await expect(banner).toBeHidden({ timeout: 6_000 });
  });

  test("countdown clamps at 0, never negative", async ({ page }) => {
    const t0 = Date.UTC(2026, 9, 26, 12, 0, 0);
    await page.clock.install({ time: new Date(t0) });
    const resetAt = new Date(t0 + 2_000).toISOString();
    await installStateRoute(page, [
      makeState({ pause: makePause(2_000, { reset_at: resetAt, seconds_until_reset: 2 }) })
    ]);
    await page.goto("/");
    const countdown = page.locator("#pause-countdown");
    await expect(countdown).toBeVisible();
    // Fast-forward well past the reset — the number must clamp to 0.
    await page.clock.fastForward(10_000);
    const txt = (await countdown.textContent()) || "";
    const n = parseInt((txt.match(/-?\d+/) || ["x"])[0], 10);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  });
});
