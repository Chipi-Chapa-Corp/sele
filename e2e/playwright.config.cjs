module.exports = {
  testDir: '.',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 60_000
  },
  reporter: 'line',
  use: {
    trace: 'retain-on-failure'
  }
}
