# Plan de migración visual — Sidebar, Header y Mainzone

**Fecha:** 26 de julio de 2026
**Alcance:** Alinear visualmente `AppShell`, `DesktopNav`, `TopBar` y el mainzone
con el lenguaje de `referencia/` (Dashboard 6 de Efferd), **sin copiar** el
bloque ni instalar dependencias externas.
**Origen del análisis:** comparación estática de `referencia/Dashboard6.tsx`,
`referencia/components/dashboard-6/*.tsx`,
`referencia/official_efferd_components/dashboard_{1..5}/` y los archivos vivos
del shell de Chome.

Este documento **no** es un reemplazo de `PLAN_INTEGRACION_EFFERD_DASHBOARD_6.md`:
lo complementa traduciendo el "contrato visual" en tareas accionables.

---

## 0. Principios no negociables

Estas reglas vienen de `PLAN_INTEGRACION_EFFERD_DASHBOARD_6.md` §1 y de
`AGENTS.md`. Cualquier tarea que las rompa se descarta:

1. **Migración visual, no copia del bloque.** No se importa
   `@efferd/dashboard-6`, no se añade `components.json`, no se copian
   componentes.
2. **Navegación desde `modules/registry`.** Los items del sidebar siguen
   viniendo del registry de módulos, filtrados por permisos y feature toggles.
3. **TopBar conserva su contrato.** Título (vía `ShellHeaderContext`), chip de
   faena (salvo que la fase 1 decida moverlo a la sidebar), búsqueda contextual,
   notificaciones, command palette, breadcrumb, auto-hide móvil.
4. **Modo claro fijo.** No se introduce toggle dark ni clases `dark:` globales
   que dependan de un tema externo.
5. **Tokens Chome prevalecen.** Esmeralda `#065F46`, fuentes Exo/Myriad, escala
   de radios y sombras propias. Nada de `slate`, Lucide ni fuentes Geist/Outfit
   de `referencia/`.
6. **Iconografía Phosphor.** Mantener el set actual; no introducir Lucide.
7. **Contratos funcionales intactos.** RBAC, scope por faena, fuentes de datos
   reales, rutas, Server Components.

---

## 1. Análisis por zona

### A. Sidebar (`components/layout/desktop-nav.tsx` + `desktop-nav-areas.tsx`)

| ID | Referencia (Efferd) | Chome hoy | Gap | Archivo |
|----|---------------------|-----------|-----|---------|
| **A1** | Workspace switcher arriba: pill con avatar + "Efferd LLC" + `ChevronDown` (dropdown) | Sólo `BrandMark` + botón de colapsar panel | Falta un **selector de faena/empresa** en el header del panel. Hoy la faena vive como chip en el TopBar; moverla aquí como dropdown mantendría el contrato (sigue siendo selector) y liberaría espacio del header. | `desktop-nav.tsx` (header del panel, ~líneas 79–95) |
| **A2** | Lista plana de 6 ítems, sin secciones ni eyebrows | Acordeón con `AreaSection` (eyebrow uppercase + caret + Collapsible) | Decisión de producto: ¿aplanar la nav? El plan anterior dice "navegación más compuesta", así que **se mantiene el acordeón**, pero el *look* se **aplana**: el `text-eyebrow` (uppercase, tracking ancho, tenue) pasa a tipografía normal `text-xs font-medium text-text-muted`. | `desktop-nav-areas.tsx:54–89` (`AreaSection`) |
| **A3** | Activo = `bg-slate-100 font-semibold`, **sin barra izquierda** | Activo = `bg-surface-3` + barra vertical `left-0 w-0.5 bg-primary` | **Quitar la barra indicadora izquierda** (la referencia no la usa) y dejar sólo fondo sutil + peso semibold. Aplica a items de área, items hijos y al "Inicio" del rail expandido. | `desktop-nav.tsx:108–114`, `nav-rows.tsx` |
| **A4** | Íconos Lucide `weight=regular` (mismo peso siempre) | Phosphor con `weight="bold"` en activo, `regular` en inactivo | **Mantener Phosphor** (regla de Chome) pero eliminar el cambio de peso activo/inactivo para un look más uniforme y sereno. | `desktop-nav.tsx`, `desktop-nav-areas.tsx`, `nav-rows.tsx` |
| **A5** | Tarjeta "What's new" arriba del perfil (label `UPDATE`, copy, link "Learn more") | Sólo `SidebarUserProfile` en el footer | **Opcional**: tarjeta de novedades / Diffusion de comunicados internos. Sólo si se conecta a una fuente real (no copy hardcodeada). | `desktop-nav.tsx` footer del panel (~144–161) |
| **A6** | Perfil: avatar + nombre + email, sin dropdown visible | Avatar + nombre + email con `DropdownMenu` (sign out, perfil) | Chome ya es más rico que la referencia. **Mantener** sin cambios. | `sidebar-user-profile.tsx` |
| **A7** | Ancho `w-64` = **16rem** (256px) | `--sidebar-width: 14.375rem` (230px), `--sidebar-rail-width: 3.5rem` (56px) | Ajustar `--sidebar-width` a **15.5rem (248px)** para respirar como la referencia sin pasar a 16rem. | `app/globals.css` (`@theme`) |
| **A8** | Padding generoso `p-4`, items `px-3 py-2 text-sm` | Items `h-[var(--nav-item-height)] px-[10px]` (36px) | Densidad casi igual. **Mantener** sin cambios. | — |
| **A9** | Rail colapsado no existe en la referencia | Rail de 56px con flyout + tooltip | Decisión SaaS de Chome. **Mantener**. | — |

