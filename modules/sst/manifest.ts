import type { ModuleManifest } from "@/modules/manifest-types"

export const sstModule = {
  id: "sst",
  permissions: [
    "sst:view",
    "sst:create",
    "sst:close",
    "sst:manage",
    "sst:evaluate_acompanamiento",
  ] as const,

  permissionMeta: {
    "sst:view":                    { id: "p-sst-view",  description: "Ver evaluaciones SST" },
    "sst:create":                  { id: "p-sst-create", description: "Crear evaluaciones SST" },
    "sst:close":                   { id: "p-sst-close", description: "Cerrar evaluaciones SST" },
    "sst:manage":                  { id: "p-sst-manage", description: "Gestionar plan de acción SST" },
    "sst:evaluate_acompanamiento": { id: "p-sst-acomp", description: "Evaluar acompañamiento en terreno (Punto 3) de evaluación de trabajador nuevo" },
  },
  nav: [
    {
      areaId: "prevencion",
      items: [
        {
          label: "Evaluaciones SST",
          href: "/prevencion/evaluaciones",
          iconName: "ClipboardText",
          group: "En terreno",
          permissions: ["sst:view", "sst:evaluate_acompanamiento"],
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
    /* El acta de trabajador nuevo acredita seis actividades del PDTP —n=15,
     * 18, 19, 23, 52 y 63— y todas al CERRARLA. El prevencionista de faena es
     * el responsable declarado de las seis y podía abrirla sin poder cerrarla,
     * así que su cumplimiento dependía de que alguien de la jefatura entrara a
     * firmar cada acta de cada faena. El alcance por faena lo acota. */
    { roleSlug: "prevencionista_faena", permission: "sst:close" },
    /* El instrumento declara que el Acta de Cierre la firman "supervisor y
     * prevencionista", y la planilla asigna la n=15 y la n=52 al supervisor y
     * al jefe de terreno. No tenían ni `sst:view`: el acta que deben firmar no
     * existía para ellos. Cerrar sigue siendo del prevencionista. */
    { roleSlug: "jefe_terreno", permission: "sst:view" },
    { roleSlug: "supervisor_terreno", permission: "sst:view" },
    { roleSlug: "administrador", permission: "sst:view" },
    { roleSlug: "administrador", permission: "sst:create" },
    { roleSlug: "administrador", permission: "sst:close" },
    { roleSlug: "administrador", permission: "sst:manage" },
    { roleSlug: "administrador", permission: "sst:evaluate_acompanamiento" },
    { roleSlug: "conductor_lider", permission: "sst:evaluate_acompanamiento" },
    { roleSlug: "admin_contrato", permission: "sst:view" },
    { roleSlug: "admin_contrato", permission: "sst:create" },
  ],
} as const satisfies ModuleManifest
