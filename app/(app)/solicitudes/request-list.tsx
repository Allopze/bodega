"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, Trash } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { SOLICITUDES_PAGE_SIZE } from "@/lib/constants"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { hasServerListFilters, ServerListFilters, type ServerListFilterOption } from "@/components/ui/server-list-filters"
import { StageTabs, type StageTab } from "@/components/ui/stage-tabs"
import { OnboardingHint } from "@/components/ui/onboarding-hint"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { useActionState, useTransition } from "react"
import { deleteRequestAction } from "./actions"
import { DELETABLE_REQUEST_STATUSES, isOwnerDeletable } from "@/lib/services/requests-delete.constants"
import { INITIAL_STATE } from "@/lib/form-state"
import { REQUEST_TYPE_LABELS, REQUEST_TYPE_VARIANTS } from "@/lib/request-types"
import type { ActionState } from "@/lib/validation/operations"

export type RequestRow = {
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


function detailHref(r: RequestRow): string {
  return `/solicitudes/${r.id}`
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
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
        title="Eliminar solicitud"
        aria-label={`Eliminar solicitud ${code}`}
      >
        <Trash size={16} aria-hidden />
      </Button>
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

export function RequestList({
  requests,
  currentUserId,
  canDeleteAny = false,
  worksiteOptions = [],
  stageTabs = [],
}: {
  requests: RequestRow[]
  currentUserId: string
  canDeleteAny?: boolean
  worksiteOptions?: ServerListFilterOption[]
  stageTabs?: StageTab[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Lista compartida con la barra de filtros: la copia local se quedaba corta
  // cada vez que aparecía un filtro sin control propio.
  const hasActiveFilters = hasServerListFilters(searchParams)

  return (
    <div className="flex flex-col gap-4">
      <OnboardingHint
        storageKey="hint_solicitudes_v1"
        title="Solicitudes de EPPs, Servicios, repuestos u otros"
        body="Crea solicitudes de EPPs, Servicios, repuestos u otros para tus faenas. EPP y otros se envían a aprobación al crearlos; repuestos y servicios pasan antes por un borrador para adjuntar cotizaciones."
      />
      {/* A5: el estado vive en las tabs, así que la barra no repite su select. */}
      {stageTabs.length > 0 && <StageTabs tabs={stageTabs} ariaLabel="Etapa de la solicitud" />}
      <ServerListFilters
        searchPlaceholder="Buscar por código o producto..."
        worksiteOptions={worksiteOptions}
      />
      <DataTable
        caption="Solicitudes"
        enableColumnToggle
        hideDensityToggle
        viewKey="sol"
        stickyFirstColumn
        columns={COLUMNS}
        rows={requests}
        searchKeys={["code", "worksiteName", "requesterName", "status", "requestType"]}
        disableInternalSearch
        pageSize={SOLICITUDES_PAGE_SIZE}
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
        renderMobileCard={(r) => {
          const href = detailHref(r)
          // UX-20: la tarjeta entera es clicable para navegar (igual que la
          // fila desktop, role="link" + onClick en vez de envolver todo en
          // <Link>) — un <Link> envolvente no puede convivir con el botón de
          // eliminar sin caer en el mismo error de interactivo-anidado que ya
          // se corrigió una vez en este repo.
          const canDelete = canDeleteAny
            ? (DELETABLE_REQUEST_STATUSES as readonly string[]).includes(r.status)
            : (r.requesterId === currentUserId && isOwnerDeletable(r.status))
          return (
            <article
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
              className="cursor-pointer rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[var(--color-text-subtle)]">{r.code}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <MetaBadge meta={{ label: `${REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType}`, variant: REQUEST_TYPE_VARIANTS[r.requestType] ?? "default" }} />
                    <PriorityBadge priority={r.urgency} size="sm" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StateBadge state={r.status} entity="request" size="sm" />
                  {canDelete && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <DeleteRequestButton requestId={r.id} code={r.code} />
                    </div>
                  )}
                </div>
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
          )
        }}
        renderRow={(r) => {
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
              /* La fila conserva su rol implícito `row`: con role="link" encima,
                 sus celdas quedaban sin padre `row` (axe aria-required-parents)
                 y la tabla dejaba de anunciarse como tabla. El clic en la fila
                 sigue como comodidad de mouse; el destino accesible por teclado
                 es el enlace del código. La tarjeta móvil es un <article>, no
                 una fila, así que ahí el patrón role="link" sigue siendo válido. */
              onClick={() => router.push(href)}
            >
              <TableCell>
                <Link
                  href={href}
                  aria-label={`Ver solicitud ${r.code}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono text-xs text-(--color-text) hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
                >{r.code}</Link>
              </TableCell>
              <TableCell>
                <MetaBadge meta={{ label: `${REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType}`, variant: REQUEST_TYPE_VARIANTS[r.requestType] ?? "default" }} />
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {r.worksiteName}
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {r.requesterName}
              </TableCell>
              <TableCell>
                {/* A-14: `PriorityBadge` es el render único de urgencia (existía
                    para esto; esta lista era la que faltaba migrar). */}
                <PriorityBadge priority={r.urgency} size="sm" />
              </TableCell>
              {/* A-35: render canónico de columna numérica, alineado con su encabezado. */}
              <TableCellNum className="text-[var(--color-text-muted)]">
                {r.itemCount}
              </TableCellNum>
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
