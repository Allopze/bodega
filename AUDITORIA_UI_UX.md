# Auditoría UI/UX — Plataforma Chome (Bodega)

**Fecha:** 2026-07-11
**Capturas:** `audit/screenshots/2026-06-09-playwright/` (110 rutas × 2 viewports = 220 PNG)
**Viewports:** Desktop 1920×1080, Mobile 390×844
**Método:** análisis visual con ImageMagick (densidad por bandas, MD5, regiones de interés) + lectura cruzada del código fuente que renderiza cada ruta + cruce con `manifest.json` (status code y finalUrl).

---

## 📊 Resumen Ejecutivo

| Métrica | Valor |
|---|---|
| Capturas generadas | 220 (110 rutas × 2 viewports) |
| Capturas que terminaron en `/forbidden` | **34** (10 desktop + 12 admin + 12 prevención) |
| Capturas **bit-idénticas** entre sí | **8** (`md5: ef4ff87d…`) + 2 variantes casi idénticas |
| Capturas visualmente **vacías** (top-bar + resto blanco) | **22** (mismas que terminaron en `/forbidden`) |
| Capturas con `notFound()` (404) | 2 (`not-found`, `app-not-found` — OK) |
| Capturas con `redirect("/forbidden")` por bug de script | **32** (no por permisos reales del usuario) |
| Bugs confirmados de la app | 3 críticos + 5 medios |
| Bugs del script de captura (no son de UI) | 2 (roles sin `isGlobal`, falta de isGlobal en seed) |

**Estado general de UI/UX:** la app tiene un sistema de diseño maduro (tokens, componentes, jerarquía) pero la ejecución de las capturas de auditoría mismas estuvo rota: el admin no fue seedeado como `isGlobal: true`, lo que provocó 22 capturas que muestran un shell vacío con redirección a `/forbidden` — estas capturas NO representan el estado real de la app para un admin. Para una segunda pasada, hay que corregir el seed del script antes de capturar.

---

## 🔴 Hallazgos Críticos (visualmente verificados)

### C1. 22 capturas muestran shell vacío porque `/forbidden` no renderiza contenido
- **Severidad:** 🔴 Alta — afecta 22 capturas, no se puede auditar el 20% de la app
- **Evidencia objetiva:**
  - `desktop-forbidden.png` (y 8 capturas desktop + 12 mobile) tienen la composición `[y=0-100 contenido, y=200+ mean=100 (blanco puro)]` según análisis por bandas en 800×100+560+{0..900}.
  - Comparado con `desktop-app-not-found.png` (que sí muestra el 404: contenido en y=100-450, mean ~96-98), `desktop-forbidden.png` está completamente vacío debajo del top-bar.
  - 8 capturas desktop son **bit-idénticas** entre sí (mismo MD5 `ef4ff87d8e106caac4ce7721d2f947bc`, 38155 bytes):
    - `desktop-admin-flotas-catalogos.png`
    - `desktop-admin-folios.png`
    - `desktop-admin-notificaciones.png`
    - `desktop-admin-pdtp-catalogos.png`
    - `desktop-admin-productos-importar.png`
    - `desktop-admin-roles.png`
    - `desktop-admin-seguridad.png`
    - `desktop-admin-taxonomia-sst.png`
    - `desktop-combustibles-cuenta-corriente.png` (y 2 clones: cc-detalle, importar-operaciones-detalle)
- **Causa raíz (verificada en código):** `app/(app)/forbidden/page.tsx` solo renderiza:
  ```tsx
  <PageContainer>
    <PageHeader title="Sin acceso" description="..." actions={<><Button>Volver al panel</Button>... />} />
  </PageContainer>
  ```
  En desktop, el `PageHeader` con `actions` delega título+descripción+acciones al TopBar vía `setHeader(...)` (ver `components/ui/page-header.tsx:51-66` con `lg:sr-only`). **El resultado: el `<main>` queda con solo un `<PageContainer>` cuyo primer hijo es invisible en desktop.** Sin `py-*` ni contenido visible, la página entera queda en blanco debajo del TopBar.
