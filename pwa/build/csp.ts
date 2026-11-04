import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/**
 * The bot's address is chosen by the person using the app, so any HTTPS host may be called. Plain HTTP is
 * allowed only for the loopback addresses: a bot without a certificate listens on 127.0.0.1 and is reached
 * through an SSH tunnel (bot README, "Without a certificate").
 */
export const CONNECT_SOURCES = "https: http://localhost:* http://127.0.0.1:*"

/**
 * lightweight-charts places TradingView's attribution logo (which its licence asks for) with a small inline
 * <style>. The policy allows exactly that stylesheet by its hash, read from the installed library, so an update
 * that changes it fails the build here instead of being blocked in the browser.
 */
export function chartLogoStyle(): string {
  const require = createRequire(import.meta.url)
  const folder = dirname(require.resolve('lightweight-charts/package.json'))
  const source = readFileSync(join(folder, 'dist', 'lightweight-charts.production.mjs'), 'utf8')
  const found = /innerText\s*=\s*"(a#tv-attr-logo\{[^"]*)"/.exec(source)?.[1]
  if (!found) throw new Error('lightweight-charts: the attribution logo stylesheet was not found; update build/csp.ts.')
  return found
}

/** The page's Content-Security-Policy, with a hash for every inline script (only the pre-paint theme script). */
export function contentSecurityPolicy(html: string): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => sha256(match[1] ?? ''))
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    `style-src 'self' ${sha256(chartLogoStyle())}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${CONNECT_SOURCES}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/**
 * Adds the policy as a meta tag in the built page only: the dev server injects inline scripts of its own.
 * GitHub Pages cannot send headers, so a meta tag is the only way.
 */
export function cspPlugin(): Plugin {
  return {
    name: 'beyond-bot:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(html)}">`
        return html.replace(/(<meta charset="utf-8">)/i, `$1\n    ${meta}`)
      },
    },
  }
}
