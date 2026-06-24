import type { ModuleManifest } from "@/modules/manifest-types"

export const feedbackModule = {
  id: "feedback",
  permissions: [
    "feedback:create",
    "feedback:view_own",
    "feedback:view_all",
    "feedback:manage",
  ] as const,
  nav: [
    {
      areaId: "soporte",
      items: [
        {
          label:       "Soporte",
          href:        "/soporte",
          iconName:    "ChatCircleText",
          permissions: ["feedback:view_own", "feedback:view_all"],
        },
      ],
    },
  ],
  defaultGrants: [
    // Gestores: acceso completo
    { roleSlug: "administrador",       permission: "feedback:create"    },
    { roleSlug: "administrador",       permission: "feedback:view_own"  },
    { roleSlug: "administrador",       permission: "feedback:view_all"  },
    { roleSlug: "administrador",       permission: "feedback:manage"    },
    { roleSlug: "jefa_chome",          permission: "feedback:create"    },
    { roleSlug: "jefa_chome",          permission: "feedback:view_own"  },
    { roleSlug: "jefa_chome",          permission: "feedback:view_all"  },
    { roleSlug: "jefa_chome",          permission: "feedback:manage"    },
    // Usuarios operativos: crear y ver propios
    { roleSlug: "secretaria",          permission: "feedback:create"    },
    { roleSlug: "secretaria",          permission: "feedback:view_own"  },
    { roleSlug: "prevencionista",      permission: "feedback:create"    },
    { roleSlug: "prevencionista",      permission: "feedback:view_own"  },
    { roleSlug: "solicitante_faena",   permission: "feedback:create"    },
    { roleSlug: "solicitante_faena",   permission: "feedback:view_own"  },
    { roleSlug: "prevencionista_faena", permission: "feedback:create"   },
    { roleSlug: "prevencionista_faena", permission: "feedback:view_own" },
    { roleSlug: "jefe_mantencion",     permission: "feedback:create"    },
    { roleSlug: "jefe_mantencion",     permission: "feedback:view_own"  },
    { roleSlug: "admin_contrato",      permission: "feedback:create"    },
    { roleSlug: "admin_contrato",      permission: "feedback:view_own"  },
  ],
} as const satisfies ModuleManifest
