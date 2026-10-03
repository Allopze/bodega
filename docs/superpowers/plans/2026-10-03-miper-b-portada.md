# MIPER — plan de implementación de la Fase B (portada por faena y Resumen)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La portada `/prevencion/miper` pasa a ser una fila por faena en alcance —con o sin MIPER—,
con una franja de cuatro cifras que llevan exactamente a su subconjunto, «Requieren mi acción» y
«Crear MIPER» por fila; el espacio de trabajo gana la pestaña «Resumen», «Elaboró» y «Cambiar de
faena»; y «Riesgos críticos sin control» queda con una sola definición para el tablero y la portada.

**Architecture:** Las reglas puras viven en `lib/prevention/miper/`: `critical-control.ts` (el
predicado «crítico sin control»), `inbox.ts` (qué espera una MIPER de una persona) y `portfolio.ts`
(qué MIPER representa a cada faena, sus estados, la URL de la portada y las cifras). El servicio
`lib/services/miper/portfolio.ts` arma una fila por faena con consultas que no crecen con el número
de MIPER: las fotos salen en lote con `buildMiperSnapshots` (y `buildMiperSnapshot` pasa a ser su caso
de una, con prueba dorada de que su salida no cambió). La portada filtra en el cliente lo que el
servicio ya acotó al alcance; el espacio de trabajo suma la pestaña «Resumen» con el historial nativo
(`WorkspaceLink`), sin ida al servidor. Lo compartido se corrige en su primitiva: `SummaryBar` gana
`renderLink`.

**Tech Stack:** Next.js 16.3.8 (App Router), React 19.2, TypeScript, Drizzle 0.45, Tailwind v4,
Radix, Vitest 4 + Testing Library (jsdom; `@testing-library/jest-dom` ya viene cargado en
`components/__tests__/setup.ts`), PGlite 0.5, Playwright 1.62 y `@axe-core/playwright`. Antes de
tocar navegación, leer en `node_modules/next/dist/docs/`:
- `01-app/03-api-reference/02-components/link.md` (§`replace` y §`scroll`);
- `01-app/03-api-reference/04-functions/use-router.md`;
- `01-app/01-getting-started/04-linking-and-navigating.md` (§«Native History API»);
- `01-app/01-getting-started/07-mutating-data.md`: el cliente despacha las Server Functions **de a
  una**. La lectura del selector de faena es bajo demanda (al abrir el menú), nunca en cada render.

**Spec:** `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` (§2.3, §3, §7; §4–§5
para el espacio de trabajo). Alcance: plan maestro `/home/allopze/.claude/plans/revisa-el-ui-ux-de-stateful-zebra.md`,
sección «B. Portada por faena y Resumen (spec §7)», con sus decisiones y su criterio de aceptación:
«la portada lista todas las faenas en alcance, incluidas las que no tienen MIPER, y cada cifra lleva
exactamente a su subconjunto (E2E y `densidad-kpi`). La prueba dorada del snapshot está verde». Donde
la spec (§7) y el plan maestro difieren, manda el plan maestro, que es posterior y está aprobado: la
cuarta cifra es «Riesgos críticos sin control» y el servicio va en `portfolio.ts`.

## Global Constraints

- **Rama:** `feat/miper-portada` (ya creada desde `main` 4f980172, que trae la Fase A y el pulido A2).
- **Sin migraciones.** Ninguna tarea toca `db/schema` ni `db/migrations`. Si una se volviera
  imprescindible: `npm run db:generate`, checksum con
  `node scripts/verify-migration-chain.mjs --update-checksums`, `npm run db:verify-migrations`, y
  nunca editar `db/migrations/meta/_journal.json` ni una migración ya creada (AGENTS.md).
- **Autorización:** no cambian rutas ni permisos, ni `modules/*`. Toda lectura nueva vuelve a
  autorizar en el servidor: `requireAccess(access, "prevention:risk:view")` y `scopeCondition` sobre la
  faena. La acción nueva va por `guarded("prevention:risk:view", …)`. Ocultar algo en la UI no es
  autorización.
- **Layout:** toda página con `PageHeader` + `PageContainer`. Ningún `<h1>` propio. **Ningún buscador
  nuevo:** la portada usa el del TopBar a través de `DataTable` (D8 de la spec; `/prevencion/miper` no
  está en `ROUTES_WITH_OWN_SEARCH`), y `/prevencion/miper/[id]` sigue en `OWN_SEARCH_PATTERNS`.
- **Navegación:**
  - En la portada, todo cambio de filtro es `router.replace(url, { scroll: false })`, y las cifras de la
    franja son `<Link replace scroll={false}>`. `portfolioHref` (Task 3) arma la URL y borra siempre el
    `tab` heredado.
  - En el espacio de trabajo se navega con `navigateWorkspace` / `WorkspaceLink`
    (`app/(app)/prevencion/miper/[id]/workspace-nav.tsx`): historial nativo y sin ida al servidor.
    `router.push` queda sólo para salir a otra MIPER (selector de faena), precedido de
    `beforeForwardNavigation(href)` como toda navegación hacia adelante (spec §3).
- **Densidad (AGENTS A1–A6):**
  - A1: cuatro cifras por pantalla. Cada una lleva a su subconjunto y SÓLO a él (sin arrastrar otros
    filtros). Una cifra en cero que llevaría a una lista vacía no enlaza.
  - A4: todo estado vacío explica qué significa y ofrece una acción real.
  - A5: una cifra, una representación. «Requieren mi acción» sólo tiene cifra en la franja; el
    segmento no la repite (ver «Decisiones», 7).
  - A6: estados con `MetaBadge` + `metaFor` (`components/states/state-badge.tsx`). La regla
    `local/no-raw-badge-variant-map` prohíbe `<Badge variant={mapa[x]}>`.
- **Texto y fechas:**
  - Color de texto sólo con tokens `-ink` (`--color-signal-ink`, `--color-danger-ink`…).
  - Copy en español de Chile; plurales con `countOf` de `@/lib/utils`.
  - Fechas con `formatDate`; el día de hoy, con `todayInChile()`. Nunca `toLocaleDateString` ni
    `new Date().toISOString().slice(0, 10)`.
- **Sin exportaciones nuevas.** Si apareciera una: Excel con `ExportButton` / `ExportDialog`.
- **Formularios:** `Field` para los campos. `NewMiperDialog` sigue con `useOperation` (envío
  imperativo); el selector de faena también usa `useOperation`.
- **Árboles duplicados:** sólo el de `DataTable` (tabla `hidden md:block` + tarjetas `md:hidden`). En
  E2E: localizadores por rol, `listRecord()` de `e2e/helpers.ts`, `exact: true` cuando un nombre es
  prefijo de otro, y nada de `.first()` para esquivar el modo estricto.
- **Bases de datos:**
  - Producción (`plataforma-db-1`) nunca.
  - `bodega_dev` (contenedor `bodega-dev-db`, 127.0.0.1:5433) sólo en transacciones de solo lectura
    (`BEGIN READ ONLY … ROLLBACK`). El recorrido en navegador no crea, guarda ni envía nada.
  - Nunca imprimir la URL de la base, la sesión QA ni una cookie.
- **Puertas por tarea:**
  - `npm run typecheck`;
  - `npm run lint -- <archivos tocados>` (el guard pasa los argumentos a `eslint`);
  - `npm run test:fast -- <archivos>`, con las rutas de `app/(app)/…` entre comillas;
  - `npm run test:pglite -- <archivo>` para cada suite PGlite tocada. Toda suite PGlite nueva se
    registra en `tests/pglite-files.ts`, o `test:fast` la intenta correr en paralelo.
- **Pruebas de componentes:**
  - Empiezan con `// @vitest-environment jsdom` en la primera línea.
  - Mockean `next/navigation`, las acciones (`./actions` o `../actions`) y `@/lib/toast`, como
    `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx`.
  - Lo que usa `PageHeader` se envuelve en `ShellHeaderProvider` (`@/components/layout/header-context`).
  - jsdom no aplica CSS: la tabla y las tarjetas de `DataTable` están las dos en el DOM. Se acota con
    `within(screen.getByRole("table", { name: … }))`.
- **Commits:**
  - En español: `feat(miper): …` / `fix(miper): …` / `test(miper): …` / `docs(miper): …`.
  - Cuerpo final con una línea en blanco y la atribución, que es lo que produce el último `-m`:
    `git commit -m "<asunto>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
  - `git add` con rutas explícitas y entre comillas. **Nunca** `git add -A` ni `git add .`, y
    **nunca** `.gitignore` (el usuario lo tiene modificado a propósito).
  - Nunca `--no-verify`. Nunca `push`.
- **E2E sólo desde un worktree desechable.** `e2e/start-server.sh` hace `rm -rf .next`, lo que
  rompería el `next dev` del usuario en :3001.
  - **Receta** (la misma que verificó el pulido A2, `qa/reports/2026-10-03-miper-a2.md` §2 y §9):

    ```bash
    cd /home/allopze/dev/chome/bodega
    SHA=$(git rev-parse --short HEAD)
    git worktree add /tmp/bodega-e2e-$SHA HEAD
    ln -s /home/allopze/dev/chome/bodega/node_modules /tmp/bodega-e2e-$SHA/node_modules
    # :3100 tiene que estar libre: con `reuseExistingServer: true`, Playwright usaría un servidor viejo.
    ss -ltnp | grep ':3100 ' && echo "OCUPADO: matar por PID (ss -ltnp), nunca pkill -f"
    cd /tmp/bodega-e2e-$SHA
    npm run test:e2e -- e2e/<spec>.spec.ts                       # el primero construye (minutos)
    E2E_SKIP_BUILD=true npm run test:e2e -- e2e/<otro>.spec.ts   # los siguientes reusan la build
    cd /home/allopze/dev/chome/bodega
    git worktree remove --force /tmp/bodega-e2e-$SHA
    ```

  - **No se copia `.env` ni `.env.local` al worktree.** `scripts/run-e2e.sh` levanta o reusa
    `bodega-e2e-postgres` (127.0.0.1:55432) y `e2e/start-server.sh` pasa explícitas todas las
    variables de la build y del servidor, igual que CI, que corre sin ningún `.env*`. `.env.local`
    apunta a `bodega_dev` y `next build` lo leería (las variables que el script no pisa se colarían en
    la build).
  - Si el build del worktree falla por una variable de entorno faltante, copiar sólo `.env` (nunca
    `.env.local`, que apunta a `bodega_dev`) y reintentar.
  - **Un spec por corrida.** Cada corrida vuelve a sembrar la base E2E.
  - El worktree toma sólo lo **commiteado**: primero el commit y después la corrida.
  - Si una E2E falla, abrir el trace (`npx playwright show-trace test-results/…/trace.zip`) antes de
    tocar un localizador.
- **Números de línea:** los citados son los de 4f980172. Una tarea anterior puede correrlos, así que
  cada paso cita además el texto exacto que se reemplaza: se ubica por el texto.
- **Entre la Task 7 y la Task 10 las E2E de la portada quedan desalineadas** (la portada vieja
  desaparece en la 7; los specs se ajustan en la 10). Ninguna E2E se corre ni se integra antes de la
  Task 10.

## Review Focus

1. **Una acción pendiente escondida detrás de la MIPER de la fila.**
   - Caso: la faena tiene la vigente con observaciones por responder y además el borrador del período
     siguiente. La fila muestra el borrador, pero quien edita tiene que ver también «Con observaciones
     · MIPER 2026», y la Jefa tiene que encontrar la ronda que le toca aunque no sea la MIPER de la fila.
   - Lo fijan:
     - la Task 3 (`portfolioActionOrder`);
     - la Task 4: PGlite «"requiere mi acción" mira todas las MIPER no reemplazadas de la faena»;
     - la Task 7: «cada acción pendiente enlaza a ESA MIPER y la vigente va aparte».
2. **Quien envió la ronda y además puede revisar.**
   - Su propia MIPER no puede aparecer como «Pendiente de tu revisión» ni contarse en «Requieren mi
     acción», ni llegarle como «Revisar / Firmar» en «Mi trabajo». Es la regla de
     `workspace-mode.ts:42-45` y de `assertNotSubmitter`; hoy ni `listMiperInbox` ni la cola la
     aplican.
   - Lo fijan:
     - la Task 3 (`inbox.test.ts`: «quien envió la ronda no la ve como pendiente…»);
     - la Task 4: PGlite en `miper-portfolio.test.ts` y en `miper-queries.test.ts`;
     - la Task 5: PGlite en `miper-work-queue.test.ts` («quien envió la ronda no la recibe para
       revisar ni firmar…»), para la cola «Mi trabajo».
3. **Foto en lote distinta de la de antes.**
   - Riesgos:
     - una fila sin N° tomaría su posición en el lote y no en su MIPER (`rowNumber: entry.rowNumber ??
       index + 1`);
     - un cambio en el orden de las claves cambiaría el `snapshotSha` aunque `toEqual` pase.
   - Lo fija, en la Task 2, la prueba dorada: compara `JSON.stringify` y `snapshotSha` con una copia
     literal de la función de antes, con filas sin N°, una MIPER vacía y filas intercaladas entre dos
     MIPER.
4. **Un `?tab=porhacer` viejo que se pega.**
   - Llegar con el enlace de la bandeja vieja abre «Requieren mi acción». Pero si al cambiar de vista
     el `tab` quedara en la URL, «Todas las faenas» no se podría volver a elegir.
   - Lo fijan:
     - la Task 3 (`portfolioHref` borra siempre `tab`);
     - la Task 7: «?tab=porhacer (la bandeja de antes) abre «Requieren mi acción»; cambiar de vista
       borra el `tab` heredado».
5. **El Resumen con filtros previos o con la actividad plegada.**
   - Si la persona llega al Resumen con `?buscar=…&factor=…`, cada cifra tiene que quitar los seis
     filtros de la matriz antes de aplicar el suyo, o lo que se ve al llegar no es lo que la cifra
     contó.
   - El enlace a una actividad plegada tiene que desplegarla y dejarla a la vista.
   - Lo fijan, en la Task 8: `workspace-url.test.ts` (`hrefToMatrixOnly`) y `resumen-panel.test.tsx`
     («cada cifra quita los filtros…» y «el enlace a una actividad plegada la despliega…»).

---

## Decisiones (donde la spec o el plan maestro callan)

| # | Tema | Decisión | Costo |
|---|---|---|---|
| 1 | ¿Resumen pasa a ser la pestaña por defecto? | **No.** La spec §3 lo dice: «`matriz` (por defecto; no se escribe)», y D9 deja la matriz como vista por defecto. Resumen va primero en la tira (orden de §2.3), pero sólo se abre con `?tab=resumen`. | Quien quiera ver el Resumen hace un clic más. |
| 2 | «Requieren mi acción» con varias MIPER no reemplazadas en la faena | Se evalúa **cada** MIPER no reemplazada de la faena (`myActions`), no sólo la de la fila. Cada acción es un enlace «<motivo> · MIPER <período>» a ESA MIPER. | La fila puede listar dos enlaces de acción. |
| 3 | Estado, «sin control» y avance cuando la fila y la vigente son distintas | Estado, versión, completitud, graves y «Elaboró» son de la MIPER de la fila (la de mayor período). «Riesgos críticos sin control» y el avance del programa son de la **vigente**: el KPI sólo cuenta MIPER vigentes, y el programa que se ejecuta es el de la vigente. La celda lo aclara con «en la vigente». | Una fila mezcla dos MIPER. Queda dicho en la celda. |
| 4 | Completitud de la portada | `checkMiperCompleteness(foto, { linkedControlIds, requireProgramLink: true })`, la misma regla que «Completos x de y» del espacio de trabajo (`miper-workspace.tsx:71-78`). Se usa la foto **viva**, también si hay una ronda abierta. | Una consulta más en lote (vínculos al programa). |
| 5 | Estados de la portada | Cinco: `sin_miper` · `borrador` · `en_revision` (técnica o Legal y RRHH) · `observada` · `vigente`. El filtro suma «Con MIPER», que es el destino de la cifra «Faenas con MIPER». El detalle sigue a la vista (`miperStatusLabel`). | Los valores viejos de `?estado=` (`draft`, `published`…) dejan de filtrar. Sólo los usaba la portada vieja. |
| 6 | Cifra «Riesgos completos» del Resumen | Muestra `x/y` y, como pide la spec §7, lleva a `completitud=pendientes`. Debajo dice «N riesgos con pendientes», que es lo que se ve al llegar. Sin pendientes, lleva a `completitud=completos`. Las cifras en 0 no enlazan. | — |
| 7 | A5: la franja, el segmento y el filtro de estado | **Resuelto, no es una excepción.** La cifra «Requieren mi acción» vive sólo en la franja. El `SegmentedControl` dice «Todas las faenas» / «Requieren mi acción», sin «(n)». Que la cifra «En revisión» escriba la misma clave `estado` que el filtro de estado se queda: una cifra que filtra es lo que pide A1, no una segunda representación. | Se aparta de la letra de la spec §7 y del plan maestro, que pedían «Requieren mi acción (n)». |
| 8 | Dónde va «Cambiar de faena» | En las acciones del `PageHeader` del espacio de trabajo, primero. Las migas del TopBar sólo se pintan a ≥1280 px (`top-bar.tsx:139-140`): ahí el selector desaparecería en pantallas menores. | La cabecera suma un botón. |
| 9 | Faenas sin MIPER en el selector | Se listan como «<faena> · sin MIPER» y llevan a la portada `?faena=<id>`, donde está «Crear MIPER». | — |
| 10 | Vista por defecto de la portada | «Todas las faenas». Antes era «Por hacer». | Cambia lo primero que ve quien entra. La cifra «Requieren mi acción» queda a un clic. |
| 11 | La cifra del programa en el Resumen | Lleva a `tab=programa` sin quitar los filtros de la matriz, porque no afectan esa cifra. | — |
| 12 | `listMipers` y `listMiperInbox` | Quedan sin consumidor de producción, pero **no se retiran en B**: el plan maestro no los lista. `listMiperInbox` pasa a usar el predicado extraído y conserva sus pruebas. | Código sólo usado por pruebas, para limpiar después. |
| 13 | `SummaryBar` y la navegación | Gana `renderLink` (sólo en modo completo). La portada lo usa para filtrar con `replace` y sin scroll; el Resumen, para navegar con `WorkspaceLink`. Arreglo en la capa compartida, no en cada página. | — |

## Correcciones al plan maestro (referencias verificadas el 2026-10-03 sobre 4f980172)

- `buildRows` está en `lib/services/miper/queries.ts:164` (no en la 158) y es privada: se exporta.
- `snapshotSha` está definida en `lib/services/miper/snapshots.ts:11`. `workflow.ts:97` es donde se
  hashea al enviar. `buildMiperSnapshot` ocupa `snapshots.ts:15-64`.
- `MATRIX_FILTER_KEYS` vive en `lib/prevention/miper/matrix-filters.ts:9`, no en `workspace-url.ts`.
- **El predicado** está en `lib/services/prevention-risk-legal.ts:1069-1079` (comentario y filtro).
  Dos precisiones:
  - Su semántica es «le falta una medida implementada o verificada **o** le falta un vínculo PDTP»:
    basta que falte una de las dos. No es «sin… ni…».
  - El vínculo es `prevention_pdtp_source_links` (PDTP corporativo), no el programa RE-04.1 de la
    MIPER.
  - Se extrae tal cual, para que el tablero no cambie de cifra.
- `occurrencesByMatrixOf` es privada en `lib/services/miper/dashboard.ts:216`. `programProgress` está
  en `lib/prevention/miper/progress.ts:34`. `getProgramProgress(client, matrixId)` está en
  `lib/services/miper/program-execution.ts:353` y no controla acceso: se llama después de
  `getMiperWorkspace`.
- `getMiperDashboard` (`dashboard.ts:106`) sólo lo consume `app/(app)/prevencion/miper/page.tsx`, así
  que se retira **entero**:
  - `lib/services/miper/dashboard.ts`;
  - `app/(app)/prevencion/miper/dashboard-panel.tsx`;
  - `lib/__tests__/miper-dashboard.test.ts`;
  - su registro en `tests/pglite-files.ts:32-33`.
- `listMiperInbox` (`queries.ts:214`) **no** excluye hoy a quien envió la ronda;
  `lib/prevention/miper/workspace-mode.ts:42-45` sí.
- `DataTable` está en `components/ui/data-table.tsx` (AGENTS.md dice `components/admin/`). Usa
  `row.id` como clave (`data-table.tsx:414,443`).
- El enlace del PDTP con `?faena=` está en `lib/services/pdtp-adapters/fulfillment-contract-2026.ts:219`.
- El KPI del tablero está en `app/(app)/dashboard/sections/prevention-section.tsx:102-107` (el `href`,
  en la 106). Su E2E está en `e2e/densidad-kpi.spec.ts:164`.
- `#miper-activity-<clave>` es el `id` del `<h2>` de cada actividad (`[id]/activity-section.tsx:30,34`).
- El «Arreglo» de la spec §7 sobre el título de `loading.tsx` ya se hizo en la Fase A (5eef1ab6).
- **Otras E2E dependen de la portada vieja** y se ajustan en la Task 10:
  - `prevencion-miper-flujo.spec.ts:54-57` y `:139-145`: el `.first()` de «Nueva MIPER» y la tarjeta
    de la bandeja (`a[href=…]` con «Pendiente de tu revisión»);
  - `prevencion-miper-escenario.spec.ts:125-128` y `:229-232`: lo mismo;
  - `prevencion-miper-programa.spec.ts:70`: el `.first()` de «Nueva MIPER».
- **Manual:** la portada está en §2 (pestañas y alta) y en §3. La §4 es la evaluación P×C y no cambia.
  Además, la §9 nombra las pestañas en la línea 350.
- **Receta E2E:** sin copiar `.env` ni `.env.local` (ver Global Constraints).

## Mapa de archivos

| Archivo | Task |
|---|---|
| `lib/prevention/miper/critical-control.ts` (+ test nuevo), `lib/services/prevention-risk-legal.ts` | 1 |
| `lib/services/miper/snapshots.ts`, `lib/__tests__/miper-snapshot-batch.test.ts` (nuevo), `tests/pglite-files.ts` | 2 |
| `lib/prevention/miper/inbox.ts` (+ test nuevo), `lib/prevention/miper/portfolio.ts` (+ test nuevo) | 3 |
| `lib/services/miper/queries.ts`, `lib/services/miper/portfolio.ts` (nuevo), `lib/__tests__/miper-portfolio.test.ts` (nuevo), `lib/__tests__/miper-queries.test.ts`, `tests/pglite-files.ts` | 4 |
| `lib/services/operational-work-queue.ts` (rama `miper_review`), `lib/__tests__/miper-work-queue.test.ts` (PGlite, ya registrada) | 5 |
| `components/ui/summary-bar.tsx`, `components/ui/summary-bar-stat-cell.tsx`, `components/ui/summary-bar.test.tsx` (nuevo), `app/(app)/prevencion/miper/new-miper-dialog.tsx` (+ test nuevo), `app/(app)/prevencion/miper/miper-home.tsx` (sólo el puente hasta la Task 7) | 6 |
| `app/(app)/prevencion/miper/miper-home.tsx` (reescrito, + test nuevo), `page.tsx`, `app/(app)/dashboard/sections/prevention-section.tsx`, `tests/pglite-files.ts` | 7 |
| Se borran: `app/(app)/prevencion/miper/dashboard-panel.tsx`, `lib/services/miper/dashboard.ts`, `lib/__tests__/miper-dashboard.test.ts` | 7 |
| `lib/prevention/miper/workspace-url.ts` (+test), `app/(app)/prevencion/miper/[id]/resumen-panel.tsx` (+ test nuevo), `[id]/workspace-memory.ts` (+test), `[id]/workspace-nav.tsx` (+test), `[id]/miper-workspace.tsx` (+test), `[id]/page.tsx` | 8 |
| `app/(app)/prevencion/miper/actions.ts` (+test), `[id]/worksite-switcher.tsx` (+ test nuevo), `[id]/miper-workspace.tsx` (+test), `lib/services/miper/queries.ts`, `lib/__tests__/miper-queries.test.ts` | 9 |
| `e2e/prevencion-miper-matriz.spec.ts` (reescrito), `e2e/prevencion-miper-escenario.spec.ts`, `e2e/prevencion-miper-flujo.spec.ts`, `e2e/prevencion-miper-programa.spec.ts`, `e2e/densidad-kpi.spec.ts`, `e2e/accessibility.spec.ts` | 10 |
| `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`, `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`, `qa/reports/2026-10-03-miper-b.md` (nuevo) | 11 |

---

### Task 1: Una sola definición de «Riesgos críticos sin control»

**Files:**
- Create: `lib/prevention/miper/critical-control.ts`
- Test: `lib/prevention/miper/critical-control.test.ts`
- Modify: `lib/services/prevention-risk-legal.ts:44` (import) y `:1069-1079` (el filtro de `getRiskDashboard`)

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces (en `lib/prevention/miper/critical-control.ts`):
  - `type CriticalCandidate = { classification: string | null; isCritical: boolean }`
  - `type CriticalCandidateControl = { id: string; status: string }`
  - `isCriticalRisk(entry: CriticalCandidate): boolean`
  - `isCriticalWithoutControl(entry: CriticalCandidate, controls: readonly CriticalCandidateControl[], pdtpLinkedControlIds: ReadonlySet<string>): boolean`
- La Task 4 (portada) y `getRiskDashboard` (tablero) usan las dos funciones. El filtro de
  «vigente» (`status = 'published'`) lo pone quien llama.

- [ ] **Step 1: Write the failing test**

Crear `lib/prevention/miper/critical-control.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isCriticalRisk, isCriticalWithoutControl } from "./critical-control"

const intolerable = { classification: "intolerable", isCritical: false }
const linked = new Set(["c-pdtp"])

describe("riesgo crítico sin control (KPI del tablero y portada MIPER)", () => {
  it("crítico es el Intolerable del RE-04 o, en una fila legacy sin clasificación, la marcada crítica", () => {
    expect(isCriticalRisk(intolerable)).toBe(true)
    expect(isCriticalRisk({ classification: null, isCritical: true })).toBe(true)
    expect(isCriticalRisk({ classification: null, isCritical: false })).toBe(false)
    // Con clasificación RE-04, la marca legacy ya no manda.
    expect(isCriticalRisk({ classification: "important", isCritical: true })).toBe(false)
    expect(isCriticalRisk({ classification: "moderate", isCritical: false })).toBe(false)
  })

  it("un Intolerable sin medidas está sin control", () => {
    expect(isCriticalWithoutControl(intolerable, [], linked)).toBe(true)
  })

  it("le falta una de las dos cosas: medida implementada o verificada, o medida con vínculo PDTP", () => {
    // Implementada pero fuera del PDTP.
    expect(isCriticalWithoutControl(intolerable, [{ id: "c1", status: "implemented" }], linked)).toBe(true)
    // En el PDTP pero sólo propuesta.
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "proposed" }], linked)).toBe(true)
    // Ineficaz o retirada no cuentan como implementada.
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "ineffective" }], linked)).toBe(true)
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "retired" }], linked)).toBe(true)
  })

  it("controlado: alguna medida implementada o verificada y alguna en el PDTP (pueden ser distintas)", () => {
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "verified" }], linked)).toBe(false)
    expect(isCriticalWithoutControl(intolerable, [{ id: "c-pdtp", status: "implemented" }], linked)).toBe(false)
    expect(isCriticalWithoutControl(intolerable, [{ id: "c1", status: "implemented" }, { id: "c-pdtp", status: "proposed" }], linked)).toBe(false)
  })

  it("lo que no es crítico nunca cuenta", () => {
    expect(isCriticalWithoutControl({ classification: "important", isCritical: false }, [], linked)).toBe(false)
    expect(isCriticalWithoutControl({ classification: null, isCritical: false }, [], linked)).toBe(false)
  })

  it("una fila legacy crítica sin control cuenta", () => {
    expect(isCriticalWithoutControl({ classification: null, isCritical: true }, [{ id: "c1", status: "verified" }], linked)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/prevention/miper/critical-control.test.ts`
Expected: FAIL con «Failed to resolve import "./critical-control"».

- [ ] **Step 3: Write minimal implementation**

Crear `lib/prevention/miper/critical-control.ts`:

```ts
/**
 * «Riesgos críticos sin control» (Fase B): UNA definición para el KPI del
 * tablero (`getRiskDashboard` → `prevention-section.tsx`) y para la portada
 * MIPER (`listMiperPortfolio`). Así las dos pantallas dicen la misma cifra.
 *
 * - **Crítico:** Intolerable en el RE-04 o, en una fila legacy sin
 *   clasificación, marcada `isCritical`.
 * - **Sin control:** le falta una medida implementada o verificada, **o** le
 *   falta una medida con vínculo PDTP activo (`prevention_pdtp_source_links`,
 *   `source_type = 'risk_control'`). Basta que falte una de las dos. Es el
 *   criterio que el tablero ya aplicaba en `prevention-risk-legal.ts`; se
 *   extrae sin cambiarlo.
 *
 * Sólo cuenta en MIPER vigentes. Ese filtro lo pone quien llama, que es quien
 * sabe qué matrices están publicadas.
 */
export type CriticalCandidate = { classification: string | null; isCritical: boolean }
export type CriticalCandidateControl = { id: string; status: string }

const IN_FORCE: ReadonlySet<string> = new Set(["implemented", "verified"])

export function isCriticalRisk(entry: CriticalCandidate): boolean {
  return entry.classification === "intolerable" || (entry.classification === null && entry.isCritical)
}

export function isCriticalWithoutControl(
  entry: CriticalCandidate,
  controls: readonly CriticalCandidateControl[],
  pdtpLinkedControlIds: ReadonlySet<string>,
): boolean {
  if (!isCriticalRisk(entry)) return false
  return !controls.some((control) => IN_FORCE.has(control.status))
    || !controls.some((control) => pdtpLinkedControlIds.has(control.id))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- lib/prevention/miper/critical-control.test.ts`
Expected: PASS (6 pruebas).

- [ ] **Step 5: El tablero usa el predicado**

En `lib/services/prevention-risk-legal.ts`, después de la línea 44
(`import { effectiveRiskLevel } from "@/lib/prevention/risk-levels"`), agregar:

```ts
import { isCriticalWithoutControl } from "@/lib/prevention/miper/critical-control"
```

Reemplazar las líneas 1069-1079:

```ts
  // Bloqueo crítico: fila vigente Intolerable (o crítica legacy) sin una medida
  // implementada/verificada o sin cobertura PDTP. Mismo criterio que antes, con
  // la clasificación RE-04 como fuente del nivel.
  const criticalBlockers = entries.filter(({ entry }) => {
    if (!publishedIds.has(entry.matrixId)) return false
    const critical = entry.classification === "intolerable" || (entry.classification === null && entry.isCritical)
    if (!critical) return false
    const entryControls = controlByEntry.get(entry.id) ?? []
    return !entryControls.some((control) => ["implemented", "verified"].includes(control.status))
      || !entryControls.some((control) => linkedControlIds.has(control.id))
  })
```

por:

```ts
  // «Riesgos críticos sin control»: fila VIGENTE Intolerable (o crítica legacy)
  // sin una medida implementada/verificada o sin cobertura PDTP. La definición es
  // una sola y la comparte la portada MIPER (`critical-control.ts`).
  const criticalBlockers = entries.filter(({ entry }) =>
    publishedIds.has(entry.matrixId) && isCriticalWithoutControl(entry, controlByEntry.get(entry.id) ?? [], linkedControlIds))
```

`entry` es una fila de `preventionRiskEntries`: trae `classification` y `isCritical`. Los controles
traen `id` y `status`. Los tipos calzan sin conversión.

- [ ] **Step 6: Puertas**

Run:

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/critical-control.ts lib/prevention/miper/critical-control.test.ts lib/services/prevention-risk-legal.ts
npm run test:fast -- lib/prevention/miper/critical-control.test.ts
```

Expected: verde. La igualdad de cifras entre el tablero y la portada la prueba la Task 4 (PGlite).

- [ ] **Step 7: Commit**

```bash
git add lib/prevention/miper/critical-control.ts lib/prevention/miper/critical-control.test.ts lib/services/prevention-risk-legal.ts
git commit -m "feat(miper): una sola definición de «riesgos críticos sin control»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fotos del MIPER en lote, con prueba dorada

**Files:**
- Modify: `lib/services/miper/snapshots.ts:1-64`
- Create: `lib/__tests__/miper-snapshot-batch.test.ts`
- Modify: `tests/pglite-files.ts` (después de la línea 24)

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces (en `lib/services/miper/snapshots.ts`):
  - `buildMiperSnapshots(client: Client, matrixIds: readonly string[]): Promise<Map<string, MiperSnapshot>>`:
    tres consultas en total, sin importar cuántas MIPER. Los ids repetidos se ignoran y los que no
    existen no vienen en el mapa.
  - `buildMiperSnapshot(client: Client, matrixId: string): Promise<MiperSnapshot>`: misma firma y
    misma salida, byte a byte. Ahora es `buildMiperSnapshots(client, [matrixId])` y lanza
    `RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")` si falta.
