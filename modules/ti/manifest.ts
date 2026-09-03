import type { ModuleManifest } from "@/modules/manifest-types"

export const tiModule = {
  id: "ti",
  permissions: [
    "ti:view",
    "ti:manage_assets",
    "ti:manage_maintenance",
    "ti:manage_tickets",
    "ti:create_ticket",
    "ti:comment_internal",
    "ti:manage_licenses",
    "ti:manage_access",
    "ti:export",
  ] as const,

  permissionMeta: {
    "ti:view":              { id: "p-ti-view",              description: "Ver módulo TI (inventario, dashboard, fichas)" },
    "ti:manage_assets":     { id: "p-ti-manage-assets",    description: "Crear y editar activos, asignaciones, devoluciones y bajas" },
    "ti:manage_maintenance":{ id: "p-ti-manage-maintenance", description: "Registrar y editar mantenciones y reparaciones" },
    "ti:manage_tickets":    { id: "p-ti-manage-tickets",   description: "Asignar, transicionar y resolver tickets TI" },
    "ti:create_ticket":     { id: "p-ti-create-ticket",    description: "Crear tickets TI a nombre de trabajadores" },
    "ti:comment_internal":  { id: "p-ti-comment-internal", description: "Ver y escribir notas internas en tickets TI" },
    "ti:manage_licenses":   { id: "p-ti-manage-licenses",  description: "Gestionar licencias, suscripciones y sus asignaciones" },
    "ti:manage_access":     { id: "p-ti-manage-access",    description: "Gestionar sistemas de acceso y checklists de alta/baja" },
    "ti:export":            { id: "p-ti-export",           description: "Exportar reportes TI a Excel" },
  },

  nav: [
    {
      areaId: "ti",
      items: [
        { label: "Dashboard TI",        href: "/ti",             iconName: "Desktop",       permissions: ["ti:view"] },
        { label: "Inventario",          href: "/ti/activos",     iconName: "Laptop",        permissions: ["ti:view"] },
        { label: "Asignaciones",        href: "/ti/asignaciones", iconName: "UserCirclePlus", permissions: ["ti:view"] },
        { label: "Mantenciones",        href: "/ti/mantenciones", iconName: "Wrench",        permissions: ["ti:view"] },
        { label: "Tickets",             href: "/ti/tickets",     iconName: "Ticket",        permissions: ["ti:view", "ti:create_ticket", "ti:manage_tickets"] },
        { label: "Licencias",           href: "/ti/licencias",   iconName: "Key",           permissions: ["ti:view"] },
        { label: "Accesos",             href: "/ti/accesos",     iconName: "LockKeyOpen",   permissions: ["ti:view"] },
        { label: "Garantías y proveedores", href: "/ti/garantias", iconName: "ShieldCheck", permissions: ["ti:view"] },
        { label: "Bajas",               href: "/ti/bajas",       iconName: "Archive",       permissions: ["ti:view"] },
        { label: "Reportes",            href: "/ti/reportes",    iconName: "ChartBar",      permissions: ["ti:view", "ti:export"] },
      ],
    },
  ],

  defaultGrants: [
    { roleSlug: "tecnico_ti",       permission: "ti:view" },
    { roleSlug: "tecnico_ti",       permission: "ti:manage_assets" },
    { roleSlug: "tecnico_ti",       permission: "ti:manage_maintenance" },
    { roleSlug: "tecnico_ti",       permission: "ti:manage_tickets" },
    { roleSlug: "tecnico_ti",       permission: "ti:comment_internal" },
    { roleSlug: "tecnico_ti",       permission: "ti:manage_licenses" },
    { roleSlug: "tecnico_ti",       permission: "ti:manage_access" },
    { roleSlug: "tecnico_ti",       permission: "ti:export" },
    { roleSlug: "jefa_chome",       permission: "ti:view" },
    { roleSlug: "jefa_chome",       permission: "ti:export" },
    { roleSlug: "subgerente_operaciones", permission: "ti:view" },
    { roleSlug: "subgerente_operaciones", permission: "ti:export" },
    { roleSlug: "admin_contrato",   permission: "ti:create_ticket" },
    { roleSlug: "jefe_terreno",     permission: "ti:create_ticket" },
    { roleSlug: "supervisor_terreno", permission: "ti:create_ticket" },
    { roleSlug: "secretaria",       permission: "ti:create_ticket" },
  ],
} as const satisfies ModuleManifest
