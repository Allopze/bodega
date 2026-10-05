"use client"

import * as React from "react"
import Link from "next/link"
import { DotsThree } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  IT_ACCEPTANCE_META, IT_ASSIGNMENT_KIND_META, IT_LOAN_OVERDUE_META, IT_PHYSICAL_STATE_META,
} from "@/lib/services/ti/constants"
import { AcceptanceSheet } from "./acceptance-sheet"
import { ReturnSheet } from "./return-sheet"
import { TransferSheet } from "./transfer-sheet"
import type { DeliveryReference } from "./assignment-reference"

interface Row {
  id: string
  code: string
  assetId: string
  assetCode: string
  assetBrand: string | null
  assetModel: string | null
  workerId: string
  workerName: string
  worksiteId: string
  worksiteName: string
  kind: string
  deliveredAt: string
  physicalState: string
  /** TIUX-14: fecha civil `YYYY-MM-DD` de un préstamo. */
  expectedReturnDate: string | null
  loanOverdue: boolean
  returnedAt: string | null
  returnPhysicalState: string | null
  /** TIA-002: 'pendiente' | 'aceptada' | 'sin_acuse'. */
  acceptanceStatus: string
  deliveredByName: string | null
}

/** Lo que la devolución necesita de la entrega original (solo custodias abiertas). */
export type DeliveryReferenceMap = Record<string, {
  accessories: { id: string; name: string; returnedAt: string | null }[]
  reference: DeliveryReference
}>

type ActiveSheet = { kind: "acuse" | "devolver" | "transferir"; row: Row } | null

const COLUMNS = [
  { key: "code", label: "Acta", width: "w-28" },
  { key: "asset", label: "Activo", sortable: true, sortValue: (row: Row) => row.assetCode },
  { key: "worker", label: "Trabajador", sortable: true, sortValue: (row: Row) => row.workerName },
  { key: "worksite", label: "Faena", sortable: true, sortValue: (row: Row) => row.worksiteName },
  { key: "deliveredAt", label: "Entrega", sortable: true, width: "w-36" },
  { key: "status", label: "Custodia", sortable: true, width: "w-36", sortValue: (row: Row) => (row.returnedAt ? 1 : 0) },
  { key: "acceptance", label: "Acuse", sortable: true, width: "w-32", sortValue: (row: Row) => row.acceptanceStatus },
  { key: "actions", label: "", width: "w-44" },
]

/** Tipo y estado físico al entregar: dato de apoyo del activo, no una columna que ensanche la tabla (TIUX-22). */
function secondaryLine(row: Row) {
  return [IT_ASSIGNMENT_KIND_META[row.kind] ?? row.kind, `Estado ${(IT_PHYSICAL_STATE_META[row.physicalState]?.label ?? row.physicalState).toLowerCase()}`].join(" · ")
}

function CustodyBadges({ row }: { row: Row }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.returnedAt
        ? <MetaBadge meta={{ label: "Devuelto", variant: "default" }} />
        : <MetaBadge meta={{ label: "Vigente", variant: "info" }} dot />}
      {row.loanOverdue && <MetaBadge meta={IT_LOAN_OVERDUE_META} />}
    </div>
  )
}

function AcceptanceBadge({ row }: { row: Row }) {
  return <MetaBadge meta={IT_ACCEPTANCE_META[row.acceptanceStatus] ?? { label: row.acceptanceStatus, variant: "warning" }} />
}

