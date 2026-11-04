// Development against the mock bot: starts it on http://127.0.0.1:8443 (an hourly candle every minute, so ticks
// and trades happen while you watch) and the Vite dev server on http://localhost:5173.
import { spawn } from 'node:child_process'
import { DEFAULT_KEY, startServer } from '../mock-bot/server.mjs'

const mock = await startServer({ port: 8443, control: true, log: true, botOptions: { speed: 60, addDelayMs: 3500 } })
console.log(`\nMock bot: http://127.0.0.1:${mock.port}  API key: ${DEFAULT_KEY}\nIn the app: Connect → address http://127.0.0.1:${mock.port}, that key.\n`)
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })
const stop = () => {
  vite.kill()
  void mock.close().then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