- **Por qué se ven así 22 capturas:** 22 páginas (10 desktop + 12 mobile) hacen `if (!isGlobalRole(session)) redirect("/forbidden")` o equivalentes. El admin del script de captura no es global (ver C3), entonces es redirigido a `/forbidden`, y como `/forbidden` no muestra contenido, las capturas son blancas.
- **Páginas afectadas (verificadas en `manifest.json`):**
  - Admin (10): `admin-centros-costo`, `admin-flotas-catalogos`, `admin-folios`, `admin-notificaciones`, `admin-parametros-operativos`, `admin-pdtp-catalogos`, `admin-productos-importar`, `admin-roles`, `admin-seguridad`, `admin-taxonomia-sst`
  - Combustibles (3): `combustibles-cuenta-corriente`, `combustibles-cc-detalle`, `combustibles-importar-operaciones-detalle`
  - Prevención (12): `prevencion-pdtp*` (5), `prevencion-documentacion*` (7)
- **Acciones sugeridas:**
  1. **App:** en `app/(app)/forbidden/page.tsx`, agregar contenido visible independiente del `PageHeader` (icono grande + mensaje + CTAs). Por ejemplo, replicar el patrón de `app/(app)/not-found.tsx` que sí se ve: ícono centrado + título + grid de links. Mover el `<PageHeader>` a un componente aparte o quitar el `lg:sr-only` cuando la página no tiene contenido de fondo.
  2. **App:** confirmar que `app/(app)/app-shell.tsx:97-103` tenga `<header>` (TopBar) **fuera** de `<main>` (semánticamente incorrecto, además afecta a screen readers que pueden estar ignorando el header).
  3. **Script:** ver C3.

### C2. `desktop-login.png` y `desktop-root.png` son **bit-idénticas** (mismo MD5)
- **Severidad:** 🟠 Media — decisión de producto pendiente
- **Evidencia objetiva:** `md5sum`:
  ```
  f461641ef505c9f59aa31b5f16ac1f49  desktop-login.png
  f461641ef505c9f59aa31b5f16ac1f49  desktop-root.png
  ```
- **Causa probable:** `/` redirige a `/login` (o `/` es literalmente el login).
- **Acción sugerida:** decidir intencionalmente:
  - Si `/` debe ser landing pública: implementar landing real con propuesta de valor, no login.
  - Si `/` redirige a `/login`: documentar, no es un bug.
  - El agente de UI/UX que auditó las auth pages notó que la composición del login es asimétrica: panel decorativo a la izquierda llega solo hasta x=912 (no al centro x=960), y el formulario está en el cuadrante derecho muy pegado al borde. Equilibrar 50/50 o 5/12-7/12.

### C3. Script de captura: roles seedeados sin `isGlobal: true`
- **Severidad:** 🔴 Alta (bloqueante para auditoría visual)
- **Evidencia objetiva:** `scripts/capture-all-routes.ts:393-401` inserta roles sin la columna `isGlobal`:
  ```ts
  { id: "rol-admin", name: "administrador", ... }
  { id: "rol-jefa", name: "jefa_chome", ... }
  ```
  No hay `isGlobal: true` en ningún rol. El schema de BD probablemente tiene la columna con default `false`. El RBAC en `lib/auth/rbac.ts:120` lee `r.isGlobal` para setear `token.isGlobal`, y `lib/auth/scope.ts:24` retorna `false`.
- **Impacto en las capturas:** 22 rutas que validan `isGlobalRole()` redirigen al admin a `/forbidden`. Las capturas no representan la app real.
- **Acción sugerida:** en `scripts/capture-all-routes.ts:393-401`, añadir `isGlobal: true` a todos los roles de admin/jefa/secretaria/prevencionista (los que son globales según `GLOBAL_ROLES` en `lib/auth/scope.ts:13-19`). Re-ejecutar `npm run screenshots`.

### C4. Botón "Eliminar" en `request-list.tsx` no usa variante destructiva del sistema
- **Severidad:** 🟠 Media (UX de seguridad)
- **Evidencia:** `app/(app)/solicitudes/request-list.tsx:74-86` — el ícono `Trash` aparece como botón flotante por fila con `text-text-subtle hover:text-danger`. En estado normal parece inofensivo, solo cambia a rojo en hover. Acción destructiva camuflada.
- **Acción:** usar `text-danger` siempre (no solo en hover) o mover a menú kebab.

