import type { Role, WorkerOption, Worksite } from "./user-form.helpers"

export type { Role, WorkerOption, Worksite }

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
