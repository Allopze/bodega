export type E2eEnvironment = Readonly<Record<string, string | undefined>>

/**
 * La suite E2E reconstruye por completo su base. Por eso la URL debe ser una
 * declaración específica del runner, nunca un fallback de DATABASE_URL.
 */
export function resolveE2eDatabaseUrl(env: E2eEnvironment = process.env) {
  return env.E2E_DATABASE_URL?.trim() || undefined
}
