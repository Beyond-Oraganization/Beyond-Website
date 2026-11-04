// Lighthouse's mobile performance score for the built app must be 90 or more (CI runs this after the build).
// Lighthouse 12 dropped its PWA category, so installability is checked by e2e/install.spec.ts instead.
//   node scripts/lighthouse.mjs [minimum]   (after npm run build; uses Playwright's Chromium)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { serve } from './serve-app.mjs'

const LIGHTHOUSE = 'lighthouse@13.5.0'
const minimum = Number(process.argv[2] ?? 90)
const port = 4310
const url = `http://localhost:${port}/Beyond-Website/app/`
const folder = mkdtempSync(join(tmpdir(), 'lighthouse-'))
const report = join(folder, 'report.json')

const server = await serve(port)
try {
  // The first visit to the app without a bot shows the Connect screen: what a new user loads first.
  execFileSync(
    'npx',
    ['--yes', LIGHTHOUSE, url, '--only-categories=performance', '--form-factor=mobile', '--screenEmulation.mobile', '--output=json', `--output-path=${report}`, '--quiet', `--chrome-path=${chromium.executablePath()}`, '--chrome-flags=--headless=new --no-sandbox'],
    { stdio: 'inherit' },
  )
  const result = JSON.parse(readFileSync(report, 'utf8'))
  const score = Math.round((result.categories.performance.score ?? 0) * 100)
  const metric = (id) => result.audits[id]?.displayValue ?? '–'
  console.log(`Performance ${score} (at least ${minimum}): FCP ${metric('first-contentful-paint')}, LCP ${metric('largest-contentful-paint')}, TBT ${metric('total-blocking-time')}, CLS ${metric('cumulative-layout-shift')}, SI ${metric('speed-index')}`)
  if (score < minimum) process.exitCode = 1
} finally {
  server.close()
  rmSync(folder, { recursive: true, force: true })
}
