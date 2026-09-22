import { spawn } from 'node:child_process'

delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn('electron-vite', ['dev'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
