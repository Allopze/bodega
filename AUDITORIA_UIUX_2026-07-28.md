# Auditoría UI/UX — Chome

**Fecha:** 2026-07-28  
**Checkout auditado:** `/home/allopze/dev/chome/bodega`  
**Alcance:** bugs visuales y funcionales de interfaz, responsive, WCAG 2.2 AA, sistema visual, consistencia entre módulos, estados, tablas y rendimiento percibido.  
**Criterio de severidad:** P0 bloquea la tarea; P1 degrada o confunde de forma significativa; P2 es una inconsistencia visible o una fricción acotada; P3 es cosmético.

> Esta auditoría no modificó código de producto en su versión original. Se agregó únicamente una prueba reproducible de captura/evidencia en `e2e/ui-ux-audit-evidence.spec.ts`.
>
> **Actualización 2026-07-28 (misma fecha, sesión de remediación):** los 20 hallazgos recibieron una corrección de código. Cada hallazgo abajo incluye una nota "✅ Corregido" con el detalle. Ver [§12. Estado de remediación](#12-estado-de-remediación-2026-07-28) para el resumen, lo verificado y lo que queda pendiente.

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Metodología y alcance ejecutado](#2-metodología-y-alcance-ejecutado)
3. [Matriz de capturas](#3-matriz-de-capturas)
4. [Hallazgos P0](#4-hallazgos-p0)
5. [Hallazgos P1](#5-hallazgos-p1)
6. [Hallazgos P2](#6-hallazgos-p2)
7. [Hallazgos P3](#7-hallazgos-p3)
8. [Resultados positivos y checks sin hallazgos](#8-resultados-positivos-y-checks-sin-hallazgos)
9. [Puntuación de salud y veredicto visual](#9-puntuación-de-salud-y-veredicto-visual)
10. [Orden recomendado de remediación](#10-orden-recomendado-de-remediación)
11. [Artefactos y comandos reproducibles](#11-artefactos-y-comandos-reproducibles)
12. [Estado de remediación (2026-07-28)](#12-estado-de-remediación-2026-07-28)

## 1. Resumen ejecutivo

La base visual es consistente y responsive en las rutas muestreadas: no hubo overflow horizontal a 1920, 1280 ni 390 px; la navegación por teclado, el zoom al 200 %, los estados de carga y la estructura de landmarks pasaron la suite existente; y el presupuesto de bundle global también pasó.

Sin embargo, el checkout no está listo para considerarse sano en UI/UX:

- `/combustibles/bitacora` está completamente bloqueada en el build de producción por una frontera Server/Client inválida.
- El shell visible en desktop y tablet incumple contraste WCAG AA en todas las rutas auditadas.
- El dashboard obtiene **50/100 en Lighthouse móvil**, con LCP de **8,18 s** y TBT de **1,36 s**.
- Hay defectos repetibles de nombre accesible, tablas sin nombre, objetivos táctiles inferiores al estándar móvil del producto y paginación interna que no se reinicia al filtrar.

### Conteo de hallazgos

| Severidad | Cantidad | Lectura |
|---|---:|---|
| P0 | 1 | Una tarea completa está bloqueada |
| P1 | 9 | Rendimiento, WCAG AA, formularios y estado de tabla |
| P2 | 8 | A11y contextual, objetivos táctiles, KPIs y observabilidad |
| P3 | 2 | Desviaciones del sistema de tokens |
| **Total** | **20** | Hallazgos atómicos, cada uno ligado a una ruta |

### Puntuación global

**6,0/10 — aceptable con reservas, no aprobable mientras exista el P0.**

## 2. Metodología y alcance ejecutado

### Rutas y viewports

Se auditó la matriz solicitada con páginas nuevas por ruta para evitar contaminación de estado entre navegaciones:

- `/dashboard`
- `/solicitudes`
- `/prevencion/pdtp`
- `/combustibles/bitacora`
- `/admin/usuarios`

Viewports:

- Desktop: `1920×1080`
- Tablet: `1280×720`
- Mobile: `390×844`

### Pruebas y mediciones

- Captura visual y métricas DOM con Playwright.
- Axe-core con reglas WCAG 2 A/AA, 2.1 AA y 2.2 AA, **incluyendo** `color-contrast`.
- Lighthouse 12.8.2 autenticado sobre build standalone:
  - desktop preset;
  - perfil móvil por defecto.
- Suite existente:
  - accesibilidad;
  - navegación por teclado;
  - zoom al 200 %;
  - latencia percibida.
- Auditoría estática de las 147 páginas autenticadas y componentes compartidos para:
  - `PageContainer` / `PageHeader`;
  - búsqueda duplicada o ausente;
  - tablas y paginación;
  - labels;
  - diálogos y sheets;
  - estados vacíos/error;
  - `SelectItem value=""`;
  - fechas nativas;
  - estados de carga hardcodeados;
  - tokens y contraste.

### Limitaciones explícitas

- El teclado virtual real de iOS/Android no se puede reproducir fielmente con el viewport de Chromium; sí se verificó scroll y altura de los primitives `Dialog`/`Sheet`.
- La base E2E contiene solo tres usuarios; el defecto de paginación de `/admin/usuarios` se confirma por el flujo de estado del componente y se activa cuando el conjunto supera 25 filas.
- Lighthouse móvil usa throttling sintético. Sirve como señal comparativa y de regresión, no sustituye datos RUM de dispositivos de terreno.
- No existen páginas hermanas independientes `/repuestos` o `/servicios` en este checkout; esos conceptos son tipos dentro del flujo de solicitudes. La comparación estructural directa se hizo entre Solicitudes y Compras.

## 3. Matriz de capturas

| Ruta | 1920×1080 | 1280×720 | 390×844 |
|---|---|---|---|
| `/dashboard` | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-dashboard.png) | [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-dashboard.png) | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-dashboard.png) |
| `/solicitudes` | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-solicitudes.png) | [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-solicitudes.png) | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-solicitudes.png) |
| `/prevencion/pdtp` | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-prevencion-pdtp.png) | [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-prevencion-pdtp.png) | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-prevencion-pdtp.png) |
| `/combustibles/bitacora` | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-combustibles-bitacora.png) | [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-combustibles-bitacora.png) | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-combustibles-bitacora.png) |
| `/admin/usuarios` | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-admin-usuarios.png) | [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-admin-usuarios.png) | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-admin-usuarios.png) |

Evidencia estructurada: [evidence.json](audit/ui-ux-2026-07-28/evidence.json).

## 4. Hallazgos P0

### UIUX-001 — `/combustibles/bitacora`: la página completa cae en el error boundary

| Campo | Evidencia |
|---|---|
| Ruta | `/combustibles/bitacora` |
| Viewports | 1920×1080, 1280×720 y 390×844 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-combustibles-bitacora.png) · [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-combustibles-bitacora.png) · [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-combustibles-bitacora.png) |
| Código | `components/ui/input.tsx:8-21`; `app/(app)/combustibles/bitacora/page.tsx:15,179,203-217` |

