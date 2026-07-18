import { validateEnv } from "@/lib/env"
import * as Sentry from "@sentry/nextjs"

export async function register() {
  // Fail fast on missing required environment variables so the process
  // crashes with a clear message instead of dying deep inside a request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    validateEnv()
    await import("./sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

export const onRequestError = Sentry.captureRequestError
