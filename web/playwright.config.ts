import { defineConfig } from "@playwright/test";

// Runs the real Go server on loopback, serving the built page (../dist),
// and drives it with real browsers. Build first: ./web/build.sh dist
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:8091", trace: "retain-on-failure" },
  webServer: {
    command: "go run ./cmd/server",
    cwd: "..",
    url: "http://127.0.0.1:8091/healthz",
    env: { ADDR: "127.0.0.1:8091", STATIC_DIR: "dist" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
