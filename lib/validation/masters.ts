import { z } from "zod"
import { cleanRut, validateRut } from "@/lib/rut"
import { normalizeEquipmentCode } from "@/lib/products/service-items"
import { duplicateNormalizedNames } from "@/lib/products/attribute-names"
import { unitOfMeasureSchema } from "./product-catalogs"

// ── Chilean RUT helper ────────────────────────────────────────────────────────
// Canonical cleaning/validation lives in @/lib/rut (audit A-15).

export const rutSchema = z
  .string()
  .optional()
  .transform((v) => (v ? cleanRut(v) : v))
  .refine((v) => !v || validateRut(v), { message: "RUT inválido" })

// ── User ──────────────────────────────────────────────────────────────────────
export const userCreateSchema = z.object({
  name:     z.string().max(80).optional().or(z.literal("")),
  email:    z.string().email("Correo inválido").transform((v) => v.toLowerCase().trim()),
  isActive: z.coerce.boolean().default(true),
  roleIds:  z.array(z.string()).min(1, "Asigna al menos un rol"),
  permissionIds: z.array(z.string()).default([]),
  workerId: z.string().optional().or(z.literal("")),
  expiresInDays: z.coerce.number().int().min(1, "Mínimo 1 día").max(30, "Máximo 30 días").default(7),
  worksiteAssignments: z.array(
    z.object({
      worksiteId: z.string(),
      isPrimary:  z.coerce.boolean().default(false),
    })
  ).default([]),
})

export const userUpdateSchema = z.object({
  id:       z.string().min(1),
  name:     z.string().min(2, "Nombre demasiado corto").max(80),
  email:    z.string().email("Correo inválido").transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8, "Mínimo 8 caracteres").or(z.literal("")).optional(),
  isActive: z.coerce.boolean().default(true),
  emailNotifications: z.coerce.boolean().default(true),
  roleIds:  z.array(z.string()).min(1, "Asigna al menos un rol"),
  permissionIds: z.array(z.string()).default([]),
  workerId: z.string().optional().or(z.literal("")),
  worksiteAssignments: z.array(
    z.object({
      worksiteId: z.string(),
      isPrimary:  z.coerce.boolean().default(false),
    })
  ).default([]),
})

export const registerUserSchema = z.object({
  name:            z.string().min(2, "Nombre demasiado corto").max(80),
  email:           z.string().email("Correo inválido").transform((v) => v.toLowerCase().trim()),
  password:        z.string().min(8, "Mínimo 8 caracteres"),
  confirmPassword: z.string().min(1, "Confirma la contraseña"),
  token:           z.string().optional().or(z.literal("")),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
})

export const userInvitationSchema = z.object({
  name:       z.string().max(80).optional().or(z.literal("")),
  email:      z.string().email("Correo inválido").transform((v) => v.toLowerCase().trim()),
  roleIds:    z.array(z.string()).min(1, "Asigna al menos un rol"),
  workerId:   z.string().optional().or(z.literal("")),
  expiresInDays: z.coerce.number().int().min(1, "Mínimo 1 día").max(30, "Máximo 30 días").default(7),
  worksiteAssignments: z.array(
    z.object({
      worksiteId: z.string(),
      isPrimary:  z.coerce.boolean().default(false),
    })
  ).default([]),
})

// ── Worksite (Faena) ──────────────────────────────────────────────────────────
export const worksiteSchema = z.object({
  id:       z.string().optional(),
  name:     z.string().min(2, "Nombre requerido").max(80),
  code:     z.string().min(1, "Código requerido").max(20).toUpperCase(),
  address:  z.string().max(200).optional().or(z.literal("")),
  region:   z.string().max(60).optional().or(z.literal("")),
  /** Título del cargo `admin_contrato` en el contrato de esta faena. */
  adminContratoLabel: z.string().max(60).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
})

