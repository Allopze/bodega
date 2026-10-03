# MIPER — plan de implementación de la Fase D (acciones masivas)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar el mismo cambio a muchos riesgos o medidas de una MIPER en una sola operación atómica
—la misma medida en N riesgos, «¿Está controlado?» en N riesgos, responsable y plazo de N medidas, y
el contexto de toda una tarea—, con exactamente las reglas del guardado de a uno; y cerrar antes el
arrastre de la Fase C.

**Architecture:** Un servicio nuevo, `lib/services/miper/bulk.ts`, con tres operaciones
(`bulkPatchMiperEntries`, `bulkAddMiperControl`, `bulkUpdateMiperControls`). Cada una abre **una**
transacción con la matriz bloqueada (`lockMatrix`), exige `prevention:risk:edit` en su faena
(`requireAccess`) y una MIPER editable (`assertEditable`: ni legacy ni reemplazada), compara la versión
de cada elemento —una vieja aborta todo—, admite hasta 300 elementos y escribe una entrada de
historial por elemento con el `changeType` de siempre y el motivo «Edición masiva». Las reglas no se
copian: el servicio reutiliza `toColumns`, `touchMatrix` y un `controlResponsible` nuevo de
`entries.ts`, y `controlColumns` (D5) se muda a un módulo puro, `lib/prevention/miper/control-values.ts`,
que también usa la vista previa del cliente (`bulk-impact.ts`): antes de aplicar, cada diálogo dice qué
riesgos quedan con pendientes nuevos según `checkMiperCompleteness`. En el cliente, «Seleccionar» es un
modo (`useRiskSelection`) en la vista de la tarea y en la matriz filtrada; la barra fija (`BulkBar`)
abre tres diálogos; antes de leer versiones se esperan los guardados en curso (`whenIdle`) y después
se anotan las nuevas (`acknowledge`). «Editar contexto» aplica `bulkPatchMiperEntries` a toda la tarea,
cambia las filas en pantalla y navega con `replace` a la clave nueva (`taskKeyOf`).

**Tech Stack:** Next.js 16.3.8 (App Router), React 19.2, TypeScript 5.9, Zod 4, Drizzle 0.45, Tailwind
v4, Radix, Vitest 4 + Testing Library (jsdom; `@testing-library/jest-dom` ya viene cargado en
`components/__tests__/setup.ts`), PGlite 0.5, Playwright 1.62 y `@axe-core/playwright`. Antes de tocar
las Server Functions y la navegación, leer en `node_modules/next/dist/docs/`:
- `01-app/01-getting-started/07-mutating-data.md`, §«Revalidate data»: `revalidatePath` en la Server
  Function trae la foto nueva en la misma respuesta;
- `01-app/01-getting-started/04-linking-and-navigating.md`, §«Native History API» (línea 343):
  `pushState`/`replaceState` se integran con `useSearchParams`, que es como navega el espacio de
  trabajo (`workspace-nav.tsx`);
- `01-app/02-guides/data-security.md`, §«Validating client input» (línea 308): los ids y versiones que
  manda el cliente son entrada no confiable; el servidor relee y compara todo.

Y una lectura del código de Next que decide la Task 10 (verificada sobre la versión instalada):
- `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:263`
  resuelve la promesa de la acción (`resolve(actionResult)`) **antes** de aplicar el árbol
  revalidado. Lo que viene después de `await accion()` corre con las filas viejas todavía en pantalla.
- `node_modules/next/dist/client/components/app-router-instance.js:147-158`: un `replaceState` nativo
  (ACTION_RESTORE) despachado mientras la acción sigue pendiente la descarta, y como revalidó
  (`didRevalidate`, `server-action-reducer.js:226`) deja agendado un refresco (`:81-90`). Por eso
  «Editar contexto» cambia las filas en pantalla **antes** de navegar: la tarea nueva existe cuando la
  URL la pide, y la foto del refresco la reemplaza después.

**Spec:** `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` §9 (Fase D), con §3
(navegación nativa y memoria del scroll), §5.2 (`taskKeyOf`), §5.5 (guardado automático), §6.2
(formulario de medida), §13 (pruebas), §14 (criterio D) y §15. Alcance: plan maestro
`/home/allopze/.claude/plans/revisa-el-ui-ux-de-stateful-zebra.md`, sección «D. Acciones masivas (spec
§9)», más «Arrastre al cerrar la Fase C (al inicio de la Fase D)», que es la Task 1. Donde la spec y el
plan maestro difieren manda el plan maestro, que es posterior y está aprobado (versión por elemento
también al agregar medidas, `toColumns`/`touchMatrix` exportados, `whenIdle`). Decisiones del usuario
que siguen rigiendo (2026-10-02):
- **D5:** plazo obligatorio **sólo** para medidas por implementar (`!isExisting`); una existente se
  verifica con una frecuencia;
- toda medida nueva —también la que se agrega en lote— nace **`proposed`**;
- **regla crítica:** Importante no controlado e Intolerable exigen una medida **por implementar** con
  responsable y plazo.

Criterio de aceptación D (plan maestro): «una medida aplicada a 40 riesgos en una operación atómica.
Una versión vieja aborta todo (PGlite)». Lo cierran las dos primeras pruebas de la Task 4.

## Global Constraints

- **Rama:** `feat/miper-acciones-masivas` (ya creada desde `main` 1143bf50, que trae las Fases A, A2,
  B y C).
- **Sin migraciones.** Las operaciones en lote escriben columnas que ya existen
  (`prevention_risk_entries`, `prevention_risk_controls`, `audit_log.reason`). Ninguna tarea toca
  `db/schema` ni `db/migrations`. Si una se volviera imprescindible: `npm run db:generate`, checksum con
  `node scripts/verify-migration-chain.mjs --update-checksums`, `npm run db:verify-migrations`, y nunca
  editar `db/migrations/meta/_journal.json` ni una migración ya creada (AGENTS.md).
- **Autorización:** no cambian rutas, permisos ni `modules/*`. Las tres acciones nuevas van detrás de
  `guarded("prevention:risk:edit", …)` (`guardPermission` + revalidación) y el servicio vuelve a
  autorizar con `requireAccess(access, EDIT, matrix.worksiteId)`. El alcance y el actor salen de la
  sesión, nunca del input. Que «Seleccionar» sólo aparezca con edición no es autorización: el servidor
  relee cada elemento y rechaza los de otra MIPER.
- **Mismas reglas que el guardado de a uno, sin copias:** `toColumns` (diccionario de la faena y factor
  activo), `controlColumns` (D5), `controlResponsible` (persona activa), `civilDate` (fechas de
  calendario) y medida nueva `proposed`. Nunca P×C ni los textos del peligro en lote: el esquema los
  rechaza.
- **Layout:** no hay páginas nuevas. «Seleccionar» y «Editar contexto» son controles de la vista (como
  «Agregar peligro» y «Contraer todo»), no acciones de página. Ningún buscador nuevo, ningún `<h1>`,
  ninguna cifra nueva.
- **Densidad y controles (AGENTS A1–A6):** fechas con `DatePicker`, nunca `<input type="date">`;
  nunca un valor crudo de enum en pantalla (`CONTROLLED_STATUS_LABEL`, `CONTROL_HIERARCHY_LABEL`);
  `Badge` sólo con variantes literales (`local/no-raw-badge-variant-map`).
- **Texto:** color de texto sólo con tokens `-ink`; copy en español de Chile; plurales con `countOf` o
  `pluralize` de `@/lib/utils`; fechas con `formatDate`. Nunca `toLocaleDateString` ni
  `new Date().toISOString().slice(0, 10)`.
- **Formularios:** `Field` para los campos; los diálogos de lote usan `useOperation` (envío imperativo,
  sin `<form action>`). A los controles que no son nativos (`OptionSelect`, `DatePicker`) se les da
  nombre con `aria-label`/`ariaLabel`. Los nombres accesibles del formulario de la medida no cambian
  (las E2E los usan).
- **Confirmación:** ninguna acción de esta fase borra. Cada cambio en lote pasa por su diálogo, con un
  botón que dice a cuántos se aplica, y el diálogo no se cierra mientras guarda.
- **Datos personales:** ningún nombre, RUT ni correo real en pruebas, fixtures, informe o commits. Los
  responsables de los fixtures son cargos («Jefe de bodega», «Supervisor de turno») o usuarios
  sembrados de prueba.
- **Bases de datos:**
  - Producción (`plataforma-db-1`) nunca.
  - `bodega_dev` (contenedor `bodega-dev-db`, 127.0.0.1:5433): **de sólo lectura en toda la fase**,
    también en la Task 12. Nada de `INSERT`, `UPDATE` ni `DELETE`, y los recuentos de antes y de
    después de un recorrido tienen que coincidir. Toda verificación que escribe corre en la base E2E
    desechable.
  - Nunca se activa `app.audit_maintenance` ni se borran filas de `audit_log`, en ninguna base.
  - Nunca imprimir la URL de la base, la sesión QA (`playwright/.auth/monkeytest.json` es una
    credencial), una cookie ni `QA_USER`.
- **Puertas por tarea:**
  - `npm run typecheck`;
  - `npm run lint -- <archivos tocados>` (el guard pasa los argumentos a `eslint`);
  - `npm run test:fast -- <archivos>`, con las rutas de `app/(app)/…` entre comillas;
  - `npm run test:pglite -- <archivo>` para cada suite PGlite tocada, **de a una**. La suite nueva
    `lib/__tests__/miper-bulk.test.ts` se registra en `tests/pglite-files.ts` en la misma tarea que la
    crea (Task 4); si no, `test:fast` la intenta correr en paralelo.
- **Pruebas de componentes:**
  - empiezan con `// @vitest-environment jsdom` en la primera línea;
  - mockean `next/navigation`, `@/lib/toast` y las acciones (`../actions`). Todo test que pinte la
    barra o un diálogo de lote mockea también `bulkAddMiperControlAction`,
    `bulkPatchMiperEntriesAction` y `bulkUpdateMiperControlsAction`;
  - jsdom no aplica CSS. Para elegir en un `OptionSelect` (Radix): `fireEvent.click` sobre el
    `combobox` y luego sobre el `option` (patrón de `components/ui/option-select.test.tsx`).
- **Commits:**
  - en español: `feat(miper): …` / `fix(miper): …` / `refactor(miper): …` / `test(miper): …` /
    `docs(miper): …`;
  - cuerpo final con una línea en blanco y la atribución, que es lo que produce el último `-m`:
    `git commit -m "<asunto>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`;
  - `git add` con rutas explícitas y entre comillas. **Nunca** `git add -A` ni `git add .`, y
    **nunca** `.gitignore` (el usuario lo tiene modificado a propósito);
  - nunca `--no-verify`. Nunca `push`.
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
- **Números de línea:** los citados son los de 1143bf50. Una tarea anterior puede correrlos, así que
  cada paso cita además el texto exacto que se reemplaza: se ubica por el texto. Los reemplazos de cada
  tarea suponen las tareas anteriores aplicadas tal como están escritas aquí.

## Review Focus

1. **Un autoguardado en curso cuando empieza el lote.** La persona edita un campo del riesgo, vuelve a
   la tarea y aprieta «Agregar medida a 2» antes de que el guardado termine. El lote tiene que esperar
   ese guardado y mandar la versión que dejó, no chocar consigo mismo («1 riesgo cambió mientras
   editabas»).
   - Lo fijan: la Task 6 (`use-row-saver.test.ts`: «whenIdle espera los guardados en curso…, también
     el que entra mientras espera»; `use-entry-autosave.test.ts`: «whenIdle espera el guardado en
     curso…») y la Task 8 (`bulk-bar.test.tsx`: «"Agregar medida a N" espera los guardados en curso…»).
2. **Editar un riesgo justo después de un cambio en lote, sin recargar.** El lote subió la versión de
   esos riesgos; el siguiente guardado automático tiene que partir de la nueva, aunque la foto
   revalidada no haya llegado o Next restaure una atrasada al volver «atrás».
   - Lo fija la Task 6 (`use-entry-autosave.test.ts`: «tras una acción masiva, el siguiente guardado
     parte de la versión que devolvió; una foto atrasada no la baja»).
3. **Un cliente adulterado que repite un elemento.** Un id dos veces escribiría dos veces su historial
   (y, en «Asignar responsable / plazo», chocaría con su propia versión). Se rechaza antes de abrir la
   transacción.
   - Lo fija la Task 3 (`miper.test.ts`: «acciones masivas: de 1 a 300 elementos, sin repetidos…»).
4. **Una selección que deja de verse.** La persona selecciona en la matriz filtrada, cambia o quita el
   filtro y aplica: el lote sólo puede tocar lo que está a la vista, y quitar los filtros termina la
   selección.
   - Lo fijan: la Task 6 (`use-risk-selection.test.ts`: «sólo cuenta lo que se ve…») y la Task 9
     (`matrix-view.test.tsx`: «… quitar los filtros termina la selección»).
5. **Renombrar una tarea al nombre de otra (o sólo cambiar mayúsculas).** «carga» → «Carga» no es un
   cambio (el diccionario normaliza): no se envía nada. «Carga» → «DESCARGA» con «Descarga» existente
   junta las dos tareas: la navegación va a la clave de la tarea que ya existía.
   - Lo fija la Task 10 (`task-context-dialog.test.tsx`: «envía sólo lo que cambió…» y «renombrar a
     una tarea que ya existe (otra grafía) la junta con ella…»).

---

## Decisiones (donde la spec o el plan maestro callan)

| # | Tema | Decisión | Costo |
|---|---|---|---|
| 1 | Versión en «Agregar medida a N» | Cada riesgo viaja con su versión y el servicio la compara, como pide el plan maestro para toda operación; pero, igual que el alta de a una, agregar una medida **no** sube la versión del riesgo. | Un cambio ajeno a ese riesgo (por ejemplo, su peligro) aborta el lote, aunque no choque con la medida. |
| 2 | Reglas de completitud en lote | Las mismas que el editor: el guardado no bloquea por completitud (eso lo hace el envío). Para que no pase en silencio, cada diálogo calcula con `checkMiperCompleteness` qué riesgos **ganan** un pendiente y lo dice antes de aplicar; no impide aplicar. | Un lote puede dejar riesgos pendientes si la persona lo decide, igual que el editor. |
| 3 | Qué cambia un lote de riesgos | El servicio acepta los siete campos de la spec §9 (¿controlado?, factor, puesto, lugar, actividad, tarea, rutinaria). La UI ofrece «¿controlado?» en la barra y actividad/tarea/puesto/lugar en «Editar contexto». | Factor y rutinaria en lote quedan sin UI (probados en PGlite). |
| 4 | Alcance de «Asignar responsable / plazo» | Un grupo elegido por la persona: todas las medidas de los riesgos seleccionados, sólo las sin responsable, o sólo las por implementar sin plazo. Cada campo parte en «No cambiar». | No se eligen medidas sueltas en lote: eso sigue en el editor. |
| 5 | D5 en «Asignar responsable / plazo» | El plazo se aplica sólo a las por implementar y la frecuencia sólo a las existentes (`controlColumns`); pasar a «Ya está implementada» borra el plazo y pasar a «Por implementar» borra la frecuencia. | Un plazo elegido no entra a las existentes del grupo; el diálogo lo dice en la ayuda del campo. |
| 6 | Historial | Una entrada por elemento con el `changeType` de siempre (`entry_updated`, `control_created`, `control_updated`) y el motivo «Edición masiva», que la bitácora ya muestra (`history-panel.tsx:64`). Ningún evento agregado. | Un lote de 300 escribe 300 líneas; la bitácora lee 500 hasta la paginación de la Fase E. |
| 7 | Después de un cambio de riesgos | El cliente anota las versiones devueltas (`acknowledge`) y aplica el cambio en pantalla (`applyEntryValues`); la foto revalidada llega después y lo reemplaza. Las medidas en lote no se aplican en pantalla: llegan con la foto, como al guardar una de a una. | El nombre recién escrito se ve con la grafía de la persona hasta que llega la del diccionario. |
| 8 | Renombrar una tarea | No renumera: los riesgos conservan su N°. Si el nombre ya existe en la faena, las tareas se juntan; la navegación va a esa clave. Puesto y lugar vacíos se conservan en cada riesgo; no se borran en lote. | Una tarea juntada puede quedar no contigua en el RE-04 exportado; puesto y lugar no se pueden vaciar en lote. |
| 9 | Selección | Vive en la vista (tarea o matriz filtrada) y se vacía al salir de ella o al terminar bien una acción; no va en la URL. En la matriz, quitar los filtros termina la selección. | «Atrás» no recupera una selección. |
| 10 | Tope | 300 riesgos para los lotes de riesgos y 300 medidas para «Asignar responsable / plazo». Sobre el tope, la barra o el diálogo dicen cuántos quitar y no dejan aplicar; el esquema lo vuelve a exigir en el servidor. | Un cambio de más de 300 se hace por partes. |
| 11 | Rechazo | El mensaje del servidor queda en el diálogo (`role="alert"`) con «Recargar la matriz» (`router.refresh()`), y la selección se conserva para reintentar. | — |
| 12 | «de N días» (arrastre C) | Sólo se salta la forma «de N días» cuando el texto dice cada / frecuencia / periodicidad; «en N días» sigue siendo plazo. «frecuencia» y «periodicidad» pasan a ser palabras de frecuencia. | «PLAZO DE 15 DÍAS, LUEGO CADA MES» se sugiere como frecuencia (la persona lo ve y decide una vez por valor, D6). |
| 13 | E2E | Una MIPER sembrada propia (`riskmatrix-masivas-e2e`, 2040) con una tarea de tres riesgos; la prueba de «Editar contexto» crea su tarea por la UI con el número de reintento. | `e2e/setup-db.ts` crece en una matriz. |

## Correcciones al plan maestro (referencias verificadas el 2026-10-03 sobre 1143bf50)

- **`lockMatrix`, `assertEditable`, `requireAccess`:** existen como dice el plan, en
  `lib/services/miper/shared.ts:87-91`, `:93-96` y `:32-36`. `assertEditable` bloquea legacy y
  `superseded`; una MIPER en revisión sigue editable, como en el guardado de a uno.
- **`toColumns` y `touchMatrix`:** son privadas de `lib/services/miper/entries.ts` (`:37-61` y
  `:24-28`); no hay equivalentes con otro nombre. La Task 4 las exporta.
- **`controlColumns`:** privada en `entries.ts:179-194` (la escribió la Fase C). La Task 2 la muda a
  `lib/prevention/miper/control-values.ts` para que la usen el servicio y la vista previa del cliente.
  El responsable se resolvía en línea en `saveMiperControl` (`:204-207`); la Task 4 lo extrae a
  `controlResponsible`.
- **`changeType`s:** `entry_updated`, `control_created` y `control_updated`
  (`lib/prevention/miper/history-labels.ts:13-19`). `miperHistory` ya acepta `reason`
  (`shared.ts:58-85`), que va a `audit_log.reason` y la bitácora lo muestra (`history-panel.tsx:64`).
- **`saveMiperControl`:** `entries.ts:196-236`.
- **`useRowSaver` no expone `whenIdle`** (el plan maestro lo da por hecho). La Task 6 lo agrega
  (`use-row-saver.ts`) y lo pasa por `useEntryAutosave` (`use-entry-autosave.ts:43`), que es el objeto
  que reparte el espacio de trabajo. `EntryAutosave` (el tipo del editor) no cambia: lo nuevo va en
  `AutosaveSync`, para no tocar los dobles de `risk-editor.test.tsx:33`.
- **`RiskRow` ES el enlace** (`risk-row.tsx:15`, un `WorkspaceLink`). La casilla va en un envoltorio
  (`SelectableRiskRow`) que la pone al lado. Lo pintan `task-view.tsx:94-99` y, con filtros,
  `activity-section.tsx:48-55`.
- **`TaskView`, `MatrixView`, filtros:** `task-view.tsx`, `matrix-view.tsx` y
  `lib/prevention/miper/matrix-filters.ts` (+ `matrix-filters-bar.tsx`); el conjunto filtrado se arma
  en `miper-workspace.tsx:118` y llega a la matriz como `tree` con `matching`.
- **`bulk-approve-bar.tsx`:** usa `useActionState` con un `<form>` de un solo botón. Se toma su patrón
  (región `sticky bottom-0` «Acciones sobre la selección», conteo y «Quitar selección»), pero cada
  acción de la MIPER abre un diálogo con campos y envía de forma imperativa: `useOperation` (AGENTS,
  «Form Operation Pattern»).
- **`taskKeyOf`:** `lib/prevention/miper/matrix-tree.ts:68-70`, por nombre normalizado. La clave que
  calcula el cliente con lo escrito coincide con la de los nombres que deja el diccionario (prueba en
  la Task 4).
- **`ControlForm` / `ControlCard`:** `control-form.tsx` (123 líneas: «¿Ya está implementada?»,
  frecuencia o plazo, campos bloqueados mientras guarda, error en `role="alert"`) y `control-card.tsx`.
  `ControlCard` no cambia; la Task 7 saca los campos de `ControlForm` a `ControlFields`.
- **Navegación:** `navigateWorkspace` (`workspace-nav.tsx:15-26`) y `beforeForwardNavigation`
  (`workspace-memory.ts:151-155`). Una acción revalidante y una navegación nativa a continuación
  conviven (ver «Tech Stack»), pero la promesa de la acción se resuelve antes de que llegue la foto.
- **Revalidación:** `guarded` (`app/(app)/prevencion/miper/actions.ts:60-80`) revalida
  `/prevencion/miper` y `/prevencion/miper/<matrixId>` leyendo `input.matrixId`: las tres acciones
  nuevas lo llevan en la raíz del input.
- **Spec §9** decía `bulkAddMiperControl(matrixId, entryIds[], values)` sin versiones: manda el plan
  maestro (una versión por elemento en toda operación).
- **No previsto en el plan maestro:**
  - `useEntryAutosave` no tenía cómo anotar versiones que no salieron de un guardado propio:
    `acknowledge`.
  - La E2E de importación afirma en un comentario que la faena restringida sólo trae 2035–2039; la
    Task 11 siembra 2040 y corrige el comentario.

## Mapa de archivos

| Archivo | Task |
|---|---|
| `lib/prevention/miper/re04-measures.ts` (+test), `lib/services/miper/entries.ts` (duplicar), `lib/__tests__/miper-entries.test.ts`, `lib/validation/prevention-module/miper.ts` (+test), `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md` (l. 450), `qa/reports/2026-10-03-miper-c.md` (§10) | 1 |
| `lib/prevention/miper/control-values.ts` (nuevo, +test), `lib/prevention/miper/bulk-impact.ts` (nuevo, +test), `lib/services/miper/entries.ts` | 2 |
| `lib/validation/prevention-module/miper.ts` (+test) | 3 |
| `lib/services/miper/entries.ts`, `lib/services/miper/bulk.ts` (nuevo), `lib/__tests__/miper-bulk.test.ts` (nuevo), `tests/pglite-files.ts` | 4 |
| `app/(app)/prevencion/miper/actions.ts` (+test) | 5 |
| `app/(app)/prevencion/miper/[id]/use-row-saver.ts` (+test), `…/use-entry-autosave.ts` (+test), `…/use-risk-selection.ts` (nuevo, +test) | 6 |
| `app/(app)/prevencion/miper/[id]/control-fields.tsx` (nuevo, +test), `…/control-form.tsx` | 7 |
| `app/(app)/prevencion/miper/[id]/bulk-shared.tsx`, `…/bulk-dialogs.tsx`, `…/bulk-bar.tsx` (nuevos), `…/bulk-bar.test.tsx` (nuevo) | 8 |
| `app/(app)/prevencion/miper/[id]/risk-row.tsx`, `…/task-view.tsx` (+test), `…/activity-section.tsx`, `…/matrix-view.tsx` (+test), `…/miper-workspace.tsx` (+test) | 9 |
| `app/(app)/prevencion/miper/[id]/task-context-dialog.tsx` (nuevo, +test), `…/task-view.tsx` (+test) | 10 |
| `e2e/setup-db.ts`, `e2e/prevencion-miper-masivas.spec.ts` (nuevo), `e2e/prevencion-miper-importacion.spec.ts` (comentario) | 11 |
| `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md` (§5), `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` (l. 3 y §9), `qa/reports/2026-10-03-miper-d.md` (nuevo) | 12 |

---

### Task 1: Arrastre de la Fase C: «de N días», orden al duplicar, topes del esquema, manual e informe C

**Files:**
- Modify: `lib/prevention/miper/re04-measures.ts:22-27` (constantes), `:256-260` (`IN_DAYS`), `:268`
  (`FREQUENCY`), `:276-289` (comentario de `deadlineSuggestion`) y `:303` (`days`)
- Test: `lib/prevention/miper/re04-measures.test.ts:104-105` (casos nuevos en el `it.each` de
  `deadlineSuggestion`)
- Modify: `lib/services/miper/entries.ts:134-140` (`duplicateMiperEntry`, las medidas)
- Test: `lib/__tests__/miper-entries.test.ts` (un test al final del `describe`)
- Modify: `lib/validation/prevention-module/miper.ts:1-2` (import), `:86-93`
  (`miperControlSaveSchema`), `:269` y `:274` (decisiones de la importación)
- Test: `lib/validation/prevention-module/miper.test.ts:1-2` (import) y un test antes de «las fechas
  son de calendario…»
- Modify: `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md:450`
- Modify: `qa/reports/2026-10-03-miper-c.md:454-457` (§10, último punto)

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces:
  - `deadlineSuggestion(text, today)`: «de N días» → hoy + N **salvo** que el texto diga «cada»,
    «frecuencia» o «periodicidad»; «en N días» → hoy + N siempre. «frecuencia» y «periodicidad» son
    palabras de frecuencia (→ existente).
  - `duplicateMiperEntry` copia las medidas en el orden de la foto (`created_at, id`), con
    `created_at` = instante + N ms por copia.
  - `miperControlSaveSchema` y las decisiones de la importación usan `MEASURE_MAX_LENGTH`,
    `RESPONSIBLE_MAX_LENGTH` y `FREQUENCY_MAX_LENGTH` de `lib/prevention/miper/re04-measures.ts`
    (3000, 300 y 120: los mismos valores). La Task 3 los reutiliza en los esquemas de lote.

**Por qué estos cinco y no los «seguimientos»:** son los puntos del «Arrastre al cerrar la Fase C» del
plan maestro marcados para el inicio de la Fase D. Los «Seguimientos (no bloquean)» y el «cambio
visible a validar con el usuario» quedan en «Después de la Fase D».

- [ ] **Step 1: Write the failing tests**

En `lib/prevention/miper/re04-measures.test.ts`, dentro del `it.each` de `describe("deadlineSuggestion:
los PLAZOS del RE-04 real", …)`:

Reemplazar:

```ts
    ["PLAZO DE 15 DÍAS", { kind: "pending", dueDate: "2026-10-18" }, "relative"],
    // «cada N días» no es un plazo: es la frecuencia con que se verifica una medida existente.
    ["CADA 30 DÍAS", { kind: "existing", frequency: "CADA 30 DÍAS" }, "frequency"],
    // El libro exportado describe la medida existente en PLAZOS: «Existente · frecuencia» o «Existente».
    // Se reconoce antes que todo lo demás: lo que sigue es la frecuencia, aunque parezca un plazo.
    ["Existente · Trimestral", { kind: "existing", frequency: "Trimestral" }, "existing"],
```

por:

```ts
    ["PLAZO DE 15 DÍAS", { kind: "pending", dueDate: "2026-10-18" }, "relative"],
    // «cada N días» no es un plazo: es la frecuencia con que se verifica una medida existente.
    ["CADA 30 DÍAS", { kind: "existing", frequency: "CADA 30 DÍAS" }, "frequency"],
    // «de N días» tras «cada», «frecuencia» o «periodicidad» dice cada cuánto se verifica, no un plazo (arrastre de la Fase C).
    ["CADA PERÍODO DE 30 DÍAS", { kind: "existing", frequency: "CADA PERÍODO DE 30 DÍAS" }, "frequency"],
    ["FRECUENCIA DE 30 DÍAS", { kind: "existing", frequency: "FRECUENCIA DE 30 DÍAS" }, "frequency"],
    ["PERIODICIDAD DE 15 DÍAS", { kind: "existing", frequency: "PERIODICIDAD DE 15 DÍAS" }, "frequency"],
    // «en N días» sigue siendo un plazo aunque después diga cada cuánto se controla.
    ["IMPLEMENTAR EN 30 DÍAS Y LUEGO CADA MES", { kind: "pending", dueDate: "2026-11-02" }, "relative"],
    // El libro exportado describe la medida existente en PLAZOS: «Existente · frecuencia» o «Existente».
    // Se reconoce antes que todo lo demás: lo que sigue es la frecuencia, aunque parezca un plazo.
    ["Existente · Trimestral", { kind: "existing", frequency: "Trimestral" }, "existing"],
```

Al final del `describe("filas de la matriz", …)` de `lib/__tests__/miper-entries.test.ts` (el patrón es
el de la prueba de la copia al período siguiente, `miper-matrices.test.ts`, commit f37eac72):

Reemplazar:

```ts
    expect(control).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })
    expect(Object.keys(control).slice(-2)).toEqual(["isExisting", "verificationFrequency"])
  })
})
```

por:

```ts
    expect(control).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })
    expect(Object.keys(control).slice(-2)).toEqual(["isExisting", "verificationFrequency"])
  })

  it("duplicar un riesgo conserva el orden de sus medidas (arrastre de la Fase C)", async () => {
    const entry = await svc.saveMiperEntry({ matrixId, values: { hazard: "Ruido de chancado", probability: 2, consequence: 2 } }, author)
    // El orden de la foto es `created_at, id`. Los ids van al revés de ese orden y se insertan
    // desordenados: ni el id ni el orden físico de las filas lo reproducen por casualidad.
    const order = ["Encierro acústico", "Mantención del silenciador", "Rotación de turnos", "Pausas de recuperación", "Audiometría anual", "Protector auditivo"]
    const controls = order.map((description, index) => ({
      id: `dup-c${order.length - index}`, riskEntryId: entry.id, description, hierarchy: "administrative" as const,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), updatedAt: "2026-01-01T00:00:00.000Z",
    }))
    await testDb.insert(schema.preventionRiskControls).values([3, 0, 5, 1, 4, 2].map((index) => controls[index]!))
    const descriptionsOf = async (entryId: string) => (await buildMiperSnapshot(testDb, matrixId)).entries.find((item) => item.id === entryId)!.controls.map((control) => control.description)
    expect(await descriptionsOf(entry.id)).toEqual(order)
    const dup = await svc.duplicateMiperEntry({ matrixId, entryId: entry.id }, author)
    expect(await descriptionsOf(dup.id)).toEqual(order)
  })
})
```

En `lib/validation/prevention-module/miper.test.ts`:

1. Reemplazar:

```ts
import { describe, expect, it } from "vitest"
import { createMiperSchema, IMPORT_LIMITS, miperApproveFinalSchema, miperControlSaveSchema, miperEntrySaveSchema, miperHeaderSchema, miperObservationSchema, programActionSchema, riskImportCommitSchema } from "./miper"

const header = {
```

por:

```ts
import { describe, expect, it } from "vitest"
import { FREQUENCY_MAX_LENGTH, MEASURE_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { createMiperSchema, IMPORT_LIMITS, miperApproveFinalSchema, miperControlSaveSchema, miperEntrySaveSchema, miperHeaderSchema, miperObservationSchema, programActionSchema, riskImportCommitSchema } from "./miper"

const header = {
```

2. Reemplazar:

```ts
    expect(riskImportCommitSchema.safeParse({ ...base, measureMapping: tooMany }).success).toBe(false)
  })

  it("las fechas son de calendario: «2026-02-31» y «2026-13-45» no existen y el 29 de febrero sólo en año bisiesto", () => {
    const accepts: Record<string, (date: string) => boolean> = {
      medida: (dueDate) => miperControlSaveSchema.safeParse({ matrixId: "m1", entryId: "e1", values: { hierarchy: "ppe", description: "Uso de casco", dueDate } }).success,
```

por:

```ts
    expect(riskImportCommitSchema.safeParse({ ...base, measureMapping: tooMany }).success).toBe(false)
  })

  it("los topes de la medida son las constantes de la importación: el editor y la carga aceptan lo mismo (arrastre de la Fase C)", () => {
    const medida = (values: Record<string, unknown>) => miperControlSaveSchema.safeParse({ matrixId: "m1", entryId: "e1", values: { hierarchy: "ppe", description: "Uso de casco", ...values } }).success
    const carga = (decisions: Record<string, unknown>) => riskImportCommitSchema.safeParse({ batchId: "b1", worksiteId: "ws", target: "draft", ...decisions }).success
    expect(medida({ description: "x".repeat(MEASURE_MAX_LENGTH) })).toBe(true)
    expect(medida({ description: "x".repeat(MEASURE_MAX_LENGTH + 1) })).toBe(false)
    expect(medida({ responsibleName: "x".repeat(RESPONSIBLE_MAX_LENGTH) })).toBe(true)
    expect(medida({ responsibleName: "x".repeat(RESPONSIBLE_MAX_LENGTH + 1) })).toBe(false)
    expect(medida({ verificationFrequency: "x".repeat(FREQUENCY_MAX_LENGTH) })).toBe(true)
    expect(medida({ verificationFrequency: "x".repeat(FREQUENCY_MAX_LENGTH + 1) })).toBe(false)
    expect(carga({ responsibleMapping: { x: { kind: "text", name: "x".repeat(RESPONSIBLE_MAX_LENGTH) } } })).toBe(true)
    expect(carga({ responsibleMapping: { x: { kind: "text", name: "x".repeat(RESPONSIBLE_MAX_LENGTH + 1) } } })).toBe(false)
    expect(carga({ deadlineMapping: { x: { kind: "existing", frequency: "x".repeat(FREQUENCY_MAX_LENGTH) } } })).toBe(true)
    expect(carga({ deadlineMapping: { x: { kind: "existing", frequency: "x".repeat(FREQUENCY_MAX_LENGTH + 1) } } })).toBe(false)
  })

  it("las fechas son de calendario: «2026-02-31» y «2026-13-45» no existen y el 29 de febrero sólo en año bisiesto", () => {
    const accepts: Record<string, (date: string) => boolean> = {
      medida: (dueDate) => miperControlSaveSchema.safeParse({ matrixId: "m1", entryId: "e1", values: { hierarchy: "ppe", description: "Uso de casco", dueDate } }).success,
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- lib/prevention/miper/re04-measures.test.ts lib/validation/prevention-module/miper.test.ts
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
```

Expected:
- `re04-measures`: FAIL en «CADA PERÍODO DE 30 DÍAS», «FRECUENCIA DE 30 DÍAS» y «PERIODICIDAD DE 15
  DÍAS» (hoy salen como plazo hoy + N). «IMPLEMENTAR EN 30 DÍAS Y LUEGO CADA MES» ya pasa: es la guarda
  de que «en N días» sigue siendo plazo.
- `miper.test.ts`: el test nuevo **pasa** antes y después, porque las constantes ya existen y valen
  lo mismo que los literales. Es la guarda de que el editor, el lote y la carga no se vuelvan a
  separar.
- PGlite: FAIL en «duplicar un riesgo conserva el orden de sus medidas»: las copias nacen con el mismo
  `created_at` y el desempate por sus ids nuevos (al azar) las desordena.

- [ ] **Step 3: «de N días» con cada / frecuencia / periodicidad**

En `lib/prevention/miper/re04-measures.ts`:

1. Reemplazar:

```ts
import type { Re04ColumnLabel } from "./re04-import"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy } from "./snapshot"

/** Largo máximo de una medida: el de `miperControlSaveSchema.values.description`. */
export const MEASURE_MAX_LENGTH = 3000
/** Largo máximo de una frecuencia de verificación: el de `deadlineDecisionSchema` y `verificationFrequency`. */
export const FREQUENCY_MAX_LENGTH = 120
/** Largo máximo de un responsable escrito: el de `responsibleDecisionSchema` y `responsibleName`. */
export const RESPONSIBLE_MAX_LENGTH = 300

const MEASURE_COLUMN: Re04ColumnLabel = "MEDIDA DE CONTROL"
```

por:

```ts
import type { Re04ColumnLabel } from "./re04-import"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy } from "./snapshot"

/*
 * Topes de una medida. Son la fuente: los esquemas MIPER
 * (`lib/validation/prevention-module/miper.ts`) los importan, así el editor de la
 * medida, las acciones masivas y la carga del RE-04 aceptan exactamente lo mismo.
 */
/** Largo máximo de una medida (`description`). */
export const MEASURE_MAX_LENGTH = 3000
/** Largo máximo de una frecuencia de verificación (`verificationFrequency`, `deadlineDecisionSchema`). */
export const FREQUENCY_MAX_LENGTH = 120
/** Largo máximo de un responsable escrito (`responsibleName`, `responsibleDecisionSchema`). */
export const RESPONSIBLE_MAX_LENGTH = 300

const MEASURE_COLUMN: Re04ColumnLabel = "MEDIDA DE CONTROL"
```

2. Reemplazar:

```ts
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/
/**
 * «EN 30 DÍAS» o «PLAZO DE 15 DÍAS» (sobre el texto ya sin tildes). Pide el «en»
 * o el «de»: «CADA 30 DÍAS» es una frecuencia, no un plazo.
 */
const IN_DAYS = /\b(?:en|de) (\d{1,3}) dias?\b/
/**
 * «AL OCURRIR» / «INMEDIATO AL OCURRIR»: una medida de contingencia que ya existe
 * (un kit de derrames) y se aplica cuando pasa el evento. Va antes de «inmediato».
```

por:

```ts
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/
/**
 * «EN 30 DÍAS» (sobre el texto ya sin tildes): siempre un plazo, aunque después
 * diga cada cuánto se controla. Pide el «en»: «CADA 30 DÍAS» es una frecuencia.
 */
const IN_DAYS = /\ben (\d{1,3}) dias?\b/
/**
 * «PLAZO DE 15 DÍAS» también es un plazo, salvo que el texto diga cada cuánto se
 * repite: «CADA PERÍODO DE 30 DÍAS», «FRECUENCIA DE 30 DÍAS» y «PERIODICIDAD DE
 * 15 DÍAS» son frecuencias (arrastre de la Fase C).
 */
const OF_DAYS = /\bde (\d{1,3}) dias?\b/
const RECURRING = /\b(?:cada|frecuencia|periodicidad)\b/
/**
 * «AL OCURRIR» / «INMEDIATO AL OCURRIR»: una medida de contingencia que ya existe
 * (un kit de derrames) y se aplica cuando pasa el evento. Va antes de «inmediato».
```

3. Reemplazar:

```ts
const ON_OCCURRENCE = /\bal ocurrir\b/
const ON_OCCURRENCE_FREQUENCY = "Al ocurrir"
const IMMEDIATE = /\binmediat/
const FREQUENCY = /\b(diari[oa]s?|semanal(es)?|quincenal(es)?|mensual(es)?|bimestral(es)?|trimestral(es)?|cuatrimestral(es)?|semestral(es)?|anual(es)?|permanente|continu[oa]|periodic[oa]|cada|siempre)\b/

function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
```

por:

```ts
const ON_OCCURRENCE = /\bal ocurrir\b/
const ON_OCCURRENCE_FREQUENCY = "Al ocurrir"
const IMMEDIATE = /\binmediat/
const FREQUENCY = /\b(diari[oa]s?|semanal(es)?|quincenal(es)?|mensual(es)?|bimestral(es)?|trimestral(es)?|cuatrimestral(es)?|semestral(es)?|anual(es)?|permanente|continu[oa]|periodic[oa]|periodicidad|frecuencia|cada|siempre)\b/

function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
```

4. Reemplazar:

```ts
 * D6: lo que sugiere un valor de PLAZOS. Primero, lo que escribe el libro
 * exportado: «Existente · frecuencia» o «Existente» → existente, con lo que sigue
 * como frecuencia (o sin ella), aunque parezca un plazo. Una fecha → por
 * implementar con esa fecha; «en N días» o «de N días» → hoy + N (antes que la frecuencia:
 * «IMPLEMENTAR EN 30 DÍAS Y CONTROL DIARIO», «PLAZO DE 15 DÍAS»; «CADA 30 DÍAS»
 * no lleva «en» ni «de» y es frecuencia);
 * «al ocurrir» → existente, con frecuencia «Al ocurrir» (antes que «inmediato»:
 * «INMEDIATO AL OCURRIR» es una contingencia que ya existe); «inmediato» → por
 * implementar hoy («INMEDIATO / ANTES DE CONTINUAR LA TAREA»); una frecuencia
```

por:

```ts
 * D6: lo que sugiere un valor de PLAZOS. Primero, lo que escribe el libro
 * exportado: «Existente · frecuencia» o «Existente» → existente, con lo que sigue
 * como frecuencia (o sin ella), aunque parezca un plazo. Una fecha → por
 * implementar con esa fecha; «en N días» → hoy + N (antes que la frecuencia:
 * «IMPLEMENTAR EN 30 DÍAS Y CONTROL DIARIO»); «de N días» → hoy + N salvo que el
 * texto diga «cada», «frecuencia» o «periodicidad» («PLAZO DE 15 DÍAS» es un
 * plazo; «CADA PERÍODO DE 30 DÍAS», una frecuencia; «CADA 30 DÍAS» no lleva «en»
 * ni «de» y también es frecuencia);
 * «al ocurrir» → existente, con frecuencia «Al ocurrir» (antes que «inmediato»:
 * «INMEDIATO AL OCURRIR» es una contingencia que ya existe); «inmediato» → por
 * implementar hoy («INMEDIATO / ANTES DE CONTINUAR LA TAREA»); una frecuencia
```

5. Reemplazar:

```ts
  const date = iso ? calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    : local ? calendarDate(Number(local[3]), Number(local[2]), Number(local[1])) : null
  if (date) return { decision: { kind: "pending", dueDate: date }, source: "date" }
  const days = IN_DAYS.exec(key)
  if (days) return { decision: { kind: "pending", dueDate: addDaysToPlainDate(today, Number(days[1])) }, source: "relative" }
  if (ON_OCCURRENCE.test(key)) return { decision: { kind: "existing", frequency: ON_OCCURRENCE_FREQUENCY }, source: "frequency" }
  if (IMMEDIATE.test(key)) return { decision: { kind: "pending", dueDate: today }, source: "immediate" }
```

por:

```ts
  const date = iso ? calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    : local ? calendarDate(Number(local[3]), Number(local[2]), Number(local[1])) : null
  if (date) return { decision: { kind: "pending", dueDate: date }, source: "date" }
  const days = IN_DAYS.exec(key) ?? (RECURRING.test(key) ? null : OF_DAYS.exec(key))
  if (days) return { decision: { kind: "pending", dueDate: addDaysToPlainDate(today, Number(days[1])) }, source: "relative" }
  if (ON_OCCURRENCE.test(key)) return { decision: { kind: "existing", frequency: ON_OCCURRENCE_FREQUENCY }, source: "frequency" }
  if (IMMEDIATE.test(key)) return { decision: { kind: "pending", dueDate: today }, source: "immediate" }
```

- [ ] **Step 4: El orden de las medidas al duplicar**

En `lib/services/miper/entries.ts`, dentro de `duplicateMiperEntry`:

Reemplazar:

```ts
    const now = nowIso()
    const { magnitude: _m, classification: _c, ...copy } = source
    const [created] = await tx.insert(preventionRiskEntries).values({ ...copy, id: `riskentry-${nanoid()}`, rowNumber: after + 1, hazardCode: `R-${nanoid(8)}`, version: 1, createdAt: now, updatedAt: now }).returning()
    const controls = await tx.select().from(preventionRiskControls).where(eq(preventionRiskControls.riskEntryId, source.id)).orderBy(asc(preventionRiskControls.createdAt))
    if (controls.length > 0) {
      await tx.insert(preventionRiskControls).values(controls.map((control) => ({
        ...control, id: `riskcontrol-${nanoid()}`, riskEntryId: created!.id, status: "proposed", effectivenessStatus: "not_assessed",
        lastVerifiedAt: null, lastVerifiedByUserId: null, version: 1, createdAt: now, updatedAt: now,
      })))
    }
    await touchMatrix(tx, matrix.id, now)
```

por:

```ts
    const now = nowIso()
    const { magnitude: _m, classification: _c, ...copy } = source
    const [created] = await tx.insert(preventionRiskEntries).values({ ...copy, id: `riskentry-${nanoid()}`, rowNumber: after + 1, hazardCode: `R-${nanoid(8)}`, version: 1, createdAt: now, updatedAt: now }).returning()
    // En el orden de la foto (`created_at, id`) y un milisegundo más por copia, como la copia al
    // período siguiente: con el mismo `created_at` para todas, el desempate por los ids nuevos
    // (al azar) las desordenaba (arrastre de la Fase C).
    const controls = await tx.select().from(preventionRiskControls).where(eq(preventionRiskControls.riskEntryId, source.id))
      .orderBy(asc(preventionRiskControls.createdAt), asc(preventionRiskControls.id))
    if (controls.length > 0) {
      await tx.insert(preventionRiskControls).values(controls.map((control, index) => ({
        ...control, id: `riskcontrol-${nanoid()}`, riskEntryId: created!.id, status: "proposed", effectivenessStatus: "not_assessed",
        lastVerifiedAt: null, lastVerifiedByUserId: null, version: 1, createdAt: new Date(Date.parse(now) + index).toISOString(), updatedAt: now,
      })))
    }
    await touchMatrix(tx, matrix.id, now)
```

- [ ] **Step 5: Los topes del esquema, de las constantes compartidas**

En `lib/validation/prevention-module/miper.ts`:

1. Reemplazar:

```ts
import { z } from "zod"
import { civilDate } from "@/lib/validation/dates"

const id = z.string().min(1)
```

por:

```ts
import { z } from "zod"
import { FREQUENCY_MAX_LENGTH, MEASURE_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { civilDate } from "@/lib/validation/dates"

const id = z.string().min(1)
```

2. Reemplazar:

```ts
  expectedVersion: version.optional(),
  values: z.object({
    hierarchy: z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." }),
    description: z.string().trim().min(3, "Describe la medida.").max(3000),
    responsibleUserId: id.nullable().optional(),
    responsibleName: z.string().trim().max(300).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    /* D5 (Fase C): una medida ya implementada se verifica con una frecuencia y no
     * lleva plazo. Opcionales: sin ellos se conserva lo que la medida ya tenía. */
    isExisting: z.boolean().optional(),
    verificationFrequency: z.string().trim().max(120, "La frecuencia admite hasta 120 caracteres.").nullable().optional(),
  }),
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })
```

por:

```ts
  expectedVersion: version.optional(),
  values: z.object({
    hierarchy: z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." }),
    description: z.string().trim().min(3, "Describe la medida.").max(MEASURE_MAX_LENGTH),
    responsibleUserId: id.nullable().optional(),
    responsibleName: z.string().trim().max(RESPONSIBLE_MAX_LENGTH).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    /* D5 (Fase C): una medida ya implementada se verifica con una frecuencia y no
     * lleva plazo. Opcionales: sin ellos se conserva lo que la medida ya tenía. */
    isExisting: z.boolean().optional(),
    verificationFrequency: z.string().trim().max(FREQUENCY_MAX_LENGTH, `La frecuencia admite hasta ${FREQUENCY_MAX_LENGTH} caracteres.`).nullable().optional(),
  }),
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })
```

3. Reemplazar:

```ts

const responsibleDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: id }),
  z.object({ kind: z.literal("text"), name: z.string().trim().min(1, "Escribe el responsable.").max(300) }),
  z.object({ kind: z.literal("none") }),
])

const deadlineDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), frequency: z.string().trim().max(120, "La frecuencia admite hasta 120 caracteres.").nullable() }),
  z.object({ kind: z.literal("pending"), dueDate: isoDate.nullable() }),
])
```

por:

```ts

const responsibleDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: id }),
  z.object({ kind: z.literal("text"), name: z.string().trim().min(1, "Escribe el responsable.").max(RESPONSIBLE_MAX_LENGTH) }),
  z.object({ kind: z.literal("none") }),
])

const deadlineDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), frequency: z.string().trim().max(FREQUENCY_MAX_LENGTH, `La frecuencia admite hasta ${FREQUENCY_MAX_LENGTH} caracteres.`).nullable() }),
  z.object({ kind: z.literal("pending"), dueDate: isoDate.nullable() }),
])
```

`re04-measures.ts` sólo importa tipos de `re04-import.ts` y módulos puros (`dedup`, `names`, `snapshot`,
`@/lib/utils`): el esquema, que también se importa desde el cliente, no arrastra nada de servidor.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test:fast -- lib/prevention/miper/re04-measures.test.ts lib/validation/prevention-module/miper.test.ts lib/prevention/miper/import-decisions.test.ts lib/reports/miper-workbook.test.ts "app/(app)/prevencion/miper/import-measures-step.test.tsx"
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
npm run test:pglite -- lib/__tests__/miper-import.test.ts
```

Expected: todo PASS (los consumidores de `deadlineSuggestion` y de las constantes incluidos).

- [ ] **Step 7: Puertas y commit del código**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/re04-measures.ts lib/prevention/miper/re04-measures.test.ts lib/services/miper/entries.ts lib/__tests__/miper-entries.test.ts lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts
git add lib/prevention/miper/re04-measures.ts lib/prevention/miper/re04-measures.test.ts lib/services/miper/entries.ts lib/__tests__/miper-entries.test.ts lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts
git commit -m "fix(miper): «de N días» con cada/frecuencia/periodicidad es frecuencia, duplicar conserva el orden de las medidas y el esquema usa los topes compartidos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Manual l. 450 e informe C §10**

En `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`, reemplazar la
línea 450 entera:

```markdown
> **INTOLERABLE E IMPORTANTE NO QUEDAN SIN PROGRAMA:** «dejar sin actividad» **no se ofrece** para una medida de un riesgo **Intolerable** o **Importante**: ambos exigen una medida por implementar con responsable y plazo, y la plataforma rechaza la decisión nombrando el riesgo. Además, un riesgo **Intolerable** exige que **al menos una de sus medidas esté vinculada a una actividad del programa** para que la MIPER pueda **enviarse a revisión**.
```

por (la redacción exacta que dio la re-revisión de la Fase C, plan maestro, «Arrastre al cerrar la
Fase C»):

```markdown
> **INTOLERABLE E IMPORTANTE NO QUEDAN SIN PROGRAMA:** «dejar sin actividad» **no se ofrece** para una medida de un riesgo **Intolerable** o **Importante**, aunque esté «Sí» controlado, y la plataforma rechaza la decisión nombrando el riesgo. Un Intolerable, y un Importante que no está «Sí» controlado, exigen además una medida por implementar con responsable y plazo. Un riesgo **Intolerable** exige también que **al menos una de sus medidas esté vinculada a una actividad del programa** para que la MIPER pueda **enviarse a revisión**.
```

En `qa/reports/2026-10-03-miper-c.md`, reemplazar el último punto de §10:

```markdown
- Las E2E `prevencion-miper-importacion`, `prevencion-miper-escenario` y
  `prevencion-miper-interacciones` se corren sobre el commit de esta sección (sin cambios de código
  respecto de `edb6dea8`), desde un worktree desechable. Esta sección se escribe antes de esas
  corridas, así que no registra su resultado: está en el informe de la ola, fuera del repositorio.
```

por:

```markdown
- Las E2E `prevencion-miper-importacion`, `prevencion-miper-escenario` y
  `prevencion-miper-interacciones` se corrieron sobre `1143bf50`, el commit de esta sección (sin
  cambios de código respecto de `edb6dea8`), desde un worktree desechable y de a un spec:

  | Spec | Pruebas | Resultado |
  |---|---|---|
  | `prevencion-miper-importacion` | 2 | 2/2 pasaron |
  | `prevencion-miper-escenario` | 10 | 10/10 pasaron |
  | `prevencion-miper-interacciones` | 8 | 8/8 pasaron |

  La tabla se versionó al inicio de la Fase D (arrastre de la Fase C); antes estaba sólo en el
  informe de la ola, fuera del repositorio.
```

Si quien ejecuta tiene a mano el informe de la ola con otro resultado, manda ese informe: se copia
tal cual y se anota la diferencia en el commit.

- [ ] **Step 9: Commit de los documentos**

```bash
git add docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md qa/reports/2026-10-03-miper-c.md
git commit -m "docs(miper): manual del Intolerable e Importante «Sí» controlado y E2E finales de la Fase C versionadas en su informe" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reglas puras del lote: `controlColumns` en un módulo propio y la vista previa de su efecto

**Files:**
- Create: `lib/prevention/miper/control-values.ts`
- Test: `lib/prevention/miper/control-values.test.ts`
- Create: `lib/prevention/miper/bulk-impact.ts`
- Test: `lib/prevention/miper/bulk-impact.test.ts`
- Modify: `lib/services/miper/entries.ts:6-7` (imports) y `:171-194` (se borra `controlColumns`, que
  pasa al módulo nuevo)

**Interfaces:**
- Consumes: `checkMiperCompleteness` (`lib/prevention/miper/completeness.ts`), `cleanMiperName`
  (`names.ts`), `applyEntryValues` (`entry-values.ts`, sólo en las pruebas), `countOf`.
- Produces (`lib/prevention/miper/control-values.ts`):
  - `type ControlValues = MiperControlSaveInput["values"]`
  - `type ControlResponsible = { responsibleUserId: string | null; responsibleSnapshot: string | null }`
  - `type ControlColumns = ControlResponsible & { hierarchy: ControlHierarchy; description: string;
    isExisting: boolean; verificationFrequency: string | null; dueDate: string | null }`
  - `controlColumns(values: ControlValues, responsible: ControlResponsible, current: { isExisting:
    boolean; verificationFrequency: string | null } | null): ControlColumns` — la de la Fase C, sin
    cambios de comportamiento.
  - `type ResponsiblePatch = { kind: "user"; userId: string } | { kind: "text"; name: string }`
  - `type ControlPatch = { responsible?: ResponsiblePatch; isExisting?: boolean; dueDate?: string |
    null; verificationFrequency?: string | null }`
  - `patchedControlValues(current: { hierarchy; description; isExisting; verificationFrequency;
    dueDate }, patch: ControlPatch): ControlValues` — lo que el lote no trae sale de la medida.
- Produces (`lib/prevention/miper/bulk-impact.ts`):
  - `newlyIncomplete(before: readonly MiperEntrySnapshot[], after: readonly MiperEntrySnapshot[]):
    MiperEntrySnapshot[]` — los riesgos de `after` que ganan un pendiente (por campo y mensaje).
  - `withAddedControl(entry, values: ControlValues, nameOf: (userId: string) => string | null):
    MiperEntrySnapshot` — con la medida nueva como la dejaría `bulkAddMiperControl`.
  - `withControlPatch(entry, controlIds: ReadonlySet<string>, patch: ControlPatch, nameOf):
    MiperEntrySnapshot` — como la dejaría `bulkUpdateMiperControls` (devuelve el mismo objeto si no
    toca ninguna medida del riesgo).
  - `impactSummary(entries: readonly MiperEntrySnapshot[], shown = 5): string | null` — «3 riesgos
    quedan con pendientes nuevos: #4, #7 y #9.»; `null` si no hay ninguno.

- [ ] **Step 1: Write the failing tests**

Crear `lib/prevention/miper/control-values.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { controlColumns, patchedControlValues } from "./control-values"

const responsible = { responsibleUserId: null, responsibleSnapshot: "Supervisor de turno" }
const pending = { hierarchy: "administrative" as const, description: "Charla de inicio de turno", isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" }
const existing = { hierarchy: "ppe" as const, description: "Uso de casco", isExisting: true, verificationFrequency: "Trimestral", dueDate: null }

describe("controlColumns (D5)", () => {
  it("una existente se guarda sin plazo y una por implementar sin frecuencia, aunque el pedido los traiga", () => {
    expect(controlColumns({ ...pending, isExisting: true, verificationFrequency: " Mensual ", dueDate: "2026-12-31" }, responsible, null))
      .toMatchObject({ isExisting: true, verificationFrequency: "Mensual", dueDate: null })
    expect(controlColumns({ ...existing, isExisting: false, dueDate: "2026-12-31" }, responsible, null))
      .toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-12-31" })
  })
  it("sin «¿ya está implementada?» ni frecuencia en el pedido, se conservan los de la medida; una nueva nace por implementar", () => {
    expect(controlColumns({ hierarchy: "ppe", description: "Uso de casco" }, responsible, { isExisting: true, verificationFrequency: "Trimestral" }))
      .toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(controlColumns({ hierarchy: "ppe", description: "Uso de casco", dueDate: "2026-11-30" }, responsible, null))
      .toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })
  })
})

describe("patchedControlValues (Fase D)", () => {
  it("lo que el lote no trae sale de la medida; el tipo y la descripción nunca cambian", () => {
    expect(patchedControlValues(pending, {})).toEqual({ ...pending })
    expect(patchedControlValues(pending, { dueDate: "2026-12-31" })).toEqual({ ...pending, dueDate: "2026-12-31" })
    expect(patchedControlValues(existing, { verificationFrequency: null })).toEqual({ ...existing, verificationFrequency: null })
  })
  it("pasado por controlColumns rige D5: un plazo no entra a una existente y pasar a existente borra el plazo", () => {
    const keep = (current: typeof pending | typeof existing) => ({ isExisting: current.isExisting, verificationFrequency: current.verificationFrequency })
    expect(controlColumns(patchedControlValues(existing, { dueDate: "2026-12-31" }), responsible, keep(existing)))
      .toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(controlColumns(patchedControlValues(pending, { isExisting: true, verificationFrequency: "Semestral" }), responsible, keep(pending)))
      .toMatchObject({ isExisting: true, verificationFrequency: "Semestral", dueDate: null })
    expect(controlColumns(patchedControlValues(existing, { isExisting: false, dueDate: "2026-12-31" }), responsible, keep(existing)))
      .toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-12-31" })
  })
})
```

Crear `lib/prevention/miper/bulk-impact.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { impactSummary, newlyIncomplete, withAddedControl, withControlPatch } from "./bulk-impact"
import { applyEntryValues } from "./entry-values"
import type { MiperControlSnapshot, MiperEntrySnapshot } from "./snapshot"

/** Un riesgo completo: todos los campos, sin medidas y «No» controlado (un Moderado no exige medidas). */
const entry = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot => ({
  id, rowNumber, activity: "Bodega", task: "Trasvasije", position: "Bodeguero", location: null, exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "rf-1", riskFactor: "Químico", isRoutine: true, hazard: "Solvente", risk: "Inhalación", probableDamage: "Intoxicación",
  probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "no", controls: [], ...overrides,
})
const pending: MiperControlSnapshot = { id: "c-pend", hierarchy: "engineering", description: "Extracción localizada", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-11-30", status: "proposed", isExisting: false, verificationFrequency: null }
const nameOf = (userId: string) => (userId === "u-1" ? "Ana Pérez" : null)

describe("newlyIncomplete: lo que una acción masiva deja con pendientes nuevos", () => {
  it("una medida por implementar sin plazo es un pendiente nuevo; una existente con responsable, no (D5)", () => {
    const before = [entry("a", 1)]
    const sinPlazo = before.map((item) => withAddedControl(item, { hierarchy: "administrative", description: "Charla de trasvasije", responsibleName: "Supervisor", isExisting: false }, nameOf))
    expect(newlyIncomplete(before, sinPlazo).map((item) => item.id)).toEqual(["a"])
    const existente = before.map((item) => withAddedControl(item, { hierarchy: "administrative", description: "Charla de trasvasije", responsibleUserId: "u-1", isExisting: true, verificationFrequency: "Mensual", dueDate: "2026-12-31" }, nameOf))
    expect(newlyIncomplete(before, existente)).toEqual([])
    // D5: la existente nace sin plazo aunque el pedido lo traiga, y propuesta.
    expect(existente[0]!.controls[0]).toMatchObject({ isExisting: true, verificationFrequency: "Mensual", dueDate: null, responsibleName: "Ana Pérez", status: "proposed" })
  })

  it("marcar «ya implementada» la única medida por implementar de un Intolerable rompe la regla crítica", () => {
    const intolerable = entry("b", 2, { probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controls: [pending] })
    expect(newlyIncomplete([intolerable], [intolerable])).toEqual([])
    const after = withControlPatch(intolerable, new Set(["c-pend"]), { isExisting: true, verificationFrequency: "Trimestral" }, nameOf)
    expect(after.controls[0]).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(newlyIncomplete([intolerable], [after]).map((item) => item.rowNumber)).toEqual([2])
  })

  it("un plazo en lote no entra a una medida existente (D5) y una medida fuera del lote no cambia", () => {
    const existing = { ...pending, id: "c-ex", isExisting: true, verificationFrequency: "Trimestral", dueDate: null }
    const both = entry("c", 3, { controls: [existing, { ...pending, dueDate: null }] })
    const after = withControlPatch(both, new Set(["c-ex", "c-pend"]), { dueDate: "2026-12-31", responsible: { kind: "user", userId: "u-1" } }, nameOf)
    expect(after.controls.map((control) => [control.id, control.dueDate, control.responsibleName])).toEqual([["c-ex", null, "Ana Pérez"], ["c-pend", "2026-12-31", "Ana Pérez"]])
    expect(withControlPatch(both, new Set(["otra"]), { dueDate: "2026-12-31" }, nameOf)).toBe(both)
  })

  it("«Sí, controlado» sin medidas es un pendiente nuevo; ya pendiente por lo mismo, no se cuenta dos veces", () => {
    const sinMedidas = entry("d", 4)
    expect(newlyIncomplete([sinMedidas], [applyEntryValues(sinMedidas, { controlledStatus: "yes" }, [])]).map((item) => item.id)).toEqual(["d"])
    const yaPendiente = entry("e", 5, { controlledStatus: "yes" })
    expect(newlyIncomplete([yaPendiente], [applyEntryValues(yaPendiente, { controlledStatus: "partial" }, [])])).toEqual([])
  })
})

describe("impactSummary", () => {
  it("nombra los riesgos por N°, en orden, y resume los que no caben", () => {
    expect(impactSummary([])).toBeNull()
    expect(impactSummary([entry("x", 7)])).toBe("1 riesgo queda con pendientes nuevos: #7.")
    expect(impactSummary([entry("y", 9), entry("x", 4), entry("z", 7)])).toBe("3 riesgos quedan con pendientes nuevos: #4, #7 y #9.")
    expect(impactSummary(Array.from({ length: 12 }, (_, index) => entry(`r${index}`, index + 1)))).toBe("12 riesgos quedan con pendientes nuevos: #1, #2, #3, #4, #5 y 7 más.")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- lib/prevention/miper/control-values.test.ts lib/prevention/miper/bulk-impact.test.ts
```

Expected: FAIL, «Failed to resolve import "./control-values"» y «… "./bulk-impact"».

- [ ] **Step 3: `controlColumns` y `patchedControlValues`**

Crear `lib/prevention/miper/control-values.ts`. `controlColumns` es la de
`lib/services/miper/entries.ts:171-194`, con su comentario, tipada; el orden de las claves del objeto
que devuelve no cambia (lo hashea el historial y lo comparan pruebas existentes):

```ts
/**
 * Lo que se guarda de una medida, en un solo lugar (D5, Fase C): el guardado de
 * una medida (`saveMiperControl`), las acciones masivas (`bulk.ts`, Fase D) y la
 * vista previa de su efecto en el cliente (`bulk-impact.ts`) pasan por aquí.
 * Puro: no toca la base ni el reloj.
 */
import type { MiperControlSaveInput } from "@/lib/validation/prevention-module/miper"
import { cleanMiperName } from "./names"
import type { ControlHierarchy } from "./snapshot"

export type ControlValues = MiperControlSaveInput["values"]
export type ControlResponsible = { responsibleUserId: string | null; responsibleSnapshot: string | null }
export type ControlColumns = ControlResponsible & {
  hierarchy: ControlHierarchy
  description: string
  isExisting: boolean
  verificationFrequency: string | null
  dueDate: string | null
}

/**
 * D5 (Fase C): una medida EXISTENTE se verifica con una frecuencia y no lleva
 * plazo; una POR IMPLEMENTAR lleva plazo y no frecuencia. Lo que no aplica se
 * guarda vacío, para que un plazo viejo no quede escondido en una existente.
 * Si el pedido no trae `isExisting` o la frecuencia, se conservan los de la
 * medida (una nueva nace por implementar): un llamador anterior a la Fase C no
 * convierte una existente en pendiente al editarla.
 */
export function controlColumns(
  values: ControlValues,
  responsible: ControlResponsible,
  current: { isExisting: boolean; verificationFrequency: string | null } | null,
): ControlColumns {
  const isExisting = values.isExisting ?? current?.isExisting ?? false
  const frequency = values.verificationFrequency === undefined ? current?.verificationFrequency ?? null : cleanMiperName(values.verificationFrequency)
  return {
    hierarchy: values.hierarchy,
    description: values.description,
    ...responsible,
    isExisting,
    verificationFrequency: isExisting ? frequency : null,
    dueDate: isExisting ? null : values.dueDate ?? null,
  }
}

/** Responsable que asigna un cambio en lote: una persona de la plataforma o un nombre o cargo escrito. */
export type ResponsiblePatch = { kind: "user"; userId: string } | { kind: "text"; name: string }

/**
 * «Asignar responsable / plazo» (Fase D): lo que cambia en cada medida. Una clave
 * ausente no se toca; la medida conserva lo suyo.
 */
export type ControlPatch = {
  responsible?: ResponsiblePatch
  isExisting?: boolean
  dueDate?: string | null
  verificationFrequency?: string | null
}

/**
 * Los valores completos de una medida después de un cambio en lote: lo que el
 * pedido no trae sale de la medida. El resultado pasa por `controlColumns`, así
 * que D5 rige igual que en el editor: una existente queda sin plazo y una por
 * implementar sin frecuencia, aunque el lote traiga una fecha o una frecuencia.
 */
export function patchedControlValues(
  current: { hierarchy: ControlHierarchy; description: string; isExisting: boolean; verificationFrequency: string | null; dueDate: string | null },
  patch: ControlPatch,
): ControlValues {
  return {
    hierarchy: current.hierarchy,
    description: current.description,
    isExisting: patch.isExisting ?? current.isExisting,
    verificationFrequency: patch.verificationFrequency === undefined ? current.verificationFrequency : patch.verificationFrequency,
    dueDate: patch.dueDate === undefined ? current.dueDate : patch.dueDate,
  }
}
```

- [ ] **Step 4: La vista previa**

Crear `lib/prevention/miper/bulk-impact.ts`:

```ts
/**
 * Vista previa de una acción masiva (Fase D, spec §9): qué riesgos quedarían con
 * pendientes NUEVOS si se aplica. El editor no impide guardar un riesgo
 * incompleto —la completitud bloquea el envío a revisión, no el guardado—, pero
 * lo muestra al instante en su chequeo. En lote, el mismo efecto sobre decenas de
 * riesgos no puede pasar sin aviso: el diálogo lo dice antes de aplicar.
 *
 * Usa las reglas de siempre: `checkMiperCompleteness` (la del envío, con la regla
 * crítica) y `controlColumns` (D5). Puro.
 */
import { countOf } from "@/lib/utils"
import { checkMiperCompleteness } from "./completeness"
import { controlColumns, patchedControlValues, type ControlPatch, type ControlValues } from "./control-values"
import { cleanMiperName } from "./names"
import type { MiperControlSnapshot, MiperEntrySnapshot, MiperHeaderSnapshot } from "./snapshot"

/** La cabecera no entra: sólo se miran los pendientes de cada riesgo. */
const NO_HEADER: MiperHeaderSnapshot = {
  period: null, iperCode: null, elaboratedOn: null, updatedOn: null, companyName: null, companyRut: null, companyAddress: null, companyCommune: null,
  economicActivity: null, adherentNumber: null, worksiteName: null, siteRepresentativeUserId: null, siteRepresentativeName: null,
  headcountTotal: null, headcountMale: null, headcountFemale: null, headcountOther: null, participationSummary: "", consultationEvidenceReference: "",
}

/** Los pendientes de un riesgo por campo y mensaje: una medida nueva todavía no tiene id. */
function problemsOf(entry: MiperEntrySnapshot): Set<string> {
  return new Set(checkMiperCompleteness({ header: NO_HEADER, entries: [entry] })
    .filter((issue) => issue.entryId === entry.id && issue.severity === "error")
    .map((issue) => `${issue.field}\u001f${issue.message}`))
}

/** Los riesgos de `after` que ganan un pendiente que no tenían en `before` (se cruzan por id). */
export function newlyIncomplete(before: readonly MiperEntrySnapshot[], after: readonly MiperEntrySnapshot[]): MiperEntrySnapshot[] {
  const previous = new Map(before.map((entry) => [entry.id, problemsOf(entry)]))
  return after.filter((entry) => {
    const known = previous.get(entry.id) ?? new Set<string>()
    return [...problemsOf(entry)].some((problem) => !known.has(problem))
  })
}

type NameOf = (userId: string) => string | null

function snapshotOf(control: Pick<MiperControlSnapshot, "id" | "status">, columns: ReturnType<typeof controlColumns>): MiperControlSnapshot {
  return {
    id: control.id, hierarchy: columns.hierarchy, description: columns.description,
    responsibleUserId: columns.responsibleUserId, responsibleName: columns.responsibleSnapshot, dueDate: columns.dueDate, status: control.status,
    isExisting: columns.isExisting, verificationFrequency: columns.verificationFrequency,
  }
}

/** El riesgo con una medida más, como la dejaría `bulkAddMiperControl` (D5 incluido; nace propuesta). */
export function withAddedControl(entry: MiperEntrySnapshot, values: ControlValues, nameOf: NameOf): MiperEntrySnapshot {
  const responsibleUserId = values.responsibleUserId ?? null
  const responsibleSnapshot = responsibleUserId ? nameOf(responsibleUserId) : cleanMiperName(values.responsibleName)
  const columns = controlColumns(values, { responsibleUserId, responsibleSnapshot }, null)
  return { ...entry, controls: [...entry.controls, snapshotOf({ id: `${entry.id}:nueva`, status: "proposed" }, columns)] }
}

/** El riesgo con las medidas de `controlIds` cambiadas como las dejaría `bulkUpdateMiperControls`. */
export function withControlPatch(entry: MiperEntrySnapshot, controlIds: ReadonlySet<string>, patch: ControlPatch, nameOf: NameOf): MiperEntrySnapshot {
  if (!entry.controls.some((control) => controlIds.has(control.id))) return entry
  return {
    ...entry,
    controls: entry.controls.map((control) => {
      if (!controlIds.has(control.id)) return control
      const current = { isExisting: control.isExisting ?? false, verificationFrequency: control.verificationFrequency ?? null }
      const responsible = !patch.responsible ? { responsibleUserId: control.responsibleUserId, responsibleSnapshot: control.responsibleName }
        : patch.responsible.kind === "user" ? { responsibleUserId: patch.responsible.userId, responsibleSnapshot: nameOf(patch.responsible.userId) }
        : { responsibleUserId: null, responsibleSnapshot: cleanMiperName(patch.responsible.name) }
      const values = patchedControlValues({ hierarchy: control.hierarchy, description: control.description, dueDate: control.dueDate, ...current }, patch)
      return snapshotOf(control, controlColumns(values, responsible, current))
    }),
  }
}

/** «#4, #7 y #9», o «#1, #2, #3, #4, #5 y 7 más». */
function listOf(numbers: readonly string[], shown: number): string {
  if (numbers.length > shown) return `${numbers.slice(0, shown).join(", ")} y ${numbers.length - shown} más`
  return numbers.length === 1 ? numbers[0]! : `${numbers.slice(0, -1).join(", ")} y ${numbers.at(-1)}`
}

/** El aviso del diálogo, o `null` si nada empeora. */
export function impactSummary(entries: readonly MiperEntrySnapshot[], shown = 5): string | null {
  if (entries.length === 0) return null
  const numbers = [...entries].sort((a, b) => a.rowNumber - b.rowNumber).map((entry) => `#${entry.rowNumber}`)
  return `${countOf(entries.length, "riesgo queda", "riesgos quedan")} con pendientes nuevos: ${listOf(numbers, shown)}.`
}
```

- [ ] **Step 5: `entries.ts` usa el módulo nuevo**

En `lib/services/miper/entries.ts` (borrar la copia local; nada más cambia):

1. Reemplazar:

```ts
import { db } from "@/db"
import { preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMapMarkers, preventionRiskMatrices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanMiperName } from "@/lib/prevention/miper/names"
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperControlSaveInput, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { resolveDictionaryId } from "./dictionaries"
import { notifyMiperRowIntolerable } from "./notifications"
```

por:

```ts
import { db } from "@/db"
import { preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMapMarkers, preventionRiskMatrices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { controlColumns } from "@/lib/prevention/miper/control-values"
import { cleanMiperName } from "@/lib/prevention/miper/names"
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { resolveDictionaryId } from "./dictionaries"
import { notifyMiperRowIntolerable } from "./notifications"
```

2. Reemplazar:

```ts
  })
}

/**
 * D5 (Fase C): una medida EXISTENTE se verifica con una frecuencia y no lleva
 * plazo; una POR IMPLEMENTAR lleva plazo y no frecuencia. Lo que no aplica se
 * guarda vacío, para que un plazo viejo no quede escondido en una existente.
 * Si el pedido no trae `isExisting` o la frecuencia, se conservan los de la
 * medida (una nueva nace por implementar): un llamador anterior a la Fase C no
 * convierte una existente en pendiente al editarla.
 */
function controlColumns(
  values: MiperControlSaveInput["values"],
  responsible: { responsibleUserId: string | null; responsibleSnapshot: string | null },
  current: { isExisting: boolean; verificationFrequency: string | null } | null,
) {
  const isExisting = values.isExisting ?? current?.isExisting ?? false
  const frequency = values.verificationFrequency === undefined ? current?.verificationFrequency ?? null : cleanMiperName(values.verificationFrequency)
  return {
    hierarchy: values.hierarchy,
    description: values.description,
    ...responsible,
    isExisting,
    verificationFrequency: isExisting ? frequency : null,
    dueDate: isExisting ? null : values.dueDate ?? null,
  }
}

export async function saveMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlSaveSchema.parse(input)
  return db.transaction(async (tx) => {
```

por:

```ts
  })
}