- `snapshotSha` no cambia. La usan `workflow.ts:97` (envío) y
  `app/api/prevencion/miper/[id]/export/route.ts:36`.

**Por qué la prueba es dorada:** `snapshotSha` es `sha256(JSON.stringify(foto))`, y ese hash queda
sellado en cada ronda y versión. `toEqual` no mira el orden de las claves; `JSON.stringify` sí. La
prueba compara el JSON y el SHA contra una **copia literal** de la función de antes.

- [ ] **Step 1: Write the failing test**

Crear `lib/__tests__/miper-snapshot-batch.test.ts`:

```ts
/**
 * Fase B: `buildMiperSnapshots` (lote) y `buildMiperSnapshot` como su caso de
 * una. PRUEBA DORADA: `snapshotSha` hashea `JSON.stringify(foto)` y ese hash
 * queda sellado en cada ronda y cada versión, así que la foto de antes y la de
 * ahora tienen que ser idénticas byte a byte: mismas filas, mismo orden de filas
 * y de medidas, mismo orden de CLAVES (`toEqual` no lo mira; por eso se compara
 * el JSON).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq, inArray } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskLocations, preventionRiskMatrices,
  preventionRiskPositions, preventionRiskProcesses, preventionRiskTasks,
} from "@/db/schema"
import type { DB } from "@/db"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import type { ControlHierarchy, ControlledStatus, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry, saveMiperControl } = await import("@/lib/services/miper/entries")
const { buildMiperSnapshot, buildMiperSnapshots, snapshotSha } = await import("@/lib/services/miper/snapshots")

type Client = DB

/**
 * COPIA LITERAL de `buildMiperSnapshot` en `lib/services/miper/snapshots.ts:15-64`
 * (commit 4f980172), antes del lote. Es la referencia dorada: NO EDITAR.
 */
async function legacyBuildMiperSnapshot(client: Client, matrixId: string): Promise<MiperSnapshot> {
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const rows = await client.select({
    entry: preventionRiskEntries,
    activity: preventionRiskProcesses.name,
    task: preventionRiskTasks.name,
    position: preventionRiskPositions.name,
    location: preventionRiskLocations.name,
    riskFactor: preventionRiskFactors.name,
  }).from(preventionRiskEntries)
    .leftJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId))
    .leftJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId))
    .leftJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId))
    .leftJoin(preventionRiskLocations, eq(preventionRiskLocations.id, preventionRiskEntries.locationId))
    .leftJoin(preventionRiskFactors, eq(preventionRiskFactors.id, preventionRiskEntries.riskFactorId))
    .where(eq(preventionRiskEntries.matrixId, matrixId))
    .orderBy(asc(preventionRiskEntries.rowNumber), asc(preventionRiskEntries.createdAt))
  const controls = rows.length === 0 ? [] : await client.select().from(preventionRiskControls)
    .where(inArray(preventionRiskControls.riskEntryId, rows.map((row) => row.entry.id)))
    .orderBy(asc(preventionRiskControls.createdAt))
  const controlsByEntry = new Map<string, typeof controls>()
  for (const control of controls) controlsByEntry.set(control.riskEntryId, [...(controlsByEntry.get(control.riskEntryId) ?? []), control])
  return {
    header: {
      period: matrix.period, iperCode: matrix.iperCode, elaboratedOn: matrix.elaboratedOn, updatedOn: matrix.updatedOn,
      companyName: matrix.companyName, companyRut: matrix.companyRut, companyAddress: matrix.companyAddress, companyCommune: matrix.companyCommune,
      economicActivity: matrix.economicActivity, adherentNumber: matrix.adherentNumber, worksiteName: matrix.worksiteName,
      siteRepresentativeUserId: matrix.siteRepresentativeUserId, siteRepresentativeName: matrix.siteRepresentativeName,
      headcountTotal: matrix.headcountTotal, headcountMale: matrix.headcountMale, headcountFemale: matrix.headcountFemale, headcountOther: matrix.headcountOther,
      participationSummary: matrix.participationSummary, consultationEvidenceReference: matrix.consultationEvidenceReference,
    },
    entries: rows.map(({ entry, activity, task, position, location, riskFactor }, index) => ({
      id: entry.id,
      rowNumber: entry.rowNumber ?? index + 1,
      activity, task, position, location,
      exposedFemale: entry.exposedFemale, exposedMale: entry.exposedMale, exposedOther: entry.exposedOther,
      riskFactorId: entry.riskFactorId, riskFactor,
      isRoutine: entry.isRoutine,
      hazard: entry.hazard, risk: entry.risk, probableDamage: entry.probableDamage,
      probability: entry.probability, consequence: entry.consequence, magnitude: entry.magnitude,
      classification: entry.classification as RiskClassification | null,
      controlledStatus: entry.controlledStatus as ControlledStatus | null,
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => ({
        id: control.id, hierarchy: control.hierarchy as ControlHierarchy, description: control.description,
        responsibleUserId: control.responsibleUserId, responsibleName: control.responsibleSnapshot, dueDate: control.dueDate, status: control.status,
      })),
    })),
  }
}

const author = { userId: "u-g", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:edit"] }
let a = ""
let b = ""
let empty = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-g1", name: "Faena G1", code: "G1" }, { id: "ws-g2", name: "Faena G2", code: "G2" }])
  await testDb.insert(schema.users).values({ id: "u-g", name: "Autora G", email: "g@g.cl", hashedPassword: "x", isActive: true })
  a = (await createMiper({ worksiteId: "ws-g1", period: 2026, revisionReason: "Período para la prueba dorada." }, author)).id
  b = (await createMiper({ worksiteId: "ws-g1", period: 2027, revisionReason: "Segundo período de la prueba dorada." }, author)).id
  empty = (await createMiper({ worksiteId: "ws-g2", period: 2026, revisionReason: "MIPER sin riesgos de la prueba dorada." }, author)).id

  // Filas de A y B intercaladas en el tiempo: el lote las separa por MIPER sin mezclar su orden.
  const a1 = await saveMiperEntry({ matrixId: a, values: { activity: "Carga", task: "Izaje", position: "Operador", location: "Patio", riskFactorId: "riskfactor-mecanico", hazard: "Carga suspendida", risk: "Golpe", probableDamage: "Fractura", probability: 2, consequence: 4, controlledStatus: "partial", isRoutine: true } }, author)
  await saveMiperEntry({ matrixId: b, values: { activity: "Bodega", task: "Orden", hazard: "Estanterías", probability: 1, consequence: 2 } }, author)
  const a2 = await saveMiperEntry({ matrixId: a, values: { hazard: "Ruido", probability: 2, consequence: 2, controlledStatus: "no" } }, author)
  const c1 = await saveMiperControl({ matrixId: a, entryId: a1.id, values: { hierarchy: "engineering", description: "Limitador de carga", responsibleName: "Mantención", dueDate: "2026-10-31" } }, author)
  const c2 = await saveMiperControl({ matrixId: a, entryId: a2.id, values: { hierarchy: "ppe", description: "Protectores auditivos", responsibleUserId: "u-g", dueDate: "2026-11-30" } }, author)
  const c3 = await saveMiperControl({ matrixId: a, entryId: a1.id, values: { hierarchy: "administrative", description: "Señalero en el izaje", responsibleName: "Supervisión", dueDate: "2026-12-31" } }, author)
  // `created_at` distintos y explícitos: con empate, el orden de Postgres no está definido (ni antes ni ahora).
  const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString()
  for (const [id, seconds] of [[c1.id, 1], [c2.id, 2], [c3.id, 3]] as const) {
    await testDb.update(schema.preventionRiskControls).set({ createdAt: later(seconds) }).where(eq(schema.preventionRiskControls.id, id))
  }
  // Dos filas de B sin N° (cargas antiguas): el respaldo `index + 1` es la posición DENTRO de B.
  await testDb.insert(schema.preventionRiskEntries).values([
    { id: "riskentry-g-b2", matrixId: b, hazardCode: "HAZ-G-B2", hazard: "Sin número uno", createdAt: later(5), updatedAt: later(5) },
    { id: "riskentry-g-b3", matrixId: b, hazardCode: "HAZ-G-B3", hazard: "Sin número dos", createdAt: later(10), updatedAt: later(10) },
  ])
}, 60_000)

describe("fotos del MIPER en lote (Fase B)", () => {
  it("PRUEBA DORADA: buildMiperSnapshot da la misma foto que antes, byte a byte (JSON y SHA)", async () => {
    for (const id of [a, b, empty]) {
      const before = await legacyBuildMiperSnapshot(testDb, id)
      const after = await buildMiperSnapshot(testDb, id)
      expect(JSON.stringify(after)).toBe(JSON.stringify(before))
      expect(snapshotSha(after)).toBe(snapshotSha(before))
    }
  })

  it("el lote arma cada foto igual que una por una, aunque los ids vengan repetidos o en otro orden", async () => {
    const batch = await buildMiperSnapshots(testDb, [empty, b, a, b])
    expect([...batch.keys()].sort()).toEqual([a, b, empty].sort())
    for (const id of [a, b, empty]) {
      expect(JSON.stringify(batch.get(id))).toBe(JSON.stringify(await legacyBuildMiperSnapshot(testDb, id)))
    }
  })

  it("el N° de respaldo de una fila sin número cuenta dentro de su MIPER, no en el lote", async () => {
    const batch = await buildMiperSnapshots(testDb, [a, b])
    expect(batch.get(b)!.entries.map((entry) => [entry.hazard, entry.rowNumber])).toEqual([["Estanterías", 1], ["Sin número uno", 2], ["Sin número dos", 3]])
    expect(batch.get(a)!.entries.map((entry) => entry.controls.map((control) => control.description)))
      .toEqual([["Limitador de carga", "Señalero en el izaje"], ["Protectores auditivos"]])
  })

  it("sin ids devuelve un mapa vacío; un id inexistente no viene en el lote y la foto suelta lo rechaza", async () => {
    expect((await buildMiperSnapshots(testDb, [])).size).toBe(0)
    expect((await buildMiperSnapshots(testDb, ["riskmatrix-no-existe"])).size).toBe(0)
    await expect(buildMiperSnapshot(testDb, "riskmatrix-no-existe")).rejects.toThrow("MIPER no encontrada o fuera de alcance.")
  })
})
```

En `tests/pglite-files.ts`, después de la línea 24 (`"lib/__tests__/miper-snapshot-service.test.ts",`),
agregar:

```ts
  // MIPER Fase B: fotos en lote y prueba dorada de que la foto de una sola no cambió (snapshotSha).
  "lib/__tests__/miper-snapshot-batch.test.ts",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts`
Expected: FAIL. La prueba dorada pasa, porque todavía compara la función vieja consigo misma. Fallan
las otras tres con «buildMiperSnapshots is not a function».

- [ ] **Step 3: Write minimal implementation**

Reemplazar las líneas 1-64 de `lib/services/miper/snapshots.ts` (todo hasta antes de
`export async function openRound`) por:

```ts
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskLocations, preventionRiskMatrices,
  preventionRiskPositions, preventionRiskProcesses, preventionRiskReviewRounds, preventionRiskTasks,
} from "@/db/schema"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import type { ControlHierarchy, ControlledStatus, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { type Client, sha256 } from "./shared"

export function snapshotSha(snapshot: MiperSnapshot) {
  return sha256(snapshot)
}

type MatrixRow = typeof preventionRiskMatrices.$inferSelect
type ControlRow = typeof preventionRiskControls.$inferSelect
type EntryRow = {
  entry: typeof preventionRiskEntries.$inferSelect
  activity: string | null; task: string | null; position: string | null; location: string | null; riskFactor: string | null
}

/**
 * Fotos vivas de varias MIPER con TRES consultas, sin importar cuántas sean (la
 * portada por faena necesita la de cada una para la completitud; una por MIPER
 * era N+1). Las consultas se encadenan, no van en paralelo: dentro de una
 * transacción (`submitMiperForReview` pasa un `tx`) usan la misma conexión.
 * Los ids repetidos se ignoran y los que no existen no vienen en el mapa.
 */
export async function buildMiperSnapshots(client: Client, matrixIds: readonly string[]): Promise<Map<string, MiperSnapshot>> {
  const snapshots = new Map<string, MiperSnapshot>()
  const ids = [...new Set(matrixIds)]
  if (ids.length === 0) return snapshots
  const matrices = await client.select().from(preventionRiskMatrices).where(inArray(preventionRiskMatrices.id, ids))
  if (matrices.length === 0) return snapshots
  const found = matrices.map((matrix) => matrix.id)
  // Mismo ORDER BY que la foto de una sola: agrupar por MIPER conserva, dentro de cada una, el orden de la consulta.
  const rows: EntryRow[] = await client.select({
    entry: preventionRiskEntries,
    activity: preventionRiskProcesses.name,
    task: preventionRiskTasks.name,
    position: preventionRiskPositions.name,
    location: preventionRiskLocations.name,
    riskFactor: preventionRiskFactors.name,
  }).from(preventionRiskEntries)
    .leftJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId))
    .leftJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId))
    .leftJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId))
    .leftJoin(preventionRiskLocations, eq(preventionRiskLocations.id, preventionRiskEntries.locationId))
    .leftJoin(preventionRiskFactors, eq(preventionRiskFactors.id, preventionRiskEntries.riskFactorId))
    .where(inArray(preventionRiskEntries.matrixId, found))
    .orderBy(asc(preventionRiskEntries.rowNumber), asc(preventionRiskEntries.createdAt))
  // Las medidas por JOIN a sus filas: el mismo conjunto que `riskEntryId IN (…)`, sin una lista de miles de ids.
  const controls = rows.length === 0 ? [] : await client.select({ control: preventionRiskControls }).from(preventionRiskControls)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
    .where(inArray(preventionRiskEntries.matrixId, found))
    .orderBy(asc(preventionRiskControls.createdAt))
  const controlsByEntry = new Map<string, ControlRow[]>()
  for (const { control } of controls) {
    const list = controlsByEntry.get(control.riskEntryId)
    if (list) list.push(control)
    else controlsByEntry.set(control.riskEntryId, [control])
  }
  const rowsByMatrix = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const list = rowsByMatrix.get(row.entry.matrixId)
    if (list) list.push(row)
    else rowsByMatrix.set(row.entry.matrixId, [row])
  }
  for (const matrix of matrices) snapshots.set(matrix.id, snapshotOf(matrix, rowsByMatrix.get(matrix.id) ?? [], controlsByEntry))
  return snapshots
}

/**
 * La foto de UNA MIPER: la que se sella en cada ronda y se hashea con
 * `snapshotSha`. Desde la Fase B es el caso de una de `buildMiperSnapshots`;
 * su salida, orden de claves incluido, no cambió (prueba dorada en
 * `lib/__tests__/miper-snapshot-batch.test.ts`).
 */
export async function buildMiperSnapshot(client: Client, matrixId: string): Promise<MiperSnapshot> {
  const snapshot = (await buildMiperSnapshots(client, [matrixId])).get(matrixId)
  if (!snapshot) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  return snapshot
}

/**
 * Arma la foto con el MISMO orden de claves de siempre, porque `snapshotSha`
 * hashea su `JSON.stringify`. No reordenar campos. `index` es la posición de la
 * fila dentro de SU MIPER: es el N° de respaldo de una fila sin número.
 */
function snapshotOf(matrix: MatrixRow, rows: readonly EntryRow[], controlsByEntry: ReadonlyMap<string, ControlRow[]>): MiperSnapshot {
  return {
    header: {
      period: matrix.period, iperCode: matrix.iperCode, elaboratedOn: matrix.elaboratedOn, updatedOn: matrix.updatedOn,
      companyName: matrix.companyName, companyRut: matrix.companyRut, companyAddress: matrix.companyAddress, companyCommune: matrix.companyCommune,
      economicActivity: matrix.economicActivity, adherentNumber: matrix.adherentNumber, worksiteName: matrix.worksiteName,
      siteRepresentativeUserId: matrix.siteRepresentativeUserId, siteRepresentativeName: matrix.siteRepresentativeName,
      headcountTotal: matrix.headcountTotal, headcountMale: matrix.headcountMale, headcountFemale: matrix.headcountFemale, headcountOther: matrix.headcountOther,
      participationSummary: matrix.participationSummary, consultationEvidenceReference: matrix.consultationEvidenceReference,
    },
    entries: rows.map(({ entry, activity, task, position, location, riskFactor }, index) => ({
      id: entry.id,
      rowNumber: entry.rowNumber ?? index + 1,
      activity, task, position, location,
      exposedFemale: entry.exposedFemale, exposedMale: entry.exposedMale, exposedOther: entry.exposedOther,
      riskFactorId: entry.riskFactorId, riskFactor,
      isRoutine: entry.isRoutine,
      hazard: entry.hazard, risk: entry.risk, probableDamage: entry.probableDamage,
      probability: entry.probability, consequence: entry.consequence, magnitude: entry.magnitude,
      classification: entry.classification as RiskClassification | null,
      controlledStatus: entry.controlledStatus as ControlledStatus | null,
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => ({
        id: control.id, hierarchy: control.hierarchy as ControlHierarchy, description: control.description,
        responsibleUserId: control.responsibleUserId, responsibleName: control.responsibleSnapshot, dueDate: control.dueDate, status: control.status,
      })),
    })),
  }
}
```

`openRound` (desde la línea 66 de antes) queda igual.

- [ ] **Step 4: Run tests to verify they pass**

Run, de a uno:

```bash
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
npm run test:pglite -- lib/__tests__/miper-snapshot-service.test.ts
npm run test:pglite -- lib/__tests__/miper-workflow.test.ts
npm run test:fast -- "app/api/prevencion/miper/[id]/export/route.test.ts"
```

Expected: PASS en las cuatro. `miper-workflow` ejercita el envío, que fotografía y hashea dentro de
una transacción.

- [ ] **Step 5: Medir el costo en `bodega_dev` (sólo lectura)**

`bodega_dev` tiene hoy una sola MIPER (el borrador de 222 riesgos) y 0 medidas. La medición da el
costo de la foto más grande que hay y el número de consultas, que es lo que el lote cambia:
- antes, 3 consultas por MIPER;
- ahora, 3 en total.

```bash
cd /home/allopze/dev/chome/bodega
DEV_DB=$(node -e 'const { loadEnvConfig } = require("@next/env"); loadEnvConfig(process.cwd(), true, { info() {}, error() {} }); process.stdout.write(process.env.DATABASE_URL)')
case "$DEV_DB" in *:5433/*) ;; *) echo "No es bodega_dev (:5433): no se mide"; exit 1;; esac
psql "$DEV_DB" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT count(*) AS mipers_no_reemplazadas,
  (SELECT count(*) FROM prevention_risk_entries e JOIN prevention_risk_matrices m ON m.id = e.matrix_id WHERE m.status <> 'superseded') AS riesgos,
  (SELECT count(*) FROM prevention_risk_controls c JOIN prevention_risk_entries e ON e.id = c.risk_entry_id JOIN prevention_risk_matrices m ON m.id = e.matrix_id WHERE m.status <> 'superseded') AS medidas
FROM prevention_risk_matrices WHERE status <> 'superseded';
-- Consulta 2 del lote: las filas de todas las MIPER no reemplazadas.
EXPLAIN (ANALYZE, BUFFERS, SUMMARY)
SELECT e.*, p.name, t.name, pos.name, l.name, f.name
FROM prevention_risk_entries e
LEFT JOIN prevention_risk_processes p ON p.id = e.process_id
LEFT JOIN prevention_risk_tasks t ON t.id = e.task_id
LEFT JOIN prevention_risk_positions pos ON pos.id = e.position_id
LEFT JOIN prevention_risk_locations l ON l.id = e.location_id
LEFT JOIN prevention_risk_factors f ON f.id = e.risk_factor_id
WHERE e.matrix_id IN (SELECT id FROM prevention_risk_matrices WHERE status <> 'superseded')
ORDER BY e.row_number, e.created_at;
-- Consulta 3 del lote: sus medidas, por JOIN.
EXPLAIN (ANALYZE, BUFFERS, SUMMARY)
SELECT c.* FROM prevention_risk_controls c
JOIN prevention_risk_entries e ON e.id = c.risk_entry_id
WHERE e.matrix_id IN (SELECT id FROM prevention_risk_matrices WHERE status <> 'superseded')
ORDER BY c.created_at;
ROLLBACK;
SQL
```

Nunca imprimir `$DEV_DB`. Anotar:
- MIPER, riesgos y medidas;
- el «Execution Time» de las dos consultas;
- si alguna hace `Seq Scan` sobre `prevention_risk_entries` con más de unas miles de filas.

Esos números van al cuerpo del commit (Step 7) y la Task 11 los copia al informe.

**Si una consulta pasa de 200 ms**, revisar `EXPLAIN`. Un índice nuevo es una migración, y una
migración no se agrega en esta fase sin consultarlo antes.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- lib/services/miper/snapshots.ts lib/__tests__/miper-snapshot-batch.test.ts tests/pglite-files.ts
```

- [ ] **Step 7: Commit**

El cuerpo lleva la medición del Step 5, con los valores reales:

```bash
git add lib/services/miper/snapshots.ts lib/__tests__/miper-snapshot-batch.test.ts tests/pglite-files.ts
git commit -m "feat(miper): fotos del MIPER en lote con prueba dorada del snapshot" \
  -m "Medición en bodega_dev (solo lectura): <N> MIPER no reemplazadas, <R> riesgos, <M> medidas; filas <x> ms, medidas <y> ms. Consultas: 3 por MIPER antes, 3 en total ahora." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Reglas puras de la portada y de la bandeja

**Files:**
- Create: `lib/prevention/miper/inbox.ts`, `lib/prevention/miper/portfolio.ts`
- Test: `lib/prevention/miper/inbox.test.ts`, `lib/prevention/miper/portfolio.test.ts`

**Interfaces:**
- Consumes: `ProgramProgress` (`lib/prevention/miper/progress.ts`, existente).
- Produces, en `lib/prevention/miper/inbox.ts`:
  - `type MiperInboxCandidate = { status: string; reviewState: string; isLegacy: boolean; hasUnsentChanges: boolean; submittedByUserId: string | null }`
  - `type MiperInboxViewer = { userId: string; permissions: readonly string[] }`
  - `miperInboxReason(row: MiperInboxCandidate, viewer: MiperInboxViewer): string | null`.
    Devuelve «Pendiente de tu revisión», «Pendiente de tu firma», «Con observaciones», «Cambios sin
    enviar», «Borrador» o `null`.
- Produces, en `lib/prevention/miper/portfolio.ts`:
  - **Constantes:**
    - `PORTFOLIO_PATH = "/prevencion/miper"`
    - `PORTFOLIO_STATUSES`, `type MiperPortfolioStatus = "sin_miper" | "borrador" | "en_revision" | "observada" | "vigente"`, `PORTFOLIO_STATUS_LABEL`
    - `type PortfolioStatusFilter = MiperPortfolioStatus | "con_miper"`, `PORTFOLIO_STATUS_FILTER_OPTIONS`
    - `PORTFOLIO_SUMMARY_HREF: { withMiper; inReview; mine; critical }` (URLs absolutas)
  - **Tipos de fila:**
    - `type MiperPortfolioMatrix = { id: string; period: number | null; versionNumber: number | null; label: string; isLegacy: boolean }`
    - `type MiperPortfolioAction = { matrixId: string; period: number | null; reason: string }`
    - `type MiperPortfolioRow` (campos en el código del Step 3)
    - `type MiperWorksiteTarget = { worksiteId: string; worksiteName: string; matrixId: string | null; period: number | null }`
  - **Selección:**
    - `type PortfolioCandidate = { id: string; worksiteId: string; period: number | null; status: string; updatedAt: string }`
    - `type PortfolioPick<T> = { primary: T; published: T | null; all: T[] }`
    - `pickCurrentMatrices<T extends PortfolioCandidate>(rows: readonly T[]): Map<string, PortfolioPick<T>>`
    - `portfolioActionOrder<T extends PortfolioCandidate>(pick: PortfolioPick<T>): T[]`
    - `portfolioStatusOf(matrix: { status: string; reviewState: string } | null): MiperPortfolioStatus`
  - **URL y cifras:**
    - `type PortfolioParams = { vista: "todas" | "mias"; estado: PortfolioStatusFilter | null; sinControl: boolean; faena: string | null }`
    - `parsePortfolioParams(params: { get(key: string): string | null }): PortfolioParams`
    - `hasPortfolioFilters(params: PortfolioParams): boolean`
    - `portfolioHref(current: { toString(): string }, patch: Record<string, string | null>, pathname?: string): string`
    - `filterPortfolioRows(rows: readonly MiperPortfolioRow[], params: PortfolioParams): MiperPortfolioRow[]`
    - `type PortfolioSummary = { total: number; withMiper: number; inReview: number; mine: number; critical: number }`
    - `portfolioSummary(rows: readonly MiperPortfolioRow[]): PortfolioSummary`

- [ ] **Step 1: Write the failing tests**

Crear `lib/prevention/miper/inbox.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { miperInboxReason } from "./inbox"

const base = { status: "draft", reviewState: "none", isLegacy: false, hasUnsentChanges: false, submittedByUserId: null }
const editor = { userId: "u-prev", permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", permissions: ["prevention:risk:view", "prevention:risk:review"] }
const legal = { userId: "u-legal", permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] }
const lectora = { userId: "u-ver", permissions: ["prevention:risk:view"] }
const doble = { userId: "u-doble", permissions: ["prevention:risk:view", "prevention:risk:edit", "prevention:risk:review", "prevention:risk:approve_legal"] }

describe("miperInboxReason: qué espera una MIPER de una persona", () => {
  it("a quien edita: su borrador, las observaciones por responder y los cambios sin enviar", () => {
    expect(miperInboxReason(base, editor)).toBe("Borrador")
    expect(miperInboxReason({ ...base, reviewState: "observed" }, editor)).toBe("Con observaciones")
    expect(miperInboxReason({ ...base, status: "published", reviewState: "observed" }, editor)).toBe("Con observaciones")
    expect(miperInboxReason({ ...base, status: "published", hasUnsentChanges: true }, editor)).toBe("Cambios sin enviar")
    expect(miperInboxReason({ ...base, status: "published" }, editor)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-x" }, editor)).toBeNull()
  })

  it("la metodología anterior y las reemplazadas no piden nada", () => {
    expect(miperInboxReason({ ...base, isLegacy: true }, editor)).toBeNull()
    expect(miperInboxReason({ ...base, status: "superseded" }, doble)).toBeNull()
  })

  it("a la Jefa lo enviado a revisión; a Legal y RRHH lo que espera su firma; a quien sólo lee, nada", () => {
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-prev" }, jefa)).toBe("Pendiente de tu revisión")
    expect(miperInboxReason({ ...base, reviewState: "pending_approval", submittedByUserId: "u-prev" }, jefa)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "pending_approval", submittedByUserId: "u-prev" }, legal)).toBe("Pendiente de tu firma")
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-prev" }, lectora)).toBeNull()
  })

  it("quien envió la ronda no la ve como pendiente de su revisión ni de su firma (como workspace-mode)", () => {
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-doble" }, doble)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "pending_approval", submittedByUserId: "u-doble" }, doble)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-prev" }, doble)).toBe("Pendiente de tu revisión")
  })
})
```

Crear `lib/prevention/miper/portfolio.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  filterPortfolioRows, hasPortfolioFilters, parsePortfolioParams, pickCurrentMatrices, PORTFOLIO_SUMMARY_HREF, portfolioActionOrder,
  portfolioHref, portfolioStatusOf, portfolioSummary, type MiperPortfolioRow,
} from "./portfolio"

const m = (id: string, worksiteId: string, period: number | null, status = "draft", updatedAt = "2026-01-01T00:00:00.000Z") => ({ id, worksiteId, period, status, updatedAt })

describe("pickCurrentMatrices: qué MIPER representa a cada faena", () => {
  it("la no reemplazada de mayor período; la vigente aparte; las reemplazadas no cuentan", () => {
    const picks = pickCurrentMatrices([m("a-2025", "a", 2025, "superseded"), m("a-2026", "a", 2026, "published"), m("a-2027", "a", 2027), m("b-leg", "b", null, "published")])
    expect(picks.get("a")!.primary.id).toBe("a-2027")
    expect(picks.get("a")!.published?.id).toBe("a-2026")
    expect(picks.get("a")!.all.map((row) => row.id)).toEqual(["a-2027", "a-2026"])
    expect(picks.get("b")!.primary.id).toBe("b-leg")
    expect(picks.get("b")!.published?.id).toBe("b-leg")
  })

  it("sin período va al final; con empate, la modificada más reciente", () => {
    const picks = pickCurrentMatrices([
      m("leg", "a", null, "published", "2026-09-01T00:00:00.000Z"),
      m("re04", "a", 2026, "draft", "2026-01-01T00:00:00.000Z"),
      m("x-vieja", "x", null, "draft", "2026-01-01T00:00:00.000Z"),
      m("x-nueva", "x", null, "draft", "2026-05-01T00:00:00.000Z"),
    ])
    expect(picks.get("a")!.primary.id).toBe("re04")
    expect(picks.get("x")!.primary.id).toBe("x-nueva")
  })

  it("una faena con sólo MIPER reemplazadas no tiene MIPER", () => {
    expect(pickCurrentMatrices([m("z", "z", 2024, "superseded")]).has("z")).toBe(false)
  })

  it("las acciones se ofrecen en orden: la de la fila, la vigente y el resto, sin repetir", () => {
    const pick = pickCurrentMatrices([m("p", "a", 2026, "published"), m("d27", "a", 2027), m("d28", "a", 2028)]).get("a")!
    expect(portfolioActionOrder(pick).map((row) => row.id)).toEqual(["d28", "p", "d27"])
  })
})

describe("portfolioStatusOf", () => {
  it("cinco estados, en español en la UI", () => {
    expect(portfolioStatusOf(null)).toBe("sin_miper")
    expect(portfolioStatusOf({ status: "draft", reviewState: "none" })).toBe("borrador")
    expect(portfolioStatusOf({ status: "draft", reviewState: "in_review" })).toBe("en_revision")
    expect(portfolioStatusOf({ status: "published", reviewState: "pending_approval" })).toBe("en_revision")
    expect(portfolioStatusOf({ status: "published", reviewState: "observed" })).toBe("observada")
    expect(portfolioStatusOf({ status: "published", reviewState: "none" })).toBe("vigente")
  })
})

describe("URL de la portada", () => {
  const read = (query: string) => parsePortfolioParams(new URLSearchParams(query))

  it("lee vista, estado, sincontrol y faena; lo que no conoce no filtra", () => {
    expect(read("vista=mias&estado=con_miper&sincontrol=1&faena=ws-a")).toEqual({ vista: "mias", estado: "con_miper", sinControl: true, faena: "ws-a" })
    expect(read("vista=otra&estado=published&sincontrol=si")).toEqual({ vista: "todas", estado: null, sinControl: false, faena: null })
    expect(hasPortfolioFilters(read(""))).toBe(false)
    expect(hasPortfolioFilters(read("vista=mias"))).toBe(true)
  })

  it("enlaces viejos: ?tab=porhacer abre «mías»; ?tab=todas|resumen, la vista por defecto; `vista` manda sobre `tab`", () => {
    expect(read("tab=porhacer").vista).toBe("mias")
    expect(read("tab=todas").vista).toBe("todas")
    expect(read("tab=resumen").vista).toBe("todas")
    expect(read("tab=porhacer&vista=todas").vista).toBe("todas")
  })

  it("portfolioHref aplica el cambio y borra SIEMPRE el `tab` heredado", () => {
    expect(portfolioHref(new URLSearchParams("tab=porhacer&estado=borrador"), { vista: null })).toBe("/prevencion/miper?estado=borrador")
    expect(portfolioHref(new URLSearchParams("tab=porhacer"), { vista: "mias" })).toBe("/prevencion/miper?vista=mias")
    expect(portfolioHref(new URLSearchParams("estado=borrador"), { estado: "" })).toBe("/prevencion/miper")
    expect(portfolioHref(new URLSearchParams(""), { faena: "ws-a" }, "/otra")).toBe("/otra?faena=ws-a")
  })
})

const row = (overrides: Partial<MiperPortfolioRow>): MiperPortfolioRow => ({
  id: "ws", worksiteId: "ws", worksiteName: "Faena", worksiteActive: true,
  matrix: { id: "m", period: 2026, versionNumber: 1, label: "Vigente · v1", isLegacy: false }, vigente: null,
  status: "vigente", stateLabel: "Vigente · v1", headcount: 0, headcountSource: "ficha", updatedAt: "2026-10-01T00:00:00.000Z",
  completeness: { complete: 1, total: 1 }, importantCount: 0, intolerableCount: 0, criticalWithoutControl: 0,
  requiresMyAction: false, myActions: [], submittedByName: null, programProgress: null,
  ...overrides,
})
const ROWS = [
  row({ id: "a", worksiteId: "a", criticalWithoutControl: 2 }),
  row({ id: "b", worksiteId: "b", status: "en_revision", requiresMyAction: true }),
  row({ id: "c", worksiteId: "c", matrix: null, status: "sin_miper", stateLabel: "Sin MIPER", completeness: null }),
  row({ id: "d", worksiteId: "d", status: "borrador", criticalWithoutControl: 1, requiresMyAction: true }),
]

describe("filtros y franja de la portada", () => {
  const ids = (query: string) => filterPortfolioRows(ROWS, parsePortfolioParams(new URLSearchParams(query))).map((item) => item.id)

  it("filtra por vista, estado (incluido «Con MIPER»), sin control y faena", () => {
    expect(ids("")).toEqual(["a", "b", "c", "d"])
    expect(ids("vista=mias")).toEqual(["b", "d"])
    expect(ids("estado=con_miper")).toEqual(["a", "b", "d"])
    expect(ids("estado=sin_miper")).toEqual(["c"])
    expect(ids("estado=en_revision")).toEqual(["b"])
    expect(ids("sincontrol=1")).toEqual(["a", "d"])
    expect(ids("faena=c")).toEqual(["c"])
    expect(ids("vista=mias&sincontrol=1")).toEqual(["d"])
  })

  it("A1: cada cifra cuenta exactamente lo que muestra su destino", () => {
    const summary = portfolioSummary(ROWS)
    expect(summary).toEqual({ total: 4, withMiper: 3, inReview: 1, mine: 2, critical: 3 })
    const at = (href: string) => filterPortfolioRows(ROWS, parsePortfolioParams(new URL(href, "http://localhost").searchParams))
    expect(at(PORTFOLIO_SUMMARY_HREF.withMiper)).toHaveLength(summary.withMiper)
    expect(at(PORTFOLIO_SUMMARY_HREF.inReview)).toHaveLength(summary.inReview)
    expect(at(PORTFOLIO_SUMMARY_HREF.mine)).toHaveLength(summary.mine)
    expect(at(PORTFOLIO_SUMMARY_HREF.critical).reduce((total, item) => total + item.criticalWithoutControl, 0)).toBe(summary.critical)
    expect(PORTFOLIO_SUMMARY_HREF.critical).toBe("/prevencion/miper?sincontrol=1")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/inbox.test.ts lib/prevention/miper/portfolio.test.ts`
