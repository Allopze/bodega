import { redirect } from "next/navigation"
import { can } from "@/lib/auth/can"
import { auth } from "@/lib/auth/auth"

export const dynamic = "force-dynamic"

/**
 * Entrada del módulo: lleva al Panel a quien puede verlo y a Registros al resto
 * (el mecánico, que sólo ve lo propio). Redirigir no es autorización: cada
 * destino vuelve a pedir su permiso.
 */
export default async function MantencionIndexPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (can(session, "mant:records:view_worksite") || can(session, "mant:records:view_all")) redirect("/mantencion/panel")
  if (can(session, "mant:records:view_own")) redirect("/mantencion/registros")
  redirect("/forbidden")
}
