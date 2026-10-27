// R-11 — Multi-run tracking with click-to-inspect.
//
// Clicking a run row calls GET /api/run/<run_id> and renders that run's
// artifacts + node history in the inspect pane, even for terminal
// (non-live) runs. The live run row carries a 'live' label; the phase
// strip continues to update from /api/state independently of the inspect
// pane.

const { test, expect } = require("@playwright/test");
const {
  installStateRoute,
  installRunRoute,
  makeState,
  makeActiveRun,
  makeRun
} = require("./_fixtures");

test.describe("R-11 click-to-inspect", () => {
  test("clicking a terminal run row loads /api/run/<id> and populates the inspect pane", async ({ page }) => {
    const state = makeState({
      active_run: makeActiveRun({ run_id: "run_live", phase: "spec" }),
      runs: [
        makeRun({ run_id: "run_live", app_name: "live-app", status: "running", phase: "spec" }),
        makeRun({ run_id: "run_aband", app_name: "aband-app", status: "abandoned_user", phase: "done" }),
        makeRun({ run_id: "run_done", app_name: "done-app", status: "done", phase: "done" })
      ]
    });
    await installStateRoute(page, [state, state, state]);

    const seen = {};
    await installRunRoute(
      page,
      {
        run_aband: {
          run_id: "run_aband",
          app_name: "aband-app",
          status: "abandoned_user",
          artifacts: [
            { path: "aband/README.md", size: 20, mtime: 1 },
            { path: "aband/SPEC.md", size: 40, mtime: 2 }
          ],
          nodes: [
            { node: "intake", status: "ok", started_at: "2026-10-26T10:00:00Z", finished_at: "2026-10-26T10:00:01Z" },
            { node: "research", status: "ok" }
          ]
        }
      },
      { expose: seen }
    );

    await page.goto("/");
    await expect(page.locator("#runs-list .run-row")).toHaveCount(3);

    await page.locator("#runs-list .run-row").filter({ hasText: "run_aband" }).click();

    // One /api/run request to the right id.
    await expect.poll(() => seen.seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.seen).toContain("run_aband");

    // Inspect pane populated with artifacts + node history.
    const inspect = page.locator("#inspect-pane");
    await expect(inspect).toContainText("aband/README.md");
    await expect(inspect).toContainText("aband/SPEC.md");
    await expect(inspect).toContainText("intake");
    await expect(inspect).toContainText("research");

    // Live run row carries a 'live' label.
    const liveRow = page.locator("#runs-list .run-row").filter({ hasText: "run_live" });
    await expect(liveRow).toContainText(/live/i);
  });

  test("phase strip keeps updating from /api/state while inspect pane shows a historical run", async ({ page }) => {
    const poll1 = makeState({
      active_run: makeActiveRun({ run_id: "run_live", phase: "spec" }),
      runs: [
        makeRun({ run_id: "run_live", status: "running", phase: "spec" }),
        makeRun({ run_id: "run_done", status: "done", phase: "done" })
      ]
    });
    const poll2 = makeState({
      active_run: makeActiveRun({ run_id: "run_live", phase: "design" }),
      runs: poll1.runs
    });
    await installStateRoute(page, [poll1, poll2, poll2]);
    await installRunRoute(page, {
      run_done: { run_id: "run_done", artifacts: [{ path: "done/x.md", size: 1, mtime: 1 }], nodes: [] }
    });

    await page.goto("/");
    await expect(page.locator("#phase-strip .phase-cell[data-state='current']")).toContainText(/spec/);

    await page.locator("#runs-list .run-row").filter({ hasText: "run_done" }).click();
    await expect(page.locator("#inspect-pane")).toContainText("done/x.md");

    // Phase strip advances to 'design' on poll 2, independent of inspect pane.
    await expect(page.locator("#phase-strip .phase-cell[data-state='current']")).toContainText(
      /design/,
      { timeout: 6_000 }
    );

    // Inspect pane still shows the historical run.
    await expect(page.locator("#inspect-pane")).toContainText("done/x.md");
  });
});
