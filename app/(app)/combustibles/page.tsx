import type { Metadata } from "next"
import { Suspense } from "react"
import { permanentRedirect, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { legacyPanelRedirect } from "@/lib/combustibles/legacy-redirects"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { PanelContent } from "./panel-content"
import { PanelLoading } from "./panel-loading"

export const metadata: Metadata = { title: "Panel de combustible" }

type SearchParams = Record<string, string | string[] | undefined>

/**
 * Permiso y redirección de las vistas viejas antes de cualquier Suspense: así
 * el redirect responde un 308 real. Los datos llegan después, con su esqueleto.
 */
export default async function PanelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", FUEL_PATHS.panel) } catch { redirect("/forbidden") }
  const sp = await searchParams
  // Los enlaces viejos a las vistas de consumo por tarjeta llegan a esta URL.
  const legacy = legacyPanelRedirect(sp)
  if (legacy) permanentRedirect(legacy)

  return (
    <Suspense fallback={<PanelLoading />}>
      <PanelContent session={session} searchParams={sp} />
    </Suspense>
  )
}
