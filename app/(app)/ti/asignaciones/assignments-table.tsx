"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDateTime } from "@/lib/utils"
import { IT_ASSIGNMENT_KIND_META, IT_PHYSICAL_STATE_META } from "@/lib/services/ti/constants"
import { ReturnSheet } from "./return-sheet"
import { TransferSheet } from "./transfer-sheet"

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
  returnedAt: string | null
  returnPhysicalState: string | null
  deliveredByName: string | null
}

const COLUMNS = [
  { key: "code", label: "Acta", width: "w-32" },
  { key: "asset", label: "Activo", sortable: true },
  { key: "worker", label: "Trabajador", sortable: true },
  { key: "worksite", label: "Faena", sortable: true },
  { key: "kind", label: "Tipo", width: "w-28" },
  { key: "deliveredAt", label: "Entrega", sortable: true, width: "w-32" },
  { key: "state", label: "Estado físico", width: "w-32" },
  { key: "status", label: "Situación", width: "w-28" },
  { key: "actions", label: "", width: "w-56" },
]

export function AssignmentsTable({ rows, canManage, workers, worksites }: {
  rows: Row[]
  canManage: boolean
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
}) {
  return (
    <DataTable
      caption="Asignaciones y custodia de activos TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["code", "assetCode", "assetBrand", "assetModel", "workerName", "worksiteName"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        return (
          <TableRow key={row.id}>
            <TableCell className="w-32">
              <Link href={`/ti/actas/${row.id}/print`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              <span className="font-medium text-[var(--color-text)]">{row.assetCode}</span>
              <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.assetBrand, row.assetModel].filter(Boolean).join(" ")}</span>
            </TableCell>
            <TableCell>{row.workerName}</TableCell>
            <TableCell>{row.worksiteName}</TableCell>
            <TableCell className="w-28">{IT_ASSIGNMENT_KIND_META[row.kind] ?? row.kind}</TableCell>
            <TableCell className="w-32">{formatDateTime(row.deliveredAt)}</TableCell>
            <TableCell className="w-32">{IT_PHYSICAL_STATE_META[row.physicalState]?.label ?? row.physicalState}</TableCell>
            <TableCell className="w-28">
              {row.returnedAt
                ? <MetaBadge meta={{ label: "Devuelto", variant: "default" }} />
                : <MetaBadge meta={{ label: "Vigente", variant: "info" }} dot />}
            </TableCell>
            <TableCell className="w-56">
              <div className="flex items-center justify-end gap-2">
                {canManage && !row.returnedAt && (
                  <>
                    <ReturnSheet
                      trigger={<Button type="button" variant="link" size="sm">Devolver</Button>}
                      assignment={row}
                    />
                    <TransferSheet
                      trigger={<Button type="button" variant="link" size="sm">Transferir</Button>}
                      assignment={row}
                      workers={workers}
                      worksites={worksites}
                    />
                  </>
                )}
                <Link href={`/ti/activos/${row.assetId}`} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                  Ver activo
                </Link>
              </div>
            </TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        return (
          <div key={row.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <Link href={`/ti/activos/${row.assetId}`} className="block">
              <div>
                <div className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</div>
                <div className="text-sm text-[var(--color-text)]">{row.workerName} · {row.assetCode}</div>
                <div className="mt-1 flex items-center gap-2">
                  {row.returnedAt ? <MetaBadge meta={{ label: "Devuelto", variant: "default" }} /> : <MetaBadge meta={{ label: "Vigente", variant: "info" }} dot />}
                  <span className="text-xs text-[var(--color-text-muted)]">{row.worksiteName}</span>
                </div>
              </div>
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
              {canManage && !row.returnedAt && (
                <>
                  <ReturnSheet
                    trigger={<Button type="button" variant="link" size="sm">Devolver</Button>}
                    assignment={row}
                  />
                  <TransferSheet
                    trigger={<Button type="button" variant="link" size="sm">Transferir</Button>}
                    assignment={row}
                    workers={workers}
                    worksites={worksites}
                  />
                </>
              )}
              <Link href={`/ti/activos/${row.assetId}`} className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Ver activo
              </Link>
            </div>
          </div>
        )
      }}
      emptyTitle="Sin asignaciones"
      emptyDescription={canManage ? "Registra la primera entrega con el botón «Nueva entrega»." : "No hay asignaciones que coincidan con tu búsqueda."}
      pageSize={25}
      viewKey="ti-asignaciones"
      enableColumnToggle
    />
  )
}