Expected: FAIL con «Failed to resolve import "./inbox"» y «… "./portfolio"».

- [ ] **Step 3: Write minimal implementation**

Crear `lib/prevention/miper/inbox.ts`:

```ts
/**
 * Qué espera una MIPER de una persona: la regla de la bandeja de antes
 * (`listMiperInbox`) y de «Requieren mi acción» en la portada por faena (Fase
 * B). Una sola regla para las dos pantallas.
 *
 * Quien envió la ronda no la ve como pendiente de su revisión ni de su firma:
 * es lo que ya aplican `workspace-mode.ts` (`isSubmitter`) y el servicio
 * (`assertNotSubmitter`). La bandeja de antes no lo hacía.
 */
export type MiperInboxCandidate = { status: string; reviewState: string; isLegacy: boolean; hasUnsentChanges: boolean; submittedByUserId: string | null }
export type MiperInboxViewer = { userId: string; permissions: readonly string[] }

export function miperInboxReason(row: MiperInboxCandidate, viewer: MiperInboxViewer): string | null {
  if (row.status === "superseded") return null
  const can = (permission: string) => viewer.permissions.includes(permission)
  const isSubmitter = row.submittedByUserId !== null && row.submittedByUserId === viewer.userId
  if (row.reviewState === "in_review" && can("prevention:risk:review") && !isSubmitter) return "Pendiente de tu revisión"
  if (row.reviewState === "pending_approval" && can("prevention:risk:approve_legal") && !isSubmitter) return "Pendiente de tu firma"
  if (can("prevention:risk:edit") && !row.isLegacy) {
    if (row.reviewState === "observed") return "Con observaciones"
    if (row.hasUnsentChanges) return "Cambios sin enviar"
    if (row.status === "draft" && row.reviewState === "none") return "Borrador"
  }
  return null
}
```

Crear `lib/prevention/miper/portfolio.ts`:

```ts
/**
 * Portada de la MIPER por faena (spec §7, Fase B): las reglas que no tocan la
 * base. Qué MIPER representa a cada faena, en qué estado está, cómo se lee la
 * URL de la portada (enlaces viejos incluidos) y qué cuenta cada cifra de la
 * franja. El servicio (`lib/services/miper/portfolio.ts`) arma las filas y la
 * portada (`app/(app)/prevencion/miper/miper-home.tsx`) las filtra con esto.
 */
import type { ProgramProgress } from "./progress"

export const PORTFOLIO_PATH = "/prevencion/miper"

export const PORTFOLIO_STATUSES = ["sin_miper", "borrador", "en_revision", "observada", "vigente"] as const
export type MiperPortfolioStatus = typeof PORTFOLIO_STATUSES[number]

export const PORTFOLIO_STATUS_LABEL: Record<MiperPortfolioStatus, string> = {
  sin_miper: "Sin MIPER",
  borrador: "Borrador",
  en_revision: "En revisión",
  observada: "Con observaciones",
  vigente: "Vigente",
}

/** El filtro de estado suma «Con MIPER» (todas menos «Sin MIPER»): es el destino de la cifra «Faenas con MIPER». */
export type PortfolioStatusFilter = MiperPortfolioStatus | "con_miper"
export const PORTFOLIO_STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: PortfolioStatusFilter; label: string }> = [
  { value: "con_miper", label: "Con MIPER" },
  ...PORTFOLIO_STATUSES.map((value) => ({ value, label: PORTFOLIO_STATUS_LABEL[value] })),
]

export type MiperPortfolioMatrix = { id: string; period: number | null; versionNumber: number | null; label: string; isLegacy: boolean }
export type MiperPortfolioAction = { matrixId: string; period: number | null; reason: string }

export type MiperPortfolioRow = {
  /** = `worksiteId`: `DataTable` usa `row.id` como clave de fila. */
  id: string
  worksiteId: string
  worksiteName: string
  worksiteActive: boolean
  /** La MIPER no reemplazada de mayor período; `null` = la faena no tiene MIPER. */
  matrix: MiperPortfolioMatrix | null
  /** La vigente, sólo cuando NO es `matrix` («Vigente vN (AAAA)»). */
  vigente: MiperPortfolioMatrix | null
  status: MiperPortfolioStatus
  /** `miperStatusLabel` de `matrix`, o «Sin MIPER». */
  stateLabel: string
  /** La dotación de la ficha de `matrix` o, sin ella, los trabajadores activos de la faena. */
  headcount: number
  headcountSource: "ficha" | "trabajadores"
  updatedAt: string | null
  /** Riesgos sin errores ÷ riesgos (la regla de «Completos x de y»). `null`: sin MIPER o metodología anterior. */
  completeness: { complete: number; total: number } | null
  importantCount: number
  intolerableCount: number
  /** De la vigente: Intolerables (o críticos legacy) sin control (`critical-control.ts`). */
  criticalWithoutControl: number
  requiresMyAction: boolean
  /** Lo que espera de ti CADA MIPER no reemplazada de la faena, no sólo la de la fila. */
  myActions: MiperPortfolioAction[]
  /** Quién envió la ronda abierta de `matrix`. */
  submittedByName: string | null
  /** Del programa de la vigente (o de `matrix` si no hay vigente). `null`: sin MIPER. */
  programProgress: ProgramProgress | null
}

/** Una opción del selector «Cambiar de faena» del espacio de trabajo. */
export type MiperWorksiteTarget = { worksiteId: string; worksiteName: string; matrixId: string | null; period: number | null }

export type PortfolioCandidate = { id: string; worksiteId: string; period: number | null; status: string; updatedAt: string }
export type PortfolioPick<T extends PortfolioCandidate> = { primary: T; published: T | null; all: T[] }

/**
 * Por faena: la MIPER no reemplazada de mayor período (sin período al final;
 * con empate, la modificada más reciente) y, aparte, la vigente (`published`;
 * el índice único de la base admite una por faena). Las reemplazadas no
 * cuentan: una faena que sólo tiene reemplazadas no tiene MIPER.
 */
export function pickCurrentMatrices<T extends PortfolioCandidate>(rows: readonly T[]): Map<string, PortfolioPick<T>> {
  const byWorksite = new Map<string, T[]>()
  for (const row of rows) {
    if (row.status === "superseded") continue
    const list = byWorksite.get(row.worksiteId)
    if (list) list.push(row)
    else byWorksite.set(row.worksiteId, [row])
  }
  const picks = new Map<string, PortfolioPick<T>>()
  for (const [worksiteId, list] of byWorksite) {
    const all = [...list].sort((a, b) =>
      (b.period ?? Number.NEGATIVE_INFINITY) - (a.period ?? Number.NEGATIVE_INFINITY)
      || b.updatedAt.localeCompare(a.updatedAt)
      || a.id.localeCompare(b.id))
    picks.set(worksiteId, { primary: all[0]!, published: list.find((row) => row.status === "published") ?? null, all })
  }
  return picks
}

/** En qué orden se ofrecen las acciones de una faena: la MIPER de la fila, la vigente y el resto, sin repetir. */
export function portfolioActionOrder<T extends PortfolioCandidate>(pick: PortfolioPick<T>): T[] {
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const row of [pick.primary, pick.published, ...pick.all]) {
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)
    ordered.push(row)
  }
  return ordered
}

export function portfolioStatusOf(matrix: { status: string; reviewState: string } | null): MiperPortfolioStatus {
  if (!matrix) return "sin_miper"
  if (matrix.reviewState === "in_review" || matrix.reviewState === "pending_approval") return "en_revision"
  if (matrix.reviewState === "observed") return "observada"
  return matrix.status === "published" ? "vigente" : "borrador"
}

export type PortfolioView = "todas" | "mias"
export type PortfolioParams = { vista: PortfolioView; estado: PortfolioStatusFilter | null; sinControl: boolean; faena: string | null }

const STATUS_FILTERS: ReadonlySet<string> = new Set(PORTFOLIO_STATUS_FILTER_OPTIONS.map((option) => option.value))

/**
 * Lee la URL de la portada. Enlaces viejos: `?tab=porhacer` (la bandeja de
 * antes) es `vista=mias`; `?tab=todas` y `?tab=resumen` caen en la vista por
 * defecto. `?faena=` (enlace del PDTP) sigue acotando a una faena.
 */
export function parsePortfolioParams(params: { get(key: string): string | null }): PortfolioParams {
  const vista = params.get("vista")
  const estado = params.get("estado")
  return {
    vista: vista === "mias" || (vista === null && params.get("tab") === "porhacer") ? "mias" : "todas",
    estado: estado && STATUS_FILTERS.has(estado) ? (estado as PortfolioStatusFilter) : null,
    sinControl: params.get("sincontrol") === "1",
    faena: params.get("faena") || null,
  }
}

export function hasPortfolioFilters(params: PortfolioParams): boolean {
  return params.vista === "mias" || params.estado !== null || params.sinControl || params.faena !== null
}

/**
 * La URL de la portada con `patch` aplicado (`null` o `""` quitan la clave).
 * Borra SIEMPRE el `tab` heredado: si no, un `?tab=porhacer` viejo volvería a
 * forzar «mías» después de elegir «Todas las faenas».
 */
export function portfolioHref(current: { toString(): string }, patch: Record<string, string | null>, pathname: string = PORTFOLIO_PATH): string {
  const next = new URLSearchParams(current.toString())
  next.delete("tab")
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") next.delete(key)
    else next.set(key, value)
  }
  const query = next.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function filterPortfolioRows(rows: readonly MiperPortfolioRow[], params: PortfolioParams): MiperPortfolioRow[] {
  return rows.filter((row) => {
    if (params.vista === "mias" && !row.requiresMyAction) return false
    if (params.estado === "con_miper" && row.matrix === null) return false
    if (params.estado !== null && params.estado !== "con_miper" && row.status !== params.estado) return false
    if (params.sinControl && row.criticalWithoutControl === 0) return false
    if (params.faena !== null && row.worksiteId !== params.faena) return false
    return true
  })
}

export type PortfolioSummary = { total: number; withMiper: number; inReview: number; mine: number; critical: number }

/** Las cuatro cifras de la franja, sobre TODAS las faenas del alcance (los filtros no las cambian). */
export function portfolioSummary(rows: readonly MiperPortfolioRow[]): PortfolioSummary {
  return {
    total: rows.length,
    withMiper: rows.filter((row) => row.matrix !== null).length,
    inReview: rows.filter((row) => row.status === "en_revision").length,
    mine: rows.filter((row) => row.requiresMyAction).length,
    critical: rows.reduce((total, row) => total + row.criticalWithoutControl, 0),
  }
}

/**
 * Destino de cada cifra (A1): su subconjunto y SÓLO él. Las URLs no arrastran
 * otros filtros. `critical` es también el destino del KPI del tablero
 * (`prevention-section.tsx`).
 */
export const PORTFOLIO_SUMMARY_HREF = {
  withMiper: `${PORTFOLIO_PATH}?estado=con_miper`,
  inReview: `${PORTFOLIO_PATH}?estado=en_revision`,
  mine: `${PORTFOLIO_PATH}?vista=mias`,
  critical: `${PORTFOLIO_PATH}?sincontrol=1`,
} as const
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- lib/prevention/miper/inbox.test.ts lib/prevention/miper/portfolio.test.ts`
Expected: PASS.

- [ ] **Step 5: Puertas**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/inbox.ts lib/prevention/miper/inbox.test.ts lib/prevention/miper/portfolio.ts lib/prevention/miper/portfolio.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/prevention/miper/inbox.ts lib/prevention/miper/inbox.test.ts lib/prevention/miper/portfolio.ts lib/prevention/miper/portfolio.test.ts
git commit -m "feat(miper): reglas puras de la portada por faena y de «requiere mi acción»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Servicio `listMiperPortfolio` (y la bandeja con la regla extraída)

**Files:**
- Modify: `lib/services/miper/queries.ts`:
  - `:22-26`: `MiperListRow` gana `submittedByUserId`;
  - `:164`: se exporta `buildRows`;
  - `:187-193`: el objeto de cada fila;
  - `:232-241`: `listMiperInbox` usa `miperInboxReason`.
- Create: `lib/services/miper/portfolio.ts`
- Test: `lib/__tests__/miper-portfolio.test.ts` (nuevo), `lib/__tests__/miper-queries.test.ts`
- Modify: `tests/pglite-files.ts`

**Interfaces:**
- Consumes:
  - `isCriticalRisk`, `isCriticalWithoutControl` (Task 1);
  - `buildMiperSnapshots(client, ids)` (Task 2);
  - `miperInboxReason`, `pickCurrentMatrices`, `portfolioActionOrder`, `portfolioStatusOf`,
    `PORTFOLIO_STATUS_LABEL` y los tipos `MiperPortfolioRow`, `MiperPortfolioMatrix`,
    `MiperPortfolioAction`, `MiperWorksiteTarget` (Task 3);
  - `checkMiperCompleteness` y `programProgress` (existentes).
- Produces:
  - `listMiperPortfolio(access: MiperAccess): Promise<{ rows: MiperPortfolioRow[] }>`. Exige
    `prevention:risk:view`. Ordena por nombre de faena.
  - `listMiperWorksiteTargets(access: MiperAccess): Promise<MiperWorksiteTarget[]>`. Exige
    `prevention:risk:view`. Mismo alcance y misma MIPER principal, sin fotos.
  - En `queries.ts`:
    - `export async function buildRows(matrixRows: Array<{ matrix: typeof preventionRiskMatrices.$inferSelect; worksiteName: string }>): Promise<MiperListRow[]>`;
    - `MiperListRow.submittedByUserId: string | null`.
  - **Cambio de conducta:** `listMiperInbox` deja de listar como «Pendiente de tu revisión / firma» la
    MIPER cuya ronda envió la misma persona.

- [ ] **Step 1: Write the failing tests**

Crear `lib/__tests__/miper-portfolio.test.ts`:

```ts
/**
 * Fase B: la portada por faena (`listMiperPortfolio`) y la lista del selector
 * de faena (`listMiperWorksiteTargets`).
 *
 * Faenas sembradas:
 * - A (activa): vigente 2026 con observaciones, dos Intolerables sin control y
 *   un programa (1 de 2 ocurrencias hechas), más el borrador 2027.
 * - B (activa): borrador en revisión, enviado por quien también puede revisar.
 * - C (activa): sin MIPER, con 3 trabajadores activos y 1 inactivo.
 * - D (cerrada): MIPER vigente de la metodología anterior con un riesgo crítico legacy.
 * - E (cerrada): sin MIPER. No aparece.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { checkMiperCompleteness } from "@/lib/prevention/miper/completeness"
import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry, saveMiperControl } = await import("@/lib/services/miper/entries")
const { getMiperWorkspace } = await import("@/lib/services/miper/queries")
const { listMiperPortfolio, listMiperWorksiteTargets } = await import("@/lib/services/miper/portfolio")
const { getRiskDashboard } = await import("@/lib/services/prevention-risk-legal")

const all = { mode: "all" as const, ids: [] as [] }
const prevencion = { userId: "u-prev", scope: all, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", scope: all, permissions: ["prevention:risk:view", "prevention:risk:review"] }
/** Edita y revisa. Envió la ronda de la Faena B, así que no puede revisarla. */
const doble = { userId: "u-doble", scope: all, permissions: ["prevention:risk:view", "prevention:risk:edit", "prevention:risk:review"] }
const acotada = { userId: "u-prev", scope: { mode: "some" as const, ids: ["ws-a"] }, permissions: ["prevention:risk:view"] }

let vigenteA = ""
let borradorA = ""
let revisionB = ""
const legacyD = "riskmatrix-legacy-d"
const rowOf = async (access: typeof prevencion, worksiteId: string) => (await listMiperPortfolio(access)).rows.find((row) => row.worksiteId === worksiteId)!

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: "ws-a", name: "Faena A", code: "A" },
    { id: "ws-b", name: "Faena B", code: "B" },
    { id: "ws-c", name: "Faena C", code: "C" },
    { id: "ws-d", name: "Faena D", code: "D", isActive: false },
    { id: "ws-e", name: "Faena E", code: "E", isActive: false },
  ])
  await testDb.insert(schema.users).values([
    { id: "u-prev", name: "Prevencionista A", email: "prev@p.cl", hashedPassword: "x", isActive: true },
    { id: "u-jefa", name: "Jefa Prevención", email: "jefa@p.cl", hashedPassword: "x", isActive: true },
    { id: "u-doble", name: "Doble Rol", email: "doble@p.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.workers).values([
    { id: "w-c1", firstName: "Uno", lastName: "C", worksiteId: "ws-c" },
    { id: "w-c2", firstName: "Dos", lastName: "C", worksiteId: "ws-c" },
    { id: "w-c3", firstName: "Tres", lastName: "C", worksiteId: "ws-c" },
    { id: "w-c4", firstName: "Cuatro", lastName: "C", worksiteId: "ws-c", isActive: false },
  ])

  // ── Faena A: vigente 2026 con observaciones y su programa, y el borrador 2027 ──
  vigenteA = (await createMiper({ worksiteId: "ws-a", period: 2026, revisionReason: "Período vigente de la portada." }, prevencion)).id
  await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Caída de altura", probability: 4, consequence: 4 } }, prevencion)
  const conMedida = await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Atrapamiento", probability: 4, consequence: 4 } }, prevencion)
  const medida = await saveMiperControl({ matrixId: vigenteA, entryId: conMedida.id, values: { hierarchy: "engineering", description: "Guarda fija", responsibleUserId: "u-prev", dueDate: "2026-12-31" } }, prevencion)
  // Implementada pero sin vínculo PDTP: sigue «sin control» (le falta una de las dos cosas).
  await testDb.update(schema.preventionRiskControls).set({ status: "implemented" }).where(eq(schema.preventionRiskControls.id, medida.id))
  await saveMiperEntry({ matrixId: vigenteA, values: { hazard: "Ruido", probability: 1, consequence: 2 } }, prevencion)
  await testDb.update(schema.preventionRiskMatrices)
    .set({ status: "published", reviewState: "observed", publishedAt: new Date().toISOString(), reviewedByUserId: "u-jefa", approvedByUserId: "u-jefa" })
    .where(eq(schema.preventionRiskMatrices.id, vigenteA))
  await testDb.insert(schema.preventionRiskPrograms).values({ id: "prog-a", matrixId: vigenteA, worksiteId: "ws-a", period: 2026, createdByUserId: "u-prev" })
  await testDb.insert(schema.preventionRiskProgramActions).values({ id: "act-a1", programId: "prog-a", actionNumber: 1, description: "Inspección de guardas", scheduleKind: "monthly", startsOn: "2024-01-01", createdByUserId: "u-prev" })
  await testDb.insert(schema.preventionRiskProgramOccurrences).values([
    { id: "occ-hecha", actionId: "act-a1", dueOn: "2024-01-31", outcome: "done" },
    { id: "occ-pendiente", actionId: "act-a1", dueOn: "2024-02-29", outcome: "pending" },
  ])
  borradorA = (await createMiper({ worksiteId: "ws-a", period: 2027, revisionReason: "Período siguiente de la portada." }, prevencion)).id
  await saveMiperEntry({ matrixId: borradorA, values: { hazard: "Volcamiento", probability: 2, consequence: 4 } }, prevencion)

  // ── Faena B: borrador en revisión, enviado por quien también revisa ──
  revisionB = (await createMiper({ worksiteId: "ws-b", period: 2026, revisionReason: "Período en revisión de la portada." }, prevencion)).id
  await saveMiperEntry({ matrixId: revisionB, values: { hazard: "Polvo", probability: 2, consequence: 2 } }, prevencion)
  await testDb.update(schema.preventionRiskMatrices).set({ reviewState: "in_review" }).where(eq(schema.preventionRiskMatrices.id, revisionB))
  await testDb.insert(schema.preventionRiskReviewRounds).values({ id: "round-b", matrixId: revisionB, roundNumber: 1, stage: "technical", snapshot: { header: {}, entries: [] }, snapshotSha256: "b".repeat(64), submittedByUserId: "u-doble" })

  // ── Faena D: cerrada, con su MIPER vigente de la metodología anterior ──
  await testDb.insert(schema.preventionRiskMatrices).values({
    id: legacyD, worksiteId: "ws-d", matrixVersion: 1, title: "MIPER legacy D", status: "published", isLegacy: true,
    methodologyId: RE04_METHODOLOGY.id, methodologySnapshot: {}, revisionReason: "MIPER de la metodología anterior.",
    participationSummary: "Participación de la metodología anterior.", consultationEvidenceReference: "Acta anterior",
    createdByUserId: "u-prev", reviewedByUserId: "u-jefa", approvedByUserId: "u-jefa", publishedAt: new Date().toISOString(),
  })
  await testDb.insert(schema.preventionRiskEntries).values({ id: "entry-legacy-d", matrixId: legacyD, hazardCode: "HAZ-D", hazard: "Explosión", isCritical: true })
}, 60_000)

describe("portada de la MIPER por faena (listMiperPortfolio)", () => {
  it("una fila por faena en alcance: las activas y las cerradas con MIPER; las cerradas sin MIPER no", async () => {
    const { rows } = await listMiperPortfolio(prevencion)
    expect(rows.map((row) => row.worksiteName)).toEqual(["Faena A", "Faena B", "Faena C", "Faena D"])
    expect(rows.map((row) => row.id)).toEqual(rows.map((row) => row.worksiteId))
  })

  it("la faena sin MIPER viene con matrix nulo, «Sin MIPER» y la dotación de sus trabajadores activos", async () => {
    expect(await rowOf(prevencion, "ws-c")).toMatchObject({
      matrix: null, vigente: null, status: "sin_miper", stateLabel: "Sin MIPER", headcount: 3, headcountSource: "trabajadores",
      updatedAt: null, completeness: null, programProgress: null, requiresMyAction: false, myActions: [], criticalWithoutControl: 0,
    })
  })

  it("con dos MIPER no reemplazadas, la fila es la de mayor período y la vigente va aparte", async () => {
    const a = await rowOf(prevencion, "ws-a")
    expect(a.matrix).toMatchObject({ id: borradorA, period: 2027, isLegacy: false })
    expect(a.vigente).toMatchObject({ id: vigenteA, period: 2026, isLegacy: false })
    expect(a).toMatchObject({ status: "borrador", stateLabel: "Borrador", importantCount: 1, intolerableCount: 0, headcountSource: "ficha" })
  })

  it("«sin control» y el avance del programa son de la vigente", async () => {
    const a = await rowOf(prevencion, "ws-a")
    expect(a.criticalWithoutControl).toBe(2)
    expect(a.programProgress).toMatchObject({ done: 1, planned: 2, ratio: 0.5 })
  })

  it("la completitud es la misma que cuenta el espacio de trabajo («Completos x de y»)", async () => {
    const a = await rowOf(prevencion, "ws-a")
    const ws = await getMiperWorkspace(borradorA, prevencion)
    const linked = new Set(ws.controlActionLinks.map((link) => link.controlId))
    const incomplete = new Set(checkMiperCompleteness(ws.snapshot, { linkedControlIds: linked, requireProgramLink: true })
      .flatMap((issue) => (issue.severity === "error" && issue.entryId ? [issue.entryId] : [])))
    expect(a.completeness).toEqual({ complete: ws.snapshot.entries.length - incomplete.size, total: ws.snapshot.entries.length })
    expect(a.completeness).toEqual({ complete: 0, total: 1 })
  })

  it("la MIPER de la metodología anterior no tiene cifra de completitud y su crítico legacy cuenta «sin control»", async () => {
    const d = await rowOf(prevencion, "ws-d")
    expect(d).toMatchObject({ worksiteActive: false, status: "vigente", stateLabel: "Vigente · metodología anterior", completeness: null, criticalWithoutControl: 1 })
    expect(d.matrix).toMatchObject({ id: legacyD, isLegacy: true })
  })

  it("«Riesgos críticos sin control» suma lo mismo que el KPI del tablero (una sola definición)", async () => {
    const { rows } = await listMiperPortfolio(prevencion)
    const dashboard = await getRiskDashboard(prevencion)
    expect(rows.reduce((total, row) => total + row.criticalWithoutControl, 0)).toBe(dashboard.criticalBlockers.length)
    expect(dashboard.criticalBlockers.length).toBe(3)
  })

  it("«requiere mi acción» mira todas las MIPER no reemplazadas de la faena, no sólo la de la fila", async () => {
    const a = await rowOf(prevencion, "ws-a")
    expect(a.requiresMyAction).toBe(true)
    expect(a.myActions).toEqual([
      { matrixId: borradorA, period: 2027, reason: "Borrador" },
      { matrixId: vigenteA, period: 2026, reason: "Con observaciones" },
    ])
  })

  it("quien envió la ronda no tiene «Pendiente de tu revisión» aunque pueda revisar; la Jefa sí", async () => {
    const deLaJefa = await rowOf(jefa, "ws-b")
    expect(deLaJefa).toMatchObject({ status: "en_revision", requiresMyAction: true, submittedByName: "Doble Rol" })
    expect(deLaJefa.myActions).toEqual([{ matrixId: revisionB, period: 2026, reason: "Pendiente de tu revisión" }])
    const deQuienEnvio = await rowOf(doble, "ws-b")
    expect(deQuienEnvio.myActions).toEqual([])
    expect(deQuienEnvio.requiresMyAction).toBe(false)
  })

  it("respeta el alcance y exige el permiso de vista", async () => {
    expect((await listMiperPortfolio(acotada)).rows.map((row) => row.worksiteId)).toEqual(["ws-a"])
    await expect(listMiperPortfolio({ ...acotada, permissions: [] })).rejects.toThrow(/fuera de alcance/)
  })

  it("el selector de faena trae la misma MIPER principal por faena", async () => {
    expect(await listMiperWorksiteTargets(prevencion)).toEqual([
      { worksiteId: "ws-a", worksiteName: "Faena A", matrixId: borradorA, period: 2027 },
      { worksiteId: "ws-b", worksiteName: "Faena B", matrixId: revisionB, period: 2026 },
      { worksiteId: "ws-c", worksiteName: "Faena C", matrixId: null, period: null },
      { worksiteId: "ws-d", worksiteName: "Faena D", matrixId: legacyD, period: null },
    ])
    expect((await listMiperWorksiteTargets(acotada)).map((target) => target.worksiteId)).toEqual(["ws-a"])
    await expect(listMiperWorksiteTargets({ ...acotada, permissions: [] })).rejects.toThrow(/fuera de alcance/)
  })
})
```

En `lib/__tests__/miper-queries.test.ts`:
- dentro del test «la bandeja muestra a la prevencionista su borrador y a la Jefa lo enviado»,
  después de su última línea (`expect(inbox.map(...)).toEqual(...)`), agregar:

  ```ts
      expect(inbox[0]!.submittedByUserId).toBe("u-q")
  ```

- y justo después de ese test (antes de «el historial lista eventos…»), agregar:

  ```ts
    it("quien envió la ronda no la ve como «Pendiente de tu revisión» aunque tenga el permiso de revisar", async () => {
      // La ronda «rq» del test anterior la envió u-q. Con el permiso de revisar sumado, la bandeja
      // sigue sin ofrecérsela: no puede revisar lo que ella misma envió (assertNotSubmitter).
      const autoraQueRevisa = { ...author, permissions: [...author.permissions, "prevention:risk:review"] }
      expect((await q.listMiperInbox(autoraQueRevisa)).map((row) => row.inboxReason)).toEqual([])
    })
  ```

En `tests/pglite-files.ts`, reemplazar las líneas 30-31:

```ts
  // MIPER F1: espacio de trabajo, bandeja por rol, lista e historial.
  "lib/__tests__/miper-queries.test.ts",
```

por:

```ts
  // MIPER F1: espacio de trabajo, bandeja por rol, lista e historial.
  "lib/__tests__/miper-queries.test.ts",
  // MIPER Fase B: portada por faena (alcance, faenas sin MIPER, «requiere mi acción», «sin control»).
  "lib/__tests__/miper-portfolio.test.ts",
```

- [ ] **Step 2: Run tests to verify they fail**

Run, de a uno:

```bash
npm run test:pglite -- lib/__tests__/miper-portfolio.test.ts
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
```

Expected:
- `miper-portfolio` falla al cargar con «Failed to resolve import "@/lib/services/miper/portfolio"»;
- `miper-queries` falla en las dos aserciones nuevas: `submittedByUserId` es `undefined` y la bandeja
  devuelve `["Pendiente de tu revisión"]`.

- [ ] **Step 3: `queries.ts`: `buildRows` exportada, `submittedByUserId` y la bandeja con la regla extraída**

En `lib/services/miper/queries.ts`:

1. Agregar a los imports:

   ```ts
   import { miperInboxReason } from "@/lib/prevention/miper/inbox"
   ```

2. En `MiperListRow` (líneas 22-26), reemplazar
   `versionNumber: number | null; label: string; updatedAt: string; submittedAt: string | null; submittedByName: string | null`
   por:

   ```ts
     versionNumber: number | null; label: string; updatedAt: string; submittedAt: string | null; submittedByName: string | null
     /** Quién envió la ronda abierta: «Requieren mi acción» lo excluye de revisar lo suyo (`miperInboxReason`). */
     submittedByUserId: string | null
   ```

3. Línea 164: `async function buildRows(` → `export async function buildRows(`. Agregar encima:

   ```ts
   /** Fila de lista de una MIPER (rótulo, versión, ronda abierta, conteos). La reusan la cadena de la faena y la portada por faena. */
   ```

4. En el objeto que devuelve `buildRows` (línea 191), reemplazar
   `updatedAt: matrix.updatedAt, submittedAt: round?.submittedAt ?? null, submittedByName: round ? submitters.get(round.submittedByUserId) ?? null : null,`
   por:

   ```ts
         updatedAt: matrix.updatedAt, submittedAt: round?.submittedAt ?? null, submittedByName: round ? submitters.get(round.submittedByUserId) ?? null : null,
         submittedByUserId: round?.submittedByUserId ?? null,
   ```