export async function saveMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlSaveSchema.parse(input)
  return db.transaction(async (tx) => {
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test:fast -- lib/prevention/miper/control-values.test.ts lib/prevention/miper/bulk-impact.test.ts lib/prevention/miper/completeness.test.ts
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
```

Expected: todo PASS. La PGlite de filas y medidas sigue verde: `saveMiperControl` guarda lo mismo.

- [ ] **Step 7: Puertas**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/control-values.ts lib/prevention/miper/control-values.test.ts lib/prevention/miper/bulk-impact.ts lib/prevention/miper/bulk-impact.test.ts lib/services/miper/entries.ts
```

- [ ] **Step 8: Commit**

```bash
git add lib/prevention/miper/control-values.ts lib/prevention/miper/control-values.test.ts lib/prevention/miper/bulk-impact.ts lib/prevention/miper/bulk-impact.test.ts lib/services/miper/entries.ts
git commit -m "feat(miper): D5 en un módulo puro y vista previa de los pendientes que deja un cambio en lote" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Esquemas de las acciones masivas

**Files:**
- Modify: `lib/validation/prevention-module/miper.ts:79-97` (se extrae `miperControlValuesSchema` y se
  agrega la sección «Acciones masivas»), `:267-276` (las decisiones de la importación reutilizan
  `responsibleUser`, `responsibleText` y `frequencyText`) y `:319` (tipos)
- Test: `lib/validation/prevention-module/miper.test.ts:1-2` (import) y tres tests al final

**Interfaces:**
- Consumes: las constantes de la Task 1 (`MEASURE_MAX_LENGTH`, `RESPONSIBLE_MAX_LENGTH`,
  `FREQUENCY_MAX_LENGTH`).
- Produces:
  - `MIPER_BULK_LIMIT = 300`
  - `miperControlValuesSchema`: los valores de una medida (los mismos de `miperControlSaveSchema.values`,
    que ahora la usa).
  - `miperBulkEntryValuesSchema`: `miperEntryValuesSchema.pick({ activity, task, position, location,
    riskFactorId, isRoutine, controlledStatus })`, estricto y con al menos una clave.
  - `miperBulkPatchEntriesSchema`: `{ matrixId, items: Array<{ entryId, expectedVersion }>, values }`.
  - `miperBulkAddControlSchema`: `{ matrixId, items: Array<{ entryId, expectedVersion }>, values:
    miperControlValuesSchema }`.
  - `miperBulkControlPatchSchema` (estricto, al menos una clave): `{ responsible?: { kind: "user";
    userId } | { kind: "text"; name }, isExisting?, dueDate?: civil | null, verificationFrequency? }`.
  - `miperBulkUpdateControlsSchema`: `{ matrixId, items: Array<{ controlId, expectedVersion }>, patch }`.
  - Los `items` van de 1 a 300, sin ids repetidos; mensajes: «Se pueden cambiar hasta 300 riesgos a la
    vez; divide la selección.», «Hay riesgos repetidos en la selección; recarga la matriz.» (y sus
    versiones con «medidas»).
  - Tipos: `MiperBulkPatchEntriesInput`, `MiperBulkAddControlInput`, `MiperBulkUpdateControlsInput`.
    `z.infer<typeof miperBulkControlPatchSchema>` es asignable a `ControlPatch` (Task 2).

- [ ] **Step 1: Write the failing tests**

En `lib/validation/prevention-module/miper.test.ts`:

1. Reemplazar:

```ts
import { describe, expect, it } from "vitest"
import { FREQUENCY_MAX_LENGTH, MEASURE_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { createMiperSchema, IMPORT_LIMITS, miperApproveFinalSchema, miperControlSaveSchema, miperEntrySaveSchema, miperHeaderSchema, miperObservationSchema, programActionSchema, riskImportCommitSchema } from "./miper"

const header = {
  matrixId: "m1", expectedVersion: 1, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: "2026-05-02",
```

por:

```ts
import { describe, expect, it } from "vitest"
import { FREQUENCY_MAX_LENGTH, MEASURE_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import {
  createMiperSchema, IMPORT_LIMITS, MIPER_BULK_LIMIT, miperApproveFinalSchema, miperBulkAddControlSchema, miperBulkPatchEntriesSchema, miperBulkUpdateControlsSchema,
  miperControlSaveSchema, miperEntrySaveSchema, miperHeaderSchema, miperObservationSchema, programActionSchema, riskImportCommitSchema,
} from "./miper"

const header = {
  matrixId: "m1", expectedVersion: 1, iperCode: "RE-04", elaboratedOn: "2026-04-30", updatedOn: "2026-05-02",
```

2. Reemplazar:

```ts
      expect([schema, accept("2028-02-29")]).toEqual([schema, true])
    }
  })
})
```

por:

```ts
      expect([schema, accept("2028-02-29")]).toEqual([schema, true])
    }
  })

  it("acciones masivas: de 1 a 300 elementos, sin repetidos, cada uno con su versión (Fase D)", () => {
    const items = (count: number) => Array.from({ length: count }, (_, index) => ({ entryId: `e${index}`, expectedVersion: 1 }))
    const patch = (list: unknown) => miperBulkPatchEntriesSchema.safeParse({ matrixId: "m1", items: list, values: { controlledStatus: "yes" } })
    expect(patch(items(1)).success).toBe(true)
    expect(patch(items(MIPER_BULK_LIMIT)).success).toBe(true)
    const over = patch(items(MIPER_BULK_LIMIT + 1))
    expect(over.success).toBe(false)
    expect(over.error?.issues[0]?.message).toBe("Se pueden cambiar hasta 300 riesgos a la vez; divide la selección.")
    expect(patch([]).success).toBe(false)
    expect(patch([{ entryId: "e1", expectedVersion: 1 }, { entryId: "e1", expectedVersion: 2 }]).error?.issues[0]?.message).toBe("Hay riesgos repetidos en la selección; recarga la matriz.")
    expect(patch([{ entryId: "e1" }]).success).toBe(false)
    const controls = (list: unknown) => miperBulkUpdateControlsSchema.safeParse({ matrixId: "m1", items: list, patch: { dueDate: "2026-12-31" } })
    expect(controls([{ controlId: "c1", expectedVersion: 3 }]).success).toBe(true)
    expect(controls(Array.from({ length: MIPER_BULK_LIMIT + 1 }, (_, index) => ({ controlId: `c${index}`, expectedVersion: 1 }))).success).toBe(false)
  })

  it("cambio de riesgos en lote: contexto, «¿controlado?», factor y rutinaria; nunca P×C ni los textos del peligro (Fase D)", () => {
    const values = (value: Record<string, unknown>) => miperBulkPatchEntriesSchema.safeParse({ matrixId: "m1", items: [{ entryId: "e1", expectedVersion: 1 }], values: value }).success
    expect(values({ activity: "Bodega", task: "Trasvasije", position: "Bodeguero", location: null })).toBe(true)
    expect(values({ controlledStatus: "partial", riskFactorId: "rf-1", isRoutine: false })).toBe(true)
    expect(values({ probability: 4 })).toBe(false)
    expect(values({ consequence: 2, controlledStatus: "yes" })).toBe(false)
    expect(values({ hazard: "Otro peligro" })).toBe(false)
    expect(values({})).toBe(false)
  })

  it("medida en lote: los valores del editor (D5 y fechas de calendario) y un cambio de medidas acotado (Fase D)", () => {
    const add = (value: Record<string, unknown>) => miperBulkAddControlSchema.safeParse({ matrixId: "m1", items: [{ entryId: "e1", expectedVersion: 1 }], values: { hierarchy: "administrative", description: "Charla de trasvasije", ...value } }).success
    expect(add({ isExisting: true, verificationFrequency: "Mensual" })).toBe(true)
    expect(add({ dueDate: "2026-02-31" })).toBe(false)
    expect(add({ description: "ok" })).toBe(false)
    const update = (value: Record<string, unknown>) => miperBulkUpdateControlsSchema.safeParse({ matrixId: "m1", items: [{ controlId: "c1", expectedVersion: 1 }], patch: value }).success
    expect(update({ responsible: { kind: "user", userId: "u-1" } })).toBe(true)
    expect(update({ responsible: { kind: "text", name: "Supervisor de turno" }, isExisting: false, dueDate: "2026-12-31" })).toBe(true)
    expect(update({ isExisting: true, verificationFrequency: "Trimestral" })).toBe(true)
    expect(update({})).toBe(false)
    expect(update({ responsible: { kind: "text", name: "  " } })).toBe(false)
    expect(update({ responsible: { kind: "none" } })).toBe(false)
    expect(update({ dueDate: "2026-02-31" })).toBe(false)
    expect(update({ verificationFrequency: "x".repeat(121) })).toBe(false)
    expect(update({ description: "Otra medida" })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- lib/validation/prevention-module/miper.test.ts
```

Expected: FAIL: `MIPER_BULK_LIMIT`, `miperBulkPatchEntriesSchema`, `miperBulkAddControlSchema` y
`miperBulkUpdateControlsSchema` no existen.

- [ ] **Step 3: Los esquemas**

En `lib/validation/prevention-module/miper.ts`:

1. Reemplazar:

```ts

export const miperEntryRefSchema = z.object({ matrixId: id, entryId: id, expectedVersion: version.optional() })

export const miperControlSaveSchema = z.object({
  matrixId: id,
  entryId: id,
  controlId: id.optional(),
  expectedVersion: version.optional(),
  values: z.object({
    hierarchy: z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." }),
    description: z.string().trim().min(3, "Describe la medida.").max(MEASURE_MAX_LENGTH),
    responsibleUserId: id.nullable().optional(),
    responsibleName: z.string().trim().max(RESPONSIBLE_MAX_LENGTH).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    /* D5 (Fase C): una medida ya implementada se verifica con una frecuencia y no
     * lleva plazo. Opcionales: sin ellos se conserva lo que la medida ya tenía. */
    isExisting: z.boolean().optional(),
    verificationFrequency: z.string().trim().max(FREQUENCY_MAX_LENGTH, `La frecuencia admite hasta ${FREQUENCY_MAX_LENGTH} caracteres.`).nullable().optional(),
  }),
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })

export const miperControlRefSchema = z.object({ matrixId: id, controlId: id, expectedVersion: version })

export const miperWorkflowSchema = z.object({ matrixId: id, expectedVersion: version, comment: z.string().trim().max(3000).optional() })
export const miperCommentedDecisionSchema = miperWorkflowSchema.extend({ comment: z.string().trim().min(10, "Explica la decisión en al menos 10 caracteres.").max(3000) })
export const miperApproveFinalSchema = miperWorkflowSchema.extend({ changeSummary: z.string().trim().min(10, "Resume los cambios de esta versión (hoja Modificaciones).").max(3000) })
```

por:

```ts

export const miperEntryRefSchema = z.object({ matrixId: id, entryId: id, expectedVersion: version.optional() })

const frequencyText = z.string().trim().max(FREQUENCY_MAX_LENGTH, `La frecuencia admite hasta ${FREQUENCY_MAX_LENGTH} caracteres.`)

/** Los valores de una medida: los del editor (`saveMiperControl`) y los de «Agregar medida a N» (Fase D). */
export const miperControlValuesSchema = z.object({
  hierarchy: z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." }),
  description: z.string().trim().min(3, "Describe la medida.").max(MEASURE_MAX_LENGTH),
  responsibleUserId: id.nullable().optional(),
  responsibleName: z.string().trim().max(RESPONSIBLE_MAX_LENGTH).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  /* D5 (Fase C): una medida ya implementada se verifica con una frecuencia y no
   * lleva plazo. Opcionales: sin ellos se conserva lo que la medida ya tenía. */
  isExisting: z.boolean().optional(),
  verificationFrequency: frequencyText.nullable().optional(),
})

export const miperControlSaveSchema = z.object({
  matrixId: id,
  entryId: id,
  controlId: id.optional(),
  expectedVersion: version.optional(),
  values: miperControlValuesSchema,
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })

export const miperControlRefSchema = z.object({ matrixId: id, controlId: id, expectedVersion: version })

/* ── Acciones masivas (Fase D, spec §9) ───────────────────────────────────
 * Hasta `MIPER_BULK_LIMIT` elementos por operación, cada uno con la versión que
 * vio la persona: una sola versión vieja aborta todo. El tope acota la
 * transacción (todo o nada, con la matriz bloqueada) y el cuerpo de la Server
 * Function. Un elemento repetido se rechaza: escribiría dos veces su historial. */

export const MIPER_BULK_LIMIT = 300

const distinct = (ids: readonly string[]) => new Set(ids).size === ids.length

const bulkEntryItems = z.array(z.object({ entryId: id, expectedVersion: version }))
  .min(1, "Selecciona al menos un riesgo.")
  .max(MIPER_BULK_LIMIT, `Se pueden cambiar hasta ${MIPER_BULK_LIMIT} riesgos a la vez; divide la selección.`)
  .refine((items) => distinct(items.map((item) => item.entryId)), { message: "Hay riesgos repetidos en la selección; recarga la matriz." })

const bulkControlItems = z.array(z.object({ controlId: id, expectedVersion: version }))
  .min(1, "Selecciona al menos una medida.")
  .max(MIPER_BULK_LIMIT, `Se pueden cambiar hasta ${MIPER_BULK_LIMIT} medidas a la vez; divide la selección.`)
  .refine((items) => distinct(items.map((item) => item.controlId)), { message: "Hay medidas repetidas en la selección; recarga la matriz." })

const hasSomeKey = (value: object) => Object.keys(value).length > 0

/**
 * Lo que un cambio de riesgos en lote puede tocar (spec §9): «¿controlado?»,
 * factor, puesto, lugar, actividad, tarea y rutinaria. Nunca P×C ni los textos
 * del peligro: eso se decide riesgo por riesgo en el editor. Estricto: una clave
 * más se rechaza.
 */
export const miperBulkEntryValuesSchema = miperEntryValuesSchema
  .pick({ activity: true, task: true, position: true, location: true, riskFactorId: true, isRoutine: true, controlledStatus: true })
  .refine(hasSomeKey, { message: "No hay cambios que aplicar." })

export const miperBulkPatchEntriesSchema = z.object({ matrixId: id, items: bulkEntryItems, values: miperBulkEntryValuesSchema })

/** La misma medida en N riesgos: sus valores son los del editor de la medida. */
export const miperBulkAddControlSchema = z.object({ matrixId: id, items: bulkEntryItems, values: miperControlValuesSchema })

const responsibleUser = z.object({ kind: z.literal("user"), userId: id })
const responsibleText = z.object({ kind: z.literal("text"), name: z.string().trim().min(1, "Escribe el responsable.").max(RESPONSIBLE_MAX_LENGTH) })

/**
 * «Asignar responsable / plazo»: cada clave presente se aplica a todas las
 * medidas del lote y cada clave ausente se conserva en cada una. D5 rige como en
 * el editor (`controlColumns`): el plazo no entra a una existente ni la
 * frecuencia a una por implementar.
 */
export const miperBulkControlPatchSchema = z.strictObject({
  responsible: z.discriminatedUnion("kind", [responsibleUser, responsibleText]).optional(),
  isExisting: z.boolean().optional(),
  dueDate: isoDate.nullable().optional(),
  verificationFrequency: frequencyText.nullable().optional(),
}).refine(hasSomeKey, { message: "Elige qué cambiar: el responsable, el plazo o si ya está implementada." })

export const miperBulkUpdateControlsSchema = z.object({ matrixId: id, items: bulkControlItems, patch: miperBulkControlPatchSchema })

export const miperWorkflowSchema = z.object({ matrixId: id, expectedVersion: version, comment: z.string().trim().max(3000).optional() })
export const miperCommentedDecisionSchema = miperWorkflowSchema.extend({ comment: z.string().trim().min(10, "Explica la decisión en al menos 10 caracteres.").max(3000) })
export const miperApproveFinalSchema = miperWorkflowSchema.extend({ changeSummary: z.string().trim().min(10, "Resume los cambios de esta versión (hoja Modificaciones).").max(3000) })
```

2. Reemplazar:

```ts
const controlHierarchySchema = z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." })

const responsibleDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: id }),
  z.object({ kind: z.literal("text"), name: z.string().trim().min(1, "Escribe el responsable.").max(RESPONSIBLE_MAX_LENGTH) }),
  z.object({ kind: z.literal("none") }),
])

const deadlineDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), frequency: z.string().trim().max(FREQUENCY_MAX_LENGTH, `La frecuencia admite hasta ${FREQUENCY_MAX_LENGTH} caracteres.`).nullable() }),
  z.object({ kind: z.literal("pending"), dueDate: isoDate.nullable() }),
])
```

por:

```ts
const controlHierarchySchema = z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." })

const responsibleDecisionSchema = z.discriminatedUnion("kind", [
  responsibleUser,
  responsibleText,
  z.object({ kind: z.literal("none") }),
])

const deadlineDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), frequency: frequencyText.nullable() }),
  z.object({ kind: z.literal("pending"), dueDate: isoDate.nullable() }),
])
```

3. Reemplazar:

```ts
export type MiperEntryValues = z.infer<typeof miperEntryValuesSchema>
export type MiperEntrySaveInput = z.infer<typeof miperEntrySaveSchema>
export type MiperControlSaveInput = z.infer<typeof miperControlSaveSchema>
```

por:

```ts
export type MiperEntryValues = z.infer<typeof miperEntryValuesSchema>
export type MiperEntrySaveInput = z.infer<typeof miperEntrySaveSchema>
export type MiperControlSaveInput = z.infer<typeof miperControlSaveSchema>
export type MiperBulkPatchEntriesInput = z.infer<typeof miperBulkPatchEntriesSchema>
export type MiperBulkAddControlInput = z.infer<typeof miperBulkAddControlSchema>
export type MiperBulkUpdateControlsInput = z.infer<typeof miperBulkUpdateControlsSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:fast -- lib/validation/prevention-module/miper.test.ts "app/(app)/prevencion/miper/[id]/control-form.test.tsx"
npm run test:pglite -- lib/__tests__/miper-import.test.ts
```

Expected: PASS. La importación sigue verde: sus decisiones aceptan lo mismo que antes.

- [ ] **Step 5: Puertas y commit**

```bash
npm run typecheck
npm run lint -- lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts
git add lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts
git commit -m "feat(miper): esquemas de las acciones masivas: hasta 300 elementos sin repetidos, nunca P×C y los valores del editor de la medida" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Servicio `bulk.ts` y su suite PGlite (criterio D)

**Files:**
- Modify: `lib/services/miper/entries.ts:24` (`touchMatrix` exportada), `:37` (`toColumns` exportada,
  con comentario), `:196-207` (`controlResponsible` nuevo; `saveMiperControl` lo usa) e import de
  `ControlResponsible`
- Create: `lib/services/miper/bulk.ts`
- Create: `lib/__tests__/miper-bulk.test.ts`
- Modify: `tests/pglite-files.ts:22` (registrar la suite nueva)

**Interfaces:**
- Consumes:
  - de la Task 2: `controlColumns`, `patchedControlValues`, `type ControlResponsible`;
  - de la Task 3: `miperBulkPatchEntriesSchema`, `miperBulkAddControlSchema`,
    `miperBulkUpdateControlsSchema`;
  - de `shared.ts`: `lockMatrix`, `requireAccess`, `assertEditable`, `miperHistory`, `nowIso`.
- Produces (`lib/services/miper/entries.ts`):
  - `export async function touchMatrix(client: Client, matrixId: string, now: string): Promise<void>`
  - `export async function toColumns(client: Client, worksiteId: string, values: MiperEntryValues):
    Promise<Partial<typeof preventionRiskEntries.$inferInsert>>`
  - `export async function controlResponsible(client: Client, values: { responsibleUserId?: string |
    null; responsibleName?: string | null }): Promise<ControlResponsible>` — persona activa
    (`assertActiveUsers`) con su nombre como foto, o el nombre escrito limpio.
- Produces (`lib/services/miper/bulk.ts`):
  - `export const BULK_REASON = "Edición masiva"`
  - `export type BulkSaved = { id: string; version: number }`
  - `bulkPatchMiperEntries(input: unknown, access: MiperAccess): Promise<{ entries: BulkSaved[] }>` —
    versiones nuevas en el orden de `items`.
  - `bulkAddMiperControl(input: unknown, access: MiperAccess): Promise<{ controls: Array<{ id: string;
    entryId: string }> }>`
  - `bulkUpdateMiperControls(input: unknown, access: MiperAccess): Promise<{ controls: BulkSaved[] }>`
  - Rechazos (`RiskLegalDomainError`): «N riesgo(s) no existe(n) en esta MIPER; recarga la matriz.»,
    «N riesgo(s) cambió/cambiaron mientras editabas; recarga la matriz para ver los cambios de la otra
    persona.» y sus equivalentes con «medida(s)»; los de `requireAccess`/`assertEditable`/
    `assertActiveUsers` sin cambios.

- [ ] **Step 1: Write the failing test**

Crear `lib/__tests__/miper-bulk.test.ts`. Cubre, en este orden: el criterio D (40 riesgos), la versión
vieja que aborta todo, el alcance (otra faena, sólo lectura, riesgo de otra MIPER), legacy y
reemplazada (con MIPER propias, para no dejar la principal bloqueada), el tope, el contexto en lote
(diccionario de la faena, nunca P×C, historial por riesgo), D5 en lote y las reglas que abortan
(fecha de calendario, persona inactiva, versión de una medida):

```ts
/**
 * Fase D (spec §9): acciones masivas de la MIPER. Cada operación es UNA
 * transacción: una versión vieja, un elemento ajeno, un dato inválido o una
 * persona inactiva abortan todo y no queda nada escrito, ni en las tablas ni en
 * el historial. Las reglas son las del guardado de a uno: D5, fechas de
 * calendario, personas activas, diccionario de la faena y medida «propuesta».
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq, inArray } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const bulk = await import("@/lib/services/miper/bulk")
const { buildMiperSnapshot } = await import("@/lib/services/miper/snapshots")

const author = { userId: "u-a", scope: { mode: "some" as const, ids: ["ws-b"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const outsider = { userId: "u-x", scope: { mode: "some" as const, ids: ["ws-x"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const viewer = { userId: "u-a", scope: { mode: "some" as const, ids: ["ws-b"] }, permissions: ["prevention:risk:view"] }
const OUT_OF_SCOPE = "Registro preventivo no encontrado o fuera de alcance."
let matrixId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-b", name: "Faena B", code: "B" }, { id: "ws-x", name: "Faena X", code: "X" }])
  await testDb.insert(schema.users).values([
    { id: "u-a", name: "Autora", email: "a@b.cl", hashedPassword: "x", isActive: true },
    { id: "u-x", name: "Externa", email: "x@b.cl", hashedPassword: "x", isActive: true },
    { id: "u-off", name: "Inactiva", email: "off@b.cl", hashedPassword: "x", isActive: false },
  ])
  matrixId = (await createMiper({ worksiteId: "ws-b", period: 2026, revisionReason: "Período para las acciones masivas." }, author)).id
}, 60_000)

let nextRow = 100
/** N riesgos Moderados, «No» controlados, sembrados directo: lo que se prueba es el lote, no el alta. */
async function seedEntries(prefix: string, count: number, matrix = matrixId) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`, matrixId: matrix, rowNumber: nextRow++, hazardCode: `R-${prefix}-${index + 1}`,
    hazard: `Peligro ${prefix} ${index + 1}`, probability: 2, consequence: 2, controlledStatus: "no",
  }))
  await testDb.insert(schema.preventionRiskEntries).values(rows)
  return rows.map((row) => ({ entryId: row.id, expectedVersion: 1 }))
}
const auditCount = async () => (await testDb.select({ id: schema.auditLog.id }).from(schema.auditLog).where(eq(schema.auditLog.entityId, matrixId))).length
const controlsOf = (entryIds: string[]) => testDb.select().from(schema.preventionRiskControls).where(inArray(schema.preventionRiskControls.riskEntryId, entryIds)).orderBy(asc(schema.preventionRiskControls.id))
const entriesOf = (entryIds: string[]) => testDb.select().from(schema.preventionRiskEntries).where(inArray(schema.preventionRiskEntries.id, entryIds)).orderBy(asc(schema.preventionRiskEntries.rowNumber))
const MEASURE = { hierarchy: "administrative" as const, description: "Charla de trasvasije seguro", responsibleUserId: "u-a", isExisting: false, dueDate: "2026-12-31" }

describe("acciones masivas de la MIPER (Fase D)", () => {
  it("criterio D: una medida se aplica a 40 riesgos en una sola operación; nace propuesta, con su historial por riesgo", async () => {
    const items = await seedEntries("cuarenta", 40)
    const before = await auditCount()
    const result = await bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, author)
    expect(result.controls).toHaveLength(40)
    const created = await controlsOf(items.map((item) => item.entryId))
    expect(created).toHaveLength(40)
    expect(new Set(created.map((control) => control.riskEntryId)).size).toBe(40)
    for (const control of created) {
      expect(control).toMatchObject({ description: "Charla de trasvasije seguro", hierarchy: "administrative", responsibleUserId: "u-a", responsibleSnapshot: "Autora", isExisting: false, dueDate: "2026-12-31", verificationFrequency: null, status: "proposed", version: 1 })
    }
    // Agregar una medida no cambia la versión del riesgo, igual que en el editor.
    expect((await entriesOf(items.map((item) => item.entryId))).every((entry) => entry.version === 1)).toBe(true)
    const log = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, matrixId))
    const bulkRows = log.filter((row) => row.reason === "Edición masiva" && (JSON.parse(row.newState ?? "{}") as { changeType?: string }).changeType === "control_created")
    expect(bulkRows).toHaveLength(40)
    expect(await auditCount()).toBe(before + 40)
  })

  it("una versión vieja aborta todo: ni medidas, ni cambios, ni historial", async () => {
    const items = await seedEntries("vieja", 40)
    // Otra pestaña guardó el riesgo 17 después de que la persona lo vio.
    await entries.saveMiperEntry({ matrixId, entryId: "vieja-17", expectedVersion: 1, values: { risk: "Inhalación de vapores" } }, author)
    const before = await auditCount()
    await expect(bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, author))
      .rejects.toThrow("1 riesgo cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona.")
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes", position: "Bodeguero" } }, author))
      .rejects.toThrow("1 riesgo cambió mientras editabas")
    expect(await controlsOf(items.map((item) => item.entryId))).toEqual([])
    const rows = await entriesOf(items.map((item) => item.entryId))
    expect(rows.filter((row) => row.controlledStatus === "yes" || row.positionId !== null)).toEqual([])
    expect(rows.find((row) => row.id === "vieja-17")!.version).toBe(2)
    expect(await auditCount()).toBe(before)
  })

  it("alcance: otra faena, sólo lectura y un riesgo de otra MIPER se rechazan sin escribir nada", async () => {
    const items = await seedEntries("alcance", 2)
    const other = (await createMiper({ worksiteId: "ws-b", period: 2027, revisionReason: "Otra MIPER de la misma faena." }, author)).id
    const [foreign] = await seedEntries("ajena", 1, other)
    const before = await auditCount()
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes" } }, outsider)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, viewer)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items: [...items, foreign!], values: { controlledStatus: "yes" } }, author))
      .rejects.toThrow("1 riesgo no existe en esta MIPER; recarga la matriz.")
    expect((await entriesOf([...items, foreign!].map((item) => item.entryId))).map((row) => row.controlledStatus)).toEqual(["no", "no", "no"])
    expect(await auditCount()).toBe(before)
  })

  it("una MIPER de la metodología anterior o reemplazada no admite cambios en lote", async () => {
    // MIPER propias: la de las demás pruebas sigue editable.
    const legacy = (await createMiper({ worksiteId: "ws-b", period: 2024, revisionReason: "MIPER de la metodología anterior." }, author)).id
    const superseded = (await createMiper({ worksiteId: "ws-b", period: 2023, revisionReason: "MIPER ya reemplazada por otra." }, author)).id
    await testDb.update(schema.preventionRiskMatrices).set({ isLegacy: true }).where(eq(schema.preventionRiskMatrices.id, legacy))
    await testDb.update(schema.preventionRiskMatrices).set({ status: "superseded", reviewedByUserId: "u-a", approvedByUserId: "u-x" }).where(eq(schema.preventionRiskMatrices.id, superseded))
    const legacyItems = await seedEntries("legacy", 1, legacy)
    const supersededItems = await seedEntries("reemplazada", 1, superseded)
    await expect(bulk.bulkPatchMiperEntries({ matrixId: legacy, items: legacyItems, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/solo lectura/)
    await expect(bulk.bulkAddMiperControl({ matrixId: legacy, items: legacyItems, values: MEASURE }, author)).rejects.toThrow(/solo lectura/)
    await expect(bulk.bulkPatchMiperEntries({ matrixId: superseded, items: supersededItems, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/reemplazada/)
    await expect(bulk.bulkAddMiperControl({ matrixId: superseded, items: supersededItems, values: MEASURE }, author)).rejects.toThrow(/reemplazada/)
    expect(await controlsOf([...legacyItems, ...supersededItems].map((item) => item.entryId))).toEqual([])
    expect((await entriesOf([...legacyItems, ...supersededItems].map((item) => item.entryId))).map((row) => row.controlledStatus)).toEqual(["no", "no"])
  })

  it("tope: 301 elementos se rechazan antes de abrir la transacción", async () => {
    const items = Array.from({ length: 301 }, (_, index) => ({ entryId: `cualquiera-${index}`, expectedVersion: 1 }))
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/hasta 300 riesgos/)
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items: items.map((item, index) => ({ controlId: `c-${index}`, expectedVersion: 1 })), patch: { dueDate: "2026-12-31" } }, author))
      .rejects.toThrow(/hasta 300 medidas/)
  })

  it("contexto en lote: usa el diccionario de la faena, nunca toca P×C y deja una entrada por riesgo con el motivo «Edición masiva»", async () => {
    const items = await seedEntries("contexto", 3)
    // La faena ya tiene la actividad escrita de otra forma: se reutiliza, como en el editor.
    await entries.saveMiperEntry({ matrixId, values: { activity: "Bodega de químicos", task: "Recepción" } }, author)
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { probability: 4 } }, author)).rejects.toThrow()
    const result = await bulk.bulkPatchMiperEntries({ matrixId, items, values: { activity: "BODEGA DE QUIMICOS", task: "Trasvasije de solventes", position: "Bodeguero" } }, author)
    expect(result.entries).toEqual(items.map((item) => ({ id: item.entryId, version: 2 })))
    const snapshot = (await buildMiperSnapshot(testDb, matrixId)).entries.filter((entry) => entry.id.startsWith("contexto-"))
    expect(snapshot.map((entry) => [entry.activity, entry.task, entry.position, entry.probability, entry.consequence, entry.classification])).toEqual(
      Array.from({ length: 3 }, () => ["Bodega de químicos", "Trasvasije de solventes", "Bodeguero", 2, 2, "moderate"]))
    // La clave de la tarea que calcula el cliente con lo escrito es la misma que la de los nombres del diccionario.
    expect(taskKeyOf(snapshot[0]!)).toBe(taskKeyOf({ activity: "BODEGA DE QUIMICOS", task: "Trasvasije de solventes" }))
    const log = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, matrixId), eq(schema.auditLog.reason, "Edición masiva")))
    const mine = log.map((row) => ({ before: JSON.parse(row.oldState ?? "{}") as Record<string, unknown>, after: JSON.parse(row.newState ?? "{}") as Record<string, unknown> }))
      .filter(({ after }) => String(after.objectId).startsWith("contexto-"))
    expect(mine.map(({ after }) => [after.changeType, after.objectId]).sort()).toEqual(items.map((item) => ["entry_updated", item.entryId]))
    expect(mine[0]!.before).toMatchObject({ processId: null, taskId: null, positionId: null })
    expect(mine[0]!.after).toMatchObject({ processId: expect.any(String), taskId: expect.any(String), positionId: expect.any(String) })
  })

  it("D5 en lote: el plazo no entra a una existente, pasar a existente borra el plazo, y lo que el lote no trae se conserva", async () => {
    const [pendingEntry, existingEntry] = await seedEntries("d5", 2)
    const pending = await entries.saveMiperControl({ matrixId, entryId: pendingEntry!.entryId, values: { hierarchy: "engineering", description: "Extracción localizada", responsibleName: "Supervisor de turno", dueDate: "2026-11-30" } }, author)
    const existing = await entries.saveMiperControl({ matrixId, entryId: existingEntry!.entryId, values: { hierarchy: "ppe", description: "Respirador con filtro", responsibleName: "Bodeguero", isExisting: true, verificationFrequency: "Trimestral" } }, author)
    const items = [{ controlId: pending.id, expectedVersion: 1 }, { controlId: existing.id, expectedVersion: 1 }]
    const stored = async () => Object.fromEntries((await testDb.select().from(schema.preventionRiskControls).where(inArray(schema.preventionRiskControls.id, [pending.id, existing.id])))
      .map((row) => [row.id === pending.id ? "pending" : "existing", row]))

    await bulk.bulkUpdateMiperControls({ matrixId, items, patch: { dueDate: "2027-01-15" } }, author)
    let rows = await stored()
    expect(rows.pending).toMatchObject({ dueDate: "2027-01-15", isExisting: false, responsibleSnapshot: "Supervisor de turno", version: 2 })
    expect(rows.existing).toMatchObject({ dueDate: null, isExisting: true, verificationFrequency: "Trimestral", responsibleSnapshot: "Bodeguero", version: 2 })

    await bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: pending.id, expectedVersion: 2 }], patch: { isExisting: true, verificationFrequency: " Semestral " } }, author)
    await bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: existing.id, expectedVersion: 2 }], patch: { isExisting: false, dueDate: "2027-02-28" } }, author)
    rows = await stored()
    expect(rows.pending).toMatchObject({ isExisting: true, verificationFrequency: "Semestral", dueDate: null })
    expect(rows.existing).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2027-02-28" })

    // Una medida en lote, ya implementada: tampoco lleva plazo aunque el pedido lo traiga.
    const [extra] = await seedEntries("d5-alta", 1)
    await bulk.bulkAddMiperControl({ matrixId, items: [extra!], values: { ...MEASURE, isExisting: true, verificationFrequency: "Mensual" } }, author)
    expect((await controlsOf([extra!.entryId]))[0]).toMatchObject({ isExisting: true, verificationFrequency: "Mensual", dueDate: null, status: "proposed" })

    const log = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, matrixId), eq(schema.auditLog.reason, "Edición masiva")))
    const toExisting = log.map((row) => ({ before: JSON.parse(row.oldState ?? "{}") as Record<string, unknown>, after: JSON.parse(row.newState ?? "{}") as Record<string, unknown> }))
      .find(({ after }) => after.objectId === pending.id && after.isExisting === true)!
    expect(toExisting.before).toMatchObject({ isExisting: false, dueDate: "2027-01-15", verificationFrequency: null })
    expect(toExisting.after).toMatchObject({ changeType: "control_updated", isExisting: true, dueDate: null, verificationFrequency: "Semestral" })
  })

  it("fechas de calendario, personas activas y versiones de medidas también abortan todo el lote", async () => {
    const [a, b] = await seedEntries("reglas", 2)
    const first = await entries.saveMiperControl({ matrixId, entryId: a!.entryId, values: { hierarchy: "administrative", description: "Hoja de seguridad a la vista", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const second = await entries.saveMiperControl({ matrixId, entryId: b!.entryId, values: { hierarchy: "administrative", description: "Hoja de seguridad a la vista", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const items = [{ controlId: first.id, expectedVersion: 1 }, { controlId: second.id, expectedVersion: 1 }]
    const before = await auditCount()
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items, patch: { dueDate: "2026-02-31" } }, author)).rejects.toThrow()
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items, patch: { responsible: { kind: "user", userId: "u-off" } } }, author)).rejects.toThrow("La persona responsable no existe o está inactiva.")
    await expect(bulk.bulkAddMiperControl({ matrixId, items: [a!, b!], values: { ...MEASURE, responsibleUserId: "u-off" } }, author)).rejects.toThrow("La persona responsable no existe o está inactiva.")
    await entries.saveMiperControl({ matrixId, entryId: b!.entryId, controlId: second.id, expectedVersion: 1, values: { hierarchy: "administrative", description: "Hoja de seguridad plastificada", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const afterEdit = await auditCount()
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items, patch: { responsible: { kind: "text", name: "Jefe de bodega" } } }, author))
      .rejects.toThrow("1 medida cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona.")
    const rows = await controlsOf([a!.entryId, b!.entryId])
    expect(rows.map((row) => [row.responsibleSnapshot, row.dueDate])).toEqual([["Bodeguero", "2026-11-30"], ["Bodeguero", "2026-11-30"]])
    expect(rows.filter((row) => row.riskEntryId === a!.entryId)).toHaveLength(1)
    expect(afterEdit).toBe(before + 1)
    expect(await auditCount()).toBe(afterEdit)
  })
})
```

En `tests/pglite-files.ts`:

Reemplazar:

```ts
  "lib/__tests__/miper-matrices.test.ts",
  // MIPER F1: filas y medidas con concurrencia optimista, inserción y borrado.
  "lib/__tests__/miper-entries.test.ts",
  // MIPER F1: foto viva del documento con nombres de diccionario y medidas.
  "lib/__tests__/miper-snapshot-service.test.ts",
  // MIPER Fase B: fotos en lote y prueba dorada de que la foto de una sola no cambió (snapshotSha).
