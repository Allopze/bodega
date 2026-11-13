import { redirect } from "next/navigation"
import { can, requireAnyPermission } from "@/lib/auth/can"

/**
 * Entrada de «Configuración» en el menú de Combustible: abre «Fuentes de datos»
 * a quien puede cargar o sincronizar datos y «Ajustes» al resto. Redirigir no es
 * autorización: cada destino vuelve a exigir el suyo.
 */
export default async function CombustiblesConfiguracionPage() {
  let session
  try {
    session = await requireAnyPermission([
      "combustibles:import",
      "combustibles:tae_import",
      "combustibles:sync_integrations",
      "combustibles:manage_control",
      "combustibles:manage_anomaly_rules",
      "combustibles:tae_manage_config",
      "combustibles:manage_integrations",
    ])
  } catch { redirect("/forbidden") }
  const puedeVerFuentes = can(session, "combustibles:import")
    || can(session, "combustibles:tae_import")
    || can(session, "combustibles:sync_integrations")
  redirect(puedeVerFuentes ? "/combustibles/fuentes" : "/combustibles/ajustes")
}
