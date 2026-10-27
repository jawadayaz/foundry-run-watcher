// R-05 — Queue and recent runs lists.
//
// Queue: per-entry minimum fields app_name + optional created_at (D-A06).
// Runs: cap at 10 rows, each row shows run_id, app_name, status, created_at,
// phase (or '—' if absent) (D-A07). Known status labels have distinct text
// AND non-colour visual treatment per R-09.

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeRun } = require("./_fixtures");

function fifteenRuns() {
  const out = [];
  for (let i = 0; i < 15; i++) {
    out.push(
      makeRun({
        run_id: `run_${String(i).padStart(3, "0")}`,
        app_name: `app_${i}`,
        status: i === 0 ? "running" : i === 1 ? "abandoned_user" : "done",
        created_at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
        phase: i === 0 ? "design" : "done"
      })
    );
  }
  return out;
}

test.describe("R-05 queue + recent runs", () => {
  test("queue list renders app_name + optional created_at", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        queue: [
          { app_name: "pending-one", created_at: "2026-10-26T10:00:00Z" },
          { app_name: "pending-two" }
        ]
      })
    ]);
    await page.goto("/");
    const items = page.locator("#queue-list .queue-row");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("pending-one");
    await expect(items.nth(0)).toContainText(/2026|10:00|ago|min|sec|h/i);
    await expect(items.nth(1)).toContainText("pending-two");
  });

  test("recent runs caps at 10 rows and shows the five required fields per row", async ({ page }) => {
    await installStateRoute(page, [makeState({ runs: fifteenRuns() })]);
    await page.goto("/");
    const rows = page.locator("#runs-list .run-row");
    await expect(rows).toHaveCount(10);
    const first = rows.first();
    await expect(first).toContainText("run_000");
    await expect(first).toContainText("app_0");
    await expect(first).toContainText(/running/i);
    await expect(first).toContainText(/2026|ago|min|sec|h/i);
    await expect(first).toContainText("design");
  });

  test("missing phase renders '—'", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        runs: [makeRun({ run_id: "run_terminated", status: "done", phase: undefined })]
      })
    ]);
    await page.goto("/");
    const row = page.locator("#runs-list .run-row").first();
    await expect(row).toContainText("—");
  });

  test("status 'abandoned_user' and 'done' differ in label text AND a non-colour attribute", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        runs: [
          makeRun({ run_id: "run_a", app_name: "ax", status: "abandoned_user" }),
          makeRun({ run_id: "run_b", app_name: "bx", status: "done" })
        ]
      })
    ]);
    await page.goto("/");
    const info = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#runs-list .run-row"));
      const pick = (txt) => rows.find((r) => r.textContent.includes(txt));
      const a = pick("run_a");
      const b = pick("run_b");
      if (!a || !b) return null;
      // Status pill is `.status-<slug>` on some element inside the row.
      const pillA = a.querySelector("[class*='status-']");
      const pillB = b.querySelector("[class*='status-']");
      const iconA = pillA?.querySelector(".status-icon, [data-icon]")?.textContent
        || pillA?.getAttribute("data-icon") || "";
      const iconB = pillB?.querySelector(".status-icon, [data-icon]")?.textContent
        || pillB?.getAttribute("data-icon") || "";
      return {
        pillAText: (pillA?.textContent || "").trim(),
        pillBText: (pillB?.textContent || "").trim(),
        iconA,
        iconB,
        clsA: pillA?.className || "",
        clsB: pillB?.className || ""
      };
    });
    expect(info, "expected two status pills in the runs list").not.toBeNull();
    // Label text differs.
    expect(info.pillAText).not.toEqual(info.pillBText);
    // Non-colour property differs — either icon glyph or class suffix.
    const nonColourDiffers = info.iconA !== info.iconB || info.clsA !== info.clsB;
    expect(nonColourDiffers).toBe(true);
  });

  test("unknown status renders verbatim with neutral styling", async ({ page }) => {
    await installStateRoute(page, [
      makeState({ runs: [makeRun({ run_id: "run_x", status: "quarantined" })] })
    ]);
    await page.goto("/");
    const row = page.locator("#runs-list .run-row").first();
    await expect(row).toContainText("quarantined");
    const hasUnknownClass = await row
      .locator("[class*='status-unknown']")
      .count();
    expect(hasUnknownClass).toBeGreaterThan(0);
  });
});