### B. Header / TopBar (`components/layout/top-bar.tsx`)

| ID | Referencia | Chome hoy | Gap | Archivo |
|----|------------|-----------|-----|---------|
| **B1** | Controls bar a la derecha del título: `Period ▾` + `Date range 📅` + `Customize` + `MoreHorizontal` (densidad `text-xs h-[30px]`) | TopBar sólo expone `header.actions` (vía PageHeader) + search + campana | Falta un **patrón "controls bar" reutilizable** (periodo + fecha + personalizar + overflow) para páginas con tendencias (dashboard, combustibles, analítica). Hoy cada página lo improvisa arriba del contenido. Crear `<ControlsBar>` que se monte vía `header.actions` y acepte `period`, `range`, `customize`, `overflow`. | `top-bar.tsx:120–160`, nuevo `components/ui/controls-bar.tsx` |
| **B2** | Título grande **dentro del main** ("Good afternoon") | Título en `TopBar` (vía `ShellHeaderContext`); `PageHeader` es `lg:sr-only` en desktop | Decisión **opuesta**. Chome eligió header sticky con título; la referencia usa título in-page. **Mantener el contrato actual** (regla 2 de `AGENTS.md` page-layout). | — |
| **B3** | Header sin búsqueda global | Search input en TopBar (`useSafeShellHeader`) | **Mantener**: la búsqueda es parte del contrato de Chome y la pide la regla 1 de page-layout. | — |
| **B4** | Header sin chip de faena, sin notificaciones | Worksite chip + `NotificationBell` | Si **A1** mueve la faena a la sidebar, eliminar el chip del TopBar. Si no, mantener. Es una decisión que se cierra en Fase 1. | `top-bar.tsx:131–144` |
| **B5** | Controles `text-xs py-1.5` (densidad baja) | TopBar `h-[3.25rem]` (52px) | Densidad razonable. Para el *controls bar* interno (B1) usar `text-xs h-[30px] rounded-md` como en la referencia. | nuevo `controls-bar.tsx` |

### C. Mainzone (`app-shell.tsx` + `components/ui/page-container.tsx`)

