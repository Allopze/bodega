# Plan de implementación — Inicio como tablero por vistas

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea.
> Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** convertir `/dashboard` (Inicio) de una página larga que apila seis
dominios en un tablero con un selector arriba que muestra **una vista a la vez**
—Resumen, Mi trabajo, y un dominio por pestaña, incluido un dominio Finanzas
nuevo—, con gráficos shadcn y la estética de la referencia.

**Arquitectura:** el selector es una tercera dimensión de la URL (`?vista=`) junto
a `?faena=` y `?periodo=`, resuelta en el Server Component. Sólo se consulta la
vista activa: los seis `Promise.all` de dominio que hoy corren siempre pasan a
correr uno. La cola de trabajo, que hoy ocupa la primera pantalla, se muda a su
propia pestaña "Mi trabajo". Se añade el dominio Finanzas absorbiendo las cifras
de dinero que hoy viven repartidas entre Adquisiciones (gasto, proveedores) y
Flota (combustible, deuda), más la facturación de venta que hoy no aparece en el
tablero en absoluto.

**Stack:** Next.js App Router (Server Components + Suspense por vista), React 19,
Tailwind v4 con tokens OKLCH en `app/globals.css`, recharts 3.9 vía el wrapper
shadcn `components/ui/chart.tsx`, Drizzle, vitest + Playwright.

## Restricciones globales

- **Español de Chile** en todo texto de usuario, comentario y nombre de test.
  Los identificadores de código en inglés, como en el resto del repo.
- **Sin dark mode.** `color-scheme: light`. Nunca escribas variantes `dark:`.
- **Colores sólo por token.** `var(--color-*)` de `app/globals.css`; los de
  gráfico desde `CHART_COLORS`/`CHART_SERIES` en `lib/chart-palette.ts`. Cero
  literales hex nuevos.
- **`--color-signal` (naranja) está reservado a estados pendientes.** Nunca para
  acciones ni decoración. Ver `DESIGN.md`.
- **Iconos Phosphor**, no Lucide. En Server Components importa desde
  `@phosphor-icons/react/dist/ssr`; en Client Components desde
  `@phosphor-icons/react`.
- **Ningún `import` estático de `dashboard-charts.tsx` fuera de
  `dashboard-domain-charts.tsx`.** Recharts pesa ~168 kB y ya se coló una vez en
  el chunk inicial (UIUX-002: 1281 kB → 816 kB al arreglarlo). Todo gráfico pasa
  por `lazyChart()` con `ssr: false` y `ChartErrorBoundary`.
- **Las funciones no cruzan la frontera RSC.** Un Server Component no puede pasar
  `formatCLP` a un Client Component: usa discriminadores (`format="clp"`) como ya
  hace `CompositionDonutChart`.
- **Zona horaria Chile.** Fechas del "hoy" vía `chileDateParts()` /
  `todayInChile()`, nunca `new Date().getFullYear()` a secas.
- **El permiso es el techo.** Elegir una vista o una faena nunca amplía lo que se
  ve: `intersectWorksiteScope` y los `can(session, …)` siguen mandando.
- **Toasts** desde `@/lib/toast`, no de `sonner` (no aplica a este plan, pero
  vale si tocas algo que los use).
- Comandos: `npm run typecheck`, `npm run lint`, `npm test -- <ruta>`,
  `npm run test:e2e`. Los e2e necesitan `PGHOST=/var/run/postgresql`.

## Decisiones tomadas (no re-litigar)

1. **La cola de trabajo va a su propia pestaña "Mi trabajo"**, completa, tal como
   está hoy. No se recorta ni se resume.
2. **Inicio abre en "Resumen"**: una vista ejecutiva transversal, no el primer
   dominio autorizado.
3. **Finanzas = toda la plata**: facturación de venta (`/facturacion`) + gasto en
   OC + proveedores + costo de combustible + deuda vencida. Adquisiciones y Flota
   ceden sus cifras de dinero.
4. **AGENTS.md §A1 se relaja** para el tablero: hasta 8 tiles por vista, en filas
   rotuladas. El resto de las pantallas conserva el tope de 4.

## Estructura de archivos

**Nuevos**

| Archivo | Responsabilidad |
|---|---|
| `app/(app)/dashboard/dashboard-views.ts` | Catálogo de vistas, gating por permiso, orden, parseo del valor de la URL. Lógica pura. |
| `app/(app)/dashboard/dashboard-views.test.ts` | Tests de lo anterior. |
| `app/(app)/dashboard/dashboard-view-tabs.tsx` | El selector. Server Component de puros `<Link>`. |
| `app/(app)/dashboard/dashboard-header.tsx` | Saludo + alcance + "actualizado". Extraído del Control Center para que viva sobre las pestañas. |
| `app/(app)/dashboard/views/resumen-view.tsx` | Vista Resumen: KPIs de ranura, alertas, gauge PDTP, tendencia, flujo, actividad. |
| `app/(app)/dashboard/views/trabajo-view.tsx` | Vista Mi trabajo: la cola completa con sus atajos y su orden. |
| `app/(app)/dashboard/sections/finance-section.tsx` | Sección del dominio Finanzas. |
| `components/ui/hero-kpi-card.tsx` | Tile hero relleno en `--color-primary-deep`. |

**Modificados**

| Archivo | Cambio |
|---|---|
| `app/(app)/dashboard/dashboard-scope.ts` | `view` entra al scope; `dashboardScopeHref` conserva las tres dimensiones. |
| `app/(app)/dashboard/dashboard-domains.ts` | Nuevo dominio `finanzas`; `shortTitle` para las pestañas. |
| `app/(app)/dashboard/page.tsx` | Deja de orquestar todo: resuelve vista, pinta cabecera + pestañas, delega en una vista. |
| `app/(app)/dashboard/dashboard-control-center.tsx` | Pierde la cabecera (a `dashboard-header.tsx`) y la cola (a `trabajo-view.tsx`). Queda como el cuerpo del Resumen. |
| `app/(app)/dashboard/dashboard-domain-shell.tsx` | `DomainIndex` se elimina (lo reemplazan las pestañas); `DomainSection` pasa a grilla bento y acepta filas de KPI rotuladas. |
| `app/(app)/dashboard/dashboard-domain-sections.tsx` | Adquisiciones y Flota ceden sus cifras de dinero; el orquestador pasa a exportar una sección por clave. |
| `app/(app)/dashboard/dashboard-charts.tsx` | `RadialGaugeChart` y `BillingFlowChart`. |
| `app/(app)/dashboard/dashboard-domain-charts.tsx` | Envoltorios diferidos de los dos anteriores. |
| `app/(app)/facturacion/money-stat.tsx` | Añade `data-kpi-card` para que el conteo de densidad lo vea. |
| `AGENTS.md` | §A1 relajada para el tablero. |
| `e2e/dashboard.spec.ts`, `e2e/densidad-kpi.spec.ts` | Al modelo de vistas. |

---

# Fase 1 — El selector de vistas

## Tarea 1: Catálogo de vistas

**Archivos:**
- Crear: `app/(app)/dashboard/dashboard-views.ts`
- Crear: `app/(app)/dashboard/dashboard-views.test.ts`

**Interfaces:**
- Consume: `DASHBOARD_DOMAIN_KEYS`, `orderDashboardDomains`, `DashboardDomain`,
  `DashboardDomainKey` de `./dashboard-domains`.
- Produce: `DashboardViewKey`, `DashboardView`, `DEFAULT_DASHBOARD_VIEW`,
  `availableDashboardViews(permissions: readonly string[]): DashboardView[]`,
  `parseDashboardView(raw: string | undefined, available: readonly DashboardView[]): DashboardViewKey`,
  `isDomainView(view: DashboardViewKey): view is DashboardDomainKey`.

- [ ] **Paso 1: escribe el test que falla**

Crea `app/(app)/dashboard/dashboard-views.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  availableDashboardViews,
  DEFAULT_DASHBOARD_VIEW,
  isDomainView,
  parseDashboardView,
} from "./dashboard-views"

/**
 * Las vistas son la tercera dimensión de la URL, junto a faena y período. El
 * gating es el mismo de los dominios: sin permiso, la pestaña no existe — no
 * basta con esconder su contenido, porque el `?vista=` es escribible a mano.
 */

const JEFATURA = [
  "requests:view_all", "purchasing:view", "approvals:approve", "receiving:view",
  "warehouse:view_stock", "deliveries:view", "operations:view_work",
  "prevention:pdtp:view", "prevention:incidents:view", "prevention:capa:view",
  "combustibles:view", "flota:view", "mantenciones:view",
  "prevention:docs:view", "ppa:view",
]

const SOLICITANTE = ["requests:view_own"]

describe("availableDashboardViews", () => {
  it("Resumen siempre existe, aunque el rol no tenga ningún dominio", () => {
    const keys = availableDashboardViews([]).map((view) => view.key)
    expect(keys).toEqual(["resumen"])
  })

  it("Mi trabajo aparece sólo con `operations:view_work`", () => {
    expect(availableDashboardViews(SOLICITANTE).map((v) => v.key)).not.toContain("trabajo")
    expect(availableDashboardViews([...SOLICITANTE, "operations:view_work"]).map((v) => v.key))
      .toContain("trabajo")
  })

  it("los dominios llegan en el orden que decide el perfil de permisos", () => {
    const keys = availableDashboardViews(JEFATURA).map((view) => view.key)
    expect(keys.slice(0, 2)).toEqual(["resumen", "trabajo"])
    // `purchasing:view` manda la plata al frente.
    expect(keys[2]).toBe("adquisiciones")
  })

  it("cada pestaña declara un rótulo corto: los títulos largos no caben en la barra", () => {
    for (const view of availableDashboardViews(JEFATURA)) {
      expect(view.title.length).toBeLessThanOrEqual(16)
    }
  })
})

describe("parseDashboardView", () => {
  const available = availableDashboardViews(JEFATURA)

  it("acepta una vista autorizada", () => {
    expect(parseDashboardView("adquisiciones", available)).toBe("adquisiciones")
  })

  it("una vista desconocida cae al Resumen en vez de dejar la página en blanco", () => {
    expect(parseDashboardView("contabilidad", available)).toBe(DEFAULT_DASHBOARD_VIEW)
  })

  it("una vista real pero NO autorizada cae al Resumen: el `?vista=` es escribible a mano", () => {
    const solicitante = availableDashboardViews(SOLICITANTE)
    expect(parseDashboardView("prevencion", solicitante)).toBe("resumen")
  })

  it("sin parámetro, Resumen", () => {
    expect(parseDashboardView(undefined, available)).toBe("resumen")
  })
})

describe("isDomainView", () => {
  it("separa las dos vistas propias de las de dominio", () => {
    expect(isDomainView("resumen")).toBe(false)
    expect(isDomainView("trabajo")).toBe(false)
    expect(isDomainView("finanzas")).toBe(true)
  })
})
```

- [ ] **Paso 2: corre el test y confirma que falla**

```bash
npm test -- "app/(app)/dashboard/dashboard-views.test.ts"
```

Esperado: FAIL — `Failed to resolve import "./dashboard-views"`.

- [ ] **Paso 3: implementa el catálogo**

Crea `app/(app)/dashboard/dashboard-views.ts`:

