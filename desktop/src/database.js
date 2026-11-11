import { DatabaseSync } from 'node:sqlite'
import { deserialize, serialize } from 'node:v8'

/** The stores the app keeps (its `StoreName`): its own data, and the candle copies. */
export const STORES = Object.freeze(['app', 'candles'])

/**
 * The app's database on this computer: one SQLite file, one table of (store, key) → value. Values are stored as V8's
 * structured-clone bytes, so whatever the page hands over (objects, arrays, typed arrays) comes back as it was.
 * It uses Node's own SQLite (`node:sqlite`, in Electron's Node 24), so nothing native has to be built.
 */
export class LocalDatabase {
  #db
  #get
  #set
  #delete
  #keys

  constructor(file) {
    this.#db = new DatabaseSync(file)
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS entries (
        store TEXT NOT NULL,
        key TEXT NOT NULL,
        value BLOB NOT NULL,
        PRIMARY KEY (store, key)
      ) WITHOUT ROWID;`)
    this.#get = this.#db.prepare('SELECT value FROM entries WHERE store = ? AND key = ?')
    this.#set = this.#db.prepare('INSERT INTO entries (store, key, value) VALUES (?, ?, ?) ON CONFLICT (store, key) DO UPDATE SET value = excluded.value')
    this.#delete = this.#db.prepare('DELETE FROM entries WHERE store = ? AND key = ?')
    // substr, not LIKE: a key's own % and _ are not wildcards.
    this.#keys = this.#db.prepare('SELECT key FROM entries WHERE store = ? AND substr(key, 1, length(?)) = ?')
  }

  /** The value under the key, or null when there is none. */
  get(store, key) {
    const row = this.#get.get(store, key)
    return row ? deserialize(row.value) : null
  }

  set(store, key, value) {
    this.#set.run(store, key, serialize(value))
  }

  delete(store, key) {
    this.#delete.run(store, key)
  }

  /** The keys of the store that start with `prefix`. */
  keys(store, prefix = '') {
    return this.#keys.all(store, prefix, prefix).map((row) => row.key)
  }

  close() {
    this.#db.close()
  }
}
