"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { TableRow, TableCell, TableCellNum } from "@/components/ui/table"
import { formatCLP } from "@/lib/utils"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"
import { WarrantyBadge } from "./warranty-badge"
import { ArrowRight, Wrench } from "@phosphor-icons/react"
import type { AssetRow } from "./page"

const assetName = (row: AssetRow) => [row.brand, row.model].filter(Boolean).join(" ")

// Las claves antiguas (`name`, `worker`, `worksite`, `type`) no existían en la
// fila (`typeName`, `workerName`…): el orden era arbitrario y `aria-sort`
// anunciaba uno falso. `sortValue` ordena por el dato real de cada columna.
const COLUMNS = [
  { key: "code", label: "Código", sortable: true, width: "w-32", sortValue: (r: AssetRow) => r.code },
  { key: "asset", label: "Activo", sortable: true, sortValue: (r: AssetRow) => `${assetName(r)} ${r.code}`.trim().toLowerCase() },
  { key: "status", label: "Estado", sortable: true, width: "w-36", sortValue: (r: AssetRow) => IT_ASSET_STATUS_META[r.status]?.label ?? r.status },
  { key: "worker", label: "Asignado a", sortable: true, sortValue: (r: AssetRow) => r.workerName },
  { key: "worksite", label: "Faena", sortable: true, sortValue: (r: AssetRow) => r.worksiteName },
  { key: "type", label: "Tipo", sortable: true, sortValue: (r: AssetRow) => r.typeName },
  { key: "warranty", label: "Garantía", sortable: true, width: "w-40", sortValue: (r: AssetRow) => r.warrantyEndDate },
  // Costo y Tickets parten ocultos (siguen en "Columnas" y en la ficha): con las
  // diez columnas visibles la tabla medía ~1280px en un pozo de 1126px a 1440 y
  // "Mantenciones" quedaba cortada. Son los dos datos menos operativos del día.
  { key: "cost", label: "Costo", numeric: true, sortable: true, width: "w-28", defaultVisible: false, sortValue: (r: AssetRow) => r.cost },
  // "Mant." era una abreviatura sin nombre completo (A6): el encabezado es de texto plano.
  { key: "maintenance", label: "Mantenciones", numeric: true, sortable: true, width: "w-32", sortValue: (r: AssetRow) => r.maintenanceCount },
  { key: "tickets", label: "Tickets", numeric: true, sortable: true, width: "w-20", defaultVisible: false, sortValue: (r: AssetRow) => r.ticketCount },
]

function StatusBadge({ status }: { status: string }) {
  const meta = IT_ASSET_STATUS_META[status]
  if (!meta) return <MetaBadge meta={{ label: status, variant: "default" }} />
  return <MetaBadge meta={{ label: meta.label, variant: meta.variant }} dot />
}

export function AssetTable({ rows }: { rows: AssetRow[] }) {
  const router = useRouter()

  return (
    <DataTable
      caption="Inventario de activos TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["code", "brand", "model", "serialNumber", "workerName", "worksiteName", "typeName"]}
      renderRow={(raw) => {
        const row = raw as unknown as AssetRow
        const href = `/ti/activos/${row.id}`
        return (
          <TableRow
            key={row.id}
            className="group cursor-pointer"
            // La fila entera navega con el mouse; el teclado y los lectores de
            // pantalla usan el enlace del código (un <tr> con role="link"
            // rompería la semántica de tabla).
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a,button")) return
              router.push(href)
            }}
          >
            <TableCell className="w-32 whitespace-nowrap">
              <Link href={href} className="font-mono text-xs font-semibold whitespace-nowrap text-[var(--color-primary)] hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell className="min-w-[14rem]">
              <div className="font-medium text-[var(--color-text)]">{assetName(row) || "—"}</div>
              {row.serialNumber && <div className="text-xs text-[var(--color-text-subtle)]">Serie: {row.serialNumber}</div>}
            </TableCell>
            <TableCell className="w-36"><StatusBadge status={row.status} /></TableCell>
            <TableCell>{row.workerName ?? "—"}</TableCell>
            <TableCell>{row.worksiteName ?? "—"}</TableCell>
            <TableCell>{row.typeName}</TableCell>
            <TableCell className="w-40"><WarrantyBadge endDate={row.warrantyEndDate} /></TableCell>
            <TableCellNum className="w-28">{row.cost != null ? formatCLP(row.cost) : "—"}</TableCellNum>
            <TableCellNum className="w-32">
              <span className="inline-flex items-center justify-end gap-1">
                <Wrench size={11} className="text-[var(--color-text-subtle)]" aria-hidden />
                {row.maintenanceCount}
              </span>
              {row.maintenanceCost > 0 && <div className="text-xs text-[var(--color-text-subtle)]">{formatCLP(row.maintenanceCost)}</div>}
            </TableCellNum>
            <TableCellNum className="w-20">{row.ticketCount}</TableCellNum>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as AssetRow
        return (
          <Link key={row.id} href={`/ti/activos/${row.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="min-w-0">
              <div className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</div>
              <div className="text-sm text-[var(--color-text)]">{assetName(row) || row.typeName}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge status={row.status} />
                {row.workerName && <span className="text-xs text-[var(--color-text-muted)]">{row.workerName}</span>}
              </div>
              {row.worksiteName && <div className="mt-1 text-xs text-[var(--color-text-subtle)]">{row.worksiteName}</div>}
            </div>
            <ArrowRight size={14} className="shrink-0 text-[var(--color-text-subtle)]" aria-hidden />
          </Link>
        )
      }}
      // El vacío "sin activos" / "sin filtros que coincidan" lo pinta la página;
      // este solo cubre la búsqueda de la barra superior.
      emptyTitle="Ningún activo coincide con la búsqueda"
      emptyDescription="Prueba con otro código, marca, serie o persona."
      pageSize={25}
      enableColumnToggle
      viewKey="ti-activos"
      stickyFirstColumn
    />
  )
}
