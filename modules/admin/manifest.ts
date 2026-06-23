/**
 * modules/admin/manifest.ts
 *
 * Módulo de administración del sistema.
 * Gestiona datos maestros (faenas, proveedores, trabajadores, productos, usuarios)
 * y configuración del sistema.
 *
 * Nota: el enlace de /admin aparece en el dropdown del TopBar para cualquier
 * usuario con al menos un permiso admin:*, no en la barra lateral principal.
 */

import type { ModuleManifest } from "@/modules/manifest-types"

export const adminModule = {
  id: "admin",

  permissions: [
    // Usuarios y roles
    "admin:users",
    "admin:manage_admins",
    // Datos maestros
    "admin:worksites",
    "admin:workers",
    "admin:products",
    "admin:suppliers",
    // Sistema
    "admin:config",
    "admin:smtp",
    "admin:email_templates",
    "admin:audit_log",
  ] as const,

  // No aparece en el sidebar principal; el TopBar lo descubre dinámicamente
  nav: [],

  /**
   * Grants por defecto al hacer seed.
   * Mapea 1:1 con SYSTEM_ROLE_PERMISSIONS en lib/auth/bootstrap.ts.
   * En Fase 3 el seed usará estos grants en lugar de bootstrap.ts.
   */
  defaultGrants: [
    // Administrador — todos los permisos del módulo
    { roleSlug: "administrador", permission: "admin:users" },
    { roleSlug: "administrador", permission: "admin:manage_admins" },
    { roleSlug: "administrador", permission: "admin:worksites" },
    { roleSlug: "administrador", permission: "admin:workers" },
    { roleSlug: "administrador", permission: "admin:products" },
    { roleSlug: "administrador", permission: "admin:suppliers" },
    { roleSlug: "administrador", permission: "admin:config" },
    { roleSlug: "administrador", permission: "admin:smtp" },
    { roleSlug: "administrador", permission: "admin:email_templates" },
    { roleSlug: "administrador", permission: "admin:audit_log" },
    // Secretaría
    { roleSlug: "secretaria", permission: "admin:users" },
    { roleSlug: "secretaria", permission: "admin:worksites" },
    { roleSlug: "secretaria", permission: "admin:workers" },
    { roleSlug: "secretaria", permission: "admin:products" },
    { roleSlug: "secretaria", permission: "admin:suppliers" },
    // Jefa Dpto. Prevención de riesgos
    { roleSlug: "prevencionista", permission: "admin:users" },
    { roleSlug: "prevencionista", permission: "admin:worksites" },
    { roleSlug: "prevencionista", permission: "admin:workers" },
    { roleSlug: "prevencionista", permission: "admin:products" },
    { roleSlug: "prevencionista", permission: "admin:suppliers" },
    // Prevencionista faena — solo trabajadores (para EPP tracking)
    { roleSlug: "solicitante_faena", permission: "admin:workers" },
    { roleSlug: "prevencionista_faena", permission: "admin:workers" },
  ],
} as const satisfies ModuleManifest
