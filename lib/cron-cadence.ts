/**
 * lib/cron-cadence.ts — Cadencia esperada de los jobs de Prevención.
 *
 * Sale del crontab (`docker-compose.yml`, servicio `cron`) con margen: un job
 * diario se da por detenido a las 26 h, uno horario a las 3 h, el semanal a los
 * 8 días. Vive aparte de `lib/services/cron-staleness.ts` (que consulta la base)
 * para que la vista «Apps» de TI la use desde un módulo puro.
 */
export const PREVENTION_CRON_MAX_AGE_HOURS: Readonly<Record<string, number>> = {
  "pdtp-weekly-reminders": 8 * 24,
  "pdtp-daily-reconcile": 26,
  "pdtp-evidence-integrity": 26,
  "pdtp-evidence-gc": 26,
  "prevention-inspection-programs": 26,
  "prevention-capa-reminders": 26,
  "prevention-training-reminders": 26,
  "prevention-cphs-alerts": 26,
  // F3: barrido diario de ocurrencias del Programa de Trabajo (vencidas y «No se
  // hizo»). Sin él acá, un cron detenido no se alerta y las alertas se apagan en
  // silencio — que es justo lo que este vigilante existe para evitar.
  "prevention-miper-daily-sweep": 26,
  "prevention-document-ack-reminders": 26,
  "sst-weekly-alerts": 26,
  "deadline-reminders": 26,
  "prevention-incident-reminders": 3,
  "prevention-permit-expiry": 1,
}