```

por:

```ts
  "lib/__tests__/miper-matrices.test.ts",
  // MIPER F1: filas y medidas con concurrencia optimista, inserción y borrado.
  "lib/__tests__/miper-entries.test.ts",
  // MIPER Fase D: acciones masivas atómicas (versión vieja, alcance, legacy, tope, D5 e historial).
  "lib/__tests__/miper-bulk.test.ts",
  // MIPER F1: foto viva del documento con nombres de diccionario y medidas.
  "lib/__tests__/miper-snapshot-service.test.ts",
  // MIPER Fase B: fotos en lote y prueba dorada de que la foto de una sola no cambió (snapshotSha).
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:pglite -- lib/__tests__/miper-bulk.test.ts
```

Expected: FAIL, «Failed to load url @/lib/services/miper/bulk» (o «Cannot find module»).

- [ ] **Step 3: Exportar lo que el lote reutiliza**

En `lib/services/miper/entries.ts`:

1. Reemplazar:

```ts
import { db } from "@/db"
import { preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMapMarkers, preventionRiskMatrices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { controlColumns } from "@/lib/prevention/miper/control-values"
import { cleanMiperName } from "@/lib/prevention/miper/names"
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
```

por:

```ts
import { db } from "@/db"
import { preventionPdtpSourceLinks, preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskMapMarkers, preventionRiskMatrices } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { controlColumns, type ControlResponsible } from "@/lib/prevention/miper/control-values"
import { cleanMiperName } from "@/lib/prevention/miper/names"
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
```

2. Reemplazar:

```ts
  return { id: row.id, version: row.version, rowNumber: row.rowNumber ?? 0, magnitude: row.magnitude, classification: row.classification }
}

async function touchMatrix(client: Client, matrixId: string, now: string) {
  // Sin tocar `version`: ese es el candado del encabezado y del flujo. Sí
  // `updated_at`, que la bandeja usa para detectar "cambios sin enviar".
  await client.update(preventionRiskMatrices).set({ updatedAt: now }).where(eq(preventionRiskMatrices.id, matrixId))
```

por:

```ts
  return { id: row.id, version: row.version, rowNumber: row.rowNumber ?? 0, magnitude: row.magnitude, classification: row.classification }
}

/** Exportada para las acciones masivas (`bulk.ts`, Fase D): la misma marca que el guardado de a uno. */
export async function touchMatrix(client: Client, matrixId: string, now: string) {
  // Sin tocar `version`: ese es el candado del encabezado y del flujo. Sí
  // `updated_at`, que la bandeja usa para detectar "cambios sin enviar".
  await client.update(preventionRiskMatrices).set({ updatedAt: now }).where(eq(preventionRiskMatrices.id, matrixId))
```

3. Reemplazar:

```ts
  return Boolean(link)
}

async function toColumns(client: Client, worksiteId: string, values: MiperEntryValues): Promise<Partial<typeof preventionRiskEntries.$inferInsert>> {
  const out: Partial<typeof preventionRiskEntries.$inferInsert> = {}
  if ("activity" in values) out.processId = await resolveDictionaryId(client, "activity", worksiteId, values.activity)
  if ("task" in values) out.taskId = await resolveDictionaryId(client, "task", worksiteId, values.task)
```

por:

```ts
  return Boolean(link)
}

/**
 * Los valores de un riesgo como columnas: los nombres pasan por el diccionario de
 * la faena (se reutiliza el que ya existe por nombre normalizado) y el factor
 * tiene que estar activo. Exportada para `bulkPatchMiperEntries` (Fase D): un
 * cambio en lote resuelve igual que el editor.
 */
export async function toColumns(client: Client, worksiteId: string, values: MiperEntryValues): Promise<Partial<typeof preventionRiskEntries.$inferInsert>> {
  const out: Partial<typeof preventionRiskEntries.$inferInsert> = {}
  if ("activity" in values) out.processId = await resolveDictionaryId(client, "activity", worksiteId, values.activity)
  if ("task" in values) out.taskId = await resolveDictionaryId(client, "task", worksiteId, values.task)
```

4. Reemplazar:

```ts
  })
}

export async function saveMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlSaveSchema.parse(input)
  return db.transaction(async (tx) => {
```

por:

```ts
  })
}

/**
 * El responsable de una medida: una persona ACTIVA (con su nombre como foto) o un
 * nombre o cargo escrito. Lo usan el editor de la medida y las acciones masivas.
 */
export async function controlResponsible(client: Client, values: { responsibleUserId?: string | null; responsibleName?: string | null }): Promise<ControlResponsible> {
  const responsibleUserId = values.responsibleUserId ?? null
  await assertActiveUsers(client, [responsibleUserId])
  const responsibleSnapshot = responsibleUserId ? (await userNames(client, [responsibleUserId])).get(responsibleUserId) ?? null : cleanMiperName(values.responsibleName)
  return { responsibleUserId, responsibleSnapshot }
}

export async function saveMiperControl(input: unknown, access: MiperAccess) {
  const data = miperControlSaveSchema.parse(input)
  return db.transaction(async (tx) => {
```

5. Reemplazar:

```ts
    assertEditable(matrix)
    const [entry] = await tx.select({ id: preventionRiskEntries.id }).from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!entry) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    const responsibleUserId = data.values.responsibleUserId ?? null
    await assertActiveUsers(tx, [responsibleUserId])
    const responsibleSnapshot = responsibleUserId ? (await userNames(tx, [responsibleUserId])).get(responsibleUserId) ?? null : cleanMiperName(data.values.responsibleName)
    const responsible = { responsibleUserId, responsibleSnapshot }
    const now = nowIso()
    if (!data.controlId) {
      const values = controlColumns(data.values, responsible, null)
```

por:

```ts
    assertEditable(matrix)
    const [entry] = await tx.select({ id: preventionRiskEntries.id }).from(preventionRiskEntries).where(and(eq(preventionRiskEntries.id, data.entryId), eq(preventionRiskEntries.matrixId, matrix.id))).limit(1)
    if (!entry) throw new RiskLegalDomainError("La fila no existe en esta MIPER; recarga la matriz.")
    const responsible = await controlResponsible(tx, data.values)
    const now = nowIso()
    if (!data.controlId) {
      const values = controlColumns(data.values, responsible, null)
```

- [ ] **Step 4: El servicio**

Crear `lib/services/miper/bulk.ts`:

```ts
/**
 * Acciones masivas de la MIPER (Fase D, spec §9):
 * - `bulkPatchMiperEntries`: el mismo cambio en N riesgos («Editar contexto» de
 *   una tarea, «Cambiar ¿controlado?»). Nunca P×C: el esquema lo rechaza.
 * - `bulkAddMiperControl`: la misma medida en N riesgos.
 * - `bulkUpdateMiperControls`: responsable, plazo, «¿ya está implementada?» y
 *   frecuencia en N medidas.
 *
 * Cada una corre en UNA transacción con la matriz bloqueada (`lockMatrix`), el
 * permiso de editar en su faena y `assertEditable` (ni legacy ni reemplazada),
 * igual que el guardado de a uno. Cada elemento trae la versión que vio la
 * persona: con una sola vieja, o un elemento que no es de esta MIPER, no se
 * escribe nada. Hasta `MIPER_BULK_LIMIT` elementos. El historial lleva una
 * entrada por elemento, con el `changeType` del guardado de a uno y el motivo
 * «Edición masiva».
 *
 * Las reglas son las del guardado de a uno, no copias: `toColumns` (diccionario
 * y factor activo), `controlColumns` (D5), `controlResponsible` (persona activa)
 * y el estado «propuesta» de toda medida nueva.
 */
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { preventionRiskControls, preventionRiskEntries } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { controlColumns, patchedControlValues } from "@/lib/prevention/miper/control-values"
import type { ControlHierarchy } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { countOf } from "@/lib/utils"
import { miperBulkAddControlSchema, miperBulkPatchEntriesSchema, miperBulkUpdateControlsSchema } from "@/lib/validation/prevention-module/miper"
import { controlResponsible, toColumns, touchMatrix } from "./entries"
import { assertEditable, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess } from "./shared"

const EDIT = "prevention:risk:edit"
/** El motivo de cada entrada del historial que escribe una acción masiva. */
export const BULK_REASON = "Edición masiva"

type Nouns = { missing: [string, string]; stale: [string, string] }
const ENTRIES: Nouns = { missing: ["riesgo no existe", "riesgos no existen"], stale: ["riesgo cambió", "riesgos cambiaron"] }
const CONTROLS: Nouns = { missing: ["medida no existe", "medidas no existen"], stale: ["medida cambió", "medidas cambiaron"] }

/**
 * Lo que vio la persona contra lo que hay. Un elemento que no es de esta MIPER o
 * una versión vieja abortan TODO, con su cuenta: nada se escribe a medias.
 */
function assertCurrent<T extends { id: string; version: number }>(found: readonly T[], items: ReadonlyArray<{ id: string; expectedVersion: number }>, nouns: Nouns): Map<string, T> {
  const byId = new Map(found.map((row) => [row.id, row]))
  const absent = items.filter((item) => !byId.has(item.id)).length
  if (absent > 0) throw new RiskLegalDomainError(`${countOf(absent, ...nouns.missing)} en esta MIPER; recarga la matriz.`)
  const stale = items.filter((item) => byId.get(item.id)!.version !== item.expectedVersion).length
  if (stale > 0) throw new RiskLegalDomainError(`${countOf(stale, ...nouns.stale)} mientras editabas; recarga la matriz para ver los cambios de la otra persona.`)
  return byId
}

export type BulkSaved = { id: string; version: number }

export async function bulkPatchMiperEntries(input: unknown, access: MiperAccess): Promise<{ entries: BulkSaved[] }> {
  const data = miperBulkPatchEntriesSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const ids = data.items.map((item) => item.entryId)
    const found = await tx.select().from(preventionRiskEntries).where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskEntries.id, ids)))
    const byId = assertCurrent(found, data.items.map((item) => ({ id: item.entryId, expectedVersion: item.expectedVersion })), ENTRIES)
    // El mismo cambio para todos: el diccionario y el factor se resuelven una sola vez.
    const columns = await toColumns(tx, matrix.worksiteId, data.values)
    const now = nowIso()
    // La matriz está bloqueada (`FOR UPDATE`): ningún guardado de a uno cambia una versión entre la lectura y esto.
    const updated = await tx.update(preventionRiskEntries).set({ ...columns, version: sql`${preventionRiskEntries.version} + 1`, updatedAt: now })
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskEntries.id, ids)))
      .returning({ id: preventionRiskEntries.id, version: preventionRiskEntries.version })
    for (const item of data.items) {
      const current = byId.get(item.entryId)!
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: current.id, changeType: "entry_updated", reason: BULK_REASON,
        before: Object.fromEntries(Object.keys(columns).map((key) => [key, current[key as keyof typeof current]])), after: columns,
        actorUserId: access.userId, actingAs: EDIT,
      })
    }
    await touchMatrix(tx, matrix.id, now)
    const versionOf = new Map(updated.map((row) => [row.id, row.version]))
    return { entries: data.items.map((item) => ({ id: item.entryId, version: versionOf.get(item.entryId)! })) }
  })
}

/**
 * La misma medida en N riesgos. Como en el editor, agregar una medida no cambia
 * la versión del riesgo; la que trae cada elemento sólo confirma que la persona
 * decidió sobre el riesgo que hay ahora.
 */
export async function bulkAddMiperControl(input: unknown, access: MiperAccess): Promise<{ controls: Array<{ id: string; entryId: string }> }> {
  const data = miperBulkAddControlSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const ids = data.items.map((item) => item.entryId)
    const found = await tx.select({ id: preventionRiskEntries.id, version: preventionRiskEntries.version }).from(preventionRiskEntries)
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskEntries.id, ids)))
    assertCurrent(found, data.items.map((item) => ({ id: item.entryId, expectedVersion: item.expectedVersion })), ENTRIES)
    const columns = controlColumns(data.values, await controlResponsible(tx, data.values), null)
    const now = nowIso()
    const created = await tx.insert(preventionRiskControls)
      .values(data.items.map((item) => ({ id: `riskcontrol-${nanoid()}`, riskEntryId: item.entryId, ...columns, status: "proposed", createdAt: now, updatedAt: now })))
      .returning({ id: preventionRiskControls.id, entryId: preventionRiskControls.riskEntryId })
    for (const control of created) {
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: control.id, changeType: "control_created", reason: BULK_REASON,
        after: { entryId: control.entryId, ...columns }, actorUserId: access.userId, actingAs: EDIT,
      })
    }
    await touchMatrix(tx, matrix.id, now)
    return { controls: created }
  })
}

export async function bulkUpdateMiperControls(input: unknown, access: MiperAccess): Promise<{ controls: BulkSaved[] }> {
  const data = miperBulkUpdateControlsSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
    assertEditable(matrix)
    const ids = data.items.map((item) => item.controlId)
    const found = (await tx.select({ control: preventionRiskControls }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .where(and(eq(preventionRiskEntries.matrixId, matrix.id), inArray(preventionRiskControls.id, ids)))).map((row) => row.control)
    const byId = assertCurrent(found, data.items.map((item) => ({ id: item.controlId, expectedVersion: item.expectedVersion })), CONTROLS)
    const assigned = data.patch.responsible
    const responsible = !assigned ? null
      : await controlResponsible(tx, assigned.kind === "user" ? { responsibleUserId: assigned.userId } : { responsibleName: assigned.name })
    const now = nowIso()
    const saved: BulkSaved[] = []
    for (const item of data.items) {
      const current = byId.get(item.controlId)!
      // Lo que el lote no trae se conserva; D5 decide qué queda vacío, igual que en el editor.
      const values = controlColumns(
        patchedControlValues({ ...current, hierarchy: current.hierarchy as ControlHierarchy }, data.patch),
        responsible ?? { responsibleUserId: current.responsibleUserId, responsibleSnapshot: current.responsibleSnapshot },
        current,
      )
      const [updated] = await tx.update(preventionRiskControls).set({ ...values, version: current.version + 1, updatedAt: now })
        .where(and(eq(preventionRiskControls.id, current.id), eq(preventionRiskControls.version, current.version)))
        .returning({ id: preventionRiskControls.id, version: preventionRiskControls.version })
      if (!updated) throw new RiskLegalDomainError(`${countOf(1, ...CONTROLS.stale)} mientras editabas; recarga la matriz para ver los cambios de la otra persona.`)
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: current.id, changeType: "control_updated", reason: BULK_REASON,
        before: {
          hierarchy: current.hierarchy, description: current.description, responsibleUserId: current.responsibleUserId, responsibleSnapshot: current.responsibleSnapshot,
          isExisting: current.isExisting, verificationFrequency: current.verificationFrequency, dueDate: current.dueDate,
        },
        after: values, actorUserId: access.userId, actingAs: EDIT,
      })
      saved.push(updated)
    }
    await touchMatrix(tx, matrix.id, now)
    return { controls: saved }
  })
}
```

Notas para quien implementa:
- `bulkPatchMiperEntries` actualiza con un solo `UPDATE … WHERE id IN (…)`: el cambio es el mismo para
  todos y la matriz está bloqueada, así que ninguna versión cambia entre la lectura y la escritura
  (el guardado de a uno también bloquea la matriz).
- `bulkUpdateMiperControls` actualiza de a una: cada medida queda con valores propios (lo que el lote
  no trae sale de ella).
- React Doctor marca `async-await-in-loop` en los tres bucles del historial: en una transacción hay
  una sola conexión y el orden del historial importa; es el mismo patrón de `program.ts`. Se acepta.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:pglite -- lib/__tests__/miper-bulk.test.ts
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
```

Expected: PASS, 8/8 y 7/7.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- lib/services/miper/entries.ts lib/services/miper/bulk.ts lib/__tests__/miper-bulk.test.ts tests/pglite-files.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/services/miper/entries.ts lib/services/miper/bulk.ts lib/__tests__/miper-bulk.test.ts tests/pglite-files.ts
git commit -m "feat(miper): acciones masivas atómicas: una medida en N riesgos, cambio de riesgos y de medidas, con versión por elemento e historial «Edición masiva»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Acciones de servidor de las acciones masivas

**Files:**
- Modify: `app/(app)/prevencion/miper/actions.ts:21` (import) y antes de `// ── Flujo ──` (`:128`)
- Test: `app/(app)/prevencion/miper/actions.test.ts:12` (mocks), `:26-27` (import) y tres tests al
  final

**Interfaces:**
- Consumes: `bulkPatchMiperEntries`, `bulkAddMiperControl`, `bulkUpdateMiperControls` (Task 4).
- Produces (todas `guarded("prevention:risk:edit", …)`, revalidan `/prevencion/miper` y
  `/prevencion/miper/<input.matrixId>`):
  - `bulkPatchMiperEntriesAction(input: unknown): Promise<ActionState>` → `{ ok: true, message: "N
    riesgo(s) actualizado(s)", data: { entries: Array<{ id: string; version: number }> } }`
  - `bulkAddMiperControlAction(input: unknown)` → `{ ok: true, message: "Medida agregada a N
    riesgo(s)", data: { created: number } }`
  - `bulkUpdateMiperControlsAction(input: unknown)` → `{ ok: true, message: "N medida(s)
    actualizada(s)", data: { updated: number } }`
  - Un `RiskLegalDomainError` llega con su mensaje y no revalida (`fail`).

- [ ] **Step 1: Write the failing tests**

En `app/(app)/prevencion/miper/actions.test.ts`:

1. Reemplazar:

```ts
const listMiperWorksiteTargets = vi.hoisted(() => vi.fn())
const commitRiskImport = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
```

por:

```ts
const listMiperWorksiteTargets = vi.hoisted(() => vi.fn())
const commitRiskImport = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const bulkPatchMiperEntries = vi.hoisted(() => vi.fn())
const bulkAddMiperControl = vi.hoisted(() => vi.fn())
const bulkUpdateMiperControls = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
```

2. Reemplazar:

```ts
vi.mock("@/lib/services/miper/risk-factors", () => ({ saveRiskFactor: vi.fn(), setRiskFactorActive: vi.fn() }))
vi.mock("@/lib/services/miper/portfolio", () => ({ listMiperWorksiteTargets }))
vi.mock("@/lib/services/miper/import", () => ({ previewRiskImport: vi.fn(), commitRiskImport }))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { approveMiperFinalAction, approveMiperTechnicalAction, commitRiskImportAction, createMiperAction, listMiperWorksiteTargetsAction, saveMiperEntryAction, submitMiperAction } from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const session = { user: { id: "trusted-user", permissions: ["prevention:risk:edit"] } }
```

por:

```ts
vi.mock("@/lib/services/miper/risk-factors", () => ({ saveRiskFactor: vi.fn(), setRiskFactorActive: vi.fn() }))
vi.mock("@/lib/services/miper/portfolio", () => ({ listMiperWorksiteTargets }))
vi.mock("@/lib/services/miper/import", () => ({ previewRiskImport: vi.fn(), commitRiskImport }))
vi.mock("@/lib/services/miper/bulk", () => ({ bulkPatchMiperEntries, bulkAddMiperControl, bulkUpdateMiperControls }))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import {
  approveMiperFinalAction, approveMiperTechnicalAction, bulkAddMiperControlAction, bulkPatchMiperEntriesAction, bulkUpdateMiperControlsAction,
  commitRiskImportAction, createMiperAction, listMiperWorksiteTargetsAction, saveMiperEntryAction, submitMiperAction,
} from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const session = { user: { id: "trusted-user", permissions: ["prevention:risk:edit"] } }
```

3. Reemplazar:

```ts
    commitRiskImport.mockResolvedValue({ batchId: "b2", matrixId: "m-imp", target: "live", created: 1, skipped: 0, notified: 0, measures: { total: 0, existing: 0, pending: 0 } })
    await expect(commitRiskImportAction({ batchId: "b2" })).resolves.toMatchObject({ ok: true, message: "1 riesgo cargado" })
  })
})
```

por:

```ts
    commitRiskImport.mockResolvedValue({ batchId: "b2", matrixId: "m-imp", target: "live", created: 1, skipped: 0, notified: 0, measures: { total: 0, existing: 0, pending: 0 } })
    await expect(commitRiskImportAction({ batchId: "b2" })).resolves.toMatchObject({ ok: true, message: "1 riesgo cargado" })
  })

  const bulkActions = [
    ["bulkPatchMiperEntriesAction", bulkPatchMiperEntriesAction, bulkPatchMiperEntries],
    ["bulkAddMiperControlAction", bulkAddMiperControlAction, bulkAddMiperControl],
    ["bulkUpdateMiperControlsAction", bulkUpdateMiperControlsAction, bulkUpdateMiperControls],
  ] as const

  it.each(bulkActions)("%s: sin permiso de editar no llega al servicio (Fase D)", async (_name, action, service) => {
    guardPermission.mockResolvedValue(denied)
    await expect(action({ matrixId: "m1", items: [] })).resolves.toEqual(denied.error)
    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:edit")
    expect(service).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each(bulkActions)("%s: fuera de la faena, el rechazo del servicio llega tal cual y no revalida (Fase D)", async (_name, action, service) => {
    guardPermission.mockResolvedValue({ session, error: null })
    service.mockRejectedValueOnce(new RiskLegalDomainError("Registro preventivo no encontrado o fuera de alcance."))
    await expect(action({ matrixId: "m-ajena", items: [{ entryId: "e1", expectedVersion: 1 }] })).resolves.toEqual({ ok: false, message: "Registro preventivo no encontrado o fuera de alcance." })
    // El alcance y el actor salen de la sesión: el servicio decide con ellos, no con el input.
    expect(service).toHaveBeenCalledWith(expect.anything(), { userId: "trusted-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:edit"] })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("las acciones masivas revalidan la MIPER y dicen cuántos riesgos o medidas cambiaron (Fase D)", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    bulkPatchMiperEntries.mockResolvedValueOnce({ entries: [{ id: "e1", version: 3 }, { id: "e2", version: 5 }] })
    await expect(bulkPatchMiperEntriesAction({ matrixId: "m1", items: [], values: { controlledStatus: "yes" } }))
      .resolves.toEqual({ ok: true, message: "2 riesgos actualizados", data: { entries: [{ id: "e1", version: 3 }, { id: "e2", version: 5 }] } })
    expect(revalidatePath).toHaveBeenCalledWith("/prevencion/miper/m1")
    bulkAddMiperControl.mockResolvedValueOnce({ controls: [{ id: "c1", entryId: "e1" }] })
    await expect(bulkAddMiperControlAction({ matrixId: "m1" })).resolves.toEqual({ ok: true, message: "Medida agregada a 1 riesgo", data: { created: 1 } })
    bulkUpdateMiperControls.mockResolvedValueOnce({ controls: [{ id: "c1", version: 2 }, { id: "c2", version: 2 }, { id: "c3", version: 4 }] })
    await expect(bulkUpdateMiperControlsAction({ matrixId: "m1" })).resolves.toEqual({ ok: true, message: "3 medidas actualizadas", data: { updated: 3 } })
    expect(revalidatePath).toHaveBeenCalledTimes(6)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/actions.test.ts"
```

Expected: FAIL: las tres acciones no se exportan (`bulkPatchMiperEntriesAction is not a function`).

- [ ] **Step 3: Las acciones**

En `app/(app)/prevencion/miper/actions.ts`:

1. Reemplazar:

```ts
import { PreventionEvidenceError, storePreventionEvidence } from "@/lib/services/prevention-evidence-upload"
import { resolveRiskReviewTrigger, verifyRiskControl } from "@/lib/services/prevention-risk-legal"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { deleteMiperControl, deleteMiperEntry, duplicateMiperEntry, saveMiperControl, saveMiperEntry } from "@/lib/services/miper/entries"
import { commitRiskImport, previewRiskImport, type RiskImportCommitResult } from "@/lib/services/miper/import"
import { listMiperWorksiteTargets } from "@/lib/services/miper/portfolio"
```

por:

```ts
import { PreventionEvidenceError, storePreventionEvidence } from "@/lib/services/prevention-evidence-upload"
import { resolveRiskReviewTrigger, verifyRiskControl } from "@/lib/services/prevention-risk-legal"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { bulkAddMiperControl, bulkPatchMiperEntries, bulkUpdateMiperControls } from "@/lib/services/miper/bulk"
import { deleteMiperControl, deleteMiperEntry, duplicateMiperEntry, saveMiperControl, saveMiperEntry } from "@/lib/services/miper/entries"
import { commitRiskImport, previewRiskImport, type RiskImportCommitResult } from "@/lib/services/miper/import"
import { listMiperWorksiteTargets } from "@/lib/services/miper/portfolio"
```

2. Reemplazar:

```ts
  return guarded("prevention:risk:edit", input, (access) => deleteMiperControl(input, access), { success: "Medida eliminada" })
}

// ── Flujo ──
export async function submitMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => submitMiperForReview(input, access), { success: "MIPER enviada a revisión" })
```

por:

```ts
  return guarded("prevention:risk:edit", input, (access) => deleteMiperControl(input, access), { success: "Medida eliminada" })
}

// ── Acciones masivas (Fase D, spec §9). Revalidan: cambian muchos riesgos a la
//    vez y la foto nueva es la que se muestra después. `data` devuelve lo que el
//    cliente necesita sin esperar esa foto: las versiones nuevas de los riesgos
//    (para que el guardado automático no choque) o cuántas medidas cambiaron. ──
export async function bulkPatchMiperEntriesAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => bulkPatchMiperEntries(input, access), {
    data: (result) => ({ entries: result.entries }),
    success: (result) => countOf(result.entries.length, "riesgo actualizado", "riesgos actualizados"),
  })
}
export async function bulkAddMiperControlAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => bulkAddMiperControl(input, access), {
    data: (result) => ({ created: result.controls.length }),
    success: (result) => `Medida agregada a ${countOf(result.controls.length, "riesgo", "riesgos")}`,
  })
}
export async function bulkUpdateMiperControlsAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => bulkUpdateMiperControls(input, access), {
    data: (result) => ({ updated: result.controls.length }),
    success: (result) => countOf(result.controls.length, "medida actualizada", "medidas actualizadas"),
  })
}

// ── Flujo ──
export async function submitMiperAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => submitMiperForReview(input, access), { success: "MIPER enviada a revisión" })
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/actions.test.ts"
```

Expected: PASS (19 pruebas).

- [ ] **Step 5: Puertas y commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/actions.ts" "app/(app)/prevencion/miper/actions.test.ts"
git add "app/(app)/prevencion/miper/actions.ts" "app/(app)/prevencion/miper/actions.test.ts"
git commit -m "feat(miper): acciones de servidor de las acciones masivas, con permiso de editar, alcance de la sesión y revalidación" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: El cliente espera y anota versiones (`whenIdle`, `acknowledge`) y lleva la selección

**Files:**
- Modify: `app/(app)/prevencion/miper/[id]/use-row-saver.ts:60-63`
- Test: `app/(app)/prevencion/miper/[id]/use-row-saver.test.ts` (un test al final)
- Modify: `app/(app)/prevencion/miper/[id]/use-entry-autosave.ts:20` (tipo nuevo), `:42-43` y `:142`
- Test: `app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts` (dos tests al final)
- Create: `app/(app)/prevencion/miper/[id]/use-risk-selection.ts`
- Test: `app/(app)/prevencion/miper/[id]/use-risk-selection.test.ts`

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces:
  - `useRowSaver(...)` devuelve además `whenIdle(entryIds: readonly string[]): Promise<void>`: espera
    los guardados en curso de esas filas, también los que entran a su cola mientras espera.
  - `use-entry-autosave.ts` exporta `type AutosaveSync = { versionOf(entryId): number | undefined;
    whenIdle(entryIds: readonly string[]): Promise<void>; acknowledge(versions: Readonly<Record<string,
    number>>): void }`, y `useEntryAutosave(...)` devuelve `EntryAutosave & AutosaveSync`.
    `acknowledge` nunca baja una versión (`sync`). `EntryAutosave` no cambia (el editor y sus dobles en
    `risk-editor.test.tsx` siguen igual).
  - `use-risk-selection.ts`: `useRiskSelection(visible: readonly MiperEntrySnapshot[])` →
    `{ selecting: boolean; selected: MiperEntrySnapshot[]; isSelected(entryId): boolean;
    toggle(entryId): void; selectAll(): void; clear(): void; start(): void; stop(): void }`, y
    `type RiskSelection = ReturnType<typeof useRiskSelection>`. `selected` es lo seleccionado **que se
    ve**, en el orden de la vista; `stop` sale del modo y vacía; `clear` vacía sin salir.

- [ ] **Step 1: Write the failing tests**

En `app/(app)/prevencion/miper/[id]/use-row-saver.test.ts`, al final del `describe("useRowSaver", …)`:

Reemplazar:

```ts
    await result.current.save("b", { hazard: "y" })
    expect(saveMiperEntryAction.mock.calls.map(([input]) => input.expectedVersion)).toEqual([2, 5])
  })
})
```

por:

```ts
    await result.current.save("b", { hazard: "y" })
    expect(saveMiperEntryAction.mock.calls.map(([input]) => input.expectedVersion)).toEqual([2, 5])
  })

  it("whenIdle espera los guardados en curso de esas filas, también el que entra mientras espera (Fase D)", async () => {
    const releases: Array<() => void> = []
    saveMiperEntryAction.mockImplementation(() => new Promise((resolve) => {
      const version = releases.length + 2
      releases.push(() => resolve({ ok: true, data: { version, magnitude: null, classification: null } }))
    }))
    const { result } = renderHook(() => useRowSaver("m1", { e1: 1, e2: 1 }))
    // Sin guardados en curso no espera nada.
    await expect(result.current.whenIdle(["e1", "e2"])).resolves.toBeUndefined()
    void result.current.save("e1", { hazard: "A" })
    let idle = false
    const waiting = result.current.whenIdle(["e1", "e2"]).then(() => { idle = true })
    // Un segundo guardado de la misma fila entra a la cola mientras se espera.
    void result.current.save("e1", { risk: "B" })
    await vi.waitFor(() => expect(saveMiperEntryAction).toHaveBeenCalledTimes(1))
    releases[0]!()
    await vi.waitFor(() => expect(saveMiperEntryAction).toHaveBeenCalledTimes(2))
    expect(idle).toBe(false)
    releases[1]!()
    await waiting
    expect(result.current.versionOf("e1")).toBe(3)
  })
})
```

En `app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts`, al final del
`describe("useEntryAutosave", …)`:

Reemplazar:

```ts
    await act(async () => { await hook.result.current.commit({ ...entry, probability: 4 }, { probability: 1 }) })
    expect(rows()[0]).toMatchObject({ probability: 4 })
  })
})
```

por:

```ts
    await act(async () => { await hook.result.current.commit({ ...entry, probability: 4 }, { probability: 1 }) })
    expect(rows()[0]).toMatchObject({ probability: 4 })
  })

  it("tras una acción masiva, el siguiente guardado parte de la versión que devolvió; una foto atrasada no la baja (Fase D)", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { version: 6, magnitude: 4, classification: "moderate" } })
    const { hook } = setup()
    act(() => { hook.result.current.acknowledge({ e1: 5 }) })
    expect(hook.result.current.versionOf("e1")).toBe(5)
    await act(async () => { await hook.result.current.commit(entry, { hazard: "Solvente" }) })
    expect(saveMiperEntryAction.mock.calls[0]![0]).toMatchObject({ entryId: "e1", expectedVersion: 5 })
    act(() => { hook.result.current.acknowledge({ e1: 2 }) })
    expect(hook.result.current.versionOf("e1")).toBe(6)
  })

  it("whenIdle espera el guardado en curso del riesgo antes de que una acción masiva lea su versión (Fase D)", async () => {
    let release!: () => void
    saveMiperEntryAction.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true, data: { version: 2, magnitude: 4, classification: "moderate" } }) }))
    const { hook } = setup()
    let commit!: Promise<boolean>
    act(() => { commit = hook.result.current.commit(entry, { hazard: "Solvente" }) })
    let idle = false
    const waiting = hook.result.current.whenIdle(["e1"]).then(() => { idle = true })
    await waitFor(() => expect(saveMiperEntryAction).toHaveBeenCalledTimes(1))
    expect(idle).toBe(false)
    await act(async () => { release(); await commit; await waiting })
    expect(hook.result.current.versionOf("e1")).toBe(2)
  })
})
```

Crear `app/(app)/prevencion/miper/[id]/use-risk-selection.test.ts`:

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { useRiskSelection } from "./use-risk-selection"

const e = (id: string) => ({ id, rowNumber: Number(id.slice(1)) }) as MiperEntrySnapshot
const all = [e("r1"), e("r2"), e("r3")]

describe("useRiskSelection (Fase D)", () => {
  it("es un modo: empieza apagado y «Terminar» vacía la selección", () => {
    const { result } = renderHook(() => useRiskSelection(all))
    expect(result.current.selecting).toBe(false)
    act(() => { result.current.start() })
    act(() => { result.current.toggle("r2") })
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r2"])
    act(() => { result.current.stop() })
    expect(result.current.selecting).toBe(false)
    expect(result.current.selected).toEqual([])
  })

  it("sólo cuenta lo que se ve: un filtro que esconde un riesgo lo saca de la selección, y vuelve si se ve otra vez", () => {
    const { result, rerender } = renderHook(({ visible }) => useRiskSelection(visible), { initialProps: { visible: all } })
    act(() => { result.current.start() })
    act(() => { result.current.toggle("r3"); result.current.toggle("r1") })
    // En el orden de la vista, no en el de los clics.
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r1", "r3"])
    rerender({ visible: [all[0]!, all[1]!] })
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r1"])
    rerender({ visible: all })
    expect(result.current.selected.map((entry) => entry.id)).toEqual(["r1", "r3"])
  })

  it("«Seleccionar los N» marca todo lo visible y «Quitar selección» lo desmarca sin salir del modo", () => {
    const { result } = renderHook(() => useRiskSelection(all))
    act(() => { result.current.start() })
    act(() => { result.current.selectAll() })
    expect(result.current.selected).toHaveLength(3)
    expect(result.current.isSelected("r2")).toBe(true)
    act(() => { result.current.clear() })
    expect(result.current.selected).toEqual([])
    expect(result.current.selecting).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/use-row-saver.test.ts" "app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts" "app/(app)/prevencion/miper/[id]/use-risk-selection.test.ts"
```

Expected: FAIL: `whenIdle` y `acknowledge` no son funciones, y `./use-risk-selection` no existe.

- [ ] **Step 3: `whenIdle` en la cola por fila**

En `app/(app)/prevencion/miper/[id]/use-row-saver.ts`:

Reemplazar:

```ts
  /** Versión conocida de una fila: la que debe viajar al borrarla después de editarla. */
  const versionOf = useCallback((entryId: string) => versions.current[entryId], [])

  return { save, sync, versionOf }
}
```

por:

```ts
  /** Versión conocida de una fila: la que debe viajar al borrarla después de editarla. */
  const versionOf = useCallback((entryId: string) => versions.current[entryId], [])

  /**
   * Espera a que terminen los guardados en curso de esas filas (Fase D): una
   * acción masiva lee después sus versiones, y con un guardado a medio camino
   * mandaría una vieja y chocaría consigo misma. Si mientras espera entra otro
   * guardado a la cola de una de ellas, también lo espera.
   */
  const whenIdle = useCallback(async (entryIds: readonly string[]) => {
    for (;;) {
      const pending = entryIds.map((entryId) => queues.current[entryId])
      await Promise.all(pending.map((run) => run?.catch(() => undefined)))
      if (entryIds.every((entryId, index) => queues.current[entryId] === pending[index])) return
    }
  }, [])

  return { save, sync, versionOf, whenIdle }
}
```

- [ ] **Step 4: `AutosaveSync` en el guardado del editor**

En `app/(app)/prevencion/miper/[id]/use-entry-autosave.ts`:

1. Reemplazar:

```ts
  clearErrors: (entryId: string) => void
}

const IDLE: SaveStatus = { state: "idle", savedAt: null, message: null }
const ownedBy = (entryId: string) => (key: string) => key.startsWith(`${entryId}.`)
const withoutEntries = (errors: Record<string, string>, entryIds: readonly string[]) =>
```

por:

```ts
  clearErrors: (entryId: string) => void
}

/** Lo que una acción masiva necesita del guardado automático (Fase D). */
export type AutosaveSync = {
  versionOf: (entryId: string) => number | undefined
  /** Espera los guardados en curso de esos riesgos: después, sus versiones son las del servidor. */
  whenIdle: (entryIds: readonly string[]) => Promise<void>
  /** Anota las versiones que devolvió una acción masiva: el siguiente guardado de cada riesgo parte de ahí. Nunca baja una. */
  acknowledge: (versions: Readonly<Record<string, number>>) => void
}

