# MIPER — plan de implementación de la Fase A2 (pulido)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 17 puntos de pulido de la Fase A (tabla «A2. Pulido de la Fase A» del plan
maestro): el scroll sólo vuelve con Atrás/Adelante, la tira de pasos cabe a 390 px, cada gesto tiene
un solo nombre, la ficha no pierde lo escrito, las medidas y la observación muestran sus errores, el
`Combobox` y «Este riesgo ya no existe» no dejan cabos sueltos, axe recorre el espacio de trabajo,
la tarjeta «Siguiente paso» tiene la lógica que le faltaba y se escriben las pruebas pendientes.

**Architecture:** Todo vive donde ya lo dejó la Fase A. La lógica pura está en
`lib/prevention/miper/`. Las vistas están en `app/(app)/prevencion/miper/[id]/`. La memoria de vista
(scroll, actividades plegadas y, desde ahora, el borrador de la ficha) está en `workspace-memory.ts`
sobre `sessionStorage`. La navegación con historial nativo está en `workspace-nav.tsx`. Lo que es
comportamiento compartido se corrige en su primitiva: `TabsList` centra la pestaña activa dentro de
su tira, `ConfirmDialog` gana `error`, `Combobox` gana ✕ para el valor libre y respeta el hover, y
`ChoiceCardGroup` gana `aria-describedby` y Home/End. Del servicio sólo cambian dos textos
(`STALE_ENTRY` y `STALE_CONTROL`).

**Tech Stack:** Next.js 16.3 (App Router). Antes de tocar navegación, leer
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` y
`node_modules/next/dist/docs/01-app/02-guides/interactive-apps.md` (§«Filter with pending
feedback»). React 19, TypeScript, Tailwind v4, Radix, Vitest + Testing Library (jsdom;
`@testing-library/jest-dom` ya viene cargado en `components/__tests__/setup.ts`), Playwright y
`@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` (§3, §5.1, §5.4–§5.7,
§6, §12). Alcance: plan maestro `/home/allopze/.claude/plans/revisa-el-ui-ux-de-stateful-zebra.md`,
sección «A2». Hallazgos de origen: `qa/reports/2026-10-02-miper-ui-fase-a.md`.

## Global Constraints

- **Sin cambios de esquema ni migraciones. Las acciones de servidor no cambian de firma.** El único
  cambio de servicio es el texto de `STALE_ENTRY` y `STALE_CONTROL` en
  `lib/services/miper/entries.ts` (Task 3). Por ese cambio se corre
  `npm run test:pglite -- lib/__tests__/miper-entries.test.ts`.
- Toda página sigue con `PageHeader` + `PageContainer`. **Ningún `<h1>` propio** y **ningún
  buscador nuevo**: `/prevencion/miper/[id]` sigue en `OWN_SEARCH_PATTERNS`.
- **Color de texto:** sólo tokens `-ink` (`--color-danger-ink`, `--color-warning-ink`…).
- **El orange `signal` no indica «filtro activo».** Para eso se usa `--color-primary-tint` /
  `--color-primary-ink`.
- **Validación:** los mensajes van en texto visible, nunca sólo en `title`. Los errores de servidor
  van en `role="alert"`. El estado de guardado sigue en `aria-live="polite"`.
- **Estados:** nunca un enum crudo. Se usan `CLASSIFICATION_LABEL`, `CONTROLLED_STATUS_LABEL` y
  `CONTROL_HIERARCHY_LABEL`.
- **Fechas:** `DatePicker` y `formatDate`. Nunca `toLocaleDateString` ni `<input type="date">`.
- **Sin árboles duplicados** `md:hidden` / `hidden md:block`.
- **Navegación dentro del espacio de trabajo:** con `navigateWorkspace` / `WorkspaceLink`
  (`app/(app)/prevencion/miper/[id]/workspace-nav.tsx`), con historial nativo y sin ida al
  servidor. `router.push` / `router.replace` quedan sólo donde el servidor tiene que traer datos
  nuevos (crear, duplicar y borrar un riesgo). **Toda navegación hacia adelante pasa por
  `beforeForwardNavigation(href)`** (Task 1): las de `navigateWorkspace` (push y replace) y los tres
  `router.push`.
- **Commits:** en español, `fix(miper): …` / `feat(miper): …` / `test(miper): …` /
  `docs(miper): …`. Cuerpo final con una línea en blanco y
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, que es lo que produce el segundo `-m`:
  `git commit -m "<asunto>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
  `git add` con rutas explícitas y entre comillas. **Nunca** `git add -A` ni `git add .` desde la
  raíz, y **nunca** `.gitignore` (el usuario lo tiene modificado a propósito).
- **Rama:** `feat/miper-a2-pulido` (ya creada desde `main` 71f65ff7).
- **Antes de cada commit:**
  - `npm run typecheck`;
  - `npm run lint -- <archivos tocados>` (el guard pasa los argumentos a `eslint`).
- **Pruebas unitarias:**
  - Comando: `npm run test:fast -- <archivo>`, con las rutas de `app/(app)/…` entre comillas.
  - Las de componentes empiezan con `// @vitest-environment jsdom` en la primera línea.
  - Mockean `next/navigation`, `../actions` (o `../../actions` desde `risk-editor/`) y
    `@/lib/toast`, como `risk-editor.test.tsx`.
- **E2E sólo desde un worktree desechable.** `e2e/start-server.sh` hace `rm -rf .next` y
  reconstruye, lo que rompería el `next dev` del usuario en :3001.
  - **Qué hace falta:**
    - No hace falta copiar ningún archivo de entorno. `scripts/run-e2e.sh` levanta o reusa el
      contenedor `bodega-e2e-postgres` (127.0.0.1:55432) y exporta `E2E_DATABASE_URL`.
    - `playwright.config.ts` sólo necesita esa variable para declarar el `webServer`.
    - `e2e/start-server.sh` pasa explícitos `DATABASE_URL`, `AUTH_*`, `APP_URL`, `NEXTAUTH_URL`,
      `PDF_RENDER_ORIGIN`, `STORAGE_PATH`, SMTP y los demás, para el sembrado, la build y el
      servidor.
    - `e2e/setup-db.ts` llama a `loadEnvConfig(process.cwd())`, pero recibe `DATABASE_URL`
      explícito.
    - CI corre exactamente así, sin ningún `.env*`: sólo `.env.example` está versionado.
  - **No copiar `.env.local`**: apunta a `bodega_dev` y `next build` lo leería.
  - **Receta:**

    ```bash
    cd /home/allopze/dev/chome/bodega
    SHA=$(git rev-parse --short HEAD)
    git worktree add /tmp/bodega-e2e-$SHA HEAD
    ln -s /home/allopze/dev/chome/bodega/node_modules /tmp/bodega-e2e-$SHA/node_modules
    # :3100 tiene que estar libre: con `reuseExistingServer: true`, Playwright usaría un servidor viejo.
    ss -ltnp | grep ':3100 ' && echo "OCUPADO: matar por PID (ss -ltnp), nunca pkill -f"
    cd /tmp/bodega-e2e-$SHA
    npm run test:e2e -- e2e/<spec>.spec.ts                       # el primero construye (minutos)
    E2E_SKIP_BUILD=true npm run test:e2e -- e2e/<otro>.spec.ts   # los siguientes reusan la build si no cambió el código
    cd /home/allopze/dev/chome/bodega
    git worktree remove --force /tmp/bodega-e2e-$SHA
    ```

  - Siempre **un spec por corrida**. El worktree toma sólo lo **commiteado**: primero se hace el
    commit y después se corre.
  - Si una E2E falla, abrir el trace (`npx playwright show-trace test-results/…/trace.zip`) antes de
    tocar el localizador.
- **Localizadores E2E** (AGENTS.md, «Locators in this repository»):
  - Siempre por rol.
  - `exact: true` cuando un nombre es prefijo de otro («Agregar medida», «Limpiar filtros»).
  - Lo de la cabecera se acota a `cabecera(page)` (`getByRole("banner")`).
  - Nada de `.first()` para esquivar el modo estricto.

## Review Focus

1. **Scroll restaurado por una navegación hacia adelante, o Atrás que deja de restaurar.**
   - Riesgo: si la clave del destino no tiene exactamente la forma de `currentViewUrl()` (ruta +
     query, sin origen), no se borra. Y si el borrado alcanza a Atrás, se pierde la regresión I2 de
     la Fase A.
   - Lo fijan, en la Task 1:
     - `workspace-memory.test.ts`: «el destino se reconoce aunque venga absoluto»;
     - `workspace-nav.test.tsx`: push y replace;
     - las pruebas de `router.push` en `task-view.test.tsx`, `new-task-dialog.test.tsx` y
       `risk-editor.test.tsx`;
     - la E2E nueva «sólo Atrás restaura el scroll…»;
     - la E2E existente «volver de una tarea a la matriz conserva el scroll…».
2. **Borrador de la ficha ofrecido donde no corresponde.**
   - Un borrador de otra versión (otra persona guardó la ficha) pisaría datos ajenos.
   - Un borrador ya recuperado, guardado o descartado no puede volver a ofrecerse.
   - Lo fijan, en la Task 4 (`ficha-sheet.test.tsx`): «un borrador de otra versión no se ofrece» y
     «guardar y «Cerrar sin guardar» borran el borrador».
3. **El diálogo de borrar medida no se queda abierto cuando falla.**
   - Riesgo: se cierra antes de la respuesta, o con Escape mientras espera, y el motivo del rechazo
     se pierde.
   - Lo fijan, en la Task 5 (`control-card.test.tsx`): «el diálogo espera el borrado» y «si el
     borrado falla, el motivo se ve en el diálogo».
4. **Un filtro se pierde por leer una URL atrasada.**
   - Riesgo: `useMatrixFilterNavigation` arma la URL con el `useSearchParams` del último render.
     Quitar un chip justo después de un `replaceState` de la búsqueda borraba el filtro que React
     aún no había pintado.
   - Lo fija, en la Task 8 (`matrix-filters-bar.test.tsx`): «aplica el cambio sobre la URL vigente
     aunque el render traiga la anterior».
5. **`Combobox`: el hover rompe la guarda del «recién enfocado», o la ✕ confirma lo escrito.**
   - Pasar el mouse por una opción y apretar Enter tiene que elegir esa opción.
   - Enter recién enfocado y sin hover tiene que seguir conservando el valor.
   - La ✕ de un valor libre limpia sin confirmar el texto.
   - Lo fijan, en la Task 6 (`combobox.test.tsx`): las tres pruebas nuevas más la existente «Enter
     recién enfocado, sin escribir, conserva el valor».

---

## Mapa de archivos

| Archivo | Fila(s) A2 | Task |
|---|---|---|
| `app/(app)/prevencion/miper/[id]/workspace-memory.ts` (+test) | 1, 8 | 1, 4 |
| `app/(app)/prevencion/miper/[id]/workspace-nav.tsx` (+test) | 1 | 1 |
| `app/(app)/prevencion/miper/[id]/task-view.tsx` (+test) | 1, 12 | 1, 3 |
| `app/(app)/prevencion/miper/[id]/new-task-dialog.tsx` (+test) | 1, 16 | 1, 9 |
| `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx` (+test) | 1, 2, 12, 13 | 1, 2, 3, 6 |
| `components/ui/tabs.tsx` (+test) | 2 | 2 |
| `app/(app)/prevencion/miper/[id]/miper-workspace.tsx` (+ test nuevo) | 3, 15, 16 | 3, 8, 9 |
| `lib/services/miper/entries.ts`, `lib/__tests__/miper-entries.test.ts` | 4 | 3 |
| `lib/prevention/miper/next-step.ts` (+test), `app/(app)/prevencion/miper/[id]/next-step-card.tsx` (+test) | 5, 15 | 3, 8 |
| `app/(app)/prevencion/miper/[id]/matrix-view.tsx` (+test) | 6 | 3 |
| `lib/prevention/miper/matrix-filters.ts` (+test), `app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx` (+test) | 7, 15 | 3, 8 |
| `app/(app)/prevencion/miper/[id]/risk-row.tsx` | 12 | 3 |
| `app/(app)/prevencion/miper/[id]/antecedentes-form.tsx`, `ficha-sheet.tsx` (+test) | 8 | 4 |
| `components/ui/confirm-dialog.tsx` (+ test nuevo) | 9 | 5 |
| `app/(app)/prevencion/miper/[id]/control-form.tsx` (+ test nuevo), `control-card.tsx` (+test), `risk-editor/measures-step.tsx` | 9 | 5 |
| `app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx` | 10, 14 | 5, 7 |
| `components/ui/combobox.tsx` (+test) | 11 | 6 |
| `app/(app)/prevencion/miper/[id]/risk-editor/risk-aside.tsx` | 14 | 7 |
| `components/ui/choice-card-group.tsx` (+test) | 14 | 7 |
| `app/(app)/prevencion/miper/[id]/summary-strip.tsx` (+ test nuevo) | 14 | 7 |
| `e2e/accessibility.spec.ts`, `e2e/accessibility-targets.ts` (+test), `e2e/miper-helpers.ts` | 17 | 7 |
| `components/prevention/pc-choice.tsx` (+test) | 15 | 8 |
| `lib/prevention/miper/entry-navigation.test.ts`, `lib/prevention/miper/workspace-url.test.ts` | 16 | 9 |
| `e2e/prevencion-miper-interacciones.spec.ts` | 1 | 1 |
| `e2e/prevencion-miper-escenario.spec.ts` (sólo un comentario) | 15 | 8 |
| `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`, spec, `qa/reports/<fecha>-miper-a2.md` | todas | 10 |

**Textos visibles que cambian y E2E afectadas** (grep sobre `e2e/*.spec.ts` y
`e2e/miper-helpers.ts`, hecho al escribir este plan):

- **Fila 4:** las E2E sólo afirman el prefijo «La fila cambió mientras la editabas»
  (`interacciones.spec.ts:171,172,181`), que se conserva. No cambian.
- **Fila 5:** «Empezar por el más grave» no aparece en ninguna E2E: no hay nada que ajustar.
  «Siguiente pendiente» se usa en `interacciones.spec.ts:206,218`, pero dentro del editor, donde
  la tarjeta no se pinta (`nextStepInView`), así que no hay dos enlaces con el mismo nombre.
- **Filas 6 y 7:** ninguna E2E de MIPER usa «Limpiar filtros», el chip «Búsqueda» ni «Eliminar
  filtro Búsqueda». No cambian.
- **Fila 10:** `flujo.spec.ts:159` y `escenario.spec.ts:261` usan
  `getByLabel("Nueva observación")`, que sigue resolviendo al textarea por su `<label>` asociado.
  No cambian.
- **Fila 14:** `elegir(page, "Probabilidad", /^4 · Alta/)` sigue calzando porque el nombre pasa a
  ser sólo el título. Se ajusta el comentario de `elegir` (Task 7). Las regiones «Observaciones
  del riesgo» y «Programa de Trabajo del riesgo» (`flujo:161`, `escenario:263,431`,
  `programa:313`) **no** se tocan, porque su `aria-label` no repite el título.
- **Fila 15:** los títulos pasan de «riesgo(s)», «dato(s)» y «observación(es)» a plural real.
  Ninguna E2E los afirma. Sólo cambia un comentario en `escenario.spec.ts:457`.

---

### Task 1: Memoria de scroll: sólo Atrás/Adelante restauran (fila 1)

**Files:**
- Modify: `app/(app)/prevencion/miper/[id]/workspace-memory.ts`, `app/(app)/prevencion/miper/[id]/workspace-nav.tsx`, `app/(app)/prevencion/miper/[id]/task-view.tsx`, `app/(app)/prevencion/miper/[id]/new-task-dialog.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx`, `e2e/prevencion-miper-interacciones.spec.ts`
- Test: `app/(app)/prevencion/miper/[id]/workspace-memory.test.ts`, `app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx`, `app/(app)/prevencion/miper/[id]/task-view.test.tsx`, `app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`

**Interfaces:**
- Consumes: `rememberScroll`, `shellScroll`, `currentViewUrl` (`./workspace-memory`), `hrefToEntry` (`@/lib/prevention/miper/workspace-url`).
- Produces (en `workspace-memory.ts`):
  - `forgetScroll(url: string): void`
  - `viewUrlOf(href: string): string`
  - `beforeForwardNavigation(href: string): void`
- Cambio de conducta: `navigateWorkspace(href, "push" | "replace")` llama a
  `beforeForwardNavigation(href)` en los dos modos. Sólo `push` sube el pozo.

**Regla (plan maestro):**
- En **cada** navegación hacia adelante se guarda el scroll actual y **se borra la clave del
  destino**:
  - en `navigateWorkspace`, con push y con replace;
  - en los tres `router.push`: «Agregar peligro», «Nueva tarea» y «Duplicar riesgo».
- No se usa un flag de `popstate`.
- **No se toca** el `router.replace(afterDeleteHref)` de «Eliminar riesgo»: el plan maestro lista
  tres sitios. Tras borrar, la matriz o la tarea retoman donde estaba la persona, que es lo esperable
  después de un borrado.
- Consecuencias que hay que conocer y documentar (Task 10):
  - «‹ Volver a la matriz» y «‹ Volver a la tarea» son pushes, así que **ya no** restauran. Sólo el
    botón Atrás del navegador lo hace.
  - Entrar al espacio de trabajo desde fuera con un `<Link>` de Next (la portada) no pasa por aquí.
    Si esa misma URL tenía una clave guardada en la pestaña, la restaura. Es una limitación del
    criterio sin `popstate` y se declara en el informe.

- [ ] **Step 1: Write the failing tests**

En `workspace-memory.test.ts`, cambiar el import y agregar al `describe`:

```ts
import { beforeForwardNavigation, readCollapsedActivities, readSavedScroll, rememberScroll, writeCollapsedActivities } from "./workspace-memory"
```

```ts
  it("antes de navegar hacia adelante guarda el scroll de la vista que se deja y olvida el del destino", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?buscar=cami")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?tarea=k", "300")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 480
    document.body.appendChild(well)
    try {
      beforeForwardNavigation("/prevencion/miper/m1?tarea=k")
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?buscar=cami")).toBe("480")
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k")).toBeNull()
    } finally {
      well.remove()
    }
  })

  it("el destino se reconoce aunque venga absoluto: la clave es ruta + query, como currentViewUrl()", () => {
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?tarea=k", "300")
    beforeForwardNavigation(`${window.location.origin}/prevencion/miper/m1?tarea=k`)
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k")).toBeNull()
  })

  it("fuera del shell (sin pozo) sólo olvida el destino", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?tarea=k", "300")
    beforeForwardNavigation("/prevencion/miper/m1?tarea=k")
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k")).toBeNull()
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1")).toBeNull()
  })
```

En la prueba existente «sin sessionStorage (modo privado, bloqueado) nada falla…», agregar la
línea del `removeItem` junto a los otros dos `spyOn`, y la aserción al final:

```ts
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("SecurityError") })
```

```ts
    expect(() => beforeForwardNavigation("/x?tarea=k")).not.toThrow()
```

En `workspace-nav.test.tsx`, reemplazar la prueba
`"antes del push guarda el scroll de la vista que se deja, por su URL; replace no guarda nada"`
(líneas 65–87) por:

```tsx
  it("push y replace guardan el scroll de la vista que se deja y olvidan el del destino; sólo push sube el pozo", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?buscar=cami")
    // Los dos cambian la URL de verdad: así la prueba distingue «la vista que se deja» de «el destino».
    const realReplace = window.history.replaceState.bind(window.history)
    const push = vi.spyOn(window.history, "pushState").mockImplementation((_state, _unused, url) => realReplace(null, "", url))
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, url) => realReplace(null, "", url))
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 480
    const scrollTo = vi.fn(() => { well.scrollTop = 0 })
    well.scrollTo = scrollTo as unknown as typeof well.scrollTo
    document.body.appendChild(well)
    // Claves viejas de los dos destinos: tienen que desaparecer.
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?paso=x", "90")
    sessionStorage.setItem(`miper:scroll:${HREF}`, "300")
    render(<><WorkspaceLink href={HREF}>Carga</WorkspaceLink><WorkspaceLink href="/prevencion/miper/m1?paso=x" replace>Paso</WorkspaceLink></>)

    // replace (cambiar de pestaña o de paso) también es ir hacia adelante.
    fireEvent.click(screen.getByRole("link", { name: "Paso" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?paso=x")
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?buscar=cami")).toBe("480")
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?paso=x")).toBeNull()
    expect(scrollTo).not.toHaveBeenCalled()

    // push desde la vista nueva: guarda ANTES de cambiar de URL y de subir el pozo.
    fireEvent.click(screen.getByRole("link", { name: "Carga" }))
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?paso=x")).toBe("480")
    expect(sessionStorage.getItem(`miper:scroll:${HREF}`)).toBeNull()
    expect(push).toHaveBeenCalledWith(null, "", HREF)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })
```

En `task-view.test.tsx`, agregar al `describe("TaskView", …)`:

```tsx
  it("«Agregar peligro» guarda el scroll de la tarea y olvida el del riesgo nuevo antes del router.push", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k&clasificacion=important")
    const destino = "/prevencion/miper/m1?clasificacion=important&fila=nuevo&paso=identificacion"
    sessionStorage.setItem(`miper:scroll:${destino}`, "500")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 240
    well.scrollTo = vi.fn()
    document.body.appendChild(well)
    router.push.mockClear()
    try {
      saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
      render(<TaskView {...base} editable />)
      fireEvent.click(screen.getByRole("button", { name: "Agregar peligro" }))
      await waitFor(() => expect(router.push).toHaveBeenCalledWith(destino))
      expect(sessionStorage.getItem(`miper:scroll:${destino}`)).toBeNull()
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k&clasificacion=important")).toBe("240")
    } finally {
      well.remove()
      sessionStorage.clear()
    }
  })
```

