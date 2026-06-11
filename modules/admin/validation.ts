/**
 * modules/admin/validation.ts
 *
 * Schemas Zod del módulo admin.
 * Fuente de verdad: lib/validation/masters.ts
 * En Fase 3 el contenido se moverá aquí.
 */

export {
  // RUT
  rutSchema,
  // Usuarios
  userCreateSchema,
  userUpdateSchema,
  registerUserSchema,
  userInvitationSchema,
  // Faenas
  worksiteSchema,
  // Proveedores
  supplierSchema,
  // Catálogo
  productCategorySchema,
  productAttributeSchema,
  productSupplierSchema,
  productSchema,
  // Trabajadores
  workerSchema,
  // ActionState compartido — también re-exportado por otros módulos desde aquí
  // o desde @/lib/validation/masters directamente
} from "@/lib/validation/masters"

export type { ActionState } from "@/lib/validation/masters"
