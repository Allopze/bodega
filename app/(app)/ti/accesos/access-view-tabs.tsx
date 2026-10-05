"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { ACCESS_VIEWS, type AccessView } from "./access-views"

/**
 * Pestañas por URL (`?vista=`). Cambiar de pestaña es estado de la vista, no
 * navegación: `router.replace` con `scroll: false` (patrón de preservación de
 * scroll de la plataforma). Se descartan los parámetros propios de cada
 * pestaña —filtros de la matriz, revisión de inactivos— para que no viajen a
 * una pestaña donde no significan nada.
 */
export function AccessViewTabs({ view }: { view: AccessView }) {
  const router = useRouter()
  const pathname = usePathname()

  const select = React.useCallback((next: AccessView) => {
    if (next === view) return
    const params = new URLSearchParams()
    if (next !== "accesos") params.set("vista", next)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router, view])

  return (
    <SegmentedControl
      ariaLabel="Secciones de accesos"
      variant="segmented"
      items={ACCESS_VIEWS.map((item) => ({
        key: item.value,
        label: item.label,
        active: item.value === view,
        onClick: () => select(item.value),
      }))}
    />
  )
}
