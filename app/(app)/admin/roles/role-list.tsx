"use client"

import * as React from "react"
import { PencilSimple } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { RoleForm, type RoleRow, type PermissionOption } from "./role-form"

const ROLE_COLUMNS = [
  { key: "label", label: "Rol", sortable: true },
  { key: "name", label: "Slug", sortable: true, width: "w-44" },
  { key: "scope", label: "Alcance", sortable: true, width: "w-32" },
  { key: "permissionCount", label: "Permisos", sortable: true, numeric: true, width: "w-28" },
  { key: "", label: "", sortable: false, width: "w-20" },
]

export interface GroupedPermission {
  module: string
  permissions: PermissionOption[]
}

interface RoleListProps {
  roles: RoleRow[]
  groupedPermissions: GroupedPermission[]
  permissions: PermissionOption[]
}

export function RoleList({ roles, groupedPermissions, permissions }: RoleListProps) {
  const [open, setOpen] = React.useState(false)
  const [editRole, setEditRole] = React.useState<RoleRow | null>(null)

  function openEdit(role: RoleRow) {
    setEditRole(role)
    setOpen(true)
  }

  const rows = roles as (RoleRow & Record<string, unknown>)[]

  return (
    <>
      <DataTable
        columns={ROLE_COLUMNS}
        rows={rows}
        searchKeys={["label", "name", "description"]}
        pageSize={20}
        emptyTitle="Sin roles"
        emptyDescription="Crea un rol base para agrupar permisos reutilizables."
        renderRow={(row) => {
          const r = row as RoleRow
          return (
            <React.Fragment key={r.id}>
              <TableRow>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{r.label}</span>
                    {r.description && (
                      <span className="text-xs text-[var(--color-text-muted)]">{r.description}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-[var(--color-text-muted)]">
                    {r.name}{r.isProtected ? " 🔒" : ""}
                  </span>
                </TableCell>
                <TableCell>
                  {r.isGlobal
                    ? <Badge variant="info">Global</Badge>
                    : <Badge variant="default">Faena</Badge>}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{r.permissionCount}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="rounded p-1.5 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    aria-label={`Editar ${r.label}`}
                  >
                    <PencilSimple size={15} />
                  </button>
                </TableCell>
              </TableRow>
            </React.Fragment>
          )
        }}
      />
      <RoleForm
        key={editRole?.id ?? "nuevo"}
        open={open}
        onClose={() => setOpen(false)}
        editRole={editRole}
        groupedPermissions={groupedPermissions}
        permissions={permissions}
      />
    </>
  )
}