5. En `listMiperInbox`, reemplazar las líneas 232-241:

   ```ts
     const built = await buildRows(rows)
     return built.flatMap((item) => {
       let inboxReason: string | undefined
       if (item.reviewState === "in_review" && can("prevention:risk:review")) inboxReason = "Pendiente de tu revisión"
       else if (item.reviewState === "pending_approval" && can("prevention:risk:approve_legal")) inboxReason = "Pendiente de tu firma"
       else if (can("prevention:risk:edit") && !item.isLegacy) {
         inboxReason = item.reviewState === "observed" ? "Con observaciones" : item.hasUnsentChanges ? "Cambios sin enviar" : item.status === "draft" && item.reviewState === "none" ? "Borrador" : undefined
       }
       return inboxReason ? [{ ...item, inboxReason }] : []
     })
   ```

   por:

   ```ts
     const built = await buildRows(rows)
     // El motivo de cada fila es la regla compartida con «Requieren mi acción» de la portada (Fase B):
     // quien envió la ronda ya no la ve como pendiente de su revisión ni de su firma.
     return built.flatMap((item) => {
       const inboxReason = miperInboxReason(item, access)
       return inboxReason ? [{ ...item, inboxReason }] : []
     })
   ```

   El `const can = …` de la línea 216 se queda: lo siguen usando las condiciones SQL de arriba.

- [ ] **Step 4: Write the service**

Crear `lib/services/miper/portfolio.ts`:

```ts
/**
 * Portada de la MIPER por faena (spec §7, Fase B). Una fila por faena en
 * alcance —las activas y las cerradas que todavía tienen una MIPER no
 * reemplazada—, con su MIPER de mayor período y, aparte, la vigente si es otra.
 * Las reglas que no tocan la base están en `lib/prevention/miper/portfolio.ts`.
 *
 * Es una lectura de página: se llama desde `page.tsx`, nunca dentro de una
 * transacción, y usa la conexión global como `buildRows`. El número de
 * consultas no crece con el de MIPER (sin N+1): las fotos van en lote
 * (`buildMiperSnapshots`) y el resto son conteos agrupados.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskMatrices,
  preventionRiskProgramActionControls, preventionRiskProgramActions, preventionRiskProgramOccurrenceRecords,
  preventionRiskProgramOccurrences, preventionRiskPrograms, workers, worksites,
} from "@/db/schema"
import { checkMiperCompleteness } from "@/lib/prevention/miper/completeness"
import { isCriticalRisk, isCriticalWithoutControl } from "@/lib/prevention/miper/critical-control"
import { miperInboxReason } from "@/lib/prevention/miper/inbox"
import {
  pickCurrentMatrices, portfolioActionOrder, PORTFOLIO_STATUS_LABEL, portfolioStatusOf,
  type MiperPortfolioAction, type MiperPortfolioMatrix, type MiperPortfolioRow, type MiperWorksiteTarget,
} from "@/lib/prevention/miper/portfolio"
import { programProgress, type OccurrenceOutcome } from "@/lib/prevention/miper/progress"
import type { MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { todayInChile } from "@/lib/utils"
import { buildRows, type MiperListRow } from "./queries"
import { buildMiperSnapshots } from "./snapshots"
import { type MiperAccess, requireAccess, scopeCondition } from "./shared"

const VIEW = "prevention:risk:view"
type MatrixRow = typeof preventionRiskMatrices.$inferSelect
type PortfolioOccurrence = { outcome: OccurrenceOutcome; dueOn: string; late: boolean }

/** Las faenas del alcance que van en la portada y sus MIPER no reemplazadas. */
async function loadPortfolioBase(access: MiperAccess) {
  const [sites, matrixRows] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites)
      .where(scopeCondition(access.scope, worksites.id)).orderBy(asc(worksites.name)),
    db.select({ matrix: preventionRiskMatrices, worksiteName: worksites.name }).from(preventionRiskMatrices)
      .innerJoin(worksites, eq(worksites.id, preventionRiskMatrices.worksiteId))
      .where(and(scopeCondition(access.scope, preventionRiskMatrices.worksiteId), ne(preventionRiskMatrices.status, "superseded"))),
  ])
  // Una faena cerrada sigue en la portada mientras tenga una MIPER no reemplazada (lo que `listMipers` ya mostraba).
  const withMiper = new Set(matrixRows.map((row) => row.matrix.worksiteId))
  return { sites: sites.filter((site) => site.isActive || withMiper.has(site.id)), matrixRows }
}

export async function listMiperPortfolio(access: MiperAccess): Promise<{ rows: MiperPortfolioRow[] }> {
  requireAccess(access, VIEW)
  const { sites, matrixRows } = await loadPortfolioBase(access)
  const matrixById = new Map(matrixRows.map(({ matrix }) => [matrix.id, matrix]))
  const listRows = await buildRows(matrixRows)
  const picks = pickCurrentMatrices(listRows)

  const primaries = [...picks.values()].map((pick) => pick.primary)
  const re04Ids = primaries.filter((row) => !row.isLegacy).map((row) => row.id)
  const publishedIds = [...picks.values()].flatMap((pick) => (pick.published ? [pick.published.id] : []))
  // El programa que se ejecuta es el de la vigente; sin vigente, el de la MIPER de la fila.
  const progressMatrixOf = (worksiteId: string) => { const pick = picks.get(worksiteId)!; return (pick.published ?? pick.primary).id }

  const [snapshots, linked, critical, occurrences, activeWorkers] = await Promise.all([
    buildMiperSnapshots(db, re04Ids),
    programLinkedControlIdsByMatrix(re04Ids),
    criticalWithoutControlByMatrix(publishedIds),
    occurrencesByMatrix([...picks.keys()].map(progressMatrixOf)),
    activeWorkersByWorksite(sites.map((site) => site.id)),
  ])
  const today = todayInChile()

  const rows = sites.map((site): MiperPortfolioRow => {
    const pick = picks.get(site.id)
    if (!pick) {
      return {
        id: site.id, worksiteId: site.id, worksiteName: site.name, worksiteActive: site.isActive,
        matrix: null, vigente: null, status: "sin_miper", stateLabel: PORTFOLIO_STATUS_LABEL.sin_miper,
        headcount: activeWorkers.get(site.id) ?? 0, headcountSource: "trabajadores", updatedAt: null, completeness: null,
        importantCount: 0, intolerableCount: 0, criticalWithoutControl: 0, requiresMyAction: false, myActions: [],
        submittedByName: null, programProgress: null,
      }
    }
    const primary = pick.primary
    const matrix = matrixById.get(primary.id)!
    const snapshot = snapshots.get(primary.id)
    const vigente = pick.published && pick.published.id !== primary.id ? pick.published : null
    const myActions = portfolioActionOrder(pick).flatMap((candidate): MiperPortfolioAction[] => {
      const reason = miperInboxReason(candidate, access)
      return reason ? [{ matrixId: candidate.id, period: candidate.period, reason }] : []
    })
    return {
      id: site.id, worksiteId: site.id, worksiteName: site.name, worksiteActive: site.isActive,
      matrix: matrixRef(primary, matrix),
      vigente: vigente ? matrixRef(vigente, matrixById.get(vigente.id)!) : null,
      status: portfolioStatusOf(primary),
      stateLabel: primary.label,
      headcount: matrix.headcountTotal ?? activeWorkers.get(site.id) ?? 0,
      headcountSource: matrix.headcountTotal === null ? "trabajadores" : "ficha",
      updatedAt: primary.updatedAt,
      completeness: snapshot ? completenessOf(snapshot, linked.get(primary.id)) : null,
      importantCount: primary.classificationCounts.important,
      intolerableCount: primary.classificationCounts.intolerable,
      criticalWithoutControl: pick.published ? critical.get(pick.published.id) ?? 0 : 0,
      requiresMyAction: myActions.length > 0,
      myActions,
      submittedByName: primary.submittedByName,
      programProgress: programProgress(occurrences.get(progressMatrixOf(site.id)) ?? [], today),
    }
  })
  return { rows }
}

/** Lista del selector «Cambiar de faena»: el mismo alcance y la misma MIPER principal, sin fotos ni conteos. */
export async function listMiperWorksiteTargets(access: MiperAccess): Promise<MiperWorksiteTarget[]> {
  requireAccess(access, VIEW)
  const { sites, matrixRows } = await loadPortfolioBase(access)
  const picks = pickCurrentMatrices(matrixRows.map(({ matrix }) => matrix))
  return sites.map((site) => {
    const primary = picks.get(site.id)?.primary ?? null
    return { worksiteId: site.id, worksiteName: site.name, matrixId: primary?.id ?? null, period: primary?.period ?? null }
  })
}

function matrixRef(row: MiperListRow, matrix: MatrixRow): MiperPortfolioMatrix {
  return { id: row.id, period: row.period, versionNumber: row.versionNumber, label: row.label, isLegacy: matrix.isLegacy }
}

/** «Completos x de y» del espacio de trabajo: riesgos sin errores, con la regla del Intolerable dentro del programa. */
function completenessOf(snapshot: MiperSnapshot, linkedControlIds: ReadonlySet<string> | undefined) {
  const incomplete = new Set(checkMiperCompleteness(snapshot, { linkedControlIds: linkedControlIds ?? new Set<string>(), requireProgramLink: true })
    .flatMap((issue) => (issue.severity === "error" && issue.entryId ? [issue.entryId] : [])))
  return { complete: snapshot.entries.length - incomplete.size, total: snapshot.entries.length }
}

/** Medidas vinculadas a una actividad viva del programa, por MIPER: el criterio de `programLinkedControlIds`. */
async function programLinkedControlIdsByMatrix(matrixIds: string[]): Promise<Map<string, Set<string>>> {
  const byMatrix = new Map<string, Set<string>>()
  if (matrixIds.length === 0) return byMatrix
  const rows = await db.select({ matrixId: preventionRiskPrograms.matrixId, controlId: preventionRiskProgramActionControls.controlId })
    .from(preventionRiskProgramActionControls)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramActionControls.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .where(and(inArray(preventionRiskPrograms.matrixId, matrixIds), eq(preventionRiskProgramActions.status, "active")))
  for (const row of rows) {
    const set = byMatrix.get(row.matrixId) ?? new Set<string>()
    set.add(row.controlId)
    byMatrix.set(row.matrixId, set)
  }
  return byMatrix
}

/** «Riesgos críticos sin control» de cada MIPER vigente, con el predicado compartido con el tablero. */
async function criticalWithoutControlByMatrix(matrixIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (matrixIds.length === 0) return counts
  const entries = await db.select({
    id: preventionRiskEntries.id, matrixId: preventionRiskEntries.matrixId,
    classification: preventionRiskEntries.classification, isCritical: preventionRiskEntries.isCritical,
  }).from(preventionRiskEntries).where(inArray(preventionRiskEntries.matrixId, matrixIds))
  const critical = entries.filter((entry) => isCriticalRisk(entry))
  if (critical.length === 0) return counts
  const controls = await db.select({ id: preventionRiskControls.id, riskEntryId: preventionRiskControls.riskEntryId, status: preventionRiskControls.status })
    .from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, critical.map((entry) => entry.id)))
  const links = controls.length === 0 ? [] : await db.select({ sourceId: preventionPdtpSourceLinks.sourceId }).from(preventionPdtpSourceLinks)
    .where(and(eq(preventionPdtpSourceLinks.sourceType, "risk_control"), inArray(preventionPdtpSourceLinks.sourceId, controls.map((control) => control.id)), eq(preventionPdtpSourceLinks.isActive, true)))
  const linkedControlIds = new Set(links.map((link) => link.sourceId))
  const controlsByEntry = new Map<string, typeof controls>()
  for (const control of controls) {
    const list = controlsByEntry.get(control.riskEntryId)
    if (list) list.push(control)
    else controlsByEntry.set(control.riskEntryId, [control])
  }
  for (const entry of critical) {
    if (isCriticalWithoutControl(entry, controlsByEntry.get(entry.id) ?? [], linkedControlIds)) counts.set(entry.matrixId, (counts.get(entry.matrixId) ?? 0) + 1)
  }
  return counts
}

/**
 * Ocurrencias del programa de cada MIPER, en la forma que consume
 * `programProgress`. El resultado vigente es el del registro actual; sin
 * registro, el de la ocurrencia: el mismo criterio que `getProgramWorkspace`.
 * (Antes vivía en `dashboard.ts`, que la Task 7 retira.)
 */
async function occurrencesByMatrix(matrixIds: string[]): Promise<Map<string, PortfolioOccurrence[]>> {
  const byMatrix = new Map<string, PortfolioOccurrence[]>()
  if (matrixIds.length === 0) return byMatrix
  const rows = await db.select({
    matrixId: preventionRiskPrograms.matrixId,
    occurrenceOutcome: preventionRiskProgramOccurrences.outcome,
    dueOn: preventionRiskProgramOccurrences.dueOn,
    recordId: preventionRiskProgramOccurrenceRecords.id,
    recordOutcome: preventionRiskProgramOccurrenceRecords.outcome,
    late: preventionRiskProgramOccurrenceRecords.late,
  }).from(preventionRiskProgramOccurrences)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .leftJoin(preventionRiskProgramOccurrenceRecords, eq(preventionRiskProgramOccurrenceRecords.id, preventionRiskProgramOccurrences.currentRecordId))
    .where(inArray(preventionRiskPrograms.matrixId, matrixIds))
  for (const row of rows) {
    const list = byMatrix.get(row.matrixId) ?? []
    list.push({
      outcome: (row.recordId ? row.recordOutcome : row.occurrenceOutcome) as OccurrenceOutcome,
      dueOn: row.dueOn,
      late: row.recordId ? row.late ?? false : false,
    })
    byMatrix.set(row.matrixId, list)
  }
  return byMatrix
}

/** Dotación de respaldo: trabajadores activos por faena (cuando la ficha no la trae). */
async function activeWorkersByWorksite(worksiteIds: string[]): Promise<Map<string, number>> {
  if (worksiteIds.length === 0) return new Map()
  const rows = await db.select({ worksiteId: workers.worksiteId, count: sql<number>`count(*)::int` }).from(workers)
    .where(and(inArray(workers.worksiteId, worksiteIds), eq(workers.isActive, true))).groupBy(workers.worksiteId)
  return new Map(rows.map((row) => [row.worksiteId, row.count]))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run, de a uno:

```bash
npm run test:pglite -- lib/__tests__/miper-portfolio.test.ts
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
npm run test:pglite -- lib/__tests__/miper-import.test.ts
npm run test:pglite -- lib/__tests__/miper-dashboard.test.ts
```

Expected: PASS en las cuatro.
- `miper-import` usa `listMiperInbox` (líneas 332 y 356).
- `miper-dashboard` sigue vivo hasta la Task 7 y usa `listMipers` / `listMiperInbox`.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- lib/services/miper/queries.ts lib/services/miper/portfolio.ts lib/__tests__/miper-portfolio.test.ts lib/__tests__/miper-queries.test.ts tests/pglite-files.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/services/miper/queries.ts lib/services/miper/portfolio.ts lib/__tests__/miper-portfolio.test.ts lib/__tests__/miper-queries.test.ts tests/pglite-files.ts
git commit -m "feat(miper): servicio de la portada por faena y bandeja sin la ronda propia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: «Mi trabajo» no ofrece revisar ni firmar la ronda propia

**Por qué:**
- La rama de revisión MIPER de la cola «Mi trabajo»
  (`lib/services/operational-work-queue.ts:1352-1383`) lista toda MIPER `in_review` /
  `pending_approval` a quien tiene `prevention:risk:review` / `prevention:risk:approve_legal`.
- No mira quién envió la ronda. A quien la envió y además tiene el permiso le ofrece «Revisar» o
  «Firmar», y el servicio después lo rechaza: `assertNotSubmitter` en `lib/services/miper/workflow.ts`
  responde «Quien envió la MIPER no puede revisarla» o «Quien elaboró la MIPER no puede aprobarla».
- Es un defecto funcional. Esta fase fija la regla canónica: `miperInboxReason` (Task 3) y
  `workspace-mode.ts:42-45` excluyen al que envió. La cola se alinea con la misma regla.

**Files:**
- Modify: `lib/services/operational-work-queue.ts`:
  - el import de `@/db/schema` (líneas 13-52): suma `preventionRiskReviewRounds`;
  - el `WHERE` de la rama `miper_review` (líneas 1379-1381).
- Test: `lib/__tests__/miper-work-queue.test.ts`. Es una suite **PGlite** (instancia `PGlite` y lee el
  `db` global) y ya está registrada en `tests/pglite-files.ts:105`. No hay archivo nuevo que
  registrar.

**Interfaces:**
- Consumes: nada de código de otras tareas. Aplica la regla de `miperInboxReason` (Task 3) en SQL.
- Produces: la rama `miper_review` de `getOperationalWorkQueue` / `getOperationalWorkCount` excluye
  las MIPER cuya ronda abierta envió `session.user.id`.
- **Esquema verificado** (`db/schema/prevention/miper.ts:8-29`):
  - `prevention_risk_review_rounds` tiene `matrix_id`, `submitted_by_user_id` (not null) y
    `decision` (nulo mientras la ronda está abierta);
  - el índice único `prevention_risk_review_rounds_one_open_unique` admite una sola ronda abierta
    por MIPER (`WHERE decision IS NULL`);
  - la ronda de Legal y RRHH conserva el `submitted_by_user_id` de quien envió
    (`workflow.ts`, `approveMiperTechnicalReview`), así que la misma condición sirve para las dos
    etapas.

- [ ] **Step 1: Write the failing test**

En `lib/__tests__/miper-work-queue.test.ts`, al final del
`describe("cola «Mi trabajo» — ramas MIPER", …)` (después de «el filtro de módulo acepta «miper»»),
agregar:

```ts
  it("quien envió la ronda no la recibe para revisar ni firmar aunque tenga el permiso (como miperInboxReason)", async () => {
    // Una MIPER enviada por quien además revisa y firma: el servicio se la rechazaría (assertNotSubmitter).
    // Se siembra aquí, al final, para no cambiar lo que ven las pruebas anteriores.
    await testDb.insert(schema.users).values({ id: "u-dual", name: "Edita, revisa y firma", email: "dual@miper.cl", hashedPassword: "x", isActive: true })
    await testDb.insert(schema.preventionRiskMatrices).values({
      id: "mx-own", worksiteId: WS_IN, matrixVersion: 4, title: "MIPER 2028", period: 2028, status: "draft", reviewState: "in_review",
      methodologyId: "m-miper", methodologySnapshot: {}, revisionReason: "Elaboración inicial.",
      participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-dual",
    })
    await testDb.insert(schema.preventionRiskReviewRounds).values({
      id: "round-own", matrixId: "mx-own", roundNumber: 1, stage: "technical",
      snapshot: { header: {}, entries: [] }, snapshotSha256: "d".repeat(64), submittedByUserId: "u-dual",
    })

    const dual = makeSession("u-dual", ["prevention:risk:view", "prevention:risk:edit", "prevention:risk:review", "prevention:risk:approve_legal"])
    const own = await getOperationalWorkQueue(dual, { module: "miper" })
    expect(own.items.map((item) => item.sourceId).sort()).toEqual(["mx-legal", "mx-review"])
    // El contador del badge dice lo mismo que la cola.
    expect(await getOperationalWorkCount(dual)).toBe(own.items.length)

    // Quien no la envió sí la recibe.
    const review = await getOperationalWorkQueue(reviewer(), { module: "miper" })
    expect(review.items.map((item) => item.sourceId).sort()).toEqual(["mx-own", "mx-review"])
  })
```

`mx-review` y `mx-legal` no tienen rondas sembradas, así que siguen en la cola de todos. La
exclusión sólo actúa cuando hay una ronda abierta enviada por quien mira.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-work-queue.test.ts`
Expected: FAIL sólo en la prueba nueva. La cola de `u-dual` trae
`["mx-legal", "mx-own", "mx-review"]`: hoy la rama no mira quién envió.

- [ ] **Step 3: Write minimal implementation**

En `lib/services/operational-work-queue.ts`:

1. En el import de `@/db/schema`, después de `preventionRiskPrograms,` (línea 36), agregar
   `preventionRiskReviewRounds,`.

2. En la rama `miper_review`, reemplazar

   ```ts
         WHERE ${inScope(preventionRiskMatrices.worksiteId)}
           AND ${inArray(preventionRiskMatrices.reviewState, reviewStates)}
       `)
   ```

   por:

   ```ts
         WHERE ${inScope(preventionRiskMatrices.worksiteId)}
           AND ${inArray(preventionRiskMatrices.reviewState, reviewStates)}
           -- Quien envió la ronda abierta no la revisa ni la firma (assertNotSubmitter): la misma
           -- regla que miperInboxReason y workspace-mode.ts. Sin esto, la cola le ofrecía una acción
           -- que el servicio rechaza. La ronda de Legal y RRHH conserva a quien envió.
           AND NOT EXISTS (
             SELECT 1 FROM ${preventionRiskReviewRounds}
             WHERE ${preventionRiskReviewRounds.matrixId} = ${preventionRiskMatrices.id}
               AND ${preventionRiskReviewRounds.decision} IS NULL
               AND ${preventionRiskReviewRounds.submittedByUserId} = ${session.user.id}
           )
       `)
   ```

   El bloque `/* … */` de arriba (líneas 1355-1357) puede sumar la frase «Tampoco a quien envió la
   ronda abierta». El comentario SQL (`--`) va dentro de la plantilla, como los de la rama de
   ocurrencias (líneas 1339-1344).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:pglite -- lib/__tests__/miper-work-queue.test.ts`
Expected: PASS. Las pruebas anteriores del archivo no cambian: ninguna MIPER sembrada antes tiene
ronda.

- [ ] **Step 5: Puertas**

```bash
npm run typecheck
npm run lint -- lib/services/operational-work-queue.ts lib/__tests__/miper-work-queue.test.ts
npm run test:fast -- lib/__tests__/operational-work-queue-filters.test.ts lib/__tests__/work-queue-eligibility.test.ts
npm run test:pglite -- lib/__tests__/operational-work-queue-row-identity.test.ts
```

- `operational-work-queue-filters` y `work-queue-eligibility` son unitarias: mockean `@/db` o no lo
  tocan.
- `operational-work-queue-row-identity` es PGlite (`tests/pglite-files.ts:102`). Arma la unión de
  todas las ramas, así que confirma que el SQL nuevo compila junto a las demás.

- [ ] **Step 6: Commit**

```bash
git add lib/services/operational-work-queue.ts lib/__tests__/miper-work-queue.test.ts
git commit -m "fix(miper): «Mi trabajo» no ofrece revisar ni firmar la ronda que uno mismo envió" -m "Misma regla que miperInboxReason y workspace-mode.ts: el servicio ya lo rechazaba con assertNotSubmitter." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Primitivas de la portada: `SummaryBar.renderLink` y `NewMiperDialog` controlado

**Files:**
- Modify: `components/ui/summary-bar.tsx`, `components/ui/summary-bar-stat-cell.tsx`
- Test: `components/ui/summary-bar.test.tsx` (nuevo)
- Modify: `app/(app)/prevencion/miper/new-miper-dialog.tsx`
- Test: `app/(app)/prevencion/miper/new-miper-dialog.test.tsx` (nuevo)
- Modify: `app/(app)/prevencion/miper/miper-home.tsx:4,98,164,182,238`. Es sólo un puente: las dos
  llamadas a `NewMiperDialog` pasan a la firma nueva para que la rama compile hasta la Task 7, que
  reescribe el archivo.

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces, en `components/ui/summary-bar.tsx`:
  - `type SummaryLinkProps = { href: string; className: string; children: React.ReactNode; "data-pressable": "" }`
  - `SummaryBar` gana la prop opcional `renderLink?: (props: SummaryLinkProps) => React.ReactNode`.
    Sólo aplica al modo completo. Sin ella todo sigue igual (`next/link`, push), así que los 10
    consumidores actuales no cambian.
- Produces, en `new-miper-dialog.tsx`:
  - `NewMiperDialog({ open, onOpenChange, worksites, currentYear, initialWorksiteId }: { open: boolean; onOpenChange: (open: boolean) => void; worksites: CreationWorksite[]; currentYear: number; initialWorksiteId?: string | null })`.
    Es **controlado** y ya no trae su botón disparador: lo abre la portada (Task 7).
  - `CreationWorksite` no cambia (la importa también `import-dialog.tsx`).

- [ ] **Step 1: Write the failing tests**

Crear `components/ui/summary-bar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SummaryBar, type SummaryLinkProps } from "./summary-bar"

describe("SummaryBar", () => {
  it("con `renderLink`, cada cifra con `href` navega con el enlace que le pasan", () => {
    const renderLink = vi.fn(({ href, className, children, ...rest }: SummaryLinkProps) => (
      <a href={href} className={className} data-testid="propio" {...rest}>{children}</a>
    ))
    render(<SummaryBar renderLink={renderLink} stats={[
      { key: "a", label: "En revisión", value: 2, href: "/x?estado=en_revision" },
      { key: "b", label: "Sin enlace", value: 0 },
    ]} />)
    const link = screen.getByRole("link", { name: /^En revisión/ })
    expect(link).toHaveAttribute("href", "/x?estado=en_revision")
    expect(link).toHaveAttribute("data-testid", "propio")
    expect(link).toHaveAttribute("data-pressable")
    expect(renderLink).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("link", { name: /^Sin enlace/ })).toBeNull()
    expect(screen.getByText("Sin enlace")).toBeInTheDocument()
  })

  it("sin `renderLink` sigue usando el enlace de Next", () => {
    render(<SummaryBar stats={[{ key: "a", label: "Vencidas", value: 3, href: "/y" }]} />)
    expect(screen.getByRole("link", { name: /^Vencidas/ })).toHaveAttribute("href", "/y")
  })
})
```

Crear `app/(app)/prevencion/miper/new-miper-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
const createMiperAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "MIPER creada", data: { id: "m-new" } })))
vi.mock("./actions", () => ({ createMiperAction }))

import { NewMiperDialog, type CreationWorksite } from "./new-miper-dialog"

const worksites: CreationWorksite[] = [
  { id: "ws-a", name: "Faena A", vigenteId: null, vigentePeriod: null, vigenteIsLegacy: false, vigenteHasUnsentChanges: false },
  { id: "ws-b", name: "Faena B", vigenteId: "m-b", vigentePeriod: 2025, vigenteIsLegacy: false, vigenteHasUnsentChanges: false },
]

afterEach(() => { vi.clearAllMocks() })

describe("NewMiperDialog (controlado)", () => {
  it("abre con la faena de la fila ya elegida y crea el borrador de ESA faena", async () => {
    const onOpenChange = vi.fn()
    render(<NewMiperDialog open onOpenChange={onOpenChange} worksites={worksites} currentYear={2026} initialWorksiteId="ws-b" />)
    expect(screen.getByRole("combobox")).toHaveTextContent("Faena B")
    // La faena B tiene vigente: se propone copiarla.
    expect(screen.getByRole("radio", { name: "Copiar la MIPER vigente (2025)" })).toBeChecked()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: "Renovación anual del período." } })
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }))
    await waitFor(() => expect(createMiperAction).toHaveBeenCalledWith({ worksiteId: "ws-b", period: 2026, revisionReason: "Renovación anual del período.", sourceMatrixId: "m-b" }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m-new?ficha=1"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("sin faena inicial, o con una que no está en la lista, parte de la primera", () => {
    render(<NewMiperDialog open onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} initialWorksiteId="ws-otra" />)
    expect(screen.getByRole("combobox")).toHaveTextContent("Faena A")
  })

  it("cerrado no monta el formulario: cada apertura parte de la faena que le pasan", () => {
    const { rerender } = render(<NewMiperDialog open={false} onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} initialWorksiteId="ws-b" />)
    expect(screen.queryByRole("dialog")).toBeNull()
    rerender(<NewMiperDialog open onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} initialWorksiteId="ws-a" />)
    expect(screen.getByRole("dialog", { name: "Nueva MIPER" })).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveTextContent("Faena A")
  })

  it("ya no trae su propio botón «Nueva MIPER»: lo pone quien lo abre", () => {
    render(<NewMiperDialog open={false} onOpenChange={vi.fn()} worksites={worksites} currentYear={2026} />)
    expect(screen.queryByRole("button", { name: "Nueva MIPER" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- components/ui/summary-bar.test.tsx "app/(app)/prevencion/miper/new-miper-dialog.test.tsx"`
Expected: FAIL.
- `summary-bar`: el enlace no tiene `data-testid="propio"`, porque `renderLink` se ignora.
- `new-miper-dialog`: los diálogos no se abren con `open` (el componente maneja su propio estado) y
  el botón «Nueva MIPER» todavía existe.

- [ ] **Step 3: `SummaryBar` con `renderLink`**

En `components/ui/summary-bar.tsx`, después de la interfaz `SummaryStat` (línea 21), agregar:

```ts
/** Lo que recibe `renderLink`: el enlace de una cifra ya armado (clase, contenido y `data-pressable`). */
export type SummaryLinkProps = { href: string; className: string; children: React.ReactNode; "data-pressable": "" }
```

En `SummaryBarProps`, después de `compact?: boolean`, agregar:

```ts
  /**
   * Cómo navega una cifra con `href` (sólo modo completo). Por defecto,
   * `next/link` (push). La portada MIPER lo usa para filtrar con `replace` y sin
   * mover el scroll (AGENTS, «Navigation and scroll preservation»), y el
   * espacio de trabajo, para navegar con el historial nativo (`WorkspaceLink`)
   * sin ida al servidor.
   */
  renderLink?: (props: SummaryLinkProps) => React.ReactNode
```

En `SummaryBarInner`:
- cambiar `({ stats, className, compact = false }: SummaryBarProps)` por
  `({ stats, className, compact = false, renderLink }: SummaryBarProps)`;
- cambiar `<SummaryBarStatCell key={stat.key} stat={stat} />` por
  `<SummaryBarStatCell key={stat.key} stat={stat} renderLink={renderLink} />`.

En `components/ui/summary-bar-stat-cell.tsx`:
- reemplazar `import type { SummaryStat } from "./summary-bar"` por
  `import type { SummaryLinkProps, SummaryStat } from "./summary-bar"`;
- cambiar la firma a
  `export function SummaryBarStatCell({ stat, renderLink }: { stat: SummaryStat; renderLink?: (props: SummaryLinkProps) => React.ReactNode }) {`;
- reemplazar el final (líneas 39-42):

  ```tsx
    const cellClass = "group flex-1 min-w-[8.5rem] border-l border-t border-[var(--color-border)]"
    return stat.href
      ? <Link href={stat.href} data-pressable className={cn(cellClass, "block hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]")}>{body}</Link>
      : <div className={cellClass}>{body}</div>
  ```

  por:

  ```tsx
    const cellClass = "group flex-1 min-w-[8.5rem] border-l border-t border-[var(--color-border)]"
    if (!stat.href) return <div className={cellClass}>{body}</div>
    const linkClass = cn(cellClass, "block hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]")
    if (renderLink) return <>{renderLink({ href: stat.href, className: linkClass, children: body, "data-pressable": "" })}</>
    return <Link href={stat.href} data-pressable className={linkClass}>{body}</Link>
  ```

- [ ] **Step 4: `NewMiperDialog` controlado y con faena inicial**

Reemplazar `app/(app)/prevencion/miper/new-miper-dialog.tsx` completo por:

```tsx
"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { createMiperAction } from "./actions"

export type CreationWorksite = { id: string; name: string; vigenteId: string | null; vigentePeriod: number | null; vigenteIsLegacy: boolean; vigenteHasUnsentChanges: boolean }

/**
 * Alta de una MIPER borrador. Es **controlado**: el estado vive en la portada,
 * que lo abre desde la cabecera («Nueva MIPER») o desde la fila de una faena
 * sin MIPER («Crear MIPER», con `initialWorksiteId`). El punto de partida se
 * elige explícitamente: copiar la MIPER vigente (sólo si no es de la
 * metodología anterior, que no se puede trasladar) o partir de una matriz
 * vacía. Una MIPER por faena y período: lo exige el servicio.
 */
export function NewMiperDialog({ open, onOpenChange, worksites, currentYear, initialWorksiteId = null }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  worksites: CreationWorksite[]
  currentYear: number
  /** La faena ya elegida. Si no está en `worksites` (fuera de alcance o inactiva), se parte de la primera. */
  initialWorksiteId?: string | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Radix desmonta el contenido al cerrar: cada apertura parte de cero, con la faena que le pasan. */}
        <NewMiperForm worksites={worksites} currentYear={currentYear} initialWorksiteId={initialWorksiteId} onCreated={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function NewMiperForm({ worksites, currentYear, initialWorksiteId, onCreated }: {
  worksites: CreationWorksite[]
  currentYear: number
  initialWorksiteId: string | null
  onCreated: () => void
}) {
  const router = useRouter()
  const [worksiteId, setWorksiteId] = useState(() =>
    initialWorksiteId && worksites.some((item) => item.id === initialWorksiteId) ? initialWorksiteId : worksites[0]?.id ?? "")
  const [source, setSource] = useState<"vigente" | "vacia">("vigente")
  const operation = useOperation()
  const worksite = worksites.find((item) => item.id === worksiteId)
  const canCopy = Boolean(worksite?.vigenteId && !worksite.vigenteIsLegacy)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createMiperAction({
      worksiteId,
      period: Number(form.get("period")),
      revisionReason: String(form.get("revisionReason") ?? ""),
      sourceMatrixId: canCopy && source === "vigente" ? worksite!.vigenteId : null,
    }), (result) => {
      onCreated()
      const id = result.data?.id
      if (typeof id === "string") router.push(`/prevencion/miper/${id}?ficha=1`)
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Nueva MIPER</DialogTitle>
        <DialogDescription>Una MIPER por faena y período. Los antecedentes se completan con los datos de la faena y la empresa.</DialogDescription>
      </DialogHeader>
      <Field label="Faena" required>
        <Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setSource("vigente") }}>
          <SelectTrigger><SelectValue placeholder="Selecciona la faena" /></SelectTrigger>
          <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Período" required><Input name="period" type="number" min={2000} max={2100} defaultValue={currentYear} required /></Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Punto de partida</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="source" checked={canCopy && source === "vigente"} disabled={!canCopy} onChange={() => setSource("vigente")} />
          {canCopy ? `Copiar la MIPER vigente (${worksite!.vigentePeriod ?? "sin período"})` : worksite?.vigenteIsLegacy ? "La MIPER vigente usa la metodología anterior y no se puede copiar" : "La faena no tiene MIPER vigente"}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="source" checked={!canCopy || source === "vacia"} onChange={() => setSource("vacia")} />
          Matriz vacía
        </label>
      </fieldset>
      <Field label="Motivo" required helper="Por ejemplo: elaboración inicial, renovación anual, cambio de proceso.">
        <Textarea name="revisionReason" required minLength={10} />
      </Field>
      {canCopy && source === "vigente" && worksite?.vigenteHasUnsentChanges && (
        <p role="status" className="rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
          La MIPER vigente tiene cambios sin enviar a revisión. Al sellarse el período {currentYear} deja de ser el documento
          vigente y esos cambios no quedarán en ninguna versión: si los necesitas, envíalos a revisión o corrígelos en la
          vigente antes de crear el período nuevo.
        </p>
      )}
      {operation.message && <p role="status" className="text-sm text-[var(--color-danger-ink)]">{operation.message}</p>}
      <DialogFooter><Button type="submit" disabled={operation.pending || !worksiteId}>Crear borrador</Button></DialogFooter>
    </form>
  )
}
```

Mientras la Task 7 no reescriba `miper-home.tsx`, éste sigue usando la firma vieja (`<NewMiperDialog
worksites=… currentYear=… />`, líneas 164 y 182) y `typecheck` falla. Por eso este paso **también**
toca las dos llamadas de la portada actual, para que la rama compile entre tareas.

En `app/(app)/prevencion/miper/miper-home.tsx`:
1. Agregar `useState` al import de React: `import { useCallback, useState } from "react"`.
2. Al principio de `MiperHome`, después de `const searchParams = useSearchParams()`, agregar:
   `const [creating, setCreating] = useState(false)`.
3. Reemplazar las dos apariciones de
   `<NewMiperDialog worksites={creationWorksites} currentYear={currentYear} />` por
   `<Button onClick={() => setCreating(true)} disabled={creationWorksites.length === 0}>Nueva MIPER</Button>`.
4. Antes del `</PageContainer>` final, agregar:
   `<NewMiperDialog open={creating} onOpenChange={setCreating} worksites={creationWorksites} currentYear={currentYear} />`.

La Task 7 reemplaza este archivo entero.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:fast -- components/ui/summary-bar.test.tsx "app/(app)/prevencion/miper/new-miper-dialog.test.tsx"`
Expected: PASS.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- components/ui/summary-bar.tsx components/ui/summary-bar-stat-cell.tsx components/ui/summary-bar.test.tsx "app/(app)/prevencion/miper/new-miper-dialog.tsx" "app/(app)/prevencion/miper/new-miper-dialog.test.tsx" "app/(app)/prevencion/miper/miper-home.tsx"
npm run test:fast -- components "app/(app)/dashboard" "app/(app)/flota" "app/(app)/bodega" "app/(app)/prevencion/ppa"
```

La última línea corre las pruebas de los demás consumidores de `SummaryBar`, que no cambian.

- [ ] **Step 7: Commit**

```bash
git add components/ui/summary-bar.tsx components/ui/summary-bar-stat-cell.tsx components/ui/summary-bar.test.tsx "app/(app)/prevencion/miper/new-miper-dialog.tsx" "app/(app)/prevencion/miper/new-miper-dialog.test.tsx" "app/(app)/prevencion/miper/miper-home.tsx"
git commit -m "feat(ui): SummaryBar navega con el enlace que le pasen; NewMiperDialog controlado con faena inicial" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Portada por faena, retiro del tablero viejo y enlaces compatibles

**Files:**
- Modify (reescrito): `app/(app)/prevencion/miper/miper-home.tsx`
- Modify: `app/(app)/prevencion/miper/page.tsx`
- Test: `app/(app)/prevencion/miper/miper-home.test.tsx` (nuevo)
- Modify: `app/(app)/dashboard/sections/prevention-section.tsx:106` (y un import)
- Delete:
  - `app/(app)/prevencion/miper/dashboard-panel.tsx`
  - `lib/services/miper/dashboard.ts`
  - `lib/__tests__/miper-dashboard.test.ts`
- Modify: `tests/pglite-files.ts:32-33` (sale el registro de `miper-dashboard`)

**Interfaces:**
- Consumes:
  - de la Task 3: `parsePortfolioParams`, `filterPortfolioRows`, `hasPortfolioFilters`, `portfolioHref`,
    `portfolioSummary`, `PORTFOLIO_SUMMARY_HREF`, `PORTFOLIO_STATUS_FILTER_OPTIONS`,
    `PORTFOLIO_STATUS_LABEL` y los tipos `MiperPortfolioRow`, `MiperPortfolioAction`,
    `MiperPortfolioMatrix`, `MiperPortfolioStatus`;
  - `listMiperPortfolio` (Task 4);
  - `SummaryBar` con `renderLink` y `SummaryLinkProps`, y `NewMiperDialog` controlado (Task 6);
  - `listMiperCreationOptions` (existente).
- Produces:
  - `MiperHome({ rows, creationWorksites, currentYear, permissions }: { rows: MiperPortfolioRow[]; creationWorksites: CreationWorksite[]; currentYear: number; permissions: { canEdit: boolean; canManageCatalog: boolean } })`.
  - **Contrato de E2E (Task 10):**
    - tabla con nombre accesible «MIPER por faena»;
    - cada `<tr>` con `data-worksite-id`;
    - tarjeta móvil `<article aria-label="<faena>">`;
    - botón «Crear MIPER de <faena>»;
    - enlaces de acción «<motivo> · MIPER <período>»;
    - texto «N crítico(s) sin control»;
    - chips «Faena» y «Riesgos críticos» (botones «Eliminar filtro Faena» / «Eliminar filtro Riesgos
      críticos»);
    - segmento con los botones «Todas las faenas» y «Requieren mi acción» (sin cifra: la cifra está
      sólo en la franja, A5);
    - filtro con el combobox «Estado».
  - El KPI del tablero lleva a `PORTFOLIO_SUMMARY_HREF.critical` (`/prevencion/miper?sincontrol=1`).

- [ ] **Step 1: Write the failing test**

Crear `app/(app)/prevencion/miper/miper-home.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { ReactNode } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import type { MiperPortfolioRow } from "@/lib/prevention/miper/portfolio"

const nav = vi.hoisted(() => ({ query: "" }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper", useSearchParams: () => new URLSearchParams(nav.query) }))
// El enlace de Next como `<a>`, dejando ver `replace` y `scroll` para afirmar cómo filtran las cifras.
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, replace, scroll, ...rest }: Record<string, unknown>) => (
    <a href={String(href)} data-replace={replace ? "true" : undefined} data-scroll={scroll === false ? "false" : undefined} {...rest}>{children as ReactNode}</a>
  ),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("./actions", () => ({ createMiperAction: vi.fn(), previewRiskImportAction: vi.fn(), commitRiskImportAction: vi.fn(), saveRiskFactorAction: vi.fn() }))

import { MiperHome } from "./miper-home"

const progress = { done: 1, late: 0, pending: 1, overdue: 0, failed: 0, planned: 2, ratio: 0.5 }
function row(overrides: Partial<MiperPortfolioRow>): MiperPortfolioRow {
  return {
    id: "ws-a", worksiteId: "ws-a", worksiteName: "Faena A", worksiteActive: true,
    matrix: { id: "m-a", period: 2026, versionNumber: 1, label: "Vigente · v1", isLegacy: false }, vigente: null,
    status: "vigente", stateLabel: "Vigente · v1", headcount: 12, headcountSource: "ficha", updatedAt: "2026-09-30T12:00:00.000Z",
    completeness: { complete: 3, total: 4 }, importantCount: 1, intolerableCount: 1, criticalWithoutControl: 1,
    requiresMyAction: false, myActions: [], submittedByName: null, programProgress: progress,
    ...overrides,
  }
}
const ROWS = [
  row({}),
  row({
    id: "ws-b", worksiteId: "ws-b", worksiteName: "Faena B", status: "en_revision", stateLabel: "En revisión por Prevención",
    matrix: { id: "m-b", period: 2026, versionNumber: null, label: "En revisión por Prevención", isLegacy: false },
    criticalWithoutControl: 0, requiresMyAction: true, myActions: [{ matrixId: "m-b", period: 2026, reason: "Pendiente de tu revisión" }], submittedByName: "Ana",
  }),
  row({
    id: "ws-c", worksiteId: "ws-c", worksiteName: "Faena C", matrix: null, status: "sin_miper", stateLabel: "Sin MIPER", headcount: 3,
    headcountSource: "trabajadores", updatedAt: null, completeness: null, importantCount: 0, intolerableCount: 0, criticalWithoutControl: 0, programProgress: null,
  }),
]
const CREATION = [{ id: "ws-c", name: "Faena C", vigenteId: null, vigentePeriod: null, vigenteIsLegacy: false, vigenteHasUnsentChanges: false }]

function show(query = "", rows: MiperPortfolioRow[] = ROWS, canEdit = true) {
  nav.query = query
  return render(
    <ShellHeaderProvider>
      <MiperHome rows={rows} creationWorksites={canEdit ? CREATION : []} currentYear={2026} permissions={{ canEdit, canManageCatalog: false }} />
    </ShellHeaderProvider>,
  )
}
const tabla = () => within(screen.getByRole("table", { name: "MIPER por faena" }))

afterEach(() => {
  nav.query = ""
  vi.clearAllMocks()
})

describe("MiperHome — franja (A1: cada cifra lleva exactamente a su subconjunto)", () => {
  it("cuatro cifras sobre todas las faenas, con su destino, sin arrastrar filtros, con replace y sin scroll", () => {
    show("estado=vigente")
    const conMiper = screen.getByRole("link", { name: /^Faenas con MIPER/ })
    expect(conMiper).toHaveAttribute("href", "/prevencion/miper?estado=con_miper")
    expect(conMiper).toHaveTextContent("2/3")
    expect(screen.getByRole("link", { name: /^En revisión/ })).toHaveAttribute("href", "/prevencion/miper?estado=en_revision")
    expect(screen.getByRole("link", { name: /^Requieren mi acción/ })).toHaveAttribute("href", "/prevencion/miper?vista=mias")
    const sinControl = screen.getByRole("link", { name: /^Riesgos críticos sin control/ })
    expect(sinControl).toHaveAttribute("href", "/prevencion/miper?sincontrol=1")
    expect(sinControl).toHaveTextContent("1")
    expect(sinControl).toHaveAttribute("data-replace", "true")
    expect(sinControl).toHaveAttribute("data-scroll", "false")
  })
})

