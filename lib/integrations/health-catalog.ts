/**
 * lib/integrations/health-catalog.ts — Catálogo de integraciones y tareas
 * programadas de la plataforma (pantalla TI › Integraciones).
 *
 * Puro (sin base de datos). Dice qué jobs de `cron_runs` se vigilan, a qué
 * módulo pertenecen y cada cuánto deben correr; el estado de cada uno lo
 * calcula `lib/integrations/health.ts`.
 */
import { PREVENTION_CRON_MAX_AGE_HOURS } from "@/lib/cron-cadence"

export interface IntegrationJob {
  jobName:     string
  /** id del módulo en el registry al que pertenece el job. */
  moduleId:    string
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

export const INTEGRATION_JOBS: IntegrationJob[] = [
  { jobName: "fuel-copec-sync", moduleId: "combustibles", label: "Sincronización Copec", maxAgeHours: 26 },
  { jobName: "fuel-visionlink-sync", moduleId: "combustibles", label: "Sincronización VisionLink", maxAgeHours: 26 },
  { jobName: "fuel-visionlink-hourly", moduleId: "combustibles", label: "Tramos por hora VisionLink", maxAgeHours: 3 },
  { jobName: "fuel-anomaly-detection", moduleId: "combustibles", label: "Detección de anomalías", maxAgeHours: 26 },
  { jobName: "fuel-statement-notifications", moduleId: "combustibles", label: "Avisos de estados de cuenta", maxAgeHours: 26 },
  { jobName: "fleet-onway-sync", moduleId: "flota", label: "GPS OnWay", maxAgeHours: 1 },
  { jobName: "fleet-wialon-sync", moduleId: "flota", label: "GPS Wialon", maxAgeHours: 1 },
  { jobName: "fleet-onway-retention", moduleId: "flota", label: "Retención de posiciones GPS", maxAgeHours: 26 },
  { jobName: "mantencion-fotos-huerfanas", moduleId: "mantencion_equipos", label: "Limpieza de fotos huérfanas", maxAgeHours: 26 },
  { jobName: "operational-integrity-scan", moduleId: "operations", label: "Revisión de integridad operacional", maxAgeHours: 26 },
  { jobName: "ti-alerts", moduleId: "ti", label: "Alertas de TI", maxAgeHours: 26 },
  { jobName: "feedback-sla-reminders", moduleId: "feedback", label: "Recordatorios de plazo de soporte", maxAgeHours: 26 },
  { jobName: "talana-workers-sync", moduleId: "admin", label: "Sincronización Talana", maxAgeHours: 26 },
  { jobName: "generated-documents-archive", moduleId: "admin", label: "Archivo de documentos generados", maxAgeHours: 1 },
  { jobName: "prevention-cron-staleness", moduleId: "prevention", label: "Vigilancia de tareas de Prevención", maxAgeHours: 3 },
  ...Object.entries(PREVENTION_CRON_MAX_AGE_HOURS).map(([jobName, maxAgeHours]) => ({
    jobName,
    moduleId: jobName === "sst-weekly-alerts" ? "sst" : "prevention",
    label: PREVENTION_JOB_LABELS[jobName] ?? jobName,
    maxAgeHours,
  })),
]
