"use client"

import * as React from "react"
import Link from "next/link"
import { CaretDown, CaretRight, CheckCircle, Warning } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { PENDING_PURCHASE_PAGE_SIZE } from "@/lib/constants"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { StateBadge, MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { formatDate } from "@/lib/utils"
import type { PendingPurchaseItem, PendingPurchaseItemStage, PendingPurchaseRequest } from "@/lib/services/purchasing"

/**
 * La cola de Compras: solicitudes aprobadas que todavía necesitan OC.
 *
 * Antes esto era un contador ("8 ítems aprobados sin incluir en ninguna OC") y
 * nada más: los registros vivían escondidos como casillas dentro del formulario
 * de creación, así que la pregunta "¿qué solicitud estoy dejando esperando?" no
 * tenía respuesta en pantalla. El contador se conserva como resumen —arriba, en
 * una sola línea— y debajo van las solicitudes, cada una con su acción.
 */

const COLUMNS = [
  { key: "_expand",          label: "",           sortable: false, width: "w-10" },
  { key: "code",             label: "Solicitud",  sortable: true,  width: "w-36" },
  { key: "date",             label: "Fecha",      sortable: true,  width: "w-28" },
  { key: "requesterName",    label: "Solicita",   sortable: true  },
  { key: "worksiteName",     label: "Faena",      sortable: true  },
  { key: "urgency",          label: "Urgencia",   sortable: true,  width: "w-24" },
  { key: "pendingItemCount", label: "Ítems por comprar", sortable: true, numeric: true, width: "w-32" },
  { key: "supplier",         label: "Proveedor sugerido", sortable: false },
  { key: "status",           label: "Estado",     sortable: true,  width: "w-32" },
  { key: "_actions",         label: "",           sortable: false, width: "w-40" },
]

/**
 * El vocabulario del desglose. Un ítem de una solicitud que espera OC puede
 * estar en cinco situaciones y Compras sólo actúa sobre la primera; las otras
 * cuatro están para que una aprobación parcial no se lea como si toda la
 * solicitud estuviese esperando compra.
 */
/** Label + variante en un solo mapa (MetaBadge): el color lo decide la etapa. */
const STAGE_META: Record<PendingPurchaseItemStage, StateMetaInput> = {
  pending_order:     { label: "Aprobado · sin OC",   variant: "signal"  },
  in_order:          { label: "En OC",               variant: "info"    },
  rejected:          { label: "Rechazado",           variant: "danger"  },
  awaiting_approval: { label: "En aprobación",       variant: "default" },
  done:              { label: "Recepción / entrega", variant: "success" },
}

/** El orden del desglose: primero lo accionable, al final lo ya resuelto. */
const STAGE_ORDER: PendingPurchaseItemStage[] = ["pending_order", "in_order", "awaiting_approval", "done", "rejected"]

function newOrderHref(request: PendingPurchaseRequest) {
  return `/compras/nueva?faena=${encodeURIComponent(request.worksiteId)}&solicitud=${encodeURIComponent(request.id)}`
}

function ItemBreakdown({ items }: { items: PendingPurchaseItem[] }) {
  const sorted = [...items].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
  )
  return (
    <ul className="flex flex-col gap-1.5">
      {sorted.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <MetaBadge meta={STAGE_META[item.stage]} />
          <span className="font-medium text-(--color-text)">{item.productName}</span>
          <span className="font-mono tabular-nums text-(--color-text-muted)">
            {item.quantity} {item.unitOfMeasure}
          </span>
          {item.productSku && (
            <span className="font-mono text-(--color-text-subtle)">{item.productSku}</span>
          )}
          {item.orderCode && item.orderId && (
            <Link
              href={`/compras/${item.orderId}`}
              className="font-mono text-(--color-primary) underline underline-offset-2"
            >{item.orderCode}</Link>
          )}
          {item.stage === "pending_order" && item.supplierName && (
            <span className="text-(--color-text-subtle)">sugerido: {item.supplierName}</span>
          )}
          {/* A5: la situación del ítem se representa una sola vez. El badge de
              etapa dice estrictamente más que su estado crudo ("Aprobado · sin
              OC" vs "Aprobado"), así que el StateBadge sobraba al lado. El
              estado crudo sigue en la ficha de la solicitud. */}
        </li>
      ))}
    </ul>
  )
}

