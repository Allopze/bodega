"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { IT_RETIREMENT_REASON_META, itStatusLabel } from "@/lib/services/ti/constants"
import { ReverseRetirementDialog } from "./reverse-retirement-dialog"

interface Row {
  id: string
  assetId: string
  assetCode: string
  brand: string | null
  model: string | null
  date: string
  reason: string
  destination: string | null
  observations: string | null
  responsibleName: string
  previousStatus: string | null
  closedAssignmentId: string | null
  reversedAt: string | null
  reverseReason: string | null
  reversedByName: string | null
  canReverse: boolean
  reverseBlockedReason: string | null
}

const REASON_VARIANT: Record<string, "danger" | "warning" | "default"> = {
  perdida: "danger",
  robo: "danger",
  venta: "warning",
  destruccion: "danger",
  reciclaje: "default",
  repuesto: "default",
  donacion: "default",
}

const COLUMNS = [
  { key: "date", label: "Fecha", sortable: true, width: "w-28" },
  { key: "asset", label: "Activo", sortable: true },
  { key: "reason", label: "Motivo", width: "w-32" },
  { key: "destination", label: "Destino final", width: "w-40" },
  { key: "responsible", label: "Responsable", width: "w-44" },
  { key: "observations", label: "Observaciones" },
  { key: "reversal", label: "", width: "w-28" },
]

/** `canManage` acá es `ti:reverse_retirement`, no `ti:manage_assets`: revertir es un permiso propio. */
export function RetirementTable({ rows, canManage = false }: { rows: Row[]; canManage?: boolean }) {
  return (
    <DataTable
      caption="Bajas de activos TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["assetCode", "brand", "model", "reason", "destination", "responsibleName", "observations", "reverseReason"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        const reversed = Boolean(row.reversedAt)
        return (
          <TableRow key={row.id} className={reversed ? "opacity-70" : undefined}>
            <TableCell className="w-28">{formatDate(row.date)}</TableCell>
            <TableCell>
              <Link href={`/ti/activos/${row.assetId}`} className={`font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline ${reversed ? "line-through" : ""}`}>
                {row.assetCode}
              </Link>
              <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.brand, row.model].filter(Boolean).join(" ")}</span>
              {reversed && (
                <span className="ml-2"><MetaBadge meta={{ label: "Revertida", variant: "default" }} /></span>
              )}
            </TableCell>
            <TableCell className="w-32">
              <MetaBadge meta={{ label: `${IT_RETIREMENT_REASON_META[row.reason] ?? row.reason}`, variant: REASON_VARIANT[row.reason] ?? "default" }} />
            </TableCell>
            <TableCell className="w-40">{row.destination ?? "—"}</TableCell>
            <TableCell className="w-44">{row.responsibleName}</TableCell>
            <TableCell className="max-w-[280px] truncate">{row.observations ?? "—"}</TableCell>
            <TableCell className="w-28 text-right">
              {reversed ? (
                <span className="text-xs text-[var(--color-text-subtle)]" title={row.reverseReason ?? undefined}>
                  por {row.reversedByName ?? "—"}
                </span>
              ) : canManage ? (
                row.canReverse ? (
                  <ReverseRetirementDialog
                    retirementId={row.id}
                    assetCode={row.assetCode}
                    date={formatDate(row.date)}
                    reasonLabel={IT_RETIREMENT_REASON_META[row.reason] ?? row.reason}
                    restoresToLabel={itStatusLabel(row.previousStatus)}
                    reopensAssignment={Boolean(row.closedAssignmentId)}
                  />
                ) : (
                  // Deshabilitado, no oculto: el usuario necesita saber que la
                  // función existe y por qué no aplica acá. Va como <button>
                  // deshabilitado y no como <span> para que el motivo sea
                  // alcanzable por teclado y lector de pantalla.
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled
                    title={row.reverseBlockedReason ?? undefined}
                    aria-label={`No se puede revertir la baja de ${row.assetCode}: ${row.reverseBlockedReason ?? "no disponible"}`}
                  >
                    Revertir
                  </Button>
                )
              ) : null}
            </TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        const reversed = Boolean(row.reversedAt)
        return (
          <Link key={row.id} href={`/ti/activos/${row.assetId}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="flex items-center gap-1.5">
                {/* En móvil esta tarjeta es la única lectura de la baja: sin la
                    marca, una baja ya revertida se reporta como vigente. */}
                <span className={`font-mono text-xs font-semibold text-[var(--color-primary)] ${reversed ? "line-through" : ""}`}>{row.assetCode}</span>
                {reversed && <MetaBadge meta={{ label: "Revertida", variant: "default" }} />}
              </div>
              <div className={`text-sm text-[var(--color-text)] ${reversed ? "line-through" : ""}`}>{IT_RETIREMENT_REASON_META[row.reason] ?? row.reason} · {formatDate(row.date)}</div>
            </div>
          </Link>
        )
      }}
      emptyTitle="Sin bajas registradas"
      emptyDescription="Los activos dados de baja aparecerán acá con su motivo y destino."
      pageSize={25}
      viewKey="ti-bajas"
      enableColumnToggle
    />
  )
}
