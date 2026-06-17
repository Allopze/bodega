"use client"

import * as React from "react"
import { useActionState } from "react"
import { useEffect } from "react"
import { toast } from "@/lib/toast"
import { Check, Copy, Envelope, Lock } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { createUser, updateUser } from "./actions"

interface Role    { id: string; name: string; label: string }
interface Permission {
  id: string
  name: string
  module: string
  description: string | null
  roleIds: string[]
}
interface Worksite { id: string; name: string; code: string }
interface Worker { id: string; firstName: string; lastName: string; rut: string | null; worksiteId: string }

interface UserForEdit {
  id:         string
  name:       string
  email:      string
  isActive:   boolean
  workerId:   string | null
  roleIds:    string[]
  permissionIds: string[]
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[]
}

interface UserFormProps {
  open:       boolean
  onClose:    () => void
  editUser?:  UserForEdit | null
  allRoles:   Role[]
  allPermissions: Permission[]
  allWorksites: Worksite[]
  allWorkers: Worker[]
}

interface UserSelectionState {
  selectedRoles:     string[]
  selectedPermissions: string[]
  selectedWsIds:     string[]
  primaryWorksiteId: string
}

interface PendingInvite {
  email:     string
  inviteUrl: string
}

type UserSelectionAction =
  | { type: "reset"; user?: UserForEdit | null }
  | { type: "toggle-role"; id: string }
  | { type: "toggle-permission"; id: string }
  | { type: "set-permissions"; ids: string[] }
  | { type: "toggle-worksite"; id: string }
  | { type: "set-primary"; id: string }