export function PendingPurchaseList({
  requests,
  pendingItemCount,
  requestCount,
  canCreate,
  createdCount = 0,
  noPendingItems = false,
  hasActiveFilters = false,
}: {
  /** La página visible de la cola. */
  requests: PendingPurchaseRequest[]
  /** Ítems aprobados sin OC en todo el alcance visible — el resumen. */
  pendingItemCount: number
  /** Solicitudes distintas que los contienen — el total del paginador. */
  requestCount: number
  canCreate: boolean
  createdCount?: number
  /** "Nueva OC" rebotó aquí porque no queda ningún ítem aprobado sin OC (UX-7). */
  noPendingItems?: boolean
  hasActiveFilters?: boolean
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())

  const toggle = React.useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <section aria-labelledby="cola-compras" className="flex flex-col gap-3">
      {/* Sin botón "Nueva OC" acá: la acción de página vive en `PageHeader.actions`
          (regla de layout 5 / A3) y la de fila es "Generar OC", que es la que
          corresponde a una cola —se compra una solicitud concreta, no "una OC"
          en abstracto. */}
      <h2 id="cola-compras" className="text-h2">Pendientes de orden de compra</h2>

      {createdCount > 1 && (
        <div className="flex items-center gap-3 rounded-(--radius) border border-(--color-success-line) bg-(--color-success-tint) px-4 py-3">
          <CheckCircle size={16} className="shrink-0 text-(--color-success-ink)" aria-hidden />
          <p className="flex-1 text-sm text-(--color-success-ink)">
            Se crearon <span className="font-semibold">{createdCount} órdenes de compra</span>, separadas por proveedor.
          </p>
        </div>
      )}

      {/* UX-7: "Nueva OC" con la cola vacía rebotaba a /compras en silencio y el
          botón parecía no haber hecho nada. */}
      {noPendingItems && (
        <div role="status" className="flex items-center gap-3 rounded-(--radius) border border-signal-line bg-signal-tint px-4 py-3">
          <Warning size={16} className="shrink-0 text-signal-ink" aria-hidden />
          <p className="flex-1 text-sm text-signal-ink">
            No hay ítems aprobados pendientes de compra por ahora.
          </p>
        </div>
      )}

      {/* El resumen: el mismo predicado que la tabla, así que no pueden diferir. */}
      <p className="text-sm text-(--color-text-muted)" aria-live="polite">
        {pendingItemCount > 0 ? (
          <>
            <span className="font-semibold text-(--color-text)">
              {pendingItemCount} ítem{pendingItemCount !== 1 ? "s" : ""} aprobado{pendingItemCount !== 1 ? "s" : ""}
            </span>
            {" "}sin incluir en ninguna OC, en{" "}
            <span className="font-semibold text-(--color-text)">
              {requestCount === 1 ? "1 solicitud" : `${requestCount} solicitudes`}
            </span>
            {requestCount > requests.length ? ` (${requests.length} en esta página).` : "."}
          </>
        ) : noPendingItems || !hasActiveFilters ? (
          "No hay ítems aprobados esperando orden de compra."
        ) : (
          "Ningún ítem aprobado sin OC coincide con los filtros aplicados."
        )}
      </p>

      <DataTable
        caption="Solicitudes aprobadas pendientes de orden de compra"
        columns={COLUMNS}
        rows={requests}
        searchKeys={["code", "worksiteName", "requesterName"]}
        disableInternalSearch
        hideDensityToggle
        pageSize={PENDING_PURCHASE_PAGE_SIZE}
        emptyTitle="Sin solicitudes por comprar"
        emptyDescription={hasActiveFilters
          ? "Ninguna solicitud aprobada sin OC coincide con los filtros aplicados."
          : "Todo lo aprobado ya está en una orden de compra."}
        emptyAction={hasActiveFilters ? (
          <Button type="button" size="sm" variant="secondary" asChild>
            <Link href="/compras">Limpiar filtros</Link>
          </Button>
        ) : undefined}
        renderRow={(request) => {
          const open = expanded.has(request.id)
          return (
            <>
              <TableRow key={request.id}>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-expanded={open}
                    // Sólo cuando el panel existe: `aria-controls` apuntando a
                    // un id ausente es un fallo de axe (aria-valid-attr-value).
                    aria-controls={open ? `items-${request.id}` : undefined}
                    aria-label={open ? `Ocultar ítems de ${request.code}` : `Ver ítems de ${request.code}`}
                    onClick={() => toggle(request.id)}
                  >
                    {open
                      ? <CaretDown size={14} weight="bold" aria-hidden />
                      : <CaretRight size={14} weight="bold" aria-hidden />}
                  </Button>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/solicitudes/${request.id}`}
                    aria-label={`Ver solicitud ${request.code}`}
                    className="font-mono text-xs text-(--color-text) hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
                  >{request.code}</Link>
                </TableCell>
                <TableCell className="text-xs text-(--color-text-subtle)">{formatDate(request.date)}</TableCell>
                <TableCell className="text-sm text-(--color-text-muted)">{request.requesterName}</TableCell>
                <TableCell className="text-sm text-(--color-text-muted)">{request.worksiteName}</TableCell>
                <TableCell><PriorityBadge priority={request.urgency} size="sm" /></TableCell>
                <TableCellNum className="text-(--color-text)">{request.pendingItemCount}</TableCellNum>
                <TableCell className="text-sm text-(--color-text-muted)">
                  {request.supplierNames.length > 0 ? request.supplierNames.join(", ") : "—"}
                </TableCell>
                <TableCell><StateBadge state={request.status} entity="request" size="sm" /></TableCell>
                <TableCell className="text-right">
                  {canCreate ? (
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={newOrderHref(request)}>Generar OC</Link>
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/solicitudes/${request.id}`}>Revisar</Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
              {open && (
                <TableRow key={`${request.id}-items`}>
                  <TableCell colSpan={COLUMNS.length} className="bg-(--color-surface-2) py-3">
                    <div id={`items-${request.id}`}>
                      <ItemBreakdown items={request.items} />
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          )
        }}
        renderMobileCard={(request) => {
          const open = expanded.has(request.id)
          return (
            <article className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/solicitudes/${request.id}`} className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-(--color-text)">{request.code}</p>
                  <p className="mt-0.5 break-words text-xs text-(--color-text-muted)">{request.requesterName}</p>
                </Link>
                <StateBadge state={request.status} entity="request" size="sm" />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-(--color-text-subtle)">Faena</dt>
                <dd className="min-w-0 break-words text-right text-(--color-text)">{request.worksiteName}</dd>
                <dt className="text-(--color-text-subtle)">Ítems por comprar</dt>
                <dd className="text-right font-mono tabular-nums text-(--color-text)">{request.pendingItemCount}</dd>
                <dt className="text-(--color-text-subtle)">Proveedor sugerido</dt>
                <dd className="min-w-0 break-words text-right text-(--color-text)">
                  {request.supplierNames.length > 0 ? request.supplierNames.join(", ") : "—"}
                </dd>
                <dt className="text-(--color-text-subtle)">Fecha</dt>
                <dd className="text-right font-mono tabular-nums text-(--color-text)">{formatDate(request.date)}</dd>
              </dl>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                aria-expanded={open}
                aria-controls={open ? `items-m-${request.id}` : undefined}
                onClick={() => toggle(request.id)}
              >
                {open ? "Ocultar ítems" : `Ver ${request.items.length} ítem${request.items.length !== 1 ? "s" : ""}`}
              </Button>
              {open && (
                <div id={`items-m-${request.id}`} className="mt-2">
                  <ItemBreakdown items={request.items} />
                </div>
              )}
              {canCreate && (
                <Button variant="primary" size="sm" asChild className="mt-3 w-full">
                  <Link href={newOrderHref(request)}>Generar OC</Link>
                </Button>
              )}
            </article>
          )
        }}
      />
    </section>
  )
}
