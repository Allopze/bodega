/**
 * Interacciones preventivas con externos — etiquetas y reglas puras.
 * Sin I/O: todo lo de acá es testeable sin base de datos.
 */

export const ENGAGEMENT_KIND_LABELS: Record<string, string> = {
  coordinacion: "Coordinación preventiva",
  fiscalizacion: "Fiscalización",
  organismo_administrador: "Visita del organismo administrador",
}

export const ENGAGEMENT_DIRECTION_LABELS: Record<string, string> = {
  received: "Recibida",
  delivered: "Entregada",
}

export const COUNTERPARTY_TYPE_LABELS: Record<string, string> = {
  mandante: "Mandante",
  contratista: "Contratista",
  subcontratista: "Subcontratista",
  otra_empresa_faena: "Otra empresa en la faena",
  direccion_trabajo: "Dirección del Trabajo",
  seremi_salud: "SEREMI de Salud",
  organismo_administrador: "Organismo administrador",
  otro: "Otro",
}

/** Qué se informa en una coordinación del art. 20. */
export const COORDINATION_INFO_TYPES = ["riesgos", "medidas", "plan_emergencia"] as const
export type CoordinationInfoType = typeof COORDINATION_INFO_TYPES[number]

export const COORDINATION_INFO_LABELS: Record<CoordinationInfoType, string> = {
  riesgos: "Riesgos laborales existentes",
  medidas: "Medidas preventivas adoptadas",
  plan_emergencia: "Plan de emergencia, catástrofe o desastre",
}

export function engagementKindBadgeVariant(kind: string): "info" | "warning" | "default" {
  if (kind === "fiscalizacion") return "warning"
  if (kind === "organismo_administrador") return "info"
  return "default"
}

export interface ReciprocityInput {
  kind: string
  direction: string
  infoTypes?: string[] | null
}

export interface ReciprocityAssessment {
  /** Tipos de información que se recibieron de alguna contraparte. */
  received: CoordinationInfoType[]
  /** Tipos de información que se entregaron a alguna contraparte. */
  delivered: CoordinationInfoType[]
  /** Recibidos sin su contraparte entregada: la mitad que suele faltar. */
  missingDelivery: CoordinationInfoType[]
  compliant: boolean
}

/**
 * El DS 44 art. 20 es simétrico: *"todas ellas tendrán el deber de coordinar y
 * cooperar... deberán informarse mutuamente de los riesgos laborales
 * existentes, las medidas preventivas adoptadas y de los planes de emergencia"*.
 *
 * En la práctica el mandante exige información y casi nadie registra la que
 * entregó. Una faena que sólo tiene registros `received` no cumple el artículo,
 * y ésta es la función que lo detecta.
 *
 * Sólo mira `coordinacion`: una fiscalización recibida no exige nada a cambio.
 */
export function assessArt20Reciprocity(records: readonly ReciprocityInput[]): ReciprocityAssessment {
  const received = new Set<CoordinationInfoType>()
  const delivered = new Set<CoordinationInfoType>()

  for (const record of records) {
    if (record.kind !== "coordinacion") continue
    const bucket = record.direction === "delivered" ? delivered : received
    for (const type of record.infoTypes ?? []) {
      if ((COORDINATION_INFO_TYPES as readonly string[]).includes(type)) bucket.add(type as CoordinationInfoType)
    }
  }

  const missingDelivery = COORDINATION_INFO_TYPES.filter((type) => received.has(type) && !delivered.has(type))
  return {
    received: COORDINATION_INFO_TYPES.filter((type) => received.has(type)),
    delivered: COORDINATION_INFO_TYPES.filter((type) => delivered.has(type)),
    missingDelivery,
    // Sin ningún registro no hay incumplimiento que declarar: puede que la
    // faena no comparta centro de trabajo con nadie.
    compliant: missingDelivery.length === 0,
  }
}

/**
 * Identificador estable de cada medida prescrita dentro de una visita.
 *
 * Alimenta `sourceItemId` de CAPA, que tiene índice único junto a `sourceType`:
 * reintentar el registro de la misma medida no duplica la acción correctiva.
 * El `n` debe ser monotónico por orden de creación — si se numerara por índice
 * de arreglo, reordenar las medidas dejaría CAPAs huérfanas apuntando a un
 * número que ahora corresponde a otra medida.
 */
export function engagementMeasureKey(engagementId: string, n: number): string {
  return `${engagementId}:${n}`
}
