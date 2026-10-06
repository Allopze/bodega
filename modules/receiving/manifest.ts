import type { ModuleManifest } from "@/modules/manifest-types"

export const receivingModule = {
  id: "receiving",
  permissions: [
    "receiving:register_office",
    "receiving:register_faena",
    "receiving:view",
  ] as const,

  permissionMeta: {
    "receiving:register_office": { id: "p-rec-reg-office", description: "Registrar llegada a oficina" },
    "receiving:register_faena":  { id: "p-rec-reg-faena",  description: "Registrar recepción en faena" },
    "receiving:view":            { id: "p-rec-view",        description: "Ver recepciones" },
  },
  nav: [
    {
      areaId: "adquisiciones",
      items: [
        {
          label:       "Recepción",
          href:        "/recepcion",
          iconName:    "Package",
          permissions: ["receiving:view", "receiving:register_office", "receiving:register_faena"],
          // TRV-01 (auditoría 2026-10-05): el conteo ya se calculaba en el layout pero no se mostraba.
          badge:       "count" as const,
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "receiving:register_office" },
    { roleSlug: "administrador",  permission: "receiving:register_faena" },
    { roleSlug: "administrador",  permission: "receiving:view" },
    { roleSlug: "jefa_chome",     permission: "receiving:view" },
    { roleSlug: "secretaria",     permission: "receiving:register_office" },
    { roleSlug: "secretaria",     permission: "receiving:register_faena" },
    { roleSlug: "secretaria",     permission: "receiving:view" },
    { roleSlug: "prevencionista", permission: "receiving:register_office" },
    { roleSlug: "prevencionista", permission: "receiving:register_faena" },
    { roleSlug: "prevencionista", permission: "receiving:view" },
    { roleSlug: "solicitante_faena", permission: "receiving:register_faena" },
    { roleSlug: "solicitante_faena", permission: "receiving:view" },
    { roleSlug: "prevencionista_faena", permission: "receiving:register_faena" },
    { roleSlug: "prevencionista_faena", permission: "receiving:view" },
    { roleSlug: "jefe_mantencion", permission: "receiving:register_faena" },
    { roleSlug: "jefe_mantencion", permission: "receiving:view" },
    // Reciben en su faena lo que solicitan (ver `requests/manifest.ts`).
    { roleSlug: "admin_contrato",     permission: "receiving:register_faena" },
    { roleSlug: "admin_contrato",     permission: "receiving:view" },
    { roleSlug: "jefe_terreno",       permission: "receiving:register_faena" },
    { roleSlug: "jefe_terreno",       permission: "receiving:view" },
    { roleSlug: "supervisor_terreno", permission: "receiving:register_faena" },
    { roleSlug: "supervisor_terreno", permission: "receiving:view" },
  ],
} as const satisfies ModuleManifest
