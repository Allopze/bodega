import type { ModuleManifest } from "@/modules/manifest-types"

export const sstModule = {
  id: "sst",
  permissions: [
    "sst:view",
    "sst:create",
    "sst:close",
    "sst:manage",
  ] as const,
  nav: [
    {
      areaId: "prevencion",
      items: [
        {
          label: "Evaluaciones SST",
          href: "/prevencion",
          iconName: "ClipboardText",
          permissions: ["sst:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "prevencionista", permission: "sst:view" },
    { roleSlug: "prevencionista", permission: "sst:create" },
    { roleSlug: "prevencionista", permission: "sst:close" },
    { roleSlug: "prevencionista", permission: "sst:manage" },
    { roleSlug: "prevencionista_faena", permission: "sst:view" },
    { roleSlug: "prevencionista_faena", permission: "sst:create" },
    { roleSlug: "administrador", permission: "sst:view" },
    { roleSlug: "administrador", permission: "sst:create" },
    { roleSlug: "administrador", permission: "sst:close" },
    { roleSlug: "administrador", permission: "sst:manage" },
  ],
} as const satisfies ModuleManifest