En `new-task-dialog.test.tsx`, agregar al `describe("NewTaskDialog", …)`:

```tsx
  it("antes de abrir el editor del riesgo creado guarda el scroll actual y olvida el del destino", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1")
    const destino = "/prevencion/miper/m1?fila=nuevo&paso=identificacion"
    sessionStorage.setItem(`miper:scroll:${destino}`, "500")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 360
    document.body.appendChild(well)
    router.push.mockClear()
    try {
      saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
      render(<NewTaskDialog open onOpenChange={() => {}} matrixId="m1" rows={rows} dictionaries={dictionaries} />)
      type("Actividad", "Oficina")
      type("Tarea", "Archivo")
      type("Puesto de trabajo", "Asistente")
      fireEvent.click(screen.getByRole("button", { name: "Crear tarea" }))
      await waitFor(() => expect(router.push).toHaveBeenCalledWith(destino))
      expect(sessionStorage.getItem(`miper:scroll:${destino}`)).toBeNull()
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1")).toBe("360")
    } finally {
      well.remove()
      sessionStorage.clear()
    }
  })
```

En `risk-editor/risk-editor.test.tsx`, reemplazar la línea 14 (el `vi.mock("../../actions", …)`)
por:

```ts
const duplicateMiperEntryAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Duplicado", data: { id: "e9", version: 1 } })))
vi.mock("../../actions", () => ({ duplicateMiperEntryAction, deleteMiperEntryAction, deleteMiperControlAction, addMiperObservationAction: vi.fn(), saveMiperControlAction, respondMiperObservationAction: vi.fn(), resolveMiperObservationAction: vi.fn(), reopenMiperObservationAction: vi.fn() }))
```

y agregar al `describe("RiskEditor", …)`:

```tsx
  it("«Duplicar riesgo» guarda el scroll del riesgo y olvida el de la copia antes del router.push", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?fila=e1")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?fila=e9", "300")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 120
    document.body.appendChild(well)
    router.push.mockClear()
    try {
      render(<RiskEditor {...props()} />)
      fireEvent.keyDown(screen.getByRole("button", { name: "Más acciones del riesgo 1" }), { key: "Enter" })
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicar riesgo" }))
      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m1?fila=e9"))
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?fila=e9")).toBeNull()
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?fila=e1")).toBe("120")
    } finally {
      well.remove()
      sessionStorage.clear()
    }
  })
```

En `e2e/prevencion-miper-interacciones.spec.ts`, cambiar el import de la línea 1:

```ts
import { test, expect, type Page } from "@playwright/test"
```

y agregar al final del archivo:

```ts
/**
 * Dos cuadros de animación: el del montaje de la vista y el de
 * `useRestoreWorkspaceScroll`, que restaura dentro de un `requestAnimationFrame`.
 * Pasados los dos, un scroll que no se restauró ya no se va a restaurar.
 */
const dosCuadros = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

test("sólo Atrás restaura el scroll: cambiar de pestaña o volver con el enlace llega arriba", async ({ page }) => {
  // A2, fila 1: la memoria de scroll restauraba también tras una navegación
  // hacia adelante (cambiar de pestaña, «‹ Volver a la matriz»), porque la clave
  // de la matriz quedaba guardada desde que se abrió una tarea.
  await page.setViewportSize({ width: 1280, height: 520 })
  await login(page)
  await page.goto(MATRIZ_CONCURRENCIA)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2039")
  await crearTarea(page, { actividad: "Casino", tarea: "Lavado de loza", puesto: "Auxiliar de casino" })
  await crearTarea(page, { actividad: "Portería", tarea: "Control de acceso", puesto: "Guardia" })
  await volverALaTarea(page)
  await volverALaMatriz(page)

  const pozo = page.locator("[data-shell-scroll]")
  const scrollDelPozo = () => pozo.evaluate((element) => element.scrollTop)
  const alFondo = async () => {
    await pozo.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    expect(await scrollDelPozo()).toBeGreaterThan(50)
  }
  const tarea = page.getByRole("link", { name: /^Control de acceso/ })

  // 1. Atrás sí restaura: es la regla que se conserva, y deja guardada la clave de la matriz.
  await alFondo()
  const scrollAntes = await scrollDelPozo()
  await tarea.click()
  await expect(page.getByRole("heading", { level: 2, name: "Control de acceso" })).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/tarea=/)
  await expect.poll(async () => Math.abs((await scrollDelPozo()) - scrollAntes)).toBeLessThanOrEqual(4)

  // 2. Programa → Matriz (dos replace) no restaura, aunque la clave de la matriz existía.
  await page.getByRole("tab", { name: "Programa", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Programa", exact: true })).toHaveAttribute("aria-selected", "true")
  await pozo.evaluate((element) => element.scrollTo({ top: 0 }))
  await page.getByRole("tab", { name: /^Matriz \(/ }).click()
  await expect(tarea).toBeAttached()
  await dosCuadros(page)
  expect(await scrollDelPozo()).toBeLessThanOrEqual(4)

  // 3. «‹ Volver a la matriz» (push) tampoco restaura: llega arriba.
  await alFondo()
  await tarea.click()
  await expect(page.getByRole("heading", { level: 2, name: "Control de acceso" })).toBeVisible()
  await volverALaMatriz(page)
  await expect(tarea).toBeAttached()
  await dosCuadros(page)
  expect(await scrollDelPozo()).toBeLessThanOrEqual(4)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/workspace-memory.test.ts" "app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"`

Expected: FAIL.
- `workspace-memory.test.ts`: `beforeForwardNavigation` no existe («is not a function»).
- `workspace-nav.test.tsx`: el replace no guarda el scroll que se deja; queda la clave `?paso=x`.
- `task-view`, `new-task-dialog` y `risk-editor`: la clave del destino sigue en `sessionStorage`
  (`expected "500" to be null`).

La E2E se corre en la Task 10, desde el worktree y con una sola build.

- [ ] **Step 3: Write minimal implementation**

En `workspace-memory.ts`, agregar después de `currentViewUrl`:

```ts
export function forgetScroll(url: string) {
  try { sessionStorage.removeItem(scrollKey(url)) } catch { /* sin almacenamiento: nada que olvidar */ }
}

/** La clave de un destino (`href` relativo o absoluto) con la misma forma que `currentViewUrl()`: ruta + query, sin origen. */
export function viewUrlOf(href: string): string {
  const url = new URL(href, window.location.href)
  return `${url.pathname}${url.search}`
}

/**
 * Antes de TODA navegación hacia adelante —`navigateWorkspace` (push y replace)
 * y los `router.push` de crear y duplicar un riesgo—: recuerda el scroll de la
 * vista que se deja y olvida el que tuviera el destino. Así sólo Atrás y
 * Adelante, que no pasan por aquí, encuentran algo que restaurar: cambiar de
 * pestaña o volver a abrir una tarea llega arriba, como cualquier navegación
 * (A2, fila 1). No depende del `popstate` de Next.
 */
export function beforeForwardNavigation(href: string) {
  const well = shellScroll()
  if (well) rememberScroll(currentViewUrl(), well.scrollTop)
  forgetScroll(viewUrlOf(href))
}
```

Y en el comentario de `useRestoreWorkspaceScroll`, reemplazar:

```ts
 * Al montar la vista (matriz o tarea) vuelve al scroll que tenía esa URL la
 * última vez que se salió de ella con un `push`. Espera un cuadro para que el
 * contenido (y las actividades plegadas) ya tenga su alto.
```

por:

```ts
 * Al montar la vista (matriz o tarea) vuelve al scroll que tenía esa URL la
 * última vez que se salió de ella. Como toda navegación hacia adelante borra la
 * clave de su destino (`beforeForwardNavigation`), sólo la encuentran Atrás y
 * Adelante. Espera un cuadro para que el contenido (y las actividades plegadas)
 * ya tenga su alto.
```

Reemplazar `workspace-nav.tsx` desde el import hasta el final de `navigateWorkspace` (líneas 3–26)
por:

```tsx
import { forwardRef, type AnchorHTMLAttributes } from "react"
import { beforeForwardNavigation, shellScroll } from "./workspace-memory"

/**
 * Navegación dentro del espacio de trabajo de la MIPER sin ida al servidor:
 * todo lo que la vista necesita (filas, foto, diccionarios) ya está en el
 * cliente, y un fetch RSC por clic costaba 200–260 ms y reiniciaba las filas.
 * Next sincroniza `pushState`/`replaceState` con `useSearchParams` (doc
 * "Native History API"). Para lo que sí necesita datos nuevos del servidor
 * (crear, duplicar o borrar un riesgo) se sigue usando `router.push`, precedido
 * de `beforeForwardNavigation` igual que aquí.
 */
export function navigateWorkspace(href: string, mode: "push" | "replace" = "push") {
  // Hacia adelante (push o replace): se recuerda el scroll que se deja y se
  // olvida el del destino. Sólo Atrás/Adelante encuentran algo que restaurar.
  beforeForwardNavigation(href)
  if (mode === "replace") {
    window.history.replaceState(null, "", href)
    return
  }
  window.history.pushState(null, "", href)
  // La página scrollea dentro del pozo del shell, no en `window` (STYLING.md).
  shellScroll()?.scrollTo({ top: 0 })
}
```

`WorkspaceLink` no cambia.

En `task-view.tsx`:
- reemplazar `import { useRestoreWorkspaceScroll } from "./workspace-memory"` por
  `import { beforeForwardNavigation, useRestoreWorkspaceScroll } from "./workspace-memory"`;
- reemplazar:

```tsx
      // El riesgo nuevo tiene que venir del servidor: aquí sí corresponde router.push.
      router.push(hrefToEntry(pathname, params, id, "identificacion"))
```

por:

```tsx
      // El riesgo nuevo tiene que venir del servidor: aquí sí corresponde router.push.
      const href = hrefToEntry(pathname, params, id, "identificacion")
      beforeForwardNavigation(href)
      router.push(href)
```

En `new-task-dialog.tsx`:
- agregar `import { beforeForwardNavigation } from "./workspace-memory"` después del import de
  `../actions`;
- reemplazar:

```tsx
      router.push(hrefToEntry(pathname, params, id, "identificacion"))
```

por:

```tsx
      const href = hrefToEntry(pathname, params, id, "identificacion")
      beforeForwardNavigation(href)
      router.push(href)
```

En `risk-editor/risk-editor.tsx`:
- agregar `import { beforeForwardNavigation } from "../workspace-memory"` antes del import de
  `../workspace-nav`;
- reemplazar:

```tsx
    if (typeof id === "string") router.push(entryHref(id))
    else router.refresh()
```

por:

```tsx
    if (typeof id === "string") {
      const href = entryHref(id)
      // Hacia adelante con ida al servidor: igual que `navigateWorkspace`, el destino no hereda un scroll viejo.
      beforeForwardNavigation(href)
      router.push(href)
    } else router.refresh()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: el mismo comando del Step 2, más
`npm run test:fast -- "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/next-step-card.test.tsx"`.

Expected: PASS. «al montarse retoma el scroll que tenía su URL al salir» de `matrix-view` sigue
verde: el montaje no pasa por `beforeForwardNavigation`.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/workspace-memory.ts" "app/(app)/prevencion/miper/[id]/workspace-nav.tsx" "app/(app)/prevencion/miper/[id]/task-view.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx" e2e/prevencion-miper-interacciones.spec.ts
git add "app/(app)/prevencion/miper/[id]/workspace-memory.ts" "app/(app)/prevencion/miper/[id]/workspace-memory.test.ts" "app/(app)/prevencion/miper/[id]/workspace-nav.tsx" "app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx" "app/(app)/prevencion/miper/[id]/task-view.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" e2e/prevencion-miper-interacciones.spec.ts
git commit -m "fix(miper): el scroll sólo vuelve con Atrás; toda navegación hacia adelante olvida el del destino" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pasos y pestañas a 390 px (fila 2)

**Files:**
- Modify: `components/ui/tabs.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx`
- Test: `components/ui/tabs.test.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`

**Interfaces:**
- Consumes: `TabsList` / `TabsTrigger` (`@/components/ui/tabs`), `EDITOR_STEPS` / `EDITOR_STEP_LABEL` (`@/lib/prevention/miper/entry-navigation`).
- Produces: no cambia ninguna firma. Cambia la conducta de `TabsList`: cuando la tira desborda,
  la pestaña activa queda **centrada dentro de la tira**. Se mueve sólo `scrollLeft` de la lista,
  nunca los ancestros. En el editor, a `< sm`, cada paso inactivo muestra sólo su número (el rótulo
  queda `max-sm:sr-only`, así que el nombre accesible no cambia) y el activo muestra su rótulo.

**Por qué en la primitiva:**
- Las dos tiras del hallazgo (pasos del riesgo y Matriz/Programa/Revisión/Historial) son `TabsList`.
- `TabsList` ya revela la activa con `scrollIntoView({ inline: "nearest" })`, que la deja pegada al
  borde: por eso el «1» quedaba recortado.
- Usar `inline: "center"` desplazaría también los ancestros, incluido el pozo con `overflow-x:
  hidden`. Por eso el centrado se hace con `scrollLeft` sobre la propia tira.

- [ ] **Step 1: Write the failing tests**

En `components/ui/tabs.test.tsx`, agregar al `describe("TabsList", …)`:

```tsx
  it("si la tira no cabe, centra la pestaña activa moviendo sólo la tira", async () => {
    render(<ExampleTabs />)
    const list = screen.getByRole("tablist", { name: "Secciones del ejemplo" })
    // jsdom no tiene layout: se declara una tira de 300 px con 600 px de contenido.
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 600 })
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 })
    list.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
    const third = screen.getByRole("tab", { name: "Tercera" })
    third.getBoundingClientRect = () => ({ left: 400, width: 100 }) as DOMRect

    // Radix activa la pestaña con mousedown (botón principal).
    fireEvent.mouseDown(third)

    // Centro de la activa (450) menos centro de la tira (150).
    await vi.waitFor(() => expect(list.scrollLeft).toBe(300))
  })