**Qué ocurre.** El build de producción muestra “Error al cargar la bitácora” y nunca renderiza filtros ni tabla. El servidor registra:

```text
Event handlers cannot be passed to Client Component props.
{ ..., onWheel: function onWheel, ... }
```

`/combustibles/bitacora/page.tsx` es un Server Component que renderiza `Input` directamente. `Input` no declara `"use client"` pero siempre crea un callback `onWheel`, por lo que React Server Components intenta serializar un event handler y aborta el render. El error boundary ofrece reintentar, pero repetir la misma renderización vuelve a fallar.

**Impacto.** El usuario no puede consultar, filtrar ni exportar la bitácora general. El HTTP 200 del error boundary puede ocultar el incidente a checks que solo validen status.

**Recomendación.** Corregir la frontera Server/Client del primitive o evitar callbacks creados en servidor; agregar una prueba de producción que verifique contenido funcional de la ruta, no solo status o ausencia de `pageerror`.

**✅ Corregido (2026-07-28).** Se agregó `"use client"` a `components/ui/input.tsx:1` — es el fix de raíz: como `Input` ya crea el closure `onWheel` internamente, ahora corre en un límite Cliente propio y puede seguir montándose directo desde cualquier Server Component (incluida `bitacora/page.tsx`) sin que React intente serializar la función por el canal RSC. Corrige la ruta y, de paso, cualquier otro Server Component que ya renderizaba `Input` directamente (`prevencion/incidentes/[id]/page.tsx`, `combustibles/sellos/page.tsx`, `combustibles/tae/tae-filters.tsx`).

**✅ Confirmado en build (2026-07-28, sesión 2).** El trabajo concurrente no relacionado terminó y `npm run build` (`next build`, Turbopack) ya compila limpio: `/combustibles/bitacora` aparece en la lista de rutas generadas sin error, `tsc` (vía el build) y `Collecting/Generating static pages` pasan sin fallos. **Pendiente:** no se hizo un smoke test manual con navegador (levantar el server y click-through de filtros/tabla en los tres viewports) — el build compilando no prueba que el contenido funcional se vea bien, solo que ya no crashea.

## 5. Hallazgos P1

### UIUX-002 — `/dashboard`: rendimiento móvil insuficiente

| Campo | Evidencia |
|---|---|
| Ruta | `/dashboard` |
| Viewport | 390×844, Lighthouse móvil |
| Captura | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-dashboard.png) |
| Lighthouse | [reporte móvil](audit/ui-ux-2026-07-28/lighthouse-dashboard-mobile.json) |
| Código | `app/(app)/dashboard/page.tsx:221-237`; `app/(app)/dashboard/dashboard-charts.tsx:1-23` |

Resultados:

| Métrica | Resultado |
|---|---:|
| Performance | **50/100** |
| FCP | 1,36 s |
| LCP | **8,18 s** |
| TBT | **1.362 ms** |
| Speed Index | 2,36 s |
| CLS | 0 |
| JS inicial sin comprimir | 2,04 MB |

El dashboard monta hasta ocho gráficos Recharts en el bloque marcado explícitamente como `above-the-fold`. Lighthouse atribuye 5,57 s de trabajo principal a evaluación de scripts y detecta aproximadamente 168 KB de JavaScript transferido sin uso en tres chunks destacados.

**Impacto.** En dispositivos modestos o conectividad de terreno, la pantalla parece lista antes de ser interactiva y el contenido principal tarda demasiado en estabilizarse.

**Recomendación.** Priorizar el centro de control y diferir analítica secundaria: import dinámico por sección, render progresivo bajo el primer viewport y menor superficie cliente para gráficos no visibles.

**✅ Corregido (2026-07-28).** Se creó `app/(app)/dashboard/dashboard-analytics-section.tsx`, un client component que carga cada gráfico con `next/dynamic(..., { ssr: false })` (chunk de Recharts fuera del bundle inicial, con skeleton de altura fija para evitar CLS). En `dashboard/page.tsx` la sección de Analítica se movió después de `DashboardControlCenter` (antes iba primero), así el Centro de Control pasa a ser el contenido prioritario del primer viewport. **Pendiente:** no se re-corrió Lighthouse móvil en esta sesión (el build de producción está bloqueado por trabajo no relacionado en curso en el mismo checkout — ver §12); falta confirmar que el score supere 75 y LCP baje de 8,18 s.

### UIUX-003 — `/dashboard`: tres textos incumplen contraste AA

| Campo | Evidencia |
|---|---|
| Ruta | `/dashboard` |
| Viewports | 1920×1080, 1280×720 y 390×844 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-dashboard.png) · [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-dashboard.png) |
| Código | `components/layout/desktop-nav.tsx:128`; `components/layout/sidebar-user-profile.tsx:82`; `app/(app)/dashboard/page.tsx:226` |

Axe/Lighthouse:

- “PLATAFORMA”: `#90a1b9` sobre `#f3f3f5`, **2,37:1**.
- Email del perfil: `#62748e` sobre `#f3f3f5`, **4,29:1**.
- “Datos del año en curso”: `#90a1b9` sobre blanco, **2,63:1**.

**Impacto.** Texto pequeño y operativo queda por debajo de 4,5:1, incumpliendo WCAG 1.4.3 AA.

**Recomendación.** Sustituir `text-slate-*` por tokens semánticos cuyo par superficie/texto esté cubierto por el test de contraste.

**✅ Corregido (2026-07-28).** `desktop-nav.tsx:128` ("PLATAFORMA") y `sidebar-user-profile.tsx:82` (email) pasaron a `text-(--color-text-muted)` / `text-(--color-text-subtle)` — mismo fix que cierra UIUX-004 a UIUX-007, porque las cinco rutas comparten estos dos componentes de shell. "Datos del año en curso" (`dashboard/page.tsx:226`) pasó a `text-(--color-text-muted)`. Los cuatro tokens de texto (`text`, `text-muted`, `text-subtle`, `text-faint`) ya están validados ≥4,5:1 contra `--color-chrome` y el resto de superficies en `components/__tests__/design-tokens-contrast.test.ts` (33/33 passed tras el cambio).

