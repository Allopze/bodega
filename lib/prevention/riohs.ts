/**
 * Reglamento Interno de Higiene y Seguridad (RIOHS).
 *
 * DS 44/2024 título III párrafo 5, arts. 56 a 61. El art. 58 fija el contenido
 * mínimo y es una lista cerrada: un reglamento al que le falta cualquiera de
 * estos capítulos no cumple, por bien redactado que esté el resto.
 *
 * No lleva tablas propias. El RIOHS es un documento versionado con distribución
 * nominativa, y la biblioteca documental (`sstDocuments` + `sstDocumentVersions`
 * + `sstDocumentDistributionTargets`) ya hace exactamente eso. Lo único que
 * agrega este archivo es la estructura exigida y cómo medir qué falta; el
 * estado se guarda en `sstDocuments.extraMetadata`.
 */

export interface RiohsSection {
  id: string
  title: string
  legalBasis: string
  /** Si es false, se puede omitir declarando por qué no aplica. */
  mandatory: boolean
}

export const RIOHS_SECTIONS: readonly RiohsSection[] = [
  {
    id: "preambulo",
    title: "Preámbulo: objetivo, alcance y mención al art. 67 de la ley 16.744",
    legalBasis: "DS 44 art. 58 n°1",
    mandatory: true,
  },
  {
    id: "examenes_medicos",
    title: "Procedimientos para exámenes médicos y psicotécnicos (pre-ocupacionales, ocupacionales y de término)",
    legalBasis: "DS 44 art. 58 n°2 letra a)",
    mandatory: true,
  },
  {
    id: "notificacion_investigacion",
    title: "Procedimientos de notificación e investigación de accidentes y enfermedades profesionales",
    legalBasis: "DS 44 art. 58 n°2 letra b)",
    mandatory: true,
  },
  {
    id: "facilidades_cphs",
    title: "Facilidades para el funcionamiento del Comité Paritario y del Departamento de Prevención",
    legalBasis: "DS 44 art. 58 n°2 letra c)",
    mandatory: true,
  },
  {
    id: "responsabilidades_jefaturas",
    title: "Responsabilidades de jefaturas y líneas operativas en prevención de riesgos",
    legalBasis: "DS 44 art. 58 n°2 letra d)",
    mandatory: true,
  },
  {
    id: "epp",
    title: "Procedimientos para selección, uso y mantención de elementos de protección personal",
    legalBasis: "DS 44 art. 58 n°2 letra e)",
    mandatory: true,
  },
  {
    id: "riesgo_grave",
    title: "Procedimiento ante riesgo grave e inminente para la vida y salud",
    legalBasis: "DS 44 art. 58 n°2 letra f)",
    mandatory: true,
  },
  {
    id: "plan_emergencia",
    title: "Procedimiento para cumplir el plan de gestión de emergencias, catástrofes o desastres",
    legalBasis: "DS 44 art. 58 n°2 letra g)",
    mandatory: true,
  },
  {
    id: "propuestas_reclamos",
    title: "Procedimientos para propuestas de mejoramiento y reclamos sobre condiciones de trabajo",
    legalBasis: "DS 44 art. 58 n°2 letra h)",
    mandatory: true,
  },
  {
    id: "obligaciones",
    title: "Capítulo de obligaciones de las personas trabajadoras",
    legalBasis: "DS 44 art. 59",
    mandatory: true,
  },
  {
    id: "prohibiciones",
    title: "Capítulo de prohibiciones",
    legalBasis: "DS 44 art. 60",
    mandatory: true,
  },
  {
    id: "sanciones",
    title: "Sanciones a las infracciones del reglamento",
    legalBasis: "DS 44 art. 61",
    mandatory: true,
  },
] as const

export const RIOHS_SECTION_IDS = RIOHS_SECTIONS.map((section) => section.id)

/** Estado que se guarda en `sstDocuments.extraMetadata`. */
export interface RiohsMetadata {
  riohsSections?: string[]
  sentToDtOn?: string | null
  sentToSeremiOn?: string | null
}

export interface RiohsCompleteness {
  checked: string[]
  missing: RiohsSection[]
  percent: number
  complete: boolean
}

/**
 * Qué capítulos del art. 58 están declarados y cuáles faltan.
 *
 * Se ignoran los ids desconocidos: si mañana se retira un capítulo del
 * catálogo, un reglamento viejo no debe quedar con un porcentaje inflado por
 * marcas que ya no corresponden a nada.
 */
export function assessRiohsCompleteness(checked: readonly string[] | null | undefined): RiohsCompleteness {
  const valid = new Set((checked ?? []).filter((id) => RIOHS_SECTION_IDS.includes(id)))
  const mandatory = RIOHS_SECTIONS.filter((section) => section.mandatory)
  const missing = mandatory.filter((section) => !valid.has(section.id))
  return {
    checked: RIOHS_SECTION_IDS.filter((id) => valid.has(id)),
    missing,
    percent: mandatory.length === 0 ? 100 : Math.round(((mandatory.length - missing.length) / mandatory.length) * 100),
    complete: missing.length === 0,
  }
}

/** Slug del tipo documental; el gate de publicación se activa sólo para éste. */
export const RIOHS_DOCUMENT_TYPE_CODE = "RIOHS"
export const RIOHS_DOCUMENT_CATEGORY_SLUG = "legal_normativa"
