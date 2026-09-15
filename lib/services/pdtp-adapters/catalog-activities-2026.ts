import source from "@/db/seed/pdtp-catalog-2026.json"

export type PdtpCatalogActivityManifestEntry = {
  id: string
  code: string
  legacyNumber: number
  title: string
  description: string
  executionGuidance: string
  revision: 1
  status: "active" | "retired"
}

const TITLES: Record<number, string> = {
  1: "Aprobar el programa preventivo",
  2: "Difundir el plan a gerencias y subgerencias",
  3: "Difundir el plan en faenas y comités paritarios",
  5: "Controlar la gestión preventiva de la línea de mando",
  6: "Revisar la gestión preventiva de faena",
  7: "Enviar estadísticas de seguridad de la faena",
  9: "Revisar la gestión preventiva corporativa",
  10: "Verificar condiciones ambientales básicas",
  11: "Constituir y mantener el comité paritario",
  12: "Capacitar a integrantes del comité paritario",
  13: "Realizar reuniones del comité paritario",
  14: "Ejecutar el plan de trabajo del comité paritario",
  15: "Dictar inducción de riesgos laborales",
  16: "Evaluar la capacitación de riesgos laborales",
  17: "Identificar personas trabajadoras especialmente sensibles",
  18: "Entregar y capacitar sobre el reglamento interno",
  19: "Mantener carpetas de requisitos legales",
  20: "Coordinar programas preventivos con la empresa mandante",
  21: "Cerrar y seguir accidentes e incidentes",
  22: "Controlar plataformas de acreditación",
  23: "Registrar entrega de EPP por cargo",
  24: "Inspeccionar el estado de los extintores",
  25: "Completar reportes diarios de equipos",
  26: "Revisar y firmar reportes diarios de equipos",
  27: "Inspeccionar taller y bodega RESPEL",
  28: "Revisar y cerrar inspecciones de equipos",
  29: "Inspeccionar contenedores de la faena",
  30: "Realizar alcotest por Prevención",
  31: "Realizar alcotest en turnos",
  32: "Enviar registros de alcotest",
  33: "Inspeccionar equipos y documentación por Prevención",
  34: "Inspeccionar equipos y documentación por línea de mando",
  35: "Mantener actualizado el inventario de riesgos MIPER",
  36: "Difundir la matriz de riesgos MIPER",
  37: "Realizar charlas participativas de seguridad",
  38: "Realizar diálogos diarios de seguridad por turno",
  39: "Observar y corregir conductas inseguras",
  40: "Inspeccionar y corregir condiciones de trabajo",
  41: "Realizar caminatas de seguridad",
  42: "Controlar informes de sanitización y plagas",
  43: "Revisar procedimientos de trabajo seguro",
  44: "Coordinar evaluaciones cualitativas con la mutual",
  45: "Coordinar evaluaciones cuantitativas con la mutual",
  46: "Desarrollar y seguir el protocolo PREXOR",
  47: "Desarrollar y seguir el protocolo TMERT y MMC",
  48: "Desarrollar y seguir el protocolo psicosocial",
  49: "Desarrollar y seguir el protocolo de radiación UV",
  50: "Controlar trabajadores en vigilancia ocupacional",
  51: "Planificar capacitaciones según necesidades",
  52: "Completar la habilitación preventiva de nuevos trabajadores",
  53: "Realizar charla diaria de seguridad y salud",
  54: "Capacitar sobre uso de extintores",
  55: "Capacitar en primeros auxilios",
  56: "Capacitar en manejo defensivo",
  57: "Capacitar en comunicación efectiva",
  58: "Capacitar a coordinadores de gestión de riesgos",
  59: "Capacitar en investigación mediante árbol causal",
  60: "Capacitar en liderazgo a la línea de mando",
  61: "Controlar certificados de idoneidad de EPP",
  62: "Documentar la entrega de EPP",
  63: "Capacitar sobre uso, reposición y eliminación de EPP",
  64: "Inspeccionar uso y estado de EPP por jefatura de terreno",
  65: "Inspeccionar uso y estado de EPP por Prevención",
  66: "Informar incidentes a la administración de contrato",
  67: "Informar incidentes a la jefatura de Prevención",
  68: "Enviar informe preliminar a la administración de contrato",
  69: "Recabar declaración de la persona involucrada",
  70: "Enviar informe preliminar a la dirección corporativa",
  71: "Difundir inmediatamente el incidente en los turnos",
  72: "Emitir la declaración individual de accidente del trabajo",
  73: "Investigar accidentes e incidentes",
  74: "Enviar el informe definitivo de investigación",
  75: "Difundir medidas preventivas de la investigación",
  76: "Dar seguimiento a medidas correctivas",
  77: "Archivar antecedentes de accidentes e incidentes",
  78: "Enviar la difusión de una página",
  79: "Constituir el comité de gestión de riesgos de desastres",
  80: "Implementar la matriz de gestión de riesgos de desastres",
  81: "Registrar reuniones del comité de gestión de riesgos",
  82: "Elaborar mapas de riesgos",
  83: "Elaborar planes de emergencia por amenaza",
  84: "Realizar simulacros de emergencia",
  85: "Promover vida y alimentación saludable",
  86: "Capacitar en manejo del estrés",
  87: "Prevenir alcohol y drogas al volante",
  88: "Capacitar en seguridad vial",
  89: "Capacitar sobre puntos ciegos",
}