// ── Supplier (Proveedor) ──────────────────────────────────────────────────────
export const supplierSchema = z.object({
  id:           z.string().optional(),
  name:         z.string().min(2, "Nombre requerido").max(100),
  rut:          rutSchema,
  businessActivity: z.string().max(140).optional().or(z.literal("")),
  contactName:  z.string().max(80).optional().or(z.literal("")),
  email:        z.string().email("Correo inválido").optional().or(z.literal("")),
  phone:        z.string().max(20).optional().or(z.literal("")),
  address:      z.string().max(200).optional().or(z.literal("")),
  commune:      z.string().max(80).optional().or(z.literal("")),
  city:         z.string().max(80).optional().or(z.literal("")),
  paymentTerms: z.string().max(60).optional().or(z.literal("")),
  notes:        z.string().max(500).optional().or(z.literal("")),
  isActive:     z.coerce.boolean().default(true),
})

// ── Product Category ──────────────────────────────────────────────────────────
export const productCategorySchema = z.object({
  id:                  z.string().optional(),
  name:                z.string().min(2, "Nombre requerido").max(80),
  slug:                z.string().min(1, "Slug requerido").max(40).toLowerCase(),
  isEpp:               z.coerce.boolean().default(false),
  requiresPrevencion:  z.coerce.boolean().default(false),
  sortOrder:           z.coerce.number().int().default(0),
})

// ── Product Attribute ─────────────────────────────────────────────────────────
export const productAttributeSchema = z.object({
  id:         z.string().optional(),
  productId:  z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  name:       z.string().min(1, "Nombre requerido").max(60),
  // `integer` es un conteo entero ≥ 1 (nº de dosis, de sesiones).
  type:       z.enum(["text", "select", "number", "integer"]),
  isRequired: z.coerce.boolean().default(false),
  options:    z.string().max(4000, "Opciones demasiado largas").optional().nullable(),   // JSON array string for "select"
  /**
   * `""` y el literal `"undefined"` significan ambos "sin familia de tallas".
   * El segundo existe porque en algún momento se serializó un `undefined` a
   * string y el schema se ensanchó para aceptarlo; mientras `updateProduct`
   * descartaba el campo era inofensivo, pero al persistirlo entraría el texto
   * "undefined" en la columna. Se normaliza acá, una vez, en vez de repetir el
   * guard en cada call site (`a.sizeFamily || null` no atrapa "undefined").
   */
  sizeFamily: z.string().max(20).optional()
                .transform((value) => (value && value !== "undefined" ? value : undefined)),
  /** El valor de este atributo ES la cantidad del ítem solicitado. */
  drivesQuantity: z.coerce.boolean().default(false),
  sortOrder:  z.coerce.number().int().default(0),
}).refine(
  (data) => !data.drivesQuantity || (data.type === "integer" && data.isRequired),
  { message: "El atributo que gobierna la cantidad debe ser entero y obligatorio", path: ["drivesQuantity"] },
)

// ── Equipo de servicio (instrumentos: monogás, alcotest, …) ──────────────────
export const serviceEquipmentSchema = z.object({
  id:           z.string().optional(),
  // Formato libre (numérico largo o alfanumérico según el fabricante), pero
  // normalizado: es la llave con la que las solicitudes encuentran el equipo.
  code:         z.string().trim().min(1, "Código interno requerido").max(40)
                  .transform(normalizeEquipmentCode),
  name:         z.string().trim().min(2, "Nombre requerido").max(120),
  // Slug normalizado: la BD exige minúsculas sin espacios para que el match
  // contra `products.equipment_kind` no dependa de cómo se escribió.
  kind:         z.string().trim().toLowerCase()
                  .min(2, "Tipo requerido").max(40)
                  .regex(/^[a-z0-9._-]+$/, "Usa sólo letras, números, guiones o puntos, sin espacios ni tildes"),
  brand:        z.string().trim().max(80).optional().or(z.literal("")),
  model:        z.string().trim().max(80).optional().or(z.literal("")),
  serialNumber: z.string().trim().max(80).optional().or(z.literal("")),
  worksiteId:   z.string().min(1, "Selecciona una faena"),
  notes:        z.string().max(300).optional().or(z.literal("")),
  isActive:     z.coerce.boolean().default(true),
})

export type ServiceEquipmentFormData = z.infer<typeof serviceEquipmentSchema>

