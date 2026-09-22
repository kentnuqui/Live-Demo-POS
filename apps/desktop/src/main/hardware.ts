import net from 'node:net'

function encode(lines: string[], kickDrawer: boolean): Buffer {
  const parts: Buffer[] = [Buffer.from([0x1b, 0x40]), Buffer.from([0x1b, 0x61, 0x01])]
  for (const line of lines) parts.push(Buffer.from(`${line}\n`, 'utf8'))
  parts.push(Buffer.from([0x1b, 0x64, 0x03]))
  parts.push(Buffer.from([0x1d, 0x56, 0x00]))
  if (kickDrawer) parts.push(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]))
  return Buffer.concat(parts)
}

function parseAddress(address: string): { host: string; port: number } | null {
  const trimmed = address.trim()
  if (!trimmed) return null
  const [host, portText] = trimmed.split(':')
  if (!host) return null
  const port = portText ? Number(portText) : 9100
  if (!Number.isFinite(port)) return null
  return { host, port }
}

/** Sends an ESC/POS ticket to a network printer. USB printers are selected in settings for a later driver. */
export function printLines(address: string, lines: string[], kickDrawer = false): Promise<{ ok: boolean; message: string }> {
  const target = parseAddress(address)
  if (!target) return Promise.resolve({ ok: false, message: 'Add a printer address first' })
  const payload = encode(lines, kickDrawer)
  return new Promise((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port })
    const fail = (message: string) => {
      socket.destroy()
      resolve({ ok: false, message })
    }
    socket.setTimeout(3000)
    socket.once('error', (error) => fail(error.message))
    socket.once('timeout', () => fail('Printer did not answer'))
    socket.once('connect', () => {
      socket.write(payload, (error) => {
        if (error) {
          fail(error.message)
          return
        }
        socket.end()
        resolve({ ok: true, message: 'Sent' })
      })
    })
  })
}

export function kickDrawer(address: string): Promise<{ ok: boolean; message: string }> {
  return printLines(address, [], true)
}