export function AssignmentsTable({ rows, canManage, workers, worksites, references = {}, hasFilters = false }: {
  rows: Row[]
  canManage: boolean
  workers: { id: string; name: string; lastName: string; worksiteId?: string }[]
  worksites: { id: string; name: string }[]
  references?: DeliveryReferenceMap
  hasFilters?: boolean
}) {
  // Una sola hoja montada a la vez, controlada desde aquí: las acciones secundarias
  // viven en un menú, y un `SheetTrigger` dentro de un menú se desmonta al cerrarlo.
  const [active, setActive] = React.useState<ActiveSheet>(null)
  const close = (open: boolean) => { if (!open) setActive(null) }

  /** Acción principal de la fila: el siguiente paso pendiente, no todas las posibles. */
  function primaryAction(row: Row): { kind: "acuse" | "devolver"; label: string } | null {
    if (!canManage) return null
    if (row.acceptanceStatus === "pendiente") return { kind: "acuse", label: "Registrar acuse" }
    if (!row.returnedAt) return { kind: "devolver", label: "Devolver" }
    return null
  }

  function rowActions(row: Row, mobile: boolean) {
    const primary = primaryAction(row)
    const open = !row.returnedAt
    return (
      <div className={mobile ? "flex flex-wrap items-center gap-2" : "flex items-center justify-end gap-2"}>
        {primary && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setActive({ kind: primary.kind, row })}>
            {primary.label}
          </Button>
        )}
        {/* No modal: el ítem abre una hoja. Un menú modal deja `pointer-events: none`
            en el body justo cuando monta la hoja, que lo guarda como valor original y
            lo restaura al cerrarse: la página quedaba sin responder a clics. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" aria-label={`Más acciones de ${row.code}`}>
              <DotsThree size={18} weight="bold" aria-hidden />
              <span className={mobile ? "ml-1" : "sr-only"}>Más</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canManage && open && primary?.kind === "acuse" && (
              <DropdownMenuItem onSelect={() => setActive({ kind: "devolver", row })}>Devolver</DropdownMenuItem>
            )}
            {canManage && open && (
              <DropdownMenuItem onSelect={() => setActive({ kind: "transferir", row })}>Transferir</DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={`/ti/actas/${row.id}/print`}>Ver acta</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/ti/activos/${row.assetId}`}>Ver activo</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <>
      <DataTable
        caption="Entregas y custodia de activos TI"
        columns={COLUMNS}
        rows={rows as unknown as Record<string, unknown>[]}
        searchKeys={["code", "assetCode", "assetBrand", "assetModel", "workerName", "worksiteName"]}
        renderRow={(raw) => {
          const row = raw as unknown as Row
          return (
            <TableRow key={row.id}>
              <TableCell className="w-28">
                <Link href={`/ti/actas/${row.id}/print`} className="font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
                  {row.code}
                </Link>
              </TableCell>
              <TableCell>
                <Link href={`/ti/activos/${row.assetId}`} className="font-medium text-[var(--color-text)] hover:underline">{row.assetCode}</Link>
                <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.assetBrand, row.assetModel].filter(Boolean).join(" ")}</span>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{secondaryLine(row)}</p>
              </TableCell>
              <TableCell>{row.workerName}</TableCell>
              <TableCell>{row.worksiteName}</TableCell>
              <TableCell className="w-36">
                {formatDateTime(row.deliveredAt)}
                {row.kind === "loan" && row.expectedReturnDate && (
                  <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">Devolver antes del {formatDate(row.expectedReturnDate)}</p>
                )}
              </TableCell>
              <TableCell className="w-36"><CustodyBadges row={row} /></TableCell>
              <TableCell className="w-32"><AcceptanceBadge row={row} /></TableCell>
              <TableCell className="w-44">{rowActions(row, false)}</TableCell>
            </TableRow>
          )
        }}
        renderMobileCard={(raw) => {
          const row = raw as unknown as Row
          return (
            <div key={row.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <Link href={`/ti/actas/${row.id}/print`} className="inline-flex min-h-11 items-center font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
                {row.code}
              </Link>
              <p className="text-sm text-[var(--color-text)]">{row.workerName} · {row.assetCode}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{row.worksiteName} · {secondaryLine(row)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <CustodyBadges row={row} />
                <AcceptanceBadge row={row} />
              </div>
              {row.kind === "loan" && row.expectedReturnDate && (
                <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">Devolver antes del {formatDate(row.expectedReturnDate)}</p>
              )}
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">{rowActions(row, true)}</div>
            </div>
          )
        }}
        emptyTitle={hasFilters ? "Ninguna entrega coincide con los filtros" : "Aún no hay entregas"}
        emptyDescription={hasFilters
          ? "Quita algún filtro para ver más entregas."
          : canManage
            ? "Cada equipo que se entrega a un trabajador queda aquí con su acta. Registra la primera con «Nueva entrega»."
            : "Cuando se entregue un equipo a un trabajador aparecerá aquí con su acta."}
        pageSize={25}
        viewKey="ti-asignaciones"
        enableColumnToggle
      />

      {active?.kind === "acuse" && (
        <AcceptanceSheet open onOpenChange={close} assignment={active.row} />
      )}
      {active?.kind === "devolver" && (
        <ReturnSheet
          open
          onOpenChange={close}
          reference={references[active.row.id]?.reference}
          assignment={{ ...active.row, accessories: references[active.row.id]?.accessories }}
        />
      )}
      {active?.kind === "transferir" && (
        <TransferSheet open onOpenChange={close} assignment={active.row} workers={workers} worksites={worksites} />
      )}
    </>
  )
}
