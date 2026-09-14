import type { ModuleManifest } from "@/modules/manifest-types"

export const operationsModule = {
  id: "operations",
  permissions: [
    "operations:view_work",
  ] as const,
  permissionMeta: {
    "operations:view_work": { id: "p-ops-view-work", description: "Ver la cola operacional priorizada dentro de sus permisos y faenas" },
  },
  nav: [
    {
      // A-26: área propia; la cola agrega módulos de todo el sistema.
      areaId: "pendientes",
      items: [{
        label: "Mis pendientes",
        href: "/pendientes",
        iconName: "CheckSquare",
        permissions: ["operations:view_work"],
        badge: "count" as const,
      }],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador", permission: "operations:view_work" },
    { roleSlug: "jefa_chome", permission: "operations:view_work" },
    { roleSlug: "secretaria", permission: "operations:view_work" },
    { roleSlug: "prevencionista", permission: "operations:view_work" },
    { roleSlug: "solicitante_faena", permission: "operations:view_work" },
    { roleSlug: "prevencionista_faena", permission: "operations:view_work" },
    { roleSlug: "jefe_mantencion", permission: "operations:view_work" },
    /*
     * PEND-002 (auditoría 2026-09-14): estos cinco roles ejecutan actividades
     * del PDTP —el manifiesto de Prevención les da `prevention:pdtp:execute`— y
     * la cola les produce trabajo, pero no podían abrirla ni verla en el menú:
     * `/pendientes` los mandaba a prohibido. Una bandeja unificada que no
     * alcanza a quien ejecuta el trabajo obliga a recorrer módulo por módulo,
     * que es justo lo que la bandeja existe para evitar.
     */
    { roleSlug: "admin_contrato", permission: "operations:view_work" },
    { roleSlug: "jefe_terreno", permission: "operations:view_work" },
    { roleSlug: "supervisor_terreno", permission: "operations:view_work" },
    { roleSlug: "gerente_legal_rrhh", permission: "operations:view_work" },
    { roleSlug: "subgerente_operaciones", permission: "operations:view_work" },
    // Y el comité: `prevention:cphs:manage` le da convocatorias y actividades
    // que cerrar, y la cola se las produce. Lo encontró la prueba de paridad al
    // reconciliar los grants con las fuentes, no la ficha del hallazgo.
    { roleSlug: "cphs", permission: "operations:view_work" },
  ],
} as const satisfies ModuleManifest
