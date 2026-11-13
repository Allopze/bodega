import { redirect } from "next/navigation"
import { can, requireAnyPermission } from "@/lib/auth/can"

export const dynamic = "force-dynamic"

/**
 * Entrada de «Configuración» en el menú de Mantención: abre la primera pantalla
 * de configuración que el permiso de la persona deja abrir (Pautas, Marcas y
 * talleres o Dispositivos). Redirigir no es autorización: cada destino vuelve a
 * exigir el suyo.
 */
export default async function MantencionConfiguracionPage() {
  let session
  try {
    session = await requireAnyPermission(["mant:schedules:manage", "mant:equipment:manage", "mant:devices:manage"])
  } catch { redirect("/forbidden") }
  if (can(session, "mant:schedules:manage")) redirect("/mantencion/pautas")
  if (can(session, "mant:equipment:manage")) redirect("/mantencion/catalogos")
  redirect("/mantencion/dispositivos")
}
