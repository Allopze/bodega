/**
 * lib/apps/catalog.ts — Catálogo de las apps de la plataforma (vista «Apps» de TI).
 *
 * Una app es un módulo del registry con pantalla propia. Este archivo es puro
 * (sin base de datos) y responde tres preguntas que el registry no contesta:
 *
 * 1. Por dónde se entra a la app y con qué ícono se la reconoce.
 * 2. Qué filas de `audit_log` son actividad de esa app (`entity_type` → app).
 * 3. Qué jobs de `cron_runs` son sus integraciones y cada cuánto deben correr.
 *
 * El mapeo de `entity_type` es explícito a propósito: el tipo lo elige cada
 * servicio al llamar `recordAudit` y no lleva el módulo dentro. Un tipo nuevo
 * que nadie mapee no se pierde: la vista lo cuenta como «sin app asignada» y lo
 * muestra, en vez de esconderlo dentro de la app equivocada.
 */
import { registry } from "@/modules/registry"
import { AREAS } from "@/components/layout/areas"
import { getModuleLabel } from "@/lib/module-labels"
import { PREVENTION_CRON_MAX_AGE_HOURS } from "@/lib/cron-cadence"

export interface AppDef {
  /** id del módulo en el registry. */
  id:        string
  label:     string
  /** Ruta de entrada: la primera pantalla de la app. */
  href:      string
  iconName:  string
  areaId:    string
  areaLabel: string
  /** Orden del área en el menú, para que la tabla salga en el mismo orden. */
  areaOrder: number
  /**
   * Por qué la app no tiene movimientos propios en la auditoría. Sin esta nota,
   * «0 movimientos» se lee como «nadie la usa» en una app de sólo lectura.
   */
  activityNote?: string
}

interface AppMeta {
  href:     string
  iconName: string
  /** Área de la app cuando el manifest no declara menú (Administración). */
  areaId?:  string
  activityNote?: string
}

/**
 * Entrada e ícono de cada app. Servicios no está: no tiene pantalla, se crea y
 * se gestiona dentro de Solicitudes, y su actividad se cuenta ahí.
 */
const APP_META: Record<string, AppMeta> = {
  operations:         { href: "/pendientes",            iconName: "CheckSquare" },
  requests:           { href: "/solicitudes",           iconName: "ClipboardText" },
  approvals:          { href: "/aprobaciones",          iconName: "ListChecks", activityNote: "Las aprobaciones se registran en Solicitudes" },
  purchasing:         { href: "/compras",               iconName: "ShoppingCart" },
  receiving:          { href: "/recepcion",             iconName: "Package" },
  flota:              { href: "/flota",                 iconName: "Car" },
  mantencion_equipos: { href: "/mantencion/panel",      iconName: "Wrench" },
  repuestos:          { href: "/mantencion/repuestos",  iconName: "Toolbox" },
  combustibles:       { href: "/combustibles",          iconName: "GasPump" },
  warehouse:          { href: "/bodega",                iconName: "Warehouse" },
  deliveries:         { href: "/entregas",              iconName: "HardHat" },
  billing:            { href: "/facturacion",           iconName: "Receipt" },
  reports:            { href: "/reportes",              iconName: "ChartBar", activityNote: "Sólo lectura: no registra movimientos" },
  analytics:          { href: "/analitica",             iconName: "ChartLineUp", activityNote: "Sólo lectura: no registra movimientos" },
  prevention:         { href: "/prevencion",            iconName: "ShieldCheck" },
  sst:                { href: "/prevencion/evaluaciones", iconName: "ClipboardText" },
  ppa:                { href: "/prevencion/ppa",        iconName: "FileText" },
  ti:                 { href: "/ti",                    iconName: "Desktop" },
  feedback:           { href: "/soporte",               iconName: "Lifebuoy" },
  admin:              { href: "/admin",                 iconName: "GearSix", areaId: "admin" },
}

/** Módulos del registry que no son una app propia. */
export const NON_APP_MODULES = new Set(["servicios"])

const ADMIN_AREA = { id: "admin", label: "Administración", order: 90 }

function areaOf(moduleId: string): { id: string; label: string; order: number } {
  const mod = (registry as readonly { id: string; nav?: readonly { areaId: string }[] }[])
    .find((entry) => entry.id === moduleId)
  const areaId = APP_META[moduleId]?.areaId ?? mod?.nav?.[0]?.areaId
  const area = AREAS.find((entry) => entry.id === areaId)
  return area ? { id: area.id, label: area.label, order: area.order } : ADMIN_AREA
}

