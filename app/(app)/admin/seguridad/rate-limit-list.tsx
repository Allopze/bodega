"use client"

import * as React from "react"
import { formatDateTime } from "@/lib/utils"
import { useActionState, useEffect } from "react"
import { LockOpen, Trash } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { clearRateLimitKeyAction, pruneRateLimitLocksAction } from "./actions"

export interface RateLimitRow {
  key: string
  count: number
  successCount: number
  lockUntil: number
  updatedAt: string
}

const COLUMNS = [
  { key: "key", label: "Clave", sortable: true, width: "w-72" },
  { key: "count", label: "Fallos", sortable: true, numeric: true, width: "w-24" },
  { key: "successCount", label: "OK", sortable: true, numeric: true, width: "w-24" },
  { key: "lockStatus", label: "Bloqueo", sortable: true, width: "w-32" },
  { key: "updatedAt", label: "Última actualización", sortable: true, width: "w-48" },
  { key: "", label: "", sortable: false, width: "w-32" },
]

interface RateLimitListProps {
  rows: RateLimitRow[]
  total: number
}

function lockStatus(lockUntil: number): { label: string; variant: "default" | "success" | "danger" | "warning" } {
  if (lockUntil > Date.now()) return { label: "Bloqueado", variant: "danger" }
  if (lockUntil > 0) return { label: "Expirado", variant: "warning" }
  return { label: "Activo", variant: "success" }
}

function formatLockUntil(lockUntil: number): string {
  if (!lockUntil || lockUntil <= 0) return "—"
  const d = new Date(lockUntil)
  if (d.getTime() <= Date.now()) return `Expirado · ${formatDateTime(d)}`
  return formatDateTime(d)
}

export function RateLimitList({ rows, total }: RateLimitListProps) {
  const [clearState, clearAction] = useActionState<ActionState, FormData>(clearRateLimitKeyAction, INITIAL_STATE)
  const [pruneState, pruneAction] = useActionState<ActionState, FormData>(pruneRateLimitLocksAction, INITIAL_STATE)

  useEffect(() => {
    if (clearState.message) {
      (clearState.ok ? toast.success : toast.error).call(null, clearState.message)
    }
  }, [clearState])
  useEffect(() => {
    if (pruneState.message) {
      (pruneState.ok ? toast.success : toast.error).call(null, pruneState.message)
    }
  }, [pruneState])

  const dataRows = rows as (RateLimitRow & Record<string, unknown>)[]

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-text-muted)]">
          {total === 0
            ? "No hay claves registradas."
            : `Mostrando ${rows.length} de ${total} registros.`}
        </p>
        <form action={pruneAction}>
          <Button type="submit" variant="secondary" size="sm">
            <Trash size={14} />Purgar bloqueos expirados
          </Button>
        </form>
      </div>
      <DataTable
        caption="Claves con Bloqueo por Rate Limit"
        columns={COLUMNS}
        rows={dataRows}
        searchKeys={["key"]}
        pageSize={20}
        emptyTitle="Sin claves registradas"
        emptyDescription="Las claves aparecen aquí cuando alguien supera los intentos permitidos."
        renderMobileCard={(row) => {
          const r = row as RateLimitRow
          const status = lockStatus(r.lockUntil)
          return (
            <ResponsiveDataListCard
              title={<span className="font-mono">{r.key}</span>}
              status={<Badge variant={status.variant}>{status.label}</Badge>}
              actions={
                <form action={clearAction}>
                  <input type="hidden" name="key" value={r.key} />
                  <Button type="submit" variant="ghost" size="sm">
                    <LockOpen size={14} />Liberar
                  </Button>
                </form>
              }
            >
              <ResponsiveDataListField label="Fallos">
                <span className="font-mono tabular-nums text-[var(--color-text)]">{r.count}</span>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Intentos correctos">
                <span className="font-mono tabular-nums text-[var(--color-text)]">{r.successCount}</span>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Bloqueo">
                {formatLockUntil(r.lockUntil)}
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Actualización">
                {r.updatedAt ? formatDateTime(r.updatedAt) : "—"}
              </ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(row) => {
          const r = row as RateLimitRow
          const status = lockStatus(r.lockUntil)
          return (
            <React.Fragment key={r.key}>
              <TableRow>
                <TableCell className="font-mono text-xs">{r.key}</TableCell>
                <TableCell className="text-right">{r.count}</TableCell>
                <TableCell className="text-right text-[var(--color-text-muted)]">{r.successCount}</TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell className="text-xs text-[var(--color-text-muted)]">
                  {formatLockUntil(r.lockUntil)}
                  <div>{r.updatedAt ? formatDateTime(r.updatedAt) : "—"}</div>
                </TableCell>
                <TableCell>
                  <form action={clearAction}>
                    <input type="hidden" name="key" value={r.key} />
                    <Button type="submit" variant="ghost" size="sm">
                      <LockOpen size={14} />Liberar
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            </React.Fragment>
          )
        }}
      />
    </>
  )
}

// (no additional export required)
