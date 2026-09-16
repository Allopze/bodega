/**
 * Centralized environment-variable validation.
 *
 * Call `validateEnv()` once at startup (instrumentation.ts).
 * Throws with a descriptive message if any required variable is absent,
 * so the server fails immediately instead of deep inside a request.
 *
 * Parsed typed values are exported for use across the app instead of
 * scattering `process.env.*` reads throughout the codebase.
 */

const REQUIRED = ["AUTH_SECRET", "DATABASE_URL"] as const

export function validateEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `[env] Variables requeridas no configuradas: ${missing.join(", ")}.\n` +
        "Consulta .env.example para instrucciones de configuración.",
    )
  }
}

export const env = {
  authSecret:       process.env.AUTH_SECRET!,
  databaseUrl:      process.env.DATABASE_URL!,
  nodeEnv:          (process.env.NODE_ENV ?? "development") as "development" | "production" | "test",

  // Optional — gracefully degrade if absent
  appUrl:           process.env.APP_URL?.trim() || null,
  resendApiKey:     process.env.RESEND_API_KEY?.trim() || null,
  storagePath:      process.env.STORAGE_PATH?.trim() || null,

  // Numeric with defaults
  taxRate:          Number(process.env.TAX_RATE ?? 0.19),
  pdfMaxConcurrent: Number(process.env.PDF_MAX_CONCURRENT ?? 2),
} as const