/** Las apps, en el orden del menú (área, luego registro). */
export const APPS: AppDef[] = (registry as readonly { id: string }[])
  .filter((mod) => !NON_APP_MODULES.has(mod.id) && APP_META[mod.id])
  .map((mod, index) => {
    const meta = APP_META[mod.id]!
    const area = areaOf(mod.id)
    return {
      id: mod.id,
      label: getModuleLabel(mod.id),
      href: meta.href,
      iconName: meta.iconName,
      areaId: area.id,
      areaLabel: area.label,
      areaOrder: area.order * 100 + index,
      ...(meta.activityNote ? { activityNote: meta.activityNote } : {}),
    }
  })
  .sort((left, right) => left.areaOrder - right.areaOrder)

export function findApp(id: string): AppDef | undefined {
  return APPS.find((app) => app.id === id)
}

/** Ids de módulo que no tienen entrada en `APP_META` (lo vigila un test). */
export function modulesWithoutApp(): string[] {
  return (registry as readonly { id: string }[])
    .map((mod) => mod.id)
    .filter((id) => !NON_APP_MODULES.has(id) && !APP_META[id])
}

// ── Actividad: entity_type de audit_log → app ────────────────────────────────

/**
 * Tipos exactos. Ganan sobre los prefijos: `prevention_container` es el
 * catálogo de contenedores de Administración, no Prevención.
 */
const ENTITY_EXACT: Record<string, string> = {
  // Solicitudes (incluye Servicios, que vive dentro del flujo de solicitudes)
  request: "requests",
  request_item: "requests",
  // Bodega
  inventory_movement: "warehouse",
  stock_item: "warehouse",
  worksite_stock: "warehouse",
  physical_inventory_count: "warehouse",
  dispatch_guide: "warehouse",
  traceability_integrity_case: "warehouse",
  // Recepción
  receipt: "receiving",
  // Entregas
  delivery: "deliveries",
  delivery_item: "deliveries",
  // Facturación
  client: "billing",
  // Flota: el padrón de equipos vive en `fuel_vehicles` pero es de Flota
  fuel_vehicle: "flota",
  fuel_vehicle_worksite_intervals: "flota",
  contract: "flota",
  contract_vehicle_assignment: "flota",
  operational_control_report: "flota",
  // Pendientes operacionales
  operational_integrity_case: "operations",
  operational_work: "operations",
  operational_settings: "operations",
  // Evaluaciones SST
  sst_evaluation: "sst",
  sst_followup: "sst",
  // PPA
  ppa: "ppa",
  // TI
  ti_report: "ti",
  // Prevención (tipos sin prefijo propio)
  capa_action: "prevention",
  miper: "prevention",
  permit: "prevention",
  work_permit: "prevention",
  management_review: "prevention",
  incident_person: "prevention",
  certification_dossier: "prevention",
  emergency_plan: "prevention",
  emergency_scenario_type: "prevention",
  inspection_program: "prevention",
  inspection_run: "prevention",
  inspection_template: "prevention",
  // Administración
  prevention_container: "admin",
  service_equipment: "admin",
  supplier: "admin",
  cost_center: "admin",
  product: "admin",
  product_category: "admin",
  worksite: "admin",
  role: "admin",
  module_toggle: "admin",
  submodule_toggle: "admin",
  system_setting: "admin",
  system_settings: "admin",
  email_template: "admin",
  code_sequence: "admin",
  notification: "admin",
  storage_orphan_sweep: "admin",
  backup_health: "admin",
  cron_run: "admin",
  rate_limit: "admin",
  smtp_delivery_test: "admin",
  resend_settings: "admin",
  cloudreve_storage_settings: "admin",
  pdf_engine_settings: "admin",
  generated_documents_settings: "admin",
}

/** Prefijos, del más específico al más general: gana el más largo que calce. */
const ENTITY_PREFIXES: Array<[prefix: string, appId: string]> = [
  ["purchase_request", "requests"],
  ["purchase_order", "purchasing"],
  ["billing_", "billing"],
  ["dte_", "billing"],
  ["fleet_", "flota"],
  ["fuel_", "combustibles"],
  ["combustibles_", "combustibles"],
  ["mant_", "mantencion_equipos"],
  ["spare_parts_", "repuestos"],
  ["it_", "ti"],
  ["feedback_", "feedback"],
  ["ppa_", "ppa"],
  ["sst_document", "prevention"],
  ["prevention_", "prevention"],
  ["pdtp", "prevention"],
  ["grd_", "prevention"],
  ["risk_legal:", "prevention"],
  ["inspection:", "prevention"],
  ["hygiene:", "prevention"],
  ["governance:", "prevention"],
  ["emergency:", "prevention"],
  ["alcotest", "prevention"],
  ["training", "prevention"],
  ["user", "admin"],
  ["worker", "admin"],
  ["epp_", "admin"],
  ["talana_", "admin"],
]

const PREFIXES_LONGEST_FIRST = [...ENTITY_PREFIXES].sort((left, right) => right[0].length - left[0].length)

