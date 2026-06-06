"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { inviteUser } from "./actions"

interface Role { id: string; name: string; label: string }
interface Worksite { id: string; name: string; code: string }

interface UserInviteFormProps {
  open: boolean
  onClose: () => void
  allRoles: Role[]
  allWorksites: Worksite[]
}

export function UserInviteForm({ open, onClose, allRoles, allWorksites }: UserInviteFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(inviteUser, INITIAL_STATE)
  const [selectedRoles, setSelectedRoles] = React.useState<string[]>([])
  const [selectedWsIds, setSelectedWsIds] = React.useState<string[]>([])
  const [primaryWorksiteId, setPrimaryWorksiteId] = React.useState("")

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Invitación creada")
      onClose()
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  function toggleRole(id: string) {
    setSelectedRoles((prev) =>
      prev.includes(id) ? prev.filter((roleId) => roleId !== id) : [...prev, id],
    )
  }

  function toggleWorksite(id: string) {
    setSelectedWsIds((prev) => {
      const next = prev.includes(id) ? prev.filter((worksiteId) => worksiteId !== id) : [...prev, id]
      if (!next.includes(primaryWorksiteId)) setPrimaryWorksiteId(next[0] ?? "")
      return next
    })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction}>
          {selectedRoles.map((roleId) => (
            <input key={roleId} type="hidden" name="roleIds" value={roleId} />
          ))}
          {selectedWsIds.map((worksiteId) => (
            <input key={worksiteId} type="hidden" name="worksiteId" value={worksiteId} />
          ))}
          {primaryWorksiteId && (
            <input type="hidden" name="primaryWorksiteId" value={primaryWorksiteId} />
          )}

          <SheetHeader>
            <div>
              <SheetTitle>Invitar usuario</SheetTitle>
              <SheetDescription>
                Envía un enlace de registro con roles y accesos iniciales.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}

            <FieldGroup className="gap-4">
              <Field label="Nombre" htmlFor="invite-name" error={state.fieldErrors?.name?.[0]}>
                <Input
                  id="invite-name"
                  name="name"
                  placeholder="Nombre Apellido"
                  autoComplete="off"
                  error={!!state.fieldErrors?.name}
                />
              </Field>

              <Field label="Correo electrónico" htmlFor="invite-email" required error={state.fieldErrors?.email?.[0]}>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="usuario@chome.cl"
                  autoComplete="off"
                  error={!!state.fieldErrors?.email}
                />
              </Field>

              <Field
                label="Vigencia"
                htmlFor="expiresInDays"
                helper="Días antes de que el enlace expire."
                error={state.fieldErrors?.expiresInDays?.[0]}
              >
                <Input
                  id="expiresInDays"
                  name="expiresInDays"
                  type="number"
                  min={1}
                  max={30}
                  defaultValue={7}
                  error={!!state.fieldErrors?.expiresInDays}
                />
              </Field>
            </FieldGroup>

            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">
                Roles
              </p>
              {state.fieldErrors?.roleIds?.[0] && (
                <p className="mb-2 text-xs text-[var(--color-danger)]">{state.fieldErrors.roleIds[0]}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {allRoles.map((role) => {
                  const checked = selectedRoles.includes(role.id)
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      className={[
                        "rounded-[var(--radius)] border px-3 py-1 text-xs",
                        "transition-[background-color,border-color,color] duration-[var(--duration-fast)] active:scale-[0.97]",
                        checked
                          ? "border-[var(--color-primary-100)] bg-[var(--color-primary-50)] font-medium text-[var(--color-primary-700)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
                      ].join(" ")}
                    >
                      {role.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">
                Faenas asignadas
              </p>
              {state.fieldErrors?.worksiteAssignments?.[0] && (
                <p className="mb-2 text-xs text-[var(--color-danger)]">
                  {state.fieldErrors.worksiteAssignments[0]}
                </p>
              )}
              {allWorksites.length === 0 && (
                <p className="text-xs text-[var(--color-text-subtle)]">No hay faenas registradas</p>
              )}
              <div className="flex flex-col gap-1">
                {allWorksites.map((worksite) => {
                  const isChecked = selectedWsIds.includes(worksite.id)
                  const isPrimary = primaryWorksiteId === worksite.id && isChecked
                  return (
                    <label
                      key={worksite.id}
                      className="group flex cursor-pointer items-center gap-3 rounded-[var(--radius)] px-2 py-1.5 hover:bg-[var(--color-surface-2)]"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleWorksite(worksite.id)}
                        className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span className="flex-1 text-sm text-[var(--color-text)]">
                        {worksite.name}
                        <span className="ml-1.5 font-mono text-xs text-[var(--color-text-subtle)]">
                          {worksite.code}
                        </span>
                      </span>
                      {isChecked && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setPrimaryWorksiteId(worksite.id) }}
                          className={[
                            "rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs transition-colors duration-[var(--duration-fast)]",
                            isPrimary
                              ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                              : "border-[var(--color-border)] bg-transparent text-[var(--color-text-subtle)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]",
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
            <SubmitButton label="Enviar invitación" loadingLabel="Enviando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