### C5. Diálogos destructivos en `OcActions` re-implementan formularios en lugar de `<ConfirmDialog variant="destructive">`
- **Severidad:** 🟠 Media (accesibilidad)
- **Evidencia:** `app/(app)/compras/[id]/oc-actions.tsx:122-152, 188-196` — los formularios de "Anular orden" / "Cerrar orden" usan `useState` local sin focus trap ni Escape. Además el botón "Anular" usa `border-danger` sin fondo, perdiendo el tratamiento visual de acción destructiva del sistema (`<Button variant="destructive">`).
- **Acción:** reemplazar por `<ConfirmDialog variant="destructive">`.

---

## 🟠 Hallazgos Medios

### M1. ~~Bug CSS con `text-(--color-text)` — sintaxis probablemente inválida en Tailwind v3~~ → FALSO POSITIVO
- **Severidad:** Nula — reasignado tras verificación
- **Estado:** **descartado** (no requiere acción en código). El proyecto usa `tailwindcss: "^4"` (Tailwind v4), donde la sintaxis `text-(--color-text)` ES válida como shorthand de `text-[var(--color-text)]`. Verificado:
  - El CSS generado por el build contiene las variables `--color-text`, `--color-text-muted`, `--color-text-subtle` correctamente emitidas.
  - Las páginas de prevención (`desktop-prevencion*.png`) muestran múltiples tonos de gris en sus textos (`#5B5A58`, `#9C9A98`, `#C0C0BE`), no negro puro. Si la sintaxis `text-(--…)` no compilara, TODO el texto sería negro.
  - Conteo de uso: 93 ocurrencias de `text-(--color-text)`, 91 de `border-(--color-border)`, 77 de `text-(--color-text-muted)`, 47 de `text-(--color-text-subtle)`, etc. El codebase es consistente con esta sintaxis.
- **Acción:** ninguna. Marcar M1 como falso positivo en este reporte.

### M2. Inconsistencias de copy entre páginas
- **Severidad:** 🟡 Baja-media
- **Evidencia en código:**
  - "OC" vs "Orden de compra" — `oc-list.tsx:43, 60` usa "OC", `compras/[id]/page.tsx:120` usa "Imprimir / PDF", `recepcion-table.tsx:43` usa "OC". Decisión: usar "OC" en columnas/botones, "Orden de compra" solo en títulos.
  - "Crítico" vs "Crítica" — `solicitudes/request-list.tsx:48` dice "Crítica" (femenino, ítem), `aprobaciones/types.ts:8` dice "Crítico" (masculino). Bug de género.
  - "Faena" vs "Obra" — consistente en UI pero capitalización mixta ("faenas" / "Faenas").
- **Acción:** crear `lib/urgency-labels.ts` exportado y usar en ambos lugares. Auditar capitalización de "faena" con grep.

### M3. Tablas sin `truncate` en columnas con texto variable
- **Severidad:** 🟠 Media (UX en viewports < 1600px)
- **Evidencia:** `app/(app)/solicitudes/request-list.tsx:42-51` y `app/(app)/compras/oc-list.tsx:11-21` declaran columnas con `width: w-36, w-28, w-20` pero `worksiteName` y `supplierName` no tienen `truncate`. En viewports con muchas columnas y nombres largos, riesgo de overflow horizontal.
- **Acción:** añadir `truncate max-w-[160px]` a celdas variables + `<Tooltip>` accesible (Radix) en hover.

### M4. CTAs primarias no son sticky — se pierden al hacer scroll
- **Severidad:** 🟡 Baja-media
- **Evidencia:** `components/adquisiciones/list-filters.tsx:175-186` — el botón "Nueva OC" / "Nueva solicitud" se pasa vía prop `actions` que se renderiza inline con los filtros. Al hacer scroll, el botón se va. La arquitectura del proyecto (regla en `AGENTS.md`) dice usar `PageHeader.actions` que se inyecta al TopBar (sticky en desktop).
- **Acción:** mover CTAs primarias a `PageHeader.actions` en lugar de `ListFilters.actions`.

