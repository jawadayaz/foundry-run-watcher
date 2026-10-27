// Playwright config for foundry-run-watcher.
//
// The dashboard is a static triple (index.html + app.js + app.css) at the
// project root. Tests mock the Foundry endpoint via page.route(), so we only
// need a plain file server to deliver the static files. We default to a
// local python http.server on 127.0.0.1:4788 but allow override via BASE_URL
// (e.g. the gh-pages live URL during `app-deploy test`).

const { defineConfig } = require("@playwright/test");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4788";
const SERVE_ROOT = process.env.SERVE_ROOT || ".";

module.exports = defineConfig({
  testDir: "./tests/acceptance",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/.report" }]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  // Only spin up a local server when BASE_URL points at the default
  // loopback port. If the operator exports BASE_URL=https://... (gh-pages),
  // we assume the deploy script has already provisioned the server.
  webServer: BASE_URL.startsWith("http://127.0.0.1:4788")
    ? {
        command: `python3 -m http.server 4788 --bind 127.0.0.1 --directory ${SERVE_ROOT}`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 10_000
      }
    : undefined,
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 }
      }
    },
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      },
      // Only the responsive test needs to run on the mobile viewport.
      testMatch: /r10-responsive\.spec\.js$/
    }
  ]
});
