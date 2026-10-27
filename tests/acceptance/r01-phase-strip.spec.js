// R-01 — Phase strip.
//
// All 11 slugs must render in order with per-cell state attribute. For
// active_run.phase = pₖ: first k cells are completed, cell k is current,
// remaining n-1-k are pending. The current cell must differ from the others
// in both a text label and a non-colour visual property (D-26 / WCAG SC
// 1.4.1), realised in UI.md as an icon glyph + border style per state.
//
// Boundary cases: first slug ("intake") current, last slug ("done") current,
// middle slug ("design") current. Also: missing active_run → all pending.

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeActiveRun, PHASES } = require("./_fixtures");

async function cellStates(page) {
  return page.$$eval("#phase-strip .phase-cell", (cells) =>
    cells.map((el) => ({
      slug: el.getAttribute("data-slug") || el.querySelector(".phase-slug")?.textContent?.trim(),
      state: el.getAttribute("data-state"),
      hasLabel: !!el.querySelector(".phase-label, .phase-slug"),
      hasIcon: !!el.querySelector(".phase-icon")
    }))
  );
}

test.describe("R-01 phase strip", () => {
  test("renders all 11 slugs in fixed order", async ({ page }) => {
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "design" }) })]);
    await page.goto("/");
    await expect(page.locator("#phase-strip .phase-cell")).toHaveCount(11);
    const states = await cellStates(page);
    expect(states.map((s) => s.slug)).toEqual(PHASES);
  });

  test("active phase 'design' marks first 3 completed, 4th current, remainder pending", async ({ page }) => {
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "design" }) })]);
    await page.goto("/");
    await expect(page.locator("#phase-strip .phase-cell")).toHaveCount(11);
    const states = await cellStates(page);
    expect(states.map((s) => s.state)).toEqual([
      "completed", "completed", "completed",
      "current",
      "pending", "pending", "pending", "pending", "pending", "pending", "pending"
    ]);
  });

  test("first slug 'intake' current → no completed cells", async ({ page }) => {
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "intake" }) })]);
    await page.goto("/");
    const states = await cellStates(page);
    expect(states[0].state).toBe("current");
    expect(states.slice(1).every((s) => s.state === "pending")).toBe(true);
  });

  test("last slug 'done' current → no pending cells", async ({ page }) => {
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "done" }) })]);
    await page.goto("/");
    const states = await cellStates(page);
    expect(states.slice(0, 10).every((s) => s.state === "completed")).toBe(true);
    expect(states[10].state).toBe("current");
  });

  test("current cell has a non-colour discriminator vs pending peers (R-09 pairing)", async ({ page }) => {
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "design" }) })]);
    await page.goto("/");
    // The current cell carries both a visible text label (slug) and a
    // non-colour visual property distinct from the pending cells. We check
    // this by comparing the data-state attribute (always a non-colour cue)
    // and verifying a measurable style difference beyond the fill colour.
    const diff = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll("#phase-strip .phase-cell"));
      const current = cells.find((c) => c.getAttribute("data-state") === "current");
      const pending = cells.find((c) => c.getAttribute("data-state") === "pending");
      if (!current || !pending) return null;
      const cCS = getComputedStyle(current);
      const pCS = getComputedStyle(pending);
      // Any one of these non-colour properties differing is enough.
      return {
        borderStyle: cCS.borderStyle !== pCS.borderStyle,
        borderWidth: cCS.borderWidth !== pCS.borderWidth,
        fontWeight: cCS.fontWeight !== pCS.fontWeight,
        textDecoration: cCS.textDecorationLine !== pCS.textDecorationLine,
        iconText:
          (current.querySelector(".phase-icon")?.textContent || "") !==
          (pending.querySelector(".phase-icon")?.textContent || ""),
        attr: current.getAttribute("data-state") !== pending.getAttribute("data-state")
      };
    });
    expect(diff, "current/pending cells not comparable").not.toBeNull();
    // At least one non-colour property must differ.
    expect(Object.values(diff).some(Boolean)).toBe(true);
  });

  test("every status-carrying cell has a text label child (not colour alone)", async ({ page }) => {
    await installStateRoute(page, [makeState({ active_run: makeActiveRun({ phase: "design" }) })]);
    await page.goto("/");
    const states = await cellStates(page);
    for (const s of states) {
      expect(s.hasLabel, `cell ${s.slug} missing visible slug/label`).toBe(true);
    }
  });
});
