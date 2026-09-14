import * as Sentry from "@sentry/nextjs"
// HALLAZGO OBS-001 (S3/P1): este `beforeSend` sólo borraba `cookie` y
// `authorization`; la URL con su query, el cuerpo de la Server Action, las
// cookies parseadas, `extra` y el usuario completo viajaban al proveedor de
// telemetría. La depuración ahora vive en un único módulo compartido por los
// tres runtimes (servidor, edge y navegador), que antes repetían el mismo
// filtro insuficiente tres veces.
import { depurarEventoTelemetria } from "@/lib/security/telemetry-scrub"

const SENTRY_DSN = process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return depurarEventoTelemetria(event)
    },
  })
}
