import type { ModuleManifest } from "@/core/module-kit"

export const approvalsModule = {
  id: "approvals",
  permissions: [
    "approvals:approve",
  ] as const,
  nav: [
    {
      areaId: "operaciones",
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
    { roleSlug: "prevencionista", permission: "approvals:approve" },
  ],
} as const satisfies ModuleManifest
