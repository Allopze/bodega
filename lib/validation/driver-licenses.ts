import { z } from "zod"
import { civilDate } from "./dates"

/**
 * Clases de licencia de conducir (Ley de Tránsito, art. 12) más las profesionales
 * «antiguas» A1/A2 que siguen vigentes en licencias emitidas antes de la reforma
 * de 1997. Los códigos son lo que se guarda en `worker_driver_licenses.classes`
 * y en `worker_positions.required_license_classes`; la restricción de la tabla
 * repite esta lista y `driver-licenses.test.ts` verifica que no se desalineen.
 */
export const DRIVER_LICENSE_CLASSES = [
  "A1", "A2", "A3", "A4", "A5",
  "A1_ANTIGUA", "A2_ANTIGUA",
  "B", "C", "D", "E", "F",
] as const

export type DriverLicenseClass = (typeof DRIVER_LICENSE_CLASSES)[number]

export interface DriverLicenseClassInfo {
  code: DriverLicenseClass
  /** Lo que se ve en la etiqueta: «A4», «A2 antigua». */
  short: string
  /** Nombre completo para `title`, lector de pantalla y ayuda. */
  name: string
  group: "profesional" | "no_profesional" | "especial" | "antigua"
}

export const DRIVER_LICENSE_CLASS_INFO: Record<DriverLicenseClass, DriverLicenseClassInfo> = {
  A1: { code: "A1", short: "A1", name: "Taxis", group: "profesional" },
  A2: { code: "A2", short: "A2", name: "Taxis, ambulancias y transporte de 10 a 17 pasajeros", group: "profesional" },
  A3: { code: "A3", short: "A3", name: "Transporte de pasajeros sin límite de asientos", group: "profesional" },
  A4: { code: "A4", short: "A4", name: "Transporte de carga simple de más de 3.500 kg", group: "profesional" },
  A5: { code: "A5", short: "A5", name: "Transporte de carga articulada de más de 3.500 kg", group: "profesional" },
  A1_ANTIGUA: { code: "A1_ANTIGUA", short: "A1 antigua", name: "Profesional antigua: taxis y transporte de pasajeros", group: "antigua" },
  A2_ANTIGUA: { code: "A2_ANTIGUA", short: "A2 antigua", name: "Profesional antigua: transporte de pasajeros y carga", group: "antigua" },
  B: { code: "B", short: "B", name: "Vehículos particulares de hasta 3.500 kg", group: "no_profesional" },
  C: { code: "C", short: "C", name: "Motocicletas", group: "no_profesional" },
  D: { code: "D", short: "D", name: "Maquinaria automotriz (tractores, grúas, cargadores)", group: "especial" },
  E: { code: "E", short: "E", name: "Vehículos de tracción animal", group: "especial" },
  F: { code: "F", short: "F", name: "Vehículos de las Fuerzas Armadas y de Orden", group: "especial" },
}

export const DRIVER_LICENSE_CLASS_GROUPS: Array<{ id: DriverLicenseClassInfo["group"]; label: string }> = [
  { id: "profesional", label: "Profesionales" },
  { id: "no_profesional", label: "No profesionales" },
  { id: "especial", label: "Especiales" },
  { id: "antigua", label: "Antiguas" },
]

const CLASS_SET = new Set<string>(DRIVER_LICENSE_CLASSES)
export const isDriverLicenseClass = (value: string): value is DriverLicenseClass => CLASS_SET.has(value)

/** Orden canónico (el de la lista), sin duplicados. */
export function sortLicenseClasses(classes: readonly string[]): DriverLicenseClass[] {
  const present = new Set(classes)
  return DRIVER_LICENSE_CLASSES.filter((code) => present.has(code))
}

