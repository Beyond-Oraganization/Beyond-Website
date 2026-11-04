// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_ID, manifest } from '../../build/manifest.ts'

const publicFile = (name: string) => new URL(`../../public/${name.replace(/^\.\//, '')}`, import.meta.url)
const size = async (name: string) => {
  const meta = await sharp(publicFile(name).pathname).metadata()
  return `${meta.width}x${meta.height}`
}
const m = manifest()
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('the manifest installs the app', () => {
  it('has the fields Chrome needs, and a path-absolute id', () => {
    expect(m.id).toBe(DEFAULT_APP_ID)
    expect(m.id?.startsWith('/')).toBe(true)
    expect(m.name && m.short_name && m.description).toBeTruthy()
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('./#/')
    expect(m.scope).toBe('./')
    const sizes = (m.icons ?? []).filter((i) => i.purpose === 'any').map((i) => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect((m.icons ?? []).some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('every icon and shortcut icon exists at its declared size', async () => {
    const icons = [...(m.icons ?? []), ...(m.shortcuts ?? []).flatMap((s) => s.icons ?? [])].filter((i) => i.type === 'image/png')
    for (const icon of icons) {
      expect(existsSync(publicFile(icon.src)), icon.src).toBe(true)
      expect(await size(icon.src), icon.src).toBe(icon.sizes)
    }
  })

  it('screenshots follow Chrome’s rules for the richer install dialog', async () => {
    const shots = m.screenshots ?? []
    for (const form of ['narrow', 'wide'] as const) expect(shots.some((s) => s.form_factor === form), form).toBe(true)
    const ratios = new Map<string, number>()
    for (const shot of shots) {
      expect(existsSync(publicFile(shot.src)), shot.src).toBe(true)
      const actual = await size(shot.src)
      expect(actual, shot.src).toBe(shot.sizes)
      const [w, h] = actual.split('x').map(Number) as [number, number]
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(320)
      expect(Math.max(w, h)).toBeLessThanOrEqual(3840)
      expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(2.3)
      const ratio = Math.round((w / h) * 1000)
      const seen = ratios.get(shot.form_factor ?? '')
      if (seen) expect(ratio, `${shot.src} aspect`).toBe(seen)
      ratios.set(shot.form_factor ?? '', ratio)
    }
  })

  it('keeps the maskable glyph inside the 80% safe circle', async () => {
    const { data, info } = await sharp(publicFile('maskable-icon-512x512.png').pathname).raw().toBuffer({ resolveWithObject: true })
    const [r0, g0, b0] = [data[0]!, data[1]!, data[2]!]
    const radius = info.width * 0.4
    let outside = 0
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels
        const differs = Math.abs(data[i]! - r0) + Math.abs(data[i + 1]! - g0) + Math.abs(data[i + 2]! - b0) > 30
        if (differs && Math.hypot(x - info.width / 2, y - info.height / 2) > radius) outside++
      }
    expect(outside).toBe(0)
  })

  it('gives iOS an opaque square touch icon', async () => {
    const { data, info } = await sharp(publicFile('apple-touch-icon-180x180.png').pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(`${info.width}x${info.height}`).toBe('180x180')
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) throw new Error('the Apple touch icon has transparent pixels')
  })

  it('links a splash screen that exists, at the size its media query names, for each iPhone and iPad', async () => {
    const links = [...html.matchAll(/<link rel="apple-touch-startup-image" media="([^"]+)" href="([^"]+)">/g)]
    expect(links.length).toBeGreaterThan(20)
    for (const [, media, href] of links) {
      const w = Number(/device-width: (\d+)px/.exec(media!)?.[1])
      const h = Number(/device-height: (\d+)px/.exec(media!)?.[1])
      const dpr = Number(/device-pixel-ratio: (\d+)/.exec(media!)?.[1])
      const landscape = /orientation: landscape/.test(media!)
      expect(existsSync(publicFile(href!)), href).toBe(true)
      expect(await size(href!), href).toBe(landscape ? `${h * dpr}x${w * dpr}` : `${w * dpr}x${h * dpr}`)
    }
  })

  it('names the iOS title, status bar and touch icon in the page', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Beyond Bot">')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">')
    expect(html).toContain('<link rel="apple-touch-icon" href="./apple-touch-icon-180x180.png">')
    expect(html).toContain('viewport-fit=cover')
  })
})
