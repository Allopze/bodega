"use client"

import * as React from "react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDateTime } from "@/lib/utils"

type AuditRow = {
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
  billing_chipax_settings: "Configuración Chipax",
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
      caption="Log de Auditoría"
      columns={COLUMNS}
      rows={entries}
      searchKeys={["userEmail", "entityType", "entityCode", "action"]}
      pageSize={30}

      emptyTitle="Sin entradas de auditoría"
      emptyDescription="Las acciones del sistema aparecerán aquí."
      renderMobileCard={(e) => {
        return (
          <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge variant={ACTION_VARIANTS[e.action] ?? "default"} size="sm">
                  {e.action}
                </Badge>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {ENTITY_LABELS[e.entityType] ?? e.entityType}
                </p>
              </div>
              <p className="text-xs font-mono text-[var(--color-text-subtle)] whitespace-nowrap">
                {formatDateTime(e.createdAt)}
              </p>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--color-text-subtle)]">Usuario</dt>
                <dd className="text-[var(--color-text-muted)] truncate">{e.userEmail ?? "Sistema"}</dd>
              </div>
              <div className="text-right">
                <dt className="text-[var(--color-text-subtle)]">Código/ID</dt>
                <dd className="font-mono text-[var(--color-text-muted)] truncate">
                  {e.entityCode ?? e.entityId.slice(0, 8) + "…"}
                </dd>
              </div>
            </dl>

            {e.reason && (
              <p className="mt-2 text-xs text-[var(--color-text-subtle)] line-clamp-2 border-t border-[var(--color-border)] pt-2">
                {e.reason}
              </p>
            )}
          </article>
        )
      }}
      renderRow={(e) => {
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