### UIUX-004 — `/solicitudes`: el shell incumple contraste AA

| Campo | Evidencia |
|---|---|
| Ruta | `/solicitudes` |
| Viewports | 1920×1080 y 1280×720 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-solicitudes.png) · [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-solicitudes.png) |
| Código | `components/layout/desktop-nav.tsx:128`; `components/layout/sidebar-user-profile.tsx:82` |

“PLATAFORMA” obtiene 2,37:1 y el email del perfil 4,29:1. Ambos están bajo el mínimo de 4,5:1 para texto normal.

**Impacto.** La ruta incumple WCAG 1.4.3 AA aunque su contenido específico no añada nuevas infracciones Axe.

**Recomendación.** Corregir los dos estilos compartidos del shell y conservar esta ruta en el gate de contraste.

**✅ Corregido (2026-07-28).** Ver el fix compartido en UIUX-003.

### UIUX-005 — `/prevencion/pdtp`: el shell incumple contraste AA

| Campo | Evidencia |
|---|---|
| Ruta | `/prevencion/pdtp` |
| Viewports | 1920×1080 y 1280×720 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-prevencion-pdtp.png) · [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-prevencion-pdtp.png) |
| Código | `components/layout/desktop-nav.tsx:128`; `components/layout/sidebar-user-profile.tsx:82` |

Se reproducen los ratios 2,37:1 y 4,29:1 del shell.

**Impacto.** La vista preventiva falla WCAG 1.4.3 AA antes de considerar sus gráficos o métricas.

**Recomendación.** Misma corrección semántica compartida y cobertura Axe sin deshabilitar contraste.

**✅ Corregido (2026-07-28).** Ver el fix compartido en UIUX-003.

### UIUX-006 — `/combustibles/bitacora`: el shell del estado de error incumple contraste AA

| Campo | Evidencia |
|---|---|
| Ruta | `/combustibles/bitacora` |
| Viewports | 1920×1080 y 1280×720 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-combustibles-bitacora.png) · [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-combustibles-bitacora.png) |
| Código | `components/layout/desktop-nav.tsx:128`; `components/layout/sidebar-user-profile.tsx:82` |

Incluso el error boundary accesible conserva los dos fallos del shell: 2,37:1 y 4,29:1.

**Impacto.** En una situación de fallo, la información periférica ya degradada añade fricción al usuario que intenta recuperarse.

**Recomendación.** Corregir en los componentes compartidos y verificar también estados de error.

**✅ Corregido (2026-07-28).** Ver el fix compartido en UIUX-003.

### UIUX-007 — `/admin/usuarios`: el shell incumple contraste AA

| Campo | Evidencia |
|---|---|
| Ruta | `/admin/usuarios` |
| Viewports | 1920×1080 y 1280×720 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-admin-usuarios.png) · [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-admin-usuarios.png) |
| Código | `components/layout/desktop-nav.tsx:128`; `components/layout/sidebar-user-profile.tsx:82` |

La ruta reproduce los ratios 2,37:1 y 4,29:1.

**Impacto.** Administración de usuarios no cumple WCAG 1.4.3 AA.

**Recomendación.** Sustituir colores literales por el par de tokens validado para chrome/sidebar.

**✅ Corregido (2026-07-28).** Ver el fix compartido en UIUX-003.

### UIUX-008 — `/dashboard`: el botón de perfil contradice su texto visible

| Campo | Evidencia |
|---|---|
| Ruta | `/dashboard` |
| Viewport | 1920×1080, Lighthouse desktop |
| Captura | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-dashboard.png) |
| Lighthouse | [reporte desktop](audit/ui-ux-2026-07-28/lighthouse-dashboard-desktop.json) |
| Código | `components/layout/sidebar-user-profile.tsx:74-85` |

El botón muestra nombre y email, pero `aria-label="Abrir menú de usuario"` reemplaza todo el nombre accesible. Lighthouse falla `label-content-name-mismatch`: el texto visible no está contenido en el nombre anunciado.

**Impacto.** Usuarios de control por voz no pueden activar el control usando las palabras visibles; incumple el principio de WCAG 2.5.3.

**Recomendación.** Incluir el nombre visible en el nombre accesible o usar una descripción adicional sin reemplazarlo.

**✅ Corregido (2026-07-28).** Se quitó el `aria-label` del botón expandido en `sidebar-user-profile.tsx:74-85` — el nombre accesible ahora se deriva del contenido visible (nombre + email), que ya es lo que el usuario ve, y se marcó `CaretUpDown` como `aria-hidden` para no sumar ruido. La variante colapsada (solo avatar, sin texto visible) no se tocó porque ahí no hay mismatch.

### UIUX-009 — `/admin/usuarios`: filtrar desde página 2+ puede mostrar un falso vacío

| Campo | Evidencia |
|---|---|
| Ruta | `/admin/usuarios` |
| Viewport | 1920×1080 |
| Captura | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-admin-usuarios.png) |
| Código | `app/(app)/admin/usuarios/user-list.tsx:98-105`; `components/admin/data-table.tsx:146-177,195-215,227-235` |

La tabla usa la búsqueda del TopBar y pagina de a 25 filas. `DataTable` reinicia `page` al ordenar y al escribir en una búsqueda **explícita**, pero no cuando cambia `searchQuery` del shell ni cuando cambia el conjunto `rows`. Si el usuario está en página 2 o superior y el filtro reduce los resultados a una sola página, `slice()` devuelve cero filas y se renderiza “Sin usuarios” aunque haya coincidencias.

**Impacto.** El sistema comunica que no existen usuarios coincidentes y puede inducir decisiones administrativas erróneas.

**Recomendación.** Reiniciar o acotar la página cuando cambien `currentSearch`, `rows`, filtros o `pageSize`; cubrir búsqueda de TopBar desde una página distinta de la primera.

