"use client"

import * as React from "react"
import { useActionState } from "react"
import { useEffect } from "react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { createUser, updateUser } from "./actions"

interface Role    { id: string; name: string; label: string }
interface Worksite { id: string; name: string; code: string }

interface UserForEdit {
  id:         string
  name:       string
  email:      string
  isActive:   boolean
  roleIds:    string[]
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[]
}

interface UserFormProps {
  open:       boolean
  onClose:    () => void
  editUser?:  UserForEdit | null
  allRoles:   Role[]
  allWorksites: Worksite[]
}

export function UserForm({ open, onClose, editUser, allRoles, allWorksites }: UserFormProps) {
  const isEdit = !!editUser

  const action = isEdit ? updateUser : createUser
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)

  // Toast + close on success
  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Usuario actualizado" : "Usuario creado"))
      onClose()
    } else if (state.message && !state.ok && state.message !== "") {
      // Top-level error without field errors
      if (!state.fieldErrors) toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // Default selected roles/worksites
  const defaultRoles    = editUser?.roleIds ?? []
  const defaultWsIds    = editUser?.worksiteAssignments.map((a) => a.worksiteId) ?? []
  const defaultPrimary  = editUser?.worksiteAssignments.find((a) => a.isPrimary)?.worksiteId
    ?? editUser?.worksiteAssignments[0]?.worksiteId ?? ""

  const [selectedRoles,    setSelectedRoles]    = React.useState<string[]>(defaultRoles)
  const [selectedWsIds,    setSelectedWsIds]    = React.useState<string[]>(defaultWsIds)
  const [primaryWorksiteId, setPrimaryWorksiteId] = React.useState<string>(defaultPrimary)

  // Reset state when form opens for a different user
  useEffect(() => {
    setSelectedRoles(editUser?.roleIds ?? [])
    setSelectedWsIds(editUser?.worksiteAssignments.map((a) => a.worksiteId) ?? [])
    setPrimaryWorksiteId(
      editUser?.worksiteAssignments.find((a) => a.isPrimary)?.worksiteId
        ?? editUser?.worksiteAssignments[0]?.worksiteId ?? ""
    )
  }, [editUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleRole(id: string) {
    setSelectedRoles((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    )
  }

  function toggleWorksite(id: string) {
    setSelectedWsIds((prev) => {
      const next = prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]
      if (!next.includes(primaryWorksiteId)) setPrimaryWorksiteId(next[0] ?? "")
      return next
    })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction}>
          {isEdit && <input type="hidden" name="id" value={editUser.id} />}
          {/* Hidden inputs for roles and worksite assignments */}
          {selectedRoles.map((rid) => (
            <input key={rid} type="hidden" name="roleIds" value={rid} />
          ))}
          {selectedWsIds.map((wsId) => (
            <input key={wsId} type="hidden" name="worksiteId" value={wsId} />
          ))}
          {primaryWorksiteId && (
            <input type="hidden" name="primaryWorksiteId" value={primaryWorksiteId} />
          )}

          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar usuario" : "Nuevo usuario"}</SheetTitle>
              <SheetDescription>
                {isEdit ? `Modificar datos de ${editUser.name}` : "Completa los datos del nuevo usuario"}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {/* Top-level error */}
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}

            <FieldGroup className="gap-4">
              <Field label="Nombre completo" htmlFor="name" required error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="name" name="name"
                  defaultValue={editUser?.name ?? ""}
                  placeholder="Nombre Apellido"
                  error={!!state.fieldErrors?.name}
                  autoComplete="off"
                />
              </Field>

              <Field label="Correo electrónico" htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
                <Input
                  id="email" name="email" type="email"
                  defaultValue={editUser?.email ?? ""}
                  placeholder="usuario@chome.cl"
                  error={!!state.fieldErrors?.email}
                  autoComplete="off"
                />
              </Field>

              <Field
                label={isEdit ? "Nueva contraseña" : "Contraseña"}
                htmlFor="password"
                required={!isEdit}
                helper={isEdit ? "Dejar en blanco para mantener la contraseña actual" : undefined}
                error={state.fieldErrors?.password?.[0]}
              >
                <Input
                  id="password" name="password" type="password"
                  placeholder={isEdit ? "••••••••" : "Mínimo 6 caracteres"}
                  error={!!state.fieldErrors?.password}
                  autoComplete="new-password"
                />
              </Field>

              {/* Active toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  name="isActive"
                  value="on"
                  defaultChecked={editUser?.isActive ?? true}
                  className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--color-border)] text-[var(--color-primary)] accent-[var(--color-primary)]"
                />
                <label htmlFor="isActive" className="text-sm text-[var(--color-text)]">
                  Usuario activo
                </label>
              </div>
            </FieldGroup>

            {/* Roles */}
            <div className="mt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)] mb-2">
                Roles
              </p>
              {state.fieldErrors?.roleIds?.[0] && (
                <p className="text-xs text-[var(--color-danger)] mb-2">{state.fieldErrors.roleIds[0]}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {allRoles.map((role) => {
                  const checked = selectedRoles.includes(role.id)
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      className={
                        [
                          "px-3 py-1 text-xs rounded-[var(--radius)] border",
                          "transition-[background-color,border-color,color] duration-[var(--duration-fast)]",
                          "active:scale-[0.97]",
                          checked
                            ? "bg-[var(--color-primary-50)] border-[var(--color-primary-100)] text-[var(--color-primary-700)] font-medium"
                            : "bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-muted)]",
                        ].join(" ")
                      }
                    >
                      {role.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Faenas */}
            <div className="mt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)] mb-2">
                Faenas asignadas
              </p>
              {state.fieldErrors?.worksiteAssignments?.[0] && (
                <p className="text-xs text-[var(--color-danger)] mb-2">
                  {state.fieldErrors.worksiteAssignments[0]}
                </p>
              )}
              {allWorksites.length === 0 && (
                <p className="text-xs text-[var(--color-text-subtle)]">No hay faenas registradas</p>
              )}
              <div className="flex flex-col gap-1">
                {allWorksites.map((ws) => {
                  const isChecked = selectedWsIds.includes(ws.id)
                  const isPrimary = primaryWorksiteId === ws.id && isChecked
                  return (
                    <label key={ws.id} className="flex items-center gap-3 py-1.5 px-2 rounded-[var(--radius)] hover:bg-[var(--color-surface-2)] cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleWorksite(ws.id)}
                        className="h-4 w-4 accent-[var(--color-primary)] shrink-0"
                      />
                      <span className="flex-1 text-sm text-[var(--color-text)]">
                        {ws.name}
                        <span className="ml-1.5 font-mono text-xs text-[var(--color-text-subtle)]">{ws.code}</span>
                      </span>
                      {isChecked && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setPrimaryWorksiteId(ws.id) }}
                          className={[
                            "text-xs px-2 py-0.5 rounded-[var(--radius-sm)] border",
                            "transition-colors duration-[var(--duration-fast)]",
                            isPrimary
                              ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                              : "bg-transparent text-[var(--color-text-subtle)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]",
                          ].join(" ")}
                        >
                          {isPrimary ? "Principal" : "Marcar principal"}
                        </button>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <SubmitButton
              label={isEdit ? "Guardar cambios" : "Crear usuario"}
              loadingLabel={isEdit ? "Guardando..." : "Creando..."}
            />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
