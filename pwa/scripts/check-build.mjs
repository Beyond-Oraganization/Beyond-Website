// Checks the build in ../app before it is committed and published by GitHub Pages:
// - no file or folder name starts with "_" or "." (Pages runs Jekyll, which would drop them);
// - the manifest, the service worker and the page's Content-Security-Policy are there;
// - the manifest names the app's fixed id.
import { readdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../app/', import.meta.url))
const problems = []

async function walk(dir, prefix = '') {
  for (const name of await readdir(dir)) {
    const path = `${dir}/${name}`
    if (/^[_.]/.test(name)) problems.push(`app/${prefix}${name}: starts with "${name[0]}", which GitHub Pages (Jekyll) would not publish`)
    if ((await stat(path)).isDirectory()) await walk(path, `${prefix}${name}/`)
  }
}

await walk(root.replace(/\/$/, ''))
const index = await readFile(`${root}index.html`, 'utf8')
if (!/<meta http-equiv="Content-Security-Policy"/.test(index)) problems.push('app/index.html: no Content-Security-Policy')
if (!/<link rel="manifest"/.test(index)) problems.push('app/index.html: no manifest link')
for (const file of ['manifest.webmanifest', 'sw.js', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png', 'apple-touch-icon-180x180.png']) {
  try {
    await stat(`${root}${file}`)
  } catch {
    problems.push(`app/${file} is missing`)
  }
}
const manifest = JSON.parse(await readFile(`${root}manifest.webmanifest`, 'utf8'))
if (!manifest.id?.startsWith('/')) problems.push(`manifest id "${manifest.id}" is not path-absolute: browsers would resolve it against the origin`)

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'))
  process.exit(1)
}
console.log(`✓ app/ is ready for GitHub Pages (manifest id ${manifest.id})`)