const IDLE: SaveStatus = { state: "idle", savedAt: null, message: null }
const ownedBy = (entryId: string) => (key: string) => key.startsWith(`${entryId}.`)
const withoutEntries = (errors: Record<string, string>, entryIds: readonly string[]) =>
```

2. Reemplazar:

```ts
  entryVersions: Record<string, number>
  setRows: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  riskFactors: ReadonlyArray<{ id: string; name: string }>
}): EntryAutosave {
  const { save, sync, versionOf } = useRowSaver(matrixId, entryVersions)
  // Se reancla por contenido, no por identidad: un objeto nuevo con las mismas
  // versiones en cada render pisaría la versión que devolvió el servidor.
  const versionsKey = JSON.stringify(entryVersions)
```

por:

```ts
  entryVersions: Record<string, number>
  setRows: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  riskFactors: ReadonlyArray<{ id: string; name: string }>
}): EntryAutosave & AutosaveSync {
  const { save, sync, versionOf, whenIdle } = useRowSaver(matrixId, entryVersions)
  // Se reancla por contenido, no por identidad: un objeto nuevo con las mismas
  // versiones en cada render pisaría la versión que devolvió el servidor.
  const versionsKey = JSON.stringify(entryVersions)
```

3. Reemplazar:

```ts
  const clearErrors = useCallback((entryId: string) => {
    writeErrors(withoutEntries(errorsRef.current, [entryId]))
  }, [])
  return { commit, statusOf, fieldError, versionOf, clearErrors }
}

function withoutKeys(errors: Record<string, string>, keys: readonly string[]) {
```

por:

```ts
  const clearErrors = useCallback((entryId: string) => {
    writeErrors(withoutEntries(errorsRef.current, [entryId]))
  }, [])
  const acknowledge = useCallback((versions: Readonly<Record<string, number>>) => { sync({ ...versions }) }, [sync])
  return { commit, statusOf, fieldError, versionOf, clearErrors, whenIdle, acknowledge }
}

function withoutKeys(errors: Record<string, string>, keys: readonly string[]) {
```

- [ ] **Step 5: La selección**

Crear `app/(app)/prevencion/miper/[id]/use-risk-selection.ts`:

```ts
"use client"

import { useCallback, useMemo, useState } from "react"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

/**
 * Selección de riesgos para las acciones masivas (Fase D, spec §9). Es un modo:
 * sin «Seleccionar» no hay casillas y la vista filtrada sigue liviana (spec §13,
 * menos de 400 controles). Sólo cuenta lo que se ve: un riesgo seleccionado que
 * un filtro esconde, o que desaparece tras recargar, sale de la selección que se
 * muestra y que se envía; si vuelve a verse, vuelve marcado.
 */
export function useRiskSelection(visible: readonly MiperEntrySnapshot[]) {
  const [selecting, setSelecting] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const selected = useMemo(() => visible.filter((entry) => chosen.has(entry.id)), [visible, chosen])
  const isSelected = useCallback((entryId: string) => chosen.has(entryId), [chosen])
  const toggle = useCallback((entryId: string) => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }, [])
  const selectAll = useCallback(() => setChosen(new Set(visible.map((entry) => entry.id))), [visible])
  const clear = useCallback(() => setChosen(new Set()), [])
  const start = useCallback(() => setSelecting(true), [])
  const stop = useCallback(() => { setSelecting(false); setChosen(new Set()) }, [])
  return { selecting, selected, isSelected, toggle, selectAll, clear, start, stop }
}

export type RiskSelection = ReturnType<typeof useRiskSelection>
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/use-row-saver.test.ts" "app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts" "app/(app)/prevencion/miper/[id]/use-risk-selection.test.ts" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

Expected: PASS.

- [ ] **Step 7: Puertas y commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/use-row-saver.ts" "app/(app)/prevencion/miper/[id]/use-row-saver.test.ts" "app/(app)/prevencion/miper/[id]/use-entry-autosave.ts" "app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts" "app/(app)/prevencion/miper/[id]/use-risk-selection.ts" "app/(app)/prevencion/miper/[id]/use-risk-selection.test.ts"
git add "app/(app)/prevencion/miper/[id]/use-row-saver.ts" "app/(app)/prevencion/miper/[id]/use-row-saver.test.ts" "app/(app)/prevencion/miper/[id]/use-entry-autosave.ts" "app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts" "app/(app)/prevencion/miper/[id]/use-risk-selection.ts" "app/(app)/prevencion/miper/[id]/use-risk-selection.test.ts"
git commit -m "feat(miper): el guardado automático espera y anota versiones para las acciones masivas, y la selección de riesgos es un modo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `ControlFields`, los campos de la medida, fuera de `ControlForm`

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/control-fields.tsx`
- Test: `app/(app)/prevencion/miper/[id]/control-fields.test.tsx`
- Modify: `app/(app)/prevencion/miper/[id]/control-form.tsx` (se reescribe entero; 123 → 58 líneas)
- Test (sin cambios, tiene que seguir verde): `app/(app)/prevencion/miper/[id]/control-form.test.tsx`

**Interfaces:**
- Consumes: `type ControlValues` (Task 2); `FREQUENCY_MAX_LENGTH`, `MEASURE_MAX_LENGTH`,
  `RESPONSIBLE_MAX_LENGTH` (`re04-measures.ts`).
- Produces (`control-fields.tsx`):
  - `type ControlDraft = { hierarchy: ControlHierarchy; isExisting: boolean; frequency: string;
    description: string; responsibleUserId: string; responsibleName: string; dueDate: string }`
    (`responsibleUserId` vacío = nombre o cargo escrito; en lote, `KEEP_RESPONSIBLE` = no cambiar).
  - `draftOf(control: MiperControlSnapshot | null): ControlDraft`
  - `valuesOf(draft: ControlDraft): ControlValues` — `null` en lo que no aplica (D5), igual que antes.
  - `isDraftReady(draft: ControlDraft): boolean` — descripción de 3 caracteres o más.
  - `KEEP_RESPONSIBLE = "__sin_cambio__"`, `KIND_OPTIONS`, `HIERARCHY_OPTIONS`.
  - `ResponsibleField({ userId, name, onChange(next: { userId: string; name: string }), options,
    current?, disabled?, keepLabel? })` — «Responsable de la medida» (+ «Nombre o cargo responsable»
    con «Otra persona o cargo…»); con `keepLabel`, primera opción «No cambiar».
  - `ControlFields({ draft, onChange(patch: Partial<ControlDraft>), disabled, responsibleOptions,
    currentResponsible?, measureSuggestions })` — los campos dentro de una grilla de dos columnas, con
    los mismos nombres accesibles de antes.
- `ControlForm` conserva sus props, sus nombres accesibles, el bloqueo mientras guarda y el error en
  `role="alert"`.

- [ ] **Step 1: Write the failing test**

Crear `app/(app)/prevencion/miper/[id]/control-fields.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { draftOf, KEEP_RESPONSIBLE, ResponsibleField, valuesOf } from "./control-fields"

describe("borrador de la medida (Fase D: compartido por el editor y «Agregar medida a N»)", () => {
  it("una medida nueva nace «Por implementar», tipo IV y con el responsable escrito vacío", () => {
    expect(draftOf(null)).toEqual({ hierarchy: "administrative", isExisting: false, frequency: "", description: "", responsibleUserId: "", responsibleName: "", dueDate: "" })
  })
  it("D5: lo que no aplica viaja en null; el nombre escrito sólo sin persona", () => {
    const draft = { ...draftOf(null), description: " Charla de trasvasije ", responsibleName: " Supervisor ", dueDate: "2026-12-31", frequency: "Mensual" }
    expect(valuesOf(draft)).toEqual({ hierarchy: "administrative", description: "Charla de trasvasije", responsibleUserId: null, responsibleName: "Supervisor", isExisting: false, verificationFrequency: null, dueDate: "2026-12-31" })
    expect(valuesOf({ ...draft, isExisting: true, frequency: " Mensual ", responsibleUserId: "u1" }))
      .toMatchObject({ responsibleUserId: "u1", responsibleName: null, isExisting: true, verificationFrequency: "Mensual", dueDate: null })
  })
})

