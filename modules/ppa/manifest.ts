import type { ModuleManifest } from "@/modules/manifest-types"

export const ppaModule = {
  id: "ppa",
  permissions: [
    "ppa:view",    // ver PPA e indicadores
    "ppa:review",  // revisar PPA detenidos y solicitar corrección
    "ppa:correct",
    "ppa:verify",
    "ppa:authorize_restart",
    "ppa:cancel",
    "ppa:close",
    "ppa:manage",  // gestión avanzada (export, administración)
  ] as const,

  permissionMeta: {
    "ppa:view":   { id: "p-ppa-view",   description: "Ver PPA Digital e indicadores" },
    "ppa:review": { id: "p-ppa-review", description: "Revisar PPA detenidos y solicitar controles" },
    "ppa:correct": { id: "p-ppa-correct", description: "Declarar implementación de controles y solicitar verificación" },
    "ppa:verify": { id: "p-ppa-verify", description: "Verificar en terreno la corrección de un PPA" },
    "ppa:authorize_restart": { id: "p-ppa-restart", description: "Autorizar el reinicio de una tarea después de verificación" },
    "ppa:cancel": { id: "p-ppa-cancel", description: "Cancelar una tarea PPA con motivo obligatorio" },
    "ppa:close": { id: "p-ppa-close", description: "Cerrar administrativamente un caso PPA autorizado" },
    "ppa:manage": { id: "p-ppa-manage", description: "Gestionar y exportar PPA Digital" },
  },
  nav: [
    {
      areaId: "prevencion",
      items: [
        {
          label: "Para, Piensa y Actúa",
          href: "/prevencion/ppa",
          iconName: "ShieldCheck",
          group: "Evaluación en terreno",
          permissions: ["ppa:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    // Revisión en faena (responsable directo).
    { roleSlug: "prevencionista_faena", permission: "ppa:view" },
    { roleSlug: "prevencionista_faena", permission: "ppa:review" },
    { roleSlug: "prevencionista_faena", permission: "ppa:correct" },
    // Prevención de oficina y jefatura.
    { roleSlug: "prevencionista", permission: "ppa:view" },
    { roleSlug: "prevencionista", permission: "ppa:review" },
    { roleSlug: "prevencionista", permission: "ppa:correct" },
    { roleSlug: "prevencionista", permission: "ppa:verify" },
    { roleSlug: "prevencionista", permission: "ppa:authorize_restart" },
    { roleSlug: "prevencionista", permission: "ppa:cancel" },
    { roleSlug: "prevencionista", permission: "ppa:close" },
    { roleSlug: "prevencionista", permission: "ppa:manage" },
    { roleSlug: "jefa_chome", permission: "ppa:view" },
    { roleSlug: "jefa_chome", permission: "ppa:review" },
    { roleSlug: "jefa_chome", permission: "ppa:verify" },
    { roleSlug: "jefa_chome", permission: "ppa:authorize_restart" },
    { roleSlug: "jefa_chome", permission: "ppa:cancel" },
    { roleSlug: "jefa_chome", permission: "ppa:close" },
    // Administración.
    { roleSlug: "administrador", permission: "ppa:view" },
    { roleSlug: "administrador", permission: "ppa:review" },
    { roleSlug: "administrador", permission: "ppa:correct" },
    { roleSlug: "administrador", permission: "ppa:verify" },
    { roleSlug: "administrador", permission: "ppa:authorize_restart" },
    { roleSlug: "administrador", permission: "ppa:cancel" },
    { roleSlug: "administrador", permission: "ppa:close" },
    { roleSlug: "administrador", permission: "ppa:manage" },
  ],
} as const satisfies ModuleManifest
