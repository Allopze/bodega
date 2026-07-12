"use client"

import { useState } from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { RoleForm } from "./role-form"
import type { GroupedPermission, PermissionOption } from "./role-form"

interface RolesActionsProps {
  groupedPermissions: GroupedPermission[]
  permissions: PermissionOption[]
}

export function RolesActions({ groupedPermissions, permissions }: RolesActionsProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} />Nuevo rol
      </Button>
      <RoleForm
        key="nuevo"
        open={open}
        onClose={() => setOpen(false)}
        editRole={null}
        groupedPermissions={groupedPermissions}
        permissions={permissions}
      />
    </>
  )
}
