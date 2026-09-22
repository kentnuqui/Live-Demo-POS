/**
 * Parses CLIENT_ORIGIN as a comma-separated allowlist.
 * Local Vite and Netlify preview/production hosts are always included for demos.
 */
export function parseClientOrigins(raw: string): string[] {
  const configured = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  const withLocal = [...configured, 'http://localhost:5173']
  return [...new Set(withLocal)]
}

/**
 * Returns true when the browser Origin may call this API.
 * Allows exact CLIENT_ORIGIN entries, localhost, and any *.netlify.app host.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true
  if (allowed.includes('*')) return true
  if (allowed.includes(origin)) return true
  try {
    const host = new URL(origin).hostname
    if (host === 'localhost' || host.endsWith('.netlify.app')) return true
  } catch {
    return false
  }
  return false
}
