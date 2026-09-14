export interface Option { value: string; label: string }

export interface PpaFormProps {
  worksites: { id: string; name: string }[]
  workPermits: { id: string; code: string; taskDescription: string; worksiteId: string }[]
  initialWorksiteId: string
  hasFaenaParam: boolean
  /**
   * PPA-001: token del enlace que acredita `initialWorksiteId` en el servidor.
   * Vacío cuando el formulario se abrió sin enlace acreditado; entonces la
   * faena la acredita el RUT del trabajador y no este campo.
   */
  accessToken: string
  tipoTrabajoOptions: Option[]
  controlOptions: Option[]
  complementarias: { key: string; label: string }[]
}
