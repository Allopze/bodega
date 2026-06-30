import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Modulo de Prevencion ampliado: IPER/MIPER, incidentes y capacitaciones.
 * Mantiene el area de navegacion 'prevencion' junto a SST y PPA.
 */
export const preventionModule = {
  id: "prevention",

  permissions: [
    "prevention:iper:view",
    "prevention:iper:manage",
    "prevention:incidents:view",
    "prevention:incidents:manage",
    "prevention:incidents:close",
    "prevention:training:view",
    "prevention:training:manage",
  ] as const,

  permissionMeta: {
    "prevention:iper:view":          { id: "p-prev-iper-view",   description: "Ver matriz IPER/MIPER" },
    "prevention:iper:manage":        { id: "p-prev-iper-manage", description: "Gestionar matriz IPER/MIPER" },
    "prevention:incidents:view":     { id: "p-prev-inc-view",    description: "Ver accidentes, incidentes y cuasi accidentes" },
    "prevention:incidents:manage":   { id: "p-prev-inc-manage",  description: "Registrar y gestionar la investigacion de incidentes" },
    "prevention:incidents:close":    { id: "p-prev-inc-close",   description: "Cerrar investigaciones de incidentes" },
    "prevention:training:view":      { id: "p-prev-train-view",  description: "Ver capacitaciones y competencias" },
    "prevention:training:manage":    { id: "p-prev-train-manage", description: "Gestionar cursos y asignaciones de capacitacion" },
  },

  nav: [
    {
      areaId: "prevencion",
      items: [
        {
          label: "IPER/MIPER",
          href: "/prevencion/iper",
          iconName: "WarningDiamond",
          permissions: ["prevention:iper:view"],
        },
        {
          label: "Incidentes",
          href: "/prevencion/incidentes",
          iconName: "Siren",
          permissions: ["prevention:incidents:view"],
        },
        {
          label: "Capacitaciones",
          href: "/prevencion/capacitaciones",
          iconName: "Certificate",
          permissions: ["prevention:training:view"],
        },
      ],
    },
  ],

  defaultGrants: [
    // Prevencion de oficina: acceso completo al modulo.
    { roleSlug: "prevencionista", permission: "prevention:iper:view" },
    { roleSlug: "prevencionista", permission: "prevention:iper:manage" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:manage" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:close" },
    { roleSlug: "prevencionista", permission: "prevention:training:view" },
    { roleSlug: "prevencionista", permission: "prevention:training:manage" },
    // Prevencionista de faena: alcance acotado a sus faenas.
    { roleSlug: "prevencionista_faena", permission: "prevention:iper:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:manage" },
    // Administrador: control total.
    { roleSlug: "administrador", permission: "prevention:iper:view" },
    { roleSlug: "administrador", permission: "prevention:iper:manage" },
    { roleSlug: "administrador", permission: "prevention:incidents:view" },
    { roleSlug: "administrador", permission: "prevention:incidents:manage" },
    { roleSlug: "administrador", permission: "prevention:incidents:close" },
    { roleSlug: "administrador", permission: "prevention:training:view" },
    { roleSlug: "administrador", permission: "prevention:training:manage" },
  ],
} as const satisfies ModuleManifest