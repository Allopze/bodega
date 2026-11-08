"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { warrantyStatus } from "@/lib/services/ti/warranty"

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
  worksiteName: string | null
}

const COLUMNS = [
  { key: "code", label: "Código", width: "w-28", sortable: true, sortValue: (r: Row) => r.code },
  { key: "asset", label: "Activo", sortable: true, sortValue: (r: Row) => [r.brand, r.model].filter(Boolean).join(" ") },
  { key: "warranty", label: "Vencimiento", sortable: true, width: "w-32", sortValue: (r: Row) => r.warrantyEndDate },
  { key: "status", label: "Garantía", width: "w-32" },
  { key: "supplier", label: "Proveedor", sortable: true, sortValue: (r: Row) => r.supplierName },
  { key: "worksite", label: "Faena", sortable: true, sortValue: (r: Row) => r.worksiteName },
  { key: "worker", label: "Asignado a" },
]

export function WarrantyTable({ rows, hasFilters = false }: { rows: Row[]; hasFilters?: boolean }) {
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
              <Link href={`/ti/activos/${row.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              <span className="font-medium text-[var(--color-text)]">{[row.brand, row.model].filter(Boolean).join(" ") || "—"}</span>
              {row.purchaseDate && <span className="ml-2 text-xs text-[var(--color-text-subtle)]">comprado {formatDate(row.purchaseDate)}</span>}
            </TableCell>
            <TableCell className="w-32">{row.warrantyEndDate ? formatDate(row.warrantyEndDate) : "—"}</TableCell>
            <TableCell className="w-32">
              {status ? <MetaBadge meta={status} dot /> : <MetaBadge meta={{ label: "Sin garantía", variant: "default" }} />}
            </TableCell>
            <TableCell>{row.supplierName ?? "—"}</TableCell>
            <TableCell>{row.worksiteName ?? "—"}</TableCell>
            <TableCell>{row.workerName || "—"}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        const status = row.warrantyEndDate ? warrantyStatus(row.warrantyEndDate) : null
        return (
          <Link key={row.id} href={`/ti/activos/${row.id}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="font-mono text-xs font-semibold text-[var(--color-primary-ink)]">{row.code}</div>
              <div className="text-sm text-[var(--color-text)]">{[row.brand, row.model].filter(Boolean).join(" ") || "—"}</div>
              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {[row.worksiteName, row.warrantyEndDate ? `hasta ${formatDate(row.warrantyEndDate)}` : null].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            {status && <MetaBadge meta={status} dot />}
          </Link>
        )
      }}
      emptyTitle={hasFilters ? "Ninguna garantía coincide con los filtros" : "Sin activos con garantía"}
      emptyDescription={hasFilters
        ? "Prueba con otra banda de vigencia o quita la faena."
        : "Los activos con fecha de término de garantía aparecerán acá."}
      emptyAction={hasFilters
        ? <Button asChild variant="secondary" size="sm"><Link href="/ti/garantias">Limpiar filtros</Link></Button>
        : undefined}
      pageSize={25}
      viewKey="ti-garantias"
    />
  )
}
