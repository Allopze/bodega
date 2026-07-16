import type { ModuleManifest } from "@/modules/manifest-types"

export const ppaModule = {
  id: "ppa",
  permissions: [
    "ppa:view",    // ver PPA e indicadores
    "ppa:review",  // revisar y autorizar/rechazar PPA detenidos
    "ppa:manage",  // gestión avanzada (export, administración)
  ] as const,

  permissionMeta: {
    "ppa:view":   { id: "p-ppa-view",   description: "Ver PPA Digital e indicadores" },
    "ppa:review": { id: "p-ppa-review", description: "Revisar y autorizar/rechazar PPA detenidos" },
    "ppa:manage": { id: "p-ppa-manage", description: "Gestionar y exportar PPA Digital" },
  },
  nav: [
    {
      areaId: "prevencion",
      items: [
        {
          label: "Para, Piensa y Actúa",
          href: "/prevencion/ppa",
          iconName: "ShieldCheck",
          permissions: ["ppa:view"],
          group: "Control en terreno",
        },
      ],
    },
  ],
  defaultGrants: [
    // Revisión en faena (responsable directo).
    { roleSlug: "prevencionista_faena", permission: "ppa:view" },
    { roleSlug: "prevencionista_faena", permission: "ppa:review" },
    // Prevención de oficina y jefatura.
    { roleSlug: "prevencionista", permission: "ppa:view" },
    { roleSlug: "prevencionista", permission: "ppa:review" },
    { roleSlug: "prevencionista", permission: "ppa:manage" },
    { roleSlug: "jefa_chome", permission: "ppa:view" },
    { roleSlug: "jefa_chome", permission: "ppa:review" },
    // Administración.
    { roleSlug: "administrador", permission: "ppa:view" },
    { roleSlug: "administrador", permission: "ppa:review" },
    { roleSlug: "administrador", permission: "ppa:manage" },
  ],
} as const satisfies ModuleManifest
