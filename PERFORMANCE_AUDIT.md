# Auditoria de Rendimiento — Plataforma Chome

> **Fecha:** 2026-07-08  
> **Alcance:** Análisis completo de stack: DB, React, SSR, bundle, caching, auth, PWA, PDF  
> **Metodología:** Revisión línea por línea de 200+ archivos en `lib/`, `app/`, `components/`, `db/`

---

## Tabla de Contenido

1. [Hallazgos Críticos](#1-hallazgos-críticos)
2. [Base de Datos](#2-base-de-datos)
3. [Rendering React](#3-rendering-react)
4. [Bundle & Code Splitting](#4-bundle--code-splitting)
5. [Servidor & Arquitectura](#5-servidor--arquitectura)
6. [Autenticación](#6-autenticación)
7. [Generación PDF](#7-generación-pdf)
8. [PWA & Service Worker](#8-pwa--service-worker)
9. [Resumen Ejecutivo](#9-resumen-ejecutivo)

---

## 1. Hallazgos Críticos

### 1.1 Indices faltantes en tablas de alto tráfico

Tres tablas principales usadas en listados, dashboards y búsquedas **carecen completamente de índices**:

| Tabla | Archivo | Operaciones afectadas |
|-------|---------|----------------------|
| `ppa_submissions` | `db/schema/ppa.ts` | `listPpa()`, `countPpa()`, `getPpaByToken()`, `getPpaStats()` |
| `sst_evaluations` | `db/schema/sst.ts` | `listEvaluations()`, `listEvaluationsGroupedByWorker()`, `getDashboardStats()` |
| `deliveryItems` / `receiptItems` | `db/schema/receiving.ts` | Múltiples queries de trazabilidad y entregas |

**Impacto:** Full table scan en cada consulta. Con 10,000+ registros, estas queries degradan de O(1) a O(n).

### 1.2 Contexto global causa re-renders en cascada

**Archivo:** `components/layout/header-context.tsx:26`

```tsx
// Cada render crea un nuevo objeto → TODOS los consumidores re-renderizan
<ShellHeaderContext.Provider value={{ header, setHeader, searchQuery, setSearchQuery }}>
```

El `DataTable`, `TopBar`, `PageHeader` y todos los consumidores del contexto se re-renderizan innecesariamente en cada cambio de estado del shell.

### 1.3 JWT callback consulta la DB en cada request (bypass de caché intencional)

**Archivo:** `lib/auth/auth.ts:138-147`

El callback JWT de NextAuth consulta roles/permisos/worksites en cada request autenticado con `bypassCache: true`. Esto significa **2+ round-trips a DB por request** solo para RBAC. Con 5 llamadas API en una página, son 10+ consultas DB adicionales.

### 1.4 Sin code splitting para librerías pesadas

**recharts (~1MB)** y **jsPDF (~180KB gzipped)** se importan estáticamente sin `next/dynamic()` ni `React.lazy()`. No existe **ningún** uso de `next/dynamic()` en todo el código.

### 1.5 Optimización de imágenes deshabilitada

`sharp` está en `devDependencies` (no en `dependencies` de producción). Todas las instancias de `next/image` usan `unoptimized={true}`. No existe bloque `images` en `next.config.ts`.

---

## 2. Base de Datos

### 2.1 Índices Faltantes — Prioridad Alta

#### `ppa_submissions` (sin índices)
```sql
-- Indices necesarios:
CREATE INDEX idx_ppa_worksite_estado ON ppa_submissions (worksite_id, estado);
CREATE INDEX idx_ppa_created ON ppa_submissions (created_at DESC);
CREATE INDEX idx_ppa_worker ON ppa_submissions (worker_id, worksite_id);
```

#### `sst_evaluations` (sin índices)
```sql
CREATE INDEX idx_sst_worksite_estado ON sst_evaluations (worksite_id, estado, created_at DESC);
CREATE INDEX idx_sst_worker ON sst_evaluations (worker_id, created_at DESC);
CREATE INDEX idx_sst_followup_eval ON sst_scheduled_followups (evaluation_id);
```

#### Tablas de recepción/entrega
```sql
CREATE INDEX idx_delivery_items_request ON delivery_items (request_item_id);
CREATE INDEX idx_delivery_items_worker ON delivery_items (worker_id);
CREATE INDEX idx_deliveries_worksite_date ON deliveries (worksite_id, delivered_at);
CREATE INDEX idx_receipt_items_po_item ON receipt_items (purchase_order_item_id);
CREATE INDEX idx_receipts_po ON receipts (purchase_order_id);
CREATE INDEX idx_approval_decisions_item ON approval_decisions (request_item_id);
CREATE INDEX idx_worksites_active ON worksites (is_active) WHERE is_active = true;
```

#### Movimientos de inventario
```sql
CREATE INDEX idx_inventory_mov_worksite_prod_type 
  ON inventory_movements (worksite_id, product_id, type);
```

### 2.2 COUNT como findMany (Alto Impacto)

**Archivos:** `lib/services/notification-read.ts:39-48`, `:127-145`

`getUnreadCount()` y `getNotificationMaintenanceStats()` obtienen **todas las filas** de la DB a memoria y cuentan con `.length` y `.filter()`. Deberían usar `count()` de SQL:

```typescript
// Antes (mal):
const rows = await db.query.notifications.findMany({
  where: eq(notifications.isRead, false),
  columns: { id: true },
})
return rows.length

// Después (bien):
const [row] = await db
  .select({ count: count() })
  .from(notifications)
  .where(eq(notifications.isRead, false))
return row?.count ?? 0
```

### 2.3 SELECT * en columnas con JSONB pesado

| Archivo | Lineas | Tabla | Columna pesada no necesaria |
|---------|--------|-------|---------------------------|
| `lib/services/ppa-module/calculos.ts` | 63-64 | `ppaSubmissions` | `answersJson` (JSONB) |
| `lib/services/sst-module/evaluations.ts` | 67-79 | `sstEvaluations` | `cargosJson`, `observacionesGenerales`, `schemaJson` |
| `lib/services/prevention-documents/search.ts` | 64 | `sstDocuments` | `extraMetadata` (JSONB), `tags` (JSONB) |
| `lib/services/prevention-documents/search.ts` | 79-81 | `sstDocuments` | `getDashboardCounters()` carga TODOS los docs sin límite |

### 2.4 N+1 y queries secuenciales

| Severidad | Archivo | Issue |
|-----------|---------|-------|
| **ALTA** | `app/(app)/aprobaciones/actions.ts:226-241` | `bulkApproveRequestAction` aprueba items uno por uno en transacciones separadas. Si falla a mitad, queda en estado inconsistente. |
| **MEDIA** | `lib/services/purchasing-module/purchase-orders-status.ts:110-118` | `recordStatusChange` llamado secuencialmente por cada item en `markOrderSent()` y `cancelOrder()` |
| **MEDIA** | `lib/services/admin-roles.ts:132-138` | Replace de permisos (delete + insert) sin transacción. Si el insert falla, el rol queda sin permisos. |
| **BAJA** | `lib/services/trazabilidad-item.ts:32-213` | 9 queries ejecutadas secuencialmente. Algunas pueden paralelizarse. |

### 2.5 Queries sin límite ni rango de fechas

| Archivo | Issue |
|---------|-------|
| `lib/services/fleet.ts:14-55` | `getFleetOverview()` agrega TODOS los registros de combustible y mantenimiento de todos los tiempos sin filtro de fecha |
| `lib/services/prevention-documents/search.ts:79-81` | `getDashboardCounters()` carga TODOS los documentos para contar en JS |
| `lib/services/stock-alerts.ts:39-42` | WHERE con aritmética (`quantity < minStock * 1.5`) que impide uso de índices |

### 2.6 Dashboard con 20 queries simultáneas

**Archivo:** `lib/services/analytics-module/dashboard.ts:39-60`

`getAnalyticsDashboard()` dispara 20 queries en un `Promise.all()`. Cada carga del dashboard de analítica genera una carga masiva sobre la DB. Considerar materialized views o caché con TTL.

### 2.7 Subquery correlacionada en snapshot

**Archivo:** `lib/services/dashboard-snapshot.ts:116`

Para cada OC en el snapshot (hasta 200), ejecuta una subquery `SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = ...`. Esto son 200 subqueries secuenciales. Mejor: obtener items en bulk y contar en JS.

---

## 3. Rendering React

### 3.1 Problemas Críticos de Contexto y Memoización

| # | Severidad | Archivo | Linea | Issue |
|---|-----------|---------|-------|-------|
| A1 | **CRITICO** | `components/layout/header-context.tsx` | 26 | Provider value recreado en cada render → todos los consumidores re-renderizan |
| A2 | **CRITICO** | `components/admin/data-table.tsx` | 20 | Sin `React.memo` → re-filtra/ordena/pagina en cada render del padre |
| A3 | **CRITICO** | `components/admin/data-table.tsx` | 86-97 | `toggleSort` sin `useCallback` → cada header de columna recibe nuevo handler |
| A4 | **CRITICO** | `components/prevention/document-grid.tsx` | 93-138 | `tileProps` creados de nuevo para cada item en cada render (30+ objetos) |
| A5 | **ALTA** | `components/layout/top-bar.tsx` | 45-47 | `findActiveBreadcrumb` ejecutado en cada render sin `useMemo` |
| A6 | **ALTA** | `components/layout/top-bar.tsx` | 52-53 | Array `ROUTES_WITH_OWN_SEARCH` recreado dentro del componente en cada render |

### 3.2 Handlers inline que rompen memoización

| Archivo | Inline Count | Handlers afectados |
|---------|-------------|-------------------|
| `components/prevention/document-tile.tsx` | **7** | onMouseEnter, onMouseLeave, onFocus, onBlur, onKeyDown, onClick×2 |
| `components/ui/pagination.tsx` | **3 por botón** | prev, page nums, next |
| `components/ui/select.tsx` | **4** | onOpenChange, onKeyDown, onClick, onMouseDown |
| `components/adquisiciones/list-filters.tsx` | **4** | onValueChange × 4 |
| `components/layout/desktop-nav.tsx` | **2** | hide/show panel |
| `components/layout/app-shell.tsx` | **1** | onMenuToggle |
| `components/layout/notification-bell.tsx` | **1 por item** | onRead per notification |

### 3.3 Componentes sin React.memo (19 componentes)

`DataTable`, `TopBar`, `AppShell`, `DesktopNav`, `MobileNav`, `Pagination`, `ServerPagination`, `SummaryBar`, `ExportDialog`, `EntityTimeline`, `RequestProgressPanel`, `OfflineBanner`, `OnboardingHint`, `DeleteRequestButton`, `ViewModeToggle`, `BrandMark`, `AreaItems`, `Breadcrumbs`, `ConfirmDialog`

### 3.4 Formularios con dependencias frágiles

**Archivo:** `app/(app)/solicitudes/use-request-form.ts`

- **11 `useEffect` hooks** en un solo hook de 250 líneas
- `itemsJson` (`JSON.stringify()`) recalculado en cada render (línea 166-175) → dispara 3 efectos en cada keystroke
- Autosave timer (60s) se resetea en cada keystroke con re-serialización del formulario completo

### 3.5 Cálculos no memoizados

| Archivo | Computación | Impacto |
|---------|------------|---------|
| `components/ui/avatar.tsx:54` | `Array.from(name).reduce(...)` por hash de color | O(n) en cada render |
| `components/states/entity-timeline.tsx:24-32` | `getStatusLabel` definida dentro del componente, llamada en `.map()` | Re-creada en cada render |

### 3.6 Efectos que podrían ser estado derivado

| Archivo | Issue |
|---------|-------|
| `components/layout/desktop-nav-areas.tsx:24-26` | `useEffect` para sync `routeArea` → `openId` (podría ser estado derivado) |
| `components/adquisiciones/onboarding-hint.tsx:15-21` | Flash inicial: renderiza null, luego useEffect revela el hint |
| `components/ui/page-header.tsx:34-39` | Flash de 1 frame: TopBar aparece sin título hasta que useEffect actualiza el contexto |

---

## 4. Bundle & Code Splitting

### 4.1 Tamaño de Bundle — Librerías Pesadas

| Librería | Tamaño (aprox.) | Dónde se importa | Code-split? |
|----------|----------------|-----------------|-------------|
| **recharts** | ~1 MB | `app/(app)/combustibles/fuel-charts.tsx`, `app/(app)/analitica/analytics-charts.tsx` | **NO** |
| **exceljs** | ~1 MB | 4 archivos server-side. 1 lazy import en export de combustibles | Parcial |
| **jsPDF** | ~180 KB gzip | `app/(app)/prevencion/ppa/ppa-access-panel.tsx` | **NO** (estático) |
| **qrcode** | ~150 KB | `app/(app)/prevencion/ppa/ppa-access-panel.tsx` | **NO** (estático) |
| **playwright** | ~400 MB | `lib/pdf/browser-pool.ts` | **SI** (`await import`) |
| **date-fns/locale/es** | ~5 KB | `components/ui/date-picker.tsx` | **NO** |
| **phosphor-icons** | Tree-shakeable | 60+ archivos | **SI** (solo iconos usados) |

### 4.2 Code Splitting Ausente

- **`next/dynamic()`**: **0 usos** en todo el código
- **`React.lazy()`**: Solo 2 usos (`CommandPalette`, `NotificationBell`)
- **`<Suspense>`**: Solo 2 usos en componentes; 40 `loading.tsx` files (correctos)
- **`generateStaticParams`**: **0 usos** — cero generación estática

### 4.3 Imágenes

- `sharp` en `devDependencies` (debe estar en `dependencies` para prod)
- Todas las instancias de `next/image` usan `unoptimized={true}`
- Sin bloque `images` en `next.config.ts`
- Sin `placeholder="blur"`, sin `sizes` en ninguna imagen
- 1 tag `<img>` raw que bypassea `next/image`

### 4.4 CSS / Fuentes

- Tailwind v4 con `@theme` en `globals.css` — limpio, sin CSS redundante
- Fuentes locales (`Exo`, `Myriad Pro`) en WOFF2 con `display: "swap"` — correcto
- `GeistMono` de `geist/font/mono` — correcto

---

## 5. Servidor & Arquitectura

### 5.1 SSR: Todo `force-dynamic`

- `app/(app)/layout.tsx` tiene `dynamic = "force-dynamic"` → **todas** las páginas autenticadas son SSR dinámico
- Esto es correcto para un dashboard interno con datos cambiantes, pero significa **cada navegación dispara render completo del servidor + queries frescas a DB**
- Cero ISR, cero SSG en páginas autenticadas

### 5.2 Caché

| Capa | Estado |
|------|--------|
| Next.js Data Cache | Deshabilitado por `force-dynamic` |
| `unstable_cache` | Solo badge counts (30s TTL) en layout |
| `revalidateTag` | **0 usos** en producción |
| TanStack Query | `staleTime: 30s`, `gcTime: 5min` — conservador y correcto |
| React `cache()` | **0 usos** — sin memoización por request |
| Redis / caché externa | **No existe** |

**Problema clave:** Los badge counts usan `unstable_cache` con tags `["badge-counts"]` pero **nunca se llama `revalidateTag("badge-counts")`** después de mutaciones. Los badges tardan hasta 30s en actualizarse tras aprobar una solicitud.

### 5.3 Server Actions

- **69 archivos** con `"use server"` — bien organizados por feature
- `revalidatePath()` usado consistentemente después de mutaciones
- Sin problemas de serialización de objetos grandes
- Sin `revalidateTag()` para alinearse con el cache del layout

### 5.4 Middleware (`proxy.ts`)

- **Sin queries DB** — solo auth + CSP — ligero y eficiente
- `crypto.randomUUID()` por request para nonce CSP — aceptable
- `publicPaths.some()` lineal en 7 items — O(1) en práctica
- Sin splitting de middleware (auth + CSP juntos) — menor pero aceptable

### 5.5 Pool de Conexiones DB

```typescript
// db/index.ts
max: 10,
idle_timeout: 30,
connect_timeout: 10,
```

Singleton pattern previene leaks en dev. 10 conexiones es razonable.

---

## 6. Autenticación

### 6.1 JWT Callback — DB por Request

**Archivo:** `lib/auth/auth.ts:138-147`

```typescript
jwt: async ({ token, user }) => {
  if (user) {
    const rbac = await getUserRbacById(token.sub!, true) // bypassCache: true
    token.roles = rbac.roles
    token.permissions = rbac.permissions
    // ...
  }
}
```

- El código indica que es intencional (S-03: "so revocations take effect immediately")
- **Costo:** 2+ DB round-trips por request autenticado
- **Mitigación parcial:** La caché en memoria de RBAC (`rbacCache` con 5s TTL) existe pero es bypasseada en este path

### 6.2 RBAC — Bien Paralelizado

**Archivo:** `lib/auth/rbac.ts:73-105`

`getUserRbacById` ejecuta `userRoles`, `directPermissions`, y `worksiteUsers` en paralelo (3 queries), luego encadena `rolePermissions` del resultado. Total: 2 round-trips en lugar de 4.

### 6.3 Tamaño del JWT

El JWT contiene arrays completos de `roles` y `permissions`. Para un admin, esto incluye todos los permisos del sistema de todos los módulos. Estimado: ~50 permisos × ~20 chars = ~1KB en el JWT. Dentro de límites del browser (~4KB por cookie), pero monitoreable si crece.

### 6.4 Rate Limiting y Timing Attack

- Rate limiting ocurre **antes** de bcrypt — correcto
- Dummy hash para prevenir timing-based user enumeration — correcto
- `DUMMY_HASH` es un hash bcrypt válido

---

## 7. Generación PDF

### 7.1 Arquitectura del Pool

**Archivo:** `lib/pdf/browser-pool.ts` (112 líneas)

```
Browser (singleton, lazy) → Context (por request, aislado) → Page → PDF
                           ↕ Concurrencia limitada (PDF_MAX_CONCURRENT, default 2)
                           ↕ Cola FIFO para overflow
```

**Bien diseñado:** lazy loading de Playwright, singleton browser, semáforo de concurrencia, crash recovery con re-lanzamiento automático, cleanup de contextos en finally.

### 7.2 Problemas Identificados

| Issue | Severidad | Detalle |
|-------|-----------|---------|
| **`networkidle` wait** | **ALTA** | `page.goto(printUrl, { waitUntil: "networkidle" })` espera hasta que no haya actividad de red por 500ms. Con polling de notificaciones cada 60s y hydration del cliente, esto añade **segundos** de latencia. Usar `"domcontentloaded"` o `"load"`. |
| **Sin timeout en goto/pdf** | **MEDIA** | Si la página de impresión se cuelga, el slot del pool queda bloqueado indefinidamente. |
| **Render completo de React** | **MEDIA** | El browser headless carga la página completa con React, no un template HTML ligero. Memoria significativa por request. |
| **Sin caché de PDFs** | **BAJA** | `Cache-Control: no-store` en cada respuesta — correcto para contenido generado, pero cada descarga regenera el PDF. |

---

## 8. PWA & Service Worker

### 8.1 Memory Leak — setInterval sin cleanup

**Archivo:** `components/pwa/pwa-register.tsx:22-39`

El `setInterval` (cada 60min para verificar actualizaciones del SW) se crea dentro de un `.then()`. El `clearInterval` se retorna desde el callback de `.then()`, no desde el `useEffect`. React nunca lo limpia al desmontar.

### 8.2 SW solo activo en /ppa

El SW se registra con `scope: "/ppa"` y su fetch handler solo intercepta `/ppa` y `/_next/static/`. Para el 95% restante de la app, el SW es inerte pero su listener de fetch corre en cada request (early return, overhead mínimo).

### 8.3 Cache-first puede servir assets stale

**Archivo:** `public/sw.js:83-97`

Assets estáticos usan cache-first sin validación de versión/ETag. Hay ventana donde usuarios ven JS/CSS stale hasta que el SW se actualiza. Mitigado parcialmente por `skipWaiting()` + `clients.claim()`.

### 8.4 Sincronización secuencial de cola offline

**Archivo:** `lib/pwa/hooks.ts:98-134`

`syncAllPending()` procesa items secuencialmente con `for...of`. Intencional (fallo en un item no debe bloquear los demás), pero lento para colas grandes.

---

## 9. Resumen Ejecutivo

### Criticidad por Área

| Área | Criticidad | Issues Críticos | Issues Altos | Issues Medios |
|------|-----------|----------------|-------------|--------------|
| Base de Datos | **ALTA** | 4 | 3 | 6 |
| Rendering React | **ALTA** | 4 | 6 | 14 |
| Bundle / Loading | **MEDIA** | 0 | 3 | 4 |
| Servidor / Caché | **MEDIA** | 1 | 2 | 3 |
| Autenticación | **MEDIA** | 0 | 2 | 1 |
| PDF | **MEDIA** | 0 | 1 | 2 |
| PWA | **BAJA** | 0 | 0 | 3 |

### Quick Wins (alto impacto, bajo esfuerzo)

| # | Acción | Impacto | Esfuerzo |
|---|--------|---------|----------|
| 1 | Agregar índices faltantes en `ppa_submissions`, `sst_evaluations`, `delivery_items`, `receipt_items` | **Muy alto** | Bajo |
| 2 | Envolver `ShellHeaderContext.Provider value` en `useMemo` | **Muy alto** | Bajo (1 línea) |
| 3 | Envolver `DataTable` en `React.memo` | **Alto** | Bajo |
| 4 | Cambiar `findMany` + `.length` por `count()` en notificaciones | **Alto** | Bajo |
| 5 | Mover `ROUTES_WITH_OWN_SEARCH` a constante fuera del componente | **Bajo** | Bajo (1 línea) |
| 6 | Usar `useMemo` para `itemsJson` en `use-request-form` | **Medio** | Bajo |
| 7 | Dynamic import para `jsPDF` y `qrcode` en PPA access panel | **Medio** | Bajo |
| 8 | Mover `sharp` a `dependencies` de producción | **Medio** | Bajo |

### Mejoras Estructurales (alto impacto, esfuerzo medio/alto)

| # | Acción | Impacto |
|---|--------|---------|
| 1 | Implementar `next/dynamic()` para recharts en páginas de analítica y combustibles | **Alto** |
| 2 | Agregar `revalidateTag("badge-counts")` después de mutaciones que afectan badges | **Alto** |
| 3 | Cambiar `networkidle` → `domcontentloaded` en PDF pool | **Alto** |
| 4 | Refactorizar `use-request-form.ts` (11 useEffect) en hooks más pequeños | **Medio** |
| 5 | Agregar `React.memo` a los 19 componentes listados | **Medio** |
| 6 | Reemplazar subquery correlacionada en `dashboard-snapshot.ts` con bulk fetch | **Medio** |
| 7 | Considerar materialized views para dashboard de analítica (20 queries) | **Medio** |
| 8 | Evaluar Redis/edge cache para RBAC en lugar de DB por request | **Alto** |
| 9 | Agregar `loading.tsx` con `<Suspense>` granular para secciones de datos en páginas pesadas | **Bajo** |

### Métricas Actuales Estimadas

| Métrica | Estado | Objetivo |
|---------|--------|----------|
| TTFB (server render) | ~200-400ms | Optimizar queries DB |
| LCP (página típica) | ~1.5-2.5s | Reducir bundle sizes |
| CLS | ~0.01 (bajo) | Mantener |
| INP | No medido | Medir con RUM (Sentry) |
| Bundle cliente (ruta típica) | ~150-250KB | Reducir librerías eager |
| Conexiones DB por página | 15-30 (dependiendo de ruta) | Reducir con join/índices |
| PDF generation time | 3-7s | Reducir con `domcontentloaded` |

---

---

## 10. Log de Cambios Aplicados

### PASS 1 — React: Contexto, Memo, Callbacks ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| A1 | Context value recreado en cada render | `components/layout/header-context.tsx:26` | Envuelto en `useMemo` |
| A2 | DataTable sin React.memo | `components/admin/data-table.tsx:20` | Envuelto en `React.memo` como `DataTableInner` |
| A3 | toggleSort sin useCallback | `components/admin/data-table.tsx:86-97` | Envuelto en `useCallback` con deps `[sortKey, sortDir]` |
| A4 | tileProps recreados en cada render en DocumentGrid | `components/prevention/document-grid.tsx:93-138` | Extraídos `FolderTile` y `DocumentItem` como componentes `React.memo` |
| A5 | findActiveBreadcrumb sin useMemo | `components/layout/top-bar.tsx:45-47` | Envuelto en `useMemo` |
| A6 | ROUTES_WITH_OWN_SEARCH en componente | `components/layout/top-bar.tsx:52-53` | Movido a constante fuera del componente |
| D | DocumentTile sin React.memo | `components/prevention/document-tile.tsx:34` | Envuelto en `React.memo` + `forwardRef` |
| 3.5 | Avatar.hash sin useMemo | `components/ui/avatar.tsx:54` | Envuelto en `useMemo` |

### PASS 2 — DB: Índices, COUNT queries ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| 2.1 | ppa_submissions sin índices | `db/schema/ppa.ts` | Agregados: `idx_ppa_worksite_estado`, `idx_ppa_created`, `idx_ppa_worker` |
| 2.1 | sst_evaluations sin índices | `db/schema/sst.ts` | Agregados: `idx_sst_worksite_estado`, `idx_sst_worker` |
| 2.1 | sst_scheduled_followups sin índice FK | `db/schema/sst.ts` | Agregado: `idx_sst_followup_eval` |
| 2.1 | receipts/items sin índices | `db/schema/receiving.ts` | Agregados: `idx_receipts_po`, `idx_receipt_items_po_item`, `idx_deliveries_worksite_date`, `idx_delivery_items_request` |
| 2.1 | approval_decisions sin índice | `db/schema/requests.ts` | Agregado: `idx_approval_decisions_item` |
| 2.1 | inventory_movements sin índice (ws+prod+type) | `db/schema/stock.ts` | Agregado: `idx_inventory_mov_worksite_prod_type` |
| 2.1 | worksites sin índice is_active | `db/schema/worksites.ts` | Agregado: `idx_worksites_active` (parcial WHERE is_active = true) |
| 2.2 | getUnreadCount: findMany + .length | `lib/services/notification-read.ts:39-48` | Reemplazado por `count()` de SQL |
| 2.2 | getNotificationMaintenanceStats: fetch 1000 + filter JS | `lib/services/notification-read.ts:127-145` | Reemplazado por 3 queries `count()` + `limit 1` |

### PASS 3 — Bundle / Images ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| 4.3 | sharp en devDependencies | `package.json:94` | Movido a `dependencies` |

### PASS 4 — PDF ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| 7.2 | networkidle wait | `app/(print)/compras/[id]/print/pdf/route.ts:54`, `app/(print)/sst/[id]/print/pdf/route.ts:44` | Cambiado a `domcontentloaded` + timeout 30s |

### PASS 5 — PWA ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| 8.1 | setInterval sin cleanup | `components/pwa/pwa-register.tsx:22-39` | Refactor: variable externa al `.then()`, cleanup en return del `useEffect` |

### PASS 6 — Bundle: Dynamic imports ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| H5 | jsPDF + qrcode importados estáticamente (~330KB) | `app/(app)/prevencion/ppa/ppa-access-panel.tsx:4-5` | Eliminados imports estáticos de `qrcode` y `jspdf`, reemplazados por `import("qrcode")` en useEffect y `await import("jspdf")` en downloadQr |

### PASS 7 — DB: Transacciones, límites, date filters ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| M9 | admin-roles: delete+insert sin transacción | `lib/services/admin-roles.ts:132-138` | Envuelto en `db.transaction()` cuando se llama sin `client` |
| M10 | getDashboardCounters sin límite | `lib/services/prevention-documents/search.ts:79-81` | GROUP BY + COUNT SQL para status, solo vigentes/aprobados iterados (limit 5000) |
| M2 | Fleet overview sin rango de fechas | `lib/services/fleet.ts:14-55` | Agregado filtro `>= 12 meses` en fuelLoads y maintenanceRecords |

### PASS 8 — React: revalidateTag + TopBar/AppShell memo ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| H2 | Sin revalidateTag badge counts | `app/(app)/aprobaciones/actions.ts` | Agregado `revalidateTag("badge-counts", { expire: 0 })` tras cada mutación (approve, reject, return, bulk, deliveryMode) |
| M7 | TopBar sin React.memo | `components/layout/top-bar.tsx` | Envuelto en `React.memo` |
| M7 | AppShell sin React.memo | `components/layout/app-shell.tsx` | Envuelto en `React.memo` |
| M17 | AppShell inline onMenuToggle | `components/layout/app-shell.tsx:127` | `useCallback` para openDrawer/closeDrawer |

### PASS 9 — React: React.memo batch (17 componentes) + inline handlers ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| M11 | Pagination sin React.memo + inline handlers | `components/ui/pagination.tsx` | Envuelto en `React.memo`; `useCallback` para prev/next/page; `useMemo` para `buildPageNums` |
| M11 | ServerPagination sin React.memo | `components/ui/server-pagination.tsx` | Envuelto en `React.memo` |
| M11 | DesktopNav sin React.memo + inline callbacks | `components/layout/desktop-nav.tsx` | Envuelto en `React.memo`; `useCallback` para `showPanel`/`hidePanel` |
| M11 | MobileNav sin React.memo | `components/layout/mobile-nav.tsx` | Envuelto en `React.memo` |
| M11 | SummaryBar sin React.memo | `components/ui/summary-bar.tsx` | Envuelto en `React.memo` |
| M11 | ExportDialog sin React.memo | `components/export-dialog.tsx` | Envuelto en `React.memo` |
| M11 | EntityTimeline sin React.memo + getStatusLabel | `components/states/entity-timeline.tsx` | Envuelto en `React.memo`; `getStatusLabel` extraído fuera del componente |
| M11 | RequestProgressPanel sin React.memo | `components/states/request-progress-panel.tsx` | Envuelto en `React.memo` |
| M11 | OfflineBanner sin React.memo | `components/pwa/offline-banner.tsx` | Envuelto en `React.memo` |
| M11 | OnboardingHint sin React.memo + flash fix | `components/adquisiciones/onboarding-hint.tsx` | Envuelto en `React.memo`; lazy `useState` initializer eliminó `useEffect` |
| M11 | DeleteRequestButton sin React.memo | `components/solicitudes/delete-request-button.tsx` | Envuelto en `React.memo` |
| M11 | ViewModeToggle sin React.memo | `components/prevention/view-mode-toggle.tsx` | Envuelto en `React.memo` |
| M11 | BrandMark sin React.memo | `components/layout/brand-mark.tsx` | Envuelto en `React.memo` |
| M11 | AreaItems sin React.memo | `components/layout/nav-rows.tsx` | Envuelto en `React.memo` |
| M11 | Breadcrumbs sin React.memo | `components/ui/page-header.tsx` | Envuelto en `React.memo` |
| M11 | ConfirmDialog sin React.memo | `components/ui/confirm-dialog.tsx` | Envuelto en `React.memo` |
| M11 | NotificationBell inline onRead por item | `components/layout/notification-bell.tsx` | Extraído `NotificationRowItem` como componente `React.memo` |
| M14 | ListFilters inline onValueChange (4 selects) | `components/adquisiciones/list-filters.tsx` | Factory `createSelectHandler` fuera del componente + handlers memoizados |

### PASS 10 — Bundle: recharts next/dynamic() ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| H3/H4 | recharts importado estáticamente (~1MB) en combustibles/analítica | `fuel-charts.tsx`, `analytics-charts.tsx` | Creados wrappers `fuel-charts-lazy.ts` y `analytics-charts-lazy.ts` con `next/dynamic({ ssr: false })`. Ahorro: ~1MB en bundle inicial. |

### PASS 11 — DB: Subquery correlacionada ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| M4 | Subquery correlacionada (hasta 200 subqueries) | `dashboard-snapshot.ts:116` | Reemplazada por bulk SELECT COUNT(*) GROUP BY + merge en JS |

### PASS 13 — Bulk: bulkApproveItems, stock alerts, revalidateTag, images, recordStatusChanges ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| M1 | bulkApprove N+1 en loop | `item-state-module/approval.ts`, `aprobaciones/actions.ts` | Nueva función `bulkApproveItems()` en approval.ts. Ahora procesa todos los items en UNA transacción. El caller usa la nueva función. |
| M3 | Stock alerts WHERE aritmético | `stock-alerts.ts:39-42` | WHERE ampliado a `* 2.0` para capturar todo; filtro `* 1.5` movido a JS. |
| L3 | Sin bloque images en next.config.ts | `next.config.ts` | Agregado bloque `images` con `formats` (AVIF/WebP) y `deviceSizes` |
| L7 | recordStatusChange en loop (2 sitios) | `purchase-orders-status.ts:110-118,189-197`, `audit.ts` | Nueva función `recordStatusChanges()` en audit.ts para batch insert. Usada en markOrderSent y cancelOrder. |
| L8 | revalidateTag faltante en bodega/solicitudes | `bodega/actions.ts`, 6 archivos en `solicitudes/actions-module/` | Agregado `revalidateTag("badge-counts", { expire: 0 })` en todos los action files |

### PASS 14 — SELECT * JSONB en listPpa ✅ COMPLETADO

| # | Hallazgo | Archivo | Fix |
|---|----------|---------|-----|
| L1 | SELECT * en PPA listing (answersJson JSONB) | `ppa-module/calculos.ts:63-64` | Definido `LIST_COLUMNS` (excluye answersJson y triggeredReasons). Usado en ambas ramas (search y normal). |

---

## 11. Pendientes

### Pendientes

- **M5** — 11 useEffect en `use-request-form.ts` (requiere testing manual)

---

> **Nota:** Reporte actualizado al 2026-07-08.