**✅ Corregido (2026-07-28).** En vez de un `useEffect` que resetea `page` (riesgoso: `rows` suele llegar con una referencia nueva en cada render del padre, lo que habría devuelto a página 1 en cada click de "página siguiente"), se acotó la página mostrada contra el total real: `safePage = Math.min(page, totalPages)`, derivado de `totalFiltered` (un número, no una referencia). `components/admin/data-table.tsx:196-209,394-399`. Cubre a la vez búsqueda de TopBar, `rows`, filtros y `pageSize`, sin depender de qué disparó el cambio. Test de regresión agregado en `components/__tests__/data-table.test.tsx` ("keeps showing real rows if the dataset shrinks while on a later page").

### UIUX-010 — `/combustibles/bitacora`: filtros de texto sin nombre accesible

| Campo | Evidencia |
|---|---|
| Ruta | `/combustibles/bitacora` |
| Viewports | Afectaría los tres una vez resuelto UIUX-001 |
| Captura | [desktop del estado actual](audit/ui-ux-2026-07-28/screenshots/desktop-combustibles-bitacora.png) |
| Código | `app/(app)/combustibles/bitacora/page.tsx:176-190,201-217`; `components/ui/input.tsx:8-35` |

Los inputs `q`, `marca`, `modelo`, `conductor`, `supervisor`, `sello_retirado` y `sello_instalado` se renderizan solo con `name` y `placeholder`. No tienen `<label>`, `aria-label` ni `aria-labelledby`. El placeholder no reemplaza un nombre accesible persistente.

**Impacto.** Al corregir el crash P0, el formulario seguirá siendo ambiguo para lector de pantalla y para usuarios que escriben y pierden el placeholder.

**Recomendación.** Usar `Field` o labels explícitos asociados; conservar el placeholder solo como ejemplo o pista.

**✅ Corregido (2026-07-28).** Se agregó `aria-label` a los 7 inputs de texto (`q`, `marca`, `modelo`, `conductor`, `supervisor`, `sello_retirado`, `sello_instalado`) en `bitacora/page.tsx`, conservando el placeholder tal cual. Se optó por `aria-label` en vez de `Field` (que añade un `<label>` visible arriba de cada control) para no alterar la densidad ya auditada de esta grilla de filtros — el nombre accesible persiste aunque el usuario escriba y el placeholder desaparezca.

## 6. Hallazgos P2

### UIUX-011 — `/dashboard`: filtros móviles con objetivos de 32–36 px

| Campo | Evidencia |
|---|---|
| Ruta | `/dashboard` |
| Viewport | 390×844 |
| Captura | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-dashboard.png) |
| Código | `app/(app)/dashboard/dashboard-control-center.tsx:247-267,269-292,435-448` |

Los cinco filtros rápidos miden 32 px de alto y los cinco selects 36 px. El estándar móvil del producto exige 44×44 px.

**Impacto.** Aumenta el error de toque en terreno, especialmente con guantes o movimiento. Los controles alcanzan el mínimo WCAG de 24 px, por lo que se clasifica como fricción de producto y no como fallo AA automático.

**Recomendación.** Aplicar altura móvil de 44 px y reducirla solo desde `sm`.

**✅ Corregido (2026-07-28).** Filtros rápidos → `h-11 sm:h-8`; selects (`FilterSelect`) → `h-11 sm:h-9`. `app/(app)/dashboard/dashboard-control-center.tsx:255,445`.

### UIUX-012 — `/solicitudes`: paginación y cierre de ayuda demasiado pequeños

| Campo | Evidencia |
|---|---|
| Ruta | `/solicitudes` |
| Viewport | 390×844 |
| Captura | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-solicitudes.png) |
| Código | `components/ui/server-pagination.tsx:62-103`; `components/ui/onboarding-hint.tsx:56-57` |

Los enlaces de página miden 28×28 px, “Página siguiente” 30×28 px y “Cerrar ayuda” 24×24 px.

**Impacto.** La paginación es una interacción repetitiva y queda por debajo del objetivo táctil de 44 px.

**Recomendación.** Ampliar hit area sin agrandar necesariamente el glifo; usar al menos 44 px en mobile y conservar la densidad desktop con breakpoint.

**✅ Corregido (2026-07-28).** `PageLink` en `components/ui/server-pagination.tsx:76` → `h-11 min-w-11 sm:h-7 sm:min-w-7` (glifo igual, hit area 44 px en mobile). "Cerrar ayuda" en `components/ui/onboarding-hint.tsx:57` → `min-h-11 min-w-11 sm:min-h-6 sm:min-w-6`.

### UIUX-013 — `/prevencion/pdtp`: tabs de 31 px y enlace de matriz con hit area mínima

| Campo | Evidencia |
|---|---|
| Ruta | `/prevencion/pdtp` |
| Viewport | 390×844 |
| Captura | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-prevencion-pdtp.png) |
| Código | `components/ui/tabs.tsx:25-47`; `app/(app)/prevencion/pdtp/page.tsx:271-278` |

Los tabs “Ejecución”, “Siniestralidad” y “Material y Ambiental” miden 31 px de alto. El enlace “Ver matriz detallada…” tiene una caja visual de 16 px de alto.

**Impacto.** Cambiar entre análisis preventivos y abrir la matriz requiere precisión innecesaria.

**Recomendación.** Dar 44 px de altura móvil a tabs y un bloque táctil con padding al enlace.

**✅ Corregido (2026-07-28).** `TabsTrigger` (`components/ui/tabs.tsx:32`) → `inline-flex min-h-11 sm:min-h-0 items-center justify-center`, corrige este y cualquier otro consumidor del primitive compartido. El enlace "Ver matriz detallada…" (`app/(app)/prevencion/pdtp/page.tsx:274`) → `inline-flex min-h-11 sm:min-h-0 items-center` (mismo texto y tamaño visual, hit area 44 px en mobile).

### UIUX-014 — `/admin/usuarios`: filtros de invitaciones de 32 px

| Campo | Evidencia |
|---|---|
| Ruta | `/admin/usuarios` |
| Viewport | 390×844 |
| Captura | [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-admin-usuarios.png) |
| Código | `app/(app)/admin/usuarios/user-invitations-panel.tsx:106-120` |

“Pendientes” y “Todas” miden 32 px de alto.

**Impacto.** Los tabs de estado administrativos quedan por debajo del objetivo táctil del producto.

**Recomendación.** Usar el primitive `Tabs` con variante móvil o elevar `min-height` a 44 px bajo `sm`.

