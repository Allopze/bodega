export const CARGO_KEYS = {
  conductor_ampliroll: 'Conductor Ampliroll',
  conductor_batea: 'Conductor Batea',
  operador_maquinaria: 'Operador Maquinaria Pesada',
  conductor_general: 'Conductor General',
  // Used in LC-SST-002 appliesWhen fields
  operador_maquinaria_pesada: 'Operador Maquinaria Pesada',
} as const

export type CargoKey = keyof typeof CARGO_KEYS

export const CARGO_OPTIONS = Object.entries(CARGO_KEYS).map(([value, label]) => ({ value, label }))
