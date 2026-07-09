"use client"

import { CheckCircle } from "@phosphor-icons/react"
import { ListFilters, type FilterOption } from "@/components/adquisiciones/list-filters"
import { OnboardingHint } from "@/components/adquisiciones/onboarding-hint"
import { RequestGroup } from "./request-group"
import { URGENCY_OPTIONS } from "./types"
import type { ApprovalRequest } from "./types"

export function ApprovalPanel({
  requests,
  canApproveEpp,
  canSetDispatch,
  worksiteOptions = [],
}: {
  requests:        ApprovalRequest[]
  canApproveEpp:   boolean
  canSetDispatch:  boolean
  worksiteOptions?: FilterOption[]
}) {
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
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle size={36} weight="light" className="text-[var(--color-success)] mb-3" />
          <p className="text-sm font-medium text-[var(--color-text)]">Sin ítems pendientes</p>
          <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-xs">
            Todas las solicitudes enviadas han sido revisadas. Bien hecho.
          </p>
        </div>
      ) : (
        requests.map((req) => (
          <RequestGroup key={req.id} request={req} canApproveEpp={canApproveEpp} canSetDispatch={canSetDispatch} />
        ))
      )}
    </div>
  )
}