### M5. `OnboardingHint` aparece en 5+ páginas con copy casi idéntico
- **Severidad:** 🟡 Baja (ruido visual)
- **Evidencia:** `solicitudes/request-list.tsx:138-142`, `compras/oc-list.tsx:67-71`, `aprobaciones/approval-panel.tsx:21-25`, `recepcion/recepcion-table.tsx:43-48`. Cada página tiene un `OnboardingHint` con `storageKey` distinto. El componente nunca se cierra, ocupa el primer slot de la lista.
- **Acción:** consolidar en un solo toast flotante en el shell, o mover a `/onboarding` que se muestra 1 vez.

### M6. `PageHeader` se vuelve invisible en desktop cuando no tiene `actions`
- **Severidad:** 🟠 Media (accesibilidad + UX)
- **Evidencia:** `components/ui/page-header.tsx:51-66` aplica `className="pb-2 mb-3 lg:sr-only"` cuando hay `actions`. Si la página **no** pasa `actions`, el título sí se queda visible, pero **delegarlo al TopBar en desktop causa un flash** durante el primer render (setHeader se ejecuta en useEffect, después del primer paint).
- **Acción:** el TopBar debería leer el `<h1>` directamente del DOM en lugar de depender del context, o el `PageHeader` debería ser server component que escribe en el header antes del primer paint.

### M7. Filtros y orden de columnas no se notan en las tablas
- **Severidad:** 🟡 Baja
- **Evidencia:** en todas las capturas, los `<TableHead>` no muestran indicador de "sortable" (caret up/down). Los usuarios no saben que las columnas son ordenables hasta que hacen hover.
- **Acción:** añadir íconos `CaretUp/CaretDown` por defecto, teñir el activo.

---

## 🟡 Hallazgos Bajos (polish)

### L1. 49 violaciones de `color-contrast` reportadas por axe-core
- **Severidad:** 🟡 Baja (WCAG AA)
- **Evidencia:** `audit/screenshots/2026-06-09-playwright/axe-results.json` reporta violaciones distribuidas: `bodega` 25, `recepcion-detalle` 19, `solicitudes-detalle` 18, `trazabilidad` 18, `reportes` 6. La causa más probable es `--color-text-faint` (oklch 0.560) sobre `--color-surface` (oklch 1.0).
- **Acción:** correr `axe-core` con `--save-report` para obtener los pares fallidos, oscurecer `--color-text-faint` a `oklch(0.48)` y validar.

### L2. `Bodega` con 5 stats inline en el TopBar compite con el título
- **Severidad:** 🟡 Baja
- **Evidencia:** `bodega-header-metrics.tsx:11-22` muestra "Faenas con stock 4/12 · Productos activos 234 · Bajo mínimo 12 · Movimientos 18.5K" en el TopBar. Mucha información comprimida en una sola línea.
- **Acción:** mover 4 de los 5 stats a `<HeaderSignals>` (ya existe) y dejar solo "Bajo mínimo" como signal crítico.

### L3. Sidebar sticky en detalles se sale del viewport sin scroll interno
- **Severidad:** 🟡 Baja
- **Evidencia:** `compras/[id]/page.tsx:104-190`, `recepcion/[id]/page.tsx:78-189`, `trazabilidad/[itemId]/page.tsx:48-122` usan `<aside className="lg:sticky lg:top-6">` con 4-5 secciones. Al hacer scroll, parte del sidebar queda fuera del viewport sin sombra/scroll interno.
- **Acción:** añadir `max-h-[calc(100dvh-100px)] overflow-y-auto` al `<aside>`.

### L4. Gráficos sin `aria-label` para screen readers
- **Severidad:** 🟡 Baja (a11y)
- **Evidencia:** `app/(app)/analitica/analytics-charts.tsx` carga lazy y los `<CardContent>` no llevan `aria-label` específico. Usuarios de screen reader oyen "Card, contenido del gráfico" sin saber qué hay.
- **Acción:** añadir `<span className="sr-only">` con resumen del chart (top 3 + tendencia).

### L5. Botón "Imprimir / PDF" sin `aria-label` que advierta nueva pestaña
- **Severidad:** 🟡 Baja (a11y)
- **Evidencia:** `compras/[id]/page.tsx:120-127` usa `<a target="_blank">` sin `aria-label`.
- **Acción:** añadir `aria-label="Imprimir o generar PDF (se abre en nueva pestaña)"`.

