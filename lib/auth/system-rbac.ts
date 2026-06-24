import { permissions, rolePermissions, roles } from "../../db/schema"

export const SYSTEM_ROLES = [
  { id: "rol-admin", name: "administrador", label: "Administrador", description: "Control total técnico del sistema", isGlobal: true },
  { id: "rol-jefa", name: "jefa_chome", label: "Jefatura", description: "Revisa, aprueba y administra la operación", isGlobal: true },
  { id: "rol-sec", name: "secretaria", label: "Secretaría", description: "Revisa, aprueba y gestiona operación diaria", isGlobal: true },
  { id: "rol-prev", name: "prevencionista", label: "Jefa Dpto. Prevención de riesgos", description: "Revisa y aprueba solicitudes", isGlobal: true },
  { id: "rol-sol-faena", name: "solicitante_faena", label: "Solicitante faena", description: "Solicita ítems para sus faenas asignadas", isGlobal: false },
  { id: "rol-prev-faena", name: "prevencionista_faena", label: "Prevencionista faena", description: "Evalúa EPP, recibe en faena y gestiona stock en sus faenas asignadas", isGlobal: false },
  { id: "rol-jefe-mant", name: "jefe_mantencion", label: "Jefe de mantención", description: "Solicita repuestos, servicios y otros para todas las faenas", isGlobal: true },
  { id: "rol-cond-lider", name: "conductor_lider", label: "Conductor líder", description: "Evalúa el acompañamiento en terreno (Punto 3) de trabajadores nuevos en sus faenas asignadas", isGlobal: false },
] satisfies Array<typeof roles.$inferInsert>