const RETIRED_NUMBERS = new Set([2, 5, 12, 13, 14, 21])

/** Correcciones ya aplicadas a las filas locales después de congelar el XLSX. */
export const PDTP_2026_LOCAL_CONTENT_OVERRIDES: Readonly<Record<number, { description?: string; executionGuidance?: string }>> = {
  3: { description: "Difundir el Plan a todos los niveles de la organización en las faenas" },
  23: { executionGuidance: "Cada vez que ingresa un trabajador nuevo se debe mantener este registro" },
  69: { description: "Encuesta o declaración de la persona trabajadora accidentada involucrada en el incidente." },
}

function semanticCode(n: number, title: string): string {
  const topic = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-")
  return `PDT-${String(n).padStart(3, "0")}-${topic}`
}

export const PDTP_2026_CATALOG_ACTIVITIES: readonly PdtpCatalogActivityManifestEntry[] = source.activities.map((row) => {
  const title = TITLES[row.n]
  const override = PDTP_2026_LOCAL_CONTENT_OVERRIDES[row.n]
  if (!title) throw new Error(`Falta el título corporativo de la actividad histórica N°${row.n}.`)
  return {
    id: `pdtp-catalog-${String(row.n).padStart(3, "0")}`,
    code: semanticCode(row.n, title),
    legacyNumber: row.n,
    title,
    description: override?.description ?? row.activity,
    executionGuidance: override?.executionGuidance ?? row.program,
    revision: 1,
    status: RETIRED_NUMBERS.has(row.n) ? "retired" : "active",
  }
})

const PDTP_2026_CATALOG_ID_BY_LEGACY_NUMBER = new Map<number, string>(
  PDTP_2026_CATALOG_ACTIVITIES.map((activity) => [activity.legacyNumber, activity.id]),
)
const PDTP_2026_LEGACY_NUMBER_BY_CATALOG_ID = new Map(
  PDTP_2026_CATALOG_ACTIVITIES.map((activity) => [activity.id, activity.legacyNumber]),
)

/** Puente explícito del primer despliegue: el número sólo indexa la
 * manifestación congelada y el evento recibe la identidad estable. */
export function pdtpCatalogActivityIdForLegacyNumber(legacyNumber: number): string {
  const id = PDTP_2026_CATALOG_ID_BY_LEGACY_NUMBER.get(legacyNumber)
  if (!id) throw new Error(`La actividad histórica N°${legacyNumber} no tiene identidad de catálogo.`)
  return id
}

export function pdtpCatalogActivityIdsForLegacyNumbers(legacyNumbers: readonly number[]): string[] {
  return legacyNumbers.map(pdtpCatalogActivityIdForLegacyNumber)
}

/** Sólo para compatibilidad del primer despliegue y fixtures previos al
 * backfill. Las identidades nuevas no tienen ni reciben un número global. */
export function legacyPdtpActivityNumberForCatalogId(catalogActivityId: string): number | null {
  return PDTP_2026_LEGACY_NUMBER_BY_CATALOG_ID.get(catalogActivityId) ?? null
}
