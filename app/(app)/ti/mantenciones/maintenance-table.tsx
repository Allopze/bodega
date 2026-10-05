"use client"

import * as React from "react"
import Link from "next/link"
import { DotsThree, Prohibit } from "@phosphor-icons/react"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate, formatCLP } from "@/lib/utils"
import { IT_MAINTENANCE_TYPE_META } from "@/lib/services/ti/constants"
import { MaintenanceSheet } from "./maintenance-sheet"
import { VoidMaintenanceDialog } from "./void-maintenance-dialog"

interface Row {
  id: string
  assetId: string
  assetCode: string
  assetBrand: string | null
  assetModel: string | null
  worksiteName: string | null
  type: string
  date: string
  reportedIssue: string | null
  diagnosis: string | null
  workDone: string
  partsUsed: string | null
  cost: number
  supplierId: string | null
  supplierName: string | null
  technicianName: string | null
  technicianUserId: string | null
  technicianUserName: string | null
  observations: string | null
  voidedAt: string | null
  voidReason: string | null
  voidedByUserName: string | null
}

const typeLabel = (type: string) => IT_MAINTENANCE_TYPE_META[type] ?? type

// Desbordaba a 1440 px (1154 px de tabla en un pozo de 1126): "Problema" y
// "Trabajo" se fundieron en "Detalle" (dos líneas), la faena baja bajo el
// activo y las acciones son una principal + menú "Más".
const COLUMNS = [
  { key: "date", label: "Fecha", sortable: true, width: "w-28", sortValue: (r: Row) => r.date },
  { key: "asset", label: "Activo", sortable: true, sortValue: (r: Row) => r.assetCode },
  { key: "worksite", label: "Faena", sortable: true, width: "w-32", sortValue: (r: Row) => r.worksiteName },
  { key: "type", label: "Tipo", sortable: true, width: "w-28", sortValue: (r: Row) => typeLabel(r.type) },
  { key: "work", label: "Detalle" },
  { key: "technician", label: "Técnico / proveedor", width: "w-40" },
  { key: "cost", label: "Costo", numeric: true, sortable: true, width: "w-28", sortValue: (r: Row) => Number(r.cost ?? 0) },
  { key: "actions", label: "", width: "w-32" },
]

/**
 * Acciones de una fila vigente. Escritorio: "Editar" a la vista y "Anular"
 * dentro de "Más" (la anulación es la menos frecuente y la destructiva). Las
 * tarjetas móviles muestran las dos a la vista: ahí no falta ancho.
 */
