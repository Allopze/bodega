import { z } from "zod"
import { todayInChile } from "@/lib/utils"
import { isCivilDate } from "./dates"

/* ── Fechas y dinero ───────────────────────────────────────────────────────── */

const civilDateSchema = z.string().refine(isCivilDate, "Fecha inválida")

/** Fecha civil opcional: "" (FormData vacío) se normaliza a null. */
const optionalCivilDate = civilDateSchema.nullable().optional().or(z.literal(""))

const moneySchema = z.coerce.number()
  .refine(Number.isFinite, "Costo inválido")
  .min(0, "El costo no puede ser negativo")
  .nullable()
  .optional()

const text = (max: number, required = false) => {
  const base = z.string().trim().max(max, `Máximo ${max} caracteres`)
  // Acepta null: los inputs condicionales (p. ej. specs solo si hasSpecs) no
  // viajan en el FormData y formData.get devuelve null. Los consumidores ya
  // normalizan con `?.trim() || null`.
  return required ? base.min(1, "Campo requerido") : base.nullable().optional().or(z.literal(""))
}

/* ── Tipos de activo ───────────────────────────────────────────────────────── */

export const IT_ASSET_CATEGORIES = ["computacion", "periferico", "red", "telefonia", "movilidad", "almacenamiento", "otro"] as const
export type ItAssetCategory = typeof IT_ASSET_CATEGORIES[number]

export const itAssetTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  category: z.enum(IT_ASSET_CATEGORIES, { message: "Categoría no reconocida" }),
  hasSpecs: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
})

/* ── Activos ───────────────────────────────────────────────────────────────── */

export const IT_ASSET_STATUSES = ["disponible", "asignado", "en_prestamo", "en_reparacion", "en_bodega", "dado_de_baja", "perdido", "robado"] as const
export type ItAssetStatus = typeof IT_ASSET_STATUSES[number]

/** Estados que un usuario puede fijar manualmente (los otros los maneja el flujo). */
// 'en_prestamo' no está acá: nace y muere con su acta de entrega (kind:
// "loan"), igual que 'asignado' — no es un estado que se fije a mano.
export const MANUAL_ASSET_STATUSES: readonly ItAssetStatus[] = ["disponible", "en_reparacion", "en_bodega", "perdido", "robado"]

export const itAssetCreateSchema = z.object({
  code: z.string().trim().min(2, "Código interno requerido").max(40),
  assetTypeId: z.string().min(1, "Selecciona el tipo de activo"),
  brand: text(80),
  model: text(80),
  serialNumber: text(80),
  // La custodia y las bajas son las únicas que cambian el estado. Un activo
  // recién registrado todavía no tiene acta ni custodio, por lo que parte
  // siempre disponible.
  status: z.literal("disponible").default("disponible"),
  worksiteId: z.string().nullable().optional().or(z.literal("")),
  location: text(120),
  purchaseDate: optionalCivilDate,
  supplierId: z.string().nullable().optional().or(z.literal("")),
  purchaseDocType: z.enum(["factura", "oc", "otro"]).nullable().optional().or(z.literal("")),
  purchaseDocRef: text(80),
  cost: moneySchema,
  warrantyEndDate: optionalCivilDate,
  processor: text(80),
  ram: text(40),
  storage: text(80),
  os: text(80),
  observations: text(500),
})

export type ItAssetFormData = z.infer<typeof itAssetCreateSchema>

// La edición no altera el estado: ese dato se conserva y solo cambia por los
// flujos trazables de custodia, baja o control de estado. Por eso no reutiliza
// el `status: "disponible"` propio del alta de un activo nuevo.
export const itAssetUpdateSchema = itAssetCreateSchema
  .omit({ status: true })
  .extend({ id: z.string().min(1) })

/** Cambio manual de estado: exige motivo para que la timeline nunca quede muda. */
export const itAssetStatusChangeSchema = z.object({
  assetId: z.string().min(1),
  status: z.enum(MANUAL_ASSET_STATUSES, { message: "Ese estado requiere su flujo formal" }),
  reason: z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres)").max(300),
})

