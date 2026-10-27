// R-07 — Resilient to transient fetch errors.
//
// On any failed poll (fetch rejection, !response.ok, abort), the UI must:
//  1) retain the last-known-good state in memory,
//  2) continue rendering it,
//  3) display a subtle 'stale (last update Xs ago)' indicator computed from
//     Date.now() − lastGoodPollMs,
//  4) retry on the next 2 s tick without surfacing a user-facing error,
//  5) clear the stale indicator on the next successful poll.

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeActiveRun } = require("./_fixtures");

test.describe("R-07 stale resilience", () => {
  test("aborted polls keep last-known-good state in the DOM and show incrementing stale indicator; clears on recovery", async ({ page }) => {
    const good = makeState({
      active_run: makeActiveRun({ phase: "spec", run_id: "live" }),
      runs: [
        { run_id: "live", app_name: "demo", status: "running", created_at: "2026-10-26T10:00:00Z", phase: "spec" }
      ]
    });
    const recovered = makeState({
      active_run: makeActiveRun({ phase: "design", run_id: "live" }),
      runs: good.runs
    });
    // Poll 1 ok, polls 2–5 abort, poll 6 ok (recovered state).
    await installStateRoute(page, [
      good,
      { kind: "abort" },
      { kind: "abort" },
      { kind: "abort" },
      { kind: "abort" },
      recovered,
      recovered
    ]);
    await page.goto("/");

    // Poll 1 populates the phase strip; verify.
    await expect(page.locator("#phase-strip .phase-cell[data-state='current']")).toContainText(/spec/);

    // Stale indicator appears while polls 2–5 abort.
    const stale = page.locator("#stale-indicator");
    await expect(stale).toBeVisible({ timeout: 6_000 });
    const first = (await stale.textContent()) || "";
    expect(first).toMatch(/stale/i);
    expect(first).toMatch(/\d+\s*s/);

    // The last-known-good phase strip is still rendered (not wiped).
    await expect(page.locator("#phase-strip .phase-cell[data-state='current']")).toContainText(/spec/);

    // The seconds counter increments.
    await page.waitForTimeout(2_500);
    const second = (await stale.textContent()) || "";
    const n1 = parseInt((first.match(/\d+/) || [0])[0], 10);
    const n2 = parseInt((second.match(/\d+/) || [0])[0], 10);
    expect(n2).toBeGreaterThan(n1);

    // Poll 6 recovers → stale clears, phase strip updates to recovered state.
    await expect(stale).toBeHidden({ timeout: 8_000 });
    await expect(page.locator("#phase-strip .phase-cell[data-state='current']")).toContainText(/design/);
  });

  test("HTTP 500 is treated the same as a network error (last-known-good retained)", async ({ page }) => {
    const good = makeState({ active_run: makeActiveRun({ phase: "spec" }) });
    await installStateRoute(page, [
      good,
      { kind: "fail", status: 500 },
      { kind: "fail", status: 500 },
      { kind: "fail", status: 500 }
    ]);
    await page.goto("/");
    await expect(page.locator("#phase-strip .phase-cell[data-state='current']")).toContainText(/spec/);
    const stale = page.locator("#stale-indicator");
    await expect(stale).toBeVisible({ timeout: 6_000 });
    // Phase strip is still rendered.
    await expect(page.locator("#phase-strip .phase-cell[data-state='current']")).toContainText(/spec/);
  });

  test("no user-facing error dialog or alert box is surfaced on failure", async ({ page }) => {
    const dialogs = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      d.dismiss();
    });
    await installStateRoute(page, [
      makeState(),
      { kind: "abort" },
      { kind: "abort" },
      { kind: "abort" }
    ]);
    await page.goto("/");
    await page.waitForTimeout(5_000);
    expect(dialogs).toEqual([]);
  });
});