/** App dueña de un `entity_type`, o null si nadie lo mapeó. */
export function appForEntityType(entityType: string): string | null {
  const exact = ENTITY_EXACT[entityType]
  if (exact) return exact
  for (const [prefix, appId] of PREFIXES_LONGEST_FIRST) {
    if (entityType.startsWith(prefix)) return appId
  }
  return null
}

/** Todos los ids de app que el mapeo nombra (lo vigila un test contra `APPS`). */
export function appIdsReferencedByEntityMap(): string[] {
  return [...new Set([...Object.values(ENTITY_EXACT), ...ENTITY_PREFIXES.map(([, appId]) => appId)])]
}

// ── Integraciones: job de cron_runs → app ────────────────────────────────────

export interface AppCronJob {
  jobName:     string
  appId:       string
  /** Nombre en lenguaje de usuario. */
  label:       string
  /**
   * Horas sin una corrida exitosa tras las cuales el job se da por detenido. Sale
   * del crontab (`docker-compose.yml`, servicio `cron`) con margen, igual que
   * `PREVENTION_CRON_MAX_AGE_HOURS`: diario 26 h, cada 5 min 1 h.
   */
  maxAgeHours: number
}

const PREVENTION_JOB_LABELS: Record<string, string> = {
  "pdtp-weekly-reminders": "Recordatorio semanal del programa",
  "pdtp-daily-reconcile": "Conciliación diaria del programa",
  "pdtp-evidence-integrity": "Integridad de evidencias del programa",
  "pdtp-evidence-gc": "Limpieza de evidencias huérfanas",
  "prevention-inspection-programs": "Programas de inspección",
  "prevention-capa-reminders": "Recordatorios CAPA",
  "prevention-training-reminders": "Recordatorios de capacitaciones",
  "prevention-cphs-alerts": "Alertas del comité paritario",
  "prevention-miper-daily-sweep": "Barrido diario MIPER",
  "prevention-document-ack-reminders": "Recordatorios de toma de conocimiento",
  "sst-weekly-alerts": "Alertas semanales SST",
  "deadline-reminders": "Avisos de vencimientos",
  "prevention-incident-reminders": "Recordatorios de incidentes",
  "prevention-permit-expiry": "Vencimiento de permisos de trabajo",
}

export const APP_CRON_JOBS: AppCronJob[] = [
  { jobName: "fuel-copec-sync", appId: "combustibles", label: "Sincronización Copec", maxAgeHours: 26 },
  { jobName: "fuel-visionlink-sync", appId: "combustibles", label: "Sincronización VisionLink", maxAgeHours: 26 },
  { jobName: "fuel-visionlink-hourly", appId: "combustibles", label: "Tramos por hora VisionLink", maxAgeHours: 3 },
  { jobName: "fuel-anomaly-detection", appId: "combustibles", label: "Detección de anomalías", maxAgeHours: 26 },
  { jobName: "fuel-statement-notifications", appId: "combustibles", label: "Avisos de estados de cuenta", maxAgeHours: 26 },
  { jobName: "fleet-onway-sync", appId: "flota", label: "GPS OnWay", maxAgeHours: 1 },
  { jobName: "fleet-wialon-sync", appId: "flota", label: "GPS Wialon", maxAgeHours: 1 },
  { jobName: "fleet-onway-retention", appId: "flota", label: "Retención de posiciones GPS", maxAgeHours: 26 },
  { jobName: "mantencion-fotos-huerfanas", appId: "mantencion_equipos", label: "Limpieza de fotos huérfanas", maxAgeHours: 26 },
  { jobName: "operational-integrity-scan", appId: "operations", label: "Revisión de integridad operacional", maxAgeHours: 26 },
  { jobName: "ti-alerts", appId: "ti", label: "Alertas de TI", maxAgeHours: 26 },
  { jobName: "feedback-sla-reminders", appId: "feedback", label: "Recordatorios de plazo de soporte", maxAgeHours: 26 },
  { jobName: "talana-workers-sync", appId: "admin", label: "Sincronización Talana", maxAgeHours: 26 },
  { jobName: "generated-documents-archive", appId: "admin", label: "Archivo de documentos generados", maxAgeHours: 1 },
  { jobName: "prevention-cron-staleness", appId: "prevention", label: "Vigilancia de tareas de Prevención", maxAgeHours: 3 },
  ...Object.entries(PREVENTION_CRON_MAX_AGE_HOURS).map(([jobName, maxAgeHours]) => ({
    jobName,
    appId: jobName === "sst-weekly-alerts" ? "sst" : "prevention",
    label: PREVENTION_JOB_LABELS[jobName] ?? jobName,
    maxAgeHours,
  })),
]

export function cronJobsForApp(appId: string): AppCronJob[] {
  return APP_CRON_JOBS.filter((job) => job.appId === appId)
}
