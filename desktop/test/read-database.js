// Prints the rows of a desktop database as JSON, typed arrays as {typedArray, values}. It runs inside Electron's own
// Node (ELECTRON_RUN_AS_NODE): the values are V8's serialisation, which an older Node's V8 cannot read.
import { DatabaseSync } from 'node:sqlite'
import { deserialize } from 'node:v8'

const database = new DatabaseSync(process.argv[2], { readOnly: true })
const rows = database.prepare('SELECT store, key, value FROM entries').all().map((row) => ({ store: row.store, key: row.key, value: deserialize(row.value) }))
database.close()
process.stdout.write(JSON.stringify(rows, (_, value) => (ArrayBuffer.isView(value) ? { typedArray: value.constructor.name, values: Array.from(value) } : value)))
