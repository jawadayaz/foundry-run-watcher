// R-06 — Launchd log tails.
//
// Two labelled, scrollable, preformatted blocks for launchd_out_tail and
// launchd_err_tail. Each ~4 KiB tail must be visible without blowing out
// the page: bounded max-height + overflow-y auto + whitespace preserved.

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState } = require("./_fixtures");

const BIG_TAIL = Array.from({ length: 200 }, (_, i) => `line ${i} with some filler text`).join("\n");

test.describe("R-06 launchd log tails", () => {
  test("both tails exist and are labelled", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        launchd_err_tail: "ERR line 1\nERR line 2\n",
        launchd_out_tail: "OUT line 1\nOUT line 2\n"
      })
    ]);
    await page.goto("/");
    const err = page.locator("#launchd-err-tail");
    const out = page.locator("#launchd-out-tail");
    await expect(err).toBeVisible();
    await expect(out).toBeVisible();
    await expect(err).toContainText("ERR line 1");
    await expect(out).toContainText("OUT line 1");
  });

  test("tails preserve newlines (<pre> or white-space: pre)", async ({ page }) => {
    await installStateRoute(page, [
      makeState({
        launchd_err_tail: "L1\nL2\nL3\n",
        launchd_out_tail: "O1\nO2\n"
      })
    ]);
    await page.goto("/");
    const info = await page.evaluate(() => {
      const inspect = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName,
          ws: cs.whiteSpace,
          maxH: cs.maxHeight,
          overflowY: cs.overflowY
        };
      };
      return { err: inspect("launchd-err-tail"), out: inspect("launchd-out-tail") };
    });
    expect(info.err, "#launchd-err-tail missing").not.toBeNull();
    expect(info.out, "#launchd-out-tail missing").not.toBeNull();
    for (const which of ["err", "out"]) {
      const el = info[which];
      // Either a <pre> or any element whose computed white-space preserves
      // newlines satisfies R-06.
      const preserves = el.tag === "PRE" || /^(pre|pre-wrap|break-spaces)$/.test(el.ws);
      expect(preserves, `${which} must preserve newlines`).toBe(true);
      // Bounded max-height — not 'none'.
      expect(el.maxH).not.toEqual("none");
      // Scrollable.
      expect(["auto", "scroll"]).toContain(el.overflowY);
    }
  });

  test("~4 KiB tail does not blow out the page (scroll height is bounded)", async ({ page }) => {
    await installStateRoute(page, [
      makeState({ launchd_err_tail: BIG_TAIL, launchd_out_tail: BIG_TAIL })
    ]);
    await page.goto("/");
    const bounded = await page.evaluate(() => {
      const el = document.getElementById("launchd-err-tail");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { h: rect.height, sh: el.scrollHeight };
    });
    expect(bounded, "err tail missing").not.toBeNull();
    // Content is longer than the box — scrollHeight > visible height.
    expect(bounded.sh).toBeGreaterThan(bounded.h);
    // Visible height is bounded (less than full viewport).
    expect(bounded.h).toBeLessThan(900);
  });
});
