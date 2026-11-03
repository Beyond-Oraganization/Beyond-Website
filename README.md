# Beyond Website

The website of Beyondia, a country of ideas.

Plain static HTML, CSS, one small script and a few images: no framework and nothing to install to *view* it. Open `index.html` in a browser (it works straight from disk), or publish the folder with any static host (GitHub Pages, Cloudflare Pages, Netlify). Home, stories, blog, plans and GitHub pages are generated from `site.config.json` by the manager in `manager/` (see its README); the other pages are written by hand.

## Pages

- `index.html` — home and the map of the site
- `stories.html` and the `story*.html` pages — stories
- `blog.html` and the `blog-*.html` pages — blog
- `conclusions.html` — conclusions of the treatise
- `ideology.html`, `principles.html`, `treatise.html`, `rules.html` — ideology (the treatise also comes as `treatise.pdf`)
- `plans.html` — plans
- `technologies.html`, `techsales.html`, `techbot.html` — technologies
- `community.html` — community, with the application form (see below)
- `creator.html` — the creator
- `search.html` — search over every page; `404.html` — the page for a wrong address

## Themes

Two colour themes, switched with the sun button in the header and remembered in the browser:

| | Classic (default) | Light |
|---|---|---|
| Sections | yellow `#FCBF49`, navy text `#003049` | cream `#FCF5ED`, ink text `#1F1717` |
| Bands (hero, footer) | navy `#003049` | peach `#F4BF96` |
| Accent / ticker | red `#D62828`, orange `#F77F00` | rose `#CE5A67` (a darker rose `#A8394A` behind small labels, to keep text readable) |

All colours are tokens at the top of `beyondia.css` (`:root` for classic, `:root[data-theme="light"]` for light). Every text colour pair meets WCAG AA in both themes; `bm check` and the tests verify it.

## Files

- `beyondia.css` — all styles, both themes, mobile menu and print styles; the fonts are declared here and live in `fonts/` (self-hosted, no request goes to a third party)
- `beyondia.js` — theme toggle, mobile menu, reading-progress fallback, search and the application form's checks; every page works without it
- `search-index.js` — the search index, generated from the text of all pages
- `logo.svg` (icon), `og-image.png` (link preview), `portrait.jpg` / `portrait.webp`
- `forms/application.gs` — the mail sender behind the application form (a Google Apps Script web app)
- `sitemap.xml`, `feed.xml` (Atom feed of the blog), `robots.txt` — generated; they need `site.url` in `site.config.json`

## Working on it

```sh
manager/bm build          # regenerate pages, shared header/footer, search index, sitemap and feed
manager/bm check          # links, metadata, images, fonts, colour contrast
sh manager/run_tests.sh   # the tests
node manager/tools/axe_audit.js .   # accessibility audit (needs `npm i playwright axe-core`)
node manager/tools/make_pdf.js treatise.html treatise.pdf   # refresh the treatise PDF after editing it
```

**After editing `beyondia.css` or `beyondia.js`, run `manager/bm build`.** Every page links them as `beyondia.css?v=<hash>`, so visitors never get a new page with an old cached stylesheet; the build updates that hash (CI fails if you forget).

**Set the real address.** `site.url` in `site.config.json` (it ends with a slash) is what canonical links, the sharing image, the sitemap and the feed use. It is currently set to the likely GitHub Pages address, `https://beyond-oraganization.github.io/Beyond-Website/`; change it if the site lives elsewhere, then run `manager/bm build`. Leave it empty and those four things are simply left out.

## The application form

The **Apply** section of `community.html` sends each application (name, email, phone, message) to your inbox as a styled email. GitHub Pages cannot send mail, so a small Google Apps Script web app, `forms/application.gs`, does it from your Google account: free, no API keys, nothing stored. **It needs connecting once** (about three minutes): follow [forms/README.md](forms/README.md), then put the web app address in the form's `action` in `community.html`. Until then the form tells visitors it is not connected yet.
