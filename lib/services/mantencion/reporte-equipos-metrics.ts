import { bucketKey, isPartialBucket, listBuckets, type IndicatorGranularity } from "@/lib/indicators/period"

/**
 * Cálculos puros de la sección «Reportes de equipos» del Panel de mantención: sin base de datos ni
 * React, para probarlos con casos escritos a mano (`reporte-equipos-metrics.test.ts`). La consulta
 * que alimenta estas funciones vive en `reporte-equipos.ts`.
 *
 * Qué es un «reporte»: una ejecución del motor de inspecciones con la plantilla `reporte_equipos`
 * (el reporte diario en papel de cada equipo, transcrito por el jefe de faena). Hay una por equipo y
 * por día esperado: los programas ya las materializan, así que acá no se recalcula ningún calendario.
 *
 * La fecha de un reporte es la del turno (`scheduledFor`), no la de la transcripción: el papel se
 * pasa a la plataforma días después. Sólo si falta, la fecha civil de Chile de `executedAt`.
 */

export const REPORTE_EQUIPOS_CODE = "reporte_equipos"

/**
 * Nombre de la plantilla en la bandeja de Inspecciones. La bandeja no filtra por plantilla, pero su
 * búsqueda de texto (`q`) sí mira el nombre de la plantilla: es el único modo, sin inventar un
 * filtro, de llevar a quien hace clic a estos reportes y no a todas las inspecciones.
 */
export const REPORTE_EQUIPOS_TEMPLATE_NAME = "Reporte de Equipos"

/** Triple firma del papel; sólo se usa cuando el snapshot de la plantilla no declara sus roles. */
export const DEFAULT_SIGNATURE_ROLES = ["operador_entrante", "operador_saliente", "supervisor_turno"] as const

/** Un reporte «recibido» es uno ya transcrito: completado o, si alguien lo revisó, revisado. */
export function isReceivedStatus(status: string): boolean {
  return status === "completed" || status === "reviewed"
}

// ── Horómetro ──────────────────────────────────────────────────────────────

/**
 * Lectura de horómetro escrita a mano. El formulario pide «sin separador de miles», pero el texto
 * llega de una transcripción y trae coma decimal («5400,5»), punto decimal («5400.5») y, a veces,
 * miles («134.122,5»). Convención es-CL: con los dos signos, el último es el decimal; una sola coma
 * es decimal; un solo punto es decimal salvo que le sigan exactamente tres dígitos (miles).
 * Devuelve `null` si no es un número no negativo reconocible.
 */
export function parseMeterReading(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const text = raw.replace(/[\s ]/g, "")
  if (!text || !/^\d[\d.,]*$/.test(text)) return null
  const lastComma = text.lastIndexOf(",")
  const lastDot = text.lastIndexOf(".")
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot)
    const thousands = decimalAt === lastComma ? "." : ","
    normalized = `${text.slice(0, decimalAt).split(thousands).join("")}.${text.slice(decimalAt + 1)}`
  } else if (lastComma >= 0) {
    normalized = text.split(",").length > 2 ? text.split(",").join("") : text.replace(",", ".")
  } else if (lastDot >= 0) {
    const dots = text.split(".").length - 1
    const afterLastDot = text.length - lastDot - 1
    normalized = dots > 1 || afterLastDot === 3 ? text.split(".").join("") : text
  } else {
    normalized = text
  }
  // Lo que quede con otro separador (miles mal puestos) no es un número que se pueda sumar.
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Más que un día no cabe en un turno: una diferencia mayor es un error de lectura o un odómetro en km. */
export const MAX_OPERATED_HOURS = 24

/**
 * Horas operadas en un reporte: `término − inicio`, sólo si ambas lecturas existen y la diferencia
 * está entre 0 y 24 h. Un valor fuera de ese rango (término menor que inicio, un dígito de más,
 * un odómetro en kilómetros) no se suma: sumarlo inflaría el total en miles de horas.
 */
export function operatedHours(start: string | null | undefined, end: string | null | undefined): number | null {
  const from = parseMeterReading(start)
  const to = parseMeterReading(end)
  if (from === null || to === null) return null
  const hours = Math.round((to - from) * 100) / 100
  return hours >= 0 && hours <= MAX_OPERATED_HOURS ? hours : null
}

// ── Firmas ─────────────────────────────────────────────────────────────────

/** Roles que firman según el snapshot de la plantilla; si no los declara (o vienen mal), los tres del papel. */
export function normalizeSignatureRoles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SIGNATURE_ROLES]
  const roles = raw.filter((role): role is string => typeof role === "string" && role.trim() !== "")
  return roles.length > 0 ? roles : [...DEFAULT_SIGNATURE_ROLES]
}

/** ¿Trae el acta cada rol exigido con un nombre? Una firma con el nombre en blanco no es una firma. */
export function hasAllSignatures(signatures: unknown, requiredRoles: readonly string[]): boolean {
  if (!Array.isArray(signatures)) return false
  const signed = new Set<string>()
  for (const entry of signatures) {
    if (!entry || typeof entry !== "object") continue
    const { role, name } = entry as { role?: unknown; name?: unknown }
    if (typeof role === "string" && typeof name === "string" && name.trim() !== "") signed.add(role)
  }
  return requiredRoles.every((role) => signed.has(role))
}

