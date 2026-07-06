"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Check } from "@phosphor-icons/react"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { inviteUser } from "./actions"
import { PendingInvitePanel } from "./user-invite-form-pending"
import type { PendingInvite, UserInviteFormProps } from "./user-invite-form.types"

export function UserInviteForm({ open, onClose, allRoles, allWorksites }: UserInviteFormProps) {
  const [selectedRoles, setSelectedRoles] = React.useState<string[]>([])
  const [selectedWsIds, setSelectedWsIds] = React.useState<string[]>([])
  const [primaryWorksiteId, setPrimaryWorksiteId] = React.useState("")
    const [pending, setPending] = React.useState<PendingInvite | null>(null)
  const [_copied, setCopied]   = React.useState(false)

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await inviteUser(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Invitación creada")
        const data = result.data as { email?: string; inviteUrl?: string } | undefined
        if (data?.inviteUrl) {
          const matchedEmail = data.email ?? result.message?.match(/a\s+(\S+@\S+)/i)?.[1] ?? ""
          setPending({ email: matchedEmail, inviteUrl: data.inviteUrl })
          setSelectedRoles([])
          setSelectedWsIds([])
          setPrimaryWorksiteId("")
        } else {
          onClose()
        }
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

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
  }  return (
    <Sheet open={open} onOpenChange={(v) => {
      if (!v) {
        setPending(null)
        setCopied(false)
        onClose()
      }
    }}>
      <SheetContent>
        {pending ? (
          <PendingInvitePanel
            pending={pending}
            onCreateAnother={() => { setPending(null); setCopied(false) }}
            onClose={() => { setPending(null); setCopied(false); onClose() }}
          />
        ) : (
          <form action={formAction} className="flex flex-col flex-1 min-h-0">
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
                <p className="mb-4 text-sm text-(--color-danger)">{state.message}</p>
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
                <p className="mb-2 text-eyebrow">
                  Roles
                </p>
                {state.fieldErrors?.roleIds?.[0] && (
                  <p className="mb-2 text-xs text-(--color-danger)">{state.fieldErrors.roleIds[0]}</p>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  {allRoles.map((role) => {
                    const checked = selectedRoles.includes(role.id)
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => toggleRole(role.id)}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-3 py-2 text-left text-xs font-medium",
                          "transition-all duration-(--duration-fast) ease-[var(--ease-out)] cursor-pointer select-none",
                          checked
                            ? "border-(--color-primary) bg-(--color-primary) text-white font-semibold shadow-(--shadow-xs) hover:opacity-90"
                            : "border-(--color-border) bg-surface text-(--color-text-muted) hover:bg-surface-2 hover:border-(--color-border-strong) hover:text-(--color-text)",
                        ].join(" ")}
                      >
                        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
                          {checked && <Check size={11} weight="bold" />}
                        </span>
                        <span className="truncate">{role.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-eyebrow">
                  Faenas asignadas
                </p>
                {state.fieldErrors?.worksiteAssignments?.[0] && (
                  <p className="mb-2 text-xs text-(--color-danger)">
                    {state.fieldErrors.worksiteAssignments[0]}
                  </p>
                )}
                {allWorksites.length === 0 && (
                  <p className="text-xs text-(--color-text-subtle)">No hay faenas registradas</p>
                )}
                <div className="flex flex-col gap-1">
                  {allWorksites.map((worksite) => {
                    const isChecked = selectedWsIds.includes(worksite.id)
                    const isPrimary = primaryWorksiteId === worksite.id && isChecked
                    return (
                      <label
                        key={worksite.id}
                        className={[
                          "group flex cursor-pointer items-center gap-3 rounded-(--radius) px-2 py-1.5 select-none",
                          "transition-colors duration-(--duration-fast) ease-[var(--ease-out)]",
                          isChecked
                            ? "bg-(--color-primary-tint) hover:bg-(--color-primary-tint)"
                            : "hover:bg-surface-2",
                        ].join(" ")}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleWorksite(worksite.id)}
                          className="h-4 w-4 shrink-0 accent-(--color-primary) cursor-pointer"
                        />
                        <span className="flex-1 text-sm text-(--color-text)">
                          {worksite.name}
                          <span className="ml-1.5 font-mono text-xs text-(--color-text-subtle)">
                            {worksite.code}
                          </span>
                        </span>
                        {isChecked && (
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); setPrimaryWorksiteId(worksite.id) }}
                            className={[
                              "rounded-(--radius-sm) border px-2 py-0.5 text-xs cursor-pointer select-none",
                              "transition-all duration-(--duration-fast) ease-[var(--ease-out)]",
                              isPrimary
                                ? "border-(--color-primary) bg-(--color-primary) text-white font-medium shadow-(--shadow-xs)"
                                : "border-(--color-border) bg-surface text-(--color-text-subtle) hover:border-(--color-primary) hover:text-(--color-primary) hover:bg-surface-2",
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
        )}
      </SheetContent>
    </Sheet>
  )
}
