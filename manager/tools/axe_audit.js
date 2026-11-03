// Accessibility audit: runs axe-core over every page of the site, in both themes and at desktop and phone width.
// Usage (from the repository root):  node manager/tools/axe_audit.js
// Needs `npm install playwright axe-core` somewhere Node can resolve them, and a Chromium for Playwright.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const root = path.resolve(process.argv[2] || '.');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html')).sort();
  const browser = await chromium.launch();
  let failures = 0;
  for (const theme of ['classic', 'light']) {
    for (const [label, width] of [['desktop', 1280], ['phone', 390]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(t => { try { localStorage.setItem('beyondia-theme', t); } catch (e) {} }, theme);
      for (const name of pages) {
        const page = await context.newPage();
        // 404.html carries a <base> at the real site address; serve its files from here instead.
        await page.route('**/404.html', async r => { const res = await r.fetch(); const body = (await res.text()).replace(/<base href="[^"]*">/, `<base href="${base}">`); await r.fulfill({ response: res, body }); });
        await page.goto(base + name);
        await page.evaluate(() => document.fonts.ready);
        await page.addScriptTag({ content: axeSource });
        const result = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
        for (const v of result.violations) {
          failures++;
          console.log(`[${theme}/${label}] ${name}: ${v.id} (${v.impact}) ${v.help}`);
          for (const n of v.nodes.slice(0, 3)) console.log('    ' + n.target.join(' ') + '  ' + (n.failureSummary || '').split('\n').slice(0, 2).join(' | '));
        }
        await page.close();
      }
      await context.close();
    }
  }
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} accessibility problem(s)` : 'No accessibility problems found.');
  process.exit(failures ? 1 : 0);
})();
