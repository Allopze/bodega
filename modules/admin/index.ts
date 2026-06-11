/**
 * modules/admin/index.ts — Barrel público del módulo admin
 *
 * REGLA DE FRONTERA: otros módulos solo pueden importar desde @/modules/admin
 * (este archivo). Nunca desde @/modules/admin/actions/..., @/modules/admin/services/...,
 * etc. directamente.
 */

// Manifest (para registry)
export { adminModule } from "./manifest"

// Tipos del dominio
export type { ActionState } from "./validation"

// Schemas del dominio (para usar en queries de otros módulos si necesitan datos maestros)
export {
  worksites, suppliers, workers,
  users, roles, permissions, userRoles, worksiteUsers,
  products, productCategories, productAttributes, productSuppliers,
} from "./schema"

// Servicios públicos del módulo
export {
  getCompanyProfile,
  getPdfMaxSizeMb,
} from "./services/system-settings"
export type { CompanyProfile } from "./services/system-settings"

// Validaciones públicas (útiles para otros módulos que necesiten validar RUTs, etc.)
export { rutSchema } from "./validation"