```ts
import type { Permission } from "@/modules/permissions"
import {
  DASHBOARD_DOMAIN_KEYS,
  orderDashboardDomains,
  type DashboardDomainKey,
} from "./dashboard-domains"

/**
 * Las vistas del tablero: **una se pinta a la vez**.
 *
 * Reemplazan a las seis secciones apiladas, que sumaban ~8.600 px de scroll en
 * 1920 y ~12.700 px en móvil, y que además consultaban las seis en paralelo cada
 * carga (sólo Adquisiciones dispara ~20 consultas). Con el selector se consulta
 * la vista activa y nada más.
 *
 * `resumen` y `trabajo` son propias; el resto son los dominios de
 * `dashboard-domains.ts`, así que el gating y el orden se heredan de allí en vez
 * de duplicarse.
 */

export const DASHBOARD_VIEW_KEYS = ["resumen", "trabajo", ...DASHBOARD_DOMAIN_KEYS] as const

export type DashboardViewKey = (typeof DASHBOARD_VIEW_KEYS)[number]

export const DEFAULT_DASHBOARD_VIEW = "resumen" satisfies DashboardViewKey

export interface DashboardView {
  key: DashboardViewKey
  /** Rótulo de la pestaña: corto, porque la barra scrollea horizontalmente. */
  title: string
  /** Sin **ninguno** de estos permisos la vista no existe. Vacío = siempre. */
  permissions: readonly Permission[]
}

const RESUMEN: DashboardView = { key: "resumen", title: "Resumen", permissions: [] }

/**
 * `operations:view_work` es el permiso que ya gobierna `/pendientes` y la cola
 * operacional (`modules/operations/manifest.ts`). Sin él la pestaña mostraría
 * una tabla vacía con un contador en cero.
 */
const TRABAJO: DashboardView = { key: "trabajo", title: "Mi trabajo", permissions: ["operations:view_work"] }

export function availableDashboardViews(permissions: readonly string[]): DashboardView[] {
  const granted = new Set(permissions)
  const views: DashboardView[] = [RESUMEN]

  if (TRABAJO.permissions.some((permission) => granted.has(permission))) views.push(TRABAJO)

  for (const domain of orderDashboardDomains(permissions)) {
    views.push({ key: domain.key, title: domain.shortTitle, permissions: domain.permissions })
  }

  return views
}

/**
 * Un `?vista=` que el rol no tiene autorizado cae al Resumen.
 *
 * No es una barrera de seguridad —cada consulta sigue gateada por su permiso—
 * sino de legibilidad: sin esto, escribir `?vista=finanzas` sin `billing:view`
 * pintaba una vista de ceros indistinguible de "no hay datos".
 */
export function parseDashboardView(
  raw: string | undefined,
  available: readonly DashboardView[],
): DashboardViewKey {
  return available.some((view) => view.key === raw)
    ? (raw as DashboardViewKey)
    : DEFAULT_DASHBOARD_VIEW
}

/** Discrimina las dos vistas propias de las que delegan en una sección de dominio. */
export function isDomainView(view: DashboardViewKey): view is DashboardDomainKey {
  return view !== "resumen" && view !== "trabajo"
}
```

- [ ] **Paso 4: añade `shortTitle` a los dominios**

En `app/(app)/dashboard/dashboard-domains.ts`, agrega el campo a la interfaz,
justo bajo `title`:

```ts
export interface DashboardDomain {
  key: DashboardDomainKey
  title: string
  /**
   * Rótulo de la pestaña. `title` no sirve: "Control preventivo en terreno" y
   * "Cumplimiento y gobernanza" empujaban la barra a scroll horizontal ya en el
   * primer render a 1366.
   */
  shortTitle: string
  anchor: string
  permissions: readonly Permission[]
}
```

Y añade el valor a cada entrada de `DASHBOARD_DOMAINS`:

```ts
  adquisiciones: { …, shortTitle: "Adquisiciones", … },
  bodega:        { …, shortTitle: "Bodega", … },
  prevencion:    { …, shortTitle: "Prevención", … },
  flota:         { …, shortTitle: "Flota", … },
  terreno:       { …, shortTitle: "Terreno", … },
  gobernanza:    { …, shortTitle: "Gobernanza", … },
```

- [ ] **Paso 5: corre los tests y confirma que pasan**

```bash
npm test -- "app/(app)/dashboard/dashboard-views.test.ts" "app/(app)/dashboard/dashboard-domains.test.ts"
npm run typecheck
```

Esperado: PASS en ambos archivos, typecheck limpio.

- [ ] **Paso 6: commit**

```bash
git add "app/(app)/dashboard/dashboard-views.ts" "app/(app)/dashboard/dashboard-views.test.ts" "app/(app)/dashboard/dashboard-domains.ts"
git commit -m "feat(dashboard): catalogo de vistas del tablero con gating por permiso"
```

---

## Tarea 2: `vista` entra a la URL

**Archivos:**
- Modificar: `app/(app)/dashboard/dashboard-scope.ts`
- Modificar: `app/(app)/dashboard/dashboard-scope.test.ts`

**Interfaces:**
- Consume: `DashboardViewKey`, `DEFAULT_DASHBOARD_VIEW`, `parseDashboardView`,
  `DashboardView` de `./dashboard-views` (Tarea 1).
- Produce: `DashboardScope` gana el campo `view: DashboardViewKey`;
  `parseDashboardScope(searchParams, authorizedWorksites, availableViews)` toma
  un tercer argumento; `dashboardScopeHref(scope, patch)` acepta
  `patch.view`.

- [ ] **Paso 1: escribe los tests que fallan**

Añade al final de `app/(app)/dashboard/dashboard-scope.test.ts`:

```ts
import { availableDashboardViews } from "./dashboard-views"

/**
 * La vista es la tercera dimensión de la URL. Vive junto a faena y período por
 * la misma razón que ellas: reencuadra consultas de **servidor**, y un Server
 * Component sólo reconsulta si el valor viaja en la URL.
 */
describe("la vista viaja en la URL", () => {
  const VIEWS = availableDashboardViews([
    "purchasing:view", "operations:view_work", "prevention:pdtp:view", "billing:view",
  ])

  it("lee `?vista=` cuando el rol la tiene autorizada", () => {
    expect(parseDashboardScope({ vista: "finanzas" }, WORKSITES, VIEWS).view).toBe("finanzas")
  })

  it("una vista no autorizada cae al Resumen sin tocar faena ni período", () => {
    const scope = parseDashboardScope(
      { vista: "gobernanza", faena: "ws-sur", periodo: "anio" }, WORKSITES, VIEWS,
    )
    expect(scope.view).toBe("resumen")
    expect(scope.worksiteId).toBe("ws-sur")
    expect(scope.period).toBe("anio")
  })

  it("cambiar de vista conserva faena y período: el alcance no se reinicia al navegar", () => {
    const scope = parseDashboardScope(
      { vista: "resumen", faena: "ws-sur", periodo: "anio" }, WORKSITES, VIEWS,
    )
    expect(dashboardScopeHref(scope, { view: "finanzas" }))
      .toBe("/dashboard?vista=finanzas&faena=ws-sur&periodo=anio")
  })

  it("cambiar de faena conserva la vista", () => {
    const scope = parseDashboardScope({ vista: "flota" }, WORKSITES, VIEWS)
    expect(dashboardScopeHref(scope, { worksiteId: "ws-norte" }))
      .toBe("/dashboard?vista=flota&faena=ws-norte")
  })

  it("el Resumen es el defecto y no ensucia la URL", () => {
    const scope = parseDashboardScope({}, WORKSITES, VIEWS)
    expect(scope.view).toBe("resumen")
    expect(dashboardScopeHref(scope, {})).toBe("/dashboard")
  })
})
```

Actualiza además las llamadas existentes de `parseDashboardScope` en ese archivo
para pasar el tercer argumento; declara el catálogo una vez arriba del `describe`
original:

```ts
const ALL_VIEWS = availableDashboardViews([
  "purchasing:view", "operations:view_work", "prevention:pdtp:view", "billing:view",
])
```

y reemplaza cada `parseDashboardScope(X, WORKSITES)` por
`parseDashboardScope(X, WORKSITES, ALL_VIEWS)`. En `dashboardScopeHref` los
objetos `base`/`withWorksite` literales necesitan el campo nuevo: añádeles
`view: "resumen"`.

- [ ] **Paso 2: corre el test y confirma que falla**

```bash
npm test -- "app/(app)/dashboard/dashboard-scope.test.ts"
```

Esperado: FAIL — `Expected 2 arguments, but got 3` en typecheck y
`expected undefined to be 'finanzas'` en runtime.

- [ ] **Paso 3: implementa**

En `app/(app)/dashboard/dashboard-scope.ts`:

```ts
import {
  DEFAULT_DASHBOARD_VIEW,
  parseDashboardView,
  type DashboardView,
  type DashboardViewKey,
} from "./dashboard-views"
```

Añade el campo a la interfaz:

```ts
export interface DashboardScope {
  /** Faena elegida, o `"all"` para todas las autorizadas. */
  worksiteId: string | typeof ALL_WORKSITES
  period: OperationalPeriodSpan
  /** Nombre de la faena elegida; `null` con `"all"`. Para rótulos. */
  worksiteName: string | null
  /**
   * Vista activa. Vive en el mismo objeto que faena y período porque es lo que
   * la URL dice, y porque todo enlace del tablero debe conservar las tres: sin
   * esto, cambiar de faena te devolvía al Resumen.
   */
  view: DashboardViewKey
}

export interface DashboardScopeSearchParams {
  faena?: string | string[]
  periodo?: string | string[]
  vista?: string | string[]
}
```

En `parseDashboardScope`, añade el parámetro y el campo al retorno:

```ts
export function parseDashboardScope(
  searchParams: DashboardScopeSearchParams,
  authorizedWorksites: ReadonlyArray<{ id: string; name: string }>,
  availableViews: readonly DashboardView[],
): DashboardScope {
  const rawPeriod = firstValue(searchParams.periodo)
  const period = isPeriod(rawPeriod) ? rawPeriod : DEFAULT_DASHBOARD_PERIOD

  const rawWorksite = firstValue(searchParams.faena)
  const match = rawWorksite && rawWorksite !== ALL_WORKSITES
    ? authorizedWorksites.find((worksite) => worksite.id === rawWorksite)
    : undefined

  return {
    worksiteId: match?.id ?? ALL_WORKSITES,
    worksiteName: match?.name ?? null,
    period,
    view: parseDashboardView(firstValue(searchParams.vista), availableViews),
  }
}
```

Y reemplaza `dashboardScopeHref` entero:

```ts
/** Href que conserva el alcance completo y cambia sólo lo que el patch pide. */
export function dashboardScopeHref(
  scope: DashboardScope,
  patch: Partial<Pick<DashboardScope, "worksiteId" | "period" | "view">>,
) {
  const worksiteId = patch.worksiteId ?? scope.worksiteId
  const period = patch.period ?? scope.period
  const view = patch.view ?? scope.view
  const params = new URLSearchParams()
  // `vista` primero: es lo que el usuario acaba de elegir y lo que verá en la
  // barra de direcciones si copia el enlace.
  if (view !== DEFAULT_DASHBOARD_VIEW) params.set("vista", view)
  if (worksiteId !== ALL_WORKSITES) params.set("faena", worksiteId)
  if (period !== DEFAULT_DASHBOARD_PERIOD) params.set("periodo", period)
  const query = params.toString()
  return query ? `/dashboard?${query}` : "/dashboard"
}
```

- [ ] **Paso 4: corre los tests y confirma que pasan**

```bash
npm test -- "app/(app)/dashboard/"
npm run typecheck
```

Esperado: los tests de scope y views PASAN. `typecheck` **falla todavía** en
`page.tsx` y `dashboard-metrics-slots.test.ts` porque `parseDashboardScope` ahora
pide tres argumentos y `DashboardScope` tiene un campo más — se arreglan en la
Tarea 4. Anota los errores y sigue.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/dashboard/dashboard-scope.ts" "app/(app)/dashboard/dashboard-scope.test.ts"
git commit -m "feat(dashboard): la vista activa viaja en la URL junto a faena y periodo"
```

---

## Tarea 3: La barra de pestañas y la cabecera

**Archivos:**
- Crear: `app/(app)/dashboard/dashboard-view-tabs.tsx`
- Crear: `app/(app)/dashboard/dashboard-header.tsx`
- Modificar: `app/(app)/dashboard/dashboard-domain-shell.tsx` (elimina `DomainIndex`)

**Interfaces:**
- Consume: `DashboardView` (Tarea 1), `DashboardScope` + `dashboardScopeHref`
  (Tarea 2), `DashboardScopeControls` (existente).
- Produce: `<DashboardViewTabs views scope workCount />` y
  `<DashboardHeader firstName summary contextLabel refreshedAt scope worksiteOptions />`.

- [ ] **Paso 1: crea la barra de pestañas**

Crea `app/(app)/dashboard/dashboard-view-tabs.tsx`:

```tsx
import Link from "next/link"
import { cn } from "@/lib/utils"
import { dashboardScopeHref, type DashboardScope } from "./dashboard-scope"
import type { DashboardView } from "./dashboard-views"

