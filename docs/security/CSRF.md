# Protección CSRF

> Auditoría S-12 / S-05. Documenta cómo se mitiga CSRF en Plataforma Chome.

**Last updated:** 2026-06-19

---

## Resumen

**Todas las mutaciones de datos pasan por Next.js Server Actions.** No existen
endpoints `POST`/`PUT`/`DELETE` "tradicionales" que muten estado: los handlers
bajo `app/api/*` son **solo lectura** (descarga de adjuntos, exportaciones,
health check, NextAuth, lectura de notificaciones).

Next.js Server Actions traen protección CSRF incorporada:

1. Se invocan únicamente vía `POST` con el header interno `Next-Action`.
2. El runtime de Next compara el header `Origin` contra el `Host` y **rechaza
   solicitudes cross-origin** antes de ejecutar la acción.
3. NextAuth v5 usa cookies `SameSite=Lax` + token CSRF propio para el flujo de
   credenciales.

Por lo tanto, un sitio atacante no puede disparar una Server Action en nombre de
un usuario autenticado: el navegador enviaría un `Origin` distinto y Next la
rechaza.

---

## Mapa de rutas — mutaciones vs solo lectura

### Mutaciones (Server Actions — CSRF protegido por Next.js)

| Server Action | Archivo | Operación |
|---|---|---|
| `saveDraftAction` | `app/(app)/repuestos/actions.ts`, `app/(app)/servicios/actions.ts` | Crear/editar borrador |
| `submitRequestAction` | (mismos archivos) | Enviar solicitud |
| `uploadQuotationAction` | (mismos archivos) | Subir cotización (PDF) |
| `deleteQuotationAction` | (mismos archivos) | Eliminar cotización |
| `selectQuotationAction` | (mismos archivos) | Aprobar cotización |
| `cancelRequestAction` | (mismos archivos) | Cancelar solicitud |
| `updateSystemSettings` | `app/(app)/admin/configuracion/actions.ts` | Actualizar configuración |
| `createUser`, `updateUser`, `deleteUser` | `app/(app)/admin/usuarios/actions.ts` | CRUD de usuarios |
| `markReadAction`, `markAllReadAction` | `app/(app)/notificaciones/actions.ts` | Marcar notificaciones leídas |
| `updateStockMovement` | `app/(app)/bodega/actions.ts` | Movimiento de stock |
| `receiveItems`, `rejectItems` | `app/(app)/recepcion/actions.ts` | Recepción de mercadería |
| `deliverItems` | `app/(app)/entregas/actions.ts` | Entrega de EPP |
| `createOc`, `receiveOc` | `app/(app)/compras/actions.ts` | Órdenes de compra |
| `createSstInspection` | `app/(app)/prevencion/actions.ts` | Inspecciones SST |

### Solo lectura (Route Handlers — sin CSRF risk)

| Ruta | Archivo | Método | Propósito |
|---|---|---|---|
| `/api/auth/[...nextauth]` | `app/api/auth/[...nextauth]/route.ts` | GET/POST | NextAuth handler (protegido internamente) |
| `/api/health` | `app/api/health/route.ts` | GET | Healthcheck (público) |
| `/api/notifications` | `app/api/notifications/route.ts` | GET | Leer notificaciones + unreadCount |
| `/api/attachments/[id]` | `app/api/attachments/[id]/route.ts` | GET | Descargar adjunto (ownership check) |
| `/api/reportes/export` | `app/api/reportes/export/route.ts` | GET | Exportar reportes Excel |
| `/api/trazabilidad/export` | `app/api/trazabilidad/export/route.ts` | GET | Exportar trazabilidad Excel |
| `/api/purchase-orders/invoices/[id]` | `app/api/purchase-orders/invoices/[id]/route.ts` | GET | Descargar factura |
| `/api/servicios/cotizaciones/[id]` | `app/api/servicios/cotizaciones/[id]/route.ts` | GET | Descargar cotización |
| `/api/repuestos/quotaciones/[id]` | `app/api/repuestos/quotaciones/[id]/route.ts` | GET | Descargar cotización |

**Nota:** El antiguo `POST /api/notifications` (mark-read, mark-all-read) fue
eliminado y migrado a Server Actions CSRF-safe en
`app/(app)/notificaciones/actions.ts`.

---

## Cómo funciona la protección

### Server Actions (mutaciones)

```
Browser                    Next.js Runtime
  │                           │
  │  POST /repuestos          │
  │  Header: Next-Action: xxx │
  │  Body: {"id":"..",...}    │
  │──────────────────────────▶│
  │                           │── 1. ¿Origin === Host?  ── NO ──▶ 403
  │                           │── 2. ¿Cookie de sesión válida? ── NO ──▶ redirect a /login
  │                           │── 3. ¿Permiso requerido? ── NO ──▶ return {ok:false}
  │                           │── 4. Ejecutar Server Action
  │◀──────────────────────────│
```

### Upload de archivos (dentro de Server Actions)

Los uploads de archivos (cotizaciones, facturas, comprobantes) se procesan
**dentro** de Server Actions, por lo que heredan la protección CSRF:

1. El Server Action recibe un `FormData` con el campo `file`
2. Se lee el buffer una sola vez (`file.arrayBuffer()`)
3. Se validan magic bytes con `validateFileBuffer()` de `lib/file-validation.ts`
4. Se normaliza el MIME type independientemente del Content-Type del cliente
5. Se escribe el buffer al volumen persistente

Esto protege contra:
- Subida de archivos maliciosos con Content-Type spoofed
- Archivos ejecutables disfrazados de PDF/imagen
- CSRF en operaciones de upload

---

## Reglas para mantener esta garantía

- **No** agregar endpoints `app/api/*` que muten estado sin un control CSRF
  explícito (token sincronizado o verificación de `Origin`/`Sec-Fetch-Site`).
  Si una integración externa lo requiere, usar un esquema de API key/HMAC, no
  cookies de sesión.
- Mantener `cookies.sameSite` en `lax` o `strict` para la cookie de sesión.
- Las notificaciones por correo se difieren **después** del commit con
  `notifyAfterCommit` (S-05), de modo que un fallo/rollback nunca produce un
  efecto observable (email) sin su mutación correspondiente.

---

## Headers de seguridad complementarios

Configurados en `next.config.ts`, aplicados a todas las rutas:

| Header | Valor | Protección |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Previene MIME sniffing |
| `X-Frame-Options` | `DENY` | Previene clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controla referrer |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Desactiva APIs sensibles |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Fuerza HTTPS |

---

## Verificación pendiente

- [ ] Test E2E (Playwright) que haga un `POST` cross-origin a una Server Action
      y verifique el rechazo (403/400). Tracked en `../auditoria/AUDITORIA_INTEGRAL_CHOME.md` (T-01).
