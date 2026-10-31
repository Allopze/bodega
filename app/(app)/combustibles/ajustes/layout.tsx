import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { requireAnyPermission } from "@/lib/auth/can"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { ajustesNavItems } from "@/lib/combustibles/section-nav"
import { AjustesNav } from "./settings-nav"

/**
 * Marco de «Ajustes»: el submenú de secciones a la izquierda y la sección
 * elegida a la derecha. Sólo pinta lo que el permiso de la persona deja
 * configurar; la puerta de cada sección sigue en su propia página.
 */
export default async function AjustesLayout({ children }: { children: ReactNode }) {
  let session
  try {
    session = await requireAnyPermission([
      "combustibles:manage_control",
      "combustibles:manage_anomaly_rules",
      "combustibles:tae_manage_config",
      "combustibles:manage_integrations",
    ], FUEL_PATHS.ajustes)
  } catch { redirect("/forbidden") }

  const items = ajustesNavItems(session)
  // Con una sola sección el submenú no decide nada y sólo robaría ancho.
  if (items.length <= 1) return <>{children}</>

  return (
    <div className="md:flex md:items-start">
      <div className="px-4 pt-2 md:sticky md:top-4 md:w-72 md:shrink-0 md:self-start md:pl-8 md:pr-0 md:pt-3">
        <AjustesNav items={items} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
