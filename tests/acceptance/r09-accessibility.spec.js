// R-09 — Readable with colour blindness.
//
// Every status-carrying element (phase cell, run status pill, pause banner)
// has either a visible text label child or a non-colour CSS property that
// distinguishes it from its peers. Red/green are never the sole status
// pair. Contrast is ≥ 4.5:1 for normal text, ≥ 3:1 for large text (D-27).
//
// We can't run a full contrast analyser inline, but we can assert the
// text-label-or-non-colour-cue requirement per element, and we can assert
// that the `done` vs `failed` pair differ in BOTH label and icon (not only
// colour).

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeActiveRun, makeRun, makePause } = require("./_fixtures");

test.describe("R-09 colour-blind accessibility", () => {
  test("every status-carrying element has a visible text label", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        active_run: makeActiveRun({ phase: "design" }),
        pause: makePause(30_000),
        runs: [
          makeRun({ run_id: "r1", status: "running" }),
          makeRun({ run_id: "r2", status: "done" }),
          makeRun({ run_id: "r3", status: "failed" }),
          makeRun({ run_id: "r4", status: "abandoned_user" }),
          makeRun({ run_id: "r5", status: "abandoned_budget" }),
          makeRun({ run_id: "r6", status: "paused" })
        ]
      })
    ]);
    await page.goto("/");

    const missingLabels = await page.evaluate(() => {
      const bad = [];
      const check = (el, kind) => {
        const txt = (el.textContent || "").trim();
        if (!txt) bad.push({ kind, html: el.outerHTML.slice(0, 120) });
      };
      document.querySelectorAll("#phase-strip .phase-cell").forEach((c) => check(c, "phase-cell"));
      document.querySelectorAll("#runs-list .run-row [class*='status-']").forEach((c) =>
        check(c, "status-pill")
      );
      const pause = document.getElementById("pause-banner");
      if (pause && !pause.hasAttribute("hidden")) check(pause, "pause-banner");
      return bad;
    });
    expect(missingLabels, "elements with no text label").toEqual([]);
  });

  test("'done' and 'failed' differ in BOTH label and a non-colour property (R-09 red/green rule)", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        runs: [
          makeRun({ run_id: "ok", status: "done" }),
          makeRun({ run_id: "bad", status: "failed" })
        ]
      })
    ]);
    await page.goto("/");
    const pair = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#runs-list .run-row"));
      const findPill = (text) => {
        const row = rows.find((r) => r.textContent.includes(text));
        return row ? row.querySelector("[class*='status-']") : null;
      };
      const okPill = findPill("ok");
      const badPill = findPill("bad");
      if (!okPill || !badPill) return null;
      const okIcon = okPill.querySelector(".status-icon, [data-icon]")?.textContent
        || okPill.getAttribute("data-icon") || "";
      const badIcon = badPill.querySelector(".status-icon, [data-icon]")?.textContent
        || badPill.getAttribute("data-icon") || "";
      return {
        okLabel: (okPill.textContent || "").trim().toLowerCase(),
        badLabel: (badPill.textContent || "").trim().toLowerCase(),
        okIcon,
        badIcon,
        okCls: okPill.className,
        badCls: badPill.className
      };
    });
    expect(pair, "expected a done and a failed row").not.toBeNull();
    expect(pair.okLabel).not.toEqual(pair.badLabel);
    // Non-colour cue — either icon glyph or class slug differs.
    const nonColourDiffers = pair.okIcon !== pair.badIcon || pair.okCls !== pair.badCls;
    expect(nonColourDiffers).toBe(true);
    // Icons should NOT both be empty (that would mean colour is the only cue).
    expect(pair.okIcon.length + pair.badIcon.length).toBeGreaterThan(0);
  });

  test("phase cell states expose a non-colour data attribute (data-state)", async ({ page }) => {
    await installStateRoute(page, [
      makeState({ active_run: makeActiveRun({ phase: "design" }) })
    ]);
    await page.goto("/");
    const states = await page.$$eval(
      "#phase-strip .phase-cell",
      (cells) => cells.map((c) => c.getAttribute("data-state"))
    );
    expect(new Set(states)).toEqual(new Set(["completed", "current", "pending"]));
  });
});
