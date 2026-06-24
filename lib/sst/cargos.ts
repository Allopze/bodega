export const CARGO_KEYS = {
  conductor_ampliroll: 'Conductor Ampliroll',
  conductor_batea: 'Conductor Batea',
  operador_maquinaria_pesada: 'Operador Maquinaria Pesada',
} as const

export type CargoKey = keyof typeof CARGO_KEYS

export const CARGO_OPTIONS = Object.entries(CARGO_KEYS).map(([value, label]) => ({ value, label }))

/**
 * Human-readable labels for evaluation signature roles.
 * Used in the PDF acta and the evaluation detail page.
 */
export const SIGNATURE_ROLE_LABELS: Record<string, string> = {
  trabajador: 'Trabajador',
  supervisor: 'Administrador de contrato',
  prevencionista: 'Prevencionista',
  jefe_area: 'Supervisor de faena/Jefe de terreno',
}
