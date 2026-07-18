"use client"

import * as React from "react"
import { useActionState } from "react"
import { useEffect } from "react"
import { toast } from "@/lib/toast"
import { PencilSimple, ToggleLeft, ToggleRight, Trash } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { UserForm } from "./user-form"
import { UserInvitationsPanel, type InvitationRow } from "./user-invitations-panel"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate } from "@/lib/utils"
import { deleteUser } from "./actions/delete"
import { toggleUserActive } from "./actions/toggle-active"
import { INITIAL_STATE } from "@/components/admin/form-state"

interface Role    { id: string; name: string; label: string }
interface Permission {
  id: string
  name: string
  module: string
  description: string | null
  roleIds: string[]
}
interface Worksite { id: string; name: string; code: string }
interface WorkerOption {
  id: string
  name: string
  rut: string | null
  worksiteId: string
  worksiteName: string
  linkedUserId: string | null
}
interface UserRow {
  id:          string
  name:        string
  email:       string
  isActive:    boolean
  emailNotifications: boolean
  passwordSetupPending: boolean
  createdAt:   string
  avatarColor: string | null
  roleIds:     string[]
  roleLabels:  string[]
  permissionIds: string[]
  workerId: string | null
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[]
  worksiteCount: number
}

interface UserListProps {
  users:        UserRow[]
  invitations:  InvitationRow[]
  allRoles:     Role[]
  allPermissions: Permission[]
  allWorksites: Worksite[]
  allWorkers: WorkerOption[]
}

const COLUMNS = [
  { key: "name",      label: "Usuario",   sortable: true  },
  { key: "roleLabels",label: "Roles",     sortable: false, width: "max-w-[280px]" },
  { key: "worksiteCount", label: "Faenas",sortable: true, numeric: true, width: "w-20" },
  { key: "isActive",  label: "Estado",    sortable: true  },
  { key: "createdAt", label: "Alta",      sortable: true  },
  { key: "",          label: "",          sortable: false, width: "w-32" },
]