// ── Product Supplier link ─────────────────────────────────────────────────────
export const productSupplierSchema = z.object({
  id:          z.string().optional(),
  supplierId:  z.string().min(1, "Selecciona un proveedor"),
  unitPrice:   z.coerce.number().min(0).optional().nullable(),
  isPreferred: z.coerce.boolean().default(false),
  notes:       z.string().max(300).optional().nullable(),
})

// ── Product ───────────────────────────────────────────────────────────────────
export const productSchema = z.object({
  id:                 z.string().optional(),
  name:               z.string().min(2, "Nombre requerido").max(120),
  description:        z.string().max(500).optional().or(z.literal("")),
  categoryId:         z.string().min(1, "Selecciona una categoría"),
  unitOfMeasure:      unitOfMeasureSchema.default("unidad"),
  isEpp:              z.coerce.boolean().default(false),
  requiresPrevencion: z.coerce.boolean().default(false),
  /** Servicio: se solicita sin precio y su costo se registra sobre la OC. */
  isService:          z.coerce.boolean().default(false),
  /** Se solicita para una persona concreta (vacunas, exámenes). */
  requiresWorker:     z.coerce.boolean().default(false),
  /** Familia de equipos que atiende ('monogas', 'alcotest'); vacío = no aplica. */
  equipmentKind:      z.string().trim().toLowerCase().max(40)
                        .regex(/^[a-z0-9._-]*$/, "Usa sólo letras, números, guiones o puntos, sin espacios ni tildes")
                        .optional().or(z.literal("")),
  referencePrice:     z.coerce.number().min(0).optional().nullable(),
  notes:              z.string().max(500).optional().or(z.literal("")),
  isActive:           z.coerce.boolean().default(true),
  attributes:         z.array(productAttributeSchema).default([]),
  suppliers:          z.array(productSupplierSchema).default([]),
}).superRefine((data, ctx) => {
  // Dos atributos con el mismo nombre se pisan cuando la solicitud los resuelve
  // por nombre (`quantityFromAttributes` y `catalogItemIssues` caen al nombre
  // si no hay id). El formulario ya lo marca, pero esta es la frontera de
  // confianza y cubre también al import y al lote de variantes.
  const names = data.attributes.map((a) => a.name).filter(Boolean)
  if (duplicateNormalizedNames(names).size > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Hay dos atributos con el mismo nombre",
      path: ["attributes"],
    })
  }
  // El índice único parcial de la BD ya lo cierra; acá el error es legible.
  if (data.attributes.filter((a) => a.drivesQuantity).length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "Solo un atributo puede gobernar la cantidad del producto",
      path: ["attributes"],
    })
  }
  if (data.suppliers.filter((s) => s.isPreferred).length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["suppliers"],
      message: "Solo un proveedor puede ser preferido",
    })
  }
})

// ── Worker (Trabajador) ───────────────────────────────────────────────────────
export const workerSchema = z.object({
  id:          z.string().optional(),
  rut:         rutSchema,
  firstName:   z.string().min(1, "Nombre requerido").max(60),
  lastName:    z.string().min(1, "Apellido requerido").max(60),
  position:    z.string().max(80).optional().or(z.literal("")),
  worksiteId:  z.string().min(1, "Selecciona una faena"),
  isActive:    z.coerce.boolean().default(true),
  sizeTop:     z.string().max(10).optional().or(z.literal("")),
  sizeBottom:  z.string().max(10).optional().or(z.literal("")),
  sizeShoe:    z.string().max(10).optional().or(z.literal("")),
  sizeGloves:  z.string().max(10).optional().or(z.literal("")),
  sizeHelmet:  z.string().max(10).optional().or(z.literal("")),
})


// ── Shared ActionState returned by all Server Actions ────────────────────────
export type ActionState = {
  ok:           boolean
  message?:     string
  fieldErrors?: Record<string, string[]>
  /**
   * Optional structured payload returned by the action. Used to surface
   * data that should NOT be displayed in a transient toast (e.g.
   * invitation URLs that grant account access) and must be rendered in
   * a deliberate, dismissable surface.
   */
  data?:        Record<string, unknown>
}
