#!/usr/bin/env node
/**
 * Optional Render boot helper: sync schema + seed, then start the API.
 * Prefer build-time `db:deploy` + `npm run start:api` on free tier so health checks pass quickly.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {string} command
 * @param {string[]} args
 */
function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    console.log(`[boot] ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd: serverDir,
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
  await run('npx', ['prisma', 'db', 'push', '--skip-generate'])
  await run('npx', ['tsx', 'prisma/seed.ts'])
  await run('node', ['dist/index.js'])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
