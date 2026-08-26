"use client"

import * as React from "react"
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, SheetCloseButton } from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useUserForm } from "./use-user-form"
import { InvitePendingCard } from "./invite-pending-card"
import { RoleSelector } from "./role-selector"
import { PermissionSection } from "./permission-section"
import { WorksiteSelector } from "./worksite-selector"
import { UserAccessReview } from "./user-access-review"
import { WorkerSelector } from "./worker-selector"
import type { UserFormProps, WorkerOption } from "./user-form.helpers"

const EMPTY_WORKERS: WorkerOption[] = []

export function UserForm({ open, onClose, editUser, allRoles, allPermissions, allWorksites, allWorkers = EMPTY_WORKERS }: UserFormProps) {
  const {
    isEdit,
    state,
    formAction,
    pending,
    copied,
    selection,
    groupedPermissions,
    directPermissionLabel,
    activeModules,
    accessIssue,
    toggleRole,
    togglePermission,
    toggleAllInModule,
    toggleWorksite,
    setPrimary,
    setWorker,
    copyInvite,
    dismissPending,
    dismissPendingAndClose,
    handleOpenChange,
  } = useUserForm({ editUser, onClose, allRoles, allPermissions, allWorksites, allWorkers })

  const safeEditUser = editUser!
  const [exceptionsOpen, setExceptionsOpen] = React.useState((editUser?.permissionIds.length ?? 0) > 0)
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        {pending ? (
          <InvitePendingCard
            pending={pending}
            copied={copied}
            onCopy={copyInvite}
            onDismiss={dismissPending}
            onDismissAndClose={dismissPendingAndClose}
          />
        ) : (
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          {isEdit && <input type="hidden" name="id" value={safeEditUser.id} />}
          {selection.selectedRoles.map((rid) => (
            <input key={rid} type="hidden" name="roleIds" value={rid} />
          ))}
          {selection.selectedPermissions.map((pid) => (
            <input key={pid} type="hidden" name="permissionIds" value={pid} />
          ))}
          {selection.selectedWsIds.map((wsId) => (
            <input key={wsId} type="hidden" name="worksiteId" value={wsId} />
          ))}
          {selection.primaryWorksiteId && (
            <input type="hidden" name="primaryWorksiteId" value={selection.primaryWorksiteId} />
          )}

          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar usuario" : "Nuevo usuario"}</SheetTitle>
              <SheetDescription>
                {isEdit ? `Modificar datos de ${safeEditUser.name}` : "Crea el acceso; el usuario definirá su contraseña."}
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="min-h-0">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}

            <RoleSelector
              roles={allRoles}
              selectedIds={selection.selectedRoles}
              onToggle={toggleRole}
              error={state.fieldErrors?.roleIds?.[0]}
            />

            <WorksiteSelector
              worksites={allWorksites}
              selectedIds={selection.selectedWsIds}
              primaryId={selection.primaryWorksiteId}
              onToggle={toggleWorksite}
              onSetPrimary={setPrimary}
              error={state.fieldErrors?.worksiteAssignments?.[0]}
            />

            <section className="mt-5" aria-labelledby="user-identity-title">
              <h3 id="user-identity-title" className="text-eyebrow mb-2">Datos de la persona</h3>
              <FieldGroup className="gap-4">
              <WorkerSelector
                workers={allWorkers}
                selectedId={selection.workerId}
                currentUserId={editUser?.id}
                onValueChange={setWorker}
                error={state.fieldErrors?.workerId?.[0]}
              />

              <Field label="Nombre completo" htmlFor="name" error={state.fieldErrors?.name?.[0]}>
                <Input
                  key={selection.workerId || editUser?.id || "new"}
                  id="name" name="name"
                  defaultValue={allWorkers.find((worker) => worker.id === selection.workerId)?.name ?? editUser?.name ?? ""}
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

              <Checkbox id="isActive" name="isActive" value="on" defaultChecked={editUser?.isActive ?? true} label="Usuario activo" />

              {isEdit && (
                <Checkbox
                  id="emailNotifications"
                  name="emailNotifications"
                  value="on"
                  defaultChecked={editUser?.emailNotifications ?? true}
                  label="Recibe notificaciones por correo"
                />
              )}

              {!isEdit && (
                <Field
                  label="Vigencia de invitación"
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
              )}
            </FieldGroup>
            </section>

            <details className="mt-5" open={exceptionsOpen} onToggle={(event) => setExceptionsOpen(event.currentTarget.open)}>
              <summary className="min-h-11 cursor-pointer rounded-[var(--radius)] px-2 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] sm:min-h-9">
                Excepciones de permisos ({selection.selectedPermissions.length})
              </summary>
              <PermissionSection
                groupedPermissions={groupedPermissions}
                selectedRoleIds={selection.selectedRoles}
                selectedPermissionIds={selection.selectedPermissions}
                directPermissionLabel={directPermissionLabel}
                activeModules={activeModules}
                onTogglePermission={togglePermission}
                onToggleAllInModule={toggleAllInModule}
                error={state.fieldErrors?.permissionIds?.[0]}
              />
            </details>

            <UserAccessReview
              roles={allRoles}
              worksites={allWorksites}
              permissions={allPermissions}
              selectedRoleIds={selection.selectedRoles}
              selectedWorksiteIds={selection.selectedWsIds}
              primaryWorksiteId={selection.primaryWorksiteId}
              selectedPermissionIds={selection.selectedPermissions}
              issue={accessIssue}
            />
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <SubmitButton
              label={isEdit ? "Guardar cambios" : "Crear usuario"}
              loadingLabel={isEdit ? "Guardando..." : "Creando..."}
              disabled={!!accessIssue}
            />
          </SheetFooter>
        </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