**✅ Corregido (2026-07-28).** Estos tabs son botones propios (no el primitive `Tabs`), así que se corrigieron aparte: `h-8` → `h-11 sm:h-8` en ambos botones ("Pendientes"/"Todas"), `app/(app)/admin/usuarios/user-invitations-panel.tsx:110,117`.

### UIUX-015 — `/solicitudes`: tabla sin caption ni nombre accesible

| Campo | Evidencia |
|---|---|
| Ruta | `/solicitudes` |
| Viewports | 1920×1080 y 1280×720 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-solicitudes.png) · [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-solicitudes.png) |
| Código | `app/(app)/solicitudes/request-list.tsx:148-179`; `components/admin/data-table.tsx:305-367`; `components/ui/table.tsx:40-47` |

La tabla no contiene `<caption>`, `aria-label` ni `aria-labelledby`.

**Impacto.** Un lector de pantalla llega a la estructura y columnas, pero no recibe el contexto “Solicitudes” al navegar directamente entre tablas.

**Recomendación.** Añadir una prop de nombre/caption al `DataTable` y exigirla en consumidores.

**✅ Corregido (2026-07-28).** Se agregó `caption: string` (ahora **obligatoria**) a `DataTableProps` (`components/admin/data-table.types.ts`), renderizado como `<TableCaption className="sr-only">` (`components/admin/data-table.tsx`). Solicitudes ya pasa `caption="Solicitudes"`.

**✅ Cerrado por completo (2026-07-28, sesión 2).** Se agregó `caption` a los ~34 call sites de `<DataTable>` en los ~28 consumidores restantes del repo (uno por caso, distinto cuando un mismo archivo renderiza más de una tabla — p. ej. "Vehículos activos" vs. "Vehículos inactivos"), y se hizo la prop obligatoria en TypeScript. Verificado con `tsc --noEmit` sobre el repo completo: 0 errores, ningún consumidor quedó sin `caption`.

### UIUX-016 — `/admin/usuarios`: tabla sin caption ni nombre accesible

| Campo | Evidencia |
|---|---|
| Ruta | `/admin/usuarios` |
| Viewports | 1920×1080 y 1280×720 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-admin-usuarios.png) · [tablet](audit/ui-ux-2026-07-28/screenshots/tablet-admin-usuarios.png) |
| Código | `app/(app)/admin/usuarios/user-list.tsx:98-106`; `components/admin/data-table.tsx:305-367`; `components/ui/table.tsx:40-47` |

La tabla tampoco expone caption o nombre.

**Impacto.** La relación entre la tabla y “Gestión de usuarios” depende solo del contexto visual de la página.

**Recomendación.** Consumir la futura prop del `DataTable` con “Usuarios de la plataforma”.

**✅ Corregido (2026-07-28).** `user-list.tsx` ya pasa `caption="Usuarios de la plataforma"` a la prop agregada en UIUX-015 (ahora obligatoria y cerrada por completo — ver nota en UIUX-015).

### UIUX-017 — `/prevencion/pdtp`: KPIs no accionables y cero sin vía de resolución

| Campo | Evidencia |
|---|---|
| Ruta | `/prevencion/pdtp` |
| Viewports | 1920×1080 y 390×844 |
| Capturas | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-prevencion-pdtp.png) · [mobile](audit/ui-ux-2026-07-28/screenshots/mobile-prevencion-pdtp.png) |
| Código | `app/(app)/prevencion/pdtp/page.tsx:323-366`; `components/ui/kpi-card.tsx:8-25,73` |

Las cuatro tarjetas usan `KpiCard`, que soporta `href`, pero ninguna lo entrega. “Acciones Pendientes” muestra `0` y “Sin hallazgos vencidos” sin navegar a acciones; “Cumplimiento Integral” puede mostrar `—` sin acceso directo a las ejecuciones que lo alimentan. En móvil las cuatro tarjetas ocupan gran parte de los primeros viewports antes de los gráficos.

**Impacto.** Las métricas informan, pero no ayudan a actuar ni a explicar el siguiente paso, contradiciendo A1/A4.

**Recomendación.** Hacer cada KPI navegable a su vista filtrada; cuando esté vacío, convertir el detalle en explicación y CTA real.

**✅ Corregido (2026-07-28).** Las 4 tarjetas ahora pasan `href` (`app/(app)/prevencion/pdtp/page.tsx:326-366`): "Cumplimiento Anual", "Avance Mes Vigente" y "Cumplimiento Integral" apuntan a `/prevencion/pdtp/${focusProgram.id}` (la vista de ejecuciones que alimenta esas cifras); "Acciones Pendientes" apunta a `/prevencion/pdtp/acciones`, con `?vencidas=1` cuando hay acciones vencidas. El detalle de "Cumplimiento Integral" en cero se reescribió para sugerir la acción ("abre el programa para registrar la primera") en vez de solo describir el estado vacío.

### UIUX-018 — `/dashboard`: CSP bloquea la telemetría cliente de Sentry

| Campo | Evidencia |
|---|---|
| Ruta | `/dashboard` |
| Viewports | 1920×1080 y 390×844 |
| Captura | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-dashboard.png) |
| Evidencia técnica | [Lighthouse desktop](audit/ui-ux-2026-07-28/lighthouse-dashboard-desktop.json) · [evidence.json](audit/ui-ux-2026-07-28/evidence.json) |
| Código | `lib/security/csp.ts:19-35`; `instrumentation-client.ts:3-19`; `next.config.ts:87-90` |

La aplicación inicializa Sentry en cliente, pero producción declara `connect-src 'self'`. El navegador bloquea los envíos al endpoint de Sentry y Lighthouse falla `errors-in-console`. También se observó un chunk interno de Next bloqueado por `script-src`; no se confirmó una navegación rota en la suite y debe investigarse por separado.

**Impacto.** Errores reales de interfaz —incluido UIUX-001— pueden no llegar a la telemetría cliente, alargando detección y recuperación.

**Recomendación.** Construir `connect-src` desde destinos explícitos permitidos por configuración y agregar una prueba CSP de envío; investigar el chunk bloqueado antes de ampliar `script-src`.

**✅ Corregido (2026-07-28), parcial.** `createCspHeader` (`lib/security/csp.ts`) ahora deriva el origen de ingest de Sentry desde `NEXT_PUBLIC_SENTRY_DSN` (`new URL(dsn).origin`) y lo agrega a `connect-src` solo si el DSN está configurado — sin abrir un wildcard `*.sentry.io` y sin cambiar nada cuando Sentry no está activo. 3 tests nuevos en `lib/__tests__/csp.test.ts` (sin DSN, con DSN, DSN mal formado).

