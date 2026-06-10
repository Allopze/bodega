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
import { Checkbox } from "@/components/ui/checkbox"
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

interface UserSelectionState {
  selectedRoles:     string[]
  selectedWsIds:     string[]
  primaryWorksiteId: string
}

type UserSelectionAction =
  | { type: "reset"; user?: UserForEdit | null }
  | { type: "toggle-role"; id: string }
  | { type: "toggle-worksite"; id: string }
  | { type: "set-primary"; id: string }

function getUserSelection(user?: UserForEdit | null): UserSelectionState {
  const selectedWsIds = user?.worksiteAssignments.map((a) => a.worksiteId) ?? []
  return {
    selectedRoles:     user?.roleIds ?? [],
    selectedWsIds,
    primaryWorksiteId: user?.worksiteAssignments.find((a) => a.isPrimary)?.worksiteId
      ?? selectedWsIds[0] ?? "",
  }
}

function userSelectionReducer(state: UserSelectionState, action: UserSelectionAction): UserSelectionState {
  switch (action.type) {
    case "reset":
      return getUserSelection(action.user)
    case "toggle-role": {
      const selectedRoles = state.selectedRoles.includes(action.id)
        ? state.selectedRoles.filter((roleId) => roleId !== action.id)
        : [...state.selectedRoles, action.id]
      return { ...state, selectedRoles }
    }
    case "toggle-worksite": {
      const selectedWsIds = state.selectedWsIds.includes(action.id)
        ? state.selectedWsIds.filter((worksiteId) => worksiteId !== action.id)
        : [...state.selectedWsIds, action.id]
      const primaryWorksiteId = selectedWsIds.includes(state.primaryWorksiteId)
        ? state.primaryWorksiteId
        : selectedWsIds[0] ?? ""
      return { ...state, selectedWsIds, primaryWorksiteId }
    }
    case "set-primary":
      return { ...state, primaryWorksiteId: action.id }
  }
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

  const [selection, updateSelection] = React.useReducer(
    userSelectionReducer,
    editUser,
    getUserSelection,
  )

  // Reset state when form opens for a different user
  useEffect(() => {
    updateSelection({ type: "reset", user: editUser })
  }, [editUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleRole(id: string) {
    updateSelection({ type: "toggle-role", id })
  }

  function toggleWorksite(id: string) {
    updateSelection({ type: "toggle-worksite", id })
  }

  const { selectedRoles, selectedWsIds, primaryWorksiteId } = selection

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
                  placeholder={isEdit ? "••••••••" : "Mínimo 8 caracteres"}
                  error={!!state.fieldErrors?.password}
                  autoComplete="new-password"
                />
              </Field>

              {/* Active toggle */}
              <Checkbox id="isActive" name="isActive" value="on" defaultChecked={editUser?.isActive ?? true} label="Usuario activo" />
            </FieldGroup>

            {/* Roles */}
            <div className="mt-5">
              <p className="text-eyebrow mb-2">
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
                            ? "bg-[var(--color-primary-tint)] border-[var(--color-primary-line)] text-[var(--color-primary-ink)] font-medium"
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
              <p className="text-eyebrow mb-2">
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
                          onClick={(e) => {
                            e.preventDefault()
                            updateSelection({ type: "set-primary", id: ws.id })
                          }}
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
