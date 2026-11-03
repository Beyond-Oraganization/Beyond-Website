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
- `community.html` — community
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
- `beyondia.js` — theme toggle, mobile menu, reading-progress fallback and search; every page works without it
- `search-index.js` — the search index, generated from the text of all pages
- `logo.svg` (icon), `og-image.png` (link preview), `portrait.jpg` / `portrait.webp`
- `sitemap.xml`, `feed.xml` (Atom feed of the blog), `robots.txt` — generated; they need `site.url` in `site.config.json`

## Working on it

```sh
manager/bm build          # regenerate pages, shared header/footer, search index, sitemap and feed
manager/bm check          # links, metadata, images, fonts, colour contrast
sh manager/run_tests.sh   # the tests
node manager/tools/axe_audit.js .   # accessibility audit (needs `npm i playwright axe-core`)
node manager/tools/make_pdf.js treatise.html treatise.pdf   # refresh the treatise PDF after editing it
```

**Set the real address.** `site.url` in `site.config.json` (it ends with a slash) is what canonical links, the sharing image, the sitemap and the feed use. It is currently set to the likely GitHub Pages address, `https://beyond-oraganization.github.io/Beyond-Website/`; change it if the site lives elsewhere, then run `manager/bm build`. Leave it empty and those four things are simply left out.
