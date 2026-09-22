import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(here, '../../../../.env'), quiet: true })

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  PIN_PEPPER: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Comma-separated browser origins allowed to call the API (Netlify + local). */
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.string().default('development')
})

/**
 * Reads process environment once. Secrets stay out of source;
 * the process refuses to boot when a required value is missing.
 */
export const env = schema.parse(process.env)