```

En `risk-editor.test.tsx`, agregar:

```tsx
  it("a < sm sólo el paso activo muestra su rótulo; los demás lo conservan para el lector de pantalla", () => {
    render(<RiskEditor {...props({ step: "evaluacion" })} />)
    const active = screen.getByRole("tab", { name: /Evaluación/, selected: true })
    const inactive = screen.getByRole("tab", { name: /Identificación/ })
    expect(within(active).getByText("Evaluación").className).not.toMatch(/max-sm:sr-only/)
    expect(within(inactive).getByText("Identificación").className).toMatch(/max-sm:sr-only/)
    // El nombre accesible del inactivo sigue completo: «1. Identificación…».
    expect(inactive.textContent).toMatch(/^1\.\s*Identificación/)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- components/ui/tabs.test.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"`

Expected: FAIL.
- `tabs`: `expected 0 to be 300`.
- `risk-editor`: `getByText("Identificación")` no encuentra el elemento, porque hoy el número y el
  rótulo viven en el mismo nodo de texto.

- [ ] **Step 3: Write minimal implementation**

En `components/ui/tabs.tsx`, reemplazar `revealActiveTab` (líneas 17–26) por:

```tsx
  const revealActiveTab = React.useCallback(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!list || !active) return
    // jsdom no implementa scrollIntoView, así que sin la guardia cualquier
    // prueba de componente que monte pestañas revienta al primer render con
    // "scrollIntoView is not a function" — y la pestaña sólo se revela para
    // hacerla alcanzable, nunca es un requisito de corrección.
    if (typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
    // Si la tira no cabe (pasos del editor MIPER, pestañas a 390 px), la activa
    // queda al centro y no pegada a un borde: se ven sus vecinas y el primer
    // paso no queda recortado (QA MIPER Fase A, UX 1). Se mueve sólo la tira:
    // `inline: "center"` desplazaría también los ancestros, pozo incluido.
    if (list.scrollWidth > list.clientWidth) {
      const listBox = list.getBoundingClientRect()
      const activeBox = active.getBoundingClientRect()
      list.scrollLeft += activeBox.left + activeBox.width / 2 - (listBox.left + listBox.width / 2)
    }
  }, [])
```

En `risk-editor/risk-editor.tsx`, reemplazar:

```tsx
              <TabsTrigger key={value} value={value}>
                {index + 1}. {EDITOR_STEP_LABEL[value]}{value === "medidas" ? ` (${entry.controls.length})` : ""}
```

por:

```tsx
              <TabsTrigger key={value} value={value} className="max-sm:px-2.5">
                {index + 1}.{" "}
                {/* A < sm los cuatro pasos no caben: el activo muestra su rótulo y los demás, sólo su número. El rótulo oculto queda `sr-only`: el nombre accesible no cambia (QA Fase A, UX 1). */}
                <span className={value === current ? undefined : "max-sm:sr-only"}>{EDITOR_STEP_LABEL[value]}{value === "medidas" ? ` (${entry.controls.length})` : ""}</span>
```

El resto del `TabsTrigger` (la marca de pendientes o ✓) no cambia.

- [ ] **Step 4: Run tests to verify they pass**

Run: el comando del Step 2.
Expected: PASS. «lleva la pestaña activa a la zona visible…» sigue verde (la llamada a
`scrollIntoView` se conserva). En `risk-editor.test.tsx`, las pruebas que buscan pasos por
`/Medidas de control/` siguen calzando.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm run lint -- components/ui/tabs.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx"
git add components/ui/tabs.tsx components/ui/tabs.test.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"
git commit -m "fix(miper): pasos compactos a 390 px y la pestaña activa centrada en su tira" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Consistencia: línea base, mensajes, rótulos, CTA, chips y peligro vacío (filas 3, 4, 5, 6, 7 y 12)

**Files:**
- Modify:
  - `app/(app)/prevencion/miper/[id]/miper-workspace.tsx` (fila 3)
  - `lib/services/miper/entries.ts` (fila 4)
  - `lib/prevention/miper/next-step.ts` y `app/(app)/prevencion/miper/[id]/next-step-card.tsx` (fila 5)
  - `app/(app)/prevencion/miper/[id]/matrix-view.tsx` (fila 6)
  - `lib/prevention/miper/matrix-filters.ts` y `app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx` (fila 7)
  - `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx` y `app/(app)/prevencion/miper/[id]/risk-row.tsx` (fila 12)
- Create: `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx`
- Test:
  - `lib/__tests__/miper-entries.test.ts` (PGlite)
  - `lib/prevention/miper/next-step.test.ts`
  - `app/(app)/prevencion/miper/[id]/next-step-card.test.tsx`
  - `app/(app)/prevencion/miper/[id]/matrix-view.test.tsx`
  - `lib/prevention/miper/matrix-filters.test.ts`
  - `app/(app)/prevencion/miper/[id]/matrix-filters-bar.test.tsx`
  - `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`
  - `app/(app)/prevencion/miper/[id]/task-view.test.tsx`

**Interfaces:**
- Consumes: `changesByEntry` (`@/lib/prevention/miper/snapshot`); `FilterToolbar.hasActiveFilters` (`@/components/ui/filter-toolbar`, prop que ya existe).
- Produces:
  - `NextStepAction` pasa a `| { kind: "riesgo"; entryId: string; purpose: "pending" | "review" }`;
    el resto de las variantes no cambia.
  - `matrixFilterChips(filters, factors)` ya no emite la clave `buscar`.
  - `MatrixView` mantiene su firma: el CTA del vacío filtrado cambia de texto y sigue llamando a
    `onClearFilters`.
  - Textos nuevos del servicio:
    - `STALE_ENTRY = "La fila cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona."`
    - `STALE_CONTROL = "La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona."`

**Lo que no se toca a propósito:**
- Los mensajes «La fila no existe en esta MIPER; recarga la matriz.» y «La medida no existe…;
  recarga la matriz.» de `entries.ts` siguen igual. El plan maestro limita la fila 4 a los dos
  `STALE_*`, y en esos casos volver a la matriz es lo correcto.
- La fila 5 dice «Se ajusta la E2E», pero ninguna E2E afirma «Empezar por el más grave» (ver la
  lista bajo el mapa de archivos). No hay localizador que cambiar.

- [ ] **Step 1: Write the failing tests**

Crear `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx`. La Task 9 le agrega pruebas;
este fixture es la base:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot, MiperHeaderSnapshot, SnapshotDiff } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"

const nav = vi.hoisted(() => ({ query: "" }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams(nav.query) }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
// Todas las acciones que importa el árbol del espacio de trabajo (grep de `../actions` y `../../actions` en `[id]/`).
vi.mock("../actions", () => ({
  addMiperObservationAction: vi.fn(), addOccurrenceEvidenceAction: vi.fn(), applyProgramGenerationAction: vi.fn(),
  approveMiperFinalAction: vi.fn(), approveMiperTechnicalAction: vi.fn(), deleteMiperControlAction: vi.fn(),
  deleteMiperEntryAction: vi.fn(), discardMiperDraftAction: vi.fn(), duplicateMiperEntryAction: vi.fn(),
  loadOccurrenceDetailAction: vi.fn(), loadProgramWorkspaceAction: vi.fn(), openMiperRoundAction: vi.fn(),
  proposeProgramActionsAction: vi.fn(), recordOccurrenceAction: vi.fn(), reopenMiperObservationAction: vi.fn(),
  requestMiperCorrectionsAction: vi.fn(), resolveMiperObservationAction: vi.fn(), respondMiperObservationAction: vi.fn(),
  retireProgramActionAction: vi.fn(), returnMiperAction: vi.fn(), saveMiperControlAction: vi.fn(),
  saveMiperEntryAction: vi.fn(), saveProgramActionAction: vi.fn(), saveProgramHeaderAction: vi.fn(),
  submitMiperAction: vi.fn(), updateMiperHeaderAction: vi.fn(), uploadProgramEvidenceAction: vi.fn(),
  voidOccurrenceRecordAction: vi.fn(), withdrawOccurrenceEvidenceAction: vi.fn(),
}))

import { MiperWorkspaceView } from "./miper-workspace"

const header: MiperHeaderSnapshot = {
  period: 2026, iperCode: "RE-04", elaboratedOn: "2026-10-01", updatedOn: null, companyName: "Chome", companyRut: "1-9", companyAddress: "Calle 1",
  companyCommune: "Panguipulli", economicActivity: "Servicios", adherentNumber: null, worksiteName: "Planta", siteRepresentativeUserId: null,
  siteRepresentativeName: "Ana", headcountTotal: 2, headcountMale: 1, headcountFemale: 1, headcountOther: 0, participationSummary: "Participación", consultationEvidenceReference: "Acta",
}
const entry = (overrides: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot => ({
  id: "e1", rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: "Peligro 1", risk: "Choque", probableDamage: "Fracturas",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [], ...overrides,
})
const editMode: WorkspaceMode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: false, readOnlyReason: null }
/** Lo que `getMiperWorkspace` entrega para un borrador nunca aprobado: todo «agregado» contra nada. */
const allAdded: SnapshotDiff = { headerFields: [], entries: [{ kind: "added", entryId: "e1", rowNumber: 1, fields: [] }], hasChanges: true }

function workspaceOf(overrides: Partial<MiperWorkspace> = {}): MiperWorkspace {
  return {
    matrix: { id: "m1", version: 1, status: "draft", reviewState: "none", isLegacy: false, worksiteId: "ws1", worksiteName: "Planta", period: 2026 },
    label: "Borrador", snapshot: { header, entries: [entry()] }, entryVersions: { e1: 1 }, controlVersions: {}, versions: [],
    lastVersionSnapshot: null, openRound: null, reviewDiff: null, reviewBaselineSnapshot: null, pendingDiff: allAdded,
    observations: [], completeness: [],
    prefill: { companyName: "Chome", companyRut: "1-9", companyAddress: "Calle 1", economicActivity: "Servicios", adherentNumber: "", companyCommune: "Panguipulli", worksiteName: "Planta", siteRepresentativeUserId: null, siteRepresentativeName: "Ana", headcount: { total: 2, male: 1, female: 1, other: 0, unrecorded: 0 } },
    riskFactors: [{ id: "f1", name: "Mecánico", isActive: true }],
    dictionaries: { activities: [], tasks: [], positions: [], locations: [], hazards: [], risks: [], damages: [], measures: [] },
    responsibleOptions: [], siblingMatrices: [], program: null, controlActionLinks: [],
    ...overrides,
  } as unknown as MiperWorkspace
}

function show(query: string, workspace = workspaceOf(), mode = editMode) {
  nav.query = query
  return render(<ShellHeaderProvider><MiperWorkspaceView workspace={workspace} history={[]} mode={mode} userId="u1" /></ShellHeaderProvider>)
}

const TASK = `tarea=${taskKeyOf({ activity: "Transporte", task: "Carga" })}`

afterEach(() => {
  nav.query = ""
  sessionStorage.clear()
})

describe("MiperWorkspaceView — marcas de cambio (A2, fila 3)", () => {
  it("sin línea base (borrador nunca aprobado) la estructura no dice «modificado»", () => {
    show("")
    expect(screen.queryByText(/modificado/)).toBeNull()
  })
  it("sin línea base la tarea no marca «Nueva»", () => {
    show(TASK)
    expect(screen.queryByText("Nueva", { exact: true })).toBeNull()
  })
  it("con una versión aprobada como línea base, las marcas vuelven", () => {
    show(TASK, workspaceOf({ lastVersionSnapshot: { header, entries: [] } }))
    expect(screen.getByText("Nueva", { exact: true })).toBeTruthy()
  })
})
```

En `lib/__tests__/miper-entries.test.ts`:
- línea 44: reemplazar `.rejects.toThrow(/La fila cambió mientras la editabas/)` por
  `.rejects.toThrow("La fila cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona.")`;
- en «medidas: responsable activo, versión y borrado», después de `expect(edited.version).toBe(2)`,
  agregar:

```ts
    // Una edición con la versión vieja: el mensaje nombra el gesto del editor, «Recargar riesgo» (A2, fila 4).
    await expect(svc.saveMiperControl({ matrixId, entryId: first!.id, controlId: control.id, expectedVersion: 1, values: { hierarchy: "ppe", description: "Casco", responsibleUserId: "u-a", dueDate: "2026-11-30" } }, author))
      .rejects.toThrow("La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona.")
```

En `lib/prevention/miper/next-step.test.ts`:
- reemplazar la expectativa de la prueba 3 por:

```ts
    expect(step).toMatchObject({ title: "Revisa la versión enviada", action: { kind: "riesgo", entryId: "b", purpose: "review" } })
```

- en la prueba 6, reemplazar `action: { kind: "riesgo", entryId: "b" }` por
  `action: { kind: "riesgo", entryId: "b", purpose: "pending" }`;
- en el `describe("nextStepInView")`, el fixture `pending` pasa a
  `action: { kind: "riesgo", entryId: "b", purpose: "pending" }`.

Reemplazar `app/(app)/prevencion/miper/[id]/next-step-card.test.tsx` completo por:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { NextStepAction } from "@/lib/prevention/miper/next-step"
import { NextStepCard } from "./next-step-card"

const hrefFor = (action: NextStepAction) => `/prevencion/miper/m1?accion=${action.kind}`

afterEach(() => { vi.restoreAllMocks() })

describe("NextStepCard", () => {
  it("sin paso no pinta nada", () => {
    const { container } = render(<NextStepCard step={null} hrefFor={hrefFor} />)
    expect(container.innerHTML).toBe("")
  })

  it("ir al pendiente se llama «Siguiente pendiente», como el pie del editor, y es push; «Ver los pendientes» es replace", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Faltan datos en 2 riesgos", description: "Empieza por los más graves.", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro", completitud: "pendientes" } }} />)
    expect(screen.getByText("Faltan datos en 2 riesgos")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Empezar por el más grave" })).toBeNull()
    fireEvent.click(screen.getByRole("link", { name: "Siguiente pendiente" }))
    expect(push).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=riesgo")
    fireEvent.click(screen.getByRole("link", { name: "Ver los pendientes" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=filtro")
  })

  it("quien revisa no recorre pendientes: su acción es «Empezar la revisión»", () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Revisa la versión enviada", description: "2 riesgos", action: { kind: "riesgo", entryId: "b", purpose: "review" }, secondary: null }} />)
    expect(screen.getByRole("link", { name: "Empezar la revisión" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Siguiente pendiente" })).toBeNull()
  })

  it("abrir la ficha reemplaza la entrada del historial", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<NextStepCard hrefFor={hrefFor} step={{ tone: "warning", title: "Completa la ficha del documento (1 dato)", description: "", action: { kind: "ficha" }, secondary: null }} />)
    fireEvent.click(screen.getByRole("link", { name: "Abrir la ficha" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?accion=ficha")
    expect(push).not.toHaveBeenCalled()
  })
})
```

En `matrix-view.test.tsx`, reemplazar la prueba
`"con filtros y sin coincidencias explica qué pasa y ofrece «Limpiar filtros» (A4)"` por:

```tsx
  it("con filtros y sin coincidencias explica qué pasa y ofrece «Ver todos los riesgos» (A4), no un segundo «Limpiar filtros»", () => {
    render(<MatrixView {...base} tree={[]} filtered />)
    expect(screen.getByText("Ningún riesgo coincide con los filtros")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Nueva tarea" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ver todos los riesgos" }))
    expect(base.onClearFilters).toHaveBeenCalledTimes(1)
  })
```

En `lib/prevention/miper/matrix-filters.test.ts`, agregar al `describe`:

```ts
  it("la búsqueda no genera chip: ya está a la vista en su campo", () => {
    const chips = matrixFilterChips({ ...EMPTY_FILTERS, search: "lodo", classifications: ["important"] }, [])
    expect(chips.map((chip) => chip.key)).toEqual(["clasificacion"])
  })
```

En `matrix-filters-bar.test.tsx`, agregar al primer `describe("MatrixFiltersBar", …)`:

```tsx
  it("con sólo la búsqueda no hay chip, pero «Limpiar filtros» sigue a mano", () => {
    render(<MatrixFiltersBar {...props} filters={{ ...EMPTY_FILTERS, search: "lodo" }} filtered />)
    expect(screen.queryByRole("button", { name: "Eliminar filtro Búsqueda" })).toBeNull()
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeTruthy()
  })
```

En `risk-editor.test.tsx`, agregar:

```tsx
  it("un peligro en blanco se titula «Peligro sin describir», no queda un título vacío", () => {
    render(<RiskEditor {...props({ rows: [entry("e1", 1, { hazard: "   " })], step: "identificacion" })} />)
    expect(screen.getByRole("heading", { level: 2, name: "Peligro sin describir" })).toBeTruthy()
  })
```

En `task-view.test.tsx`, agregar:

```tsx
  it("un riesgo con el peligro en blanco se lista como «Peligro sin describir»", () => {
    const blank = buildMatrixTree([e("z", 9, { hazard: "  " })], { incomplete: new Set(), observed: new Set(), modified: new Set(), matching: null })[0]!.tasks[0]!
    render(<TaskView {...base} task={blank} editable />)
    expect(screen.getByRole("link", { name: "Riesgo #9: peligro sin describir" })).toBeTruthy()
    expect(screen.getByText("Peligro sin describir")).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" lib/prevention/miper/next-step.test.ts "app/(app)/prevencion/miper/[id]/next-step-card.test.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" lib/prevention/miper/matrix-filters.test.ts "app/(app)/prevencion/miper/[id]/matrix-filters-bar.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx"`

Expected: FAIL.

| Prueba | Fallo esperado |
|---|---|
| Marcas de cambio sin línea base (`miper-workspace`) | encuentra «1 modificado(s)» y «Nueva» |
| `next-step` | falta `purpose` |
| `next-step-card` | no hay enlace «Siguiente pendiente» ni «Empezar la revisión» |
| `matrix-view` | no hay botón «Ver todos los riesgos» |
| `matrix-filters` y `matrix-filters-bar` | el chip `buscar` sigue ahí |
| `risk-editor` y `task-view` | el título queda en blanco |

`typecheck` también falla en los fixtures con `purpose`. Es esperable hasta el Step 3.

Run: `npm run test:pglite -- lib/__tests__/miper-entries.test.ts`

Expected: FAIL, el mensaje todavía dice «Recarga la matriz…».

- [ ] **Step 3: Write minimal implementation**

**Fila 3.** En `miper-workspace.tsx`, reemplazar:

```tsx
  const diff = reviewing ? workspace.reviewDiff : workspace.pendingDiff
  const changes = useMemo<Map<string, EntryChange>>(() => (diff ? changesByEntry(diff) : new Map()), [diff])
```

por:

```tsx
  // Contra qué se compara: la foto de la ronda anterior (en revisión) o la última versión sellada.
  const baseline = reviewing ? workspace.reviewBaselineSnapshot : workspace.lastVersionSnapshot
  const diff = reviewing ? workspace.reviewDiff : workspace.pendingDiff
  // Sin línea base (un borrador que nunca se aprobó) todo sería «Nueva» y cada
  // actividad diría «N modificado(s)»: la marca no informa y compite con
  // «N pendientes» (QA Fase A, UX 2). Sin con qué comparar, no hay marcas.
  const changes = useMemo<Map<string, EntryChange>>(() => (baseline && diff ? changesByEntry(diff) : new Map()), [baseline, diff])
```

y borrar la **segunda** aparición de esta línea: la original, entre
`const openEntry = …` y `const atRoot = …`, que queda duplicada.

```tsx
  const baseline = reviewing ? workspace.reviewBaselineSnapshot : workspace.lastVersionSnapshot
```

**Fila 4.** En `lib/services/miper/entries.ts`, reemplazar las líneas 13–14 por:

```ts
// El editor ofrece «Recargar riesgo»: el mensaje nombra ese mismo gesto (QA Fase A, UX 3). El prefijo se conserva: lo afirman las E2E.
const STALE_ENTRY = "La fila cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona."
const STALE_CONTROL = "La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona."
```

**Fila 5.** En `lib/prevention/miper/next-step.ts`:
- reemplazar `  | { kind: "riesgo"; entryId: string }` por:

```ts
  /** `purpose` da el rótulo: «Siguiente pendiente» para quien completa, «Empezar la revisión» para quien revisa. */
  | { kind: "riesgo"; entryId: string; purpose: "pending" | "review" }
```

- en la regla del revisor, reemplazar `target ? { kind: "riesgo", entryId: target } : null` por
  `target ? { kind: "riesgo", entryId: target, purpose: "review" } : null`;
- en «Faltan datos», reemplazar `first ? { kind: "riesgo", entryId: first } : null` por
  `first ? { kind: "riesgo", entryId: first, purpose: "pending" } : null`.

En `next-step-card.tsx`, reemplazar la línea `const LABEL…` (línea 9) por:

```tsx
/**
 * Un nombre por acción (QA Fase A, INCONSISTENCY 2): ir al riesgo pendiente se
 * llama igual que el botón del pie del editor, «Siguiente pendiente»; quien
 * revisa no recorre pendientes, empieza la revisión.
 */
const RISK_LABEL = { pending: "Siguiente pendiente", review: "Empezar la revisión" } as const
const LABEL = { ficha: "Abrir la ficha", tab: "Ir a Revisión", filtro: "Ver los pendientes" } as const
const labelOf = (action: NextStepAction) => (action.kind === "riesgo" ? RISK_LABEL[action.purpose] : LABEL[action.kind])
```

y en el cuerpo:
- reemplazar `{step.action.kind === "riesgo" ? "Empezar por el más grave" : LABEL[step.action.kind]}`
  por `{labelOf(step.action)}`;
- reemplazar `{LABEL[step.secondary.kind]}` por `{labelOf(step.secondary)}`.

**Fila 6.** En `matrix-view.tsx`, reemplazar:

```tsx
          ? <EmptyState title="Ningún riesgo coincide con los filtros" description="Quita algún filtro o cambia la búsqueda." action={<Button variant="secondary" onClick={onClearFilters}>Limpiar filtros</Button>} />
```

por:

```tsx
          // La barra ya ofrece «Limpiar filtros»: el CTA del vacío dice lo que logra, no repite el nombre (QA A2, fila 6).
          ? <EmptyState title="Ningún riesgo coincide con los filtros" description="Quita algún filtro o cambia la búsqueda." action={<Button variant="secondary" onClick={onClearFilters}>Ver todos los riesgos</Button>} />
```

**Fila 7.** En `lib/prevention/miper/matrix-filters.ts`, borrar la línea:

```ts
  if (filters.search.trim()) chips.push({ key: "buscar", label: "Búsqueda", value: filters.search, displayValue: `«${filters.search.trim()}»` })
```

y agregar sobre `export function matrixFilterChips`:

```ts
/** Chips de los filtros activos. La búsqueda no lleva chip: ya está a la vista en su propio campo (QA A2, fila 7). */
```

En `matrix-filters-bar.tsx`, reemplazar:

```tsx
    <FilterToolbar
      activeChips={chips}
```

por (un comentario `//` entre atributos JSX es válido en TSX):

```tsx
    <FilterToolbar
      activeChips={chips}
      // Sin chip de búsqueda, una búsqueda sola no dejaría «Limpiar filtros» a mano (A2, fila 7).
      hasActiveFilters={filtered}
```

**Fila 12.** En `risk-editor/risk-editor.tsx`, reemplazar
`<h2 className="text-xl font-semibold">{entry.hazard ?? "Peligro sin describir"}</h2>` por:

```tsx
          <h2 className="text-xl font-semibold">{entry.hazard?.trim() || "Peligro sin describir"}</h2>
```

En `risk-row.tsx`, reemplazar el cuerpo de `RiskRow` hasta el `<p>` del peligro:

```tsx
  return (
    <WorkspaceLink href={href} aria-label={`Riesgo #${entry.rowNumber}: ${entry.hazard ?? "peligro sin describir"}`}
```

por:

```tsx
  // Un peligro en blanco («   ») es un peligro vacío: ni título vacío ni nombre accesible cortado.
  const hazard = entry.hazard?.trim() || null
  return (
    <WorkspaceLink href={href} aria-label={`Riesgo #${entry.rowNumber}: ${hazard ?? "peligro sin describir"}`}
```

y `{entry.hazard ?? "Peligro sin describir"}</p>` por `{hazard ?? "Peligro sin describir"}</p>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: los dos comandos del Step 2.
Expected: PASS. En PGlite, «rechaza una edición con versión vieja» y «medidas: responsable
activo, versión y borrado» quedan verdes.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" lib/services/miper/entries.ts lib/prevention/miper/next-step.ts "app/(app)/prevencion/miper/[id]/next-step-card.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.tsx" lib/prevention/miper/matrix-filters.ts "app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx" "app/(app)/prevencion/miper/[id]/risk-row.tsx"
git add "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" lib/services/miper/entries.ts lib/__tests__/miper-entries.test.ts lib/prevention/miper/next-step.ts lib/prevention/miper/next-step.test.ts "app/(app)/prevencion/miper/[id]/next-step-card.tsx" "app/(app)/prevencion/miper/[id]/next-step-card.test.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" lib/prevention/miper/matrix-filters.ts lib/prevention/miper/matrix-filters.test.ts "app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx" "app/(app)/prevencion/miper/[id]/matrix-filters-bar.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" "app/(app)/prevencion/miper/[id]/risk-row.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx"
git commit -m "fix(miper): sin marcas sin línea base, «Recarga el riesgo», un nombre por acción, CTA y chips sin duplicar y peligro vacío" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ficha: borrador recuperable y campos bloqueados mientras guarda (fila 8)

**Files:**
- Modify: `app/(app)/prevencion/miper/[id]/workspace-memory.ts`, `app/(app)/prevencion/miper/[id]/antecedentes-form.tsx`, `app/(app)/prevencion/miper/[id]/ficha-sheet.tsx`
- Test: `app/(app)/prevencion/miper/[id]/workspace-memory.test.ts`, `app/(app)/prevencion/miper/[id]/ficha-sheet.test.tsx`

**Interfaces:**
- Consumes: `Callout` (`@/components/ui/callout`), `Button`, `useOperation`; el tipo `Header = MiperWorkspace["snapshot"]["header"]`, que ya está en `antecedentes-form.tsx`.
- Produces (en `workspace-memory.ts`):
  - `readFichaDraft(matrixId: string, version: number): Record<string, unknown> | null`
  - `writeFichaDraft(matrixId: string, version: number, draft: object): void`
  - `clearFichaDraft(matrixId: string, version: number): void`
  - La clave es `miper:ficha:<matrixId>:<version>`.
- Textos visibles nuevos:
  - el `Callout` «Hay cambios de la ficha que no se guardaron»;
  - los botones «Recuperar lo que no guardaste» y «Descartar esos cambios». Este último no se llama
    «Descartar», para no ser prefijo de «Descartar borrador», que vive en la cabecera.

**Regla (plan maestro):**
- Un `popstate` no se puede cancelar: Next ya navegó.
- Por eso el borrador se guarda en `sessionStorage` con la clave `matrixId:version`. La versión es
  la de la matriz, que sube cuando alguien guarda la ficha (`matrices.ts:132`); guardar un riesgo
  no la cambia.
- Al reabrir la ficha se ofrece «Recuperar lo que no guardaste». Se mantiene `beforeunload`.
- Los campos quedan deshabilitados mientras se guarda.
- El borrador se borra al guardar, con «Descartar esos cambios» y con «Cerrar sin guardar».
  Recuperarlo lo vuelve a dejar como el estado sucio del formulario.

- [ ] **Step 1: Write the failing tests**

En `workspace-memory.test.ts`, agregar `clearFichaDraft, readFichaDraft, writeFichaDraft` al import
y estas pruebas:

```ts
  it("el borrador de la ficha se guarda por MIPER y versión, bajo miper:ficha:<matrixId>:<version>", () => {
    writeFichaDraft("m1", 3, { iperCode: "RE-04-B" })
    expect(sessionStorage.getItem("miper:ficha:m1:3")).toBe(JSON.stringify({ iperCode: "RE-04-B" }))
    expect(readFichaDraft("m1", 3)).toEqual({ iperCode: "RE-04-B" })
    // Otra versión (alguien guardó la ficha después) no lo ve.
    expect(readFichaDraft("m1", 4)).toBeNull()
    clearFichaDraft("m1", 3)
    expect(readFichaDraft("m1", 3)).toBeNull()
  })

  it("un borrador ilegible o que no es un objeto no se ofrece", () => {
    sessionStorage.setItem("miper:ficha:m1:1", "{roto")
    expect(readFichaDraft("m1", 1)).toBeNull()
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify(["a"]))
    expect(readFichaDraft("m1", 1)).toBeNull()
  })
```

En la prueba «sin sessionStorage…», agregar:

```ts
    expect(() => writeFichaDraft("m1", 1, { a: 1 })).not.toThrow()
    expect(() => clearFichaDraft("m1", 1)).not.toThrow()
    expect(readFichaDraft("m1", 1)).toBeNull()
```

En `ficha-sheet.test.tsx`:
- agregar `afterEach` al import de `vitest` y, después de las constantes, este bloque:

```tsx
afterEach(() => { sessionStorage.clear() })
```

- agregar al `describe("FichaSheet", …)`:

```tsx
  it("lo escrito sin guardar sobrevive a cerrar la ficha sin confirmar (Atrás) y al reabrirla se ofrece recuperarlo", () => {
    const first = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    expect(JSON.parse(sessionStorage.getItem("miper:ficha:m1:1")!)).toMatchObject({ iperCode: "RE-04-B" })
    // «Atrás» desmonta la ficha sin pasar por «¿Cerrar sin guardar?».
    first.unmount()
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.getByDisplayValue("RE-04")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Recuperar lo que no guardaste" }))
    expect(screen.getByDisplayValue("RE-04-B")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
  })

  it("«Descartar esos cambios» borra el borrador y no lo vuelve a ofrecer", () => {
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify({ iperCode: "RE-04-B" }))
    const first = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.click(screen.getByRole("button", { name: "Descartar esos cambios" }))
    expect(sessionStorage.getItem("miper:ficha:m1:1")).toBeNull()
    first.unmount()
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
  })

  it("un borrador de otra versión (alguien guardó la ficha después) o igual a lo guardado no se ofrece", () => {
    sessionStorage.setItem("miper:ficha:m1:0", JSON.stringify({ iperCode: "VIEJO" }))
    const first = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
    first.unmount()
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify({ iperCode: "RE-04" }))
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    expect(screen.queryByRole("button", { name: "Recuperar lo que no guardaste" })).toBeNull()
  })

  it("guardar y «Cerrar sin guardar» borran el borrador", async () => {
    const saved = render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar antecedentes" }))
    await waitFor(() => expect(sessionStorage.getItem("miper:ficha:m1:1")).toBeNull())
    saved.unmount()

    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-C" } })
    expect(sessionStorage.getItem("miper:ficha:m1:1")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sin guardar" }))
    expect(sessionStorage.getItem("miper:ficha:m1:1")).toBeNull()
  })

  it("con cambios sin guardar, cerrar o recargar la pestaña lo advierte (beforeunload)", () => {
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    const before = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(false)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    const after = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(true)
  })

  it("mientras guarda, los campos quedan deshabilitados", async () => {
    updateMiperHeaderAction.mockReturnValueOnce(new Promise<never>(() => {}))
    render(<FichaSheet open onClose={vi.fn()} workspace={workspace} editable />)
    fireEvent.change(screen.getByDisplayValue("RE-04"), { target: { value: "RE-04-B" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar antecedentes" }))
    await waitFor(() => expect(screen.getByDisplayValue("RE-04-B")).toBeDisabled())
    expect(screen.getByDisplayValue("Chome")).toBeDisabled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/workspace-memory.test.ts" "app/(app)/prevencion/miper/[id]/ficha-sheet.test.tsx"`

Expected: FAIL.
- `writeFichaDraft is not a function`.
- `miper:ficha:m1:1` es `null`.
- No existe «Recuperar lo que no guardaste».
- El input no queda deshabilitado.

La prueba de `beforeunload` pasa desde ya: fija lo que se mantiene.

- [ ] **Step 3: Write minimal implementation**

En `workspace-memory.ts`, agregar al final:

```ts
const fichaDraftKey = (matrixId: string, version: number) => `miper:ficha:${matrixId}:${version}`

/**
 * Borrador de la «Ficha del documento» (A2, fila 8): lo escrito y no guardado,
 * por MIPER y versión. «Atrás» cierra la ficha sin pasar por «¿Cerrar sin
 * guardar?» —un `popstate` no se cancela: Next ya navegó—, así que lo escrito
 * se guarda aquí y la ficha lo ofrece al reabrirse. La versión va en la clave:
 * si otra persona guardó la ficha, la versión cambió y el borrador viejo ya no
 * se ofrece sobre datos que no conoce.
 */
export function readFichaDraft(matrixId: string, version: number): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(fichaDraftKey(matrixId, version)) ?? "null")
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function writeFichaDraft(matrixId: string, version: number, draft: object) {
  try { sessionStorage.setItem(fichaDraftKey(matrixId, version), JSON.stringify(draft)) } catch { /* sin almacenamiento: no se recuerda */ }
}

export function clearFichaDraft(matrixId: string, version: number) {
  try { sessionStorage.removeItem(fichaDraftKey(matrixId, version)) } catch { /* sin almacenamiento: nada que borrar */ }
}
```

En `antecedentes-form.tsx`:

1. Imports. Agregar `import { Callout } from "@/components/ui/callout"` después del import de
   `Button`, y `import { clearFichaDraft, readFichaDraft, writeFichaDraft } from "./workspace-memory"`
   después del de `../actions`.

2. Después de `function payloadOf…`, agregar:

```tsx
/** Los campos de texto que el tipo de la ficha no deja en `null`. */
const NOT_NULL = new Set<keyof Header>(["participationSummary", "consultationEvidenceReference"])

/**
 * El borrador guardado, aplicado sobre lo último guardado. Sólo entran las
 * claves de la ficha con un tipo que la ficha acepta: un valor ajeno o corrupto
 * se ignora. Devuelve `null` si no hay borrador o si no cambia nada.
 */
function recoverableDraft(matrixId: string, version: number, saved: Header): Header | null {
  const stored = readFichaDraft(matrixId, version)
  if (!stored) return null
  const draft: Record<string, unknown> = { ...saved }
  for (const key of Object.keys(saved) as Array<keyof Header>) {
    if (key === "period" || !(key in stored)) continue
    const value = stored[key]
    if (typeof value === "string" || typeof value === "number" || (value === null && !NOT_NULL.has(key))) draft[key] = value
  }
  return JSON.stringify(payloadOf(draft as Header)) === JSON.stringify(payloadOf(saved)) ? null : (draft as Header)
}
```

3. Reemplazar:

```tsx
  const dirty = editable && JSON.stringify(payloadOf(header)) !== JSON.stringify(payloadOf(saved))
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
```

por:

```tsx
  const dirty = editable && JSON.stringify(payloadOf(header)) !== JSON.stringify(payloadOf(saved))
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  // Lo escrito viaja a `sessionStorage` mientras está sucio: «atrás» cierra la
  // ficha sin confirmar y así no se pierde. `beforeunload` sigue cubriendo la recarga.
  useEffect(() => {
    if (dirty) writeFichaDraft(matrix.id, version, payloadOf(header))
  }, [dirty, header, matrix.id, version])
  // La ficha vive en el portal del `Sheet`, que sólo se pinta en el cliente:
  // leer `sessionStorage` en el inicializador no desfasa la hidratación.
  const [recoverable, setRecoverable] = useState<Header | null>(() => recoverableDraft(matrix.id, matrix.version, workspace.snapshot.header))
```

4. Reemplazar la línea
   `const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })` por:

```tsx
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  // Mientras guarda, nada se edita: lo enviado es lo que se ve (A2, fila 8).
  const locked = !editable || operation.pending
```

5. En `restorable`, reemplazar `if (!editable || !source || …` por `if (locked || !source || …`.

6. Reemplazar `disabled={!editable}` por `disabled={locked}` en los seis controles editables:
   - el `Input` de `textField`;
   - el `Input` de `numberField`;
   - el `DatePicker` de `elaboratedOn`;
   - el `DatePicker` de `updatedOn`;
   - el `Textarea` de `participationSummary`;
   - el `Input` de `consultationEvidenceReference`.

   Los `Input` ya `disabled` (Período, «Elaboró / revisó / aprobó») no cambian.

7. En `submit`, reemplazar el callback de éxito:

```tsx
    operation.run(() => updateMiperHeaderAction({ matrixId: matrix.id, expectedVersion: version, ...payloadOf(submitted) }), (result) => {
      if (typeof result.data?.version === "number") setVersion(result.data.version)
      setSaved(submitted)
      onSaved?.()
    })
```

por:

```tsx
    operation.run(() => updateMiperHeaderAction({ matrixId: matrix.id, expectedVersion: version, ...payloadOf(submitted) }), (result) => {
      // El borrador era de la versión que se acaba de guardar: deja de existir.
      clearFichaDraft(matrix.id, version)
      setRecoverable(null)
      if (typeof result.data?.version === "number") setVersion(result.data.version)
      setSaved(submitted)
      onSaved?.()
    })
```

8. Justo después de `<form onSubmit={submit} className="space-y-6">`, agregar:

```tsx
      {editable && recoverable && (
        <Callout tone="warning" title="Hay cambios de la ficha que no se guardaron">
          <p>Quedaron de la última vez que la abriste en esta pestaña del navegador.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => { setHeader(recoverable); setRecoverable(null) }}>Recuperar lo que no guardaste</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => { clearFichaDraft(matrix.id, version); setRecoverable(null) }}>Descartar esos cambios</Button>
          </div>
        </Callout>
      )}
```

En `ficha-sheet.tsx`:
- agregar `import { clearFichaDraft } from "./workspace-memory"`;
- reemplazar
  `const close = () => { setDirty(false); setConfirming(false); onClose() }` por:

```tsx
  const close = () => { setDirty(false); setConfirming(false); onClose() }
  // «Cerrar sin guardar» es descartar a sabiendas: el borrador no se vuelve a ofrecer.
  const discard = () => { clearFichaDraft(workspace.matrix.id, workspace.matrix.version); close() }
```

- en el `ConfirmDialog`, reemplazar `onConfirm={close}` por `onConfirm={discard}`;
- actualizar el comentario del componente: después de «cerrar con cambios sin guardar pide
  confirmación.», agregar «Lo escrito queda como borrador recuperable si la ficha se cierra sin
  confirmar (Atrás).».

- [ ] **Step 4: Run tests to verify they pass**

Run: el comando del Step 2.
Expected: PASS, incluidas las tres pruebas existentes de `FichaSheet`.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/workspace-memory.ts" "app/(app)/prevencion/miper/[id]/antecedentes-form.tsx" "app/(app)/prevencion/miper/[id]/ficha-sheet.tsx"
git add "app/(app)/prevencion/miper/[id]/workspace-memory.ts" "app/(app)/prevencion/miper/[id]/workspace-memory.test.ts" "app/(app)/prevencion/miper/[id]/antecedentes-form.tsx" "app/(app)/prevencion/miper/[id]/ficha-sheet.tsx" "app/(app)/prevencion/miper/[id]/ficha-sheet.test.tsx"
git commit -m "feat(miper): la ficha guarda lo no guardado y ofrece recuperarlo al reabrirse; campos bloqueados mientras guarda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Medidas y observación (filas 9 y 10)

**Files:**
- Modify: `components/ui/confirm-dialog.tsx`, `app/(app)/prevencion/miper/[id]/control-form.tsx`, `app/(app)/prevencion/miper/[id]/control-card.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/measures-step.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx`
- Create: `components/ui/confirm-dialog.test.tsx`, `app/(app)/prevencion/miper/[id]/control-form.test.tsx`
- Test: `app/(app)/prevencion/miper/[id]/control-card.test.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`

**Interfaces:**
- Consumes: `useOperation` y `OperationResult` (`@/lib/hooks/use-operation`), en modo `"message"` (el que viene por defecto); `toast` (`@/lib/toast`); `Field` (`@/components/ui/field`).
- Produces:
  - `ConfirmDialog` gana `error?: string`: el motivo se muestra dentro del diálogo, con
    `role="alert"`. Es retrocompatible con sus 149 usos.
  - `ControlCard` cambia de props: se va `deleting: boolean` y quedan
    `onDelete: () => Promise<OperationResult>` y `editDisabled?: boolean`.
  - `ControlForm` mantiene su firma. El error del servidor pasa a `role="alert"` y el éxito sigue
    avisando con `toast.success`.
  - `MeasuresStep` y `FollowUpStep` mantienen su firma.

**Decisión:** se usa `ConfirmDialog.error` porque la fila 9 dice «el diálogo… muestra el error».
Arreglarlo en la primitiva evita una alerta local fuera del diálogo (AGENTS.md, «Fix Shared UI
Problems at the Correct Layer»).

- [ ] **Step 1: Write the failing tests**

Crear `components/ui/confirm-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ConfirmDialog } from "./confirm-dialog"

describe("ConfirmDialog", () => {
  it("con `error`, muestra el motivo dentro del diálogo como alerta", () => {
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Eliminar la medida" description="Se elimina." onConfirm={vi.fn()} error="La medida cambió mientras la editabas." />)
    expect(screen.getByRole("alert")).toHaveTextContent("La medida cambió mientras la editabas.")
  })
  it("sin `error` no hay alerta", () => {
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Eliminar la medida" description="Se elimina." onConfirm={vi.fn()} />)
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
```

Crear `app/(app)/prevencion/miper/[id]/control-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"

const saveMiperControlAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperControlAction }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import { ControlForm } from "./control-form"

// Pedro Soto ya no está en la faena: no viene en `responsibleOptions`.
const control: MiperControlSnapshot = { id: "c1", hierarchy: "administrative", description: "Pausas activas", responsibleUserId: "u9", responsibleName: "Pedro Soto", dueDate: "2026-10-30", status: "proposed" }
const base = { matrixId: "m1", entryId: "e1", responsibleOptions: [{ id: "u1", name: "Ana Pérez" }], measureSuggestions: [] as string[] }

afterEach(() => { vi.clearAllMocks() })

describe("ControlForm", () => {
  it("dice a la vista que la descripción pide al menos 3 caracteres", () => {
    render(<ControlForm {...base} control={null} controlVersion={undefined} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole("textbox", { name: "Descripción de la medida" })).toHaveAccessibleDescription("Mínimo 3 caracteres.")
    expect(screen.getByRole("button", { name: "Agregar medida" })).toBeDisabled()
  })

  it("guardar envía la versión de la medida, avisa y cierra", async () => {
    saveMiperControlAction.mockResolvedValueOnce({ ok: true, message: "Medida guardada", data: { id: "c1", version: 4 } })
    const onDone = vi.fn()
    render(<ControlForm {...base} control={control} controlVersion={3} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Guardar medida" }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(saveMiperControlAction).toHaveBeenCalledWith({
      matrixId: "m1", entryId: "e1", controlId: "c1", expectedVersion: 3,
      values: { hierarchy: "administrative", description: "Pausas activas", responsibleUserId: "u9", responsibleName: null, dueDate: "2026-10-30" },
    })
    expect(toast.success).toHaveBeenCalledWith("Medida guardada")
  })

  it("un rechazo del servidor queda a la vista (role=alert) y el formulario no se cierra", async () => {
    saveMiperControlAction.mockResolvedValueOnce({ ok: false, message: "La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona." })
    const onDone = vi.fn()
    render(<ControlForm {...base} control={control} controlVersion={3} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Guardar medida" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("La medida cambió mientras la editabas.")
    expect(onDone).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("el responsable actual que ya no está en la faena sigue siendo la opción elegida", () => {
    render(<ControlForm {...base} control={control} controlVersion={3} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Responsable de la medida" })).toHaveTextContent("Pedro Soto")
  })
})
```

Reemplazar `app/(app)/prevencion/miper/[id]/control-card.test.tsx` completo por:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OperationResult } from "@/lib/hooks/use-operation"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import { ControlCard } from "./control-card"

const control: MiperControlSnapshot = { id: "c1", hierarchy: "ppe", description: "Uso de casco y guantes", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-30", status: "proposed" }
const deleted = () => vi.fn(async (): Promise<OperationResult> => ({ ok: true, message: "Medida eliminada" }))
const openConfirm = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Eliminar la medida/ }))
  return screen.getByRole("dialog", { name: "Eliminar la medida" })
}

