"use client"

import { useSession } from "next-auth/react"
import { useEffect, useRef } from "react"

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of retry attempts after a transient session fetch failure. */
const MAX_RETRIES = 3

/**
 * Base delay (ms) for exponential backoff. Each retry doubles this:
 *   1st retry → 1 000 ms
 *   2nd retry → 2 000 ms
 *   3rd retry → 4 000 ms
 */
const BASE_DELAY_MS = 1_000

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Monitors the client-side session state and automatically retries the session
 * fetch with exponential backoff when a transient failure is detected.
 *
 * ## Why this exists
 *
 * `next-auth`'s `SessionProvider` internally calls `fetchData("session")` on
 * mount and on every `visibilitychange` (tab focus). If that fetch fails — e.g.
 * because Turbopack is recompiling during hot reload, or a database query in the
 * JWT callback times out — the provider sets the session to `null` and marks the
 * status as `"unauthenticated"`. This causes the app to display a logged-out UI
 * even though the user is fully authenticated server-side.
 *
 * ## How it works
 *
 * 1. Renders as a child of the `SessionProvider` so it has access to `useSession()`.
 * 2. Tracks whether a valid session was ever seen (via a ref).
 * 3. If the session drops from valid → null, it's a fetch error → calls `update()`
 *    which issues a fresh `GET /api/auth/session` request.
 * 4. Retries up to `MAX_RETRIES` times with exponential backoff (`BASE_DELAY_MS * 2^n`).
 * 5. Resets the retry counter on a successful session load.
 *
 * The `update()` method is preferred over the internal `_getSession` because it
 * preserves the current session state on failure (only sets the new session on
 * success), while `_getSession` overwrites the session with `null` unconditionally.
 *
 * This component renders nothing.
 */
export function SessionRetryHandler() {
  const { data: session, update } = useSession()
  const retryCountRef = useRef(0)
  const hadSessionRef = useRef(false)

  // Track whether we ever had a valid session (set synchronously during render).
  if (session) {
    hadSessionRef.current = true
  }

  useEffect(() => {
    // Detect session fetch failure:
    //   - No session data (null)
    //   - But we HAD a valid session before → transient error, not real unauthenticated
    //   - Haven't exhausted retries
    if (!session && hadSessionRef.current && retryCountRef.current < MAX_RETRIES) {
      const attemptNumber = retryCountRef.current + 1
      const delay = BASE_DELAY_MS * Math.pow(2, retryCountRef.current)

      retryCountRef.current++

      if (process.env.NODE_ENV === "development") {
        console.debug(
          `[session-retry] Fetch de sesión falló, reintentando ${attemptNumber}/${MAX_RETRIES} en ${delay}ms…`,
        )
      }

      const timer = setTimeout(() => {
        update()
      }, delay)

      return () => clearTimeout(timer)
    }

    // Reset retry counter when session is successfully restored
    if (session && retryCountRef.current > 0) {
      if (process.env.NODE_ENV === "development") {
        console.debug("[session-retry] Sesión recuperada exitosamente")
      }
      retryCountRef.current = 0
    }
  }, [session, update])

  return null
}
