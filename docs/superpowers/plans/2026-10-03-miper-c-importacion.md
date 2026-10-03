# MIPER — plan de implementación de la Fase C (importación con medidas)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar el RE-04 crea también sus medidas de control —con el tipo I–V que confirma una
persona, su responsable y su plazo o su frecuencia de verificación—, y la regla D5 (plazo sólo para
lo que está por implementar) queda de punta a punta: foto, guardado, completitud, «Atención
requerida», Excel y formulario de la medida.

**Architecture:** La lectura de las medidas es pura y vive en `lib/prevention/miper/re04-measures.ts`:
separa las medidas de la celda **original** «MEDIDA DE CONTROL» del lote (con sus saltos de línea),
agrupa frases, responsables y plazos distintos, sugiere tipo y plazo, y dice qué le falta o le sobra a
un mapeo. La vista previa (`previewRiskImport`) devuelve ese análisis; la carga (`commitRiskImport`)
**lo vuelve a calcular desde el lote**, rechaza un mapeo incompleto o ajeno, y crea el borrador, los
riesgos, las medidas (todas `proposed`) y la traza en **una sola transacción**
(`createMiperWithClient`). El diálogo pasa a cuatro pasos (Archivo → Filas → Medidas detectadas →
Confirmar) con el estado de las decisiones en un módulo puro (`import-decisions.ts`) y el patrón de
`generate-actions-dialog.tsx`. `isExisting` y `verificationFrequency` entran a la foto **al final de
cada medida**: las fotos selladas no se tocan y `controlsKey` las normaliza (`?? false` / `?? null`).

**Tech Stack:** Next.js 16.3.8 (App Router), React 19.2, TypeScript 5.9, Zod 4, Drizzle 0.45,
ExcelJS 4.4, Tailwind v4, Radix, Vitest 4 + Testing Library (jsdom; `@testing-library/jest-dom` ya
viene cargado en `components/__tests__/setup.ts`), PGlite 0.5, Playwright 1.62 y
`@axe-core/playwright`. Antes de tocar las Server Functions, leer en `node_modules/next/dist/docs/`:
- `01-app/01-getting-started/07-mutating-data.md`: el cliente despacha las Server Functions **de a
  una**, y sus argumentos llegan serializados;
- `01-app/02-guides/data-security.md`, §«Validating client input»: todo lo que llega a una Server
  Function es entrada no confiable. Por eso la carga recalcula las claves desde el lote;
- `01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`, §`bodySizeLimit`: el
  repo lo fija en `21mb` (`next.config.*`), de sobra para los mapeos (≈ 60 KB con el RE-04 real).

**Spec:** `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` §8 (Fase C), con §2.2
(D5 y D6), §6.2 (formulario de medida), §13 y §15. Alcance: plan maestro
`/home/allopze/.claude/plans/revisa-el-ui-ux-de-stateful-zebra.md`, sección «C. Importación con
medidas (spec §8)», más «Al inicio de la Fase C» del «Arrastre al cerrar la Fase B». Donde la spec y
el plan maestro difieren manda el plan maestro, que es posterior y está aprobado
(`distinctPhrases` con `normalizeMeasure`, «;» y «.X» como separadores, estado `proposed`).
Decisiones del usuario (2026-10-02), obligatorias:
- **D5:** plazo obligatorio **sólo** para medidas por implementar (`!isExisting`);
- **D6:** PLAZOS se mapea en la vista previa, **una vez por valor distinto**;
- las medidas importadas —existentes y por implementar— quedan **`proposed`** hasta que alguien las
  verifique: no bajan «Riesgos críticos sin control» sin evidencia;
- **Importante no controlado e Intolerable** exigen al menos **una medida por implementar** con
  responsable y plazo.

Criterio de aceptación C: «importar el RE-04 de Biodiversa en un borrador `QA_` de `bodega_dev`
(revertido después) crea las medidas con tipo, responsable y plazo o frecuencia. Los pendientes bajan
a los reales. Un mapeo incompleto se rechaza en el servidor». Lo cierra la Task 11, con el RE-04
real, pero **en la base E2E desechable y no en `bodega_dev`** («Decisiones», 13): limpiar un borrador
en `bodega_dev` exigiría apagar la protección de sólo agregar de `audit_log` y borrar bitácora.

## Global Constraints

- **Rama:** `feat/miper-importacion` (ya creada desde `main` 972192fa, que trae la Fase A, el pulido
  A2 y la Fase B).
- **Sin migraciones.** `prevention_risk_controls.is_existing` (`boolean NOT NULL DEFAULT false`) y
  `verification_frequency` (`text`) ya existen (`db/schema/prevention/risk-legal.ts:317,320`), y el
  CHECK `prevention_risk_controls_critical_standard` (`:337`) sólo ata a `is_critical = true`, que
  esta fase no escribe. Ninguna tarea toca `db/schema` ni `db/migrations`. Si una se volviera
  imprescindible: `npm run db:generate`, checksum con
  `node scripts/verify-migration-chain.mjs --update-checksums`, `npm run db:verify-migrations`, y
  nunca editar `db/migrations/meta/_journal.json` ni una migración ya creada (AGENTS.md).
- **Autorización:** no cambian rutas, permisos ni `modules/*`. La vista previa y la carga siguen
  detrás de `guardPermission("prevention:risk:edit")` y vuelven a autorizar en el servicio
  (`requireAccess(access, EDIT, worksiteId)`); `createMiperWithClient` repite la comprobación del
  alta. Toda decisión que llega del cliente se valida en el servidor (esquema + claves recalculadas
  + personas activas **y de la faena**). Ocultar algo en la UI no es autorización.
- **Layout:** no hay páginas nuevas. La importación sigue siendo un `Sheet` que abre «Importar»
  desde `PageHeader.actions` de la portada (regla 5). Ningún buscador nuevo, ningún `<h1>`.
- **Densidad y controles (AGENTS A4–A6):**
  - fechas con `DatePicker`, nunca `<input type="date">`;
  - nunca un valor crudo de enum en pantalla: el tipo se muestra con `CONTROL_HIERARCHY_LABEL` y el
    estado de la medida importada como «Propuesta»;
  - `Badge` sólo con variantes literales: la regla `local/no-raw-badge-variant-map` prohíbe
    `<Badge variant={mapa[x]}>`.
- **Texto y fechas:**
  - color de texto sólo con tokens `-ink` (`--color-warning-ink`, `--color-danger-ink`…);
  - copy en español de Chile; plurales con `countOf` de `@/lib/utils`;
  - fechas con `formatDate`; el día de hoy con `todayInChile()`; sumar días a una fecha civil con
    `addDaysToPlainDate`. Nunca `toLocaleDateString` ni `new Date().toISOString().slice(0, 10)`.
- **Exportaciones:** sólo Excel. La Task 4 cambia el libro RE-04 existente (`miper-workbook.ts`); no
  hay exportaciones nuevas.
- **Formularios:** `Field` para los campos. `ControlForm` y el diálogo de importación usan
  `useOperation` (envío imperativo, sin `<form action>`). A los controles que no son nativos
  (`OptionSelect`, `DatePicker`, el input de archivo) se les da nombre con `aria-label`/`ariaLabel`
  explícito: así lo encuentran las pruebas por rol.
- **Datos personales:** ningún nombre, RUT ni correo del Excel real entra a una prueba, un fixture,
  el informe QA o un commit. Las frases de medidas y de plazos del RE-04 sí. Los responsables de los
  fixtures son cargos («Supervisor de turno», «Jefe de faena», «SUPERVISOR/PREVENCION»). Los libros
  de prueba se generan con ExcelJS; el archivo real nunca se copia ni se versiona (está ignorado).
- **Bases de datos:**
  - Producción (`plataforma-db-1`) nunca.
  - `bodega_dev` (contenedor `bodega-dev-db`, 127.0.0.1:5433): **de sólo lectura en toda la fase**,
    también en la Task 11. Nada de `INSERT`, `UPDATE` ni `DELETE`, y los recuentos de antes y de
    después de un recorrido tienen que coincidir.
  - Nunca se activa `app.audit_maintenance` ni se borran filas de `audit_log`; la verificación con
    datos reales corre en la base E2E desechable.
  - Nunca imprimir la URL de la base, la sesión QA (`playwright/.auth/monkeytest.json` es una
    credencial), una cookie ni `QA_USER`.
- **Puertas por tarea:**
  - `npm run typecheck`;
  - `npm run lint -- <archivos tocados>` (el guard pasa los argumentos a `eslint`);
  - `npm run test:fast -- <archivos>`, con las rutas de `app/(app)/…` entre comillas;
  - `npm run test:pglite -- <archivo>` para cada suite PGlite tocada, **de a una**. Esta fase no crea
    suites PGlite nuevas: todas sus pruebas PGlite van en suites ya registradas en
    `tests/pglite-files.ts` (`miper-snapshot-batch`, `miper-entries`, `miper-queries`, `miper-import`,
    `miper-work-queue`). Si alguna tarea creara una, se registra ahí o `test:fast` la intenta correr
    en paralelo.
- **Pruebas de componentes:**
  - empiezan con `// @vitest-environment jsdom` en la primera línea;
  - mockean `next/navigation`, las acciones (`./actions` o `../actions`) y `@/lib/toast`. `DataTable`
    usa `useRouter`, `usePathname` y `useSearchParams`: el mock de `next/navigation` trae los tres;
  - jsdom no aplica CSS. Para elegir en un `OptionSelect` (Radix): `fireEvent.click` sobre el
    `combobox` y luego sobre el `option` (patrón de `components/ui/option-select.test.tsx`).
- **Commits:**
  - en español: `feat(miper): …` / `fix(miper): …` / `test(miper): …` / `docs(miper): …`;
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
- **Números de línea:** los citados son los de 972192fa. Una tarea anterior puede correrlos, así que
  cada paso cita además el texto exacto que se reemplaza: se ubica por el texto.
- **Entre la Task 8 y la Task 9 la importación desde la UI queda a medias.** La Task 8 vuelve
  obligatorios los mapeos cuando el archivo trae medidas, y el diálogo que los envía llega en la Task
  9. Mientras tanto, el diálogo viejo recibe «falta decidir…» con cualquier RE-04 que traiga medidas.
  Ninguna E2E se corre, ni se integra nada, antes de la Task 10.

## Review Focus

1. **Una decisión vieja aplicada a un lote nuevo.** La persona revisa el archivo, decide, vuelve a
   «Archivo», cambia el período o crea un factor (eso vuelve a correr la vista previa y da un lote
   nuevo), y confirma. Tiene que valer lo del lote nuevo; las decisiones de otro archivo se rechazan
   en el servidor, no se aplican a medias.
   - Lo fijan: la Task 8 (PGlite «…uno armado para otro archivo; no crea nada») y la Task 9
     (`import-dialog.test.tsx`: «volver a revisar el archivo descarta las decisiones»).
2. **El responsable cambia entre la vista previa y la carga.** La persona elegida se desactiva o no es
   de la faena (un cliente adulterado puede mandar cualquier id). La carga se rechaza con un mensaje
   claro y no deja un borrador vacío.
   - Lo fija la Task 8 (PGlite «un responsable que ya no está activo o no es de la faena se rechaza…»).
3. **El orden de las medidas de un riesgo.** Todas las medidas importadas nacen en la misma
   transacción, con el mismo `created_at`: sin cuidado, la foto (y la tarjeta, y el Excel, y el
   `snapshotSha`) las ordena al azar por id.
   - Lo fijan: la Task 1 (desempate por id, PGlite) y la Task 8 (PGlite «…en el orden del Excel»).
4. **Una descripción con salto de línea en el Excel exportado.** El libro escribe una línea por
   medida en MEDIDA, RESPONSABLE y PLAZOS; un `\n` dentro de una descripción correría todas las líneas
   siguientes y el responsable quedaría junto a la medida equivocada.
   - Lo fija la Task 4 (`miper-workbook.test.ts`: «…una descripción con salto de línea no corre las
     líneas»).
5. **Volver a importar el libro que exporta la plataforma.** Cada medida trae su «IV. Controles
   administrativos: …» y RESPONSABLE/PLAZOS traen una línea por medida. Cada medida tiene que quedar
   con su tipo, su responsable y su plazo, no con la celda entera repetida.
   - Lo fijan: la Task 6 (`re04-measures.test.ts`, «libro exportado…» y
     `miper-workbook.test.ts`, «el libro exportado se vuelve a importar…»).

---

## Lo que enseñó el RE-04 real (sin datos personales)

Leído con un script ExcelJS de un solo uso, fuera del repo.
- **El archivo que la spec describe es otro.** Las cifras de la spec (D5 y D6: 167 «PARCIALMENTE
  CONTROLADO», TRIMESTRAL 178, INMEDIATO 46) y el texto «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN
  INMEDIATA» están en `docs/Prevención Biodiversa/5. MATRIZ DE RIESGOS/RE- 04 Matriz de
  Identificación de Peligros y Evaluación de Riesgos (MIPER).xlsx`, en la raíz de esa carpeta.
  - La copia de `2026/` trae «TRIMESTRAL» en las 216 filas con plazo y no tiene la cola «REQUIERE
    ACCIÓN INMEDIATA».
  - La de `2025/` tiene otro formato: la hoja «MATRIZ DE RIESGOS», sin «RE-04 IPER».
  - La Task 11 usa el de la raíz. Es el mismo que ya se cargó en «Oficina Central 2099».
- **Archivo de la raíz:** 254 filas de datos.
  - 24 dicen «REVISAR» y no tienen P, C ni medidas.
  - 230 tienen medidas; con la regla de separadores de abajo salen 789 medidas y 222 frases
    distintas.
  - `inferHierarchy` sugiere por palabra clave 203 de 222 frases. Quedan 19 «sin pista», todas reglas
    de conducta («UTILIZAR RUTAS SEGURAS», «ORGANIZAR LAS TAREAS»), que el IV por defecto ya acierta.
- **Separadores:**
  - Comas de primer nivel: «USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA, …».
  - «;»: 16 celdas, cuyas comas **enumeran dentro** de una medida («VERIFICAR CARGA MÁXIMA,
    DISTRIBUCIÓN, HERMETICIDAD, …; INSPECCIÓN ANTES DE SALIR; …»). Separar también por esas comas daba
    fragmentos sueltos («DISTRIBUCIÓN», «HERMETICIDAD»).
  - Saltos de línea: 27 celdas, en tres líneas que son ingeniería / administrativas / EPP, la última
    con su lista de EPP por comas.
  - «.X» pegado: «…AGENTES BIOLÓGICOS.PARTICIPAR…».
  - Coma final («…A LA DEFENSIVA,») y espacios alrededor del salto («HDS \n MANTENER»).
  - Medidas pegadas sin separador («LENTES DE SEGURIDADINSPECCIÓNAR»), que no se pueden separar.
- **RESPONSABLE:** 9 valores distintos, **todos cargos** («SUPERVISOR/PREVENCION» en 191 filas, «…
  / CONDUCTOR / …»). Ningún nombre de persona.
- **PLAZOS:** 5 valores, ninguno es fecha:
  - «TRIMESTRAL»: frecuencia → existente;
  - «INMEDIATO / ANTES DE CONTINUAR LA TAREA»: por implementar hoy;
  - «ANTES DE CADA OPERACIÓN»: frecuencia;
  - «INMEDIATO AL OCURRIR»: por implementar hoy;
  - «IMPLEMENTAR EN 30 DÍAS Y CONTROL DIARIO»: por implementar hoy + 30. Es el caso que obliga a mirar
    «en N días» antes que la palabra de frecuencia.
- **«¿Está controlado?»:**
  - las 46 filas «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA» son las 46 Importantes con
    plazo «INMEDIATO…»;
  - hoy el parser las lee como «no», porque busca el texto exacto.

## Decisiones (donde la spec o el plan maestro callan)

| # | Tema | Decisión | Costo |
|---|---|---|---|
| 1 | Separadores de medidas | Los saltos de línea separan siempre. Dentro de una línea, «;» si la línea tiene alguno y, si no, las comas de primer nivel (fuera de paréntesis). Después, «.X» pegado. Una línea con «I.–V.» es una sola medida. | Una lista por comas dentro de una celda con «;» queda en una medida. |
| 2 | Qué filas piden decisiones | Todas menos las `rejected` (P o C fuera de escala, que nunca se cargan). Las `needs_review` sí, porque se cargan si el factor existe al confirmar. Preview y carga calculan las claves desde las mismas filas del lote, así que coinciden. | Se pueden decidir frases de una fila que al final queda fuera. |
| 3 | Confirmación del tipo | Cada tipo inferido nace «Sugerida». El del prefijo del Excel nace confirmado. Se confirma eligiendo otro tipo, con «Confirmar» en la fila o con «Aceptar sugerencias (N)». «Siguiente» exige cero sugeridas. Responsables y plazos nacen en su sugerencia y no piden confirmación aparte. | Un clic acepta también las «Sugerida · sin pista» (IV); el rótulo las delata antes. |
| 4 | Plazo que no se reconoce, o vacío | «Por implementar», sin fecha. | La completitud lo marca pendiente: es el dato que de verdad falta. |
| 5 | Responsable | Por defecto, el texto del Excel. Si coincide exactamente con el nombre de una persona de la faena, se sugiere esa persona. Vacío: «Sin responsable». Las personas elegibles son las de `responsibleOptions`: activas de la faena más quien importa, igual que en el editor. | — |
| 6 | Frecuencia de una existente | Opcional. La completitud no la exige: D5 pide tipo, descripción y responsable. | Puede quedar una existente sin frecuencia. |
| 7 | Lo que no aplica | El servidor guarda `due_date = NULL` en una existente y `verification_frequency = NULL` en una por implementar. Si el pedido no trae `isExisting` o la frecuencia, se conservan los de la medida; una medida nueva nace por implementar. | — |
| 8 | Orden de las medidas importadas | `created_at` = instante de la transacción + N ms por medida, para conservar el orden del Excel. El duplicado de un riesgo queda con el desempate por id de la Task 1. | Al duplicar, el orden es estable pero no el original («Después de la Fase C»). |
| 9 | Libro exportado | «—» donde falta un dato, y los saltos de línea de una descripción se aplanan: la línea N de MEDIDA, RESPONSABLE y PLAZOS es la misma medida. Al volver a importarlo, las líneas se alinean sólo si todas las medidas traen «I.–V.» y los conteos calzan. | — |
| 10 | Topes | 5.000 frases y 1.000 responsables o plazos distintos por importación; clave ≤ 3.000 caracteres, frecuencia ≤ 120 (`IMPORT_LIMITS`). La vista previa los aplica antes de guardar el lote; el esquema de la carga, otra vez. | Un RE-04 más grande se divide. |
| 11 | «Atención requerida» | Usa la regla de la completitud: el responsable puede ser usuario **o escrito**, la medida tiene que estar por implementar, y un Importante «Sí, controlado» con alguna medida no aparece. El título pasa a «… sin medida por implementar con responsable y plazo». | — |
| 12 | Pasos del diálogo | Se avanza con «Atrás» y «Siguiente», no con clic en el paso. Cambiar faena, período o archivo descarta la vista previa y las decisiones. Si el archivo no trae medidas, se salta «Medidas detectadas». | — |
| 13 | Dónde se verifica el criterio C con el RE-04 real (Task 11) | En la **base E2E desechable**, que se vuelve a sembrar en cada corrida: un spec temporal, sin commitear, en un worktree desechable sube el archivo real por la UI. `bodega_dev` queda de sólo lectura. Revertir una importación ahí exigiría borrar bitácora, y eso no se hace. | El plan maestro decía `bodega_dev`. La base E2E no trae la MIPER «Oficina Central 2099» para comparar, así que la línea base de pendientes se calcula en la misma base: los riesgos que sin medidas quedarían pendientes. El catálogo de factores es el de las migraciones, y puede diferir del de `bodega_dev`. |

## Correcciones al plan maestro (referencias verificadas el 2026-10-03 sobre 972192fa)

- **Foto (`MiperControlSnapshot`, `controlsKey`):**
  - `MiperControlSnapshot` y `controlsKey` están en `lib/prevention/miper/snapshot.ts:13-16` y
    `:77-79`, no en `lib/services/miper/snapshots.ts`.
  - En `snapshots.ts` están `snapshotSha` (`:11`), `buildMiperSnapshots` (`:29-71`, con el ORDER BY de
    las medidas en `:56`) y `snapshotOf`, que arma cada medida en `:111-114`.
  - `snapshotSha` sólo se calcula al enviar (`workflow.ts:97`) y al exportar en vivo
    (`app/api/prevencion/miper/[id]/export/route.ts:36`): ninguna parte compara un hash recalculado con
    uno sellado.
  - Agregar claves cambia el hash de las fotos **nuevas**, nunca el de las selladas. La prueba dorada
    de la Fase B (`lib/__tests__/miper-snapshot-batch.test.ts:125-140`) compara contra una copia
    literal «NO EDITAR». La Task 2 no la edita: le quita las dos claves nuevas a la foto antes de
    comparar y afirma aparte que son las dos últimas.
- **Guardado de la medida:** `miperControlSaveSchema` está en
  `lib/validation/prevention-module/miper.ts:76-88`; `saveMiperControl`, en
  `lib/services/miper/entries.ts:171-206`.
- **Completitud:** la regla vive en `lib/prevention/miper/completeness.ts:54-69`.
- **«Atención requerida»** (`lib/services/prevention-attention.ts:363`):
  - el predicado es el `NOT EXISTS` de `:363-369`, y los títulos están en `:405-410`;
  - hoy sólo acepta `responsible_user_id` (un responsable escrito no cuenta, aunque la completitud lo
    acepta): eso es «cuenta `responsibleSnapshot`»;
  - además pide responsable y plazo a un Importante «Sí, controlado», que la completitud no.
- **Excel:** las tres columnas se arman en `lib/reports/miper-workbook.ts:305-308`.
  - RESPONSABLE deduplica (`new Set`) y PLAZOS descarta las vacías (`filter(Boolean)`): por eso se
    desalinean.
  - PLAZOS hoy no pasa por `safe()`; con la frecuencia escrita por una persona, tiene que pasar.
- **Parser:** `CONTROLLED_TEXT`/`controlledStatusOf` están en
  `lib/prevention/miper/re04-import.ts:175-189` y buscan el texto exacto.
  - `normalized.measures` usa `textOf`, que aplana los saltos de línea: por eso se separa desde
    `original["MEDIDA DE CONTROL"]`, como dice el plan maestro.
- **`normalizeMeasure`:** está en `lib/prevention/miper/dedup.ts:24-33` y quita «de, la, el, los, y,
  para, con, en, del». La spec §8 decía `distinctMeasures` con `normalizeMiperName`: manda el plan
  maestro.
- **Importación (`import.ts`):**
  - Las líneas 343-347 son el comentario; la creación aparte del borrador es `:346-349` (un
    `createMiper` que abre su propia transacción).
  - El `import_applied` por fila está en `:416-420` y el de la matriz en `:442-449`.
  - `riskImportCommitSchema` está en `lib/validation/prevention-module/miper.ts:249-262`.
  - `createMiper` ocupa `lib/services/miper/matrices.ts:24-120`.
- **Personas responsables:** `assertActiveUsers` está en `lib/services/miper/shared.ts:98-103` y no
  mira la faena. Los «usuarios de la faena» del editor se arman a mano en
  `lib/services/miper/queries.ts:89-90` y `:137-142`; la Task 7 los extrae a
  `worksiteResponsibleOptions`.
- **Diálogos:**
  - `import-dialog.tsx` (277 líneas) es un `Sheet` con un solo paso y un `Select` sin nombre
    accesible propio.
  - `generate-actions-dialog.tsx` es el patrón: borradores por clave en un `Record`, `OptionSelect`
    con `aria-label` por grupo, `DatePicker` y aviso antes de aplicar.
- **Medida (A2):** `control-form.tsx` (98 líneas: `locked` mientras guarda, `role=alert`) y
  `control-card.tsx` (61 líneas: `editDisabled`, el borrado espera la respuesta) ya traen el A2.
- **Pruebas que usan la bandeja vieja:**
  - `miper-import.test.ts`: el historial por riesgo está en `:306` (4 `import_applied`: 3 filas + la
    matriz), y `listMiperInbox` en `:72`, `:332` y `:356`;
  - `lib/__tests__/miper-queries.test.ts:53-76` usa `listMipers` y `listMiperInbox`;
  - el patrón `workbookOf` está en `miper-import.test.ts:112-138`.
- **«Cambiar de faena»:** el rótulo «(actual)» está en
  `app/(app)/prevencion/miper/[id]/worksite-switcher.tsx:52` (`labelOf`, `:13-15`).
- **No previsto en el plan maestro:**
  - El aviso de «Atención requerida» de `prevention-home.tsx` toma el título del servicio: no hay E2E
    que lo afirme.

## Mapa de archivos

| Archivo | Task |
|---|---|
| `lib/services/miper/snapshots.ts`, `lib/__tests__/miper-snapshot-batch.test.ts`, `lib/services/miper/queries.ts`, `lib/__tests__/miper-queries.test.ts`, `lib/__tests__/miper-import.test.ts` (sólo la bandeja), `lib/prevention/miper/inbox.ts` y `lib/services/miper/portfolio.ts` (comentarios), `app/(app)/prevencion/miper/[id]/worksite-switcher.tsx` (+test) | 1 |
| `lib/prevention/miper/snapshot.ts` (+test), `lib/services/miper/snapshots.ts`, `lib/__tests__/miper-snapshot-batch.test.ts`, `lib/validation/prevention-module/miper.ts` (+test), `lib/services/miper/entries.ts`, `lib/__tests__/miper-entries.test.ts` | 2 |
| `lib/prevention/miper/completeness.ts` (+test), `lib/services/prevention-attention.ts`, `lib/__tests__/miper-work-queue.test.ts` | 3 |
| `lib/reports/miper-workbook.ts` (+test) | 4 |
| `app/(app)/prevencion/miper/[id]/control-form.tsx` (+test), `app/(app)/prevencion/miper/[id]/control-card.tsx` (+test) | 5 |
| `lib/prevention/miper/re04-import.ts` (+test), `lib/prevention/miper/re04-measures.ts` (nuevo, +test), `lib/reports/miper-workbook.test.ts` | 6 |
| `lib/services/miper/shared.ts`, `lib/services/miper/queries.ts`, `lib/validation/prevention-module/miper.ts`, `lib/services/miper/import.ts`, `lib/__tests__/miper-import.test.ts` | 7 |
| `lib/validation/prevention-module/miper.ts` (+test), `lib/services/miper/matrices.ts`, `lib/services/miper/import.ts`, `lib/__tests__/miper-import.test.ts`, `app/(app)/prevencion/miper/actions.ts` (+test) | 8 |
| `lib/prevention/miper/import-decisions.ts` (nuevo, +test), `app/(app)/prevencion/miper/import-measures-step.tsx` (nuevo, +test), `app/(app)/prevencion/miper/import-dialog.tsx` (reescrito, +test nuevo) | 9 |
| `e2e/prevencion-miper-importacion.spec.ts` (nuevo) | 10 |
| `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`, `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`, `qa/reports/2026-10-03-miper-c.md` (nuevo) | 11 |

---

### Task 1: Arrastre de la Fase B: desempate de medidas, retiro de la bandeja vieja y «(actual)» sin período

**Files:**
- Modify: `lib/services/miper/snapshots.ts:52-56` (ORDER BY de las medidas)
- Modify: `lib/__tests__/miper-snapshot-batch.test.ts` (un test al final del `describe`)
- Modify: `lib/services/miper/queries.ts:1` y `:9` (imports), `:203-245` (se borran `listMipers` y
  `listMiperInbox`)
- Modify: `lib/__tests__/miper-queries.test.ts:16-18` (imports) y `:53-76`
- Modify: `lib/__tests__/miper-import.test.ts:16-18` (comentario), `:72`, `:176-178` (helper nuevo),
  `:331-332` y `:355-357`
- Modify: `lib/prevention/miper/inbox.ts:1-9` (comentario), `lib/services/miper/portfolio.ts:46`
  (comentario)
- Modify: `app/(app)/prevencion/miper/[id]/worksite-switcher.tsx:27-29` (comentario) y `:51-52`
- Test: `app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx:57-62`
- Test: `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx:239-249`. La prueba de la Fase B
  afirma el rótulo viejo, «Planta · 2027 (actual)», que es justo el defecto.

**Interfaces:**
- Consumes: nada de otras tareas.
- Produces:
  - `buildMiperSnapshots` / `buildMiperSnapshot` ordenan las medidas de cada riesgo por
    `created_at` y, con empate, por `id`. La Task 8 se apoya en eso: las medidas importadas nacen
    en la misma transacción.
  - `listMipers` y `listMiperInbox` dejan de existir. «Requieren mi acción» es
    `listMiperPortfolio(access).rows[i].myActions: MiperPortfolioAction[]` con
    `MiperPortfolioAction = { matrixId: string; period: number | null; reason: string }`
    (`lib/prevention/miper/portfolio.ts`).
  - «Cambiar de faena» rotula la faena actual `«<faena> (actual)»`, sin período.

- [ ] **Step 1: Write the failing tests**

Al final del `describe("fotos del MIPER en lote (Fase B)", …)` de
`lib/__tests__/miper-snapshot-batch.test.ts`, agregar:

```ts
  it("medidas con el mismo created_at salen por id: el orden no queda al azar (arrastre de la Fase B)", async () => {
    const tie = (await createMiper({ worksiteId: "ws-g2", period: 2027, revisionReason: "MIPER para el desempate de medidas." }, author)).id
    const entry = await saveMiperEntry({ matrixId: tie, values: { hazard: "Empate de medidas", probability: 1, consequence: 2 } }, author)
    const same = new Date(Date.now() + 60_000).toISOString()
    // Al revés del orden por id: sin desempate, Postgres las devuelve en el orden que le acomode.
    await testDb.insert(schema.preventionRiskControls).values(["riskcontrol-tie-c", "riskcontrol-tie-b", "riskcontrol-tie-a"].map((id) => ({
      id, riskEntryId: entry.id, hierarchy: "administrative", description: `Medida ${id.slice(-1)}`, createdAt: same, updatedAt: same,
    })))
    const ids = (await buildMiperSnapshot(testDb, tie)).entries[0]!.controls.map((control) => control.id)
    expect(ids).toEqual(["riskcontrol-tie-a", "riskcontrol-tie-b", "riskcontrol-tie-c"])
    // El lote dice lo mismo que la foto suelta.
    expect((await buildMiperSnapshots(testDb, [tie])).get(tie)!.entries[0]!.controls.map((control) => control.id)).toEqual(ids)
  })
```

La MIPER `tie` no entra a la prueba dorada, que recorre sólo `[a, b, empty]`.

En `app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx`, reemplazar el test «la faena actual
queda marcada y no se puede elegir; las demás, sí» (`:57-62`) por:

```ts
  it("la faena actual queda marcada, sin período, y no se puede elegir; las demás, sí", async () => {
    listMiperWorksiteTargetsAction.mockResolvedValue({ ok: true, data: { targets: TARGETS } })
    render(<WorksiteSwitcher currentWorksiteId="ws-a" />)
    abrir()
    // La lista trae la MIPER principal de cada faena: estando en la vigente 2025 con un borrador 2026,
    // «Faena A · 2026 (actual)» decía un período que no es el que se mira.
    expect(await screen.findByRole("menuitem", { name: "Faena A (actual)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.queryByRole("menuitem", { name: /2026 \(actual\)/ })).toBeNull()
    expect(screen.getByRole("menuitem", { name: "Faena B · 2027" })).not.toHaveAttribute("aria-disabled")
  })
```

En `app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx`, en el test ««Cambiar de faena» marca
«(actual)» la faena de ESTA MIPER aunque la principal de la faena sea otra…», reemplazar:

```ts
    expect(await screen.findByRole("menuitem", { name: "Planta · 2027 (actual)" })).toHaveAttribute("aria-disabled", "true")
```

por:

```ts
    // Sin período: «Planta · 2027 (actual)» nombraba el borrador 2027 estando en la vigente 2026.
    expect(await screen.findByRole("menuitem", { name: "Planta (actual)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.queryByRole("menuitem", { name: /2027 \(actual\)/ })).toBeNull()
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
npm run test:fast -- "app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

Expected:
- PGlite: FAIL en «medidas con el mismo created_at…». Es lo esperable, porque Postgres devuelve los
  empates en el orden que le acomode (aquí, el de inserción: c, b, a). La prueba dorada sigue verde.
  Si el test nuevo pasara por azar, igual se agrega el desempate: con empate el orden no está
  definido.
- jsdom: FAIL, porque no encuentra los menuitems «Faena A (actual)» ni «Planta (actual)».

- [ ] **Step 3: Desempate por id**

En `lib/services/miper/snapshots.ts`, reemplazar:

```ts
  // Las medidas por JOIN a sus filas: el mismo conjunto que `riskEntryId IN (…)`, sin una lista de miles de ids.
  const controls = rows.length === 0 ? [] : await client.select({ control: preventionRiskControls }).from(preventionRiskControls)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
    .where(inArray(preventionRiskEntries.matrixId, found))
    .orderBy(asc(preventionRiskControls.createdAt))
```

por:

```ts
  // Las medidas por JOIN a sus filas: el mismo conjunto que `riskEntryId IN (…)`, sin una lista de miles de ids.
  // Desempate por id: las medidas de un riesgo duplicado o importado nacen en la misma transacción
  // (mismo `created_at`) y Postgres no garantiza su orden, que entra al `snapshotSha` de la ronda.
  const controls = rows.length === 0 ? [] : await client.select({ control: preventionRiskControls }).from(preventionRiskControls)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
    .where(inArray(preventionRiskEntries.matrixId, found))
    .orderBy(asc(preventionRiskControls.createdAt), asc(preventionRiskControls.id))
```

- [ ] **Step 4: «(actual)» sin período**

En `app/(app)/prevencion/miper/[id]/worksite-switcher.tsx`, reemplazar en el comentario:

```ts
 * - «(actual)» se decide por FAENA, no por MIPER: la lista trae la MIPER
 *   principal de cada faena, que no es la que se mira si se está en la vigente
 *   2026 con un borrador 2027.
```

por:

```ts
 * - «(actual)» se decide por FAENA, no por MIPER, y se muestra SIN período: la
 *   lista trae la MIPER principal de cada faena, que no es la que se mira si se
 *   está en la vigente 2026 con un borrador 2027 («Planta · 2027 (actual)»
 *   nombraba un período que no era el de la pantalla).
```

y la línea:

```tsx
          <DropdownMenuItem key={target.worksiteId} disabled>{labelOf(target)} (actual)</DropdownMenuItem>
```

por:

```tsx
          <DropdownMenuItem key={target.worksiteId} disabled>{target.worksiteName} (actual)</DropdownMenuItem>
```

- [ ] **Step 5: Retirar `listMipers` y `listMiperInbox`, y migrar sus aserciones a la portada**

En `lib/services/miper/queries.ts`:
1. Borrar entera la función `listMipers` (desde `export async function listMipers(` hasta su `}`)
   y entera `listMiperInbox` (desde `export async function listMiperInbox(` hasta el `}` que cierra
   su `return built.flatMap(…)`).
2. Quedan sin uso `gt`, `or` y `miperInboxReason`. Reemplazar la línea 1:

   ```ts
   import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm"
   ```

   por:

   ```ts
   import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
   ```

   y borrar la línea `import { miperInboxReason } from "@/lib/prevention/miper/inbox"`.
3. `buildRows` se queda: la usan la cadena de la faena (`getMiperWorkspace`) y la portada.

En `lib/__tests__/miper-queries.test.ts`, después de
`const q = await import("@/lib/services/miper/queries")` agregar:

```ts
const { listMiperPortfolio } = await import("@/lib/services/miper/portfolio")
```

y agregar a los imports estáticos:

```ts
import type { MiperAccess } from "@/lib/services/miper/shared"
```

Reemplazar los tres tests de `:53-76` («la lista cuenta filas por clasificación…», «la bandeja
muestra a la prevencionista…» y «quien envió la ronda no la ve…») por:

```ts
  it("la portada cuenta los graves de la faena y respeta el alcance", async () => {
    const { rows } = await listMiperPortfolio(author)
    expect(rows.map((row) => row.worksiteId)).toEqual(["ws-q"])
    expect(rows[0]).toMatchObject({ matrix: { id: matrixId }, intolerableCount: 1, importantCount: 0, completeness: { total: 2 } })
    // Quien no tiene la faena en su alcance ve sólo la suya, sin MIPER.
    expect((await listMiperPortfolio(outsider)).rows.map((row) => [row.worksiteId, row.matrix])).toEqual([["ws-other", null]])
  })
  it("«Requieren mi acción»: a la prevencionista, su borrador; a la Jefa, lo enviado", async () => {
    const acciones = async (access: MiperAccess) => (await listMiperPortfolio(access)).rows.find((row) => row.worksiteId === "ws-q")!.myActions
    expect((await acciones(author)).map((action) => action.reason)).toEqual(["Borrador"])
    expect(await acciones(jefa)).toEqual([])
    // Forzar el estado sin pasar por la completitud: la regla sólo mira `review_state` y la ronda.
    await testDb.update(schema.preventionRiskMatrices).set({ reviewState: "in_review" }).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await testDb.insert(schema.preventionRiskReviewRounds).values({ id: "rq", matrixId, roundNumber: 1, stage: "technical", snapshot: { header: {}, entries: [] }, snapshotSha256: "c".repeat(64), submittedByUserId: "u-q" })
    expect(await acciones(jefa)).toEqual([{ matrixId, period: 2026, reason: "Pendiente de tu revisión" }])
    expect((await listMiperPortfolio(jefa)).rows.find((row) => row.worksiteId === "ws-q")!.submittedByName).toBe("Prevencionista Q")
    // «Elaboró» del espacio de trabajo (Fase B): el nombre de quien envió la ronda abierta.
    expect((await q.getMiperWorkspace(matrixId, jefa)).openRound?.submittedByName).toBe("Prevencionista Q")
  })
  it("quien envió la ronda no la ve como «Pendiente de tu revisión» aunque tenga el permiso de revisar", async () => {
    // La ronda «rq» del test anterior la envió u-q. Con el permiso de revisar sumado, «Requieren mi
    // acción» sigue sin ofrecérsela: no puede revisar lo que ella misma envió (assertNotSubmitter).
    const autoraQueRevisa = { ...author, permissions: [...author.permissions, "prevention:risk:review"] }
    expect((await listMiperPortfolio(autoraQueRevisa)).rows.find((row) => row.worksiteId === "ws-q")!.myActions).toEqual([])
  })