/* ── Asignaciones y custodia ───────────────────────────────────────────────── */

export const IT_ASSIGNMENT_KINDS = ["delivery", "loan", "transfer", "repair_exit"] as const
export const IT_PHYSICAL_STATES = ["bueno", "regular", "malo", "nuevo"] as const
export const IT_RETURN_PHYSICAL_STATES = ["bueno", "regular", "malo"] as const

export const itAssignmentCreateSchema = z.object({
  assetId: z.string().min(1, "Selecciona un activo"),
  workerId: z.string().min(1, "Selecciona un trabajador"),
  worksiteId: z.string().min(1, "Selecciona una faena"),
  kind: z.enum(IT_ASSIGNMENT_KINDS, { message: "Tipo de entrega no reconocido" }).default("delivery"),
  deliveredAt: z.string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), "Fecha de entrega inválida")
    .refine((v) => v <= `${todayInChile()}T23:59`, "La entrega no puede tener fecha futura"),
  physicalState: z.enum(IT_PHYSICAL_STATES, { message: "Estado físico no reconocido" }).default("bueno"),
  observations: text(500),
  accepted: z.coerce.boolean().default(true),
  accessoryNames: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  /** IDs de fotos ya persistidas por el upload previo (stage delivery). */
  photoIds: z.array(z.string().min(1)).max(40).default([]),
})

export const itAssignmentReturnSchema = z.object({
  assignmentId: z.string().min(1),
  returnedAt: z.string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), "Fecha de devolución inválida")
    .refine((v) => v <= `${todayInChile()}T23:59`, "La devolución no puede tener fecha futura"),
  returnPhysicalState: z.enum(IT_RETURN_PHYSICAL_STATES, { message: "Estado físico no reconocido" }).default("bueno"),
  returnObservations: text(500),
  returnedAccessoryNames: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  /** Estado al que vuelve el activo: disponible (por defecto) o en_bodega. */
  nextStatus: z.enum(["disponible", "en_bodega"]).default("disponible"),
  photoIds: z.array(z.string().min(1)).max(40).default([]),
})

/* ── Mantenciones ──────────────────────────────────────────────────────────── */

export const IT_MAINTENANCE_TYPES = ["preventiva", "correctiva", "reparacion", "actualizacion", "revision"] as const

export const itMaintenanceSchema = z.object({
  id: z.string().optional(),
  assetId: z.string().min(1, "Selecciona un activo"),
  type: z.enum(IT_MAINTENANCE_TYPES, { message: "Tipo no reconocido" }).default("correctiva"),
  date: civilDateSchema.refine((v) => v <= todayInChile(), "La fecha no puede ser futura"),
  reportedIssue: text(500),
  diagnosis: text(500),
  workDone: z.string().trim().min(2, "Describe el trabajo realizado").max(1000),
  partsUsed: text(500),
  supplierId: z.string().nullable().optional().or(z.literal("")),
  technicianName: text(80),
  technicianUserId: z.string().nullable().optional().or(z.literal("")),
  cost: moneySchema,
  observations: text(500),
})

/** Anulación de mantención: el motivo es el mismo mínimo que exige el CHECK de BD. */
export const itMaintenanceVoidSchema = z.object({
  id: z.string().min(1, "Mantención no indicada"),
  reason: z.string().trim().min(10, "Explica por qué se anula (mínimo 10 caracteres)").max(500),
})

/* ── Bajas ─────────────────────────────────────────────────────────────────── */

export const IT_RETIREMENT_REASONS = ["venta", "reciclaje", "destruccion", "repuesto", "donacion", "perdida", "robo"] as const

