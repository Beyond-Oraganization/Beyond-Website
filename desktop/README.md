# Beyond Bot for the desktop

The Beyond Bot app in its own window, with a real database on the computer. It opens the hosted app
(<https://beyond-oraganization.github.io/Beyond-Website/app/>), so it updates whenever the site does. What
the app would keep in the browser's storage goes into one SQLite file instead:

- every backtest you run, not only the last 50;
- every scenario of each Monte Carlo (its balance path and the price paths drawn), which a browser drops;
- the copies of the bot's candles used for backtests;
- the app's settings and remembered connections.

The file is `~/Library/Application Support/Beyond Bot/beyond-bot.sqlite` on a Mac. The browser and the
desktop app keep separate data: runs saved in Chrome stay in Chrome.

## How it works

- `src/main.js` opens a window on the app's address and keeps every other site out of it: links elsewhere open
  in your browser.
- `src/preload.cjs` gives the page `window.beyondBotDesktop`, four operations on the database (get, set,
  delete, list keys), and nothing else: no file paths, no SQL.
- `src/bridge.js` answers them only for pages of the app itself (its origin *and* its folder, since every
  GitHub Pages site of the organisation shares one origin), and only for the app's two stores.
- `src/database.js` is the SQLite file, through Node's own `node:sqlite` (Electron's Node 24), so nothing
  native has to be built. Values are stored as V8's structured-clone bytes, so objects and typed arrays come
  back as they went in.
- The API key's device key is the one thing that stays in the window's own IndexedDB: it is non-extractable
  and never crosses into the file.

## Use it

```bash
npm install
npm start
```

## Build the Mac app

```bash
npm run dist
```

It makes `dist/Beyond Bot-1.0.0-arm64-mac.zip`. The app is not signed, so the first time macOS refuses to open
it: right-click it, choose **Open**, then **Open** again. It does not update itself, but the app inside it updates
with the site. Its first start needs the internet.

## Test it

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` checks the database and which pages may use it. `npm run test:e2e` drives the real Electron app against
the app's local build and the mock bot (run `npm run build` in `../pwa` first): it runs a backtest with a Monte
Carlo, reads the SQLite file, and restarts the app to see the run and the login come back.