```

En `lib/__tests__/miper-import.test.ts`:
1. En el comentario de cabecera, punto 4, reemplazar «y la matriz aparece en la bandeja como «Cambios
   sin enviar».» por «y la matriz aparece en «Requieren mi acción» de la portada como «Cambios sin
   enviar».».
2. Reemplazar `const { listMiperInbox } = await import("@/lib/services/miper/queries")` por:

   ```ts
   const { listMiperPortfolio } = await import("@/lib/services/miper/portfolio")
   ```

3. Después de la función `drainPostCommit`, agregar:

   ```ts
   /** «Requieren mi acción» de la portada para la autora, en una faena. */
   async function myActionsIn(worksiteId: string) {
     return (await listMiperPortfolio(author)).rows.find((row) => row.worksiteId === worksiteId)?.myActions ?? []
   }
   ```

4. Reemplazar:

   ```ts
       // Antes de importar, la bandeja no la tiene: no hay cambios sin enviar.
       expect((await listMiperInbox(author)).some((row) => row.id === live.id)).toBe(false)
   ```

   por:

   ```ts
       // Antes de importar, «Requieren mi acción» no la tiene: no hay cambios sin enviar.
       expect((await myActionsIn(WS_LIVE)).some((action) => action.matrixId === live.id)).toBe(false)
   ```

5. Reemplazar:

   ```ts
       const inbox = await listMiperInbox(author)
       expect(inbox.find((row) => row.id === live.id)?.inboxReason).toBe("Cambios sin enviar")
   ```

   por:

   ```ts
       expect((await myActionsIn(WS_LIVE)).find((action) => action.matrixId === live.id)?.reason).toBe("Cambios sin enviar")
   ```

Comentarios que nombraban lo retirado:
- En `lib/prevention/miper/inbox.ts`, reemplazar las líneas 2-4:

  ```ts
   * Qué espera una MIPER de una persona: la regla de la bandeja de antes
   * (`listMiperInbox`) y de «Requieren mi acción» en la portada por faena (Fase
   * B). Una sola regla para las dos pantallas.
  ```

  por:

  ```ts
   * Qué espera una MIPER de una persona: la regla de «Requieren mi acción» en la
   * portada por faena (Fase B, `listMiperPortfolio`). La cola «Mi trabajo» aplica
   * la misma regla en SQL (`operational-work-queue.ts`).
  ```

  y en la línea 8, «La bandeja de antes no lo hacía.» por «La bandeja de antes, retirada en la Fase
  C, no lo hacía.».
- En `lib/services/miper/portfolio.ts:46`, reemplazar «(lo que `listMipers` ya mostraba)» por «(lo que
  ya mostraba la lista de antes de la Fase B)».

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
npm run test:pglite -- lib/__tests__/miper-import.test.ts
npm run test:fast -- "app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
grep -rn "listMipers\b\|listMiperInbox" lib app e2e --include=*.ts --include=*.tsx
grep -rn "· [0-9]\{4\} (actual)" app e2e --include=*.ts --include=*.tsx
```

Expected:
- todo PASS, la prueba dorada incluida;
- los dos `grep` no devuelven nada.

- [ ] **Step 7: Puertas**

```bash
npm run typecheck
npm run lint -- lib/services/miper/snapshots.ts lib/services/miper/queries.ts lib/services/miper/portfolio.ts lib/prevention/miper/inbox.ts lib/__tests__/miper-snapshot-batch.test.ts lib/__tests__/miper-queries.test.ts lib/__tests__/miper-import.test.ts "app/(app)/prevencion/miper/[id]/worksite-switcher.tsx" "app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
```

- [ ] **Step 8: Commit**

```bash
git add lib/services/miper/snapshots.ts lib/services/miper/queries.ts lib/services/miper/portfolio.ts lib/prevention/miper/inbox.ts lib/__tests__/miper-snapshot-batch.test.ts lib/__tests__/miper-queries.test.ts lib/__tests__/miper-import.test.ts "app/(app)/prevencion/miper/[id]/worksite-switcher.tsx" "app/(app)/prevencion/miper/[id]/worksite-switcher.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"
git commit -m "fix(miper): las medidas con el mismo instante salen por id, se retira la bandeja vieja y «Cambiar de faena» marca la actual sin período" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `isExisting` y la frecuencia en la foto y en el guardado de la medida

**Files:**
- Modify: `lib/prevention/miper/snapshot.ts:13-16` (tipo) y `:77-79` (`controlsKey`)
- Test: `lib/prevention/miper/snapshot.test.ts`
- Modify: `lib/services/miper/snapshots.ts:111-114` (`snapshotOf`, la medida)
- Modify: `lib/__tests__/miper-snapshot-batch.test.ts` (la prueba dorada quita las dos claves nuevas
  antes de comparar)
- Modify: `lib/validation/prevention-module/miper.ts:81-87`
- Test: `lib/validation/prevention-module/miper.test.ts`
- Modify: `lib/services/miper/entries.ts:7` (import) y `:171-206` (`saveMiperControl`)
- Test: `lib/__tests__/miper-entries.test.ts`

**Interfaces:**
- Consumes: el desempate de la Task 1 (no lo toca).
- Produces:
  - `MiperControlSnapshot` gana `isExisting?: boolean` y `verificationFrequency?: string | null`
    (opcionales: una foto sellada antes de la Fase C no los trae). Las fotos nuevas los llevan
    **siempre** y **al final** de cada medida, después de `status`.
  - `controlsKey` (privada) los compara con `?? false` / `?? null`: una foto vieja contra la viva
    equivalente no marca cambios.
  - `miperControlSaveSchema.values` gana `isExisting?: boolean` y
    `verificationFrequency?: string | null` (`trim`, máx. 120).
  - `saveMiperControl`:
    - una existente se guarda con `due_date = NULL`; una por implementar, con
      `verification_frequency = NULL`;
    - si el pedido no trae `isExisting` o la frecuencia, se conservan los de la medida (nueva: por
      implementar);
    - el historial `control_created` lleva `isExisting` y `verificationFrequency` en `after`, y
      `control_updated` los lleva en `before` y en `after`.
  - Las Tasks 3, 4, 5 y 8 leen `control.isExisting ?? false` y `control.verificationFrequency ?? null`.

- [ ] **Step 1: Write the failing tests**

Al final del `describe("diffSnapshots", …)` de `lib/prevention/miper/snapshot.test.ts`, agregar:

```ts
  it("una foto sellada antes de la Fase C, sin isExisting ni frecuencia, no marca cambios contra la viva equivalente", () => {
    // `entry()` arma la medida sin las dos claves: es la forma de una foto sellada antes de la Fase C.
    const sealed: MiperSnapshot = { header, entries: [entry("e1")] }
    const live: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: false, verificationFrequency: null })) })] }
    expect(diffSnapshots(sealed, live)).toEqual({ headerFields: [], entries: [], hasChanges: false })
  })

  it("marcar una medida como existente, o cambiar su frecuencia, es un cambio de «Medidas de control»", () => {
    const pending: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: false, verificationFrequency: null })) })] }
    const existing: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: true, verificationFrequency: "Trimestral" })) })] }
    const monthly: MiperSnapshot = { header, entries: [entry("e1", { controls: entry("e1").controls.map((control) => ({ ...control, isExisting: true, verificationFrequency: "Mensual" })) })] }
    expect(diffSnapshots(pending, existing).entries).toEqual([{ kind: "modified", entryId: "e1", rowNumber: 1, fields: ["controls"] }])
    expect(diffSnapshots(existing, monthly).entries).toEqual([{ kind: "modified", entryId: "e1", rowNumber: 1, fields: ["controls"] }])
  })
```

En `lib/validation/prevention-module/miper.test.ts`, agregar `miperControlSaveSchema` al import de
`./miper` y, al final del `describe`:

```ts
  it("medida: «¿ya está implementada?» y su frecuencia son opcionales y acotados (Fase C)", () => {
    const base = { matrixId: "m1", entryId: "e1", values: { hierarchy: "ppe", description: "Uso de casco" } }
    expect(miperControlSaveSchema.safeParse(base).success).toBe(true)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, isExisting: true, verificationFrequency: "Trimestral" } }).success).toBe(true)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, isExisting: false, verificationFrequency: null } }).success).toBe(true)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, verificationFrequency: "x".repeat(121) } }).success).toBe(false)
    expect(miperControlSaveSchema.safeParse({ ...base, values: { ...base.values, isExisting: "sí" } }).success).toBe(false)
  })
```

En `lib/__tests__/miper-entries.test.ts`:
- después de `const svc = await import("@/lib/services/miper/entries")`, agregar
  `const { buildMiperSnapshot } = await import("@/lib/services/miper/snapshots")`;
- al final del `describe("filas de la matriz", …)`, agregar:

```ts
  it("medida existente (D5): guarda la frecuencia y no el plazo; editarla sin decirlo la conserva; el historial lleva antes y después", async () => {
    const entry = await svc.saveMiperEntry({ matrixId, values: { hazard: "Caída al mismo nivel", probability: 2, consequence: 2 } }, author)
    const created = await svc.saveMiperControl({ matrixId, entryId: entry.id, values: {
      hierarchy: "administrative", description: "Charla de inicio de turno", responsibleName: "Supervisor de turno",
      isExisting: true, verificationFrequency: " Trimestral ", dueDate: "2026-12-31",
    } }, author)
    const stored = async () => (await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.id, created.id)))[0]!
    // Una existente no lleva plazo aunque el pedido lo traiga: se verifica con su frecuencia.
    expect(await stored()).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null, status: "proposed" })

    // Un llamador que no manda «¿ya está implementada?» ni la frecuencia no la convierte en pendiente.
    await svc.saveMiperControl({ matrixId, entryId: entry.id, controlId: created.id, expectedVersion: 1, values: {
      hierarchy: "administrative", description: "Charla de inicio de turno firmada", responsibleName: "Supervisor de turno",
    } }, author)
    expect(await stored()).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null, version: 2 })

    // Pasarla a «por implementar»: lleva plazo y pierde la frecuencia.
    await svc.saveMiperControl({ matrixId, entryId: entry.id, controlId: created.id, expectedVersion: 2, values: {
      hierarchy: "administrative", description: "Charla de inicio de turno firmada", responsibleName: "Supervisor de turno",
      isExisting: false, verificationFrequency: "Trimestral", dueDate: "2026-11-30",
    } }, author)
    expect(await stored()).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30", version: 3 })

    const log = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, matrixId))
    const states = log
      .map((row) => ({ before: JSON.parse(row.oldState ?? "{}") as Record<string, unknown>, after: JSON.parse(row.newState ?? "{}") as Record<string, unknown> }))
      .filter(({ after }) => after.objectId === created.id)
    expect(states.find(({ after }) => after.changeType === "control_created")!.after).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    const toPending = states.find(({ after }) => after.changeType === "control_updated" && after.isExisting === false)!
    expect(toPending.before).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(toPending.after).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })

    // La foto viva lleva las dos claves, al final de la medida.
    const control = (await buildMiperSnapshot(testDb, matrixId)).entries.find((item) => item.id === entry.id)!.controls[0]!
    expect(control).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })
    expect(Object.keys(control).slice(-2)).toEqual(["isExisting", "verificationFrequency"])
  })
```

En `lib/__tests__/miper-snapshot-batch.test.ts`, la copia literal `legacyBuildMiperSnapshot` **no se
toca**. Cambian las aserciones:
1. Al final del comentario de cabecera (antes de ` */`), agregar:

   ```ts
    *
    * Fase C (D5): la foto suma `isExisting` y `verificationFrequency` AL FINAL de
    * cada medida. La prueba dorada sigue comparando byte a byte con la copia
    * literal de antes, quitando sólo esas dos claves (`sinClavesFaseC`), y afirma
    * aparte que son las dos últimas: así se sabe que nada más cambió de lugar.
   ```

2. Después de la función `legacyBuildMiperSnapshot`, agregar:

   ```ts
   /** La foto sin las dos claves que la Fase C agrega al final de cada medida. Quitar claves no mueve las demás. */
   function sinClavesFaseC(snapshot: MiperSnapshot): MiperSnapshot {
     return {
       ...snapshot,
       entries: snapshot.entries.map((entry) => ({
         ...entry,
         controls: entry.controls.map(({ isExisting: _existing, verificationFrequency: _frequency, ...control }) => control),
       })),
     }
   }
   ```

3. Reemplazar el test «PRUEBA DORADA: buildMiperSnapshot da la misma foto que antes, byte a byte
   (JSON y SHA)» por:

   ```ts
     it("PRUEBA DORADA: buildMiperSnapshot da la misma foto que antes, byte a byte (JSON y SHA), salvo las dos claves de la Fase C al final de cada medida", async () => {
       for (const id of [a, b, empty]) {
         const before = await legacyBuildMiperSnapshot(testDb, id)
         const after = await buildMiperSnapshot(testDb, id)
         expect(JSON.stringify(sinClavesFaseC(after))).toBe(JSON.stringify(before))
         expect(snapshotSha(sinClavesFaseC(after))).toBe(snapshotSha(before))
         for (const control of after.entries.flatMap((entry) => entry.controls)) {
           expect(Object.keys(control).slice(-2)).toEqual(["isExisting", "verificationFrequency"])
         }
       }
     })
   ```

4. En el test «el lote arma cada foto igual que una por una…», reemplazar
   `expect(JSON.stringify(batch.get(id))).toBe(JSON.stringify(await legacyBuildMiperSnapshot(testDb, id)))`
   por:

   ```ts
         expect(JSON.stringify(sinClavesFaseC(batch.get(id)!))).toBe(JSON.stringify(await legacyBuildMiperSnapshot(testDb, id)))
   ```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- lib/prevention/miper/snapshot.test.ts lib/validation/prevention-module/miper.test.ts
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
```

Expected:
- `snapshot.test.ts`: FAIL en «marcar una medida como existente…», porque `controlsKey` no mira las
  claves nuevas. «una foto sellada…» ya pasa, y tiene que seguir pasando.
- `miper.test.ts`: FAIL, porque `isExisting: "sí"` se acepta (el esquema no conoce la clave y la
  descarta).
- `miper-entries`: FAIL, porque `isExisting` se guarda `false`.
- `miper-snapshot-batch`: FAIL en la prueba dorada, porque las dos últimas claves son
  `["dueDate", "status"]`.

- [ ] **Step 3: La foto**

En `lib/prevention/miper/snapshot.ts`, reemplazar:

```ts
export type MiperControlSnapshot = {
  id: string; hierarchy: ControlHierarchy; description: string
  responsibleUserId: string | null; responsibleName: string | null; dueDate: string | null; status: string
}
```

por:

```ts
export type MiperControlSnapshot = {
  id: string; hierarchy: ControlHierarchy; description: string
  responsibleUserId: string | null; responsibleName: string | null; dueDate: string | null; status: string
  /**
   * D5 (Fase C). Opcionales porque una foto sellada antes de la Fase C no los
   * trae, y una foto sellada no se recalcula. Ausente = por implementar y sin
   * frecuencia, la regla de entonces: así los leen `controlsKey`, la
   * completitud y el Excel. Las fotos nuevas los llevan siempre, al final.
   */
  isExisting?: boolean
  verificationFrequency?: string | null
}
```

y:

```ts
function controlsKey(controls: MiperControlSnapshot[]): string {
  return JSON.stringify([...controls].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, c.hierarchy, c.description, c.responsibleUserId, c.responsibleName, c.dueDate, c.status]))
}
```

por:

```ts
/** Una foto sellada antes de la Fase C no trae `isExisting` ni la frecuencia: se normalizan para que no parezcan cambios. */
function controlsKey(controls: MiperControlSnapshot[]): string {
  return JSON.stringify([...controls].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [
    c.id, c.hierarchy, c.description, c.responsibleUserId, c.responsibleName, c.dueDate, c.status,
    c.isExisting ?? false, c.verificationFrequency ?? null,
  ]))
}
```

En `lib/services/miper/snapshots.ts` (`snapshotOf`), reemplazar:

```ts
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => ({
        id: control.id, hierarchy: control.hierarchy as ControlHierarchy, description: control.description,
        responsibleUserId: control.responsibleUserId, responsibleName: control.responsibleSnapshot, dueDate: control.dueDate, status: control.status,
      })),
```

por:

```ts
      // Fase C: `isExisting` y la frecuencia van AL FINAL, después de `status`. Así
      // todo lo anterior sigue en el mismo orden de claves que hashea `snapshotSha`.
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => ({
        id: control.id, hierarchy: control.hierarchy as ControlHierarchy, description: control.description,
        responsibleUserId: control.responsibleUserId, responsibleName: control.responsibleSnapshot, dueDate: control.dueDate, status: control.status,
        isExisting: control.isExisting, verificationFrequency: control.verificationFrequency,
      })),
```

- [ ] **Step 4: El esquema**

En `lib/validation/prevention-module/miper.ts`, dentro de `miperControlSaveSchema`, reemplazar:

```ts
    dueDate: isoDate.nullable().optional(),
  }),
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })
```

por:

```ts
    dueDate: isoDate.nullable().optional(),
    /* D5 (Fase C): una medida ya implementada se verifica con una frecuencia y no
     * lleva plazo. Opcionales: sin ellos se conserva lo que la medida ya tenía. */
    isExisting: z.boolean().optional(),
    verificationFrequency: z.string().trim().max(120, "La frecuencia admite hasta 120 caracteres.").nullable().optional(),
  }),
}).refine((value) => !value.controlId || value.expectedVersion !== undefined, { path: ["expectedVersion"], message: "Falta la versión de la medida; recarga la matriz." })
```

- [ ] **Step 5: El guardado**

En `lib/services/miper/entries.ts`, reemplazar la línea 7:

```ts
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
```

por:

```ts
import { miperControlRefSchema, miperControlSaveSchema, miperEntryRefSchema, miperEntrySaveSchema, type MiperControlSaveInput, type MiperEntryValues } from "@/lib/validation/prevention-module/miper"
```

y reemplazar la función `saveMiperControl` entera (`:171-206`) por:

```ts
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
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, EDIT, matrix.worksiteId)
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
      const [created] = await tx.insert(preventionRiskControls).values({ id: `riskcontrol-${nanoid()}`, riskEntryId: entry.id, ...values, status: "proposed", createdAt: now, updatedAt: now })
        .returning({ id: preventionRiskControls.id, version: preventionRiskControls.version })
      await touchMatrix(tx, matrix.id, now)
      await miperHistory(tx, { matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: created!.id, changeType: "control_created", after: { entryId: entry.id, ...values }, actorUserId: access.userId, actingAs: EDIT })
      return created!
    }
    const [current] = await tx.select().from(preventionRiskControls).where(and(eq(preventionRiskControls.id, data.controlId), eq(preventionRiskControls.riskEntryId, entry.id))).limit(1)
    if (!current) throw new RiskLegalDomainError("La medida no existe en esta fila; recarga la matriz.")
    if (current.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE_CONTROL)
    const values = controlColumns(data.values, responsible, current)
    const [updated] = await tx.update(preventionRiskControls).set({ ...values, version: current.version + 1, updatedAt: now })
      .where(and(eq(preventionRiskControls.id, current.id), eq(preventionRiskControls.version, current.version)))
      .returning({ id: preventionRiskControls.id, version: preventionRiskControls.version })
    if (!updated) throw new RiskLegalDomainError(STALE_CONTROL)
    await touchMatrix(tx, matrix.id, now)
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "control", objectId: current.id, changeType: "control_updated",
      before: {
        hierarchy: current.hierarchy, description: current.description, responsibleUserId: current.responsibleUserId, responsibleSnapshot: current.responsibleSnapshot,
        isExisting: current.isExisting, verificationFrequency: current.verificationFrequency, dueDate: current.dueDate,
      },
      after: values, actorUserId: access.userId, actingAs: EDIT,
    })
    return updated
  })
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test:fast -- lib/prevention/miper/snapshot.test.ts lib/validation/prevention-module/miper.test.ts lib/prevention/miper/completeness.test.ts
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
npm run test:pglite -- lib/__tests__/miper-snapshot-service.test.ts
npm run test:pglite -- lib/__tests__/miper-workflow.test.ts
```

Expected: PASS. `completeness.test.ts` y `miper-workflow` no cambian todavía: sirven para confirmar
que las medidas sin `isExisting` siguen leyéndose como antes.

- [ ] **Step 7: Puertas**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/snapshot.ts lib/prevention/miper/snapshot.test.ts lib/services/miper/snapshots.ts lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts lib/services/miper/entries.ts lib/__tests__/miper-entries.test.ts lib/__tests__/miper-snapshot-batch.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add lib/prevention/miper/snapshot.ts lib/prevention/miper/snapshot.test.ts lib/services/miper/snapshots.ts lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts lib/services/miper/entries.ts lib/__tests__/miper-entries.test.ts lib/__tests__/miper-snapshot-batch.test.ts
git commit -m "feat(miper): la medida dice si ya está implementada; la foto y el guardado llevan isExisting y la frecuencia de verificación" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Completitud D5 y regla crítica; «Atención requerida» con la misma regla

**Files:**
- Modify: `lib/prevention/miper/completeness.ts:54-69`
- Test: `lib/prevention/miper/completeness.test.ts`
- Modify: `lib/services/prevention-attention.ts:290-300` (comentario), `:359-370` (predicado) y
  `:405-410` (títulos)
- Test: `lib/__tests__/miper-work-queue.test.ts` (un test en «atención de Prevención — tipo MIPER»)

**Interfaces:**
- Consumes: `MiperControlSnapshot.isExisting?` y `verificationFrequency?` (Task 2).
- Produces: `checkMiperCompleteness(snapshot, options)` con la misma firma y estas reglas nuevas:
  - el error `dueDate` por medida (`controlId` puesto) sólo sale para `!(isExisting ?? false)`, con
    el mensaje «La medida por implementar necesita un plazo.»;
  - el error de riesgo `dueDate` (sin `controlId`) sale cuando un **Importante no controlado**
    (`controlledStatus !== "yes"`) o un **Intolerable** con medidas no tiene **ninguna medida por
    implementar con responsable y plazo**. Los mensajes son «Un riesgo Importante no controlado
    exige una medida por implementar con responsable y plazo.» y «Un riesgo Intolerable exige una
    medida por implementar con responsable y plazo.».

  La portada (`portfolio.ts`), el espacio de trabajo, el envío a revisión (`workflow.ts`) y la Task 8
  leen esta misma función: ninguno cambia de código.
- «Atención requerida» lista los Importantes e Intolerables con el mismo criterio. Sus títulos pasan a
  «Riesgo Intolerable sin medida por implementar con responsable y plazo» y «Riesgo Importante sin
  medida por implementar con responsable y plazo».

- [ ] **Step 1: Write the failing tests**

Al final del `describe("completitud RE-04 (§5.1)", …)` de `lib/prevention/miper/completeness.test.ts`,
agregar:

```ts
  it("D5: una medida existente no pide plazo; una por implementar, sí (y una foto vieja se lee como por implementar)", () => {
    const moderate = row({ probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "partial" })
    const existing = { ...control, dueDate: null, isExisting: true, verificationFrequency: "Trimestral" }
    expect(errors({ header, entries: [{ ...moderate, controls: [existing] }] })).toEqual([])
    // Sin frecuencia también vale: D5 pide tipo, descripción y responsable.
    expect(errors({ header, entries: [{ ...moderate, controls: [{ ...existing, verificationFrequency: null }] }] })).toEqual([])
    expect(errors({ header, entries: [{ ...moderate, controls: [{ ...control, dueDate: null, isExisting: false }] }] }).map((i) => [i.field, i.message]))
      .toEqual([["dueDate", "La medida por implementar necesita un plazo."]])
    // `control` no trae `isExisting`: es la forma de una foto sellada antes de la Fase C.
    expect(errors({ header, entries: [{ ...moderate, controls: [{ ...control, dueDate: null }] }] }).map((i) => i.field)).toEqual(["dueDate"])
  })
  it("una medida existente sigue pidiendo responsable, salvo en un Tolerable", () => {
    const moderate = row({ probability: 2, consequence: 2, magnitude: 4, classification: "moderate", controlledStatus: "partial" })
    const existing = { ...control, dueDate: null, isExisting: true, responsibleName: null }
    expect(errors({ header, entries: [{ ...moderate, controls: [existing] }] }).map((i) => i.field)).toEqual(["responsible"])
    expect(errors({ header, entries: [row({ controlledStatus: "yes", controls: [existing] })] })).toEqual([])
  })
  it("regla crítica: un Importante no controlado y un Intolerable exigen una medida POR IMPLEMENTAR con responsable y plazo", () => {
    const important = row({ probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "partial" })
    const existing = { ...control, id: "c-ex", dueDate: null, isExisting: true, verificationFrequency: "Trimestral" }
    const toImplement = { ...control, id: "c-new", dueDate: "2026-12-31", isExisting: false }
    expect(errors({ header, entries: [{ ...important, controls: [existing] }] }).map((i) => [i.field, i.message]))
      .toEqual([["dueDate", "Un riesgo Importante no controlado exige una medida por implementar con responsable y plazo."]])
    expect(errors({ header, entries: [{ ...important, controls: [existing, toImplement] }] })).toEqual([])
    // Por implementar pero sin responsable: no cuenta, y además la medida pide su responsable.
    expect(errors({ header, entries: [{ ...important, controls: [existing, { ...toImplement, responsibleName: null }] }] }).map((i) => i.field))
      .toEqual(["dueDate", "responsible"])
    // Un Importante «Sí, controlado» con medidas existentes ya cumple.
    expect(errors({ header, entries: [{ ...important, controlledStatus: "yes", controls: [existing] }] })).toEqual([])
    const intolerable = row({ probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controlledStatus: "yes", controls: [existing] })
    expect(errors({ header, entries: [intolerable] }).map((i) => i.message)).toEqual(["Un riesgo Intolerable exige una medida por implementar con responsable y plazo."])
    expect(errors({ header, entries: [{ ...intolerable, controls: [existing, toImplement] }] })).toEqual([])
  })
```

En `lib/__tests__/miper-work-queue.test.ts`, dentro de `describe("atención de Prevención — tipo
MIPER", …)` y después del test «con la fuente apagada no agrega nada», agregar:

```ts
  it("la banda sin medida usa la regla de la completitud: cuenta un responsable escrito y no cuenta una medida existente (Fase C)", async () => {
    await testDb.insert(schema.preventionRiskEntries).values([
      // Intolerable cuya única medida YA EXISTE: no hay nada por implementar con responsable y plazo → aparece.
      { id: "entry-intol-existente", matrixId: "mx-in", rowNumber: 4, hazardCode: "FIS-03", risk: "Caída desde la batea", probability: 4, consequence: 4, controlledStatus: "partial" },
      // Importante no controlado con una medida por implementar de responsable ESCRITO y plazo → no aparece.
      { id: "entry-imp-texto", matrixId: "mx-in", rowNumber: 5, hazardCode: "QUI-02", risk: "Inhalación de polvo", probability: 4, consequence: 2, controlledStatus: "no" },
      // Importante «Sí, controlado» con una medida existente: la completitud no le pide más → no aparece.
      { id: "entry-imp-controlado", matrixId: "mx-in", rowNumber: 6, hazardCode: "ERG-01", risk: "Sobreesfuerzo", probability: 4, consequence: 2, controlledStatus: "yes" },
    ])
    await testDb.insert(schema.preventionRiskControls).values([
      { id: "ctl-existente", riskEntryId: "entry-intol-existente", description: "Barandas en la batea", hierarchy: "engineering", isExisting: true, verificationFrequency: "Trimestral", responsibleSnapshot: "Supervisor de turno" },
      { id: "ctl-texto", riskEntryId: "entry-imp-texto", description: "Humectación del área", hierarchy: "engineering", responsibleSnapshot: "Jefe de faena", dueDate: "2026-12-31" },
      { id: "ctl-controlado", riskEntryId: "entry-imp-controlado", description: "Pausas activas", hierarchy: "administrative", isExisting: true, verificationFrequency: "Mensual", responsibleSnapshot: "Supervisor de turno" },
    ])
    const items = await getPreventionAttention({
      worksiteIds: [WS_IN], includeActions: false, includeEvaluations: false, includePpa: false, includeMiper: true, limit: 50,
    })
    const ids = items.filter((item) => item.kind === "miper").map((item) => item.id)
    expect(ids).toContain("miper_entry:entry-intol-existente")
    expect(ids).not.toContain("miper_entry:entry-imp-texto")
    expect(ids).not.toContain("miper_entry:entry-imp-controlado")
    expect(items.find((item) => item.id === "miper_entry:entry-intol-existente")!.title).toBe("Riesgo Intolerable sin medida por implementar con responsable y plazo")
    // Lo de antes no cambia: el Intolerable sin medidas y el Importante cuya medida no tiene plazo siguen.
    expect(ids).toEqual(expect.arrayContaining(["miper_entry:entry-intol", "miper_entry:entry-important"]))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- lib/prevention/miper/completeness.test.ts
npm run test:pglite -- lib/__tests__/miper-work-queue.test.ts
```

Expected:
- `completeness.test.ts`: FAIL en los tres tests nuevos (la existente pide plazo, los mensajes no
  dicen «por implementar», la existente cuenta como «asignada»);
- `miper-work-queue`: FAIL en el nuevo (`entry-imp-texto` aparece porque el responsable escrito no
  cuenta; el título no dice «por implementar»).

- [ ] **Step 3: La completitud**

En `lib/prevention/miper/completeness.ts`, reemplazar:

```ts
    const assigned = entry.controls.filter((control) => control.dueDate && (control.responsibleUserId || control.responsibleName))
    if (cls === "important" && entry.controlledStatus !== "yes" && entry.controls.length > 0 && assigned.length === 0) {
      err("dueDate", "Un riesgo Importante no controlado exige una medida con responsable y plazo.")
    }
    if (cls === "intolerable") {
      if (entry.controls.length > 0 && assigned.length === 0) err("dueDate", "Un riesgo Intolerable exige una medida con responsable y plazo.")
```

por:

```ts
    // D5 (Fase C): sólo una medida POR IMPLEMENTAR lleva plazo; una existente se
    // verifica con su frecuencia. Una foto anterior a la Fase C no trae
    // `isExisting`: se lee como por implementar, que era la regla de entonces.
    // Regla crítica (decisión del usuario, 2026-10-02): Importante no controlado e
    // Intolerable exigen al menos una medida POR IMPLEMENTAR con responsable y
    // plazo; las existentes no la reemplazan.
    const assigned = entry.controls.filter((control) => !(control.isExisting ?? false) && control.dueDate && (control.responsibleUserId || control.responsibleName))
    if (cls === "important" && entry.controlledStatus !== "yes" && entry.controls.length > 0 && assigned.length === 0) {
      err("dueDate", "Un riesgo Importante no controlado exige una medida por implementar con responsable y plazo.")
    }
    if (cls === "intolerable") {
      if (entry.controls.length > 0 && assigned.length === 0) err("dueDate", "Un riesgo Intolerable exige una medida por implementar con responsable y plazo.")
```

y:

```ts
      if (!control.dueDate) err("dueDate", "La medida necesita un plazo.", control.id)
```

por:

```ts
      if (!(control.isExisting ?? false) && !control.dueDate) err("dueDate", "La medida por implementar necesita un plazo.", control.id)
```

Actualizar también el comentario de cabecera del archivo. Reemplazar:

```ts
 * advertencias sólo se muestran (el Intolerable siempre lleva su advertencia
 * crítica, aunque esté completo).
 */
```

por:

```ts
 * advertencias sólo se muestran (el Intolerable siempre lleva su advertencia
 * crítica, aunque esté completo). Fase C: una medida existente (D5) no lleva
 * plazo, y la regla crítica pide una medida por implementar.
 */
```

- [ ] **Step 4: «Atención requerida»**

En `lib/services/prevention-attention.ts`, reemplazar:

```ts
        // «Importante sin medida» y «medida sin responsable o plazo» son el
        // mismo predicado: no tener NINGUNA medida completa. Una actividad
        // retirada ya no ejecuta nada, así que no cuenta como medida.
        sql`NOT EXISTS (
          SELECT 1 FROM ${preventionRiskControls}
          WHERE ${preventionRiskControls.riskEntryId} = ${preventionRiskEntries.id}
            AND ${preventionRiskControls.status} <> 'retired'
            AND ${preventionRiskControls.responsibleUserId} IS NOT NULL
            AND ${preventionRiskControls.dueDate} IS NOT NULL
        )`,
```

por:

```ts
        // El mismo criterio que la completitud (`completeness.ts`, Fase C): le
        // falta una medida POR IMPLEMENTAR con responsable —usuario o escrito— y
        // plazo. Un Importante «Sí, controlado» con alguna medida ya cumple. Una
        // medida retirada ya no ejecuta nada, así que no cuenta.
        sql`NOT EXISTS (
          SELECT 1 FROM ${preventionRiskControls}
          WHERE ${preventionRiskControls.riskEntryId} = ${preventionRiskEntries.id}
            AND ${preventionRiskControls.status} <> 'retired'
            AND (
              (${preventionRiskControls.isExisting} = false
                AND ${preventionRiskControls.dueDate} IS NOT NULL
                AND (${preventionRiskControls.responsibleUserId} IS NOT NULL OR btrim(coalesce(${preventionRiskControls.responsibleSnapshot}, '')) <> ''))
              OR (${preventionRiskEntries.classification} = 'important' AND ${preventionRiskEntries.controlledStatus} = 'yes')
            )
        )`,
```

y los títulos:

```ts
        ? "Riesgo Intolerable sin medida con responsable y plazo"
        : "Riesgo Importante sin medida con responsable y plazo",
```

por:

```ts
        ? "Riesgo Intolerable sin medida por implementar con responsable y plazo"
        : "Riesgo Importante sin medida por implementar con responsable y plazo",
```

En el comentario encima de `async function miperAttentionItems(`, reemplazar:

```ts
 *  · Una fila Intolerable o Importante sin ninguna medida con responsable y
 *    plazo es exactamente el defecto que deja la matriz sin programa.
```

por:

```ts
 *  · Una fila Intolerable o Importante sin ninguna medida POR IMPLEMENTAR con
 *    responsable y plazo (la regla de la completitud, Fase C) es exactamente el
 *    defecto que deja la matriz sin programa.
```

y en el comentario de `includeMiper` (dentro de los argumentos de `getPreventionAttention`),
reemplazar:

```ts
   * bandas Intolerables o Importantes sin ninguna medida con responsable y
   * plazo. Mismo interruptor que las demás fuentes: lo enciende quien tiene
```

por:

```ts
   * bandas Intolerables o Importantes sin ninguna medida por implementar con
   * responsable y plazo. Mismo interruptor que las demás fuentes: lo enciende quien tiene
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:fast -- lib/prevention/miper/completeness.test.ts lib/prevention/miper/next-step.test.ts lib/prevention/miper/entry-navigation.test.ts
npm run test:pglite -- lib/__tests__/miper-work-queue.test.ts
npm run test:pglite -- lib/__tests__/miper-portfolio.test.ts
npm run test:pglite -- lib/__tests__/miper-workflow.test.ts
```

Expected: PASS. La portada y el envío leen `checkMiperCompleteness`; sus medidas sembradas no traen
`isExisting`, así que siguen como antes.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/completeness.ts lib/prevention/miper/completeness.test.ts lib/services/prevention-attention.ts lib/__tests__/miper-work-queue.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/prevention/miper/completeness.ts lib/prevention/miper/completeness.test.ts lib/services/prevention-attention.ts lib/__tests__/miper-work-queue.test.ts
git commit -m "feat(miper): el plazo es sólo para lo que está por implementar y los graves exigen una medida por implementar con responsable y plazo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Excel RE-04: una línea por medida en MEDIDA, RESPONSABLE y PLAZOS

**Files:**
- Modify: `lib/reports/miper-workbook.ts:305-317`
- Test: `lib/reports/miper-workbook.test.ts`

**Interfaces:**
- Consumes: `MiperControlSnapshot.isExisting?` y `verificationFrequency?` (Task 2).
- Produces: en la hoja «RE-04 IPER», las celdas R (MEDIDA DE CONTROL), T (RESPONSABLE) y U (PLAZOS)
  de cada riesgo tienen **el mismo número de líneas**, y la línea N es la medida N:
  - R: `«<CONTROL_HIERARCHY_LABEL>: <descripción>»`, con los saltos de línea de la descripción
    aplanados a un espacio;
  - T: `responsibleName`, o «—»;
  - U: la frecuencia de verificación si es existente, la fecha (`formatDate`) si es por
    implementar, y «—» si falta.

  La Task 6 vuelve a leer este formato al importar un libro exportado.
- `alignedDetail` (constante de prueba en `miper-workbook.test.ts`): la usa también la Task 6.

- [ ] **Step 1: Write the failing tests**

En `lib/reports/miper-workbook.test.ts`, en el test «traduce la clasificación, las medidas con su
jerarquía y el estado de control», reemplazar:

```ts
    expect(sheet.getCell("T14").value).toBe("Supervisor de patio")
    expect(sheet.getCell("U14").value).toBe("30-06-2026")
```

por:

```ts
    // Una línea por medida en las tres columnas (Fase C): la segunda medida no tiene plazo y lo dice.
    expect(sheet.getCell("T14").value).toBe("Supervisor de patio\nSupervisor de patio")
    expect(sheet.getCell("U14").value).toBe("30-06-2026\n—")
```

Después de la constante `detail`, agregar:

```ts
/**
 * Fase C: una fila con una medida por implementar, una existente con frecuencia
 * y una existente sin frecuencia (con un plazo viejo que ya no aplica). La
 * descripción de la segunda trae un salto de línea, como sale de un `Textarea`.
 */
const alignedSnapshot: MiperSnapshot = {
  ...snapshot,
  entries: [{
    ...snapshot.entries[0]!,
    controls: [
      { id: "ctl-a", hierarchy: "engineering", description: "Topes de descarga", responsibleUserId: null, responsibleName: "Supervisor de patio", dueDate: "2026-06-30", status: "proposed", isExisting: false, verificationFrequency: null },
      { id: "ctl-b", hierarchy: "administrative", description: "Charla de inicio\nde turno", responsibleUserId: null, responsibleName: null, dueDate: null, status: "proposed", isExisting: true, verificationFrequency: "Trimestral" },
      { id: "ctl-c", hierarchy: "ppe", description: "Casco y barbiquejo", responsibleUserId: null, responsibleName: "Jefe de faena", dueDate: "2026-12-31", status: "proposed", isExisting: true, verificationFrequency: null },
    ],
  }],
}
const alignedDetail = { ...detail, version: { ...detail.version, snapshot: alignedSnapshot } } as MiperVersionDetail
```

y, al final del `describe` principal:

```ts
  it("una línea por medida en MEDIDA, RESPONSABLE y PLAZOS: frecuencia si es existente, fecha si es por implementar (Fase C)", async () => {
    const workbook = await buildMiperWorkbook(alignedDetail, null)
    const sheet = workbook.getWorksheet("RE-04 IPER")!
    expect(sheet.getCell("R14").value).toBe(
      "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de inicio de turno\nV. Elementos de protección personal: Casco y barbiquejo",
    )
    expect(sheet.getCell("T14").value).toBe("Supervisor de patio\n—\nJefe de faena")
    expect(sheet.getCell("U14").value).toBe("30-06-2026\nTrimestral\n—")
  })

  it("una descripción con salto de línea no corre las líneas: las tres columnas tienen tantas líneas como medidas", async () => {
    const workbook = await buildMiperWorkbook(alignedDetail, null)
    const sheet = workbook.getWorksheet("RE-04 IPER")!
    const lines = (cell: string) => String(sheet.getCell(cell).value).split("\n").length
    expect([lines("R14"), lines("T14"), lines("U14")]).toEqual([3, 3, 3])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/reports/miper-workbook.test.ts`

Expected: FAIL. Hoy T14 es «Supervisor de patio» (deduplicado), U14 es «30-06-2026» (sin la vacía) y
R14 tiene cuatro líneas, por el salto de la descripción.

- [ ] **Step 3: Write minimal implementation**

En `lib/reports/miper-workbook.ts`, después de `const HEADER_FILL = "FF1F3864"`, agregar:

```ts
/** Marca de dato faltante en las columnas de medidas: mantiene la línea N de las tres en la medida N. */
const MISSING = "—"
```

y reemplazar:

