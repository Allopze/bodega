import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { withFuelContext } from "@/lib/combustibles/routes"
import { firstAllowedCuadraturaHref } from "@/lib/combustibles/section-nav"

/** Entrada de «Cuadratura» en el menú: abre la primera vista que el permiso deja ver, con el período y la faena. */
export default async function CuadraturaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }
  redirect(withFuelContext(firstAllowedCuadraturaHref(session), await searchParams))
}