| ID | Referencia | Chome hoy | Gap | Archivo |
|----|------------|-----------|-----|---------|
| **C1** | Grid 12-col: 8 principal + 4 lateral derecho | `PageContainer` con anchos `wide` / `form` / `workbench` / `full` | Falta un **modo "dashboard grid"** (o un componente `<DashboardGrid main aside>`) para componer principal + lateral en desktop y una sola columna en móvil. Hoy el dashboard apila verticalmente. | `components/ui/page-container.tsx`, dashboard page |
| **C2** | Cards: `rounded-2xl p-6 border shadow-sm bg-white` | Tokens `--radius-xl:1rem`, `--shadow-card`, `--color-surface` ya definidos | Tokens alineados. Falta una **variante "card grande"** consistente (`p-6 radius-xl shadow-card`) en el `Card` del design system para que no se reimplemente disperso. | `components/ui/card.tsx` |
| **C3** | "AI Insights" + "Budget usage" como bloques editoriales compactos | Métricas en `MetricBar` y tiles accionables | **Opcional / inspiración** para una tira editorial de IA/insights en el dashboard. No prioritario y sólo si hay fuente real. | dashboard page |
| **C4** | Esquina sup-izq del pozo **no redondeada** (referencia flush al header) | `lg:rounded-tl-(--radius-shell)` (2.25rem) | Decisión de Chome (pozo blanco sobre sidebar casi-blanco). **Mantener**, o reducir a `--radius-lg` (0.75rem) si se quiere un look más plano. Opcional. | `app-shell.tsx:127` |

---

## 2. Plan de implementación

> **Estado al 2026-07-26** (implementación parcial):
> - ✅ Fase 1.1–1.4 (A7, A3, A4, A2) — aplicadas y validadas (typecheck + tests del shell en verde).
> - ⏸️ Fase 1.5 (A1 WorksiteSwitcher) — **deferida**: requiere mutar `primaryWorksiteId` en sesión/JWT y atravesar RBAC en muchos servicios (`lib/auth/rbac.ts`, `lib/auth/scope.ts`, callbacks de NextAuth). Necesita decisión de producto + server action de cambio de faena. No es sólo visual.
> - ✅ Fase 2.1 (C1 DashboardGrid) — primitivo creado en `components/ui/dashboard-grid.tsx`.
> - ✅ Fase 2.2 (C2 card `feature`) — variante añadida a `components/ui/card.tsx`.
> - ⏸️ Fase 2.3 (refactor del dashboard al grid) — **deferida**: es riesgo medio (reorganiza el dashboard operacional); conviene como PR separado y revisable.
> - ✅ Fase 3.1 (B1 ControlsBar) — primitivo creado en `components/ui/controls-bar.tsx`.
> - ⏸️ Fase 3.2 (migrar páginas a ControlsBar) — **deferida**: trabajo por-página, riesgo medio.
> - ⏸️ Fase 4 (opcionales) — fuera de este ciclo.

### Fase 1 — Shell visual (quick wins, alto impacto, bajo riesgo)

**Objetivo:** que el sidebar se vea como la referencia sin romper contratos.

| Orden | Tarea | Archivos | Riesgo | Validación |
|-------|-------|----------|--------|------------|
| 1.1 | **A7** Ajustar `--sidebar-width` a `15.5rem` (248px) | `app/globals.css` | Bajo | Visual en todas las rutas `(app)/*` |
| 1.2 | **A3** Quitar la barra indicadora izquierda (`left-0 w-0.5 bg-primary`) de items activos (Inicio, área, item hijo) | `desktop-nav.tsx`, `desktop-nav-areas.tsx`, `nav-rows.tsx` | Bajo | Snapshot visual + `aria-current="page"` sigue presente |
| 1.3 | **A4** Eliminar el cambio de peso `weight="bold"` en activo; usar `regular` siempre en Phosphor | `desktop-nav.tsx`, `desktop-nav-areas.tsx`, `nav-rows.tsx`, `mobile-nav.tsx` | Bajo | Visual + sin cambios de layout |
| 1.4 | **A2** Aplanar el eyebrow del acordeón: pasar `text-eyebrow` (uppercase + tracking) a `text-xs font-medium text-text-muted` normal | `desktop-nav-areas.tsx` | Bajo | Visual |
| 1.5 | **A1** Crear `<WorksiteSwitcher>` (dropdown con avatar + nombre + `ChevronDown`) en el header del panel, alimentado por las faenas del usuario. Decidir con producto si el chip del TopBar (B4) se elimina o se mantiene como duplicado contextual. | nuevo `components/layout/worksite-switcher.tsx`, `desktop-nav.tsx`, opcionalmente `top-bar.tsx` | Medio | Dropdown accesible, persistencia por faena, fallback si hay una sola faena |