```ts
  for (const entry of snapshot.entries) {
    const measures = entry.controls.map((control) => `${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description}`).join("\n")
    const responsible = [...new Set(entry.controls.map((control) => control.responsibleName).filter(Boolean))].join("\n")
    const deadlines = entry.controls.map((control) => (control.dueDate ? formatDate(control.dueDate) : "")).filter(Boolean).join("\n")
```

por:

```ts
  for (const entry of snapshot.entries) {
    // Fase C: una línea por medida en MEDIDA, RESPONSABLE y PLAZOS, para que la
    // línea N de las tres sea la misma medida. Antes RESPONSABLE se deduplicaba y
    // PLAZOS descartaba las vacías, y las columnas se desalineaban. PLAZOS es la
    // frecuencia de verificación de una medida existente o la fecha de una por
    // implementar (D5). Una foto anterior a la Fase C no trae `isExisting`: por
    // implementar, la regla de entonces.
    const lines = entry.controls.map((control) => ({
      measure: `${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description.replace(/\s*\n\s*/g, " ")}`,
      responsible: control.responsibleName ?? MISSING,
      deadline: (control.isExisting ?? false)
        ? control.verificationFrequency ?? MISSING
        : control.dueDate ? formatDate(control.dueDate) : MISSING,
    }))
    const measures = lines.map((line) => line.measure).join("\n")
    const responsible = lines.map((line) => line.responsible).join("\n")
    const deadlines = lines.map((line) => line.deadline).join("\n")
```

En el `sheet.addRow([...])` de abajo, reemplazar el último elemento `deadlines,` por `safe(deadlines),`.
La frecuencia la escribe una persona y pasa por la misma neutralización de fórmulas que el resto.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- lib/reports/miper-workbook.test.ts "app/api/prevencion/miper/[id]/export/route.test.ts"`

Expected: PASS.

- [ ] **Step 5: Puertas**

```bash
npm run typecheck
npm run lint -- lib/reports/miper-workbook.ts lib/reports/miper-workbook.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/reports/miper-workbook.ts lib/reports/miper-workbook.test.ts
git commit -m "fix(miper): el Excel RE-04 alinea medida, responsable y plazo, y PLAZOS lleva la frecuencia de las medidas existentes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Formulario y tarjeta de la medida: «¿Ya está implementada?»

**Files:**
- Modify: `app/(app)/prevencion/miper/[id]/control-form.tsx` (reescrito)
- Test: `app/(app)/prevencion/miper/[id]/control-form.test.tsx`
- Modify: `app/(app)/prevencion/miper/[id]/control-card.tsx:41-43`
- Test: `app/(app)/prevencion/miper/[id]/control-card.test.tsx`

**Interfaces:**
- Consumes: `MiperControlSnapshot.isExisting?` y `verificationFrequency?` (Task 2), y
  `saveMiperControlAction` con `values.isExisting` / `values.verificationFrequency` (Task 2).
- Produces:
  - `ControlForm`, con las mismas props. Agrega el grupo de radio «¿Ya está implementada?» con las
    tarjetas «Ya está implementada» y «Por implementar». Una medida nueva nace «Por implementar».
    - existente → campo «Frecuencia de verificación» (`textbox`), sin «Plazo de la medida»;
    - por implementar → «Plazo de la medida» (`DatePicker`).

    Envía siempre `isExisting`, `verificationFrequency` (`null` si es por implementar) y `dueDate`
    (`null` si es existente). Los nombres accesibles de antes no cambian: «Tipo de control»,
    «Descripción de la medida», «Nombre o cargo responsable», «Responsable de la medida» y «Plazo de
    la medida».
  - `ControlCard` muestra «Existente · verificación <frecuencia>» (o «… sin frecuencia») o «Por
    implementar · plazo <dd-mm-aaaa>» (o «… sin fecha»), y en otra línea «Responsable: …». La E2E de
    la Task 10 busca esos textos.

- [ ] **Step 1: Write the failing tests**

En `app/(app)/prevencion/miper/[id]/control-form.test.tsx`:
1. En el test «guardar envía la versión de la medida, avisa y cierra», reemplazar el `values` esperado:

   ```ts
         values: { hierarchy: "administrative", description: "Pausas activas", responsibleUserId: "u9", responsibleName: null, dueDate: "2026-10-30" },
   ```

   por:

   ```ts
         values: { hierarchy: "administrative", description: "Pausas activas", responsibleUserId: "u9", responsibleName: null, isExisting: false, verificationFrequency: null, dueDate: "2026-10-30" },
   ```

2. En «mientras guarda, los campos quedan deshabilitados», después de la aserción de «Responsable de
   la medida», agregar:

   ```ts
       expect(screen.getByRole("radio", { name: "Por implementar" })).toBeDisabled()
   ```

3. Al final del `describe`, agregar:

```ts
  it("una medida nace «Por implementar» con plazo; marcada como implementada pide la frecuencia y no el plazo (D5)", async () => {
    saveMiperControlAction.mockResolvedValueOnce({ ok: true, message: "Medida guardada", data: { id: "c2", version: 1 } })
    render(<ControlForm {...base} control={null} controlVersion={undefined} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole("radiogroup", { name: "¿Ya está implementada?" })).toBeTruthy()
    expect(screen.getByRole("radio", { name: "Por implementar" })).toBeChecked()
    expect(screen.getByRole("button", { name: /^Plazo de la medida/ })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Frecuencia de verificación" })).toBeNull()

    fireEvent.click(screen.getByRole("radio", { name: "Ya está implementada" }))
    expect(screen.queryByRole("button", { name: /^Plazo de la medida/ })).toBeNull()
    fireEvent.change(screen.getByRole("textbox", { name: "Frecuencia de verificación" }), { target: { value: " Trimestral " } })
    fireEvent.change(screen.getByRole("textbox", { name: "Descripción de la medida" }), { target: { value: "Charla de inicio de turno" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre o cargo responsable" }), { target: { value: "Supervisor de turno" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar medida" }))
    await waitFor(() => expect(saveMiperControlAction).toHaveBeenCalledTimes(1))
    expect(saveMiperControlAction.mock.calls[0]![0]).toMatchObject({
      matrixId: "m1", entryId: "e1",
      values: { hierarchy: "administrative", description: "Charla de inicio de turno", responsibleUserId: null, responsibleName: "Supervisor de turno", isExisting: true, verificationFrequency: "Trimestral", dueDate: null },
    })
  })

  it("al editar una medida existente llega marcada y con su frecuencia, y guardar la conserva", async () => {
    saveMiperControlAction.mockResolvedValueOnce({ ok: true, message: "Medida guardada", data: { id: "c1", version: 4 } })
    render(<ControlForm {...base} control={{ ...control, isExisting: true, verificationFrequency: "Mensual", dueDate: null }} controlVersion={3} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole("radio", { name: "Ya está implementada" })).toBeChecked()
    expect(screen.getByRole("textbox", { name: "Frecuencia de verificación" })).toHaveValue("Mensual")
    fireEvent.click(screen.getByRole("button", { name: "Guardar medida" }))
    await waitFor(() => expect(saveMiperControlAction).toHaveBeenCalledTimes(1))
    expect(saveMiperControlAction.mock.calls[0]![0].values).toMatchObject({ isExisting: true, verificationFrequency: "Mensual", dueDate: null })
  })
```

En `app/(app)/prevencion/miper/[id]/control-card.test.tsx`, reemplazar el test «muestra tipo,
responsable, plazo y actividades del programa» por:

```ts
  it("muestra tipo, «Por implementar · plazo», responsable y actividades del programa", () => {
    render(<ControlCard control={control} linkedActionNumbers={[3]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} />)
    expect(screen.getByText("V. Elementos de protección personal")).toBeTruthy()
    // `control` no trae `isExisting` (foto anterior a la Fase C): se lee como por implementar.
    expect(screen.getByText("Por implementar · plazo 30-10-2026")).toBeTruthy()
    expect(screen.getByText("Responsable: Supervisor")).toBeTruthy()
    expect(screen.getByText("En el programa: Actividad #3")).toBeTruthy()
  })

  it("una medida existente muestra su frecuencia de verificación y no un plazo (D5)", () => {
    render(<ControlCard control={{ ...control, isExisting: true, verificationFrequency: "Trimestral", dueDate: null }} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} />)
    expect(screen.getByText("Existente · verificación Trimestral")).toBeTruthy()
    expect(screen.queryByText(/plazo/)).toBeNull()
    render(<ControlCard control={{ ...control, id: "c2", isExisting: true, verificationFrequency: null, dueDate: null }} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={deleted()} />)
    expect(screen.getByText("Existente · verificación sin frecuencia")).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/control-form.test.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx"`

Expected: FAIL. No existe el radio «Por implementar», el `values` enviado no trae `isExisting` y la
tarjeta dice «Responsable: Supervisor · Plazo: 30-10-2026».

- [ ] **Step 3: El formulario**

Reemplazar el contenido de `app/(app)/prevencion/miper/[id]/control-form.tsx` por:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { toast } from "@/lib/toast"
import { saveMiperControlAction } from "../actions"

const HIERARCHY_OPTIONS = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>).map(([value, label]) => ({ value, label }))
const OTHER = "__otra__"
/** D5 (Fase C): una medida existente se verifica con una frecuencia; una por implementar lleva plazo. */
const KIND_OPTIONS = [
  { value: "existing", title: "Ya está implementada", description: "Se verifica cada cierto tiempo; no lleva plazo." },
  { value: "pending", title: "Por implementar", description: "Lleva responsable y la fecha en que debe estar lista." },
] as const

/**
 * Alta y edición de una medida (spec §6.2). Sale de la ficha antigua
 * (`entry-sheet.tsx`) conservando los nombres accesibles que usan las E2E:
 * «Tipo de control», «Descripción de la medida», «Nombre o cargo
 * responsable», «Plazo de la medida».
 *
 * Fase C: «¿Ya está implementada?». Una medida nueva nace «Por implementar»
 * (la regla de siempre). Una existente pide la frecuencia de verificación en vez
 * del plazo, y el formulario envía `null` en lo que no aplica.
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
  const [hierarchy, setHierarchy] = useState<ControlHierarchy>(control?.hierarchy ?? "administrative")
  const [isExisting, setIsExisting] = useState(control?.isExisting ?? false)
  const [frequency, setFrequency] = useState(control?.verificationFrequency ?? "")
  const [description, setDescription] = useState(control?.description ?? "")
  const [responsibleUserId, setResponsibleUserId] = useState(control?.responsibleUserId ?? "")
  const [responsibleName, setResponsibleName] = useState(control?.responsibleUserId ? "" : control?.responsibleName ?? "")
  const [dueDate, setDueDate] = useState(control?.dueDate ?? "")
  // Modo «message»: el rechazo del servidor queda escrito en el formulario
  // (role=alert) en vez de un toast que se va; el éxito sigue avisando y cierra.
  const operation = useOperation()
  // Mientras guarda, nada se edita: lo enviado es lo que se ve.
  const locked = operation.pending
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? controlVersion : undefined,
    values: {
      hierarchy, description: description.trim(),
      responsibleUserId: responsibleUserId || null,
      responsibleName: responsibleUserId ? null : responsibleName.trim() || null,
      isExisting,
      verificationFrequency: isExisting ? frequency.trim() || null : null,
      dueDate: isExisting ? null : dueDate || null,
    },
  }), (result) => { toast.success(result.message ?? "Medida guardada"); onDone() })
  // El responsable actual puede ya no estar en la faena (`responsibleOptions`
  // son sus usuarios activos): sin esta opción el select mostraba «Selecciona…»
  // y parecía sin responsable.
  const currentResponsible = control?.responsibleUserId && !responsibleOptions.some((option) => option.id === control.responsibleUserId)
    ? [{ value: control.responsibleUserId, label: control.responsibleName ?? "Responsable actual" }]
    : []
  return (
    <div role="group" aria-label={control ? "Editar medida de control" : "Nueva medida de control"} className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <p className="text-sm font-medium text-[var(--color-text)]">¿Ya está implementada?</p>
        <ChoiceCardGroup label="¿Ya está implementada?" className="sm:grid-cols-2" options={KIND_OPTIONS} value={isExisting ? "existing" : "pending"}
          disabled={locked} onChange={(value) => setIsExisting(value === "existing")} />
      </div>
      <Field label="Tipo de control (jerarquía)" required>
        <OptionSelect aria-label="Tipo de control" options={HIERARCHY_OPTIONS} value={hierarchy} disabled={locked} onValueChange={(value) => setHierarchy(value as ControlHierarchy)} />
      </Field>
      {isExisting ? (
        <Field label="Frecuencia de verificación" helper="Cada cuánto se comprueba que sigue funcionando (por ejemplo, trimestral).">
          <Input aria-label="Frecuencia de verificación" value={frequency} disabled={locked} onChange={(event) => setFrequency(event.target.value)} placeholder="Trimestral" maxLength={120} />
        </Field>
      ) : (
        <Field label="Plazo" required helper="Fecha en que la medida debe estar implementada.">
          <DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} disabled={locked} onChange={setDueDate} />
        </Field>
      )}
      {/* El rótulo visible es el nombre accesible (WCAG 2.5.3, «label in name»). */}
      <Field label="Descripción de la medida" required className="md:col-span-2" helper="Mínimo 3 caracteres.">
        <Textarea aria-label="Descripción de la medida" value={description} disabled={locked} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={3000} />
      </Field>
      {measureSuggestions.length > 0 && (
        <Field label="Usar una medida ya escrita en esta MIPER" className="md:col-span-2">
          <Combobox aria-label="Usar una medida ya escrita" options={measureSuggestions.map((value) => ({ value, label: value }))} value="" disabled={locked} onChange={(value) => { if (value) setDescription(value) }} placeholder="Buscar medida…" />
        </Field>
      )}
      <Field label="Responsable">
        <OptionSelect
          aria-label="Responsable de la medida"
          options={[...responsibleOptions.map((option) => ({ value: option.id, label: option.name })), ...currentResponsible, { value: OTHER, label: "Otra persona o cargo…" }]}
          value={responsibleUserId || OTHER}
          disabled={locked}
          onValueChange={(value) => setResponsibleUserId(value === OTHER ? "" : value)}
        />
      </Field>
      {!responsibleUserId && (
        <Field label="Nombre o cargo responsable">
          <Input aria-label="Nombre o cargo responsable" value={responsibleName} disabled={locked} onChange={(event) => setResponsibleName(event.target.value)} placeholder="Supervisor de turno" maxLength={300} />
        </Field>
      )}
      {operation.message && <p role="alert" className="text-sm text-[var(--color-danger-ink)] md:col-span-2">{operation.message}</p>}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" loading={operation.pending} disabled={description.trim().length < 3} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        <Button size="sm" variant="secondary" disabled={operation.pending} onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}
```

`ChoiceCardGroup<T>` infiere `T = "existing" | "pending"` de `KIND_OPTIONS` (`as const`).

- [ ] **Step 4: La tarjeta**

En `app/(app)/prevencion/miper/[id]/control-card.tsx`, reemplazar:

```tsx
        <p className="text-xs text-[var(--color-text-subtle)]">Responsable: {control.responsibleName ?? "sin asignar"} · Plazo: {control.dueDate ? formatDate(control.dueDate) : "sin plazo"}</p>
```

por:

```tsx
        {/* D5 (Fase C): la existente se verifica con una frecuencia; la por implementar lleva plazo.
            Una foto anterior a la Fase C no trae `isExisting`: por implementar, la regla de entonces. */}
        <p className="text-xs text-[var(--color-text-subtle)]">
          {(control.isExisting ?? false)
            ? `Existente · verificación ${control.verificationFrequency ?? "sin frecuencia"}`
            : `Por implementar · plazo ${control.dueDate ? formatDate(control.dueDate) : "sin fecha"}`}
        </p>
        <p className="text-xs text-[var(--color-text-subtle)]">Responsable: {control.responsibleName ?? "sin asignar"}</p>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/control-form.test.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx" "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx" "app/(app)/prevencion/miper/[id]/miper-workspace.test.tsx"`

Expected: PASS. El editor y el espacio de trabajo pintan `ControlForm` y `ControlCard`: sirven para
confirmar que no se rompió nada alrededor.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- "app/(app)/prevencion/miper/[id]/control-form.tsx" "app/(app)/prevencion/miper/[id]/control-form.test.tsx" "app/(app)/prevencion/miper/[id]/control-card.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx"
```

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/prevencion/miper/[id]/control-form.tsx" "app/(app)/prevencion/miper/[id]/control-form.test.tsx" "app/(app)/prevencion/miper/[id]/control-card.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx"
git commit -m "feat(miper): la medida pregunta si ya está implementada y la tarjeta dice «Existente · verificación» o «Por implementar · plazo»" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lectura de las medidas del RE-04 (parser y módulo puro `re04-measures.ts`)

**Files:**
- Modify: `lib/prevention/miper/re04-import.ts:175-189` (`CONTROLLED_TEXT` → prefijos)
- Test: `lib/prevention/miper/re04-import.test.ts`
- Create: `lib/prevention/miper/re04-measures.ts`
- Test: `lib/prevention/miper/re04-measures.test.ts`
- Test: `lib/reports/miper-workbook.test.ts` (un test de ida y vuelta con el libro exportado)

**Interfaces:**
- Consumes:
  - `normalizeMeasure` (`./dedup`), `cleanMiperName` y `normalizeMiperName` (`./names`);
  - `CONTROL_HIERARCHY_LABEL` y `ControlHierarchy` (`./snapshot`);
  - `countOf` y `addDaysToPlainDate` (`@/lib/utils`);
  - `alignedDetail` de `miper-workbook.test.ts` (Task 4) y el formato de las columnas R/T/U (Task 4).
- Produces (en `lib/prevention/miper/re04-measures.ts`, puro, sin `db` ni reloj):
  - `type HierarchySource = "prefix" | "keyword" | "default"`
  - `type HierarchySuggestion = { hierarchy: ControlHierarchy; source: HierarchySource }`
  - `type MeasurePiece = { text: string; key: string; prefix: ControlHierarchy | null }`
  - `type ResponsibleDecision = { kind: "user"; userId: string } | { kind: "text"; name: string } | { kind: "none" }`
  - `type DeadlineDecision = { kind: "existing"; frequency: string | null } | { kind: "pending"; dueDate: string | null }`
  - `type DeadlineSource = "date" | "relative" | "immediate" | "frequency" | "default"`
  - `type ImportRowInput = { rowNumber: number; status: string; original: unknown }`
  - `type ResponsibleUser = { id: string; name: string }`
  - `type ImportMeasure = { rowNumber: number; text: string; phraseKey: string; prefix: ControlHierarchy | null; responsibleKey: string; deadlineKey: string }`
  - `type PhraseGroup = { key: string; text: string; count: number; suggestion: HierarchySuggestion }`
  - `type ValueGroup<D> = { key: string; text: string | null; count: number; suggestion: D }`
  - `type MeasureAnalysis = { measures: ImportMeasure[]; phrases: PhraseGroup[]; responsibles: ValueGroup<ResponsibleDecision>[]; deadlines: ValueGroup<DeadlineDecision>[] }`
  - `type ImportMappings = { measureMapping: Record<string, ControlHierarchy>; responsibleMapping: Record<string, ResponsibleDecision>; deadlineMapping: Record<string, DeadlineDecision> }`
  - `const MEASURE_MAX_LENGTH = 3000`
  - `splitMeasures(cell: unknown): MeasurePiece[]`
  - `inferHierarchy(piece: { text: string; prefix?: ControlHierarchy | null }): HierarchySuggestion`
  - `deadlineSuggestion(text: string | null, today: string): { decision: DeadlineDecision; source: DeadlineSource }`
  - `responsibleSuggestion(text: string | null, users: readonly ResponsibleUser[]): ResponsibleDecision`
  - `distinctPhrases(measures: ReadonlyArray<Pick<ImportMeasure, "text" | "phraseKey" | "prefix">>): PhraseGroup[]`
  - `analyzeRe04Measures(rows: readonly ImportRowInput[], options: { today: string; users?: readonly ResponsibleUser[] }): MeasureAnalysis`
  - `suggestedMappings(analysis: MeasureAnalysis): ImportMappings`
  - `mappingProblems(analysis: MeasureAnalysis, mappings: ImportMappings): string[]` (vacío = se
    puede aplicar)
- Claves:
  - frase = `normalizeMeasure(texto)`;
  - responsable y plazo = `normalizeMiperName(texto)`, con `""` para el vacío y para «—».

  Las Tasks 7 y 8 las calculan con esta misma función, desde las mismas filas del lote.
- `controlledStatusOf` reconoce el rótulo por prefijo de palabras: «PARCIALMENTE CONTROLADO - REQUIERE
  ACCIÓN INMEDIATA» → `partial`.

- [ ] **Step 1: Write the failing tests**

En `lib/prevention/miper/re04-import.test.ts`, dentro del `describe("parser puro del RE-04 IPER", …)`,
agregar:

```ts
  it("«¿Está controlado?» se reconoce por prefijo: la cola del RE-04 real no lo vuelve «No»", () => {
    const rows = parse([
      sheetRow({ controlled: "PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA" }),
      sheetRow({ controlled: "SÍ, CONTROLADO (VERIFICADO EN TERRENO)" }),
      sheetRow({ controlled: "NO CONTROLADO - SIN MEDIDAS" }),
      // «SIN …» empieza con «si» pero no es «Sí»: el prefijo es por palabras.
      sheetRow({ controlled: "SIN INFORMACIÓN" }),
    ])
    expect(rows.map((row) => row.normalized.controlledStatus)).toEqual(["partial", "yes", "no", "no"])
  })
```

Crear `lib/prevention/miper/re04-measures.test.ts`:

```ts
/**
 * Fase C (spec §8): las medidas del RE-04 real. Las frases salen del RE-04 de
 * Biodiversa (`docs/Prevención Biodiversa/…/RE- 04 … (MIPER).xlsx`, ignorado por
 * git). Los responsables son cargos: ningún dato personal entra a una prueba.
 */
import { describe, expect, it } from "vitest"
import {
  analyzeRe04Measures, deadlineSuggestion, distinctPhrases, inferHierarchy, mappingProblems, responsibleSuggestion, splitMeasures, suggestedMappings,
} from "./re04-measures"

const TODAY = "2026-10-03"
const texts = (cell: unknown) => splitMeasures(cell).map((piece) => piece.text)
const row = (rowNumber: number, original: Record<string, unknown>, status = "ready") => ({ rowNumber, status, original })

describe("splitMeasures: las medidas de una celda del RE-04 real", () => {
  it("separa por comas de primer nivel, sin cortar dentro de paréntesis, y quita el punto final", () => {
    expect(texts("USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA, SEÑALIZACIÓN DE ÁREAS, CAPACITACIÓN EN TRABAJO SEGURO."))
      .toEqual(["USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", "ORDEN Y LIMPIEZA", "SEÑALIZACIÓN DE ÁREAS", "CAPACITACIÓN EN TRABAJO SEGURO"])
  })
  it("con «;» en la línea, separa por «;» y las comas enumeran dentro de una medida", () => {
    expect(texts("APLICAR TRES PUNTOS DE APOYO; PROHIBIDO SALTAR DESDE CABINA O CONTENEDOR; MANTENER PELDAÑOS, PASAMANOS Y CALZADO LIMPIOS; VERIFICAR ILUMINACIÓN Y ESTADO DE ACCESOS; PROHIBIDO SUBIR AL BORDE DEL CONTENEDOR SIN PROTECCIÓN."))
      .toEqual([
        "APLICAR TRES PUNTOS DE APOYO", "PROHIBIDO SALTAR DESDE CABINA O CONTENEDOR", "MANTENER PELDAÑOS, PASAMANOS Y CALZADO LIMPIOS",
        "VERIFICAR ILUMINACIÓN Y ESTADO DE ACCESOS", "PROHIBIDO SUBIR AL BORDE DEL CONTENEDOR SIN PROTECCIÓN",
      ])
  })
  it("corta dos medidas pegadas por un punto sin espacio, pero no una sigla", () => {
    expect(texts("USO DE GUANTES Y MASCARILLA, LAVADO FRECUENTE DE MANOS, EVITAR CONTACTO DIRECTO CON AGENTES BIOLÓGICOS.PARTICIPAR DE FORMA OBLIGATORIA EN PROGRAMA DE INOCULACION DE LA FAENA."))
      .toEqual(["USO DE GUANTES Y MASCARILLA", "LAVADO FRECUENTE DE MANOS", "EVITAR CONTACTO DIRECTO CON AGENTES BIOLÓGICOS", "PARTICIPAR DE FORMA OBLIGATORIA EN PROGRAMA DE INOCULACION DE LA FAENA"])
    expect(texts("USO DE E.P.P. OBLIGATORIO")).toEqual(["USO DE E.P.P. OBLIGATORIO"])
  })
  it("cada salto de línea separa; la coma final y los espacios sobrantes no dejan medidas vacías", () => {
    expect(texts("INSTALAR RESGUARDOS EN MAQUINAS\nGUANTES, CASCO, CALZADO DE SEGURIDAD")).toEqual(["INSTALAR RESGUARDOS EN MAQUINAS", "GUANTES", "CASCO", "CALZADO DE SEGURIDAD"])
    expect(texts("SEÑALIZACIÓN Y DEMARCACION DE VIAS\nCONTROL DE VELOCIDAD Y CAPACITACIÓN\nCHALECO REFLECTANTE, CASCO, CAPACITACIÓN DE MANEJO A LA DEFENSIVA,"))
      .toEqual(["SEÑALIZACIÓN Y DEMARCACION DE VIAS", "CONTROL DE VELOCIDAD Y CAPACITACIÓN", "CHALECO REFLECTANTE", "CASCO", "CAPACITACIÓN DE MANEJO A LA DEFENSIVA"])
    expect(texts("SISTEMAS DE VENTILACION\nCAPACITACIÓN EN MANEJO DE SUSTANCIAS CONOCER SUS RIESGOS IDENTIFICADOS EN HDS \n MANTENER VENTILACION ADECUADA, ALMACENAR PRODUCTOS EN LUGARES AUTORIZADOS Y EVITAR FUENTES DE IGNICION"))
      .toEqual(["SISTEMAS DE VENTILACION", "CAPACITACIÓN EN MANEJO DE SUSTANCIAS CONOCER SUS RIESGOS IDENTIFICADOS EN HDS", "MANTENER VENTILACION ADECUADA", "ALMACENAR PRODUCTOS EN LUGARES AUTORIZADOS Y EVITAR FUENTES DE IGNICION"])
  })
  it("el «I.–V.» del libro exportado da el tipo y la línea es una sola medida, con comas o sin rótulo", () => {
    expect(splitMeasures("III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de 5 minutos, registro firmado\nII. Cambiar solvente por uno base agua")
      .map((piece) => [piece.text, piece.prefix]))
      .toEqual([["Topes de descarga", "engineering"], ["Charla de 5 minutos, registro firmado", "administrative"], ["Cambiar solvente por uno base agua", "substitution"]])
  })
  it("la misma medida dos veces en una celda cuenta una; sin texto no hay medidas", () => {
    expect(texts("ORDEN Y LIMPIEZA, orden y limpieza.")).toEqual(["ORDEN Y LIMPIEZA"])
    expect(texts("Y, DE.")).toEqual([])
    expect(splitMeasures(null)).toEqual([])
    expect(splitMeasures(42)).toEqual([])
  })
})

describe("inferHierarchy: el tipo sugerido", () => {
  it.each([
    ["USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", "ppe"],
    ["GUANTES", "ppe"],
    ["USO DE PROTECTORES AUDITIVOS", "ppe"],
    ["BLOQUEO Y ETIQUETADO (LOTO)", "engineering"],
    ["INSTALACION DE BARANDAS Y ESCALAS SEGURAS", "engineering"],
    ["MANTENER RESGUARDOS INSTALADOS", "engineering"],
    ["DEMARCACIÓN DE ÁREAS DE TRÁNSITO", "engineering"],
    ["USO DE BARANDAS", "engineering"],
    ["CAPACITACIÓN EN TRABAJO SEGURO", "administrative"],
    ["PROCEDIMIENTOS DE BLOQUEO Y ETIQUETADO", "administrative"],
    ["REVISIÓN DE INSTALACIONES ELÉCTRICAS", "administrative"],
    ["NO INTRODUCIR MANOS EN PARTES MOVILES", "administrative"],
    ["SUSTITUIR SOLVENTE POR PRODUCTO BASE AGUA", "substitution"],
    ["ELIMINAR LA TAREA MANUAL", "elimination"],
  ])("«%s» → %s por palabra clave (manda la que aparece primero)", (text, hierarchy) => {
    expect(inferHierarchy({ text })).toEqual({ hierarchy, source: "keyword" })
  })
  it("«uso de …» sin otra pista es EPP; sin ninguna pista es IV y queda marcada", () => {
    expect(inferHierarchy({ text: "USO DE CINTA ANTIDESLIZANTE" })).toEqual({ hierarchy: "ppe", source: "keyword" })
    expect(inferHierarchy({ text: "ORGANIZAR LAS TAREAS" })).toEqual({ hierarchy: "administrative", source: "default" })
  })
  it("el «I.–V.» del Excel manda sobre las palabras clave", () => {
    expect(inferHierarchy({ text: "Uso de casco", prefix: "administrative" })).toEqual({ hierarchy: "administrative", source: "prefix" })
  })
})

describe("deadlineSuggestion: los PLAZOS del RE-04 real", () => {
  it.each([
    ["TRIMESTRAL", { kind: "existing", frequency: "TRIMESTRAL" }, "frequency"],
    ["ANTES DE CADA OPERACIÓN", { kind: "existing", frequency: "ANTES DE CADA OPERACIÓN" }, "frequency"],
    ["INMEDIATO / ANTES DE CONTINUAR LA TAREA", { kind: "pending", dueDate: TODAY }, "immediate"],
    ["INMEDIATO AL OCURRIR", { kind: "pending", dueDate: TODAY }, "immediate"],
    // «en N días» manda sobre «diario»: es una medida nueva con su plazo.
    ["IMPLEMENTAR EN 30 DÍAS Y CONTROL DIARIO", { kind: "pending", dueDate: "2026-11-02" }, "relative"],
    ["30-06-2026", { kind: "pending", dueDate: "2026-06-30" }, "date"],
    ["2026-06-30", { kind: "pending", dueDate: "2026-06-30" }, "date"],
    ["31/12/2026", { kind: "pending", dueDate: "2026-12-31" }, "date"],
  ] as const)("«%s»", (text, decision, source) => {
    expect(deadlineSuggestion(text, TODAY)).toEqual({ decision, source })
  })
  it("una fecha imposible, un texto sin pista o una celda vacía quedan por implementar y sin fecha", () => {
    for (const text of ["31-02-2026", "SEGÚN PROGRAMA", "", null]) {
      expect(deadlineSuggestion(text, TODAY)).toEqual({ decision: { kind: "pending", dueDate: null }, source: "default" })
    }
  })
})

describe("responsibleSuggestion", () => {
  it("por defecto, el texto del Excel; si es exactamente el nombre de una persona de la faena, esa persona; vacío, sin responsable", () => {
    const users = [{ id: "u-1", name: "Jefe de Faena" }]
    expect(responsibleSuggestion("SUPERVISOR/PREVENCION", users)).toEqual({ kind: "text", name: "SUPERVISOR/PREVENCION" })
    expect(responsibleSuggestion("  jefe de   faena ", users)).toEqual({ kind: "user", userId: "u-1" })
    expect(responsibleSuggestion(null, users)).toEqual({ kind: "none" })
  })
})

describe("analyzeRe04Measures", () => {
  const analysis = analyzeRe04Measures([
    row(14, { "MEDIDA DE CONTROL": "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA", "RESPONSABLE": "SUPERVISOR/PREVENCION", "PLAZOS": "INMEDIATO / ANTES DE CONTINUAR LA TAREA" }),
    row(15, { "MEDIDA DE CONTROL": "ORDEN Y LIMPIEZA; INSPECCIÓN DE HERRAMIENTAS", "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL " }),
    // P o C fuera de la escala: nunca se carga, así que no pide decisiones.
    row(16, { "MEDIDA DE CONTROL": "PROTECTORES AUDITIVOS", "RESPONSABLE": "PREVENCION", "PLAZOS": "MENSUAL" }, "rejected"),
    row(17, { "MEDIDA DE CONTROL": null, "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL" }),
    // Espera su factor: si existe al confirmar se carga, así que sus medidas sí piden decisión.
    row(18, { "MEDIDA DE CONTROL": "CHARLA DE SEGURIDAD", "RESPONSABLE": null, "PLAZOS": null }, "needs_review"),
  ], { today: TODAY })

  it("una medida por frase y fila; las filas que nunca se cargan no piden decisiones", () => {
    expect(analysis.measures.map((measure) => [measure.rowNumber, measure.text])).toEqual([
      [14, "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)"], [14, "ORDEN Y LIMPIEZA"],
      [15, "ORDEN Y LIMPIEZA"], [15, "INSPECCIÓN DE HERRAMIENTAS"], [18, "CHARLA DE SEGURIDAD"],
    ])
  })
  it("cada frase, responsable y plazo distinto aparece una vez, por frecuencia, con su sugerencia", () => {
    expect(analysis.phrases.map((phrase) => [phrase.text, phrase.count, phrase.suggestion.hierarchy])).toEqual([
      ["ORDEN Y LIMPIEZA", 2, "administrative"],
      ["CHARLA DE SEGURIDAD", 1, "administrative"],
      ["INSPECCIÓN DE HERRAMIENTAS", 1, "administrative"],
      ["USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", 1, "ppe"],
    ])
    expect(analysis.responsibles.map((group) => [group.key, group.text, group.count, group.suggestion])).toEqual([
      ["prevencion", "PREVENCION", 2, { kind: "text", name: "PREVENCION" }],
      ["supervisor/prevencion", "SUPERVISOR/PREVENCION", 2, { kind: "text", name: "SUPERVISOR/PREVENCION" }],
      ["", null, 1, { kind: "none" }],
    ])
    expect(analysis.deadlines.map((group) => [group.key, group.text, group.count, group.suggestion])).toEqual([
      ["inmediato / antes de continuar la tarea", "INMEDIATO / ANTES DE CONTINUAR LA TAREA", 2, { kind: "pending", dueDate: TODAY }],
      ["trimestral", "TRIMESTRAL", 2, { kind: "existing", frequency: "TRIMESTRAL" }],
      ["", null, 1, { kind: "pending", dueDate: null }],
    ])
  })
  it("libro exportado: con «I.–V.» en todas las medidas y una línea por medida, cada medida toma su responsable y su plazo", () => {
    const exported = analyzeRe04Measures([row(14, {
      "MEDIDA DE CONTROL": "III. Controles de ingeniería: Topes de descarga\nIV. Controles administrativos: Charla de inicio de turno",
      "RESPONSABLE": "Supervisor de turno\n—", "PLAZOS": "30-06-2026\nTrimestral",
    })], { today: TODAY })
    expect(exported.measures.map((measure) => [measure.text, measure.prefix, measure.responsibleKey, measure.deadlineKey])).toEqual([
      ["Topes de descarga", "engineering", "supervisor de turno", "30-06-2026"],
      ["Charla de inicio de turno", "administrative", "", "trimestral"],
    ])
    // Sin «I.–V.», la celda entera vale para todas las medidas de la fila.
    const plain = analyzeRe04Measures([row(14, { "MEDIDA DE CONTROL": "BARANDAS\nCHARLA DE INICIO", "RESPONSABLE": "SUPERVISOR\nPREVENCION", "PLAZOS": "TRIMESTRAL" })], { today: TODAY })
    expect(plain.measures.map((measure) => measure.responsibleKey)).toEqual(["supervisor prevencion", "supervisor prevencion"])
  })
  it("distinctPhrases: si alguna aparición trae «I.–V.», la frase toma ese tipo", () => {
    expect(distinctPhrases([
      { text: "Charla de inicio", phraseKey: "charla inicio", prefix: null },
      { text: "Charla de inicio", phraseKey: "charla inicio", prefix: "administrative" },
    ])).toEqual([{ key: "charla inicio", text: "Charla de inicio", count: 2, suggestion: { hierarchy: "administrative", source: "prefix" } }])
  })
})

