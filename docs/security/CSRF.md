# Protección CSRF

> Audit S-12 / S-05. Documenta cómo se mitiga CSRF en Chome Solicitudes y Bodega.

## Resumen

**Todas las mutaciones de datos pasan por Next.js Server Actions.** No existen
endpoints `POST`/`PUT`/`DELETE` "tradicionales" que muten estado: los handlers
bajo `app/api/*` son **solo lectura** (descarga de adjuntos, exportaciones,
health check, NextAuth).

Next.js Server Actions traen protección CSRF incorporada:

1. Se invocan únicamente vía `POST` con el header interno `Next-Action`.
2. El runtime de Next compara el header `Origin` contra el `Host` y **rechaza
   solicitudes cross-origin** antes de ejecutar la acción.
3. NextAuth v5 usa cookies `SameSite=Lax` + token CSRF propio para el flujo de
   credenciales.

Por lo tanto, un sitio atacante no puede disparar una Server Action en nombre de
un usuario autenticado: el navegador enviaría un `Origin` distinto y Next la
rechaza.

## Reglas para mantener esta garantía

- **No** agregar endpoints `app/api/*` que muten estado sin un control CSRF
  explícito (token sincronizado o verificación de `Origin`/`Sec-Fetch-Site`).
  Si una integración externa lo requiere, usar un esquema de API key/HMAC, no
  cookies de sesión.
- Mantener `cookies.sameSite` en `lax` o `strict` para la cookie de sesión.
- Las notificaciones por correo se difieren **después** del commit con
  `notifyAfterCommit` (S-05), de modo que un fallo/rollback nunca produce un
  efecto observable (email) sin su mutación correspondiente.

## Verificación pendiente

- [ ] Test E2E (Playwright) que haga un `POST` cross-origin a una Server Action
      y verifique el rechazo (403/400). Tracked en `AUDITORIA_COMPLETA.md` (T-01).
