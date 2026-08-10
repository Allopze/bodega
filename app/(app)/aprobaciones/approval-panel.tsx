"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { CheckCircle, MagnifyingGlass } from "@phosphor-icons/react"
import { ListFilters, LIST_FILTER_PARAMS, type FilterOption } from "@/components/adquisiciones/list-filters"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { RequestGroup } from "./request-group"
import { BulkApproveBar } from "./bulk-approve-bar"
import { URGENCY_OPTIONS } from "./types"
import type { ApprovalRequest } from "./types"

export function ApprovalPanel({
  requests,
  canApproveEpp,
  canSetDispatch,
  canAssignWork,
  worksiteOptions = [],
}: {
  requests:        ApprovalRequest[]
  canApproveEpp:   boolean
  canSetDispatch:  boolean
  canAssignWork:   boolean
  worksiteOptions?: FilterOption[]
}) {
  // E-3: la selección vive aquí, no en cada grupo, para poder aprobar ítems de
  // varias solicitudes de una vez. La acción del servidor valida el alcance por
  // ítem, así que cruzar solicitudes es seguro.
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const clearSelection = React.useCallback(() => setSelectedIds([]), [])

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasActiveFilters = LIST_FILTER_PARAMS.some((key) => searchParams.get(key))

  const toggleItem = React.useCallback((id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }, [])

  const toggleMany = React.useCallback((ids: string[], select: boolean) => {
    setSelectedIds((prev) => select
      ? [...new Set([...prev, ...ids])]
      : prev.filter((id) => !new Set(ids).has(id)))
  }, [])

  // Si la lista cambia tras aprobar, se descartan los ids que ya no existen.
  const visibleIds = React.useMemo(
    () => new Set(requests.flatMap((r) => r.pendingItems.map((i) => i.id))),
    [requests],
  )
  React.useEffect(() => {
    setSelectedIds((prev) => {
      const next = prev.filter((id) => visibleIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [visibleIds])

  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_aprobaciones_v1"
        title="Revisión y aprobación"
        body="Aquí aparecen los ítems que esperan tu aprobación. Puedes aprobar o rechazar ítem por ítem, o usar 'Aprobar todos' en una solicitud completa. Los ítems aprobados pasan a Compras automáticamente."
      />
      <ListFilters
        searchPlaceholder="Buscar por código..."
        urgencyOptions={URGENCY_OPTIONS}
        worksiteOptions={worksiteOptions}
      />

      {requests.length === 0 ? (
        // A4: "Bien hecho" sólo es cierto sin filtros. Con la cola acotada
        // (típicamente por `solicitud=` desde /pendientes) la pantalla afirmaba
        // que no quedaba nada por revisar mientras el resto seguía esperando.
        hasActiveFilters ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MagnifyingGlass size={36} weight="light" className="text-text-subtle mb-3" />
            <p className="text-sm font-medium text-(--color-text)">Sin resultados para estos filtros</p>
            <p className="text-sm text-(--color-text-muted) mt-1 max-w-xs">
              Puede haber ítems esperando aprobación fuera de lo que estás filtrando.
            </p>
            <Link
              href={pathname}
              scroll={false}
              className="mt-4 inline-flex h-8 items-center rounded-(--radius) border border-border px-3 text-xs font-medium text-(--color-text) transition-colors hover:bg-surface-2"
            >
              Ver toda la cola
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle size={36} weight="light" className="text-[var(--color-success)] mb-3" />
            <p className="text-sm font-medium text-[var(--color-text)]">Sin ítems pendientes</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-xs">
              Todas las solicitudes enviadas han sido revisadas. Bien hecho.
            </p>
          </div>
        )
      ) : (
        requests.map((req) => (
          <RequestGroup
            key={req.id}
            request={req}
            canApproveEpp={canApproveEpp}
            canSetDispatch={canSetDispatch}
            canAssignWork={canAssignWork}
            selectedIds={selectedIds}
            onToggleItem={toggleItem}
            onToggleMany={toggleMany}
          />
        ))
      )}
      <BulkApproveBar selectedIds={selectedIds} onClear={clearSelection} />
    </div>
  )
}
