export interface Role { id: string; name: string; label: string }
export interface Worksite { id: string; name: string; code: string }

export interface PendingInvite {
  email:    string
  inviteUrl: string
}

export interface UserInviteFormProps {
  open: boolean
  onClose: () => void
  allRoles: Role[]
  allWorksites: Worksite[]
}