/**
 * El selector del tablero: **qué se quiere mirar**.
 *
 * Reemplaza a `DomainIndex`, que eran anclas `#dominio-*` sobre una página que
 * ya tenía las seis secciones montadas: navegaba con scroll, no conmutaba nada.
 * Estas son `<Link>` a `?vista=`, así que cada una es un render de servidor con
 * sus propias consultas y ninguna otra.
 *
 * `top-14` = alto de la TopBar (`h-[3.5rem]`), que es sticky en el mismo
 * contenedor de scroll con `z-10`. Con `top-0` la barra se pegaba **encima** del
 * título (I-05, auditoría 2026-08-05); `z-5 < z-10` deja ganar a la TopBar opaca
 * en los anchos donde se superponen.
 */
export function DashboardViewTabs({
  views,
  scope,
  workCount,
}: {
  views: DashboardView[]
  scope: DashboardScope
  /** Total de la cola, para la insignia de "Mi trabajo". `null` la omite. */
  workCount: number | null
}) {
  // Una sola vista no es un selector: es una etiqueta.
  if (views.length < 2) return null

  return (
    <nav
      aria-label="Vistas del tablero"
      className={cn(
        "sticky top-14 z-5 -mx-1 mb-5 flex gap-1 overflow-x-auto px-1",
        "border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur",
      )}
    >
      {views.map((view) => {
        const active = view.key === scope.view
        return (
          <Link
            key={view.key}
            href={dashboardScopeHref(scope, { view: view.key })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors",
              // Subrayado como pseudo-elemento y no como `border-b`: así no
              // desplaza medio píxel el texto al activarse.
              "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
              active
                ? "text-[var(--color-text)] after:bg-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] after:bg-transparent",
            )}
          >
            {view.title}
            {view.key === "trabajo" && workCount !== null && workCount > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                {workCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Paso 2: extrae la cabecera del Control Center**

Crea `app/(app)/dashboard/dashboard-header.tsx` con el bloque `<header>` que hoy
vive en `dashboard-control-center.tsx:229-248`, más su función auxiliar:

```tsx
import { formatDateTime } from "@/lib/utils"
import { DashboardScopeControls } from "./dashboard-scope-controls"
import type { DashboardScope } from "./dashboard-scope"

/**
 * Saludo + alcance global. Vive **sobre** las pestañas porque la faena y el
 * período reencuadran todas las vistas, no sólo la activa: bajarlos dentro de
 * una vista sugeriría que sólo aplican ahí.
 */
export function DashboardHeader({
  firstName,
  summary,
  contextLabel,
  refreshedAt,
  scope,
  worksiteOptions,
}: {
  firstName: string
  /** Frase del saludo, ya construida en el servidor. */
  summary: string
  contextLabel: string
  refreshedAt: string
  scope: DashboardScope
  worksiteOptions: Array<{ id: string; name: string }>
}) {
  return (
    <header className="border-b border-[var(--color-border)] pb-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {/* Saludo, no encabezado: el `<h1>` de la página lo emite PageHeader y
              tener dos competía en el árbol de accesibilidad (L-01). */}
          <p className="text-3xl font-bold tracking-tight text-[var(--color-text)]">Hola, {firstName}</p>
          <p className="mt-1.5 max-w-[70ch] text-sm text-[var(--color-text-muted)]">{summary}</p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <DashboardScopeControls scope={scope} worksites={worksiteOptions} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-subtle)]">
            <span className="font-medium text-[var(--color-text-muted)]">{contextLabel}</span>
            <span aria-hidden>·</span>
            <time dateTime={refreshedAt}>Actualizado {formatDateTime(refreshedAt)}</time>
          </div>
        </div>
      </div>
    </header>
  )
}

/**
 * El saludo declara **una** cifra: el total de la cola.
 *
 * Antes enumeraba total, críticas, vencidas y entregas — y cada una de esas tres
 * ya vivía en su chip de atajo y en su tarjeta de alerta. La regla A5 lo prohíbe
 * y el detalle sigue a un clic.
 */
export function buildOperationalSummary(total: number, worksiteName: string | null) {
  const where = worksiteName ? ` en ${worksiteName}` : ""
  if (total === 0) return `No tienes acciones pendientes${where}.`
  return `Tienes ${total} tarea${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"}${where}.`
}
```

- [ ] **Paso 3: elimina `DomainIndex`**

En `app/(app)/dashboard/dashboard-domain-shell.tsx`, borra la función
`DomainIndex` completa (líneas 7-52, incluido su bloque de comentario) y los
imports que quedan huérfanos (`Link` de `next/link`). Deja intactas
`DomainSection` y `DomainSectionFallback`.

- [ ] **Paso 4: verifica que compila aislado**

```bash
npm run lint -- "app/(app)/dashboard/dashboard-view-tabs.tsx" "app/(app)/dashboard/dashboard-header.tsx"
```

Esperado: sin errores. `typecheck` sigue rojo en `page.tsx` y en
`dashboard-domain-sections.tsx` (importa `DomainIndex`): se cierra en la Tarea 4.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/dashboard/dashboard-view-tabs.tsx" "app/(app)/dashboard/dashboard-header.tsx" "app/(app)/dashboard/dashboard-domain-shell.tsx"
git commit -m "feat(dashboard): barra de pestanas de vista y cabecera extraida"
```

---

## Tarea 4: `page.tsx` renderiza una vista a la vez

Es la tarea grande: `page.tsx` deja de consultar los trece servicios siempre y
pasa a delegar en la vista activa. Al final de esta tarea el tablero funciona
completo con las vistas existentes; Finanzas y el bento llegan después.

**Archivos:**
- Crear: `app/(app)/dashboard/views/resumen-view.tsx`
- Crear: `app/(app)/dashboard/views/trabajo-view.tsx`
- Modificar: `app/(app)/dashboard/page.tsx`
- Modificar: `app/(app)/dashboard/dashboard-control-center.tsx`
- Modificar: `app/(app)/dashboard/dashboard-domain-sections.tsx`
- Modificar: `app/(app)/dashboard/dashboard-metrics-slots.test.ts`
- Modificar: `app/(app)/dashboard/dashboard-control-center.test.tsx`

**Interfaces:**
- Consume: todo lo de las Tareas 1-3.
- Produce, con estas firmas exactas (las usa `page.tsx` en el paso 5):

```tsx
// views/resumen-view.tsx — Server Component async
export interface ResumenViewProps {
  session: Session
  scope: DashboardScope
  worksiteScope: WorksiteScope
  pdtpScope: string[] | "all"
  worksiteIds: string[]
  currentYear: number
  /** Total de la cola, ya consultado por la página para la cabecera. */
  queueTotal: number
  /** Resumen de la cola: alimenta la ranura de trabajo y las alertas. */
  queueSummary: OperationalQueueResult["summary"]
  refreshedAt: string
}
export async function ResumenView(props: ResumenViewProps): Promise<JSX.Element>

// views/trabajo-view.tsx — Client Component
export function TrabajoView(props: {
  tasks: DashboardTask[]
  queueSummary: { total: number; critical: number; overdue: number; deliveries: number }
  queueShortcuts: QueueShortcut[]
  scope: DashboardScope
  canAssign: boolean
  refreshedAt: string
}): JSX.Element
export type DashboardTask = WorkTask & { operationalItem?: OperationalWorkItem }
export interface QueueShortcut { key: string; label: string; count: number; href: string }
```

  - `dashboard-domain-sections.tsx` exporta `SECTION_BY_DOMAIN` y
    `<DashboardDomainSection domain={key} {...props} />` en vez de
    `<DashboardDomainSections />`.
  - `DomainSectionsProps` **pierde** `worksitesBreakdown` y `pendingApprovals`:
    los consumía sólo Adquisiciones y salían de `getDashboardData`, que ahora se
    llama dentro de esa sección y de Finanzas.
  - `buildOperationalMetrics`, `buildOperationalAlerts` y `buildQueueShortcuts`
    se mudan de `page.tsx` a `views/resumen-view.tsx` **con la misma firma y el
    mismo nombre**; `page.tsx` las importa desde ahí.

- [ ] **Paso 1: mueve la cola a su vista**

Crea `app/(app)/dashboard/views/trabajo-view.tsx`. Corta de
`dashboard-control-center.tsx` el `<section id="cola-de-trabajo">` completo
(líneas 259-352) junto con `WorkQueueRow`, `FilterSelect`, `relativeAge`,
`MODULE_META`, `MODULE_FALLBACK`, `moduleMeta`, `PRIORITY_RANK`, `SORT_OPTIONS`,
`FILTERS_STORAGE_KEY`, el tipo `SortOption` y los dos `useEffect` de
`sessionStorage`. El componente resultante:

```tsx
"use client"

import * as React from "react"
// …los mismos imports que hoy usan la cola: Link, iconos Phosphor,
// useSafeShellHeader, Badge, Button, EmptyState, PriorityBadge, Select*,
// WorkAssignmentControl, chileDateParts, cn, tipos de work-queue.

/**
 * Vista "Mi trabajo": la cola operacional completa.
 *
 * Ocupaba la primera pantalla de Inicio y empujaba todo indicador bajo el pliegue
 * — el primer gráfico aparecía a pantalla y media de scroll. Acá es el contenido
 * principal de su propia pestaña, que es lo que siempre fue.
 *
 * **Sólo el orden** vive en `sessionStorage`: es preferencia de UI y se aplica en
 * cliente sobre las filas ya cargadas. La faena y el período reencuadran
 * consultas de servidor y por eso viajan en la URL. `sessionStorage` y no estado
 * de React porque cualquier `router.refresh()` —el de `WorkAssignmentControl`,
 * por ejemplo— desmonta el árbol (hay `loading.tsx`) y lo borraría.
 */
export function TrabajoView({
  tasks,
  queueSummary,
  queueShortcuts,
  scope,
  canAssign,
  refreshedAt,
}: {
  tasks: DashboardTask[]
  queueSummary: { total: number; critical: number; overdue: number; deliveries: number }
  queueShortcuts: QueueShortcut[]
  scope: DashboardScope
  canAssign: boolean
  refreshedAt: string
}) {
  // …el cuerpo actual: sessionStorage del orden, filtro por `searchQuery`,
  // `filteredTasks`, `isTruncated`, y el `<section id="cola-de-trabajo">` tal
  // cual, sin el `<DashboardGrid>` alrededor: acá ocupa el ancho completo.
}
```

Mueve también los tipos `DashboardTask`, `QueueShortcut` y `SortOption` a este
archivo y reexporta `DashboardTask`/`QueueShortcut` desde él; `page.tsx` los
importará desde aquí.

- [ ] **Paso 2: crea la vista Resumen**

Crea `app/(app)/dashboard/views/resumen-view.tsx`. Es un Server Component async
que hace el `Promise.all` que hoy vive en `page.tsx` **menos** la cola (que llega
ya consultada) y **menos** lo que sólo usaban los dominios:

```tsx
import { Suspense } from "react"
import type { Session } from "next-auth"
import Link from "next/link"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { DashboardGrid } from "@/components/ui/dashboard-grid"
import { EmptyState } from "@/components/ui/empty-state"
import type { WorksiteScope } from "@/lib/auth/scope"
import { can } from "@/lib/auth/can"
import { formatCLP, formatDate } from "@/lib/utils"
// …servicios: getDashboardData, listOperationalActivity, getCriticalStockAlertCount,
// listEppCoverageGaps, getOperationalPeriodMetrics, getOperationalBacklogComparisons,
// getOperationalSnapshotHistory, getCapaDashboardCounts, getIncidentDashboardCounts,
// getActivePdtpProgram, listPdtpPrograms, loadPdtpComplianceSummary.
import { DashboardResumenBody } from "../dashboard-control-center"
import { RecentActivity } from "../recent-activity"
import { PdtpComplianceCard } from "../pdtp-compliance-card"

/**
 * Vista de entrada: lo transversal, no un dominio.
 *
 * Cuatro KPIs por ranura semántica (dinero · cumplimiento · riesgo · trabajo),
 * las alertas que no son tile, el flujo del período y el backlog comparado. Los
 * dominios completos viven cada uno en su pestaña.
 */
export async function ResumenView({ session, scope, worksiteScope, pdtpScope, worksiteIds, currentYear, queue }: ResumenViewProps) {
  // …el mismo Promise.all de page.tsx, sin `getOperationalWorkQueue`,
  // y con los mismos gates `can(session, …)`.
}
```

Mueve a este archivo, **sin cambiar sus firmas ni sus nombres**,
`buildOperationalMetrics`, `buildOperationalAlerts`, `pendientesHref`,
`periodWindowHref`, `buildQueueShortcuts`, `periodComparison`,
`buildOperationalPeriodSummary`, `backlogComparison` y
`buildOperationalBacklogSummary` desde `page.tsx`. `buildQueueShortcuts` la
necesita también la vista Mi trabajo: expórtala desde aquí y que `page.tsx` la
llame para ambas.

Actualiza el import en `dashboard-metrics-slots.test.ts`:

```ts
import { buildOperationalAlerts, buildOperationalMetrics } from "./views/resumen-view"
```

y añade `view: "resumen"` al literal `const scope: DashboardScope` de ese archivo.

- [ ] **Paso 3: reduce el Control Center al cuerpo del Resumen**

En `dashboard-control-center.tsx`, renombra `DashboardControlCenter` a
`DashboardResumenBody` y quita de sus props `firstName`, `contextLabel`,
`tasks`, `queueSummary`, `queueShortcuts`, `worksiteOptions`, `canAssign` — todo
eso se fue a la cabecera o a la vista Mi trabajo. Queda:

```tsx
export function DashboardResumenBody({
  scope,
  metrics,
  alerts,
  periodSummary,
  backlogSummary,
  mainSlot,
  asideSlot,
}: DashboardResumenBodyProps) {
  return (
    <DashboardGrid
      main={<>{metrics.length > 0 && <OperationalMetricsStrip metrics={metrics} />}{mainSlot}</>}
      aside={<>{/* Requiere atención, asideSlot, CompactMetricList ×2 — tal cual hoy */}</>}
    />
  )
}
```

Borra el `<header>` (ya está en `dashboard-header.tsx`) y `buildOperationalSummary`
(idem). Actualiza `dashboard-control-center.test.tsx`: renombra el sujeto, quita
las aserciones sobre el saludo y la cola —que ahora prueban otros componentes— y
deja las de KPIs, alertas y listas compactas.

- [ ] **Paso 4: una sección de dominio a la vez**

En `dashboard-domain-sections.tsx`, borra el import de `DomainIndex` y reemplaza
el orquestador del final del archivo:

```tsx
export const SECTION_BY_DOMAIN: Record<DashboardDomainKey, (props: DomainSectionsProps) => Promise<React.JSX.Element>> = {
  adquisiciones: AcquisitionsSection,
  bodega: WarehouseSection,
  prevencion: PreventionSection,
  flota: FleetSection,
  terreno: FieldControlSection,
  gobernanza: GovernanceSection,
}

/**
 * La sección del dominio activo. Una, no seis.
 *
 * `DashboardDomainSections` montaba las seis con un `Suspense` cada una: la de
 * Adquisiciones sola dispara ~20 consultas, y se pagaban todas en cada carga
 * aunque el usuario mirara Prevención.
 */
export function DashboardDomainSection({ domain, ...props }: DomainSectionsProps & { domain: DashboardDomainKey }) {
  const Section = SECTION_BY_DOMAIN[domain]
  return <Section {...props} />
}
```

- [ ] **Paso 5: reescribe `page.tsx`**

`page.tsx` queda como orquestador delgado:

```tsx
export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardScopeSearchParams> }) {
  const session = await auth()
  if (!session) return null

  const roleScope = resolveWorksiteScope(session)
  // Hora de Chile: el proceso corre en UTC y el 31 de diciembre por la tarde
  // saltaba al año siguiente, consultando PDTP/SST del año equivocado.
  const currentYear = chileDateParts().year

  // Los tres permisos que necesitan los atajos de la cola. El resto se resuelve
  // dentro de cada vista, que es la que sabe qué consulta.
  const canApprove = can(session, "approvals:approve")
  const canReceive = can(session, "receiving:view")
  const canDeliver = can(session, "deliveries:create")

  const authorizedWorksites = await listVisibleWorksites(roleScope)
  const views = availableDashboardViews(session.user.permissions)
  const scope = parseDashboardScope(await searchParams, authorizedWorksites, views)

  const worksiteScope = intersectWorksiteScope(roleScope, scope)
  const pdtpScope = scopeToWorksiteIds(worksiteScope)
  const scopeWorksiteIds = scopedWorksiteId(scope)
    ? [scopedWorksiteId(scope)!]
    : authorizedWorksites.map((worksite) => worksite.id)

  /*
   * La cola se consulta **siempre**, pero con una sola fila salvo en su vista.
   *
   * `summary` y `total` se calculan sobre la población completa del alcance, no
   * sobre la página (`getOperationalWorkQueuePage`: `summary` sale del CTE
   * `filtered`, los items de `paginated`), así que el saludo y la insignia de la
   * pestaña son exactos con `limit: 1`. Y el mínimo es 1: el servicio hace
   * `Math.max(1, …)`, un 0 no ahorraría nada.
   */
  const queue = await getOperationalWorkQueue(session, {
    limit: scope.view === "trabajo" ? QUEUE_PREVIEW_LIMIT : 1,
    worksiteId: scope.worksiteId,
  })

  const refreshedAt = new Date().toISOString()
  const contextLabel = scope.worksiteName
    ?? (roleScope.mode === "all" ? "Todas las faenas activas" : "Todas mis faenas autorizadas")

  // Población completa del alcance, no las filas cargadas (D-02). La consume el
  // gráfico de distribución por módulo de Adquisiciones.
  const moduleWorkload = Object.entries(queue.summary.moduleCounts)
    .map(([module, count]) => ({ module: OPERATIONAL_MODULE_LABELS[module as OperationalModule] ?? module, count: count ?? 0 }))
    .filter((entry) => entry.count > 0)

  return (
    <PageContainer>
      <PageHeader title="Inicio" actions={<QuickActions session={session} />} />
      <div className="animate-in fade-in duration-[var(--duration-default)]">
        <DashboardHeader
          firstName={session.user.name?.split(" ")[0] ?? "usuario"}
          summary={buildOperationalSummary(queue.total, scope.worksiteName)}
          contextLabel={contextLabel}
          refreshedAt={refreshedAt}
          scope={scope}
          worksiteOptions={authorizedWorksites}
        />
        <DashboardViewTabs views={views} scope={scope} workCount={queue.total} />

        {/* El `key` con el alcance completo es necesario: sin él, cambiar de
            faena reusaba el árbol suspendido y la vista mostraba los datos de la
            faena anterior mientras las consultas nuevas resolvían. */}
        <Suspense key={`${scope.view}:${scope.worksiteId}:${scope.period}`} fallback={<DomainSectionFallback />}>
          {scope.view === "trabajo" ? (
            <TrabajoView
              tasks={queue.items.map(toDashboardTask)}
              queueSummary={{
                total: queue.total,
                critical: queue.summary.critical,
                overdue: queue.summary.overdue,
                deliveries: queue.summary.moduleCounts.entregas ?? 0,
              }}
              queueShortcuts={buildQueueShortcuts({ queue, scope, canApprove, canReceive, canDeliver })}
              scope={scope}
              canAssign={session.user.permissions.includes("operations:assign_work")}
              refreshedAt={refreshedAt}
            />
          ) : scope.view === "resumen" ? (
            <ResumenView
              session={session} scope={scope} worksiteScope={worksiteScope}
              pdtpScope={pdtpScope} worksiteIds={scopeWorksiteIds}
              currentYear={currentYear} queueTotal={queue.total}
              queueSummary={queue.summary} refreshedAt={refreshedAt}
            />
          ) : (
            <DashboardDomainSection
              domain={scope.view}
              session={session} scope={scope} worksiteScope={worksiteScope}
              pdtpScope={pdtpScope} worksiteIds={scopeWorksiteIds}
              currentYear={currentYear}
              moduleWorkload={moduleWorkload} queueTotal={queue.total}
            />
          )}
        </Suspense>
      </div>
    </PageContainer>
  )
}
```

Dos notas sobre este archivo:

1. **`worksitesBreakdown` y `pendingApprovals`** salían de `getDashboardData`,
   que ahora sólo llama el Resumen. Mueve la llamada **dentro** de
   `AcquisitionsSection` (que necesita `pendingApprovals`) y de `FinanceSection`
   (que necesita `worksitesBreakdown` para "Inversión por faena", Tarea 8): cada
   una tiene su propio `Promise.all` y así no encarece las otras vistas. Quita
   los dos campos de `DomainSectionsProps`.
2. **`buildQueueShortcuts` vive en `views/resumen-view.tsx` aunque la consuma
   `page.tsx` para la vista Mi trabajo.** Es deliberado: comparte
   `pendientesHref` con `buildOperationalMetrics` y `buildOperationalAlerts`, y
   sacarla a un módulo propio sería un archivo de tres funciones para evitar un
   import. No lo "arregles".

- [ ] **Paso 6: corre todo y confirma verde**

```bash
npm run typecheck
npm run lint
npm test -- "app/(app)/dashboard/"
```

Esperado: PASS los tres. Si `dashboard-control-center.test.tsx` falla por
aserciones sobre el saludo o la cola, muévelas: el saludo lo prueba ahora
`buildOperationalSummary` (test unitario nuevo en `dashboard-header.test.ts` si
hace falta) y la cola la prueba el e2e de la Tarea 5.

- [ ] **Paso 7: verifica en el navegador**

```bash
npm run dev
```

Abre `http://localhost:3001/dashboard`, entra con las credenciales del seed y
comprueba a ojo: la barra de pestañas aparece bajo el saludo, "Resumen" está
activa, "Mi trabajo" muestra su insignia con el total, y cambiar de pestaña
conserva la faena elegida en la URL.

- [ ] **Paso 8: commit**

```bash
git add "app/(app)/dashboard/"
git commit -m "feat(dashboard): Inicio renderiza una vista a la vez en vez de apilar seis dominios"
```

---

## Tarea 5: E2E del selector

**Archivos:**
- Modificar: `e2e/dashboard.spec.ts`

- [ ] **Paso 1: reemplaza el bloque de secciones por dominio**

Borra los tests `"el admin ve las secciones por dominio en orden de gasto
primero"`, `"el índice navega a cada sección"`, `"cada cifra declara su ventana y
la sección no promete una global"`, `"cada sección enlaza al módulo que la
explica"` y `"el control preventivo en terreno agrupa los seis dominios que
faltaban"` — todos asumen las seis secciones montadas a la vez. Reemplázalos por:

```ts
/**
 * El selector de vistas: una a la vez. Sustituye al índice de anclas, que
 * navegaba con scroll sobre una página con las seis secciones ya montadas.
 */
test.describe("Selector de vistas", () => {
  test("el admin ve Resumen, Mi trabajo y sus dominios, con la plata primero", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    await expect(tabs).toBeVisible()

    const titles = await tabs.getByRole("link").allTextContents()
    expect(titles.map((t) => t.replace(/\d+$/, "").trim()).slice(0, 3))
      .toEqual(["Resumen", "Mi trabajo", "Finanzas"])
  })

  test("Inicio abre en Resumen y sólo esa vista está montada", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
    // La cola vive en su pestaña: montarla acá era lo que empujaba todo
    // indicador bajo el pliegue.
    await expect(page.locator("#cola-de-trabajo")).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Adquisiciones" })).toHaveCount(0)
  })

  test("elegir una vista la pinta y deja las otras fuera del DOM", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    await tabs.getByRole("link", { name: "Prevención" }).click()

    await expect(page).toHaveURL(/vista=prevencion/)
    await expect(page.getByRole("region", { name: "Prevención y SST" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Finanzas" })).toHaveCount(0)
    await expect(tabs.getByRole("link", { name: "Prevención" })).toHaveAttribute("aria-current", "page")
  })

  test("Mi trabajo es la cola completa y su insignia cuadra con el saludo", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Vistas del tablero" })
    const saludo = (await page.getByText(/Tienes (\d+) tareas? pendientes?/).textContent()) ?? ""
    const total = saludo.match(/Tienes (\d+)/)?.[1] ?? "0"

    await expect(tabs.getByRole("link", { name: /Mi trabajo/ })).toContainText(total)
    await tabs.getByRole("link", { name: /Mi trabajo/ }).click()

    await expect(page).toHaveURL(/vista=trabajo/)
    await expect(page.getByRole("region", { name: "Cola de trabajo" })).toBeVisible()
  })

  test("cambiar de vista no reinicia la faena", async ({ page }) => {
    const picker = await worksitePicker(page)
    if ((await picker.count()) === 0) test.skip(true, "El usuario tiene una sola faena autorizada")

    await picker.click()
    await page.getByRole("option").filter({ hasNotText: "Todas las faenas" }).first().click()
    await expect(page).toHaveURL(/faena=/)

    await page.getByRole("navigation", { name: "Vistas del tablero" })
      .getByRole("link", { name: "Flota" }).click()

    // Las tres dimensiones conviven en la URL: sin esto, elegir vista tras
    // elegir faena devolvía el tablero a "todas".
    await expect(page).toHaveURL(/vista=flota/)
    await expect(page).toHaveURL(/faena=/)
  })

  test("una vista no autorizada cae al Resumen en vez de dejar la página en blanco", async ({ page }) => {
    await page.goto("/dashboard?vista=contabilidad")
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
  })
})
```

- [ ] **Paso 2: ajusta los tests que quedan**

En `"la cola de trabajo no scrollea horizontalmente a 1440px"` y en `"la pantalla
tiene dos controles de alcance y el de la cola es sólo el orden"`, añade al
principio:

```ts
    await page.goto("/dashboard?vista=trabajo")
```

El resto de ese `describe` (KPIs de ranura, período en la URL, faena que
sobrevive al recargar, faena inexistente) sigue valiendo tal cual sobre el
Resumen.

- [ ] **Paso 3: corre los e2e**

```bash
PGHOST=/var/run/postgresql npm run test:e2e -- e2e/dashboard.spec.ts
```

Esperado: PASS. El test de "Finanzas" en la primera posición fallará hasta la
Fase 2 — márcalo con `test.fixme` y quítale la marca en la Tarea 9.

- [ ] **Paso 4: commit**

```bash
git add e2e/dashboard.spec.ts
git commit -m "test(e2e): el tablero se navega por vistas, no por anclas"
```

---

# Fase 2 — El dominio Finanzas

## Tarea 6: Declarar el dominio

**Archivos:**
- Modificar: `app/(app)/dashboard/dashboard-domains.ts`
- Modificar: `app/(app)/dashboard/dashboard-domains.test.ts`

- [ ] **Paso 1: escribe el test que falla**

Añade a `dashboard-domains.test.ts`:

```ts
describe("dominio Finanzas", () => {
  it("a quien mira la plata le abre por Finanzas, antes que Adquisiciones", () => {
    const keys = orderDashboardDomains([...JEFATURA, "billing:view"]).map((d) => d.key)
    expect(keys[0]).toBe("finanzas")
    expect(keys.indexOf("finanzas")).toBeLessThan(keys.indexOf("adquisiciones"))
  })

  it("`purchasing:view` solo ya abre Finanzas: el gasto también es plata", () => {
    expect(orderDashboardDomains(["purchasing:view"]).map((d) => d.key)).toContain("finanzas")
  })

  it("sin ningún permiso de dinero, Finanzas no existe", () => {
    const keys = orderDashboardDomains(["prevention:pdtp:view", "warehouse:view_stock"]).map((d) => d.key)
    expect(keys).not.toContain("finanzas")
  })
})
```

Y actualiza la aserción existente `"a quien mira la plata le abre con gasto"`
—que hoy espera exactamente `["adquisiciones", "flota", …]`— para incluir
`"finanzas"` al frente:

```ts
    expect(keys).toEqual(["finanzas", "adquisiciones", "flota", "prevencion", "bodega", "terreno", "gobernanza"])
```

(`JEFATURA` incluye `purchasing:view`, así que Finanzas entra por ahí aunque el
perfil no tenga `billing:view`.)

- [ ] **Paso 2: corre el test y confirma que falla**

```bash
npm test -- "app/(app)/dashboard/dashboard-domains.test.ts"
```

Esperado: FAIL — `expected 'adquisiciones' to be 'finanzas'`.

- [ ] **Paso 3: implementa**

En `dashboard-domains.ts`, añade `"finanzas"` al inicio de
`DASHBOARD_DOMAIN_KEYS`, la entrada al mapa, y actualiza los dos órdenes:

```ts
export const DASHBOARD_DOMAIN_KEYS = [
  "finanzas",
  "adquisiciones",
  "bodega",
  "prevencion",
  "flota",
  "terreno",
  "gobernanza",
] as const
```

```ts
  finanzas: {
    key: "finanzas",
    title: "Finanzas",
    shortTitle: "Finanzas",
    anchor: "dominio-finanzas",
    /**
     * Cubre las dos direcciones del dinero: `billing:view` la venta
     * (facturación y cobranza), `purchasing:view` la compra (gasto en OC), y
     * `combustibles:view_costs` el costo de combustible y su deuda. Basta uno:
     * quien sólo ve compras entra igual y ve su mitad de la sección.
     */
    permissions: ["billing:view", "purchasing:view", "combustibles:view_costs"],
  },
```

```ts
const MONEY_FIRST: readonly DashboardDomainKey[] = ["finanzas", "adquisiciones", "flota", "prevencion", "bodega", "terreno", "gobernanza"]
const PREVENTION_FIRST: readonly DashboardDomainKey[] = ["prevencion", "terreno", "gobernanza", "bodega", "adquisiciones", "flota", "finanzas"]
```

- [ ] **Paso 4: corre los tests**

```bash
npm test -- "app/(app)/dashboard/"
npm run typecheck
```

Esperado: PASS todo menos un error de exhaustividad en `SECTION_BY_DOMAIN`
(`Property 'finanzas' is missing`). Es lo que se cierra en la Tarea 8; déjalo.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/dashboard/dashboard-domains.ts" "app/(app)/dashboard/dashboard-domains.test.ts"
git commit -m "feat(dashboard): declara el dominio Finanzas"
```

---

## Tarea 7: Tile de dinero contable y gráfico de flujo facturado/cobrado

**Archivos:**
- Modificar: `app/(app)/facturacion/money-stat.tsx`
- Modificar: `app/(app)/dashboard/dashboard-charts.tsx`
- Modificar: `app/(app)/dashboard/dashboard-domain-charts.tsx`

**Interfaces:**
- Produce: `<MoneyStat …/>` gana `data-kpi-card`;
  `BillingFlowChart({ data }: { data: Array<{ period: string; invoiced: number; collected: number }> })`.

- [ ] **Paso 1: marca `MoneyStat` como tile**

`MoneyStat` ya resuelve lo que `KpiCard` no sabe hacer: **nunca suma monedas
distintas**. Reusarlo es correcto; lo único que le falta es el ancla que cuenta
el e2e de densidad. En `app/(app)/facturacion/money-stat.tsx`, añade el atributo
a los dos retornos:

```tsx
  return href
    ? <Link href={href} data-kpi-card="" className={className}>{content}</Link>
    : <div data-kpi-card="" className={className}>{content}</div>
```

Y documenta por qué en el bloque de arriba del componente:

```
 * 4. **Cuenta como tile.** `data-kpi-card` es el ancla que usa
 *    `e2e/densidad-kpi.spec.ts` para contar indicadores por pantalla. Sin él,
 *    una fila de cuatro `MoneyStat` era invisible para el tope de densidad.
```

- [ ] **Paso 2: añade el gráfico de flujo**

En `dashboard-charts.tsx`, junto a los demás `satisfies ChartConfig`:

```tsx
const billingFlowConfig = {
  invoiced:  { label: "Facturado", color: CHART_COLORS.brand },
  collected: { label: "Cobrado",   color: CHART_COLORS.blue },
} satisfies ChartConfig
```

y el componente:

```tsx
/**
 * Facturado contra cobrado, mes a mes.
 *
 * Las dos series son dinero en la misma moneda y la misma escala, así que
 * comparten eje (A5b sólo prohíbe mezclar unidades distintas). La brecha entre
 * ambas líneas **es** la lectura: lo emitido que todavía no entra en caja.
 */
export function BillingFlowChart({ data }: {
  data: Array<{ period: string; invoiced: number; collected: number }>
}) {
  if (!data.some((row) => row.invoiced + row.collected > 0)) return null

  const peak = maxBy(data, (row) => row.invoiced)

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Facturado y cobrado</h3>
        <p className="text-xs text-[var(--color-text-muted)]">Emisión contra pagos confirmados, por mes</p>
      </div>

      <ChartDataTable
        title="Facturado y cobrado"
        groupLabel="Mes"
        columns={["Facturado", "Cobrado"]}
        rows={data.map((row) => ({ label: row.period, values: [formatCLP(row.invoiced), formatCLP(row.collected)] }))}
        conclusion={`El mayor facturado se registró en ${peak.period}: ${formatCLP(peak.invoiced)}.`}
        caption="Las dos series se distinguen sólo por color; los valores exactos están aquí."
        className="mb-3 mt-0 border-b border-t-0 pb-3 pt-0"
      />

      <ChartContainer config={billingFlowConfig} className="h-56 w-full">
        <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={52} fontSize={11} tickFormatter={compactCLPTick} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => [formatCLP(Number(value)), String(name)]} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line dataKey="invoiced" type="monotone" stroke="var(--color-invoiced)" strokeWidth={2} dot={false} />
          <Line dataKey="collected" type="monotone" stroke="var(--color-collected)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </div>
  )
}
```

- [ ] **Paso 3: envuélvelo diferido**

En `dashboard-domain-charts.tsx`, al final:

```tsx
export const BillingFlowChart = lazyChart(() => import("./dashboard-charts").then((m) => m.BillingFlowChart), "el flujo de facturación", "h-80")
```

- [ ] **Paso 4: verifica**

```bash
npm run typecheck
npm run lint
npm run check:bundle-budget
```

Esperado: los tres limpios. `check:bundle-budget` importa: confirma que recharts
no entró al chunk inicial.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/facturacion/money-stat.tsx" "app/(app)/dashboard/dashboard-charts.tsx" "app/(app)/dashboard/dashboard-domain-charts.tsx"
git commit -m "feat(dashboard): grafico de facturado vs cobrado y MoneyStat contable como tile"
```

---

## Tarea 8: La sección Finanzas

**Archivos:**
- Crear: `app/(app)/dashboard/sections/finance-section.tsx`
- Modificar: `app/(app)/dashboard/dashboard-domain-sections.tsx`
- Modificar: `app/(app)/dashboard/dashboard-domain-shell.tsx`

**Interfaces:**
- Consume: `getBillingSummary(session, { period?: string; worksiteId?: string })`
  de `@/lib/services/billing/queries` → `BillingSummary`;
  `getAnalyticsDashboard`, `getFuelMonthlyTrend`, `getOverdueFuelDebt`,
  `getDashboardData`; `DomainSection` (Tarea 12 le añade `kpiGroups`).
- Produce: `FinanceSection(props: DomainSectionsProps): Promise<JSX.Element>`.

- [ ] **Paso 1: `DomainSection` acepta filas rotuladas de KPI**

En `dashboard-domain-shell.tsx`, cambia la prop `kpis` por una lista de grupos,
manteniendo `kpis` como atajo de un grupo sin rótulo:

```tsx
export interface DomainKpiGroup {
  key: string
  /** Rótulo de la fila. `null` la deja sin encabezado (grupo único). */
  label: string | null
  content: ReactNode
}

export function DomainSection({ domain, kpis, kpiGroups, summary, charts, links, note }: {
  domain: DashboardDomain
  /** Una sola fila sin rótulo. Excluyente con `kpiGroups`. */
  kpis?: ReactNode
  /**
   * Varias filas rotuladas. Finanzas las necesita: ocho cifras seguidas sin
   * separar ingresos de egresos se leen como una sola lista.
   */
  kpiGroups?: DomainKpiGroup[]
  summary?: ReactNode
  charts: ReactNode
  links: Array<{ label: string; href: string }>
  note?: string
}) {
  const groups: DomainKpiGroup[] = kpiGroups ?? (kpis ? [{ key: "default", label: null, content: kpis }] : [])
  // …cabecera y nota igual que hoy…
  return (
    // …
      {groups.map((group) => (
        <div key={group.key} className={group.key === groups[0]!.key ? undefined : "mt-4"}>
          {group.label && (
            <h3 className="text-eyebrow mb-2 text-[var(--color-text-faint)]">{group.label}</h3>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{group.content}</div>
        </div>
      ))}
    // …
  )
}
```

- [ ] **Paso 2: escribe la sección**

Crea `app/(app)/dashboard/sections/finance-section.tsx`:

```tsx
import { CurrencyDollar, FileText, Gauge, Receipt, ShoppingCart, Timer, Warning } from "@phosphor-icons/react/dist/ssr"
import { KpiCard } from "@/components/ui/kpi-card"
import { MoneyStat } from "@/app/(app)/facturacion/money-stat"
import { formatCLP } from "@/lib/utils"
import { getBillingSummary } from "@/lib/services/billing/queries"
import { getAnalyticsDashboard } from "@/lib/services/analytics-module/dashboard"
import { getFuelMonthlyTrend } from "@/lib/services/dashboard-fleet-maintenance"
import { getOverdueFuelDebt } from "@/lib/services/dashboard-domains-data"
import { getDashboardData } from "@/lib/services/dashboard"
import { computeHealthStats } from "@/lib/services/dte-portal/reconciliation"
import { readDtePortalConfig } from "@/lib/services/dte-portal/config"
import { DASHBOARD_DOMAINS } from "../dashboard-domains"
import { DomainSection } from "../dashboard-domain-shell"
import { periodScopeLabel, scopedWorksiteId, type DashboardScope } from "../dashboard-scope"
import { getOperationalCalendarBounds } from "@/lib/services/operational-period-metrics"
import {
  BillingFlowChart, CompositionDonutChart, ThresholdRankingChart, WorksiteActivityChart,
} from "../dashboard-domain-charts"
import type { DomainSectionsProps } from "../dashboard-domain-sections"

/**
 * Finanzas: **toda la plata**, en las dos direcciones.
 *
 * Ingresos (venta) salían sólo en `/facturacion`, que no tenía ninguna presencia
 * en el tablero. Egresos (gasto en OC, proveedores, combustible, deuda) vivían
 * repartidos entre Adquisiciones y Flota, donde competían con las cifras de
 * proceso de esos dominios. Acá conviven y se comparan.
 *
 * Ocho tiles en dos filas rotuladas: es la excepción declarada a §A1 de
 * AGENTS.md, que rige para el resto de las pantallas.
 */
export async function FinanceSection({ session, scope }: DomainSectionsProps) {
  const permissions = session.user.permissions
  const has = (permission: string) => permissions.includes(permission)
  const worksiteId = scopedWorksiteId(scope)
  const bounds = getOperationalCalendarBounds(new Date(), scope.period)

  // `getBillingSummary` acepta período tributario `YYYY-MM` y faena, así que el
  // alcance global del tablero lo reencuadra sin código de datos nuevo.
  const billingPeriod = bounds.currentStart.slice(0, 7)
  const dteCodEmp = (await readDtePortalConfig()).credentials.codEmp

  const [billing, analytics, fuelTrend, debt, dteHealth, dashboardData] = await Promise.all([
    has("billing:view")
      ? getBillingSummary(session, { period: billingPeriod, ...(worksiteId ? { worksiteId } : {}) }).catch(() => null)
      : Promise.resolve(null),
    has("purchasing:view")
      ? getAnalyticsDashboard(session, {
          fromDate: bounds.currentStart.slice(0, 10),
          toDate: bounds.currentEnd.slice(0, 10),
          ...(worksiteId ? { worksiteId } : {}),
        })
      : Promise.resolve(null),
    has("combustibles:view_costs") ? getFuelMonthlyTrend(session, 6, worksiteId) : Promise.resolve([]),
    has("combustibles:view_costs") ? getOverdueFuelDebt(bounds.currentEnd.slice(0, 10)) : Promise.resolve({ amount: 0, statements: 0 }),
    has("purchasing:view") ? computeHealthStats(billingPeriod, dteCodEmp).catch(() => null) : Promise.resolve(null),
    has("purchasing:view") ? getDashboardData(session, worksiteId) : Promise.resolve(null),
  ])

  const periodo = periodScopeLabel(scope.period).toLocaleLowerCase("es-CL")
  const fuelCost = fuelTrend.reduce((sum, point) => sum + point.amount, 0)

  const notes = [
    billing ? "La facturación de venta usa el período tributario del mes en curso del alcance, no un rango libre." : null,
    dteHealth && worksiteId ? "Las cifras de DTE son por empresa y período tributario, no por faena: no siguen el filtro de arriba." : null,
    debt.statements > 0 && worksiteId ? "La deuda de cuenta corriente es por proveedor: no se puede repartir por faena." : null,
  ].filter(Boolean)

  return (
    <DomainSection
      domain={DASHBOARD_DOMAINS.finanzas}
      note={notes.length > 0 ? notes.join(" ") : undefined}
      links={[
        { label: "Facturación", href: "/facturacion" },
        { label: "Compras", href: "/compras" },
        { label: "Analítica", href: "/analitica" },
      ]}
      kpiGroups={[
        ...(billing ? [{
          key: "ingresos",
          label: "Ingresos — facturación de venta",
          content: (
            <>
              <MoneyStat label="Facturado en el período" amounts={billing.invoicedByCurrency}
                detail={`${billing.invoiceCount} documento(s) emitido(s) · ${periodo}`}
                origin="Documentos sincronizados desde FacturaEnLínea, sin contar anuladas."
                href={`/facturacion/facturas?periodo=${billingPeriod}`} />
              <MoneyStat label="Cobrado del período" amounts={billing.collectedByCurrency}
                detail="Sólo pagos con confirmación manual"
                origin="Suma de pagos confirmados imputados a facturas emitidas en el período."
                href={`/facturacion/facturas?periodo=${billingPeriod}&pago=paid`} />
              <MoneyStat label="Pendiente de cobro" amounts={billing.outstandingByCurrency}
                detail="Saldo de todas las facturas abiertas"
                origin="Total menos pagos confirmados, de todas las facturas no pagadas (no sólo del período)."
                href="/facturacion/facturas?pago=unpaid" />
              <MoneyStat label="Vencido" amounts={billing.overdueByCurrency}
                detail={`${billing.overdueCount} factura(s) vencida(s) · hoy`}
                origin="Facturas con vencimiento anterior a hoy y saldo pendiente."
                tone={billing.overdueCount > 0 ? "danger" : "neutral"}
                href="/facturacion/facturas?vencidas=1" />
            </>
          ),
        }] : []),
        ...(analytics || fuelTrend.length > 0 ? [{
          key: "egresos",
          label: "Egresos — compra y consumo",
          content: (
            <>
              {analytics && (
                <KpiCard icon={<ShoppingCart size={16} />} label="Gasto en OC" value={formatCLP(analytics.kpis.totalSpend)}
                  detail={`${analytics.kpis.purchaseOrderCount} OC emitidas · ${periodo}`}
                  trend={analytics.kpis.spendVariationPct} href="/compras" />
              )}
              {analytics && (
                <KpiCard icon={<Timer size={16} />} label="Ticket medio por OC" value={formatCLP(analytics.kpis.averageOrderAmount)}
                  detail={`Monto promedio · ${periodo}`} href="/analitica" />
              )}
              {has("combustibles:view_costs") && (
                <KpiCard icon={<Gauge size={16} />} label="Costo de combustible" value={formatCLP(fuelCost)}
                  detail="Cargas facturadas · últimos 6 meses" href="/combustibles" />
              )}
              {has("combustibles:view_costs") && (
                <KpiCard icon={<Warning size={16} />} label="Deuda vencida" value={formatCLP(debt.amount)}
                  detail={debt.statements > 0 ? `${debt.statements} cuenta(s) · hoy` : "Sin cuentas vencidas, hoy"}
                  tone={debt.amount > 0 ? "signal" : "neutral"} href="/combustibles/cuenta-corriente" />
              )}
            </>
          ),
        }] : []),
      ]}
      charts={
        <>
          {billing && billing.monthly.length > 0 && (
            <BillingFlowChart data={billing.monthly.map((row) => ({
              period: row.period, invoiced: row.invoiced, collected: row.collected,
            }))} />
          )}
          {billing && billing.aging.some((bucket) => bucket.count > 0) && (
            <ThresholdRankingChart
              title="Antigüedad de la deuda" description="Saldo pendiente por días desde el vencimiento"
              unit="" format="clp" invert
              goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={billing.aging.map((bucket) => ({
                name: bucket.label,
                // Una sola moneda en el eje: mezclarlas daría un total falso.
                value: bucket.byCurrency[0]?.amount ?? 0,
                detail: `${bucket.count} factura(s)`,
              }))}
            />
          )}
          {analytics && (
            <CompositionDonutChart
              title="Gasto por módulo" description={`De qué se compone el gasto — ${periodo}`}
              totalLabel="del período" format="clp"
              data={analytics.spendByModule.map((row) => ({ key: row.module, label: row.module, value: row.totalAmount }))}
            />
          )}
          {analytics && analytics.topSuppliers.length > 0 && (
            <ThresholdRankingChart
              title="Proveedores por gasto" description="Concentración de compra en el período" unit="" format="clp"
              invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={analytics.topSuppliers.slice(0, 8).map((row) => ({
                name: row.name, value: Math.round(row.totalAmount), detail: `${row.count} OC`,
              }))}
            />
          )}
          {billing && billing.topClients.length > 0 && (
            <ThresholdRankingChart
              title="Principales clientes" description="Facturación del período atribuida a un cliente" unit="" format="clp"
              invert goodAtOrAbove={Number.POSITIVE_INFINITY} warnAtOrAbove={Number.POSITIVE_INFINITY}
              data={billing.topClients.slice(0, 8).map((row) => ({
                name: row.clientName, value: Math.round(row.amount), detail: row.currency,
              }))}
            />
          )}
          {dashboardData && dashboardData.worksitesBreakdown.length > 0 && (
            <WorksiteActivityChart worksites={dashboardData.worksitesBreakdown} />
          )}
        </>
      }
    />
  )
}
```

- [ ] **Paso 3: engánchala al orquestador**

En `dashboard-domain-sections.tsx`, importa y añade la entrada:

```tsx
import { FinanceSection } from "./sections/finance-section"

export const SECTION_BY_DOMAIN: Record<DashboardDomainKey, (props: DomainSectionsProps) => Promise<React.JSX.Element>> = {
  finanzas: FinanceSection,
  adquisiciones: AcquisitionsSection,
  // …el resto igual
}
```

Exporta también `DomainSectionsProps` desde ese archivo (hoy es `export
interface`, verifica que lo sea) para que la sección la importe sin ciclo.

- [ ] **Paso 4: verifica**

```bash
npm run typecheck
npm run lint
npm run dev
```

Abre `http://localhost:3001/dashboard?vista=finanzas` y comprueba: dos filas
rotuladas ("Ingresos — facturación de venta" y "Egresos — compra y consumo"), y
que las cifras sin datos digan "Sin datos" en vez de `$0`.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/dashboard/sections/finance-section.tsx" "app/(app)/dashboard/dashboard-domain-sections.tsx" "app/(app)/dashboard/dashboard-domain-shell.tsx"
git commit -m "feat(dashboard): dominio Finanzas con ingresos de venta y egresos de compra"
```

---

## Tarea 9: Adquisiciones y Flota ceden el dinero

**Archivos:**
- Modificar: `app/(app)/dashboard/dashboard-domain-sections.tsx`
- Modificar: `e2e/dashboard.spec.ts`

Sin esto, "Gasto por módulo" y "Proveedores por gasto" saldrían **dos veces** en
el tablero: la regla A5 sigue viva (una dimensión, una representación) aunque el
tope de tiles se haya relajado.

- [ ] **Paso 1: vacía de dinero Adquisiciones**

En `AcquisitionsSection`:

- Borra los KPIs `"Gasto"` y `"Monto promedio por OC"`.
- Añade en su lugar dos cifras de **proceso**:

```tsx
          <KpiCard icon={<ClipboardText size={16} />} label="OC emitidas" value={String(analytics.kpis.purchaseOrderCount)}
            detail={`Órdenes creadas · ${periodo}`} href="/compras" />
          <KpiCard icon={<Timer size={16} />} label="Órdenes activas" value={String(analytics.kpis.activeOrderCount ?? 0)}
            detail="En curso sin cerrar · ahora" href="/pendientes?module=compras" />
```

  Si `analytics.kpis` no expone `activeOrderCount`, usa
  `getOperationalWorkQueue`-independiente: sustituye ese segundo tile por
  `"Tiempo de ciclo"` sólo si el servicio lo entrega; en caso contrario deja la
  fila en tres tiles. **No inventes una cifra que ningún servicio calcula.**
- Borra el bloque `summary={dteHealth && …}` completo y la consulta
  `computeHealthStats` + `readDtePortalConfig` de su `Promise.all`. La salud DTE
  se mide en Finanzas.
- Borra los charts `CompositionDonutChart` ("Gasto por módulo"),
  `ThresholdRankingChart` ("Proveedores por gasto") y `WorksiteActivityChart`.
  Quedan `OperationalTrendChart` y `ModuleWorkloadChart`.
- Mueve `getDashboardData(session, scopedWorksite)` **dentro** de su `Promise.all`
  para obtener `pendingApprovals`, ya que `page.tsx` dejó de pasarlo.
- Actualiza el `note`: elimina la advertencia sobre DTE.

- [ ] **Paso 2: vacía de dinero Flota**

En `FleetSection`:

- Borra los KPIs `"Costo de combustible"` y `"Deuda vencida"`, y de su
  `Promise.all` la llamada a `getOverdueFuelDebt`, `countPendingFuelCreditNotes`
  y `readDtePortalConfig`.
- Borra el `note` sobre la deuda por proveedor.
- Deja `getFuelMonthlyTrend`: alimenta `FuelConsumptionChart`, que grafica
  **litros y costo en eje doble** — esa sigue siendo una lectura operacional
  (cuánto se consume), no financiera.
- Rellena las dos ranuras liberadas con cifras de operación de flota que ya se
  consultan y hoy no se muestran:

```tsx
          <KpiCard icon={<Truck size={16} />} label="Vehículos activos" value={String(fleet.length)}
            detail="Con al menos un movimiento registrado" href="/flota" />
          <KpiCard icon={<Wrench size={16} />} label="Alertas por uso" value={String(usageAlerts.length)}
            detail={usageAlerts.length > 0 ? "Mantención vencida por km u horas · ahora" : "Ninguna pasada de intervalo"}
            tone={usageAlerts.length > 0 ? "signal" : "neutral"} href="/mantenciones" />
```

- [ ] **Paso 3: actualiza el e2e**

En `e2e/dashboard.spec.ts`, dentro del describe de vistas, añade:

```ts
  test("el dinero vive en Finanzas y no se repite en Adquisiciones ni Flota", async ({ page }) => {
    await page.goto("/dashboard?vista=finanzas")
    const finanzas = page.getByRole("region", { name: "Finanzas" })
    await expect(finanzas.getByText("Gasto en OC", { exact: true })).toBeVisible()
    await expect(finanzas.getByText("Proveedores por gasto")).toBeVisible()

    await page.goto("/dashboard?vista=adquisiciones")
    const adquisiciones = page.getByRole("region", { name: "Adquisiciones" })
    // A5 sigue viva: una dimensión, una representación. El tope de tiles se
    // relajó; la prohibición de duplicar cifras no.
    await expect(adquisiciones.getByText("Proveedores por gasto")).toHaveCount(0)
    await expect(adquisiciones.getByText("Gasto por módulo")).toHaveCount(0)

    await page.goto("/dashboard?vista=flota")
    await expect(page.getByRole("region", { name: "Flota y combustible" })
      .getByText("Deuda vencida", { exact: true })).toHaveCount(0)
  })
```

Y quita el `test.fixme` que dejaste en la Tarea 5 sobre el orden de pestañas.

- [ ] **Paso 4: corre todo**

```bash
npm run typecheck && npm run lint && npm test -- "app/(app)/dashboard/"
PGHOST=/var/run/postgresql npm run test:e2e -- e2e/dashboard.spec.ts
```

Esperado: todo verde.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/dashboard/dashboard-domain-sections.tsx" e2e/dashboard.spec.ts
git commit -m "refactor(dashboard): Adquisiciones y Flota ceden sus cifras de dinero a Finanzas"
```

---

# Fase 3 — La estética de la referencia

## Tarea 10: Tile hero

**Archivos:**
- Crear: `components/ui/hero-kpi-card.tsx`
- Modificar: `components/__tests__/design-tokens-contrast.test.ts`
- Modificar: `app/(app)/dashboard/operational-metrics-strip.tsx`

- [ ] **Paso 1: escribe el test de contraste que falla**

`--color-primary-deep` está documentado en `DESIGN.md` como "Fondo hero card" y
nunca se usó. Antes de pintar texto blanco encima, fija el mínimo. Añade a
`components/__tests__/design-tokens-contrast.test.ts`:

```ts
  it("el tile hero pone texto blanco sobre primary-deep con contraste AAA", () => {
    // El hero es texto grande sobre relleno macizo: si el token se aclara en un
    // ajuste de paleta, el número deja de leerse y nadie lo nota a ojo.
    expect(contrastWithWhite("color-primary-deep")).toBeGreaterThanOrEqual(7)
  })
```

Si el archivo no tiene un helper contra blanco puro, añádelo junto a `contrast`:

```ts
/** Contraste contra blanco puro: el texto del tile hero no sale de un token. */
function contrastWithWhite(token: string): number {
  const hi = 1
  const lo = luminance(token)
  return (hi + 0.05) / (lo + 0.05)
}
```

- [ ] **Paso 2: corre el test**

```bash
npm test -- components/__tests__/design-tokens-contrast.test.ts
```

Esperado: PASS (`--color-primary-deep` es `oklch(0.220 …)`, muy oscuro). Si
fallara, **no aclares el texto: oscurece el token** y actualiza la tabla de
`DESIGN.md`.

- [ ] **Paso 3: implementa el tile**

Crea `components/ui/hero-kpi-card.tsx`:

```tsx
import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

/**
 * El primer tile de una fila, relleno en verde profundo.
 *
 * Un ancla visual por fila: con cuatro tarjetas blancas idénticas la mirada no
 * tiene dónde caer primero. `--color-primary-deep` existe en el design system
 * documentado como "Fondo hero card" desde la migración visual y no se había
 * usado nunca.
 *
 * Conserva `data-kpi-card`: el conteo de densidad de `e2e/densidad-kpi.spec.ts`
 * cuenta por ese atributo y un hero que no cuente sería un hueco en la guarda.
 */
export function HeroKpiCard({ icon, label, value, detail, trend, href }: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  /** Variación porcentual ya calculada. `0` no es buena ni mala noticia. */
  trend?: number | null
  href?: string
}) {
  const card = (
    <div
      data-kpi-card=""
      className={cn(
        "flex h-full flex-col justify-between rounded-[var(--radius-xl)] p-4",
        "bg-[var(--color-primary-deep)] text-white shadow-[var(--shadow-card)]",
        "transition-all duration-(--duration-fast)",
        href && "hover:brightness-125",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-white/70">{label}</p>
        {icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-white/10 text-white">
            {icon}
          </span>
        )}
      </div>

      <p className="mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight text-white">{value}</p>

      <div className="mt-2.5 flex items-start gap-2 text-xs">
        {typeof trend === "number" && (
          <span className={cn(
            "inline-flex items-center gap-0.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold text-white",
          )}>
            {trend > 0 ? <ArrowUp size={11} weight="bold" /> : trend < 0 ? <ArrowDown size={11} weight="bold" /> : null}
            {Math.abs(trend)}%
          </span>
        )}
        <span className="line-clamp-2 text-white/70">{detail}</span>
      </div>
    </div>
  )

  return href ? <Link href={href} className="block h-full">{card}</Link> : card
}
```

- [ ] **Paso 4: úsalo en la primera ranura del Resumen**

En `operational-metrics-strip.tsx`, pinta el primer tile como hero:

```tsx
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => {
          const Icon = METRIC_ICON[metric.icon] ?? CheckCircle
          // Sólo el primero: dos rellenos macizos en una fila de cuatro compiten
          // entre sí y ninguno ancla nada.
          if (index === 0) {
            return (
              <HeroKpiCard key={metric.key} icon={<Icon size={16} />} label={metric.label}
                value={String(metric.value)} detail={metric.description} href={metric.href} />
            )
          }
          return (
            <KpiCard key={metric.key} … />
          )
        })}
      </div>
```

- [ ] **Paso 5: verifica**

```bash
npm test -- components/__tests__/design-tokens-contrast.test.ts
npm run typecheck && npm run lint
```

- [ ] **Paso 6: commit**

```bash
git add components/ui/hero-kpi-card.tsx components/__tests__/design-tokens-contrast.test.ts "app/(app)/dashboard/operational-metrics-strip.tsx"
git commit -m "feat(ui): tile hero en verde profundo para la primera ranura del tablero"
```

---

## Tarea 11: Gauge radial de cumplimiento

**Archivos:**
- Modificar: `app/(app)/dashboard/dashboard-charts.tsx`
- Modificar: `app/(app)/dashboard/dashboard-domain-charts.tsx`
- Modificar: `app/(app)/dashboard/views/resumen-view.tsx`

- [ ] **Paso 1: añade el gráfico**

En `dashboard-charts.tsx`, añade `PolarAngleAxis`, `RadialBar` y `RadialBarChart`
al import de `recharts`, y el componente:

```tsx
const gaugeConfig = {
  value: { label: "Avance", color: CHART_COLORS.brand },
} satisfies ChartConfig

/**
 * Medidor radial para una sola tasa contra su meta.
 *
 * Un porcentaje anual no es una serie: dibujarlo como línea de un punto o como
 * barra suelta desperdicia la tarjeta. El arco declara la meta y el color dice
 * si está bajo ella — `signal` (naranja) por debajo, marca por encima, que es
 * exactamente el rol reservado del naranja: "pendiente".
 */
export function RadialGaugeChart({ title, description, percent, targetPercent, footer, href }: {
  title: string
  description: string
  /** 0-100 ya redondeado por el llamador. */
  percent: number
  /** Meta en la misma escala. Omitida, el arco siempre va en color de marca. */
  targetPercent?: number
  footer?: string
  href?: string
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  const belowTarget = targetPercent !== undefined && value < targetPercent

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>

      <ChartContainer config={gaugeConfig} className="mx-auto aspect-[2/1] max-h-44 w-full">
        <RadialBarChart data={[{ name: title, value }]} startAngle={200} endAngle={-20} innerRadius="72%" outerRadius="100%">
          {/* Sin el eje polar explícito, recharts escala el arco al máximo del
              dato: un 41% dibujaba el círculo completo. */}
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            dataKey="value" angleAxisId={0} background cornerRadius={999}
            fill={belowTarget ? CHART_COLORS.signal : CHART_COLORS.brand}
            isAnimationActive={false}
          />
          <text x="50%" y="72%" textAnchor="middle" className="fill-[var(--color-text)] font-mono text-3xl font-bold">
            {value}%
          </text>
        </RadialBarChart>
      </ChartContainer>

      {(footer || targetPercent !== undefined) && (
        <p className="mt-1 text-center text-xs text-[var(--color-text-muted)]">
          {footer ?? `Meta ${targetPercent}%`}
        </p>
      )}
      {href && (
        <p className="mt-2 text-center">
          <a href={href} className="text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
            Ver detalle
          </a>
        </p>
      )}
    </div>
  )
}
```

- [ ] **Paso 2: envuélvelo diferido**

```tsx
export const RadialGaugeChart = lazyChart(() => import("./dashboard-charts").then((m) => m.RadialGaugeChart), "el medidor de cumplimiento", "h-64")
```

- [ ] **Paso 3: úsalo en el Resumen**

En `views/resumen-view.tsx`, dentro del `mainSlot`, bajo los KPIs y sobre la
actividad reciente:

```tsx
              <div className="grid gap-6 xl:grid-cols-2">
                {pdtpSummary && (
                  <RadialGaugeChart
                    title="Cumplimiento PDTP" description={`Avance acreditado · año ${currentYear}`}
                    percent={Math.round(pdtpSummary.percent * 100)}
                    targetPercent={Math.round(pdtpSummary.target * 100)}
                    href="/prevencion/pdtp"
                  />
                )}
                <OperationalTrendChart data={trend.map((p) => ({ month: p.month, requests: p.requests, orders: p.orders, receipts: p.receipts }))} />
              </div>
```

Añade `getOperationalTrendHistory(session, 6, new Date(), scopedWorksiteId(scope))`
al `Promise.all` del Resumen para alimentar `trend` (importa `scopedWorksiteId`
desde `../dashboard-scope`; `ResumenView` recibe `scope`, no un id suelto).

**Mueve `PdtpComplianceCard` del `asideSlot` del Resumen a la sección de
Prevención**, donde vive el detalle: dejarla junto al gauge sería la misma cifra
en dos representaciones (A5, que sigue vigente). El `asideSlot` del Resumen queda
sólo con "Requiere atención", el flujo del período y el backlog comparado.

- [ ] **Paso 4: verifica en el navegador**

```bash
npm run dev
```

En `/dashboard`, comprueba que el arco no se dibuja completo con un valor
parcial, que el número queda centrado bajo el arco y que el color pasa a naranja
si el avance está bajo la meta.

- [ ] **Paso 5: commit**

```bash
git add "app/(app)/dashboard/"
git commit -m "feat(dashboard): medidor radial de cumplimiento en el Resumen"
```

---

## Tarea 12: Grilla bento

**Archivos:**
- Modificar: `app/(app)/dashboard/dashboard-domain-shell.tsx`

Hoy `DomainSection` pinta todos los gráficos en `xl:grid-cols-2` con la misma
altura: una rejilla uniforme donde nada destaca. La referencia mezcla anchos.

- [ ] **Paso 1: acepta gráficos anchos**

Cambia la grilla de gráficos a tres columnas con un `span` opcional:

```tsx
      {/* Bento: 3 columnas en 2xl, 2 en xl, 1 abajo. Un gráfico puede pedir
          ancho doble envolviéndose en `<div className="xl:col-span-2">`; los
          rankings verticales y los donuts se leen mejor en una sola. */}
      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-3">{charts}</div>
```

Y documenta el uso en el bloque de arriba de `DomainSection`:

```
 * Los gráficos de serie temporal (tendencias, flujo de facturación) piden ancho
 * doble; los de composición y ranking se leen bien en una columna. Envuélvelos
 * en el consumidor:
 *
 *   <div className="xl:col-span-2"><OperationalTrendChart … /></div>
```

- [ ] **Paso 2: aplica el ancho doble donde corresponde**

En cada sección, envuelve en `<div className="xl:col-span-2">` los gráficos de
serie temporal: `OperationalTrendChart` (Adquisiciones), `BillingFlowChart`
(Finanzas), `SstTrendChart` y `MaterialEnvironmentalChart` (Prevención),
`FuelConsumptionChart` y `MaintenanceTrendChart` (Flota).

- [ ] **Paso 3: revisa a tres anchos**

```bash
npm run dev
```

Comprueba `/dashboard?vista=finanzas` a 1920, 1366 y 390 px. A 1366 la grilla es
de 2 columnas y un `xl:col-span-2` ocupa la fila entera: correcto. A 390 todo
apila.

- [ ] **Paso 4: commit**

```bash
git add "app/(app)/dashboard/"
git commit -m "feat(dashboard): grilla bento de tres columnas con graficos de ancho doble"
```

---

# Fase 4 — Reglas, pruebas y evidencia

## Tarea 13: Relajar §A1 en AGENTS.md y en la guarda

**Archivos:**
- Modificar: `AGENTS.md`
- Modificar: `e2e/densidad-kpi.spec.ts`

- [ ] **Paso 1: reescribe §A1**

En `AGENTS.md`, dentro del bloque `<!-- BEGIN:screen-density-rules -->`, sustituye
la sección `## A1` por:

```markdown
## A1 — Máximo 4 tiles de KPI sobre el contenido

- No más de **4 tarjetas** de métrica arriba del contenido principal. Cada
  una debe ser accionable (clic = filtra o navega); si un número no cambia
  ninguna decisión, va abajo o se elimina.
- Los KPIs secundarios van en una fila compacta de texto (patrón
  `WarehouseHeaderMetrics` / la "tira editorial" `MetricBar`), no en tarjetas.
- Un tile en estado vacío muestra la acción para dejar de estarlo, nunca "0"
  ni "—" pelados.

### Excepción declarada: el tablero (`/dashboard`)

Inicio pinta **una vista a la vez** y cada vista es un dominio completo, no una
pantalla de gestión con una lista debajo: no hay "contenido principal" que los
tiles puedan sepultar. Ahí el tope es de **8 tiles por vista**, y sobre 4 la fila
se parte en **grupos rotulados** (`DomainSection.kpiGroups`) — Finanzas separa
"Ingresos" de "Egresos". Ocho cifras seguidas sin ese corte se leen como una sola
lista indistinguible, que es el defecto que A1 previene.

Lo que **no** se relaja:

- Cada tile sigue siendo accionable y sigue llevando a su subconjunto, no al
  total (lo verifica `e2e/densidad-kpi.spec.ts`).
- **A5 sigue rigiendo**: una cifra no puede estar en dos vistas del tablero. Por
  eso el gasto en OC se fue de Adquisiciones cuando nació Finanzas.
- El resto de las pantallas conserva el tope de 4 sin excepciones.
```

- [ ] **Paso 2: actualiza la guarda automatizada**

En `e2e/densidad-kpi.spec.ts`, reemplaza el test `"el tablero respeta el tope
dentro de cada sección de dominio"`:

```ts
  const MAX_KPIS_TABLERO = 8

  test("cada vista del tablero respeta su tope y agrupa sobre cuatro tiles", async ({ page }) => {
    await login(page)

    // Se recorren las pestañas reales, no una lista fija: una vista nueva no
    // puede quedar fuera de la guarda por olvido.
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle").catch(() => undefined)
    const hrefs = await page.getByRole("navigation", { name: "Vistas del tablero" })
      .getByRole("link").evaluateAll((links) => links.map((l) => (l as HTMLAnchorElement).href))

    const excedidas: string[] = []
    for (const href of hrefs) {
      await page.goto(href)
      await page.waitForLoadState("networkidle").catch(() => undefined)
      const total = await page.locator("[data-kpi-card]").count()
      if (total > MAX_KPIS_TABLERO) excedidas.push(`${new URL(href).search || "?vista=resumen"}: ${total}`)
    }

    expect(excedidas).toEqual([])
  })
```

Actualiza también el comentario de cabecera del archivo, que hoy dice que el tope
"se aplica por sección en el tablero": ahora se aplica por vista, con el techo de
8 que declara la excepción de A1.

- [ ] **Paso 3: corre la guarda**

```bash
PGHOST=/var/run/postgresql npm run test:e2e -- e2e/densidad-kpi.spec.ts
```

Esperado: PASS. Si alguna vista pasa de 8, **no subas el número**: mueve la cifra
sobrante a `summary` (`SummaryBar`, la tira editorial) o elimínala.

- [ ] **Paso 4: commit**

```bash
git add AGENTS.md e2e/densidad-kpi.spec.ts
git commit -m "docs(agents): A1 admite 8 tiles agrupados en el tablero, 4 en el resto"
```

---

## Tarea 14: Evidencia visual y cierre

**Archivos:**
- Modificar: `scripts/capture-all-routes.ts`
- Crear: `AUDITORIA_DASHBOARD_VISTAS_2026-08-06.md`

- [ ] **Paso 1: añade las vistas a la lista de capturas**

En `scripts/capture-all-routes.ts`, la ruta `/dashboard` produce hoy una sola
captura. Añade una entrada por vista para que la evidencia cubra las ocho:

```ts
  { path: "/dashboard", name: "inicio-resumen" },
  { path: "/dashboard?vista=trabajo", name: "inicio-trabajo" },
  { path: "/dashboard?vista=finanzas", name: "inicio-finanzas" },
  { path: "/dashboard?vista=adquisiciones", name: "inicio-adquisiciones" },
  { path: "/dashboard?vista=prevencion", name: "inicio-prevencion" },
  { path: "/dashboard?vista=flota", name: "inicio-flota" },
  { path: "/dashboard?vista=bodega", name: "inicio-bodega" },
  { path: "/dashboard?vista=terreno", name: "inicio-terreno" },
  { path: "/dashboard?vista=gobernanza", name: "inicio-gobernanza" },
```

Verifica antes el `outputDir` del script: está fechado a mano y suele quedar
apuntando a una carpeta vieja. Ponlo en `audit/screenshots/inicio-vistas-2026-08-06`.

- [ ] **Paso 2: captura**

```bash
npm run screenshots
```

- [ ] **Paso 3: mide el scroll y déjalo escrito**

Cuenta las capturas por viewport de cada vista. El punto de partida documentado
era: `/dashboard` en 8 rebanadas a 1920, 11 a 1366 y 15 a 390
(`audit/screenshots/inicio-2026-08-05/`). Escribe
`AUDITORIA_DASHBOARD_VISTAS_2026-08-06.md` con:

- Tabla antes/después de rebanadas por viewport y por vista.
- Consultas por carga: antes seis secciones de dominio en paralelo (Adquisiciones
  sola ~20 consultas) más el lote del Control Center; después, la vista activa.
- Lo que quedó fuera y por qué, en particular cualquier vista que exceda 8 tiles
  y cómo se resolvió.

- [ ] **Paso 4: suite completa**

```bash
npm run typecheck && npm run lint && npm test
PGHOST=/var/run/postgresql npm run test:e2e
npm run check:bundle-budget
```

Esperado: todo verde. `check:bundle-budget` es el que atrapa un import estático
de recharts colado en el chunk inicial.

- [ ] **Paso 5: commit**

```bash
git add scripts/capture-all-routes.ts AUDITORIA_DASHBOARD_VISTAS_2026-08-06.md audit/screenshots/
git commit -m "docs(dashboard): evidencia visual y medicion del tablero por vistas"
```

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| `analytics.kpis.activeOrderCount` puede no existir (Tarea 9, paso 1). | El paso lo dice explícitamente: si el servicio no lo entrega, deja la fila en tres tiles. **No inventes la cifra.** |
| Multi-moneda en Finanzas: `ThresholdRankingChart` recibe un número, no `MoneyAmount[]`. | El plan toma `byCurrency[0]` y lo declara en el `detail`. Si el seed tiene dos monedas activas, parte el gráfico en uno por moneda antes de mezclar. |
| `computeHealthStats` y `getOverdueFuelDebt` son por empresa/período tributario, no por faena. | Ya está resuelto: el `note` de la sección lo declara, igual que hacían Adquisiciones y Flota. |
| El período del tablero es `mes/trimestre/año`, pero `getBillingSummary` toma un `YYYY-MM`. | Se usa el mes de inicio de la ventana y se declara en el `note`. Si hace falta trimestre real, es un cambio en `billing/queries.ts` que este plan **no** incluye. |
| `dashboard-domain-sections.tsx` queda en ~700 líneas con seis secciones. | Deuda declarada: partirlo en `sections/<dominio>-section.tsx`, uno por archivo, como ya hace Finanzas. No entra en este plan. |
