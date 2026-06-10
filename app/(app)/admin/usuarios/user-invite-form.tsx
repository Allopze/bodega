"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { Check, Copy, Envelope } from "@phosphor-icons/react"
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

interface PendingInvite {
  email:    string
  inviteUrl: string
}

export function UserInviteForm({ open, onClose, allRoles, allWorksites }: UserInviteFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(inviteUser, INITIAL_STATE)
  const [selectedRoles, setSelectedRoles] = React.useState<string[]>([])
  const [selectedWsIds, setSelectedWsIds] = React.useState<string[]>([])
  const [primaryWorksiteId, setPrimaryWorksiteId] = React.useState("")
  const [pending, setPending] = React.useState<PendingInvite | null>(null)
  const [copied, setCopied]   = React.useState(false)
  // Track the last state we already reacted to so we don't fire a
  // setState cascade on re-render. useActionState returns a new state
  // reference after every server response, so a single `===` check is
  // enough to detect "this is new".
  const lastSeenStateRef = React.useRef<ActionState>(INITIAL_STATE)

  useEffect(() => {
    if (state === lastSeenStateRef.current) return
    lastSeenStateRef.current = state
    if (state.ok) {
      toast.success(state.message ?? "Invitación creada")
      const data = state.data as { inviteUrl?: string } | undefined
      if (data?.inviteUrl) {
        // The action returned a non-empty inviteUrl only when SMTP is
        // not configured. Keep the form open and surface the link in a
        // deliberate, dismissable panel instead of a transient toast.
        const matchedEmail = state.message?.match(/a\s+(\S+@\S+)/i)?.[1] ?? ""
        setPending({ email: matchedEmail, inviteUrl: data.inviteUrl })
        // Reset role/worksite selections so the form is ready for a new invite.
        setSelectedRoles([])
        setSelectedWsIds([])
        setPrimaryWorksiteId("")
      } else {
        onClose()
      }
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

  return (
    <Sheet open={open} onOpenChange={(v) => {
      if (!v) {
        setPending(null)
        setCopied(false)
        onClose()
      }
    }}>
      <SheetContent>
        {pending ? (
          <>
            <SheetHeader>
              <div>
                <SheetTitle>Invitación pendiente</SheetTitle>
                <SheetDescription>
                  SMTP no está configurado. Comparte este enlace con {pending.email || "el destinatario"} por un canal seguro.
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
                      Enlace de registro
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
                Crear otra invitación
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
                <p className="mb-2 text-eyebrow">
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
                            ? "border-[var(--color-primary-line)] bg-[var(--color-primary-tint)] font-medium text-[var(--color-primary-ink)]"
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
                <p className="mb-2 text-eyebrow">
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
        )}
      </SheetContent>
    </Sheet>
  )
}
