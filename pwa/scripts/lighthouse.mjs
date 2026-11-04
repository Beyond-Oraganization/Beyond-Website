// Lighthouse's mobile performance score for the built app must be 90 or more (CI runs this after the build). It is
// the median of three runs, as single runs vary by a few points. Lighthouse 12 dropped its PWA category, so
// installability is checked by e2e/install.spec.ts instead.
//   node scripts/lighthouse.mjs [minimum]   (after npm run build; uses Playwright's Chromium)
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { serve } from './serve-app.mjs'

const LIGHTHOUSE = 'lighthouse@13.5.0'
const RUNS = 3
const minimum = Number(process.argv[2] ?? 90)
const port = 4310
// A first visit without a bot shows the Connect screen: what a new user loads first.
const url = `http://localhost:${port}/Beyond-Website/app/`
const folder = mkdtempSync(join(tmpdir(), 'lighthouse-'))
const run = promisify(execFile)

// Asynchronous on purpose: the page is served by this same process, which must keep answering meanwhile.
const server = await serve(port)
const results = []
try {
  for (let i = 1; i <= RUNS; i++) {
    const report = join(folder, `report-${i}.json`)
    await run('npx', [
      '--yes', LIGHTHOUSE, url, '--only-categories=performance', '--form-factor=mobile', '--output=json', `--output-path=${report}`, '--quiet',
      '--max-wait-for-load=30000', `--chrome-path=${chromium.executablePath()}`, '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
    ], { maxBuffer: 1 << 26 })
    const result = JSON.parse(readFileSync(report, 'utf8'))
    const score = Math.round((result.categories.performance.score ?? 0) * 100)
    const metric = (id) => result.audits[id]?.displayValue ?? '–'
    console.log(`Run ${i}: performance ${score}; FCP ${metric('first-contentful-paint')}, LCP ${metric('largest-contentful-paint')}, TBT ${metric('total-blocking-time')}, CLS ${metric('cumulative-layout-shift')}, SI ${metric('speed-index')}`)
    results.push(score)
  }
  const median = [...results].sort((a, b) => a - b)[Math.floor(RUNS / 2)]
  console.log(`Median mobile performance ${median} (at least ${minimum}).`)
  if (median < minimum) process.exitCode = 1
} finally {
  server.close()
  rmSync(folder, { recursive: true, force: true })
}