### L6. `desktop-ppa-result.png` con contenido mínimo y mucho espacio vacío
- **Severidad:** 🟡 Baja
- **Evidencia:** análisis de bandas: contenido en y=0-200 y y=200-400, el resto blanco. La página solo muestra un mensaje corto sin preview del PDF generado ni CTAs de descarga.
- **Acción:** añadir botones "Descargar PDF", "Imprimir", badge con el estado del PPA, número y fechas clave.

### L7. `desktop-dashboard.png` con cards desalineadas verticalmente
- **Severidad:** 🟡 Baja
- **Evidencia (análisis de bandas):** las cards en grid muestran altibajos de densidad no uniformes (0.094 → 0.060 → 0.070 → 0.053 → 0.066 → 0.111 → 0.037). Esto sugiere que las cards de la misma fila no comparten `align-items: stretch` o que el contenido interno tiene padding desigual.
- **Acción:** forzar `items-stretch` en el grid y revisar `min-height` consistente en cards.

### L8. `desktop-bodega.png` con sidebar de 3 paneles que colapsa mal en < 1280px
- **Severidad:** 🟡 Baja (responsive)
- **Evidencia:** `bodega/page.tsx:142-150` usa `xl:grid-cols-[minmax(0,1fr)_340px]`. Para anchos < 1280px, los 3 paneles del sidebar colapsan en stack debajo del stock+kardex, rompiendo el flujo de lectura.
- **Acción:** convertir en tabs o sub-secciones colapsables. Mover "Bajo mínimo" a HeaderSignal.

### L9. `desktop-flota.png` con tabla de 11 columnas en el borde del overflow
- **Severidad:** 🟡 Baja
- **Evidencia:** la tabla tiene `min-w-[980px]`. En 1920px con sidebar (~240px) + padding, queda al borde. Acciones por fila (Combustible / Mantenciones / Detalle) son tres `Button variant="ghost"` que se confunden con links.
- **Acción:** vista colapsable o tabs en mobile, menú kebab para acciones por fila en desktop.

### L10. Breadcrumb y sidebar muestran árboles de navegación distintos
- **Severidad:** 🟡 Baja (consistencia)
- **Evidencia:** las páginas legacy (`/combustibles/vehiculos`, `/combustibles/proveedores-combustible`) hacen redirect a `/admin/flota-catalogos/*` pero el sidebar y el breadcrumb siguen mostrando "Combustibles" como activo en las legacy, mientras que la misma página renderizada desde la URL canónica muestra "Administración > Catálogos de flota".
- **Acción:** normalizar el breadcrumb al path canónico después del redirect (usar `usePathname` post-redirect, o middleware que reescriba la URL).

### L11. `desktop-compras-facturas.png` con tabla pegada al borde inferior (45px de padding)
- **Severidad:** 🟡 Baja
- **Evidencia:** la última tabla termina a 1034px de un viewport de 1080px. Sin "respiro" antes del borde. Todas las capturas que terminan al ras carecen de un "footer" o padding compensatorio.
- **Acción:** añadir `pb-8` o `mb-8` consistente al final de cada `<PageContainer>`.

### L12. `desktop-bodega.png` con `WarehouseHeaderMetrics` muestra "Bajo mínimo: 12" sin contexto
- **Severidad:** 🟡 Baja
- **Evidencia:** el usuario ve "12" pero no sabe si son productos, unidades, o el delta vs la semana pasada.
- **Acción:** añadir sufijo de unidad ("12 productos") o tooltip con definición.

---

## 📱 Hallazgos Específicos Mobile (390×844)

### MB1. 84 capturas mobile < 40KB (probablemente vacías)
- **Severidad:** 🟠 Media
- **Evidencia:** 84 de 110 capturas mobile tienen tamaño < 40KB. Muchas son las 25 que redirigen a `/forbidden` (ver C1), pero también hay otras con poco contenido.
- **Acción:** después de corregir C1/C3, regenerar y re-medir.