describe("MiperHome — vista, estado y enlaces viejos", () => {
  it("el segmento «Requieren mi acción» no repite la cifra de la franja (A5) y filtra con replace y sin scroll", () => {
    show("")
    // La cifra vive sólo en la franja: ningún botón lleva «(n)».
    expect(screen.queryByRole("button", { name: /^Requieren mi acción \(/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Requieren mi acción" }))
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper?vista=mias", { scroll: false })
  })

  it("?tab=porhacer (la bandeja de antes) abre «Requieren mi acción»; cambiar de vista borra el `tab` heredado", () => {
    show("tab=porhacer")
    expect(screen.getByRole("button", { name: "Requieren mi acción" })).toHaveAttribute("aria-pressed", "true")
    expect(tabla().getByText("Faena B")).toBeInTheDocument()
    expect(tabla().queryByText("Faena A")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Todas las faenas" }))
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper", { scroll: false })
  })

  it("?tab=todas y ?tab=resumen caen en «Todas las faenas»", () => {
    show("tab=resumen")
    expect(screen.getByRole("button", { name: "Todas las faenas" })).toHaveAttribute("aria-pressed", "true")
    expect(tabla().getByText("Faena A")).toBeInTheDocument()
  })

  it("el filtro de estado incluye «Sin MIPER»", () => {
    show("estado=sin_miper")
    expect(screen.getByRole("combobox", { name: "Estado" })).toBeInTheDocument()
    expect(tabla().getByText("Faena C")).toBeInTheDocument()
    expect(tabla().queryByText("Faena A")).toBeNull()
  })

  it("?faena= (enlace del PDTP) acota a esa faena y lo dice en un chip que se puede quitar", () => {
    show("faena=ws-b")
    expect(tabla().queryByText("Faena A")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Faena" }))
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper", { scroll: false })
  })

  it("?sincontrol=1 deja sólo las faenas con riesgos críticos sin control", () => {
    show("sincontrol=1")
    expect(tabla().getByText("1 crítico sin control")).toBeInTheDocument()
    expect(tabla().queryByText("Faena B")).toBeNull()
    expect(screen.getByRole("button", { name: "Eliminar filtro Riesgos críticos" })).toBeInTheDocument()
  })

  it("ya no hay pestañas ni filtro «Responsable»", () => {
    show("")
    expect(screen.queryByRole("tab")).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Responsable" })).toBeNull()
  })

  it("«Requieren mi acción» vacía lo dice y ofrece ver todas las faenas (A4)", () => {
    show("vista=mias", [ROWS[0]!])
    expect(screen.getAllByText("No tienes MIPER pendientes").length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole("button", { name: "Ver todas las faenas" })[0]!)
    expect(router.replace).toHaveBeenCalledWith("/prevencion/miper", { scroll: false })
  })
})

describe("MiperHome — filas", () => {
  it("cada acción pendiente enlaza a ESA MIPER y la vigente va aparte", () => {
    show("", [row({
      vigente: { id: "m-v", period: 2025, versionNumber: 3, label: "Vigente · v3", isLegacy: false },
      requiresMyAction: true, myActions: [{ matrixId: "m-v", period: 2025, reason: "Con observaciones" }],
    })])
    expect(tabla().getByRole("link", { name: "Con observaciones · MIPER 2025" })).toHaveAttribute("href", "/prevencion/miper/m-v")
    expect(tabla().getByRole("link", { name: "Vigente v3 (2025)" })).toHaveAttribute("href", "/prevencion/miper/m-v")
    expect(tabla().getByRole("link", { name: "Faena A" })).toHaveAttribute("href", "/prevencion/miper/m-a")
    expect(tabla().getByText("1 crítico sin control en la vigente")).toBeInTheDocument()
  })

  it("muestra la completitud con su barra, y la metodología anterior sin cifra", () => {
    show("", [row({}), row({ id: "ws-d", worksiteId: "ws-d", worksiteName: "Faena D", completeness: null, matrix: { id: "m-d", period: null, versionNumber: null, label: "Vigente · metodología anterior", isLegacy: true } })])
    expect(tabla().getByRole("progressbar", { name: "Faena A: 3 de 4 completos" })).toBeInTheDocument()
    expect(tabla().getByText("Metodología anterior")).toBeInTheDocument()
  })

  it("la faena sin MIPER ofrece «Crear MIPER», que abre el diálogo con esa faena ya elegida", () => {
    show("")
    fireEvent.click(tabla().getByRole("button", { name: "Crear MIPER de Faena C" }))
    const dialog = screen.getByRole("dialog", { name: "Nueva MIPER" })
    expect(within(dialog).getByRole("combobox")).toHaveTextContent("Faena C")
  })

  it("sin permiso de edición no hay «Crear MIPER» ni «Nueva MIPER»", () => {
    show("", ROWS, false)
    expect(screen.queryByRole("button", { name: /^Crear MIPER/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Nueva MIPER" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/miper-home.test.tsx"`
Expected: FAIL. La portada vieja recibe `inbox`, `all` y `dashboard`, que no existen, y no pinta la
tabla «MIPER por faena» ni la franja.

- [ ] **Step 3: Reescribir la portada**

Reemplazar `app/(app)/prevencion/miper/miper-home.tsx` completo por:

```tsx
"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect } from "@/components/ui/option-select"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Progress } from "@/components/ui/progress"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { SummaryBar, type SummaryLinkProps } from "@/components/ui/summary-bar"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  filterPortfolioRows, hasPortfolioFilters, parsePortfolioParams, PORTFOLIO_STATUS_FILTER_OPTIONS, PORTFOLIO_STATUS_LABEL,
  PORTFOLIO_SUMMARY_HREF, portfolioHref, portfolioSummary,
  type MiperPortfolioAction, type MiperPortfolioMatrix, type MiperPortfolioRow, type MiperPortfolioStatus,
} from "@/lib/prevention/miper/portfolio"
import { countOf, formatDate } from "@/lib/utils"
import { ImportMiperDialog } from "./import-dialog"
import { NewMiperDialog, type CreationWorksite } from "./new-miper-dialog"

/** Estado de la faena → badge (A6: nunca el valor crudo; `MetaBadge`, no un mapa local de variantes). */
const STATUS_META: Record<MiperPortfolioStatus, StateMetaInput> = {
  sin_miper: { label: PORTFOLIO_STATUS_LABEL.sin_miper, variant: "neutral" },
  borrador: { label: PORTFOLIO_STATUS_LABEL.borrador, variant: "outline" },
  en_revision: { label: PORTFOLIO_STATUS_LABEL.en_revision, variant: "info" },
  observada: { label: PORTFOLIO_STATUS_LABEL.observada, variant: "warning" },
  vigente: { label: PORTFOLIO_STATUS_LABEL.vigente, variant: "success" },
}

const COLUMNS = [
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "status", label: "Estado" },
  { key: "headcount", label: "Dotación", numeric: true, sortable: true },
  { key: "completeness", label: "Completitud" },
  { key: "graves", label: "Importantes e Intolerables", numeric: true },
  { key: "programProgress", label: "Programa" },
  { key: "updatedAt", label: "Actualizada", sortable: true },
]

/** Las cifras FILTRAN esta misma lista: `replace` y sin mover el scroll (AGENTS, «Navigation and scroll preservation»). */
function ReplaceLink({ href, className, children, ...rest }: SummaryLinkProps) {
  return <Link href={href} replace scroll={false} className={className} {...rest}>{children}</Link>
}

const matrixHref = (matrixId: string) => `/prevencion/miper/${matrixId}`
const periodLabel = (period: number | null) => (period === null ? "sin período" : String(period))
const actionLabel = (action: MiperPortfolioAction) => `${action.reason} · MIPER ${periodLabel(action.period)}`

function vigenteLabel(matrix: MiperPortfolioMatrix) {
  if (matrix.isLegacy) return `Vigente · metodología anterior (${periodLabel(matrix.period)})`
  return `Vigente ${matrix.versionNumber ? `v${matrix.versionNumber} ` : ""}(${periodLabel(matrix.period)})`
}

function programLabel(row: MiperPortfolioRow) {
  const progress = row.programProgress
  if (!progress || progress.planned === 0) return "Sin ocurrencias"
  return `${Math.round((progress.ratio ?? 0) * 100)}% · ${progress.done}/${progress.planned}`
}

/** Faena, su MIPER, la vigente si es otra y lo que cada MIPER espera de ti (un enlace por acción). */
function Worksite({ row }: { row: MiperPortfolioRow }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="font-medium">
        {row.matrix ? <Link href={matrixHref(row.matrix.id)} className="hover:underline">{row.worksiteName}</Link> : row.worksiteName}
        {!row.worksiteActive && <span className="ml-2 text-xs font-normal text-[var(--color-text-subtle)]">Faena cerrada</span>}
      </p>
      {row.matrix && (
        <p className="text-xs text-[var(--color-text-subtle)]">MIPER {periodLabel(row.matrix.period)}{row.matrix.versionNumber ? ` · v${row.matrix.versionNumber}` : ""}</p>
      )}
      {row.vigente && (
        <p className="text-xs"><Link href={matrixHref(row.vigente.id)} className="text-[var(--color-text-muted)] hover:underline">{vigenteLabel(row.vigente)}</Link></p>
      )}
      {row.myActions.map((action) => (
        <p key={action.matrixId} className="text-xs font-semibold">
          <Link href={matrixHref(action.matrixId)} className="text-[var(--color-signal-ink)] hover:underline">{actionLabel(action)}</Link>
        </p>
      ))}
    </div>
  )
}

function State({ row, onCreate }: { row: MiperPortfolioRow; onCreate: (() => void) | null }) {
  const meta = metaFor(STATUS_META, row.status)
  const detail = [row.matrix && row.stateLabel !== meta.label ? row.stateLabel : null, row.submittedByName ? `enviada por ${row.submittedByName}` : null].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-col items-start gap-1">
      <MetaBadge meta={meta} />
      {detail && <p className="text-xs text-[var(--color-text-subtle)]">{detail}</p>}
      {/* El nombre empieza con el texto visible y nombra la faena (WCAG 2.5.3): cada fila tiene el suyo. */}
      {onCreate && <Button size="sm" variant="secondary" onClick={onCreate} aria-label={`Crear MIPER de ${row.worksiteName}`}>Crear MIPER</Button>}
    </div>
  )
}

function Headcount({ row }: { row: MiperPortfolioRow }) {
  return (
    <span className="block">
      <span className="tabular-nums">{row.headcount}</span>
      <span className="block text-xs text-[var(--color-text-subtle)]">{row.headcountSource === "ficha" ? "según la ficha" : "trabajadores activos"}</span>
    </span>
  )
}

function Completeness({ row }: { row: MiperPortfolioRow }) {
  if (row.matrix?.isLegacy) return <span className="text-xs text-[var(--color-text-subtle)]">Metodología anterior</span>
  if (!row.completeness) return <span className="text-xs text-[var(--color-text-subtle)]">—</span>
  const { complete, total } = row.completeness
  if (total === 0) return <span className="text-xs text-[var(--color-text-subtle)]">Sin riesgos</span>
  return (
    <span className="flex min-w-32 items-center gap-2">
      <Progress value={complete} max={total} size="sm" label={`${row.worksiteName}: ${complete} de ${total} completos`} className="flex-1" />
      <span className="text-xs tabular-nums">{complete}/{total}</span>
    </span>
  )
}

function Graves({ row }: { row: MiperPortfolioRow }) {
  return (
    <span className="block">
      <span className="tabular-nums">{row.importantCount + row.intolerableCount}</span>
      {row.criticalWithoutControl > 0 && (
        <span className="block text-xs font-medium text-[var(--color-danger-ink)]">
          {countOf(row.criticalWithoutControl, "crítico sin control", "críticos sin control")}{row.vigente ? " en la vigente" : ""}
        </span>
      )}
    </span>
  )
}

/**
 * Portada del RE-04 por faena (spec §7, Fase B): una fila por faena en alcance
 * —con o sin MIPER—, la franja de cuatro cifras (A1), «Todas las faenas» /
 * «Requieren mi acción» y el filtro de estado. La búsqueda la da el TopBar
 * (D8), que alimenta a `DataTable`. Los filtros viven en la URL y se aplican
 * aquí sobre las faenas que el servicio ya acotó al alcance.
 */
export function MiperHome({ rows, creationWorksites, currentYear, permissions }: {
  rows: MiperPortfolioRow[]
  creationWorksites: CreationWorksite[]
  currentYear: number
  permissions: { canEdit: boolean; canManageCatalog: boolean }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = parsePortfolioParams(searchParams)
  const visible = filterPortfolioRows(rows, params)
  const summary = portfolioSummary(rows)
  const filtered = hasPortfolioFilters(params)
  // El alta vive aquí: la abren la cabecera («Nueva MIPER») y la fila de una faena sin MIPER («Crear MIPER»).
  const [creating, setCreating] = useState<{ worksiteId: string | null } | null>(null)
  const creatable = new Set(creationWorksites.map((worksite) => worksite.id))
  const createFor = (row: MiperPortfolioRow) =>
    permissions.canEdit && !row.matrix && creatable.has(row.worksiteId) ? () => setCreating({ worksiteId: row.worksiteId }) : null

  /** Filtrar es estado de la vista: `replace` y sin scroll. `portfolioHref` borra además el `tab` heredado. */
  const update = (patch: Record<string, string | null>) => router.replace(portfolioHref(searchParams, patch, pathname), { scroll: false })
  const clearAll = () => update({ vista: null, estado: null, sincontrol: null, faena: null })

  // Chips sólo para los filtros que no tienen control a la vista (A2): la faena que llega del PDTP y «sin control».
  const chips: ActiveFilterChip[] = []
  if (params.faena) chips.push({ key: "faena", label: "Faena", value: params.faena, displayValue: rows.find((row) => row.worksiteId === params.faena)?.worksiteName ?? "no disponible" })
  if (params.sinControl) chips.push({ key: "sincontrol", label: "Riesgos críticos", value: "1", displayValue: "sin control" })

  const withoutMiper = summary.total - summary.withMiper
  const empty = params.vista === "mias" && params.estado === null && chips.length === 0
    ? { title: "No tienes MIPER pendientes", description: "Cuando una MIPER espere tu revisión, tu firma o tu respuesta, aparecerá aquí." }
    : filtered
      ? { title: "Ninguna faena coincide con los filtros", description: "Quita algún filtro para ver las demás faenas." }
      : rows.length === 0
        ? { title: "No hay faenas a tu alcance", description: "Pide a Administración que te asigne una faena para ver o crear su MIPER." }
        : { title: "Ninguna faena coincide con la búsqueda", description: "Prueba con otro nombre de faena o de estado." }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Matriz IPER (MIPER)"
        description="Identificación de peligros y evaluación de riesgos por faena y período, con revisión técnica y aprobación Legal y RRHH."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />}
        actions={<div className="flex gap-2">
          {permissions.canManageCatalog && <Button asChild variant="secondary"><Link href="/prevencion/miper/factores">Factores de riesgo</Link></Button>}
          {permissions.canEdit && <ImportMiperDialog worksites={creationWorksites} currentYear={currentYear} canManageCatalog={permissions.canManageCatalog} />}
          {permissions.canEdit && (
            <Button onClick={() => setCreating({ worksiteId: null })} disabled={creationWorksites.length === 0}
              title={creationWorksites.length === 0 ? "No hay faenas activas a tu alcance" : undefined}>
              Nueva MIPER
            </Button>
          )}
        </div>}
      />
      <div className="space-y-4">
        <SummaryBar renderLink={ReplaceLink} stats={[
          {
            key: "con-miper", label: "Faenas con MIPER", value: `${summary.withMiper}/${summary.total}`, href: PORTFOLIO_SUMMARY_HREF.withMiper,
            secondary: withoutMiper > 0 ? `${countOf(withoutMiper, "faena")} sin MIPER` : "Todas tienen MIPER",
          },
          { key: "en-revision", label: "En revisión", value: summary.inReview, secondary: "Técnica o de Legal y RRHH", href: PORTFOLIO_SUMMARY_HREF.inReview },
          { key: "mias", label: "Requieren mi acción", value: summary.mine, tone: "signal", secondary: "Tu revisión, tu firma o tu respuesta", href: PORTFOLIO_SUMMARY_HREF.mine },
          {
            key: "sin-control", label: "Riesgos críticos sin control", value: summary.critical, tone: "signal", href: PORTFOLIO_SUMMARY_HREF.critical,
            secondary: "Intolerables vigentes sin control verificado o sin PDTP",
          },
        ]} />
        <FilterToolbar className="mb-0" activeChips={chips} onRemoveChip={(key) => update({ [key]: null })} onClearAll={clearAll} hasActiveFilters={filtered}>
          {/* A5: la cifra «Requieren mi acción» vive sólo en la franja; el segmento cambia la vista sin repetirla. */}
          <SegmentedControl ariaLabel="Qué faenas ver" variant="segmented" items={[
            { key: "todas", label: "Todas las faenas", active: params.vista === "todas", onClick: () => update({ vista: null }) },
            { key: "mias", label: "Requieren mi acción", active: params.vista === "mias", onClick: () => update({ vista: "mias" }) },
          ]} />
          <OptionSelect aria-label="Estado" emptyLabel="Todos los estados" className="w-56" value={params.estado ?? ""}
            options={PORTFOLIO_STATUS_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onValueChange={(value) => update({ estado: value || null })} />
        </FilterToolbar>
        <DataTable
          caption="MIPER por faena"
          columns={COLUMNS}
          rows={visible}
          searchKeys={["worksiteName", "stateLabel"]}
          emptyTitle={empty.title}
          emptyDescription={empty.description}
          emptyAction={filtered ? <Button type="button" variant="secondary" size="sm" onClick={clearAll}>Ver todas las faenas</Button> : undefined}
          renderRow={(row) => (
            <TableRow key={row.id} data-worksite-id={row.worksiteId}>
              <TableCell><Worksite row={row} /></TableCell>
              <TableCell><State row={row} onCreate={createFor(row)} /></TableCell>
              <TableCell className="text-right"><Headcount row={row} /></TableCell>
              <TableCell><Completeness row={row} /></TableCell>
              <TableCell className="text-right"><Graves row={row} /></TableCell>
              <TableCell className="text-sm">{programLabel(row)}</TableCell>
              <TableCell>{row.updatedAt ? formatDate(row.updatedAt) : "—"}</TableCell>
            </TableRow>
          )}
          renderMobileCard={(row) => (
            <article aria-label={row.worksiteName} className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <Worksite row={row} />
              <State row={row} onCreate={createFor(row)} />
              <Completeness row={row} />
              <p className="text-xs text-[var(--color-text-subtle)]">
                Dotación {row.headcount} · Importantes e Intolerables {row.importantCount + row.intolerableCount} · Programa {programLabel(row)}
              </p>
              {row.criticalWithoutControl > 0 && (
                <p className="text-xs font-medium text-[var(--color-danger-ink)]">
                  {countOf(row.criticalWithoutControl, "crítico sin control", "críticos sin control")}{row.vigente ? " en la vigente" : ""}
                </p>
              )}
            </article>
          )}
        />
      </div>
      <NewMiperDialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null) }}
        worksites={creationWorksites} currentYear={currentYear} initialWorksiteId={creating?.worksiteId ?? null} />
    </PageContainer>
  )
}
```

- [ ] **Step 4: La página lee la portada nueva**

Reemplazar `app/(app)/prevencion/miper/page.tsx` completo por:

```tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listMiperPortfolio } from "@/lib/services/miper/portfolio"
import { listMiperCreationOptions } from "@/lib/services/miper/queries"
import { codeYear } from "@/lib/utils"
import { MiperHome } from "./miper-home"

export const metadata: Metadata = { title: "Matriz IPER (MIPER)" }

/**
 * Portada del RE-04 por faena (spec §7, Fase B): una fila por faena en alcance
 * —con o sin MIPER— y la franja de cuatro cifras. Los filtros (`vista`,
 * `estado`, `sincontrol`, `faena`) viven en la URL y se aplican en el cliente
 * sobre las faenas del alcance, que son pocas. El alcance lo aplica el
 * servicio: el navegador nunca recibe una faena ajena. No lleva buscador
 * propio: el del TopBar filtra la tabla (`DataTable`).
 */
export default async function MiperPage() {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const canEdit = can(session, "prevention:risk:edit")
  const [portfolio, creation] = await Promise.all([
    listMiperPortfolio(access),
    // El alta exige `prevention:risk:edit`; sin ese permiso no se consultan faenas ni vigentes.
    canEdit ? listMiperCreationOptions(access) : Promise.resolve({ worksites: [] }),
  ])
  return (
    <MiperHome
      rows={portfolio.rows}
      creationWorksites={creation.worksites}
      currentYear={codeYear()}
      permissions={{ canEdit, canManageCatalog: can(session, "prevention:risk:catalog:manage") }}
    />
  )
}
```

- [ ] **Step 5: Retirar el tablero viejo y apuntar el KPI del tablero de inicio**

```bash
git rm "app/(app)/prevencion/miper/dashboard-panel.tsx" lib/services/miper/dashboard.ts lib/__tests__/miper-dashboard.test.ts
```

En `tests/pglite-files.ts`, borrar las líneas 32-33:

```ts
  // MIPER F3: tablero del Resumen (tiles accionables, franja y tabla por faena).
  "lib/__tests__/miper-dashboard.test.ts",
```

En `app/(app)/dashboard/sections/prevention-section.tsx`:
- después de la línea 11 (`import { getPdtpComplianceIndicatorsForScope } …`), agregar:

  ```ts
  import { PORTFOLIO_SUMMARY_HREF } from "@/lib/prevention/miper/portfolio"
  ```

- en la línea 106, reemplazar `href="/prevencion/miper?tab=todas" />` por
  `href={PORTFOLIO_SUMMARY_HREF.critical} />`.

  El KPI y la portada cuentan con el mismo predicado (Task 1) y llevan al mismo subconjunto. La E2E
  `densidad-kpi` se ajusta en la Task 10.

Comprobar que no quedó nada del tablero viejo (las E2E se ajustan en la Task 10):

```bash
grep -rn "getMiperDashboard\|MiperDashboard\|dashboard-panel\|miper/dashboard\"" app lib components tests
```

Expected: sin resultados.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm run test:fast -- "app/(app)/prevencion/miper" lib/prevention/miper
npm run typecheck
```

Expected: PASS, incluida `miper-home.test.tsx`. `typecheck` confirma que nadie importaba lo retirado.

- [ ] **Step 7: Puertas**

```bash
npm run lint -- "app/(app)/prevencion/miper/miper-home.tsx" "app/(app)/prevencion/miper/miper-home.test.tsx" "app/(app)/prevencion/miper/page.tsx" "app/(app)/dashboard/sections/prevention-section.tsx" tests/pglite-files.ts
```

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/prevencion/miper/miper-home.tsx" "app/(app)/prevencion/miper/miper-home.test.tsx" "app/(app)/prevencion/miper/page.tsx" "app/(app)/dashboard/sections/prevention-section.tsx" tests/pglite-files.ts
git commit -m "feat(miper): portada por faena con franja de cuatro cifras, «Requieren mi acción» y «Crear MIPER»" -m "Retira las pestañas Resumen/Por hacer/Todas, el filtro Responsable, dashboard-panel.tsx y getMiperDashboard. ?tab=porhacer abre «Requieren mi acción»; el KPI del tablero lleva a ?sincontrol=1." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Los tres archivos borrados ya quedaron en el índice con el `git rm` del Step 5.

---
### Task 8: Pestaña «Resumen» del espacio de trabajo

**Files:**
- Modify: `lib/prevention/miper/workspace-url.ts` (`WORKSPACE_TABS` y `hrefToMatrixOnly`) y su test `workspace-url.test.ts`
- Create: `app/(app)/prevencion/miper/[id]/resumen-panel.tsx`
- Test: `app/(app)/prevencion/miper/[id]/resumen-panel.test.tsx` (nuevo)
- Modify: `app/(app)/prevencion/miper/[id]/workspace-memory.ts` (+ `workspace-memory.test.ts`): `revealActivity`
- Modify: `app/(app)/prevencion/miper/[id]/workspace-nav.tsx` (+ `workspace-nav.test.tsx`): `scrollToWhenReady`
- Modify: `app/(app)/prevencion/miper/[id]/miper-workspace.tsx` (+ `miper-workspace.test.tsx`)
- Modify: `app/(app)/prevencion/miper/[id]/page.tsx`

**Interfaces:**
- Consumes:
  - `SummaryBar` con `renderLink` y `SummaryLinkProps` (Task 6);
  - `MATRIX_FILTER_KEYS`, `MatrixFilterKey` (`lib/prevention/miper/matrix-filters.ts`, existentes);
  - `getProgramProgress(client, matrixId)` (`lib/services/miper/program-execution.ts:353`, existente);
  - `ActivityNode` (`matrix-tree.ts`), `ProgramProgress` (`progress.ts`);
  - `WorkspaceLink`, `readCollapsedActivities` y `writeCollapsedActivities` (existentes).
- Produces:
  - `WORKSPACE_TABS = ["resumen", "matriz", "programa", "revision", "historial"]`. `WorkspaceTab`
    suma `"resumen"`; `readWorkspaceView(?tab=resumen)` da `tab: "resumen"`.
  - `hrefToMatrixOnly(pathname: string, params: Params, patch?: Partial<Record<MatrixFilterKey, string>>): string`:
    quita la vista, la ficha y los seis filtros de la matriz, y después aplica `patch`.
  - `revealActivity(matrixId: string, activityKey: string): void` (en `workspace-memory.ts`).
  - `scrollToWhenReady(id: string, frames?: number): void` (en `workspace-nav.tsx`).
  - `ResumenPanel({ matrixId, rows, tree, incomplete, programProgress, editable, onNewTask })`.
  - `MiperWorkspaceView` gana la prop obligatoria `programProgress: ProgramProgress`.

**La matriz sigue siendo la pestaña por defecto** (spec §3 y D9; ver «Decisiones», 1). «Resumen» va
primero en la tira, en el orden de la spec §2.3, y se abre con `?tab=resumen`.

- [ ] **Step 1: Write the failing tests**

En `lib/prevention/miper/workspace-url.test.ts`:
- cambiar el import por:

  ```ts
  import { hrefToEntry, hrefToFicha, hrefToMatrix, hrefToMatrixOnly, hrefToMatrixWith, hrefToTab, hrefToTask, readWorkspaceView } from "./workspace-url"
  ```

- agregar al `describe`:

  ```ts
    it("Resumen (Fase B): `tab=resumen` es una pestaña; la fila y la tarea siguen mandando sobre ella", () => {
      expect(readWorkspaceView(params("tab=resumen"))).toMatchObject({ tab: "resumen", taskKey: null, entryId: null })
      expect(readWorkspaceView(params("tab=resumen&tarea=k1"))).toMatchObject({ tab: "matriz", taskKey: "k1" })
      expect(hrefToTab(P, params("buscar=x"), "resumen")).toBe(`${P}?buscar=x&tab=resumen`)
    })

    it("hrefToMatrixOnly quita los seis filtros de la matriz, la vista y la ficha antes de aplicar el suyo", () => {
      const current = params("buscar=lodo&clasificacion=moderate&completitud=completos&controlado=yes&factor=f1&marca=observados&tab=resumen&ficha=1&q=prog")
      // `q` es del programa: no es un filtro de la matriz y se conserva.
      expect(hrefToMatrixOnly(P, current, { clasificacion: "important,intolerable" })).toBe(`${P}?q=prog&clasificacion=important%2Cintolerable`)
      expect(hrefToMatrixOnly(P, current)).toBe(`${P}?q=prog`)
    })
  ```

Crear `app/(app)/prevencion/miper/[id]/resumen-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildMatrixTree } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const nav = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams(nav.query) }))

import { ResumenPanel } from "./resumen-panel"

const P = "/prevencion/miper/m1"
const entry = (overrides: Partial<MiperEntrySnapshot>): MiperEntrySnapshot => ({
  id: "e1", rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: "Peligro", risk: "Choque", probableDamage: "Fractura",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [],
  ...overrides,
})
const ROWS = [
  entry({}),
  entry({ id: "e2", rowNumber: 2, activity: "Mantención", task: "Revisión", probability: 1, consequence: 2, magnitude: 2, classification: "tolerable", controlledStatus: "yes" }),
  entry({ id: "e3", rowNumber: 3, activity: "Mantención", task: "Revisión", probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controlledStatus: "partial" }),
]
const INCOMPLETE = new Set(["e1", "e3"])
const treeOf = (rows: MiperEntrySnapshot[], incomplete: ReadonlySet<string>) => buildMatrixTree(rows, { incomplete, observed: new Set(), modified: new Set(), matching: null })
const PROGRESS = { done: 1, late: 0, pending: 1, overdue: 0, failed: 1, planned: 3, ratio: 1 / 3 }
const NO_PROGRAM = { done: 0, late: 0, pending: 0, overdue: 0, failed: 0, planned: 0, ratio: null }

function show(query = "", rows = ROWS, incomplete: ReadonlySet<string> = INCOMPLETE, onNewTask = vi.fn()) {
  nav.query = query
  return render(<ResumenPanel matrixId="m1" rows={rows} tree={treeOf(rows, incomplete)} incomplete={incomplete} programProgress={rows === ROWS ? PROGRESS : NO_PROGRAM} editable onNewTask={onNewTask} />)
}

afterEach(() => {
  nav.query = ""
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("ResumenPanel — cuatro cifras que llevan a su subconjunto (A1)", () => {
  it("cada cifra de la matriz quita los filtros que había antes de aplicar el suyo", () => {
    show("tab=resumen&buscar=lodo&factor=f1&clasificacion=moderate")
    const completos = screen.getByRole("link", { name: /^Riesgos completos/ })
    expect(completos).toHaveAttribute("href", `${P}?completitud=pendientes`)
    expect(completos).toHaveTextContent("1/3")
    expect(completos).toHaveTextContent("2 riesgos con pendientes")
    expect(screen.getByRole("link", { name: /^Importantes e Intolerables/ })).toHaveAttribute("href", `${P}?clasificacion=important%2Cintolerable`)
    expect(screen.getByRole("link", { name: /^No controlados/ })).toHaveAttribute("href", `${P}?controlado=no`)
    // El programa no lee los filtros de la matriz: se conservan.
    const programa = screen.getByRole("link", { name: /^Avance del programa/ })
    expect(programa).toHaveAttribute("href", `${P}?buscar=lodo&factor=f1&clasificacion=moderate&tab=programa`)
    expect(programa).toHaveTextContent("33%")
    expect(programa).toHaveTextContent("1/3 realizadas")
  })

  it("una cifra en cero no lleva a una lista vacía; sin pendientes, «Riesgos completos» lleva a los completos", () => {
    const tolerable = [ROWS[1]!]
    show("", tolerable, new Set())
    expect(screen.queryByRole("link", { name: /^No controlados/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /^Importantes e Intolerables/ })).toBeNull()
    expect(screen.getByRole("link", { name: /^Riesgos completos/ })).toHaveAttribute("href", `${P}?completitud=completos`)
    expect(screen.getByRole("link", { name: /^Avance del programa/ })).toHaveTextContent("Sin ocurrencias")
  })

  it("sin riesgos, el estado vacío explica y ofrece «Nueva tarea» (A4)", () => {
    const onNewTask = vi.fn()
    show("", [], new Set(), onNewTask)
    expect(screen.getByText("Esta MIPER todavía no tiene riesgos")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }))
    expect(onNewTask).toHaveBeenCalled()
  })
})

describe("ResumenPanel — completitud por actividad", () => {
  it("una barra por actividad, en el orden del RE-04, con su cuenta", () => {
    show("")
    expect(screen.getByRole("progressbar", { name: "Transporte: 0 de 1 completos" })).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Mantención: 1 de 2 completos" })).toBeInTheDocument()
  })

  it("el enlace a una actividad plegada la despliega, quita los filtros y la deja a la vista con el foco", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0 })
    const tree = treeOf(ROWS, INCOMPLETE)
    const key = tree[1]!.key
    sessionStorage.setItem("miper:m1:collapsed", JSON.stringify([key]))
    const replace = vi.spyOn(window.history, "replaceState")
    show("tab=resumen&buscar=lodo")
    // El destino lo pinta MatrixView al cambiar de pestaña; aquí se simula ya pintado.
    const target = document.createElement("h2")
    target.id = `miper-activity-${key}`
    target.innerHTML = "<button type=\"button\">Mantención</button>"
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)
    try {
      fireEvent.click(screen.getByRole("link", { name: "Mantención" }))
      expect(replace).toHaveBeenCalledWith(null, "", `${P}#miper-activity-${key}`)
      expect(JSON.parse(sessionStorage.getItem("miper:m1:collapsed")!)).toEqual([])
      expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" })
      expect(document.activeElement).toBe(target.querySelector("button"))
    } finally {
      target.remove()
    }
  })
})
```

En `app/(app)/prevencion/miper/[id]/workspace-memory.test.ts`:
- agregar `revealActivity` al import;
- agregar al `describe`:

  ```ts
    it("revealActivity despliega sólo esa actividad y no escribe si ya estaba abierta (Resumen, Fase B)", () => {
      writeCollapsedActivities("m1", ["a", "b"])
      revealActivity("m1", "a")
      expect([...readCollapsedActivities("m1")]).toEqual(["b"])
      const setItem = vi.spyOn(Storage.prototype, "setItem")
      revealActivity("m1", "zzz")
      expect(setItem).not.toHaveBeenCalled()
    })
  ```

En `app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx`:
- cambiar el import por `import { scrollToWhenReady, WorkspaceLink } from "./workspace-nav"`;
- agregar al final del archivo:

  ```tsx
  describe("scrollToWhenReady", () => {
    it("espera a que la vista pinte el destino, lo lleva a la vista y le pasa el foco a su botón", () => {
      const frames: FrameRequestCallback[] = []
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
      try {
        scrollToWhenReady("destino")
        frames.shift()!(0) // primer cuadro: el destino todavía no existe
        const target = document.createElement("h2")
        target.id = "destino"
        target.innerHTML = "<button type=\"button\">Actividad</button>"
        target.scrollIntoView = vi.fn()
        document.body.appendChild(target)
        frames.shift()!(0) // segundo cuadro: ya está
        expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" })
        expect(document.activeElement).toBe(target.querySelector("button"))
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it("si el destino nunca aparece, se rinde sin error", () => {
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0 })
      try {
        expect(() => scrollToWhenReady("no-existe", 3)).not.toThrow()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
  ```

En `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx`:
- después de `const allAdded …`, agregar
  `const NO_PROGRAM = { done: 0, late: 0, pending: 0, overdue: 0, failed: 0, planned: 0, ratio: null }`;
- en `show()`, cambiar
  `<MiperWorkspaceView workspace={workspace} history={[]} mode={mode} userId="u1" />` por
  `<MiperWorkspaceView workspace={workspace} history={[]} mode={mode} userId="u1" programProgress={NO_PROGRAM} />`;
- agregar al final del archivo:

  ```tsx
  describe("MiperWorkspaceView — pestaña Resumen (Fase B)", () => {
    it("la matriz sigue siendo la pestaña por defecto; Resumen va primero en la tira", () => {
      show("")
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Resumen", "Matriz (1)", "Programa", "Revisión", "Historial"])
      expect(screen.getByRole("tab", { name: "Resumen", selected: false })).toBeTruthy()
      expect(screen.getByRole("tab", { name: "Matriz (1)", selected: true })).toBeTruthy()
    })

    it("con ?tab=resumen muestra las cuatro cifras y la completitud por actividad", () => {
      show("tab=resumen")
      expect(screen.getByRole("tab", { name: "Resumen", selected: true })).toBeTruthy()
      expect(screen.getByRole("link", { name: /^Riesgos completos/ })).toBeTruthy()
      expect(screen.getByRole("progressbar", { name: /^Transporte: / })).toBeTruthy()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:fast -- lib/prevention/miper/workspace-url.test.ts "app/(app)/prevencion/miper/[id]/resumen-panel.test.tsx" "app/(app)/prevencion/miper/[id]/workspace-memory.test.ts" "app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

Expected: FAIL.
- `workspace-url`: `tab=resumen` cae en `matriz` y `hrefToMatrixOnly` no existe.
- `resumen-panel`: no resuelve `./resumen-panel`.
- `workspace-memory` y `workspace-nav`: no existen `revealActivity` ni `scrollToWhenReady`.
- `miper-workspace`: no hay pestaña «Resumen».

- [ ] **Step 3: URL del Resumen**

En `lib/prevention/miper/workspace-url.ts`:

1. Después del import de `entry-navigation`, agregar:

   ```ts
   import { MATRIX_FILTER_KEYS, type MatrixFilterKey } from "./matrix-filters"
   ```

2. Reemplazar `export const WORKSPACE_TABS = ["matriz", "programa", "revision", "historial"] as const`
   por:

   ```ts
   /** «resumen» (Fase B) va primero en la tira, pero la pestaña por defecto sigue siendo la matriz (spec §3). */
   export const WORKSPACE_TABS = ["resumen", "matriz", "programa", "revision", "historial"] as const
   ```

3. Al final del archivo, agregar:

   ```ts
   const CLEAR_MATRIX_FILTERS = Object.fromEntries(MATRIX_FILTER_KEYS.map((key) => [key, null])) as Record<MatrixFilterKey, null>

   /**
    * La matriz con SÓLO estos filtros (pestaña Resumen, Fase B). Quita la vista,
    * la ficha y los seis filtros de la matriz antes de aplicar `patch`: si no,
    * la cifra del Resumen y lo que se ve al llegar no coinciden. Los parámetros
    * del programa (`q`, `estado`, `frecuencia`) no son de la matriz y se quedan.
    */
   export const hrefToMatrixOnly = (pathname: string, params: Params, patch: Partial<Record<MatrixFilterKey, string>> = {}) =>
     href(pathname, params, { ...CLEAR_VIEW, ficha: null, ...CLEAR_MATRIX_FILTERS, ...patch })
   ```

- [ ] **Step 4: Desplegar la actividad y llevarla a la vista**

En `app/(app)/prevencion/miper/[id]/workspace-memory.ts`, después de `writeCollapsedActivities`
(línea 32), agregar:

```ts
/** Despliega una actividad plegada antes de llevar a ella (los enlaces del Resumen, Fase B). Si ya estaba abierta, no escribe. */
export function revealActivity(matrixId: string, activityKey: string) {
  const collapsed = readCollapsedActivities(matrixId)
  if (!collapsed.delete(activityKey)) return
  writeCollapsedActivities(matrixId, collapsed)
}
```

En `app/(app)/prevencion/miper/[id]/workspace-nav.tsx`, después de `navigateWorkspace`, agregar:

```ts
/**
 * Lleva el pozo hasta `id` cuando la vista que lo contiene ya se pintó: cambiar
 * de pestaña con `replaceState` re-renderiza después, así que el destino
 * aparece uno o dos cuadros más tarde. Deja el foco en su primer botón (el de
 * la tarjeta de la actividad), sin volver a desplazar. Si en `frames` cuadros
 * no aparece, se rinde sin error.
 */
export function scrollToWhenReady(id: string, frames = 30) {
  const tick = (left: number) => {
    const target = document.getElementById(id)
    if (target) {
      target.scrollIntoView({ block: "start" })
      target.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
      return
    }
    if (left > 0) requestAnimationFrame(() => tick(left - 1))
  }
  requestAnimationFrame(() => tick(frames))
}
```

- [ ] **Step 5: El panel**

Crear `app/(app)/prevencion/miper/[id]/resumen-panel.tsx`:

```tsx
"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Progress } from "@/components/ui/progress"
import { SummaryBar, type SummaryLinkProps, type SummaryStat } from "@/components/ui/summary-bar"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { ProgramProgress } from "@/lib/prevention/miper/progress"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { hrefToMatrixOnly, hrefToTab } from "@/lib/prevention/miper/workspace-url"
import { countOf } from "@/lib/utils"
import { revealActivity } from "./workspace-memory"
import { scrollToWhenReady, WorkspaceLink } from "./workspace-nav"

/** Las cifras cambian la vista con `replaceState`: sin ida al servidor y sin entrada nueva en el historial (spec §3). */
function ReplaceWorkspaceLink({ href, className, children, ...rest }: SummaryLinkProps) {
  return <WorkspaceLink href={href} replace className={className} {...rest}>{children}</WorkspaceLink>
}

/**
 * Pestaña «Resumen» del espacio de trabajo (spec §7, Fase B). No es la vista por
 * defecto: la matriz lo sigue siendo (§3, D9).
 *
 * - Cuatro cifras que llevan a su subconjunto (A1). Las tres de la matriz QUITAN
 *   los seis filtros antes de aplicar el suyo (`hrefToMatrixOnly`); si no, la
 *   cifra y lo que se ve al llegar no coinciden.
 * - La completitud por actividad, con cada barra enlazada a su tarjeta en la
 *   matriz. Si la tarjeta estaba plegada, se despliega.
 */
export function ResumenPanel({ matrixId, rows, tree, incomplete, programProgress, editable, onNewTask }: {
  matrixId: string
  rows: readonly MiperEntrySnapshot[]
  /** El árbol completo (sin filtros) de la matriz: el orden del RE-04 y la cuenta por actividad. */
  tree: readonly ActivityNode[]
  /** Riesgos con algún error de completitud: el mismo conjunto que filtra `completitud=pendientes`. */
  incomplete: ReadonlySet<string>
  programProgress: ProgramProgress
  editable: boolean
  onNewTask: () => void
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Esta MIPER todavía no tiene riesgos"
        description="El resumen se arma con los riesgos de la matriz: empieza por una tarea con su actividad, su puesto y sus peligros."
        action={editable
          ? <Button onClick={onNewTask}>Nueva tarea</Button>
          : <Button asChild variant="secondary"><WorkspaceLink href={hrefToTab(pathname, params, "matriz")} replace>Ver la matriz</WorkspaceLink></Button>}
      />
    )
  }
  const pending = rows.filter((row) => incomplete.has(row.id)).length
  const graves = rows.filter((row) => row.classification === "important" || row.classification === "intolerable").length
  const uncontrolled = rows.filter((row) => row.controlledStatus === "no").length
  const { done, planned, overdue, ratio } = programProgress
  const stats: SummaryStat[] = [
    {
      key: "completos", label: "Riesgos completos", value: `${rows.length - pending}/${rows.length}`,
      secondary: pending > 0 ? `${countOf(pending, "riesgo")} con pendientes` : "Ninguno con pendientes",
      href: hrefToMatrixOnly(pathname, params, { completitud: pending > 0 ? "pendientes" : "completos" }),
    },
    {
      key: "graves", label: "Importantes e Intolerables", value: graves, tone: "signal",
      secondary: graves > 0 ? "Exigen medida y seguimiento" : "Ninguno en esta MIPER",
      href: graves > 0 ? hrefToMatrixOnly(pathname, params, { clasificacion: "important,intolerable" }) : undefined,
    },
    {
      key: "no-controlados", label: "No controlados", value: uncontrolled, tone: "signal",
      secondary: uncontrolled > 0 ? "«¿Está controlado?» en No" : "Ninguno marcado No",
      href: uncontrolled > 0 ? hrefToMatrixOnly(pathname, params, { controlado: "no" }) : undefined,
    },
    {
      key: "programa", label: "Avance del programa", value: planned === 0 ? "Sin ocurrencias" : `${Math.round((ratio ?? 0) * 100)}%`,
      secondary: planned === 0 ? "Genera las actividades desde las medidas" : `${done}/${planned} realizadas${overdue > 0 ? ` · ${countOf(overdue, "vencida")}` : ""}`,
      href: hrefToTab(pathname, params, "programa"),
    },
  ]
  return (
    <div className="space-y-4">
      <SummaryBar stats={stats} renderLink={ReplaceWorkspaceLink} />
      <section aria-labelledby="miper-resumen-actividades" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 id="miper-resumen-actividades" className="text-sm font-semibold">Completitud por actividad</h2>
        <ul className="mt-3 space-y-3">
          {tree.map((activity) => {
            const complete = activity.tasks.reduce((total, task) => total + task.complete, 0)
            const target = `miper-activity-${activity.key}`
            return (
              <li key={activity.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto]">
                <WorkspaceLink href={`${hrefToMatrixOnly(pathname, params)}#${target}`} replace className="truncate text-sm font-medium hover:underline"
                  onClick={() => { revealActivity(matrixId, activity.key); scrollToWhenReady(target) }}>
                  {activity.label}
                </WorkspaceLink>
                <span className="col-start-2 row-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-3">{complete}/{activity.entryCount}</span>
                <Progress value={complete} max={activity.entryCount} label={`${activity.label}: ${complete} de ${activity.entryCount} completos`}
                  className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1" />
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
```

- [ ] **Step 6: El espacio de trabajo pinta la pestaña y la página carga el avance**

En `app/(app)/prevencion/miper/[id]/miper-workspace.tsx`:

1. Agregar a los imports:

   ```ts
   import type { ProgramProgress } from "@/lib/prevention/miper/progress"
   import { ResumenPanel } from "./resumen-panel"
   ```

2. Cambiar la firma de `MiperWorkspaceView` por:

   ```tsx
   export function MiperWorkspaceView({ workspace, history, mode, userId, programProgress }: {
     workspace: MiperWorkspace; history: MiperHistoryEvent[]; mode: WorkspaceMode; userId: string
     /** Avance del Programa de Trabajo para la pestaña Resumen (lo carga `page.tsx`). */
     programProgress: ProgramProgress
   }) {
   ```

3. En el `<TabsList>`, antes de `<TabsTrigger value="matriz">…`, agregar
   `<TabsTrigger value="resumen">Resumen</TabsTrigger>`.

4. Antes de `<TabsContent value="matriz" className="space-y-3">`, agregar:

   ```tsx
             <TabsContent value="resumen">
               <ResumenPanel matrixId={workspace.matrix.id} rows={rows} tree={fullTree} incomplete={incomplete} programProgress={programProgress}
                 editable={editable} onNewTask={() => setNewTaskOpen(true)} />
             </TabsContent>
   ```

En `app/(app)/prevencion/miper/[id]/page.tsx`:

1. Agregar a los imports:

   ```ts
   import { db } from "@/db"
   import { getProgramProgress } from "@/lib/services/miper/program-execution"
   ```

2. Reemplazar la última línea de la función
   (`return <MiperWorkspaceView workspace={workspace} history={history} mode={mode} userId={session.user.id} />`)
   por:

   ```tsx
     /* Avance del programa para la pestaña Resumen (Fase B). Va DESPUÉS de
      * autorizar (`getMiperWorkspace`), porque `getProgramProgress` no controla
      * acceso. La Fase E lo reemplaza por `getProgramWorkspace().progress`, cuando
      * el programa se cargue en esta página. */
     const { program: programProgress } = await getProgramProgress(db, workspace.matrix.id)
     return <MiperWorkspaceView workspace={workspace} history={history} mode={mode} userId={session.user.id} programProgress={programProgress} />
   ```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
npm run test:fast -- lib/prevention/miper "app/(app)/prevencion/miper/[id]"
npm run typecheck
```

Expected: PASS. Corre la carpeta completa del espacio de trabajo, porque `MiperWorkspaceView` cambió
de firma.

- [ ] **Step 8: Puertas**

```bash
npm run lint -- lib/prevention/miper/workspace-url.ts lib/prevention/miper/workspace-url.test.ts "app/(app)/prevencion/miper/[id]/resumen-panel.tsx" "app/(app)/prevencion/miper/[id]/resumen-panel.test.tsx" "app/(app)/prevencion/miper/[id]/workspace-memory.ts" "app/(app)/prevencion/miper/[id]/workspace-memory.test.ts" "app/(app)/prevencion/miper/[id]/workspace-nav.tsx" "app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" "app/(app)/prevencion/miper/[id]/page.tsx"
```

- [ ] **Step 9: Commit**

```bash
git add lib/prevention/miper/workspace-url.ts lib/prevention/miper/workspace-url.test.ts "app/(app)/prevencion/miper/[id]/resumen-panel.tsx" "app/(app)/prevencion/miper/[id]/resumen-panel.test.tsx" "app/(app)/prevencion/miper/[id]/workspace-memory.ts" "app/(app)/prevencion/miper/[id]/workspace-memory.test.ts" "app/(app)/prevencion/miper/[id]/workspace-nav.tsx" "app/(app)/prevencion/miper/[id]/workspace-nav.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" "app/(app)/prevencion/miper/[id]/page.tsx"
git commit -m "feat(miper): pestaña «Resumen» con cuatro cifras que limpian los filtros y completitud por actividad" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Contexto del espacio de trabajo: «Elaboró» y «Cambiar de faena»

**Files:**
- Modify: `lib/services/miper/queries.ts`: el tipo `openRound`, la consulta de nombres y el
  `openRound` que devuelve (líneas 37, 132 y 148 en 4f980172; la Task 4 las corre dos líneas)
- Test: `lib/__tests__/miper-queries.test.ts`
- Modify: `app/(app)/prevencion/miper/actions.ts` (acción de lectura nueva)
- Test: `app/(app)/prevencion/miper/actions.test.ts`
- Create: `app/(app)/prevencion/miper/[id]/worksite-switcher.tsx`
- Test: `app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx` (nuevo)
- Modify: `app/(app)/prevencion/miper/[id]/miper-workspace.tsx` (+ `miper-workspace.test.tsx`)

**Interfaces:**
- Consumes:
  - `listMiperWorksiteTargets(access)` y `MiperWorksiteTarget` (Tasks 3 y 4);
  - `beforeForwardNavigation` (`workspace-memory.ts`) y `useOperation` (existentes).
- Produces:
  - `MiperWorkspace.openRound` gana `submittedByName: string | null`.
  - `listMiperWorksiteTargetsAction(input?: unknown): Promise<ActionState>`, con
    `data: { targets: MiperWorksiteTarget[] }`. Exige `prevention:risk:view` y **no revalida**.
  - `WorksiteSwitcher({ currentMatrixId }: { currentMatrixId: string })`.
  - **«Elaboró»** = `openRound.submittedByName ?? versions[0]?.elaboratedByName ?? null`. Se pinta en
    `SummaryStrip`, en la raíz de la matriz.

- [ ] **Step 1: Write the failing tests**

En `lib/__tests__/miper-queries.test.ts`, dentro del test «la bandeja muestra a la prevencionista su
borrador y a la Jefa lo enviado», después de `expect(inbox[0]!.submittedByUserId).toBe("u-q")` (lo
agregó la Task 4), agregar:

```ts
    // «Elaboró» del espacio de trabajo (Fase B): el nombre de quien envió la ronda abierta.
    expect((await q.getMiperWorkspace(matrixId, jefa)).openRound?.submittedByName).toBe("Prevencionista Q")
```

En `app/(app)/prevencion/miper/actions.test.ts`:
- después de `const approveMiperFinal = vi.hoisted(() => vi.fn())`, agregar:

  ```ts
  const listMiperWorksiteTargets = vi.hoisted(() => vi.fn())
  ```

- después de `vi.mock("@/lib/services/miper/risk-factors", …)`, agregar:

  ```ts
  vi.mock("@/lib/services/miper/portfolio", () => ({ listMiperWorksiteTargets }))
  ```

- en el import de `./actions`, sumar `listMiperWorksiteTargetsAction`;
- agregar al `describe`:

  ```ts
    it("la lista del selector de faena exige ver MIPER, sale del alcance de la sesión y no revalida", async () => {
      guardPermission.mockResolvedValue(denied)
      await expect(listMiperWorksiteTargetsAction({})).resolves.toEqual(denied.error)
      expect(guardPermission).toHaveBeenCalledWith("prevention:risk:view")
      expect(listMiperWorksiteTargets).not.toHaveBeenCalled()

      const targets = [{ worksiteId: "ws-own", worksiteName: "Faena propia", matrixId: "m1", period: 2026 }]
      guardPermission.mockResolvedValue({ session, error: null })
      listMiperWorksiteTargets.mockResolvedValue(targets)
      await expect(listMiperWorksiteTargetsAction({ userId: "spoofed" })).resolves.toEqual({ ok: true, data: { targets } })
      expect(listMiperWorksiteTargets).toHaveBeenCalledWith({ userId: "trusted-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:edit"] })
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  ```

Crear `app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
const listMiperWorksiteTargetsAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ listMiperWorksiteTargetsAction }))

import { WorksiteSwitcher } from "./worksite-switcher"

const TARGETS = [
  { worksiteId: "ws-a", worksiteName: "Faena A", matrixId: "m1", period: 2026 },
  { worksiteId: "ws-b", worksiteName: "Faena B", matrixId: "m2", period: 2027 },
  { worksiteId: "ws-c", worksiteName: "Faena C", matrixId: null, period: null },
]
const abrir = () => fireEvent.keyDown(screen.getByRole("button", { name: "Cambiar de faena" }), { key: "Enter" })

afterEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("WorksiteSwitcher", () => {
  it("no pide la lista al pintarse: la pide al abrir el menú, una sola vez", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValue({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    expect(listMiperWorksiteTargetsAction).not.toHaveBeenCalled()
    abrir()
    expect(await screen.findByRole("menuitem", { name: "Faena B · 2027" })).toBeTruthy()
    expect(listMiperWorksiteTargetsAction).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    abrir()
    expect(await screen.findByRole("menuitem", { name: "Faena B · 2027" })).toBeTruthy()
    expect(listMiperWorksiteTargetsAction).toHaveBeenCalledTimes(1)
  })

  it("otra faena navega con router.push a su MIPER; una faena sin MIPER, a la portada acotada a ella", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValue({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    abrir()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Faena B · 2027" }))
    expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m2")
    abrir()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Faena C · sin MIPER" }))
    expect(router.push).toHaveBeenCalledWith("/prevencion/miper?faena=ws-c")
  })

  it("la MIPER actual queda marcada y no se puede elegir", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValue({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    abrir()
    expect(await screen.findByRole("menuitem", { name: "Faena A · 2026 (actual)" })).toHaveAttribute("aria-disabled", "true")
  })

  it("si la lectura falla lo dice y deja reintentar", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValueOnce({ ok: false, message: "No tienes permisos para realizar esta acción" })
    listMiperWorksiteTargetsAction.mockResolvedValueOnce({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentMatrixId="m1" />)
    abrir()
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reintentar/ }))
    expect(await screen.findByRole("menuitem", { name: "Faena B · 2027" })).toBeTruthy()
    expect(listMiperWorksiteTargetsAction).toHaveBeenCalledTimes(2)
  })
})
```

En `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx`:
- en la lista de `vi.mock("../actions", () => ({ … }))`, sumar `listMiperWorksiteTargetsAction: vi.fn(),`;
- agregar al final del archivo:

  ```tsx
  describe("MiperWorkspaceView — «Elaboró» y «Cambiar de faena» (Fase B)", () => {
    const elaboro = () => screen.getByText((_, node) => node?.tagName === "DT" && node.textContent?.trim() === "Elaboró").nextElementSibling?.textContent
    const round = { id: "r1", stage: "technical", roundNumber: 1, openedAt: null, submittedByUserId: "u2", submittedByName: "Ana Pérez", submittedAt: "2026-10-01T15:00:00.000Z", snapshot: { header, entries: [entry()] } }
    const version = { id: "v1", versionNumber: 1, approvedAt: "2026-09-01T00:00:00.000Z", changeSummary: "Emisión", approverName: "Legal", technicalReviewerName: "Jefa", elaboratedByName: "Luis Soto" }

    it("con una ronda abierta, «Elaboró» es quien la envió", () => {
      show("", workspaceOf({ openRound: round, versions: [version] } as unknown as Partial<MiperWorkspace>))
      expect(elaboro()).toContain("Ana Pérez")
    })

    it("sin ronda abierta, quien elaboró la última versión aprobada", () => {
      show("", workspaceOf({ versions: [version] } as unknown as Partial<MiperWorkspace>))
      expect(elaboro()).toContain("Luis Soto")
    })

    it("sin ronda ni versión aprobada no hay «Elaboró»", () => {
      show("")
      expect(screen.queryByText((_, node) => node?.tagName === "DT" && node.textContent?.trim() === "Elaboró")).toBeNull()
    })

    it("la cabecera ofrece «Cambiar de faena» sin pedir la lista al pintarse", () => {
      show("")
      expect(screen.getByRole("button", { name: "Cambiar de faena" })).toBeTruthy()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
npm run test:fast -- "app/(app)/prevencion/miper/actions.test.ts" "app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

Expected: FAIL.
- `miper-queries`: `submittedByName` es `undefined`.
- `actions`: `listMiperWorksiteTargetsAction` no existe.
- `worksite-switcher`: el módulo no existe.
- `miper-workspace`: no hay «Elaboró» (hoy `authorName={null}`) ni «Cambiar de faena».

- [ ] **Step 3: `openRound.submittedByName`**

En `lib/services/miper/queries.ts`:

1. En el tipo `MiperWorkspace` (línea 37), reemplazar
   `openRound: { id: string; stage: "technical" | "legal_rrhh"; roundNumber: number; openedAt: string | null; submittedByUserId: string; submittedAt: string; snapshot: MiperSnapshot } | null`
   por:

   ```ts
     /** `submittedByName`: «Elaboró» del espacio de trabajo (Fase B). */
     openRound: { id: string; stage: "technical" | "legal_rrhh"; roundNumber: number; openedAt: string | null; submittedByUserId: string; submittedByName: string | null; submittedAt: string; snapshot: MiperSnapshot } | null
   ```

2. Línea 132: reemplazar
   `const names = await userNames(db, observationRows.flatMap((observation) => [observation.authorUserId, observation.respondedByUserId]))`
   por:

   ```ts
     const names = await userNames(db, [...observationRows.flatMap((observation) => [observation.authorUserId, observation.respondedByUserId]), round?.submittedByUserId])
   ```

3. Línea 148: reemplazar
   `openRound: round ? { id: round.id, stage: round.stage as "technical" | "legal_rrhh", roundNumber: round.roundNumber, openedAt: round.openedAt, submittedByUserId: round.submittedByUserId, submittedAt: round.submittedAt, snapshot: round.snapshot as MiperSnapshot } : null,`
   por:

   ```ts
       openRound: round ? { id: round.id, stage: round.stage as "technical" | "legal_rrhh", roundNumber: round.roundNumber, openedAt: round.openedAt, submittedByUserId: round.submittedByUserId, submittedByName: names.get(round.submittedByUserId) ?? null, submittedAt: round.submittedAt, snapshot: round.snapshot as MiperSnapshot } : null,
   ```

- [ ] **Step 4: La acción de lectura**

En `app/(app)/prevencion/miper/actions.ts`:
- agregar a los imports:

  ```ts
  import { listMiperWorksiteTargets } from "@/lib/services/miper/portfolio"
  ```

- después de `discardMiperDraftAction` (línea 89), agregar:

  ```ts
  /**
   * Lista del selector «Cambiar de faena» (Fase B). Es una lectura bajo demanda:
   * el selector la pide al ABRIR el menú, nunca en cada render del espacio de
   * trabajo. El alcance sale de la sesión, nunca del input. No revalida.
   */
  export async function listMiperWorksiteTargetsAction(input: unknown = {}) {
    return guarded("prevention:risk:view", input, (access) => listMiperWorksiteTargets(access), { revalidate: false, data: (targets) => ({ targets }) })
  }
  ```

- [ ] **Step 5: El selector**

Crear `app/(app)/prevencion/miper/[id]/worksite-switcher.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MiperWorksiteTarget } from "@/lib/prevention/miper/portfolio"
import { listMiperWorksiteTargetsAction } from "../actions"
import { beforeForwardNavigation } from "./workspace-memory"

function labelOf(target: MiperWorksiteTarget) {
  return target.matrixId ? `${target.worksiteName} · ${target.period ?? "sin período"}` : `${target.worksiteName} · sin MIPER`
}

/**
 * «Cambiar de faena» (spec §2.3, Fase B).
 *
 * - La lista se pide al ABRIR el menú: es una lectura bajo demanda, no una
 *   consulta en cada render del espacio de trabajo. Se guarda mientras la página
 *   siga montada.
 * - Cambiar de faena es salir de esta MIPER, y eso necesita datos del servidor:
 *   va con `router.push`, precedido de `beforeForwardNavigation` como toda
 *   navegación hacia adelante del espacio de trabajo (spec §3).
 * - Una faena sin MIPER lleva a la portada acotada a ella, donde está «Crear MIPER».
 */
export function WorksiteSwitcher({ currentMatrixId }: { currentMatrixId: string }) {
  const router = useRouter()
  const operation = useOperation()
  const [targets, setTargets] = useState<MiperWorksiteTarget[] | null>(null)
  const load = () => operation.run(() => listMiperWorksiteTargetsAction({}), (result) => setTargets((result.data?.targets ?? []) as MiperWorksiteTarget[]))
  const go = (href: string) => {
    beforeForwardNavigation(href)
    router.push(href)
  }
  return (
    <DropdownMenu onOpenChange={(open) => { if (open && targets === null && !operation.pending) load() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">Cambiar de faena<CaretDown aria-hidden className="ml-1 size-3.5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Faenas a tu alcance</DropdownMenuLabel>
        {operation.pending && <DropdownMenuItem disabled>Cargando faenas…</DropdownMenuItem>}
        {!operation.pending && operation.message && (
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); load() }}>{operation.message} Reintentar</DropdownMenuItem>
        )}
        {targets?.map((target) => (target.matrixId === currentMatrixId ? (
          <DropdownMenuItem key={target.worksiteId} disabled>{labelOf(target)} (actual)</DropdownMenuItem>
        ) : (
          <DropdownMenuItem key={target.worksiteId}
            onSelect={() => go(target.matrixId ? `/prevencion/miper/${target.matrixId}` : `/prevencion/miper?faena=${encodeURIComponent(target.worksiteId)}`)}>
            {labelOf(target)}
          </DropdownMenuItem>
        )))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go("/prevencion/miper")}>Ver todas las faenas</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 6: El espacio de trabajo pinta «Elaboró» y el selector**

En `app/(app)/prevencion/miper/[id]/miper-workspace.tsx`:

1. Agregar el import `import { WorksiteSwitcher } from "./worksite-switcher"`.

2. Después de `const versionLabel = …` (línea 116), agregar:

   ```ts
     // «Elaboró» (Fase B): quien envió la ronda abierta o, sin ronda, quien elaboró la última versión aprobada.
     const authorName = workspace.openRound?.submittedByName ?? workspace.versions[0]?.elaboratedByName ?? null
   ```

3. En las acciones del `PageHeader`, reemplazar
   `<div className="flex flex-wrap items-center gap-2">` (seguido de `{editable && <Button …>Nueva
   tarea</Button>}`) por:

   ```tsx
             <div className="flex flex-wrap items-center gap-2">
               <WorksiteSwitcher currentMatrixId={workspace.matrix.id} />
   ```

   `Nueva tarea` y `WorkflowBar` quedan después, en el mismo orden.

4. En `<SummaryStrip …>`, reemplazar `authorName={null}` por `authorName={authorName}`.

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
npm run test:fast -- "app/(app)/prevencion/miper"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Puertas**

```bash
npm run lint -- lib/services/miper/queries.ts lib/__tests__/miper-queries.test.ts "app/(app)/prevencion/miper/actions.ts" "app/(app)/prevencion/miper/actions.test.ts" "app/(app)/prevencion/miper/[id]/worksite-switcher.tsx" "app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

- [ ] **Step 9: Commit**

```bash
git add lib/services/miper/queries.ts lib/__tests__/miper-queries.test.ts "app/(app)/prevencion/miper/actions.ts" "app/(app)/prevencion/miper/actions.test.ts" "app/(app)/prevencion/miper/[id]/worksite-switcher.tsx" "app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
git commit -m "feat(miper): «Elaboró» en la franja y selector de faena que carga la lista al abrirse" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: E2E de la portada y del Resumen (desde un worktree)

**Files:**
- Modify (reescrito): `e2e/prevencion-miper-matriz.spec.ts`
- Modify: `e2e/prevencion-miper-escenario.spec.ts`:
  - la tabla de cobertura del encabezado (línea 30);
  - el import de `./helpers` (línea 2);
  - el paso 1 (`:125-128`);
  - los pasos 8–9 (`:229-232`);
  - el paso 14 (`:381-406`).
- Modify: `e2e/prevencion-miper-flujo.spec.ts`: el paso 1 (`:54-57`) y la Jefa (`:139-145`)
- Modify: `e2e/prevencion-miper-programa.spec.ts:70`
- Modify: `e2e/densidad-kpi.spec.ts`: `PANTALLAS` (`:22-36`), `:164` y el test «cada destino
  acotado…» (`:200-211`)
- Modify: `e2e/accessibility.spec.ts` (un test más en «Accessibility audit — MIPER: vistas del
  espacio de trabajo», después de la línea 109)

**Interfaces:**
- Consumes: el contrato de E2E de la Task 7 y los nombres de la Task 8:
  - cifras del Resumen: «Riesgos completos», «Importantes e Intolerables», «No controlados»,
    «Avance del programa»;
  - `progressbar` con nombre «<actividad>: x de y completos».
- Consumes también los semillados de `e2e/setup-db.ts`:
  - `admin@e2e.chome.cl`: global, con los cuatro permisos MIPER;
  - «Faena E2E» (`ws-e2e`): MIPER vigente de la metodología anterior;
  - «Faena Restringida E2E»: borradores 2037–2039 y vigente 2036;
  - «Oficina Central E2E» y «Faena Sin CPHS E2E»: sin MIPER;
  - las tres firmas MIPER (`prev.faena@`, `jefa.prevencion@`, `legal.rrhh@`).
- Produces: la evidencia del criterio de aceptación B: la portada lista todas las faenas y cada cifra
  lleva exactamente a su subconjunto. Incluye la E2E nueva «Crear MIPER desde una faena sin MIPER».

**Base compartida.**
- Aquí cada corrida es de un solo spec y vuelve a sembrar la base. En CI, en cambio, los specs de un
  shard comparten la base.
- Por eso las pruebas comparan cada cifra con lo que se ve al llegar **en el mismo momento**, nunca
  con un número fijo.
- Además, cada enlace de acción se busca por su nombre con el período («… · MIPER 2030»).

- [ ] **Step 1: Reescribir `e2e/prevencion-miper-matriz.spec.ts`**

```ts
import { test, expect, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, listRecord, login } from "./helpers"

/**
 * E2E: portada de la MIPER por faena (Fase B, spec §7) y el mapa de riesgos.
 *
 * Cubre:
 *   • La portada lista TODAS las faenas del alcance, con y sin MIPER, sin las
 *     pestañas ni el filtro «Responsable» de antes.
 *   • Cada cifra de la franja lleva exactamente a su subconjunto (A1), y
 *     «Riesgos críticos sin control» dice lo mismo que el KPI del tablero.
 *   • «Crear MIPER» desde una faena sin MIPER: el diálogo llega con la faena.
 *   • El mapa de riesgos (CGRD) responde.
 *
 * Corre como admin (alcance global, los cuatro permisos MIPER). Las cifras se
 * comparan con lo que se ve al llegar en el MISMO momento, no con números
 * fijos: en CI la base es compartida dentro del shard y otras pruebas MIPER
 * crean o sellan matrices.
 */
const PORTADA = "/prevencion/miper"
/** Filas de la tabla (escritorio). `tr[data-worksite-id]` no cuenta la fila del estado vacío. */
const filas = (page: Page) => page.locator("tbody tr[data-worksite-id]")
const cifra = (page: Page, rotulo: string) => page.getByRole("link", { name: new RegExp(`^${rotulo}`) })

async function valorDe(link: Locator, rotulo: string): Promise<number> {
  const texto = (await link.textContent()) ?? ""
  const valor = texto.slice(rotulo.length).match(/\d+/)
  expect(valor, `«${rotulo}» sin cifra: ${texto}`).not.toBeNull()
  return Number(valor![0])
}

test.describe("Prevención — portada MIPER por faena", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("lista todas las faenas del alcance, con y sin MIPER, sin pestañas ni filtro «Responsable»", async ({ page }) => {
    await page.goto(PORTADA)
    await expect(page).toHaveURL(/\/prevencion\/miper/)
    await expectPageTitle(page, "Matriz IPER (MIPER)")
    await expect(page.getByRole("table", { name: "MIPER por faena" })).toBeVisible()
    // Una faena con MIPER: su nombre enlaza a ella.
    await expect(listRecord(page, "Faena E2E").getByRole("link", { name: "Faena E2E", exact: true })).toBeVisible()
    // Una faena activa sin MIPER también viene, con su «Crear MIPER».
    await expect(listRecord(page, "Faena Sin CPHS E2E")).toContainText("Sin MIPER")
    await expect(page.getByRole("button", { name: "Crear MIPER de Faena Sin CPHS E2E", exact: true })).toBeVisible()
    // Lo retirado no vuelve.
    await expect(page.getByRole("tab", { name: "Por hacer" })).toHaveCount(0)
    await expect(page.getByRole("combobox", { name: "Responsable" })).toHaveCount(0)
  })

  test("cada cifra de la franja lleva exactamente a su subconjunto", async ({ page }) => {
    for (const { rotulo, destino } of [
      { rotulo: "Faenas con MIPER", destino: "estado=con_miper" },
      { rotulo: "En revisión", destino: "estado=en_revision" },
      { rotulo: "Requieren mi acción", destino: "vista=mias" },
    ]) {
      await page.goto(PORTADA)
      const link = cifra(page, rotulo)
      const esperado = await valorDe(link, rotulo)
      await link.click()
      await expect(page).toHaveURL(new RegExp(`\\?${destino}$`))
      await expect(filas(page)).toHaveCount(esperado)
    }

    // «Riesgos críticos sin control» suma riesgos: llega a las faenas que los tienen y la suma por fila coincide.
    await page.goto(PORTADA)
    const sinControl = cifra(page, "Riesgos críticos sin control")
    const total = await valorDe(sinControl, "Riesgos críticos sin control")
    await sinControl.click()
    await expect(page).toHaveURL(/\?sincontrol=1$/)
    await expect(page.getByRole("button", { name: "Eliminar filtro Riesgos críticos", exact: true })).toBeVisible()
    const porFila = await filas(page).evaluateAll((rows) => rows.map((row) => Number(row.textContent?.match(/(\d+) críticos? sin control/)?.[1] ?? 0)))
    expect(porFila.every((n) => n > 0)).toBe(true)
    expect(porFila.reduce((suma, n) => suma + n, 0)).toBe(total)

    // Y es la misma cifra que el KPI del tablero: una sola definición.
    await page.goto("/dashboard?vista=prevencion")
    const kpi = page.locator("[data-kpi-card]").filter({ hasText: "Riesgos críticos sin control" })
    await expect(kpi).toBeVisible()
    expect(Number(((await kpi.textContent()) ?? "").match(/Riesgos críticos sin control\s*(\d+)/)?.[1])).toBe(total)
  })

  test("Crear MIPER desde una faena sin MIPER", async ({ page }) => {
    await page.goto(PORTADA)
    await expect(listRecord(page, "Oficina Central E2E")).toContainText("Sin MIPER")
    await page.getByRole("button", { name: "Crear MIPER de Oficina Central E2E", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
    // La faena llega elegida desde la fila.
    await expect(dialog.getByRole("combobox")).toContainText("Oficina Central E2E")
    await dialog.getByLabel("Período").fill("2041")
    await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
    await dialog.getByLabel("Motivo").fill("Elaboración inicial de la faena, creada desde su fila en la portada.")
    await dialog.getByRole("button", { name: "Crear borrador" }).click()
    // Abre con la «Ficha del documento», igual que «Nueva MIPER».
    await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?ficha=1/)
    await expect(page.getByRole("dialog", { name: "Ficha del documento" })).toBeVisible()

    await page.goto(PORTADA)
    await expect(listRecord(page, "Oficina Central E2E")).toContainText("Borrador")
    await expect(page.getByRole("button", { name: "Crear MIPER de Oficina Central E2E", exact: true })).toHaveCount(0)
  })
})

// El mapa se trasladó a CGRD el 2026-09-22. El flujo completo del plano y sus
// marcadores vive en prevencion-cgrd-risk-map.spec.ts; acá sólo queda que la
// pantalla responde y se titula como corresponde.
test.describe("Prevención — mapa de riesgos", () => {
  test("navegación al mapa de riesgos interactivo", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/cgrd/mapa")
    await expect(page).toHaveURL(/\/prevencion\/cgrd\/mapa/)
    await expectPageTitle(page, /Mapa de riesgos|Peligros y riesgos/i)
  })
})
```

- [ ] **Step 2: Escenario: «Nueva MIPER», la Jefa en la portada y el paso 14**

En `e2e/prevencion-miper-escenario.spec.ts`:

1. Línea 2: agregar `listRecord` al import de `./helpers`:

   ```ts
   import { expectPageTitle, listRecord, login, pickCurrentMonthDate, textoVisible, MINIMAL_PNG } from "./helpers"
   ```

2. Línea 30 de la tabla de cobertura: reemplazar
   ``| 14 avance general (Resumen + programa) | 6 | F3: `dashboard-panel.tsx` |`` por:

   ```
   | 14 avance general (Resumen de la MIPER + portada + programa) | 6 | Fase B: pestaña «Resumen» y fila de la portada |
   ```

   (Sólo cambia el contenido de la fila; el ` * ` del comentario se queda.)

3. Líneas 125-128 (paso 1): reemplazar

   ```ts
     // Dos "Nueva MIPER" en pantalla —el CTA del header y el del estado vacío—, el
     // mismo alta ofrecida en dos sitios; no es la copia móvil/escritorio de un
     // `DataTable`, y el CTA del header va primero en el DOM.
     await page.getByRole("button", { name: "Nueva MIPER" }).first().click()
   ```

   por:

   ```ts
     // «Nueva MIPER» vive en la cabecera. La portada por faena (Fase B) ya no
     // repite el alta en un estado vacío, y la fila de una faena sin MIPER ofrece
     // «Crear MIPER de <faena>», que es otro nombre.
     await cabecera(page).getByRole("button", { name: "Nueva MIPER", exact: true }).click()
   ```

4. Líneas 229-232 (pasos 8–9): reemplazar

   ```ts
     await jefa.goto("/prevencion/miper")
     // La tarjeta de la bandeja se identifica por el enlace a ESTA MIPER y no por el
     // rótulo suelto (que podría repetirse con otra ronda pendiente).
     await expect(jefa.locator(`a[href="/prevencion/miper/${id}"]`)).toContainText("Pendiente de tu revisión")
   ```

   por:

   ```ts
     await jefa.goto("/prevencion/miper")
     // Fase B: la portada por faena da un enlace por cada MIPER que espera algo de
     // ti, «<motivo> · MIPER <período>». Se busca el de ESTE período y se comprueba
     // que lleva a ESTA MIPER. La fila y la tarjeta móvil lo repiten; `getByRole`
     // sólo ve la visible.
     await expect(jefa.getByRole("link", { name: `Pendiente de tu revisión · MIPER ${PERIOD}`, exact: true })).toHaveAttribute("href", `/prevencion/miper/${id}`)
   ```

5. Reemplazar el test completo del paso 14 (desde
   `test("paso 14: la Jefa consulta el avance general en la pestaña «Resumen» y en el programa", …`
   hasta su `})`) por:

   ```ts
   test("paso 14: la Jefa consulta el avance en el «Resumen» de la MIPER, en la portada y en el programa", async ({ browser }) => {
     const jefa = await as(browser, "jefa.prevencion@e2e.chome.cl")
     await jefa.goto(`${miperUrl}?tab=resumen`)
     await expectPageTitle(jefa, /^MIPER Faena E2E/)
     await expect(jefa.getByRole("tab", { name: "Resumen", selected: true })).toBeVisible()

     // Las cifras del Resumen que enlazan (A1). «No controlados» está en 0 (los dos riesgos quedaron
     // «Parcialmente»), así que no enlaza: se ve, pero no lleva a una lista vacía.
     for (const rotulo of [/^Riesgos completos/, /^Importantes e Intolerables/, /^Avance del programa/]) {
       await expect(jefa.getByRole("link", { name: rotulo })).toBeVisible()
     }
     // El avance es el que deriva `programProgress` de las ocurrencias: 1 de 3.
     const avance = jefa.getByRole("link", { name: /^Avance del programa/ })
     await expect(avance).toContainText("33%")
     await expect(avance).toContainText("1/3 realizadas")
     // La completitud por actividad, en el orden del RE-04.
     await expect(jefa.getByRole("progressbar", { name: /^Operación de la correa transportadora: / })).toBeVisible()

     // La fila de la faena en la portada muestra el mismo avance (el programa de la vigente).
     await jefa.goto("/prevencion/miper")
     await expect(listRecord(jefa, "Faena E2E")).toContainText("33% · 1/3")

     // «Elaboró» en la franja de la matriz: sin ronda abierta, quien elaboró la v1.
     await jefa.goto(miperUrl)
     await expect(jefa.getByRole("definition").filter({ hasText: "Prevencionista Faena E2E" })).toBeVisible()

     // La cifra del programa lleva a la pestaña Programa, que dice lo mismo.
     await jefa.goto(`${miperUrl}?tab=resumen`)
     await jefa.getByRole("link", { name: /^Avance del programa/ }).click()
     await expect(jefa).toHaveURL(/tab=programa/)
     await expect(jefa.getByRole("heading", { name: "Programa de Trabajo Preventivo RE-04.1" })).toBeVisible()
     await expect(jefa.getByText("1/3 realizadas")).toBeVisible()
   })
   ```


- [ ] **Step 3: Flujo y programa**

En `e2e/prevencion-miper-flujo.spec.ts`:

1. Líneas 54-57: el mismo reemplazo del punto 3 del Step 2. El comentario es idéntico, así que se
   reemplaza por el mismo bloque con `cabecera(page)`.

2. Líneas 139-145: reemplazar

   ```ts
     await jefa.goto("/prevencion/miper")
     // La bandeja de la Jefatura puede traer más de una ronda pendiente —la base
     // E2E es compartida y cualquier otra prueba que envíe una MIPER deja la suya—,
     // así que la tarjeta esperada se identifica por el enlace a ESTA MIPER y no
     // por el rótulo suelto (que pasaría a resolver dos nodos).
     const id = miperUrl.split("/").pop()!
     await expect(jefa.locator(`a[href="/prevencion/miper/${id}"]`)).toContainText("Pendiente de tu revisión")
   ```

   por:

   ```ts
     await jefa.goto("/prevencion/miper")
     // La base E2E es compartida: otra prueba puede dejar su propia ronda pendiente
     // en la misma faena. La portada por faena (Fase B) da un enlace por cada MIPER
     // que espera algo de ti, «<motivo> · MIPER <período>»: se busca el de ESTE
     // período y se comprueba que lleva a ESTA MIPER.
     const id = miperUrl.split("/").pop()!
     await expect(jefa.getByRole("link", { name: `Pendiente de tu revisión · MIPER ${PERIOD}`, exact: true })).toHaveAttribute("href", `/prevencion/miper/${id}`)
   ```

En `e2e/prevencion-miper-programa.spec.ts:70`, reemplazar
`await page.getByRole("button", { name: "Nueva MIPER" }).first().click()` por:

```ts
  await cabecera(page).getByRole("button", { name: "Nueva MIPER", exact: true }).click()
```

- [ ] **Step 4: `densidad-kpi`**

En `e2e/densidad-kpi.spec.ts`:

1. En `PANTALLAS`, después de `{ path: "/prevencion/emergencias", name: "Emergencias" },`, agregar:

   ```ts
     // Fase B: la portada MIPER por faena tiene franja (SummaryBar, no tarjetas) y dos filtros a la vista.
     { path: "/prevencion/miper", name: "MIPER" },
   ```

2. Línea 164: reemplazar
   `{ vista: "prevencion", label: "Riesgos críticos sin control", destino: "/prevencion/miper?tab=todas" },`
   por:

   ```ts
       { vista: "prevencion", label: "Riesgos críticos sin control", destino: "/prevencion/miper?sincontrol=1" },
   ```

3. En el test «cada destino acotado reconoce su filtro y ofrece quitarlo», antes de su `})` final,
   agregar:

   ```ts
       // Fase B: la portada MIPER reconoce «sin control» con un chip que se puede quitar.
       await page.goto("/prevencion/miper?sincontrol=1")
       await page.waitForLoadState("networkidle").catch(() => undefined)
       await expect(page.getByRole("button", { name: "Eliminar filtro Riesgos críticos", exact: true })).toBeVisible()
   ```

- [ ] **Step 5: axe sobre el Resumen y el menú «Cambiar de faena»**

En `e2e/accessibility.spec.ts`, dentro de `test.describe("Accessibility audit — MIPER: vistas del
espacio de trabajo", …)`, después del test «tarea, los cuatro pasos del editor y la ficha del
documento», agregar:

```ts
  test("la pestaña Resumen y el menú «Cambiar de faena» (Fase B)", async ({ page }) => {
    await login(page)
    await page.goto(MIPER_VIGENTE)
    await page.waitForLoadState("networkidle")

    await page.getByRole("tab", { name: "Resumen", exact: true }).click()
    await expect(page.getByRole("link", { name: /^Riesgos completos/ })).toBeVisible()
    await sinAnimaciones(page)
    await auditar(page)

    // La lista se pide al abrir el menú: se espera a que llegue antes de auditar.
    await cabecera(page).getByRole("button", { name: "Cambiar de faena", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: "Ver todas las faenas", exact: true })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: /^Faena / })).not.toHaveCount(0)
    await sinAnimaciones(page)
    await auditar(page)
  })
```

- [ ] **Step 6: Puertas sin navegador y commit**

```bash
npm run typecheck
npm run lint -- e2e/prevencion-miper-matriz.spec.ts e2e/prevencion-miper-escenario.spec.ts e2e/prevencion-miper-flujo.spec.ts e2e/prevencion-miper-programa.spec.ts e2e/densidad-kpi.spec.ts e2e/accessibility.spec.ts
git add e2e/prevencion-miper-matriz.spec.ts e2e/prevencion-miper-escenario.spec.ts e2e/prevencion-miper-flujo.spec.ts e2e/prevencion-miper-programa.spec.ts e2e/densidad-kpi.spec.ts e2e/accessibility.spec.ts
git commit -m "test(miper): E2E de la portada por faena, «Crear MIPER» desde una fila y el Resumen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Primero el commit, porque el worktree sólo ve lo commiteado.

- [ ] **Step 7: Correr las E2E desde un worktree**

Con la receta de Global Constraints, en este orden y de a un spec. Desde la segunda corrida va
`E2E_SKIP_BUILD=true`:

1. `npm run test:e2e -- e2e/prevencion-miper-matriz.spec.ts` (construye)
2. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-escenario.spec.ts`
3. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-flujo.spec.ts`
4. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-programa.spec.ts`
5. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-interacciones.spec.ts`
6. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-controles.spec.ts`
7. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/densidad-kpi.spec.ts`
8. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/accessibility.spec.ts -g "miper|MIPER"`. Recorre con
   axe la portada nueva, `[id]`, factores, las vistas del espacio de trabajo y, desde el Step 5, el
   Resumen y el menú «Cambiar de faena».

Expected: todo PASS. Es el criterio de aceptación B.
- Las corridas 5 y 6 no se tocaron, pero el espacio de trabajo ganó una pestaña y un botón de
  cabecera: confirman que no hubo regresión.
- Anotar el conteo por spec para el informe (Task 11).
- Si una falla: trace, causa y arreglo en un commit `fix(miper): …`. Después, worktree nuevo desde el
  HEAD nuevo y repetir **ese** spec.

---

### Task 11: Recorrido en navegador, informe QA, manual y spec

**Files:**
- Create: `qa/reports/2026-10-03-miper-b.md`. Si la verificación se hace otro día, se usa la fecha
  real en el nombre (`AAAA-MM-DD`).
- Modify:
  - `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`: §2 (líneas
    29 y 33), §3 (líneas 73-97 y la viñeta de la línea 102) y §9 (línea 350);
  - `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`: línea 3, §2.3 (línea 88) y
    §7 (líneas 403-425).
- Temporal (no se versiona; se borra al terminar): `qa-b-sonda.mjs` en la raíz del repo.

**Interfaces:**
- Consumes:
  - las tareas 1–10 ya commiteadas;
  - la medición del commit de la Task 2 (`git log --grep "Medición en bodega_dev"`);
  - los conteos E2E de la Task 10;
  - el `next dev` del usuario en :3001 (`bodega_dev`);
  - la sesión `playwright/.auth/monkeytest.json`.
- Produces: la evidencia de la fase y la documentación al día.

**Regla del recorrido:** `bodega_dev` es de solo lectura en esta verificación.
- «Crear MIPER» se abre y se cancela, sin crear. La creación real la cubre la E2E de la Task 10.
- No se edita ningún riesgo, ficha ni medida.
- Si la sesión QA expiró, se regenera con `node scripts/qa-login.mjs`. Nunca se imprime.

- [ ] **Step 1: Preparación (sólo lectura)**

```bash
cd /home/allopze/dev/chome/bodega
DEV_DB=$(node -e 'const { loadEnvConfig } = require("@next/env"); loadEnvConfig(process.cwd(), true, { info() {}, error() {} }); process.stdout.write(process.env.DATABASE_URL)')
case "$DEV_DB" in *:5433/*) ;; *) echo "No es bodega_dev (:5433): no se sigue"; exit 1;; esac
psql "$DEV_DB" -At -c "BEGIN READ ONLY; SELECT count(*), max(created_at) FROM drizzle.__drizzle_migrations; ROLLBACK;"
node -e 'const j = require("./db/migrations/meta/_journal.json"); console.log(j.entries.length, j.entries.at(-1).when)'
psql "$DEV_DB" -At -c "BEGIN READ ONLY; SELECT 'faenas', count(*) FILTER (WHERE is_active), count(*) FROM worksites; SELECT 'mipers', status, review_state, is_legacy, count(*) FROM prevention_risk_matrices GROUP BY 2,3,4 ORDER BY 2,3,4; SELECT 'riesgos', count(*) FROM prevention_risk_entries; SELECT 'medidas', count(*) FROM prevention_risk_controls; ROLLBACK;"
```

- Si las migraciones aplicadas no calzan con el journal, todo el shell da 500: se informa y no se
  sigue.
- Nunca imprimir `$DEV_DB`.
- La MIPER del recorrido es la de 222 riesgos (`riskmatrix-7fJbp_csGgyQu8qUbYbiC`, «Oficina Central
  2099»). Si ya no existe, la MIPER con más riesgos; anotar su id.
- Guardar los conteos: al final tienen que ser los mismos.

- [ ] **Step 2: Sonda automática**

Crear `qa-b-sonda.mjs` en la raíz y correrla con `MIPER_ID=<id> node qa-b-sonda.mjs`:

```js
// qa-b-sonda.mjs — sonda TEMPORAL de la Task 11 (Fase B). Va en la raíz del repo para
// resolver @playwright/test. NO se versiona: `rm qa-b-sonda.mjs` al terminar.
// Sólo lee: no crea, no guarda, no envía. La sesión QA es una credencial: no se imprime nada de ella.
import { chromium } from "@playwright/test"

const BASE = "http://localhost:3001"
const PORTADA = `${BASE}/prevencion/miper`
const MIPER = `${BASE}/prevencion/miper/${process.env.MIPER_ID}`
const browser = await chromium.launch()
const anotar = (caso, comprobacion, valor) => console.log(JSON.stringify({ caso, comprobacion, valor }))

async function abrir(viewport) {
  const context = await browser.newContext({ storageState: "playwright/.auth/monkeytest.json", viewport })
  const page = await context.newPage()
  const errores = []
  const acciones = []
  page.on("console", (message) => { if (message.type() === "error") errores.push(message.text().slice(0, 160)) })
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().includes("dicebear")) errores.push(`${response.status()} ${new URL(response.url()).pathname}`) })
  // Una Server Function viaja como POST con la cabecera `next-action`.
  page.on("request", (request) => { if (request.method() === "POST" && request.headers()["next-action"]) acciones.push(new URL(request.url()).pathname) })
  return { context, page, errores, acciones }
}
const filas = (page) => page.locator("tbody tr[data-worksite-id]")
const cifraDe = async (link, rotulo) => Number(((await link.textContent()) ?? "").slice(rotulo.length).match(/\d+/)?.[0] ?? Number.NaN)
const sinScrollHorizontal = (page) => page.evaluate(() => {
  const pozo = document.querySelector("[data-shell-scroll]")
  return document.documentElement.scrollWidth <= innerWidth && (!pozo || pozo.scrollWidth <= pozo.clientWidth)
})

{ // 1440×900 — portada
  const { context, page, errores } = await abrir({ width: 1440, height: 900 })
  const inicio = Date.now()
  await page.goto(PORTADA)
  await page.getByRole("table", { name: "MIPER por faena" }).waitFor()
  anotar("portada", "ms hasta la tabla (next dev; la primera carga incluye compilar)", Date.now() - inicio)
  anotar("portada", "filas sin filtros", await filas(page).count())
  for (const [rotulo, destino] of [["Faenas con MIPER", "estado=con_miper"], ["En revisión", "estado=en_revision"], ["Requieren mi acción", "vista=mias"]]) {
    await page.goto(PORTADA)
    const link = page.getByRole("link", { name: new RegExp(`^${rotulo}`) })
    const cifra = await cifraDe(link, rotulo)
    await link.click()
    await page.waitForURL((url) => url.search === `?${destino}`)
    anotar("franja", `${rotulo}: [cifra, filas al llegar]`, [cifra, await filas(page).count()])
  }
  await page.goto(PORTADA)
  const critica = page.getByRole("link", { name: /^Riesgos críticos sin control/ })
  const total = await cifraDe(critica, "Riesgos críticos sin control")
  await critica.click()
  await page.waitForURL((url) => url.search === "?sincontrol=1")
  const porFila = await filas(page).evaluateAll((rows) => rows.map((row) => Number(row.textContent?.match(/(\d+) críticos? sin control/)?.[1] ?? 0)))
  anotar("franja", "Riesgos críticos sin control: [cifra, suma por fila]", [total, porFila.reduce((a, b) => a + b, 0)])
  await page.goto(`${BASE}/dashboard?vista=prevencion`)
  const kpi = page.locator("[data-kpi-card]").filter({ hasText: "Riesgos críticos sin control" })
  const enlaceKpi = page.locator("a:has([data-kpi-card])").filter({ hasText: "Riesgos críticos sin control" })
  anotar("tablero", "KPI «Riesgos críticos sin control» [valor, href]", [
    ((await kpi.textContent().catch(() => "")) ?? "").match(/control\s*(\d+)/)?.[1] ?? "(sin KPI)",
    await enlaceKpi.getAttribute("href").catch(() => null),
  ])
  await page.goto(`${PORTADA}?tab=porhacer`)
  anotar("compat", "?tab=porhacer → «Requieren mi acción» presionado", await page.getByRole("button", { name: "Requieren mi acción", exact: true }).getAttribute("aria-pressed"))
  await page.getByRole("button", { name: "Todas las faenas", exact: true }).click()
  await page.waitForURL((url) => !url.search.includes("tab="))
  anotar("compat", "cambiar de vista borra el `tab` heredado (search)", new URL(page.url()).search)
  await page.goto(`${PORTADA}?tab=todas`)
  anotar("compat", "?tab=todas → «Todas las faenas» presionado", await page.getByRole("button", { name: "Todas las faenas", exact: true }).getAttribute("aria-pressed"))
  // «Crear MIPER»: sólo abrir y cancelar. Esta verificación no escribe en bodega_dev.
  await page.goto(PORTADA)
  const crear = page.getByRole("button", { name: /^Crear MIPER de / })
  if (await crear.count() > 0) {
    const faena = (await crear.first().getAttribute("aria-label"))?.replace("Crear MIPER de ", "")
    await crear.first().click()
    const dialogo = page.getByRole("dialog", { name: "Nueva MIPER" })
    anotar("crear", "[faena de la fila, faena elegida en el diálogo]", [faena, (await dialogo.getByRole("combobox").textContent())?.trim()])
    await page.keyboard.press("Escape")
  } else {
    anotar("crear", "faenas sin MIPER con «Crear MIPER»", 0)
  }
  anotar("consola/red", "portada 1440×900", errores)
  await context.close()
}

{ // 1440×900 — espacio de trabajo: Resumen y «Cambiar de faena»
  const { context, page, errores, acciones } = await abrir({ width: 1440, height: 900 })
  await page.goto(`${MIPER}?tab=resumen&buscar=zzz&clasificacion=moderate`)
  await page.getByRole("tab", { name: "Resumen", selected: true }).waitFor()
  for (const rotulo of ["Riesgos completos", "Importantes e Intolerables", "No controlados", "Avance del programa"]) {
    const link = page.getByRole("link", { name: new RegExp(`^${rotulo}`) })
    anotar("resumen", `${rotulo}: href`, await link.count() ? await link.getAttribute("href") : "(sin enlace: cifra en 0)")
  }
  anotar("resumen", "Server Functions al pintar (esperado 0)", acciones.length)
  const completos = page.getByRole("link", { name: /^Riesgos completos/ })
  const texto = await completos.textContent()
  await completos.click()
  await page.waitForURL(/completitud=/)
  anotar("resumen", "Riesgos completos → [texto de la cifra, search al llegar]", [texto, new URL(page.url()).search])
  // La última actividad (la más abajo) → su tarjeta en la matriz, a la vista y con el foco.
  await page.goto(`${MIPER}?tab=resumen`)
  const actividad = page.locator('a[href*="#miper-activity-"]').last()
  const destino = (await actividad.getAttribute("href")).split("#")[1]
  await actividad.click()
  await page.waitForFunction((id) => {
    const target = document.getElementById(id)
    if (!target) return false
    const box = target.getBoundingClientRect()
    return box.top >= 0 && box.top < innerHeight
  }, destino)
  anotar("resumen", "actividad a la vista; el foco está en su tarjeta", await page.evaluate(() => document.activeElement?.closest("h2")?.id ?? null))
  const antes = acciones.length
  await page.getByRole("button", { name: "Cambiar de faena" }).click()
  await page.getByRole("menuitem", { name: "Ver todas las faenas" }).waitFor()
  await page.waitForTimeout(500)
  anotar("selector", "Server Functions al abrir (esperado 1)", acciones.length - antes)
  anotar("selector", "opciones", await page.getByRole("menuitem").allTextContents())
  await page.keyboard.press("Escape")
  anotar("consola/red", "espacio de trabajo 1440×900", errores)
  await context.close()
}

{ // 390×844 — sin scroll horizontal
  const { context, page, errores } = await abrir({ width: 390, height: 844 })
  await page.goto(PORTADA)
  await page.getByRole("article").first().waitFor()
  anotar("390", "portada sin scroll horizontal", await sinScrollHorizontal(page))
  await page.goto(`${MIPER}?tab=resumen`)
  await page.getByRole("tab", { name: "Resumen", selected: true }).waitFor()
  anotar("390", "Resumen sin scroll horizontal", await sinScrollHorizontal(page))
  anotar("consola/red", "390×844", errores)
  await context.close()
}

await browser.close()
```

Criterios de la sonda:

| Caso | Criterio |
|---|---|
| franja | En cada cifra, `cifra === filas al llegar`. En «sin control», `cifra === suma por fila`. |
| tablero | El valor del KPI es el mismo de la franja y su `href` es `/prevencion/miper?sincontrol=1`. |
| compat | `?tab=porhacer` → `"true"`; al cambiar de vista, `search` queda sin `tab`; `?tab=todas` → `"true"`. |
| crear | La faena de la fila y la del diálogo coinciden. |
| resumen | Las cifras de la matriz llevan sólo su filtro (sin `buscar` ni `clasificacion=moderate`). 0 Server Functions al pintar. La actividad queda a la vista y con el foco (el id de su `h2`). |
| selector | Exactamente 1 Server Function al abrir. Las opciones incluyen «Ver todas las faenas». |
| 390 | Sin scroll horizontal (`true`). |
| consola/red | Sin errores. dicebear es ruido conocido. |

- [ ] **Step 3: Recorrido manual (1440×900 y teclado)**

| Qué hacer | Qué tiene que pasar |
|---|---|
| En la portada, Tab por la franja, el segmento y el filtro de estado; Enter en «Requieren mi acción». | Foco visible en cada cifra y en cada botón. La lista se filtra sin subir el scroll. |
| Escribir parte del nombre de una faena en el buscador del TopBar. | La tabla se filtra. Sin coincidencias, el vacío dice «Ninguna faena coincide con la búsqueda». |
| `?faena=<id de una faena>`. | Una sola fila y el chip «Faena: <nombre>». «Eliminar filtro Faena» lo quita. |
| En la MIPER del recorrido, «Contraer todo» en la matriz → pestaña Resumen → clic en una actividad. | La actividad llega desplegada y a la vista. «Contraer todo» se puede restaurar después; es preferencia de `sessionStorage`, no un dato. |
| «Cambiar de faena» → elegir una faena «sin MIPER». | Lleva a la portada `?faena=…` con su chip, sin errores. |
| Resumen de la MIPER del recorrido a 1024 px. | Las cuatro cifras caben (envuelven) y no hay scroll horizontal. |

- [ ] **Step 4: Recuento después y limpieza**

Repetir los conteos del Step 1. Tienen que dar **los mismos números**. Luego `rm qa-b-sonda.mjs`.

- [ ] **Step 5: Informe `qa/reports/2026-10-03-miper-b.md`**

Mismo formato que `qa/reports/2026-10-03-miper-a2.md`. Secciones, en este orden:

1. **Alcance:** acotado a la Fase B (portada por faena, Resumen, «Elaboró», selector y KPI del
   tablero). No es una auditoría de la aplicación ni afirma cobertura total.
2. **Entorno y datos:**
   - migraciones;
   - faenas, MIPER, riesgos y medidas, antes y después (idénticos);
   - la medición de la Task 2, copiada de su commit.
3. **PASS:** una tabla con la medición de cada caso de la sonda y del recorrido manual.
4. **Hallazgos clasificados:** PRODUCT BUG, FUNCTIONAL FINDING, UX FINDING, INCONSISTENCY,
   AUTOMATION WARNING e IMPROVEMENT OPPORTUNITY. Si no hay hallazgos en una categoría, se dice.
5. **Errores de consola y fallas de red.**
6. **Cobertura de rutas y pasos.**
7. **COVERAGE GAP.** Como mínimo:
   - las acciones de revisión y firma en `bodega_dev`, que no tiene rondas (lo cubren la PGlite de la
     Task 4 y las E2E `escenario` y `flujo`);
   - «Elaboró» con datos reales (unitarias de la Task 9 y paso 14 de `escenario`);
   - una cifra «sin control» distinta de 0 en `bodega_dev`, que no tiene MIPER vigentes (PGlite de la
     Task 4);
   - una faena cerrada con MIPER (PGlite);
   - la creación real desde la fila (E2E de la Task 10);
   - un lector de pantalla real;
   - tiempos en producción (fuera de alcance: requieren autorización).
8. **Compuertas** (Step 7), con el conteo de pruebas, y **E2E** (Task 10), con el conteo por spec.
9. **Recomendaciones priorizadas.** Entre ellas: retirar `listMipers` / `listMiperInbox` en la Fase C
   (ver «Después de la Fase B»).

Nunca afirmar cobertura total.

- [ ] **Step 6: Manual y spec**

En `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`:

1. Línea 29: reemplazar el párrafo completo por:

   > Cada faena tiene **una MIPER por período**, entendiendo por período el año (2026, 2027, …). Al
   > abrir una MIPER encontrarás su espacio de trabajo con cinco pestañas: **Resumen · Matriz ·
   > Programa · Revisión · Historial**. Abre en la **Matriz**. En el encabezado están **"Cambiar de
   > faena"**, que lleva a la MIPER de otra faena de tu alcance, y **"Ficha del documento"**, donde se
   > completan los antecedentes.

2. Línea 33 (paso 1 de «Cómo crear la MIPER de un período nuevo»): reemplazar por:

   > 1. Entra a `/prevencion/miper` y presiona **"Nueva MIPER"**. Si la faena todavía no tiene MIPER,
   >    su fila ofrece **"Crear MIPER"**, que abre el mismo diálogo con la faena ya elegida.

3. Reemplazar las líneas 73-97 (desde `## 3. Cómo Consultar la MIPER de tu Faena` hasta antes de
   `### La cola «Mi trabajo»`) por el texto de abajo. «La cola «Mi trabajo»» y «Cómo se leen las
   bandas en pantalla» quedan como están.

   ```md
   ## 3. Cómo Consultar la MIPER de tu Faena

   `/prevencion/miper` es la **portada por faena**: una fila por cada faena de tu alcance, tenga o no MIPER. Las faenas cerradas siguen apareciendo mientras conserven una MIPER no reemplazada.

   ### La franja de cuatro cifras

   Arriba hay cuatro cifras. Cada una es un enlace que deja la lista **exactamente** en lo que cuenta, sin arrastrar otros filtros:

   | Cifra | Qué cuenta | Al hacer clic |
   |---|---|---|
   | **Faenas con MIPER** | Cuántas faenas de tu alcance tienen MIPER, sobre el total (x/y) | la lista de las faenas con MIPER |
   | **En revisión** | Faenas cuya MIPER está en revisión técnica o esperando a Legal y RRHH | esas faenas |
   | **Requieren mi acción** | Faenas con una MIPER que espera algo de ti | la vista "Requieren mi acción" |
   | **Riesgos críticos sin control** | Riesgos Intolerables de las MIPER vigentes (o críticos de la metodología anterior) a los que les falta una medida implementada o verificada, o una medida vinculada al PDTP | las faenas que los tienen; cada fila dice cuántos |

   La última cifra es **la misma** que el indicador "Riesgos críticos sin control" del tablero de inicio: las dos pantallas usan una sola definición.

   ### Todas las faenas o sólo las tuyas

   *   **"Todas las faenas"** (por defecto) y **"Requieren mi acción"** cambian la lista; cuántas faenas son lo dice la cifra de la franja. Una MIPER requiere tu acción si es tu borrador, tiene observaciones por responder o cambios sin enviar (si editas), espera tu revisión técnica (Jefatura) o tu firma (Legal y RRHH). **Quien envió una ronda no la ve como pendiente de su propia revisión.**
   *   El filtro **Estado** acota a *Con MIPER*, *Sin MIPER*, *Borrador*, *En revisión*, *Con observaciones* o *Vigente*.
   *   Para buscar una faena se usa el buscador de la barra superior ("Filtrar en esta página…").
   *   Los filtros que no tienen un control a la vista —la faena que llega desde el PDTP y "Riesgos críticos sin control"— aparecen como **chips** que se quitan de a uno. **"Limpiar filtros"** quita todo.

   ### Qué muestra cada fila

   *   **Faena:** su nombre (enlace a la MIPER), el período y la versión. Si la vigente es otra MIPER —por ejemplo, porque ya empezaste la del año siguiente—, aparece debajo como **"Vigente vN (AAAA)"**, también como enlace. Lo que espera de ti cada MIPER de la faena aparece como enlace, por ejemplo **"Pendiente de tu revisión · MIPER 2027"**.
   *   **Estado**, con quién envió la ronda en curso. Una faena sin MIPER dice **"Sin MIPER"** y, si puedes editar, ofrece **"Crear MIPER"**.
   *   **Dotación:** la de la ficha de la MIPER o, si no la tiene, los trabajadores activos de la faena.
   *   **Completitud:** riesgos sin datos pendientes sobre el total, la misma cuenta que "Completos x de y" dentro de la MIPER. Una MIPER de la metodología anterior dice *"Metodología anterior"*, sin cifra.
   *   **Importantes e Intolerables**, y cuántos **críticos sin control** tiene la vigente.
   *   **Programa:** el avance del Programa de Trabajo de la vigente (ver "El avance", sección 9).
   *   **Actualizada:** la última modificación.

   > [!NOTE]
   > Los enlaces antiguos siguen funcionando: `?tab=porhacer` abre "Requieren mi acción", y `?tab=todas` o `?tab=resumen`, la lista completa.

   ### La pestaña «Resumen» de cada MIPER

   Dentro de una MIPER, la pestaña **Resumen** lee el documento de una vez. Tiene cuatro cifras, y las tres primeras llevan a la matriz ya filtrada **después de quitar cualquier búsqueda o filtro que tuvieras**, para que lo que ves al llegar sea lo que la cifra contó:

   | Cifra | Qué cuenta | Al hacer clic |
   |---|---|---|
   | **Riesgos completos** | Riesgos sin datos pendientes, sobre el total | la matriz con los riesgos **con pendientes** (o con los completos, si no queda ninguno pendiente) |
   | **Importantes e Intolerables** | Riesgos en las dos bandas más graves | la matriz filtrada por esas bandas |
   | **No controlados** | Riesgos con "¿Está controlado?" en *No* | la matriz filtrada por *No controlados* |
   | **Avance del programa** | Ocurrencias realizadas del Programa de Trabajo | la pestaña **Programa** |

   Una cifra en cero no lleva a ninguna parte: no hay nada que mostrar.

   Debajo, **"Completitud por actividad"** muestra una barra por actividad, en el orden del RE-04. Su nombre lleva a la tarjeta de esa actividad en la matriz, y la despliega si la habías plegado.

   > [!NOTE]
   > El avance es el **mismo** que deriva el Programa de Trabajo de las ocurrencias (ver "El avance", sección 9). Nunca se ingresa a mano.

   En la franja de la matriz, **"Elaboró"** dice quién envió la ronda en curso o, si no hay ninguna, quién elaboró la última versión aprobada.
   ```

4. Línea 350 (§9): reemplazar `junto a Matriz, Revisión e Historial` por
   `junto a Resumen, Matriz, Revisión e Historial`.

5. Línea 102 («La cola «Mi trabajo»»): al final de la viñeta que empieza con
   `*   **Revisar la MIPER {período}**`, agregar:

   > Quien envió la ronda no la recibe en su cola: no puede revisar ni firmar lo que envió.

En `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`:

1. Línea 3: `Estado: **Fase A implementada, con el pulido A2**` →
   `Estado: **Fase A (con el pulido A2) y Fase B implementadas**`.

2. Línea 88: reemplazar `| Migas + cabecera. El selector de faena se agrega en la Fase B. |` por
   `| Migas + cabecera. «Cambiar de faena» va en las acciones de la cabecera (Fase B): las migas sólo se ven desde 1280 px. |`.

3. Reemplazar §7 completa (líneas 403-425, desde `## 7. Fase B: portada y Resumen` hasta antes de
   `## 8. Fase C`) por:

   ```md
   ## 7. Fase B: portada y Resumen

   Implementada. Plan: `docs/superpowers/plans/2026-10-03-miper-b-portada.md`. Respecto de la versión
   anterior de esta sección: la cuarta cifra pasó a ser «Riesgos críticos sin control» y el servicio
   vive en `portfolio.ts` (plan maestro de 2026-10-02).

   - **`listMiperPortfolio(access)`** (`lib/services/miper/portfolio.ts`, `prevention:risk:view`):
     - Una fila por faena en alcance (`scopeCondition`): las activas y las cerradas que todavía
       tienen una MIPER no reemplazada. Las faenas sin MIPER vienen con `matrix: null`.
     - La fila es la MIPER no reemplazada de **mayor período**. Si la vigente es otra, va aparte
       («Vigente vN (AAAA)»). Las reglas puras están en `lib/prevention/miper/portfolio.ts`.
     - Campos:
       - estado: `sin_miper` · `borrador` · `en_revision` · `observada` · `vigente`;
       - versión y `updatedAt`;
       - dotación: la de la ficha o, sin ella, los trabajadores activos;
       - completitud: riesgos sin errores ÷ riesgos, con la regla de «Completos x de y» del espacio
         de trabajo; sin cifra en la metodología anterior;
       - Importantes e Intolerables;
       - «riesgos críticos sin control» y avance del programa, los dos **de la vigente**;
       - quién envió la ronda abierta;
       - `myActions`.
     - `myActions` / `requiresMyAction`: la regla de la bandeja (`miperInboxReason`,
       `lib/prevention/miper/inbox.ts`) aplicada a **todas** las MIPER no reemplazadas de la faena, no
       sólo a la de la fila. Excluye a quien envió la ronda, como `workspace-mode.ts`.
     - Sin N+1: las fotos salen en lote (`buildMiperSnapshots`). `buildMiperSnapshot` es su caso de
       una, con prueba dorada de que su salida (y por lo tanto `snapshotSha`) no cambió.
   - **«Riesgos críticos sin control»:** una sola definición (`lib/prevention/miper/critical-control.ts`)
     para el KPI del tablero y la portada. Es el Intolerable vigente (o `isCritical` en una fila legacy
     sin clasificación) al que le falta una medida implementada o verificada, o una medida con vínculo
     PDTP activo.
   - **Portada:**
     - `SummaryBar` con cuatro cifras, cada una a su subconjunto y sólo a él:
       - faenas con MIPER x/y (`?estado=con_miper`);
       - en revisión (`?estado=en_revision`);
       - requieren mi acción (`?vista=mias`);
       - riesgos críticos sin control (`?sincontrol=1`).

       Filtran con `replace` y sin mover el scroll (`SummaryBar.renderLink`).
     - `SegmentedControl` «Todas las faenas» / «Requieren mi acción» y filtro de estado. La cifra de
       «Requieren mi acción» vive sólo en la franja (A5); el segmento no la repite. Que «En revisión»
       escriba la misma clave `estado` que el filtro no es una segunda representación: es la cifra
       que filtra, como pide A1.
     - `DataTable` con fila y tarjeta móvil (`id` = faena). La búsqueda la da el TopBar (D8).
     - «Crear MIPER» en la fila de una faena sin MIPER abre `NewMiperDialog` (ahora controlado) con
       la faena ya elegida.
     - Se retiraron las pestañas Resumen / Por hacer / Todas, el filtro «Responsable»,
       `dashboard-panel.tsx` y `getMiperDashboard` (`dashboard.ts`).
     - Enlaces viejos:
       - `?tab=porhacer` → `vista=mias`;
       - `?tab=todas|resumen` → la vista por defecto;
       - `?faena=` (PDTP) acota a la faena con un chip;
       - el KPI del tablero apunta a `?sincontrol=1`.
   - **Pestaña Resumen del espacio de trabajo** (`?tab=resumen`; la matriz sigue siendo la pestaña
     por defecto, §3):
     - Cuatro cifras:
       - riesgos completos x/y → `completitud=pendientes` (o `completos`, si no queda ninguno);
       - Importantes e Intolerables → `clasificacion=important,intolerable`;
       - no controlados → `controlado=no`;
       - avance del programa → `tab=programa`.

       Las tres primeras **quitan los seis filtros de la matriz** antes de aplicar el suyo
       (`hrefToMatrixOnly`). Una cifra en cero no enlaza.
     - La completitud por actividad, en barras (`Progress`). Cada una lleva a su tarjeta
       (`#miper-activity-<clave>`) y la despliega si estaba plegada.
     - El avance sale de `getProgramProgress`, en `[id]/page.tsx`. La Fase E lo reemplaza por
       `getProgramWorkspace().progress`.
   - **Contexto del espacio de trabajo:**
     - «Elaboró» es quien envió la ronda abierta o, sin ronda, quien elaboró la última versión
       aprobada.
     - «Cambiar de faena» (cabecera) pide la lista al abrirse (`listMiperWorksiteTargetsAction`) y
       navega con `router.push`.
   - **«Mi trabajo»:** la rama de revisión MIPER de la cola (`operational-work-queue.ts`) excluye la
     ronda que envió la misma persona, con la regla de `miperInboxReason`. Antes le ofrecía «Revisar» o
     «Firmar» y el servicio lo rechazaba (`assertNotSubmitter`).
   - **Arreglos:** el título de `loading.tsx` ya se había corregido en la Fase A. `dashboard.ts`, que
     reemplazaba la query entera al enlazar, se retiró.
   ```

- [ ] **Step 7: Puertas**

```bash
npm run typecheck && npm run lint && npm run test:fast && npm run check:secrets && npm run doctor
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
npm run test:pglite -- lib/__tests__/miper-snapshot-service.test.ts
npm run test:pglite -- lib/__tests__/miper-portfolio.test.ts
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
npm run test:pglite -- lib/__tests__/miper-workflow.test.ts
npm run test:pglite -- lib/__tests__/miper-import.test.ts
npm run test:pglite -- lib/__tests__/miper-work-queue.test.ts
```

Expected: verde. `db:verify-migrations` no aplica, porque no hay migración. Anotar en el informe los
conteos de `test:fast` (archivos y pruebas) y los resultados de PGlite. Los `test:pglite` van de a uno.

- [ ] **Step 8: Commit**

```bash
git status --short   # qa-b-sonda.mjs NO debe aparecer (ya borrado); el .gitignore modificado NO se agrega
git add docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md qa/reports/2026-10-03-miper-b.md
git commit -m "docs(miper): manual y spec al día con la portada por faena e informe de verificación de la Fase B" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Autorrevisión contra el plan maestro (sección B)

| Pedido del plan maestro | Task |
|---|---|
| `listMiperPortfolio(access)` en `portfolio.ts`, con `prevention:risk:view` | 4 |
| Faenas con `scopeCondition`: activas, más las inactivas con MIPER | 4 (PGlite: faena D sí, faena E no) |
| Se reutiliza `buildRows` | 4 (exportada) |
| Fila = MIPER no reemplazada de mayor período, más «Vigente vN (AAAA)» | 3 (`pickCurrentMatrices`) y 4 |
| Estado, versión, dotación (ficha o trabajadores), `updatedAt` | 4 |
| Completitud (legacy → «Metodología anterior», sin cifra) | 4 y 7 |
| Importantes + Intolerables | 4 y 7 |
| `requiresMyAction`: predicado extraído de la bandeja, sin quien envió la ronda | 3 (`miperInboxReason`) y 4 |
| `submittedByName` | 4 y 7 |
| Avance del programa (`programProgress` + ocurrencias por MIPER) | 4 (`occurrencesByMatrix`, movida desde `dashboard.ts`) |
| `buildMiperSnapshots` en lote, `buildMiperSnapshot` como envoltorio y prueba dorada | 2 |
| Medición en `bodega_dev` | 2 (Step 5) y 11 (informe) |
| Franja de 4 cifras que llevan a su subconjunto | 3 (pura), 7 (UI) y 10 (E2E) |
| «Riesgos críticos sin control»: un solo predicado para el tablero y la portada | 1, 4 (igualdad PGlite) y 10 (igualdad E2E) |
| `SegmentedControl` «Todas» / «Requieren mi acción» (sin «(n)»: la cifra está sólo en la franja, A5), filtro de estado y búsqueda del TopBar vía `DataTable` | 7 |
| «Crear MIPER» por fila; `NewMiperDialog` con `initialWorksiteId` y `open` / `onOpenChange`, estado en la página | 6 y 7; E2E nueva en la 10 |
| Se retiran las pestañas, el filtro Responsable, `dashboard-panel.tsx` y `getMiperDashboard`, con sus pruebas | 7 |
| (Revisión del plan) «Mi trabajo» alineado con `miperInboxReason`: sin la ronda propia | 5 |
| Enlaces: `?tab=porhacer` → `vista=mias`; `?tab=todas|resumen` → por defecto; `?faena=`; KPI → `?sincontrol=1`; `densidad-kpi` | 3, 7 y 10 |
| Pestaña Resumen: `resumen` en `WORKSPACE_TABS`; 4 cifras que limpian `MATRIX_FILTER_KEYS`; avance de `getProgramProgress` (nota de la Fase E); `Progress` por actividad hacia `#miper-activity-<key>` | 8 |
| «Elaboró» = `openRound.submittedByName`, con respaldo en `versions[0].elaboratedByName` | 9 |
| Selector de faena cargado al abrir, con `router.push` | 9 |
| PGlite: faena sin MIPER, inactiva con MIPER, dos no reemplazadas, legacy, alcance, `requiresMyAction`, «sin control» | 4 |
| E2E: `matriz`, paso 14 de `escenario`, `densidad-kpi` y la nueva «Crear MIPER desde una faena sin MIPER» | 10 (más `flujo`, `programa` y el paso 8 de `escenario`, que dependían de la bandeja vieja) |
| Docs: manual §3–§4 | 11: §2, §3 y §9. La §4 (P×C) no habla de la portada. |
| Spec §7 al día | 11 |

**Nombres que cruzan tareas:**
- `isCriticalRisk` y `isCriticalWithoutControl`: Task 1 → Task 4.
- `buildMiperSnapshots`: Task 2 → Task 4.
- `miperInboxReason`, `pickCurrentMatrices`, `portfolioActionOrder`, `portfolioStatusOf`,
  `MiperPortfolioRow`, `MiperWorksiteTarget`: Task 3 → Tasks 4, 7 y 9.
- `parsePortfolioParams`, `portfolioHref`, `filterPortfolioRows`, `portfolioSummary`,
  `PORTFOLIO_SUMMARY_HREF`: Task 3 → Task 7.
- `buildRows` (exportada) y `MiperListRow.submittedByUserId`: Task 4.
- `listMiperPortfolio`: Task 4 → Task 7. `listMiperWorksiteTargets`: Task 4 → Task 9.
- `SummaryBar.renderLink` y `SummaryLinkProps`: Task 6 → Tasks 7 y 8.
- `NewMiperDialog` controlado: Task 6 → Task 7.
- `hrefToMatrixOnly`, `revealActivity`, `scrollToWhenReady`, `ResumenPanel` y la prop
  `programProgress` de `MiperWorkspaceView`: Task 8. La Task 9 vuelve a tocar el mismo test del
  espacio de trabajo y conserva el `NO_PROGRAM` que deja la 8.
- `openRound.submittedByName` y `listMiperWorksiteTargetsAction`: Task 9.

## Después de la Fase B

Integrar localmente en `main` con todo en verde, sin push (subirlo se consulta). Luego, el plan de la
**Fase C** (importación con medidas, spec §8), con este mismo formato, en `feat/miper-<fase>` desde
`main`. Las cifras de «medidas pendientes» que el plan maestro manda a la portada en la Fase C van
sobre `listMiperPortfolio`, no sobre el `dashboard.ts` que esta fase retira.

**Limpieza para la Fase C** («Decisiones», 12): retirar `listMipers` y `listMiperInbox`
(`lib/services/miper/queries.ts`), que desde B no tienen consumidor de producción.
- La Fase C ya toca `lib/__tests__/miper-import.test.ts`, que es uno de los que los usa (líneas 72,
  332 y 356).
- Esas aserciones pasan a `miperInboxReason` o a `listMiperPortfolio(…).rows[…].myActions`, y las de
  `lib/__tests__/miper-queries.test.ts` («la lista cuenta filas…» y «la bandeja…»), a
  `listMiperPortfolio`.
- `buildRows` se queda: la usan la cadena de la faena y la portada.