**Cierre de fase 1:** screenshot antes/después del sidebar en `/dashboard` y en
una ruta profunda (p. ej. `/combustibles/bitacora`).

### Fase 2 — Mainzone (dashboard grid)

**Objetivo:** que el dashboard pueda componerse principal + lateral como la
referencia, sin reescribir todas las páginas.

| Orden | Tarea | Archivos | Riesgo | Validación |
|-------|-------|----------|--------|------------|
| 2.1 | **C1** Añadir un layout `<DashboardGrid>` (o un `width="dashboard"` en `PageContainer`) que produzca un grid 12-col con slot `main` (col-span-8 lg) + slot `aside` (col-span-4 lg), colapsando a 1 col en `< lg`. | nuevo `components/ui/dashboard-grid.tsx`, `page-container.tsx` | Bajo | Prueba visual + responsive en `/dashboard` prototipo |
| 2.2 | **C2** Añadir variante "card grande" (`p-6 radius-xl shadow-card`) en el `Card` del design system y migrar el dashboard a ella. | `components/ui/card.tsx`, dashboard components | Bajo | Visual + sin regresiones en otras páginas |
| 2.3 | Refactor del dashboard para usar `DashboardGrid` con `main` (KPIs + cola + actividad) y `aside` (alertas + PDTP + métricas mensuales) | `dashboard-control-center.tsx`, `app/(app)/dashboard/page.tsx` | Medio | Pruebas de `dashboard-control-center` siguen pasando |
| 2.4 | **C4 (opcional)** Si el equipo quiere look más plano, reducir `lg:rounded-tl-(--radius-shell)` a `lg:rounded-tl-(--radius-lg)`. | `app-shell.tsx:127` | Bajo | Visual |

**Cierre de fase 2:** dashboard con composición principal + lateral, responsive,
sin pérdida de datos ni permisos.

### Fase 3 — Header enriquecido (controls bar)

**Objetivo:** estandarizar el patrón "periodo + fecha + personalizar" para
páginas con tendencias, sin duplicar la búsqueda global.

| Orden | Tarea | Archivos | Riesgo | Validación |
|-------|-------|----------|--------|------------|
| 3.1 | **B1** Crear `<ControlsBar>` reutilizable con slots `period`, `range`, `customize`, `overflow`. Densidad `text-xs h-[30px] rounded-md`. Se monta vía `PageHeader.actions` (no es una segunda toolbar). | nuevo `components/ui/controls-bar.tsx` | Bajo | Story / página de prueba + atajos de teclado |
| 3.2 | Migrar `/combustibles/bitacora`, `/analitica` y `/dashboard` al `ControlsBar` (cuando tengan controles de período). | páginas correspondientes | Medio | Sin duplicar búsqueda; URL sigue siendo fuente de verdad donde ya lo es |
| 3.3 | **B4** Si en Fase 1 se movió la faena al sidebar y se decide eliminar el chip del TopBar, eliminar también `worksiteName` de `TopBar` o dejarlo como fallback cuando el sidebar esté colapsado. | `top-bar.tsx` | Bajo | Visual en sidebar colapsado + expandido |

### Fase 4 — Opcionales /Nice-to-have

| Tarea | Detalle |
|-------|---------|
| **A5** Tarjeta "What's new" en el footer del sidebar | Sólo si se conecta a una fuente real (Diffusion, comunicados internos). No hardcodear copy. |
| **C3** Tira editorial de IA/insights en el dashboard | Inspiración visual; requiere fuente real (métricas calculadas, no LLM inventando). |
| Modo dark como trabajo futuro (no en este plan) | La referencia usa `dark:`; Chome es light fijo. Si se quiere, es un proyecto aparte con tokens propios. |

---

## 3. Archivos que se tocarán (resumen)

### Nuevos

- `components/layout/worksite-switcher.tsx` (Fase 1)
- `components/ui/dashboard-grid.tsx` (Fase 2)
- `components/ui/controls-bar.tsx` (Fase 3)