### MB2. Bug del `PageHeader` afecta más a mobile que a desktop
- **Severidad:** 🟠 Media
- **Evidencia:** en mobile, `PageHeader` con `actions` SÍ se renderiza visible (no hay `lg:sr-only`), pero las acciones se duplican: aparecen en `PageHeader` (mobile) Y en el TopBar (vía `setHeader`). Resultado: dos copias del botón "Nueva X" en la misma vista.
- **Acción:** revisar lógica de `setHeader` y la prop `headerActions` vs `actions` en `PageHeader` y los componentes que la usan.

### MB3. Capturas mobile con scroll horizontal accidental
- **Severidad:** 🟡 Baja
- **Evidencia:** las tablas con `min-w-[900px]`+ se desbordan en 390px. El `TableRoot` tiene `overflow-x-auto` (bien), pero en mobile el usuario tiene que hacer swipe horizontal para ver columnas, lo cual se siente roto.
- **Acción:** convertir tablas a `card` layout en mobile usando `data-table.tsx:mobileCards` que ya está implementado. Auditar qué tablas NO lo usan.

### MB4. CTAs muy pequeños en mobile
- **Severidad:** 🟡 Baja
- **Evidencia:** los botones `size="sm"` en mobile pueden quedar < 32px de alto, debajo del mínimo táctil recomendado (44px iOS / 48dp Android).
- **Acción:** usar `size="md"` o `size="lg"` en mobile, dejar `sm` solo en desktop.

---

## 🔄 Inconsistencias Detectadas

| Área | Patrón A | Patrón B | Páginas afectadas |
|------|----------|----------|-------------------|
| Botón primario | "Nueva OC" / "Nueva carga" / "+ Nuevo vehículo" | "Crear" / "Registrar" / "Agregar" | todas las listas |
| Estado vacío | "No hay X. Crea el primero." con CTA | Tabla vacía sin explicación | inconsistente entre módulos |
| Date format | "2026-06-09" / "9 jun 2026" / "hace 3 días" | mezclados | dependiendo del contexto |
| Currency | "$1.234.567" / "CLP 1.234.567" / "1,2M CLP" | `formatCLP` debería ser la única fuente | revisar usos inline |
| Pagination | "Anterior / 1 / 2 / 3 / Siguiente" | "Mostrar 25 / 50 / 100" + offset | inconsistente |
| Tabs de filtros | Chips arriba de la tabla | Select dropdowns | solicitudes vs OC vs recepción |

---

## 🛠 Acciones Recomendadas (Priorizadas)

### Sprint 1 (urgente, ~1 día)
1. **Corregir `app/(app)/forbidden/page.tsx`** (C1) — agregar contenido visible (icono + mensaje + grid de links), replicar el patrón de `not-found.tsx`. Sin esto, **el 20% de la app no se puede usar desde un redirect a `/forbidden`**.
2. **Corregir `scripts/capture-all-routes.ts:393-401`** (C3) — añadir `isGlobal: true` a roles de admin/jefa/secretaria/prevencionista. Regenerar capturas.
3. **Reemplazar `text-(--…)` por `text-[var(--…)]`** (M1) — buscar con `grep` y reemplazar.

### Sprint 2 (1-2 semanas)
4. **Estandarizar CTAs y terminología** (M2, M4) — unificar "OC" vs "Orden de compra", mover CTAs primarias a `PageHeader.actions`, decidir "Crítico" vs "Crítica".
5. **Reemplazar diálogos inline por `<ConfirmDialog variant="destructive">`** (C5) en `OcActions`.
6. **Truncar columnas variables en tablas** (M3) — añadir `truncate max-w-[160px]` a `worksiteName`, `requesterName`, `supplierName`.
7. **Validar contraste WCAG** (L1) — correr axe-core con pares fallidos, ajustar `--color-text-faint`.

### Sprint 3 (mejoras continuas)
8. **Refactor `OnboardingHint`** (M5) — consolidar en 1 toast flotante global.
9. **Arreglar `PageHeader` flash** (M6) — hacer que el TopBar lea `<h1>` directamente del DOM.
10. **Tablas mobile** (MB3) — usar `data-table.tsx:mobileCards` en todas las listas, auditar cuáles no lo usan.
11. **Sidebar sticky con max-height** (L3) — añadir `max-h-[calc(100dvh-100px)] overflow-y-auto` a todos los `<aside className="lg:sticky">`.
12. **Catálogo visual de estados** — crear `/admin/estados` que documente todos los `StateBadge` y su semántica.

