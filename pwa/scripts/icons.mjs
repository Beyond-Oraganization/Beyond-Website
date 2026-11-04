// Generates every icon the app installs with, from assets/*.svg into public/, and writes their <link> tags
// into index.html. Run it after changing an icon: `npm run icons`. The outputs are committed, so a build needs
// no image tools.
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { instructions } from '@vite-pwa/assets-generator/api/instructions'
import { generateAssets } from '@vite-pwa/assets-generator/api/generate-assets'
import { generateHtmlMarkup } from '@vite-pwa/assets-generator/api/generate-html-markup'
import { combinePresetAndAppleSplashScreens, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const NAVY = '#003049'
const here = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url))

// iPhones from the 11 on, current iPads. Devices that share a resolution share one image.
const DEVICES = [
  'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone Air', 'iPhone 17', 'iPhone 16 Pro Max', 'iPhone 16 Pro',
  'iPhone 16 Plus', 'iPhone 16', 'iPhone 16e', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
  'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14', 'iPhone 13 Pro Max', 'iPhone 13 Pro',
  'iPhone 13', 'iPhone 13 mini', 'iPhone 12 Pro Max', 'iPhone 12', 'iPhone 12 mini', 'iPhone 11 Pro Max',
  'iPhone 11 Pro', 'iPhone 11', 'iPhone XR', 'iPhone SE 4.7"',
  'iPad Pro 12.9"', 'iPad Pro 11"', 'iPad Air 13"', 'iPad Air 11"', 'iPad Air 10.9"', 'iPad 11"', 'iPad 10.2"',
  'iPad mini 8.3"',
]

const onNavy = { background: NAVY, fit: 'contain' }
const preset = combinePresetAndAppleSplashScreens(
  {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.2, resizeOptions: onNavy },
    apple: { ...minimal2023Preset.apple, padding: 0.12, resizeOptions: onNavy },
  },
  { padding: 0.45, resizeOptions: onNavy, linkMediaOptions: { log: false, addMediaScreen: true, basePath: './', xhtml: false } },
  DEVICES,
)

await mkdir(here('public/shortcuts'), { recursive: true })
await copyFile(here('assets/app-icon.svg'), here('public/app-icon.svg'))

const plan = await instructions({
  imageResolver: () => readFile(here('assets/app-icon.svg')),
  imageName: here('public/app-icon.svg'),
  preset,
  faviconPreset: '2023',
  htmlLinks: { xhtml: false, includeId: false },
  basePath: './',
  resolveSvgName: () => 'app-icon.svg',
})
await generateAssets(plan, true, here('public'), (message) => console.log(message))

for (const name of await readdir(here('assets'))) {
  const match = /^shortcut-(\w+)\.svg$/.exec(name)
  if (match) await sharp(here(`assets/${name}`)).resize(96, 96).png({ compressionLevel: 9 }).toFile(here(`public/shortcuts/${match[1]}-96.png`))
}

// The generator's markup names splash screens "…-light-…" while it writes them without "light": point every
// link at a file that exists, and stop if one is still missing.
const { existsSync } = await import('node:fs')
const markup = generateHtmlMarkup(plan).map((link) =>
  link.replace(/href="\.\/([^"]+)"/, (all, file) => (existsSync(here(`public/${file}`)) ? all : `href="./${file.replace('-light-', '-')}"`)),
)
for (const link of markup) {
  const file = /href="\.\/([^"]+)"/.exec(link)?.[1]
  if (file && !existsSync(here(`public/${file}`))) throw new Error(`index.html would link a missing file: ${file}`)
}
const links = markup.map((link) => `    ${link}`).join('\n')
const index = await readFile(here('index.html'), 'utf8')
const updated = index.replace(
  /(<!-- icons:start[^>]*-->)[\s\S]*?(\s*<!-- icons:end -->)/,
  `$1\n${links}$2`,
)
await writeFile(here('index.html'), updated)
console.log(`Wrote ${markup.length} <link> tags into index.html`)