// ── Reportes esperados y recibidos ─────────────────────────────────────────

export interface ReportRunRow {
  /** Fecha civil del reporte (`YYYY-MM-DD`); `null` si no se puede ubicar en el calendario. */
  date: string | null
  status: string
}

export interface CoveragePoint {
  key: string
  expected: number
  received: number
  /** El balde en curso: sus cifras valen sólo hasta hoy. */
  partial: boolean
}

export interface ReportCoverage {
  expected: number
  received: number
  /** `null` sin reportes esperados: no hay porcentaje que inventar. */
  percent: number | null
  points: CoveragePoint[]
}

/**
 * Esperados = reportes no cancelados con fecha dentro del período y no posterior a hoy (lo futuro
 * no se espera todavía). Recibidos = de esos, los completados o revisados. Un reporte cancelado no
 * se esperaba: el jefe de faena lo anuló porque el equipo no operó.
 */
export function summarizeCoverage(
  runs: readonly ReportRunRow[],
  query: { from: string; to: string; granularity: IndicatorGranularity; today: string },
): ReportCoverage {
  const to = query.to < query.today ? query.to : query.today
  const keys = to >= query.from ? listBuckets(query.from, to, query.granularity) : []
  const points = new Map<string, CoveragePoint>(
    keys.map((key) => [key, { key, expected: 0, received: 0, partial: isPartialBucket(key, query.granularity, query.today) && to >= query.today }]),
  )
  let expected = 0
  let received = 0
  for (const run of runs) {
    if (run.status === "cancelled" || !run.date || run.date < query.from || run.date > to) continue
    expected += 1
    const point = points.get(bucketKey(run.date, query.granularity))
    if (point) point.expected += 1
    if (isReceivedStatus(run.status)) {
      received += 1
      if (point) point.received += 1
    }
  }
  return { expected, received, percent: expected > 0 ? (received / expected) * 100 : null, points: keys.map((key) => points.get(key)!) }
}

// ── Fallas por sistema ─────────────────────────────────────────────────────

/** Sistemas en que se agrupan los ítems del papel. El orden es el de la leyenda, no el de tamaño. */
export const FAILURE_SYSTEMS = [
  { id: "electrico", label: "Eléctrico", items: ["luces", "baliza", "bocina", "alarma_retroceso", "tableros_instrumentos"] },
  { id: "frenos_direccion", label: "Frenos y dirección", items: ["freno_servicio", "freno_estacionamiento", "direccion"] },
  { id: "neumaticos", label: "Neumáticos y rodado", items: ["neumaticos_llantas", "pernos_tuercas_rueda"] },
  { id: "fluidos", label: "Fluidos y fugas", items: ["fuga_aceite_frenos", "nivel_agua", "nivel_aceite_motor", "nivel_aceite_hidraulico"] },
  { id: "carroceria", label: "Carrocería y cabina", items: ["estado_carroceria", "espejos", "estado_asiento"] },
  { id: "seguridad", label: "Seguridad", items: ["cinturon_seguridad", "extintor"] },
  { id: "implemento", label: "Implemento", items: ["estado_rotor", "estado_garra", "estado_link_pasadores", "estado_orugas", "estado_balde", "estado_ampliroll"] },
] as const

export const OTHER_SYSTEM = { id: "otros", label: "Otros" } as const

const SYSTEM_BY_ITEM: ReadonlyMap<string, { id: string; label: string }> = new Map(
  FAILURE_SYSTEMS.flatMap((system) => system.items.map((item) => [item, { id: system.id, label: system.label }] as const)),
)

/** Los ítems del acoplado son el espejo de los del camión (`acoplado_<ítem>`) y cuentan en su mismo sistema. */
export function failureSystemOf(itemId: string): { id: string; label: string } {
  const base = itemId.startsWith("acoplado_") ? itemId.slice("acoplado_".length) : itemId
  return SYSTEM_BY_ITEM.get(base) ?? OTHER_SYSTEM
}

export interface SystemFailureCount {
  id: string
  label: string
  count: number
}

