#!/usr/bin/env node
/**
 * Render boot: sync schema + seed (idempotent), then start the API.
 * Skips `prisma generate` at runtime — the client is produced during build.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const serverDir = resolve(root, 'apps/server')

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    console.log(`[boot] ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
      shell: true
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(undefined)
      else reject(new Error(`[boot] ${command} exited with code ${code}`))
    })
  })
}

async function main() {
  await run('npx', ['prisma', 'db', 'push', '--skip-generate'], serverDir)
  await run('npx', ['tsx', 'prisma/seed.ts'], serverDir)
  await run('node', ['dist/index.js'], serverDir)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
