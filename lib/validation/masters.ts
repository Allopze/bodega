import { z } from "zod"

// ── Chilean RUT helper ────────────────────────────────────────────────────────
// Accepts formats: 12345678-9, 12.345.678-9, 12345678-K, etc.
// We store the cleaned form (no dots, with dash).
function cleanRut(rut: string): string {
  return rut.replace(/\./g, "").trim().toUpperCase()
}

function validateRut(rut: string): boolean {
  const cleaned = cleanRut(rut)
  if (!/^\d{7,8}-[\dKk]$/.test(cleaned)) return false
  const [num, dv] = cleaned.split("-")
  let sum = 0
  let mul = 2
  for (let i = num.length - 1; i >= 0; i--) {
    sum += parseInt(num[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const expected = 11 - (sum % 11)
  const computed = expected === 11 ? "0" : expected === 10 ? "K" : String(expected)
  return computed === dv.toUpperCase()
}

export const rutSchema = z
  .string()
  .optional()
  .transform((v) => (v ? cleanRut(v) : v))
  .refine((v) => !v || validateRut(v), { message: "RUT inválido" })

// ── User ──────────────────────────────────────────────────────────────────────
export const userCreateSchema = z.object({
  name:     z.string().min(2, "Nombre demasiado corto").max(80),
  email:    z.string().email("Correo inválido").transform((v) => v.toLowerCase().trim()),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  isActive: z.coerce.boolean().default(true),
  roleIds:  z.array(z.string()).min(1, "Asigna al menos un rol"),
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
  password: z.string().min(6, "Mínimo 6 caracteres").or(z.literal("")).optional(),
  isActive: z.coerce.boolean().default(true),
  roleIds:  z.array(z.string()).min(1, "Asigna al menos un rol"),
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
  isActive: z.coerce.boolean().default(true),
})

// ── Cost Center ───────────────────────────────────────────────────────────────
export const costCenterSchema = z.object({
  id:          z.string().optional(),
  name:        z.string().min(2, "Nombre requerido").max(80),
  code:        z.string().min(1, "Código requerido").max(20).toUpperCase(),
  worksiteId:  z.string().min(1, "Selecciona una faena"),
  isActive:    z.coerce.boolean().default(true),
})

// ── Supplier (Proveedor) ──────────────────────────────────────────────────────
export const supplierSchema = z.object({
  id:           z.string().optional(),
  name:         z.string().min(2, "Nombre requerido").max(100),
  rut:          rutSchema,
  contactName:  z.string().max(80).optional().or(z.literal("")),
  email:        z.string().email("Correo inválido").optional().or(z.literal("")),
  phone:        z.string().max(20).optional().or(z.literal("")),
  address:      z.string().max(200).optional().or(z.literal("")),
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
  type:       z.enum(["text", "select", "number"]),
  isRequired: z.coerce.boolean().default(false),
  options:    z.string().optional().nullable(),   // JSON array string for "select"
  sortOrder:  z.coerce.number().int().default(0),
})

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
  sku:                z.string().min(1, "SKU requerido").max(40).toUpperCase(),
  name:               z.string().min(2, "Nombre requerido").max(120),
  description:        z.string().max(500).optional().or(z.literal("")),
  categoryId:         z.string().min(1, "Selecciona una categoría"),
  unitOfMeasure:      z.string().min(1, "Unidad requerida").max(20).default("unidad"),
  isEpp:              z.coerce.boolean().default(false),
  requiresPrevencion: z.coerce.boolean().default(false),
  referencePrice:     z.coerce.number().min(0).optional().nullable(),
  notes:              z.string().max(500).optional().or(z.literal("")),
  isActive:           z.coerce.boolean().default(true),
  attributes:         z.array(productAttributeSchema).default([]),
  suppliers:          z.array(productSupplierSchema).default([]),
})

// ── Warehouse (Bodega) ────────────────────────────────────────────────────────
export const warehouseSchema = z.object({
  id:          z.string().optional(),
  name:        z.string().min(2, "Nombre requerido").max(80),
  code:        z.string().min(1, "Código requerido").max(20).toUpperCase(),
  type:        z.enum(["central", "worksite", "transit"]).default("central"),
  worksiteId:  z.string().optional().nullable().or(z.literal("")),
  address:     z.string().max(200).optional().or(z.literal("")),
  notes:       z.string().max(300).optional().or(z.literal("")),
  isActive:    z.coerce.boolean().default(true),
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
