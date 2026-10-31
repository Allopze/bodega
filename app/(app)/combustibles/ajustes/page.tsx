import { redirect } from "next/navigation"
import { requireAnyPermission } from "@/lib/auth/can"
import { firstAllowedAjustesHref } from "@/lib/combustibles/section-nav"

/** Entrada de «Ajustes» en el menú: abre la primera sección que el permiso deja configurar. */
export default async function AjustesPage() {
  let session
  try {
    session = await requireAnyPermission([
      "combustibles:manage_control",
      "combustibles:manage_anomaly_rules",
      "combustibles:tae_manage_config",
      "combustibles:manage_integrations",
    ])
  } catch { redirect("/forbidden") }
  redirect(firstAllowedAjustesHref(session) ?? "/forbidden")
}
