"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { buildCrossFilterHref, crossFilterActive, type CrossFilterAction } from "@/lib/services/mantencion/looker/filters"

/**
 * Un clic de filtro cruzado navega con `router.replace(..., { scroll: false })`, igual que los
 * demás filtros de URL del repo: no llena el historial y no devuelve la página al inicio.
 * `pending` deja marcar `aria-busy` mientras el servidor recalcula.
 */
export function useCrossFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const current = React.useMemo(
    () => new URLSearchParams(Array.from(searchParams.entries())),
    [searchParams],
  )

  const isActive = React.useCallback(
    (values: Record<string, string>) => crossFilterActive(current, values),
    [current],
  )

  const toggle = React.useCallback((action: CrossFilterAction) => {
    const href = buildCrossFilterHref(pathname, current, {
      ...action,
      active: crossFilterActive(current, action.values),
    })
    startTransition(() => router.replace(href, { scroll: false }))
  }, [current, pathname, router])

  return { toggle, isActive, pending }
}