**🔎 Investigado (2026-07-28, sesión 3) — causa raíz identificada, CSP sin cambios por decisión explícita.** El chunk bloqueado (`/_next/static/chunks/*.js`, idéntico en `/dashboard`, `/solicitudes` y `/prevencion/pdtp` en el `evidence.json` original) no es de Sentry ni de esta app: es el propio mecanismo de carga de rutas/chunks de Next.js App Router.

- `node_modules/next/dist/client/route-loader.js` (función `appendScript`) crea el `<script>` con `document.createElement('script')` + `document.body.appendChild(script)` y **nunca asigna `.nonce`**. Depende por completo de que `'strict-dynamic'` propague confianza automáticamente.
- La documentación oficial de Next.js confirma que el preload con nonce (`PreloadChunks`, `nonce: workStore.nonce`) para componentes `next/dynamic()` **solo corre cuando `ssr: true`**; con `ssr: false` el chunk se carga puramente en cliente por la misma vía sin nonce.
- La propagación de `'strict-dynamic'` es confiable a un primer nivel, pero se vuelve frágil con un segundo nivel de indirección: el prefetch automático de `<Link>` (idéntico en las tres rutas porque comparten el mismo sidebar) y cualquier `next/dynamic(..., { ssr: false })` caen en ese caso.
- **Nota importante:** el fix de UIUX-002 (sesión 1) agregó 8 `dynamic(..., { ssr: false })` nuevos en `dashboard-analytics-section.tsx` para diferir los gráficos del Dashboard — eso aumenta la superficie expuesta a este mismo problema específicamente en `/dashboard`, no la reduce.
- No se reprodujo en vivo con navegador en esta sesión (el entorno tuvo builds concurrentes de otro proceso mientras se intentaba levantar un server de inspección); la causa está respaldada por el código fuente de Next.js y su documentación oficial, no por una repro en vivo.

**Decisión (2026-07-28):** no modificar la CSP ahora. Quitar `'strict-dynamic'` resolvería el bloqueo de raíz (los chunks same-origin volverían a calzar con `'self'`), pero es un cambio de postura de seguridad que se decidió no tomar en esta sesión; se deja documentado como deuda técnica conocida en vez de tocar la política.

## 7. Hallazgos P3

### UIUX-019 — `/solicitudes`: cabecera de tabla evita los tokens del sistema

| Campo | Evidencia |
|---|---|
| Ruta | `/solicitudes` |
| Viewport | 1920×1080 |
| Captura | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-solicitudes.png) |
| Código | `components/ui/table.tsx:106-116` |

`TableHead` usa `text-slate-500 bg-slate-50/70 border-slate-200/80` en lugar de tokens semánticos. El test de contraste de tokens pasa porque estos literales quedan fuera de su alcance.

**Impacto.** La tabla puede desviarse si cambia la paleta del producto y dificulta garantizar contraste desde un único contrato.

**Recomendación.** Migrar el primitive a tokens de texto sutil, superficie y borde.

**✅ Corregido (2026-07-28).** `TableHead` (`components/ui/table.tsx:113-115`): `text-slate-500` → `text-(--color-text-subtle)`, `bg-slate-50/70` → `bg-(--color-surface-2)`, `border-slate-200/80` → `border-(--color-border)`. Al ser el primitive compartido, cierra a la vez UIUX-020.

### UIUX-020 — `/admin/usuarios`: cabecera de tabla evita los tokens del sistema

| Campo | Evidencia |
|---|---|
| Ruta | `/admin/usuarios` |
| Viewport | 1920×1080 |
| Captura | [desktop](audit/ui-ux-2026-07-28/screenshots/desktop-admin-usuarios.png) |
| Código | `components/ui/table.tsx:106-116` |

La tabla de usuarios hereda los mismos colores literales del primitive.

**Impacto.** La consistencia temática depende de valores Tailwind duplicados y no del sistema semántico.

**Recomendación.** Consumir la misma corrección del primitive y añadir un check estático para literales de paleta en componentes base.

**✅ Corregido (2026-07-28).** Ver el fix compartido en UIUX-019.

**✅ Check estático agregado (2026-07-28, sesión 2).** `components/__tests__/ui-primitives-no-literal-colors.test.ts` — test Vitest (mismo patrón que `design-tokens-contrast.test.ts`) que escanea todos los `.tsx` de `components/ui/` y falla si aparece un color Tailwind literal (`slate-500`, `red-400`, etc.) en vez de un token semántico `--color-*`. 51/51 archivos pasan hoy; cualquier literal nuevo en un primitive rompe el test.

## 8. Resultados positivos y checks sin hallazgos

### Layout, shell y responsive

- Las cinco rutas tienen un solo `<main>` y landmarks de header/nav/main correctos.
- Existe skip link y la suite verifica que sea el primer elemento focusable.
- No se detectó overflow horizontal en ninguna de las 15 combinaciones ruta/viewport.
- `DataTable` alterna correctamente tabla desktop y cards mobile en Solicitudes y Usuarios.
- `TableRoot` tiene `min-width` defensivo, scroll horizontal y clipping de contenido `sr-only`.
- `DialogContent` limita altura a `min(90dvh,54rem)` y habilita scroll vertical.
- `Sheet` usa layout de altura completa y `SheetBody` scrolleable.
- El rail desktop tiene scroll independiente; el perfil permanece anclado al fondo.

### Contrato de páginas

El barrido de 147 `page.tsx` autenticados no confirmó:

- páginas funcionales sin `PageContainer`;
- páginas funcionales sin `PageHeader`;
- wrappers manuales de padding duplicando `PageContainer`;
- dobles títulos reales;
- acciones de página confinadas solo a `headerActions`.

Los candidatos textuales sin estos componentes eran redirects, páginas delegadas o estados standalone justificados.

### Búsqueda, filtros y fechas

- No se reprodujo búsqueda textual duplicada en las cinco rutas.
- Solicitudes usa búsqueda server-side propia y oculta correctamente la del TopBar.
- La bitácora sí define búsqueda propia, aunque queda inaccesible por UIUX-001.
- No hay `<input type="date">` nativos.
- No reapareció `<SelectItem value="">`.
- No se encontraron `loading={true}` hardcodeados.
- No hay `toLocaleDateString()` directo en componentes TSX.

