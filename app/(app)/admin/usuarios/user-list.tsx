"use client"

import * as React from "react"
import { useActionState } from "react"
import { useEffect } from "react"
import { toast } from "sonner"
import { Plus, PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { UserForm } from "./user-form"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { toggleUserActive } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

interface Role    { id: string; name: string; label: string }
interface Worksite { id: string; name: string; code: string }
interface UserRow {
  id:          string
  name:        string
  email:       string
  isActive:    boolean
  createdAt:   string
  avatarColor: string | null
  roleIds:     string[]
  roleLabels:  string[]
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[]
  worksiteCount: number
}

interface UserListProps {
  users:        UserRow[]
  allRoles:     Role[]
  allWorksites: Worksite[]
}

const COLUMNS = [
  { key: "name",      label: "Usuario",   sortable: true  },
  { key: "roleLabels",label: "Roles",     sortable: false },
  { key: "worksiteCount", label: "Faenas",sortable: true, numeric: true, width: "w-20" },
  { key: "isActive",  label: "Estado",    sortable: true  },
  { key: "createdAt", label: "Alta",      sortable: true  },
  { key: "",          label: "",          sortable: false, width: "w-24" },
]

export function UserList({ users, allRoles, allWorksites }: UserListProps) {
  const [sheetOpen, setSheetOpen]   = React.useState(false)
  const [editUser,  setEditUser]    = React.useState<UserRow | null>(null)
  const [toggleState, toggleAction] = useActionState(toggleUserActive, INITIAL_STATE)

  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  function openCreate() { setEditUser(null); setSheetOpen(true) }
  function openEdit(u: UserRow) { setEditUser(u); setSheetOpen(true) }

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={users as unknown as Record<string, unknown>[]}
        searchKeys={["name", "email"]}
        pageSize={25}
        searchPlaceholder="Buscar usuario o correo..."
        emptyTitle="Sin usuarios"
        emptyDescription="Crea el primer usuario para comenzar."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo usuario</Button>}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />Nuevo usuario
          </Button>
        }
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
                <div className="flex flex-wrap gap-1">
                  {u.roleLabels.map((label) => (
                    <Badge key={label} variant="default" size="sm">{label}</Badge>
                  ))}
                </div>
              </TableCell>
              {/* Faenas count */}
              <TableCell className="font-mono text-xs text-right text-[var(--color-text-muted)]">
                {u.worksiteCount}
              </TableCell>
              {/* Status */}
              <TableCell>
                <Badge variant={u.isActive ? "success" : "default"} dot>
                  {u.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              {/* Created */}
              <TableCell className="text-xs text-[var(--color-text-muted)]">
                {formatDate(u.createdAt)}
              </TableCell>
              {/* Actions */}
              <TableCell>
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => openEdit(u)}
                    className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]"
                    title="Editar"
                  >
                    <PencilSimple size={14} />
                  </button>
                  <form action={toggleAction}>
                    <input type="hidden" name="id"       value={u.id} />
                    <input type="hidden" name="activate" value={String(!u.isActive)} />
                    <button
                      type="submit"
                      className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]"
                      title={u.isActive ? "Desactivar" : "Activar"}
                    >
                      {u.isActive
                        ? <ToggleRight size={14} className="text-[var(--color-primary)]" />
                        : <ToggleLeft size={14} />
                      }
                    </button>
                  </form>
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />

      <UserForm
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editUser={editUser}
        allRoles={allRoles}
        allWorksites={allWorksites}
      />
    </>
  )
}
