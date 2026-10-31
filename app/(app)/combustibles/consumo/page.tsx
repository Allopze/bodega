import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { withFuelContext } from "@/lib/combustibles/routes"
import { FIRST_PERFORMANCE_HREF } from "@/lib/combustibles/section-nav"

/** Entrada de «Consumo» en el menú: abre Rendimiento (la primera pestaña), con el período y la faena. */
export default async function ConsumoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  try { await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  redirect(withFuelContext(FIRST_PERFORMANCE_HREF, await searchParams))
}
