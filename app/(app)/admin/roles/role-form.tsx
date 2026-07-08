"use client"

import * as React from "react"
import { useActionState } from "react"
import { Warning } from "@phosphor-icons/react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { toast } from "@/lib/toast"
import { saveRoleAction } from "./actions"

export interface RoleRow {
  id: string
  name: string
  label: string
  description: string
  isGlobal: boolean
  isProtected: boolean
  permissionCount: number
  permissionIds: string[]
}

export interface PermissionOption {
  id: string
  name: string
  module: string
  description: string
}

export interface GroupedPermission {
  module: string
  permissions: PermissionOption[]
}

const MODULE_LABELS: Record<string, string> = {
  admin: "Administración",
  approvals: "Aprobaciones",
  purchasing: "Compras",
  receiving: "Recepción",
  reports: "Reportes",
  requests: "Solicitudes",
  warehouse: "Bodega",
  combustibles: "Combustibles",
  flota: "Flota",
  mantenciones: "Mantenciones",
  prevention: "Prevención",
  sst: "SST",
  pdtp: "PDTP",
}

function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module
}

interface RoleFormProps {
  open: boolean
  onClose: () => void
  editRole?: RoleRow | null
  groupedPermissions: GroupedPermission[]
  permissions: PermissionOption[]
}

export function RoleForm({ open, onClose, editRole, groupedPermissions }: RoleFormProps) {
  const isEdit = !!editRole
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(editRole?.permissionIds ?? []))

  React.useEffect(() => {
    setSelected(new Set(editRole?.permissionIds ?? []))
  }, [editRole])

  function togglePermission(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleModule(group: GroupedPermission) {
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = group.permissions.every((p) => next.has(p.id))
      for (const p of group.permissions) {
        if (allSelected) next.delete(p.id)
        else next.add(p.id)
      }
      return next
    })
  }

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      formData.set("permissionIds", Array.from(selected).join(","))
      const result = await saveRoleAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? (isEdit ? "Rol actualizado" : "Rol creado"))
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="sm:max-w-2xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {isEdit && <input type="hidden" name="id" value={editRole!.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar rol" : "Nuevo rol"}</SheetTitle>
              <SheetDescription>
                Define el nombre, el alcance y los permisos incluidos en este rol.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            {editRole?.isProtected && (
              <div className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint, var(--color-surface-2))] p-3 text-xs text-[var(--color-text)]">
                <Warning size={16} className="mt-0.5 shrink-0 text-[var(--color-warning)]" aria-hidden />
                <span>
                  Este rol está protegido. Conserva al menos un permiso; los cambios se aplican a todos los usuarios asignados.
                </span>
              </div>
            )}
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Nombre / slug" htmlFor="role-name" required error={state.fieldErrors?.name?.[0]} helper="Se usa como identificador interno (ej: jefe_bodega).">
                  <Input
                    id="role-name"
                    name="name"
                    defaultValue={editRole?.name ?? ""}
                    error={!!state.fieldErrors?.name}
                    disabled={editRole?.isProtected}
                  />
                </Field>
                <Field label="Etiqueta" htmlFor="role-label" required error={state.fieldErrors?.label?.[0]}>
                  <Input
                    id="role-label"
                    name="label"
                    defaultValue={editRole?.label ?? ""}
                    error={!!state.fieldErrors?.label}
                  />
                </Field>
              </div>
              <Field label="Descripción (opcional)" htmlFor="role-desc" error={state.fieldErrors?.description?.[0]}>
                <Input
                  id="role-desc"
                  name="description"
                  defaultValue={editRole?.description ?? ""}
                  error={!!state.fieldErrors?.description}
                />
              </Field>
              <Checkbox
                id="role-global"
                name="isGlobal"
                value="on"
                defaultChecked={editRole?.isGlobal ?? false}
                label="Rol global (acceso a todas las faenas)"
              />

              <div className="mt-2">
                <p className="text-eyebrow mb-2">Permisos incluidos</p>
                <div className="max-h-72 space-y-3 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  {groupedPermissions.map((group) => {
                    const allOn = group.permissions.every((p) => selected.has(p.id))
                    return (
                      <div key={group.module}>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
                            {moduleLabel(group.module)}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleModule(group)}
                            className="text-[11px] text-[var(--color-primary)] hover:underline"
                          >
                            {allOn ? "Quuitar todos" : "Seleccionar todos"}
                          </button>
                        </div>
                        <ul className="space-y-1">
                          {group.permissions.map((p) => {
                            const checked = selected.has(p.id)
                            return (
                              <li key={p.id}>
                                <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-[var(--color-surface)]">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePermission(p.id)}
                                    className="mt-0.5"
                                  />
                                  <span className="min-w-0">
                                    <span className="block text-xs font-medium text-[var(--color-text)]">{p.name}</span>
                                    <span className="block text-[11px] text-[var(--color-text-muted)]">{p.description}</span>
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </div>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear rol"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
