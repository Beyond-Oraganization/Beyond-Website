// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The colour tokens of :root and :root[data-theme="light"], as the website's checks.py reads them. */
function tokens(css: string): Record<'classic' | 'light', Record<string, string>> {
  const block = (selector: RegExp) => {
    const body = selector.exec(css)?.[1] ?? ''
    return Object.fromEntries([...body.matchAll(/--([a-z-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]))
  }
  const classic = block(/:root\{([^}]*)\}/)
  return { classic, light: { ...classic, ...block(/:root\[data-theme="light"\]\{([^}]*)\}/) } }
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

const site = tokens(readFileSync(new URL('../../../beyondia.css', import.meta.url), 'utf8'))
const app = tokens(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'))

describe('the app’s colours are the website’s', () => {
  for (const theme of ['classic', 'light'] as const)
    it(`${theme} theme: every site token has the site's value`, () => {
      for (const [name, value] of Object.entries(site[theme])) expect(`--${name} ${app[theme][name]}`).toBe(`--${name} ${value}`)
    })
})

// The website's CONTRAST_PAIRS (manager/beyondia_manager/checks.py), plus the app's profit and loss colours.
const PAIRS: [string, string, number][] = [
  ['c-fg', 'c-bg', 4.5], ['c-mute', 'c-bg', 4.5], ['c-fg', 'c-alt', 4.5], ['c-mute', 'c-alt', 4.5],
  ['d-fg', 'd-bg', 4.5], ['d-mute', 'd-bg', 4.5], ['d-lead', 'd-bg', 4.5], ['accent-ink', 'accent', 4.5], ['band-ink', 'band', 3],
  ['c-gain', 'c-bg', 4.5], ['c-gain', 'c-alt', 4.5], ['c-loss', 'c-bg', 4.5], ['c-loss', 'c-alt', 4.5],
  ['d-gain', 'd-bg', 4.5], ['d-loss', 'd-bg', 4.5],
]

describe('every text colour reaches WCAG AA on its surface', () => {
  for (const theme of ['classic', 'light'] as const)
    it.each(PAIRS)(`${theme}: --%s on --%s ≥ %d:1`, (fg, bg, minimum) => {
      const ratio = contrast(app[theme][fg]!, app[theme][bg]!)
      expect(ratio, `${app[theme][fg]} on ${app[theme][bg]}`).toBeGreaterThanOrEqual(minimum)
    })
})

describe('text on the band is large text', () => {
  // The band pair is checked at 3:1, which WCAG allows only from 24px (normal weight; Archivo Black is 400).
  it('the ticker never draws its text below 24px', () => {
    const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8')
    const font = /\.ticker-group\{[^}]*font:\s*400\s+clamp\((\d+)px/.exec(css)
    expect(Number(font?.[1])).toBeGreaterThanOrEqual(24)
  })
})