/** Ocurrencias de falla (una por respuesta «no cumple») por sistema, de mayor a menor; sin los sistemas sin fallas. */
export function countFailuresBySystem(itemIds: readonly string[]): SystemFailureCount[] {
  const counts = new Map<string, SystemFailureCount>()
  for (const itemId of itemIds) {
    const system = failureSystemOf(itemId)
    const entry = counts.get(system.id) ?? { ...system, count: 0 }
    entry.count += 1
    counts.set(system.id, entry)
  }
  const order = new Map<string, number>([...FAILURE_SYSTEMS.map((system) => system.id), OTHER_SYSTEM.id].map((id, index) => [id, index]))
  return [...counts.values()].sort((a, b) => b.count - a.count || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
}

// ── Fallas abiertas y su antigüedad ────────────────────────────────────────

/** Una lectura de un ítem en un reporte de un equipo (cualquier orden de llegada). */
export interface ItemReading {
  date: string
  result: string
}

/**
 * Cuándo se detectó la falla vigente de un ítem: la fecha del primer reporte de la racha actual en
 * que salió en falla, sin un reporte intermedio que lo marcara conforme.
 *
 * - «Racha actual» es la última racha de fallas: se parte del reporte más reciente con falla y se
 *   retrocede mientras no aparezca un día en que el ítem salió conforme.
 * - Sólo «conforme» corta la racha. Un «no aplica» o un ítem sin responder no dicen que la falla se
 *   arregló, así que no la interrumpen.
 * - Dos reportes el mismo día (turnos): si uno marca falla, el día cuenta como falla.
 *
 * Devuelve `null` si no hay ninguna lectura con falla.
 */
export function detectionDate(readings: readonly ItemReading[]): string | null {
  const byDay = new Map<string, "fail" | "ok" | "neutral">()
  for (const reading of readings) {
    const kind = reading.result === "non_conforming" ? "fail" : reading.result === "conforming" ? "ok" : "neutral"
    const current = byDay.get(reading.date)
    if (kind === "fail" || current === undefined || (kind === "ok" && current === "neutral")) byDay.set(reading.date, kind)
  }
  const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  let last = -1
  for (let index = days.length - 1; index >= 0; index--) {
    if (days[index]![1] === "fail") { last = index; break }
  }
  if (last < 0) return null
  let first = last
  for (let index = last - 1; index >= 0; index--) {
    const kind = days[index]![1]
    if (kind === "ok") break
    if (kind === "fail") first = index
  }
  return days[first]![0]
}

/** Días civiles entre dos fechas `YYYY-MM-DD` (`to − from`, nunca negativo). */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

export const AGE_BUCKETS = [
  { id: "fresh", label: "0 a 3 días", max: 3 },
  { id: "week", label: "4 a 7 días", max: 7 },
  { id: "old", label: "Más de 7 días", max: Number.POSITIVE_INFINITY },
] as const

export type AgeBucketId = (typeof AGE_BUCKETS)[number]["id"]

export function ageBucketOf(days: number): AgeBucketId {
  return AGE_BUCKETS.find((bucket) => days <= bucket.max)!.id
}

/** Un hallazgo sin cerrar de un reporte, ya ubicado en su equipo y su ítem. */
export interface OpenFindingRow {
  id: string
  /** Equipo del reporte; `null` si el equipo ya no existe. */
  vehicleId: string | null
  /** Ítem del papel; `null` en una desviación registrada a mano, que no sale de una respuesta. */
  itemId: string | null
  criticality: string
  /** Fecha civil de Chile en que se levantó el hallazgo. */
  createdDate: string
}

export interface OpenFailure {
  /** Una falla es un ítem de un equipo, no cada reporte que la repite. */
  key: string
  vehicleId: string | null
  itemId: string | null
  /** Algún hallazgo de la falla impacta la seguridad (gravedad alta o crítica). */
  safety: boolean
  detectedOn: string
  ageDays: number
  bucket: AgeBucketId
}

const SAFETY_CRITICALITIES = ["high", "critical"]

export function readingKey(vehicleId: string, itemId: string): string {
  return `${vehicleId}::${itemId}`
}

/**
 * Fallas abiertas: los hallazgos sin cerrar, juntando los que repiten el mismo ítem del mismo equipo.
 * El motor levanta un hallazgo por cada reporte donde el ítem sale en falla, así que un freno que
 * falla cinco días seguidos deja cinco hallazgos abiertos; para quien repara, es una sola falla,
 * y contarla cinco veces la haría ver cinco veces más grave. La antigüedad se cuenta desde la
 * detección (`detectionDate`) con las lecturas de ese equipo e ítem (`readings`, por `readingKey`);
 * sin lecturas, desde el primer hallazgo.
 */
export function buildOpenFailures(
  findings: readonly OpenFindingRow[],
  readings: ReadonlyMap<string, readonly ItemReading[]>,
  today: string,
): OpenFailure[] {
  const groups = new Map<string, OpenFindingRow[]>()
  for (const finding of findings) {
    // Sin equipo o sin ítem no hay con qué juntar: cada hallazgo es su propia falla.
    const key = finding.vehicleId && finding.itemId ? readingKey(finding.vehicleId, finding.itemId) : `finding::${finding.id}`
    const group = groups.get(key)
    if (group) group.push(finding)
    else groups.set(key, [finding])
  }
  return [...groups.entries()].map(([key, group]) => {
    const first = group[0]!
    const earliestFinding = group.reduce((min, row) => (row.createdDate < min ? row.createdDate : min), first.createdDate)
    const detected = first.vehicleId && first.itemId ? detectionDate(readings.get(key) ?? []) : null
    const detectedOn = detected ?? earliestFinding
    const ageDays = daysBetween(detectedOn, today)
    return {
      key,
      vehicleId: first.vehicleId,
      itemId: first.itemId,
      safety: group.some((row) => SAFETY_CRITICALITIES.includes(row.criticality)),
      detectedOn,
      ageDays,
      bucket: ageBucketOf(ageDays),
    }
  })
}