export const itRetirementSchema = z.object({
  assetId: z.string().min(1, "Selecciona un activo"),
  date: civilDateSchema.refine((v) => v <= todayInChile(), "La fecha no puede ser futura"),
  reason: z.enum(IT_RETIREMENT_REASONS, { message: "Motivo no reconocido" }),
  responsibleUserId: z.string().min(1, "Selecciona al responsable"),
  authorizedByUserId: z.string().min(1, "Selecciona quién autoriza"),
  destination: text(200),
  observations: text(500),
}).refine(
  (data) => data.responsibleUserId !== data.authorizedByUserId,
  {
    // Doble control: dar de baja un activo es irreversible y el modelo separa
    // ambos roles a propósito. Nada impedía que fueran la misma persona.
    message: "Quien autoriza la baja debe ser distinto del responsable",
    path: ["authorizedByUserId"],
  },
)

/** Reversión de baja: mismo mínimo de motivo que exige el CHECK de BD. */
export const itRetirementReverseSchema = z.object({
  retirementId: z.string().min(1, "Baja no indicada"),
  reason: z.string().trim().min(10, "Explica por qué se revierte (mínimo 10 caracteres)").max(500),
})

/* ── Tickets ───────────────────────────────────────────────────────────────── */

export const IT_TICKET_CATEGORIES = ["hardware", "software", "correo", "internet", "impresoras", "telefonia", "accesos", "plataforma", "cuentas", "otro"] as const
export const IT_TICKET_PRIORITIES = ["baja", "normal", "alta", "critica"] as const
export const IT_TICKET_STATUSES = ["nuevo", "asignado", "en_diagnostico", "en_progreso", "esperando_usuario", "esperando_proveedor", "resuelto", "cerrado"] as const
export const IT_TICKET_OPEN_STATUSES = ["nuevo", "asignado", "en_diagnostico", "en_progreso", "esperando_usuario", "esperando_proveedor"] as const

export const itTicketCreateSchema = z.object({
  subject: z.string().trim().min(4, "Asunto requerido (mínimo 4 caracteres)").max(120),
  description: z.string().trim().min(10, "Describe el problema (mínimo 10 caracteres)").max(2000),
  category: z.enum(IT_TICKET_CATEGORIES, { message: "Categoría no reconocida" }).default("hardware"),
  priority: z.enum(IT_TICKET_PRIORITIES, { message: "Prioridad no reconocida" }).default("normal"),
  workerId: z.string().nullable().optional().or(z.literal("")),
  worksiteId: z.string().min(1, "Selecciona una faena"),
  assetId: z.string().nullable().optional().or(z.literal("")),
})

/**
 * Grafo de transiciones válidas. Vive en validación (no en el servicio) para
 * que la UI ofrezca únicamente los estados alcanzables: antes el desplegable
 * listaba los 8 estados y el servidor rechazaba la mitad después de que el
 * usuario ya había escrito el motivo obligatorio.
 */
export const IT_TICKET_TRANSITIONS: Record<string, readonly string[]> = {
  nuevo: ["asignado", "en_diagnostico", "en_progreso", "esperando_usuario", "resuelto", "cerrado"],
  asignado: ["en_diagnostico", "en_progreso", "esperando_usuario", "esperando_proveedor", "resuelto", "cerrado"],
  en_diagnostico: ["en_progreso", "esperando_usuario", "esperando_proveedor", "resuelto", "cerrado"],
  en_progreso: ["esperando_usuario", "esperando_proveedor", "resuelto", "cerrado"],
  esperando_usuario: ["en_progreso", "resuelto", "cerrado"],
  esperando_proveedor: ["en_progreso", "resuelto", "cerrado"],
  resuelto: ["cerrado", "en_progreso"],
  cerrado: ["en_progreso"],
}

export function itTicketNextStatuses(current: string): readonly string[] {
  return IT_TICKET_TRANSITIONS[current] ?? []
}

