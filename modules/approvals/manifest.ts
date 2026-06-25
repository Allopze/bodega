import type { ModuleManifest } from "@/modules/manifest-types"

export const approvalsModule = {
  id: "approvals",
  permissions: [
    "approvals:approve",
  ] as const,

  permissionMeta: {
    "approvals:approve": { id: "p-apr", description: "Revisar y aprobar solicitudes" },
  },
  nav: [
    {
      areaId: "adquisiciones",
      items: [
        {
          label:       "Aprobaciones",
          href:        "/aprobaciones",
          iconName:    "CheckSquare",
          permissions: ["approvals:approve"],
          badge:       "count" as const,
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "approvals:approve" },
    { roleSlug: "jefa_chome",     permission: "approvals:approve" },
    { roleSlug: "secretaria",     permission: "approvals:approve" },
    { roleSlug: "prevencionista", permission: "approvals:approve" },
  ],
} as const satisfies ModuleManifest
