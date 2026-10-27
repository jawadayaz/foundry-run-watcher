// R-04 — File preview with mtime refresh.
//
// Click an artifact row → GET /api/file?path=<encoded rel> → render body in
// a <pre>. On a subsequent poll, if that artifact's mtime has increased,
// re-fetch and replace content. Binary bodies (NUL in first 1 KiB) show
// "binary file — preview unavailable".

const { test, expect } = require("@playwright/test");
const {
  installStateRoute,
  installFileRoute,
  makeState,
  makeArtifact,
  bytesWithNul
} = require("./_fixtures");

test.describe("R-04 file preview + mtime refresh", () => {
  test("clicking a row issues ONE /api/file request with URL-encoded path", async ({ page }) => {
    const poll = makeState({
      artifacts: [makeArtifact("src/path with space.ts", { mtime: 1_700_000_100 })]
    });
    await installStateRoute(page, [poll]);
    const seen = {};
    await installFileRoute(
      page,
      { "src/path with space.ts": "hello world\n" },
      { expose: seen }
    );
    await page.goto("/");
    await page
      .locator("#artifact-list .artifact-row")
      .filter({ hasText: "src/path with space.ts" })
      .click();
    const preview = page.locator("#preview-content");
    await expect(preview).toContainText("hello world");
    expect(seen.seen).toEqual(["src/path with space.ts"]);
    // Also assert the raw URL used the %20 encoding — check network via
    // request event. (The fixture decodes the param, so this is the proof.)
    const reqs = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/file")) reqs.push(r.url());
    });
    // Re-click to generate a second request we can observe.
    await page
      .locator("#artifact-list .artifact-row")
      .filter({ hasText: "src/path with space.ts" })
      .click();
    await expect.poll(() => reqs.length).toBeGreaterThanOrEqual(1);
    expect(reqs[0]).toMatch(/path=src%2Fpath(%20|\+)with(%20|\+)space\.ts/);
  });

  test("mtime bump on a later poll triggers a second /api/file request", async ({ page }) => {
    const poll1 = makeState({ artifacts: [makeArtifact("foo.md", { mtime: 1000 })] });
    const poll2 = makeState({ artifacts: [makeArtifact("foo.md", { mtime: 2000 })] });
    await installStateRoute(page, [poll1, poll2, poll2]);

    // Two distinct bodies so we can see the content swap.
    let hit = 0;
    await page.route(/\/api\/file(\?.*)?$/, async (route) => {
      hit += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: hit === 1 ? "version A" : "version B"
      });
    });

    await page.goto("/");
    await page
      .locator("#artifact-list .artifact-row")
      .filter({ hasText: "foo.md" })
      .click();
    const preview = page.locator("#preview-content");
    await expect(preview).toContainText("version A");

    // Wait for poll 2 + mtime-triggered refetch.
    await expect(preview).toContainText("version B", { timeout: 6_000 });
    expect(hit).toBeGreaterThanOrEqual(2);
  });

  test("no refetch when mtime is unchanged across polls", async ({ page }) => {
    const polls = [1, 2, 3].map(() =>
      makeState({ artifacts: [makeArtifact("foo.md", { mtime: 1000 })] })
    );
    await installStateRoute(page, polls);
    let hit = 0;
    await page.route(/\/api\/file(\?.*)?$/, async (route) => {
      hit += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "constant"
      });
    });
    await page.goto("/");
    await page
      .locator("#artifact-list .artifact-row")
      .filter({ hasText: "foo.md" })
      .click();
    await expect(page.locator("#preview-content")).toContainText("constant");
    // Let 2 extra polls fire — hit count must stay at 1 (only the click).
    await page.waitForTimeout(5_000);
    expect(hit).toBe(1);
  });

  test("binary body (leading NUL) renders the fallback message, not raw bytes", async ({ page }) => {
    await installStateRoute(page, [
      makeState({ artifacts: [makeArtifact("bin.dat", { mtime: 1 })] })
    ]);
    const nulBytes = bytesWithNul(32, 0);
    await page.route(/\/api\/file(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: nulBytes
      });
    });
    await page.goto("/");
    await page
      .locator("#artifact-list .artifact-row")
      .filter({ hasText: "bin.dat" })
      .click();
    const panel = page.locator("#preview-pane");
    await expect(panel).toContainText("binary file");
    await expect(panel).toContainText("preview unavailable");
  });
});
