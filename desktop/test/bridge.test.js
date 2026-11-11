import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isTheApp, storeHandlers } from '../src/bridge.js'

const APP = 'https://beyond-oraganization.github.io/Beyond-Website/app/'

/** A database that remembers in memory, standing in for the SQLite one. */
function memory() {
  const values = new Map()
  return {
    get: (store, key) => values.get(`${store}/${key}`) ?? null,
    set: (store, key, value) => void values.set(`${store}/${key}`, value),
    delete: (store, key) => void values.delete(`${store}/${key}`),
    keys: (store, prefix) => [...values.keys()].filter((k) => k.startsWith(`${store}/${prefix}`)).map((k) => k.slice(store.length + 1)),
  }
}

describe('which pages are the app', () => {
  it('is the app’s own pages, at any route', () => {
    assert.ok(isTheApp(APP, APP))
    assert.ok(isTheApp(`${APP}#/backtest`, APP))
    assert.ok(isTheApp(`${APP}index.html?x=1`, APP))
  })

  it('is not another site, nor another site of the same GitHub Pages origin, nor a folder that only starts alike', () => {
    for (const page of ['https://example.com/Beyond-Website/app/', 'https://beyond-oraganization.github.io/other/', 'https://beyond-oraganization.github.io/Beyond-Website/app-copy/', 'http://beyond-oraganization.github.io/Beyond-Website/app/', 'file:///Beyond-Website/app/', 'not a url', ''])
      assert.equal(isTheApp(page, APP), false, page)
  })
})

describe('the database bridge', () => {
  it('answers the app’s pages', () => {
    const handlers = storeHandlers(memory(), APP)
    handlers['store:set'](`${APP}#/backtest`, 'app', 'runs:c:1', { at: 1 })

    assert.deepEqual(handlers['store:get'](APP, 'app', 'runs:c:1'), { at: 1 })
    assert.deepEqual(handlers['store:keys'](APP, 'app', 'runs:c:'), ['runs:c:1'])
  })

  it('refuses a page from anywhere else', () => {
    const handlers = storeHandlers(memory(), APP)

    for (const channel of Object.keys(handlers))
      assert.throws(() => handlers[channel]('https://evil.example/', 'app', 'k', 1), /Only the Beyond Bot app/, channel)
  })

  it('offers only the app’s two stores, and text keys', () => {
    const handlers = storeHandlers(memory(), APP)

    assert.throws(() => handlers['store:get'](APP, 'sqlite_master', 'k'), /no store "sqlite_master"/)
    assert.throws(() => handlers['store:get'](APP, 'app', { key: 1 }), /must be text/)
    assert.deepEqual(Object.keys(handlers).sort(), ['store:delete', 'store:get', 'store:keys', 'store:set'])
  })
})
