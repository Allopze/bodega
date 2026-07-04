import type { ModuleManifest } from "@/modules/manifest-types"

export const preventionModule = {
  id: "prevention",

  permissions: [
    "prevention:pdtp:view",
    "prevention:pdtp:manage",
    "prevention:pdtp:approve",
    "prevention:pdtp:sign_legal",
    "prevention:docs:view",
    "prevention:docs:manage",
    "prevention:docs:archive",
    "prevention:docs:manage_sensitive",
    "prevention:docs:manage_restricted",
  ] as const,

  permissionMeta: {
    "prevention:pdtp:view":       { id: "p-prev-pdtp-view",       description: "Ver Programa de Trabajo Preventivo SG-SST" },
    "prevention:pdtp:manage":     { id: "p-prev-pdtp-manage",     description: "Gestionar catálogo, cronograma y ejecuciones del Programa de Trabajo Preventivo" },
    "prevention:pdtp:approve":    { id: "p-prev-pdtp-approve",    description: "Aprobar el Programa de Trabajo Preventivo como jefatura de prevención" },
    "prevention:pdtp:sign_legal": { id: "p-prev-pdtp-sign-legal", description: "Firmar el Programa de Trabajo Preventivo como Gerencia Legal y Recursos Humanos" },
    "prevention:docs:view":               { id: "p-prev-docs-v",    description: "Ver la documentación preventiva" },
    "prevention:docs:manage":             { id: "p-prev-docs-m",    description: "Subir archivos, crear carpetas y crear versiones de documentos" },
    "prevention:docs:archive":            { id: "p-prev-docs-arch", description: "Archivar (soft delete) documentos" },
    "prevention:docs:manage_sensitive":   { id: "p-prev-docs-sens", description: "Gestionar documentos con confidencialidad 'sensible'" },
    "prevention:docs:manage_restricted":  { id: "p-prev-docs-rest", description: "Gestionar documentos con confidencialidad 'restringido'" },
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
          label: "Documentación",
          href: "/prevencion/documentacion",
          iconName: "FolderOpen",
          permissions: ["prevention:docs:view"],
        },
      ],
    },
  ],

  defaultGrants: [
    // PDTP
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:view" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:approve" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:view" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:approve" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:sign_legal" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:manage" },
    { roleSlug: "admin_contrato",      permission: "prevention:pdtp:view" },
    { roleSlug: "admin_contrato",      permission: "prevention:pdtp:manage" },
    { roleSlug: "supervisor_faena",    permission: "prevention:pdtp:view" },
    { roleSlug: "supervisor_faena",    permission: "prevention:pdtp:manage" },
    { roleSlug: "jefe_terreno",        permission: "prevention:pdtp:view" },
    { roleSlug: "jefe_terreno",        permission: "prevention:pdtp:manage" },
    { roleSlug: "cphs",                permission: "prevention:pdtp:view" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:view" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:manage" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:approve" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:sign_legal" },
    // Documentación
    { roleSlug: "prevencionista",      permission: "prevention:docs:view" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:archive" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:manage_sensitive" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:manage_restricted" },
    { roleSlug: "prevencionista_faena", permission: "prevention:docs:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:docs:manage" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:view" },
    { roleSlug: "supervisor_faena",    permission: "prevention:docs:view" },
    { roleSlug: "jefe_terreno",        permission: "prevention:docs:view" },
    { roleSlug: "administrador",       permission: "prevention:docs:view" },
    { roleSlug: "administrador",       permission: "prevention:docs:manage" },
    { roleSlug: "administrador",       permission: "prevention:docs:archive" },
    { roleSlug: "administrador",       permission: "prevention:docs:manage_sensitive" },
    { roleSlug: "administrador",       permission: "prevention:docs:manage_restricted" },
  ],
} as const satisfies ModuleManifest
