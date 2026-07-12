export interface Role { id: string; name: string; label: string }
export interface Worksite { id: string; name: string; code: string }
export interface WorkerOption {
  id: string
  name: string
  rut: string | null
  worksiteId: string
  worksiteName: string
  linkedUserId: string | null
}

export interface PendingInvite {
  email:    string
  inviteUrl: string
}

export interface UserInviteFormProps {
  open: boolean
  onClose: () => void
  allRoles: Role[]
  allWorksites: Worksite[]
  allWorkers: WorkerOption[]
}
