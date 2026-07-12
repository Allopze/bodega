"use client"

import * as React from "react"
import { useActionState } from "react"
import { useEffect } from "react"
import { useReducer } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { createUser, updateUser } from "./actions"
import {
  userSelectionReducer,
  getUserSelection,
  groupPermissions,
  type UserForEdit,
  type Permission,
  type Role,
  type Worksite,
  type WorkerOption,
  type PendingInvite,
} from "./user-form.helpers"

export interface UseUserFormProps {
  editUser?: UserForEdit | null
  onClose: () => void
  allRoles: Role[]
  allPermissions: Permission[]
  allWorksites: Worksite[]
  allWorkers: WorkerOption[]
}

export interface UseUserFormReturn {
  isEdit: boolean
  state: ActionState
  formAction: (payload: FormData) => void
  pending: PendingInvite | null
  copied: boolean
  selection: {
    selectedRoles: string[]
    selectedPermissions: string[]
    selectedWsIds: string[]
    primaryWorksiteId: string
    workerId: string
  }
  groupedPermissions: ReturnType<typeof groupPermissions>
  directPermissionLabel: string
  activeModules: string[]
  toggleRole: (id: string) => void
  togglePermission: (id: string) => void
  toggleAllInModule: (group: { module: string; permissions: Permission[] }) => void
  toggleWorksite: (id: string) => void
  setPrimary: (id: string) => void
  setWorker: (id: string) => void
  copyInvite: () => Promise<void>
  dismissPending: () => void
  dismissPendingAndClose: () => void
  handleOpenChange: (v: boolean) => void
}

export function useUserForm({ editUser, onClose, allRoles: _allRoles, allPermissions, allWorkers, allWorksites: _allWorksites }: UseUserFormProps): UseUserFormReturn {
  const isEdit = !!editUser

  const action = isEdit ? updateUser : createUser
  const [state, formAction] = useActionState<ActionState, FormData>(action, INITIAL_STATE)
  const lastSeenStateRef = React.useRef<ActionState>(INITIAL_STATE)
  const [pending, setPending] = React.useState<PendingInvite | null>(null)
  const [copied, setCopied] = React.useState(false)

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
      if (!state.fieldErrors) toast.error(state.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const [selection, updateSelection] = useReducer(
    userSelectionReducer,
    editUser,
    getUserSelection,
  )

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
      .filter((p) => !p.roleIds.some((roleId) => selection.selectedRoles.includes(roleId)))
      .map((p) => p.id)
    const allSelected = toggleableIds.every((id) => selection.selectedPermissions.includes(id))
    const next = allSelected
      ? selection.selectedPermissions.filter((id) => !toggleableIds.includes(id))
      : [...new Set([...selection.selectedPermissions, ...toggleableIds])]
    updateSelection({ type: "set-permissions", ids: next })
  }

  function toggleWorksite(id: string) {
    updateSelection({ type: "toggle-worksite", id })
  }

  function setPrimary(id: string) {
    updateSelection({ type: "set-primary", id })
  }

  function setWorker(id: string) {
    const worker = allWorkers.find((item) => item.id === id)
    updateSelection({ type: "set-worker", workerId: id, worksiteId: worker?.worksiteId })
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

  function dismissPending() {
    setPending(null)
    setCopied(false)
  }

  function dismissPendingAndClose() {
    setPending(null)
    setCopied(false)
    onClose()
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setPending(null)
      setCopied(false)
      onClose()
    }
  }

  const { selectedRoles, selectedPermissions, selectedWsIds, primaryWorksiteId, workerId } = selection
  const groupped = React.useMemo(() => groupPermissions(allPermissions), [allPermissions])
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
  }, [allPermissions, selectedRoles, selectedPermissions])

  return {
    isEdit,
    state,
    formAction,
    pending,
    copied,
    selection: { selectedRoles, selectedPermissions, selectedWsIds, primaryWorksiteId, workerId },
    groupedPermissions: groupped,
    directPermissionLabel,
    activeModules,
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
  }
}