function getUserSelection(user?: UserForEdit | null): UserSelectionState {
  const selectedWsIds = user?.worksiteAssignments.map((a) => a.worksiteId) ?? []
  return {
    selectedRoles:     user?.roleIds ?? [],
    selectedPermissions: user?.permissionIds ?? [],
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
    case "toggle-permission": {
      const selectedPermissions = state.selectedPermissions.includes(action.id)
        ? state.selectedPermissions.filter((permissionId) => permissionId !== action.id)
        : [...state.selectedPermissions, action.id]
      return { ...state, selectedPermissions }
    }
    case "set-permissions":
      return { ...state, selectedPermissions: action.ids }
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

const MODULE_LABELS: Record<string, string> = {
  admin: "Administración",
  approvals: "Aprobaciones",
  purchasing: "Compras",
  receiving: "Recepción",
  reports: "Reportes",
  requests: "Solicitudes",
  warehouse: "Bodega",
}

function getModuleLabel(module: string) {
  return MODULE_LABELS[module] ?? module
}

function groupPermissions(permissions: Permission[]) {
  return permissions.reduce<Array<{ module: string; permissions: Permission[] }>>((groups, permission) => {
    const group = groups.find((item) => item.module === permission.module)
    if (group) group.permissions.push(permission)
    else groups.push({ module: permission.module, permissions: [permission] })
    return groups
  }, [])
}

export function UserForm({ open, onClose, editUser, allRoles, allPermissions, allWorksites, allWorkers }: UserFormProps) {
  const isEdit = !!editUser

  const action = isEdit ? updateUser : createUser
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)
  const lastSeenStateRef = React.useRef<ActionState>(INITIAL_STATE)
  const [pending, setPending] = React.useState<PendingInvite | null>(null)
  const [copied, setCopied] = React.useState(false)

  // Toast + close on success
  useEffect(() => {
    if (state === lastSeenStateRef.current) return
    lastSeenStateRef.current = state
    if (state.ok) {
      toast.success(state.message ?? (isEdit ? "Usuario actualizado" : "Usuario creado"))
      const data = state.data as { email?: string; inviteUrl?: string } | undefined
      if (!isEdit && data?.inviteUrl) {
        setPending({ email: data.email ?? "", inviteUrl: data.inviteUrl })
      } else {
        onClose()
      }
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

  function togglePermission(id: string) {
    updateSelection({ type: "toggle-permission", id })
  }

  function toggleAllInModule(group: { module: string; permissions: Permission[] }) {
    const toggleableIds = group.permissions
      .filter((p) => !p.roleIds.some((roleId) => selectedRoles.includes(roleId)))
      .map((p) => p.id)
    const allSelected = toggleableIds.every((id) => selectedPermissions.includes(id))
    const next = allSelected
      ? selectedPermissions.filter((id) => !toggleableIds.includes(id))
      : [...new Set([...selectedPermissions, ...toggleableIds])]
    updateSelection({ type: "set-permissions", ids: next })
  }

  function toggleWorksite(id: string) {
    updateSelection({ type: "toggle-worksite", id })
  }

  async function copyInvite() {
    if (!pending) return
    try {
      await navigator.clipboard.writeText(pending.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("No se pudo copiar al portapapeles")
    }
  }

  const { selectedRoles, selectedPermissions, selectedWsIds, primaryWorksiteId } = selection
  const groupedPermissions = React.useMemo(() => groupPermissions(allPermissions), [allPermissions])
  const directPermissionLabel = `${selectedPermissions.length} ${
    selectedPermissions.length === 1 ? "permiso directo" : "permisos directos"
  }`
  const activeModules = React.useMemo(() => {
    const modules = new Set<string>()
    for (const p of allPermissions) {
      const inherited = p.roleIds.some((rid) => selectedRoles.includes(rid))
      const direct = selectedPermissions.includes(p.id)
      if (inherited || direct) modules.add(p.module)
    }
    return [...modules]
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  }, [allPermissions, selectedRoles, selectedPermissions])

  return (
    <Sheet open={open} onOpenChange={(v) => {
      if (!v) {
        setPending(null)
        setCopied(false)
        onClose()
      }
    }}>
      <SheetContent className="sm:max-w-2xl">
        {pending ? (
          <>
            <SheetHeader>
              <div>
                <SheetTitle>Invitación pendiente</SheetTitle>
                <SheetDescription>
                  SMTP no está configurado. Comparte este enlace con {pending.email || "el usuario"} por un canal seguro.
                </SheetDescription>
              </div>
              <SheetCloseButton onClick={() => { setPending(null); setCopied(false); onClose() }} />
            </SheetHeader>

            <SheetBody>
              <div
                role="status"
                aria-live="polite"
                className="rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-4"
              >
                <div className="flex items-start gap-2">
                  <Envelope size={16} weight="bold" className="mt-0.5 text-[var(--color-warning)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text)]">
                      Enlace para crear contraseña
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Caduca automáticamente. No lo pegues en canales públicos.
                    </p>
                    <div className="mt-3 flex items-stretch gap-2">
                      <code className="flex-1 break-all rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs font-mono text-[var(--color-text)]">
                        {pending.inviteUrl}
                      </code>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={copyInvite}
                        aria-label="Copiar enlace al portapapeles"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? "Copiado" : "Copiar"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </SheetBody>

            <SheetFooter>
              <Button
                type="button"
                variant="primary"
                onClick={() => { setPending(null); setCopied(false) }}
              >
                Crear otro usuario
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setPending(null); setCopied(false); onClose() }}
              >
                Cerrar
              </Button>
            </SheetFooter>
          </>
        ) : (
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          {isEdit && <input type="hidden" name="id" value={editUser.id} />}
          {/* Hidden inputs for roles and worksite assignments */}
          {selectedRoles.map((rid) => (
            <input key={rid} type="hidden" name="roleIds" value={rid} />
          ))}
          {selectedPermissions.map((pid) => (
            <input key={pid} type="hidden" name="permissionIds" value={pid} />
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
                {isEdit ? `Modificar datos de ${editUser.name}` : "Crea el acceso; el usuario definirá su contraseña."}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="min-h-0">
            {/* Top-level error */}
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}

            <FieldGroup className="gap-4">
              {isEdit && (
                <Field label="Nombre completo" htmlFor="name" required error={state.fieldErrors?.name?.[0]}>
                  <Input
                    id="name" name="name"
                    defaultValue={editUser?.name ?? ""}
                    placeholder="Nombre Apellido"
                    error={!!state.fieldErrors?.name}
                    autoComplete="off"
                  />
                </Field>
              )}

              <Field label="Correo electrónico" htmlFor="email" required error={state.fieldErrors?.email?.[0]}>
                <Input
                  id="email" name="email" type="email"
                  defaultValue={editUser?.email ?? ""}
                  placeholder="usuario@chome.cl"
                  error={!!state.fieldErrors?.email}
                  autoComplete="off"
                />
              </Field>

              {/* Active toggle */}
              <Checkbox id="isActive" name="isActive" value="on" defaultChecked={editUser?.isActive ?? true} label="Usuario activo" />

              {/* Worker selector */}
              <Field label="Trabajador vinculado" htmlFor="workerId">
                <select
                  id="workerId"
                  name="workerId"
                  defaultValue={editUser?.workerId ?? ""}
                  className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <option value="">Sin vincular</option>
                  {allWorkers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.firstName} {worker.lastName}{worker.rut ? ` (${worker.rut})` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                  Opcional: vincula este usuario a un trabajador existente
                </p>
              </Field>
            </FieldGroup>

            {/* Roles */}
            <div className="mt-5">
              <p className="text-eyebrow mb-2">
                Roles
              </p>
              {state.fieldErrors?.roleIds?.[0] && (
                <p className="text-xs text-[var(--color-danger)] mb-2">{state.fieldErrors.roleIds[0]}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {allRoles.map((role) => {
                  const checked = selectedRoles.includes(role.id)
                  return (
                    <button
                      key={role.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleRole(role.id)}
                      className={
                        [
                          "inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-[var(--radius)] border",
                          "transition-[background-color,border-color,color] duration-[var(--duration-fast)]",
                          "active:scale-[0.97]",
                          checked
                            ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] hover:bg-[var(--color-primary-strong)]"
                            : "bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-muted)]",
                        ].join(" ")
                      }
                    >
                      <span
                        data-role-selection-slot="true"
                        className="flex h-3 w-3 shrink-0 items-center justify-center"
                        aria-hidden="true"
                      >
                        {checked && <Check size={11} weight="bold" />}
                      </span>
                      {role.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Permissions */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-eyebrow">Permisos</p>
                <span className="rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
                  {directPermissionLabel}
                </span>
              </div>

              {activeModules.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {activeModules.map((mod) => (
                    <span
                      key={mod}
                      className="inline-flex items-center rounded-[var(--radius-full)] bg-[var(--color-primary-tint)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary-ink)]"
                    >
                      {getModuleLabel(mod)}
                    </span>
                  ))}
                </div>
              )}

              {state.fieldErrors?.permissionIds?.[0] && (
                <p className="mb-2 text-xs text-[var(--color-danger)]">{state.fieldErrors.permissionIds[0]}</p>
              )}
              {groupedPermissions.length === 0 && (
                <p className="text-xs text-[var(--color-text-subtle)]">No hay permisos registrados</p>
              )}

              <div role="region" aria-label="Permisos de usuario" className="space-y-4">
                {groupedPermissions.map((group) => {
                  const toggleableIds = group.permissions
                    .filter((p) => !p.roleIds.some((rid) => selectedRoles.includes(rid)))
                    .map((p) => p.id)
                  const allToggled =
                    toggleableIds.length > 0 && toggleableIds.every((id) => selectedPermissions.includes(id))
                  return (
                    <section key={group.module}>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-eyebrow">{getModuleLabel(group.module)}</p>
                        {toggleableIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleAllInModule(group)}
                            className="text-[11px] font-medium text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--color-primary-strong)]"
                          >
                            {allToggled ? "Quitar todos" : "Seleccionar todos"}
                          </button>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {group.permissions.map((permission) => {
                          const inheritedByRole = permission.roleIds.some((rid) => selectedRoles.includes(rid))
                          const directlyGranted = selectedPermissions.includes(permission.id)
                          const active = inheritedByRole || directlyGranted
                          if (inheritedByRole) {
                            return (
                              <div
                                key={permission.id}
                                className="flex h-9 items-center gap-3 rounded-md px-2 opacity-50"
                              >
                                <Lock size={14} weight="bold" className="shrink-0 text-[var(--color-text-faint)]" aria-hidden />
                                <span className="flex-1 truncate text-sm text-[var(--color-text-muted)]">
                                  {permission.description ?? permission.name}
                                </span>
                                <span className="shrink-0 text-[10px] text-[var(--color-text-subtle)]">vía rol</span>
                              </div>
                            )
                          }
                          return (
                            <label
                              key={permission.id}
                              className={cn(
                                "flex h-9 cursor-pointer items-center gap-3 rounded-md px-2",
                                "transition-colors duration-[var(--duration-fast)] ease-out",
                                "hover:bg-[var(--color-surface-2)]",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={directlyGranted}
                                onChange={() => togglePermission(permission.id)}
                                aria-label={permission.description ?? permission.name}
                                className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                              />
                              <span
                                className={cn(
                                  "flex-1 truncate text-sm transition-colors duration-[var(--duration-fast)]",
                                  active ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
                                )}
                              >
                                {permission.description ?? permission.name}
                              </span>
                              <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-faint)]">
                                {permission.name}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </section>
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
        )}
      </SheetContent>
    </Sheet>
  )
}