export const SYSTEM_PERMISSIONS = [
  { id: "p-req-create", name: "requests:create", module: "requests", description: "Crear solicitudes" },
  { id: "p-req-own", name: "requests:view_own", module: "requests", description: "Ver solicitudes propias" },
  { id: "p-req-all", name: "requests:view_all", module: "requests", description: "Ver todas las solicitudes" },
  { id: "p-req-submit", name: "requests:submit", module: "requests", description: "Enviar solicitudes a aprobación" },
  { id: "p-req-delete", name: "requests:delete", module: "requests", description: "Eliminar solicitudes no aprobadas" },
  { id: "p-apr", name: "approvals:approve", module: "approvals", description: "Revisar y aprobar solicitudes" },
  { id: "p-pur-view", name: "purchasing:view", module: "purchasing", description: "Ver módulo de órdenes de compra" },
  { id: "p-pur-create", name: "purchasing:create_order", module: "purchasing", description: "Crear órdenes de compra" },
  { id: "p-pur-send", name: "purchasing:send_order", module: "purchasing", description: "Enviar OC a proveedor" },
  { id: "p-pur-sup", name: "purchasing:manage_suppliers", module: "purchasing", description: "Administrar proveedores" },
  { id: "p-pur-delete", name: "purchasing:delete_order", module: "purchasing", description: "Eliminar órdenes de compra no recibidas" },
  { id: "p-rec-reg-office", name: "receiving:register_office", module: "receiving", description: "Registrar llegada a oficina" },
  { id: "p-rec-reg-faena", name: "receiving:register_faena", module: "receiving", description: "Registrar recepción en faena" },
  { id: "p-rec-view", name: "receiving:view", module: "receiving", description: "Ver recepciones" },
  { id: "p-wh-stock", name: "warehouse:view_stock", module: "warehouse", description: "Ver stock" },
  { id: "p-wh-mov", name: "warehouse:register_movement", module: "warehouse", description: "Registrar movimientos" },
  { id: "p-wh-adj", name: "warehouse:adjust_stock", module: "warehouse", description: "Ajustar stock" },
  { id: "p-rep-view", name: "reports:view", module: "reports", description: "Ver reportes y matriz de trazabilidad" },
  { id: "p-adm-usr", name: "admin:users", module: "admin", description: "Gestionar usuarios" },
  { id: "p-adm-ws", name: "admin:worksites", module: "admin", description: "Gestionar faenas" },
  { id: "p-adm-wrk", name: "admin:workers", module: "admin", description: "Gestionar trabajadores" },
  { id: "p-adm-prod", name: "admin:products", module: "admin", description: "Gestionar catálogo" },
  { id: "p-adm-sup", name: "admin:suppliers", module: "admin", description: "Gestionar proveedores" },
  { id: "p-adm-cfg", name: "admin:config", module: "admin", description: "Configuración del sistema" },
  { id: "p-adm-smtp", name: "admin:smtp", module: "admin", description: "Configurar servidor SMTP" },
  { id: "p-adm-tpl", name: "admin:email_templates", module: "admin", description: "Gestionar plantillas de correo" },
  { id: "p-adm-mgt", name: "admin:manage_admins", module: "admin", description: "Asignar roles y permisos de administración" },
  { id: "p-adm-audit", name: "admin:audit_log", module: "admin", description: "Ver log de auditoría" },
  // Repuestos module
  { id: "p-rep-create", name: "repuestos:create", module: "repuestos", description: "Crear solicitudes de repuestos" },
  { id: "p-rep-own", name: "repuestos:view_own", module: "repuestos", description: "Ver solicitudes de repuestos propias" },
  { id: "p-rep-all", name: "repuestos:view_all", module: "repuestos", description: "Ver todas las solicitudes de repuestos" },
  { id: "p-rep-submit", name: "repuestos:submit", module: "repuestos", description: "Enviar solicitudes de repuestos a aprobación" },
  { id: "p-rep-approve", name: "repuestos:approve", module: "repuestos", description: "Aprobar cotizaciones de repuestos" },
  // Servicios module
  { id: "p-srv-create", name: "servicios:create", module: "servicios", description: "Crear solicitudes de servicios" },
  { id: "p-srv-own", name: "servicios:view_own", module: "servicios", description: "Ver solicitudes de servicios propias" },
  { id: "p-srv-all", name: "servicios:view_all", module: "servicios", description: "Ver todas las solicitudes de servicios" },
  { id: "p-srv-submit", name: "servicios:submit", module: "servicios", description: "Enviar solicitudes de servicios a aprobación" },
  { id: "p-srv-approve", name: "servicios:approve", module: "servicios", description: "Aprobar cotizaciones de servicios" },
  // SST module
  { id: "p-sst-view", name: "sst:view", module: "sst", description: "Ver evaluaciones SST" },
  { id: "p-sst-create", name: "sst:create", module: "sst", description: "Crear evaluaciones SST" },
  { id: "p-sst-close", name: "sst:close", module: "sst", description: "Cerrar evaluaciones SST" },
  { id: "p-sst-manage", name: "sst:manage", module: "sst", description: "Gestionar plan de acción SST" },
  { id: "p-sst-acomp", name: "sst:evaluate_acompanamiento", module: "sst", description: "Evaluar acompañamiento en terreno (Punto 3) de evaluación de trabajador nuevo" },
  // PPA Digital module
  { id: "p-ppa-view", name: "ppa:view", module: "ppa", description: "Ver PPA Digital e indicadores" },
  { id: "p-ppa-review", name: "ppa:review", module: "ppa", description: "Revisar y autorizar/rechazar PPA detenidos" },
  { id: "p-ppa-manage", name: "ppa:manage", module: "ppa", description: "Gestionar y exportar PPA Digital" },
  // Feedback / Soporte module
  { id: "p-fb-create", name: "feedback:create",   module: "feedback", description: "Enviar reportes de soporte (bug, consulta, sugerencia)" },
  { id: "p-fb-own",    name: "feedback:view_own",  module: "feedback", description: "Ver los propios reportes de soporte" },
  { id: "p-fb-all",    name: "feedback:view_all",  module: "feedback", description: "Ver todos los reportes de soporte" },
  { id: "p-fb-manage", name: "feedback:manage",    module: "feedback", description: "Gestionar reportes de soporte (cambiar estado, nota interna)" },
  // Deliveries module
  { id: "p-del-view",   name: "deliveries:view",   module: "deliveries", description: "Ver historial de entregas" },
  { id: "p-del-create", name: "deliveries:create", module: "deliveries", description: "Registrar entregas a trabajadores" },
  // Traceability module
  { id: "p-trace-view", name: "traceability:view", module: "traceability", description: "Ver trazabilidad de ítems" },
] satisfies Array<typeof permissions.$inferInsert>

const JEFATURA_PERMISSION_IDS = [
  "p-req-all",
  "p-req-delete",
  "p-apr",
  "p-pur-view",
  "p-pur-delete",
  "p-rec-view",
  "p-wh-stock",
  "p-rep-view",
  "p-trace-view",
  "p-ppa-view",
  "p-ppa-review",
]

const SECRETARIA_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-all", "p-req-submit", "p-req-delete",
  "p-apr",
  "p-pur-view", "p-pur-create", "p-pur-send", "p-pur-sup", "p-pur-delete",
  "p-rec-reg-office", "p-rec-reg-faena", "p-rec-view",
  "p-wh-stock", "p-wh-mov",
  "p-rep-view", "p-trace-view",
  "p-adm-usr", "p-adm-ws", "p-adm-wrk", "p-adm-prod", "p-adm-sup",
]

const PREVENCIONISTA_OFICINA_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-all", "p-req-submit",
  "p-apr",
  "p-rec-reg-office", "p-rec-view",
  "p-wh-stock", "p-wh-mov",
  "p-rep-view", "p-trace-view",
  "p-adm-usr", "p-adm-ws", "p-adm-wrk", "p-adm-prod", "p-adm-sup",
  "p-sst-view", "p-sst-create", "p-sst-close", "p-sst-manage",
  "p-ppa-view", "p-ppa-review", "p-ppa-manage",
]

