/**
 * modules/admin/schema.ts
 *
 * Tablas Drizzle que pertenecen conceptualmente al módulo admin.
 * La fuente de verdad sigue siendo db/schema/ (donde drizzle-kit las lee).
 * Este archivo declara la propiedad semántica: "el módulo admin es dueño de estas tablas".
 *
 * En Fase 3 (cleanup), estas tablas podrían moverse a este archivo y
 * db/schema/index.ts pasaría a re-exportar desde aquí.
 */

// Autenticación / RBAC
export {
  users,
  userInvitations,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  worksiteUsers,
  usersRelations,
  userInvitationsRelations,
  rolesRelations,
  permissionsRelations,
  userRolesRelations,
} from "@/db/schema"

// Datos maestros
export {
  worksites,
  suppliers,
  workers,
  worksitesRelations,
  workersRelations,
} from "@/db/schema"

// Catálogo de productos
export {
  productCategories,
  products,
  productAttributes,
  productSuppliers,
  productCategoriesRelations,
  productsRelations,
  productAttributesRelations,
  productSuppliersRelations,
} from "@/db/schema"

// Configuración de sistema
export {
  systemSettings,
} from "@/db/schema"

// Auditoría (vista de logs)
export {
  auditLog,
} from "@/db/schema"