describe("mapeos", () => {
  const analysis = analyzeRe04Measures([row(14, { "MEDIDA DE CONTROL": "GUANTES, CASCO", "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL" })], { today: TODAY })

  it("las sugerencias forman un mapeo completo y sin problemas", () => {
    const mappings = suggestedMappings(analysis)
    expect(mappings).toEqual({
      measureMapping: { guantes: "ppe", casco: "ppe" },
      responsibleMapping: { prevencion: { kind: "text", name: "PREVENCION" } },
      deadlineMapping: { trimestral: { kind: "existing", frequency: "TRIMESTRAL" } },
    })
    expect(mappingProblems(analysis, mappings)).toEqual([])
  })
  it("dice qué falta y qué sobra, en palabras de la persona", () => {
    const mappings = suggestedMappings(analysis)
    const { casco: _casco, ...withoutCasco } = mappings.measureMapping
    expect(mappingProblems(analysis, { ...mappings, measureMapping: withoutCasco, responsibleMapping: {} })).toEqual([
      "La importación no coincide con la vista previa: falta decidir el tipo de 1 medida y el responsable de 1 valor.",
      "Vuelve a revisar el archivo.",
    ])
    expect(mappingProblems(analysis, { ...mappings, deadlineMapping: { ...mappings.deadlineMapping, mensual: { kind: "existing", frequency: "MENSUAL" } } })).toEqual([
      "La importación trae decisiones para 1 valor que el archivo no tiene.",
      "Vuelve a revisar el archivo.",
    ])
  })
})
```

En `lib/reports/miper-workbook.test.ts`:
- agregar `import { analyzeRe04Measures } from "@/lib/prevention/miper/re04-measures"` a los imports;
- al final del `describe` principal (después de los dos tests de la Task 4), agregar:

```ts
  it("el libro exportado se vuelve a importar: cada medida conserva su tipo, su responsable y su plazo (Fase C)", async () => {
    const sheet = (await buildMiperWorkbook(alignedDetail, null)).getWorksheet("RE-04 IPER")!
    const original = { "MEDIDA DE CONTROL": sheet.getCell("R14").value, "RESPONSABLE": sheet.getCell("T14").value, "PLAZOS": sheet.getCell("U14").value }
    const { measures, phrases } = analyzeRe04Measures([{ rowNumber: 14, status: "ready", original }], { today: "2026-10-03" })
    expect(measures.map((measure) => [measure.text, measure.prefix, measure.responsibleKey, measure.deadlineKey])).toEqual([
      ["Topes de descarga", "engineering", "supervisor de patio", "30-06-2026"],
      ["Charla de inicio de turno", "administrative", "", "trimestral"],
      ["Casco y barbiquejo", "ppe", "jefe de faena", ""],
    ])
    expect(phrases.every((phrase) => phrase.suggestion.source === "prefix")).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/re04-import.test.ts lib/prevention/miper/re04-measures.test.ts lib/reports/miper-workbook.test.ts`

Expected:
- `re04-import.test.ts`: FAIL en el test nuevo, porque la primera fila sale `no`;
- `re04-measures.test.ts` y el test nuevo de `miper-workbook.test.ts`: FAIL con «Failed to resolve
  import "./re04-measures"».

- [ ] **Step 3: El parser**

En `lib/prevention/miper/re04-import.ts`, reemplazar:

```ts
/** "SÍ, CONTROLADO" / "PARCIALMENTE CONTROLADO" / "NO CONTROLADO" / vacío → "no". */
const CONTROLLED_TEXT: Record<string, Re04ControlledStatus> = {
  "si controlado": "yes",
  "si": "yes",
  "controlado": "yes",
  "parcialmente controlado": "partial",
  "parcialmente": "partial",
  "parcial": "partial",
  "no controlado": "no",
  "no": "no",
}

export function controlledStatusOf(value: unknown): Re04ControlledStatus {
  return CONTROLLED_TEXT[keyOf(value)] ?? "no"
}
```

por:

```ts
/**
 * "SÍ, CONTROLADO" / "PARCIALMENTE CONTROLADO" / "NO CONTROLADO" / vacío → "no".
 * Se reconoce por PREFIJO de palabras, del rótulo más largo al más corto: el
 * RE-04 real escribe «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA» en sus
 * 46 Importantes, y con la búsqueda exacta caían en «no» (Fase C). «SIN …» no es
 * «SÍ»: el prefijo termina en un espacio.
 */
const CONTROLLED_PREFIXES: ReadonlyArray<readonly [string, Re04ControlledStatus]> = [
  ["parcialmente controlado", "partial"],
  ["si controlado", "yes"],
  ["no controlado", "no"],
  ["parcialmente", "partial"],
  ["controlado", "yes"],
  ["parcial", "partial"],
  ["si", "yes"],
  ["no", "no"],
]

export function controlledStatusOf(value: unknown): Re04ControlledStatus {
  const key = keyOf(value)
  const match = CONTROLLED_PREFIXES.find(([prefix]) => key === prefix || key.startsWith(`${prefix} `))
  return match?.[1] ?? "no"
}
```

Y en el comentario de cabecera del archivo, reemplazar:

```ts
 * - Los textos del formato real se mapean: `"SÍ, CONTROLADO" → "yes"`,
 *   `"PARCIALMENTE CONTROLADO" → "partial"`, `"NO CONTROLADO"` o vacío `→ "no"`;
```

por:

```ts
 * - Los textos del formato real se mapean por prefijo: `"SÍ, CONTROLADO" → "yes"`,
 *   `"PARCIALMENTE CONTROLADO…" → "partial"`, `"NO CONTROLADO"` o vacío `→ "no"`;
```

- [ ] **Step 4: El módulo puro**

Crear `lib/prevention/miper/re04-measures.ts`:

```ts
/**
 * Medidas del RE-04 en la importación (Fase C, spec §8). Puro: no toca la base
 * ni el reloj (el «hoy» lo pasa quien llama).
 *
 * - Las medidas salen SIEMPRE de `original["MEDIDA DE CONTROL"]`: la celda tal
 *   como vino del Excel, guardada en la fila del lote, con los saltos de línea
 *   que `normalized.measures` aplana. Así un lote preparado antes de la Fase C
 *   sirve sin versionar el parser.
 * - Cada frase distinta (`normalizeMeasure`) se decide una vez: su tipo I–V. Cada
 *   valor distinto de RESPONSABLE y de PLAZOS (`normalizeMiperName`), también
 *   una vez (D6).
 * - La vista previa y la carga calculan esto con la misma función y desde las
 *   mismas filas del lote. La carga rechaza un mapeo al que le falten claves o
 *   que traiga claves que el lote no tiene (`mappingProblems`).
 */
import { addDaysToPlainDate, countOf } from "@/lib/utils"
import { normalizeMeasure } from "./dedup"
import { cleanMiperName, normalizeMiperName } from "./names"
import type { Re04ColumnLabel } from "./re04-import"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy } from "./snapshot"

/** Largo máximo de una medida: el de `miperControlSaveSchema.values.description`. */
export const MEASURE_MAX_LENGTH = 3000
const FREQUENCY_MAX_LENGTH = 120
const RESPONSIBLE_MAX_LENGTH = 300

const MEASURE_COLUMN: Re04ColumnLabel = "MEDIDA DE CONTROL"
const RESPONSIBLE_COLUMN: Re04ColumnLabel = "RESPONSABLE"
const DEADLINE_COLUMN: Re04ColumnLabel = "PLAZOS"

export type HierarchySource = "prefix" | "keyword" | "default"
export type HierarchySuggestion = { hierarchy: ControlHierarchy; source: HierarchySource }
export type MeasurePiece = { text: string; key: string; prefix: ControlHierarchy | null }
export type ResponsibleDecision = { kind: "user"; userId: string } | { kind: "text"; name: string } | { kind: "none" }
export type DeadlineDecision = { kind: "existing"; frequency: string | null } | { kind: "pending"; dueDate: string | null }
export type DeadlineSource = "date" | "relative" | "immediate" | "frequency" | "default"
export type ImportRowInput = { rowNumber: number; status: string; original: unknown }
export type ResponsibleUser = { id: string; name: string }
export type ImportMeasure = { rowNumber: number; text: string; phraseKey: string; prefix: ControlHierarchy | null; responsibleKey: string; deadlineKey: string }
export type PhraseGroup = { key: string; text: string; count: number; suggestion: HierarchySuggestion }
export type ValueGroup<D> = { key: string; text: string | null; count: number; suggestion: D }
export type MeasureAnalysis = {
  /** En el orden de las filas y, dentro de cada fila, en el del Excel. */
  measures: ImportMeasure[]
  phrases: PhraseGroup[]
  responsibles: ValueGroup<ResponsibleDecision>[]
  deadlines: ValueGroup<DeadlineDecision>[]
}
export type ImportMappings = {
  measureMapping: Record<string, ControlHierarchy>
  responsibleMapping: Record<string, ResponsibleDecision>
  deadlineMapping: Record<string, DeadlineDecision>
}

/** La importación deja las celdas en texto, número o booleano (`cellValue`). */
function cellText(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

/* ── Separar las medidas de una celda ───────────────────────────────────── */

const ROMAN: Record<string, ControlHierarchy> = { I: "elimination", II: "substitution", III: "engineering", IV: "administrative", V: "ppe" }
const BARE_PREFIX = /^(IV|V|I{1,3})\.\s+/u
/** «IV. Controles administrativos:», como escribe cada medida el libro que exporta la plataforma. */
const LABELED_PREFIXES = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>)
  .map(([hierarchy, label]) => ({ hierarchy, prefix: `${label}:`.toLocaleLowerCase("es-CL") }))
/** «…BIOLÓGICOS.PARTICIPAR…»: dos medidas pegadas por un punto sin espacio. No corta «E.P.P.» ni «D.S. 594». */
const GLUED_SENTENCE = /(?<=\p{L}{3})\.(?=\p{Lu}\p{L}{2})/u
/** Viñetas y puntuación sobrantes en los bordes de una medida. */
const EDGE_PUNCTUATION = /^[\s.,;:\-–—•*]+|[\s.,;:\-–—•*]+$/gu

function prefixOf(line: string): { hierarchy: ControlHierarchy; rest: string } | null {
  const lower = line.toLocaleLowerCase("es-CL")
  for (const { hierarchy, prefix } of LABELED_PREFIXES) {
    if (lower.startsWith(prefix)) return { hierarchy, rest: line.slice(prefix.length) }
  }
  const bare = BARE_PREFIX.exec(line)
  return bare ? { hierarchy: ROMAN[bare[1]!]!, rest: line.slice(bare[0].length) } : null
}

/** Corta por `separator` fuera de paréntesis o corchetes: «EPP (CASCO, GUANTES)» queda entero. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of text) {
    if (char === "(" || char === "[") depth += 1
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1
    if (depth === 0 && char === separator) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * Las medidas de una celda «MEDIDA DE CONTROL»:
 * - cada salto de línea separa;
 * - una línea con «I.–V.» (libro exportado) es UNA medida y trae su tipo;
 * - en las demás, «;» si la línea tiene alguno —sus comas enumeran dentro de una
 *   medida: «VERIFICAR CARGA MÁXIMA, DISTRIBUCIÓN, HERMETICIDAD; …»— y si no,
 *   las comas de primer nivel;
 * - después, el «.X» pegado.
 * Se descartan los restos de menos de 3 caracteres y la misma frase repetida en
 * la celda.
 */
export function splitMeasures(cell: unknown): MeasurePiece[] {
  const text = cellText(cell)
  if (text === null) return []
  const pieces: MeasurePiece[] = []
  const seen = new Set<string>()
  const push = (raw: string, prefix: ControlHierarchy | null) => {
    const cleaned = (cleanMiperName(raw) ?? "").replace(EDGE_PUNCTUATION, "").slice(0, MEASURE_MAX_LENGTH)
    const key = normalizeMeasure(cleaned)
    if (cleaned.length < 3 || key === "" || seen.has(key)) return
    seen.add(key)
    pieces.push({ text: cleaned, key, prefix })
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanMiperName(rawLine)
    if (line === null) continue
    const prefixed = prefixOf(line)
    if (prefixed) {
      push(prefixed.rest, prefixed.hierarchy)
      continue
    }
    const bySemicolon = splitTopLevel(line, ";")
    const parts = bySemicolon.length > 1 ? bySemicolon : splitTopLevel(line, ",")
    for (const part of parts) for (const piece of part.split(GLUED_SENTENCE)) push(piece, null)
  }
  return pieces
}

/* ── Tipo sugerido ──────────────────────────────────────────────────────── */

/**
 * Palabras clave (sin tildes, minúsculas) por tipo, en orden de prioridad para el
 * empate. Manda la que aparece PRIMERO en la frase: «PROCEDIMIENTOS DE BLOQUEO»
 * es IV y «USO DE BARANDAS» es III. Se buscan como comienzo de palabra
 * («guante» calza «guantes»); «no » lleva su espacio para no calzar «normas».
 */
const KEYWORDS: ReadonlyArray<readonly [ControlHierarchy, readonly string[]]> = [
  ["elimination", ["eliminar", "eliminacion", "suprimir"]],
  ["substitution", ["sustituir", "sustitucion", "reemplazar", "reemplazo"]],
  ["engineering", [
    "baranda", "barrera", "resguardo", "enclavamiento", "bloqueo", "loto", "mantencion", "mantenimiento", "demarcacion", "delimitar",
    "aislacion", "puesta a tierra", "ventilacion", "extraccion", "pantalla", "proteccion de maquina", "sistema de seguridad",
    "sistemas de seguridad", "soporte", "ayuda mecanica", "ayudas mecanicas", "alarma", "instalar", "instalacion", "sombra",
    "extintor", "asiento", "escala", "piso",
  ]],
  ["ppe", [
    "epp", "elementos de proteccion personal", "elemento de proteccion personal", "guante", "casco", "calzado", "bota", "lente",
    "antiparra", "mascarilla", "respirador", "protector auditivo", "protectores auditivos", "tapon", "protector ocular", "chaleco",
    "arnes", "careta", "faja", "bloqueador", "legionario", "sombrero", "ropa", "overol", "traje", "zapato", "barbiquejo",
  ]],
  ["administrative", [
    "capacitacion", "capacitar", "procedimiento", "senalizacion", "senalizar", "senaletica", "inspeccion", "inspeccionar", "revision",
    "revisar", "supervision", "supervisar", "pausa", "rotacion", "charla", "induccion", "orden y limpieza", "control de", "controlar",
    "verificar", "verificacion", "planificar", "planificacion", "prohibir", "prohibido", "prohibicion", "respetar", "permiso de trabajo",
    "checklist", "protocolo", "programa", "vigia", "medicion", "higiene", "lavado", "desinfeccion", "vacunacion", "inoculacion",
    "comunicacion", "comunicar", "reportar", "reporte", "autoevaluacion", "ergonomia", "hidratacion", "gestion", "horario", "jornada",
    "turno", "instructivo", "evitar", "no ", "distancia", "transitar", "conducir", "operar", "fomentar", "suspender", "detener",
    "asegurar", "postura", "elongacion", "clima",
  ]],
]
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const KEYWORD_RULES = KEYWORDS.map(([hierarchy, words]) => ({
  hierarchy,
  pattern: new RegExp(`(^|[^\\p{L}])(?:${words.map(escapeRegExp).join("|")})`, "u"),
}))
/** «USO DE …» sin otra pista es EPP (spec §8). */
const USE_OF = /^uso(?: \p{L}+)? de\b/u

/** El tipo que se sugiere. Sin pista: IV, marcado `default` para que la persona lo mire. */
export function inferHierarchy(piece: { text: string; prefix?: ControlHierarchy | null }): HierarchySuggestion {
  if (piece.prefix) return { hierarchy: piece.prefix, source: "prefix" }
  const text = normalizeMiperName(piece.text)
  let best: { hierarchy: ControlHierarchy; position: number } | null = null
  for (const rule of KEYWORD_RULES) {
    const match = rule.pattern.exec(text)
    if (!match) continue
    const position = match.index + match[1]!.length
    if (!best || position < best.position) best = { hierarchy: rule.hierarchy, position }
  }
  if (best) return { hierarchy: best.hierarchy, source: "keyword" }
  if (USE_OF.test(text)) return { hierarchy: "ppe", source: "keyword" }
  return { hierarchy: "administrative", source: "default" }
}

/* ── Plazo y responsable sugeridos ──────────────────────────────────────── */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/
const IN_DAYS = /\b(\d{1,3}) dias?\b/
const IMMEDIATE = /\binmediat/
const FREQUENCY = /\b(diari[oa]s?|semanal(es)?|quincenal(es)?|mensual(es)?|bimestral(es)?|trimestral(es)?|cuatrimestral(es)?|semestral(es)?|anual(es)?|permanente|continu[oa]|periodic[oa]|cada|siempre)\b/

function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * D6: lo que sugiere un valor de PLAZOS. Una fecha → por implementar con esa
 * fecha; «en N días» → hoy + N (antes que la frecuencia: «IMPLEMENTAR EN 30
 * DÍAS Y CONTROL DIARIO»); «inmediato» → por implementar hoy; una frecuencia
 * («TRIMESTRAL», «ANTES DE CADA OPERACIÓN») → existente, con ese texto como
 * frecuencia de verificación. Sin pista o vacío → por implementar, sin fecha.
 */
export function deadlineSuggestion(text: string | null, today: string): { decision: DeadlineDecision; source: DeadlineSource } {
  const cleaned = cleanMiperName(text)
  if (cleaned === null) return { decision: { kind: "pending", dueDate: null }, source: "default" }
  const iso = ISO_DATE.exec(cleaned)
  const local = LOCAL_DATE.exec(cleaned)
  const date = iso ? calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    : local ? calendarDate(Number(local[3]), Number(local[2]), Number(local[1])) : null
  if (date) return { decision: { kind: "pending", dueDate: date }, source: "date" }
  const key = normalizeMiperName(cleaned)
  const days = IN_DAYS.exec(key)
  if (days) return { decision: { kind: "pending", dueDate: addDaysToPlainDate(today, Number(days[1])) }, source: "relative" }
  if (IMMEDIATE.test(key)) return { decision: { kind: "pending", dueDate: today }, source: "immediate" }
  if (FREQUENCY.test(key)) return { decision: { kind: "existing", frequency: cleaned.slice(0, FREQUENCY_MAX_LENGTH) }, source: "frequency" }
  return { decision: { kind: "pending", dueDate: null }, source: "default" }
}

/** Por defecto, el responsable tal como lo escribe el Excel; si es exactamente el nombre de una persona elegible, esa persona. */
export function responsibleSuggestion(text: string | null, users: readonly ResponsibleUser[]): ResponsibleDecision {
  const cleaned = cleanMiperName(text)
  if (cleaned === null) return { kind: "none" }
  const key = normalizeMiperName(cleaned)
  const user = users.find((candidate) => normalizeMiperName(candidate.name) === key)
  return user ? { kind: "user", userId: user.id } : { kind: "text", name: cleaned.slice(0, RESPONSIBLE_MAX_LENGTH) }
}

/* ── Análisis del lote ──────────────────────────────────────────────────── */

const EMPTY_MARK = /^[—–-]$/u

/**
 * El valor de RESPONSABLE o PLAZOS de cada medida de la fila. El libro que
 * exporta la plataforma escribe UNA LÍNEA POR MEDIDA en las tres columnas (y cada
 * medida con su «I.–V.»): ahí cada línea es de su medida, y «—» es «vacío». En
 * cualquier otro caso, la celda entera vale para todas las medidas de la fila.
 */
function valuesPerMeasure(cell: unknown, pieces: readonly MeasurePiece[]): string[] {
  const text = cellText(cell) ?? ""
  const lines = text.split(/\r?\n/).map((line) => {
    const cleaned = cleanMiperName(line) ?? ""
    return EMPTY_MARK.test(cleaned) ? "" : cleaned
  })
  if (pieces.length > 1 && pieces.every((piece) => piece.prefix !== null) && lines.length === pieces.length) return lines
  const whole = cleanMiperName(text) ?? ""
  return pieces.map(() => (EMPTY_MARK.test(whole) ? "" : whole))
}

const byCountThenText = (a: { count: number; text: string | null }, b: { count: number; text: string | null }) =>
  b.count - a.count || (a.text ?? "").localeCompare(b.text ?? "", "es")

/** Las frases distintas, por frecuencia. Si alguna aparición trae «I.–V.», la frase toma ese tipo. */
export function distinctPhrases(measures: ReadonlyArray<Pick<ImportMeasure, "text" | "phraseKey" | "prefix">>): PhraseGroup[] {
  const groups = new Map<string, { text: string; count: number; prefix: ControlHierarchy | null }>()
  for (const measure of measures) {
    const group = groups.get(measure.phraseKey)
    if (group) {
      group.count += 1
      group.prefix ??= measure.prefix
      continue
    }
    groups.set(measure.phraseKey, { text: measure.text, count: 1, prefix: measure.prefix })
  }
  return [...groups].map(([key, group]) => ({ key, text: group.text, count: group.count, suggestion: inferHierarchy(group) })).sort(byCountThenText)
}

function groupValues<D>(measures: readonly ImportMeasure[], field: "responsibleKey" | "deadlineKey", texts: ReadonlyMap<string, string | null>, suggest: (text: string | null) => D): ValueGroup<D>[] {
  const counts = new Map<string, number>()
  for (const measure of measures) counts.set(measure[field], (counts.get(measure[field]) ?? 0) + 1)
  return [...counts].map(([key, count]) => {
    const text = texts.get(key) ?? null
    return { key, text, count, suggestion: suggest(text) }
  }).sort(byCountThenText)
}

/**
 * Las medidas del lote y lo que hay que decidir. Las filas `rejected` (P o C
 * fuera de la escala) nunca se cargan y no piden decisiones; las
 * `needs_review` sí, porque se cargan si el factor existe al confirmar.
 */
export function analyzeRe04Measures(rows: readonly ImportRowInput[], options: { today: string; users?: readonly ResponsibleUser[] }): MeasureAnalysis {
  const measures: ImportMeasure[] = []
  const responsibleTexts = new Map<string, string | null>()
  const deadlineTexts = new Map<string, string | null>()
  for (const row of rows) {
    if (row.status === "rejected") continue
    const original = (row.original ?? {}) as Partial<Record<Re04ColumnLabel, unknown>>
    const pieces = splitMeasures(original[MEASURE_COLUMN])
    if (pieces.length === 0) continue
    const responsibles = valuesPerMeasure(original[RESPONSIBLE_COLUMN], pieces)
    const deadlines = valuesPerMeasure(original[DEADLINE_COLUMN], pieces)
    pieces.forEach((piece, index) => {
      const responsible = responsibles[index] ?? ""
      const deadline = deadlines[index] ?? ""
      const responsibleKey = normalizeMiperName(responsible)
      const deadlineKey = normalizeMiperName(deadline)
      if (!responsibleTexts.has(responsibleKey)) responsibleTexts.set(responsibleKey, responsible || null)
      if (!deadlineTexts.has(deadlineKey)) deadlineTexts.set(deadlineKey, deadline || null)
      measures.push({ rowNumber: row.rowNumber, text: piece.text, phraseKey: piece.key, prefix: piece.prefix, responsibleKey, deadlineKey })
    })
  }
  return {
    measures,
    phrases: distinctPhrases(measures),
    responsibles: groupValues(measures, "responsibleKey", responsibleTexts, (text) => responsibleSuggestion(text, options.users ?? [])),
    deadlines: groupValues(measures, "deadlineKey", deadlineTexts, (text) => deadlineSuggestion(text, options.today).decision),
  }
}

/** Las sugerencias como mapeo: es lo que hace «Aceptar sugerencias» sin cambios. */
export function suggestedMappings(analysis: MeasureAnalysis): ImportMappings {
  return {
    measureMapping: Object.fromEntries(analysis.phrases.map((phrase) => [phrase.key, phrase.suggestion.hierarchy])),
    responsibleMapping: Object.fromEntries(analysis.responsibles.map((group) => [group.key, group.suggestion])),
    deadlineMapping: Object.fromEntries(analysis.deadlines.map((group) => [group.key, group.suggestion])),
  }
}

/**
 * Lo que impide aplicar un mapeo al lote, en palabras de la persona. Vacío = se
 * puede aplicar. Falta una clave: la persona no decidió algo que el lote trae.
 * Sobra una clave: la decisión es de otro archivo (otra vista previa) o de un
 * cliente adulterado. En los dos casos se rechaza entero, antes de escribir.
 */
export function mappingProblems(analysis: MeasureAnalysis, mappings: ImportMappings): string[] {
  const missing: string[] = []
  let extra = 0
  const check = (expected: ReadonlyArray<{ key: string }>, given: Readonly<Record<string, unknown>>, describe: (count: number) => string) => {
    const keys = new Set(expected.map((group) => group.key))
    const absent = [...keys].filter((key) => !Object.hasOwn(given, key)).length
    if (absent > 0) missing.push(describe(absent))
    extra += Object.keys(given).filter((key) => !keys.has(key)).length
  }
  check(analysis.phrases, mappings.measureMapping, (count) => `el tipo de ${countOf(count, "medida")}`)
  check(analysis.responsibles, mappings.responsibleMapping, (count) => `el responsable de ${countOf(count, "valor")}`)
  check(analysis.deadlines, mappings.deadlineMapping, (count) => `el plazo de ${countOf(count, "valor")}`)
  const problems: string[] = []
  if (missing.length > 0) {
    const list = missing.length === 1 ? missing[0]! : `${missing.slice(0, -1).join(", ")} y ${missing.at(-1)!}`
    problems.push(`La importación no coincide con la vista previa: falta decidir ${list}.`)
  }
  if (extra > 0) problems.push(`La importación trae decisiones para ${countOf(extra, "valor")} que el archivo no tiene.`)
  if (problems.length > 0) problems.push("Vuelve a revisar el archivo.")
  return problems
}
```

`countOf(2, "valor")` da «2 valores» y `countOf(1, "medida")`, «1 medida» (`pluralize` de
`lib/utils.ts`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:fast -- lib/prevention/miper/re04-import.test.ts lib/prevention/miper/re04-measures.test.ts lib/reports/miper-workbook.test.ts lib/prevention/miper/dedup.test.ts`

Expected: PASS.
- Si un caso de `inferHierarchy` falla por una palabra clave, se corrige la lista, nunca la frase de
  la prueba: las frases son del RE-04 real.
- Si falla por precedencia, recordar que manda la que aparece primero y, con empate, el orden de
  `KEYWORDS`.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/re04-import.ts lib/prevention/miper/re04-import.test.ts lib/prevention/miper/re04-measures.ts lib/prevention/miper/re04-measures.test.ts lib/reports/miper-workbook.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/prevention/miper/re04-import.ts lib/prevention/miper/re04-import.test.ts lib/prevention/miper/re04-measures.ts lib/prevention/miper/re04-measures.test.ts lib/reports/miper-workbook.test.ts
git commit -m "feat(miper): lectura pura de las medidas del RE-04 (frases, tipo sugerido, responsables y plazos) y «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA» como parcial" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Vista previa con «medidas detectadas» y los responsables de la faena

**Files:**
- Modify: `lib/services/miper/shared.ts:1-5` (imports) y al final (helper nuevo)
- Modify: `lib/services/miper/queries.ts:6` (import), `:80`, `:89-90` y `:137-142` (usa el helper)
- Modify: `lib/validation/prevention-module/miper.ts` (constante `IMPORT_LIMITS`, antes de
  `riskImportTargetSchema`)
- Modify: `lib/services/miper/import.ts:45-56` (imports), `:79-89` (`RiskImportPreview`) y
  `:200-315` (`previewRiskImport`)
- Test: `lib/__tests__/miper-import.test.ts` (`workbookOf` con marca, fixture con medidas y un
  `describe` nuevo)

**Interfaces:**
- Consumes: `analyzeRe04Measures`, `MeasureAnalysis` y `ResponsibleUser` (Task 6). Toma
  `controlledStatusOf` por prefijo (Task 6) a través del parser.
- Produces:
  - `worksiteResponsibleOptions(client: Client, worksiteId: string, selfUserId: string): Promise<Array<{ id: string; name: string }>>`
    en `lib/services/miper/shared.ts`. Devuelve los usuarios activos de la faena (`worksite_users`)
    por nombre y, si no está entre ellos, quien edita (si está activo). Es lo que ofrecen el editor y
    la vista previa; la Task 8 valida contra lo mismo.
  - `IMPORT_LIMITS = { phrases: 5000, values: 1000 } as const` en
    `lib/validation/prevention-module/miper.ts`.
  - `RiskImportPreview` gana:
    - `measureAnalysis: MeasureAnalysis`, con las medidas de las filas no `rejected`;
    - `responsibleOptions: Array<{ id: string; name: string }>`.
  - La vista previa rechaza un archivo con más de `IMPORT_LIMITS.phrases` frases distintas o más de
    `IMPORT_LIMITS.values` responsables o plazos distintos, **antes** de guardar el lote.
  - En `miper-import.test.ts`, para la Task 8:
    - `workbookOf(rows: ExcelRow[], marker?: string)`: la marca va en A1 y cambia el checksum del
      archivo, así que dos libros con las mismas filas son lotes distintos;
    - `MEASURES_FIXTURE: ExcelRow[]` (4 filas, la última fuera de escala).

- [ ] **Step 1: Write the failing test**

En `lib/__tests__/miper-import.test.ts`:
1. Agregar a los imports estáticos:

   ```ts
   import { todayInChile } from "@/lib/utils"
   ```

2. Cambiar la firma y la primera línea de `workbookOf`:

   ```ts
   /** Libro mínimo con la forma del RE-04 real: membrete, encabezado doble y datos. */
   async function workbookOf(rows: ExcelRow[]): Promise<Buffer> {
     const workbook = new ExcelJS.Workbook()
     const sheet = workbook.addWorksheet(RE04_SHEET_NAME)
     sheet.getCell("A1").value = "Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER)"
   ```

   por:

   ```ts
   /**
    * Libro mínimo con la forma del RE-04 real: membrete, encabezado doble y datos.
    * `marker` va en el membrete: dos libros con las mismas filas y distinta marca
    * tienen distinto checksum, así que son lotes distintos para la misma faena.
    */
   async function workbookOf(rows: ExcelRow[], marker = "Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER)"): Promise<Buffer> {
     const workbook = new ExcelJS.Workbook()
     const sheet = workbook.addWorksheet(RE04_SHEET_NAME)
     sheet.getCell("A1").value = marker
   ```

3. Después de `const FIXTURE: ExcelRow[] = [ … ]`, agregar:

   ```ts
   /**
    * Fase C: medidas con las formas del RE-04 de Biodiversa (frases reales,
    * responsables que son cargos, PLAZOS reales). Filas del Excel 14 a 17.
    * - 14: Importante, «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA»,
    *   cuatro medidas por comas (una con paréntesis), plazo «INMEDIATO…».
    * - 15: Moderado, tres líneas (ingeniería y la lista de EPP), «TRIMESTRAL ».
    * - 16: Tolerable, dos medidas por «;»; una se repite con la fila 14.
    * - 17: P fuera de la escala: no se carga y sus medidas no piden decisión.
    */
   const MEASURES_FIXTURE: ExcelRow[] = [
     {
       number: 1, activity: "Traslado de lodo", task: "Descarga", position: "Conductor", factor: "Mecánico", hazard: "Camión en pendiente",
       risk: "Volcamiento", damage: "Politraumatismo", probability: 2, consequence: 4, mr: 8, classification: "IMPORTANTE",
       measures: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA, SEÑALIZACIÓN DE ÁREAS, CAPACITACIÓN EN TRABAJO SEGURO.",
       controlled: "PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA", responsible: "SUPERVISOR/PREVENCION", deadlines: "INMEDIATO / ANTES DE CONTINUAR LA TAREA",
     },
     {
       number: 2, activity: "Mantención", task: "Cambio de neumático", position: "Mecánico", factor: "Mecánico", hazard: "Herramientas manuales",
       risk: "Golpes", damage: "Contusiones", probability: 2, consequence: 2, mr: 4, classification: "MODERADO",
       measures: "INSTALAR RESGUARDOS EN MAQUINAS\nGUANTES, CASCO, CALZADO DE SEGURIDAD",
       controlled: "PARCIALMENTE CONTROLADO", responsible: "SUPERVISOR/PREVENCION", deadlines: "TRIMESTRAL ",
     },
     {
       number: 3, activity: "Mantención", task: "Orden de taller", position: "Mecánico", factor: "Físico", hazard: "Piso resbaladizo",
       risk: "Caída al mismo nivel", damage: "Esguince", probability: 1, consequence: 2, mr: 2, classification: "TOLERABLE",
       measures: "ORDEN Y LIMPIEZA; INSPECCIÓN DE HERRAMIENTAS", controlled: "SÍ, CONTROLADO", responsible: "PREVENCION", deadlines: "TRIMESTRAL",
     },
     { number: 4, activity: "Mantención", factor: "Físico", hazard: "Ruido", probability: 3, consequence: 2, measures: "PROTECTORES AUDITIVOS", responsible: "PREVENCION", deadlines: "MENSUAL" },
   ]
   ```

4. Después del `describe("vista previa del RE-04", …)`, agregar:

```ts
/* ── Medidas detectadas en la vista previa (Fase C) ─────────────────────── */

describe("vista previa: medidas detectadas (Fase C)", () => {
  it("separa las medidas de la celda original, agrupa frases, responsables y plazos, sugiere tipo y plazo, y trae las personas de la faena", async () => {
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Vista previa con medidas"), { worksiteId: WS, target: "draft", period: 2034, fileName: "RE-04 medidas.xlsx" }, author)
    const analysis = preview.measureAnalysis

    // 4 + 4 + 2 medidas. La fila 17 (P = 3) no se carga nunca: no aporta.
    expect(analysis.measures).toHaveLength(10)
    expect(analysis.measures.some((measure) => measure.rowNumber === 17)).toBe(false)
    // El salto de línea de la fila 15 sobrevivió a ExcelJS y al `jsonb` del lote.
    expect(analysis.measures.filter((measure) => measure.rowNumber === 15).map((measure) => measure.text))
      .toEqual(["INSTALAR RESGUARDOS EN MAQUINAS", "GUANTES", "CASCO", "CALZADO DE SEGURIDAD"])

    expect(analysis.phrases).toHaveLength(9)
    expect(analysis.phrases[0]).toMatchObject({ text: "ORDEN Y LIMPIEZA", count: 2, suggestion: { hierarchy: "administrative", source: "keyword" } })
    expect(analysis.phrases.find((phrase) => phrase.text.startsWith("USO DE EPP"))!.suggestion.hierarchy).toBe("ppe")
    expect(analysis.phrases.find((phrase) => phrase.text === "INSTALAR RESGUARDOS EN MAQUINAS")!.suggestion.hierarchy).toBe("engineering")

    expect(analysis.responsibles.map((group) => [group.text, group.count, group.suggestion])).toEqual([
      ["SUPERVISOR/PREVENCION", 8, { kind: "text", name: "SUPERVISOR/PREVENCION" }],
      ["PREVENCION", 2, { kind: "text", name: "PREVENCION" }],
    ])
    expect(analysis.deadlines.map((group) => [group.text, group.count, group.suggestion])).toEqual([
      ["TRIMESTRAL", 6, { kind: "existing", frequency: "TRIMESTRAL" }],
      ["INMEDIATO / ANTES DE CONTINUAR LA TAREA", 4, { kind: "pending", dueDate: todayInChile() }],
    ])

    // Los usuarios activos de la faena, para elegir responsable.
    expect(preview.responsibleOptions.map((option) => option.id).sort()).toEqual(["u-autora", "u-jefa", "u-legal", "u-prev"])
    // «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA» es parcial (antes caía en «no»).
    expect(preview.rows[0]!.normalized.controlledStatus).toBe("partial")
  })

  it("un RE-04 sin medidas no pide decisiones", async () => {
    const preview = await previewRiskImport(await workbookOf([FIXTURE[2]!], "Sin medidas"), { worksiteId: WS, target: "draft", period: 2034 }, author)
    expect(preview.measureAnalysis).toEqual({ measures: [], phrases: [], responsibles: [], deadlines: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:pglite -- lib/__tests__/miper-import.test.ts`

Expected: FAIL en los dos tests nuevos, porque `preview.measureAnalysis` es `undefined`. Los demás
siguen verdes.

- [ ] **Step 3: Las personas de la faena, en un solo lugar**

En `lib/services/miper/shared.ts`:
- reemplazar `import { and, eq, inArray, sql, type SQL } from "drizzle-orm"` por
  `import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"`;
- reemplazar `import { preventionRiskMatrices, users } from "@/db/schema"` por
  `import { preventionRiskMatrices, users, worksiteUsers } from "@/db/schema"`;
- al final del archivo, agregar:

```ts
/**
 * Responsables que se ofrecen en una faena: sus usuarios activos, por nombre, y
 * —si no está entre ellos— quien edita. Lo usan el editor de la medida
 * (`getMiperWorkspace`) y la importación (vista previa y carga, Fase C), para que
 * lo que se ofrece y lo que se acepta sean lo mismo.
 */
export async function worksiteResponsibleOptions(client: Client, worksiteId: string, selfUserId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await client.select({ id: users.id, name: users.name }).from(worksiteUsers).innerJoin(users, eq(users.id, worksiteUsers.userId))
    .where(and(eq(worksiteUsers.worksiteId, worksiteId), eq(users.isActive, true))).orderBy(asc(users.name))
  if (rows.some((row) => row.id === selfUserId)) return rows
  const [self] = await client.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, selfUserId), eq(users.isActive, true))).limit(1)
  return self ? [...rows, self] : rows
}
```

En `lib/services/miper/queries.ts`:
1. En el `Promise.all` de `getMiperWorkspace`, renombrar `responsibleRows` a `responsibleOptions` en
   la lista de la izquierda, y reemplazar el elemento:

   ```ts
       db.select({ id: users.id, name: users.name }).from(worksiteUsers).innerJoin(users, eq(users.id, worksiteUsers.userId))
         .where(and(eq(worksiteUsers.worksiteId, matrix.worksiteId), eq(users.isActive, true))).orderBy(asc(users.name)),
   ```

   por:

   ```ts
       worksiteResponsibleOptions(db, matrix.worksiteId, access.userId),
   ```

2. Borrar el bloque que agregaba a quien edita:

   ```ts
     const responsibleOptions = [...responsibleRows]
     if (!responsibleOptions.some((option) => option.id === access.userId)) {
       const self = await userNames(db, [access.userId])
       const selfName = self.get(access.userId)
       if (selfName) responsibleOptions.push({ id: access.userId, name: selfName })
     }
   ```

3. Agregar `worksiteResponsibleOptions` al import de `./shared`.
4. Quitar `worksiteUsers` del import de `@/db/schema`, que queda sin uso. `users` se queda: lo usa
   `getMiperHistory`.

En `lib/validation/prevention-module/miper.ts`, antes de `export const riskImportTargetSchema`,
agregar:

```ts
/**
 * Topes de una importación (Fase C): lo que una persona puede decidir en una
 * vista previa y lo que el cuerpo de una Server Function tiene que cargar. El
 * RE-04 de Biodiversa trae 222 frases distintas y 5 plazos.
 */
export const IMPORT_LIMITS = { phrases: 5000, values: 1000 } as const
```

- [ ] **Step 4: La vista previa**

En `lib/services/miper/import.ts`:
1. Agregar a los imports:

   ```ts
   import { analyzeRe04Measures, type MeasureAnalysis } from "@/lib/prevention/miper/re04-measures"
   ```

   y reemplazar:
   - `import { riskImportCommitSchema, riskImportPreviewSchema } from "@/lib/validation/prevention-module/miper"`
     por `import { IMPORT_LIMITS, riskImportCommitSchema, riskImportPreviewSchema } from "@/lib/validation/prevention-module/miper"`;
   - `import { codeYear } from "@/lib/utils"` por
     `import { codeYear, countOf, todayInChile } from "@/lib/utils"`;
   - el import de `./shared` por:

     ```ts
     import { assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, OUT_OF_SCOPE, requireAccess, worksiteResponsibleOptions } from "./shared"
     ```

2. En `RiskImportPreview`, después de `live: { … }`, agregar:

   ```ts
     /**
      * Fase C: las medidas del archivo y lo que hay que decidir una vez por valor
      * distinto (tipo de cada frase, responsables, plazos), con su sugerencia.
      */
     measureAnalysis: MeasureAnalysis
     /** Personas que se pueden elegir como responsable: las activas de la faena y quien importa. */
     responsibleOptions: Array<{ id: string; name: string }>
   ```

3. En `previewRiskImport`, después del `const rows: RiskImportRowView[] = parsed.rows.map(…)` y antes
   del comentario «Los dos destinos se comprueban acá…», agregar:

   ```ts
     /* Fase C: las medidas se leen de la celda original (con sus saltos de línea),
      * no de `normalized.measures`, y cada frase, responsable y plazo distinto se
      * decide una vez (D6). Los topes se aplican antes de guardar el lote. */
     const responsibleOptions = await worksiteResponsibleOptions(db, data.worksiteId, access.userId)
     const measureAnalysis = analyzeRe04Measures(rows, { today: todayInChile(), users: responsibleOptions })
     assertWithinImportLimits(measureAnalysis)
   ```

4. En el `return { … }` de `previewRiskImport`, después de `live: { … },`, agregar
   `measureAnalysis,` y `responsibleOptions,`.
5. Después de la función `rowBlocked`, agregar:

   ```ts
   /** Fase C: lo que cabe en una importación (`IMPORT_LIMITS`). Más que eso se divide en partes. */
   function assertWithinImportLimits(analysis: MeasureAnalysis) {
     if (analysis.phrases.length > IMPORT_LIMITS.phrases) {
       throw new RiskLegalDomainError(`El archivo trae ${countOf(analysis.phrases.length, "medida distinta", "medidas distintas")}: el máximo por importación es ${IMPORT_LIMITS.phrases}. Divide el RE-04 en partes.`)
     }
     if (Math.max(analysis.responsibles.length, analysis.deadlines.length) > IMPORT_LIMITS.values) {
       throw new RiskLegalDomainError(`El archivo trae más de ${IMPORT_LIMITS.values} responsables o plazos distintos. Divide el RE-04 en partes.`)
     }
   }
   ```

6. En el comentario de cabecera de `import.ts`, después del punto 3, agregar:

   ```ts
    * 4. **Medidas (Fase C).** La vista previa devuelve `measureAnalysis` (frases,
    *    responsables y plazos distintos, con su sugerencia) y la carga lo vuelve a
    *    calcular desde las filas del lote: nunca confía en las claves del cliente.
   ```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:pglite -- lib/__tests__/miper-import.test.ts
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
```

Expected: PASS. La carga todavía no usa el análisis (Task 8): los tests de carga siguen como antes.

- [ ] **Step 6: Puertas**

```bash
npm run typecheck
npm run lint -- lib/services/miper/shared.ts lib/services/miper/queries.ts lib/validation/prevention-module/miper.ts lib/services/miper/import.ts lib/__tests__/miper-import.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/services/miper/shared.ts lib/services/miper/queries.ts lib/validation/prevention-module/miper.ts lib/services/miper/import.ts lib/__tests__/miper-import.test.ts
git commit -m "feat(miper): la vista previa del RE-04 detecta las medidas y sugiere tipo, responsable y plazo una vez por valor distinto" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Carga con medidas en una sola transacción

**Files:**
- Modify: `lib/validation/prevention-module/miper.ts:249-262` (`riskImportCommitSchema`)
- Test: `lib/validation/prevention-module/miper.test.ts`
- Modify: `lib/services/miper/matrices.ts:24-120` (`createMiper` → `createMiperWithClient`)
- Modify: `lib/services/miper/import.ts` (`RiskImportCommitResult`, `commitRiskImport` y dos helpers)
- Test: `lib/__tests__/miper-import.test.ts` (los commits que ya existen pasan mapeos; un `describe`
  nuevo)
- Modify: `app/(app)/prevencion/miper/actions.ts:22` (import) y `:434-441` (`commitRiskImportAction`)
- Test: `app/(app)/prevencion/miper/actions.test.ts`

**Interfaces:**
- Consumes:
  - de la Task 6: `analyzeRe04Measures`, `mappingProblems`, `suggestedMappings` (sólo en pruebas),
    `ImportMappings`, `ImportMeasure`, `ResponsibleDecision`;
  - de la Task 7: `worksiteResponsibleOptions`, `IMPORT_LIMITS`, y `MEASURES_FIXTURE` y
    `workbookOf(rows, marker)` en `miper-import.test.ts`;
  - de la Task 1: el desempate por id;
  - de la Task 3: la completitud D5.
- Produces:
  - `riskImportCommitSchema` gana tres campos, **por defecto `{}`** (un RE-04 sin medidas no pide
    nada):
    - `measureMapping: Record<string, ControlHierarchy>`;
    - `responsibleMapping: Record<string, ResponsibleDecision>`;
    - `deadlineMapping: Record<string, DeadlineDecision>`.

    Las claves tienen hasta 3.000 caracteres y el tamaño se acota con `IMPORT_LIMITS`. El tipo va
    por enum; el texto del responsable no puede quedar vacío; la frecuencia admite hasta 120
    caracteres y la fecha es `AAAA-MM-DD` o `null`.
  - `createMiperWithClient(tx: Client, input: unknown, access: MiperAccess): Promise<{ id: string }>`
    en `lib/services/miper/matrices.ts`: el alta dentro de una transacción ajena, con la misma
    validación y autorización. `createMiper(input, access)` conserva su firma y la usa.
  - `RiskImportCommitResult` gana `measures: { total: number; existing: number; pending: number }`.
  - `commitRiskImport`:
    - rechaza con `RiskLegalDomainError` (y nada escrito) un mapeo con claves que faltan o sobran, o
      con una persona inactiva o que no es de la faena;
    - crea borrador, riesgos, medidas (`status = "proposed"`, en el orden del Excel) y traza en
      **una** transacción;
    - cada `import_applied` por riesgo lleva `measures: <n>`, y el de la matriz lleva `measures`,
      `existing` y `pending`.
  - `commitRiskImportAction` responde `data: { matrixId, created, skipped, measures }` y el mensaje
    «N riesgos cargados con M medidas propuestas (X existentes y Y por implementar)», más
    «; K filas detenidas» si hubo. La Task 9 lo muestra en un toast.

- [ ] **Step 1: Write the failing tests**

En `lib/validation/prevention-module/miper.test.ts`, agregar `riskImportCommitSchema` e
`IMPORT_LIMITS` al import de `./miper` y, al final del `describe`:

```ts
  it("carga del RE-04: los mapeos son opcionales (archivo sin medidas), con tipos del enum y topes de tamaño (Fase C)", () => {
    const base = { batchId: "b1", worksiteId: "ws", target: "draft" }
    expect(riskImportCommitSchema.parse(base)).toMatchObject({ measureMapping: {}, responsibleMapping: {}, deadlineMapping: {} })
    expect(riskImportCommitSchema.safeParse({
      ...base,
      measureMapping: { casco: "ppe" },
      responsibleMapping: { "": { kind: "none" }, prevencion: { kind: "text", name: "PREVENCION" }, jefa: { kind: "user", userId: "u-1" } },
      deadlineMapping: { trimestral: { kind: "existing", frequency: "TRIMESTRAL" }, inmediato: { kind: "pending", dueDate: null }, fecha: { kind: "pending", dueDate: "2026-06-30" } },
    }).success).toBe(true)
    expect(riskImportCommitSchema.safeParse({ ...base, measureMapping: { casco: "helmet" } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, deadlineMapping: { fecha: { kind: "pending", dueDate: "30-06-2026" } } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, deadlineMapping: { x: { kind: "existing", frequency: "x".repeat(121) } } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, responsibleMapping: { x: { kind: "text", name: "  " } } }).success).toBe(false)
    expect(riskImportCommitSchema.safeParse({ ...base, responsibleMapping: { x: { kind: "persona", userId: "u-1" } } }).success).toBe(false)
    const tooMany = Object.fromEntries(Array.from({ length: IMPORT_LIMITS.phrases + 1 }, (_, index) => [`medida ${index}`, "administrative"]))
    expect(riskImportCommitSchema.safeParse({ ...base, measureMapping: tooMany }).success).toBe(false)
  })
```

En `lib/__tests__/miper-import.test.ts`:
1. Imports estáticos:
   - reemplazar `import { and, asc, eq } from "drizzle-orm"` por
     `import { and, asc, eq, inArray } from "drizzle-orm"`;
   - agregar:

     ```ts
     import { normalizeMeasure } from "@/lib/prevention/miper/dedup"
     import { normalizeMiperName } from "@/lib/prevention/miper/names"
     import { suggestedMappings, type ImportMappings } from "@/lib/prevention/miper/re04-measures"
     ```

2. Imports dinámicos: después de `const { listMiperPortfolio } = await import("@/lib/services/miper/portfolio")`, agregar:

   ```ts
   const { getMiperWorkspace } = await import("@/lib/services/miper/queries")
   const { buildMiperSnapshot } = await import("@/lib/services/miper/snapshots")
   ```

3. Después de `myActionsIn` (Task 1), agregar:

   ```ts
   async function matricesOf(worksiteId: string, period: number) {
     return testDb.select({ id: schema.preventionRiskMatrices.id }).from(schema.preventionRiskMatrices)
       .where(and(eq(schema.preventionRiskMatrices.worksiteId, worksiteId), eq(schema.preventionRiskMatrices.period, period)))
   }

   async function batchOf(batchId: string) {
     const [batch] = await testDb.select().from(schema.preventionRiskImportBatches).where(eq(schema.preventionRiskImportBatches.id, batchId))
     return batch!
   }

   /** Los `import_applied` de una MIPER (`newState` del log). */
   async function appliedOf(matrixId: string) {
     const log = await testDb.select().from(schema.auditLog)
       .where(and(eq(schema.auditLog.entityType, "risk_legal:risk:miper"), eq(schema.auditLog.entityId, matrixId)))
     return log.map((row) => JSON.parse(row.newState ?? "{}") as Record<string, unknown>).filter((state) => state.changeType === "import_applied")
   }
   ```

4. Los commits que ya existen ahora mandan los mapeos de la vista previa:
   - en «escribe las filas que pasan…» (borrador), dentro del objeto de `commitRiskImport({ … })`,
     agregar `...suggestedMappings(preview.measureAnalysis),`;
   - en «no le pone dueño al lote…» (al vigente), cambiar
     `commitRiskImport({ batchId: preview.batchId, worksiteId: WS_LIVE, target: "live" }, author)`
     por
     `commitRiskImport({ batchId: preview.batchId, worksiteId: WS_LIVE, target: "live", ...suggestedMappings(preview.measureAnalysis) }, author)`;
   - los de «factor de riesgo que el catálogo no tiene» no cambian: sus filas no traen medidas, y
     sin mapeos la carga los toma vacíos. Eso prueba que un RE-04 sin medidas no pide nada.

5. En «escribe las filas que pasan…», después de `expect(committed).toMatchObject({ created: 3,
   skipped: 1, notified: 1, target: "draft" })`, agregar:

   ```ts
       // Fase C: la medida de la fila 14 («IV. Controles administrativos: …», «Supervisor», «30-06-2026»).
       expect(committed.measures).toEqual({ total: 1, existing: 0, pending: 1 })
       expect((await buildMiperSnapshot(testDb, committed.matrixId)).entries[0]!.controls).toEqual([expect.objectContaining({
         hierarchy: "administrative", description: "procedimiento de descarga", responsibleName: "Supervisor",
         dueDate: "2026-06-30", isExisting: false, verificationFrequency: null, status: "proposed",
       })])
   ```

   y, después de `expect(changes.filter((change) => change === "import_applied")).toHaveLength(4)`:

   ```ts
       // Un `import_applied` por riesgo, con su cuenta de medidas (sólo la fila 14 trae una).
       expect((await appliedOf(committed.matrixId)).filter((state) => state.object === "entry").map((state) => state.measures).sort()).toEqual([0, 0, 1])
   ```

6. Al final del archivo, agregar:

```ts
/* ── Carga con medidas (Fase C) ─────────────────────────────────────────── */

describe("carga con medidas (Fase C)", () => {
  it("crea las medidas de cada riesgo con su tipo, responsable y plazo o frecuencia, todas «propuesta» y en el orden del Excel; los pendientes bajan a los reales", async () => {
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Carga con medidas"), { worksiteId: WS, target: "draft", period: 2035 }, author)
    const mappings = suggestedMappings(preview.measureAnalysis)
    // La persona cambia una decisión: «PREVENCION» es la prevencionista de la faena.
    mappings.responsibleMapping[normalizeMiperName("PREVENCION")] = { kind: "user", userId: "u-prev" }
    const committed = await commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2035, revisionReason: "Importación con medidas de prueba.", ...mappings,
    }, author)
    expect(committed).toMatchObject({ created: 3, skipped: 1, measures: { total: 10, existing: 6, pending: 4 } })

    const entries = await entriesOf(committed.matrixId)
    const controls = await testDb.select().from(schema.preventionRiskControls).where(inArray(schema.preventionRiskControls.riskEntryId, entries.map((entry) => entry.id)))
    expect(controls).toHaveLength(10)
    // Existentes o por implementar, todas quedan propuestas hasta que alguien las verifique.
    expect(controls.every((control) => control.status === "proposed")).toBe(true)

    const [first, second, third] = (await buildMiperSnapshot(testDb, committed.matrixId)).entries
    // Orden del Excel dentro de cada riesgo, aunque todas nacen en la misma transacción.
    expect(first!.controls.map((control) => control.description)).toEqual([
      "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", "ORDEN Y LIMPIEZA", "SEÑALIZACIÓN DE ÁREAS", "CAPACITACIÓN EN TRABAJO SEGURO",
    ])
    expect(first!.controls[0]).toMatchObject({
      hierarchy: "ppe", responsibleUserId: null, responsibleName: "SUPERVISOR/PREVENCION", isExisting: false, verificationFrequency: null, dueDate: todayInChile(),
    })
    expect(first!.controlledStatus).toBe("partial")
    expect(second!.controls.map((control) => [control.description, control.hierarchy])).toEqual([
      ["INSTALAR RESGUARDOS EN MAQUINAS", "engineering"], ["GUANTES", "ppe"], ["CASCO", "ppe"], ["CALZADO DE SEGURIDAD", "ppe"],
    ])
    expect(second!.controls[0]).toMatchObject({ isExisting: true, verificationFrequency: "TRIMESTRAL", dueDate: null })
    expect(third!.controls.map((control) => [control.description, control.responsibleUserId, control.responsibleName])).toEqual([
      ["ORDEN Y LIMPIEZA", "u-prev", "Prevencionista de faena"], ["INSPECCIÓN DE HERRAMIENTAS", "u-prev", "Prevencionista de faena"],
    ])

    // Un `import_applied` por riesgo con su cuenta, y el de la matriz con el total.
    const applied = await appliedOf(committed.matrixId)
    expect(applied.filter((state) => state.object === "entry").map((state) => state.measures).sort()).toEqual([2, 4, 4])
    expect(applied.find((state) => state.object === "matrix")).toMatchObject({ created: 3, skipped: 1, measures: 10, existing: 6, pending: 4 })

    // Los pendientes bajan a los reales: ningún riesgo queda con errores. El Importante tiene medidas
    // por implementar con responsable y plazo, y las existentes no piden plazo.
    const { completeness } = await getMiperWorkspace(committed.matrixId, author)
    expect(completeness.filter((issue) => issue.severity === "error" && issue.entryId)).toEqual([])
  }, 60_000)

  it("rechaza en el servidor un mapeo incompleto, uno con claves que el lote no tiene y uno armado para otro archivo; no crea nada", async () => {
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Rechazos"), { worksiteId: WS, target: "draft", period: 2036 }, author)
    const full = suggestedMappings(preview.measureAnalysis)
    const commit = (mappings: Partial<ImportMappings>) => commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2036, revisionReason: "Intento de carga que se rechaza.", ...full, ...mappings,
    }, author)

    const { [normalizeMeasure("CASCO")]: _casco, ...withoutCasco } = full.measureMapping
    await expect(commit({ measureMapping: withoutCasco })).rejects.toThrow("falta decidir el tipo de 1 medida")
    await expect(commit({ responsibleMapping: {} })).rejects.toThrow("falta decidir el responsable de 2 valores")
    await expect(commit({ deadlineMapping: { ...full.deadlineMapping, semestral: { kind: "existing", frequency: "SEMESTRAL" } } }))
      .rejects.toThrow("trae decisiones para 1 valor que el archivo no tiene")
    // Review Focus 1: las decisiones de OTRO archivo (otra vista previa) no sirven para este lote.
    const other = await previewRiskImport(await workbookOf([MEASURES_FIXTURE[2]!], "Otro archivo"), { worksiteId: WS, target: "draft", period: 2036 }, author)
    await expect(commit(suggestedMappings(other.measureAnalysis))).rejects.toThrow("Vuelve a revisar el archivo.")
    // Un tipo fuera del enum lo rechaza el esquema.
    await expect(commit({ measureMapping: { ...full.measureMapping, [normalizeMeasure("CASCO")]: "helmet" as never } })).rejects.toThrow()

    // Nada se creó: ni el borrador ni medidas, y el lote sigue preparado.
    expect(await matricesOf(WS, 2036)).toHaveLength(0)
    expect((await batchOf(preview.batchId)).status).toBe("staged")
  }, 60_000)

  it("un responsable que ya no está activo o que no es de la faena se rechaza, aunque la vista previa lo ofreciera (Review Focus 2)", async () => {
    await testDb.insert(schema.users).values({ id: "u-otra-faena", name: "Supervisor de otra faena", email: "otra@imp.cl", hashedPassword: "x", isActive: true, emailNotifications: false })
    const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Responsables"), { worksiteId: WS, target: "draft", period: 2037 }, author)
    const mappings = suggestedMappings(preview.measureAnalysis)
    const commit = (userId: string) => commitRiskImport({
      batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2037, revisionReason: "Carga con un responsable inválido.", ...mappings,
      responsibleMapping: { ...mappings.responsibleMapping, [normalizeMiperName("PREVENCION")]: { kind: "user", userId } },
    }, author)

    await expect(commit("u-otra-faena")).rejects.toThrow("La persona responsable no es de la faena o está inactiva.")
    // u-legal es de la faena, pero se da de baja entre la vista previa y la carga.
    await testDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-legal"))
    try {
      await expect(commit("u-legal")).rejects.toThrow(/inactiva/)
    } finally {
      await testDb.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, "u-legal"))
    }
    expect(await matricesOf(WS, 2037)).toHaveLength(0)
  }, 60_000)

  it("si algo falla a mitad de la carga no queda nada: ni el borrador, ni riesgos, ni medidas (una sola transacción)", async () => {
    // Falla la última medida de la última fila: para entonces ya se escribieron el borrador, dos
    // riesgos y sus medidas. Antes de la Fase C el borrador se creaba en otra transacción y quedaba.
    await pg.exec(`
      CREATE FUNCTION qa_falla_medida() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.description = 'INSPECCIÓN DE HERRAMIENTAS' THEN RAISE EXCEPTION 'falla forzada de la prueba'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER qa_falla_medida BEFORE INSERT ON prevention_risk_controls FOR EACH ROW EXECUTE FUNCTION qa_falla_medida();
    `)
    try {
      const preview = await previewRiskImport(await workbookOf(MEASURES_FIXTURE, "Rollback"), { worksiteId: WS, target: "draft", period: 2038 }, author)
      await expect(commitRiskImport({
        batchId: preview.batchId, worksiteId: WS, target: "draft", period: 2038, revisionReason: "Carga que falla a mitad.", ...suggestedMappings(preview.measureAnalysis),
      }, author)).rejects.toThrow()
      expect(await matricesOf(WS, 2038)).toHaveLength(0)
      expect((await batchOf(preview.batchId)).status).toBe("staged")
      expect((await batchRowsOf(preview.batchId)).every((row) => row.riskEntryId === null)).toBe(true)
    } finally {
      await pg.exec("DROP TRIGGER qa_falla_medida ON prevention_risk_controls; DROP FUNCTION qa_falla_medida();")
    }
  }, 60_000)
})
```

En `app/(app)/prevencion/miper/actions.test.ts`:
1. Después de `const listMiperWorksiteTargets = vi.hoisted(() => vi.fn())`, agregar:

   ```ts
   const commitRiskImport = vi.hoisted(() => vi.fn())
   ```

2. Después del `vi.mock("@/lib/services/miper/portfolio", …)`, agregar:

   ```ts
   vi.mock("@/lib/services/miper/import", () => ({ previewRiskImport: vi.fn(), commitRiskImport }))
   ```

3. Agregar `commitRiskImportAction` al import de `./actions` y, al final del `describe`:

   ```ts
     it("la carga del RE-04 dice cuántos riesgos y medidas creó, y que las medidas quedan propuestas (Fase C)", async () => {
       guardPermission.mockResolvedValue({ session, error: null })
       commitRiskImport.mockResolvedValue({ batchId: "b1", matrixId: "m-imp", target: "draft", created: 3, skipped: 1, notified: 0, measures: { total: 10, existing: 6, pending: 4 } })
       await expect(commitRiskImportAction({ batchId: "b1" })).resolves.toEqual({
         ok: true,
         message: "3 riesgos cargados con 10 medidas propuestas (6 existentes y 4 por implementar); 1 fila detenida",
         data: { matrixId: "m-imp", created: 3, skipped: 1, measures: { total: 10, existing: 6, pending: 4 } },
       })
       commitRiskImport.mockResolvedValue({ batchId: "b2", matrixId: "m-imp", target: "live", created: 1, skipped: 0, notified: 0, measures: { total: 0, existing: 0, pending: 0 } })
       await expect(commitRiskImportAction({ batchId: "b2" })).resolves.toMatchObject({ ok: true, message: "1 riesgo cargado" })
     })
   ```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:fast -- lib/validation/prevention-module/miper.test.ts "app/(app)/prevencion/miper/actions.test.ts"
npm run test:pglite -- lib/__tests__/miper-import.test.ts
```

Expected:
- `miper.test.ts`: FAIL, porque `IMPORT_LIMITS` existe (Task 7) pero el esquema no tiene los mapeos:
  `parse(base)` no trae `measureMapping`;
- `actions.test.ts`: FAIL en el mensaje («3 fila(s) cargada(s)…»);
- `miper-import`: FAIL en los cuatro tests nuevos y en `committed.measures`. En particular, el de
  rollback encuentra el borrador 2038 creado: hoy se crea en otra transacción.

- [ ] **Step 3: El esquema**

En `lib/validation/prevention-module/miper.ts`, reemplazar `riskImportCommitSchema` entero
(`:249-262`) por:

```ts
const controlHierarchySchema = z.enum(["elimination", "substitution", "engineering", "administrative", "ppe"], { message: "Selecciona el tipo de control (I a V)." })

const responsibleDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: id }),
  z.object({ kind: z.literal("text"), name: z.string().trim().min(1, "Escribe el responsable.").max(300) }),
  z.object({ kind: z.literal("none") }),
])

const deadlineDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), frequency: z.string().trim().max(120, "La frecuencia admite hasta 120 caracteres.").nullable() }),
  z.object({ kind: z.literal("pending"), dueDate: isoDate.nullable() }),
])

/** Una decisión por clave (frase, responsable o plazo distinto), con tope de tamaño. Vacío por defecto. */
function decisionMap<T extends z.ZodType>(value: T, max: number, label: string) {
  return z.record(z.string().max(3000), value)
    .refine((record) => Object.keys(record).length <= max, { message: `Demasiados ${label} en una sola importación (máximo ${max}).` })
    .default({})
}

export const riskImportCommitSchema = z.object({
  batchId: id,
  worksiteId: id,
  target: riskImportTargetSchema,
  period: riskImportPeriodSchema,
  /* Sólo para `draft`: es el motivo del alta y queda en la bitácora. */
  revisionReason: z.string().trim().max(3000).optional(),
  /* Fase C (spec §8, D6): una decisión por frase, por responsable y por plazo
   * distintos. El servidor recalcula las claves desde el lote y rechaza las que
   * falten o sobren (`mappingProblems`). Un RE-04 sin medidas no pide nada. */
  measureMapping: decisionMap(controlHierarchySchema, IMPORT_LIMITS.phrases, "tipos de medida"),
  responsibleMapping: decisionMap(responsibleDecisionSchema, IMPORT_LIMITS.values, "responsables"),
  deadlineMapping: decisionMap(deadlineDecisionSchema, IMPORT_LIMITS.values, "plazos"),
}).superRefine((value, ctx) => {
  if (value.target !== "draft") return
  const reason = value.revisionReason ?? ""
  if (reason.length > 0 && reason.length < 10) {
    ctx.addIssue({ code: "custom", path: ["revisionReason"], message: "Describe el motivo en al menos 10 caracteres." })
  }
})
```

`IMPORT_LIMITS` (Task 7) está declarado arriba en el mismo archivo. Si `typecheck` reclama por el
`.default({})` del genérico, tipar el retorno como
`z.ZodDefault<z.ZodType<Record<string, z.output<T>>, Record<string, z.input<T>>>>`. No cambia nada en
tiempo de ejecución.

- [ ] **Step 4: El alta dentro de una transacción ajena**

En `lib/services/miper/matrices.ts`, reemplazar el comienzo de `createMiper`:

```ts
export async function createMiper(input: unknown, access: MiperAccess) {
  const data = createMiperSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  return db.transaction(async (tx) => {
    const [worksite] = await tx.select({ id: worksites.id, name: worksites.name }).from(worksites)
```

por:

```ts
export async function createMiper(input: unknown, access: MiperAccess) {
  const data = createMiperSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  return db.transaction((tx) => createMiperWithClient(tx, data, access))
}

/**
 * El alta de una MIPER dentro de una transacción ajena (Fase C): la importación
 * crea el borrador en LA MISMA transacción que sus riesgos y medidas, así que un
 * fallo a mitad no deja un borrador vacío. Valida y autoriza igual que
 * `createMiper`: quien la llama no se salta nada.
 */
export async function createMiperWithClient(tx: Client, input: unknown, access: MiperAccess) {
  const data = createMiperSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  const [worksite] = await tx.select({ id: worksites.id, name: worksites.name }).from(worksites)
```

Y al final del cuerpo, reemplazar el cierre:

```ts
    return { id }
  })
}

export async function updateMiperHeader(input: unknown, access: MiperAccess) {
```

por:

```ts
  return { id }
}

export async function updateMiperHeader(input: unknown, access: MiperAccess) {
```

Todo lo que queda entre esas dos ediciones —faena activa, período libre, origen, metodología,
prellenado, filas y medidas copiadas, historial— **no cambia de contenido**. Sólo pierde un nivel de
indentación (dos espacios), porque deja de estar dentro del callback de `db.transaction`. El
parámetro se llama `tx`, como el del callback de antes, así que ninguna línea del cuerpo cambia de
texto. `Client` ya está importado de `./shared`. Comprobación:
`git diff -w lib/services/miper/matrices.ts` muestra sólo las dos ediciones de arriba.

- [ ] **Step 5: La carga**

En `lib/services/miper/import.ts`:
1. Imports:
   - en el import de `@/db/schema`, agregar `preventionRiskControls`;
   - reemplazar
     `import { analyzeRe04Measures, type MeasureAnalysis } from "@/lib/prevention/miper/re04-measures"`
     por:

     ```ts
     import {
       analyzeRe04Measures, mappingProblems, type ImportMappings, type ImportMeasure, type MeasureAnalysis, type ResponsibleDecision,
     } from "@/lib/prevention/miper/re04-measures"
     ```

   - reemplazar `import { createMiper } from "./matrices"` por
     `import { createMiperWithClient } from "./matrices"`;
   - el import de `./shared` pasa a ser:

     ```ts
     import {
       assertActiveUsers, assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, OUT_OF_SCOPE, requireAccess,
       userNames, worksiteResponsibleOptions,
     } from "./shared"
     ```

2. En `RiskImportCommitResult`, después de `notified: number`, agregar:

   ```ts
     /** Fase C: medidas creadas, todas «propuesta»: existentes y por implementar. */
     measures: { total: number; existing: number; pending: number }
   ```

3. Reemplazar `commitRiskImport` entera (desde su comentario «Carga el lote preparado…» hasta el
   `}` que cierra su `return { … }`) por:

```ts
/**
 * Carga el lote preparado. Destino `draft`: crea el MIPER en borrador (con el
 * período y el motivo de cualquier alta) y escribe las filas ahí. Destino
 * `live`: agrega las filas al MIPER vigente, que queda con «Cambios sin enviar».
 *
 * Fase C: UNA transacción para todo —el borrador, las filas, sus medidas y la
 * traza—, con el cliente de la transacción (la conexión global `db` no se toca
 * dentro del callback). Antes el borrador se creaba en su propia transacción y
 * un fallo a mitad dejaba un borrador vacío. Las decisiones de la vista previa
 * se validan contra las claves que el servidor vuelve a calcular desde el lote.
 */
export async function commitRiskImport(input: unknown, access: MiperAccess): Promise<RiskImportCommitResult> {
  const data = riskImportCommitSchema.parse(input)
  requireAccess(access, EDIT, data.worksiteId)

  /* El lote se comprueba antes de abrir la transacción: si ya se cargó, el error
   * tiene que decir eso y no «ya existe un MIPER del período» (que es lo que
   * respondería el alta al chocar con la matriz que la primera carga creó). */
  await loadBatch(db, data.batchId, data.worksiteId)
  const today = todayInChile()

  const result = await db.transaction(async (tx) => {
    // Relectura autoritativa dentro de la transacción.
    const batch = await loadBatch(tx, data.batchId, data.worksiteId)
    const batchRows = await tx.select().from(preventionRiskImportRows)
      .where(eq(preventionRiskImportRows.batchId, batch.id)).orderBy(asc(preventionRiskImportRows.rowNumber))

    /* Las claves de las decisiones se recalculan desde el lote, nunca se toman
     * del cliente: una que falte o que sobre (otra vista previa, un cliente
     * adulterado) rechaza la carga antes de escribir nada. */
    const analysis = analyzeRe04Measures(batchRows, { today })
    const problems = mappingProblems(analysis, data)
    if (problems.length > 0) throw new RiskLegalDomainError(problems.join(" "))
    const responsibleNames = await importResponsibleNames(tx, data.worksiteId, data.responsibleMapping, access)

    const revisionReason = data.revisionReason?.trim() || "Importación RE-04 desde Excel"
    const draftId = data.target === "draft"
      ? (await createMiperWithClient(tx, { worksiteId: data.worksiteId, period: data.period ?? codeYear(), revisionReason }, access)).id
      : null
    const matrix = draftId !== null
      ? await lockMatrix(tx, draftId)
      : await lockMatrix(tx, (await liveMatrix(tx, data.worksiteId)).id)
    assertEditable(matrix)

    // El catálogo se relee acá: entre la vista previa y la carga la persona pudo
    // crear el factor que faltaba, y eso es exactamente lo que la fila esperaba.
    const factors = await activeFactors(tx)
    const [max] = await tx.select({ maxRow: sql<number>`coalesce(max(${preventionRiskEntries.rowNumber}), 0)::int` })
      .from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))

    const now = nowIso()
    const resolution = data.target === "draft" ? "creada_en_borrador" : "agregada_al_vivo"
    const intolerable: Array<{ entryId: string; rowNumber: number }> = []
    const measuresByRow = new Map<number, ImportMeasure[]>()
    for (const measure of analysis.measures) measuresByRow.set(measure.rowNumber, [...(measuresByRow.get(measure.rowNumber) ?? []), measure])
    const measures = { total: 0, existing: 0, pending: 0 }
    let created = 0
    let skipped = 0
    let nextRow = (max?.maxRow ?? 0) + 1

    for (const row of batchRows) {
      const issues = (row.issues ?? []) as RiskImportIssue[]
      const normalized = row.normalized as Re04Normalized
      const key = factorKeyOf(normalized)
      const riskFactorId = key === null ? null : factors.byKey.get(key) ?? null

      if (rowBlocked(issues, normalized, riskFactorId)) {
        skipped += 1
        // La fila detenida no se carga; `resolution` deja dicho que se ignoró y
        // el estado sigue señalando por qué (fuera de escala, o falta el factor).
        await tx.update(preventionRiskImportRows).set({
          resolution: "ignorada",
          status: issues.some((issue) => issue.code === "p_out_of_scale" || issue.code === "c_out_of_scale") ? "rejected" : "needs_review",
        }).where(eq(preventionRiskImportRows.id, row.id))
        continue
      }

      const [entry] = await tx.insert(preventionRiskEntries).values({
        id: `riskentry-${nanoid()}`,
        matrixId: matrix.id,
        rowNumber: nextRow,
        hazardCode: `R-${nanoid(8)}`,
        ...(await entryColumns(tx, matrix.worksiteId, normalized, riskFactorId, {
          rowNumber: row.rowNumber,
          original: row.original as Record<string, unknown>,
          normalized: row.normalized as Record<string, unknown>,
          issues,
        })),
        version: 1,
        createdAt: now,
        updatedAt: now,
      }).returning({
        id: preventionRiskEntries.id, rowNumber: preventionRiskEntries.rowNumber, classification: preventionRiskEntries.classification,
      })
      nextRow += 1
      created += 1

      const rowMeasures = measuresByRow.get(row.rowNumber) ?? []
      if (rowMeasures.length > 0) {
        const controls = rowMeasures.map((measure, index) => importedControl(measure, index, entry!.id, now, data, responsibleNames))
        await tx.insert(preventionRiskControls).values(controls)
        for (const control of controls) {
          measures.total += 1
          if (control.isExisting) measures.existing += 1
          else measures.pending += 1
        }
      }

      await tx.update(preventionRiskImportRows).set({
        status: "activated", resolution, riskEntryId: entry!.id, resolvedByUserId: access.userId, resolvedAt: now,
      }).where(eq(preventionRiskImportRows.id, row.id))
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "entry", objectId: entry!.id, changeType: "import_applied",
        after: { batchId: batch.id, sourceRowNumber: row.rowNumber, riskEntryId: entry!.id, resolution, rowNumber: entry!.rowNumber, measures: rowMeasures.length },
        actorUserId: access.userId, actingAs: EDIT,
      })
      if (entry!.classification === "intolerable") {
        intolerable.push({ entryId: entry!.id, rowNumber: entry!.rowNumber ?? nextRow - 1 })
      }
    }

    /* `updated_at` es lo que «Requieren mi acción» lee como «cambios sin enviar»:
     * sin esto las filas agregadas al vigente no aparecerían. */
    await tx.update(preventionRiskMatrices).set({
      updatedAt: now,
      // El lote sólo es dueño de la matriz que él mismo crea (índice único).
      ...(draftId !== null ? { sourceImportBatchId: batch.id } : {}),
    }).where(eq(preventionRiskMatrices.id, matrix.id))

    const ready = batchRows.filter((row) => riskImportStatus((row.issues ?? []) as RiskImportIssue[]) === "ready").length
    await tx.update(preventionRiskImportBatches).set({
      status: "activated",
      approvedByUserId: access.userId, approvedAt: now,
      activatedByUserId: access.userId, activatedAt: now, activatedMatrixId: matrix.id,
      totalRows: batchRows.length, readyRows: ready, reviewRows: batchRows.length - ready,
    }).where(eq(preventionRiskImportBatches.id, batch.id))

    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "matrix", objectId: matrix.id, changeType: "import_applied",
      after: {
        batchId: batch.id, target: data.target, sourceFileName: batch.sourceFileName,
        sourceImportBatchId: draftId !== null ? batch.id : null, created, skipped,
        measures: measures.total, existing: measures.existing, pending: measures.pending,
      },
      actorUserId: access.userId, actingAs: EDIT,
    })

    return { matrixId: matrix.id, matrixTitle: matrix.title, worksiteId: matrix.worksiteId, created, skipped, intolerable, measures }
  })

  /* Post-COMMIT y una vez por fila: la deduplicación por fila
   * (`miper-row-intolerable:{entryId}`) hace seguras las repeticiones. */
  for (const row of result.intolerable) {
    notifyMiperRowIntolerable({
      matrixId: result.matrixId, worksiteId: result.worksiteId, matrixTitle: result.matrixTitle,
      entryId: row.entryId, rowNumber: row.rowNumber, actorUserId: access.userId,
    })
  }

  return {
    batchId: data.batchId,
    matrixId: result.matrixId,
    target: data.target,
    created: result.created,
    skipped: result.skipped,
    notified: result.intolerable.length,
    measures: result.measures,
  }
}

/**
 * Responsables elegidos como persona: activos y de la faena (o quien importa),
 * lo mismo que ofreció la vista previa (`worksiteResponsibleOptions`). Un id que
 * no está ahí viene de un cliente adulterado o de una baja entre la vista previa
 * y la carga: se rechaza, no se carga a medias.
 */
async function importResponsibleNames(client: Client, worksiteId: string, mapping: Readonly<Record<string, ResponsibleDecision>>, access: MiperAccess) {
  const ids = [...new Set(Object.values(mapping).flatMap((decision) => (decision.kind === "user" ? [decision.userId] : [])))]
  if (ids.length === 0) return new Map<string, string>()
  await assertActiveUsers(client, ids)
  const allowed = new Set((await worksiteResponsibleOptions(client, worksiteId, access.userId)).map((option) => option.id))
  if (ids.some((id) => !allowed.has(id))) throw new RiskLegalDomainError("La persona responsable no es de la faena o está inactiva.")
  return userNames(client, ids)
}

/**
 * La medida importada (Fase C). Siempre «propuesta» —existente o por
 * implementar— hasta que alguien la verifique: así no baja «Riesgos críticos sin
 * control» sin evidencia (decisión del usuario). D5: la existente lleva su
 * frecuencia y no plazo; la por implementar, su plazo.
 */
function importedControl(measure: ImportMeasure, index: number, riskEntryId: string, now: string, mappings: ImportMappings, names: ReadonlyMap<string, string>) {
  const responsible = mappings.responsibleMapping[measure.responsibleKey]!
  const deadline = mappings.deadlineMapping[measure.deadlineKey]!
  return {
    id: `riskcontrol-${nanoid()}`,
    riskEntryId,
    hierarchy: mappings.measureMapping[measure.phraseKey]!,
    description: measure.text,
    isExisting: deadline.kind === "existing",
    verificationFrequency: deadline.kind === "existing" ? cleanMiperName(deadline.frequency) : null,
    dueDate: deadline.kind === "pending" ? deadline.dueDate : null,
    responsibleUserId: responsible.kind === "user" ? responsible.userId : null,
    responsibleSnapshot: responsible.kind === "user" ? names.get(responsible.userId) ?? null
      : responsible.kind === "text" ? cleanMiperName(responsible.name) : null,
    status: "proposed",
    /* Todas nacen en la misma transacción: un milisegundo más por medida conserva
     * el orden del Excel (la foto ordena por `created_at` y desempata por id). */
    createdAt: new Date(Date.parse(now) + index).toISOString(),
    updatedAt: now,
  }
}
```

`mappingProblems(analysis, data)` y `importedControl(…, data, …)` reciben el resultado de
`riskImportCommitSchema.parse` como `ImportMappings`: los tipos de Zod calzan con los de
`re04-measures.ts` sin conversión.

- [ ] **Step 6: El mensaje de la acción**

En `app/(app)/prevencion/miper/actions.ts`:
- reemplazar `import { commitRiskImport, previewRiskImport } from "@/lib/services/miper/import"` por
  `import { commitRiskImport, previewRiskImport, type RiskImportCommitResult } from "@/lib/services/miper/import"`;
- agregar `import { countOf } from "@/lib/utils"`;
- reemplazar `commitRiskImportAction` entera por:

```ts
export async function commitRiskImportAction(input: unknown) {
  return guarded("prevention:risk:edit", input, (access) => commitRiskImport(input, access), {
    data: (result) => ({ matrixId: result.matrixId, created: result.created, skipped: result.skipped, measures: result.measures }),
    success: importResultMessage,
  })
}

/** «3 riesgos cargados con 10 medidas propuestas (6 existentes y 4 por implementar); 1 fila detenida». */
function importResultMessage(result: RiskImportCommitResult): string {
  if (result.created === 0) return "No se cargó ninguna fila: revisa los problemas por fila."
  const measures = result.measures.total === 0 ? ""
    : ` con ${countOf(result.measures.total, "medida propuesta", "medidas propuestas")} (${countOf(result.measures.existing, "existente")} y ${result.measures.pending} por implementar)`
  const skipped = result.skipped > 0 ? `; ${countOf(result.skipped, "fila detenida", "filas detenidas")}` : ""
  return `${countOf(result.created, "riesgo cargado", "riesgos cargados")}${measures}${skipped}`
}
```

`importResultMessage` no se exporta: un archivo `"use server"` sólo exporta funciones `async`.

- [ ] **Step 7: Run tests to verify they pass**

```bash
npm run test:fast -- lib/validation/prevention-module/miper.test.ts "app/(app)/prevencion/miper/actions.test.ts" lib/prevention/miper/re04-measures.test.ts
npm run test:pglite -- lib/__tests__/miper-import.test.ts
npm run test:pglite -- lib/__tests__/miper-matrices.test.ts
npm run test:pglite -- lib/__tests__/miper-notifications.test.ts
```

Expected: PASS. `miper-matrices` prueba que el alta de siempre no cambió. `miper-notifications`
prueba que el aviso de fila Intolerable de la importación sigue saliendo después del COMMIT.

- [ ] **Step 8: Puertas**

```bash
npm run typecheck
npm run lint -- lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts lib/services/miper/matrices.ts lib/services/miper/import.ts lib/__tests__/miper-import.test.ts "app/(app)/prevencion/miper/actions.ts" "app/(app)/prevencion/miper/actions.test.ts"
```

- [ ] **Step 9: Commit**

```bash
git add lib/validation/prevention-module/miper.ts lib/validation/prevention-module/miper.test.ts lib/services/miper/matrices.ts lib/services/miper/import.ts lib/__tests__/miper-import.test.ts "app/(app)/prevencion/miper/actions.ts" "app/(app)/prevencion/miper/actions.test.ts"
git commit -m "feat(miper): la carga del RE-04 crea las medidas propuestas en la misma transacción que el borrador y rechaza un mapeo incompleto o ajeno" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Diálogo de importación en cuatro pasos

