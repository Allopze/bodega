"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { inviteUser } from "./actions/invite"
import { PendingInvitePanel } from "./user-invite-form-pending"
import { WorkerSelector } from "./worker-selector"
import { RoleSelector } from "./role-selector"
import { WorksiteSelector } from "./worksite-selector"
import { UserAccessReview } from "./user-access-review"
import { getAccessIssue } from "./user-form.helpers"
import type { PendingInvite, UserInviteFormProps } from "./user-invite-form.types"

interface InviteSelection {
  selectedRoles: string[]
  selectedWsIds: string[]
  primaryWorksiteId: string
  selectedWorkerId: string
  name: string
}

type InviteSelectionAction =
  | { type: "reset" }
  | { type: "toggle-role"; id: string }
  | { type: "toggle-worksite"; id: string }
  | { type: "select-worker"; id: string; name?: string; worksiteId?: string }
  | { type: "set-name"; value: string }
  | { type: "set-primary"; id: string }

const EMPTY_SELECTION: InviteSelection = { selectedRoles: [], selectedWsIds: [], primaryWorksiteId: "", selectedWorkerId: "", name: "" }

function inviteSelectionReducer(state: InviteSelection, action: InviteSelectionAction): InviteSelection {
  switch (action.type) {
    case "reset": return EMPTY_SELECTION
    case "toggle-role": return { ...state, selectedRoles: state.selectedRoles.includes(action.id) ? state.selectedRoles.filter((id) => id !== action.id) : [...state.selectedRoles, action.id] }
    case "toggle-worksite": {
      const selectedWsIds = state.selectedWsIds.includes(action.id) ? state.selectedWsIds.filter((id) => id !== action.id) : [...state.selectedWsIds, action.id]
      return { ...state, selectedWsIds, primaryWorksiteId: selectedWsIds.includes(state.primaryWorksiteId) ? state.primaryWorksiteId : selectedWsIds[0] ?? "" }
    }
    case "select-worker": {
      const selectedWsIds = action.worksiteId && !state.selectedWsIds.includes(action.worksiteId) ? [...state.selectedWsIds, action.worksiteId] : state.selectedWsIds
      return { ...state, selectedWorkerId: action.id, name: action.name ?? state.name, selectedWsIds, primaryWorksiteId: state.primaryWorksiteId || action.worksiteId || "" }
    }
    case "set-name": return { ...state, name: action.value }
    case "set-primary": return { ...state, primaryWorksiteId: action.id }
  }
}

export function UserInviteForm({ open, onClose, allRoles, allWorksites, allWorkers }: UserInviteFormProps) {
  const [selection, dispatchSelection] = React.useReducer(inviteSelectionReducer, EMPTY_SELECTION)
  const [pending, setPending] = React.useState<PendingInvite | null>(null)
  const { selectedRoles, selectedWsIds, primaryWorksiteId, selectedWorkerId, name } = selection
  const accessIssue = React.useMemo(
    () => getAccessIssue(allRoles, selectedRoles, selectedWsIds),
    [allRoles, selectedRoles, selectedWsIds],
  )

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await inviteUser(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Invitación creada")
        // El formulario sigue montado tras cerrar: la próxima invitación parte
        // sin los roles ni las faenas de la anterior.
        dispatchSelection({ type: "reset" })
        const data = result.data as { email?: string; inviteUrl?: string } | undefined
        if (data?.inviteUrl) {
          const matchedEmail = data.email ?? result.message?.match(/a\s+(\S+@\S+)/i)?.[1] ?? ""
          setPending({ email: matchedEmail, inviteUrl: data.inviteUrl })
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
    dispatchSelection({ type: "toggle-role", id })
  }

  function toggleWorksite(id: string) {
    dispatchSelection({ type: "toggle-worksite", id })
  }

  function selectWorker(workerId: string) {
    const worker = allWorkers.find((item) => item.id === workerId)
    dispatchSelection({ type: "select-worker", id: workerId, name: worker?.name, worksiteId: worker?.worksiteId })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => {
      if (!v) {
        setPending(null)
        onClose()
      }
    }}>
      <SheetContent>
        {pending ? (
          <PendingInvitePanel
            pending={pending}
            onCreateAnother={() => setPending(null)}
            onClose={() => { setPending(null); onClose() }}
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

              <RoleSelector
                roles={allRoles}
                selectedIds={selectedRoles}
                onToggle={toggleRole}
                error={state.fieldErrors?.roleIds?.[0]}
              />

              <WorksiteSelector
                worksites={allWorksites}
                selectedIds={selectedWsIds}
                primaryId={primaryWorksiteId}
                onToggle={toggleWorksite}
                onSetPrimary={(id) => dispatchSelection({ type: "set-primary", id })}
                error={state.fieldErrors?.worksiteAssignments?.[0]}
              />

              <section className="mt-5" aria-labelledby="invite-identity-title">
                <h3 id="invite-identity-title" className="text-eyebrow mb-2">Datos de la persona</h3>
                <FieldGroup className="gap-4">
                <WorkerSelector
                  workers={allWorkers}
                  selectedId={selectedWorkerId}
                  onValueChange={selectWorker}
                  error={state.fieldErrors?.workerId?.[0]}
                />

                <Field label="Nombre" htmlFor="invite-name" error={state.fieldErrors?.name?.[0]}>
                  <Input
                    id="invite-name"
                    name="name"
                    value={name}
                    onChange={(event) => dispatchSelection({ type: "set-name", value: event.target.value })}
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
              </section>

              <UserAccessReview
                roles={allRoles}
                worksites={allWorksites}
                permissions={[]}
                selectedRoleIds={selectedRoles}
                selectedWorksiteIds={selectedWsIds}
                primaryWorksiteId={primaryWorksiteId}
                selectedPermissionIds={[]}
                issue={accessIssue}
              />
            </SheetBody>

            <SheetFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <SubmitButton label="Enviar invitación" loadingLabel="Enviando..." disabled={!!accessIssue} />
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
