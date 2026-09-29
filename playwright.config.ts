import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3001", headless: true },
  webServer: [
    {
      command: "node tests/support/auth-server.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "npm run dev -- --port 3001",
      url: "http://127.0.0.1:3001/login",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
        DEMO_ENABLED: "true",
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
  reporter: "list",
});
