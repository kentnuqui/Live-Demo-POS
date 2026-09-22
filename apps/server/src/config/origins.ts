/**
 * Parses CLIENT_ORIGIN as a comma-separated allowlist.
 * Local Vite is always included so local terminals can hit a remote demo API.
 */
export function parseClientOrigins(raw: string): string[] {
  const configured = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  const withLocal = [...configured, 'http://localhost:5173']
  return [...new Set(withLocal)]
}
