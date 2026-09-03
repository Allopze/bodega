"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate, todayInChile } from "@/lib/utils"
import { civilDaysUntil } from "@/lib/services/ti/civil-dates"

interface Row {
  id: string
  code: string
  brand: string | null
  model: string | null
  status: string
  warrantyEndDate: string | null
  purchaseDate: string | null
  supplierName: string | null
  workerName: string | null
}

function warrantyStatus(date: string): { label: string; variant: "success" | "warning" | "danger" | "default" } {
  const days = civilDaysUntil(date, todayInChile())
  if (days < 0) return { label: "Vencida", variant: "danger" }
  if (days <= 30) return { label: `Vence en ${days} d`, variant: "danger" }
  if (days <= 60) return { label: `Vence en ${days} d`, variant: "warning" }
  if (days <= 90) return { label: `Vence en ${days} d`, variant: "warning" }
  return { label: "Vigente", variant: "success" }
}

const COLUMNS = [
  { key: "code", label: "Código", width: "w-28" },
  { key: "asset", label: "Activo", sortable: true },
  { key: "warranty", label: "Vencimiento", sortable: true, width: "w-32" },
  { key: "status", label: "Garantía", width: "w-32" },
  { key: "supplier", label: "Proveedor", sortable: true },
  { key: "worker", label: "Asignado a" },
]

export function WarrantyTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable
      caption="Garantías de activos TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["code", "brand", "model", "supplierName", "workerName"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        const status = row.warrantyEndDate ? warrantyStatus(row.warrantyEndDate) : null
        return (
          <TableRow key={row.id}>
            <TableCell className="w-28">
              <Link href={`/ti/activos/${row.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              <span className="font-medium text-[var(--color-text)]">{[row.brand, row.model].filter(Boolean).join(" ") || "—"}</span>
              {row.purchaseDate && <span className="ml-2 text-xs text-[var(--color-text-subtle)]">comprado {formatDate(row.purchaseDate)}</span>}
            </TableCell>
            <TableCell className="w-32">{row.warrantyEndDate ? formatDate(row.warrantyEndDate) : "—"}</TableCell>
            <TableCell className="w-32">
              {status ? <Badge variant={status.variant} dot>{status.label}</Badge> : <Badge variant="default">Sin garantía</Badge>}
            </TableCell>
            <TableCell>{row.supplierName ?? "—"}</TableCell>
            <TableCell>{row.workerName ?? "—"}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        const status = row.warrantyEndDate ? warrantyStatus(row.warrantyEndDate) : null
        return (
          <Link key={row.id} href={`/ti/activos/${row.id}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</div>
              <div className="text-sm text-[var(--color-text)]">{[row.brand, row.model].filter(Boolean).join(" ") || "—"}</div>
            </div>
            {status && <Badge variant={status.variant} dot>{status.label}</Badge>}
          </Link>
        )
      }}
      emptyTitle="Sin activos con garantía"
      emptyDescription="Los activos con fecha de término de garantía aparecerán acá."
      pageSize={25}
      viewKey="ti-garantias"
    />
  )
}
