import { STORES } from './database.js'

/**
 * Whether a page is the app: the same origin as `appUrl` and inside its folder. The folder matters: every GitHub
 * Pages site of the organisation shares the origin `beyond-oraganization.github.io`.
 */
export function isTheApp(pageUrl, appUrl) {
  try {
    const page = new URL(pageUrl)
    const app = new URL(appUrl)
    const folder = app.pathname.endsWith('/') ? app.pathname : `${app.pathname}/`
    return page.origin === app.origin && (page.pathname === app.pathname || page.pathname.startsWith(folder))
  } catch {
    return false
  }
}

/**
 * What the page may ask of the database, by IPC channel: the four operations of the app's `LocalStore` port and
 * nothing else (no file paths, no SQL). Each answers only a page that {@link isTheApp}, about one of {@link STORES}.
 */
export function storeHandlers(database, appUrl) {
  const guarded = (operation) => (pageUrl, store, key, value) => {
    if (!isTheApp(pageUrl, appUrl)) throw new Error('Only the Beyond Bot app may use its database.')
    if (!STORES.includes(store)) throw new Error(`The database has no store "${store}".`)
    if (typeof key !== 'string') throw new Error('A key must be text.')
    return operation(store, key, value)
  }
  return {
    'store:get': guarded((store, key) => database.get(store, key)),
    'store:set': guarded((store, key, value) => database.set(store, key, value)),
    'store:delete': guarded((store, key) => database.delete(store, key)),
    'store:keys': guarded((store, prefix) => database.keys(store, prefix)),
  }
}