afterEach(() => { vi.clearAllMocks() })

describe("ControlCard", () => {
  it("muestra tipo, responsable, plazo y actividades del programa", () => {
    render(<ControlCard control={control} linkedActionNumbers={[3]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} />)
    expect(screen.getByText("V. Elementos de protección personal")).toBeTruthy()
    expect(screen.getByText(/Responsable: Supervisor · Plazo: 30-10-2026/)).toBeTruthy()
    expect(screen.getByText("En el programa: Actividad #3")).toBeTruthy()
  })

  it("eliminar pide confirmación; si sale bien, el diálogo se cierra y avisa", async () => {
    const onDelete = deleted()
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} />)
    const dialog = openConfirm()
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar medida" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Eliminar la medida" })).toBeNull())
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith("Medida eliminada")
  })

  it("el diálogo espera el borrado: mientras tanto no se cierra, ni con Escape", async () => {
    const onDelete = vi.fn(() => new Promise<OperationResult>(() => {}))
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} />)
    const dialog = openConfirm()
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar medida" }))
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Eliminar medida" })).toBeDisabled())
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(screen.getByRole("dialog", { name: "Eliminar la medida" })).toBeTruthy()
  })

  it("si el borrado falla, el motivo se ve en el diálogo, que sigue abierto", async () => {
    const onDelete = vi.fn(async (): Promise<OperationResult> => ({ ok: false, message: "La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona." }))
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} />)
    const dialog = openConfirm()
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar medida" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La medida cambió mientras la editabas.")
    expect(screen.getByRole("dialog", { name: "Eliminar la medida" })).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("con otra medida en edición, «Editar» queda deshabilitado", () => {
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} editDisabled />)
    expect(screen.getByRole("button", { name: /^Editar la medida/ })).toBeDisabled()
  })
})
```

En `risk-editor.test.tsx`, agregar:

```tsx
  it("con una medida en edición, «Agregar medida» y el «Editar» de las otras quedan deshabilitados", () => {
    const a = { id: "c1", hierarchy: "administrative" as const, description: "Pausas activas", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-30", status: "proposed" }
    const b = { ...a, id: "c2", description: "Rotación de puestos" }
    render(<RiskEditor {...props({ step: "medidas", rows: [entry("e1", 1, { controls: [a, b] })], data: { ...props().data, controlVersions: { c1: 1, c2: 1 } } })} />)
    fireEvent.click(screen.getByRole("button", { name: "Editar la medida: Pausas activas" }))
    expect(screen.getByRole("button", { name: "Agregar medida" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Editar la medida: Rotación de puestos" })).toBeDisabled()
  })

  it("la observación nueva dice a la vista que pide al menos 5 caracteres", () => {
    render(<RiskEditor {...props({ step: "seguimiento", mode: { ...mode, canObserve: true } })} />)
    expect(screen.getByRole("textbox", { name: "Nueva observación" })).toHaveAccessibleDescription("Mínimo 5 caracteres.")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- components/ui/confirm-dialog.test.tsx "app/(app)/prevencion/miper/[id]/control-form.test.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"`

Expected: FAIL.
- No hay `role="alert"` en el diálogo.
- La descripción accesible está vacía.
- El trigger del responsable muestra «Selecciona…».
- El diálogo se cierra antes de la respuesta.
- «Agregar medida» sigue habilitado.

- [ ] **Step 3: Write minimal implementation**

En `components/ui/confirm-dialog.tsx`:
- agregar a `ConfirmDialogProps`, después de `reasonPlaceholder?: string`:

```tsx
  /**
   * Motivo por el que la acción falló. Se muestra dentro del diálogo, que
   * sigue abierto, como `role="alert"`: el resultado no se pierde en un toast
   * que desaparece mientras la persona decide qué hacer.
   */
  error?: string
```

- agregar `error,` a la desestructuración, después de `reasonPlaceholder,`;
- justo antes de `<DialogFooter>`, agregar:

```tsx
        {error && <p role="alert" className="px-1 pb-2 text-sm text-[var(--color-danger-ink)]">{error}</p>}
```

Reemplazar `app/(app)/prevencion/miper/[id]/control-card.tsx` completo por:

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import { CONTROL_HIERARCHY_LABEL, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { formatDate } from "@/lib/utils"

/**
 * Tarjeta de una medida. El borrado se confirma y el diálogo **espera la
 * respuesta** (A2, fila 9): si el servidor lo rechaza (otra persona la editó,
 * cubre una actividad del PDTP…), el motivo queda en el diálogo, que no se
 * cierra hasta que la persona decide.
 */
export function ControlCard({ control, linkedActionNumbers, editable, verifyHref, onEdit, onDelete, editDisabled = false }: {
  control: MiperControlSnapshot
  linkedActionNumbers: readonly number[]
  editable: boolean
  verifyHref: string | null
  onEdit: () => void
  /** Borra la medida. El diálogo espera la respuesta: cierra si salió bien y, si no, muestra el motivo. */
  onDelete: () => Promise<OperationResult>
  /** Hay otra medida abierta en edición: no se abre una segunda. */
  editDisabled?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const deletion = useOperation()
  const short = control.description.length > 60 ? `${control.description.slice(0, 60)}…` : control.description
  const onOpenChange = (open: boolean) => {
    // Mientras el servidor responde, el diálogo no se cierra (ni con Escape).
    if (deletion.pending) return
    setConfirming(open)
    if (!open) deletion.setMessage("")
  }
  return (
    <article aria-label={`Medida: ${short}`} className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium">{CONTROL_HIERARCHY_LABEL[control.hierarchy]}</p>
        <p className="whitespace-pre-line">{control.description}</p>
        <p className="text-xs text-[var(--color-text-subtle)]">Responsable: {control.responsibleName ?? "sin asignar"} · Plazo: {control.dueDate ? formatDate(control.dueDate) : "sin plazo"}</p>
        {linkedActionNumbers.length > 0 && <p className="text-xs">En el programa: {linkedActionNumbers.map((number) => `Actividad #${number}`).join(", ")}</p>}
        {verifyHref && <Link className="text-xs underline" href={verifyHref}>Verificar eficacia del control</Link>}
      </div>
      {editable && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" aria-label={`Editar la medida: ${short}`} disabled={editDisabled} onClick={onEdit}>Editar</Button>
          <Button size="sm" variant="ghost" aria-label={`Eliminar la medida: ${short}`} onClick={() => setConfirming(true)}>Eliminar</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming} onOpenChange={onOpenChange}
        title="Eliminar la medida" description={`Se elimina «${short}». El cambio queda en el historial de la MIPER.`}
        confirmLabel="Eliminar medida" variant="destructive" loading={deletion.pending} error={deletion.message || undefined}
        onConfirm={() => deletion.run(onDelete, (result) => { setConfirming(false); toast.success(result.message ?? "Medida eliminada") })}
      />
    </article>
  )
}
```

En `control-form.tsx`:
- agregar `import { toast } from "@/lib/toast"` después del import de `snapshot`;
- reemplazar desde
  `const operation = useOperation({ feedback: "toast", onSuccess: onDone })` hasta el cierre de
  `save` por:

```tsx
  // Modo «message»: el rechazo del servidor queda escrito en el formulario
  // (role=alert) en vez de un toast que se va; el éxito sigue avisando y cierra.
  const operation = useOperation()
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? controlVersion : undefined,
    values: {
      hierarchy, description: description.trim(),
      responsibleUserId: responsibleUserId || null,
      responsibleName: responsibleUserId ? null : responsibleName.trim() || null,
      dueDate: dueDate || null,
    },
  }), (result) => { toast.success(result.message ?? "Medida guardada"); onDone() })
  // El responsable actual puede ya no estar en la faena (`responsibleOptions`
  // son sus usuarios activos): sin esta opción el select mostraba «Selecciona…»
  // y parecía sin responsable.
  const currentResponsible = control?.responsibleUserId && !responsibleOptions.some((option) => option.id === control.responsibleUserId)
    ? [{ value: control.responsibleUserId, label: control.responsibleName ?? "Responsable actual" }]
    : []
```

- reemplazar el `Field` de la descripción:

```tsx
      <Field label="Descripción de la medida" required className="md:col-span-2">
```

por:

```tsx
      <Field label="Descripción de la medida" required className="md:col-span-2" helper="Mínimo 3 caracteres.">
```

- en el `OptionSelect` del responsable, reemplazar
  `options={[...responsibleOptions.map((option) => ({ value: option.id, label: option.name })), { value: OTHER, label: "Otra persona o cargo…" }]}`
  por:

```tsx
          options={[...responsibleOptions.map((option) => ({ value: option.id, label: option.name })), ...currentResponsible, { value: OTHER, label: "Otra persona o cargo…" }]}
```

- justo antes de `<div className="flex gap-2 md:col-span-2">`, agregar:

```tsx
      {operation.message && <p role="alert" className="text-sm text-[var(--color-danger-ink)] md:col-span-2">{operation.message}</p>}
```

En `risk-editor/measures-step.tsx`:
- borrar `import { useOperation } from "@/lib/hooks/use-operation"`;
- reemplazar desde `const [editing, setEditing] = …` hasta `const done = () => setEditing(null)`
  por:

```tsx
  const [editing, setEditing] = useState<string | "new" | null>(null)
  // Una medida a la vez (A2, fila 9): abrir otra desmontaba el formulario abierto y perdía lo escrito sin avisar.
  const editingAny = editing !== null
  // Guardar y borrar una medida ya revalidan la página desde la acción
  // (`saveMiperControlAction`, `deleteMiperControlAction`): la foto nueva llega
  // con su respuesta. Un `router.refresh()` encima era un segundo viaje RSC.
  const done = () => setEditing(null)
```

- en el `ControlCard`, reemplazar `<ControlCard key={control.id} control={control} editable={editable} deleting={deletion.pending}`
  por:

```tsx
          <ControlCard key={control.id} control={control} editable={editable} editDisabled={editingAny}
```

  y
  `onDelete={() => deletion.run(() => deleteMiperControlAction({ matrixId: data.matrixId, controlId: control.id, expectedVersion: data.controlVersions[control.id]! }))} />`
  por:

```tsx
            onDelete={() => deleteMiperControlAction({ matrixId: data.matrixId, controlId: control.id, expectedVersion: data.controlVersions[control.id]! })} />
```

- reemplazar
  `: <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>Agregar medida</Button>)}`
  por:

```tsx
          : <Button size="sm" variant="secondary" disabled={editingAny} onClick={() => setEditing("new")}>Agregar medida</Button>)}