const PREVENCIONISTA_FAENA_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-submit",
  "p-rec-reg-faena", "p-rec-view",
  "p-wh-stock", "p-wh-mov",
  "p-adm-wrk",
  "p-rep-create", "p-rep-own", "p-rep-submit",
]

const PREVENCIONISTA_FAENA_SCOPE_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-submit",
  "p-rec-reg-faena", "p-rec-view",
  "p-wh-stock", "p-wh-mov",
  "p-adm-wrk",
  "p-rep-create", "p-rep-own", "p-rep-submit",
  "p-srv-create", "p-srv-own", "p-srv-submit",
  "p-sst-view", "p-sst-create",
  "p-rep-view",
  "p-ppa-view", "p-ppa-review",
]

const REPUESTOS_JEFATURA_PERMISSION_IDS = [
  "p-rep-all", "p-rep-approve",
]

const REPUESTOS_SECRETARIA_PERMISSION_IDS = [
  "p-rep-create", "p-rep-own", "p-rep-all", "p-rep-submit",
]

const REPUESTOS_PREVENCIONISTA_PERMISSION_IDS = [
  "p-rep-create", "p-rep-own", "p-rep-all", "p-rep-submit",
]

const SERVICIOS_JEFATURA_PERMISSION_IDS = [
  "p-srv-all", "p-srv-approve",
]

const SERVICIOS_SECRETARIA_PERMISSION_IDS = [
  "p-srv-create", "p-srv-own", "p-srv-all", "p-srv-submit",
]

const SERVICIOS_PREVENCIONISTA_PERMISSION_IDS = [
  "p-srv-create", "p-srv-own", "p-srv-all", "p-srv-submit",
]

const SERVICIOS_FAENA_PERMISSION_IDS = [
  "p-srv-create", "p-srv-own", "p-srv-submit",
]

const JEFE_MANTENCION_PERMISSION_IDS = [
  "p-req-create", "p-req-own", "p-req-submit",
  "p-pur-view",
  "p-rec-reg-faena", "p-rec-view",
  "p-wh-stock",
  "p-rep-view", "p-trace-view",
]

// Feedback / Soporte module
const FEEDBACK_MANAGER_PERMISSION_IDS = [
  "p-fb-create", "p-fb-own", "p-fb-all", "p-fb-manage",
]

const FEEDBACK_USER_PERMISSION_IDS = [
  "p-fb-create", "p-fb-own",
]

// Conductor líder: único permiso — evaluar el Punto 3 (acompañamiento en terreno)
const CONDUCTOR_LIDER_PERMISSION_IDS = ["p-sst-acomp"]

// Deliveries module
const DELIVERIES_VIEW_PERMISSION_IDS = ["p-del-view"]
const DELIVERIES_CREATE_PERMISSION_IDS = ["p-del-view", "p-del-create"]

export const SYSTEM_ROLE_PERMISSIONS = [
  ...SYSTEM_PERMISSIONS.map((permission) => ({ roleId: "rol-admin", permissionId: permission.id })),
  ...JEFATURA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefa", permissionId })),
  ...REPUESTOS_JEFATURA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefa", permissionId })),
  ...SERVICIOS_JEFATURA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefa", permissionId })),
  ...FEEDBACK_MANAGER_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefa", permissionId })),
  ...DELIVERIES_VIEW_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefa", permissionId })),
  ...SECRETARIA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sec", permissionId })),
  ...REPUESTOS_SECRETARIA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sec", permissionId })),
  ...SERVICIOS_SECRETARIA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sec", permissionId })),
  ...FEEDBACK_USER_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sec", permissionId })),
  ...DELIVERIES_CREATE_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sec", permissionId })),
  ...PREVENCIONISTA_OFICINA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev", permissionId })),
  ...REPUESTOS_PREVENCIONISTA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev", permissionId })),
  ...SERVICIOS_PREVENCIONISTA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev", permissionId })),
  ...FEEDBACK_USER_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev", permissionId })),
  ...DELIVERIES_CREATE_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev", permissionId })),
  ...PREVENCIONISTA_FAENA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sol-faena", permissionId })),
  ...SERVICIOS_FAENA_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sol-faena", permissionId })),
  ...FEEDBACK_USER_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sol-faena", permissionId })),
  ...DELIVERIES_VIEW_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-sol-faena", permissionId })),
  ...PREVENCIONISTA_FAENA_SCOPE_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev-faena", permissionId })),
  ...FEEDBACK_USER_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev-faena", permissionId })),
  ...DELIVERIES_CREATE_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-prev-faena", permissionId })),
  ...JEFE_MANTENCION_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefe-mant", permissionId })),
  ...FEEDBACK_USER_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-jefe-mant", permissionId })),
  ...CONDUCTOR_LIDER_PERMISSION_IDS.map((permissionId) => ({ roleId: "rol-cond-lider", permissionId })),
] satisfies Array<typeof rolePermissions.$inferInsert>