**Files:**
- Create: `lib/prevention/miper/import-decisions.ts`
- Test: `lib/prevention/miper/import-decisions.test.ts`
- Create: `app/(app)/prevencion/miper/import-measures-step.tsx`
- Test: `app/(app)/prevencion/miper/import-measures-step.test.tsx`
- Modify (reescrito): `app/(app)/prevencion/miper/import-dialog.tsx`
- Test (nuevo): `app/(app)/prevencion/miper/import-dialog.test.tsx`

**Interfaces:**
- Consumes:
  - de la Task 6 (sólo tipos): `MeasureAnalysis`, `ImportMappings`, `ResponsibleDecision`,
    `DeadlineDecision`, `PhraseGroup`;
  - de la Task 7: `RiskImportPreview.measureAnalysis` y `.responsibleOptions`;
  - de la Task 8: `commitRiskImportAction` con los tres mapeos, y su `data.matrixId` y `message`.
- Produces:
  - En `lib/prevention/miper/import-decisions.ts` (puro, sin React):
    - `type PhraseDecision = { hierarchy: ControlHierarchy; confirmed: boolean }`
    - `type ImportDecisions = { phrases: Record<string, PhraseDecision>; responsibles: Record<string, ResponsibleDecision>; deadlines: Record<string, DeadlineDecision> }`
    - `initialDecisions(analysis: MeasureAnalysis): ImportDecisions`: el tipo nace sugerido salvo el
      del prefijo, que nace confirmado;
    - `unconfirmedCount(decisions: ImportDecisions): number`
    - `acceptSuggestions(decisions: ImportDecisions): ImportDecisions`
    - `choosePhraseType(decisions: ImportDecisions, key: string, hierarchy: ControlHierarchy): ImportDecisions`
    - `decisionsToMappings(decisions: ImportDecisions): ImportMappings`
    - `type ImportSummary = { measures: number; existing: number; pending: number }`
    - `importSummary(analysis: MeasureAnalysis, loadableRows: ReadonlySet<number>, deadlines: Record<string, DeadlineDecision>): ImportSummary`
  - `ImportMeasuresStep({ analysis, responsibleOptions, decisions, onChange })`. Las tres regiones se
    llaman «Tipo de cada medida detectada», «Responsables del Excel» y «Plazos del Excel». Los
    controles por valor se llaman:
    - «Tipo de control de «<frase>»» y «Confirmar el tipo de «<frase>»»;
    - «Responsable para «<valor>»»;
    - «Cómo se cargan las medidas con «<valor>»», «Frecuencia de verificación para «<valor>»» y
      «Plazo para «<valor>»».

    `<frase>` y `<valor>` se cortan a 60 caracteres con «…». Los botones son «Aceptar sugerencias
    (N)» y el checkbox, «Sólo sugeridas».
  - `ImportMiperDialog`, con las mismas props. Sus nombres para la E2E (Task 10) y la Task 11:
    - el diálogo se llama «Importar el RE-04» y el paso actual lleva `aria-current="step"` con el
      texto «N. <Paso>»;
    - los campos son «Faena» (combobox), «Período del borrador» y «Archivo del RE-04»;
    - los botones son «Revisar el archivo», «Siguiente», «Atrás», «Cargar en borrador» y «Agregar al
      vigente»;
    - las regiones son «Qué se va a cargar» y la del resumen «<N> medidas: <X> existentes y <Y> por
      implementar.»;
    - el error del servidor sale en `role="alert"`.

- [ ] **Step 1: Write the failing tests**

Crear `lib/prevention/miper/import-decisions.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { acceptSuggestions, choosePhraseType, decisionsToMappings, importSummary, initialDecisions, unconfirmedCount } from "./import-decisions"
import type { MeasureAnalysis } from "./re04-measures"

/** Dos filas del Excel (14 y 15): una con plazo «INMEDIATO…» y otra «TRIMESTRAL»; una frase trae su «III.». */
const ANALYSIS: MeasureAnalysis = {
  measures: [
    { rowNumber: 14, text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", phraseKey: "uso epp casco guantes calzado seguridad", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 14, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 15, text: "Topes de descarga", phraseKey: "topes descarga", prefix: "engineering", responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
    { rowNumber: 15, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
  ],
  phrases: [
    { key: "orden limpieza", text: "ORDEN Y LIMPIEZA", count: 2, suggestion: { hierarchy: "administrative", source: "keyword" } },
    { key: "topes descarga", text: "Topes de descarga", count: 1, suggestion: { hierarchy: "engineering", source: "prefix" } },
    { key: "uso epp casco guantes calzado seguridad", text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", count: 1, suggestion: { hierarchy: "ppe", source: "keyword" } },
  ],
  responsibles: [{ key: "supervisor/prevencion", text: "SUPERVISOR/PREVENCION", count: 4, suggestion: { kind: "text", name: "SUPERVISOR/PREVENCION" } }],
  deadlines: [
    { key: "inmediato / antes de continuar la tarea", text: "INMEDIATO / ANTES DE CONTINUAR LA TAREA", count: 2, suggestion: { kind: "pending", dueDate: "2026-10-03" } },
    { key: "trimestral", text: "TRIMESTRAL", count: 2, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } },
  ],
}

describe("decisiones de la vista previa (Fase C)", () => {
  it("el tipo nace sugerido salvo el que trae el Excel; responsables y plazos nacen en su sugerencia", () => {
    const decisions = initialDecisions(ANALYSIS)
    expect(decisions.phrases).toEqual({
      "orden limpieza": { hierarchy: "administrative", confirmed: false },
      "topes descarga": { hierarchy: "engineering", confirmed: true },
      "uso epp casco guantes calzado seguridad": { hierarchy: "ppe", confirmed: false },
    })
    expect(unconfirmedCount(decisions)).toBe(2)
    expect(decisions.responsibles["supervisor/prevencion"]).toEqual({ kind: "text", name: "SUPERVISOR/PREVENCION" })
    expect(decisions.deadlines.trimestral).toEqual({ kind: "existing", frequency: "TRIMESTRAL" })
  })

  it("«Aceptar sugerencias» confirma todo sin cambiar los tipos; elegir un tipo confirma esa frase; nada se modifica en el lugar", () => {
    const decisions = initialDecisions(ANALYSIS)
    const accepted = acceptSuggestions(decisions)
    expect(unconfirmedCount(accepted)).toBe(0)
    expect(accepted.phrases["orden limpieza"]).toEqual({ hierarchy: "administrative", confirmed: true })
    const chosen = choosePhraseType(decisions, "orden limpieza", "engineering")
    expect(chosen.phrases["orden limpieza"]).toEqual({ hierarchy: "engineering", confirmed: true })
    expect(unconfirmedCount(chosen)).toBe(1)
    expect(decisions.phrases["orden limpieza"]!.confirmed).toBe(false)
  })

  it("los mapeos para el servidor son las decisiones, sin el estado de confirmación", () => {
    expect(decisionsToMappings(acceptSuggestions(initialDecisions(ANALYSIS)))).toEqual({
      measureMapping: { "orden limpieza": "administrative", "topes descarga": "engineering", "uso epp casco guantes calzado seguridad": "ppe" },
      responsibleMapping: { "supervisor/prevencion": { kind: "text", name: "SUPERVISOR/PREVENCION" } },
      deadlineMapping: { "inmediato / antes de continuar la tarea": { kind: "pending", dueDate: "2026-10-03" }, trimestral: { kind: "existing", frequency: "TRIMESTRAL" } },
    })
  })

  it("el resumen cuenta sólo las medidas de las filas que se cargan, existentes o por implementar según su plazo", () => {
    const { deadlines } = initialDecisions(ANALYSIS)
    expect(importSummary(ANALYSIS, new Set([14, 15]), deadlines)).toEqual({ measures: 4, existing: 2, pending: 2 })
    expect(importSummary(ANALYSIS, new Set([14]), deadlines)).toEqual({ measures: 2, existing: 0, pending: 2 })
    expect(importSummary(ANALYSIS, new Set([14, 15]), { ...deadlines, trimestral: { kind: "pending", dueDate: null } })).toEqual({ measures: 4, existing: 0, pending: 4 })
  })
})
```

Crear `app/(app)/prevencion/miper/import-measures-step.test.tsx`:

```tsx
// @vitest-environment jsdom
import { useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { initialDecisions, type ImportDecisions } from "@/lib/prevention/miper/import-decisions"
import type { MeasureAnalysis } from "@/lib/prevention/miper/re04-measures"
import { ImportMeasuresStep } from "./import-measures-step"

const ANALYSIS: MeasureAnalysis = {
  measures: [
    { rowNumber: 14, text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", phraseKey: "uso epp casco guantes calzado seguridad", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 14, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 15, text: "Topes de descarga", phraseKey: "topes descarga", prefix: "engineering", responsibleKey: "", deadlineKey: "trimestral" },
  ],
  phrases: [
    { key: "orden limpieza", text: "ORDEN Y LIMPIEZA", count: 1, suggestion: { hierarchy: "administrative", source: "keyword" } },
    { key: "topes descarga", text: "Topes de descarga", count: 1, suggestion: { hierarchy: "engineering", source: "prefix" } },
    { key: "uso epp casco guantes calzado seguridad", text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", count: 1, suggestion: { hierarchy: "ppe", source: "default" } },
  ],
  responsibles: [
    { key: "supervisor/prevencion", text: "SUPERVISOR/PREVENCION", count: 2, suggestion: { kind: "text", name: "SUPERVISOR/PREVENCION" } },
    { key: "", text: null, count: 1, suggestion: { kind: "none" } },
  ],
  deadlines: [
    { key: "inmediato / antes de continuar la tarea", text: "INMEDIATO / ANTES DE CONTINUAR LA TAREA", count: 2, suggestion: { kind: "pending", dueDate: "2026-10-03" } },
    { key: "trimestral", text: "TRIMESTRAL", count: 1, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } },
  ],
}
const USERS = [{ id: "u-1", name: "Jefe de faena" }]

/** El paso es controlado: el arnés guarda las decisiones como lo hace el diálogo. */
function Harness({ onChange }: { onChange?: (decisions: ImportDecisions) => void }) {
  const [decisions, setDecisions] = useState(() => initialDecisions(ANALYSIS))
  return <ImportMeasuresStep analysis={ANALYSIS} responsibleOptions={USERS} decisions={decisions} onChange={(next) => { setDecisions(next); onChange?.(next) }} />
}
const tipos = () => screen.getByRole("region", { name: "Tipo de cada medida detectada" })

describe("ImportMeasuresStep (Fase C)", () => {
  it("las frases sin tipo del Excel nacen sugeridas (la sin pista lo dice); «Aceptar sugerencias» las confirma todas", () => {
    render(<Harness />)
    expect(within(tipos()).getByText("Sugerida")).toBeTruthy()
    expect(within(tipos()).getByText("Sugerida · sin pista")).toBeTruthy()
    expect(within(tipos()).getByText("Del Excel")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Aceptar sugerencias (2)" }))
    expect(within(tipos()).queryByText(/^Sugerida/)).toBeNull()
    expect(screen.getByRole("button", { name: "Aceptar sugerencias (0)" })).toBeDisabled()
  })

  it("«Sólo sugeridas» deja a la vista lo que falta; elegir un tipo o «Confirmar» confirma esa frase", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Sólo sugeridas" }))
    expect(within(tipos()).queryByText("Topes de descarga")).toBeNull()
    fireEvent.click(within(tipos()).getByRole("combobox", { name: "Tipo de control de «ORDEN Y LIMPIEZA»" }))
    fireEvent.click(screen.getByRole("option", { name: "III. Controles de ingeniería" }))
    expect(onChange.mock.lastCall![0].phrases["orden limpieza"]).toEqual({ hierarchy: "engineering", confirmed: true })
    expect(within(tipos()).queryByText("ORDEN Y LIMPIEZA")).toBeNull()
    fireEvent.click(within(tipos()).getByRole("button", { name: /^Confirmar el tipo de «USO DE EPP/ }))
    expect(onChange.mock.lastCall![0].phrases["uso epp casco guantes calzado seguridad"]).toEqual({ hierarchy: "ppe", confirmed: true })
  })

  it("cada responsable del Excel se decide una vez: como está escrito, una persona de la faena o sin responsable", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const responsables = screen.getByRole("region", { name: "Responsables del Excel" })
    expect(within(responsables).getByRole("combobox", { name: "Responsable para «SUPERVISOR/PREVENCION»" })).toHaveTextContent("Tal como dice el Excel")
    expect(within(responsables).getByRole("combobox", { name: "Responsable para «(vacío)»" })).toHaveTextContent("Sin responsable")
    fireEvent.click(within(responsables).getByRole("combobox", { name: "Responsable para «SUPERVISOR/PREVENCION»" }))
    fireEvent.click(screen.getByRole("option", { name: "Jefe de faena" }))
    expect(onChange.mock.lastCall![0].responsibles["supervisor/prevencion"]).toEqual({ kind: "user", userId: "u-1" })
  })

  it("cada plazo del Excel se decide una vez: existente con su frecuencia o por implementar con fecha", () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const plazos = screen.getByRole("region", { name: "Plazos del Excel" })
    expect(within(plazos).getByRole("textbox", { name: "Frecuencia de verificación para «TRIMESTRAL»" })).toHaveValue("TRIMESTRAL")
    expect(within(plazos).getByRole("button", { name: "Plazo para «INMEDIATO / ANTES DE CONTINUAR LA TAREA»: 03-10-2026" })).toBeTruthy()
    fireEvent.click(within(plazos).getByRole("combobox", { name: "Cómo se cargan las medidas con «TRIMESTRAL»" }))
    fireEvent.click(screen.getByRole("option", { name: "Por implementar: llevan plazo" }))
    expect(onChange.mock.lastCall![0].deadlines.trimestral).toEqual({ kind: "pending", dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(within(plazos).queryByRole("textbox", { name: "Frecuencia de verificación para «TRIMESTRAL»" })).toBeNull()
  })
})
```

Crear `app/(app)/prevencion/miper/import-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MeasureAnalysis } from "@/lib/prevention/miper/re04-measures"
import type { RiskImportPreview } from "@/lib/services/miper/import"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper", useSearchParams: () => new URLSearchParams() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))
const actions = vi.hoisted(() => ({ previewRiskImportAction: vi.fn(), commitRiskImportAction: vi.fn(), saveRiskFactorAction: vi.fn() }))
vi.mock("./actions", () => actions)

import { ImportMiperDialog } from "./import-dialog"

const ANALYSIS: MeasureAnalysis = {
  measures: [
    { rowNumber: 14, text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", phraseKey: "uso epp casco guantes calzado seguridad", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 14, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "inmediato / antes de continuar la tarea" },
    { rowNumber: 15, text: "Topes de descarga", phraseKey: "topes descarga", prefix: "engineering", responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
    { rowNumber: 15, text: "ORDEN Y LIMPIEZA", phraseKey: "orden limpieza", prefix: null, responsibleKey: "supervisor/prevencion", deadlineKey: "trimestral" },
  ],
  phrases: [
    { key: "orden limpieza", text: "ORDEN Y LIMPIEZA", count: 2, suggestion: { hierarchy: "administrative", source: "keyword" } },
    { key: "topes descarga", text: "Topes de descarga", count: 1, suggestion: { hierarchy: "engineering", source: "prefix" } },
    { key: "uso epp casco guantes calzado seguridad", text: "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", count: 1, suggestion: { hierarchy: "ppe", source: "keyword" } },
  ],
  responsibles: [{ key: "supervisor/prevencion", text: "SUPERVISOR/PREVENCION", count: 4, suggestion: { kind: "text", name: "SUPERVISOR/PREVENCION" } }],
  deadlines: [
    { key: "inmediato / antes de continuar la tarea", text: "INMEDIATO / ANTES DE CONTINUAR LA TAREA", count: 2, suggestion: { kind: "pending", dueDate: "2026-10-03" } },
    { key: "trimestral", text: "TRIMESTRAL", count: 2, suggestion: { kind: "existing", frequency: "TRIMESTRAL" } },
  ],
}

function previewRow(rowNumber: number, status: "ready" | "rejected") {
  return {
    rowNumber, status, original: {}, fingerprintSha256: "x", riskFactorId: "riskfactor-mecanico", riskFactorName: "Mecánico",
    issues: status === "rejected" ? [{ code: "p_out_of_scale", message: "La probabilidad 3 no está en la escala (1, 2 o 4)." }] : [],
    normalized: { activity: "Traslado de lodo", hazard: `Peligro de la fila ${rowNumber}`, risk: null, probability: 2, consequence: 4 },
    magnitude: status === "rejected" ? null : 8, classification: status === "rejected" ? null : "important",
  }
}

/** Lo que la vista previa devuelve: sólo los campos que pinta el diálogo. */
const preview = (batchId: string) => ({
  batchId, sheetName: "RE-04 IPER", target: "draft",
  rows: [previewRow(14, "ready"), previewRow(15, "ready"), previewRow(16, "rejected")],
  totals: { total: 3, ready: 2, needsReview: 0, rejected: 1 },
  draft: { period: 2026, blockedReason: null },
  live: { matrixId: null, title: null, blockedReason: "La faena no tiene una MIPER vigente a la que agregar las filas: cárgalas en un borrador." },
  measureAnalysis: ANALYSIS,
  responsibleOptions: [{ id: "u-1", name: "Jefe de faena" }],
}) as unknown as RiskImportPreview

const WORKSITES = [{ id: "ws-1", name: "Faena Norte", vigenteId: null, vigentePeriod: null, vigenteIsLegacy: false, vigenteHasUnsentChanges: false }]
const pasoActual = (dialog: HTMLElement) => dialog.querySelector('[aria-current="step"]')
/** Holgura para `test:fast`, que corre cientos de archivos en paralelo: 1 s (el valor por defecto) se queda corto bajo carga. */
const LENTO = { timeout: 5000 }

async function abrirYRevisar() {
  render(<ImportMiperDialog worksites={WORKSITES} currentYear={2026} canManageCatalog={false} />)
  fireEvent.click(screen.getByRole("button", { name: "Importar" }))
  const dialog = await screen.findByRole("dialog", { name: "Importar el RE-04" }, LENTO)
  fireEvent.change(within(dialog).getByLabelText("Archivo del RE-04"), { target: { files: [new File(["x"], "RE-04 Biodiversa.xlsx")] } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Revisar el archivo" }))
  await within(dialog).findByText("3 filas en «RE-04 IPER»: 2 para cargar, 0 por revisar y 1 sin cargar.", {}, LENTO)
  return dialog
}

afterEach(() => { vi.clearAllMocks() })

describe("ImportMiperDialog (Fase C)", () => {
  it("recorre Archivo → Filas → Medidas detectadas → Confirmar y envía los tres mapeos", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: preview("riskimport-1") } })
    actions.commitRiskImportAction.mockResolvedValue({ ok: true, message: "2 riesgos cargados con 4 medidas propuestas (2 existentes y 2 por implementar); 1 fila detenida", data: { matrixId: "m-nueva" } })
    const dialog = await abrirYRevisar()
    expect(pasoActual(dialog)).toHaveTextContent("2. Filas")

    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    expect(pasoActual(dialog)).toHaveTextContent("3. Medidas detectadas")
    // No se avanza con tipos sin confirmar: el Excel no los trae y siempre los confirma una persona.
    expect(within(dialog).getByRole("button", { name: "Siguiente" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))

    expect(pasoActual(dialog)).toHaveTextContent("4. Confirmar")
    const resumen = within(dialog).getByRole("region", { name: "Qué se va a cargar" })
    expect(resumen).toHaveTextContent("2 riesgos listos para cargar.")
    expect(resumen).toHaveTextContent("1 fila no se carga: probabilidad o consecuencia fuera de 1, 2 y 4.")
    expect(resumen).toHaveTextContent("4 medidas: 2 existentes y 2 por implementar.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cargar en borrador" }))

    await waitFor(() => expect(actions.commitRiskImportAction).toHaveBeenCalledTimes(1), LENTO)
    expect(actions.commitRiskImportAction).toHaveBeenCalledWith({
      batchId: "riskimport-1", worksiteId: "ws-1", target: "draft", period: 2026, revisionReason: "Importación RE-04 desde RE-04 Biodiversa.xlsx",
      measureMapping: { "orden limpieza": "administrative", "topes descarga": "engineering", "uso epp casco guantes calzado seguridad": "ppe" },
      responsibleMapping: { "supervisor/prevencion": { kind: "text", name: "SUPERVISOR/PREVENCION" } },
      deadlineMapping: { "inmediato / antes de continuar la tarea": { kind: "pending", dueDate: "2026-10-03" }, trimestral: { kind: "existing", frequency: "TRIMESTRAL" } },
    })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m-nueva"), LENTO)
    expect(toast.success).toHaveBeenCalledWith("2 riesgos cargados con 4 medidas propuestas (2 existentes y 2 por implementar); 1 fila detenida")
  })

  it("volver a revisar el archivo descarta las decisiones: valen las del lote nuevo (Review Focus 1)", async () => {
    actions.previewRiskImportAction.mockResolvedValueOnce({ ok: true, data: { preview: preview("riskimport-1") } })
    actions.previewRiskImportAction.mockResolvedValueOnce({ ok: true, data: { preview: preview("riskimport-2") } })
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Atrás" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Atrás" }))
    expect(pasoActual(dialog)).toHaveTextContent("1. Archivo")
    fireEvent.change(within(dialog).getByLabelText("Período del borrador"), { target: { value: "2027" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Revisar el archivo" }))
    await within(dialog).findByText("3 filas en «RE-04 IPER»: 2 para cargar, 0 por revisar y 1 sin cargar.", {}, LENTO)
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    // Las sugerencias aceptadas eran del lote 1: en el lote 2 vuelven a estar por confirmar.
    expect(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: "Siguiente" })).toBeDisabled()
  })

  it("un rechazo del servidor queda a la vista y el diálogo no se cierra", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: preview("riskimport-1") } })
    actions.commitRiskImportAction.mockResolvedValue({ ok: false, message: "La importación no coincide con la vista previa: falta decidir el tipo de 1 medida. Vuelve a revisar el archivo." })
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar sugerencias (2)" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Cargar en borrador" }))
    expect(await within(dialog).findByRole("alert", {}, LENTO)).toHaveTextContent("falta decidir el tipo de 1 medida")
    expect(router.push).not.toHaveBeenCalled()
    expect(pasoActual(dialog)).toHaveTextContent("4. Confirmar")
  })

  it("un archivo sin medidas salta «Medidas detectadas»", async () => {
    actions.previewRiskImportAction.mockResolvedValue({ ok: true, data: { preview: { ...preview("riskimport-1"), measureAnalysis: { measures: [], phrases: [], responsibles: [], deadlines: [] } } } })
    const dialog = await abrirYRevisar()
    fireEvent.click(within(dialog).getByRole("button", { name: "Siguiente" }))
    expect(pasoActual(dialog)).toHaveTextContent("4. Confirmar")
    expect(within(dialog).getByRole("region", { name: "Qué se va a cargar" })).toHaveTextContent("El archivo no trae medidas de control.")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/import-decisions.test.ts "app/(app)/prevencion/miper/import-measures-step.test.tsx" "app/(app)/prevencion/miper/import-dialog.test.tsx"`

Expected: FAIL. Los dos primeros no resuelven sus módulos, y el del diálogo no encuentra el texto de
totales ni los pasos.

- [ ] **Step 3: Las decisiones (puro)**

Crear `lib/prevention/miper/import-decisions.ts`:

```ts
/**
 * Estado de las decisiones del paso «Medidas detectadas» de la importación
 * (Fase C, spec §8). Puro, sin React: lo usa el diálogo y lo prueba `vitest`.
 *
 * - El tipo de cada frase nace SUGERIDO (`confirmed: false`), salvo que el Excel
 *   lo traiga («IV. …» del libro exportado). El Excel del RE-04 no trae tipo:
 *   siempre lo confirma una persona, eligiéndolo, con «Confirmar» o con «Aceptar
 *   sugerencias».
 * - Responsables y plazos nacen en su sugerencia y se pueden cambiar; no piden
 *   una confirmación aparte.
 * - Todas las funciones devuelven un objeto nuevo: nada se modifica en el lugar.
 */
import type { DeadlineDecision, ImportMappings, MeasureAnalysis, ResponsibleDecision } from "./re04-measures"
import type { ControlHierarchy } from "./snapshot"

export type PhraseDecision = { hierarchy: ControlHierarchy; confirmed: boolean }
export type ImportDecisions = {
  phrases: Record<string, PhraseDecision>
  responsibles: Record<string, ResponsibleDecision>
  deadlines: Record<string, DeadlineDecision>
}
export type ImportSummary = { measures: number; existing: number; pending: number }

export function initialDecisions(analysis: MeasureAnalysis): ImportDecisions {
  return {
    phrases: Object.fromEntries(analysis.phrases.map((phrase) => [phrase.key, { hierarchy: phrase.suggestion.hierarchy, confirmed: phrase.suggestion.source === "prefix" }])),
    responsibles: Object.fromEntries(analysis.responsibles.map((group) => [group.key, group.suggestion])),
    deadlines: Object.fromEntries(analysis.deadlines.map((group) => [group.key, group.suggestion])),
  }
}

export function unconfirmedCount(decisions: ImportDecisions): number {
  return Object.values(decisions.phrases).filter((decision) => !decision.confirmed).length
}

/** «Aceptar sugerencias»: confirma todas las frases con el tipo que ya tienen. */
export function acceptSuggestions(decisions: ImportDecisions): ImportDecisions {
  return {
    ...decisions,
    phrases: Object.fromEntries(Object.entries(decisions.phrases).map(([key, decision]) => [key, { ...decision, confirmed: true }])),
  }
}

/** Elegir un tipo (o confirmar el sugerido) confirma esa frase. */
export function choosePhraseType(decisions: ImportDecisions, key: string, hierarchy: ControlHierarchy): ImportDecisions {
  return { ...decisions, phrases: { ...decisions.phrases, [key]: { hierarchy, confirmed: true } } }
}

/** Lo que viaja a `commitRiskImportAction`: las decisiones, sin el estado de confirmación. */
export function decisionsToMappings(decisions: ImportDecisions): ImportMappings {
  return {
    measureMapping: Object.fromEntries(Object.entries(decisions.phrases).map(([key, decision]) => [key, decision.hierarchy])),
    responsibleMapping: { ...decisions.responsibles },
    deadlineMapping: { ...decisions.deadlines },
  }
}

/**
 * Cuántas medidas se cargarían y cómo: sólo las de las filas que se cargan
 * (`loadableRows`, las «listas»), existentes o por implementar según la decisión
 * de su plazo.
 */
export function importSummary(analysis: MeasureAnalysis, loadableRows: ReadonlySet<number>, deadlines: Record<string, DeadlineDecision>): ImportSummary {
  let existing = 0
  let pending = 0
  for (const measure of analysis.measures) {
    if (!loadableRows.has(measure.rowNumber)) continue
    if (deadlines[measure.deadlineKey]?.kind === "existing") existing += 1
    else pending += 1
  }
  return { measures: existing + pending, existing, pending }
}
```

- [ ] **Step 4: El paso «Medidas detectadas»**

Crear `app/(app)/prevencion/miper/import-measures-step.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { acceptSuggestions, choosePhraseType, unconfirmedCount, type ImportDecisions, type PhraseDecision } from "@/lib/prevention/miper/import-decisions"
import type { DeadlineDecision, MeasureAnalysis, PhraseGroup, ResponsibleDecision } from "@/lib/prevention/miper/re04-measures"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy } from "@/lib/prevention/miper/snapshot"
import { countOf, todayInChile } from "@/lib/utils"

const HIERARCHY_OPTIONS = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>).map(([value, label]) => ({ value, label }))
const AS_WRITTEN = "__excel__"
const NOBODY = "__nadie__"
const KIND_OPTIONS = [
  { value: "existing", label: "Ya implementadas: se verifican" },
  { value: "pending", label: "Por implementar: llevan plazo" },
]
/** Nombre corto de una frase o un valor para los nombres accesibles. */
const short = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text)
const valueLabel = (group: { text: string | null }) => group.text ?? "(vacío)"

/**
 * Paso «Medidas detectadas» de la importación (Fase C, spec §8). La persona
 * decide UNA VEZ por valor distinto (D6), no fila por fila:
 * - el tipo I–V de cada frase (el Excel no lo trae: se sugiere y se confirma);
 * - quién responde por cada valor de RESPONSABLE;
 * - si cada valor de PLAZOS es una medida existente (con su frecuencia de
 *   verificación) o por implementar (con su fecha).
 * Controlado: las decisiones viven en el diálogo (`ImportDecisions`).
 */
export function ImportMeasuresStep({ analysis, responsibleOptions, decisions, onChange }: {
  analysis: MeasureAnalysis
  responsibleOptions: ReadonlyArray<{ id: string; name: string }>
  decisions: ImportDecisions
  onChange: (decisions: ImportDecisions) => void
}) {
  const [onlySuggested, setOnlySuggested] = useState(false)
  const pending = unconfirmedCount(decisions)
  const phrases = onlySuggested ? analysis.phrases.filter((phrase) => !decisions.phrases[phrase.key]?.confirmed) : analysis.phrases
  const setResponsible = (key: string, decision: ResponsibleDecision) => onChange({ ...decisions, responsibles: { ...decisions.responsibles, [key]: decision } })
  const setDeadline = (key: string, decision: DeadlineDecision) => onChange({ ...decisions, deadlines: { ...decisions.deadlines, [key]: decision } })

  return (
    <div className="space-y-6">
      <section aria-labelledby="importar-tipos" className="space-y-3">
        <div className="space-y-1">
          <h3 id="importar-tipos" className="text-sm font-semibold">Tipo de cada medida</h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            {countOf(analysis.measures.length, "medida")} en {countOf(analysis.phrases.length, "frase distinta", "frases distintas")}. El Excel no trae
            el tipo (I a V): la plataforma lo sugiere y tú lo confirmas una vez por frase.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="secondary" disabled={pending === 0} onClick={() => onChange(acceptSuggestions(decisions))}>
            Aceptar sugerencias ({pending})
          </Button>
          <Checkbox label="Sólo sugeridas" checked={onlySuggested} onChange={(event) => setOnlySuggested(event.target.checked)} />
        </div>
        {pending > 0 && (
          <p className="text-sm text-[var(--color-warning-ink)]">
            Falta confirmar el tipo de {countOf(pending, "frase")}: elígelo en cada fila, usa «Confirmar» o «Aceptar sugerencias».
          </p>
        )}
        <TableRoot aria-label="Tipo de cada medida detectada">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medida</TableHead>
                <TableHead className="text-right">Veces</TableHead>
                <TableHead>Tipo de control</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {phrases.map((phrase) => {
                const decision = decisions.phrases[phrase.key]!
                return (
                  <TableRow key={phrase.key}>
                    <TableCell className="min-w-64 whitespace-normal">{phrase.text}</TableCell>
                    <TableCell className="text-right tabular-nums">{phrase.count}</TableCell>
                    <TableCell className="min-w-56">
                      <OptionSelect aria-label={`Tipo de control de «${short(phrase.text)}»`} options={HIERARCHY_OPTIONS} value={decision.hierarchy}
                        onValueChange={(value) => onChange(choosePhraseType(decisions, phrase.key, value as ControlHierarchy))} />
                    </TableCell>
                    <TableCell>
                      <PhraseState phrase={phrase} decision={decision} onConfirm={() => onChange(choosePhraseType(decisions, phrase.key, decision.hierarchy))} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      </section>

      <section aria-labelledby="importar-responsables" className="space-y-3">
        <div className="space-y-1">
          <h3 id="importar-responsables" className="text-sm font-semibold">Responsables</h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            Cada valor de la columna RESPONSABLE se decide una vez: queda como está escrito, se asigna a una persona de la faena o queda sin responsable.
          </p>
        </div>
        <TableRoot aria-label="Responsables del Excel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>En el Excel</TableHead>
                <TableHead className="text-right">Medidas</TableHead>
                <TableHead>Responsable en la MIPER</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.responsibles.map((group) => {
                const decision = decisions.responsibles[group.key]!
                const options = [
                  ...(group.text ? [{ value: AS_WRITTEN, label: `Tal como dice el Excel: «${short(group.text)}»` }] : []),
                  ...responsibleOptions.map((option) => ({ value: option.id, label: option.name })),
                  { value: NOBODY, label: "Sin responsable" },
                ]
                const value = decision.kind === "user" ? decision.userId : decision.kind === "text" ? AS_WRITTEN : NOBODY
                return (
                  <TableRow key={group.key}>
                    <TableCell className="min-w-48 whitespace-normal">{valueLabel(group)}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.count}</TableCell>
                    <TableCell className="min-w-64">
                      <OptionSelect aria-label={`Responsable para «${short(valueLabel(group))}»`} options={options} value={value}
                        onValueChange={(next) => setResponsible(group.key, next === AS_WRITTEN ? { kind: "text", name: group.text ?? "" } : next === NOBODY ? { kind: "none" } : { kind: "user", userId: next })} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      </section>

      <section aria-labelledby="importar-plazos" className="space-y-3">
        <div className="space-y-1">
          <h3 id="importar-plazos" className="text-sm font-semibold">Plazos</h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            Cada valor de la columna PLAZOS se decide una vez. Una frecuencia («TRIMESTRAL») dice que la medida ya está implementada y se verifica;
            «INMEDIATO» o una fecha, que está por implementar. Las medidas importadas quedan «Propuesta» hasta que alguien las verifique.
          </p>
        </div>
        <TableRoot aria-label="Plazos del Excel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>En el Excel</TableHead>
                <TableHead className="text-right">Medidas</TableHead>
                <TableHead>Cómo se cargan</TableHead>
                <TableHead>Frecuencia o plazo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.deadlines.map((group) => {
                const decision = decisions.deadlines[group.key]!
                const label = short(valueLabel(group))
                return (
                  <TableRow key={group.key}>
                    <TableCell className="min-w-48 whitespace-normal">{valueLabel(group)}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.count}</TableCell>
                    <TableCell className="min-w-56">
                      <OptionSelect aria-label={`Cómo se cargan las medidas con «${label}»`} options={KIND_OPTIONS} value={decision.kind}
                        onValueChange={(kind) => setDeadline(group.key, kind === "existing"
                          ? { kind: "existing", frequency: group.text?.slice(0, 120) ?? null }
                          : { kind: "pending", dueDate: todayInChile() })} />
                    </TableCell>
                    <TableCell className="min-w-48">
                      {decision.kind === "existing" ? (
                        <Input aria-label={`Frecuencia de verificación para «${label}»`} value={decision.frequency ?? ""} maxLength={120} placeholder="Trimestral"
                          onChange={(event) => setDeadline(group.key, { kind: "existing", frequency: event.target.value || null })} />
                      ) : (
                        <div className="space-y-1">
                          <DatePicker ariaLabel={`Plazo para «${label}»`} value={decision.dueDate ?? undefined} onChange={(iso) => setDeadline(group.key, { kind: "pending", dueDate: iso })} />
                          {!decision.dueDate && <p className="text-xs text-[var(--color-text-subtle)]">Sin fecha: la medida queda pendiente de plazo.</p>}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      </section>
    </div>
  )
}

/** «Sugerida» (y «sin pista» si ninguna palabra clave calzó) hasta que alguien la confirma. */
function PhraseState({ phrase, decision, onConfirm }: { phrase: PhraseGroup; decision: PhraseDecision; onConfirm: () => void }) {
  if (decision.confirmed) {
    const fromExcel = phrase.suggestion.source === "prefix" && decision.hierarchy === phrase.suggestion.hierarchy
    return <span className="text-xs text-[var(--color-text-subtle)]">{fromExcel ? "Del Excel" : "Confirmada"}</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {phrase.suggestion.source === "default"
        ? <Badge variant="warning" size="sm">Sugerida · sin pista</Badge>
        : <Badge variant="warning" size="sm">Sugerida</Badge>}
      <Button type="button" size="sm" variant="ghost" aria-label={`Confirmar el tipo de «${short(phrase.text)}»`} onClick={onConfirm}>Confirmar</Button>
    </div>
  )
}
```

- [ ] **Step 5: El diálogo en cuatro pasos**

Reemplazar el contenido de `app/(app)/prevencion/miper/import-dialog.tsx` por:

```tsx
"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { decisionsToMappings, importSummary, initialDecisions, unconfirmedCount, type ImportDecisions } from "@/lib/prevention/miper/import-decisions"
import type { RiskImportPreview, RiskImportRowView } from "@/lib/services/miper/import"
import { toast } from "@/lib/toast"
import { cn, countOf } from "@/lib/utils"
import { commitRiskImportAction, previewRiskImportAction, saveRiskFactorAction } from "./actions"
import { ImportMeasuresStep } from "./import-measures-step"
import type { CreationWorksite } from "./new-miper-dialog"

/**
 * Importación del RE-04 real (§9.3, F3; Fase C, spec §8).
 *
 * Cuatro pasos: **Archivo** (faena, período y `.xlsx`) → **Filas** (la vista
 * previa congela el lote y muestra los problemas por fila) → **Medidas
 * detectadas** (tipo I–V de cada frase, responsables y plazos, una vez por valor
 * distinto) → **Confirmar** (resumen y destino). Patrón de
 * `generate-actions-dialog.tsx`: el sistema propone y la persona decide.
 *
 * Lo que la vista previa muestra y lo que la carga hace son lo mismo que decidió
 * el servidor: acá no se recalcula nada. La carga vuelve a calcular las claves
 * desde el lote y rechaza un mapeo incompleto o de otro archivo. Cambiar faena,
 * período o archivo descarta la vista previa y las decisiones.
 */

type Step = "archivo" | "filas" | "medidas" | "confirmar"
const STEPS: ReadonlyArray<{ value: Step; label: string }> = [
  { value: "archivo", label: "Archivo" },
  { value: "filas", label: "Filas" },
  { value: "medidas", label: "Medidas detectadas" },
  { value: "confirmar", label: "Confirmar" },
]

const STATUS_LABEL: Record<RiskImportRowView["status"], string> = {
  ready: "Lista",
  needs_review: "Requiere revisión",
  rejected: "No se carga",
}

/** Fila plana de la tabla: el `DataTable` filtra y ordena por texto. */
type PreviewTableRow = {
  id: string
  excelRow: number
  activity: string
  hazard: string
  evaluation: string
  problems: string
  status: string
}

function previewRow(row: RiskImportRowView): PreviewTableRow {
  const evaluation = row.magnitude === null
    ? "Sin evaluar"
    : `P ${row.normalized.probability} × C ${row.normalized.consequence} = MR ${row.magnitude}`
  return {
    id: String(row.rowNumber),
    excelRow: row.rowNumber,
    activity: row.normalized.activity ?? "—",
    hazard: row.normalized.hazard ?? row.normalized.risk ?? "—",
    evaluation,
    problems: row.issues.length === 0 ? "Sin problemas" : row.issues.map((issue) => issue.message).join(" · "),
    status: STATUS_LABEL[row.status],
  }
}

/** Código estable del catálogo a partir del nombre del Excel. */
function factorCodeOf(name: string) {
  const code = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)
  return code.length >= 2 ? code : `factor_${code}`.slice(0, 60).padEnd(2, "_")
}

export function ImportMiperDialog({ worksites, currentYear, canManageCatalog }: {
  worksites: CreationWorksite[]
  currentYear: number
  canManageCatalog: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("archivo")
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [period, setPeriod] = useState(String(currentYear))
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<RiskImportPreview | null>(null)
  const [decisions, setDecisions] = useState<ImportDecisions | null>(null)
  const [revisionReason, setRevisionReason] = useState("")
  const operation = useOperation()

  const tableRows = useMemo(() => (preview?.rows ?? []).map(previewRow), [preview])
  // Los factores que el catálogo todavía no tiene: la vista previa ofrece crearlos.
  const unknownFactors = useMemo(() => {
    const names = new Set<string>()
    for (const row of preview?.rows ?? []) {
      const issue = row.issues.find((candidate) => candidate.code === "unknown_factor")
      if (issue && typeof issue.excel === "string") names.add(issue.excel)
    }
    return [...names]
  }, [preview])
  const hasMeasures = (preview?.measureAnalysis.measures.length ?? 0) > 0
  const pendingTypes = decisions ? unconfirmedCount(decisions) : 0
  // Sólo las filas «listas» se cargan seguro; las que esperan su factor, si existe al confirmar.
  const summary = useMemo(() => {
    if (!preview || !decisions) return null
    const loadable = new Set(preview.rows.filter((row) => row.status === "ready").map((row) => row.rowNumber))
    return importSummary(preview.measureAnalysis, loadable, decisions.deadlines)
  }, [preview, decisions])

  /** Cambiar faena, período o archivo invalida lo revisado: hay que volver a revisar. */
  function discardPreview() {
    setPreview(null)
    setDecisions(null)
  }

  function handleOpen(next: boolean) {
    setOpen(next)
    if (!next) {
      discardPreview()
      setFile(null)
      setRevisionReason("")
      setStep("archivo")
      operation.setMessage("")
    }
  }

  function runPreview() {
    if (!file || !worksiteId) return
    const form = new FormData()
    form.set("file", file)
    form.set("worksiteId", worksiteId)
    form.set("period", period)
    operation.run(() => previewRiskImportAction(form), (result) => {
      const next = (result.data?.preview ?? null) as RiskImportPreview | null
      setPreview(next)
      // Un lote nuevo trae su propio análisis: las decisiones de antes no valen para él.
      setDecisions(next ? initialDecisions(next.measureAnalysis) : null)
      // El motivo del alta sólo se propone; quien importa lo puede cambiar.
      setRevisionReason((current) => current.length > 0 ? current : `Importación RE-04 desde ${file.name}`)
      setStep("filas")
    })
  }

  function createFactor(name: string) {
    operation.run(() => saveRiskFactorAction({ code: factorCodeOf(name), name, sortOrder: 200 }), runPreview)
  }

  function commit(target: "draft" | "live") {
    if (!preview || !decisions) return
    operation.run(() => commitRiskImportAction({
      batchId: preview.batchId,
      worksiteId,
      target,
      period: Number(period),
      revisionReason,
      ...decisionsToMappings(decisions),
    }), (result) => {
      handleOpen(false)
      toast.success(result.message ?? "RE-04 importado")
      const matrixId = result.data?.matrixId
      if (typeof matrixId === "string") router.push(`/prevencion/miper/${matrixId}`)
      else router.refresh()
    })
  }

  const goNext = () => setStep(step === "filas" ? (hasMeasures ? "medidas" : "confirmar") : "confirmar")
  const goBack = () => {
    operation.setMessage("")
    setStep(step === "confirmar" ? (hasMeasures ? "medidas" : "filas") : step === "medidas" ? "filas" : "archivo")
  }

  const draft = preview?.draft
  const live = preview?.live

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          disabled={worksites.length === 0}
          title={worksites.length === 0 ? "No hay faenas activas a tu alcance" : undefined}
        >
          Importar
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-5xl">
        <SheetHeader>
          <div>
            <SheetTitle>Importar el RE-04</SheetTitle>
            <SheetDescription>
              Lee la hoja «RE-04 IPER» del Excel real con sus medidas de control. La matriz y la clasificación del archivo se informan, pero
              manda el cálculo de la plataforma (P × C): una fila con probabilidad o consecuencia fuera de 1, 2, 4 no se carga.
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>

        <SheetBody className="space-y-4">
          <ol aria-label="Pasos de la importación" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {STEPS.map((item, index) => (
              <li key={item.value} aria-current={item.value === step ? "step" : undefined}
                className={cn("text-[var(--color-text-subtle)]", item.value === step && "font-semibold text-[var(--color-text)]")}>
                {index + 1}. {item.label}
              </li>
            ))}
          </ol>

          {step === "archivo" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Faena" required>
                <OptionSelect aria-label="Faena" placeholder="Selecciona la faena" value={worksiteId}
                  options={worksites.map((item) => ({ value: item.id, label: item.name }))}
                  onValueChange={(value) => { setWorksiteId(value); discardPreview() }} />
              </Field>
              <Field label="Período del borrador" helper="Sólo se usa al cargar en un borrador nuevo.">
                <Input aria-label="Período del borrador" type="number" min={2000} max={2100} value={period} onChange={(event) => { setPeriod(event.target.value); discardPreview() }} />
              </Field>
              <Field label="Archivo del RE-04" required helper="Excel .xlsx, hoja «RE-04 IPER».">
                <Input
                  aria-label="Archivo del RE-04"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => { setFile(event.target.files?.[0] ?? null); discardPreview() }}
                />
              </Field>
            </div>
          )}

          {step === "filas" && preview && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-text-subtle)]">
                {countOf(preview.totals.total, "fila")} en «{preview.sheetName}»: {preview.totals.ready} para cargar, {preview.totals.needsReview} por
                revisar y {preview.totals.rejected} sin cargar.
              </p>
              {unknownFactors.length > 0 && (
                <div className="rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
                  <p className="font-medium">Factores de riesgo fuera del catálogo</p>
                  <p>El RE-04 usa factores que el catálogo todavía no tiene. Créalos para poder cargar esas filas.</p>
                  <ul className="mt-2 space-y-1">
                    {unknownFactors.map((name) => (
                      <li key={name} className="flex flex-wrap items-center gap-2">
                        <span>«{name}»</span>
                        {canManageCatalog
                          ? <Button type="button" size="sm" variant="secondary" disabled={operation.pending} onClick={() => createFactor(name)}>Crear factor</Button>
                          : <span>Pídele a quien administra el catálogo que lo cree.</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <DataTable
                caption="Problemas por fila del RE-04"
                columns={[
                  { key: "excelRow", label: "Fila del Excel", numeric: true, sortable: true },
                  { key: "activity", label: "Actividad" },
                  { key: "hazard", label: "Peligro / riesgo" },
                  { key: "evaluation", label: "Evaluación de la plataforma" },
                  { key: "problems", label: "Problemas" },
                  { key: "status", label: "Estado" },
                ]}
                rows={tableRows}
                searchKeys={["activity", "hazard", "problems", "status"]}
                pageSize={15}
                emptyTitle="Sin filas que revisar"
                emptyDescription="La hoja no tiene riesgos evaluados."
                renderRow={(row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums">{row.excelRow}</TableCell>
                    <TableCell>{row.activity}</TableCell>
                    <TableCell>{row.hazard}</TableCell>
                    <TableCell className="tabular-nums">{row.evaluation}</TableCell>
                    <TableCell className={row.problems === "Sin problemas" ? "text-[var(--color-text-subtle)]" : undefined}>{row.problems}</TableCell>
                    <TableCell>{row.status}</TableCell>
                  </TableRow>
                )}
              />
            </div>
          )}

          {step === "medidas" && preview && decisions && (
            <ImportMeasuresStep analysis={preview.measureAnalysis} responsibleOptions={preview.responsibleOptions} decisions={decisions} onChange={setDecisions} />
          )}

          {step === "confirmar" && preview && summary && (
            <div className="space-y-4">
              <section aria-labelledby="importar-resumen" className="space-y-2 rounded-xl border border-[var(--color-border)] p-4">
                <h3 id="importar-resumen" className="text-sm font-semibold">Qué se va a cargar</h3>
                <ul className="space-y-1 text-sm">
                  <li>{countOf(preview.totals.ready, "riesgo listo", "riesgos listos")} para cargar.</li>
                  {preview.totals.needsReview > 0 && (
                    <li>{countOf(preview.totals.needsReview, "fila espera", "filas esperan")} su factor de riesgo: se carga sólo si el factor existe al confirmar.</li>
                  )}
                  {preview.totals.rejected > 0 && (
                    <li>{countOf(preview.totals.rejected, "fila no se carga", "filas no se cargan")}: probabilidad o consecuencia fuera de 1, 2 y 4.</li>
                  )}
                  <li>
                    {summary.measures === 0
                      ? "El archivo no trae medidas de control."
                      : `${countOf(summary.measures, "medida")}: ${countOf(summary.existing, "existente")} y ${summary.pending} por implementar.`}
                  </li>
                </ul>
                {summary.measures > 0 && (
                  <p className="text-xs text-[var(--color-text-subtle)]">
                    Todas quedan «Propuesta» hasta que alguien las verifique: importar no baja «Riesgos críticos sin control» sin evidencia.
                  </p>
                )}
              </section>
              <Field label="Motivo del borrador" helper="Queda en la bitácora del MIPER si se carga en un borrador nuevo.">
                <Textarea aria-label="Motivo del borrador" value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} minLength={10} />
              </Field>
              {(draft?.blockedReason || live?.blockedReason) && (
                <div className="space-y-1 text-sm text-[var(--color-text-subtle)]">
                  {draft?.blockedReason && <p>Borrador: {draft.blockedReason}</p>}
                  {live?.blockedReason && <p>Al vigente: {live.blockedReason}</p>}
                </div>
              )}
            </div>
          )}

          {operation.message && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{operation.message}</p>}
        </SheetBody>

        <SheetFooter>
          {step === "archivo" ? (
            <>
              <Button type="button" variant="ghost" onClick={() => handleOpen(false)}>Cancelar</Button>
              <Button type="button" loading={operation.pending} disabled={operation.pending || !file || !worksiteId} onClick={runPreview}>Revisar el archivo</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={operation.pending} onClick={goBack}>Atrás</Button>
              {step === "confirmar" ? (
                <>
                  <Button type="button" variant="secondary" disabled={operation.pending || Boolean(live?.blockedReason)} onClick={() => commit("live")}>
                    Agregar al vigente
                  </Button>
                  <Button type="button" loading={operation.pending} disabled={operation.pending || Boolean(draft?.blockedReason)} onClick={() => commit("draft")}>
                    Cargar en borrador
                  </Button>
                </>
              ) : (
                <Button type="button" disabled={operation.pending || (step === "medidas" && pendingTypes > 0)} onClick={goNext}>Siguiente</Button>
              )}
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

Notas para quien implementa:
- `useOperation` sigue en modo `message`. Con `onSuccess` no deja «Guardado correctamente.», así que
  `operation.message` sólo trae rechazos: van en `role="alert"`.
- El éxito de la carga se anuncia con `toast.success(result.message)`, porque el diálogo se cierra.
- Si `Button` no acepta `loading` junto con `disabled`, quitar `loading` del botón «Revisar el
  archivo»: el patrón de `control-form.tsx` usa los dos.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:fast -- lib/prevention/miper/import-decisions.test.ts "app/(app)/prevencion/miper/import-measures-step.test.tsx" "app/(app)/prevencion/miper/import-dialog.test.tsx" "app/(app)/prevencion/miper/miper-home.test.tsx"`

Expected: PASS. `miper-home.test.tsx` pinta el botón «Importar» y mockea `./actions`: sirve para
confirmar que la portada no se rompió.

- [ ] **Step 7: Puertas**

```bash
npm run typecheck
npm run lint -- lib/prevention/miper/import-decisions.ts lib/prevention/miper/import-decisions.test.ts "app/(app)/prevencion/miper/import-measures-step.tsx" "app/(app)/prevencion/miper/import-measures-step.test.tsx" "app/(app)/prevencion/miper/import-dialog.tsx" "app/(app)/prevencion/miper/import-dialog.test.tsx"
```

- [ ] **Step 8: Commit**