function RowActions({ row, suppliers, stacked }: { row: Row; suppliers: { id: string; name: string }[]; stacked?: boolean }) {
  const [voidOpen, setVoidOpen] = React.useState(false)
  const cost = Number(row.cost ?? 0)
  const edit = (
    <MaintenanceSheet
      trigger={<Button type="button" variant={stacked ? "secondary" : "link"} size="sm">Editar</Button>}
      suppliers={suppliers}
      editMaintenance={row}
    />
  )
  if (stacked) {
    return (
      <>
        {edit}
        <VoidMaintenanceDialog maintenanceId={row.id} assetCode={row.assetCode} date={formatDate(row.date)} cost={cost} />
      </>
    )
  }
  return (
    <div className="flex items-center justify-end gap-1">
      {edit}
      {/* No modal: el ítem abre una hoja. Un menú modal deja `pointer-events: none`
          en el body justo cuando monta la hoja, que lo guarda como valor original y
          lo restaura al cerrarse: la página quedaba sin responder a clics. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Más acciones de la mantención de ${row.assetCode}`}>
            <DotsThree size={16} weight="bold" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownMenuItem onSelect={() => setVoidOpen(true)} className="text-[var(--color-danger-ink)]">
            <Prohibit size={14} aria-hidden /> Anular mantención
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <VoidMaintenanceDialog
        maintenanceId={row.id}
        assetCode={row.assetCode}
        date={formatDate(row.date)}
        cost={cost}
        open={voidOpen}
        onOpenChange={setVoidOpen}
      />
    </div>
  )
}

export function MaintenanceTable({ rows, canManage = false, suppliers = [] }: {
  rows: Row[]
  canManage?: boolean
  suppliers?: { id: string; name: string }[]
}) {
  return (
    <DataTable
      caption="Mantenciones y reparaciones TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["assetCode", "assetBrand", "assetModel", "worksiteName", "reportedIssue", "workDone", "technicianName", "technicianUserName", "supplierName", "voidReason"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        const voided = Boolean(row.voidedAt)
        // Anulada: sin `opacity` (dejaba el texto en 3:1). Se atenúa con tokens
        // —fondo `surface-2`, texto `subtle`— y la marca real es el tachado
        // del dato principal más el badge "Anulada".
        const muted = voided ? "text-[var(--color-text-subtle)]" : ""
        return (
          <TableRow key={row.id} className={voided ? "bg-[var(--color-surface-2)]" : undefined}>
            <TableCell className={`w-28 ${muted}`}>{formatDate(row.date)}</TableCell>
            <TableCell>
              <Link href={`/ti/activos/${row.assetId}`} className={`font-mono text-xs font-semibold hover:underline ${voided ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-primary)]"}`}>
                {row.assetCode}
              </Link>
              <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.assetBrand, row.assetModel].filter(Boolean).join(" ")}</span>
              {voided && (
                <span className="ml-2"><MetaBadge meta={{ label: "Anulada", variant: "danger" }} /></span>
              )}
            </TableCell>
            <TableCell className={`w-32 text-xs ${voided ? "text-[var(--color-text-subtle)]" : "text-[var(--color-text-muted)]"}`}>{row.worksiteName ?? "—"}</TableCell>
            <TableCell className="w-28"><MetaBadge meta={{ label: typeLabel(row.type), variant: voided ? "default" : "warning" }} /></TableCell>
            <TableCell className={`max-w-[320px] ${muted}`}>
              <div className={`truncate ${voided ? "line-through" : ""}`}>{row.workDone}</div>
              {row.reportedIssue && (
                <div className="truncate text-xs text-[var(--color-text-subtle)]" title={row.reportedIssue}>Problema: {row.reportedIssue}</div>
              )}
            </TableCell>
            <TableCell className="w-40">
              <span className={`text-xs ${voided ? "text-[var(--color-text-subtle)]" : "text-[var(--color-text-muted)]"}`}>
                {[row.technicianName, row.technicianUserName, row.supplierName].filter(Boolean).join(" · ") || "—"}
              </span>
            </TableCell>
            <TableCell className={`w-28 text-right font-mono text-xs font-semibold tabular-nums ${voided ? "text-[var(--color-text-subtle)] line-through" : ""}`}>{formatCLP(Number(row.cost ?? 0))}</TableCell>
            <TableCell className="w-32 text-right">
              {voided ? (
                <span className="text-xs text-[var(--color-text-subtle)]" title={row.voidReason ?? undefined}>
                  por {row.voidedByUserName ?? "—"}
                </span>
              ) : canManage ? (
                <RowActions row={row} suppliers={suppliers} />
              ) : null}
            </TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        const voided = Boolean(row.voidedAt)
        return (
          <div key={row.id} className={`rounded-xl border border-[var(--color-border)] p-3 ${voided ? "bg-[var(--color-surface-2)]" : "bg-[var(--color-surface)]"}`}>
            <Link href={`/ti/activos/${row.assetId}`} className="flex min-h-11 flex-col justify-center">
              <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                <span className={voided ? "text-[var(--color-text-subtle)] line-through" : undefined}>{row.assetCode} · {typeLabel(row.type)}</span>
                {voided && <MetaBadge meta={{ label: "Anulada", variant: "danger" }} />}
              </div>
              {/* El costo va tachado también acá: en móvil esta tarjeta es la
                  única lectura del monto, y sin la marca se re-reporta como real. */}
              <div className={`text-xs ${voided ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-text-muted)]"}`}>
                {formatDate(row.date)} · <span className="font-mono tabular-nums">{formatCLP(Number(row.cost ?? 0))}</span>
              </div>
              {row.worksiteName && <div className="text-xs text-[var(--color-text-subtle)]">{row.worksiteName}</div>}
            </Link>
            {voided ? (
              <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
                Anulada por {row.voidedByUserName ?? "—"}{row.voidReason ? `: ${row.voidReason}` : ""}
              </p>
            ) : canManage ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
                <RowActions row={row} suppliers={suppliers} stacked />
              </div>
            ) : null}
          </div>
        )
      }}
      emptyTitle="Sin mantenciones"
      emptyDescription="Las mantenciones y reparaciones registradas aparecerán acá."
      pageSize={25}
      viewKey="ti-mantenciones"
      enableColumnToggle
    />
  )
}
