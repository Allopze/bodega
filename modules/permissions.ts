/**
 * modules/permissions.ts — Tipo Permission derivado del registry
 *
 * En lugar de mantener manualmente un union type de 23+ strings (que habría que
 * actualizar cada vez que se agrega un módulo), este archivo los deriva del registry.
 *
 * El tipo público `Permission` se deriva del registry vivo. `lib/auth/types.ts`
 * lo reexporta solo para compatibilidad con imports antiguos.
 *
 * USO:
 *   import type { Permission } from "@/modules/permissions"
 *   — En código nuevo usar esta ruta, no @/lib/auth/types
 */

import type { registry } from "./registry"

// ── Tipo derivado desde el registry vivo ──────────────────────────────────────

/**
 * Unión de todos los permission keys declarados por los módulos registrados.
 */
export type RegistryPermission = typeof registry[number]["permissions"][number]
export type Permission = RegistryPermission

// ── Constante útil para seed y audit ─────────────────────────────────────────
import { registry as _registry } from "./registry"
import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Array plano de todos los permisos declarados por los módulos registrados.
 * Cast a ReadonlyArray<ModuleManifest> para que funcione con registry vacío
 * (cuando está vacío TypeScript infiere `never` en el elemento, no ModuleManifest).
 */
export const ALL_MODULE_PERMISSIONS = (
  _registry as ReadonlyArray<ModuleManifest>
).flatMap((m) => m.permissions)

export const ALL_MODULE_DEFAULT_GRANTS = (
  _registry as ReadonlyArray<ModuleManifest>
).flatMap((m) => m.defaultGrants ?? [])
