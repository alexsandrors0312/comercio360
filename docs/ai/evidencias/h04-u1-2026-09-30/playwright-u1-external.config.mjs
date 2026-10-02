export default {
  testDir: `C:/Users/Alexs/AppData/Local/Temp/h04-u1-78223936cb97431ea3d9dc282179834e/${process.env.H04_U1_ARM}/tests/e2e`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3001",
    headless: true,
  },
  reporter: "list",
};