### Teclado y accesibilidad

La suite existente terminó con **76 pruebas aprobadas**:

- axe sin contraste en 27 rutas;
- navegación por teclado;
- retorno de foco y cierre con Escape;
- zoom 200 %;
- feedback de operaciones y navegación.

La captura específica encontró:

- cero controles visibles sin label en Dashboard, Solicitudes, PDTP y Usuarios;
- cero `tabIndex` positivos en el barrido;
- cero overflow al 200 % en la suite.

Advertencia de cobertura: `e2e/accessibility.spec.ts:42-45` deshabilita `color-contrast`, por eso la suite existente no detecta UIUX-003 a UIUX-007. Además, `e2e/zoom-200.spec.ts:61-86` solo revisa los primeros 20 controles y exige 24 px, no el estándar móvil de producto de 44 px.

### Estados y feedback

- Los estados de error inspeccionados ofrecen recuperación; el de bitácora permite reintentar y reportar.
- Los empty states de las listas principales usan `EmptyState` y CTA contextual.
- No se confirmó un doble submit ni error silencioso en los flujos cubiertos.
- Solicitudes conserva filtros en URL y ofrece “Limpiar filtros”.

### Rendimiento y calidad técnica

- Lighthouse desktop de Dashboard:
  - Performance 87/100;
  - Accessibility 96/100;
  - Best Practices 93/100;
  - FCP 0,38 s;
  - LCP 1,69 s;
  - TBT 205 ms;
  - CLS 0,001.
- Presupuesto de bundle:
  - 161 rutas analizadas;
  - peor caso `/combustibles/facturas`: 2,42 MB;
  - presupuesto: 3,00 MB;
  - resultado: aprobado.
- Contraste de tokens: 33/33 pruebas aprobadas.
- ESLint global: aprobado.
- TypeScript `tsc --noEmit`: aprobado.

## 9. Puntuación de salud y veredicto visual

Escala por dimensión: 0 deficiente, 1 frágil, 2 parcial, 3 sólida, 4 excelente.

| Dimensión | Puntaje | Fundamento |
|---|---:|---|
| Accesibilidad | **2/4** | Buen teclado, landmarks, labels y reflow; fallan contraste AA, nombre accesible y contexto de tablas |
| Performance | **2/4** | Desktop correcto y bundle bajo presupuesto; Lighthouse móvil 50 con LCP/TBT altos |
| Responsive | **3/4** | Sin overflow y buenas cards mobile; varios hit targets quedan bajo 44 px |
| Theming / sistema visual | **2/4** | Tokens robustos y testados; shell/tablas todavía usan paleta literal que escapa a los tests |
| Resistencia a anti-patrones | **3/4** | UI específica del dominio, sobria y operacional; PDTP y analítica aún caen en densidad de tarjetas/gráficos antes de la acción |
| **Total** | **12/20** | **6,0/10** |

### Veredicto “¿parece UI genérica o generada por IA?”

**Aprobado con reservas.** Chome ya tiene lenguaje propio: vocabulario operacional, faena scope, estados reales, tablas densas y controles coherentes. No se percibe como una plantilla genérica. La principal señal de patrón automático es la tendencia a resolver dashboards con una cuadrícula extensa de cards y gráficos, especialmente en PDTP, antes de priorizar la siguiente acción del usuario.

## 10. Orden recomendado de remediación

1. **Restaurar `/combustibles/bitacora`** y agregar smoke test de contenido sobre build de producción.
2. **Cerrar los cinco hallazgos de contraste del shell** desde los componentes compartidos y habilitar contraste en el gate regular.
3. **Reducir el costo inicial del Dashboard móvil** con carga progresiva de analítica.
4. **Corregir labels de bitácora, nombre accesible del perfil y nombres de tablas.**
5. **Reiniciar paginación de `DataTable` ante búsqueda/filtros/dataset.**
6. **Alinear objetivos táctiles a 44 px en mobile.**
7. **Hacer accionables los KPIs PDTP y mejorar estados cero.**
8. **Alinear CSP y Sentry sin abrir directivas genéricas.**
9. **Migrar literales slate de primitives a tokens semánticos.**

### Criterios mínimos de aceptación posterior

- Bitácora muestra filtros y al menos cabecera/empty state de tabla en los tres viewports.
- Axe con contraste no reporta violaciones en las cinco rutas.
- Lighthouse móvil del Dashboard supera 75 y mantiene CLS ≤0,1.
- LCP móvil ≤2,5 s y TBT ≤300 ms en el mismo entorno sintético o se documenta una meta incremental.
- Todas las tablas muestreadas exponen nombre accesible.
- Los controles móviles de uso repetitivo miden al menos 44 px.
- Buscar desde página 2+ nunca produce un falso vacío.
- Sentry recibe un evento de prueba bajo la CSP de producción.

## 11. Artefactos y comandos reproducibles

### Archivos

- Prueba de evidencia: `e2e/ui-ux-audit-evidence.spec.ts`
- Matriz estructurada: `audit/ui-ux-2026-07-28/evidence.json`
- Lighthouse desktop: `audit/ui-ux-2026-07-28/lighthouse-dashboard-desktop.json`
- Lighthouse móvil: `audit/ui-ux-2026-07-28/lighthouse-dashboard-mobile.json`
- Capturas: `audit/ui-ux-2026-07-28/screenshots/`

### Resultados ejecutados

```text
Playwright accessibility + keyboard + zoom + perceived latency: 76 passed
Playwright UI/UX evidence: 1 passed, 15 capturas canónicas
Vitest design-tokens-contrast: 33 passed
Bundle budget: OK, 161 rutas, máximo 2,42 MB / 3,00 MB
ESLint: passed
Typecheck: passed
Lighthouse Dashboard desktop: 87 / 96 / 93 / 63
Lighthouse Dashboard mobile: 50 / 96 / 93 / 63
```

> SEO 63 no se considera una deuda relevante para una aplicación autenticada e interna.

### Reproducción

```bash
npx playwright test e2e/ui-ux-audit-evidence.spec.ts --project=chromium
npx playwright test e2e/accessibility.spec.ts e2e/keyboard-navigation.spec.ts e2e/zoom-200.spec.ts e2e/perceived-latency.spec.ts --project=chromium
npx vitest run components/__tests__/design-tokens-contrast.test.ts
npm run check:bundle-budget
npm run lint
npm run typecheck
```

