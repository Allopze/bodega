"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDateTime } from "@/lib/utils"

interface AuditRow {
  id:          string
  userEmail:   string | null
  action:      string
  entityType:  string
  entityId:    string
  entityCode:  string | null
  oldState:    string | null
  newState:    string | null
  reason:      string | null
  createdAt:   string
}

const ACTION_VARIANTS: Record<string, "success" | "info" | "warning" | "danger" | "default"> = {
  create:        "success",
  update:        "info",
  status_change: "warning",
  delete:        "danger",
  login:         "default",
}

const ENTITY_LABELS: Record<string, string> = {
  user:             "Usuario",
  worksite:         "Faena",
  cost_center:      "Centro de costo",
  supplier:         "Proveedor",
  product:          "Producto",
  product_category: "Categoría",
  warehouse:        "Bodega",
}

const COLUMNS = [
  { key: "createdAt",  label: "Fecha/hora",  sortable: true  },
  { key: "userEmail",  label: "Usuario",     sortable: true  },
  { key: "action",     label: "Acción",      sortable: true, width: "w-28" },
  { key: "entityType", label: "Entidad",     sortable: true, width: "w-32" },
  { key: "entityCode", label: "Código/ID",   sortable: true  },
  { key: "reason",     label: "Motivo",      sortable: false },
]

export function AuditLog({ entries }: { entries: AuditRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={entries as unknown as Record<string, unknown>[]}
      searchKeys={["userEmail", "entityType", "entityCode", "action"]}
      pageSize={30}
      searchPlaceholder="Buscar usuario, entidad, código..."
      emptyTitle="Sin entradas de auditoría"
      emptyDescription="Las acciones del sistema aparecerán aquí."
      renderRow={(row) => {
        const e = row as unknown as AuditRow
        return (
          <TableRow key={e.id}>
            <TableCell className="text-xs font-mono text-[var(--color-text-muted)] whitespace-nowrap">
              {formatDateTime(e.createdAt)}
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-muted)]">
              {e.userEmail ?? <span className="text-[var(--color-text-subtle)]">Sistema</span>}
            </TableCell>
            <TableCell>
              <Badge variant={ACTION_VARIANTS[e.action] ?? "default"} size="sm">
                {e.action}
              </Badge>
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-muted)]">
              {ENTITY_LABELS[e.entityType] ?? e.entityType}
            </TableCell>
            <TableCell>
              {e.entityCode
                ? <span className="font-mono text-xs">{e.entityCode}</span>
                : <span className="text-xs font-mono text-[var(--color-text-subtle)] truncate max-w-[8rem] inline-block">{e.entityId.slice(0, 8)}…</span>
              }
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-muted)] max-w-xs">
              <span className="line-clamp-1">{e.reason ?? "—"}</span>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}
