import type { ModuleManifest } from "@/core/module-kit"

export const receivingModule = {
  id: "receiving",
  permissions: [
    "receiving:register_office",
    "receiving:register_faena",
    "receiving:view",
  ] as const,
  nav: [
    {
      section: "Operaciones",
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
    { roleSlug: "jefa_chome",     permission: "receiving:register_office" },
    { roleSlug: "jefa_chome",     permission: "receiving:register_faena" },
    { roleSlug: "jefa_chome",     permission: "receiving:view" },
    { roleSlug: "secretaria",     permission: "receiving:register_office" },
    { roleSlug: "secretaria",     permission: "receiving:view" },
  ],
} as const satisfies ModuleManifest
