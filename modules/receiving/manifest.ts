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
  ],
} as const satisfies ModuleManifest
