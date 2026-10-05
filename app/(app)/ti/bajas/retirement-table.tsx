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
  worksiteName: string | null
  date: string
  reason: string
  destination: string | null
  observations: string | null
  responsibleName: string
  authorizedByName: string | null
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

const reasonLabel = (reason: string) => IT_RETIREMENT_REASON_META[reason] ?? reason

const COLUMNS = [
  { key: "date", label: "Fecha", sortable: true, width: "w-28", sortValue: (r: Row) => r.date },
  { key: "asset", label: "Activo", sortable: true, sortValue: (r: Row) => r.assetCode },
  { key: "worksite", label: "Faena", sortable: true, width: "w-32", sortValue: (r: Row) => r.worksiteName },
  { key: "reason", label: "Motivo", sortable: true, width: "w-32", sortValue: (r: Row) => reasonLabel(r.reason) },
  { key: "destination", label: "Destino final", width: "w-36" },
  // Doble control: responsable y autorizante tienen que verse juntos en la lista.
  { key: "responsible", label: "Responsable / Autorizó", sortable: true, width: "w-48", sortValue: (r: Row) => r.responsibleName },
  { key: "observations", label: "Observaciones" },
  { key: "reversal", label: "", width: "w-28" },
]

function Signatories({ row, muted }: { row: Row; muted?: boolean }) {
  return (
    <div className={muted ? "text-[var(--color-text-subtle)]" : undefined}>
      <div>{row.responsibleName}</div>
      <div className="text-xs text-[var(--color-text-subtle)]">Autorizó: {row.authorizedByName ?? "—"}</div>
    </div>
  )
}

/** `canManage` acá es `ti:reverse_retirement`, no `ti:manage_assets`: revertir es un permiso propio. */
export function RetirementTable({ rows, canManage = false }: { rows: Row[]; canManage?: boolean }) {
  return (
    <DataTable
      caption="Bajas de activos TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["assetCode", "brand", "model", "worksiteName", "reason", "destination", "responsibleName", "authorizedByName", "observations", "reverseReason"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        const reversed = Boolean(row.reversedAt)
        // Revertida: atenuada con tokens (`surface-2`, texto `subtle`), no con
        // `opacity`, que dejaba el texto en ~3:1. La marca es el tachado del
        // código y el badge "Revertida".
        const muted = reversed ? "text-[var(--color-text-subtle)]" : ""
        return (
          <TableRow key={row.id} className={reversed ? "bg-[var(--color-surface-2)]" : undefined}>
            <TableCell className={`w-28 ${muted}`}>{formatDate(row.date)}</TableCell>
            <TableCell>
              <Link href={`/ti/activos/${row.assetId}`} className={`font-mono text-xs font-semibold hover:underline ${reversed ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-primary)]"}`}>
                {row.assetCode}
              </Link>
              <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.brand, row.model].filter(Boolean).join(" ")}</span>
              {reversed && (
                <span className="ml-2"><MetaBadge meta={{ label: "Revertida", variant: "default" }} /></span>
              )}
            </TableCell>
            <TableCell className={`w-32 text-xs ${reversed ? "text-[var(--color-text-subtle)]" : "text-[var(--color-text-muted)]"}`}>{row.worksiteName ?? "—"}</TableCell>
            <TableCell className="w-32">
              <MetaBadge meta={{ label: reasonLabel(row.reason), variant: reversed ? "default" : (REASON_VARIANT[row.reason] ?? "default") }} />
            </TableCell>
            <TableCell className={`w-36 ${muted}`}>{row.destination ?? "—"}</TableCell>
            <TableCell className="w-48"><Signatories row={row} muted={reversed} /></TableCell>
            <TableCell className={`max-w-[280px] truncate ${muted}`}>{row.observations ?? "—"}</TableCell>
            <TableCell className="w-28 text-right">
              {reversed ? (
                <span className="text-xs text-[var(--color-text-subtle)]" title={row.reverseReason ?? undefined}>
                  por {row.reversedByName ?? "—"}
                </span>
              ) : canManage ? (
                <ReverseAction row={row} />
              ) : null}
            </TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        const reversed = Boolean(row.reversedAt)
        return (
          <div key={row.id} className={`rounded-xl border border-[var(--color-border)] p-3 ${reversed ? "bg-[var(--color-surface-2)]" : "bg-[var(--color-surface)]"}`}>
            <Link href={`/ti/activos/${row.assetId}`} className="block">
              <div className="flex items-center gap-1.5">
                {/* En móvil esta tarjeta es la única lectura de la baja: sin la
                    marca, una baja ya revertida se reporta como vigente. */}
                <span className={`font-mono text-xs font-semibold ${reversed ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-primary)]"}`}>{row.assetCode}</span>
                {reversed && <MetaBadge meta={{ label: "Revertida", variant: "default" }} />}
              </div>
              <div className={`text-sm ${reversed ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-text)]"}`}>{reasonLabel(row.reason)} · {formatDate(row.date)}</div>
              {row.worksiteName && <div className="text-xs text-[var(--color-text-subtle)]">{row.worksiteName}</div>}
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                {row.responsibleName} · autorizó {row.authorizedByName ?? "—"}
              </div>
            </Link>
            {reversed ? (
              <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
                Revertida por {row.reversedByName ?? "—"}{row.reverseReason ? `: ${row.reverseReason}` : ""}
              </p>
            ) : canManage ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
                <ReverseAction row={row} />
                {!row.canReverse && row.reverseBlockedReason && (
                  <p className="basis-full text-xs text-[var(--color-text-muted)]">{row.reverseBlockedReason}</p>
                )}
              </div>
            ) : null}
          </div>
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

/** Revertir, o su versión deshabilitada con la razón: igual en escritorio y móvil. */
function ReverseAction({ row }: { row: Row }) {
  if (row.canReverse) {
    return (
      <ReverseRetirementDialog
        retirementId={row.id}
        assetCode={row.assetCode}
        date={formatDate(row.date)}
        reasonLabel={reasonLabel(row.reason)}
        restoresToLabel={itStatusLabel(row.previousStatus)}
        reopensAssignment={Boolean(row.closedAssignmentId)}
      />
    )
  }
  // Deshabilitado, no oculto: el usuario necesita saber que la función existe
  // y por qué no aplica acá. Va como <button> deshabilitado y no como <span>
  // para que el motivo sea alcanzable por teclado y lector de pantalla.
  return (
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
}
