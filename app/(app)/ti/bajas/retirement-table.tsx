"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { IT_RETIREMENT_REASON_META } from "@/lib/services/ti/constants"

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
]

export function RetirementTable({ rows }: { rows: Row[] }) {
  return (
    <DataTable
      caption="Bajas de activos TI"
      columns={COLUMNS}
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["assetCode", "brand", "model", "reason", "destination", "responsibleName", "observations"]}
      renderRow={(raw) => {
        const row = raw as unknown as Row
        return (
          <TableRow key={row.id}>
            <TableCell className="w-28">{formatDate(row.date)}</TableCell>
            <TableCell>
              <Link href={`/ti/activos/${row.assetId}`} className="font-mono text-xs font-semibold text-[var(--color-primary)] hover:underline">
                {row.assetCode}
              </Link>
              <span className="ml-2 text-xs text-[var(--color-text-subtle)]">{[row.brand, row.model].filter(Boolean).join(" ")}</span>
            </TableCell>
            <TableCell className="w-32">
              <Badge variant={REASON_VARIANT[row.reason] ?? "default"}>{IT_RETIREMENT_REASON_META[row.reason] ?? row.reason}</Badge>
            </TableCell>
            <TableCell className="w-40">{row.destination ?? "—"}</TableCell>
            <TableCell className="w-44">{row.responsibleName}</TableCell>
            <TableCell className="max-w-[280px] truncate">{row.observations ?? "—"}</TableCell>
          </TableRow>
        )
      }}
      renderMobileCard={(raw) => {
        const row = raw as unknown as Row
        return (
          <Link key={row.id} href={`/ti/activos/${row.assetId}`} className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div>
              <div className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.assetCode}</div>
              <div className="text-sm text-[var(--color-text)]">{IT_RETIREMENT_REASON_META[row.reason] ?? row.reason} · {formatDate(row.date)}</div>
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
