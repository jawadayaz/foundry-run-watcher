// R-10 — Mobile-friendly layout.
//
// ≤ 767 px: panels stack vertically in a single column; artifact tree is
// collapsed behind a user-expandable toggle. ≥ 1280 px: three-pane layout.
// Breakpoint implemented via @media (min-width: 1280px).
//
// We run this spec both at 390×844 (mobile project) and 1280×800 (desktop
// project — the file matches the default `testMatch`).

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeActiveRun, makeArtifact } = require("./_fixtures");

test.describe("R-10 responsive layout", () => {
  test("mobile viewport: single column + artifact tree collapsed behind toggle", async ({ page, viewport }) => {
    test.skip(viewport.width >= 1280, "only runs at mobile viewport width");
    await installStateRoute(page, [
      makeState({
        active_run: makeActiveRun({ phase: "design" }),
        artifacts: [makeArtifact("SPEC.md"), makeArtifact("ARCHITECTURE.md")]
      })
    ]);
    await page.goto("/");

    // Artifact list is hidden inside a collapsed <details> or an aria-expanded="false" toggle.
    const collapsed = await page.evaluate(() => {
      const details = document.querySelector("#artifact-details");
      if (details && details.tagName === "DETAILS") return !details.open;
      // Fallback: look for a toggle whose target panel is hidden.
      const toggle = document.querySelector(
        "[aria-controls='artifact-list'], [data-toggle='artifact-list']"
      );
      if (!toggle) return false;
      return toggle.getAttribute("aria-expanded") === "false";
    });
    expect(collapsed, "artifact tree should be collapsed on mobile first paint").toBe(true);

    // Panels stack: inspect the computed grid-template-columns of the main
    // grid container. At mobile width this should resolve to a single
    // column (no multi-column grid).
    const singleCol = await page.evaluate(() => {
      const grid = document.querySelector(".body-grid, main.app, #app");
      if (!grid) return null;
      const cs = getComputedStyle(grid);
      const tracks = cs.gridTemplateColumns.split(" ").filter(Boolean);
      return tracks.length <= 1;
    });
    // Null is acceptable (if the dev used flex rather than grid). Only
    // fail when a grid is present and has multiple tracks.
    if (singleCol !== null) expect(singleCol).toBe(true);
  });

  test("desktop viewport: three-pane layout", async ({ page, viewport }) => {
    test.skip(viewport.width < 1280, "only runs at desktop viewport width");
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "design" }) })]);
    await page.goto("/");
    const info = await page.evaluate(() => {
      const grid = document.querySelector(".body-grid, main.app, #app");
      if (!grid) return null;
      const cs = getComputedStyle(grid);
      const tracks = cs.gridTemplateColumns.split(" ").filter((t) => t && t !== "none");
      return { tracks: tracks.length, display: cs.display };
    });
    expect(info, "expected a top-level grid container").not.toBeNull();
    expect(info.tracks).toBeGreaterThanOrEqual(3);
  });

  test("desktop viewport: 11 phase cells + both log tails + runs list all rendered", async ({ page, viewport }) => {
    test.skip(viewport.width < 1280, "only runs at desktop viewport width");
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "design" }) })]);
    await page.goto("/");
    await expect(page.locator("#phase-strip .phase-cell")).toHaveCount(11);
    await expect(page.locator("#launchd-err-tail")).toBeVisible();
    await expect(page.locator("#launchd-out-tail")).toBeVisible();
    await expect(page.locator("#runs-list")).toBeVisible();
  });
});
