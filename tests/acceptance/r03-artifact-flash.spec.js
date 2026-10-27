// R-03 — Artifact tree with new-file flash.
//
// Between consecutive polls:
//   newPaths = currentPaths \ previousPaths (Set-of-strings diff, D-13)
// Each path in newPaths gets the `.flash` class for ~1500 ms.
// Removed paths disappear silently (D-15).

const { test, expect } = require("@playwright/test");
const { installStateRoute, makeState, makeArtifact } = require("./_fixtures");

test.describe("R-03 artifact tree + new-file flash", () => {
  test("renders path and size for every artifact entry", async ({ page }) => {
    const arts = [
      makeArtifact("SPEC.md", { size: 42 }),
      makeArtifact("src/foo.ts", { size: 128 })
    ];
    await installStateRoute(page, [makeState({ artifacts: arts })]);
    await page.goto("/");
    const list = page.locator("#artifact-list .artifact-row");
    await expect(list).toHaveCount(2);
    await expect(list.filter({ hasText: "SPEC.md" })).toContainText("42");
    await expect(list.filter({ hasText: "src/foo.ts" })).toContainText("128");
  });

  test("new path on poll 2 gets .flash class, loses it within ~1500 ms", async ({ page }) => {
    const poll1 = makeState({
      artifacts: [makeArtifact("SPEC.md"), makeArtifact("ARCHITECTURE.md")]
    });
    const poll2 = makeState({
      artifacts: [
        makeArtifact("SPEC.md"),
        makeArtifact("ARCHITECTURE.md"),
        makeArtifact("src/foo.ts")
      ]
    });
    await installStateRoute(page, [poll1, poll2, poll2, poll2]);
    await page.goto("/");

    // Poll 1 rows exist, no flash on them.
    await expect(page.locator("#artifact-list .artifact-row")).toHaveCount(2);

    // Wait for poll 2 (every 2 s). New row shows up with .flash.
    const fooRow = page
      .locator("#artifact-list .artifact-row")
      .filter({ hasText: "src/foo.ts" });
    await expect(fooRow).toBeVisible({ timeout: 6_000 });
    await expect(fooRow).toHaveClass(/\bflash\b/);

    // Flash should clear within ~1500 ms per R-03 spec (allow slack).
    await expect(fooRow).not.toHaveClass(/\bflash\b/, { timeout: 3_000 });
  });

  test("removed path disappears silently on next poll", async ({ page }) => {
    const poll1 = makeState({
      artifacts: [makeArtifact("keep.md"), makeArtifact("gone.md")]
    });
    const poll2 = makeState({
      artifacts: [makeArtifact("keep.md")]
    });
    await installStateRoute(page, [poll1, poll2, poll2]);
    await page.goto("/");

    await expect(page.locator("#artifact-list .artifact-row")).toHaveCount(2);
    // After the second poll fires:
    await expect(
      page.locator("#artifact-list .artifact-row").filter({ hasText: "gone.md" })
    ).toHaveCount(0, { timeout: 6_000 });
    await expect(
      page.locator("#artifact-list .artifact-row").filter({ hasText: "keep.md" })
    ).toHaveCount(1);
  });

  test("first poll's artifacts are NOT flashed (first-poll suppression is optional, but at a minimum the flash must clear before 3 s)", async ({ page }) => {
    const poll1 = makeState({ artifacts: [makeArtifact("SPEC.md")] });
    await installStateRoute(page, [poll1, poll1]);
    await page.goto("/");
    const row = page.locator("#artifact-list .artifact-row").first();
    await expect(row).toBeVisible();
    // Whether or not the first-poll row initially flashes, it must not
    // flash forever — allow the standard 1500 ms + 1500 ms slack.
    await expect(row).not.toHaveClass(/\bflash\b/, { timeout: 3_000 });
  });
});
