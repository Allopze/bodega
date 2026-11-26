import type { DB } from "@/db"

/** Metadata for a single permission — id is the short DB key, description is human-readable. */
export interface PermissionMeta {
  id:          string
  description: string
}

export interface NavChild {
  label: string
  href: string
  permissions?: string[]
  roles?: string[]
}

export interface NavItem {
  label: string
  href: string
  iconName: string
  permissions?: string[]
  roles?: string[]
  badge?: "count"
  children?: NavChild[]
  /**
   * Un ítem con `children` muestra sus hijos desplegados al cargar, sin que la
   * persona tenga que abrirlo («Configuración» de Mantención). Sin esto el
   * padre sólo se despliega cuando la pantalla actual es suya o de un hijo.
   * La persona sigue pudiendo plegarlo.
   */
  defaultOpen?: boolean
  /** Encabezado de sección bajo el que se agrupa este ítem (opcional). */
  group?: string
  /**
   * Prefijos de ruta que también pertenecen a este ítem aunque vivan en otro
   * árbol (`/combustibles/control/revision` es parte de «Revisión»). Cuentan
   * para el ítem activo, la miga de la top bar y el interruptor de submódulo;
   * no se pintan en el menú.
   *
   * Un segmento que es sólo `*` vale por cualquier segmento de la ruta (el
   * alias de «Equipos» en `modules/mantencion-equipos/manifest.ts` es la ficha
   * de mantención de cualquier equipo). El comodín sólo lo entiende
   * `isHrefActive` (ítem activo y miga): el interruptor de submódulo compara
   * prefijos literales y lo ignora, así que esa ruta sigue gobernada por su
   * propio árbol.
   */
  aliases?: string[]
}

export interface NavSection {
  areaId: string
  items: NavItem[]
}

export interface RolePermissionGrant {
  roleSlug: string
  permission: string
}

export interface ModuleManifest {
  id: string
  permissions: readonly string[]
  /** Maps each permission name (e.g. "combustibles:view") to its DB id and description. */
  permissionMeta?: Record<string, PermissionMeta>
  nav?: NavSection[]
  seed?: (db: DB) => Promise<void>
  defaultGrants?: RolePermissionGrant[]
}
