import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { LocalDatabase } from '../src/database.js'

/** The desktop app's database, on a throwaway file. */
let folder = ''
let file = ''

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'beyond-bot-db-'))
  file = join(folder, 'beyond-bot.sqlite')
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe('the desktop app’s database', () => {
  it('keeps objects and typed arrays across a restart', () => {
    const first = new LocalDatabase(file)
    first.set('candles', 'conn|XAUUSD 1h|0', { close: Float64Array.of(2000.5, 2001.25), count: 2 })
    first.close()

    const again = new LocalDatabase(file)
    const value = again.get('candles', 'conn|XAUUSD 1h|0')
    again.close()

    assert.ok(value.close instanceof Float64Array)
    assert.deepEqual([Array.from(value.close), value.count], [[2000.5, 2001.25], 2])
  })

  it('has nothing under a key never set', () => {
    const database = new LocalDatabase(file)
    assert.equal(database.get('app', 'nothing'), null)
    database.close()
  })

  it('replaces a value set twice', () => {
    const database = new LocalDatabase(file)
    database.set('app', 'k', 1)
    database.set('app', 'k', 2)
    assert.equal(database.get('app', 'k'), 2)
    database.close()
  })

  it('lists the keys of one store by prefix, with no wildcards in the prefix', () => {
    const database = new LocalDatabase(file)
    for (const key of ['runs:a_1:1', 'runs:a_1:2', 'runs:ax1:1']) database.set('app', key, 1)
    database.set('candles', 'runs:a_1:3', 1)

    assert.deepEqual(database.keys('app', 'runs:a_1:').sort(), ['runs:a_1:1', 'runs:a_1:2'])
    assert.equal(database.keys('app').length, 3)
    database.close()
  })

  it('forgets a deleted key', () => {
    const database = new LocalDatabase(file)
    database.set('app', 'k', 1)
    database.delete('app', 'k')
    assert.deepEqual([database.get('app', 'k'), database.keys('app')], [null, []])
    database.close()
  })
})