describe("ResponsibleField", () => {
  const options = [{ id: "u1", name: "Ana Pérez" }]
  it("en lote parte en «No cambiar»; «Otra persona o cargo…» pide el nombre", () => {
    const onChange = vi.fn()
    const { rerender } = render(<ResponsibleField userId={KEEP_RESPONSIBLE} name="" onChange={onChange} options={options} keepLabel="No cambiar" />)
    const select = screen.getByRole("combobox", { name: "Responsable de la medida" })
    expect(select).toHaveTextContent("No cambiar")
    expect(screen.queryByRole("textbox", { name: "Nombre o cargo responsable" })).toBeNull()
    fireEvent.click(select)
    fireEvent.click(screen.getByRole("option", { name: "Otra persona o cargo…" }))
    expect(onChange).toHaveBeenCalledWith({ userId: "", name: "" })
    rerender(<ResponsibleField userId="" name="Jefe de bodega" onChange={onChange} options={options} keepLabel="No cambiar" />)
    expect(screen.getByRole("textbox", { name: "Nombre o cargo responsable" })).toHaveValue("Jefe de bodega")
  })
  it("fuera de lote no ofrece «No cambiar»", () => {
    render(<ResponsibleField userId="u1" name="" onChange={vi.fn()} options={options} />)
    fireEvent.click(screen.getByRole("combobox", { name: "Responsable de la medida" }))
    expect(screen.queryByRole("option", { name: "No cambiar" })).toBeNull()
    expect(screen.getByRole("option", { name: "Ana Pérez" })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/control-fields.test.tsx" "app/(app)/prevencion/miper/[id]/control-form.test.tsx"
```

Expected: `control-fields.test.tsx` FAIL («Failed to resolve import "./control-fields"»);
`control-form.test.tsx` PASS (es la red de seguridad de la extracción: no se toca).

- [ ] **Step 3: Los campos**

Crear `app/(app)/prevencion/miper/[id]/control-fields.tsx`. Es el cuerpo de `ControlForm` de
1143bf50 (líneas 17-23 y 75-115) con el estado en un `ControlDraft`:

```tsx
"use client"

import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import type { ControlValues } from "@/lib/prevention/miper/control-values"
import { FREQUENCY_MAX_LENGTH, MEASURE_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"

export const HIERARCHY_OPTIONS = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>).map(([value, label]) => ({ value, label }))
const OTHER = "__otra__"
/** Sólo en lote (Fase D): el responsable de cada medida se conserva. */
export const KEEP_RESPONSIBLE = "__sin_cambio__"
/** D5 (Fase C): una medida existente se verifica con una frecuencia; una por implementar lleva plazo. */
export const KIND_OPTIONS = [
  { value: "existing", title: "Ya está implementada", description: "Se verifica cada cierto tiempo; no lleva plazo." },
  { value: "pending", title: "Por implementar", description: "Lleva responsable y la fecha en que debe estar lista." },
] as const

/** Lo que una persona está escribiendo en el formulario de una medida. `responsibleUserId` vacío = nombre o cargo escrito. */
export type ControlDraft = {
  hierarchy: ControlHierarchy; isExisting: boolean; frequency: string; description: string
  responsibleUserId: string; responsibleName: string; dueDate: string
}

/** El borrador de una medida existente, o el de una nueva: «Por implementar», tipo IV, sin responsable. */
export function draftOf(control: MiperControlSnapshot | null): ControlDraft {
  return {
    hierarchy: control?.hierarchy ?? "administrative",
    isExisting: control?.isExisting ?? false,
    frequency: control?.verificationFrequency ?? "",
    description: control?.description ?? "",
    responsibleUserId: control?.responsibleUserId ?? "",
    responsibleName: control?.responsibleUserId ? "" : control?.responsibleName ?? "",
    dueDate: control?.dueDate ?? "",
  }
}

/** Mínimo de la descripción, el del esquema: el botón de guardar no se habilita antes. */
export const isDraftReady = (draft: ControlDraft) => draft.description.trim().length >= 3

/** Lo que se envía: `null` en lo que no aplica (D5), igual en el editor y en «Agregar medida a N». */
export function valuesOf(draft: ControlDraft): ControlValues {
  return {
    hierarchy: draft.hierarchy, description: draft.description.trim(),
    responsibleUserId: draft.responsibleUserId || null,
    responsibleName: draft.responsibleUserId ? null : draft.responsibleName.trim() || null,
    isExisting: draft.isExisting,
    verificationFrequency: draft.isExisting ? draft.frequency.trim() || null : null,
    dueDate: draft.isExisting ? null : draft.dueDate || null,
  }
}

/**
 * Responsable de una medida: una persona de la faena o «Otra persona o cargo…»,
 * que pide el nombre. El responsable actual que ya no está en la faena sigue
 * siendo la opción elegida (A2, fila 9). En lote, `keepLabel` agrega «No
 * cambiar» (`KEEP_RESPONSIBLE`) como primera opción.
 */
export function ResponsibleField({ userId, name, onChange, options, current = null, disabled = false, keepLabel }: {
  userId: string
  name: string
  onChange: (next: { userId: string; name: string }) => void
  options: ReadonlyArray<{ id: string; name: string }>
  current?: { id: string; name: string } | null
  disabled?: boolean
  keepLabel?: string
}) {
  const value = userId || OTHER
  return (
    <>
      <Field label="Responsable">
        <OptionSelect
          aria-label="Responsable de la medida"
          options={[
            ...(keepLabel ? [{ value: KEEP_RESPONSIBLE, label: keepLabel }] : []),
            ...options.map((option) => ({ value: option.id, label: option.name })),
            ...(current ? [{ value: current.id, label: current.name }] : []),
            { value: OTHER, label: "Otra persona o cargo…" },
          ]}
          value={value}
          disabled={disabled}
          onValueChange={(next) => onChange({ userId: next === OTHER ? "" : next, name })}
        />
      </Field>
      {value === OTHER && (
        <Field label="Nombre o cargo responsable">
          <Input aria-label="Nombre o cargo responsable" value={name} disabled={disabled} onChange={(event) => onChange({ userId: "", name: event.target.value })} placeholder="Supervisor de turno" maxLength={RESPONSIBLE_MAX_LENGTH} />
        </Field>
      )}
    </>
  )
}

/**
 * Los campos de una medida (spec §6.2), sin guardar nada: los usan el editor de
 * la medida (`ControlForm`) y «Agregar medida a N» (Fase D). Se pintan dentro de
 * una grilla de dos columnas. Conservan los nombres accesibles que usan las E2E:
 * «¿Ya está implementada?», «Tipo de control», «Plazo de la medida»,
 * «Frecuencia de verificación», «Descripción de la medida», «Responsable de la
 * medida» y «Nombre o cargo responsable».
 */
export function ControlFields({ draft, onChange, disabled, responsibleOptions, currentResponsible = null, measureSuggestions }: {
  draft: ControlDraft
  onChange: (patch: Partial<ControlDraft>) => void
  disabled: boolean
  responsibleOptions: ReadonlyArray<{ id: string; name: string }>
  currentResponsible?: { id: string; name: string } | null
  measureSuggestions: readonly string[]
}) {
  return (
    <>
      <div className="space-y-2 md:col-span-2">
        <p className="text-sm font-medium text-[var(--color-text)]">¿Ya está implementada?</p>
        <ChoiceCardGroup label="¿Ya está implementada?" className="sm:grid-cols-2" options={KIND_OPTIONS} value={draft.isExisting ? "existing" : "pending"}
          disabled={disabled} onChange={(value) => onChange({ isExisting: value === "existing" })} />
      </div>
      <Field label="Tipo de control (jerarquía)" required>
        <OptionSelect aria-label="Tipo de control" options={HIERARCHY_OPTIONS} value={draft.hierarchy} disabled={disabled} onValueChange={(value) => onChange({ hierarchy: value as ControlHierarchy })} />
      </Field>
      {draft.isExisting ? (
        <Field label="Frecuencia de verificación" helper="Cada cuánto se comprueba que sigue funcionando (por ejemplo, trimestral).">
          <Input aria-label="Frecuencia de verificación" value={draft.frequency} disabled={disabled} onChange={(event) => onChange({ frequency: event.target.value })} placeholder="Trimestral" maxLength={FREQUENCY_MAX_LENGTH} />
        </Field>
      ) : (
        <Field label="Plazo" required helper="Fecha en que la medida debe estar implementada.">
          <DatePicker ariaLabel="Plazo de la medida" value={draft.dueDate || undefined} disabled={disabled} onChange={(dueDate) => onChange({ dueDate })} />
        </Field>
      )}
      {/* El rótulo visible es el nombre accesible (WCAG 2.5.3, «label in name»). */}
      <Field label="Descripción de la medida" required className="md:col-span-2" helper="Mínimo 3 caracteres.">
        <Textarea aria-label="Descripción de la medida" value={draft.description} disabled={disabled} onChange={(event) => onChange({ description: event.target.value })} rows={3} maxLength={MEASURE_MAX_LENGTH} />
      </Field>
      {measureSuggestions.length > 0 && (
        <Field label="Usar una medida ya escrita en esta MIPER" className="md:col-span-2">
          <Combobox aria-label="Usar una medida ya escrita" options={measureSuggestions.map((value) => ({ value, label: value }))} value="" disabled={disabled} onChange={(value) => { if (value) onChange({ description: value }) }} placeholder="Buscar medida…" />
        </Field>
      )}
      <ResponsibleField userId={draft.responsibleUserId} name={draft.responsibleName} options={responsibleOptions} current={currentResponsible} disabled={disabled}
        onChange={(next) => onChange({ responsibleUserId: next.userId, responsibleName: next.name })} />
    </>
  )
}
```

- [ ] **Step 4: `ControlForm` sobre `ControlFields`**

Reemplazar entero `app/(app)/prevencion/miper/[id]/control-form.tsx` por:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { saveMiperControlAction } from "../actions"
import { ControlFields, draftOf, isDraftReady, valuesOf, type ControlDraft } from "./control-fields"

/**
 * Alta y edición de una medida (spec §6.2). Sale de la ficha antigua
 * (`entry-sheet.tsx`) conservando los nombres accesibles que usan las E2E:
 * «Tipo de control», «Descripción de la medida», «Nombre o cargo
 * responsable», «Plazo de la medida».
 *
 * Fase C: «¿Ya está implementada?». Una medida nueva nace «Por implementar»
 * (la regla de siempre). Una existente pide la frecuencia de verificación en vez
 * del plazo, y el formulario envía `null` en lo que no aplica.
 *
 * Fase D: los campos viven en `ControlFields`, que comparte con «Agregar medida
 * a N»; aquí quedan el guardado, el error del servidor y los botones.
 */
export function ControlForm({ matrixId, entryId, control, controlVersion, responsibleOptions, measureSuggestions, onDone, onCancel }: {
  matrixId: string
  entryId: string
  control: MiperControlSnapshot | null
  controlVersion: number | undefined
  responsibleOptions: ReadonlyArray<{ id: string; name: string }>
  measureSuggestions: readonly string[]
  onDone: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<ControlDraft>(() => draftOf(control))
  const update = (patch: Partial<ControlDraft>) => setDraft((current) => ({ ...current, ...patch }))
  // Modo «message»: el rechazo del servidor queda escrito en el formulario
  // (role=alert) en vez de un toast que se va; el éxito sigue avisando y cierra.
  const operation = useOperation()
  // Mientras guarda, nada se edita: lo enviado es lo que se ve.
  const locked = operation.pending
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? controlVersion : undefined, values: valuesOf(draft),
  }), (result) => { toast.success(result.message ?? "Medida guardada"); onDone() })
  // El responsable actual puede ya no estar en la faena (`responsibleOptions`
  // son sus usuarios activos): sin esta opción el select mostraba «Selecciona…»
  // y parecía sin responsable.
  const currentResponsible = control?.responsibleUserId && !responsibleOptions.some((option) => option.id === control.responsibleUserId)
    ? { id: control.responsibleUserId, name: control.responsibleName ?? "Responsable actual" }
    : null
  return (
    <div role="group" aria-label={control ? "Editar medida de control" : "Nueva medida de control"} className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
      <ControlFields draft={draft} onChange={update} disabled={locked} responsibleOptions={responsibleOptions} currentResponsible={currentResponsible} measureSuggestions={measureSuggestions} />
      {operation.message && <p role="alert" className="text-sm text-[var(--color-danger-ink)] md:col-span-2">{operation.message}</p>}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" loading={operation.pending} disabled={!isDraftReady(draft)} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        <Button size="sm" variant="secondary" disabled={operation.pending} onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/control-fields.test.tsx" "app/(app)/prevencion/miper/[id]/control-form.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx"
```

Expected: PASS. `control-form.test.tsx` sin cambios: mismo envío, mismos nombres y mismo bloqueo.

- [ ] **Step 6: Puertas y commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/control-fields.tsx" "app/(app)/prevencion/miper/[id]/control-fields.test.tsx" "app/(app)/prevencion/miper/[id]/control-form.tsx"
git add "app/(app)/prevencion/miper/[id]/control-fields.tsx" "app/(app)/prevencion/miper/[id]/control-fields.test.tsx" "app/(app)/prevencion/miper/[id]/control-form.tsx"
git commit -m "refactor(miper): los campos de la medida en ControlFields, para compartirlos con «Agregar medida a N»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Barra de selección y diálogos de lote

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/bulk-shared.tsx`
- Create: `app/(app)/prevencion/miper/[id]/bulk-dialogs.tsx`
- Create: `app/(app)/prevencion/miper/[id]/bulk-bar.tsx`
- Test: `app/(app)/prevencion/miper/[id]/bulk-bar.test.tsx`

**Interfaces:**
- Consumes:
  - Task 2: `newlyIncomplete`, `withAddedControl`, `withControlPatch`, `impactSummary`, `type
    ControlPatch`; `applyEntryValues` (`entry-values.ts`);
  - Task 3: `MIPER_BULK_LIMIT`;
  - Task 5: `bulkAddMiperControlAction`, `bulkPatchMiperEntriesAction`, `bulkUpdateMiperControlsAction`;
  - Task 6: `type AutosaveSync`;
  - Task 7: `ControlFields`, `draftOf`, `valuesOf`, `isDraftReady`, `ResponsibleField`,
    `KEEP_RESPONSIBLE`, `type ControlDraft`.
- Produces:
  - `bulk-shared.tsx`: `type BulkContext = { matrixId; sync: AutosaveSync; setRows(updater); riskFactors;
    responsibleOptions; measureSuggestions; dictionaries: { activities; tasks; positions; locations };
    controlVersions }`; `type EntryItem = { entryId: string; expectedVersion: number }`;
    `MISSING_VERSION`; `entryItems(sync, entries): Promise<EntryItem[] | null>` (espera `whenIdle` y lee
    `versionOf`); `settlePatchedEntries(context, data, values)` (anota y aplica en pantalla);
    `BulkDialog({ open, onOpenChange, title, description, impact, error, busy, confirmLabel,
    confirmDisabled, onConfirm, children })`.
  - `bulk-dialogs.tsx`: `BulkAddControlDialog`, `BulkControlledDialog`, `BulkControlPatchDialog`, con
    props `{ entries: readonly MiperEntrySnapshot[]; context: BulkContext; onOpenChange(open: boolean);
    onDone(): void }`.
  - `bulk-bar.tsx`: `BulkBar({ selected: readonly MiperEntrySnapshot[]; context: BulkContext; onClear():
    void })` — región «Acciones sobre la selección»; botones «Quitar selección», «Cambiar
    ¿controlado?», «Asignar responsable / plazo» y «Agregar medida a N». Nombres que usan las Tasks 9-11:
    diálogos «Agregar una medida a N riesgo(s)», «¿Está controlado? en N riesgo(s)», «Responsable y
    plazo de las medidas de N riesgo(s)»; botones «Agregar a N», «Aplicar a N», «Aplicar a N
    medida(s)», «Cancelar», «Recargar la matriz»; grupo «¿A qué medidas?» con «Todas (n)», «Sin
    responsable (n)» y «Por implementar sin plazo (n)».

**Patrón:** `app/(app)/aprobaciones/bulk-approve-bar.tsx` (región `sticky bottom-0`, conteo, «Quitar
selección», y el `-mx-4 … md:-mx-8` que la lleva al borde del `PageContainer`). A diferencia de ésa,
cada acción abre un diálogo con campos y envía de forma imperativa (`useOperation`).

- [ ] **Step 1: Write the failing test**

Crear `app/(app)/prevencion/miper/[id]/bulk-bar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperControlSnapshot, MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))
const actions = vi.hoisted(() => ({ bulkAddMiperControlAction: vi.fn(), bulkPatchMiperEntriesAction: vi.fn(), bulkUpdateMiperControlsAction: vi.fn() }))
vi.mock("../actions", () => actions)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"

/** Riesgos completos: Moderados, «No» controlados y sin medidas (un Moderado no las exige). */
const e = (id: string, rowNumber: number, controls: MiperControlSnapshot[] = []): MiperEntrySnapshot => ({
  id, rowNumber, activity: "Bodega", task: "Trasvasije", position: "Bodeguero", location: null, exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "rf-1", riskFactor: "Químico", isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "Inhalación", probableDamage: "Intoxicación",
  probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "no", controls,
})
const control = (id: string, overrides: Partial<MiperControlSnapshot> = {}): MiperControlSnapshot => ({
  id, hierarchy: "administrative", description: `Medida ${id}`, responsibleUserId: null, responsibleName: null, dueDate: null, status: "proposed", isExisting: false, verificationFrequency: null, ...overrides,
})
const versions: Record<string, number> = { a: 4, b: 2 }
function context(overrides: Partial<BulkContext> = {}): BulkContext {
  return {
    matrixId: "m1",
    sync: { versionOf: (id) => versions[id], whenIdle: vi.fn(async () => {}), acknowledge: vi.fn() },
    setRows: vi.fn(), riskFactors: [], responsibleOptions: [{ id: "u1", name: "Ana Pérez" }], measureSuggestions: [],
    dictionaries: { activities: [], tasks: [], positions: [], locations: [] }, controlVersions: { c1: 3, c2: 7 }, ...overrides,
  }
}
const selected = [e("a", 4), e("b", 7)]

afterEach(() => { vi.clearAllMocks() })

describe("BulkBar (Fase D)", () => {
  it("sin selección no se pinta; con selección dice cuántos y ofrece las tres acciones", () => {
    const { rerender } = render(<BulkBar selected={[]} context={context()} onClear={vi.fn()} />)
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
    rerender(<BulkBar selected={selected} context={context()} onClear={vi.fn()} />)
    const bar = screen.getByRole("region", { name: "Acciones sobre la selección" })
    expect(bar).toHaveTextContent("2 riesgos seleccionados")
    for (const name of ["Agregar medida a 2", "Cambiar ¿controlado?", "Asignar responsable / plazo", "Quitar selección"]) {
      expect(within(bar).getByRole("button", { name })).toBeEnabled()
    }
  })

  it("sobre 300 avisa cuántos quitar y no deja aplicar", () => {
    const many = Array.from({ length: 302 }, (_, index) => e(`r${index}`, index + 1))
    render(<BulkBar selected={many} context={context()} onClear={vi.fn()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Se pueden cambiar hasta 300 riesgos a la vez: quita 2 de la selección.")
    expect(screen.getByRole("button", { name: "Agregar medida a 302" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cambiar ¿controlado?" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Asignar responsable / plazo" })).toBeDisabled()
  })

  it("«Agregar medida a N» espera los guardados en curso, envía la versión de cada riesgo y vacía la selección", async () => {
    let idle!: () => void
    const ctx = context({ sync: { versionOf: (id) => versions[id], whenIdle: vi.fn(() => new Promise<void>((resolve) => { idle = resolve })), acknowledge: vi.fn() } })
    actions.bulkAddMiperControlAction.mockResolvedValueOnce({ ok: true, message: "Medida agregada a 2 riesgos", data: { created: 2 } })
    const onClear = vi.fn()
    render(<BulkBar selected={selected} context={ctx} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar medida a 2" }))
    const dialog = screen.getByRole("dialog", { name: "Agregar una medida a 2 riesgos" })
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ya está implementada" }))
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Descripción de la medida" }), { target: { value: "Ficha de seguridad a la vista" } })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nombre o cargo responsable" }), { target: { value: "Jefe de bodega" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Agregar a 2" }))
    await waitFor(() => expect(ctx.sync.whenIdle).toHaveBeenCalledWith(["a", "b"]))
    // Mientras un guardado del riesgo sigue en curso, no se leen versiones ni se envía nada.
    expect(actions.bulkAddMiperControlAction).not.toHaveBeenCalled()
    idle()
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(actions.bulkAddMiperControlAction).toHaveBeenCalledWith({
      matrixId: "m1", items: [{ entryId: "a", expectedVersion: 4 }, { entryId: "b", expectedVersion: 2 }],
      values: { hierarchy: "administrative", description: "Ficha de seguridad a la vista", responsibleUserId: null, responsibleName: "Jefe de bodega", isExisting: true, verificationFrequency: null, dueDate: null },
    })
    expect(toast.success).toHaveBeenCalledWith("Medida agregada a 2 riesgos")
  })

  it("antes de agregar una medida por implementar sin plazo avisa qué riesgos quedan con pendientes nuevos", () => {
    render(<BulkBar selected={selected} context={context()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar medida a 2" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nombre o cargo responsable" }), { target: { value: "Jefe de bodega" } })
    // Sin descripción todavía no hay medida que evaluar.
    expect(within(dialog).queryByText(/quedan con pendientes nuevos/)).toBeNull()
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Descripción de la medida" }), { target: { value: "Ventilación forzada" } })
    expect(within(dialog).getByText(/2 riesgos quedan con pendientes nuevos: #4 y #7\./)).toBeTruthy()
    // Ya implementada no lleva plazo (D5): con responsable, nada queda pendiente.
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ya está implementada" }))
    expect(within(dialog).queryByText(/quedan con pendientes nuevos/)).toBeNull()
  })

  it("«Cambiar ¿controlado?» anota las versiones nuevas y cambia las filas en pantalla sin esperar la foto", async () => {
    const ctx = context()
    actions.bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, message: "2 riesgos actualizados", data: { entries: [{ id: "a", version: 5 }, { id: "b", version: 3 }] } })
    render(<BulkBar selected={selected} context={ctx} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar ¿controlado?" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Aplicar a 2" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sí" }))
    // «Sí» sin medidas: los dos quedan con un pendiente nuevo, y se dice antes.
    expect(within(dialog).getByText(/2 riesgos quedan con pendientes nuevos/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar a 2" }))
    await waitFor(() => expect(ctx.sync.acknowledge).toHaveBeenCalledWith({ a: 5, b: 3 }))
    expect(actions.bulkPatchMiperEntriesAction).toHaveBeenCalledWith({ matrixId: "m1", items: [{ entryId: "a", expectedVersion: 4 }, { entryId: "b", expectedVersion: 2 }], values: { controlledStatus: "yes" } })
    const updater = vi.mocked(ctx.setRows).mock.calls[0]![0]
    expect(updater([e("a", 4), e("z", 9)]).map((row) => [row.id, row.controlledStatus])).toEqual([["a", "yes"], ["z", "no"]])
  })

  it("un rechazo queda en el diálogo con «Recargar la matriz» y la selección se conserva", async () => {
    actions.bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: false, message: "1 riesgo cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona." })
    const onClear = vi.fn()
    render(<BulkBar selected={selected} context={context()} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar ¿controlado?" }))
    fireEvent.click(screen.getByRole("radio", { name: "No" }))
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a 2" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("1 riesgo cambió mientras editabas")
    fireEvent.click(screen.getByRole("button", { name: "Recargar la matriz" }))
    expect(router.refresh).toHaveBeenCalled()
    expect(onClear).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("«Asignar responsable / plazo»: «Sin responsable» acota las medidas y cada una viaja con su versión", async () => {
    const withControls = [e("a", 4, [control("c1")]), e("b", 7, [control("c2", { responsibleName: "Bodeguero", isExisting: true, verificationFrequency: "Mensual" })])]
    actions.bulkUpdateMiperControlsAction.mockResolvedValueOnce({ ok: true, message: "1 medida actualizada", data: { updated: 1 } })
    const onClear = vi.fn()
    render(<BulkBar selected={withControls} context={context()} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Asignar responsable / plazo" }))
    const dialog = screen.getByRole("dialog")
    // Todo parte en «no cambiar»: no hay nada que aplicar.
    expect(within(dialog).getByRole("button", { name: "Aplicar a 2 medidas" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sin responsable (1)" }))
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Responsable de la medida" }))
    fireEvent.click(screen.getByRole("option", { name: "Ana Pérez" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar a 1 medida" }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(actions.bulkUpdateMiperControlsAction).toHaveBeenCalledWith({ matrixId: "m1", items: [{ controlId: "c1", expectedVersion: 3 }], patch: { responsible: { kind: "user", userId: "u1" } } })
  })

  it("«Asignar responsable / plazo»: pasar a «ya implementada» la única medida por implementar de un Intolerable se avisa antes", () => {
    const intolerable = { ...e("a", 4, [control("c1", { responsibleName: "Supervisor", dueDate: "2026-11-30" })]), probability: 4, consequence: 4, magnitude: 16, classification: "intolerable" as const }
    render(<BulkBar selected={[intolerable]} context={context()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Asignar responsable / plazo" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).queryByText(/pendientes nuevos/)).toBeNull()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Ya está implementada" }))
    expect(within(dialog).getByText(/1 riesgo queda con pendientes nuevos: #4\./)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/bulk-bar.test.tsx"
```

Expected: FAIL, «Failed to resolve import "./bulk-bar"».

- [ ] **Step 3: Lo común: versiones, filas en pantalla y el marco del diálogo**

Crear `app/(app)/prevencion/miper/[id]/bulk-shared.tsx`:

```tsx
"use client"

import { useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { applyEntryValues } from "@/lib/prevention/miper/entry-values"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import type { AutosaveSync } from "./use-entry-autosave"

/** Lo que las acciones masivas (Fase D) necesitan del espacio de trabajo. Lo arma `miper-workspace.tsx`. */
export type BulkContext = {
  matrixId: string
  sync: AutosaveSync
  /** Aplica un cambio de riesgos en pantalla sin esperar la foto del servidor. */
  setRows: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  riskFactors: ReadonlyArray<{ id: string; name: string }>
  responsibleOptions: ReadonlyArray<{ id: string; name: string }>
  measureSuggestions: readonly string[]
  dictionaries: { activities: readonly string[]; tasks: readonly string[]; positions: readonly string[]; locations: readonly string[] }
  controlVersions: Readonly<Record<string, number>>
}

export type EntryItem = { entryId: string; expectedVersion: number }

/** Sin versión conocida de un riesgo no se adivina una: se pide recargar. */
export const MISSING_VERSION = { ok: false as const, message: "Falta la versión de un riesgo; recarga la matriz." }

/**
 * Las versiones que se envían, leídas DESPUÉS de que terminen los guardados en
 * curso de esos riesgos (`whenIdle`): si no, un campo que se guardaba al salir
 * del editor dejaba una versión vieja y el lote chocaba consigo mismo.
 */
export async function entryItems(sync: AutosaveSync, entries: readonly MiperEntrySnapshot[]): Promise<EntryItem[] | null> {
  const ids = entries.map((entry) => entry.id)
  await sync.whenIdle(ids)
  const items: EntryItem[] = []
  for (const entryId of ids) {
    const expectedVersion = sync.versionOf(entryId)
    if (expectedVersion === undefined) return null
    items.push({ entryId, expectedVersion })
  }
  return items
}

/**
 * Después de un cambio de riesgos en lote: anota las versiones nuevas (el
 * siguiente guardado automático de cada uno parte de ahí) y aplica el cambio en
 * pantalla. La foto del servidor llega después, con la revalidación, y como trae
 * esas mismas versiones la reemplaza.
 */
export function settlePatchedEntries(context: BulkContext, data: Record<string, unknown> | undefined, values: MiperEntryValues) {
  const list = Array.isArray(data?.entries) ? data.entries : []
  const versions = Object.fromEntries(list.flatMap((item: unknown) => {
    const saved = item as { id?: unknown; version?: unknown }
    return typeof saved?.id === "string" && typeof saved.version === "number" ? [[saved.id, saved.version] as const] : []
  }))
  context.sync.acknowledge(versions)
  context.setRows((rows) => rows.map((row) => (row.id in versions ? applyEntryValues(row, values, context.riskFactors) : row)))
}

/**
 * Marco común de los diálogos de lote: el efecto en la completitud antes de
 * aplicar (no impide: el editor tampoco), el rechazo del servidor con «Recargar
 * la matriz» y el diálogo que no se cierra mientras guarda.
 */
export function BulkDialog({ open, onOpenChange, title, description, impact, error, busy, confirmLabel, confirmDisabled, onConfirm, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  impact: string | null
  error: string
  busy: boolean
  confirmLabel: string
  confirmDisabled: boolean
  onConfirm: () => void
  children: ReactNode
}) {
  const router = useRouter()
  const [reloading, startReload] = useTransition()
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {children}
          {impact && (
            <Callout tone="warning" title="Antes de aplicar">
              {impact} Puedes aplicarlo igual y completarlos después: el envío a revisión los va a pedir.
            </Callout>
          )}
          {error && (
            <Callout tone="danger" role="alert">
              <p>{error}</p>
              <Button className="mt-2" size="sm" variant="secondary" loading={reloading} onClick={() => startReload(() => router.refresh())}>Recargar la matriz</Button>
            </Callout>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button loading={busy} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Los tres diálogos**

Crear `app/(app)/prevencion/miper/[id]/bulk-dialogs.tsx`:

```tsx
"use client"

import { useMemo, useState } from "react"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useOperation } from "@/lib/hooks/use-operation"
import { impactSummary, newlyIncomplete, withAddedControl, withControlPatch } from "@/lib/prevention/miper/bulk-impact"
import type { ControlPatch } from "@/lib/prevention/miper/control-values"
import { applyEntryValues } from "@/lib/prevention/miper/entry-values"
import { FREQUENCY_MAX_LENGTH } from "@/lib/prevention/miper/re04-measures"
import { CONTROLLED_STATUS_LABEL, type ControlledStatus, type MiperControlSnapshot, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { countOf } from "@/lib/utils"
import { MIPER_BULK_LIMIT } from "@/lib/validation/prevention-module/miper"
import { bulkAddMiperControlAction, bulkPatchMiperEntriesAction, bulkUpdateMiperControlsAction } from "../actions"
import { BulkDialog, type BulkContext, entryItems, MISSING_VERSION, settlePatchedEntries } from "./bulk-shared"
import { ControlFields, draftOf, isDraftReady, KEEP_RESPONSIBLE, ResponsibleField, valuesOf, type ControlDraft } from "./control-fields"

type DialogProps = { entries: readonly MiperEntrySnapshot[]; context: BulkContext; onOpenChange: (open: boolean) => void; onDone: () => void }

const nameIn = (options: BulkContext["responsibleOptions"]) => (userId: string) => options.find((option) => option.id === userId)?.name ?? null

/** «Agregar medida a N»: la misma medida en cada riesgo, con los campos del editor. */
export function BulkAddControlDialog({ entries, context, onOpenChange, onDone }: DialogProps) {
  const [draft, setDraft] = useState<ControlDraft>(() => draftOf(null))
  const operation = useOperation()
  const values = valuesOf(draft)
  // Sin descripción todavía no hay medida que evaluar: el aviso hablaría de lo que falta escribir.
  const impact = isDraftReady(draft) ? impactSummary(newlyIncomplete(entries, entries.map((entry) => withAddedControl(entry, values, nameIn(context.responsibleOptions))))) : null
  const apply = () => operation.run(async () => {
    const items = await entryItems(context.sync, entries)
    if (!items) return MISSING_VERSION
    return bulkAddMiperControlAction({ matrixId: context.matrixId, items, values })
  }, (result) => { toast.success(result.message ?? "Medida agregada"); onDone() })
  return (
    <BulkDialog open onOpenChange={onOpenChange} title={`Agregar una medida a ${countOf(entries.length, "riesgo", "riesgos")}`}
      description="La misma medida se agrega a cada riesgo seleccionado y queda «Propuesta», como toda medida nueva."
      impact={impact} error={operation.message} busy={operation.pending}
      confirmLabel={`Agregar a ${entries.length}`} confirmDisabled={!isDraftReady(draft)} onConfirm={apply}>
      <div className="grid gap-3 md:grid-cols-2">
        <ControlFields draft={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} disabled={operation.pending}
          responsibleOptions={context.responsibleOptions} measureSuggestions={context.measureSuggestions} />
      </div>
    </BulkDialog>
  )
}

const CONTROLLED = (["yes", "partial", "no"] as const).map((value) => ({ value, title: CONTROLLED_STATUS_LABEL[value] }))

/** «Cambiar ¿controlado?»: el mismo «¿Está controlado?» en cada riesgo (un cambio de riesgos en lote). */
export function BulkControlledDialog({ entries, context, onOpenChange, onDone }: DialogProps) {
  const [status, setStatus] = useState<ControlledStatus | null>(null)
  const operation = useOperation()
  const impact = status ? impactSummary(newlyIncomplete(entries, entries.map((entry) => applyEntryValues(entry, { controlledStatus: status }, context.riskFactors)))) : null
  const apply = () => {
    if (!status) return
    const values = { controlledStatus: status }
    operation.run(async () => {
      const items = await entryItems(context.sync, entries)
      if (!items) return MISSING_VERSION
      return bulkPatchMiperEntriesAction({ matrixId: context.matrixId, items, values })
    }, (result) => {
      settlePatchedEntries(context, result.data, values)
      toast.success(result.message ?? "Riesgos actualizados")
      onDone()
    })
  }
  return (
    <BulkDialog open onOpenChange={onOpenChange} title={`¿Está controlado? en ${countOf(entries.length, "riesgo", "riesgos")}`}
      description="Lo que elijas reemplaza la respuesta de cada riesgo seleccionado."
      impact={impact} error={operation.message} busy={operation.pending}
      confirmLabel={`Aplicar a ${entries.length}`} confirmDisabled={status === null} onConfirm={apply}>
      <ChoiceCardGroup label="¿Está controlado el riesgo?" options={CONTROLLED} value={status} disabled={operation.pending} onChange={setStatus} />
    </BulkDialog>
  )
}

type Scope = "all" | "unassigned" | "undated"
const SCOPE_TEST: Record<Scope, (control: MiperControlSnapshot) => boolean> = {
  all: () => true,
  unassigned: (control) => !control.responsibleUserId && !control.responsibleName,
  undated: (control) => !(control.isExisting ?? false) && !control.dueDate,
}
type Kind = "keep" | "existing" | "pending"
const KIND: ReadonlyArray<{ value: Kind; title: string; description: string }> = [
  { value: "keep", title: "No cambiar", description: "Cada medida queda como está." },
  { value: "existing", title: "Ya está implementada", description: "Se verifica con una frecuencia; pierde el plazo." },
  { value: "pending", title: "Por implementar", description: "Lleva plazo; pierde la frecuencia." },
]

/**
 * «Asignar responsable / plazo» de las medidas de los riesgos seleccionados.
 * Cada campo parte en «no cambiar». D5 rige como en el editor: el plazo sólo
 * entra a las medidas por implementar y la frecuencia sólo a las existentes.
 */
export function BulkControlPatchDialog({ entries, context, onOpenChange, onDone }: DialogProps) {
  const [scope, setScope] = useState<Scope>("all")
  const [kind, setKind] = useState<Kind>("keep")
  const [responsible, setResponsible] = useState({ userId: KEEP_RESPONSIBLE, name: "" })
  const [dueDate, setDueDate] = useState("")
  const [frequency, setFrequency] = useState("")
  const operation = useOperation()
  const all = useMemo(() => entries.flatMap((entry) => entry.controls), [entries])
  const counts = { all: all.length, unassigned: all.filter(SCOPE_TEST.unassigned).length, undated: all.filter(SCOPE_TEST.undated).length }
  const controls = all.filter(SCOPE_TEST[scope])
  const textResponsibleMissing = responsible.userId === "" && responsible.name.trim() === ""
  const patch: ControlPatch = {
    ...(responsible.userId === KEEP_RESPONSIBLE || textResponsibleMissing ? {}
      : { responsible: responsible.userId ? { kind: "user", userId: responsible.userId } : { kind: "text", name: responsible.name.trim() } }),
    ...(kind === "keep" ? {} : { isExisting: kind === "existing" }),
    ...(kind !== "existing" && dueDate ? { dueDate } : {}),
    ...(kind !== "pending" && frequency.trim() ? { verificationFrequency: frequency.trim() } : {}),
  }
  const ids = new Set(controls.map((control) => control.id))
  const nothing = Object.keys(patch).length === 0
  const impact = nothing ? null : impactSummary(newlyIncomplete(entries, entries.map((entry) => withControlPatch(entry, ids, patch, nameIn(context.responsibleOptions)))))
  const over = controls.length > MIPER_BULK_LIMIT
  const apply = () => operation.run(async () => {
    const items = controls.map((control) => ({ controlId: control.id, expectedVersion: context.controlVersions[control.id] }))
    if (items.some((item) => item.expectedVersion === undefined)) return { ok: false, message: "Falta la versión de una medida; recarga la matriz." }
    return bulkUpdateMiperControlsAction({ matrixId: context.matrixId, items, patch })
  }, (result) => { toast.success(result.message ?? "Medidas actualizadas"); onDone() })
  return (
    <BulkDialog open onOpenChange={onOpenChange} title={`Responsable y plazo de las medidas de ${countOf(entries.length, "riesgo", "riesgos")}`}
      description="Elige a qué medidas se aplica y qué cambia. Lo que dejes en «No cambiar» o vacío se conserva en cada medida."
      impact={impact} error={operation.message} busy={operation.pending}
      confirmLabel={`Aplicar a ${countOf(controls.length, "medida", "medidas")}`}
      confirmDisabled={nothing || textResponsibleMissing || controls.length === 0 || over} onConfirm={apply}>
      {all.length === 0 ? (
        <p className="text-sm text-[var(--color-text-subtle)]">Los riesgos seleccionados todavía no tienen medidas: agrégalas primero con «Agregar medida».</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <p className="text-sm font-medium">¿A qué medidas?</p>
            <ChoiceCardGroup label="¿A qué medidas?" value={scope} onChange={setScope} disabled={operation.pending}
              options={[
                { value: "all", title: `Todas (${counts.all})` },
                { value: "unassigned", title: `Sin responsable (${counts.unassigned})` },
                { value: "undated", title: `Por implementar sin plazo (${counts.undated})` },
              ]} />
            {over && <p role="status" className="text-sm text-[var(--color-warning-ink)]">Son {controls.length} medidas: se pueden cambiar hasta {MIPER_BULK_LIMIT} a la vez. Elige un grupo más chico o selecciona menos riesgos.</p>}
          </div>
          <div className="space-y-2 md:col-span-2">
            <p className="text-sm font-medium">¿Ya está implementada?</p>
            <ChoiceCardGroup label="¿Ya está implementada?" options={KIND} value={kind} onChange={setKind} disabled={operation.pending} />
          </div>
          <ResponsibleField userId={responsible.userId} name={responsible.name} onChange={setResponsible} options={context.responsibleOptions} disabled={operation.pending} keepLabel="No cambiar" />
          {kind !== "existing" && (
            <Field label="Plazo" helper="Sólo para las medidas por implementar. Vacío: no cambia.">
              <DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} disabled={operation.pending} onChange={setDueDate} />
            </Field>
          )}
          {kind !== "pending" && (
            <Field label="Frecuencia de verificación" helper="Sólo para las medidas ya implementadas. Vacío: no cambia.">
              <Input aria-label="Frecuencia de verificación" value={frequency} disabled={operation.pending} onChange={(event) => setFrequency(event.target.value)} placeholder="Trimestral" maxLength={FREQUENCY_MAX_LENGTH} />
            </Field>
          )}
        </div>
      )}
    </BulkDialog>
  )
}
```

- [ ] **Step 5: La barra**

Crear `app/(app)/prevencion/miper/[id]/bulk-bar.tsx`:

```tsx
"use client"

import { useState } from "react"
import { X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { pluralize } from "@/lib/utils"
import { MIPER_BULK_LIMIT } from "@/lib/validation/prevention-module/miper"
import { BulkAddControlDialog, BulkControlledDialog, BulkControlPatchDialog } from "./bulk-dialogs"
import type { BulkContext } from "./bulk-shared"

type Open = "add" | "controlled" | "patch" | null

/**
 * Barra de acciones sobre los riesgos seleccionados (Fase D, spec §9). Mismo
 * patrón que `aprobaciones/bulk-approve-bar.tsx`: aparece sólo con selección y
 * es `sticky` al pie del pozo del shell (no `fixed`, que se metería bajo el
 * sidebar). Cada acción abre su diálogo; al terminar bien, la selección se vacía.
 * Sobre el tope de una operación avisa cuántos quitar y no deja aplicar.
 */
export function BulkBar({ selected, context, onClear }: { selected: readonly MiperEntrySnapshot[]; context: BulkContext; onClear: () => void }) {
  const [open, setOpen] = useState<Open>(null)
  if (selected.length === 0) return null
  const over = selected.length - MIPER_BULK_LIMIT
  const props = { entries: selected, context, onOpenChange: (next: boolean) => { if (!next) setOpen(null) }, onDone: () => { setOpen(null); onClear() } }
  return (
    <div role="region" aria-label="Acciones sobre la selección"
      className="sticky bottom-0 z-30 -mx-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)] md:-mx-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[var(--color-text)]">
          <p><span className="font-mono font-semibold tabular-nums">{selected.length}</span> {pluralize(selected.length, "riesgo seleccionado", "riesgos seleccionados")}</p>
          {over > 0 && <p role="status" className="text-[var(--color-warning-ink)]">Se pueden cambiar hasta {MIPER_BULK_LIMIT} riesgos a la vez: quita {over} de la selección.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClear}><X size={14} />Quitar selección</Button>
          <Button type="button" variant="secondary" size="sm" disabled={over > 0} onClick={() => setOpen("controlled")}>Cambiar ¿controlado?</Button>
          <Button type="button" variant="secondary" size="sm" disabled={over > 0} onClick={() => setOpen("patch")}>Asignar responsable / plazo</Button>
          <Button type="button" size="sm" disabled={over > 0} onClick={() => setOpen("add")}>Agregar medida a {selected.length}</Button>
        </div>
      </div>
      {open === "add" && <BulkAddControlDialog {...props} />}
      {open === "controlled" && <BulkControlledDialog {...props} />}
      {open === "patch" && <BulkControlPatchDialog {...props} />}
    </div>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/bulk-bar.test.tsx"
```

Expected: PASS (8 pruebas).

- [ ] **Step 7: Puertas y commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/bulk-shared.tsx" "app/(app)/prevencion/miper/[id]/bulk-dialogs.tsx" "app/(app)/prevencion/miper/[id]/bulk-bar.tsx" "app/(app)/prevencion/miper/[id]/bulk-bar.test.tsx"
git add "app/(app)/prevencion/miper/[id]/bulk-shared.tsx" "app/(app)/prevencion/miper/[id]/bulk-dialogs.tsx" "app/(app)/prevencion/miper/[id]/bulk-bar.tsx" "app/(app)/prevencion/miper/[id]/bulk-bar.test.tsx"
git commit -m "feat(miper): barra de selección y diálogos de lote: medida en N riesgos, ¿controlado? y responsable/plazo, con el efecto antes de aplicar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: «Seleccionar» en la vista de la tarea y en la matriz filtrada

**Files:**
- Modify: `app/(app)/prevencion/miper/[id]/risk-row.tsx:1-2` (import) y al final (`SelectableRiskRow`)
- Modify: `app/(app)/prevencion/miper/[id]/task-view.tsx:12-25`, `:29-30`, `:78`, `:89`, `:96-97` y
  `:102-105`
- Modify: `app/(app)/prevencion/miper/[id]/activity-section.tsx:9-10`, `:22-25` y `:50-51`
- Modify: `app/(app)/prevencion/miper/[id]/matrix-view.tsx:3-12`, `:20-21`, `:31-34` y `:41-44`
- Modify: `app/(app)/prevencion/miper/[id]/miper-workspace.tsx:38`, `:113-114`, `:185` y `:195`
- Test: `app/(app)/prevencion/miper/[id]/task-view.test.tsx`, `…/matrix-view.test.tsx`,
  `…/miper-workspace.test.tsx`

**Interfaces:**
- Consumes: `useRiskSelection`, `type RiskSelection` (Task 6); `BulkBar`, `type BulkContext` (Task 8);
  `autosave` del espacio de trabajo, que ya es `EntryAutosave & AutosaveSync` (Task 6).
- Produces:
  - `SelectableRiskRow` (`risk-row.tsx`): las props de `RiskRow` más `selection: { checked: boolean;
    onToggle(): void } | null`; la casilla «Seleccionar el riesgo #N: {peligro}» va **al lado** del
    enlace.
  - `TaskView` gana `bulk?: BulkContext`: con él, «Seleccionar» / «Terminar selección», «Seleccionar
    los N riesgos» y la barra. El espacio de trabajo la monta con `key={task.key}` (otra tarea parte sin
    selección).
  - `ActivitySection` gana `selection?: RiskSelection | null`.
  - `MatrixView` gana `bulk?: BulkContext`: con filtros, «Seleccionar» / «Terminar selección»,
    «Seleccionar los N resultados» y la barra; quitar los filtros termina la selección.
  - `MiperWorkspaceView` arma `bulk` sólo si `editable` y lo pasa a la tarea y a la matriz.

- [ ] **Step 1: Write the failing tests**

En `app/(app)/prevencion/miper/[id]/task-view.test.tsx`:

1. Reemplazar:

```tsx
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("tarea=k&clasificacion=important") }))
const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

const toastError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/toast", () => ({ toast: { error: toastError, success: vi.fn() } }))

import { TaskView } from "./task-view"

const e = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
```

por:

```tsx
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("tarea=k&clasificacion=important") }))
const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction, bulkAddMiperControlAction: vi.fn(), bulkPatchMiperEntriesAction: vi.fn(), bulkUpdateMiperControlsAction: vi.fn() }))

const toastError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/toast", () => ({ toast: { error: toastError, success: vi.fn() } }))

import type { BulkContext } from "./bulk-shared"
import { TaskView } from "./task-view"

const e = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
```

2. Reemplazar:

```tsx
}) as MiperEntrySnapshot
const rows = [e("a", 4), e("b", 7, { position: "Peoneta" })]
const task = buildMatrixTree(rows, { incomplete: new Set(["a"]), observed: new Set(), modified: new Set(), matching: null })[0]!.tasks[0]!
const base = { matrixId: "m1", task, incomplete: new Set(["a"]), observed: new Set<string>(), changes: new Map(), issuesByEntry: new Map([["a", [{ scope: "entry" as const, entryId: "a", field: "controls", message: "m", severity: "error" as const }]]]) }

describe("TaskView", () => {
```

por:

```tsx
}) as MiperEntrySnapshot
const rows = [e("a", 4), e("b", 7, { position: "Peoneta" })]
const task = buildMatrixTree(rows, { incomplete: new Set(["a"]), observed: new Set(), modified: new Set(), matching: null })[0]!.tasks[0]!
const bulk = (): BulkContext => ({
  matrixId: "m1", sync: { versionOf: () => 1, whenIdle: async () => {}, acknowledge: vi.fn() }, setRows: vi.fn(), riskFactors: [], responsibleOptions: [],
  measureSuggestions: [], dictionaries: { activities: [], tasks: [], positions: [], locations: [] }, controlVersions: {},
})
const base = { matrixId: "m1", task, incomplete: new Set(["a"]), observed: new Set<string>(), changes: new Map(), issuesByEntry: new Map([["a", [{ scope: "entry" as const, entryId: "a", field: "controls", message: "m", severity: "error" as const }]]]) }

describe("TaskView", () => {
```

3. Reemplazar:

```tsx
    expect(screen.getByRole("link", { name: "Riesgo #9: peligro sin describir" })).toBeTruthy()
    expect(screen.getByText("Peligro sin describir")).toBeTruthy()
  })
})
```

por:

```tsx
    expect(screen.getByRole("link", { name: "Riesgo #9: peligro sin describir" })).toBeTruthy()
    expect(screen.getByText("Peligro sin describir")).toBeTruthy()
  })

  it("«Seleccionar» pone una casilla al lado de cada riesgo, fuera de su enlace; sin el modo no hay casillas (Fase D)", () => {
    render(<TaskView {...base} editable bulk={bulk()} />)
    expect(screen.queryByRole("checkbox")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }))
    const box = screen.getByRole("checkbox", { name: "Seleccionar el riesgo #4: Peligro 4" })
    // Fuera del `<a>`: un clic en la casilla no abre el editor.
    expect(box.closest("a")).toBeNull()
    fireEvent.click(box)
    expect(screen.getByRole("region", { name: "Acciones sobre la selección" })).toHaveTextContent("1 riesgo seleccionado")
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar los 2 riesgos" }))
    expect(screen.getByRole("region", { name: "Acciones sobre la selección" })).toHaveTextContent("2 riesgos seleccionados")
    fireEvent.click(screen.getByRole("button", { name: "Terminar selección" }))
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
  })

  it("sin acciones masivas (sólo lectura) no ofrece «Seleccionar»", () => {
    render(<TaskView {...base} editable={false} />)
    expect(screen.queryByRole("button", { name: "Seleccionar" })).toBeNull()
  })
})
```

En `app/(app)/prevencion/miper/[id]/matrix-view.test.tsx` (la matriz pinta ahora la barra, que importa
las acciones: el test las mockea):

1. Reemplazar:

```tsx
import { buildMatrixTree, taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))

import { MatrixView } from "./matrix-view"

const e = (id: string, rowNumber: number, activity: string, task: string) => ({ id, rowNumber, activity, task, position: "P", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${id}`, risk: "R", probableDamage: "D", probability: 1, consequence: 1, magnitude: 1, classification: "tolerable", controlledStatus: "yes", controls: [] }) as MiperEntrySnapshot
```

por:

```tsx
import { buildMatrixTree, taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))
vi.mock("../actions", () => ({ bulkAddMiperControlAction: vi.fn(), bulkPatchMiperEntriesAction: vi.fn(), bulkUpdateMiperControlsAction: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import type { BulkContext } from "./bulk-shared"
import { MatrixView } from "./matrix-view"

const e = (id: string, rowNumber: number, activity: string, task: string) => ({ id, rowNumber, activity, task, position: "P", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${id}`, risk: "R", probableDamage: "D", probability: 1, consequence: 1, magnitude: 1, classification: "tolerable", controlledStatus: "yes", controls: [] }) as MiperEntrySnapshot
```

2. Reemplazar:

```tsx
    render(<MatrixView {...base} tree={buildMatrixTree(accented, { ...ctx, matching: null })} filtered={false} />)
    expect(screen.getByRole("region", { name: /Lavado de camión/ })).toBeTruthy()
  })
})
```

por:

```tsx
    render(<MatrixView {...base} tree={buildMatrixTree(accented, { ...ctx, matching: null })} filtered={false} />)
    expect(screen.getByRole("region", { name: /Lavado de camión/ })).toBeTruthy()
  })

  it("con filtros ofrece «Seleccionar» y «Seleccionar los N resultados»; quitar los filtros termina la selección (Fase D)", () => {
    const bulk: BulkContext = {
      matrixId: "m1", sync: { versionOf: () => 1, whenIdle: async () => {}, acknowledge: vi.fn() }, setRows: vi.fn(), riskFactors: [], responsibleOptions: [],
      measureSuggestions: [], dictionaries: { activities: [], tasks: [], positions: [], locations: [] }, controlVersions: {},
    }
    const structure = buildMatrixTree(rows, { ...ctx, matching: null })
    const filteredTree = buildMatrixTree(rows, { ...ctx, matching: new Set(["a", "b"]) })
    const { rerender } = render(<MatrixView {...base} bulk={bulk} tree={structure} filtered={false} />)
    // Sin filtros la matriz lista tareas, no riesgos: no hay qué seleccionar.
    expect(screen.queryByRole("button", { name: "Seleccionar" })).toBeNull()
    rerender(<MatrixView {...base} bulk={bulk} tree={filteredTree} filtered />)
    expect(screen.queryByRole("checkbox")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }))
    expect(screen.getByRole("checkbox", { name: "Seleccionar el riesgo #2: Peligro b" }).closest("a")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar los 2 resultados" }))
    expect(screen.getByRole("region", { name: "Acciones sobre la selección" })).toHaveTextContent("2 riesgos seleccionados")
    rerender(<MatrixView {...base} bulk={bulk} tree={structure} filtered={false} />)
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
    rerender(<MatrixView {...base} bulk={bulk} tree={filteredTree} filtered />)
    expect(screen.queryByRole("checkbox")).toBeNull()
  })
})
```

En `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx` (la lista de acciones del mock es «todas
las que importa el árbol del espacio de trabajo»: se suman las tres nuevas):

1. Reemplazar:

```tsx
  saveMiperEntryAction: vi.fn(), saveProgramActionAction: vi.fn(), saveProgramHeaderAction: vi.fn(),
  submitMiperAction: vi.fn(), updateMiperHeaderAction: vi.fn(), uploadProgramEvidenceAction: vi.fn(),
  voidOccurrenceRecordAction: vi.fn(), withdrawOccurrenceEvidenceAction: vi.fn(),
}))

import { MiperWorkspaceView } from "./miper-workspace"
```

por:

```tsx
  saveMiperEntryAction: vi.fn(), saveProgramActionAction: vi.fn(), saveProgramHeaderAction: vi.fn(),
  submitMiperAction: vi.fn(), updateMiperHeaderAction: vi.fn(), uploadProgramEvidenceAction: vi.fn(),
  voidOccurrenceRecordAction: vi.fn(), withdrawOccurrenceEvidenceAction: vi.fn(),
  bulkAddMiperControlAction: vi.fn(), bulkPatchMiperEntriesAction: vi.fn(), bulkUpdateMiperControlsAction: vi.fn(),
}))

import { MiperWorkspaceView } from "./miper-workspace"
```

2. Reemplazar:

```tsx
    expect(screen.queryByRole("menuitem", { name: /2027 \(actual\)/ })).toBeNull()
    expect(screen.getByRole("menuitem", { name: "Mina · 2026" })).not.toHaveAttribute("aria-disabled")
  })
})
```

por:

```tsx
    expect(screen.queryByRole("menuitem", { name: /2027 \(actual\)/ })).toBeNull()
    expect(screen.getByRole("menuitem", { name: "Mina · 2026" })).not.toHaveAttribute("aria-disabled")
  })

  it("acciones masivas (Fase D): quien edita ve «Seleccionar» en la tarea; en solo lectura, no", () => {
    const { unmount } = show(TASK)
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeTruthy()
    unmount()
    show(TASK, workspaceOf(), { ...editMode, canEdit: false, readOnlyReason: "Esta MIPER es de solo lectura." })
    expect(screen.queryByRole("button", { name: "Seleccionar" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/task-view.test.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

Expected: FAIL en los tests nuevos: no existe el botón «Seleccionar».

- [ ] **Step 3: La casilla al lado de la fila**

En `app/(app)/prevencion/miper/[id]/risk-row.tsx`:

1. Reemplazar:

```tsx
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { CONTROLLED_STATUS_LABEL, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { WorkspaceLink } from "./workspace-nav"
```

por:

```tsx
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { Checkbox } from "@/components/ui/checkbox"
import { CONTROLLED_STATUS_LABEL, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { WorkspaceLink } from "./workspace-nav"
```

2. Reemplazar:

```tsx
    </WorkspaceLink>
  )
}
```

por:

```tsx
    </WorkspaceLink>
  )
}

/**
 * Una fila de riesgo con su casilla de selección (Fase D). La casilla va AL LADO
 * del enlace, nunca dentro: un control dentro de un `<a>` es HTML inválido y su
 * clic abriría el editor. Sin `selection` (fuera del modo «Seleccionar») es la
 * fila de siempre.
 */
export function SelectableRiskRow({ selection, ...row }: Parameters<typeof RiskRow>[0] & { selection: { checked: boolean; onToggle: () => void } | null }) {
  if (!selection) return <RiskRow {...row} />
  const hazard = row.entry.hazard?.trim() || "peligro sin describir"
  return (
    <div className="flex items-center gap-2">
      <Checkbox label={`Seleccionar el riesgo #${row.entry.rowNumber}: ${hazard}`} labelHidden checked={selection.checked} onChange={selection.onToggle} />
      <div className="min-w-0 flex-1"><RiskRow {...row} /></div>
    </div>
  )
}
```

- [ ] **Step 4: La vista de la tarea**

En `app/(app)/prevencion/miper/[id]/task-view.tsx`:

1. Reemplazar:

```tsx
import { hrefToEntry, hrefToMatrix } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { saveMiperEntryAction } from "../actions"
import { RiskRow } from "./risk-row"
import { beforeForwardNavigation, useRestoreWorkspaceScroll } from "./workspace-memory"
import { WorkspaceLink } from "./workspace-nav"

export function TaskView({ matrixId, task, editable, incomplete, observed, changes, issuesByEntry }: {
  matrixId: string
  task: TaskNode
  editable: boolean
```

por:

```tsx
import { hrefToEntry, hrefToMatrix } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { saveMiperEntryAction } from "../actions"
import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"
import { SelectableRiskRow } from "./risk-row"
import { useRiskSelection } from "./use-risk-selection"
import { beforeForwardNavigation, useRestoreWorkspaceScroll } from "./workspace-memory"
import { WorkspaceLink } from "./workspace-nav"

export function TaskView({ matrixId, task, editable, incomplete, observed, changes, issuesByEntry, bulk }: {
  matrixId: string
  task: TaskNode
  editable: boolean
```

2. Reemplazar:

```tsx
  observed: ReadonlySet<string>
  changes: Map<string, EntryChange>
  issuesByEntry: Map<string, CompletenessIssue[]>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  // Al volver del editor, la tarea retoma su scroll (lo guarda `navigateWorkspace` al salir).
  useRestoreWorkspaceScroll()
```

por:

```tsx
  observed: ReadonlySet<string>
  changes: Map<string, EntryChange>
  issuesByEntry: Map<string, CompletenessIssue[]>
  /** Acciones masivas (Fase D): sólo con edición. Sin esto no hay «Seleccionar». */
  bulk?: BulkContext
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  const selection = useRiskSelection(task.entries)
  // Al volver del editor, la tarea retoma su scroll (lo guarda `navigateWorkspace` al salir).
  useRestoreWorkspaceScroll()
```

3. Reemplazar:

```tsx
          <h2 className="text-xl font-semibold">{task.label}</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">{task.activity ?? "Sin actividad"}</p>
        </div>
        {editable && <Button onClick={() => { void addHazard() }} loading={adding}>Agregar peligro</Button>}
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map(([label, value]) => (
```

por:

```tsx
          <h2 className="text-xl font-semibold">{task.label}</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">{task.activity ?? "Sin actividad"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bulk && task.entries.length > 0 && (
            <Button variant="secondary" onClick={selection.selecting ? selection.stop : selection.start}>{selection.selecting ? "Terminar selección" : "Seleccionar"}</Button>
          )}
          {editable && <Button onClick={() => { void addHazard() }} loading={adding}>Agregar peligro</Button>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map(([label, value]) => (
```

4. Reemplazar:

```tsx
        ))}
      </dl>
      <section aria-labelledby="miper-task-risks" className="space-y-2">
        <h3 id="miper-task-risks" className="text-sm font-semibold">Peligros identificados ({task.entries.length})</h3>
        {task.entries.length === 0
          ? <EmptyState compact title="Esta tarea no tiene riesgos" description="Agrega el primer peligro de la tarea para evaluarlo." action={editable ? <Button onClick={() => { void addHazard() }} loading={adding}>Agregar peligro</Button> : undefined} />
          : (
            <ul className="space-y-2">
              {task.entries.map((entry) => (
                <li key={entry.id}>
                  <RiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} issueCount={incomplete.has(entry.id) ? errorCount(entry.id) : 0}
                    observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1} />
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
```

por:

```tsx
        ))}
      </dl>
      <section aria-labelledby="miper-task-risks" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="miper-task-risks" className="text-sm font-semibold">Peligros identificados ({task.entries.length})</h3>
          {selection.selecting && <Button size="sm" variant="ghost" onClick={selection.selectAll}>Seleccionar los {task.entries.length} riesgos</Button>}
        </div>
        {task.entries.length === 0
          ? <EmptyState compact title="Esta tarea no tiene riesgos" description="Agrega el primer peligro de la tarea para evaluarlo." action={editable ? <Button onClick={() => { void addHazard() }} loading={adding}>Agregar peligro</Button> : undefined} />
          : (
            <ul className="space-y-2">
              {task.entries.map((entry) => (
                <li key={entry.id}>
                  <SelectableRiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} issueCount={incomplete.has(entry.id) ? errorCount(entry.id) : 0}
                    observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1}
                    selection={selection.selecting ? { checked: selection.isSelected(entry.id), onToggle: () => selection.toggle(entry.id) } : null} />
                </li>
              ))}
            </ul>
          )}
      </section>
      {bulk && selection.selecting && <BulkBar selected={selection.selected} context={bulk} onClear={selection.clear} />}
    </div>
  )
}
```

- [ ] **Step 5: La matriz filtrada**

En `app/(app)/prevencion/miper/[id]/activity-section.tsx`:

1. Reemplazar:

```tsx
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { RiskRow } from "./risk-row"
import { WorkspaceLink } from "./workspace-nav"

function Counts({ counts }: { counts: ClassificationCounts }) {
```

por:

```tsx
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { SelectableRiskRow } from "./risk-row"
import type { RiskSelection } from "./use-risk-selection"
import { WorkspaceLink } from "./workspace-nav"

function Counts({ counts }: { counts: ClassificationCounts }) {
```

2. Reemplazar:

```tsx
  )
}

export function ActivitySection({ activity, expanded, onToggle, filtered, incomplete, observed, changes, issuesByEntry }: {
  activity: ActivityNode; expanded: boolean; onToggle: () => void; filtered: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
}) {
  const pathname = usePathname()
  const params = useSearchParams()
```

por:

```tsx
  )
}

export function ActivitySection({ activity, expanded, onToggle, filtered, incomplete, observed, changes, issuesByEntry, selection = null }: {
  activity: ActivityNode; expanded: boolean; onToggle: () => void; filtered: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
  /** Modo «Seleccionar» de la vista filtrada (Fase D): una casilla al lado de cada riesgo. */
  selection?: RiskSelection | null
}) {
  const pathname = usePathname()
  const params = useSearchParams()
```

3. Reemplazar:

```tsx
                <ul className="space-y-2 pl-3">
                  {task.matching.map((entry) => (
                    <li key={entry.id}>
                      <RiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1}
                        issueCount={incomplete.has(entry.id) ? (issuesByEntry.get(entry.id) ?? []).filter((issue) => issue.severity === "error").length : 0} />
                    </li>
                  ))}
                </ul>
```

por:

```tsx
                <ul className="space-y-2 pl-3">
                  {task.matching.map((entry) => (
                    <li key={entry.id}>
                      <SelectableRiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1}
                        issueCount={incomplete.has(entry.id) ? (issuesByEntry.get(entry.id) ?? []).filter((issue) => issue.severity === "error").length : 0}
                        selection={selection ? { checked: selection.isSelected(entry.id), onToggle: () => selection.toggle(entry.id) } : null} />
                    </li>
                  ))}
                </ul>
```

En `app/(app)/prevencion/miper/[id]/matrix-view.tsx` (quitar los filtros termina la selección con el
patrón de «guardar información de renders anteriores» que ya usa `use-rows-from-source.ts`, sin
efecto):

1. Reemplazar:

```tsx
"use client"

import { useLayoutEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { ActivitySection } from "./activity-section"
import { readCollapsedActivities, useRestoreWorkspaceScroll, writeCollapsedActivities } from "./workspace-memory"

export function MatrixView({ matrixId, tree, filtered, editable, incomplete, observed, changes, issuesByEntry, onNewTask, onClearFilters, toolbar }: {
  matrixId: string
  tree: ActivityNode[]; filtered: boolean; editable: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
```

por:

```tsx
"use client"

import { useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { ActivitySection } from "./activity-section"
import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"
import { useRiskSelection } from "./use-risk-selection"
import { readCollapsedActivities, useRestoreWorkspaceScroll, writeCollapsedActivities } from "./workspace-memory"

export function MatrixView({ matrixId, tree, filtered, editable, incomplete, observed, changes, issuesByEntry, onNewTask, onClearFilters, toolbar, bulk }: {
  matrixId: string
  tree: ActivityNode[]; filtered: boolean; editable: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
```

2. Reemplazar:

```tsx
  onClearFilters: () => void
  /** La barra de filtros la arma el workspace (necesita la URL); queda como ranura para probar la vista sin ella. */
  toolbar?: (state: { collapsedAll: boolean; toggleAll: () => void; filtered: boolean }) => ReactNode
}) {
  // Abrir una tarea desmonta la matriz: lo plegado se recuerda por matriz en
  // `sessionStorage`. Se lee en un efecto de layout —antes de pintar, sin
```

por:

```tsx
  onClearFilters: () => void
  /** La barra de filtros la arma el workspace (necesita la URL); queda como ranura para probar la vista sin ella. */
  toolbar?: (state: { collapsedAll: boolean; toggleAll: () => void; filtered: boolean }) => ReactNode
  /** Acciones masivas (Fase D): sólo con edición, y sólo con filtros, que es cuando la matriz lista riesgos. */
  bulk?: BulkContext
}) {
  // Abrir una tarea desmonta la matriz: lo plegado se recuerda por matriz en
  // `sessionStorage`. Se lee en un efecto de layout —antes de pintar, sin
```

3. Reemplazar:

```tsx
  const collapsedAll = tree.length > 0 && tree.every((activity) => collapsed.has(activity.key))
  const toggleAll = () => update(collapsedAll ? new Set() : new Set(tree.map((activity) => activity.key)))
  const toggle = (key: string) => { const next = new Set(collapsed); if (next.has(key)) next.delete(key); else next.add(key); update(next) }
  return (
    <div className="space-y-3">
      {toolbar?.({ collapsedAll, toggleAll, filtered })}
      {tree.length === 0 ? (
        filtered
          // La barra ya ofrece «Limpiar filtros»: el CTA del vacío dice lo que logra, no repite el nombre (QA A2, fila 6).
```

por:

```tsx
  const collapsedAll = tree.length > 0 && tree.every((activity) => collapsed.has(activity.key))
  const toggleAll = () => update(collapsedAll ? new Set() : new Set(tree.map((activity) => activity.key)))
  const toggle = (key: string) => { const next = new Set(collapsed); if (next.has(key)) next.delete(key); else next.add(key); update(next) }
  // Con filtros la matriz lista los riesgos que coinciden: son los que se pueden seleccionar (Fase D).
  const matching = useMemo(() => (filtered ? tree.flatMap((activity) => activity.tasks.flatMap((task) => task.matching)) : []), [filtered, tree])
  const selection = useRiskSelection(matching)
  // Quitar los filtros termina la selección: la estructura no lista riesgos (patrón de `useRowsFromSource`).
  const [wasFiltered, setWasFiltered] = useState(filtered)
  if (wasFiltered !== filtered) {
    setWasFiltered(filtered)
    if (!filtered) selection.stop()
  }
  const selecting = Boolean(bulk) && filtered && selection.selecting
  return (
    <div className="space-y-3">
      {toolbar?.({ collapsedAll, toggleAll, filtered })}
      {bulk && filtered && matching.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={selecting ? selection.stop : selection.start}>{selecting ? "Terminar selección" : "Seleccionar"}</Button>
          {selecting && <Button size="sm" variant="ghost" onClick={selection.selectAll}>Seleccionar los {matching.length} resultados</Button>}
        </div>
      )}
      {tree.length === 0 ? (
        filtered
          // La barra ya ofrece «Limpiar filtros»: el CTA del vacío dice lo que logra, no repite el nombre (QA A2, fila 6).
```

4. Reemplazar:

```tsx
          : <EmptyState title="Esta MIPER todavía no tiene riesgos" description="Empieza por una tarea: indica la actividad, la tarea y el puesto, y después sus peligros." action={editable ? <Button onClick={onNewTask}>Nueva tarea</Button> : undefined} />
      ) : tree.map((activity) => (
        <ActivitySection key={activity.key} activity={activity} expanded={filtered || !collapsed.has(activity.key)} onToggle={() => toggle(activity.key)}
          filtered={filtered} incomplete={incomplete} observed={observed} changes={changes} issuesByEntry={issuesByEntry} />
      ))}
    </div>
  )
}
```

por:

```tsx
          : <EmptyState title="Esta MIPER todavía no tiene riesgos" description="Empieza por una tarea: indica la actividad, la tarea y el puesto, y después sus peligros." action={editable ? <Button onClick={onNewTask}>Nueva tarea</Button> : undefined} />
      ) : tree.map((activity) => (
        <ActivitySection key={activity.key} activity={activity} expanded={filtered || !collapsed.has(activity.key)} onToggle={() => toggle(activity.key)}
          filtered={filtered} incomplete={incomplete} observed={observed} changes={changes} issuesByEntry={issuesByEntry} selection={selecting ? selection : null} />
      ))}
      {bulk && selecting && <BulkBar selected={selection.selected} context={bulk} onClear={selection.clear} />}
    </div>
  )
}
```

- [ ] **Step 6: El espacio de trabajo reparte el contexto del lote**

En `app/(app)/prevencion/miper/[id]/miper-workspace.tsx`:

1. Reemplazar:

```tsx
import { TaskView } from "./task-view"
import { useEntryAutosave } from "./use-entry-autosave"
import { useRowsFromSource } from "./use-rows-from-source"
import { WorkflowBar } from "./workflow-bar"
import { WorksiteSwitcher } from "./worksite-switcher"
import { navigateWorkspace, WorkspaceLink } from "./workspace-nav"
```

por:

```tsx
import { TaskView } from "./task-view"
import { useEntryAutosave } from "./use-entry-autosave"
import { useRowsFromSource } from "./use-rows-from-source"
import type { BulkContext } from "./bulk-shared"
import { WorkflowBar } from "./workflow-bar"
import { WorksiteSwitcher } from "./worksite-switcher"
import { navigateWorkspace, WorkspaceLink } from "./workspace-nav"
```

2. Reemplazar:

```tsx
  useEffect(() => { knownVersionOf.current = autosave.versionOf }, [autosave.versionOf])
  const editable = mode.canEdit && !reviewing
  const [newTaskOpen, setNewTaskOpen] = useState(false)

  const incomplete = useMemo(() => new Set([...entryIssues].filter(([, list]) => list.some((issue) => issue.severity === "error")).map(([entryId]) => entryId)), [entryIssues])
  const modified = useMemo(() => new Set([...changes.values()].filter((change) => change.kind !== "removed").map((change) => change.entryId)), [changes])
```

por:

```tsx
  useEffect(() => { knownVersionOf.current = autosave.versionOf }, [autosave.versionOf])
  const editable = mode.canEdit && !reviewing
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  // Acciones masivas (Fase D): sólo quien edita, sobre lo vivo. Las versiones las lleva el guardado automático.
  const bulk: BulkContext | undefined = editable ? {
    matrixId: workspace.matrix.id, sync: autosave, setRows, riskFactors: workspace.riskFactors, responsibleOptions: workspace.responsibleOptions,
    measureSuggestions: workspace.dictionaries.measures, dictionaries: workspace.dictionaries, controlVersions: workspace.controlVersions,
  } : undefined

  const incomplete = useMemo(() => new Set([...entryIssues].filter(([, list]) => list.some((issue) => issue.severity === "error")).map(([entryId]) => entryId)), [entryIssues])
  const modified = useMemo(() => new Set([...changes.values()].filter((change) => change.kind !== "removed").map((change) => change.entryId)), [changes])
```

3. Reemplazar:

```tsx
                data={{ matrixId: workspace.matrix.id, published: workspace.matrix.status === "published", riskFactors: workspace.riskFactors, dictionaries: workspace.dictionaries, responsibleOptions: workspace.responsibleOptions, controlVersions: workspace.controlVersions, controlActionLinks: workspace.controlActionLinks, observations: workspace.observations }} />
            ) : view.taskKey ? (
              task
                ? <TaskView matrixId={workspace.matrix.id} task={task} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues} />
                : <EmptyState title="Esta tarea ya no existe" description="Puede que sus riesgos se hayan movido o eliminado." action={<Button asChild><WorkspaceLink href={hrefToTab(pathname, searchParams, "matriz")} restoreScroll>Volver a la matriz</WorkspaceLink></Button>} />
            ) : (
              <>
```

por:

```tsx
                data={{ matrixId: workspace.matrix.id, published: workspace.matrix.status === "published", riskFactors: workspace.riskFactors, dictionaries: workspace.dictionaries, responsibleOptions: workspace.responsibleOptions, controlVersions: workspace.controlVersions, controlActionLinks: workspace.controlActionLinks, observations: workspace.observations }} />
            ) : view.taskKey ? (
              task
                // `key`: otra tarea (o la misma con otro nombre, tras «Editar contexto») parte sin selección.
                ? <TaskView key={task.key} matrixId={workspace.matrix.id} task={task} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues} bulk={bulk} />
                : <EmptyState title="Esta tarea ya no existe" description="Puede que sus riesgos se hayan movido o eliminado." action={<Button asChild><WorkspaceLink href={hrefToTab(pathname, searchParams, "matriz")} restoreScroll>Volver a la matriz</WorkspaceLink></Button>} />
            ) : (
              <>
```

4. Reemplazar:

```tsx
                  onToggleClassification={(cls) => setFilter("clasificacion", (filters.classifications.includes(cls) ? filters.classifications.filter((item) => item !== cls) : [...filters.classifications, cls]).join(",") || null)}
                  onTogglePending={() => setFilter("completitud", filters.onlyIncomplete ? null : "pendientes")}
                  onToggleUncontrolled={() => setFilter("controlado", filters.controlled === "no" ? null : "no")} />
                <MatrixView matrixId={workspace.matrix.id} tree={tree} filtered={filtered} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues}
                  onNewTask={() => setNewTaskOpen(true)}
                  onClearFilters={() => setFilters(Object.fromEntries(MATRIX_FILTER_KEYS.map((key) => [key, null])))}
                  toolbar={({ collapsedAll, toggleAll, filtered: isFiltered }) => (
```

por:

```tsx
                  onToggleClassification={(cls) => setFilter("clasificacion", (filters.classifications.includes(cls) ? filters.classifications.filter((item) => item !== cls) : [...filters.classifications, cls]).join(",") || null)}
                  onTogglePending={() => setFilter("completitud", filters.onlyIncomplete ? null : "pendientes")}
                  onToggleUncontrolled={() => setFilter("controlado", filters.controlled === "no" ? null : "no")} />
                <MatrixView matrixId={workspace.matrix.id} tree={tree} filtered={filtered} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues} bulk={bulk}
                  onNewTask={() => setNewTaskOpen(true)}
                  onClearFilters={() => setFilters(Object.fromEntries(MATRIX_FILTER_KEYS.map((key) => [key, null])))}
                  toolbar={({ collapsedAll, toggleAll, filtered: isFiltered }) => (
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/task-view.test.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx" "app/(app)/prevencion/miper/[id]/resumen-panel.test.tsx"
```

Expected: PASS.

- [ ] **Step 8: Puertas y commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/risk-row.tsx" "app/(app)/prevencion/miper/[id]/task-view.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx" "app/(app)/prevencion/miper/[id]/activity-section.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
git add "app/(app)/prevencion/miper/[id]/risk-row.tsx" "app/(app)/prevencion/miper/[id]/task-view.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx" "app/(app)/prevencion/miper/[id]/activity-section.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
git commit -m "feat(miper): modo «Seleccionar» en la vista de la tarea y en la matriz filtrada, con la casilla al lado de cada riesgo y la barra de lote" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: «Editar contexto» de la tarea

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/task-context-dialog.tsx`
- Test: `app/(app)/prevencion/miper/[id]/task-context-dialog.test.tsx`
- Modify: `app/(app)/prevencion/miper/[id]/task-view.tsx` (botón «Editar contexto» y el diálogo)
- Test: `app/(app)/prevencion/miper/[id]/task-view.test.tsx` (un test al final)

**Interfaces:**
- Consumes: `bulkPatchMiperEntriesAction` (Task 5); `BulkDialog`, `type BulkContext`, `entryItems`,
  `MISSING_VERSION`, `settlePatchedEntries` (Task 8); `impactSummary`, `newlyIncomplete` (Task 2);
  `taskKeyOf` (`matrix-tree.ts`), `hrefToTask` (`workspace-url.ts`), `navigateWorkspace`
  (`workspace-nav.tsx`).
- Produces:
  - `contextChanges(task: TaskNode, draft: Record<"activity" | "task" | "position" | "location",
    string>): MiperEntryValues` — sólo lo que cambió (nombres comparados normalizados; puesto y lugar
    vacíos se conservan).
  - `TaskContextDialog({ task: TaskNode; context: BulkContext; onOpenChange(open: boolean) })` —
    diálogo «Editar contexto de la tarea» con «Actividad», «Tarea», «Puesto de trabajo», «Lugar
    específico» y «Guardar contexto». Al terminar: anota versiones, cambia las filas en pantalla,
    cierra y, si la clave cambió, `navigateWorkspace(hrefToTask(…, nueva), "replace")`.

**Invariantes de la navegación (spec §3):** se navega con `navigateWorkspace`, que llama a
`beforeForwardNavigation` (guarda el scroll que se deja y olvida el del destino) y usa
`replaceState`: la clave vieja ya no existe, así que «atrás» no debe volver a ella. Las filas se
cambian **antes** de navegar, porque la promesa de la acción se resuelve antes de que llegue la foto
revalidada (ver «Tech Stack»); con la foto vieja, la URL nueva mostraría «Esta tarea ya no existe».

- [ ] **Step 1: Write the failing tests**

Crear `app/(app)/prevencion/miper/[id]/task-context-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildMatrixTree, taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const nav = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams(nav.query) }))
const bulkPatchMiperEntriesAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ bulkPatchMiperEntriesAction }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import type { BulkContext } from "./bulk-shared"
import { contextChanges, TaskContextDialog } from "./task-context-dialog"

const e = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot => ({
  id, rowNumber, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "Choque", probableDamage: "Fracturas",
  probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "no", controls: [], ...overrides,
})
const taskOf = (rows: MiperEntrySnapshot[]) => buildMatrixTree(rows, { incomplete: new Set(), observed: new Set(), modified: new Set(), matching: null })[0]!.tasks[0]!
function context(): BulkContext {
  return {
    matrixId: "m1", sync: { versionOf: (id) => ({ a: 3, b: 1 })[id], whenIdle: vi.fn(async () => {}), acknowledge: vi.fn() }, setRows: vi.fn(), riskFactors: [],
    responsibleOptions: [], measureSuggestions: [], dictionaries: { activities: ["Transporte"], tasks: ["Carga", "Descarga"], positions: [], locations: [] }, controlVersions: {},
  }
}
const type = (label: string, value: string) => {
  const input = screen.getByRole("combobox", { name: label })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

afterEach(() => {
  vi.clearAllMocks()
  nav.query = ""
  window.history.replaceState(null, "", "/")
})

describe("contextChanges", () => {
  const task = taskOf([e("a", 4), e("b", 7, { position: "Peoneta" })])
  it("envía sólo lo que cambió; mayúsculas, tildes y espacios no son un cambio", () => {
    expect(contextChanges(task, { activity: " transporte ", task: "CARGA", position: "", location: "Planta" })).toEqual({})
    expect(contextChanges(task, { activity: "Transporte", task: "Carga de lodo", position: "", location: "" })).toEqual({ task: "Carga de lodo" })
  })
  it("un puesto distinto por riesgo: vacío se conserva y escrito se aplica a todos", () => {
    expect(contextChanges(task, { activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta" })).toEqual({ position: "Conductor" })
  })
})

describe("TaskContextDialog (Fase D)", () => {
  it("prellena la actividad, la tarea y lo común; sin cambios no deja guardar", () => {
    render(<TaskContextDialog task={taskOf([e("a", 4), e("b", 7, { position: "Peoneta" })])} context={context()} onOpenChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Actividad" })).toHaveValue("Transporte")
    expect(screen.getByRole("combobox", { name: "Tarea" })).toHaveValue("Carga")
    expect(screen.getByRole("combobox", { name: "Puesto de trabajo" })).toHaveValue("")
    expect(screen.getByRole("combobox", { name: "Puesto de trabajo" })).toHaveAccessibleDescription("Hoy hay varios: vacío, cada riesgo conserva el suyo.")
    expect(screen.getByRole("combobox", { name: "Lugar específico" })).toHaveValue("Planta")
    expect(screen.getByRole("button", { name: "Guardar contexto" })).toBeDisabled()
  })

  it("renombrar la tarea: envía la versión de cada riesgo, actualiza las filas y navega con replace a la clave nueva", async () => {
    nav.query = `tarea=${taskOf([e("a", 4)]).key}&clasificacion=moderate`
    window.history.replaceState(null, "", `/prevencion/miper/m1?${nav.query}`)
    const length = window.history.length
    const ctx = context()
    const onOpenChange = vi.fn()
    bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, message: "2 riesgos actualizados", data: { entries: [{ id: "a", version: 4 }, { id: "b", version: 2 }] } })
    render(<TaskContextDialog task={taskOf([e("a", 4), e("b", 7)])} context={ctx} onOpenChange={onOpenChange} />)
    type("Tarea", "Carga de lodo")
    fireEvent.click(screen.getByRole("button", { name: "Guardar contexto" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(ctx.sync.whenIdle).toHaveBeenCalledWith(["a", "b"])
    expect(bulkPatchMiperEntriesAction).toHaveBeenCalledWith({ matrixId: "m1", items: [{ entryId: "a", expectedVersion: 3 }, { entryId: "b", expectedVersion: 1 }], values: { task: "Carga de lodo" } })
    expect(ctx.sync.acknowledge).toHaveBeenCalledWith({ a: 4, b: 2 })
    // Las filas cambian en pantalla antes de navegar: la tarea nueva ya existe cuando la URL la pide.
    const rows = vi.mocked(ctx.setRows).mock.calls[0]![0]([e("a", 4), e("z", 9)])
    expect(rows.map((row) => [row.id, row.task])).toEqual([["a", "Carga de lodo"], ["z", "Carga"]])
    const key = taskKeyOf({ activity: "Transporte", task: "Carga de lodo" })
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/prevencion/miper/m1?tarea=${key}&clasificacion=moderate`)
    // Replace, no push: «atrás» no vuelve a la clave vieja, que ya no existe.
    expect(window.history.length).toBe(length)
    expect(toast.success).toHaveBeenCalledWith("Contexto actualizado en 2 riesgos")
  })

  it("renombrar a una tarea que ya existe (otra grafía) la junta con ella: navega a la clave de esa tarea", async () => {
    const onOpenChange = vi.fn()
    bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, data: { entries: [{ id: "a", version: 4 }] } })
    render(<TaskContextDialog task={taskOf([e("a", 4)])} context={context()} onOpenChange={onOpenChange} />)
    type("Tarea", "DESCARGA ")
    fireEvent.click(screen.getByRole("button", { name: "Guardar contexto" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(window.location.search).toBe(`?tarea=${taskKeyOf({ activity: "Transporte", task: "Descarga" })}`)
  })

  it("sólo cambiar el puesto no cambia la clave: no navega", async () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k")
    const onOpenChange = vi.fn()
    bulkPatchMiperEntriesAction.mockResolvedValueOnce({ ok: true, data: { entries: [{ id: "a", version: 4 }] } })
    render(<TaskContextDialog task={taskOf([e("a", 4)])} context={context()} onOpenChange={onOpenChange} />)
    type("Puesto de trabajo", "Operador de grúa")
    fireEvent.click(screen.getByRole("button", { name: "Guardar contexto" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(bulkPatchMiperEntriesAction.mock.calls[0]![0].values).toEqual({ position: "Operador de grúa" })
    expect(window.location.search).toBe("?tarea=k")
  })

  it("más de 300 riesgos: dice por qué y no deja guardar", () => {
    const many = Array.from({ length: 301 }, (_, index) => e(`r${index}`, index + 1))
    render(<TaskContextDialog task={taskOf(many)} context={context()} onOpenChange={vi.fn()} />)
    type("Tarea", "Carga de lodo")
    expect(screen.getByRole("status")).toHaveTextContent("Esta tarea tiene 301 riesgos")
    expect(screen.getByRole("button", { name: "Guardar contexto" })).toBeDisabled()
  })
})
```

En `app/(app)/prevencion/miper/[id]/task-view.test.tsx`:

Reemplazar:

```tsx
    render(<TaskView {...base} editable={false} />)
    expect(screen.queryByRole("button", { name: "Seleccionar" })).toBeNull()
  })
})
```

por:

```tsx
    render(<TaskView {...base} editable={false} />)
    expect(screen.queryByRole("button", { name: "Seleccionar" })).toBeNull()
  })

  it("«Editar contexto» abre el diálogo con la tarea de la vista (Fase D)", () => {
    render(<TaskView {...base} editable bulk={bulk()} />)
    fireEvent.click(screen.getByRole("button", { name: "Editar contexto" }))
    expect(screen.getByRole("dialog", { name: "Editar contexto de la tarea" })).toHaveTextContent("2 riesgos de «Carga»")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/task-context-dialog.test.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx"
```

Expected: FAIL: «Failed to resolve import "./task-context-dialog"», y no existe «Editar contexto».

- [ ] **Step 3: El diálogo**

Crear `app/(app)/prevencion/miper/[id]/task-context-dialog.tsx`:

```tsx
"use client"

import { useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Combobox } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { impactSummary, newlyIncomplete } from "@/lib/prevention/miper/bulk-impact"
import { applyEntryValues } from "@/lib/prevention/miper/entry-values"
import { taskKeyOf, type TaskNode } from "@/lib/prevention/miper/matrix-tree"
import { normalizeMiperName } from "@/lib/prevention/miper/names"
import { hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { countOf } from "@/lib/utils"
import { MIPER_BULK_LIMIT, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { bulkPatchMiperEntriesAction } from "../actions"
import { BulkDialog, type BulkContext, entryItems, MISSING_VERSION, settlePatchedEntries } from "./bulk-shared"
import { navigateWorkspace } from "./workspace-nav"

type ContextField = "activity" | "task" | "position" | "location"
const same = (a: string | null, b: string | null) => normalizeMiperName(a ?? "") === normalizeMiperName(b ?? "")

/** El valor común de los riesgos de la tarea, o `null` si difieren: en el RE-04 una tarea puede tener varios puestos (spec §2.2, D3). */
function shared(task: TaskNode, field: ContextField): string | null {
  const first = task.entries[0]?.[field] ?? null
  return task.entries.every((entry) => same(entry[field], first)) ? first ?? "" : null
}

/**
 * Lo que cambia, y nada más. Actividad y tarea se comparan por nombre
 * normalizado: el diccionario de la faena ya trata «carga» y «Carga» como el
 * mismo nombre. Puesto y lugar vacíos se conservan en cada riesgo.
 */
export function contextChanges(task: TaskNode, draft: Record<ContextField, string>): MiperEntryValues {
  const values: MiperEntryValues = {}
  if (!same(draft.activity, task.activity)) values.activity = draft.activity.trim()
  if (!same(draft.task, task.task)) values.task = draft.task.trim()
  for (const field of ["position", "location"] as const) {
    const common = shared(task, field)
    if (draft[field].trim() && (common === null || !same(draft[field], common))) values[field] = draft[field].trim()
  }
  return values
}

/**
 * «Editar contexto» de una tarea (spec §9, mockup): actividad, tarea, puesto y
 * lugar de TODOS sus riesgos en una operación (`bulkPatchMiperEntries`). Si
 * cambia el nombre, la tarea cambia de clave (`taskKeyOf`): al terminar se
 * navega con REPLACE a la nueva, porque la vieja ya no existe y «atrás» no debe
 * llevar a «Esta tarea ya no existe». Las filas se actualizan en pantalla antes
 * de navegar: la promesa de la acción se resuelve antes de que llegue la foto.
 */
export function TaskContextDialog({ task, context, onOpenChange }: { task: TaskNode; context: BulkContext; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const [draft, setDraft] = useState<Record<ContextField, string>>(() => ({
    activity: task.activity ?? "", task: task.task ?? "", position: shared(task, "position") ?? "", location: shared(task, "location") ?? "",
  }))
  const operation = useOperation()
  const values = contextChanges(task, draft)
  const changed = Object.keys(values).length > 0
  const over = task.entries.length > MIPER_BULK_LIMIT
  const ready = changed && draft.activity.trim() !== "" && draft.task.trim() !== "" && !over
  const impact = changed ? impactSummary(newlyIncomplete(task.entries, task.entries.map((entry) => applyEntryValues(entry, values, context.riskFactors)))) : null
  const apply = () => operation.run(async () => {
    const items = await entryItems(context.sync, task.entries)
    if (!items) return MISSING_VERSION
    return bulkPatchMiperEntriesAction({ matrixId: context.matrixId, items, values })
  }, (result) => {
    settlePatchedEntries(context, result.data, values)
    toast.success(`Contexto actualizado en ${countOf(task.entries.length, "riesgo", "riesgos")}`)
    onOpenChange(false)
    const nextKey = taskKeyOf({ activity: values.activity ?? task.activity, task: values.task ?? task.task })
    if (nextKey !== task.key) navigateWorkspace(hrefToTask(pathname, params, nextKey), "replace")
  })
  const field = (key: ContextField, label: string, list: keyof BulkContext["dictionaries"], required: boolean) => (
    <Field label={label} htmlFor={`miper-context-${key}`} required={required}
      helper={required ? undefined : shared(task, key) === null ? "Hoy hay varios: vacío, cada riesgo conserva el suyo." : "Vacío, cada riesgo conserva el suyo."}>
      <Combobox id={`miper-context-${key}`} allowCustomValue options={context.dictionaries[list].map((value) => ({ value, label: value }))} value={draft[key]}
        disabled={operation.pending} placeholder={shared(task, key) === null ? "Varios" : "Escribe o elige…"} onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} />
    </Field>
  )
  return (
    <BulkDialog open onOpenChange={onOpenChange} title="Editar contexto de la tarea"
      description={`Cambia la actividad, la tarea, el puesto o el lugar de ${countOf(task.entries.length, "riesgo", "riesgos")} de «${task.label}». La evaluación y las medidas de cada riesgo no cambian.`}
      impact={impact} error={operation.message} busy={operation.pending} confirmLabel="Guardar contexto" confirmDisabled={!ready} onConfirm={apply}>
      <div className="grid gap-3 md:grid-cols-2">
        {field("activity", "Actividad", "activities", true)}
        {field("task", "Tarea", "tasks", true)}
        {field("position", "Puesto de trabajo", "positions", false)}
        {field("location", "Lugar específico", "locations", false)}
      </div>
      {over && <p role="status" className="text-sm text-[var(--color-warning-ink)]">Esta tarea tiene {task.entries.length} riesgos: el contexto se cambia de a {MIPER_BULK_LIMIT} como máximo. Muévelos por partes desde la matriz filtrada.</p>}
    </BulkDialog>
  )
}
```

- [ ] **Step 4: El botón en la vista de la tarea**

En `app/(app)/prevencion/miper/[id]/task-view.tsx`:

1. Reemplazar:

```tsx
import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"
import { SelectableRiskRow } from "./risk-row"
import { useRiskSelection } from "./use-risk-selection"
import { beforeForwardNavigation, useRestoreWorkspaceScroll } from "./workspace-memory"
import { WorkspaceLink } from "./workspace-nav"
```

por:

```tsx
import { BulkBar } from "./bulk-bar"
import type { BulkContext } from "./bulk-shared"
import { SelectableRiskRow } from "./risk-row"
import { TaskContextDialog } from "./task-context-dialog"
import { useRiskSelection } from "./use-risk-selection"
import { beforeForwardNavigation, useRestoreWorkspaceScroll } from "./workspace-memory"
import { WorkspaceLink } from "./workspace-nav"
```

2. Reemplazar:

```tsx
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  const selection = useRiskSelection(task.entries)
  // Al volver del editor, la tarea retoma su scroll (lo guarda `navigateWorkspace` al salir).
  useRestoreWorkspaceScroll()
```

por:

```tsx
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  const selection = useRiskSelection(task.entries)
  const [editingContext, setEditingContext] = useState(false)
  // Al volver del editor, la tarea retoma su scroll (lo guarda `navigateWorkspace` al salir).
  useRestoreWorkspaceScroll()
```

3. Reemplazar:

```tsx
          <p className="text-sm text-[var(--color-text-subtle)]">{task.activity ?? "Sin actividad"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bulk && task.entries.length > 0 && (
            <Button variant="secondary" onClick={selection.selecting ? selection.stop : selection.start}>{selection.selecting ? "Terminar selección" : "Seleccionar"}</Button>
          )}
```

por:

```tsx
          <p className="text-sm text-[var(--color-text-subtle)]">{task.activity ?? "Sin actividad"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bulk && task.entries.length > 0 && <Button variant="secondary" onClick={() => setEditingContext(true)}>Editar contexto</Button>}
          {bulk && task.entries.length > 0 && (
            <Button variant="secondary" onClick={selection.selecting ? selection.stop : selection.start}>{selection.selecting ? "Terminar selección" : "Seleccionar"}</Button>
          )}
```

4. Reemplazar:

```tsx
          )}
      </section>
      {bulk && selection.selecting && <BulkBar selected={selection.selected} context={bulk} onClear={selection.clear} />}
    </div>
  )
}
```

por:

```tsx
          )}
      </section>
      {bulk && selection.selecting && <BulkBar selected={selection.selected} context={bulk} onClear={selection.clear} />}
      {bulk && editingContext && <TaskContextDialog task={task} context={bulk} onOpenChange={setEditingContext} />}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:fast -- "app/(app)/prevencion/miper/[id]/task-context-dialog.test.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

Expected: PASS.

- [ ] **Step 6: Puertas y commit**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/task-context-dialog.tsx" "app/(app)/prevencion/miper/[id]/task-context-dialog.test.tsx" "app/(app)/prevencion/miper/[id]/task-view.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx"
git add "app/(app)/prevencion/miper/[id]/task-context-dialog.tsx" "app/(app)/prevencion/miper/[id]/task-context-dialog.test.tsx" "app/(app)/prevencion/miper/[id]/task-view.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx"
git commit -m "feat(miper): «Editar contexto» cambia actividad, tarea, puesto y lugar de toda la tarea y pasa con replace a la tarea nueva" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: E2E de las acciones masivas (desde un worktree)

**Files:**
- Modify: `e2e/setup-db.ts:3234` (después del `insert` de `miperDraftFixtures`)
- Create: `e2e/prevencion-miper-masivas.spec.ts`
- Modify: `e2e/prevencion-miper-importacion.spec.ts:29` (comentario: la faena trae 2035–2040)

**Interfaces:**
- Consumes:
  - los nombres de las Tasks 8-10 (región «Acciones sobre la selección», casillas «Seleccionar el
    riesgo #N: …», botones «Seleccionar», «Seleccionar los N resultados», «Agregar medida a 2»,
    «Agregar a 2», «Cambiar ¿controlado?», «Aplicar a 2», «Editar contexto», «Guardar contexto»;
    diálogos «Agregar una medida a 2 riesgos», «¿Está controlado? en 2 riesgos», «Editar contexto de
    la tarea»);
  - `login`, `expectPageTitle` (`e2e/helpers.ts`); `crearTarea`, `escribir`, `irAPaso`,
    `volverALaTarea` (`e2e/miper-helpers.ts`); `AXE_TAGS`, `AXE_DISABLED_RULES`
    (`e2e/accessibility-targets.ts`);
  - el admin sembrado (`admin@e2e.chome.cl`, alcance global, `prevention:risk:edit`).
- Produces: la evidencia E2E del alcance D (una medida a 2 riesgos y no al tercero; «Cambiar
  ¿controlado?» en la matriz filtrada; renombrar una tarea con «Editar contexto» y `replace`; axe sobre
  la barra y el diálogo).

**Por qué una MIPER sembrada propia:** «Faena Restringida E2E» ya tiene 2035–2039 (`teclado`,
`estructura`, `concurrencia`, la vigente y la reemplazada) y la importación crea 2046/2047. La nueva
`riskmatrix-masivas-e2e` es 2040 con `matrixVersion` 6, y trae una tarea con dos Moderados y un
Tolerable, para que `?clasificacion=moderate` deje justo dos a la vista. La búsqueda no sirve para eso:
«Buscar en la matriz» también mira la tarea, y «solvente» calza con los tres (lo mostró la corrida al
planificar). Lo que el spec escribe lleva el número de reintento.

- [ ] **Step 1: La siembra y el spec**

En `e2e/setup-db.ts`:

Reemplazar:

```ts
  }))
  await db.insert(schema.preventionRiskMatrices).values(miperDraftFixtures)

  /* Una MIPER **reemplazada** con su propia medida: es el tercer caso de la
   * regla `canVerify` —la medida se sigue leyendo, pero de una versión que ya no
   * rige—, y el único de los tres que depende del estado de la MIPER y no del
```

por:

```ts
  }))
  await db.insert(schema.preventionRiskMatrices).values(miperDraftFixtures)

  /* MIPER Fase D (acciones masivas): un borrador propio con una tarea de tres
   * riesgos sembrados, para «Agregar medida a N» y «Cambiar ¿controlado?» de
   * `e2e/prevencion-miper-masivas.spec.ts`. Ningún otro spec lo toca. Período
   * 2040 y `matrixVersion` 6 en `ws-restricted-e2e`: 2035–2039 y 1–5 ya están
   * tomados. Actividad, tarea y puesto van por el diccionario de la faena, como
   * los escribe el editor (`resolveDictionaryId`). */
  await db.insert(schema.preventionRiskMatrices).values({
    id: "riskmatrix-masivas-e2e", worksiteId: "ws-restricted-e2e", matrixVersion: 6, period: 2040,
    title: "MIPER Faena Restringida E2E 2040", status: "draft", reviewState: "none", isLegacy: false,
    methodologyId: "riskmethod-e2e", methodologySnapshot: {},
    revisionReason: "Fixture E2E de las acciones masivas de la MIPER.",
    participationSummary: "Participación del comité de fixture E2E para las pruebas.",
    consultationEvidenceReference: "Acta de consulta de fixture E2E",
    createdByUserId: "user-admin-e2e", version: 1, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionRiskProcesses).values({
    id: "riskproc-masivas-e2e", worksiteId: "ws-restricted-e2e", code: "A-MASIVAS", name: "Bodega de químicos", normalizedName: "bodega de quimicos",
    isActive: true, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionRiskTasks).values({
    id: "risktask-masivas-e2e", worksiteId: "ws-restricted-e2e", processId: null, code: "T-MASIVAS", name: "Trasvasije de solventes", normalizedName: "trasvasije de solventes",
    isRoutine: true, isActive: true, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionRiskPositions).values({
    id: "riskpos-masivas-e2e", worksiteId: "ws-restricted-e2e", taskId: null, code: "P-MASIVAS", name: "Bodeguero", normalizedName: "bodeguero",
    isActive: true, createdAt: now, updatedAt: now,
  })
  // Dos Moderados y un Tolerable: `?clasificacion=moderate` deja a la vista justo dos.
  await db.insert(schema.preventionRiskEntries).values(([
    ["Derrame de solvente", "Contacto con la piel", "Dermatitis", 2],
    ["Vapores de solvente", "Inhalación", "Intoxicación", 2],
    ["Tambor en altura", "Caída de objetos", "Contusiones", 1],
  ] as const).map(([hazard, risk, probableDamage, probability], index) => ({
    id: `riskentry-masivas-e2e-${index + 1}`, matrixId: "riskmatrix-masivas-e2e", rowNumber: index + 1, hazardCode: `HAZ-MASIVAS-${index + 1}`,
    processId: "riskproc-masivas-e2e", taskId: "risktask-masivas-e2e", positionId: "riskpos-masivas-e2e",
    hazard, risk, probableDamage, isRoutine: true, exposedFemale: 0, exposedMale: 2, exposedOther: 0,
    probability, consequence: 2, controlledStatus: "no", version: 1, createdAt: now, updatedAt: now,
  })))

  /* Una MIPER **reemplazada** con su propia medida: es el tercer caso de la
   * regla `canVerify` —la medida se sigue leyendo, pero de una versión que ya no
   * rige—, y el único de los tres que depende del estado de la MIPER y no del
```

En `e2e/prevencion-miper-importacion.spec.ts`:

Reemplazar:

```ts
 *
 * Va a «Faena Restringida E2E», período 2046 (2047 en el reintento de CI):
 * ningún otro spec afirma esa fila ni esos períodos, y el sembrado sólo trae
 * 2035–2039 en esa faena.
 */
const FAENA = "Faena Restringida E2E"
```

por:

```ts
 *
 * Va a «Faena Restringida E2E», período 2046 (2047 en el reintento de CI):
 * ningún otro spec afirma esa fila ni esos períodos, y el sembrado sólo trae
 * 2035–2040 en esa faena.
 */
const FAENA = "Faena Restringida E2E"
```

Crear `e2e/prevencion-miper-masivas.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { expectPageTitle, login } from "./helpers"
import { crearTarea, escribir, irAPaso, volverALaTarea } from "./miper-helpers"

/**
 * E2E MIPER — acciones masivas (Fase D, spec §9):
 *   • «Seleccionar» en la vista de una tarea, dos casillas y «Agregar medida a 2»:
 *     la medida queda en esos dos riesgos y no en el tercero, y el historial lo
 *     dice con el motivo «Edición masiva».
 *   • En la matriz filtrada, «Seleccionar los N resultados» y «Cambiar
 *     ¿controlado?».
 *   • «Editar contexto» renombra la tarea de todos sus riesgos y la URL pasa a la
 *     tarea nueva con replace: «atrás» no vuelve a la clave vieja.
 *   • axe sobre la barra de selección y el diálogo de la medida.
 *
 * `riskmatrix-masivas-e2e` (2040, «Faena Restringida E2E») llega con la tarea
 * «Trasvasije de solventes» y tres riesgos sembrados (`e2e/setup-db.ts`): dos
 * Moderados y un Tolerable. Ningún otro spec la toca. Lo que este spec escribe lleva el número de reintento, así
 * un reintento de CI no tropieza con lo que dejó el intento anterior.
 */
const MATRIZ = "/prevencion/miper/riskmatrix-masivas-e2e"
const TAREA = "Trasvasije de solventes"
const riesgo = (page: Page, numero: number, peligro: string) => page.getByRole("link", { name: `Riesgo #${numero}: ${peligro}`, exact: true })

async function auditar(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).disableRules([...AXE_DISABLED_RULES]).include(selector).analyze()
  expect(results.violations).toEqual([])
}

async function abrirTarea(page: Page) {
  await page.goto(MATRIZ)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2040")
  await page.getByRole("link", { name: new RegExp(`^${TAREA}`) }).click()
  await expect(page.getByRole("heading", { level: 2, name: TAREA })).toBeVisible()
}

test("«Agregar medida a 2»: la medida queda en los dos riesgos elegidos, no en el tercero, y el historial dice «Edición masiva»", async ({ page }, testInfo) => {
  const medida = `Bandeja antiderrame bajo el tambor ${testInfo.retry + 1}`
  await login(page)
  await abrirTarea(page)
  // Sin el modo, ninguna casilla: la vista queda liviana.
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await page.getByRole("button", { name: "Seleccionar", exact: true }).click()
  await page.getByRole("checkbox", { name: "Seleccionar el riesgo #1: Derrame de solvente", exact: true }).check()
  await page.getByRole("checkbox", { name: "Seleccionar el riesgo #2: Vapores de solvente", exact: true }).check()
  const barra = page.getByRole("region", { name: "Acciones sobre la selección" })
  await expect(barra).toContainText("2 riesgos seleccionados")
  await auditar(page, '[role="region"][aria-label="Acciones sobre la selección"]')

  await barra.getByRole("button", { name: "Agregar medida a 2", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "Agregar una medida a 2 riesgos" })
  await dialogo.getByRole("radio", { name: "Ya está implementada", exact: true }).click()
  await dialogo.getByLabel("Frecuencia de verificación", { exact: true }).fill("Mensual")
  await dialogo.getByLabel("Descripción de la medida", { exact: true }).fill(medida)
  await dialogo.getByLabel("Nombre o cargo responsable", { exact: true }).fill("Jefe de bodega")
  await auditar(page, '[role="dialog"]')
  await dialogo.getByRole("button", { name: "Agregar a 2", exact: true }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  // Terminó bien: la selección se vació y la barra se fue.
  await expect(barra).toBeHidden()

  const tarjeta = page.getByRole("article", { name: `Medida: ${medida}`, exact: true })
  for (const [numero, peligro] of [[1, "Derrame de solvente"], [2, "Vapores de solvente"]] as const) {
    await riesgo(page, numero, peligro).click()
    await irAPaso(page, "Medidas de control")
    await expect(tarjeta).toContainText("Existente · verificación Mensual")
    await expect(tarjeta).toContainText("Responsable: Jefe de bodega")
    await volverALaTarea(page)
  }
  await riesgo(page, 3, "Tambor en altura").click()
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("heading", { level: 3, name: /^Medidas de control/ })).toBeVisible()
  await expect(tarjeta).toHaveCount(0)

  // Una entrada por riesgo, con el motivo de la acción masiva (un reintento de CI puede sumar las de su intento).
  await page.goto(`${MATRIZ}?tab=historial`)
  const entradas = page.getByRole("listitem").filter({ hasText: "Medida agregada" }).filter({ hasText: "Edición masiva" })
  await expect(entradas.first()).toBeVisible()
  expect(await entradas.count()).toBeGreaterThanOrEqual(2)
})

test("en la matriz filtrada, «Seleccionar los N resultados» y «Cambiar ¿controlado?» cambian todos los que coinciden", async ({ page }) => {
  await login(page)
  // Los dos Moderados de la tarea; el tercero es Tolerable y queda fuera del filtro.
  await page.goto(`${MATRIZ}?clasificacion=moderate`)
  await expect(riesgo(page, 1, "Derrame de solvente")).toBeVisible()
  await expect(riesgo(page, 3, "Tambor en altura")).toHaveCount(0)
  await page.getByRole("button", { name: "Seleccionar", exact: true }).click()
  await page.getByRole("button", { name: "Seleccionar los 2 resultados", exact: true }).click()
  const barra = page.getByRole("region", { name: "Acciones sobre la selección" })
  await expect(barra).toContainText("2 riesgos seleccionados")
  await barra.getByRole("button", { name: "Cambiar ¿controlado?", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "¿Está controlado? en 2 riesgos" })
  await dialogo.getByRole("radio", { name: "Parcialmente", exact: true }).click()
  await dialogo.getByRole("button", { name: "Aplicar a 2", exact: true }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  await expect(riesgo(page, 1, "Derrame de solvente")).toContainText("Controlado: Parcialmente")
  await expect(riesgo(page, 2, "Vapores de solvente")).toContainText("Controlado: Parcialmente")
  // Lo guardado, no sólo la pantalla; y el que no estaba a la vista no cambió.
  await page.goto(`${MATRIZ}?buscar=tambor`)
  await expect(riesgo(page, 3, "Tambor en altura")).toContainText("Controlado: No")
  await page.goto(`${MATRIZ}?clasificacion=moderate`)
  await expect(riesgo(page, 2, "Vapores de solvente")).toContainText("Controlado: Parcialmente")
})

test("«Editar contexto» renombra la tarea de todos sus riesgos; la URL pasa a la tarea nueva sin dejar la vieja en el historial", async ({ page }, testInfo) => {
  const actividad = `Mantención de grúa ${testInfo.retry + 1}`
  await login(page)
  await page.goto(MATRIZ)
  await crearTarea(page, { actividad, tarea: "Cambio de cable", puesto: "Mecánico", peligro: "Cable cortado" })
  await volverALaTarea(page)
  await page.getByRole("button", { name: "Agregar peligro", exact: true }).click()
  await expect(page).toHaveURL(/paso=identificacion/)
  await volverALaTarea(page)
  await expect(page.getByRole("heading", { level: 2, name: "Cambio de cable" })).toBeVisible()
  const antes = new URL(page.url()).searchParams.get("tarea")

  await page.getByRole("button", { name: "Editar contexto", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "Editar contexto de la tarea" })
  await expect(dialogo).toContainText("2 riesgos de «Cambio de cable»")
  await escribir(dialogo, "Tarea", "Cambio de cable de izaje")
  await dialogo.getByRole("button", { name: "Guardar contexto", exact: true }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole("heading", { level: 2, name: "Cambio de cable de izaje" })).toBeVisible()
  const despues = new URL(page.url()).searchParams.get("tarea")
  expect(despues).not.toBeNull()
  expect(despues).not.toBe(antes)
  await expect(page.getByRole("link", { name: /^Riesgo #\d+: Cable cortado$/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /^Riesgo #\d+: peligro sin describir$/ })).toBeVisible()
  await expect(page.getByText("Esta tarea ya no existe")).toHaveCount(0)

  // Replace: «atrás» no vuelve a la clave vieja (con push, mostraría «Esta tarea ya no existe»).
  await page.goBack()
  await expect(page).not.toHaveURL(new RegExp(`tarea=${antes}(&|$)`))
  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`tarea=${despues}(&|$)`))
  // Lo guardado: al recargar, la tarea nueva sigue con sus dos riesgos.
  await page.reload()
  await expect(page.getByRole("heading", { level: 2, name: "Cambio de cable de izaje" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 3, name: "Peligros identificados (2)" })).toBeVisible()
})
```

- [ ] **Step 2: Puertas sin navegador y commit**

```bash
npm run typecheck
npm run lint -- e2e/setup-db.ts e2e/prevencion-miper-masivas.spec.ts e2e/prevencion-miper-importacion.spec.ts
git add e2e/setup-db.ts e2e/prevencion-miper-masivas.spec.ts e2e/prevencion-miper-importacion.spec.ts
git commit -m "test(miper): E2E de las acciones masivas: medida a 2 riesgos, ¿controlado? en la matriz filtrada y «Editar contexto» con replace" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Primero el commit, porque el worktree sólo ve lo commiteado.

- [ ] **Step 3: Correr las E2E desde un worktree**

Con la receta de Global Constraints, en este orden y de a un spec. Desde la segunda corrida va
`E2E_SKIP_BUILD=true`:

1. `npm run test:e2e -- e2e/prevencion-miper-masivas.spec.ts` (construye)
2. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-interacciones.spec.ts`: el formulario
   de la medida (Task 7), la tarea y el editor (Task 9).
3. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-flujo.spec.ts`: `agregarMedida` y el
   envío a revisión.
4. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-matriz.spec.ts`: la portada, con la
   fila de «Faena Restringida E2E» que ahora tiene 2040.
5. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-importacion.spec.ts`
6. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-escenario.spec.ts`
7. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/accessibility.spec.ts -g "MIPER|miper"`

Expected: todo PASS.
- Anotar el conteo por spec para el informe (Task 12).
- Si una falla: abrir el trace, buscar la causa y arreglarla en un commit `fix(miper): …`. Después,
  worktree nuevo desde el HEAD nuevo y repetir **ese** spec.
- Si «Editar contexto» muestra «Esta tarea ya no existe» o «atrás» vuelve a la clave vieja, el
  problema está en el orden filas → navegación de la Task 10 (ver «Tech Stack»), no en el
  localizador.

---

### Task 12: Manual, spec §9, puertas completas y recorrido de sólo lectura con informe QA

**Files:**
- Modify: `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md` (§5: una
  subsección nueva antes de «### En el celular», línea 238)
- Modify: `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` (línea 3, y al final de
  §9, antes de «## 10. Fase E», línea 575)
- Create: `qa/reports/2026-10-03-miper-d.md`. Si la verificación se hace otro día, se usa la fecha real
  en el nombre (`AAAA-MM-DD`).
- Temporal, **nunca se commitea**: `qa-d-lectura.mjs` en la raíz del checkout, borrado al terminar el
  Step 3.

**Interfaces:**
- Consumes: las tareas 1–11 ya commiteadas y los conteos E2E de la Task 11; los nombres de las Tasks
  8–10; la MIPER «Oficina Central 2099» de `bodega_dev` (`riskmatrix-7fJbp_csGgyQu8qUbYbiC`, 222
  riesgos, la misma del informe C).
- Produces: el manual y la spec al día, y la evidencia de la fase.

**Reglas del recorrido (además de las de Global Constraints):**
- En `bodega_dev` **nada se escribe**: se abren los diálogos de lote y se **cancelan**. Nunca «Agregar
  a N», «Aplicar a N», «Aplicar a N medidas» ni «Guardar contexto». Lo que escribe ya quedó probado en
  PGlite y en la base E2E desechable (Tasks 4 y 11).
- La sonda registra toda Server Function (`POST` con cabecera `next-action`): la esperada es ninguna.
  Una MIPER con ronda abierta dispararía `openMiperRoundAction` para un revisor; por eso el Step 2
  comprueba antes que la elegida no tiene ronda abierta.
- Los recuentos de antes y de después tienen que coincidir.
- Capturas a `/tmp/claude-1000/-home-allopze-dev-chome-bodega/10960f9d-1cca-4584-a80d-a04d7f759f0b/scratchpad/qa-d/`.

- [ ] **Step 1: Puertas completas**

```bash
npm run typecheck && npm run lint && npm run test:fast && npm run check:secrets && npm run doctor
npm run test:pglite -- lib/__tests__/miper-bulk.test.ts
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
npm run test:pglite -- lib/__tests__/miper-import.test.ts
npm run test:pglite -- lib/__tests__/miper-matrices.test.ts
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
npm run test:pglite -- lib/__tests__/miper-portfolio.test.ts
npm run test:pglite -- lib/__tests__/miper-workflow.test.ts
npm run test:pglite -- lib/__tests__/miper-work-queue.test.ts
```

Expected: verde.
- `db:verify-migrations` no aplica: no hay migración.
- Anotar en el informe los conteos de `test:fast` (archivos y pruebas) y los de PGlite. Los
  `test:pglite` van de a uno.
- `npm run doctor` sólo da advertencias. Las de los archivos nuevos son de las mismas reglas que ya
  marcan archivos vecinos (`only-export-components`, `no-high-complexity-react-function`,
  `async-await-in-loop` en los bucles del historial); se anotan, no se persiguen.

- [ ] **Step 2: Antes del recorrido: migraciones, ronda abierta y recuentos de `bodega_dev`**

```bash
cd /home/allopze/dev/chome/bodega
DEV_DB=$(node -e 'const { loadEnvConfig } = require("@next/env"); loadEnvConfig(process.cwd(), true, { info() {}, error() {} }); process.stdout.write(process.env.DATABASE_URL)')
case "$DEV_DB" in *:5433/*) ;; *) echo "No es bodega_dev (:5433): no se sigue"; exit 1;; esac
psql "$DEV_DB" -At -c "BEGIN READ ONLY; SELECT count(*), max(created_at) FROM drizzle.__drizzle_migrations; ROLLBACK;"
node -e 'const j = require("./db/migrations/meta/_journal.json"); console.log(j.entries.length, j.entries.at(-1).when)'
MIPER_ID=riskmatrix-7fJbp_csGgyQu8qUbYbiC
# Sin ronda abierta: si no, abrir la MIPER como revisor escribiría la apertura (openMiperRoundAction).
psql "$DEV_DB" -At -c "BEGIN READ ONLY; SELECT status, review_state, (SELECT count(*) FROM prevention_risk_review_rounds r WHERE r.matrix_id = m.id AND r.decision IS NULL) FROM prevention_risk_matrices m WHERE m.id = '$MIPER_ID'; ROLLBACK;"
cat > /tmp/qa-d-recuento.sql <<'SQL'
BEGIN READ ONLY;
SELECT 'matrices', count(*) FROM prevention_risk_matrices
UNION ALL SELECT 'entries', count(*) FROM prevention_risk_entries
UNION ALL SELECT 'controls', count(*) FROM prevention_risk_controls
UNION ALL SELECT 'processes', count(*) FROM prevention_risk_processes
UNION ALL SELECT 'tasks', count(*) FROM prevention_risk_tasks
UNION ALL SELECT 'audit_log', count(*) FROM audit_log;
SELECT 'md5 entries', md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM prevention_risk_entries t;
SELECT 'md5 controls', md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM prevention_risk_controls t;
ROLLBACK;
SQL
psql "$DEV_DB" -At -f /tmp/qa-d-recuento.sql | grep -v '^BEGIN$\|^ROLLBACK$' > /tmp/qa-d-antes.txt
mkdir -p /tmp/claude-1000/-home-allopze-dev-chome-bodega/10960f9d-1cca-4584-a80d-a04d7f759f0b/scratchpad/qa-d
```

Criterios para seguir:
- Si el número de migraciones de la base es menor que el del journal, `bodega_dev` está atrasada y el
  shell responde 500: se informa y **no** se migra en esta fase (no es una base que el plan pueda
  tocar).
- Si la consulta de la MIPER devuelve una ronda abierta (tercera columna > 0), se elige otra MIPER en
  borrador de `bodega_dev` sin ronda abierta y se anota cuál.
- Si la sesión QA venció (la sonda lo dice), se regenera sin imprimir nada:
  `node --env-file=.env.qa scripts/qa-login.mjs > /dev/null`. Nunca se commitea `.env.qa` ni
  `playwright/.auth/`.

- [ ] **Step 3: Recorrido de sólo lectura en `bodega_dev` (:3001)**

Crear `qa-d-lectura.mjs` en la raíz y correrlo con
`MIPER_ID=$MIPER_ID SHOTS=/tmp/claude-1000/-home-allopze-dev-chome-bodega/10960f9d-1cca-4584-a80d-a04d7f759f0b/scratchpad/qa-d node qa-d-lectura.mjs`:

```js
// qa-d-lectura.mjs — sonda TEMPORAL y de SÓLO LECTURA (Task 12, Fase D). Va en la raíz para resolver
// @playwright/test. NO se versiona: `rm qa-d-lectura.mjs` al terminar. Abre la selección y los
// diálogos de lote y los CANCELA: nunca aprieta «Agregar a N», «Aplicar a N» ni «Guardar contexto».
// La sesión QA es una credencial: no se imprime nada de ella.
import { chromium } from "@playwright/test"

const BASE = "http://localhost:3001"
const { MIPER_ID, SHOTS } = process.env
const anotar = (caso, valor) => console.log(JSON.stringify({ caso, valor }))
const browser = await chromium.launch()
const context = await browser.newContext({ storageState: "playwright/.auth/monkeytest.json", viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errores = []
const escrituras = []
page.on("console", (message) => { if (message.type() === "error") errores.push(message.text().slice(0, 160)) })
page.on("request", (request) => {
  if (request.method() === "POST" && request.headers()["next-action"]) escrituras.push(new URL(request.url()).pathname + new URL(request.url()).search)
})
const controles = () => page.evaluate(() => document.querySelectorAll(
  "main a[href], main button, main input, main select, main textarea, main [role=checkbox], main [role=radio], main [role=combobox]").length)
const sinScroll = () => page.evaluate(() => {
  const well = document.querySelector("[data-shell-scroll]")
  return document.documentElement.scrollWidth <= innerWidth && (!well || well.scrollWidth <= well.clientWidth)
})
const texto = async (locator) => ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim()

// 1. La estructura: sin filtros no hay «Seleccionar», y sigue bajo 400 controles (spec §13).
await page.goto(`${BASE}/prevencion/miper/${MIPER_ID}`)
if (page.url().includes("/login")) {
  anotar("sesión", "vencida: regenerarla (Step 2) y volver a correr")
  await browser.close()
  process.exit(1)
}
await page.getByRole("tab", { name: /^Matriz/ }).waitFor()
anotar("estructura: controles en <main>", await controles())
anotar("estructura: botones «Seleccionar»", await page.getByRole("button", { name: "Seleccionar", exact: true }).count())

// 2. La matriz filtrada: sin el modo, con el modo, la barra y sus tres diálogos (abiertos y cancelados).
await page.goto(`${BASE}/prevencion/miper/${MIPER_ID}?clasificacion=important`)
await page.getByRole("link", { name: /^Riesgo #\d+:/ }).first().waitFor()
const resultados = await page.getByRole("link", { name: /^Riesgo #\d+:/ }).count()
anotar("filtrada (Importantes): riesgos a la vista", resultados)
anotar("filtrada: controles sin el modo", await controles())
const seleccionar = page.getByRole("button", { name: "Seleccionar", exact: true })
if (await seleccionar.count() === 0) {
  anotar("filtrada: «Seleccionar»", "no aparece: la sesión QA no edita esta MIPER (COVERAGE GAP)")
} else {
  await seleccionar.click()
  anotar("filtrada: controles con el modo", await controles())
  await page.getByRole("button", { name: `Seleccionar los ${resultados} resultados`, exact: true }).click()
  const barra = page.getByRole("region", { name: "Acciones sobre la selección" })
  anotar("barra: texto", await texto(barra))
  await page.screenshot({ path: `${SHOTS}/d-barra-1440.png` })
  const dialogos = [
    ["Cambiar ¿controlado?", /^¿Está controlado\? en /, "controlado"],
    ["Asignar responsable / plazo", /^Responsable y plazo de las medidas de /, "responsable-plazo"],
    [/^Agregar medida a \d+$/, /^Agregar una medida a /, "agregar-medida"],
  ]
  for (const [boton, nombre, archivo] of dialogos) {
    const disparador = barra.getByRole("button", { name: boton })
    if (await disparador.isDisabled()) { anotar(`barra: ${archivo}`, "deshabilitado (más de 300)"); continue }
    await disparador.click()
    const dialogo = page.getByRole("dialog", { name: nombre })
    await dialogo.waitFor()
    anotar(`diálogo ${archivo}: texto`, (await texto(dialogo)).slice(0, 400))
    await page.screenshot({ path: `${SHOTS}/d-dialogo-${archivo}.png` })
    await dialogo.getByRole("button", { name: "Cancelar", exact: true }).click()
    await dialogo.waitFor({ state: "hidden" })
  }
  // 390×844: con la barra a la vista, ni la página ni el pozo dan scroll horizontal.
  await page.setViewportSize({ width: 390, height: 844 })
  anotar("390: sin scroll horizontal con la barra", await sinScroll())
  await page.screenshot({ path: `${SHOTS}/d-barra-390.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("button", { name: "Terminar selección", exact: true }).click()
}

// 3. La vista de la primera tarea: «Editar contexto» se abre y se cancela.
await page.goto(`${BASE}/prevencion/miper/${MIPER_ID}`)
await page.locator("main section[aria-labelledby^='miper-activity-'] ul a").first().click()
await page.getByRole("heading", { level: 2 }).first().waitFor()
const editar = page.getByRole("button", { name: "Editar contexto", exact: true })
if (await editar.count() > 0) {
  await editar.click()
  const contexto = page.getByRole("dialog", { name: "Editar contexto de la tarea" })
  anotar("«Editar contexto»: texto", (await texto(contexto)).slice(0, 300))
  anotar("«Editar contexto»: «Guardar contexto» deshabilitado sin cambios", await contexto.getByRole("button", { name: "Guardar contexto", exact: true }).isDisabled())
  await page.screenshot({ path: `${SHOTS}/d-contexto.png` })
  await contexto.getByRole("button", { name: "Cancelar", exact: true }).click()
}
anotar("Server Functions enviadas (esperado: ninguna)", escrituras)
anotar("consola", errores)
await browser.close()
```

Después:

```bash
psql "$DEV_DB" -At -f /tmp/qa-d-recuento.sql | grep -v '^BEGIN$\|^ROLLBACK$' > /tmp/qa-d-despues.txt
diff /tmp/qa-d-antes.txt /tmp/qa-d-despues.txt && echo "DESPUÉS = ANTES"
rm qa-d-lectura.mjs
git status --short   # qa-d-lectura.mjs no aparece; el .gitignore modificado NO se agrega
```

Si el `diff` no da vacío, o «Server Functions enviadas» no es `[]`, se investiga y se informa: este
paso no escribe.

Criterios:

| Caso | Criterio |
|---|---|
| estructura | Sin «Seleccionar» (0 botones) y bajo 400 controles (spec §13). |
| filtrada sin el modo | Sin casillas. Se anota la cifra de controles. |
| filtrada con el modo | Una casilla más por riesgo a la vista. Se anota la cifra: es la razón de que el modo se active a mano. |
| barra | «N riesgos seleccionados» con los N del filtro; con más de 300, el aviso «quita …» y las acciones deshabilitadas. |
| diálogos | Los tres abren con su título y su botón de aplicar; «Asignar responsable / plazo» muestra los tres grupos con sus cifras; se cancelan sin escribir. |
| 390 | `true`. |
| «Editar contexto» | Abre con la actividad y la tarea de la vista y «Guardar contexto» deshabilitado sin cambios. |
| escrituras | `[]`, y los recuentos de antes y de después coinciden. |

- [ ] **Step 4: Manual y spec**

En `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`, antes de
«### En el celular» (línea 238), agregar:

```markdown
### Cambios en lote

Cuando el mismo cambio vale para varios riesgos —la misma medida, la misma respuesta a "¿Está controlado?", el mismo responsable o plazo— no hace falta abrirlos de a uno:

1. En la vista de una tarea, o en la matriz con algún filtro o búsqueda, aprieta **"Seleccionar"**. Aparece una casilla al lado de cada riesgo, y **"Seleccionar los N riesgos"** (o **"los N resultados"**) los marca todos. **"Terminar selección"** quita las casillas.
2. Abajo aparece una barra con lo elegido y tres acciones:
   - **"Agregar medida a N"**: la misma medida, con el formulario de siempre, en cada riesgo seleccionado. Nace **Propuesta**, como toda medida nueva.
   - **"Cambiar ¿controlado?"**: la misma respuesta en todos.
   - **"Asignar responsable / plazo"**: a todas las medidas de esos riesgos, sólo a las que no tienen responsable o sólo a las por implementar sin plazo. Lo que dejas en «No cambiar» o vacío queda como estaba en cada medida. El plazo sólo entra a las medidas por implementar y la frecuencia sólo a las ya implementadas.
3. Antes de aplicar, el diálogo avisa si el cambio deja riesgos con **pendientes nuevos** (por ejemplo, una medida por implementar sin plazo, o un Intolerable que se queda sin medida por implementar). Puedes aplicarlo igual: el envío a revisión los va a pedir.

**"Editar contexto"**, en la vista de una tarea, cambia la actividad, la tarea, el puesto o el lugar de **todos** sus riesgos de una vez. Si cambias el nombre, la página pasa a la tarea nueva; si ya había una tarea con ese nombre, quedan juntas. Puesto y lugar vacíos dejan el de cada riesgo.

> [!IMPORTANT]
> **TODO O NADA.** Un cambio en lote se guarda completo o no se guarda. Si otra persona cambió alguno de esos riesgos mientras tanto, no se aplica nada y el aviso dice cuántos cambiaron; **"Recargar la matriz"** trae lo nuevo para volver a intentarlo. Se pueden cambiar hasta **300** riesgos (o medidas) por vez. Cada riesgo queda en el **Historial** con el motivo «Edición masiva». La probabilidad y la consecuencia nunca cambian en lote: se deciden riesgo por riesgo.
```

En `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`:
1. Línea 3: reemplazar «Estado: **Fases A (con el pulido A2), B y C implementadas**» por «Estado:
   **Fases A (con el pulido A2), B, C y D implementadas**».
2. Al final de §9 (antes de «## 10. Fase E: programa, revisión, historial y controles»), agregar:

   ```markdown
   **Implementado (Fase D, plan `docs/superpowers/plans/2026-10-03-miper-d-acciones-masivas.md`):**

   - **Servicio** (`lib/services/miper/bulk.ts`). Cada operación es una transacción con la matriz
     bloqueada, el permiso de editar de su faena y la MIPER editable (ni legacy ni reemplazada). Cada
     elemento trae su versión: una vieja, o un elemento de otra MIPER, abortan todo («N riesgos
     cambiaron mientras editabas; recarga la matriz…»). Hasta 300 elementos. Una entrada de historial
     por elemento, con el `changeType` del guardado de a uno y el motivo «Edición masiva».
     - `bulkAddMiperControl` recibe también la versión de cada riesgo (el plan maestro la pide en toda
       operación) pero, como el alta de a una, no la cambia.
     - Las reglas son las del guardado de a uno: `toColumns` (diccionario y factor activo),
       `controlColumns` (D5, ahora en `lib/prevention/miper/control-values.ts`), personas activas y
       medida nueva «propuesta». Nunca P×C: el esquema lo rechaza.
   - **Antes de aplicar**, cada diálogo dice qué riesgos ganan un pendiente
     (`lib/prevention/miper/bulk-impact.ts`, con `checkMiperCompleteness`). No impide aplicar, igual
     que el editor.
   - **UI.** «Seleccionar» es un modo (sin él no hay casillas) en la vista de la tarea y en la matriz
     filtrada; la casilla va al lado del enlace del riesgo. La barra fija de abajo ofrece «Agregar
     medida a N», «Cambiar ¿controlado?» y «Asignar responsable / plazo» (a todas las medidas, a las
     sin responsable o a las por implementar sin plazo), y sobre 300 dice cuántos quitar.
     `ControlFields` (los campos de la medida) lo comparten el editor y «Agregar medida a N».
   - **Versiones.** Antes de leerlas se esperan los guardados en curso (`whenIdle`); después, las
     nuevas quedan anotadas (`acknowledge`) y el guardado siguiente no choca.
   - **«Editar contexto»** cambia actividad, tarea, puesto y lugar de todos los riesgos de la tarea.
     Si cambia la clave, cambia las filas en pantalla y navega con `replace` a la tarea nueva: la
     promesa de la acción se resuelve antes de que llegue la foto revalidada.
   ```

- [ ] **Step 5: Informe `qa/reports/2026-10-03-miper-d.md`**

Mismo formato que `qa/reports/2026-10-03-miper-c.md`. Secciones, en este orden:
1. **Alcance:** acotado a la Fase D (los tres lotes, la selección, «Editar contexto», `ControlFields` y
   el arrastre de la Fase C). No es una auditoría de la aplicación ni afirma cobertura total.
2. **Entorno y datos.** Decir explícitamente:
   - **Toda escritura se verificó en PGlite y en la base E2E desechable; en `bodega_dev` sólo se
     leyó** (Step 3): se abrieron y cancelaron los diálogos, sin una sola Server Function.
   - el worktree y su commit; las migraciones de `bodega_dev`; la MIPER recorrida (id y que no tenía
     ronda abierta); los recuentos de antes y de después, idénticos.
3. **PASS:** una tabla con
   - el criterio D con números: la PGlite «criterio D: una medida se aplica a 40 riesgos…» (40
     medidas, 40 entradas «Edición masiva», versiones de los riesgos sin cambiar) y «una versión vieja
     aborta todo» (0 medidas, 0 historial);
   - las E2E de la Task 11, con el conteo por spec;
   - lo medido en el Step 3 (controles sin y con el modo, la barra, los diálogos, 390, escrituras).
4. **Hallazgos clasificados:** PRODUCT BUG, FUNCTIONAL FINDING, UX FINDING, INCONSISTENCY, AUTOMATION
   WARNING e IMPROVEMENT OPPORTUNITY. Si no hay hallazgos en una categoría, se dice. Candidatos a
   revisar:
   - la cifra de controles con el modo «Seleccionar» encendido en una matriz filtrada grande;
   - «Buscar en la matriz» también mira la tarea: «solvente» trae los tres riesgos de «Trasvasije de
     solventes» (AUTOMATION WARNING de la planificación, no un defecto);
   - la bitácora con 300 líneas de un mismo lote (hasta la paginación de la Fase E).
5. **Errores de consola y fallas de red.**
6. **Cobertura de rutas y pasos.**
7. **COVERAGE GAP.** Como mínimo:
   - aplicar un lote en `bodega_dev` (sólo PGlite y base E2E);
   - un lote de más de 300 en el navegador (sólo jsdom y PGlite);
   - dos pestañas aplicando un lote y guardando a la vez (sólo PGlite: la versión vieja aborta; jsdom:
     `whenIdle`);
   - factor y rutinaria en lote (servicio y PGlite; sin UI, «Decisiones» 3);
   - un lector de pantalla real;
   - tiempos en producción (fuera de alcance: requieren autorización).
8. **Compuertas** (Step 1), con el conteo de pruebas, y **E2E** (Task 11), con el conteo por spec.
9. **Recomendaciones priorizadas.** Entre ellas, las de «Después de la Fase D».

Nunca afirmar cobertura total. Ningún nombre de persona: los responsables de las pruebas son cargos o
usuarios sembrados.

- [ ] **Step 6: Commit**

```bash
git status --short   # qa-d-lectura.mjs no aparece; el .gitignore modificado NO se agrega
git add docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md qa/reports/2026-10-03-miper-d.md
git commit -m "docs(miper): manual de los cambios en lote, spec §9 implementada e informe de verificación de la Fase D" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Autorrevisión contra el plan maestro (sección D y arrastre de C)

| Pedido | Task |
|---|---|
| Arrastre C: «de N días» se salta con cada/frecuencia/periodicidad, con pruebas | 1 |
| Arrastre C: manual l. 450 con la redacción de la re-revisión | 1 |
| Arrastre C: tabla de E2E finales sobre 1143bf50 en el informe C §10 | 1 |
| Arrastre C: `duplicateMiperEntry` conserva el orden de las medidas | 1 (PGlite que falla sin el arreglo) |
| Arrastre C: el esquema MIPER sin los literales 300 y 120 | 1 (y la Task 3 los reutiliza) |
| Servicio `bulk.ts`: una transacción con `lockMatrix`, `requireAccess(EDIT)` y `assertEditable` | 4 |
| Versión por elemento, todo o nada | 4 (PGlite «una versión vieja aborta todo…», también para medidas) |
| Tope de 300 | 3 (esquema) y 4 (PGlite), 8 (barra) y 10 (diálogo) |
| Historial por elemento con los `changeType` de siempre y «Edición masiva» | 4 (PGlite), 11 (E2E: la bitácora) |
| `toColumns` / `touchMatrix` exportados | 4 |
| `bulkPatchMiperEntries` sin P×C | 3 (esquema) y 4 (PGlite) |
| `bulkAddMiperControl` | 4 |
| `bulkUpdateMiperControls`: responsable, plazo, `isExisting` y frecuencia | 3 y 4 |
| D5 y fechas de calendario en lote, como el guardado de a uno | 2 (`controlColumns` puro), 3 y 4 (PGlite «D5 en lote…», «fechas de calendario…») |
| Personas activas (`assertActiveUsers`) | 4 (`controlResponsible`, PGlite) |
| Medidas nuevas `proposed` | 4 (PGlite) |
| Completitud y regla crítica: nada inconsistente en silencio | 2 (`bulk-impact`) y 8 (aviso en cada diálogo) |
| Acciones `guarded("prevention:risk:edit")` con revalidación; rechazo sin permiso y fuera de la faena | 5 |
| Modo «Seleccionar»; sin él no hay casillas | 6 (hook) y 9 (vistas) |
| Casilla hermana de `RiskRow`, no dentro del enlace | 9 (`SelectableRiskRow`, jsdom) |
| Barra fija con el patrón de `bulk-approve-bar.tsx` | 8 |
| Aviso cuando la selección pasa de 300 | 8 |
| `ControlFields` extraído de `ControlForm`, con lo de A2 y C | 7 (`control-form.test.tsx` sin cambios) |
| `whenIdle` antes de leer versiones | 6 y 8 |
| «Editar contexto» con `bulkPatchMiperEntries` y `replace` al `taskKeyOf` nuevo | 10 (jsdom) y 11 (E2E) |
| PGlite: atomicidad, alcance, legacy y reemplazada, tope, historial, D5, fechas | 4 |
| Acciones con `vi.mock` del módulo nuevo | 5 |
| E2E: una medida a 2 riesgos; renombrar la tarea | 11 |
| Criterio D: 40 riesgos en una operación atómica; versión vieja aborta todo (PGlite) | 4 |
| Docs: manual de las acciones masivas, spec §9, informe QA con recorrido de sólo lectura | 12 |

**Nombres que cruzan tareas:**
- Task 1 → Task 3: `MEASURE_MAX_LENGTH`, `RESPONSIBLE_MAX_LENGTH`, `FREQUENCY_MAX_LENGTH` importadas
  en el esquema.
- Task 2 → Tasks 4, 8 y 10: `controlColumns`, `patchedControlValues`, `type ControlValues`, `type
  ControlResponsible`, `type ControlPatch`; `newlyIncomplete`, `withAddedControl`, `withControlPatch`,
  `impactSummary`.
- Task 3 → Tasks 4, 8 y 10: `MIPER_BULK_LIMIT`, `miperControlValuesSchema`,
  `miperBulkPatchEntriesSchema`, `miperBulkAddControlSchema`, `miperBulkUpdateControlsSchema`.
- Task 4 → Task 5: `bulkPatchMiperEntries`, `bulkAddMiperControl`, `bulkUpdateMiperControls` y sus
  resultados (`{ entries }`, `{ controls }`).
- Task 5 → Tasks 8 y 10: `bulkPatchMiperEntriesAction` (`data.entries`), `bulkAddMiperControlAction`,
  `bulkUpdateMiperControlsAction`.
- Task 6 → Tasks 8 y 9: `type AutosaveSync` (`versionOf`, `whenIdle`, `acknowledge`),
  `useRiskSelection`, `type RiskSelection`.
- Task 7 → Task 8: `ControlFields`, `draftOf`, `valuesOf`, `isDraftReady`, `ResponsibleField`,
  `KEEP_RESPONSIBLE`, `type ControlDraft`.
- Task 8 → Tasks 9 y 10: `BulkBar`, `type BulkContext`, `BulkDialog`, `entryItems`,
  `MISSING_VERSION`, `settlePatchedEntries`.
- Tasks 8–10 → Tasks 11 y 12: los nombres accesibles listados en la Task 11 («Interfaces»).

**Verificación del plan antes de entregarlo (2026-10-03):** el código de las Tasks 1 a 11 se aplicó
tal como está escrito aquí sobre una copia exportada de 1143bf50 (`git archive`), fuera del checkout
del usuario, y cada «Reemplazar … por …» se extrajo de esa copia y se comprobó que aparece una sola vez
en el estado anterior de su archivo.
- Pasaron `typecheck` y `eslint` sobre los 41 archivos tocados (con `e2e/`).
- Pasaron las suites rápidas de `app/(app)/prevencion`, `lib/prevention`, `lib/validation`,
  `lib/reports`, `app/(app)/dashboard` y `lib/services`: 280 archivos, 2.532 pruebas (1 omitida, que ya
  lo estaba).
- Pasaron, de a una, las PGlite `miper-bulk` (8), `miper-entries` (7), `miper-import` (17),
  `miper-matrices` (6), `miper-workflow` (6), `miper-snapshot-batch` (5), `miper-queries` (7) y
  `miper-work-queue` (14).
- Las pruebas nuevas de «de N días» y del orden al duplicar fallan sin su arreglo y pasan con él.
- E2E, desde esa copia (build propia en :3100, base E2E desechable, sin `.env*`): `prevencion-miper-masivas`
  3/3 (axe incluido), `prevencion-miper-interacciones` 8/8, `prevencion-miper-flujo` 3/3,
  `prevencion-miper-matriz` 4/4, `prevencion-miper-importacion` 2/2, `prevencion-miper-escenario`
  10/10 y `accessibility.spec.ts -g "MIPER|miper"` 5/5. La primera corrida de `masivas` falló porque
  el filtro por búsqueda traía los tres riesgos; se cambió a `?clasificacion=moderate` con un Tolerable
  sembrado, que es lo que está escrito.
- `npm run doctor`: sólo advertencias, de las mismas reglas que ya marcan archivos vecinos.
- **No se corrió** el recorrido de sólo lectura en `bodega_dev` (Task 12, Step 3): queda para la
  ejecución.

## Después de la Fase D

Integrar localmente en `main` con todo en verde, sin push (subirlo se consulta). Sigue **V1** (recorrido
de revisión y solo lectura, antes de E), según el orden del plan maestro: 0 → A2 → B → C → D → V1 → E →
V2.

Pendientes que esta fase deja anotados:
- **Arrastre de la Fase C que no bloquea:** la suite `*-concurrency-postgres` para el `FOR UPDATE` del
  lote; `startTransition` en la capa de `useOperation`; fusionar decisiones al re-revisar el mismo
  archivo; el conteo de producción de `is_existing`/`verification_frequency` antes del despliegue (sólo
  con autorización); un mensaje distinto para lotes heredados ni `staged` ni `activated`.
- **Cambio visible a validar con el usuario** (de la Fase C): el RE-04 exportado escribe en PLAZOS
  «Existente · <frecuencia>» (o «Existente») para las medidas existentes.
- **De la Fase D:**
  - factor y rutinaria en lote no tienen UI (el servicio los acepta: «Decisiones» 3);
  - «Asignar responsable / plazo» no elige medidas sueltas (Decisiones 4);
  - la bitácora muestra cada línea de un lote; la paginación de la Fase E la hace navegable;
  - renombrar o juntar tareas no renumera: el RE-04 exportado puede quedar con una tarea no contigua.
