"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, Trash } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { StateBadge, REQUEST_STATE_META } from "@/components/states/state-badge"
import { ListFilters, type FilterOption } from "@/components/adquisiciones/list-filters"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { TableRow, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { urgencyLabel } from "@/lib/urgency-labels"
import { useActionState, useTransition } from "react"
import { deleteRequestAction } from "./actions"
import { DELETABLE_REQUEST_STATUSES, isOwnerDeletable } from "@/lib/services/requests-delete.constants"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { REQUEST_TYPE_LABELS, REQUEST_TYPE_VARIANTS } from "@/lib/request-types"
import type { ActionState } from "@/lib/validation/operations"

export interface RequestRow {
  id:            string
  code:          string
  requestType:   string
  worksiteName:  string
  urgency:       string
  status:        string
  itemCount:     number
  submittedAt:   string | null
  createdAt:     string
  requesterId:   string
  requesterName: string
}

const COLUMNS = [
  { key: "code",          label: "Código",     sortable: true,  width: "w-36" },
  { key: "requestType",   label: "Tipo",       sortable: true,  width: "w-28" },
  { key: "worksiteName",  label: "Faena",      sortable: true  },
  { key: "requesterName", label: "Solicita",   sortable: true  },
  { key: "urgency",       label: "Urgencia",   sortable: true,  width: "w-28" },
  { key: "itemCount",     label: "Ítems",      sortable: true,  numeric: true, width: "w-20" },
  { key: "status",        label: "Estado",     sortable: true,  width: "w-36" },
  { key: "createdAt",     label: "Fecha",      sortable: true,  width: "w-32" },
  { key: "_actions",      label: "",           sortable: false, width: "w-10" },
]

const URGENCY_DOT: Record<string, string> = {
  normal:   "text-[var(--color-text-subtle)]",
  high:     "text-[var(--color-warning)]",
  critical: "text-[var(--color-danger)]",
}


/** Tipos con detalle en su propio vertical (no en /solicitudes/[id]) */
const DETAIL_BASE: Record<string, string> = {
  repuestos: "/repuestos",
  servicios: "/servicios",
}

function detailHref(r: RequestRow): string {
  return `${DETAIL_BASE[r.requestType] ?? "/solicitudes"}/${r.id}`
}

function DeleteRequestButton({ requestId, code }: { requestId: string; code: string }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteRequestAction, INITIAL_STATE)
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    if (!state.message) return
    if (state.ok) toast.success(state.message)
    else toast.error(state.message)
  }, [state])

  function handleConfirm() {
    const fd = new FormData()
    fd.set("requestId", requestId)
    startTransition(() => action(fd))
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="rounded p-1 text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] disabled:opacity-50"
        title="Eliminar solicitud"
        aria-label={`Eliminar solicitud ${code}`}
      >
        <Trash size={16} />
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Eliminar solicitud?"
        description={`La solicitud ${code} será eliminada permanentemente junto con todos sus ítems y archivos adjuntos. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="destructive"
        loading={pending}
        onConfirm={handleConfirm}
      />
    </>
  )
}

const STATUS_OPTIONS: FilterOption[] = Object.entries(REQUEST_STATE_META).map(
  ([value, meta]) => ({ value, label: meta.label }),
)

export function RequestList({
  requests,
  currentUserId,
  canDeleteAny = false,
  worksiteOptions = [],
}: {
  requests: RequestRow[]
  currentUserId: string
  canDeleteAny?: boolean
  worksiteOptions?: FilterOption[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const currentQ = searchParams.get("q")
  const currentEstado = searchParams.get("estado")
  const currentFaena = searchParams.get("faena")
  const currentUrgencia = searchParams.get("urgencia")
  const hasActiveFilters = Boolean(currentQ || currentEstado || currentFaena || currentUrgencia)

  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_solicitudes_v1"
        title="Solicitudes de EPPs, Servicios, repuestos u otros"
        body="Crea solicitudes de EPPs, Servicios, repuestos u otros para tus faenas. Agrega los ítems, guarda el borrador y envíala a revisión. Puedes seguir el estado de cada solicitud desde aquí."
      />
      <ListFilters
        searchPlaceholder="Buscar por código o producto..."
        statusOptions={STATUS_OPTIONS}
        worksiteOptions={worksiteOptions}
      />
      <DataTable
        enableColumnToggle
        hideDensityToggle
        viewKey="sol"
        stickyFirstColumn
        columns={COLUMNS}
        rows={requests as unknown as Record<string, unknown>[]}
        searchKeys={["code", "worksiteName", "requesterName", "status", "requestType"]}
        disableInternalSearch
        pageSize={25}
        emptyTitle="Sin solicitudes"
        emptyDescription={hasActiveFilters ? "No hay solicitudes que coincidan con los filtros aplicados." : "No hay solicitudes registradas aún."}
        emptyAction={
          hasActiveFilters ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => router.replace("/solicitudes", { scroll: false })}
            >
              Limpiar filtros
            </Button>
          ) : (
            <Button size="sm" variant="primary" asChild>
              <Link href="/solicitudes/nueva">
                <Plus weight="bold" size={16} />
                Nueva solicitud
              </Link>
            </Button>
          )
        }
        renderMobileCard={(row) => {
          const r = row as unknown as RequestRow
          return (
            <Link href={detailHref(r)} className="block">
              <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--color-text-subtle)]">{r.code}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant={REQUEST_TYPE_VARIANTS[r.requestType] ?? "default"} size="sm">
                        {REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType}
                      </Badge>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${URGENCY_DOT[r.urgency] ?? ""}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {urgencyLabel(r.urgency)}
                      </span>
                    </div>
                  </div>
                  <StateBadge state={r.status} entity="request" size="sm" />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Faena</dt>
                    <dd className="text-[var(--color-text-muted)] truncate">{r.worksiteName}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Solicita</dt>
                    <dd className="text-[var(--color-text-muted)] truncate">{r.requesterName}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-text-subtle)]">Ítems</dt>
                    <dd className="font-mono tabular-nums text-[var(--color-text)]">{r.itemCount}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[var(--color-text-subtle)]">Fecha</dt>
                    <dd className="text-[var(--color-text-muted)]">{formatDate(r.submittedAt ?? r.createdAt)}</dd>
                  </div>
                </dl>
              </article>
            </Link>
          )
        }}
        renderRow={(row) => {
          const r = row as unknown as RequestRow
          const href = detailHref(r)
          // B-1: con permiso privilegiado se pueden eliminar todos los estados borrables;
          // el dueño sin permiso, solo los que no están en el pipeline de aprobación.
          const canDelete = canDeleteAny
            ? (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(r.status)
            : (r.requesterId === currentUserId && isOwnerDeletable(r.status))
          return (
            <TableRow
              key={r.id}
              className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
              role="link"
              tabIndex={0}
              aria-label={`Ver solicitud ${r.code}`}
              onClick={() => router.push(href)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  router.push(href)
                }
              }}
            >
              <TableCell>
                <span className="font-mono text-xs text-[var(--color-text)]">{r.code}</span>
              </TableCell>
              <TableCell>
                <Badge variant={REQUEST_TYPE_VARIANTS[r.requestType] ?? "default"} size="sm">
                  {REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {r.worksiteName}
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {r.requesterName}
              </TableCell>
              <TableCell>
                <span className={`text-xs font-medium ${URGENCY_DOT[r.urgency] ?? ""}`}>
                  {urgencyLabel(r.urgency)}
                </span>
              </TableCell>
              <TableCell className="tabular-nums text-sm text-[var(--color-text-muted)] text-right pr-6">
                {r.itemCount}
              </TableCell>
              <TableCell>
                <StateBadge state={r.status} entity="request" size="sm" />
              </TableCell>
              <TableCell className="text-xs text-[var(--color-text-subtle)]">
                {formatDate(r.submittedAt ?? r.createdAt)}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                {canDelete && (
                  <DeleteRequestButton requestId={r.id} code={r.code} />
                )}
              </TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
