"use client"

import { useState } from "react"
import { Plus, EnvelopeSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { UserForm } from "./user-form"
import { UserInviteForm } from "./user-invite-form"
import type { Role, Permission, Worksite } from "./user-form.helpers"
import type { WorkerOption } from "./user-invite-form.types"

interface UserActionsProps {
  allRoles: Role[]
  allPermissions: Permission[]
  allWorksites: Worksite[]
  allWorkers: WorkerOption[]
}

export function UserActions({ allRoles, allPermissions, allWorksites, allWorkers }: UserActionsProps) {
  const [userFormOpen, setUserFormOpen] = useState(false)
  const [inviteFormOpen, setInviteFormOpen] = useState(false)

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setUserFormOpen(true)}>
        <Plus size={14} />Nuevo usuario
      </Button>
      <Button size="sm" onClick={() => setInviteFormOpen(true)}>
        <EnvelopeSimple size={14} />Invitar
      </Button>
      <UserForm
        key="nuevo"
        open={userFormOpen}
        onClose={() => setUserFormOpen(false)}
        editUser={null}
        allRoles={allRoles}
        allPermissions={allPermissions}
        allWorksites={allWorksites}
        allWorkers={allWorkers}
      />
      <UserInviteForm
        open={inviteFormOpen}
        onClose={() => setInviteFormOpen(false)}
        allRoles={allRoles}
        allWorksites={allWorksites}
        allWorkers={allWorkers}
      />
    </>
  )
}
