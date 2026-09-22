# Mapa de riesgos en CGRD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasladar la pantalla del mapa de riesgos desde `/prevencion/miper/mapa` a `/prevencion/cgrd/mapa`, con su API, su navegación y su capítulo del manual, sin tocar el modelo de datos.

**Architecture:** Es una mudanza, no un rediseño. Se mueven archivos de página, panel, loader y rutas de API; se agrega una entrada `children` en el manifest de prevención; se declara un redirect permanente para la ruta vieja. Tablas, servicio `prevention-risk-map`, prefijo de storage y permisos `prevention:risk:*` quedan idénticos.

**Tech Stack:** Next.js (App Router, Server Components), Drizzle, Vitest, PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-22-mapa-riesgos-en-cgrd-design.md`

## Global Constraints

- **No renombrar** tablas (`prevention_risk_map_layouts`, `prevention_risk_map_markers`), columnas, el servicio `lib/services/prevention-risk-map.ts` ni el prefijo `storage/risk-map/`. Son objetos publicados; reescribirlos es el incidente DAT-002.
- **No crear ni migrar permisos.** El mapa sigue exigiendo `prevention:risk:view` para ver y `prevention:risk:edit` para editar.
- **Sin migración de base de datos.** Este cambio no genera ningún `.sql`.
- **Usar `git mv`** para cada traslado, para que el historial siga al archivo.
- Rutas de filtro que naveguen: `router.replace(url, { scroll: false })` (regla del repo, `AGENTS.md`).
- Textos de usuario en español; comentarios de código en español, como el resto del módulo.
- Puertas del repo: `npm run typecheck`, `npm run lint`, `npm run test:fast`, `npm run test:pglite`, `npm run test:e2e`.
- **Nunca `git add -A`.** El árbol de trabajo puede contener cambios en curso de otra sesión; cada commit usa rutas explícitas.
- Las suites Postgres corren contra el contenedor e2e en el puerto 55432, no contra el socket local; si no está arriba, se saltan solas y eso **no** cuenta como verde.

---

### Task 1: Mover la API del mapa a `/api/prevencion/cgrd/mapa`

Va primero porque la UI la consume por URL construida en runtime. Al terminar esta tarea la aplicación sigue funcionando: el panel, todavía alojado en `miper/`, apunta a la API nueva.

**Files:**
- Move: `app/api/prevencion/miper/mapa/route.ts` → `app/api/prevencion/cgrd/mapa/route.ts`
- Move: `app/api/prevencion/miper/mapa/route.test.ts` → `app/api/prevencion/cgrd/mapa/route.test.ts`
- Move: `app/api/prevencion/miper/mapa/[name]/route.ts` → `app/api/prevencion/cgrd/mapa/[name]/route.ts`
- Modify: `app/(app)/prevencion/miper/risk-map-panel.tsx:141,203`
- Modify: `lib/services/module-toggles.ts:157`
- Modify: `lib/__tests__/risk-map-gc.test.ts:156,165,168`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: los endpoints `POST /api/prevencion/cgrd/mapa` (form-data `file`, `worksiteId`, `title`; responde `201 {ok, layoutId, path, mimeType}`) y `GET /api/prevencion/cgrd/mapa/[name]` (responde la imagen con header `X-Plano-Estado: vigente|archivado`). La Tarea 2 los consume desde su ubicación nueva.

- [ ] **Step 1: Mover los archivos con git**

```bash
mkdir -p "app/api/prevencion/cgrd"
git mv "app/api/prevencion/miper/mapa" "app/api/prevencion/cgrd/mapa"
rmdir "app/api/prevencion/miper" 2>/dev/null || true
```

- [ ] **Step 2: Apuntar el `revalidatePath` del POST a la ruta nueva**

En `app/api/prevencion/cgrd/mapa/route.ts`, la línea que hoy dice:

```ts
revalidatePath("/prevencion/miper")
```

pasa a:

```ts
revalidatePath("/prevencion/cgrd/mapa")
```

- [ ] **Step 3: Actualizar el assert del test de la ruta**

En `app/api/prevencion/cgrd/mapa/route.test.ts`, el assert que hoy dice:

```ts
expect(mockRevalidatePath).toHaveBeenCalledWith("/prevencion/miper")
```

pasa a:

```ts
expect(mockRevalidatePath).toHaveBeenCalledWith("/prevencion/cgrd/mapa")
```

- [ ] **Step 4: Correr el test de la ruta y verificar que pasa**

Run: `npx vitest run app/api/prevencion/cgrd/mapa/route.test.ts`
Expected: PASS, 2 tests (registro con MIME detectado por bytes; compensación con `removeFile` al fallar).

- [ ] **Step 5: Actualizar el par del module-toggle**

En `lib/services/module-toggles.ts`, la línea 157:

```ts
{ moduleId: "prevention", submoduleHref: "/prevencion/miper/mapa", prefix: "/api/prevencion/miper/mapa" },
```

se borra de ahí y se declara **inmediatamente antes** de la entrada del CGRD, que ya existe en la línea 135:

```ts
// El mapa de riesgos se trasladó a CGRD (2026-09-22). El par href/prefijo viaja
// junto con la ruta: si la API se quedaba bajo /api/prevencion/miper, apagar el
// submódulo MIPER habría roto una pantalla del CGRD.
{ moduleId: "prevention", submoduleHref: "/prevencion/cgrd/mapa", prefix: "/api/prevencion/cgrd/mapa" },
{ moduleId: "prevention", submoduleHref: "/prevencion/cgrd", prefix: "/api/prevencion/cgrd" },
```

El orden en el fuente **no** decide la resolución: el array se ordena por longitud
de prefijo descendente en `lib/services/module-toggles.ts:212`, así que
`/api/prevencion/cgrd/mapa` siempre gana sobre `/api/prevencion/cgrd`. Ponerlas
juntas y en ese orden es legibilidad, no corrección.

Agregar de todos modos un caso al test, porque esa garantía es de una línea de
sort que nadie asocia con el mapa — en `lib/__tests__/module-toggles.test.ts`,
comprobar que una ruta `/api/prevencion/cgrd/mapa/plano.png` resuelve al
submódulo `/prevencion/cgrd/mapa` y no a `/prevencion/cgrd`. Seguir la forma de
los casos ya existentes en ese archivo.

- [ ] **Step 6: Apuntar el panel a la API nueva**

En `app/(app)/prevencion/miper/risk-map-panel.tsx`, línea 141:

```tsx
src={`/api/prevencion/cgrd/mapa/${layout.imagePath.split("/").pop()}`}
```

y línea 203:

```ts
const response = await fetch("/api/prevencion/cgrd/mapa", { method: "POST", body: uploadForm })
```

- [ ] **Step 7: Actualizar el test de GC que ejercita el GET**

En `lib/__tests__/risk-map-gc.test.ts`: el `describe` de la línea 156 y las dos referencias dentro de `get()` (líneas ~165 y ~168).

```ts
describe("GET /api/prevencion/cgrd/mapa/[name] (MIP-002)", () => {
```

```ts
    const { GET } = await import("@/app/api/prevencion/cgrd/mapa/[name]/route")
    const { NextRequest } = await import("next/server")
    return GET(
      new NextRequest(`http://localhost/api/prevencion/cgrd/mapa/${name}`),
      { params: Promise.resolve({ name }) },
    )
```

Los asserts de `X-Plano-Estado` y `Cache-Control` **no** cambian: siguen probando que el plano archivado se sirve con `private, no-store` y el vigente con `private, max-age=300`.

- [ ] **Step 8: Correr los tests afectados**

Run: `npx vitest run lib/__tests__/risk-map-gc.test.ts lib/__tests__/module-toggles.test.ts app/api/prevencion/cgrd/mapa/route.test.ts`
Expected: PASS. `risk-map-gc` necesita PGlite; si la suite se salta, no cuenta como verde — verificar que reporta tests ejecutados.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
# add explícito, NUNCA `git add -A`: el árbol puede contener trabajo en curso
# de otra sesión (2026-09-22: 8 archivos de PDTP sin commitear).
git add "app/api/prevencion/cgrd/mapa" "app/(app)/prevencion/miper/risk-map-panel.tsx" \
        lib/services/module-toggles.ts lib/__tests__/risk-map-gc.test.ts
git commit -m "refactor(prevencion): mover la API del mapa de riesgos a /api/prevencion/cgrd/mapa

El par href/prefijo del module-toggle viaja junto con la ruta: si la API se
quedaba bajo /api/prevencion/miper, apagar el submódulo MIPER habría roto una
pantalla alojada en CGRD sin que nada lo explicara.

Seguro para los datos: la URL de la imagen se arma en el cliente desde
image_path; ninguna fila guarda una URL de API.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Mover la pantalla a `/prevencion/cgrd/mapa` y redirigir la ruta vieja

**Files:**
- Move: `app/(app)/prevencion/miper/mapa/page.tsx` → `app/(app)/prevencion/cgrd/mapa/page.tsx`
- Move: `app/(app)/prevencion/miper/risk-map-panel.tsx` → `app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx`
- Move: `app/(app)/prevencion/miper/risk-map-data.ts` → `app/(app)/prevencion/cgrd/mapa/risk-map-data.ts`
- Create: `app/(app)/prevencion/cgrd/mapa/actions.ts`
- Modify: `app/(app)/prevencion/miper/actions.ts:153-166` (quitar el bloque del mapa)
- Modify: `next.config.ts` (bloque `redirects()`)
- Create: `lib/__tests__/risk-map-ui-contract.test.ts`
- Modify: `lib/__tests__/miper-ui-contract.test.ts:26-34,113-120` (quitar los dos tests del mapa)
- Move: `e2e/prevencion-miper-risk-map.spec.ts` → `e2e/prevencion-cgrd-risk-map.spec.ts`

**Interfaces:**
- Consumes: los endpoints de la Tarea 1.
- Produces: la ruta `/prevencion/cgrd/mapa` y las acciones `addRiskMapMarkerAction(input: unknown): Promise<ActionState>` y `removeRiskMapMarkerAction(input: unknown): Promise<ActionState>` exportadas desde `app/(app)/prevencion/cgrd/mapa/actions.ts`. La Tarea 3 enlaza esa ruta desde la navegación.

- [ ] **Step 1: Escribir el test e2e del redirect (falla primero)**

Crear en `e2e/prevencion-cgrd-risk-map.spec.ts` — todavía no existe; se crea en el Step 5 al mover el spec. Para no depender del orden, este test se agrega temporalmente al final de `e2e/prevencion-miper-risk-map.spec.ts` y viaja con el archivo en el Step 5:

```ts
/**
 * El mapa se trasladó a CGRD el 2026-09-22. Sin este test, romper el redirect
 * no falla ninguna suite: los bookmarks y los enlaces del manual antiguo
 * simplemente caen en un 404 que nadie observa.
 */
test("la ruta anterior del mapa redirige a CGRD", async ({ page }) => {
  await login(page)
  await page.goto("/prevencion/miper/mapa")
  await expect(page).toHaveURL(/\/prevencion\/cgrd\/mapa$/)
  await expect(page.getByRole("heading", { level: 1, name: "Mapa de riesgos" })).toBeVisible()
})
```

Nota: este test hace su propio `login`, así que debe ir **fuera** del `test.describe` que tiene el `beforeEach` (o repetirlo es inofensivo, pero el `beforeEach` navegaría antes).

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx playwright test e2e/prevencion-miper-risk-map.spec.ts -g "redirige a CGRD"`
Expected: FAIL — la URL sigue siendo `/prevencion/miper/mapa`, porque el redirect todavía no existe.

- [ ] **Step 3: Mover los tres archivos de UI**

```bash
mkdir -p "app/(app)/prevencion/cgrd/mapa"
git mv "app/(app)/prevencion/miper/mapa/page.tsx" "app/(app)/prevencion/cgrd/mapa/page.tsx"
git mv "app/(app)/prevencion/miper/risk-map-panel.tsx" "app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx"
git mv "app/(app)/prevencion/miper/risk-map-data.ts" "app/(app)/prevencion/cgrd/mapa/risk-map-data.ts"
rmdir "app/(app)/prevencion/miper/mapa" 2>/dev/null || true
```

- [ ] **Step 4: Ajustar imports, breadcrumbs y comentario normativo de `page.tsx`**

Los imports relativos pasan de `../risk-map-panel` a `./risk-map-panel` y de `../risk-map-data` a `./risk-map-data`. El comentario de cabecera y los breadcrumbs quedan así:

```tsx
import { RiskMapPanel } from "./risk-map-panel"
import { loadRiskMapProps } from "./risk-map-data"
```

```tsx
/**
 * DS 44 art. 62 (título III párrafo 6): el mapa de riesgos es exigible por sí
 * mismo, con contenido y visibilidad propios.
 *
 * Vive bajo CGRD por decisión de Prevención (2026-09-22), pero sus marcadores
 * siguen siendo peligros de la matriz IPER publicada de la faena (art. 7): el
 * instrumento es distinto, el dato es compartido. Por eso la pantalla exige
 * `prevention:risk:view` y no `prevention:cgrd:view` — ver
 * docs/superpowers/specs/2026-09-22-mapa-riesgos-en-cgrd-design.md.
 */
```

```tsx
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención", href: "/prevencion" },
          { label: "Gestión de riesgos de desastres", href: "/prevencion/cgrd" },
          { label: "Mapa de riesgos" },
        ]} />}
```

La `description` del `PageHeader` se precisa para que nadie espere amenazas de desastre en este plano:

```tsx
        description="Plano de cada faena con los peligros de la matriz IPER vigente ubicados sobre él. Debe estar visible en el lugar de trabajo. No muestra las amenazas de la matriz GRD."
```

- [ ] **Step 5: Mover el spec e2e**

```bash
git mv e2e/prevencion-miper-risk-map.spec.ts e2e/prevencion-cgrd-risk-map.spec.ts
```

Dentro del archivo: el `test.describe` pasa a `"Prevención — CGRD: mapa de riesgos espacial"`, el `goto` del `beforeEach` pasa a `/prevencion/cgrd/mapa`, y el comentario de cabecera que hoy dice "mapa de riesgos espacial de MIPER (§13/Oro)" pasa a:

```ts
/**
 * E2E: mapa de riesgos espacial (DS 44 art. 62, requisito Oro de la
 * certificación CPHS) — cargar un plano de planta, ubicar un marcador sobre un
 * peligro de la matriz IPER publicada y quitarlo. Vive bajo CGRD desde el
 * 2026-09-22; los marcadores siguen saliendo de la MIPER.
 *
 * No hay librería de mapas en el repo: el overlay es CSS puro sobre una imagen
 * responsiva, así que el clic se posiciona por porcentaje del `boundingBox`
 * real, igual que calcula el cliente.
 *
 * El plano usa `MINIMAL_PNG` (e2e/helpers.ts): sin bytes de imagen de verdad el
 * navegador no le da dimensiones al <img> y el clic porcentual no tiene
 * dónde caer.
 */
```

También se borra el comentario del `beforeEach` que explicaba por qué el mapa no es una pestaña de la MIPER (líneas 19-22): ya no describe la estructura.

- [ ] **Step 6: Crear las server actions en su ubicación nueva**

Crear `app/(app)/prevencion/cgrd/mapa/actions.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  addRiskMapMarker,
  removeRiskMapMarker,
} from "@/lib/services/prevention-risk-map"
import type { RiskLegalAccess } from "@/lib/services/prevention-risk-legal"
import type { ActionState } from "@/lib/validation/prevention"

/*
 * El mapa exige `prevention:risk:edit`, no un permiso del CGRD: los marcadores
 * son entradas de la matriz IPER publicada. Mudar la pantalla a CGRD no mudó
 * el dato. Ver docs/superpowers/specs/2026-09-22-mapa-riesgos-en-cgrd-design.md.
 */
const REVALIDATE = "/prevencion/cgrd/mapa"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): RiskLegalAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

async function run(access: RiskLegalAccess, operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return unexpectedActionError(error, "prevencion/cgrd/mapa/actions")
  }
}

export async function addRiskMapMarkerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addRiskMapMarker(input, access))
}

export async function removeRiskMapMarkerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => removeRiskMapMarker(input, access))
}
```

Se conserva la revalidación de `/prevencion/pdtp/cobertura`: el mapa alimenta el requisito Oro `risk_map` de la certificación, y esa vista lo refleja.

- [ ] **Step 7: Quitar el bloque del mapa de las acciones de MIPER**

En `app/(app)/prevencion/miper/actions.ts`, borrar el separador `/* ── Mapa de riesgos ── */` y las dos acciones (líneas 153-166), y borrar el import que queda sin uso:

```ts
import {
  addRiskMapMarker,
  removeRiskMapMarker,
} from "@/lib/services/prevention-risk-map"
```

- [ ] **Step 8: Confirmar que el import de acciones del panel no requiere cambios**

El panel ya importa con ruta relativa (`risk-map-panel.tsx:15`):

```ts
import { addRiskMapMarkerAction, removeRiskMapMarkerAction } from "./actions"
```

Como el panel y el nuevo `actions.ts` quedan en la misma carpeta (`app/(app)/prevencion/cgrd/mapa/`), ese import resuelve solo al archivo creado en el Step 6. **No se edita.** Verificarlo con:

```bash
grep -n 'from "./actions"' "app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx"
```

Expected: una coincidencia, en la línea 15.

- [ ] **Step 9: Declarar el redirect permanente**

En `next.config.ts`, dentro del array que devuelve `redirects()`, junto a los demás redirects de `/prevencion`:

```ts
      // El mapa de riesgos (DS 44 art. 62) se trasladó a CGRD el 2026-09-22.
      { source: "/prevencion/miper/mapa", destination: "/prevencion/cgrd/mapa", permanent: true },
```

Debe quedar antes de cualquier patrón que capture `/prevencion/miper/:path*`. Hoy no existe ninguno.

- [ ] **Step 10: Mover los dos tests de contrato del panel a un archivo propio**

Crear `lib/__tests__/risk-map-ui-contract.test.ts` con los dos tests que hoy viven en `miper-ui-contract.test.ts` (líneas 26-34 y 113-120), apuntando a la ruta nueva. Dejan de ser contrato de la MIPER:

```ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8")

const PANEL = "app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx"

describe("contratos React del mapa de riesgos", () => {
  it("permite activar el plano de riesgos con teclado cuando es editable", () => {
    const riskMap = source(PANEL)

    expect(riskMap).toContain("onKeyDown={handleKeyDown}")
    expect(riskMap).toContain("tabIndex={canEdit ? 0 : undefined}")
    expect(riskMap).toContain('event.key !== "Enter" && event.key !== " "')
    expect(riskMap).toContain("setPendingPoint({ xPct: 50, yPct: 50 })")
    expect(riskMap).toContain("Plano de riesgos: clic para ubicar un marcador")
  })

  it("conserva la faena elegida del mapa cuando una mutación refresca los datos", () => {
    const riskMap = source(PANEL)

    expect(riskMap).toContain('searchParams.get("mapWorksite")')
    expect(riskMap).toContain('params.set("mapWorksite", value)')
    expect(riskMap).toContain("onValueChange={navigateWorksite}")
    expect(riskMap).toContain('router.replace(qs ? `?${qs}` : "", { scroll: false })')
  })
})
```

Borrar esos dos mismos tests de `lib/__tests__/miper-ui-contract.test.ts`. Los demás tests de ese archivo (fecha estable de SSR, tab activo, devolver a borrador) **no** se tocan.

- [ ] **Step 11: Correr los tests unitarios afectados**

Run: `npx vitest run lib/__tests__/risk-map-ui-contract.test.ts lib/__tests__/miper-ui-contract.test.ts`
Expected: PASS ambos archivos, sin tests omitidos.

- [ ] **Step 12: Typecheck y lint**

Run: `npm run typecheck && npm run lint`
Expected: sin errores. El typecheck es la red que atrapa un import relativo mal ajustado tras el `git mv`.

- [ ] **Step 13: Correr el e2e del mapa, incluido el redirect**

Run: `npx playwright test e2e/prevencion-cgrd-risk-map.spec.ts`
Expected: PASS los dos tests — el flujo de plano y marcadores en la ruta nueva, y el redirect desde la vieja (que en el Step 2 fallaba).

- [ ] **Step 14: Commit**

```bash
git add "app/(app)/prevencion/cgrd/mapa" "app/(app)/prevencion/miper/actions.ts" \
        next.config.ts lib/__tests__/risk-map-ui-contract.test.ts \
        lib/__tests__/miper-ui-contract.test.ts e2e/
git commit -m "refactor(prevencion): mover la pantalla del mapa de riesgos a /prevencion/cgrd/mapa

La ruta anterior redirige permanente. Las acciones del marcador se separan de
las de MIPER y revalidan la ruta nueva, conservando prevention:risk:edit: los
marcadores son entradas de la matriz IPER publicada, y mudar la pantalla no
mudó el dato.

Los dos contratos de UI del panel salen de miper-ui-contract y pasan a un
archivo propio; dejaron de describir la MIPER.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Colgar el mapa de la navegación del CGRD

**Files:**
- Modify: `modules/prevention/manifest.ts:382-391` (eliminar), `:493-500` (agregar `children`)
- Modify: `lib/__tests__/navigation.test.ts:175-188`
- Modify: `scripts/capture-all-routes.ts:762`

**Interfaces:**
- Consumes: la ruta `/prevencion/cgrd/mapa` de la Tarea 2.
- Produces: la entrada de navegación. Nada posterior depende de ella.

- [ ] **Step 1: Actualizar el test de navegación (falla primero)**

En `lib/__tests__/navigation.test.ts`, reemplazar el bloque de las líneas 175-188:

```ts
  // El mapa de riesgos (DS 44 art. 62) se trasladó a CGRD el 2026-09-22, pero
  // sigue siendo un destino propio: sin el desempate por prefijo más largo,
  // entrar al mapa dejaría las dos filas resaltadas.
  it("keeps CGRD and Mapa de riesgos as distinct destinations", () => {
    expect(isHrefActive("/prevencion/cgrd", "/prevencion/cgrd")).toBe(true)
    expect(isHrefActive("/prevencion/cgrd", "/prevencion/cgrd/mapa")).toBe(false)
    expect(isHrefActive("/prevencion/cgrd/mapa", "/prevencion/cgrd/mapa")).toBe(true)
    expect(isHrefActive("/prevencion/cgrd/mapa", "/prevencion/cgrd")).toBe(false)
    // Las subrutas de la MIPER siguen perteneciendo a la MIPER.
    expect(isHrefActive("/prevencion/miper", "/prevencion/miper/controles/ctl-1")).toBe(true)
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/__tests__/navigation.test.ts -t "distinct destinations"`
Expected: FAIL — `/prevencion/cgrd/mapa` todavía no es una entrada de navegación.

- [ ] **Step 3: Eliminar la entrada del grupo "Programa"**

En `modules/prevention/manifest.ts`, borrar completo el objeto de las líneas 382-391 (el que tiene `label: "Mapa de riesgos"`, `href: "/prevencion/miper/mapa"`, `iconName: "MapPin"`, `group: "Programa"`). El grupo "Programa" queda con Matriz IPER y Requisitos legales.

- [ ] **Step 4: Agregar el mapa como hijo del CGRD**

En el mismo archivo, la entrada del CGRD (líneas ~493-500) pasa a:

```ts
        {
          // DS 44: comité propio de riesgo de desastres, distinto del CPHS.
          label: "Gestión de riesgos de desastres",
          href: "/prevencion/cgrd",
          iconName: "Mountains",
          group: "Cumplimiento del programa",
          permissions: ["prevention:cgrd:view"],
          children: [
            {
              // DS 44 art. 62: instrumento exigible por sí mismo, que el
              // fiscalizador pide por separado — por eso es un destino propio y
              // no una sección más del workbench. Sus marcadores son peligros de
              // la matriz IPER publicada (art. 7), así que el permiso sigue
              // siendo el de riesgo y no el del CGRD: un rol con cgrd:view pero
              // sin risk:view (admin_contrato) no verá esta fila, y eso es
              // deliberado.
              label: "Mapa de riesgos",
              href: "/prevencion/cgrd/mapa",
              permissions: ["prevention:risk:view"],
            },
          ],
        },
```

El patrón de un hijo con permiso distinto del padre ya existe en este archivo: "Aprobaciones" (líneas 352-356) exige `prevention:pdtp:approve` bajo un padre que exige `prevention:pdtp:view`.

- [ ] **Step 5: Correr los tests de navegación y permisos**

Run: `npx vitest run lib/__tests__/navigation.test.ts lib/__tests__/prevention-rbac.test.ts`
Expected: PASS. El test de grupos de navegación (`NAV_GROUP_ORDER`) debe seguir verde: el grupo "Programa" pierde una entrada pero no desaparece.

- [ ] **Step 6: Actualizar la ruta de captura de pantallas**

En `scripts/capture-all-routes.ts`, la línea 762:

```ts
  { slug: "prevencion-cgrd-mapa", path: "/prevencion/cgrd/mapa", auth: true, notes: "Mapa de riesgos: instrumento propio del DS 44 art. 62, alojado en CGRD desde el 2026-09-22." },
```

Moverla junto a la entrada `prevencion-cgrd` si existe, para que el archivo siga agrupado por módulo.

- [ ] **Step 7: Correr el test del script de captura**

Run: `npx vitest run scripts/capture-all-routes.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add modules/prevention/manifest.ts lib/__tests__/navigation.test.ts \
        lib/__tests__/module-toggles.test.ts scripts/capture-all-routes.ts
git commit -m "feat(prevencion): colgar el mapa de riesgos de la navegación del CGRD

Sale del grupo Programa y pasa a ser hijo de Gestión de riesgos de desastres,
conservando prevention:risk:view. El hijo con permiso distinto del padre sigue
el patrón que ya usa Aprobaciones bajo PDTP.

Consecuencia deliberada: admin_contrato tiene cgrd:view pero no risk:view, así
que no verá la fila. La corrección, si alguna vez se decide, es otorgarle
risk:view, no mover el permiso de la pantalla.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Trasladar la documentación y reescribir los comentarios normativos

**Files:**
- Modify: `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md:66-78`
- Modify: `docs/manual-prevencion/parte-4-gobernanza-y-seguimiento/17-gestion-riesgo-desastres-cgrd.md`
- Modify: `docs/manual-prevencion/README.md` (si nombra la ruta del mapa)

**Interfaces:**
- Consumes: la ruta y la navegación de las Tareas 2 y 3.
- Produces: nada que otra tarea consuma.

- [ ] **Step 1: Mover la sección del manual al capítulo 17**

Cortar la sección "El Mapa de Riesgos en Terreno" (líneas 66-78 del capítulo 04) y pegarla al final del capítulo 17, como sección 5, con la ruta nueva y una advertencia que hoy falta:

```markdown
---

## 5. El Mapa de Riesgos en Terreno (DS 44 Art. 62)

> **Ruta en Plataforma:** Menú > Cumplimiento del programa > Gestión de riesgos de desastres > **Mapa de riesgos** (`/prevencion/cgrd/mapa`).

El mapa de riesgos es un instrumento **distinto de la Matriz GRD** de este mismo
capítulo, y distinto también de la Matriz IPER: es la representación gráfica del
plano de la faena que localiza dónde están los mayores peligros físicos. Sirve de
inducción visual para visitas, transportistas y personal nuevo, y debe estar
visible en el lugar de trabajo.

> [!IMPORTANT]
> Los marcadores del mapa salen de la **Matriz IPER publicada** de la faena
> (capítulo 4), no de la Matriz GRD de amenazas. Una faena sin MIPER publicada
> verá el mapa vacío, y al publicar una revisión de la MIPER los marcadores se
> reubican solos sobre los peligros que sobreviven. El mapa **no acredita ninguna
> actividad del PDTP**; sí cuenta para el requisito Oro de la certificación CPHS.

Contenidos que se esperan sobre el plano: segregación peatón/maquinaria, zonas de
ruido (PREXOR), SUSPEL, vías de evacuación y puntos de encuentro.

**Consejo:** mantener una copia plastificada en gran formato en la entrada y en la
sala de inducciones.
```

- [ ] **Step 2: Dejar el puntero en el capítulo 04**

Donde estaba la sección movida, en el capítulo 04:

```markdown
---

## El Mapa de Riesgos

El mapa de riesgos (DS 44 Art. 62) se trasladó al **capítulo 17 — Gestión del
Riesgo de Desastres** (`/prevencion/cgrd/mapa`).

Se documenta allá, pero sus marcadores salen de la matriz IPER que describe este
capítulo: al publicar una revisión de la MIPER, cada marcador se reubica sobre el
peligro equivalente de la versión nueva, y el marcador de un peligro que
desaparece se elimina. Si trabajas la MIPER, ese es el efecto que tu publicación
tiene sobre el mapa.
```

- [ ] **Step 3: Corregir el encabezado y el índice del capítulo 04**

El título del archivo y su entrada en `docs/manual-prevencion/README.md` mencionan ambos instrumentos. Revisar con:

```bash
grep -rn "mapa-riesgos\|Mapa de Riesgos\|mapa de riesgos" docs/manual-prevencion/README.md docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md docs/manual-prevencion/anexos/
```

Actualizar cada mención de la ruta `/prevencion/miper/mapa` a `/prevencion/cgrd/mapa`. **No renombrar el archivo** `04-miper-mapa-riesgos.md`: el capítulo conserva el puntero y renombrarlo rompería enlaces del manual sin ganar nada.

- [ ] **Step 4: Declarar la actividad PDTP en el capítulo 17**

En la cabecera del capítulo 17, donde dice `**Actividades PDTP Asociadas:** N° 79 … N° 80 … N° 81`, agregar una línea para que nadie suponga que el mapa acredita:

```markdown
> **Nota:** el Mapa de Riesgos (sección 5) no acredita ninguna actividad del PDTP; es exigible por el DS 44 Art. 62 y cuenta para el requisito Oro de la certificación CPHS.
```

- [ ] **Step 5: Verificar que no quedan rutas viejas en la documentación**

Run: `grep -rn "prevencion/miper/mapa" docs/ app/ lib/ modules/ scripts/ e2e/ next.config.ts`
Expected: una sola coincidencia, la del `source` del redirect en `next.config.ts`. Cualquier otra es una referencia sin actualizar.

- [ ] **Step 6: Commit**

```bash
git add docs/manual-prevencion/
git commit -m "docs(prevencion): trasladar el mapa de riesgos al capítulo del CGRD

El capítulo 4 conserva un puntero, porque los marcadores salen de la matriz IPER
que ese capítulo describe y quien publica una revisión necesita saber que reubica
el mapa.

Agrega lo que el manual no decía: que el mapa no acredita ninguna actividad del
PDTP, y que una faena sin MIPER publicada lo verá vacío.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificación completa y cierre

**Files:** ninguno nuevo. Esta tarea solo ejecuta y reporta.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la evidencia que el contrato del repo exige antes de declarar el cambio hecho.

- [ ] **Step 1: Correr todas las puertas deterministas**

```bash
npm run typecheck
npm run lint
npm run check:secrets
npm run test:fast
npm run test:pglite
npm run test:e2e
```

Expected: todas verdes. `npm run db:verify-migrations` debe seguir verde también, aunque este cambio no agrega migraciones.

**Si `test:pglite` reporta suites omitidas**, el contenedor de Postgres del puerto 55432 no está arriba: levantarlo y repetir. Una suite que se salta sola no es una suite que pasa.

- [ ] **Step 2: Verificar en el navegador con permiso de riesgo**

Con un usuario que tenga `prevention:risk:view` y `prevention:risk:edit` (por ejemplo rol `prevencionista`):

1. Entrar a `/prevencion/cgrd` y comprobar que "Mapa de riesgos" aparece como hijo en el menú.
2. Abrir el mapa y comprobar que la fila del menú resaltada es la del mapa, no la del CGRD.
3. Subir un plano en una faena con MIPER publicada, colocar un marcador y quitarlo.
4. Abrir `/prevencion/miper/mapa` y comprobar que redirige a `/prevencion/cgrd/mapa`.
5. Comprobar que no hay errores de consola ni peticiones de red fallidas.

- [ ] **Step 3: Verificar el caso del permiso ausente**

Con un usuario de rol `admin_contrato` (tiene `cgrd:view`, no tiene `risk:view`):

1. Entrar a `/prevencion/cgrd` y comprobar que la página carga normal.
2. Comprobar que "Mapa de riesgos" **no** aparece en el menú.
3. Comprobar que no hay error ni 403 visible: la fila simplemente no está.

- [ ] **Step 4: Verificar que la certificación CPHS sigue acreditando**

El requisito Oro `risk_map` (`lib/prevention/cphs-certification.ts:353-360`) se cumple con `riskMapActive && riskMapMarkerCount > 0`. Con el marcador creado en el Step 2, abrir la pantalla de certificación del CPHS de esa faena y comprobar que el requisito figura cumplido. Es una verificación por datos, no por ruta, y debe pasar sin cambios — si falla, algo del traslado tocó lo que no debía.

- [ ] **Step 5: Reportar**

Informar: qué se movió, qué puertas se corrieron con su resultado, qué se verificó en navegador y con qué roles, y qué quedó fuera de alcance (las dos deudas de las secciones 10 y 11 del spec: la colisión de nombres con la matriz GRD de amenazas, y la desalineación del manual sobre zonificación y descarga).

---

## Registro de ejecución (2026-09-22)

Rama `feat/mapa-riesgos-en-cgrd`. Cuatro commits, uno por tarea:

| Tarea | Commit | Resultado |
|---|---|---|
| 1. API | `d14663f5` | `/api/prevencion/cgrd/mapa` + module-toggle |
| 2. Pantalla | `297fd72d` | `/prevencion/cgrd/mapa` + redirect + acciones propias |
| 3. Navegación | `2a513522` | hija del CGRD, con `prevention:risk:view` |
| 4. Documentación | `15eb884d` | capítulo 17 + puntero en el 4 |

### Desviaciones del plan

1. **Ocho archivos de PDTP sin commitear** aparecieron en el árbol al empezar
   (trabajo en curso de otra sesión). Cada commit usó rutas explícitas en vez de
   `git add -A`, y esos archivos quedaron intactos. El plan se corrigió a media
   ejecución para que la regla quedara escrita.
2. **`not-found-suggestion.test.ts` no requirió cambios** — declara
   `/prevencion/miper` y nunca el mapa. El spec lo listaba por precaución.
3. **El orden de las entradas de `module-toggles` no decide nada**: el array se
   ordena por longitud de prefijo (`module-toggles.ts:212`). Se agregó igual un
   caso al test, porque esa garantía vive en una línea de `sort` que nadie asocia
   con el mapa.
4. **El import de acciones del panel no se editó**: ya era relativo (`./actions`),
   así que resolvió solo al archivo nuevo de la misma carpeta.
5. **Cinco referencias a la ruta anterior que el plan no previó.** Una era un
   fallo real: `e2e/prevencion-miper-matriz.spec.ts:29` asertaba
   `toHaveURL(/\/prevencion\/miper\/mapa/)` y habría fallado al redirigir. Las
   otras cuatro eran comentarios y `docs/plan.yml`.
6. **`docs/generado/` está en `.gitignore`** y todavía nombra la ruta anterior.
   Se regenera; no se tocó a mano.
7. **Tres tests más de los planificados**: el positivo de navegación (un rol con
   ambos permisos SÍ ve el mapa — sin él, el negativo pasaría igual si la
   navegación se rompiera entera), el desempate de `module-toggles`, y que el
   panel consuma la API en su ruta de CGRD (esa URL se arma como string, así que
   el typecheck no la protege).

### Rojo del redirect, demostrado

El test del redirect se ejecutó en rojo **quitando el redirect y rebuildeando**,
no solo en verde:

```
✘ la ruta anterior del mapa redirige a CGRD
  Expected pattern: /\/prevencion\/cgrd\/mapa$/
  Received string:  "http://localhost:3100/prevencion/miper/mapa"
```

El redirect se restauró con `git checkout` y la suite volvió a verde. Un test de
redirect que nunca se vio fallar por la razón correcta no protege nada.
