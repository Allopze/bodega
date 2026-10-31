import "server-only"
import type { Session } from "next-auth"
import { cookies } from "next/headers"
import { FUEL_PERIOD_COOKIE } from "./cookie"
import { defaultFuelPeriodFor } from "./defaults"
import { resolveFuelPeriod } from "./parse"
import type { ResolvedFuelPeriod } from "./types"

/** Resuelve el período de una página de Combustible: URL, cookie o valor por rol. */
export async function resolveFuelPeriodForPage(
  session: Session | null,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ResolvedFuelPeriod> {
  const store = await cookies()
  const raw = store.get(FUEL_PERIOD_COOKIE)?.value
  return resolveFuelPeriod({
    searchParams,
    cookieValue: raw ? decodeURIComponent(raw) : null,
    fallback: defaultFuelPeriodFor(session),
  })
}
