// Writes a PDF of one page of the site using its print stylesheet.
// Usage (from the repository root):  node manager/tools/make_pdf.js treatise.html treatise.pdf
// Needs Playwright with a Chromium. The site's own print rules (beyondia.css, @media print) decide the layout.
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const [page_, out] = [process.argv[2], process.argv[3]];
  if (!page_ || !out) { console.error('usage: node make_pdf.js page.html out.pdf'); process.exit(2); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(page_));
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: out, format: 'A4', printBackground: false, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font:8px sans-serif;width:100%;text-align:center;color:#555">Beyondia &middot; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } });
  await browser.close();
})();
