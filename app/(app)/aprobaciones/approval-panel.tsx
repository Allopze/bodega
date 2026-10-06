"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { CheckCircle, MagnifyingGlass } from "@phosphor-icons/react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { hasServerListFilters, ServerListFilters, type ServerListFilterOption } from "@/components/ui/server-list-filters"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { RequestGroup } from "./request-group"
import { BulkApproveBar } from "./bulk-approve-bar"
import { URGENCY_OPTIONS } from "./types"
import { QuotationPendingSection } from "./quotation-pending-section"
import type { ApprovalRequest, QuotationPendingRequest } from "./types"

export function ApprovalPanel({
  requests,
  canApproveEpp,
  canSetDispatch,
  worksiteOptions = [],
  quotationRequests = [],
  quotationTotal = 0,
}: {
  requests:        ApprovalRequest[]
  canApproveEpp:   boolean
  canSetDispatch:  boolean
  worksiteOptions?: ServerListFilterOption[]
  /** ADQ-05 · repuestos/servicios que esperan que se elija una cotización. */
  quotationRequests?: QuotationPendingRequest[]
  quotationTotal?: number
}) {
  // E-3: la selección vive aquí, no en cada grupo, para poder aprobar ítems de
  // varias solicitudes de una vez. La acción del servidor valida el alcance por
  // ítem, así que cruzar solicitudes es seguro.
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const clearSelection = React.useCallback(() => setSelectedIds([]), [])

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasActiveFilters = hasServerListFilters(searchParams)

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

  const hasQuotationWork = quotationRequests.length > 0

  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_aprobaciones_v1"
        title="Revisión y aprobación"
        body="Aquí aparecen los ítems que esperan tu aprobación. Puedes aprobar o rechazar ítem por ítem, o usar 'Aprobar todos' en una solicitud completa. Los ítems aprobados pasan a Compras automáticamente."
      />
      <ServerListFilters
        searchPlaceholder="Buscar por código..."
        urgencyOptions={URGENCY_OPTIONS}
        worksiteOptions={worksiteOptions}
      />

      {requests.length === 0 ? (
        // A4: "Todo al día" sólo es cierto si no queda NADA por decidir: ni
        // ítems en la cola ni solicitudes esperando una cotización. Con filtros
        // activos la cola está acotada y el mensaje es otro (típicamente
        // `solicitud=` desde /pendientes).
        hasActiveFilters ? (
          <EmptyState
            icon={<MagnifyingGlass size={24} weight="light" />}
            title="Sin resultados para estos filtros"
            description="Puede haber ítems esperando aprobación fuera de lo que estás filtrando."
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href={pathname} scroll={false}>Ver toda la cola</Link>
              </Button>
            }
          />
        ) : hasQuotationWork ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No hay ítems esperando aprobación directa. Quedan solicitudes por elegir cotización:
          </p>
        ) : (
          <EmptyState
            tone="success"
            icon={<CheckCircle size={24} weight="light" />}
            title="Sin ítems pendientes"
            description="Todo lo enviado ya fue revisado. Cuando llegue una solicitud nueva aparecerá aquí."
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href="/solicitudes">Ver solicitudes</Link>
              </Button>
            }
          />
        )
      ) : (
        requests.map((req) => (
          <RequestGroup
            key={req.id}
            request={req}
            canApproveEpp={canApproveEpp}
            canSetDispatch={canSetDispatch}
            selectedIds={selectedIds}
            onToggleItem={toggleItem}
            onToggleMany={toggleMany}
          />
        ))
      )}
      <QuotationPendingSection requests={quotationRequests} total={quotationTotal} />
      <BulkApproveBar selectedIds={selectedIds} onClear={clearSelection} />
    </div>
  )
}