```

En `risk-editor/follow-up-step.tsx`:
- agregar `import { Field } from "@/components/ui/field"` después del import de `Button`;
- reemplazar:

```tsx
            <Textarea aria-label="Nueva observación" value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Ej.: Revisar consecuencia. De acuerdo con el daño probable debería evaluarse nuevamente la severidad." />
```

por:

```tsx
            {/* El mínimo que exige el botón, a la vista (A2, fila 10). El rótulo visible es el nombre accesible. */}
            <Field label="Nueva observación" htmlFor={`${entry.id}-observacion`} helper="Mínimo 5 caracteres.">
              <Textarea id={`${entry.id}-observacion`} value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Ej.: Revisar consecuencia. De acuerdo con el daño probable debería evaluarse nuevamente la severidad." />
            </Field>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: el comando del Step 2.
Expected: PASS. En `risk-editor.test.tsx`, «guardar o borrar una medida no pide un
router.refresh()» sigue verde: el borrado cierra el diálogo y la edición vuelve a la tarjeta.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm run lint -- components/ui/confirm-dialog.tsx "app/(app)/prevencion/miper/[id]/control-form.tsx" "app/(app)/prevencion/miper/[id]/control-card.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/measures-step.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx"
git add components/ui/confirm-dialog.tsx components/ui/confirm-dialog.test.tsx "app/(app)/prevencion/miper/[id]/control-form.tsx" "app/(app)/prevencion/miper/[id]/control-form.test.tsx" "app/(app)/prevencion/miper/[id]/control-card.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/measures-step.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"
git commit -m "fix(miper): una medida a la vez, errores del guardado y del borrado a la vista, responsable actual y ayuda de la observación" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `Combobox` y «Este riesgo ya no existe» (filas 11 y 13)

**Files:**
- Modify: `components/ui/combobox.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx`
- Test: `components/ui/combobox.test.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`

**Interfaces:**
- Consumes: `useComboboxListbox` (`./use-combobox-listbox`, sin cambios); `useTransition` (React); `router.refresh()`. La doc de `use-router.md` dice que trae el payload RSC nuevo y que dentro de una transición `isPending` dura hasta que se aplica (ver también `interactive-apps.md`).
- Produces: `Combobox` sin cambios de firma. Cambia la conducta:
  - con `clearLabel`, un valor libre (`allowCustomValue`) muestra la ✕;
  - pasar el mouse por una fila apaga el estado «recién enfocado».

  `RiskEditor` sin cambios de firma: se retira `MISSING_AFTER_MS`.

**Hecho que no se puede confirmar leyendo:** que, en Next 16.3, `isPending` siga en `true` hasta que
llega la foto nueva. La prueba unitaria usa un `router.refresh` síncrono y no lo ejercita. Se
confirma en el navegador (Task 10, fila 13): con `?fila=<id inexistente>`, el esqueleto se ve y el
aviso aparece después de la respuesta RSC del refresh, no antes. Mirar la pestaña Network: el aviso
pinta tras el GET `_rsc`.

- [ ] **Step 1: Write the failing tests**

En `components/ui/combobox.test.tsx`, agregar al `describe("Combobox", …)`:

```tsx
  it("con clearLabel, un valor libre también se puede limpiar con ✕", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="Polvo" onChange={onChange} allowCustomValue clearLabel="Quitar el peligro" />)
    fireEvent.mouseDown(screen.getByRole("button", { name: "Quitar el peligro" }))
    expect(onChange).toHaveBeenCalledWith("")
  })

  it("sin clearLabel, el valor libre no ofrece ✕", () => {
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="Polvo" onChange={vi.fn()} allowCustomValue />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("pasar el mouse por una opción recién enfocado deja elegirla con Enter", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="Polvo" onChange={onChange} allowCustomValue />)
    fireEvent.focus(input())
    fireEvent.mouseEnter(screen.getByRole("option", { name: "Ruido de motor" }))
    fireEvent.keyDown(input(), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("Ruido de motor")
  })
```

En `risk-editor.test.tsx`, reemplazar la prueba
`"un riesgo que no existe pide recargar y después avisa"` por:

```tsx
  it("un riesgo que no existe pide la foto nueva una vez y avisa cuando esa recarga termina, sin temporizador", async () => {
    router.refresh.mockClear()
    const { rerender } = render(<RiskEditor {...props({ entryId: "zzz" })} />)
    expect(router.refresh).toHaveBeenCalledTimes(1)
    // Sin reloj falso: el aviso no espera 2,5 s, sale al terminar la transición.
    expect(await screen.findByText("Este riesgo ya no existe")).toBeTruthy()
    rerender(<RiskEditor {...props({ entryId: "zzz", rows: [entry("e1", 1)] })} />)
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })
```

Reemplazar la prueba `"RF4: «Volver a la matriz» conserva la ruta de la matriz"` por:

```tsx
  it("RF4: «Volver a la matriz» conserva la ruta de la matriz", async () => {
    router.refresh.mockClear()
    render(<RiskEditor {...props({ entryId: "zzz" })} />)
    expect((await screen.findByRole("link", { name: "Volver a la matriz" })).getAttribute("href")).toBe("/prevencion/miper/m1")
  })
```

Agregar:

```tsx
  it("si el riesgo llega con la foto nueva, se abre el editor y no el aviso", async () => {
    router.refresh.mockClear()
    const { rerender } = render(<RiskEditor {...props({ entryId: "e9", rows: [entry("e1", 1)] })} />)
    rerender(<RiskEditor {...props({ entryId: "e9", rows: [entry("e1", 1), entry("e9", 2, { hazard: "Recién creado" })] })} />)
    expect(await screen.findByRole("heading", { level: 2, name: "Recién creado" })).toBeTruthy()
    expect(screen.queryByText("Este riesgo ya no existe")).toBeNull()
  })
```

Las pruebas de este archivo que ya no usan reloj falso pueden dejar el
`afterEach(() => { vi.useRealTimers(); … })`: no estorba.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- components/ui/combobox.test.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"`

Expected: FAIL.
- `combobox`: no existe el botón «Quitar el peligro»; y con hover + Enter, `onChange` no se llama
  (la guarda «recién enfocado» cierra).
- `risk-editor`: «Este riesgo ya no existe» no aparece antes del `findByText` (1 s), porque el
  temporizador es de 2,5 s.

- [ ] **Step 3: Write minimal implementation**

En `components/ui/combobox.tsx`:
- después de `const currentText = selected?.label ?? (allowCustomValue ? value : "")`, agregar:

```tsx
  // Un valor libre (`allowCustomValue`) también es un valor: con `clearLabel`
  // se limpia igual que una opción elegida (A2, fila 11).
  const hasValue = Boolean(selected) || (allowCustomValue && value !== "")
  const showClear = !disabled && hasValue && Boolean(clearLabel)
```

- reemplazar `{!disabled && selected && clearLabel && (` por `{showClear && (`;
- reemplazar `{!selected && (` (el del `CaretDown`) por `{!selected && !showClear && (`;
- reemplazar `onMouseEnter={() => listbox.setActiveIndex(index)}` por:

```tsx
              onMouseEnter={() => {
                // Pasar el mouse por una fila ya es elegirla como activa: Enter la toma aunque el campo esté «recién enfocado».
                pristineRef.current = false
                listbox.setActiveIndex(index)
              }}
```

En `risk-editor/risk-editor.tsx`:
- reemplazar `import { useEffect, useRef, useState } from "react"` por
  `import { useEffect, useState, useTransition } from "react"`;
- borrar:

```tsx
/** Si el `fila` no está, se recarga una vez y, pasado este tiempo, se avisa. */
const MISSING_AFTER_MS = 2500
```

- reemplazar:

```tsx
  const [missing, setMissing] = useState(false)
  const refreshed = useRef(false)

  useEffect(() => {
    if (entry) return
    if (!refreshed.current) { refreshed.current = true; router.refresh() }
    const timer = setTimeout(() => setMissing(true), MISSING_AFTER_MS)
    return () => clearTimeout(timer)
  }, [entry, router])

  if (!entry) {
    if (!missing) return <div aria-busy="true" className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full" /></div>
```

  por:

```tsx
  // Un `fila` que no está: se pide la foto nueva UNA vez, en una transición, y
  // el aviso sale cuando esa transición termina y el riesgo sigue sin venir. El
  // temporizador fijo de 2,5 s podía avisar con la foto todavía en camino, o
  // hacer esperar de más cuando ya había llegado (A2, fila 13).
  const [refreshing, startRefresh] = useTransition()
  const [refreshRequested, setRefreshRequested] = useState(false)

  useEffect(() => {
    if (entry || refreshRequested) return
    setRefreshRequested(true)
    startRefresh(() => { router.refresh() })
  }, [entry, refreshRequested, router])

  if (!entry) {
    if (!refreshRequested || refreshing) return <div aria-busy="true" className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full" /></div>
```

  La línea siguiente (el `return <EmptyState title="Este riesgo ya no existe" … />`) no cambia.

- [ ] **Step 4: Run tests to verify they pass**

Run: el comando del Step 2.
Expected: PASS. Las pruebas existentes de `Combobox` («Enter recién enfocado, sin escribir,
conserva el valor; con flecha elige la fila») siguen verdes.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm run lint -- components/ui/combobox.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx"
git add components/ui/combobox.tsx components/ui/combobox.test.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"
git commit -m "fix(miper): ✕ para el valor libre, el hover elige en el Combobox y «ya no existe» espera a la recarga" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Accesibilidad y axe sobre el espacio de trabajo (filas 14 y 17)

**Files:**
- Modify: `app/(app)/prevencion/miper/[id]/risk-editor/risk-aside.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx`, `components/ui/choice-card-group.tsx`, `app/(app)/prevencion/miper/[id]/summary-strip.tsx`, `e2e/accessibility.spec.ts`, `e2e/accessibility-targets.ts`, `e2e/miper-helpers.ts`
- Create: `app/(app)/prevencion/miper/[id]/summary-strip.test.tsx`
- Test: `components/ui/choice-card-group.test.tsx`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`, `e2e/accessibility-targets.test.ts`

**Interfaces:**
- Consumes: `AxeBuilder` (`@axe-core/playwright`); `AXE_TAGS` / `AXE_DISABLED_RULES` (`e2e/accessibility-targets.ts`); `login` (`e2e/helpers.ts`); `cabecera`, `irAPaso`, `PasoDelRiesgo` (`e2e/miper-helpers.ts`); la MIPER vigente sembrada `riskmatrix-controles-e2e` (`e2e/setup-db.ts`), con un riesgo sin actividad ni tarea: «Atrapamiento en correa transportadora E2E», #1, P×C 2×4, con dos medidas.
- Produces:
  - `ROUTE_URL_OVERRIDES["/prevencion/miper/[id]"] = "/prevencion/miper/riskmatrix-controles-e2e"`.
  - El describe E2E «Accessibility audit — MIPER: vistas del espacio de trabajo».
  - Cambios de nombres accesibles:
    - las tarjetas de `ChoiceCardGroup` se nombran sólo por su título y el criterio pasa a
      descripción;
    - los botones de `SummaryStrip` empiezan con su texto visible.

**Cómo llega axe a MIPER hoy:**
- La auditoría recorre `accessibilityTargets()`.
- Las rutas dinámicas sólo entran con una URL en `ROUTE_URL_OVERRIDES`, y `/prevencion/miper/[id]`
  no tiene ninguna.
- Con el override entra la **estructura**.
- La tarea, el editor (cuatro pasos) y la ficha son la misma ruta con otro estado de URL. Se
  recorren por la UI, como lo hace una persona, en un `describe` aparte.
- `AXE_DISABLED_RULES` tiene que seguir vacío: lo exige `accessibility-targets.test.ts`.

- [ ] **Step 1: Write the failing tests**

En `components/ui/choice-card-group.test.tsx`, agregar:

```tsx
  it("el nombre de cada tarjeta es su título; el criterio va como descripción accesible", () => {
    render(<ChoiceCardGroup label="Probabilidad" options={[{ value: 1, title: "1 · Baja", description: "Rara vez." }, { value: 2, title: "2 · Media", description: "A veces." }]} value={null} onChange={vi.fn()} />)
    const baja = screen.getByRole("radio", { name: "1 · Baja" })
    expect(baja).toHaveAccessibleDescription("Rara vez.")
  })

  it("Home y End llevan a la primera y a la última y mueven el foco", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="partial" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "Parcialmente" }), { key: "End" })
    expect(onChange).toHaveBeenLastCalledWith("no")
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "No" }))
    fireEvent.keyDown(screen.getByRole("radio", { name: "Parcialmente" }), { key: "Home" })
    expect(onChange).toHaveBeenLastCalledWith("yes")
  })

  it("Home sobre la ya elegida no vuelve a avisar (cada aviso es un guardado)", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="yes" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "Sí" }), { key: "Home" })
    expect(onChange).not.toHaveBeenCalled()
  })
```

Crear `app/(app)/prevencion/miper/[id]/summary-strip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { SummaryStrip } from "./summary-strip"

const snapshot = {
  header: { worksiteName: "Planta", period: 2026, headcountTotal: 3 },
  entries: [{ id: "a", classification: "important", controlledStatus: "no" }, { id: "b", classification: "tolerable", controlledStatus: "yes" }],
} as unknown as MiperSnapshot

