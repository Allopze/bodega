// Lo único del SDK de navegador que usa la plataforma. Existe para que el
// `import()` diferido de sentry-client.ts apunte a este módulo y no al
// namespace completo de `@sentry/browser`: con re-exports nombrados webpack
// descarta Replay, Feedback y tracing del chunk (de ~300 KB a lo necesario).
export { captureException, init } from "@sentry/browser"
