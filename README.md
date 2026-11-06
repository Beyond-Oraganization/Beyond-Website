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

## The Beyond Bot app

`app/` is **Beyond Bot**, an installable web app (PWA) for the trading bot of `techbot.html`: <https://beyond-oraganization.github.io/Beyond-Website/app/>. It speaks only the bot's HTTPS command API (`beyondbot serve`) and covers every command and every view of the bot's terminal UI: session, trading, markets with charts, backtests, orders, strategies, a console, system health and the bot's account. It uses this site's colours, fonts and both themes, and shares the theme choice with it.

Its source is `pwa/` (React, TypeScript, Vite). `app/` is the build, committed like the site's other generated files; CI rebuilds it and fails if it differs, so **after editing `pwa/`, rebuild and commit `app/`**:

```sh
cd pwa
npm ci                 # once
npm run dev:mock       # the app on http://localhost:5173 with a simulated bot (address http://127.0.0.1:8443, key printed)
npm run build          # writes ../app
npm test               # unit and component tests
npx playwright install chromium && npm run test:e2e   # after a build: flows, axe in both themes, offline start, installability
npm run lighthouse     # after a build: Lighthouse's mobile performance, at least 90
```

`npm run icons` and `npm run screenshots` regenerate the icons, splash screens and install screenshots in `pwa/public/`; `npm run record-fixtures` saves a real bot's answers (redacted) for the parser tests. The site's own tools (`bm check`, the sitemap, the search index, the axe audit) look only at the pages in the root, so the app has its own checks.

**Strategy settings.** The Trading and Backtest forms are built entirely from the bot's catalog (`strategies --json`): each strategy's parameters with their ranges, its default rules, and the syntax of its rules, such as `open|close long|short on cross up|down lower|upper N`. Each word of that syntax becomes one control of a rule (a fixed word, a menu for `a|b`, a field for `N`), rules can be added, reordered and removed, and any rule can be written as text instead. So a new strategy on the bot, or a new kind of condition written the same way, needs no change in the app. The app checks ranges and rule syntax as you type; what depends on several values (a band beyond `moving-count`) is checked by the bot, whose message is shown. **Saved setups** keep a strategy, its parameters and its rules under a name, on the device, for any market. A bot from before rules (no `--json`) still works: its catalog is read from `strategies`, and no rules are sent. The code: `pwa/src/strategy/` (`rules.ts` the grammar, `config.ts` the settings and their checks, `setups.ts`), `pwa/src/components/StrategyForm.tsx` and `RuleEditor.tsx`.

**Connecting a bot.** On the bot's server, allow the app's origin and restart the bot:

```sh
echo 'BEYONDBOT_API_ORIGINS=https://beyond-oraganization.github.io' | sudo tee -a /etc/beyondbot.env
sudo systemctl restart beyondbot
```

Then, on each device: trust the bot's certificate once (the bot's README, "Trusting the certificate"), make sure the firewall lets the device reach port 8443, and enter the bot's address and API key in the app (Connect). The key is kept encrypted under a passphrase by default.

**Trading accounts.** Connecting gives the app the bot's database (markets, candles, strategies, backtests) but no trading account: the bot lets a device act on an account only after it signs in to that account with its password, even one the bot is already trading. **Trading accounts** (the Account screen) signs in to accounts, creates them (cTrader or Bybit, Demo or Live; a Live one asks again, and so does every strategy started on it), switches between them, and signs out (strategies keep trading) or stops them. A device can hold several accounts at once; the header shows the one commands act on. The first login answers with a connection token (`X-BeyondBot-Connection`), which the app keeps for that bot and sends with every command; when the bot says it expired (403, or after a restart of the bot) the app forgets it and asks for a sign-in. Code: `pwa/src/api/client.ts` (the headers), `pwa/src/api/bot.ts` (the token), `pwa/src/screens/Account.tsx`. The mock bot (`npm run dev:mock`) behaves the same: sign in as `demo` / `demo-password`.

**Installing it.** On Android, Windows, macOS, Linux and ChromeOS, Chrome or Edge offer **Install** (the app's own button, or the address bar). On iPhone and iPad: Safari → Share → **Add to Home Screen**; install it *before* connecting, because the installed app keeps its own storage apart from Safari. On a Mac, Safari → File → **Add to Dock**. Firefox on computers cannot install web apps; the app says so and suggests another browser. Once installed it has its own icon and window, starts offline with the last data it saw, and offers each new version with a Reload button.

## The application form

The **Apply** section of `community.html` asks for a name, email, phone and message. The site has no server and uses no outside service, so an application travels as an email from the visitor's own email app (the `mailto:` protocol): **Send by email** opens a new message to beyondia.official@gmail.com with the subject *New member application: <name>* and the details laid out in plain text, and the visitor presses Send. Pressing Reply answers them directly.

- The email is plain text (a `mailto:` link cannot carry formatting), and it arrives only once the visitor sends it.
- If no email app opens (someone who only uses webmail in the browser), the page offers the application to copy and paste into an email.
- Without JavaScript the form is replaced by a link that opens an email to beyondia.official@gmail.com with the four headings to fill in. (Browsers' own handling of a `mailto:` form garbles `+`, `&` and non-Latin letters, so the form always builds the email with the script.)
- To send applications elsewhere, replace beyondia.official@gmail.com everywhere in `community.html` (the form's `action`, which the script reads, and the texts and links around it). The tests check that they all agree.
