// Golden-case runner.
//
// Every golden JSON pins a non-ambiguous domain rule to the output of one of
// six pure helpers inside app.js. The architect (ARCHITECTURE.md) states the
// coder must expose these helpers on `window.__helpers` (or compatible) so
// they are callable from Playwright `page.evaluate()`:
//
//   window.__helpers = {
//     classifyPhase(index, activeIndex): "completed" | "current" | "pending",
//     countdownSeconds(resetMs, now): number,
//     secondsUntilResetFallback(secondsUntilReset, pollReceivedAt, now): number,
//     diffPaths(previous: string[], current: string[]): string[],  // sorted
//     isBinaryPreview(bytes: Uint8Array): boolean,
//     classifyStatus(status: string): { label, icon, cls }
//   };
//
// For `isBinaryPreview`, the golden input is a byte-array factory
// `{ byteCount, nulAt }`; the runner materialises a Uint8Array of that shape
// before calling.
//
// Against an empty implementation (`window.__helpers === undefined` or any
// missing method) every golden test fails — satisfying the test-author rule
// "tests must fail on an empty implementation".

const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { installStateRoute, makeState } = require("./_fixtures");

const GOLDEN_DIR = path.join(__dirname, "..", "..", "golden");

function loadGoldens() {
  const files = fs
    .readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => ({
    file: f,
    body: JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), "utf8"))
  }));
}

const GOLDENS = loadGoldens();

test.describe("golden cases — pure helpers", () => {
  // Give the page a quiet /api/state so the poll loop doesn't noise up logs.
  test.beforeEach(async ({ page }) => {
    await installStateRoute(page, [makeState()]);
    await page.goto("/");
  });

  test("app.js exposes window.__helpers with all six functions", async ({ page }) => {
    const shape = await page.evaluate(() => {
      const h = window.__helpers;
      if (!h) return null;
      return {
        classifyPhase: typeof h.classifyPhase,
        countdownSeconds: typeof h.countdownSeconds,
        secondsUntilResetFallback: typeof h.secondsUntilResetFallback,
        diffPaths: typeof h.diffPaths,
        isBinaryPreview: typeof h.isBinaryPreview,
        classifyStatus: typeof h.classifyStatus
      };
    });
    expect(shape, "window.__helpers is not defined (empty impl)").not.toBeNull();
    expect(shape).toEqual({
      classifyPhase: "function",
      countdownSeconds: "function",
      secondsUntilResetFallback: "function",
      diffPaths: "function",
      isBinaryPreview: "function",
      classifyStatus: "function"
    });
  });

  for (const { file, body: g } of GOLDENS) {
    test(`${g.id} :: ${g.function} :: ${file}`, async ({ page }) => {
      const result = await page.evaluate(({ g }) => {
        const h = window.__helpers;
        if (!h || typeof h[g.function] !== "function") {
          return { __missing: true, fn: g.function };
        }
        let args;
        switch (g.function) {
          case "classifyPhase":
            args = [g.input.index, g.input.activeIndex];
            break;
          case "countdownSeconds":
            args = [g.input.resetMs, g.input.now];
            break;
          case "secondsUntilResetFallback":
            args = [g.input.secondsUntilReset, g.input.pollReceivedAt, g.input.now];
            break;
          case "diffPaths": {
            // Return a sorted array for stable comparison with the expected
            // array in the golden file.
            const out = h.diffPaths(g.input.previous, g.input.current);
            const arr = Array.isArray(out) ? out.slice() : Array.from(out);
            arr.sort();
            return { value: arr };
          }
          case "isBinaryPreview": {
            const { byteCount, nulAt } = g.input;
            const bytes = new Uint8Array(byteCount);
            // Fill with 'A' (0x41). Leave 0x00 at nulAt if provided.
            for (let i = 0; i < byteCount; i++) bytes[i] = 0x41;
            if (nulAt !== null && nulAt !== undefined && nulAt >= 0 && nulAt < byteCount) {
              bytes[nulAt] = 0x00;
            }
            return { value: h.isBinaryPreview(bytes) };
          }
          case "classifyStatus":
            args = [g.input];
            break;
          default:
            return { __unknownFn: g.function };
        }
        return { value: h[g.function](...args) };
      }, { g });

      expect(result.__missing, `helper ${g.function} missing from window.__helpers`).toBeUndefined();
      expect(result.__unknownFn, "golden references an unknown function").toBeUndefined();
      expect(result.value).toEqual(g.expected);
    });
  }
});