## 12. Estado de remediación (2026-07-28)

Los 20 hallazgos recibieron una corrección de código en la misma fecha de la auditoría, en dos sesiones. El detalle está inline en cada hallazgo (§4-§7, bloques "✅ Corregido"); esta sección resume el estado, lo verificado y lo que sigue abierto.

### 12.1 Resumen por severidad

| Severidad | Cerrados | Cerrados parcial | Nota |
|---|---:|---:|---|
| P0 | 1/1 | — | Fix de raíz aplicado y confirmado con un `next build` limpio (sesión 2); falta smoke test manual con navegador |
| P1 | 9/9 | — | Incluye los 5 hallazgos de contraste (un solo fix compartido) |
| P2 | 7/8 | 1/8 | UIUX-018 queda parcial: causa del chunk de `script-src` ya identificada (§ nota sesión 3), CSP sin tocar por decisión explícita; falta confirmar un envío real a Sentry |
| P3 | 2/2 | — | Mismo fix compartido para ambos, incluido el check estático de UIUX-020 |

### 12.2 Archivos tocados

**Sesión 1 (fixes originales):** `components/ui/input.tsx` (+"use client"), `components/ui/table.tsx`, `components/ui/tabs.tsx`, `components/ui/server-pagination.tsx`, `components/ui/onboarding-hint.tsx`, `components/admin/data-table.tsx` y `data-table.types.ts`, `components/layout/desktop-nav.tsx`, `components/layout/sidebar-user-profile.tsx`, `lib/security/csp.ts`, `app/(app)/dashboard/page.tsx`, `app/(app)/dashboard/dashboard-control-center.tsx`, `app/(app)/dashboard/dashboard-analytics-section.tsx` (nuevo), `app/(app)/combustibles/bitacora/page.tsx`, `app/(app)/prevencion/pdtp/page.tsx`, `app/(app)/admin/usuarios/user-list.tsx`, `app/(app)/admin/usuarios/user-invitations-panel.tsx`, `app/(app)/solicitudes/request-list.tsx`. Tests: `lib/__tests__/csp.test.ts`, `components/__tests__/data-table.test.tsx`.

**Sesión 2 (accionables de código restantes):** `caption` obligatoria en `data-table.types.ts`, wireada en los ~27 consumidores restantes de `DataTable` (uno o más `<DataTable>` por archivo: emergencias, brechas de competencia, acciones PDTP, permisos de trabajo, gestión del cambio, vehículos, incidentes, historial de importación de combustible, proveedores de combustible, entregas, productos, auditoría, folios, proveedores, faenas, centros de costo, órdenes de compra, catálogos de productos, catálogos PDTP, taxonomía SST, roles, rate-limit, notificaciones, trabajadores, EPP, recepción — lista completa en el diff/`git log`). Test nuevo: `components/__tests__/ui-primitives-no-literal-colors.test.ts`.

### 12.3 Verificación ejecutada

**Sesión 1:** ESLint y `tsc --noEmit` acotados a los archivos tocados (sin errores); `design-tokens-contrast` + `data-table` + `csp` tests: 52/52 passed.

**Sesión 2 (repo completo, ya sin el bloqueo de la sesión 1):**

- `tsc --noEmit` sobre todo el repo: **0 errores** (confirma que ningún consumidor de `DataTable` quedó sin `caption`).
- `npm run lint` sobre todo el repo: **0 errores**, 1 warning preexistente ajeno a esta auditoría (`bodega/actions.ts`, variable no usada).
- `npm run build` (`next build`, Turbopack): **compila limpio**, incluida `/combustibles/bitacora`; único warning es una traza de NFT ajena (`lib/services/backups.ts`), no relacionada con UI/UX.
- `npm run check:bundle-budget`: **OK**, 161 rutas, peor caso 2,42 MB / 3,00 MB.
- `npx vitest run components/__tests__/ui-primitives-no-literal-colors.test.ts`: **51/51 passed**.
- **No se ejecutó** la suite Playwright (`accessibility`, `keyboard-navigation`, `zoom-200`, `perceived-latency`, `ui-ux-audit-evidence`) ni Lighthouse: el `webServer` de Playwright usa `E2E_ALLOW_DESTRUCTIVE_RESET=true` contra una base de datos e2e compartida, y ya había un proceso `@playwright/test/cli.js test-server` corriendo en este entorno (más un `next-server` de otro usuario del sistema) — correr la suite ahora arriesgaba pisar un test run ajeno en curso. Ver nota de concurrencia.

**Nota de concurrencia (actualizada):** el trabajo no relacionado detectado en la sesión 1 (physical inventory / recepción / purchasing, migraciones `0125`-`0126`) ya no bloquea `tsc`/`lint`/`build` — parece haber terminado. Sigue habiendo evidencia de otros procesos activos en este mismo entorno (un `test-server` de Playwright y un `next-server` bajo otro usuario del sistema), por lo que operaciones destructivas como el reset e2e siguen sin ser seguras de correr sin coordinar primero.

### 12.4 Pendiente

1. **Smoke test manual del fix P0 con navegador.** El build ya compila limpio; falta levantar el server y hacer click-through de filtros/tabla de `/combustibles/bitacora` en los tres viewports para confirmar el contenido funcional (no solo que ya no crashea).
2. **Re-medir Lighthouse móvil del Dashboard** tras diferir la analítica (UIUX-002) — el objetivo de la auditoría era >75 con LCP ≤2,5 s y TBT ≤300 ms.
3. **Re-correr la suite Playwright completa** una vez coordinado con quien esté usando el `test-server`/entorno e2e compartido ahora mismo, para no pisar un run ajeno con el reset destructivo.
4. **Confirmar que Sentry recibe un evento real** bajo la CSP de producción (criterio de aceptación original) — el fix de UIUX-018 solo se verificó con tests unitarios de construcción del header, no con un envío real; requiere el dashboard de Sentry en producción.
5. **Reconsiderar `'strict-dynamic'` en `script-src`** si el chunk bloqueado (investigado en la sesión 3, ver UIUX-018) empieza a causar problemas reales de navegación — hoy es una limitación conocida y documentada, no confirmada como un blocker funcional, y se decidió explícitamente no tocar la CSP por ahora. Si se revisita: quitar `'strict-dynamic'` (deja `'self'` + nonce) es el fix más directo, a costa de esa capa extra de protección.

