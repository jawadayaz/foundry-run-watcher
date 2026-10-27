// R-12 — Historical runs persist.
//
// Runs with terminal status (`done`, `abandoned_user`, `abandoned_budget`)
// remain visible in the recent-runs list across polls. The dashboard reads
// only from /api/state.runs and never maintains its own history — rows
// identified by run_id, no duplication across polls.

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeRun } = require("./_fixtures");

test.describe("R-12 historical runs persist", () => {
  test("three terminated runs stay visible across two polls, no duplication", async ({ page }) => {
    const runs = [
      makeRun({ run_id: "r_done_1", app_name: "a1", status: "done", phase: "done" }),
      makeRun({ run_id: "r_aband_1", app_name: "a2", status: "abandoned_user", phase: "done" }),
      makeRun({ run_id: "r_aband_2", app_name: "a3", status: "abandoned_budget", phase: "done" })
    ];
    const poll1 = makeState({ runs });
    const poll2 = makeState({ runs }); // identity-by-run_id
    await installStateRoute(page, [poll1, poll2, poll2]);
    await page.goto("/");

    const rows = page.locator("#runs-list .run-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "r_done_1" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "r_aband_1" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "r_aband_2" })).toHaveCount(1);

    // Wait for poll 2 (and perhaps a third) and re-verify no duplication.
    await page.waitForTimeout(4_500);
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "r_done_1" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "r_aband_1" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "r_aband_2" })).toHaveCount(1);
  });

  test("dashboard shows no runs when /api/state.runs is empty (no local persistence)", async ({ page }) => {
    const poll1 = makeState({
      runs: [makeRun({ run_id: "ephemeral", status: "done" })]
    });
    const poll2 = makeState({ runs: [] });
    await installStateRoute(page, [poll1, poll2, poll2]);
    await page.goto("/");
    await expect(page.locator("#runs-list .run-row").filter({ hasText: "ephemeral" })).toHaveCount(1);
    // Once Foundry stops returning the run, the dashboard drops the row —
    // it does NOT keep its own history.
    await expect(
      page.locator("#runs-list .run-row").filter({ hasText: "ephemeral" })
    ).toHaveCount(0, { timeout: 6_000 });
  });
});