/** «A2, A4 o B»: para «su cargo exige …». */
export function formatLicenseClassList(classes: readonly string[], conjunction: "o" | "y" = "o"): string {
  const labels = sortLicenseClasses(classes).map((code) => DRIVER_LICENSE_CLASS_INFO[code].short)
  if (labels.length <= 1) return labels[0] ?? ""
  return `${labels.slice(0, -1).join(", ")} ${conjunction} ${labels[labels.length - 1]}`
}

/**
 * ¿La licencia habilita lo que el cargo exige? `required` vacío = el cargo no
 * exige una clase en particular. Basta una coincidencia («exige A4 o A5»).
 */
export function licenseSatisfies(held: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true
  const set = new Set(held)
  return required.some((code) => set.has(code))
}

/**
 * Lee las clases escritas a mano en la planilla: «A2/A4/A5/B», «a1,a2,b,d»,
 * «a3, a5», «A2 Antigua/B». Lo que no reconoce lo devuelve aparte para
 * informarlo, nunca lo descarta en silencio.
 */
export function parseLicenseClasses(raw: string | null | undefined): { classes: DriverLicenseClass[]; unrecognized: string[] } {
  if (!raw) return { classes: [], unrecognized: [] }
  const tokens = String(raw)
    .split(/[\/,;+|]|\s+y\s+|\s*-\s+/i)
    .map((token) => token.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase())
    .filter(Boolean)
  const found = new Set<DriverLicenseClass>()
  const unrecognized: string[] = []
  for (const token of tokens) {
    const compact = token.replace(/\s+/g, " ")
    const antigua = /^(A[12])\s*(ANTIGUA|ANT\.?)$/.exec(compact)
    if (antigua) { found.add(`${antigua[1]}_ANTIGUA` as DriverLicenseClass); continue }
    const plain = compact.replace(/^CLASE\s+/, "")
    if (isDriverLicenseClass(plain)) { found.add(plain); continue }
    unrecognized.push(token)
  }
  return { classes: sortLicenseClasses([...found]), unrecognized }
}

export const DRIVER_LICENSE_NOTES_MAX = 300

export const driverLicenseClassesSchema = z
  .array(z.string().trim())
  .transform((values) => [...new Set(values)])
  .pipe(z.array(z.enum(DRIVER_LICENSE_CLASSES, { message: "Clase de licencia no reconocida" })))

export const driverLicenseSchema = z.object({
  workerId: z.string().trim().min(1, "Trabajador requerido"),
  classes: driverLicenseClassesSchema.refine((v) => v.length > 0, "Marca al menos una clase"),
  expiresAt: civilDate("Fecha de vencimiento inválida").nullable(),
  notes: z.string().trim().max(DRIVER_LICENSE_NOTES_MAX, `Máximo ${DRIVER_LICENSE_NOTES_MAX} caracteres`).nullable(),
})

export type DriverLicenseInput = z.infer<typeof driverLicenseSchema>

/**
 * Estado de un conductor, en orden de precedencia: lo que impide conducir hoy
 * primero (vencida, sin licencia), después lo que no calza con el cargo, después
 * lo que vencerá. Un estado por fila; nunca dos pastillas para la misma persona.
 */
export const DRIVER_STATUSES = ["vencida", "sin_licencia", "clase_insuficiente", "por_vencer", "vigente", "sin_fecha"] as const
export type DriverStatus = (typeof DRIVER_STATUSES)[number]

export const DRIVER_STATUS_LABEL: Record<DriverStatus, string> = {
  vencida: "Vencida",
  sin_licencia: "Sin licencia",
  clase_insuficiente: "Clase insuficiente",
  por_vencer: "Por vencer",
  vigente: "Vigente",
  sin_fecha: "Sin fecha",
}

/** Lo que entra en «Requieren atención». `sin_fecha` también: una licencia sin fecha no se puede controlar. */
export const DRIVER_ATTENTION_STATUSES: ReadonlySet<DriverStatus> = new Set(["vencida", "sin_licencia", "clase_insuficiente", "por_vencer", "sin_fecha"])
