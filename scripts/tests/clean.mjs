import { rm } from 'node:fs/promises'

// Deliberately fixed paths: never remove tmp/, build/, profiles or test sources.
for (const name of ['test-results', 'benchmark-results', 'coverage', '.nyc_output']) {
  await rm(new URL(`../../${name}`, import.meta.url), { recursive: true, force: true })
  console.log(`Removed ${name}/`)
}
