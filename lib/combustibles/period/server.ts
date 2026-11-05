import "server-only"
import type { Session } from "next-auth"
import { cookies } from "next/headers"
import { FUEL_PERIOD_COOKIE } from "./cookie"
import { defaultFuelPeriodFor } from "./defaults"
import { resolveFuelPeriod } from "./parse"
import type { ResolvedFuelPeriod } from "./types"

/**
 * Valor de la cookie decodificado. Una cookie editada a mano o vieja puede no ser
 * URI válida (`%E0%A4%A` lanza `URIError`): en ese caso se devuelve `null` y la
 * página cae al valor por rol en vez de romperse entera (hallazgo 6.6 de la
 * auditoría 2026-11-05).
 */
export function decodeFuelPeriodCookieValue(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

/** Resuelve el período de una página de Combustible: URL, cookie o valor por rol. */
export async function resolveFuelPeriodForPage(
  session: Session | null,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ResolvedFuelPeriod> {
  const store = await cookies()
  const raw = store.get(FUEL_PERIOD_COOKIE)?.value
  return resolveFuelPeriod({
    searchParams,
    cookieValue: decodeFuelPeriodCookieValue(raw),
    fallback: defaultFuelPeriodFor(session),
  })
}
