export interface Option { value: string; label: string }

export interface PpaFormProps {
  worksites: { id: string; name: string }[]
  initialWorksiteId: string
  hasFaenaParam: boolean
  tipoTrabajoOptions: Option[]
  controlOptions: Option[]
  complementarias: { key: string; label: string }[]
}
