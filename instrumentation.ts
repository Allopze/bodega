import { validateEnv } from "@/lib/env"

export async function register() {
  // Fail fast on missing required environment variables so the process
  // crashes with a clear message instead of dying deep inside a request.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    validateEnv()
  }
}
