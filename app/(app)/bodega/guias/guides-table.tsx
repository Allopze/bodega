"use client"

import Link from "next/link"
import { Truck } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DEFAULT_PAGE_SIZE } from "@/lib/constants"
import { formatDate, formatDateRelative, formatQty } from "@/lib/utils"
import type { DispatchGuideListRow } from "@/lib/services/dispatch-guides"

/** La fila de la tabla es exactamente lo que devuelve el servicio. */
export type DispatchGuideTableRow = DispatchGuideListRow

const COLUMNS = [
  { key: "code", label: "Número", sortable: true, width: "w-36" },
  { key: "issuedAt", label: "Emisión", sortable: true, width: "w-32" },
  { key: "destinationWorksiteName", label: "Faena de destino", sortable: true },
  { key: "status", label: "Estado", sortable: true, width: "w-36" },
  { key: "dispatcherName", label: "Responsable del despacho", sortable: true },
  { key: "itemCount", label: "Ítems", sortable: true, numeric: true, width: "w-24" },
  { key: "actions", label: "", sortable: false, width: "w-24" },
]

/**
 * `DataTable` se conecta solo al buscador del `TopBar`, así que el filtro por
 * número no necesita input propio. El resto de los filtros (estado, faena,
 * fechas) viven en la URL y los aplica el servidor.
 */
/**
 * Lo que lleva esperando una guía despachada: sin la fecha de salida el estado
 * "Despachada" no distingue la de ayer de la de hace cinco semanas.
 */
function WaitingSince({ guide, dispatchedAtById }: { guide: DispatchGuideTableRow; dispatchedAtById: Record<string, string> }) {
  if (guide.status !== "dispatched") return null
  const since = dispatchedAtById[guide.id] ?? guide.issuedAt
  return (
    <span className="mt-0.5 block text-xs text-[var(--color-signal-ink)]">
      Despachada {formatDateRelative(since)}
    </span>
  )
}

export function DispatchGuidesTable({
  guides,
  dispatchedAtById = {},
}: {
  guides: DispatchGuideTableRow[]
  /** Cuándo salió cada guía por confirmar (id → ISO). Sin dato se usa la emisión. */
  dispatchedAtById?: Record<string, string>
}) {
  return (
    <DataTable
      caption="Guías de despacho"
      columns={COLUMNS}
      rows={guides}
      searchKeys={["code", "destinationWorksiteName", "dispatcherName"]}
      pageSize={DEFAULT_PAGE_SIZE}
      disableInternalSearch
      emptyTitle="Sin guías de despacho"
      emptyDescription="No hay guías que coincidan con los filtros aplicados."
      renderMobileCard={(guide) => (
        <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-[var(--color-text-subtle)]">{guide.code}</p>
              <Link
                href={`/bodega/guias/${guide.id}`}
                className="-my-1 flex min-h-11 items-center break-words text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                {guide.destinationWorksiteName}
              </Link>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{guide.dispatcherName}</p>
            </div>
            <div className="shrink-0 text-right">
              <StateBadge state={guide.status} entity="dispatch_guide" size="sm" />
              <WaitingSince guide={guide} dispatchedAtById={dispatchedAtById} />
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-[var(--color-text-subtle)]">Emisión</dt>
              <dd className="text-[var(--color-text-muted)]">{formatDate(guide.issuedAt)}</dd>
            </div>
            <div className="text-right">
              <dt className="text-[var(--color-text-subtle)]">Ítems</dt>
              <dd className="text-[var(--color-text-muted)]">
                {guide.itemCount} · {formatQty(guide.totalQuantity)}
              </dd>
            </div>
          </dl>
        </article>
      )}
      renderRow={(guide) => (
        <TableRow key={guide.id}>
          <TableCell>
            <Link href={`/bodega/guias/${guide.id}`} className="font-mono text-xs text-[var(--color-primary)] hover:underline">
              {guide.code}
            </Link>
          </TableCell>
          <TableCell className="text-xs text-[var(--color-text-subtle)]">{formatDate(guide.issuedAt)}</TableCell>
          <TableCell className="text-sm text-[var(--color-text)]">{guide.destinationWorksiteName}</TableCell>
          <TableCell>
            <StateBadge state={guide.status} entity="dispatch_guide" size="sm" />
            <WaitingSince guide={guide} dispatchedAtById={dispatchedAtById} />
          </TableCell>
          <TableCell className="text-sm text-[var(--color-text-muted)]">{guide.dispatcherName}</TableCell>
          <TableCell className="text-right font-mono text-xs text-[var(--color-text-muted)]">
            <span title={`${guide.itemCount} líneas · ${formatQty(guide.totalQuantity)} en total`}>
              {guide.itemCount}
            </span>
          </TableCell>
          <TableCell>
            <Button variant="secondary" size="sm" asChild className="gap-1">
              <Link href={`/bodega/guias/${guide.id}`} aria-label={`Abrir guía ${guide.code}`}>
                <Truck size={12} aria-hidden />
                Ver
              </Link>
            </Button>
          </TableCell>
        </TableRow>
      )}
    />
  )
}
