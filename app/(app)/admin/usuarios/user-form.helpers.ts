export interface Role    { id: string; name: string; label: string }
export interface Permission {
  id: string
  name: string
  module: string
  description: string | null
  roleIds: string[]
}
export interface Worksite { id: string; name: string; code: string }

export interface UserForEdit {
  id:         string
  name:       string
  email:      string
  isActive:   boolean
  emailNotifications: boolean
  roleIds:    string[]
  permissionIds: string[]
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[]
}

export interface UserFormProps {
  open:       boolean
  onClose:    () => void
  editUser?:  UserForEdit | null
  allRoles:   Role[]
  allPermissions: Permission[]
  allWorksites: Worksite[]
}

export interface UserSelectionState {
  selectedRoles:     string[]
  selectedPermissions: string[]
  selectedWsIds:     string[]
  primaryWorksiteId: string
}

export interface PendingInvite {
  email:     string
  inviteUrl: string
}

export type UserSelectionAction =
  | { type: "reset"; user?: UserForEdit | null }
  | { type: "toggle-role"; id: string }
  | { type: "toggle-permission"; id: string }
  | { type: "set-permissions"; ids: string[] }
  | { type: "toggle-worksite"; id: string }
  | { type: "set-primary"; id: string }

export function getUserSelection(user?: UserForEdit | null): UserSelectionState {
  const selectedWsIds = user?.worksiteAssignments.map((a) => a.worksiteId) ?? []
  return {
    selectedRoles:     user?.roleIds ?? [],
    selectedPermissions: user?.permissionIds ?? [],
    selectedWsIds,
    primaryWorksiteId: user?.worksiteAssignments.find((a) => a.isPrimary)?.worksiteId
      ?? selectedWsIds[0] ?? "",
  }
}

export function userSelectionReducer(state: UserSelectionState, action: UserSelectionAction): UserSelectionState {
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

export const MODULE_LABELS: Record<string, string> = {
  admin: "Administración",
  approvals: "Aprobaciones",
  purchasing: "Compras",
  receiving: "Recepción",
  reports: "Reportes",
  requests: "Solicitudes",
  warehouse: "Bodega",
}

export function getModuleLabel(module: string) {
  return MODULE_LABELS[module] ?? module
}

export function groupPermissions(permissions: Permission[]) {
  return permissions.reduce<Array<{ module: string; permissions: Permission[] }>>((groups, permission) => {
    const group = groups.find((item) => item.module === permission.module)
    if (group) group.permissions.push(permission)
    else groups.push({ module: permission.module, permissions: [permission] })
    return groups
  }, [])
}
