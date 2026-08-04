export interface Role {
  id: string
  name: string
  label: string
  requiresWorksiteAssignment?: boolean
}
export interface Permission {
  id: string
  name: string
  module: string
  description: string | null
  roleIds: string[]
}
export interface Worksite { id: string; name: string; code: string }
export interface WorkerOption {
  id: string
  name: string
  rut: string | null
  worksiteId: string
  worksiteName: string
  linkedUserId: string | null
}

export interface UserForEdit {
  id:         string
  name:       string
  email:      string
  isActive:   boolean
  emailNotifications: boolean
  roleIds:    string[]
  permissionIds: string[]
  workerId?: string | null
  worksiteAssignments: { worksiteId: string; isPrimary: boolean }[]
}

export interface UserFormProps {
  open:       boolean
  onClose:    () => void
  editUser?:  UserForEdit | null
  allRoles:   Role[]
  allPermissions: Permission[]
  allWorksites: Worksite[]
  allWorkers?: WorkerOption[]
}

export interface UserSelectionState {
  selectedRoles:     string[]
  selectedPermissions: string[]
  selectedWsIds:     string[]
  primaryWorksiteId: string
  workerId: string
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
  | { type: "set-worker"; workerId: string; worksiteId?: string }

export function getUserSelection(user?: UserForEdit | null): UserSelectionState {
  const selectedWsIds = user?.worksiteAssignments.map((a) => a.worksiteId) ?? []
  return {
    selectedRoles:     user?.roleIds ?? [],
    selectedPermissions: user?.permissionIds ?? [],
    selectedWsIds,
    primaryWorksiteId: user?.worksiteAssignments.find((a) => a.isPrimary)?.worksiteId
      ?? selectedWsIds[0] ?? "",
    workerId: user?.workerId ?? "",
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
    case "set-worker": {
      const selectedWsIds = action.worksiteId && !state.selectedWsIds.includes(action.worksiteId)
        ? [...state.selectedWsIds, action.worksiteId]
        : state.selectedWsIds
      return {
        ...state,
        workerId: action.workerId,
        selectedWsIds,
        primaryWorksiteId: state.primaryWorksiteId || action.worksiteId || "",
      }
    }
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

export function getAccessIssue(roles: Role[], selectedRoleIds: string[], selectedWorksiteIds: string[]) {
  if (selectedRoleIds.length === 0) return "Selecciona al menos un rol antes de continuar."

  const selectedRoleIdSet = new Set(selectedRoleIds)
  const rolesRequiringWorksite = roles.filter(
    (role) => selectedRoleIdSet.has(role.id) && role.requiresWorksiteAssignment,
  )
  if (rolesRequiringWorksite.length > 0 && selectedWorksiteIds.length === 0) {
    const labels = rolesRequiringWorksite.map((role) => role.label).join(", ")
    return `${labels} requiere al menos una faena asignada.`
  }

  return undefined
}
