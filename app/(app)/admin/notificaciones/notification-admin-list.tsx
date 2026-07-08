"use client"

import { useActionState, useEffect } from "react"
import { Trash, Calendar } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { cleanupReadNotificationsAction } from "./actions"
import * as React from "react"

export interface AdminNotificationView {
  id: string
  type: string
  title: string
  body: string
  isRead: boolean
  createdAt: string
  userEmail: string
  userName: string
  entityHref: string | null
}

const COLUMNS = [
  { key: "title", label: "Título", sortable: true },
  { key: "type", label: "Tipo", sortable: true, width: "w-32" },
  { key: "userEmail", label: "Usuario", sortable: true, width: "w-56" },
  { key: "isRead", label: "Estado", sortable: true, width: "w-28" },
  { key: "createdAt", label: "Fecha", sortable: true, width: "w-48" },
]

interface NotificationAdminListProps {
  rows: AdminNotificationView[]
  oldestReadDate: string | null
  retentionDays: number
}

export function NotificationAdminList({ rows, oldestReadDate, retentionDays }: NotificationAdminListProps) {
  const [state, formAction] = useActionState(cleanupReadNotificationsAction, INITIAL_STATE)

  useEffect(() => {
    if (state.message) {
      (state.ok ? toast.success : toast.error).call(null, state.message)
    }
  }, [state])

  const dataRows = rows as (AdminNotificationView & Record<string, unknown>)[]

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <Calendar size={14} />
          <span>
            Notificación leída más antigua:{" "}
            {oldestReadDate ? new Date(oldestReadDate).toLocaleString() : "—"}
          </span>
          <span>· Retención configurada: {retentionDays} días</span>
        </div>
        <form action={formAction}>
          <Button type="submit" variant="secondary" size="sm">
            <Trash size={14} />Purgar leídas antiguas ({retentionDays}d)
          </Button>
        </form>
      </div>
      <DataTable
        columns={COLUMNS}
        rows={dataRows}
        searchKeys={["title", "body", "userEmail", "type"]}
        pageSize={25}
        emptyTitle="Sin notificaciones"
        emptyDescription="El servicio no ha registrado notificaciones recientemente."
        renderRow={(row) => {
          const r = row as AdminNotificationView
          return (
            <React.Fragment key={r.id}>
              <TableRow>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{r.title}</span>
                    {r.body && (
                      <span className="text-xs text-[var(--color-text-muted)]">{r.body}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs">{r.type}</TableCell>
                <TableCell className="text-xs text-[var(--color-text-muted)]">
                  {r.userName && <span className="block">{r.userName}</span>}
                  <span>{r.userEmail}</span>
                </TableCell>
                <TableCell>
                  {r.isRead ? <Badge variant="success">Leída</Badge> : <Badge variant="warning">Sin leer</Badge>}
                </TableCell>
                <TableCell className="text-xs text-[var(--color-text-muted)]">
                  {new Date(r.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            </React.Fragment>
          )
        }}
      />
    </>
  )
}