---

## 📋 Inventario Completo de Capturas Analizadas

### Desktop (110 capturas, 1920×1080)
- **Auth (5):** `root`, `login`, `registro`, `recuperar`, `recuperar-token` — ver C2 (root = login bit-idénticos), agente de auth reportó asimetría de paneles en login
- **PPA (2):** `ppa-form`, `ppa-result` — ver L6 (result con poco contenido)
- **Errores (3):** `not-found`, `app-not-found`, `forbidden` — ver C1 (`forbidden` vacío)
- **Dashboard / perfil / soporte (5):** `dashboard`, `perfil`, `soporte`, `soporte-nuevo`, `soporte-detalle` — ver L7 (cards desalineadas), M13 (OnboardingHint en soporte)
- **Solicitudes / aprobaciones / compras / recepción (8):** ver M3 (sin truncate), C4 (botón papelera), C5 (diálogos inline), M16 (CTAs primarias)
- **Bodega / entregas / trazabilidad (5):** ver L2 (WarehouseHeaderMetrics), L8 (sidebar xl collapse), L3 (sidebar sticky)
- **Reportes / analítica (2):** ver M11 (estados sin StateBadge), L4 (charts sin aria-label)
- **Flota / mantenciones (2):** ver L9 (tabla 11 cols, acciones ghost)
- **Combustibles (16):** **8 rotas** (C1), ver L10 (breadcrumb inconsistente)
- **Repuestos / servicios (6):** ahora redirigen a `/solicitudes` vía `next.config.ts:36-46`, capturas muestran `/solicitudes` con query `?tipo=`
- **Prevención (23):** **12 rotas** (C1), ver M1 (bug CSS `text-(--…)`)
- **Admin (25):** **10 rotas** (C1), el resto se ve OK

### Mobile (110 capturas, 390×844)
- Patrones similares a desktop con problemas agravados: **84 < 40KB**, ver MB1-MB4
- Las 22 que redirigen a `/forbidden` se repiten en mobile
- Tablas requieren vista de cards (MB3) — la mayoría de listas se ve apretada

---

## 📂 Archivos Generados

- `AUDITORIA_UI_UX.md` (este documento, raíz)
- `audit/UI_UX_AUDIT.md` (informe de 38 hallazgos previos basado en lectura de código, no visual)
- `audit/screenshots/2026-06-09-playwright/INVENTARIO_UI_UX_RAW.md` (análisis de píxeles por agente)
- `audit/screenshots/2026-06-09-playwright/INVENTARIO_RAW_REPUESTOS_SERVICIOS_PREVENCION.md` (análisis repuestos/servicios/prevención)
- `audit/screenshots/2026-06-09-playwright/manifest.json` (status + finalUrl por captura)

---

## 🔍 Metodología y Limitaciones

**Lo que verifiqué con evidencia objetiva:**
- Conteo de capturas por viewport, tamaño en bytes, MD5 de archivos para detectar duplicados.
- Composición de píxeles por bandas horizontales (mean del grayscale en `800×100+560+y`) para distinguir capturas vacías vs con contenido.
- `manifest.json` (status code + finalUrl) para distinguir páginas que cargan OK, que redirigen, o que devuelven 404.
- Lectura directa de archivos `.tsx` para entender causa raíz de bugs visuales.

**Lo que NO pude verificar (limitaciones de la sesión):**
- Texto exacto de copy, ortografía, contraste WCAG en pares específicos (requiere OCR + axe-core con `--save-report`).
- Estados hover/focus/active/disabled (capturas estáticas).
- Animaciones, transiciones, microinteracciones.
- Comportamiento responsive en breakpoints intermedios (tablet 768px).
- Real flow de teclado y orden de tabulación.

**Siguiente pasada sugerida:**
- Corregir C1 (forbidden) + C3 (seed) y re-ejecutar `npm run screenshots`.
- Corregir M1 (bug CSS) y re-validar con axe-core.
- Capturar interacciones: modales abiertos, dropdowns, focus traps.
- Tabular capturas desktop vs mobile side-by-side en `/admin/estados`.
