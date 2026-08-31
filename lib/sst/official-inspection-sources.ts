/**
 * Fuentes oficiales cotejadas contra la carpeta maestra SGI 2026.
 *
 * El hash es del binario original, no de la definición JSON. Los duplicados
 * de `anexos/` y `checklists/` no son nuevas revisiones y no se registran acá.
 */
export interface OfficialInspectionSource {
  annex: string
  definitionCode: string | null
  fileName: string
  revision: string | null
  effectiveDate: string | null
  sha256: string
}

export const OFFICIAL_INSPECTION_SOURCES: readonly OfficialInspectionSource[] = [
  { annex: "1", definitionCode: "inspeccion_equipos_moviles", fileName: "Anexo 1 Inspeccion de Equipos Moviles (maquinaria pesada - camiones) 2019.xls", revision: null, effectiveDate: "2019-01-01", sha256: "ad2aa71685ee0512c21599ac186dd964d0afefc5fd5dd243bd23e52eb29a663f" },
  { annex: "2", definitionCode: "inspeccion_extintores", fileName: "Anexo 2 Inspeccion Estado extintores.xls", revision: null, effectiveDate: null, sha256: "6e46d8bc48e0286f5aac76955d194efab085455ed03aa7b6e471961369dfc568" },
  { annex: "3", definitionCode: "inspeccion_epp", fileName: "Anexo 3  Inspeccion de Uso y Estado de EPP.xls", revision: null, effectiveDate: null, sha256: "b286f019f3d0b5907d3ae4ac71265cf6cc06590029ec4b930ec7d491548814e0" },
  { annex: "4", definitionCode: "observacion_ampliroll", fileName: "Anexo 4 Observacion de Seguridad Camion Ampliroll PR-SGC-24.xls", revision: null, effectiveDate: null, sha256: "dd2dd9b52e43a74836c413a8dc8de5ee84c81ca8c6728ecfca1d391b26dc7736" },
  { annex: "5", definitionCode: "observacion_maquinaria", fileName: "Anexo 5 Observacion de Seguridad Maquinaria Pesada PR-SGC-25.xls", revision: null, effectiveDate: null, sha256: "7f9b84c75df3d6dfd3440ffb84e8903e9058f045e1b2d1f32db1990966d3185d" },
  { annex: "7", definitionCode: "observacion_planeada", fileName: "Anexo 7 Observaciones Planeadas (2).XLS", revision: "Rev. 01", effectiveDate: null, sha256: "159df7537aeef7ed9eb98c97a72e0f8e0c0375b0a321cbdc973de3e4a30fbfb7" },
  { annex: "08", definitionCode: "inspeccion_no_planeada", fileName: "Anexo 08 Evidencia Objetiva Inspecciones de Seguridad.docx", revision: null, effectiveDate: null, sha256: "085579f4a15145d18cf3c3cfce6cc91c69af6a3054765d9065f6c69dc19aecd2" },
  { annex: "12", definitionCode: "inspeccion_taller", fileName: "Anexo 12 Inspeccion Taller Mantención.xlsx", revision: null, effectiveDate: null, sha256: "5285c3d4df341e61c06de154237a8d87e932b1ae0bb6cbdf2dafd9dd5171925f" },
  { annex: "13", definitionCode: "inspeccion_carros", fileName: "Anexo 13 Inspeccion Carro.xlsx", revision: "Rev. 00", effectiveDate: null, sha256: "dc6c9647d8e613e9bfa7f858860e86ff334d682906e0dde378d255351c85a500" },
  { annex: "14", definitionCode: "inspeccion_contenedores", fileName: "Anexo 14 Inspeccion Contenedores (1).xlsx", revision: null, effectiveDate: null, sha256: "ba14f7167864fc4333d21469a48bf6182fe110ab52f8fedde2647efe6bd01838" },
  { annex: "15", definitionCode: null, fileName: "Anexo 15 Seguimiento y Control de Observaciones e Inspecciones planeadas y no planeadas.xlsx", revision: null, effectiveDate: null, sha256: "4ead4412a4913ae40623fd56d672f72e900cc175a82d7ceee3cb162db7a78c5b" },
] as const

export function officialInspectionSourceFor(definitionCode: string) {
  return OFFICIAL_INSPECTION_SOURCES.find((source) => source.definitionCode === definitionCode) ?? null
}