export const itTicketTransitionSchema = z.object({
  ticketId: z.string().min(1),
  status: z.enum(IT_TICKET_STATUSES, { message: "Estado no reconocido" }),
  reason: z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres)").max(300),
  resolution: text(1000),
  /**
   * Asignación explícita del ticket. `""`/ausente = no cambiar el asignado
   * actual; `"__none__"` = desasignar. Sin este campo el estado `asignado` era
   * inalcanzable en la práctica: nada podía escribir `assignee_user_id`.
   */
  assigneeUserId: z.string().nullable().optional().or(z.literal("")),
}).refine(
  (data) => data.status !== "resuelto" || Boolean(data.resolution && data.resolution.trim().length >= 3),
  { message: "Describe la resolución para cerrar el caso (mínimo 3 caracteres)", path: ["resolution"] },
)

/** Centinela del selector de asignación para vaciar el técnico responsable. */
export const IT_TICKET_UNASSIGN = "__none__"

export const itTicketCommentSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().trim().min(1, "Escribe un comentario").max(2000),
  isInternal: z.coerce.boolean().default(false),
})

/* ── Licencias ─────────────────────────────────────────────────────────────── */

export const IT_LICENSE_PERIODICITIES = ["mensual", "anual", "unica"] as const

export const itLicenseSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Nombre requerido").max(120),
  supplierId: z.string().nullable().optional().or(z.literal("")),
  type: text(80),
  purchasedQuantity: z.coerce.number().int("Cantidad entera").min(0, "Cantidad no puede ser negativa").default(0),
  cost: moneySchema,
  periodicity: z.enum(IT_LICENSE_PERIODICITIES, { message: "Periodicidad no reconocida" }).default("anual"),
  startDate: optionalCivilDate,
  renewalDate: optionalCivilDate,
  responsibleUserId: z.string().nullable().optional().or(z.literal("")),
  notes: text(500),
  isActive: z.coerce.boolean().default(true),
})

export const itLicenseAssignmentSchema = z.object({
  licenseId: z.string().min(1, "Selecciona una licencia"),
  workerId: z.string().nullable().optional().or(z.literal("")),
  assetId: z.string().nullable().optional().or(z.literal("")),
  area: text(80),
  worksiteId: z.string().nullable().optional().or(z.literal("")),
  notes: text(300),
}).refine(
  (data) => Boolean(data.workerId || data.assetId || data.area || data.worksiteId),
  { message: "Asigna la licencia a un trabajador, equipo, área o faena", path: ["workerId"] },
)

/* ── Accesos y checklists ──────────────────────────────────────────────────── */

export const IT_ACCESS_STATUSES = ["activo", "suspendido", "baja"] as const

export const itAccessSystemSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Nombre requerido").max(80),
  description: text(300),
  isActive: z.coerce.boolean().default(true),
})

export const itSystemAccessSchema = z.object({
  systemId: z.string().min(1, "Selecciona un sistema"),
  workerId: z.string().min(1, "Selecciona un trabajador"),
  status: z.enum(IT_ACCESS_STATUSES, { message: "Estado no reconocido" }).default("activo"),
  responsibleUserId: z.string().nullable().optional().or(z.literal("")),
  notes: text(300),
})

export const IT_CHECKLIST_KINDS = ["onboarding", "offboarding"] as const

export const itChecklistSchema = z.object({
  workerId: z.string().min(1, "Selecciona un trabajador"),
  kind: z.enum(IT_CHECKLIST_KINDS, { message: "Tipo de checklist no reconocido" }),
  notes: text(500),
})

export const itChecklistTaskToggleSchema = z.object({
  taskId: z.string().min(1),
  done: z.coerce.boolean(),
  notes: text(300),
})

/* ── Garantías y proveedores TI ────────────────────────────────────────────── */

export const IT_SUPPLIER_CATEGORIES = ["reparacion", "venta_hardware", "licencias", "telefonia", "internet", "cloud", "otro"] as const

export const itSupplierLinkSchema = z.object({
  supplierId: z.string().min(1, "Selecciona un proveedor"),
  category: z.enum(IT_SUPPLIER_CATEGORIES, { message: "Categoría no reconocida" }),
  notes: text(300),
})
