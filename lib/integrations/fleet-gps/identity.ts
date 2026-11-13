/**
 * Identidad de equipos para los proveedores GPS.
 *
 * OnWay entrega una patente; Wialon nombra la unidad con texto libre y puede
 * traer la patente en una propiedad personalizada. Normalizar de la misma
 * manera en ambos lados evita que el mismo equipo entre dos veces al panel por
 * una diferencia de guion, tilde o mayúscula.
 */

export function normalizeGpsKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
}

/** Alias con el nombre que ya usa la reconciliación de OnWay. */
export const normalizePlate = normalizeGpsKey

/**
 * Patentes chilenas: formato nuevo (BBBB11) y antiguo (BB1234). Se aceptan
 * guion, punto, espacio o «·» entre los grupos porque el catálogo y los nombres
 * de unidad las escriben así («Camión CBJY-18», «CB-JY-18», «XX·4243»): sin
 * separadores, la patente embebida nunca calzaba.
 */
const SEP = "[-\\s.\u00b7]?"
const PLATE_PATTERN = new RegExp(
  `\\b[A-Z]{2}${SEP}[A-Z]{2}${SEP}\\d{2}\\b|\\b[A-Z]{2}${SEP}\\d{2}${SEP}\\d{2}\\b`,
  "g",
)

/** Patentes embebidas en un nombre libre, ya normalizadas. */
export function plateCandidatesFromText(value: string): string[] {
  const matches = value.toUpperCase().match(PLATE_PATTERN) ?? []
  return [...new Set(matches.map(normalizeGpsKey))]
}

/**
 * Códigos internos embebidos en un nombre libre, ya normalizados. Las unidades
 * de Wialon se nombran «CARGADOR FRONTAL CR-52», «EXCAVADORA GR-11» o
 * «TO37 D6R»: el código va como una palabra con letras Y dígitos. Una palabra
 * sólo de letras («CAT») o sólo de dígitos («6125») no se toma: calzaría con
 * cualquier cosa.
 */
export function codeCandidatesFromText(value: string): string[] {
  const tokens = value.split(/[\s(),;/]+/).map(normalizeGpsKey)
  return [...new Set(tokens.filter((token) => token.length >= 3 && token.length <= 12 && /[A-Z]/.test(token) && /\d/.test(token)))]
}

export interface VehicleIdentity {
  id: string
  plate: string
  code: string | null
}

export interface VehicleIdentityIndex {
  byPlate: Map<string, VehicleIdentity[]>
  byCode: Map<string, VehicleIdentity[]>
}

export function buildVehicleIdentityIndex(vehicles: readonly VehicleIdentity[]): VehicleIdentityIndex {
  const byPlate = new Map<string, VehicleIdentity[]>()
  const byCode = new Map<string, VehicleIdentity[]>()
  for (const vehicle of vehicles) {
    const plateKey = normalizePlate(vehicle.plate)
    if (plateKey) byPlate.set(plateKey, [...(byPlate.get(plateKey) ?? []), vehicle])
    if (vehicle.code) {
      const codeKey = normalizeGpsKey(vehicle.code)
      if (codeKey) byCode.set(codeKey, [...(byCode.get(codeKey) ?? []), vehicle])
    }
  }
  return { byPlate, byCode }
}

export type VehicleIdentityMatch =
  | { kind: "matched"; vehicle: VehicleIdentity; reason: "plate" | "code" | "text" }
  | { kind: "ambiguous"; candidates: VehicleIdentity[] }
  | { kind: "unmatched" }

function uniqueMatch(candidates: VehicleIdentity[] | undefined): VehicleIdentityMatch {
  if (!candidates || candidates.length === 0) return { kind: "unmatched" }
  if (candidates.length > 1) return { kind: "ambiguous", candidates }
  return { kind: "matched", vehicle: candidates[0]!, reason: "plate" }
}

function withReason(match: VehicleIdentityMatch, reason: "plate" | "code" | "text"): VehicleIdentityMatch {
  return match.kind === "matched" ? { ...match, reason } : match
}

/**
 * Resuelve una identidad contra el catálogo. La patente manda sobre el código;
 * si ambos lados son ambiguos, no se elige: el equipo queda pendiente para que
 * una persona lo vincule.
 */
export function matchVehicleByIdentity(
  input: { plate?: string | null; code?: string | null; name?: string | null },
  index: VehicleIdentityIndex,
): VehicleIdentityMatch {
  if (input.plate) {
    const match = uniqueMatch(index.byPlate.get(normalizePlate(input.plate)))
    if (match.kind !== "unmatched") return match
  }
  if (input.code) {
    const match = uniqueMatch(index.byCode.get(normalizeGpsKey(input.code)))
    if (match.kind !== "unmatched") return withReason(match, "code")
  }
  if (input.name) {
    const exactPlate = uniqueMatch(index.byPlate.get(normalizePlate(input.name)))
    if (exactPlate.kind !== "unmatched") return withReason(exactPlate, "text")
    const exactCode = uniqueMatch(index.byCode.get(normalizeGpsKey(input.name)))
    if (exactCode.kind !== "unmatched") return withReason(exactCode, "text")
    for (const candidate of plateCandidatesFromText(input.name)) {
      const match = uniqueMatch(index.byPlate.get(candidate))
      if (match.kind !== "unmatched") return withReason(match, "text")
    }
    // Código interno dentro del nombre. Si dos palabras apuntan a vehículos
    // distintos, no se elige: queda ambiguo para que una persona lo vincule.
    const byCode = new Map<string, VehicleIdentity>()
    for (const candidate of codeCandidatesFromText(input.name)) {
      const vehicles = index.byCode.get(candidate) ?? []
      if (vehicles.length > 1) return { kind: "ambiguous", candidates: vehicles }
      if (vehicles[0]) byCode.set(vehicles[0].id, vehicles[0])
    }
    if (byCode.size > 1) return { kind: "ambiguous", candidates: [...byCode.values()] }
    const [codeMatch] = byCode.values()
    if (codeMatch) return { kind: "matched", vehicle: codeMatch, reason: "text" }
  }
  return { kind: "unmatched" }
}

export interface PlateResolvable {
  id: string
  plate: string
  meterType: string
}

/**
 * Resolver de patente → vehículo para `saveMeterReadings`.
 *
 * Primero la patente EXACTA del catálogo (la lectura se arma con ella); la
 * normalizada sólo sirve de respaldo cuando es única. OnWay comparaba la
 * patente normalizada del catálogo contra la cruda («CBJY18» vs «CBJY-18») y
 * ninguna lectura `gps_onway` llegó a guardarse.
 */
export function buildVehicleResolverByPlate(
  vehicles: readonly PlateResolvable[],
): (plate: string) => { id: string; meterType: string } | undefined {
  const byExact = new Map(vehicles.map((vehicle) => [vehicle.plate, vehicle]))
  const byNormalized = new Map<string, PlateResolvable | null>()
  for (const vehicle of vehicles) {
    const key = normalizePlate(vehicle.plate)
    if (!key) continue
    byNormalized.set(key, byNormalized.has(key) ? null : vehicle)
  }
  return (plate) => {
    const vehicle = byExact.get(plate) ?? byNormalized.get(normalizePlate(plate)) ?? undefined
    return vehicle ? { id: vehicle.id, meterType: vehicle.meterType } : undefined
  }
}