export function UserList({ users, invitations, allRoles, allPermissions, allWorksites, allWorkers }: UserListProps) {
  const [sheetOpen, setSheetOpen]   = React.useState(false)
  const [editUser,  setEditUser]    = React.useState<UserRow | null>(null)
  const [deleteUserConfirm, setDeleteUserConfirm] = React.useState<UserRow | null>(null)
  const [toggleState, toggleAction] = useActionState(toggleUserActive, INITIAL_STATE)
  const [deleteState, deleteAction] = useActionState(deleteUser, INITIAL_STATE)

  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  useEffect(() => {
    if (deleteState.message) {
      if (deleteState.ok) toast.success(deleteState.message)
      else toast.error(deleteState.message)
    }
  }, [deleteState])

  function openEdit(u: UserRow) { setEditUser(u); setSheetOpen(true) }

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={users as unknown as Record<string, unknown>[]}
        searchKeys={["name", "email"]}
        pageSize={25}

        emptyTitle="Sin usuarios"
        emptyDescription="Invita al equipo o crea usuarios manualmente."
        renderRow={(row) => {
          const u = row as unknown as UserRow
          return (
            <TableRow key={u.id}>
              {/* User */}
              <TableCell>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={u.name} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">{u.name}</p>
                    <p className="text-xs text-[var(--color-text-subtle)] truncate">{u.email}</p>
                  </div>
                </div>
              </TableCell>
              {/* Roles */}
              <TableCell>
                <div className="flex flex-wrap items-center gap-1 max-w-[280px]">
                  {u.roleLabels.slice(0, 3).map((label) => (
                    <Badge key={label} variant="default" size="sm">{label}</Badge>
                  ))}
                  {u.roleLabels.length > 3 && (
                    <span className="text-[10px] font-medium text-[var(--color-text-subtle)] whitespace-nowrap">
                      +{u.roleLabels.length - 3} más
                    </span>
                  )}
                </div>
              </TableCell>
              {/* Faenas count */}
              <TableCell className="font-mono text-xs text-right text-[var(--color-text-muted)]">
                {u.worksiteCount}
              </TableCell>
              {/* Status */}
              <TableCell>
                <Badge
                  variant={u.passwordSetupPending ? "warning" : u.isActive ? "success" : "default"}
                  dot
                  className="w-24 justify-center"
                >
                  {u.passwordSetupPending ? "Pendiente" : u.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              {/* Created */}
              <TableCell className="text-xs text-[var(--color-text-muted)]">
                {formatDate(u.createdAt)}
              </TableCell>
              {/* Actions */}
              <TableCell>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => openEdit(u)}
                    className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] "
                    title="Editar"
                    aria-label={`Editar usuario ${u.name}`}
                  >
                    <PencilSimple size={16} />
                  </button>
                  <form action={toggleAction}>
                    <input type="hidden" name="id"       value={u.id} />
                    <input type="hidden" name="activate" value={String(!u.isActive)} />
                    <button
                      type="submit"
                      className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] "
                      title={u.isActive ? "Desactivar" : "Activar"}
                      aria-label={`${u.isActive ? "Desactivar" : "Activar"} usuario ${u.name}`}
                    >
                      {u.isActive
                        ? <ToggleRight size={20} className="text-[var(--color-primary)]" />
                        : <ToggleLeft size={20} />
                      }
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => setDeleteUserConfirm(u)}
                    className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-danger)] hover:text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)] transition-colors duration-[var(--duration-fast)] "
                    title="Eliminar"
                    aria-label={`Eliminar usuario ${u.name}`}
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          )
        }}
        renderMobileCard={(row) => {
          const u = row as unknown as UserRow
          return (
            <article className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={u.name} size="sm" />
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium text-[var(--color-text)]">{u.name}</h2>
                    <p className="truncate text-xs text-[var(--color-text-subtle)]">{u.email}</p>
                  </div>
                </div>
                <Badge variant={u.passwordSetupPending ? "warning" : u.isActive ? "success" : "default"} dot>
                  {u.passwordSetupPending ? "Pendiente" : u.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1">
                {u.roleLabels.slice(0, 3).map((label) => (
                  <Badge key={label} variant="default" size="sm">{label}</Badge>
                ))}
                {u.roleLabels.length > 3 && (
                  <span className="text-[10px] font-medium text-[var(--color-text-subtle)] whitespace-nowrap">
                    +{u.roleLabels.length - 3} más
                  </span>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Faenas</dt>
                  <dd className="font-mono tabular-nums text-[var(--color-text)]">{u.worksiteCount}</dd>
                </div>
                <div className="text-right">
                  <dt className="text-[var(--color-text-subtle)]">Alta</dt>
                  <dd className="text-[var(--color-text-muted)]">{formatDate(u.createdAt)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-mobile"
                  onClick={() => openEdit(u)}
                  title="Editar"
                  aria-label={`Editar usuario ${u.name}`}
                >
                  <PencilSimple size={16} />
                </Button>
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="activate" value={String(!u.isActive)} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-mobile"
                    title={u.isActive ? "Desactivar" : "Activar"}
                    aria-label={`${u.isActive ? "Desactivar" : "Activar"} usuario ${u.name}`}
                  >
                    {u.isActive
                      ? <ToggleRight size={20} className="text-[var(--color-primary)]" />
                      : <ToggleLeft size={20} />
                    }
                  </Button>
                </form>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-mobile"
                  onClick={() => setDeleteUserConfirm(u)}
                  title="Eliminar"
                  aria-label={`Eliminar usuario ${u.name}`}
                  className="text-[var(--color-danger)] hover:text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)]"
                >
                  <Trash size={16} />
                </Button>
              </div>
            </article>
          )
        }}
      />

      <ConfirmDialog
        open={deleteUserConfirm !== null}
        onOpenChange={(open) => { if (!open) setDeleteUserConfirm(null) }}
        title={`¿Eliminar usuario ${deleteUserConfirm?.name ?? ""}?`}
        description="Esta acción no se puede deshacer. El usuario perderá acceso al sistema."
        confirmLabel="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (!deleteUserConfirm) return
          const fd = new FormData()
          fd.set("id", deleteUserConfirm.id)
          deleteAction(fd)
          setDeleteUserConfirm(null)
        }}
      />

      <UserInvitationsPanel invitations={invitations} />

      <UserForm
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editUser={editUser}
        allRoles={allRoles}
        allPermissions={allPermissions}
        allWorksites={allWorksites}
        allWorkers={allWorkers}
      />
    </>
  )
}
