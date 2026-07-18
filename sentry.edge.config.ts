import * as Sentry from "@sentry/nextjs"

const SENTRY_DSN = process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request?.headers) {
        const { cookie, authorization, ...safe } = event.request.headers as Record<string, string>
        void cookie
        void authorization
        event.request.headers = safe
      }
      return event
    },
  })
}