describe("SummaryStrip", () => {
  it("cada botón de filtro empieza su nombre accesible con su texto visible (WCAG 2.5.3)", () => {
    render(<SummaryStrip snapshot={snapshot} authorName={null} submittedAt={null} versionLabel="v1" taskCount={1} completeCount={1}
      onTogglePending={vi.fn()} onToggleClassification={vi.fn()} onToggleUncontrolled={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Importante 1: filtrar la matriz" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Tolerable 1: filtrar la matriz" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Completos 1 de 2: filtrar los riesgos con pendientes" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "No controlados 1: filtrar la matriz" })).toBeTruthy()
  })
})
```

En `risk-editor.test.tsx`, agregar:

```tsx
  it("el resumen lateral es una región con título, no un complementary anidado, y sus bloques no repiten el título en aria-label", () => {
    const { container } = render(<RiskEditor {...props()} />)
    expect(screen.queryByRole("complementary")).toBeNull()
    expect(screen.getByRole("region", { name: "Resumen del riesgo" })).toBeTruthy()
    expect(container.querySelector('section[aria-label="Contexto"], section[aria-label="Chequeo del riesgo"], section[aria-label="Nivel de riesgo"]')).toBeNull()
  })
```

En `e2e/accessibility-targets.test.ts`, dentro de
`"resuelve con fixture las rutas que no se pueden visitar tal cual"`, agregar:

```ts
    // A2, fila 17: la estructura de la matriz, sobre la MIPER vigente sembrada (`e2e/setup-db.ts`).
    expect(byPattern.get("/prevencion/miper/[id]")).toBe("/prevencion/miper/riskmatrix-controles-e2e")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- components/ui/choice-card-group.test.tsx "app/(app)/prevencion/miper/[id]/summary-strip.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" e2e/accessibility-targets.test.ts`

Expected: FAIL.
- `choice-card-group`: el nombre hoy es «1 · BajaRara vez.» y Home/End no hacen nada.
- `summary-strip`: el nombre es «Filtrar la matriz: Importante (1)».
- `risk-editor`: existe un `complementary`.
- `accessibility-targets`: la ruta no tiene fixture (`undefined`).

- [ ] **Step 3: Write minimal implementation**

Reemplazar `components/ui/choice-card-group.tsx` completo por:

```tsx
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { SelectableCard, SelectableCardDescription, SelectableCardTitle } from "./selectable-card"

export type ChoiceCardOption<T extends string | number> = { value: T; title: string; description?: string }

/**
 * Grupo de radio hecho de `SelectableCard`. `SelectableCard` deja en manos de
 * quien lo usa el patrón de radio del WAI-ARIA (una sola tarjeta en el orden de
 * tabulación, flechas, Home y End para moverse y elegir); este componente lo
 * implementa una vez. Lo usan P×C, «¿Está controlado?» y «¿Rutinaria?» de la MIPER.
 *
 * El nombre de cada tarjeta es su título y el texto largo va como descripción
 * (`aria-describedby`). Sin eso, el nombre de cada tarjeta de P y C era el
 * criterio completo del RE-04.
 */
export function ChoiceCardGroup<T extends string | number>({ label, options, value, onChange, disabled = false, className }: {
  label: string
  options: ReadonlyArray<ChoiceCardOption<T>>
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const idBase = React.useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex

  /** Flechas: la vecina, dando la vuelta. Home/End: la primera y la última. */
  function targetIndex(key: string, index: number): number | null {
    switch (key) {
      case "ArrowRight": case "ArrowDown": return (index + 1) % options.length
      case "ArrowLeft": case "ArrowUp": return (index - 1 + options.length) % options.length
      case "Home": return 0
      case "End": return options.length - 1
      default: return null
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = targetIndex(event.key, index)
    if (next === null || disabled) return
    event.preventDefault()
    refs.current[next]?.focus()
    // La ya elegida no se vuelve a avisar: cada aviso es un guardado.
    if (options[next]!.value !== value) onChange(options[next]!.value)
  }

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={cn("grid gap-2 sm:grid-cols-3", className)}>
      {options.map((option, index) => {
        const titleId = `${idBase}-${index}-titulo`
        const descriptionId = option.description ? `${idBase}-${index}-descripcion` : undefined
        return (
          <SelectableCard
            key={String(option.value)}
            ref={(node) => { refs.current[index] = node }}
            selected={option.value === value}
            tabIndex={index === tabbable ? 0 : -1}
            disabled={disabled}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClick={() => { if (option.value !== value) onChange(option.value) }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <SelectableCardTitle id={titleId} className="whitespace-normal">{option.title}</SelectableCardTitle>
            {option.description && <SelectableCardDescription id={descriptionId} className="mt-1">{option.description}</SelectableCardDescription>}
          </SelectableCard>
        )
      })}
    </div>
  )
}
```

En `risk-editor/risk-aside.tsx`:
- reemplazar el `return (` y la apertura `<aside …>` por:

```tsx
  const titleId = `${entry.id}-resumen`
  // `section` con título y no `aside`: dentro de `<main>`, un `complementary`
  // anidado no es un hito de primer nivel. Los bloques internos se nombran por
  // su título visible: un `aria-label` igual al título sólo lo repetía (A2, fila 14).
  return (
    <section aria-labelledby={titleId} className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <h3 id={titleId} className="sr-only">Resumen del riesgo</h3>
```

- en las tres secciones internas, quitar el `aria-label` y bajar el título a `h4`. Por ejemplo,
  `<section className={card} aria-label="Contexto">` pasa a `<section className={card}>`, y
  `<h3 className="mb-2 …">Contexto</h3>` pasa a `<h4 className="mb-2 …">Contexto</h4>`, con las
  mismas clases. Igual con «Chequeo del riesgo» y «Nivel de riesgo»;
- reemplazar el cierre `</aside>` por `</section>`.

En `risk-editor/follow-up-step.tsx`, reemplazar:

```tsx
        <section aria-label="Cambios respecto de la revisión anterior" className="space-y-2">
          <h3 className="text-sm font-semibold">{change.kind === "added" ? "Riesgo nuevo en esta ronda" : "Cambios respecto de la revisión anterior"}</h3>
```

por:

```tsx
        <section aria-labelledby={`${entry.id}-h-cambios`} className="space-y-2">
          <h3 id={`${entry.id}-h-cambios`} className="text-sm font-semibold">{change.kind === "added" ? "Riesgo nuevo en esta ronda" : "Cambios respecto de la revisión anterior"}</h3>
```

Las regiones «Programa de Trabajo del riesgo» y «Observaciones del riesgo» **no** cambian: su
`aria-label` no repite el título y las E2E las localizan por ese nombre.

En `summary-strip.tsx`:
- reemplazar el botón de completos:

```tsx
              <button type="button" aria-pressed={pendingActive} onClick={onTogglePending} className={cn(toggleClass, pendingActive && activeClass)}
                aria-label={`Completos ${completeCount} de ${entries.length}: filtrar los riesgos con pendientes`}>
                <span className="text-[var(--color-text-subtle)]">Completos</span> <span className="tabular-nums">{completeCount} de {entries.length}</span>
              </button>
```

  por:

```tsx
              <button type="button" aria-pressed={pendingActive} onClick={onTogglePending} className={cn(toggleClass, pendingActive && activeClass)}>
                <span className="text-[var(--color-text-subtle)]">Completos</span> <span className="tabular-nums">{completeCount} de {entries.length}</span>
                <span className="sr-only">: filtrar los riesgos con pendientes</span>
              </button>
```

- reemplazar
  `const content = <><RiskClassificationBadge classification={cls} size="sm" /><span className="tabular-nums">{count(cls)}</span></>`
  por (el espacio explícito separa el rótulo de la cifra en el nombre; en un contenedor flex no se
  ve):

```tsx
          const content = <><RiskClassificationBadge classification={cls} size="sm" /> <span className="tabular-nums">{count(cls)}</span></>
```

- reemplazar el botón de clasificación:

```tsx
              <button type="button" aria-pressed={active} onClick={() => onToggleClassification(cls)}
                aria-label={`Filtrar la matriz: ${CLASSIFICATION_LABEL[cls]} (${count(cls)})`}
                className={cn(toggleClass, active && activeClass)}>
                {content}
              </button>
```

  por:

```tsx
              {/* El nombre empieza con lo que se ve («Importante 3») y sigue con lo que hace (WCAG 2.5.3, A2 fila 14). */}
              <button type="button" aria-pressed={active} onClick={() => onToggleClassification(cls)} className={cn(toggleClass, active && activeClass)}>
                {content}
                <span className="sr-only">: filtrar la matriz</span>
              </button>
```

- en el botón «No controlados», agregar `<span className="sr-only">: filtrar la matriz</span>`
  antes de `</button>`;
- si `CLASSIFICATION_LABEL` queda sin uso, quitarlo del import.

En `e2e/accessibility-targets.ts`, agregar a `ROUTE_URL_OVERRIDES`:

```ts
  // MIPER vigente sembrada con un riesgo y dos medidas: la estructura de la
  // matriz. La tarea, el editor y la ficha los recorre `accessibility.spec.ts`
  // aparte, porque son estados de la URL de esta misma ruta (A2, fila 17).
  "/prevencion/miper/[id]": "/prevencion/miper/riskmatrix-controles-e2e",
```

Reemplazar `e2e/accessibility.spec.ts` completo por:

```ts
import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login } from "./helpers"
import { accessibilityTargets, AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { cabecera, irAPaso, type PasoDelRiesgo } from "./miper-helpers"

/*
 * UX-001 y UX-002 (auditoría 2026-09-14).
 *
 * Antes: una lista `CRITICAL_PAGES` escrita a mano con ~20 rutas sobre 207, y
 * `.disableRules(["color-contrast"])` en las dos suites. Es decir, la
 * auditoría automática dejaba fuera módulos completos —combustibles, flota,
 * mantenciones, facturación, TI, recepción, trazabilidad— y renunciaba al
 * único criterio que más se rompe al cambiar estilos.
 *
 * Ahora el alcance sale del inventario de rutas (el mismo que alimenta las
 * capturas) y las reglas activas están declaradas en un módulo que se verifica
 * sin navegador, en `accessibility-targets.test.ts`.
 */
const targets = accessibilityTargets()

async function auditar(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags([...AXE_TAGS])
    .disableRules([...AXE_DISABLED_RULES])
    .analyze()

  expect(results.violations).toEqual([])
}

test.describe("Accessibility audit", () => {
  for (const { path, name, auth } of targets) {
    test(`${name} (${path})`, async ({ page }) => {
      if (auth) await login(page)
      await page.goto(path)

      await page.waitForLoadState("networkidle")

      await auditar(page)
    })
  }
})

/*
 * MIPER (A2, fila 17). El espacio de trabajo es una sola ruta dinámica con
 * cuatro vistas que viven en la URL: estructura, tarea (`?tarea=`), editor
 * (`?fila=&paso=`) y ficha (`?ficha=1`). El recorrido de arriba sólo visita la
 * estructura (`ROUTE_URL_OVERRIDES`); aquí se llega a las demás por la UI,
 * como una persona, sobre la MIPER vigente sembrada (`e2e/setup-db.ts`).
 */
const MIPER_VIGENTE = "/prevencion/miper/riskmatrix-controles-e2e"
const PELIGRO_SEMBRADO = "Atrapamiento en correa transportadora E2E"
const PASOS: PasoDelRiesgo[] = ["Identificación", "Evaluación", "Medidas de control", "Seguimiento"]

/**
 * Espera a que terminen las animaciones finitas (entrada del `Sheet`, fundido
 * del panel de la pestaña): axe mediría el contraste a medio fundido. Las
 * infinitas (spinners, esqueletos) se ignoran.
 */
async function sinAnimaciones(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))))
}

test.describe("Accessibility audit — MIPER: vistas del espacio de trabajo", () => {
  test("tarea, los cuatro pasos del editor y la ficha del documento", async ({ page }) => {
    await login(page)
    await page.goto(MIPER_VIGENTE)
    await page.waitForLoadState("networkidle")

    // El riesgo sembrado no trae actividad ni tarea: vive en «Sin actividad › Sin tarea».
    await page.getByRole("link", { name: /^Sin tarea/ }).click()
    await expect(page.getByRole("heading", { level: 2, name: "Sin tarea" })).toBeVisible()
    await sinAnimaciones(page)
    await auditar(page)

    await page.getByRole("link", { name: `Riesgo #1: ${PELIGRO_SEMBRADO}`, exact: true }).click()
    await expect(page.getByRole("heading", { level: 2, name: PELIGRO_SEMBRADO })).toBeVisible()
    for (const paso of PASOS) {
      await irAPaso(page, paso)
      await sinAnimaciones(page)
      await auditar(page)
    }

    await cabecera(page).getByRole("button", { name: "Ficha del documento", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Ficha del documento" })).toBeVisible()
    await sinAnimaciones(page)
    await auditar(page)
  })
})
```

En `e2e/miper-helpers.ts`, en el comentario de `elegir`, reemplazar:

```ts
 * subcadena de «No rutinaria». Con regex, el llamador ancla lo que haga falta
 * (`/^4 · Alta/`), porque el nombre de P y C incluye el criterio completo.
```

por:

```ts
 * subcadena de «No rutinaria». Con regex, el llamador ancla lo que haga falta
 * (`/^4 · Alta/`): el nombre de P y C es sólo el título («4 · Alta», o «4 · Alta
 * (extremadamente dañino)» en Consecuencia) y el criterio del RE-04 va como
 * descripción accesible (A2, fila 14).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: el comando del Step 2, más
`npm run test:fast -- components/prevention/pc-choice.test.tsx "app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx"`.

Expected: PASS. En `pc-choice.test.tsx`, `/^4 · Alta(?! \()/` sigue calzando con el nombre nuevo.

- [ ] **Step 5: Commit (unitarias y E2E nueva)**

```bash
npm run typecheck
npm run lint -- components/ui/choice-card-group.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-aside.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx" "app/(app)/prevencion/miper/[id]/summary-strip.tsx" e2e/accessibility.spec.ts e2e/accessibility-targets.ts e2e/miper-helpers.ts
git add components/ui/choice-card-group.tsx components/ui/choice-card-group.test.tsx "app/(app)/prevencion/miper/[id]/risk-editor/risk-aside.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx" "app/(app)/prevencion/miper/[id]/summary-strip.tsx" "app/(app)/prevencion/miper/[id]/summary-strip.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" e2e/accessibility.spec.ts e2e/accessibility-targets.ts e2e/accessibility-targets.test.ts e2e/miper-helpers.ts
git commit -m "fix(miper): resumen lateral como región, tarjetas nombradas por su título con Home/End, franja con su texto en el nombre y axe sobre el espacio de trabajo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Correr axe desde el worktree**

Con la receta de Global Constraints:

```bash
npm run test:e2e -- e2e/accessibility.spec.ts -g "miper|MIPER"
```

`-g` toma las rutas estáticas de MIPER, el override `/prevencion/miper/[id]` y el `describe`
nuevo.

Expected: PASS, sin violaciones. Si `results.violations` no viene vacío:
1. La diferencia del `toEqual([])` trae `id`, `impact` y `nodes[].target` de cada violación.
2. Se arregla en el componente dueño, en su capa: si es una primitiva compartida, en la primitiva,
   con su prueba unitaria.
3. Se commitea como `fix(miper): <regla axe> en <vista>`.
4. Se vuelve a correr el spec.

**Nunca** se agregan reglas a `AXE_DISABLED_RULES`. Si la violación está fuera de MIPER y no se
puede corregir en esta fase, se detiene la tarea y se informa al usuario, con la regla y el nodo.

---

### Task 8: Lógica: tarjeta «Siguiente paso», filtros sobre la URL vigente y bandas (fila 15)

**Files:**
- Modify: `lib/prevention/miper/next-step.ts`, `app/(app)/prevencion/miper/[id]/miper-workspace.tsx`, `app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx`, `components/prevention/pc-choice.tsx`, `e2e/prevencion-miper-escenario.spec.ts` (sólo un comentario)
- Test: `lib/prevention/miper/next-step.test.ts`, `app/(app)/prevencion/miper/[id]/next-step-card.test.tsx`, `app/(app)/prevencion/miper/[id]/matrix-filters-bar.test.tsx`, `components/prevention/pc-choice.test.tsx`

**Interfaces:**
- Consumes: `countOf(count, singular, plural?)` (`@/lib/utils`, el helper de plural que ya existe: «Reuse Before Creating»); `RE04_METHODOLOGY` (`@/lib/prevention/miper/methodology`).
- Produces:
  - `NextStep` gana `scope: "everywhere" | "root"`.
  - `nextStepInView(step, view: { atRoot: boolean; tab: string })`: se va `readOnly` y decide
    `step.scope`.
  - `nextStepFor` aplica la regla del revisor sólo con `hasOpenRound`.
  - Títulos con plural real:
    - «Faltan datos en 1 riesgo» / «Faltan datos en N riesgos»;
    - «Completa la ficha del documento (1 dato)»;
    - «Responde N observaciones»;
    - la descripción del revisor: «N riesgos · M Importantes o Intolerables».
  - `useMatrixFilterNavigation` arma la URL desde `window.location.search` al aplicar.

**No se cambia el hash de `taskKeyOf`.** La colisión es de ~3e-7 y cambiarlo rompe los enlaces
guardados (plan maestro).

- [ ] **Step 1: Write the failing tests**

Reemplazar `lib/prevention/miper/next-step.test.ts` completo por:

```ts
import { describe, expect, it } from "vitest"
import { nextStepFor, nextStepInView, type NextStep, type NextStepInput } from "./next-step"
import type { MiperEntrySnapshot } from "./snapshot"

const rows = [
  { id: "a", rowNumber: 1, classification: "moderate" },
  { id: "b", rowNumber: 2, classification: "important" },
] as MiperEntrySnapshot[]
const mode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canRespond: false, isSubmitter: false, readOnlyReason: null }
const input = (overrides: Partial<NextStepInput> = {}): NextStepInput => ({
  mode, status: "draft", reviewState: "none", hasOpenRound: false, hasPendingChanges: false, versionLabel: "sin versión aprobada",
  issues: [], openObservations: 0, rows, ...overrides,
})
const entryIssue = (entryId: string) => ({ scope: "entry" as const, entryId, field: "controls", message: "m", severity: "error" as const })

describe("nextStepFor", () => {
  it("1. solo lectura muestra el motivo, en todas las vistas", () => {
    expect(nextStepFor(input({ mode: { ...mode, canEdit: false, readOnlyReason: "Reemplazada por 2027" } }))).toMatchObject({ tone: "info", title: "Reemplazada por 2027", action: null, scope: "everywhere" })
  })
  it("2. quien envió la ronda espera la revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, isSubmitter: true }, hasOpenRound: true }))).toMatchObject({ title: "Enviaste esta ronda: la revisa otra persona.", scope: "root" })
  })
  it("3. el revisor parte por el riesgo más grave", () => {
    const step = nextStepFor(input({ mode: { ...mode, canEdit: false, canReviewTechnical: true }, hasOpenRound: true }))
    expect(step).toMatchObject({ title: "Revisa la versión enviada", action: { kind: "riesgo", entryId: "b", purpose: "review" }, scope: "root" })
    expect(step?.description).toBe("2 riesgos · 1 Importante o Intolerable")
  })
  it("3b. sin ronda abierta no hay nada que revisar: la regla del revisor no aplica", () => {
    expect(nextStepFor(input({ mode: { ...mode, canEdit: false, canReviewTechnical: true }, hasOpenRound: false }))).toBeNull()
  })
  it("4. con observaciones por responder lleva a Revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, canRespond: true }, reviewState: "observed", openObservations: 3 }))).toMatchObject({ title: "Responde 3 observaciones", action: { kind: "tab", tab: "revision" } })
    expect(nextStepFor(input({ mode: { ...mode, canRespond: true }, reviewState: "observed", openObservations: 1 }))?.title).toBe("Responde 1 observación")
  })
  it("5. los datos de cabecera van antes que los riesgos", () => {
    const step = nextStepFor(input({ issues: [{ scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }, entryIssue("a")] }))
    expect(step).toMatchObject({ title: "Completa la ficha del documento (1 dato)", description: "Falta la fecha de elaboración.", action: { kind: "ficha" } })
  })
  it("5b. una matriz sin riesgos no manda a la ficha ni dice «lista para enviar»: no hay tarjeta (el estado vacío trae «Nueva tarea»)", () => {
    const empty = { scope: "header" as const, field: "entries", message: "La matriz no tiene registros de evaluación.", severity: "error" as const }
    expect(nextStepFor(input({ rows: [], issues: [empty] }))).toBeNull()
    const withHeader = nextStepFor(input({ rows: [], issues: [empty, { scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }] }))
    expect(withHeader).toMatchObject({ title: "Completa la ficha del documento (1 dato)", action: { kind: "ficha" } })
  })
  it("6. faltan datos: al pendiente más grave, con el filtro como alternativa", () => {
    const step = nextStepFor(input({ issues: [entryIssue("a"), entryIssue("b"), entryIssue("b")] }))
    expect(step).toMatchObject({ tone: "warning", title: "Faltan datos en 2 riesgos", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro" } })
    expect(nextStepFor(input({ issues: [entryIssue("a")] }))?.title).toBe("Faltan datos en 1 riesgo")
  })
  it("7. sin errores en borrador: lista para enviar", () => {
    expect(nextStepFor(input())).toMatchObject({ tone: "success", title: "Lista para enviar a revisión", action: null })
  })
  it("8. vigente con cambios sin revisar", () => {
    expect(nextStepFor(input({ status: "published", hasPendingChanges: true, versionLabel: "v1", mode: { ...mode, canEdit: false } }))?.title).toBe("Hay cambios sin revisar desde v1")
  })
  it("9. sin nada que hacer no hay tarjeta", () => {
    expect(nextStepFor(input({ status: "published", mode: { ...mode, canEdit: false } }))).toBeNull()
  })
})

describe("nextStepInView", () => {
  const readOnly: NextStep = { tone: "info", title: "Reemplazada por 2027", description: "", action: null, secondary: null, scope: "everywhere" }
  const respond: NextStep = { tone: "warning", title: "Responde 3 observaciones", description: "d", action: { kind: "tab", tab: "revision" }, secondary: null, scope: "root" }
  const pending: NextStep = { tone: "warning", title: "Faltan datos en 2 riesgos", description: "d", action: { kind: "riesgo", entryId: "b", purpose: "pending" }, secondary: { kind: "filtro", completitud: "pendientes" }, scope: "root" }

  it("un paso de alcance «everywhere» (el motivo de sólo lectura) se ve también en la tarea y en el editor", () => {
    expect(nextStepInView(readOnly, { atRoot: false, tab: "matriz" })).toBe(readOnly)
    expect(nextStepInView(readOnly, { atRoot: true, tab: "matriz" })).toBe(readOnly)
  })
  it("los de alcance «root», sólo en la raíz", () => {
    expect(nextStepInView(pending, { atRoot: false, tab: "matriz" })).toBeNull()
    expect(nextStepInView(pending, { atRoot: true, tab: "matriz" })).toBe(pending)
    expect(nextStepInView(null, { atRoot: true, tab: "matriz" })).toBeNull()
  })
  it("en Revisión no ofrece «Ir a Revisión», pero conserva el texto y las otras acciones", () => {
    expect(nextStepInView(respond, { atRoot: true, tab: "revision" })).toMatchObject({ title: "Responde 3 observaciones", action: null, secondary: null })
    expect(nextStepInView(respond, { atRoot: true, tab: "programa" })?.action).toEqual({ kind: "tab", tab: "revision" })
    expect(nextStepInView(pending, { atRoot: true, tab: "revision" })).toEqual(pending)
  })
})
```

En `next-step-card.test.tsx`, agregar `scope: "root"` a cada uno de los tres objetos `step={{ … }}`
(por ejemplo, `…, secondary: null, scope: "root" }}`).

En `matrix-filters-bar.test.tsx`:
- agregar `beforeEach` al import de `vitest`;
- como primera línea dentro de `describe("MatrixFiltersBar: navegación de filtros", () => {`,
  agregar:

```tsx
  // La navegación lee la URL vigente (`window.location`), no la del render: se fija la misma que trae el mock de `useSearchParams`.
  beforeEach(() => { window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k1&clasificacion=important&buscar=lodo") })
```

- y agregar en ese `describe`:

```tsx
  it("aplica el cambio sobre la URL vigente aunque el render traiga la anterior", () => {
    // Un `replaceState` (la búsqueda, otro filtro) cambió la URL y React todavía no volvió a pintar.
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k1&clasificacion=important&buscar=lodo&controlado=no")
    const spy = replace()
    render(<MatrixFiltersBar {...props} filters={f} />)
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Clasificación" }))
    const url = last(spy)
    expect(url.searchParams.get("controlado")).toBe("no")
    expect(url.searchParams.has("clasificacion")).toBe(false)
    expect(url.searchParams.get("tarea")).toBe("k1")
    spy.mockRestore()
  })
```

En `components/prevention/pc-choice.test.tsx`:
- agregar `import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"`;
- agregar:

```tsx
  it("la leyenda de bandas sale de RE04_METHODOLOGY (la misma fuente que congela cada MIPER)", () => {
    render(<PcChoice probability={null} consequence={null} onChange={() => {}} />)
    const bands = RE04_METHODOLOGY.configuration.bands.map((band) => `${band.magnitudes.join("–")} ${band.label}`).join(" · ")
    expect(bands).toBe("1–2 Tolerable · 4 Moderado · 8 Importante · 16 Intolerable")
    expect(screen.getByText(`Bandas del RE-04: ${bands}`)).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/next-step.test.ts "app/(app)/prevencion/miper/[id]/next-step-card.test.tsx" "app/(app)/prevencion/miper/[id]/matrix-filters-bar.test.tsx" components/prevention/pc-choice.test.tsx`

Expected: FAIL.
- `next-step`: falta `scope`; los títulos todavía dicen «riesgo(s)», «dato(s)» y
  «observación(es)»; la regla 3b devuelve «Revisa la versión enviada».
- `next-step-card`: `typecheck` falla por `scope`.
- `matrix-filters-bar`: `expected null to be "no"`.

La prueba de `pc-choice` **pasa ya**: es un refactor y la prueba fija su salida, que antes y
después es la misma.

- [ ] **Step 3: Write minimal implementation**

Reemplazar `lib/prevention/miper/next-step.ts` completo por:

```ts
/**
 * La tarjeta «Siguiente paso» (spec §5.6): una sola recomendación, la primera
 * regla que aplica. Reemplaza al texto suelto que pintaba `WorkflowBar`.
 */
import { countOf } from "@/lib/utils"
import type { CompletenessIssue } from "./completeness"
import { firstPendingBySeverity } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"
import type { WorkspaceMode } from "./workspace-mode"

export type NextStepAction =
  | { kind: "ficha" }
  /** `purpose` da el rótulo: «Siguiente pendiente» para quien completa, «Empezar la revisión» para quien revisa. */
  | { kind: "riesgo"; entryId: string; purpose: "pending" | "review" }
  | { kind: "tab"; tab: "revision" }
  | { kind: "filtro"; completitud: "pendientes" }

/**
 * `scope` dice dónde se ve: `everywhere` (el motivo de solo lectura, también en
 * la tarea y en el editor, que es donde se intenta editar) o `root` (el resto,
 * sólo en la raíz de la matriz). Lo decide la regla, no quien la pinta.
 */
export type NextStep = { tone: "info" | "warning" | "success"; title: string; description: string; action: NextStepAction | null; secondary: NextStepAction | null; scope: "everywhere" | "root" }

export type NextStepInput = {
  mode: Pick<WorkspaceMode, "canEdit" | "canReviewTechnical" | "canApproveLegal" | "canRespond" | "isSubmitter" | "readOnlyReason">
  status: string
  reviewState: string
  hasOpenRound: boolean
  hasPendingChanges: boolean
  versionLabel: string
  issues: readonly CompletenessIssue[]
  openObservations: number
  rows: readonly MiperEntrySnapshot[]
}

const step = (tone: NextStep["tone"], title: string, description = "", action: NextStepAction | null = null, secondary: NextStepAction | null = null, scope: NextStep["scope"] = "root"): NextStep => ({ tone, title, description, action, secondary, scope })

export function nextStepFor(input: NextStepInput): NextStep | null {
  const { mode, rows } = input
  if (mode.readOnlyReason) return step("info", mode.readOnlyReason, "", null, null, "everywhere")
  if (mode.isSubmitter && input.hasOpenRound) return step("info", "Enviaste esta ronda: la revisa otra persona.", "Puedes seguir editando; los cambios quedan para la ronda siguiente.")
  // Revisar es sobre la foto enviada: sin ronda abierta no hay qué revisar (spec §5.6, regla 2).
  if ((mode.canReviewTechnical || mode.canApproveLegal) && input.hasOpenRound) {
    const critical = rows.filter((row) => row.classification === "important" || row.classification === "intolerable")
    const target = firstPendingBySeverity(rows, new Set(critical.map((row) => row.id))) ?? [...rows].sort((a, b) => a.rowNumber - b.rowNumber)[0]?.id ?? null
    return step("warning", "Revisa la versión enviada", `${countOf(rows.length, "riesgo")} · ${countOf(critical.length, "Importante o Intolerable", "Importantes o Intolerables")}`, target ? { kind: "riesgo", entryId: target, purpose: "review" } : null)
  }
  if (mode.canRespond && input.openObservations > 0) {
    return step("warning", `Responde ${countOf(input.openObservations, "observación")}`, "Cada respuesta queda junto a la observación; después reenvía a revisión.", { kind: "tab", tab: "revision" })
  }
  if (mode.canEdit) {
    const errors = input.issues.filter((issue) => issue.severity === "error")
    // «La matriz no tiene registros» es de cabecera, pero no se corrige en la ficha: se agrega una tarea.
    const header = errors.filter((issue) => issue.scope === "header" && issue.field !== "entries")
    if (header.length > 0) return step("warning", `Completa la ficha del documento (${countOf(header.length, "dato")})`, header[0]!.message, { kind: "ficha" })
    // Sin riesgos no hay tarjeta: el estado vacío de la matriz ya trae «Nueva tarea» justo debajo.
    if (rows.length === 0) return null
    const pending = new Set(errors.flatMap((issue) => (issue.entryId ? [issue.entryId] : [])))
    if (pending.size > 0) {
      const first = firstPendingBySeverity(rows, pending)
      return step("warning", `Faltan datos en ${countOf(pending.size, "riesgo")}`, "Empieza por los más graves; «Siguiente pendiente» te lleva al próximo.", first ? { kind: "riesgo", entryId: first, purpose: "pending" } : null, { kind: "filtro", completitud: "pendientes" })
    }
    if (input.status === "draft" || input.reviewState === "observed") return step("success", "Lista para enviar a revisión", "Usa «Enviar a revisión» en la cabecera.")
  }
  if (input.status === "published" && input.hasPendingChanges) return step("info", `Hay cambios sin revisar desde ${input.versionLabel}`, "Envíalos a revisión cuando estén listos.")
  return null
}

/**
 * Dónde se ve la tarjeta (spec §4): lo decide `step.scope`. Ya en Revisión no
 * se ofrece «Ir a Revisión».
 */
export function nextStepInView(step: NextStep | null, view: { atRoot: boolean; tab: string }): NextStep | null {
  if (!step || (!view.atRoot && step.scope !== "everywhere")) return null
  if (view.tab !== "revision") return step
  const drop = (action: NextStepAction | null) => (action?.kind === "tab" && action.tab === "revision" ? null : action)
  return { ...step, action: drop(step.action), secondary: drop(step.secondary) }
}
```

En `miper-workspace.tsx`, reemplazar
`const step = nextStepInView(nextStep, { atRoot, tab: view.tab, readOnly: Boolean(mode.readOnlyReason) })`
por:

```tsx
  const step = nextStepInView(nextStep, { atRoot, tab: view.tab })
```

En `matrix-filters-bar.tsx`:
- reemplazar `import { usePathname, useSearchParams } from "next/navigation"` por
  `import { usePathname } from "next/navigation"`;
- reemplazar el hook `useMatrixFilterNavigation` completo por:

```tsx
/**
 * Cambia los filtros de la URL sin ida al servidor (`router.replace` costaba un
 * fetch RSC por cambio o por tecla): arma la URL aquí y la aplica con
 * `navigateWorkspace(..., "replace")`. Parte de la URL **vigente**
 * (`window.location.search`), no de la del último render: dos cambios seguidos
 * —la búsqueda con su espera de 300 ms y un chip— no se pisan (A2, fila 15).
 */
export function useMatrixFilterNavigation() {
  const pathname = usePathname()
  const setFilters = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    navigateWorkspace(query ? `${pathname}?${query}` : pathname, "replace")
  }, [pathname])
  const setFilter = useCallback((key: string, value: string | null) => setFilters({ [key]: value }), [setFilters])
  return { setFilters, setFilter }
}
```

En `components/prevention/pc-choice.tsx`:
- agregar `RE04_METHODOLOGY` al import de `@/lib/prevention/miper/methodology`;
- después de `const consequenceOptions = …`, agregar:

```tsx
/** La leyenda sale de la misma fuente que congela cada MIPER (`methodology_snapshot`), no de un texto escrito a mano. */
const BANDS = RE04_METHODOLOGY.configuration.bands.map((band) => `${band.magnitudes.join("–")} ${band.label}`).join(" · ")
```

- reemplazar
  `<p className="text-xs text-[var(--color-text-subtle)]">Bandas del RE-04: 1–2 Tolerable · 4 Moderado · 8 Importante · 16 Intolerable</p>`
  por:

```tsx
      <p className="text-xs text-[var(--color-text-subtle)]">Bandas del RE-04: {BANDS}</p>
```

En `e2e/prevencion-miper-escenario.spec.ts`, línea 457, reemplazar
`  // «Faltan datos en N riesgo(s)»). Sin esto, la recarga puede ganarle a la` por
`  // «Faltan datos en N riesgos»). Sin esto, la recarga puede ganarle a la`.

- [ ] **Step 4: Run tests to verify they pass**

Run: el comando del Step 2, más
`npm run test:fast -- "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" "app/(app)/prevencion/miper/[id]/workflow-bar.test.tsx"`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/next-step.ts "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx" components/prevention/pc-choice.tsx e2e/prevencion-miper-escenario.spec.ts
git add lib/prevention/miper/next-step.ts lib/prevention/miper/next-step.test.ts "app/(app)/prevencion/miper/[id]/next-step-card.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx" "app/(app)/prevencion/miper/[id]/matrix-filters-bar.test.tsx" components/prevention/pc-choice.tsx components/prevention/pc-choice.test.tsx e2e/prevencion-miper-escenario.spec.ts
git commit -m "fix(miper): la tarjeta del revisor exige ronda abierta, plurales reales y alcance propio; filtros sobre la URL vigente; bandas desde la metodología" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Pruebas que faltan (fila 16)

**Files:**
- Test: `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx`, `app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx`, `lib/prevention/miper/entry-navigation.test.ts`, `lib/prevention/miper/workspace-url.test.ts`, `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`

**Interfaces:**
- Consumes: el fixture `show(query, workspace?, mode?)`, `workspaceOf`, `editMode`, `TASK` y `header` de `miper-workspace.test.tsx` (Task 3); `nextPendingId` (`@/lib/prevention/miper/entry-navigation`); `hrefToEntry` (`@/lib/prevention/miper/workspace-url`).
- Produces: sólo pruebas.

**Cobertura de la fila 16:**

| Lo que pide la fila 16 | Dónde queda |
|---|---|
| Guardado de `ControlForm` | Task 5 (`control-form.test.tsx`) |
| Teclado de `ChoiceCardGroup` | Task 7 (`choice-card-group.test.tsx`) |
| `beforeunload` y borrador de la ficha | Task 4 (`ficha-sheet.test.tsx`) |
| Render completo del workspace, cierre bloqueado de `NewTaskDialog`, `nextPendingId(null)`, `hrefToEntry` sin paso y regresiones del editor | esta tarea |

Por «regresiones del editor» se entiende la conducta del pie y del modo lectura que la Fase A
dejó sin prueba:
- el aviso «No quedan otros riesgos pendientes» (y su variante «en este filtro»);
- los botones deshabilitados en los extremos de la tarea;
- «Sin medidas de control.» en lectura.

Estas pruebas **fijan conducta existente**: deberían pasar a la primera. Si alguna falla, es un
defecto real: se detiene la tarea y se informa con la evidencia, sin «arreglar» la prueba.

- [ ] **Step 1: Write the tests**

En `miper-workspace.test.tsx`, agregar al final:

```tsx
describe("MiperWorkspaceView — render completo (A2, fila 16)", () => {
  it("en la raíz: título, tarjeta «Siguiente paso», pestañas, buscador y estructura", () => {
    show("")
    expect(screen.getByRole("heading", { level: 1, name: "MIPER Planta 2026" })).toBeTruthy()
    expect(screen.getByText("Faltan datos en 1 riesgo")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Siguiente pendiente" }).getAttribute("href")).toBe("/prevencion/miper/m1?fila=e1")
    expect(screen.getByRole("tab", { name: "Matriz (1)", selected: true })).toBeTruthy()
    expect(screen.getByLabelText("Buscar en la matriz")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: /Transporte/ })).toBeTruthy()
  })

  it("con ?tarea= muestra la tarea y la tarjeta no (va sólo en la raíz)", () => {
    show(TASK)
    expect(screen.getByRole("heading", { level: 2, name: "Carga" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 3, name: "Peligros identificados (1)" })).toBeTruthy()
    expect(screen.queryByText("Faltan datos en 1 riesgo")).toBeNull()
  })

  it("con ?fila=&paso= abre el editor del riesgo en ese paso", () => {
    show("fila=e1&paso=evaluacion")
    expect(screen.getByRole("heading", { level: 2, name: "Peligro 1" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Evaluación/, selected: true })).toBeTruthy()
  })

  it("una tarea que ya no existe lo dice y ofrece volver a la matriz", () => {
    show("tarea=zzz")
    expect(screen.getByText("Esta tarea ya no existe")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Volver a la matriz" }).getAttribute("href")).toBe("/prevencion/miper/m1")
  })

  it("con ?ficha=1 abre la «Ficha del documento»", () => {
    show("ficha=1")
    expect(screen.getByRole("dialog", { name: "Ficha del documento" })).toBeTruthy()
  })

  it("el motivo de solo lectura acompaña también al editor (alcance «everywhere»)", () => {
    const reason = "Esta MIPER fue reemplazada por la de otro período: se conserva como historia."
    show("fila=e1", workspaceOf(), { ...editMode, canEdit: false, readOnlyReason: reason })
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Más acciones/ })).toBeNull()
  })
})
```

En `new-task-dialog.test.tsx`, agregar:

```tsx
  it("mientras crea, el diálogo no se cierra: ni Escape ni «Cancelar»", () => {
    saveMiperEntryAction.mockReturnValueOnce(new Promise(() => {}))
    const onOpenChange = vi.fn()
    render(<NewTaskDialog open onOpenChange={onOpenChange} matrixId="m1" rows={rows} dictionaries={dictionaries} />)
    type("Actividad", "Oficina")
    type("Tarea", "Archivo")
    type("Puesto de trabajo", "Asistente")
    fireEvent.click(screen.getByRole("button", { name: "Crear tarea" }))
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Nueva tarea" }), { key: "Escape" })
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole("dialog", { name: "Nueva tarea" })).toBeTruthy()
  })
```

En `lib/prevention/miper/entry-navigation.test.ts`, dentro de `describe("recorrido", …)`:

```ts
  it("sin riesgo actual (desde la matriz) empieza por el primer pendiente por N°, respetando el filtro", () => {
    expect(nextPendingId(rows, null, new Set(["c", "b"]), null)).toBe("b")
    expect(nextPendingId(rows, null, new Set(["c", "b"]), new Set(["c"]))).toBe("c")
    expect(nextPendingId(rows, null, new Set(), null)).toBeNull()
  })
```

En `lib/prevention/miper/workspace-url.test.ts`, dentro del `describe`:

```ts
  it("hrefToEntry sin paso quita el `paso` anterior: el editor abre en el primer paso con errores", () => {
    expect(hrefToEntry(P, params("fila=e1&paso=medidas&buscar=lodo"), "e2")).toBe(`${P}?buscar=lodo&fila=e2`)
  })
```

En `risk-editor.test.tsx`, agregar:

```tsx
  it("sin otros pendientes el pie lo dice y, con filtro, aclara «en este filtro»", () => {
    const { unmount } = render(<RiskEditor {...props({ incomplete: new Set(["e1"]) })} />)
    expect(screen.getByText("No quedan otros riesgos pendientes.")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Siguiente pendiente" })).toBeNull()
    unmount()
    render(<RiskEditor {...props({ incomplete: new Set(["e1"]), matching: new Set(["e1"]) })} />)
    expect(screen.getByText("No quedan otros riesgos pendientes en este filtro.")).toBeTruthy()
  })

  it("en los extremos de la tarea, «‹ Anterior» y «Siguiente ›» quedan como botones deshabilitados", () => {
    const { unmount } = render(<RiskEditor {...props()} />)
    expect(screen.getByRole("button", { name: "‹ Anterior" })).toBeDisabled()
    expect(screen.getByRole("link", { name: "Siguiente ›" })).toBeTruthy()
    unmount()
    render(<RiskEditor {...props({ entryId: "e2" })} />)
    expect(screen.getByRole("button", { name: "Siguiente ›" })).toBeDisabled()
    expect(screen.getByText("2 de 2 en la tarea")).toBeTruthy()
  })

  it("en modo lectura, un riesgo sin medidas lo dice en el paso Medidas", () => {
    render(<RiskEditor {...props({ editable: false, step: "medidas" })} />)
    expect(screen.getByText("Sin medidas de control.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Agregar medida" })).toBeNull()
  })
```

- [ ] **Step 2: Run tests**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx" lib/prevention/miper/entry-navigation.test.ts lib/prevention/miper/workspace-url.test.ts "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"`

Expected: PASS, porque fijan conducta existente o la de las Tasks 1–8.
- Si «en la raíz…» falla porque la tarjeta dice «Completa la ficha del documento…», el fixture
  `header` dejó un dato de cabecera vacío: revisar `checkMiperCompleteness` antes de tocar el
  componente.
- Si cualquier otra falla, es un defecto: se detiene la tarea y se informa.

- [ ] **Step 3: Run the whole MIPER unit surface**

Run: `npm run test:fast -- lib/prevention/miper "app/(app)/prevencion/miper" components/prevention components/ui/combobox.test.tsx components/ui/choice-card-group.test.tsx components/ui/tabs.test.tsx components/ui/confirm-dialog.test.tsx e2e/accessibility-targets.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
npm run typecheck
git add "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx" lib/prevention/miper/entry-navigation.test.ts lib/prevention/miper/workspace-url.test.ts "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"
git commit -m "test(miper): render del espacio de trabajo, cierre bloqueado de «Nueva tarea», recorrido sin riesgo actual y regresiones del editor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: E2E en worktree, recorrido en navegador, informe QA, manual y spec

**Files:**
- Create: `qa/reports/<fecha>-miper-a2.md`. `<fecha>` es el día real de la verificación, en
  `AAAA-MM-DD`.
- Modify: `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`, `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`
- Temporal (no se versiona; se borra al terminar): `qa-a2-sonda.mjs` en la raíz del repo.

**Interfaces:**
- Consumes: todas las tareas anteriores ya commiteadas; la receta del worktree (Global Constraints); el `next dev` del usuario en :3001 (`bodega_dev`); la sesión `playwright/.auth/monkeytest.json`.
- Produces: la evidencia de la fase.

- [ ] **Step 1: E2E de MIPER desde un worktree**

Con la receta de Global Constraints, en este orden y de a un spec. Desde la segunda corrida va
`E2E_SKIP_BUILD=true`: la build del primero sirve, porque el código del worktree no cambia.

1. `npm run test:e2e -- e2e/prevencion-miper-interacciones.spec.ts`. Incluye la nueva «sólo Atrás
   restaura el scroll…».
2. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-flujo.spec.ts`
3. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-escenario.spec.ts`
4. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-programa.spec.ts`
5. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-matriz.spec.ts`
6. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-controles.spec.ts`
7. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/accessibility.spec.ts -g "miper|MIPER"`

Expected: todo PASS. Es el criterio de aceptación A2: «sin regresiones en las E2E de MIPER; el
scroll sólo se restaura con Atrás; axe sin violaciones nuevas».
- Anotar el conteo por spec, como en el informe de la Fase A.
- Si una falla: trace, causa y arreglo en un commit `fix(miper): …`.
- Después, worktree nuevo desde el HEAD nuevo y repetir **ese** spec.

- [ ] **Step 2: Comprobar que la E2E nueva discrimina**

Opcional, pero recomendado como evidencia para el informe. Hay que mostrar que «sólo Atrás
restaura…» **falla** sobre el código de antes de A2:

```bash
cd /home/allopze/dev/chome/bodega
BASE=$(git merge-base HEAD main)
git worktree add /tmp/bodega-e2e-base-${BASE:0:8} $BASE
ln -s /home/allopze/dev/chome/bodega/node_modules /tmp/bodega-e2e-base-${BASE:0:8}/node_modules
git show HEAD:e2e/prevencion-miper-interacciones.spec.ts > /tmp/bodega-e2e-base-${BASE:0:8}/e2e/prevencion-miper-interacciones.spec.ts
cd /tmp/bodega-e2e-base-${BASE:0:8}
npm run test:e2e -- e2e/prevencion-miper-interacciones.spec.ts -g "sólo Atrás restaura"
cd /home/allopze/dev/chome/bodega && git worktree remove --force /tmp/bodega-e2e-base-${BASE:0:8}
```

Expected: FAIL en la parte 2 (Programa → Matriz) con un `scrollTop` > 4. Va al informe, en PASS:
«la E2E nueva falla sobre el código previo».

- [ ] **Step 3: Recorrido asistido en navegador (`next dev` :3001, `bodega_dev`)**

1. **Preparación.**
   - Comparar migraciones aplicadas con el journal. Si difieren, el shell da 500 (memoria del
     repo):

     ```bash
     DEV_DB=$(node -e 'const { loadEnvConfig } = require("@next/env"); loadEnvConfig(process.cwd(), true, { info() {}, error() {} }); process.stdout.write(process.env.DATABASE_URL)')
     psql "$DEV_DB" -At -c "SELECT count(*), max(created_at) FROM drizzle.__drizzle_migrations"
     node -e 'const j = require("./db/migrations/meta/_journal.json"); console.log(j.entries.length, j.entries.at(-1).when)'
     ```

     Nunca imprimir `$DEV_DB`.
   - Elegir la MIPER del recorrido: la de 222 riesgos de la Fase A (`riskmatrix-7fJbp_csGgyQu8qUbYbiC`,
     «Oficina Central 2099»). Si ya no existe, la MIPER en borrador con más riesgos de
     `bodega_dev`; anotar su id.
   - Recuento antes, en solo lectura:

     ```bash
     psql "$DEV_DB" -c "BEGIN READ ONLY; SELECT (SELECT count(*) FROM prevention_risk_entries WHERE matrix_id = '<MIPER_ID>') AS riesgos, (SELECT count(*) FROM prevention_risk_controls c JOIN prevention_risk_entries e ON e.id = c.risk_entry_id WHERE e.matrix_id = '<MIPER_ID>') AS medidas; ROLLBACK;"
     ```

     Si una columna no calza, verla con `\d prevention_risk_controls`.

2. **Sonda automática.** Crear `qa-a2-sonda.mjs` en la raíz y correrla con
   `MIPER_ID=<id> node qa-a2-sonda.mjs`:

```js
// qa-a2-sonda.mjs — sonda TEMPORAL de la Tarea 10 (A2). Va en la raíz del repo
// para resolver @playwright/test. NO se versiona: `rm qa-a2-sonda.mjs` al terminar.
// La sesión QA es una credencial: no se imprime nada de ella.
import { chromium } from "@playwright/test"

const BASE = "http://localhost:3001"
const MIPER = `${BASE}/prevencion/miper/${process.env.MIPER_ID}`
const browser = await chromium.launch()
const anotar = (fila, comprobacion, valor) => console.log(JSON.stringify({ fila, comprobacion, valor }))

async function abrir(viewport) {
  const context = await browser.newContext({ storageState: "playwright/.auth/monkeytest.json", viewport })
  const page = await context.newPage()
  const errores = []
  page.on("console", (message) => { if (message.type() === "error") errores.push(message.text().slice(0, 160)) })
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().includes("dicebear")) errores.push(`${response.status()} ${new URL(response.url()).pathname}`) })
  return { context, page, errores }
}
const pozo = (page) => page.locator("[data-shell-scroll]")
const scrollTop = (page) => pozo(page).evaluate((element) => element.scrollTop)
const dosCuadros = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const alMedio = (page) => pozo(page).evaluate((element) => element.scrollTo({ top: Math.round(element.scrollHeight / 2) }))
/** Clic en el primer enlace a una tarea que esté a la vista: el clic no debe scrollear. */
const abrirTareaVisible = (page) => page.evaluate(() => {
  const enlace = [...document.querySelectorAll('a[href*="tarea="]')].find((node) => { const box = node.getBoundingClientRect(); return box.top > 120 && box.bottom < innerHeight })
  enlace.click()
})

{ // 1440×900: filas 1, 3, 5, 6, 7, 13 y 15
  const { context, page, errores } = await abrir({ width: 1440, height: 900 })
  await page.goto(MIPER)
  await page.getByRole("tab", { name: /^Matriz \(/ }).waitFor()
  await alMedio(page)
  const antes = await scrollTop(page)
  await abrirTareaVisible(page)
  await page.waitForURL(/tarea=/)
  await page.goBack()
  await page.waitForURL((url) => !url.search.includes("tarea="))
  await dosCuadros(page)
  anotar(1, "Atrás restaura [antes, después]", [antes, await scrollTop(page)])
  await page.getByRole("tab", { name: "Programa", exact: true }).click()
  await pozo(page).evaluate((element) => element.scrollTo({ top: 0 }))
  await page.getByRole("tab", { name: /^Matriz \(/ }).click()
  await dosCuadros(page)
  anotar(1, "Programa → Matriz no restaura (scrollTop)", await scrollTop(page))
  await alMedio(page)
  await abrirTareaVisible(page)
  await page.waitForURL(/tarea=/)
  await page.getByRole("link", { name: "‹ Volver a la matriz", exact: true }).click()
  await dosCuadros(page)
  anotar(1, "«‹ Volver a la matriz» no restaura (scrollTop)", await scrollTop(page))
  anotar(3, "textos «modificado» en la estructura (borrador sin versión)", await page.getByText(/modificado/).count())
  anotar(5, "enlaces «Siguiente pendiente» en la tarjeta", await page.getByRole("link", { name: "Siguiente pendiente", exact: true }).count())
  anotar(15, "título de la tarjeta", await page.getByText(/^Faltan datos en [\d.]+ riesgos?$/).textContent().catch(() => "(otra tarjeta)"))
  await page.goto(`${MIPER}?buscar=zzzz-qa-a2-sin-resultados`)
  await page.getByText("Ningún riesgo coincide con los filtros").waitFor()
  anotar(6, "CTA «Ver todos los riesgos»", await page.getByRole("button", { name: "Ver todos los riesgos", exact: true }).count())
  anotar(7, "chips «Búsqueda:»", await page.getByText("Búsqueda:", { exact: true }).count())
  anotar(7, "«Limpiar filtros» en la barra", await page.getByRole("button", { name: "Limpiar filtros", exact: true }).count())
  const inicio = Date.now()
  await page.goto(`${MIPER}?fila=riskentry-qa-a2-no-existe`)
  const esqueleto = await page.locator('[aria-busy="true"]').count()
  await page.getByText("Este riesgo ya no existe").waitFor({ timeout: 15_000 })
  anotar(13, "esqueleto visto antes del aviso / ms hasta el aviso (incluye la carga)", [esqueleto, Date.now() - inicio])
  anotar("consola/red", "1440×900", errores)
  await context.close()
}

{ // 390×844: fila 2 y la primitiva compartida
  const { context, page, errores } = await abrir({ width: 390, height: 844 })
  await page.goto(MIPER)
  await page.getByRole("tab", { name: /^Matriz \(/ }).waitFor()
  await page.locator('a[href*="tarea="]').first().click()
  await page.waitForURL(/tarea=/)
  await page.locator('a[href*="fila="]').first().click()
  await page.waitForURL(/fila=/)
  await page.getByRole("tab", { name: /Medidas de control/ }).click()
  const pasos = page.getByRole("tablist", { name: "Pasos del riesgo" })
  anotar(2, "tira de pasos [scrollWidth, clientWidth]", await pasos.evaluate((element) => [element.scrollWidth, element.clientWidth]))
  anotar(2, "paso 1 entero dentro de la tira", await pasos.evaluate((element) => {
    const lista = element.getBoundingClientRect()
    const uno = element.querySelector('[role="tab"]').getBoundingClientRect()
    return uno.left >= lista.left - 1 && uno.right <= lista.right + 1
  }))
  anotar(2, "sin scroll horizontal de página", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  anotar("consola/red", "390×844", errores)
  // `TabsList` es compartido: en otra página con pestañas el pozo no se desplaza en horizontal.
  await page.goto(`${BASE}/prevencion/miper`)
  await page.getByRole("tab", { name: "Todas", exact: true }).click()
  await dosCuadros(page)
  anotar(2, "portada MIPER: scrollLeft del pozo", await pozo(page).evaluate((element) => element.scrollLeft))
  await context.close()
}

await browser.close()
```

   Criterios de la sonda:

   | Fila | Criterio |
   |---|---|
   | 1 | Atrás: \|después − antes\| ≤ 4. Programa → Matriz y «‹ Volver a la matriz»: ≤ 4. |
   | 2 | La tira cabe (`scrollWidth ≤ clientWidth`) o el paso 1 queda entero. Sin scroll horizontal de página. El pozo de la portada en 0. |
   | 3 | 0 textos «modificado». |
   | 5 | Exactamente 1 enlace «Siguiente pendiente». |
   | 6 | Exactamente 1 CTA «Ver todos los riesgos». |
   | 7 | 0 chips «Búsqueda:» y 1 «Limpiar filtros». |
   | 13 | Primero el esqueleto (≥ 1) y después el aviso. En Network, el aviso pinta tras el GET `_rsc` del refresh. |
   | 15 | Título con plural real. |
   | Consola y red | Sin errores (dicebear es ruido conocido). |

3. **Recorrido manual, 1440×900** (con el mismo Chromium o a mano). Para cada punto se anota lo
   observado.

   | Fila | Qué hacer | Qué tiene que pasar |
   |---|---|---|
   | 4 | Un riesgo en dos pestañas. En A, «Expuestos (otro)» pasa de n a n+1 y espera «Guardado a las…». En B, lo mismo con n+2. | B dice «No se guardó: La fila cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona.» y ofrece «Recargar riesgo». **Restaurar n** desde una de las dos pestañas. |
   | 8 | Matriz → abrir una tarea (push) → «Ficha del documento» → escribir `QA_A2` en «Código IPER» → botón Atrás del navegador → «Ficha del documento». | Aparece «Recuperar lo que no guardaste» y, al usarlo, el valor `QA_A2`. Después «Cerrar» → «Cerrar sin guardar» y reabrir: ya no se ofrece. Nada se guarda en la BD. |
   | 9 | En un riesgo, «Agregar medida» con `QA_ A2 medida`, responsable `QA_ Supervisor` y plazo → guardar → «Editar» la medida. | «Agregar medida» queda deshabilitado mientras se edita. «Cancelar». |
   | 9 (falla) | La misma medida abierta en dos pestañas. A la elimina. B intenta eliminarla. | En B el diálogo sigue abierto y muestra el motivo («La medida no existe en esta MIPER; recarga la matriz.» o el `STALE_CONTROL`). Cerrar. El recuento final de medidas vuelve al inicial. |
   | 11 | «Nueva tarea» → enfocar «Actividad» → pasar el mouse por una sugerencia → Enter. | Queda elegida la sugerencia. «Cancelar», sin crear. |
   | 12 | En una tarea, «Agregar peligro». | El editor se titula «Peligro sin describir». Eliminar ese riesgo («Más» → «Eliminar riesgo»). |
   | 14 | Teclado en las tarjetas de P y C: Tab hasta el grupo, End, Home y flechas. | El foco es visible y la selección se mueve. El árbol de accesibilidad (snapshot de Playwright) nombra cada tarjeta sólo por su título. |
   | 10 | Una observación requiere un revisor con ronda abierta, que `bodega_dev` no tiene. | Se declara **COVERAGE GAP**. Lo cubren la unitaria de la Task 5 y las E2E `flujo` y `escenario`. |

4. **Recuento después**, con la misma consulta del punto 1. Tiene que dar los mismos números.
   Luego `rm qa-a2-sonda.mjs`.

- [ ] **Step 4: Informe `qa/reports/<fecha>-miper-a2.md`**

Mismo formato que `qa/reports/2026-10-02-miper-ui-fase-a.md`. Secciones, en este orden:
1. Alcance: acotado a A2, no es una auditoría de la aplicación.
2. Entorno y datos: migraciones, la MIPER y sus recuentos antes y después.
3. PASS: una tabla con la medición de cada fila de la sonda y del recorrido manual.
4. Hallazgos clasificados: PRODUCT BUG, FUNCTIONAL FINDING, UX FINDING, INCONSISTENCY,
   AUTOMATION WARNING e IMPROVEMENT OPPORTUNITY.
5. Errores de consola y fallas de red.
6. Cobertura de rutas y pasos.
7. COVERAGE GAP. Como mínimo:
   - la fila 10 en navegador;
   - el modo revisión y la tarjeta «Empezar la revisión» en `bodega_dev` (sólo E2E y
     unitarias);
   - lector de pantalla real;
   - resoluciones intermedias.
8. Limitaciones declaradas de la fila 1:
   - «‹ Volver a…» ya no restaura; sólo el Atrás del navegador;
   - entrar desde fuera del espacio de trabajo con un `<Link>` puede restaurar una clave vieja de
     esa misma URL.
9. Compuertas (Step 6), con el conteo de pruebas.
10. Recomendaciones priorizadas.

Nunca afirmar cobertura total.

- [ ] **Step 5: Manual y spec**

En `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`:

1. En «Antecedentes: los datos que se completan solos», antes de la línea «Los cambios de un MIPER
   vigente se aplican de inmediato…», agregar el párrafo:

   > Si sales de la ficha sin guardar —por ejemplo, con el botón Atrás del navegador—, lo escrito
   > no se pierde: al volver a abrirla en la misma pestaña aparece **"Recuperar lo que no
   > guardaste"** (o **"Descartar esos cambios"**). Mientras se guarda, los campos quedan
   > bloqueados.

2. En «Cómo se organiza», punto 2, reemplazar la oración `"Volver a la matriz" (o el botón Atrás del navegador) te devuelve con tus filtros intactos, a la misma altura de la página y con las actividades que habías plegado.` por:

   > "Volver a la matriz" te devuelve con tus filtros intactos y con las actividades que habías
   > plegado, desde arriba de la página. El botón **Atrás** del navegador, además, te deja a la
   > misma altura en que estabas.

3. En «Buscar y filtrar», reemplazar `Bajo la barra aparecen como **chips** que se quitan de a uno, o todos con **"Limpiar filtros"**.` por:

   > Bajo la barra aparecen como **chips** que se quitan de a uno, o todos con **"Limpiar
   > filtros"**. La búsqueda no lleva chip: ya se ve en su campo.

   Y reemplazar `Si ningún riesgo coincide, la matriz lo dice y ofrece **"Limpiar filtros"**.` por:

   > Si ningún riesgo coincide, la matriz lo dice y ofrece **"Ver todos los riesgos"**, que quita
   > la búsqueda y todos los filtros.

4. En «Editar un riesgo»:
   - en la fila **3. Medidas de control** de la tabla, después de `con "Agregar medida".`,
     agregar ` Se edita una medida a la vez. Si el servidor rechaza guardar o eliminar una medida,
     el motivo queda escrito en el formulario o en el diálogo.`;
   - en **Guardado automático**, reemplazar `Si el riesgo cambió en el servidor mientras lo editabas, el aviso trae un botón **"Recargar riesgo"**;` por:

     > Si el riesgo cambió en el servidor mientras lo editabas, el aviso dice "Recarga el riesgo
     > para ver el cambio de la otra persona" y trae el botón **"Recargar riesgo"**;

5. En «Recorrer los pendientes», reemplazar `La tarjeta **"Siguiente paso"**, bajo el encabezado de la página, te lleva al primer pendiente más grave.` por:

   > La tarjeta **"Siguiente paso"**, bajo el encabezado de la página, tiene el mismo botón
   > **"Siguiente pendiente"** y parte por el pendiente más grave. A quien revisa le ofrece
   > **"Empezar la revisión"**.

6. En «En el celular», agregar al final del párrafo:

   > En pantallas angostas, los pasos del editor muestran su número y el paso activo, su nombre.

En `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`:

1. Línea 3: `Estado: **Fase A implementada**` → `Estado: **Fase A implementada, con el pulido A2**`.
2. §3, viñeta **Lo que se recuerda al volver**: reemplazar la oración desde «y el scroll del pozo
   del shell se guarda…» hasta «…No se usa `history.state`, que es de Next.» por:

   > y el scroll del pozo del shell se guarda por URL (`miper:scroll:<ruta+query>`). Antes de
   > **toda navegación hacia adelante** (`navigateWorkspace` con push o replace, y los
   > `router.push` de crear y duplicar) se guarda el de la vista que se deja y se **borra el del
   > destino** (`beforeForwardNavigation`). Así sólo Atrás/Adelante encuentran algo que restaurar:
   > cambiar de pestaña o volver con «‹ Volver a la matriz» llega arriba. No se usa
   > `history.state`, que es de Next, ni un flag de `popstate`.

3. §5.1: reemplazar `  - Bajo la barra, chips removibles y "Limpiar filtros".` por
   `  - Bajo la barra, chips removibles y "Limpiar filtros". La búsqueda no lleva chip: ya está a la vista en su campo.`.
   Reemplazar el CTA del vacío filtrado, `con CTA\n  "Limpiar filtros" (A4), que quita las seis claves de filtro de la URL.`, por
   `con CTA\n  "Ver todos los riesgos" (A4), que quita las seis claves de filtro de la URL.`.
4. §5.4:
   - En **Pasos**, agregar al final del párrafo:

     > A `< sm`, cada paso muestra su número y el activo, su rótulo (el rótulo oculto queda
     > `sr-only`). `TabsList` centra la pestaña activa dentro de su tira cuando no cabe.

   - En **Riesgo recién creado que aún no llegó**, reemplazar
     `Si después sigue sin aparecer: "Este riesgo\n  ya no existe" y un enlace a la matriz.` por:

     > La recarga corre en una transición (`useTransition`). Si cuando termina sigue sin aparecer:
     > "Este riesgo ya no existe" y un enlace a la matriz. No hay un temporizador fijo.

5. §5.5: reemplazar `("La fila cambió mientras la\n  editabas…")` por
   `("La fila cambió mientras la editabas. Recarga el\n  riesgo para ver el cambio de la otra persona.")`.
6. §5.6:
   - En la regla 2, agregar «(sólo con `hasOpenRound`)».
   - Al final de «Reglas añadidas durante la implementación», agregar:
     - **A2:** los títulos usan plural real (`countOf`).
     - Cada paso declara su `scope` (`everywhere` para el motivo de solo lectura, `root` para el
       resto). `nextStepInView` ya no lee `readOnlyReason`.
     - La acción al riesgo se llama «Siguiente pendiente» (`purpose: "pending"`) o «Empezar la
       revisión» (`purpose: "review"`).
7. §5.7: agregar al final:

   > Lo escrito y no guardado se guarda en `sessionStorage` (`miper:ficha:<matrixId>:<version>`).
   > Al reabrir la ficha se ofrece "Recuperar lo que no guardaste", porque un `popstate` no se
   > puede cancelar. Se borra al guardar, al descartarlo y con "Cerrar sin guardar". Mientras
   > guarda, los campos quedan deshabilitados. `beforeunload` se mantiene.

8. §6.1: agregar las viñetas:
   - Con `clearLabel`, un valor libre también muestra la ✕.
   - Pasar el mouse por una opción apaga el estado «recién enfocado», así que Enter la elige.
9. §6.2: agregar las viñetas:
   - Ayuda visible «Mínimo 3 caracteres.».
   - El error del servidor en `role="alert"` (`useOperation` en modo `message`).
   - El responsable actual que ya no está en `responsibleOptions` se agrega como opción.
   - Una medida a la vez: con una edición abierta, «Agregar medida» y los otros «Editar» se
     deshabilitan.
   - El borrado espera la respuesta y muestra el error en el `ConfirmDialog` (`error`).
10. §6.3: reemplazar `- Cada tarjeta lleva el rótulo y el valor ("Alta (4)") como título y el texto del RE-04 como\n  descripción.` por:

    > - Cada tarjeta se nombra por su título ("4 · Alta"); el texto del RE-04 va como descripción
    >   accesible (`aria-describedby`).

    Reemplazar `- Las flechas mueven la selección dentro del grupo (patrón radio).` por
    `- Las flechas, Home y End mueven la selección dentro del grupo (patrón radio).`. Agregar la
    viñeta `- La leyenda de bandas sale de \`RE04_METHODOLOGY\`.`.
11. §12: agregar las viñetas:
    - El resumen lateral del editor es una `<section aria-labelledby>` y no un `<aside>`; sus
      bloques no repiten el título en `aria-label`.
    - Los botones de la franja de resumen empiezan su nombre con su texto visible (WCAG 2.5.3).
    - axe recorre la estructura, la tarea, los cuatro pasos y la ficha
      (`e2e/accessibility.spec.ts`).

- [ ] **Step 6: Puertas**

Run:

```bash
npm run typecheck && npm run lint && npm run test:fast && npm run check:secrets && npm run doctor
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
```

Expected: verde. `db:verify-migrations` no aplica, porque no hay migración. Anotar en el informe
los conteos de `test:fast` (archivos y pruebas) y el resultado de PGlite.

- [ ] **Step 7: Commit**

```bash
git status --short   # qa-a2-sonda.mjs NO debe aparecer (ya borrado); .gitignore modificado NO se agrega
git add docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md qa/reports/<fecha>-miper-a2.md
git commit -m "docs(miper): manual y spec al día con el pulido A2 e informe de verificación" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Autorrevisión contra la tabla A2

| # | Qué | Task |
|---|---|---|
| 1 | El scroll se restaura de más | 1. Unitarias + E2E «sólo Atrás restaura…». Se corre en la Task 10. |
| 2 | Tira de pasos y pestañas a 390 px | 2. Medición en navegador en la Task 10. |
| 3 | «Nueva/modificado» sin línea base | 3 |
| 4 | «Recarga la matriz» vs «Recargar riesgo» | 3. PGlite. |
| 5 | Un solo nombre para la acción | 3. Ninguna E2E que ajustar. |
| 6 | Dos «Limpiar filtros» | 3 |
| 7 | La búsqueda también como chip | 3 |
| 8 | La ficha pierde lo escrito al volver | 4 |
| 9 | Medidas (deshabilitar, ayuda, `role=alert`, borrado que espera, responsable actual) | 5 |
| 10 | Observación: `Field` con «mínimo 5 caracteres» | 5 |
| 11 | `Combobox`: ✕ del valor libre y hover | 6 |
| 12 | Peligro vacío | 3 |
| 13 | «Ya no existe» con `useTransition` | 6 |
| 14 | Accesibilidad (`aside` → `section`, `aria-describedby` + Home/End, nombres de la franja) | 7 |
| 15 | Lógica (`hasOpenRound`, plural, `scope`, URL vigente, bandas; `taskKeyOf` intacto) | 8 |
| 16 | Pruebas que faltan | 9 (más 4, 5 y 7, según su tabla) |
| 17 | axe | 7. Se corre en el Step 6 de la Task 7 y en la Task 10. |

Nombres que cruzan tareas:
- `beforeForwardNavigation`: definido en la Task 1 y usado por la Task 1.
- `readFichaDraft`, `writeFichaDraft` y `clearFichaDraft`: definidos y usados en la Task 4.
- `NextStepAction.purpose`: lo agrega la Task 3 y lo consume la Task 8.
- `NextStep.scope`: lo agrega la Task 8, junto con los fixtures de `next-step-card.test.tsx`.
- `ControlCard.onDelete` y `editDisabled`: Task 5.
- `ConfirmDialog.error`: Task 5.
- El fixture `show`, `workspaceOf`, `editMode`, `TASK` y `header` de `miper-workspace.test.tsx`:
  lo crea la Task 3 y lo usa la Task 9.

## Después de A2

Integrar localmente en `main` con todo en verde, sin push (subirlo se consulta). Luego, el plan de
la **Fase B** (portada por faena y Resumen, spec §7) con este mismo formato, en la rama
`feat/miper-b-…` desde `main`.