```bash
git add lib/prevention/miper/import-decisions.ts lib/prevention/miper/import-decisions.test.ts "app/(app)/prevencion/miper/import-measures-step.tsx" "app/(app)/prevencion/miper/import-measures-step.test.tsx" "app/(app)/prevencion/miper/import-dialog.tsx" "app/(app)/prevencion/miper/import-dialog.test.tsx"
git commit -m "feat(miper): importar en cuatro pasos con «Medidas detectadas»: tipo por frase, responsables y plazos una vez por valor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: E2E de la importación (desde un worktree)

**Files:**
- Create: `e2e/prevencion-miper-importacion.spec.ts`

**Interfaces:**
- Consumes:
  - los nombres del diálogo (Task 9) y de las tarjetas de medida (Task 5);
  - `RE04_COLUMNS` y `RE04_SHEET_NAME` (`lib/prevention/miper/re04-import.ts`);
  - `login` (`e2e/helpers.ts`), y `abrirRiesgo`, `cabecera` e `irAPaso` (`e2e/miper-helpers.ts`);
  - `AXE_TAGS` y `AXE_DISABLED_RULES` (`e2e/accessibility-targets.ts`);
  - los semillados de `e2e/setup-db.ts`:
    - `admin@e2e.chome.cl`: global, con `prevention:risk:edit`, y el usuario «Admin E2E»;
    - «Faena Restringida E2E» (`ws-restricted-e2e`), con borradores 2037–2039 y la vigente 2036;
    - el catálogo de factores, con «Mecánico» y «Físico».
- Produces la evidencia E2E del criterio C:
  - el RE-04 se importa con sus medidas (tipo, responsable y plazo o frecuencia);
  - «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA» entra como «Parcialmente»;
  - el servidor rechaza un mapeo adulterado;
  - axe no encuentra nada en «Medidas detectadas».

**Por qué «Faena Restringida E2E», período 2046:**
- «Faena E2E» la usan `flujo`, `escenario` y `programa` para crear sus MIPER, y `escenario` afirma
  su fila de la portada.
- «Oficina Central E2E» y «Faena Sin CPHS E2E» las afirma `matriz` como «Sin MIPER».
- En CI los specs de un shard comparten la base: un borrador 2046 en «Faena Restringida E2E» no
  cambia nada que otro spec afirme.
- El libro lleva una marca única en A1: el checksum identifica la carga por faena, y un segundo
  intento sobre la misma base no choca con «Este archivo ya se cargó».

**Cómo se adultera el cliente:**
- La Server Function viaja como `POST` a la URL de la página, con la cabecera `next-action`, y sus
  argumentos van como texto JSON (`encodeReply` de React con objetos planos).
- La prueba intercepta ese `POST`, le quita una frase a `measureMapping` y deja seguir el pedido.
- Si el cuerpo no fuera JSON (otra versión de Next), `adulterado` queda en `false` y la prueba lo
  dice con su mensaje: se investiga, no se relaja la aserción.

- [ ] **Step 1: Write the spec**

Crear `e2e/prevencion-miper-importacion.spec.ts`:

```ts
import { test, expect, type Locator, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import ExcelJS from "exceljs"
import { RE04_COLUMNS, RE04_SHEET_NAME } from "../lib/prevention/miper/re04-import"
import { AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { login } from "./helpers"
import { abrirRiesgo, cabecera, irAPaso } from "./miper-helpers"

/**
 * E2E: importación del RE-04 con medidas (Fase C, spec §8).
 *
 * Cubre:
 *   • Archivo → Filas → Medidas detectadas → Confirmar, con un `.xlsx` hecho con
 *     ExcelJS (frases y plazos del RE-04 real; responsables que son cargos).
 *   • «Siguiente» no avanza con tipos sin confirmar; «Aceptar sugerencias» los confirma.
 *   • Un responsable del Excel se asigna a una persona; los plazos se mapean una
 *     vez por valor (TRIMESTRAL → existente; INMEDIATO → por implementar hoy).
 *   • El servidor rechaza un mapeo adulterado (falta una frase) y no crea nada.
 *   • Las medidas quedan en cada riesgo con «Existente · verificación …» o «Por
 *     implementar · plazo …», y «…REQUIERE ACCIÓN INMEDIATA» es «Parcialmente».
 *   • axe sobre el paso «Medidas detectadas».
 *
 * Va a «Faena Restringida E2E», período 2046: ningún otro spec afirma esa fila
 * ni ese período.
 */
const FAENA = "Faena Restringida E2E"
const PERIODO = "2046"

type Fila = Partial<Record<(typeof RE04_COLUMNS)[number], string | number>>
const FILAS: Fila[] = [
  {
    "N°": 1, "ACTIVIDAD": "Traslado de lodo", "TAREA": "Descarga en predio", "PUESTO DE TRABAJO": "Conductor", "FACTORES DE RIESGO": "Mecánico",
    "PELIGRO": "Camión en pendiente", "RIESGO": "Volcamiento", "DAÑO PROBABLE": "Politraumatismo", "PROBABILIDAD": 2, "CONSECUENCIA": 4, "MR": 8,
    "CLASIFICACIÓN DEL RIESGO": "IMPORTANTE",
    "MEDIDA DE CONTROL": "USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD), ORDEN Y LIMPIEZA, SEÑALIZACIÓN DE ÁREAS",
    "¿ESTÁ CONTROLADO EL RIESGO?": "PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA", "RESPONSABLE": "SUPERVISOR/PREVENCION",
    "PLAZOS": "INMEDIATO / ANTES DE CONTINUAR LA TAREA",
  },
  {
    "N°": 2, "ACTIVIDAD": "Mantención", "TAREA": "Cambio de neumático", "PUESTO DE TRABAJO": "Mecánico", "FACTORES DE RIESGO": "Mecánico",
    "PELIGRO": "Herramientas manuales", "RIESGO": "Golpes", "DAÑO PROBABLE": "Contusiones", "PROBABILIDAD": 2, "CONSECUENCIA": 2, "MR": 4,
    "CLASIFICACIÓN DEL RIESGO": "MODERADO",
    "MEDIDA DE CONTROL": "INSTALAR RESGUARDOS EN MAQUINAS\nGUANTES, CASCO, CALZADO DE SEGURIDAD",
    "¿ESTÁ CONTROLADO EL RIESGO?": "PARCIALMENTE CONTROLADO", "RESPONSABLE": "SUPERVISOR/PREVENCION", "PLAZOS": "TRIMESTRAL",
  },
  {
    "N°": 3, "ACTIVIDAD": "Mantención", "TAREA": "Orden de taller", "PUESTO DE TRABAJO": "Mecánico", "FACTORES DE RIESGO": "Físico",
    "PELIGRO": "Piso resbaladizo", "RIESGO": "Caída al mismo nivel", "DAÑO PROBABLE": "Esguince", "PROBABILIDAD": 1, "CONSECUENCIA": 2, "MR": 2,
    "CLASIFICACIÓN DEL RIESGO": "TOLERABLE",
    "MEDIDA DE CONTROL": "MANTENER ORDEN Y LIMPIEZA", "¿ESTÁ CONTROLADO EL RIESGO?": "SÍ, CONTROLADO", "RESPONSABLE": "PREVENCION", "PLAZOS": "TRIMESTRAL",
  },
]

/** Libro con la forma del RE-04 real (encabezado en 12-13, datos desde la 14) y una marca única en A1. */
async function libro(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(RE04_SHEET_NAME)
  sheet.getCell("A1").value = `Matriz IPER · E2E ${Date.now()}`
  RE04_COLUMNS.forEach((label, index) => { sheet.getRow(12).getCell(index + 1).value = label })
  for (const [column, label] of [[14, "PROBABILIDAD"], [15, "CONSECUENCIA"], [16, "MR"], [17, "CLASIFICACIÓN DEL RIESGO"]] as const) {
    sheet.getRow(13).getCell(column).value = label
  }
  FILAS.forEach((fila, index) => {
    const row = sheet.getRow(14 + index)
    RE04_COLUMNS.forEach((label, column) => {
      const value = fila[label]
      if (value !== undefined) row.getCell(column + 1).value = value
    })
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const pasoActual = (dialogo: Locator) => dialogo.locator('[aria-current="step"]')

/** axe sobre el diálogo abierto (el `Sheet` es modal: lo de atrás queda `aria-hidden`). */
async function auditarDialogo(page: Page) {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).disableRules([...AXE_DISABLED_RULES]).include('[role="dialog"]').analyze()
  expect(results.violations).toEqual([])
}

test("importar un RE-04 con medidas: tipo, responsable y plazo o frecuencia; el servidor rechaza un mapeo adulterado", async ({ page }) => {
  test.setTimeout(180_000)
  await login(page)
  await page.goto("/prevencion/miper")
  // Las acciones del PageHeader se pintan en el TopBar (banner) y en una copia `lg:sr-only`.
  await cabecera(page).getByRole("button", { name: "Importar", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "Importar el RE-04" })
  await expect(dialogo).toBeVisible()

  // 1. Archivo
  await dialogo.getByRole("combobox", { name: "Faena", exact: true }).click()
  await page.getByRole("option", { name: FAENA, exact: true }).click()
  await dialogo.getByLabel("Período del borrador", { exact: true }).fill(PERIODO)
  await dialogo.getByLabel("Archivo del RE-04", { exact: true }).setInputFiles({
    name: "RE-04 E2E.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await libro(),
  })
  await dialogo.getByRole("button", { name: "Revisar el archivo", exact: true }).click()

  // 2. Filas
  await expect(dialogo.getByText("3 filas en «RE-04 IPER»: 3 para cargar, 0 por revisar y 0 sin cargar.", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(pasoActual(dialogo)).toHaveText("2. Filas")
  await dialogo.getByRole("button", { name: "Siguiente", exact: true }).click()

  // 3. Medidas detectadas: 8 frases, todas con palabra clave; PLAZOS ya sugerido.
  await expect(pasoActual(dialogo)).toHaveText("3. Medidas detectadas")
  const siguiente = dialogo.getByRole("button", { name: "Siguiente", exact: true })
  await expect(siguiente).toBeDisabled()
  await expect(dialogo.getByRole("textbox", { name: "Frecuencia de verificación para «TRIMESTRAL»", exact: true })).toHaveValue("TRIMESTRAL")
  await expect(dialogo.getByRole("combobox", { name: "Cómo se cargan las medidas con «INMEDIATO / ANTES DE CONTINUAR LA TAREA»", exact: true }))
    .toContainText("Por implementar")
  await dialogo.getByRole("combobox", { name: "Responsable para «PREVENCION»", exact: true }).click()
  await page.getByRole("option", { name: "Admin E2E", exact: true }).click()
  await auditarDialogo(page)
  await dialogo.getByRole("button", { name: "Aceptar sugerencias (8)", exact: true }).click()
  await expect(siguiente).toBeEnabled()
  await siguiente.click()

  // 4. Confirmar
  await expect(pasoActual(dialogo)).toHaveText("4. Confirmar")
  await expect(dialogo.getByRole("region", { name: "Qué se va a cargar" })).toContainText("8 medidas: 5 existentes y 3 por implementar.")

  // Un cliente adulterado: el cuerpo de la Server Function pierde una frase del mapeo de tipos.
  // El servidor recalcula las claves desde el lote, lo rechaza y no crea nada.
  let adulterado = false
  // Predicado y no glob: la Server Function va a la URL de la página, con o sin query string.
  await page.route((url) => url.pathname === "/prevencion/miper", async (route) => {
    const request = route.request()
    if (adulterado || request.method() !== "POST" || !request.headers()["next-action"]) return route.fallback()
    let args: unknown
    try { args = JSON.parse(request.postData() ?? "") } catch { return route.fallback() }
    const payload = Array.isArray(args) ? (args[0] as { measureMapping?: Record<string, string> } | undefined) : undefined
    if (!payload?.measureMapping) return route.fallback()
    delete payload.measureMapping[Object.keys(payload.measureMapping)[0]!]
    adulterado = true
    return route.continue({ postData: JSON.stringify(args) })
  })
  await dialogo.getByRole("button", { name: "Cargar en borrador", exact: true }).click()
  await expect(dialogo.getByRole("alert")).toContainText("falta decidir el tipo de 1 medida", { timeout: 30_000 })
  expect(adulterado, "el cuerpo de la Server Function no se pudo leer como JSON: revisar cómo serializa Next los argumentos").toBe(true)
  await page.unrouteAll({ behavior: "wait" })

  // La carga de verdad.
  await dialogo.getByRole("button", { name: "Cargar en borrador", exact: true }).click()
  await page.waitForURL(/\/prevencion\/miper\/riskmatrix-[^/?]+$/, { timeout: 60_000 })
  const matriz = page.url()

  // Riesgo 1 (Importante): medidas por implementar con el responsable escrito y el plazo de hoy.
  await abrirRiesgo(page, 1, "Camión en pendiente")
  await expect(page.getByRole("radiogroup", { name: "¿Está controlado el riesgo?" }).getByRole("radio", { name: "Parcialmente", exact: true }))
    .toHaveAttribute("aria-checked", "true")
  await irAPaso(page, "Medidas de control")
  const epp = page.getByRole("article", { name: "Medida: USO DE EPP (CASCO, GUANTES, CALZADO DE SEGURIDAD)", exact: true })
  await expect(epp).toContainText("V. Elementos de protección personal")
  await expect(epp).toContainText(/Por implementar · plazo \d{2}-\d{2}-\d{4}/)
  await expect(epp).toContainText("Responsable: SUPERVISOR/PREVENCION")

  // Riesgo 2 (Moderado): medidas existentes con su frecuencia, el tipo de cada una.
  await page.goto(matriz)
  await abrirRiesgo(page, 2, "Herramientas manuales")
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("article", { name: "Medida: GUANTES", exact: true })).toContainText("Existente · verificación TRIMESTRAL")
  await expect(page.getByRole("article", { name: "Medida: INSTALAR RESGUARDOS EN MAQUINAS", exact: true })).toContainText("III. Controles de ingeniería")

  // Riesgo 3: «PREVENCION» quedó asignado a la persona elegida.
  await page.goto(matriz)
  await abrirRiesgo(page, 3, "Piso resbaladizo")
  await irAPaso(page, "Medidas de control")
  await expect(page.getByRole("article", { name: "Medida: MANTENER ORDEN Y LIMPIEZA", exact: true })).toContainText("Responsable: Admin E2E")
})
```

- [ ] **Step 2: Puertas sin navegador y commit**

```bash
npm run typecheck
npm run lint -- e2e/prevencion-miper-importacion.spec.ts
git add e2e/prevencion-miper-importacion.spec.ts
git commit -m "test(miper): E2E de la importación del RE-04 con medidas y del rechazo de un mapeo adulterado" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Primero el commit, porque el worktree sólo ve lo commiteado.

- [ ] **Step 3: Correr las E2E desde un worktree**

Con la receta de Global Constraints, en este orden y de a un spec. Desde la segunda corrida va
`E2E_SKIP_BUILD=true`:

1. `npm run test:e2e -- e2e/prevencion-miper-importacion.spec.ts` (construye)
2. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-interacciones.spec.ts`: pasa por el
   formulario de la medida (Task 5).
3. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-flujo.spec.ts`: agrega una medida
   con plazo (`agregarMedida`) y envía a revisión con la completitud nueva.
4. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-escenario.spec.ts`
5. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-programa.spec.ts`
6. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-controles.spec.ts`
7. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/prevencion-miper-matriz.spec.ts`: la portada y el
   selector de faena (Task 1).
8. `E2E_SKIP_BUILD=true npm run test:e2e -- e2e/accessibility.spec.ts -g "miper|MIPER"`: los pasos del
   editor, con el formulario de la medida nuevo.

Expected: todo PASS.
- Anotar el conteo por spec para el informe (Task 11).
- Si una falla: abrir el trace, buscar la causa y arreglarla en un commit `fix(miper): …`. Después,
  worktree nuevo desde el HEAD nuevo y repetir **ese** spec.
- Si falla el cuerpo adulterado (`adulterado` en `false`): no se quita la aserción. Se lee el cuerpo
  real en el trace (pestaña Network) y se ajusta el interceptor a esa forma.

---

### Task 11: Verificación con el RE-04 real (base E2E desechable), informe QA, manual y spec

**Files:**
- Create: `qa/reports/2026-10-03-miper-c.md`. Si la verificación se hace otro día, se usa la fecha
  real en el nombre (`AAAA-MM-DD`).
- Modify: `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`:
  - §2, «Importar el RE-04 desde el Excel real» (líneas 45-56);
  - §3, la línea 139 («Atención requerida»);
  - §5, la tabla «¿Qué significa "¿Está controlado?"» (líneas 236-240);
  - §6, una subsección nueva y la tabla de reglas (líneas 262-270).
- Modify: `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`: la línea 3 y §8 (agregar
  «Implementado»).
- Temporales, **nunca se commitean**:
  - `e2e/qa-c-biodiversa.spec.ts`, que vive sólo en un worktree desechable del commit final y se
    borra con él;
  - opcional, `qa-c-lectura.mjs` en la raíz del checkout, borrado al terminar el Step 3.

**Interfaces:**
- Consumes:
  - las tareas 1–10 ya commiteadas, y los conteos E2E de la Task 10;
  - la receta E2E de Global Constraints;
  - la prevencionista sembrada `prev.faena@e2e.chome.cl` (contraseña de las semillas):
    - permisos `prevention:risk:view` y `prevention:risk:edit`;
    - alcance «Faena E2E» (`ws-e2e`), su única faena para crear MIPER;
    - aparece como «Prevencionista Faena E2E» entre los responsables;
  - el RE-04 real, por ruta absoluta: `/home/allopze/dev/chome/bodega/docs/Prevención Biodiversa/5.
    MATRIZ DE RIESGOS/RE- 04 Matriz de Identificación de Peligros y Evaluación de Riesgos
    (MIPER).xlsx`. Es el archivo de la raíz de la carpeta, ignorado por git;
  - `resolveE2eDatabaseUrl` (`e2e/environment.ts`), para **leer** la base E2E. Toma sólo
    `E2E_DATABASE_URL`, que `scripts/run-e2e.sh` le pasa a Playwright; nunca `DATABASE_URL`;
  - de la Task 9, los nombres del diálogo:
    - «Importar el RE-04», «Período del borrador», «Archivo del RE-04»;
    - las regiones «Tipo de cada medida detectada», «Responsables del Excel», «Plazos del Excel» y
      «Qué se va a cargar»;
    - los controles «Responsable para «…»», «Cómo se cargan las medidas con «…»» y «Frecuencia de
      verificación para «…»»;
  - de la Fase B, la cifra «Riesgos completos» del Resumen (`x/y`, enlace) y el filtro de la matriz
    `completitud=pendientes`;
  - el nombre accesible de cada paso del editor: «3. Medidas de control (N) · completo» o «… · M
    pendientes».
- Produces: la evidencia del criterio de aceptación C con el archivo real, y el manual y la spec al
  día.

**Por qué en la base E2E y no en `bodega_dev`:**
- El plan maestro dice «un borrador `QA_` de `bodega_dev` (revertido después)». Pero revertir una
  importación ahí exige borrar filas de `audit_log`, que es de sólo agregar (migración 0340), y para
  eso habría que apagar su protección. Eso no se hace («Decisiones», 13).
- La base E2E (`bodega-e2e-postgres`, 127.0.0.1:55432) se vuelve a sembrar en cada corrida: no hay
  nada que revertir.
- `bodega_dev` sólo se lee (Step 3, opcional).

**Reglas de esta verificación (además de las de Global Constraints):**
- El archivo real se lee por su ruta absoluta desde el worktree. Nada de él se copia ni se commitea:
  ni el spec temporal, ni un fixture, ni una captura.
- El informe lleva cifras, frases de medidas, plazos y cargos; ningún nombre de persona. Las únicas
  personas que el spec asigna son usuarios sembrados de prueba.
- El spec escribe sólo a través de la UI y **sólo lee** la base E2E por SQL.
- Las capturas y el `resultados.json` van a
  `/tmp/claude-1000/-home-allopze-dev-chome-bodega/10960f9d-1cca-4584-a80d-a04d7f759f0b/scratchpad/qa-c/`.
- Nunca se activa `app.audit_maintenance` ni se borran filas de `audit_log`, en ninguna base.

- [ ] **Step 1: Worktree desechable y spec temporal**

Con la receta de Global Constraints (sin copiar `.env*`; :3100 libre; nunca desde el checkout
principal):

```bash
cd /home/allopze/dev/chome/bodega
SHA=$(git rev-parse --short HEAD)
git worktree add /tmp/bodega-e2e-$SHA HEAD
ln -s /home/allopze/dev/chome/bodega/node_modules /tmp/bodega-e2e-$SHA/node_modules
ss -ltnp | grep ':3100 ' && echo "OCUPADO: matar por PID (ss -ltnp), nunca pkill -f"
```

Crear, **sólo en el worktree**, `/tmp/bodega-e2e-$SHA/e2e/qa-c-biodiversa.spec.ts`:

```ts
// e2e/qa-c-biodiversa.spec.ts — spec TEMPORAL de la Task 11 (Fase C). Vive sólo en un worktree
// desechable y NUNCA se commitea. Sube el RE-04 real (ignorado por git) por la UI a la base E2E
// desechable, que `scripts/run-e2e.sh` vuelve a sembrar en cada corrida: no hay nada que revertir.
// Por SQL sólo LEE esa base (`E2E_DATABASE_URL`). No imprime nombres de personas: el RE-04 trae
// cargos, y la única persona que se asigna es una usuaria sembrada de prueba.
import fs from "node:fs"
import { test, expect, type Locator, type Page } from "@playwright/test"
import postgres from "postgres"
import { resolveE2eDatabaseUrl } from "./environment"
import { login } from "./helpers"
import { cabecera } from "./miper-helpers"

const RE04 = "/home/allopze/dev/chome/bodega/docs/Prevención Biodiversa/5. MATRIZ DE RIESGOS/RE- 04 Matriz de Identificación de Peligros y Evaluación de Riesgos (MIPER).xlsx"
const QA_DIR = "/tmp/claude-1000/-home-allopze-dev-chome-bodega/10960f9d-1cca-4584-a80d-a04d7f759f0b/scratchpad/qa-c"
const PREVENCIONISTA = "prev.faena@e2e.chome.cl"
const FAENA = "Faena E2E"
const PERIODO = "2048"
const resultados: Record<string, unknown> = {}
const anotar = (clave: string, valor: unknown) => { resultados[clave] = valor; console.log(JSON.stringify({ clave, valor })) }
const numero = (texto: string | undefined) => Number((texto ?? "").replace(/\./g, ""))
const celdas = (region: Locator) => region.locator("tbody tr").evaluateAll((rows) => rows.map((row) =>
  [...row.querySelectorAll("td")].map((cell) => cell.querySelector("input")?.value ?? cell.textContent?.trim() ?? "")))

test.describe.configure({ mode: "serial" })
test.beforeAll(() => { fs.mkdirSync(QA_DIR, { recursive: true }) })
test.afterAll(() => { fs.writeFileSync(`${QA_DIR}/resultados.json`, JSON.stringify(resultados, null, 2)) })

function baseE2e() {
  const url = resolveE2eDatabaseUrl()
  if (!url) throw new Error("E2E_DATABASE_URL es requerida: este spec sólo lee la base E2E desechable")
  return postgres(url, { max: 1 })
}

/** Abre «Importar» como la prevencionista, con el RE-04 real, y revisa el archivo. */
async function revisar(page: Page) {
  await login(page, PREVENCIONISTA)
  await page.goto("/prevencion/miper")
  await cabecera(page).getByRole("button", { name: "Importar", exact: true }).click()
  const dialogo = page.getByRole("dialog", { name: "Importar el RE-04" })
  // Su única faena para crear MIPER: llega elegida.
  await expect(dialogo.getByRole("combobox", { name: "Faena", exact: true })).toContainText(FAENA)
  await dialogo.getByLabel("Período del borrador", { exact: true }).fill(PERIODO)
  await dialogo.getByLabel("Archivo del RE-04", { exact: true }).setInputFiles(RE04)
  await dialogo.getByRole("button", { name: "Revisar el archivo", exact: true }).click()
  await expect(dialogo.getByText(/ en «RE-04 IPER»: /)).toBeVisible({ timeout: 120_000 })
  return dialogo
}

// Va primero: sólo revisa (deja un lote preparado, que el test siguiente reemplaza al volver a revisar
// el mismo archivo). Después de la carga, el mismo archivo ya no se puede volver a revisar en la faena.
test("390×844: «Medidas detectadas» con el RE-04 real no da scroll horizontal (sólo revisa, no carga)", async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const dialogo = await revisar(page)
  await dialogo.getByRole("button", { name: "Siguiente", exact: true }).click()
  await expect(dialogo.getByRole("region", { name: "Tipo de cada medida detectada" })).toBeVisible()
  const sinScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  anotar("390: sin scroll horizontal de la página", sinScroll)
  await page.screenshot({ path: `${QA_DIR}/c-medidas-390.png` })
  expect(sinScroll).toBe(true)
})

test("RE-04 real: medidas con tipo, responsable y plazo o frecuencia, todas propuestas; los pendientes bajan a los reales; el servidor rechaza un mapeo adulterado", async ({ page }) => {
  test.setTimeout(900_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const dialogo = await revisar(page)
  anotar("filas: totales", await dialogo.getByText(/ en «RE-04 IPER»: /).textContent())
  await page.screenshot({ path: `${QA_DIR}/c-filas.png` })
  await dialogo.getByRole("button", { name: "Siguiente", exact: true }).click()

  // ── Medidas detectadas ──
  const tipos = dialogo.getByRole("region", { name: "Tipo de cada medida detectada" })
  const responsables = dialogo.getByRole("region", { name: "Responsables del Excel" })
  const plazos = dialogo.getByRole("region", { name: "Plazos del Excel" })
  await expect(tipos).toBeVisible()
  anotar("medidas: frases distintas", await tipos.locator("tbody tr").count())
  anotar("medidas: «Sugerida · sin pista»", await tipos.getByText("Sugerida · sin pista", { exact: true }).count())
  anotar("medidas: tipos sugeridos, las 15 más frecuentes [frase, veces, tipo, estado]", (await celdas(tipos)).slice(0, 15))
  anotar("medidas: responsables [valor, medidas, decisión]", await celdas(responsables))
  anotar("medidas: plazos sugeridos [valor, medidas, cómo, frecuencia o plazo]", await celdas(plazos))
  // No se avanza con tipos sin confirmar.
  await expect(dialogo.getByRole("button", { name: "Siguiente", exact: true })).toBeDisabled()
  // Mapeos de la persona: «PREVENCION» pasa a la prevencionista sembrada; «INMEDIATO AL OCURRIR»
  // se declara ya implementada, con su texto como frecuencia de verificación.
  await responsables.getByRole("combobox", { name: "Responsable para «PREVENCION»", exact: true }).click()
  await page.getByRole("option", { name: "Prevencionista Faena E2E", exact: true }).click()
  await plazos.getByRole("combobox", { name: "Cómo se cargan las medidas con «INMEDIATO AL OCURRIR»", exact: true }).click()
  await page.getByRole("option", { name: "Ya implementadas: se verifican", exact: true }).click()
  await expect(plazos.getByRole("textbox", { name: "Frecuencia de verificación para «INMEDIATO AL OCURRIR»", exact: true })).toHaveValue("INMEDIATO AL OCURRIR")
  await page.screenshot({ path: `${QA_DIR}/c-medidas-detectadas.png` })
  await dialogo.getByRole("button", { name: /^Aceptar sugerencias/ }).click()
  await dialogo.getByRole("button", { name: "Siguiente", exact: true }).click()

  // ── Confirmar ──
  const resumen = (await dialogo.getByRole("region", { name: "Qué se va a cargar" }).textContent()) ?? ""
  anotar("confirmar: resumen", resumen)
  const cifras = resumen.match(/([\d.]+) medidas?: ([\d.]+) existentes? y ([\d.]+) por implementar/)
  expect(cifras, `el resumen no trae «N medidas: X existentes y Y por implementar»: ${resumen}`).not.toBeNull()
  const [total, existentes, porImplementar] = [numero(cifras![1]), numero(cifras![2]), numero(cifras![3])]
  await page.screenshot({ path: `${QA_DIR}/c-confirmar.png` })

  // Un cliente adulterado: el cuerpo de la Server Function pierde una frase del mapeo de tipos.
  // Con el lote real, el servidor recalcula las claves y lo rechaza sin crear nada.
  let adulterado = false
  await page.route((url) => url.pathname === "/prevencion/miper", async (route) => {
    const request = route.request()
    if (adulterado || request.method() !== "POST" || !request.headers()["next-action"]) return route.fallback()
    let args: unknown
    try { args = JSON.parse(request.postData() ?? "") } catch { return route.fallback() }
    const payload = Array.isArray(args) ? (args[0] as { measureMapping?: Record<string, string> } | undefined) : undefined
    if (!payload?.measureMapping) return route.fallback()
    delete payload.measureMapping[Object.keys(payload.measureMapping)[0]!]
    adulterado = true
    return route.continue({ postData: JSON.stringify(args) })
  })
  await dialogo.getByRole("button", { name: "Cargar en borrador", exact: true }).click()
  const alerta = dialogo.getByRole("alert")
  await expect(alerta).toContainText("falta decidir el tipo de 1 medida", { timeout: 60_000 })
  expect(adulterado, "el cuerpo de la Server Function no se pudo leer como JSON").toBe(true)
  anotar("rechazo: mensaje del servidor", await alerta.textContent())
  await page.unrouteAll({ behavior: "wait" })

  // ── La carga de verdad ──
  const inicio = Date.now()
  await dialogo.getByRole("button", { name: "Cargar en borrador", exact: true }).click()
  await page.waitForURL(/\/prevencion\/miper\/riskmatrix-[^/?]+$/, { timeout: 300_000 })
  anotar("carga: ms (build de producción del worktree)", Date.now() - inicio)
  const matriz = page.url()
  const matrixId = new URL(matriz).pathname.split("/").at(-1)!

  const sql = baseE2e()
  let riesgos: { total: number; pendientesSinMedidas: number; noControlados: number; parciales: number }
  try {
    const [medidas] = await sql<Array<Record<string, number>>>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE c.is_existing)::int AS existentes,
        count(*) FILTER (WHERE NOT c.is_existing)::int AS "porImplementar",
        count(*) FILTER (WHERE c.status = 'proposed')::int AS propuestas,
        count(*) FILTER (WHERE c.responsible_user_id IS NULL AND btrim(coalesce(c.responsible_snapshot, '')) = '')::int AS "sinResponsable",
        count(*) FILTER (WHERE c.responsible_user_id IS NOT NULL)::int AS "aPersona",
        count(*) FILTER (WHERE c.is_existing AND c.verification_frequency IS NULL)::int AS "existentesSinFrecuencia",
        count(*) FILTER (WHERE c.is_existing AND c.due_date IS NOT NULL)::int AS "existentesConPlazo",
        count(*) FILTER (WHERE NOT c.is_existing AND c.due_date IS NULL)::int AS "porImplementarSinPlazo",
        count(*) FILTER (WHERE NOT c.is_existing AND c.verification_frequency IS NOT NULL)::int AS "porImplementarConFrecuencia"
      FROM prevention_risk_controls c JOIN prevention_risk_entries e ON e.id = c.risk_entry_id
      WHERE e.matrix_id = ${matrixId}`
    anotar("base: medidas", medidas)
    anotar("base: medidas por tipo", await sql`
      SELECT c.hierarchy, c.is_existing, count(*)::int AS n FROM prevention_risk_controls c JOIN prevention_risk_entries e ON e.id = c.risk_entry_id
      WHERE e.matrix_id = ${matrixId} GROUP BY 1, 2 ORDER BY 1, 2`)
    anotar("base: plazo o frecuencia", await sql`
      SELECT c.is_existing, coalesce(c.verification_frequency, '—') AS frecuencia, coalesce(c.due_date, '—') AS plazo, count(*)::int AS n
      FROM prevention_risk_controls c JOIN prevention_risk_entries e ON e.id = c.risk_entry_id
      WHERE e.matrix_id = ${matrixId} GROUP BY 1, 2, 3 ORDER BY 4 DESC`)
    const [filas] = await sql<Array<{ total: number; pendientesSinMedidas: number; noControlados: number; parciales: number }>>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE e.controlled_status IN ('yes', 'partial') OR e.classification IN ('important', 'intolerable'))::int AS "pendientesSinMedidas",
        count(*) FILTER (WHERE e.controlled_status = 'no')::int AS "noControlados",
        count(*) FILTER (WHERE e.controlled_status = 'partial')::int AS parciales
      FROM prevention_risk_entries e WHERE e.matrix_id = ${matrixId}`
    riesgos = filas!
    anotar("base: riesgos", riesgos)

    // Tipo, responsable y plazo o frecuencia en TODAS; todas propuestas; las cifras son las del resumen.
    expect(medidas!.total).toBe(total)
    expect(medidas!.existentes).toBe(existentes)
    expect(medidas!.porImplementar).toBe(porImplementar)
    expect(medidas!.propuestas).toBe(medidas!.total)
    expect(medidas!.sinResponsable).toBe(0)
    expect(medidas!.aPersona).toBeGreaterThan(0)
    expect(medidas!.existentesSinFrecuencia).toBe(0)
    expect(medidas!.existentesConPlazo).toBe(0)
    expect(medidas!.porImplementarSinPlazo).toBe(0)
    expect(medidas!.porImplementarConFrecuencia).toBe(0)
    // «PARCIALMENTE CONTROLADO - REQUIERE ACCIÓN INMEDIATA» entra como parcial: el RE-04 real no tiene
    // ninguna fila «No controlado» (antes del arreglo, sus 46 Importantes caían en «no»).
    expect(riesgos.noControlados).toBe(0)
  } finally {
    await sql.end()
  }

  // ── Los pendientes bajan a los reales ──
  // Línea base: sin medidas —como cargaba el importador antes de la Fase C— todo riesgo «Sí» o
  // «Parcialmente» controlado, Importante o Intolerable queda con pendientes. En este archivo son todos.
  await page.goto(`${matriz}?tab=resumen`)
  const completos = page.getByRole("link", { name: /^Riesgos completos/ })
  const textoCompletos = (await completos.textContent()) ?? ""
  const fraccion = textoCompletos.match(/(\d+)\/(\d+)/)
  expect(fraccion, `«Riesgos completos» sin x/y: ${textoCompletos}`).not.toBeNull()
  const pendientes = Number(fraccion![2]) - Number(fraccion![1])
  anotar("resumen: «Riesgos completos»", textoCompletos)
  anotar("pendientes: [línea base sin medidas, después de importar]", [riesgos.pendientesSinMedidas, pendientes])
  await page.screenshot({ path: `${QA_DIR}/c-resumen.png` })
  expect(Number(fraccion![2])).toBe(riesgos.total)
  expect(pendientes).toBeLessThan(riesgos.pendientesSinMedidas)

  // Y son reales: ninguno queda pendiente por sus medidas. Se revisan hasta 20.
  await page.goto(`${matriz}?completitud=pendientes`)
  const enlaces = page.getByRole("link", { name: /^Riesgo #\d+:/ })
  if (pendientes > 0) await expect(enlaces.nth(0)).toBeVisible()
  expect(await enlaces.count()).toBe(pendientes)
  const hrefs = (await enlaces.evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))).slice(0, 20)
  const motivos: string[][] = []
  for (const href of hrefs) {
    await page.goto(href)
    const pasos = page.getByRole("tablist", { name: "Pasos del riesgo" }).getByRole("tab")
    await expect(pasos.nth(0)).toBeVisible()
    const nombres = await pasos.evaluateAll((tabs) => tabs.map((tab) => (tab.textContent ?? "").replace(/\s+/g, " ").trim()))
    motivos.push(nombres.filter((nombre) => /pendiente/.test(nombre)))
    expect(nombres.find((nombre) => nombre.includes("Medidas de control")), `riesgo pendiente por sus medidas: ${href}`).toMatch(/completo$/)
  }
  anotar("pendientes: pasos con pendientes de los primeros 20", motivos)

  // ── Cómo se ven en el editor ──
  await page.goto(`${matriz}?clasificacion=important`)
  // Las vistas de la MIPER no duplican árboles (`e2e/miper-helpers.ts`): `nth(0)` es el primer riesgo.
  await page.getByRole("link", { name: /^Riesgo #\d+:/ }).nth(0).click()
  await page.getByRole("tab", { name: /Medidas de control/ }).click()
  await expect(page.getByRole("article").nth(0)).toBeVisible()
  const importante = await page.getByRole("article").allTextContents()
  anotar("editor: tarjetas de un Importante", importante)
  expect(importante.some((texto) => /Por implementar · plazo \d{2}-\d{2}-\d{4}/.test(texto))).toBe(true)
  await page.screenshot({ path: `${QA_DIR}/c-editor-importante.png` })
  await page.goto(`${matriz}?clasificacion=moderate`)
  await page.getByRole("link", { name: /^Riesgo #\d+:/ }).nth(0).click()
  await page.getByRole("tab", { name: /Medidas de control/ }).click()
  await expect(page.getByRole("article").nth(0)).toBeVisible()
  const moderado = await page.getByRole("article").allTextContents()
  anotar("editor: tarjetas de un Moderado", moderado)
  expect(moderado.some((texto) => /Existente · verificación /.test(texto))).toBe(true)
  await page.screenshot({ path: `${QA_DIR}/c-editor-moderado.png` })
})
```

Notas para quien ejecuta:
- `revisar` no elige la faena: con una sola faena a su alcance, el `OptionSelect` llega con ella. Si la
  semilla cambió y hay más, se elige «Faena E2E» como en la Task 10.
- Los enlaces del filtro `completitud=pendientes` son de la vista filtrada de la matriz (los riesgos
  bajo cada tarea). Si con el catálogo de la base E2E no queda ningún riesgo pendiente, el bucle no
  corre y el informe lo dice.

- [ ] **Step 2: Correr, anotar y borrar el worktree**

```bash
cd /tmp/bodega-e2e-$SHA
npm run test:e2e -- e2e/qa-c-biodiversa.spec.ts      # construye (minutos)
cat /tmp/claude-1000/-home-allopze-dev-chome-bodega/10960f9d-1cca-4584-a80d-a04d7f759f0b/scratchpad/qa-c/resultados.json
cd /home/allopze/dev/chome/bodega
git worktree remove --force /tmp/bodega-e2e-$SHA
git status --short   # no aparece qa-c-biodiversa.spec.ts: vivió sólo en el worktree
```

Criterios:

| Caso | Criterio |
|---|---|
| 390 | `true`: el paso «Medidas detectadas» no da scroll horizontal a la página. |
| filas | 254 filas; las 24 «REVISAR» (sin P ni C) no se cargan. Las que esperan un factor que el catálogo de la base E2E no tiene se anotan con su número. |
| medidas | 222 frases y 19 «Sugerida · sin pista» (el análisis del archivo al planificar). «Siguiente» deshabilitado antes de aceptar. Responsables: 8 valores, todos cargos. Plazos: 5 valores (TRIMESTRAL y ANTES DE CADA OPERACIÓN existentes, INMEDIATO… por implementar hoy, «EN 30 DÍAS…» hoy + 30). Si las cifras difieren porque el catálogo de factores deja fuera otras filas, se anota la diferencia y su causa. |
| confirmar | «N medidas: X existentes y Y por implementar». |
| rechazo | «…falta decidir el tipo de 1 medida…», con el cuerpo adulterado. |
| base | Las cifras de la base son las del resumen, todas `proposed`, ninguna sin responsable, existentes con frecuencia y sin plazo, por implementar con plazo y sin frecuencia, ninguna fila «No controlado». |
| pendientes | `[línea base, después]` con «después» < «línea base». Ninguno de los pendientes revisados lo está por sus medidas. Las dos cifras son la evidencia de «los pendientes bajan a los reales». |
| editor | Un Importante con «Por implementar · plazo …» y un Moderado con «Existente · verificación …». |

Si el spec falla:
- abrir el trace (`npx playwright show-trace test-results/…/trace.zip`) antes de tocar nada;
- un defecto del producto se arregla en un commit `fix(miper): …` en la rama, y el spec temporal se
  vuelve a crear en un worktree nuevo desde el HEAD nuevo;
- un localizador que no calza con el HTML real se corrige sólo en el spec temporal, y el informe lo
  anota como AUTOMATION WARNING.

- [ ] **Step 3 (opcional): Recorrido de sólo lectura en `bodega_dev`**

Sirve para ver en datos existentes el formulario de la medida nuevo («¿Ya está implementada?», plazo y
frecuencia). **No se guarda nada:** se abren formularios y se cancelan.
- Ningún `INSERT`, `UPDATE` ni `DELETE`.
- Ninguna faena `QA_`.
- Nunca «Revisar el archivo» en `bodega_dev`: la vista previa guarda un lote preparado.
- Los recuentos de antes y de después tienen que coincidir.

Una medida de una foto **sellada antes de la Fase C** (sin `isExisting`) no se puede ver en
`bodega_dev`, que no tiene versiones ni rondas, y su tabla de medidas tiene la columna `NOT NULL
DEFAULT false`. Esa lectura la cubren `snapshot.test.ts` y `control-card.test.tsx`, y se declara en
COVERAGE GAP.

```bash
cd /home/allopze/dev/chome/bodega
DEV_DB=$(node -e 'const { loadEnvConfig } = require("@next/env"); loadEnvConfig(process.cwd(), true, { info() {}, error() {} }); process.stdout.write(process.env.DATABASE_URL)')
case "$DEV_DB" in *:5433/*) ;; *) echo "No es bodega_dev (:5433): no se sigue"; exit 1;; esac
psql "$DEV_DB" -At -c "BEGIN READ ONLY; SELECT count(*), max(created_at) FROM drizzle.__drizzle_migrations; ROLLBACK;"
node -e 'const j = require("./db/migrations/meta/_journal.json"); console.log(j.entries.length, j.entries.at(-1).when)'
cat > /tmp/qa-c-recuento.sql <<'SQL'
BEGIN READ ONLY;
SELECT 'matrices', count(*) FROM prevention_risk_matrices
UNION ALL SELECT 'entries', count(*) FROM prevention_risk_entries
UNION ALL SELECT 'controls', count(*) FROM prevention_risk_controls
UNION ALL SELECT 'import_batches', count(*) FROM prevention_risk_import_batches
UNION ALL SELECT 'audit_log', count(*) FROM audit_log;
SELECT 'md5 entries', md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM prevention_risk_entries t;
SELECT 'md5 controls', md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM prevention_risk_controls t;
ROLLBACK;
SQL
psql "$DEV_DB" -At -f /tmp/qa-c-recuento.sql | grep -v '^BEGIN$\|^ROLLBACK$' > /tmp/qa-c-antes.txt
psql "$DEV_DB" -At -c "BEGIN READ ONLY; SELECT id FROM prevention_risk_matrices WHERE title LIKE '%Oficina Central%2099%'; ROLLBACK;"
```

Crear `qa-c-lectura.mjs` en la raíz y correrlo con
`MIPER_ID=<id de la consulta de arriba> SHOTS=/tmp/claude-1000/-home-allopze-dev-chome-bodega/10960f9d-1cca-4584-a80d-a04d7f759f0b/scratchpad/qa-c node qa-c-lectura.mjs`:

```js
// qa-c-lectura.mjs — sonda TEMPORAL y de SÓLO LECTURA (Task 11, opcional). Va en la raíz para resolver
// @playwright/test. NO se versiona: `rm qa-c-lectura.mjs` al terminar. Abre el formulario de una
// medida y lo cancela: no guarda nada. La sesión QA es una credencial: no se imprime nada de ella.
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
page.on("request", (request) => { if (request.method() === "POST" && request.headers()["next-action"]) escrituras.push(new URL(request.url()).pathname) })

await page.goto(`${BASE}/prevencion/miper/${MIPER_ID}?completitud=pendientes`)
await page.getByRole("link", { name: /^Riesgo #\d+:/ }).nth(0).click()
await page.getByRole("tab", { name: /Medidas de control/ }).click()
anotar("tarjetas de medida existentes", await page.getByRole("article").allTextContents())
const agregar = page.getByRole("button", { name: "Agregar medida", exact: true })
if (await agregar.count() === 0) {
  anotar("formulario", "la sesión QA no edita esta MIPER: sin «Agregar medida»")
} else {
  await agregar.click()
  anotar("formulario: «Por implementar» elegido al abrir", await page.getByRole("radio", { name: "Por implementar" }).getAttribute("aria-checked"))
  anotar("formulario: «Plazo de la medida» a la vista", await page.getByRole("button", { name: /^Plazo de la medida/ }).count())
  await page.getByRole("radio", { name: "Ya está implementada" }).click()
  anotar("formulario: «Frecuencia de verificación» a la vista y sin plazo", [
    await page.getByRole("textbox", { name: "Frecuencia de verificación" }).count(),
    await page.getByRole("button", { name: /^Plazo de la medida/ }).count(),
  ])
  await page.screenshot({ path: `${SHOTS}/c-bodega-dev-formulario.png` })
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
}
// Una Server Function de lectura (el selector de faena) no aparece acá: si hay alguna, se anota y se revisa.
anotar("Server Functions enviadas (esperado: ninguna)", escrituras)
anotar("consola", errores)
await browser.close()
```

Después:

```bash
psql "$DEV_DB" -At -f /tmp/qa-c-recuento.sql | grep -v '^BEGIN$\|^ROLLBACK$' > /tmp/qa-c-despues.txt
diff /tmp/qa-c-antes.txt /tmp/qa-c-despues.txt && echo "DESPUÉS = ANTES"
rm qa-c-lectura.mjs
```

Si el `diff` no da vacío, se investiga y se informa: este paso no escribe.

- [ ] **Step 4: Informe `qa/reports/2026-10-03-miper-c.md`**

Mismo formato que `qa/reports/2026-10-03-miper-b.md`. Secciones, en este orden:
1. **Alcance:** acotado a la Fase C (importación con medidas, D5 de punta a punta, la tarjeta y el
   formulario de la medida, el Excel y el arrastre de la Fase B). No es una auditoría de la
   aplicación ni afirma cobertura total.
2. **Entorno y datos.** Decir explícitamente:
   - **El criterio de aceptación C se verificó con el RE-04 real de Biodiversa en la base E2E
     desechable, y no en `bodega_dev` como dice literalmente el plan maestro.** El motivo: revertir
     una importación en `bodega_dev` exige borrar filas de `audit_log`, que es de sólo agregar
     (migración 0340), y para eso habría que apagar su protección (`app.audit_maintenance`). No se
     hizo. La base E2E se vuelve a sembrar en cada corrida, así que no quedó nada que revertir.
   - Además: el worktree y su commit; que el spec fue temporal y no se commiteó; el catálogo de
     factores de la base E2E; si se hizo el Step 3, las migraciones de `bodega_dev` y sus recuentos
     antes y después (idénticos).
3. **PASS:** una tabla con lo medido en cada caso del Step 2 (de `resultados.json`) y del Step 3. Debe
   incluir el criterio C con números:
   - medidas creadas, con tipo, responsable y plazo o frecuencia;
   - todas `proposed`;
   - existentes y por implementar iguales al resumen;
   - pendientes, línea base contra después;
   - el rechazo del mapeo adulterado.
4. **Hallazgos clasificados:** PRODUCT BUG, FUNCTIONAL FINDING, UX FINDING, INCONSISTENCY,
   AUTOMATION WARNING e IMPROVEMENT OPPORTUNITY. Si no hay hallazgos en una categoría, se dice.
   Candidatos a revisar:
   - las frases partidas por comas en celdas sin «;» («SEGUROS Y DISTRIBUCIÓN UNIFORME DE LA CARGA»);
   - las 19 «sin pista»;
   - la tabla de 222 frases en un `Sheet`.
5. **Errores de consola y fallas de red.**
6. **Cobertura de rutas y pasos.**
7. **COVERAGE GAP.** Como mínimo:
   - la comparación con «Oficina Central 2099» de `bodega_dev`: la línea base se calculó en la base
     E2E;
   - la diferencia posible entre el catálogo de factores de la base E2E y el de `bodega_dev`;
   - una medida de una foto sellada antes de la Fase C vista en pantalla (sólo `snapshot.test.ts` y
     `control-card.test.tsx`);
   - «Agregar al vigente» con medidas (sólo PGlite);
   - el rollback a mitad de carga (sólo PGlite, con un trigger);
   - un lector de pantalla real;
   - tiempos en producción (fuera de alcance: requieren autorización).
8. **Compuertas** (Step 6), con el conteo de pruebas, y **E2E** (Task 10 y el spec temporal de este
   paso), con el conteo por spec.
9. **Recomendaciones priorizadas.** Entre ellas, las de «Después de la Fase C».

Nunca afirmar cobertura total. Ningún nombre de persona: los responsables del RE-04 son cargos y la
única persona asignada es una usuaria sembrada de prueba.

- [ ] **Step 5: Manual y spec**

En `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`:

1. Reemplazar la subsección «### Importar el RE-04 desde el Excel real» entera (desde ese título hasta
   antes de «### Antecedentes: los datos que se completan solos»), conservando su último párrafo
   («Si el archivo usa **factores de riesgo que el catálogo no tiene**…»), por:

   ```markdown
   ### Importar el RE-04 desde el Excel real

   Desde el encabezado de la portada, **"Importar"** lee la hoja **«RE-04 IPER»** de un Excel del formato real y carga sus riesgos **y sus medidas de control**. Son cuatro pasos:

   1. **Archivo.** Se elige la **Faena**, el **Período del borrador** y el archivo `.xlsx`, y se aprieta **"Revisar el archivo"**.
   2. **Filas.** Una fila por riesgo con la fila del Excel, la actividad, el peligro/riesgo, la **evaluación que calcula la plataforma** y, si hay algo que mirar, el **problema por fila**: una Probabilidad o Consecuencia **fuera de la escala** (sólo valen **1, 2 y 4**) o un **factor de riesgo que el catálogo todavía no tiene**.
   3. **Medidas detectadas.** La plataforma separa las medidas de la columna **MEDIDA DE CONTROL** (por saltos de línea; dentro de una línea, por «;» y, si no hay «;», por las comas que no están entre paréntesis) y agrupa lo que se repite: cada **frase distinta**, cada **responsable distinto** y cada **plazo distinto** se deciden **una sola vez**, no fila por fila.
      - **Tipo (I–V).** El Excel no lo trae. La plataforma lo **sugiere** por palabras clave (EPP, guantes, casco → V; capacitación, procedimiento, señalización, inspección → IV; barandas, bloqueo, resguardos, mantención → III) y lo marca **"Sugerida"** hasta que lo confirmas: eligiéndolo, con **"Confirmar"** en la fila o con **"Aceptar sugerencias"**. **"Sólo sugeridas"** deja a la vista lo que falta. Una frase sin ninguna pista se sugiere IV y dice **"Sugerida · sin pista"**: mírala antes de aceptar. Si el Excel es uno exportado por la plataforma, el «IV. Controles administrativos: …» de cada medida ya trae su tipo.
      - **Responsables.** Cada valor de la columna RESPONSABLE queda **tal como está escrito**, se asigna a una **persona de la faena** o queda **sin responsable**.
      - **Plazos.** Cada valor de la columna PLAZOS decide si sus medidas **ya están implementadas** —se cargan como **existentes**, con ese texto como **frecuencia de verificación** («TRIMESTRAL», «ANTES DE CADA OPERACIÓN»)— o están **por implementar**, con una **fecha**: «INMEDIATO…» propone el día de la importación, «EN 30 DÍAS…» propone hoy + 30 y una fecha escrita se toma tal cual. Un valor que la plataforma no reconoce queda por implementar y sin fecha.
   4. **Confirmar.** Un resumen dice cuántos riesgos se cargan y cuántas medidas (existentes y por implementar), y se elige el destino: **"Cargar en borrador"** (un borrador nuevo del período) o **"Agregar al vigente"**.

   > [!IMPORTANT]
   > **LAS MEDIDAS IMPORTADAS QUEDAN «PROPUESTA».** Existentes o por implementar, todas entran en estado **Propuesta** hasta que alguien las verifique: importar un Excel **no baja** "Riesgos críticos sin control" sin evidencia.

   > [!IMPORTANT]
   > **MANDA LA PLATAFORMA, NO EL EXCEL.** La matriz y la clasificación que trae el archivo se **informan**, pero el valor que se guarda es el que calcula la plataforma (`P × C`). Una fila cuya Probabilidad o Consecuencia no esté en 1, 2 ó 4 **no se carga**, aunque se apriete el botón: la escritura vuelve a validarse en el servidor.

   La carga es **una sola operación**: si algo falla, no queda ni el borrador, ni riesgos, ni medidas. El servidor vuelve a calcular las frases, los responsables y los plazos desde el archivo revisado y **rechaza** una carga a la que le falte una decisión o que traiga decisiones de otro archivo ("Vuelve a revisar el archivo"). Cambiar la faena, el período o el archivo descarta lo revisado.
   ```

2. Línea 139: reemplazar «la banda sin medida con responsable y plazo» por «la banda sin medida por
   implementar con responsable y plazo».
3. En la tabla de «¿Qué significa "¿Está controlado?"», reemplazar las filas **Parcialmente** y **No**
   por:

   ```markdown
   | **Parcialmente** | Hay medidas, pero no alcanzan a cubrir el riesgo: queda trabajo por hacer. | Exige al menos una medida registrada. Si es Importante, además una medida **por implementar** con responsable y plazo. |
   | **No** | El riesgo no está controlado (no hay medidas suficientes). | Un riesgo Importante exige una medida **por implementar** con responsable y plazo; un Intolerable, siempre. |
   ```

4. Antes de «### Reglas que la plataforma exige antes de dejar enviar a revisión», agregar:

   ```markdown
   ### Medida existente o por implementar

   Cada medida dice si **ya está implementada** o está **por implementar** («¿Ya está implementada?» en el formulario de la medida):

   | | Qué pide | Cómo se ve en la tarjeta |
   |---|---|---|
   | **Ya está implementada** (existente) | Tipo, descripción y responsable (salvo en Tolerables). En vez de plazo, una **frecuencia de verificación**, opcional (por ejemplo, trimestral). | «Existente · verificación Trimestral» |
   | **Por implementar** | Tipo, descripción, responsable (salvo en Tolerables) y **plazo**. | «Por implementar · plazo 31-12-2026» |

   En el Excel exportado, la columna **PLAZOS** lleva la frecuencia de una medida existente y la fecha de una por implementar, **una línea por medida**, alineada con MEDIDA DE CONTROL y RESPONSABLE; «—» marca el dato que falta.
   ```

5. En la tabla de reglas, reemplazar las filas **Importante**, **Intolerable** y **Toda medida** por:

   ```markdown
   | **Importante** | Al menos una medida; si no está «Sí» controlado, una medida **por implementar con responsable y plazo** (una existente no la reemplaza). |
   | **Intolerable** | Al menos una medida **por implementar** con responsable y plazo, y advertencia crítica permanente mientras siga en esa banda. |
   | Toda medida | Descripción y tipo (I–V); **plazo sólo si está por implementar**. El responsable es obligatorio salvo en riesgos Tolerables. |
   ```

En `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md`:
1. Línea 3: reemplazar «Estado: **Fase A (con el pulido A2) y Fase B implementadas**» por «Estado:
   **Fases A (con el pulido A2), B y C implementadas**».
2. Al final de §8 (antes de «## 9. Fase D: acciones masivas»), agregar:

   ```markdown
   **Implementado (Fase C, plan `docs/superpowers/plans/2026-10-03-miper-c-importacion.md`):**

   - **D5 y D6, confirmadas por el usuario el 2026-10-02.** Además, dos decisiones suyas:
     - **Estado `proposed`:** las medidas importadas —existentes y por implementar— quedan
       **propuestas** hasta que alguien las verifique; no bajan «Riesgos críticos sin control» sin
       evidencia.
     - **Regla crítica:** un **Importante no controlado** y un **Intolerable** exigen al menos **una
       medida por implementar** con responsable y plazo; las existentes no la reemplazan
       (`checkMiperCompleteness`). «Atención requerida» aplica la misma regla.
   - **Separadores.** Se separan los saltos de línea. Dentro de una línea, «;» si la hay y, si no,
     las comas de primer nivel; después, el «.X» pegado. Una línea con «I.–V.» (libro exportado) es
     una medida con su tipo. Las frases se agrupan con `normalizeMeasure`
     (`distinctPhrases`), no con `normalizeMiperName`.
   - **Tipo.** Gana la palabra clave que aparece primero; sin ninguna, IV marcada «sin pista».
     Todo tipo inferido nace «Sugerida» y lo confirma una persona: eligiéndolo, con «Confirmar» o
     con «Aceptar sugerencias».
   - **Servidor.** La carga recalcula las claves desde el lote, rechaza las que faltan o sobran,
     exige personas activas y de la faena, y crea borrador, riesgos, medidas y traza en una sola
     transacción (`createMiperWithClient`).
   - **Excel.** MEDIDA, RESPONSABLE y PLAZOS llevan una línea por medida; PLAZOS es la frecuencia
     (existente) o la fecha (por implementar).
   ```

- [ ] **Step 6: Puertas**

```bash
npm run typecheck && npm run lint && npm run test:fast && npm run check:secrets && npm run doctor
npm run test:pglite -- lib/__tests__/miper-snapshot-batch.test.ts
npm run test:pglite -- lib/__tests__/miper-snapshot-service.test.ts
npm run test:pglite -- lib/__tests__/miper-entries.test.ts
npm run test:pglite -- lib/__tests__/miper-matrices.test.ts
npm run test:pglite -- lib/__tests__/miper-queries.test.ts
npm run test:pglite -- lib/__tests__/miper-portfolio.test.ts
npm run test:pglite -- lib/__tests__/miper-import.test.ts
npm run test:pglite -- lib/__tests__/miper-workflow.test.ts
npm run test:pglite -- lib/__tests__/miper-work-queue.test.ts
npm run test:pglite -- lib/__tests__/miper-notifications.test.ts
npm run test:pglite -- lib/__tests__/miper-program-generation.test.ts
```

Expected: verde.
- `db:verify-migrations` no aplica: no hay migración.
- Anotar en el informe los conteos de `test:fast` (archivos y pruebas) y los resultados de PGlite. Los
  `test:pglite` van de a uno.
- Si `test:fast` falla en `import-dialog.test.tsx` sólo bajo la carga de la corrida completa, mirar el
  tiempo: las esperas del test ya tienen 5 s (`LENTO`). No se suben a ciegas.

- [ ] **Step 7: Commit**

```bash
git status --short   # ni qa-c-biodiversa.spec.ts ni qa-c-lectura.mjs aparecen; el .gitignore modificado NO se agrega
git add docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md qa/reports/2026-10-03-miper-c.md
git commit -m "docs(miper): manual y spec al día con la importación con medidas e informe de verificación de la Fase C" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Autorrevisión contra el plan maestro (sección C y arrastre de B)

| Pedido | Task |
|---|---|
| Arrastre: desempate `asc(preventionRiskControls.id)` con prueba; la dorada sigue verde | 1 |
| Arrastre: retirar `listMipers` / `listMiperInbox` y migrar sus aserciones a `listMiperPortfolio` | 1 (`miper-queries.test.ts`, `miper-import.test.ts`) |
| Arrastre: «Cambiar de faena» sin período en la actual | 1 (más la prueba de la Fase B que afirmaba el rótulo viejo) |
| C1 Foto: `isExisting?` y `verificationFrequency?`; `controlsKey` con `?? false` / `?? null`; foto vieja sin cambios falsos; las selladas no se recalculan | 2 |
| C1 Guardado: esquema y `saveMiperControl` con historial antes y después | 2 |
| C1 Completitud: plazo sólo con `!isExisting`; regla crítica por implementar | 3 |
| C1 Consumidores: `prevention-attention.ts` alineado (cuenta el responsable escrito) | 3 |
| C1 Las cifras de pendientes en la portada de B | 3. La portada usa `checkMiperCompleteness`, sin código nuevo; la PGlite `miper-portfolio` sigue verde. |
| C1 Excel: una línea por medida; PLAZOS = frecuencia o fecha | 4 |
| C1 UI: «¿Ya está implementada?» en `ControlForm`; «Existente · verificación X» / «Por implementar · plazo …» en `ControlCard` | 5 |
| C2 Parser: «…REQUIERE ACCIÓN INMEDIATA» → `partial`, por prefijo | 6 |
| C3 `re04-measures.ts`: desde `original["MEDIDA DE CONTROL"]`; `splitMeasures` (saltos, «;», comas de primer nivel, «.X», prefijos I–V); `inferHierarchy` → `{ hierarchy, source }`; `distinctPhrases` con `normalizeMeasure`; `deadlineSuggestion` | 6 |
| C4 Vista previa: `measureAnalysis` y los usuarios de la faena | 7 |
| C5 Esquema con `measureMapping`, `responsibleMapping` y `deadlineMapping` | 8 |
| C5 Validación: claves recalculadas (desconocidas y faltantes), usuarios activos y de la faena, enum y topes | 8 (y los topes en la vista previa, 7) |
| C5 Transacción: medidas `proposed` y un `import_applied` por riesgo con la cuenta | 8 |
| C5 `createMiperWithClient`: borrador en la misma transacción | 8 (rollback probado con un trigger) |
| C6 UI: Archivo → Filas → Medidas detectadas → Confirmar; tipo por frase con «Aceptar sugerencias» y «sólo sugeridas»; responsables y plazos; resumen; patrón de `generate-actions-dialog.tsx` | 9 |
| C7 Unitarias: `re04-measures` con frases reales, completitud, foto vieja, alineación del Excel | 2, 3, 4 y 6 |
| C7 PGlite con libro de ExcelJS: medidas, mapeos, rechazo de claves incompletas o desconocidas, rollback | 7 y 8 |
| C7 E2E de importación con `.xlsx` generado | 10 |
| C8 Docs: manual de importación; spec §8 con `proposed` y la regla crítica; informe QA | 11 |
| Criterio C: importar el RE-04 de Biodiversa crea las medidas con tipo, responsable y plazo o frecuencia; los pendientes bajan a los reales; un mapeo incompleto se rechaza | 11, con el archivo real en la base E2E desechable («Decisiones», 13); `bodega_dev` sólo se lee |

**Nombres que cruzan tareas:**
- Task 2 → Tasks 3, 4, 5 y 8: `MiperControlSnapshot.isExisting?` y `.verificationFrequency?`, y
  `miperControlSaveSchema.values.isExisting` / `.verificationFrequency`.
- Task 4 → Task 6: `alignedDetail` (en `miper-workbook.test.ts`).
- Task 6 → Tasks 7, 8 y 9:
  - `analyzeRe04Measures`, `mappingProblems`, `suggestedMappings`;
  - los tipos `MeasureAnalysis`, `ImportMappings`, `ImportMeasure`, `ResponsibleDecision`,
    `DeadlineDecision` y `PhraseGroup`;
  - `controlledStatusOf` por prefijo.
- Task 7 → Tasks 8 y 9:
  - `worksiteResponsibleOptions` e `IMPORT_LIMITS`;
  - `RiskImportPreview.measureAnalysis` y `.responsibleOptions`;
  - `MEASURES_FIXTURE` y `workbookOf(rows, marker)` en `miper-import.test.ts`.
- Task 8 → Tasks 9, 10 y 11: `createMiperWithClient`, `RiskImportCommitResult.measures` y el mensaje
  de `commitRiskImportAction`.
- Task 9 → Tasks 10 y 11: los nombres del diálogo y del paso.
  - Diálogo «Importar el RE-04»; paso con `aria-current="step"`; campos «Faena», «Período del
    borrador» y «Archivo del RE-04».
  - Botones «Revisar el archivo», «Siguiente», «Aceptar sugerencias (N)» y «Cargar en borrador».
  - Regiones «Tipo de cada medida detectada», «Responsables del Excel», «Plazos del Excel» y «Qué se
    va a cargar».
  - Controles «Responsable para «…»», «Cómo se cargan las medidas con «…»» y «Frecuencia de
    verificación para «…»».

**Verificación del plan antes de entregarlo (2026-10-03):** el código de las Tasks 1 a 10 se aplicó
tal como está escrito acá en un worktree desechable, fuera del checkout del usuario.
- Pasaron `typecheck` y `eslint` sobre los 40 archivos tocados.
- Pasaron las suites rápidas de `app/(app)/prevencion`, `lib/prevention`, `lib/reports`,
  `lib/validation`, `app/api/prevencion`, `app/(app)/dashboard` y `lib/services` (2.587 pruebas).
- Pasaron, de a una, las PGlite `miper-snapshot-batch`, `miper-entries`, `miper-queries`,
  `miper-portfolio`, `miper-import` (11), `miper-work-queue`, `miper-workflow`, `miper-matrices`,
  `miper-notifications`, `miper-program`, `miper-program-generation`, `miper-snapshot-service` y
  `miper-constraints`.
- El test del desempate falla sin el `asc(id)` y pasa con él.
- `re04-measures.ts`, corrido sobre el RE-04 real, da 789 medidas, 222 frases, 19 sin pista y los 5
  plazos.
- **No se corrió ninguna E2E** (Tasks 10 y 11) ni el recorrido de lectura en `bodega_dev` (Task 11): quedan para la
  ejecución.

## Después de la Fase C

Integrar localmente en `main` con todo en verde, sin push (subirlo se consulta). Luego, el plan de la
**Fase D** (acciones masivas, spec §9) con este mismo formato. D escribe `isExisting`, la frecuencia,
el responsable y el plazo en lote: debe reutilizar `controlColumns` (Task 2) para que la regla de qué
se guarda vacío sea una sola.

Pendientes que esta fase deja anotados:
- **Orden al duplicar un riesgo** (`duplicateMiperEntry`): las copias de sus medidas nacen con el
  mismo `created_at` y, con el desempate de la Task 1, salen por id, que es estable pero no el orden
  original. El arreglo es el mismo que el de la importación: `created_at` + N ms por medida.
- **«Seguimiento» del editor** (`follow-up-step.tsx`): el diff de «Medidas de control» lista sólo las
  descripciones, así que pasar una medida de «por implementar» a «existente» se ve como «antes X →
  ahora X».
- **`DataTable` dentro del `Sheet` de importación** (paso «Filas»): toma la búsqueda del TopBar de la
  portada. Evaluar `disableInternalSearch` o una búsqueda propia del diálogo.
- **Frases partidas en celdas con comas que enumeran sin «;»** («VERIFICAR CIERRE DEL PORTALÓN,
  SEGUROS Y DISTRIBUCIÓN…»). Una opción «Omitir» o «Unir con la anterior» en «Medidas detectadas»
  sería la mejora natural si el informe QA lo pide.
