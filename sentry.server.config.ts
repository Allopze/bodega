import * as Sentry from "@sentry/nextjs"

const SENTRY_DSN = process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request?.headers) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { cookie, authorization, ...safe } = event.request.headers as Record<string, string>
        event.request.headers = safe
      }
      return event
    },
  })
}