### Modificados

- `app/globals.css` — `--sidebar-width`, opcionalmente `--radius-shell`
- `components/layout/desktop-nav.tsx` — header del panel, footer, items activos
- `components/layout/desktop-nav-areas.tsx` — eyebrow del acordeón, items activos
- `components/layout/nav-rows.tsx` — items activos, peso de ícono
- `components/layout/mobile-nav.tsx` — peso de ícono (consistencia)
- `components/layout/top-bar.tsx` — chip de faena (si se mueve), integración con `ControlsBar`
- `components/ui/page-container.tsx` — nuevo `width="dashboard"` (opcional)
- `components/ui/card.tsx` — variante "card grande"
- `app/(app)/dashboard/page.tsx` + `dashboard-control-center.tsx` — refactor grid

### Sin tocar (contratos intactos)

- `modules/registry.ts`, `modules/permissions.ts`, manifest por módulo
- `lib/auth/*`, `lib/services/*`
- `app/(app)/layout.tsx` (RBAC, scope, feature toggles)
- `command-palette.tsx`, `notification-bell.tsx`
- Rutas y Server Components

---

## 4. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Mover la faena al sidebar rompe el contrato del `TopBar` actual | Mantener `worksiteName` en `TopBarProps` como opcional; si el sidebar está colapsado, el chip vuelve al TopBar. Documentar la decisión en `AGENTS.md` si se confirma. |
| Quitar la barra indicadora activa reduce affordance | Compensar con fondo más marcado (`bg-surface-3`) + `font-semibold` + ícono en color primario. Verificar contraste WCAG. |
| Aplanar el eyebrow del acordeón confunde jerarquía | Mantener separación vertical entre áreas y un caret claro. Test con usuarios si hay duda. |
| `DashboardGrid` introduce un layout nuevo que cada página usa distinto | Definir el componente con slots tipados y ejemplos en `STYLING.md`; no permitir variantes ad-hoc. |
| `ControlsBar` se convierte en segunda toolbar y rompe la regla 5 de page-layout | Forzar montaje vía `PageHeader.actions`; nunca como toolbar inline dentro del contenido. Documentar en `AGENTS.md`. |
| Modo dark entra de rebote desde clases `dark:` copiadas | Lint: prohibir `dark:` en archivos nuevos salvo excepciones documentadas. |

---

## 5. Criterios de aceptación

La migración visual se considera completa cuando:

1. El sidebar expandido muestra selector de faena en el header, navegación
   acordeón con eyebrow aplanada, items activos sin barra izquierda y perfil en
   el footer — todo coherente con el lenguaje de `referencia/`.
2. El dashboard se compone en grid principal + lateral en desktop y colapsa a
   una columna en móvil sin perder datos ni permisos.
3. Existe un `ControlsBar` reutilizable usado por las páginas con tendencias,
   montado vía `PageHeader.actions`, sin duplicar la búsqueda global.
4. Todas las pruebas existentes (`dashboard-control-center`, `top-bar`,
   `sidebar-user-profile`, design-tokens-contrast) siguen pasando.
5. No se ha instalado ningún paquete externo nuevo; no se ha añadido
   `components.json`; no se han copiado componentes de `referencia/`.
6. `AGENTS.md` se actualiza con las nuevas reglas (worksite switcher,
   `ControlsBar`, `DashboardGrid`) si procede.

---

## 6. Fuente de la referencia

- `referencia/Dashboard6.tsx` — shell de tres zonas (sidebar + controls + grid)
- `referencia/components/dashboard-6/{stats,mrr-chart,right-cards}.tsx` —
  composición de tarjetas
- `referencia/official_efferd_components/dashboard_{1..5}/` — variantes de
  grilla, bordes y densidad
- `referencia/index.html` + `referencia/assets/css/` — captura estática,
  fuentes embebidas y feedback puntual en gráficos (no se importan)

Estos archivos son **muestra de composición visual**, no fuente de datos,
navegación ni arquitectura. Cualquier coincidencia textual con la demo
financiera es coincidencia: Chome conserva su dominio operacional.
