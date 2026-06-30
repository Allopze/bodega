import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Modulo de Prevencion ampliado: matriz de riesgos, incidentes y capacitaciones.
 * Mantiene el area de navegacion 'prevencion' junto a SST y PPA.
 */
export const preventionModule = {
  id: "prevention",

  permissions: [
    "prevention:pdtp:view",
    "prevention:pdtp:manage",
    "prevention:pdtp:approve",
    "prevention:pdtp:sign_legal",
    "prevention:iper:view",
    "prevention:iper:manage",
    "prevention:incidents:view",
    "prevention:incidents:manage",
    "prevention:incidents:close",
    "prevention:training:view",
    "prevention:training:manage",
  ] as const,

  permissionMeta: {
    "prevention:pdtp:view":         { id: "p-prev-pdtp-view", description: "Ver Programa de Trabajo Preventivo SG-SST" },
    "prevention:pdtp:manage":       { id: "p-prev-pdtp-manage", description: "Gestionar catalogo, cronograma y ejecuciones del Programa de Trabajo Preventivo" },
    "prevention:pdtp:approve":      { id: "p-prev-pdtp-approve", description: "Aprobar el Programa de Trabajo Preventivo como jefatura de prevencion" },
    "prevention:pdtp:sign_legal":   { id: "p-prev-pdtp-sign-legal", description: "Firmar el Programa de Trabajo Preventivo como Gerencia Legal y Recursos Humanos" },
    "prevention:iper:view":          { id: "p-prev-iper-view",   description: "Ver matriz de identificacion de peligros y evaluacion de riesgos" },
    "prevention:iper:manage":        { id: "p-prev-iper-manage", description: "Gestionar matriz de identificacion de peligros y evaluacion de riesgos" },
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
          label: "Programa preventivo SG-SST",
          href: "/prevencion/pdtp",
          iconName: "ClipboardText",
          permissions: ["prevention:pdtp:view"],
        },
        {
          label: "Matriz de riesgos",
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
    { roleSlug: "prevencionista", permission: "prevention:pdtp:view" },
    { roleSlug: "prevencionista", permission: "prevention:pdtp:manage" },
    { roleSlug: "prevencionista", permission: "prevention:pdtp:approve" },
    { roleSlug: "prevencionista", permission: "prevention:iper:view" },
    { roleSlug: "prevencionista", permission: "prevention:iper:manage" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:manage" },
    { roleSlug: "prevencionista", permission: "prevention:incidents:close" },
    { roleSlug: "prevencionista", permission: "prevention:training:view" },
    { roleSlug: "prevencionista", permission: "prevention:training:manage" },
    // Gerencia Legal/Recursos Humanos y jefatura: firma legal y visibilidad ejecutiva.
    { roleSlug: "jefa_chome", permission: "prevention:pdtp:view" },
    { roleSlug: "jefa_chome", permission: "prevention:pdtp:approve" },
    { roleSlug: "jefa_chome", permission: "prevention:pdtp:sign_legal" },
    // Prevencionista de faena: alcance acotado a sus faenas.
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:iper:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:manage" },
    // Roles de terreno incorporados por el PDTP.
    { roleSlug: "admin_contrato", permission: "prevention:pdtp:view" },
    { roleSlug: "admin_contrato", permission: "prevention:pdtp:manage" },
    { roleSlug: "supervisor_faena", permission: "prevention:pdtp:view" },
    { roleSlug: "supervisor_faena", permission: "prevention:pdtp:manage" },
    { roleSlug: "jefe_terreno", permission: "prevention:pdtp:view" },
    { roleSlug: "jefe_terreno", permission: "prevention:pdtp:manage" },
    { roleSlug: "cphs", permission: "prevention:pdtp:view" },
    // Administrador: control total.
    { roleSlug: "administrador", permission: "prevention:pdtp:view" },
    { roleSlug: "administrador", permission: "prevention:pdtp:manage" },
    { roleSlug: "administrador", permission: "prevention:pdtp:approve" },
    { roleSlug: "administrador", permission: "prevention:pdtp:sign_legal" },
    { roleSlug: "administrador", permission: "prevention:iper:view" },
    { roleSlug: "administrador", permission: "prevention:iper:manage" },
    { roleSlug: "administrador", permission: "prevention:incidents:view" },
    { roleSlug: "administrador", permission: "prevention:incidents:manage" },
    { roleSlug: "administrador", permission: "prevention:incidents:close" },
    { roleSlug: "administrador", permission: "prevention:training:view" },
    { roleSlug: "administrador", permission: "prevention:training:manage" },
  ],
} as const satisfies ModuleManifest
