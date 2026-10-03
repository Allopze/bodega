# MIPER — plan integral del resto: Fase D (Tasks 5–12), V1, Fase E y V2, en paralelo

> **Para el controlador.** Cada stream recibe SÓLO su brief autocontenido en
> `.superpowers/sdd/2026-10-03-miper-resto-integral/stream-<N>-brief.md` (git-ignorado). Los briefs se
> generan desde este documento: las secciones marcadas `<!-- BEGIN:… -->` se copian tal cual.

**Objetivo.** Cerrar el rediseño de la MIPER: las acciones masivas de la Fase D sobre el servicio ya
commiteado, el recorrido de revisión y sólo lectura (V1), la Fase E (programa, revisión, historial,
controles y descarga de evidencia) y la verificación final (V2).

**Modelo de ejecución (instrucción del usuario, 2026-10-03: velocidad).**

1. **Fase 0 (controlador, secuencial, minutos):** una base común que todos los streams necesitan
   (`action-guard.ts`), verificada con dos puertas baratas.
2. **Siete streams en paralelo** (Sonnet), cada uno en su worktree y su rama, con **propiedad de
   archivos disjunta**. Ningún stream corre puertas: escriben código y pruebas, revisan su diff y
   commitean.
3. **Integración (controlador):** cherry-pick en orden, tres cableados explícitos (W1–W3), puertas en
   orden, E2E desde un worktree desechable, recorridos V1/V2, docs e informes, y la ronda de arreglos.

**Estado de partida.** Rama `feat/miper-acciones-masivas`, HEAD `b97ec7f9` (Task 4 + su ronda de
arreglos: `.for("update")` en las lecturas de riesgos, helpers compartidos en `entries.ts`, y los
elementos sin cambio efectivo **no se escriben**: `bulkPatchMiperEntries` devuelve
`{ entries: BulkSaved[] }` y `bulkUpdateMiperControls` `{ controls: BulkSaved[] }` sólo con lo escrito;
`bulkAddMiperControl` devuelve `{ controls: Array<{ id; entryId }> }` y siempre crea en todos). Fases
A, A2, B y C están en `main`. `.gitignore` del usuario modificado a propósito: nunca se stagea.

**Fuentes.**
- Plan maestro `/home/allopze/.claude/plans/revisa-el-ui-ux-de-stateful-zebra.md`: secciones D, V1, E,
  V2, «Criterios de aceptación», y los arrastres/decisiones del final.
- Spec `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` §9–§12.
- Plan D `docs/superpowers/plans/2026-10-03-miper-d-acciones-masivas.md`: las Tasks 5–12 **no se
  reescriben**; se asignan a streams y su texto se embebe en los briefs S1, S2 y S7.

**Desvíos decididos acá (y su costo).**

| # | Desvío | Por qué | Costo |
|---|---|---|---|
| 1 | V1 deja de ir antes de E: S7 la escribe como spec E2E en paralelo y se corre en la integración contra la UI final. | Velocidad. | Sus hallazgos entran a la ronda de arreglos de la integración, no al diseño de E. |
| 2 | Task 11 de D → S7; Task 12 de D (manual, spec §9, informe D, recorrido de sólo lectura) → integración. | El manual y la spec son archivos calientes: un solo dueño. | Los docs se escriben al final, con la UI ya mergeada. |
| 3 | Las acciones nuevas de E van en archivos nuevos (`[id]/program-actions.ts`, `[id]/history-actions.ts`) sobre `action-guard.ts` (Fase 0). | `actions.ts` es de S1. Un archivo `"use server"` no puede exportar `guarded` (lo publicaría como endpoint). | Un archivo más; `actions.ts` adelgaza. |
| 4 | Las pruebas PGlite nuevas van en suites **ya registradas** en `tests/pglite-files.ts`. | Ese archivo es caliente. | Las suites existentes crecen. |
| 5 | `getProgramProgress` se borra (S3); el Resumen lee `program.progress` de la carga del programa (S4). | Arrastre de B. | Dos suites PGlite cambian su aserción de avance. |
| 6 | El encabezado del programa deja de editar los datos de empresa: los muestra de la ficha. El esquema se acota a fecha y encargado. Las columnas de empresa del programa quedan en la base (sin migración) pero ya no se editan ni se exportan. | Spec §10 y plan maestro E. | Datos de empresa viejos en `prevention_risk_programs` quedan huérfanos de UI. |
| 7 | Índices (`occurrence_evidence.record_id`, `records.occurrence_id`, `action_controls.control_id`): **fuera**, salvo que la medición de la integración lo justifique. | Plan maestro: «sólo si la medición lo justifica». | Ninguno si no se miden lentitudes. |
| 8 | Los streams no corren ninguna puerta (ni typecheck, ni lint, ni pruebas, ni E2E). | Instrucción del usuario. | Las costuras entre streams aparecen recién en la integración. |

---

<!-- BEGIN:global -->
## Reglas globales (valen para todos los streams y para la integración)

### Reglas del repositorio (AGENTS.md)
- Páginas: `PageHeader` + `PageContainer`; nunca un `<h1>` propio ni padding alrededor de
  `PageContainer`. Acciones de página en `PageHeader.actions`.
- **Sin buscador suelto:** `/prevencion/miper/[id]` está en `OWN_SEARCH_PATTERNS` (`top-bar.tsx`); la
  matriz y el programa tienen buscadores propios **rotulados**. Ningún buscador nuevo fuera de ésos.
- **Densidad A1–A6:** ≤ 4 tiles accionables; 4–6 filtros primarios; lista + acción en el header, nunca
  un formulario permanente; vacíos con qué significa + qué hacer + CTA real (`EmptyState`); una
  dimensión = una representación; un gráfico = una unidad por eje; nunca un enum crudo en pantalla;
  abreviaturas con `title`.
- **Color de texto:** sólo tokens `-ink` (`--color-warning-ink`, `--color-signal-ink`, …). Botón
  primario = `<Button variant="primary">`.
- **Plurales:** `countOf` / `pluralize` de `@/lib/utils`.
- **Fechas:** `formatDate` / `formatDateTime`; HOY con `todayInChile()`, año con `codeYear()`. Nunca
  `toLocaleDateString`, nunca `new Date().toISOString().slice(0, 10)`. Controles de fecha con el
  `DatePicker` del design system, nunca `<input type="date">`.
- **Formularios:** `Field` para cada campo. `<form action={serverAction}>` → `useActionState`; envío
  imperativo (onClick, diálogo de confirmación, onChange) → `useOperation` (`@/lib/hooks/use-operation`).
  Controles no nativos (`OptionSelect`, `DatePicker`) con `aria-label`/`ariaLabel`.
- **Exportaciones:** sólo Excel (`.xlsx`), nunca CSV. `ExportButton` / `ExportDialog`.
- **Confirmación** de toda acción destructiva (`ConfirmDialog`), con el diálogo bloqueado mientras guarda.
- **Migraciones:** ninguna prevista. Si una fuera imprescindible: cambiar `db/schema/*.ts`,
  `npm run db:generate`, `node scripts/verify-migration-chain.mjs --update-checksums`,
  `npm run db:verify-migrations`. **Nunca** editar `db/migrations/meta/_journal.json` ni una migración
  ya creada; nunca `db:push`.
- **Autorización:** ocultar en la UI no es autorización. El servidor relee y vuelve a autorizar todo
  (`requireAccess` + `scopeAllows`); el alcance y el actor salen de la sesión, nunca del input.
- **Locators E2E:** `getByRole` ignora nodos ocultos; `getByText`/`getByLabel`/`locator` no. Usar
  `textoVisible()` / `campoInspeccion()` de `e2e/helpers.ts` en vez de `.first()`. `{ exact: true }`
  cuando un nombre es prefijo de otro.

### Reglas de fase que tienen que seguir valiendo
- **D5:** el plazo es obligatorio **sólo** para medidas por implementar (`!isExisting`); una existente
  se verifica con una frecuencia. `controlColumns` (`lib/prevention/miper/control-values.ts`) es la
  única implementación, compartida por el servicio, el lote y la vista previa del cliente.
- **Regla crítica:** un Importante no controlado y un Intolerable exigen al menos una medida **por
  implementar** con responsable y plazo (y el Intolerable, vínculo con el programa al enviar).
- **Medidas nuevas e importadas nacen `proposed`**, también las del lote.
- **Fechas de calendario:** `isoDate` valida el calendario (2026-02-31 se rechaza); `civilDate` en el
  servicio.
- **Navegación del espacio de trabajo con historia nativa:** `navigateWorkspace(href, "push"|"replace")`
  (`[id]/workspace-nav.tsx`), que llama a `beforeForwardNavigation`; los enlaces internos son
  `WorkspaceLink`; «‹ Volver a …» lleva `restoreScroll`. Los filtros en la URL se cambian con
  `replace` y sin ida al servidor. Nunca `router.push`/`router.replace` para la vista del espacio de
  trabajo.

### Nunca
- Tocar producción.
- Escribir en `bodega_dev` (contenedor `bodega-dev-db`, 127.0.0.1:5433): sólo lectura, y los recuentos
  de antes y de después de un recorrido coinciden.
- Usar `app.audit_maintenance` o borrar de `audit_log`, en ninguna base.
- Imprimir credenciales, cookies, URLs de base o `playwright/.auth/monkeytest.json`.
- `npm run test:e2e` desde el checkout principal `/home/allopze/dev/chome/bodega` (`e2e/start-server.sh`
  hace `rm -rf .next` y rompe el `next dev` del usuario en :3001).
- `pkill -f` (matar sólo por PID, `ss -ltnp`).
- Stagear `.gitignore`. `git add -A` / `git add .`.
- `--no-verify`. `push`.

### Commits
- Conventional commits en español: `feat(miper): …`, `fix(miper): …`, `refactor(miper): …`,
  `test(miper): …`, `docs(miper): …`.
- `git add` con rutas explícitas y entre comillas (las de `app/(app)/…` llevan paréntesis).
- Pie: `git commit -m "<asunto>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"` en los
  streams (decisión B: el pie nombra el modelo que escribió el commit); el controlador firma con
  `Claude Opus 5.5`.
- Datos personales: ningún nombre, RUT ni correo real en pruebas, fixtures, informes o commits.
<!-- END:global -->

<!-- BEGIN:stream-rules -->
## Cómo trabaja un stream

- Trabajas **sólo** en tu worktree y tu rama (`miper-resto/s<N>`), que parten del commit de la Fase 0
  sobre `feat/miper-acciones-masivas`. El controlador te da la ruta.
- **No corres ninguna puerta:** ni `typecheck`, ni `lint`, ni `test:fast`, ni `test:pglite`, ni E2E.
  Escribes el código **y** las pruebas que se piden (nombres y aserciones de este brief), relees tu diff
  y commiteas. El controlador corre todo al integrar.
- **Sólo tocas los archivos de tu lista «Propios».** Si necesitas cambiar otro, no lo hagas: anótalo
  en tu reporte como «cableado pendiente» con el cambio exacto.
- **Interfaces de otros streams:** las consumes con los nombres y firmas exactos de este brief, aunque
  el archivo todavía no exista en tu worktree (aparece al integrar). No crees copias, dobles ni stubs en
  archivos de otro stream. En pruebas, mockéalos con `vi.mock(<ruta>)`.
- Antes de usar una API de Next.js, lee la guía pertinente en
  `/home/allopze/dev/chome/bodega/node_modules/next/dist/docs/` (tu worktree no tiene `node_modules`).
- Reutiliza antes de crear (`components/ui/`, `lib/hooks/`, `lib/utils`, módulos vecinos de MIPER).
- Pruebas de componentes: `// @vitest-environment jsdom` en la primera línea; mockean
  `next/navigation`, `@/lib/toast` y las acciones de servidor que el árbol importe. jsdom no aplica CSS;
  en `OptionSelect` (Radix) se elige con `fireEvent.click` sobre el `combobox` y luego sobre el
  `option` (patrón de `components/ui/option-select.test.tsx`).
- No despachas subagentes.
- **Reporte final** (< 25 líneas): estado (DONE | DONE_WITH_CONCERNS | BLOCKED), commits (sha + asunto),
  archivos tocados, pruebas escritas (nombres), interfaces que provees tal como quedaron (si alguna
  difiere del contrato, dilo en la primera línea), cableados pendientes, dudas.
<!-- END:stream-rules -->

---

## Mapa de propiedad de archivos

Cada archivo tiene **un** dueño. «Int.» = sólo la integración lo toca.

| Archivo | Dueño |
|---|---|
| `app/(app)/prevencion/miper/action-guard.ts` (nuevo) | Fase 0 |
| `app/(app)/prevencion/miper/actions.ts`, `actions.test.ts` | Fase 0 (extracción) → **S1** (Task 5) → Int. (W1) |
| `[id]/use-row-saver.ts`(+test), `[id]/use-entry-autosave.ts`(+test), `[id]/use-risk-selection.ts`(+test), `[id]/control-fields.tsx`(+test), `[id]/control-form.tsx` | **S1** |
| `[id]/bulk-shared.tsx`, `[id]/bulk-dialogs.tsx`, `[id]/bulk-bar.tsx`(+test), `[id]/risk-row.tsx`, `[id]/task-view.tsx`(+test), `[id]/activity-section.tsx`, `[id]/matrix-view.tsx`(+test), `[id]/task-context-dialog.tsx`(+test) | **S2** |
| `lib/services/miper/program-queries.ts`, `program-execution.ts`, `program.ts`, `portfolio.ts`, `program-links.ts` (nuevo), `evidence-access.ts` (nuevo); `lib/prevention/miper/evidence-url.ts` (nuevo, +test); `lib/validation/prevention-module/miper.ts` (+test); `lib/reports/miper-workbook.ts` (+test); `app/api/prevencion/miper/evidence/[name]/route.ts` (nuevo, +test); `[id]/program-actions.ts` (nuevo, +test); suites PGlite `lib/__tests__/miper-program-queries.test.ts`, `miper-program.test.ts`, `miper-program-execution.test.ts`, `miper-program-occurrences.test.ts` | **S3** |
| `[id]/page.tsx`, `[id]/miper-workspace.tsx`(+test), `lib/prevention/miper/workspace-url.ts`(+test), `[id]/use-workspace-filter-navigation.ts` (nuevo, +test), `[id]/matrix-filters-bar.tsx`(+test), `[id]/program-panel.tsx`, `[id]/program-panel.test.tsx` (nuevo), `[id]/program-action-card.tsx` (nuevo), `[id]/program-action-dialog.tsx`, `[id]/generate-actions-dialog.tsx`, `[id]/resumen-panel.tsx` (sólo si hace falta) | **S4** → Int. (W2, W3 en `miper-workspace*`) |
| `[id]/program-activity-view.tsx` (nuevo, +test), `[id]/link-measures-dialog.tsx` (nuevo, +test), `[id]/evidence-sheet.tsx` (+test nuevo), `[id]/occurrence-dialog.tsx`, `[id]/program-badges.ts` (nuevo, +test) | **S5** |
| `lib/services/miper/queries.ts`, `lib/__tests__/miper-queries.test.ts`, `[id]/history-actions.ts` (nuevo, +test), `[id]/history-panel.tsx` (+test nuevo), `[id]/review-panel.tsx` (+test nuevo), `[id]/observation-item.tsx`, `[id]/risk-editor/risk-editor.tsx` (+test), `lib/prevention/miper/entry-navigation.ts` (+test), `lib/prevention/miper/review-walk.ts` (nuevo, +test), `app/(app)/prevencion/miper/controles/[id]/page.tsx` | **S6** |
| `e2e/**` (incluye `setup-db.ts`, `accessibility*.ts`, `miper-helpers.ts`, todas las specs MIPER) | **S7** |
| `tests/pglite-files.ts`, `docs/manual-prevencion/…/04-miper-mapa-riesgos.md`, la spec, `qa/reports/**`, `modules/**` | Int. |
| `lib/services/miper/bulk.ts`, `entries.ts` | nadie (cerrados en `b97ec7f9`) |

`[id]/` = `app/(app)/prevencion/miper/[id]/`.

---

## Fase 0 (controlador, antes de abrir los worktrees)

**P0-1. `action-guard.ts`.** Mover sin cambios de comportamiento, desde `app/(app)/prevencion/miper/actions.ts`
a un archivo nuevo **sin** `"use server"` (exportar `guarded` desde un archivo `"use server"` lo
publicaría como Server Function invocable): `BASE`, el tipo `Session`, `accessFrom`, `matrixIdOf`,
`stringFieldOf`, `fail` y `guarded`.

```ts
// app/(app)/prevencion/miper/action-guard.ts
/**
 * Frontera común de las Server Functions de la MIPER: permiso, alcance y actor
 * de la sesión, traducción de errores de dominio y revalidación. NO lleva
 * "use server": lo importan `actions.ts`, `[id]/program-actions.ts` y
 * `[id]/history-actions.ts`, y desde un archivo "use server" `guarded` quedaría
 * publicado como endpoint.
 */
import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { MiperAccess } from "@/lib/services/miper/shared"
import { PreventionEvidenceError } from "@/lib/services/prevention-evidence-upload"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import type { ActionState } from "@/lib/validation/prevention"
import type { Permission } from "@/modules/permissions"

export const MIPER_BASE = "/prevencion/miper"
export type MiperSession = NonNullable<Awaited<ReturnType<typeof guardPermission>>["session"]>
export function accessFrom(session: MiperSession): MiperAccess { /* cuerpo actual */ }
export function matrixIdOf(input: unknown): string | null { /* cuerpo actual */ }
export function stringFieldOf(input: unknown, key: string): string | null { /* cuerpo actual */ }
export function fail(error: unknown): ActionState { /* cuerpo actual */ }
export async function guarded<T>(permission: Permission, input: unknown, operation: (access: MiperAccess) => Promise<T>, options: { /* igual */ } = {}): Promise<ActionState> { /* cuerpo actual, con MIPER_BASE */ }
```

En `actions.ts`: borrar esas definiciones e importar
`{ accessFrom, fail, guarded, matrixIdOf, MIPER_BASE as BASE, stringFieldOf, type MiperSession as Session }`
desde `./action-guard`; quitar los imports que queden sin uso. `actions.test.ts` no cambia (sus
`vi.mock` de `@/lib/auth/can` y `next/cache` son de módulo y alcanzan a `action-guard.ts`).

**P0-2. Puertas baratas** (sobre el checkout principal; no son E2E):
`npm run typecheck` y `npm run test:fast -- "app/(app)/prevencion/miper/actions.test.ts"`.

**P0-3. Commit** `refactor(miper): la frontera de las Server Functions de la MIPER en action-guard.ts, para acciones en archivos propios`
(+ opcional, en otro commit, este plan: `docs(miper): plan integral del resto de la MIPER en paralelo`).

**P0-4. Worktrees.** Uno por stream desde ese commit:

```bash
cd /home/allopze/dev/chome/bodega
BASE=$(git rev-parse HEAD)
mkdir -p /home/allopze/dev/chome/bodega-wt
for n in 1 2 3 4 5 6 7; do git worktree add -b "miper-resto/s$n" "/home/allopze/dev/chome/bodega-wt/s$n" "$BASE"; done
```

(O el `isolation: "worktree"` del Agent, si se prefiere; entonces anotar la rama de cada uno.) Los
streams no necesitan `node_modules` porque no corren puertas.

---

<!-- BEGIN:contracts -->
## Contratos entre streams (nombres y firmas exactos)

Un stream que **consume** una interfaz la usa tal cual, aunque el archivo aún no exista en su worktree.
Un stream que la **provee** no la cambia; si no puede cumplirla, lo dice en la primera línea de su
reporte.

### C0 — Fase 0 (ya en la base)
`app/(app)/prevencion/miper/action-guard.ts`: `MIPER_BASE`, `type MiperSession`,
`accessFrom(session): MiperAccess`, `matrixIdOf(input): string | null`,
`stringFieldOf(input, key): string | null`, `fail(error): ActionState`,
`guarded<T>(permission, input, operation, options?: { revalidate?: boolean; data?: (r: T) => Record<string, unknown>; success?: string | ((r: T) => string); after?: (s: MiperSession) => Promise<void> }): Promise<ActionState>`.
`guarded` revalida `/prevencion/miper` y `/prevencion/miper/<matrixId>` leyendo `matrixId` **del input
crudo** (Zod lo descarta después): por eso toda acción de programa la envía con `matrixId`.

### C1 — S1 provee (Fase D Tasks 5–7; detalle en el plan D)
- `app/(app)/prevencion/miper/actions.ts`:
  - `bulkPatchMiperEntriesAction(input: unknown): Promise<ActionState>` →
    `{ ok: true, message, data: { entries: Array<{ id: string; version: number }> } }`;
  - `bulkAddMiperControlAction(input: unknown)` → `{ ok: true, message, data: { created: number } }`;
  - `bulkUpdateMiperControlsAction(input: unknown)` → `{ ok: true, message, data: { updated: number } }`.
  - Mensajes: con N > 0, `countOf(N, "riesgo actualizado", "riesgos actualizados")`,
    `` `Medida agregada a ${countOf(N, "riesgo", "riesgos")}` `` y
    `countOf(N, "medida actualizada", "medidas actualizadas")`. **Con 0 escritos** (el servicio salta lo
    que ya estaba así): `«No había nada que cambiar en los riesgos seleccionados.»` y
    `«No había nada que cambiar en las medidas elegidas.»` (`ok: true`, `data` con lista vacía / `0`).
- `use-row-saver.ts`: `useRowSaver(...)` devuelve además `whenIdle(entryIds: readonly string[]): Promise<void>`.
- `use-entry-autosave.ts`: `type AutosaveSync = { versionOf(entryId: string): number | undefined; whenIdle(entryIds: readonly string[]): Promise<void>; acknowledge(versions: Readonly<Record<string, number>>): void }`;
  `useEntryAutosave(...)` devuelve `EntryAutosave & AutosaveSync`.
- `use-risk-selection.ts`: `useRiskSelection(visible: readonly MiperEntrySnapshot[])` →
  `{ selecting; selected; isSelected(id); toggle(id); selectAll(); clear(); start(); stop() }`;
  `type RiskSelection = ReturnType<typeof useRiskSelection>`.
- `control-fields.tsx`: `type ControlDraft`, `draftOf`, `valuesOf`, `isDraftReady`, `KEEP_RESPONSIBLE`,
  `KIND_OPTIONS`, `HIERARCHY_OPTIONS`, `ResponsibleField`, `ControlFields` (firmas del plan D, Task 7).

### C2 — S2 provee (Fase D Tasks 8–10)
- `bulk-shared.tsx`: `type BulkContext = { matrixId; sync: AutosaveSync; setRows; riskFactors; responsibleOptions; measureSuggestions; dictionaries; controlVersions }`
  (forma exacta del plan D, Task 8), `type EntryItem`, `MISSING_VERSION`, `entryItems`,
  `settlePatchedEntries`, `BulkDialog`.
- `TaskView` gana `bulk?: BulkContext`; `MatrixView` gana `bulk?: BulkContext`; `ActivitySection` gana
  `selection?: RiskSelection | null`; `SelectableRiskRow` en `risk-row.tsx`.
- **No** toca `miper-workspace.tsx` ni su prueba: el reparto de `bulk` lo hace la integración (W2).

### C3 — S3 provee (servidor del programa y evidencia)
- `lib/services/miper/program-queries.ts`:
  - `ProgramActionView` gana `processId: string | null`.
  - `ProgramWorkspace` gana `processes: Array<{ id: string; name: string }>` (procesos **activos** de la
    faena de la MIPER, por nombre; también sin programa).
  - `getProgramWorkspace(matrixId: string, access: MiperAccess): Promise<ProgramWorkspace>` — firma igual.
  - Tipos nuevos:
    ```ts
    export type ProgramEvidenceView = {
      id: string; evidenceUploadId: string; fileName: string; description: string | null
      uploadedAt: string; uploadedByName: string | null
      withdrawnAt: string | null; withdrawReason: string | null
      mimeType: string | null; inlineSafe: boolean
    }
    export type ProgramRecordView = {
      id: string; outcome: "done" | "not_done"; effectiveOn: string | null; late: boolean
      reason: string | null; notes: string | null; recordedAt: string; recordedByName: string | null
      voidedAt: string | null; voidReason: string | null; voidedByName: string | null
      evidence: ProgramEvidenceView[]
    }
    export type ProgramOccurrenceDetail = { occurrenceId: string; currentRecordId: string | null; records: ProgramRecordView[] }
    export type ProgramActionDetail = { actionId: string; occurrences: ProgramOccurrenceDetail[] }
    export async function getProgramActionDetail(actionId: string, access: MiperAccess): Promise<ProgramActionDetail>
    ```
- `app/(app)/prevencion/miper/[id]/program-actions.ts` (`"use server"`):
  `loadProgramActionDetailAction(input: { matrixId: string; actionId: string }): Promise<ActionState>` →
  `{ ok: true, data: ProgramActionDetail }`; permiso `prevention:risk:view`; `revalidate: false`.
- `lib/validation/prevention-module/miper.ts`: `programHeaderSchema` =
  `{ matrixId, expectedVersion, elaboratedOn: isoDate.nullable(), programManagerUserId: id.nullable() }`.
  `saveProgramHeaderAction` (en `actions.ts`) no cambia de nombre. Sin programa, el cliente manda
  `expectedVersion: 1` y el servicio lo crea (`ensureProgram`) y guarda.
- `lib/prevention/miper/evidence-url.ts` (puro, usable en cliente):
  `MIPER_EVIDENCE_PATH_PREFIX = "storage/miper-evidence/"`;
  `miperEvidenceHref(evidenceUploadId: string, options?: { download?: boolean }): string | null` →
  `/api/prevencion/miper/evidence/<nombre>` (+ `?descargar=1`); `null` si la ruta no es de MIPER.
- Ruta `GET /api/prevencion/miper/evidence/[name]` (comportamiento en S3).
- `lib/services/miper/program-links.ts`:
  `activeProgramControlLinks(client: Client, matrixIds: readonly string[]): Promise<Array<{ matrixId: string; controlId: string; actionId: string; actionNumber: number; description: string }>>`
  (sólo actividades `active`, por `actionNumber`). Lo adoptan `program-execution.ts` y `portfolio.ts`
  (S3) y `queries.ts` (S6).
- `getProgramProgress` **deja de existir**.

### C4 — S4 provee (armazón del programa y del espacio de trabajo)
- `MiperWorkspaceView` props: `{ workspace; history: HistoryPanelProps["history"]; mode; userId; program: ProgramWorkspace }`
  (`programProgress` desaparece; el Resumen recibe `program.progress`).
- `lib/prevention/miper/workspace-url.ts`: `WorkspaceView` gana `activityId: string | null`; prioridad
  **`fila` > `actividad` > `tarea`** > `tab`; con `actividad` la pestaña es `programa`;
  `hrefToActivity(pathname, params, actionId): string`; `CLEAR_VIEW` incluye `actividad`, así que
  `hrefToTab`, `hrefToEntry`, `hrefToTask`, `hrefToProgramOnly` y `hrefToMatrixOnly` la limpian.
- `[id]/use-workspace-filter-navigation.ts`:
  `useWorkspaceFilterNavigation<K extends string>(keys: readonly K[]): { setFilter(key: K, value: string | null): void; setFilters(patch: Partial<Record<K, string | null>>): void; clearFilters(): void }`.
  `useMatrixFilterNavigation()` (en `matrix-filters-bar.tsx`) pasa a ser
  `useWorkspaceFilterNavigation(MATRIX_FILTER_KEYS)`.
- `ProgramPanel` props: `{ matrixId; mode; userId; users; program: ProgramWorkspace; rows: readonly MiperEntrySnapshot[]; header: MiperSnapshot["header"]; activityId: string | null }`.

### C5 — S5 provee (detalle de una actividad)
- `[id]/program-activity-view.tsx`:
  `ProgramActivityView({ matrixId, programId, action, mode, userId, users, rows, processes }: { matrixId: string; programId: string; action: ProgramActionView; mode: WorkspaceMode; userId: string; users: Array<{ id: string; name: string }>; rows: readonly MiperEntrySnapshot[]; processes: Array<{ id: string; name: string }> })`.
- `[id]/link-measures-dialog.tsx`:
  `LinkMeasuresDialog({ matrixId, programId, action, rows, open, onOpenChange })`.
- `[id]/occurrence-dialog.tsx`: `OccurrenceDialog` conserva sus props actuales (puede sumar sólo
  props **opcionales**, p. ej. `matrixId?: string`). S4 la usa desde la tarjeta.
- `[id]/program-badges.ts` (nuevo; se **mueven** desde `program-panel.tsx` sin cambios):
  `occurrenceBadge(occurrence: ProgramOccurrenceView, today: string): StateMetaInput` y
  `recordBadge(record: { outcome: string; voidedAt: string | null }): StateMetaInput`. S4 los importa
  y borra sus copias locales.
- `SCHEDULE_KIND_LABEL`, `PROGRAM_SCHEDULE_OPTIONS`, `ProgramActionDialog` y `RetireActionDialog`
  siguen exportados desde `program-action-dialog.tsx` (S4) con los mismos nombres.

### C6 — S6 provee (revisión, historial, controles)
- `lib/services/miper/queries.ts`:
  `MIPER_HISTORY_PAGE_SIZE = 50`;
  `type MiperHistoryPage = { events: MiperHistoryEvent[]; nextCursor: string | null }`;
  `getMiperHistory(matrixId: string, access: MiperAccess, options?: { cursor?: string | null }): Promise<MiperHistoryPage>`.
- `[id]/history-actions.ts` (`"use server"`):
  `loadMiperHistoryPageAction(input: { matrixId: string; cursor: string }): Promise<ActionState>` →
  `{ ok: true, data: MiperHistoryPage }`.
- `[id]/history-panel.tsx`: `HistoryPanelProps = { workspace: MiperWorkspace; history: MiperHistoryPage }`.
- `[id]/review-panel.tsx`: `ReviewPanelProps = { workspace; mode; onOpenEntry; rows: readonly MiperEntrySnapshot[]; observed: ReadonlySet<string>; modified: ReadonlySet<string>; hasBaseline: boolean }`.
- `lib/prevention/miper/entry-navigation.ts`:
  `nextInScopeId(rows: readonly MiperEntrySnapshot[], currentId: string, scope: ReadonlySet<string>): string | null`.

### C7 — Nombres de la UI (los usa S7 en las E2E; S4/S5/S6 los cumplen al pie de la letra)

| Dónde | Rol y nombre accesible |
|---|---|
| Lista del programa (S4) | cada actividad: `article` nombrado por su `h2` **«Actividad N° {n}»**; enlace **«Abrir el detalle de la actividad N° {n}»**; botón **«Registrar la ocurrencia del {dd-mm-aaaa}»** (próxima pendiente, si se puede ejecutar); botones **«Editar la actividad N° {n}»** y **«Retirar la actividad N° {n}»** (quien edita, actividad activa) |
| Filtros del programa (S4) | campo **«Buscar actividad del programa»**; `combobox` **«Filtrar por estado de la actividad»** y **«Filtrar por frecuencia de la actividad»**; botón **«Limpiar filtros»** |
| Encabezado del programa (S4) | botón **«Editar antecedentes»** / vacío **«Completar antecedentes»**; diálogo **«Antecedentes del Programa de Trabajo»** con `DatePicker` **«Fecha de elaboración del programa»**, `combobox` **«Encargado del programa»** y botón **«Guardar antecedentes»**; nada más |
| Detalle (S5) | `region` (section con `aria-labelledby`) **«Actividad N° {n}»** (`h2`); enlace **«Volver al programa»**; enlaces **«Ver la fila {rowNumber} en la MIPER»**; botón **«Vincular medidas»** → diálogo **«Medidas de la actividad N° {n}»** con casillas **«Fila {rowNumber}: {descripción}»** y botón **«Guardar vínculos»**; por ocurrencia: **«Registrar la ocurrencia del {fecha}»** (→ diálogo con ese mismo nombre) y **«Ver la evidencia de la ocurrencia del {fecha}»** (→ diálogo **«Evidencia de la ocurrencia»**); por registro: botón **«Anular el registro del {fecha}»** y la marca **«Anulado»** |
| Evidencia (S5) | enlaces **«Abrir {archivo}»** (sólo PDF/imagen) y **«Descargar {archivo}»**; botón **«Retirar la evidencia {archivo}»**; marca **«Retirada»** |
| Revisión (S6) | `region` **«Recorrer la MIPER»** con enlaces **«Importantes e Intolerables ({n})»**, **«Modificados ({n})»** (sólo con línea base) y **«Observados ({n})»**; en cero, texto sin enlace |
| Editor, sin edición y con filtro (S6) | enlace **«Siguiente del filtro»**; si no hay otro: texto «No hay otros riesgos en este filtro.» |
| Observación con riesgo (S6) | enlace con el texto del riesgo (`observation.entryLabel`) que abre `?fila=<id>&paso=seguimiento` |
| Historial (S6) | lista bajo el `h2` «Bitácora»; botón **«Cargar más»**; estado `aria-live="polite"` «Mostrando {n} eventos» |
| `controles/[id]` (S6) | `<p>` «Peligro: {peligro}» y `RiskClassificationBadge` («Importante · MR 8»); migas «Prevención › MIPER › {faena} {período} › Riesgo #{n} › {medida}» |

### C8 — Siembra E2E (S7)
- Usuario **`miper.lectura@e2e.chome.cl`** (`user-miper-lectura-e2e`, contraseña de siempre), rol
  `rol-miper-lectura-e2e` (`miper_lectura`, global) con **sólo** `p-prev-risk-view`.
- `riskmatrix-masivas-e2e` (2040, Faena Restringida) del plan D, Task 11.
- `riskmatrix-revision-e2e` (2041, Faena Restringida): borrador completo, listo para «Enviar a revisión».
- 60 filas de bitácora sembradas sobre `riskmatrix-reemplazada-e2e` (para «Cargar más»).
<!-- END:contracts -->

---

<!-- BEGIN:s1 -->
## S1 — Fase D núcleo: acciones de servidor, versiones del cliente y `ControlFields` (Tasks 5, 6 y 7)

**Objetivo.** Ejecutar las Tasks 5, 6 y 7 del plan D tal como están escritas (su texto va embebido al
final de este brief), con un agregado en la Task 5.

**Propios:** `app/(app)/prevencion/miper/actions.ts`, `actions.test.ts`; `[id]/use-row-saver.ts`(+test),
`[id]/use-entry-autosave.ts`(+test), `[id]/use-risk-selection.ts`(+test), `[id]/control-fields.tsx`(+test),
`[id]/control-form.tsx`.

**No tocar:** `action-guard.ts` (Fase 0), `bulk.ts`, `entries.ts`, todo lo de S2–S7. En `actions.ts`
**no** borres ni cambies `loadProgramWorkspaceAction` / `loadOccurrenceDetailAction` (los retira la
integración, W1).

**Provee:** C1. **Consume:** C0 (`guarded` ya viene de `./action-guard`; el texto de la Task 5 que dice
`guarded` sigue valiendo igual); `bulkPatchMiperEntries`, `bulkAddMiperControl`,
`bulkUpdateMiperControls` de `lib/services/miper/bulk.ts` **tal como están en la base** (léelo antes:
los tipos de resultado cambiaron en `b97ec7f9`).

**Agregado a la Task 5 (ronda de arreglos de la Task 4).** El servicio ya no escribe los elementos sin
cambio efectivo, así que el resultado cuenta sólo lo escrito:
- `bulkPatchMiperEntriesAction`: `success: (r) => r.entries.length === 0 ? "No había nada que cambiar en los riesgos seleccionados." : countOf(r.entries.length, "riesgo actualizado", "riesgos actualizados")`.
- `bulkUpdateMiperControlsAction`: lo mismo con `r.controls.length` y
  «No había nada que cambiar en las medidas elegidas.».
- `bulkAddMiperControlAction` no cambia (siempre crea en todos).
- Pruebas nuevas en `actions.test.ts`:
  - «el lote de riesgos sin nada que cambiar avisa en vez de decir 0» → servicio
    `{ entries: [] }` ⇒ `{ ok: true, message: "No había nada que cambiar en los riesgos seleccionados.", data: { entries: [] } }`;
  - «el lote de medidas sin nada que cambiar avisa en vez de decir 0» → `{ controls: [] }` ⇒
    `{ ok: true, message: "No había nada que cambiar en las medidas elegidas.", data: { updated: 0 } }`.

**Desvíos sobre el texto embebido:**
- Saltar todos los pasos «Run tests…» y «Puertas»: no se corre nada. Los pasos de código y de pruebas sí.
- Pie de commit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Los números de línea son de `1143bf50`: ubica cada reemplazo por su texto.

**Commits:** los asuntos del paso final de cada Task (5, 6, 7), uno por Task.
<!-- END:s1 -->

<!-- BEGIN:s2 -->
## S2 — Fase D UI: barra y diálogos de lote, «Seleccionar», «Editar contexto» (Tasks 8, 9 y 10)

**Objetivo.** Ejecutar las Tasks 8, 9 y 10 del plan D tal como están escritas (texto embebido al final),
con estos ajustes.

**Propios:** `[id]/bulk-shared.tsx`, `[id]/bulk-dialogs.tsx`, `[id]/bulk-bar.tsx`, `[id]/bulk-bar.test.tsx`,
`[id]/risk-row.tsx`, `[id]/task-view.tsx`(+test), `[id]/activity-section.tsx`, `[id]/matrix-view.tsx`(+test),
`[id]/task-context-dialog.tsx`(+test).

**No tocar:** `[id]/miper-workspace.tsx` y `[id]/miper-workspace.test.tsx` (son de S4). En la Task 9,
**omite** el Step 6 entero y las ediciones de `miper-workspace.test.tsx` del Step 1: los aplica la
integración (W2). Nada de S1 (`actions.ts`, hooks, `control-fields.tsx`, `control-form.tsx`).

**Provee:** C2. **Consume:** C1 completo (S1 lo escribe en paralelo: impórtalo con esos nombres aunque
no exista todavía en tu worktree), `newlyIncomplete`, `withAddedControl`, `withControlPatch`,
`impactSummary`, `type ControlPatch` (`lib/prevention/miper/bulk-impact.ts`, ya en la base),
`MIPER_BULK_LIMIT` (`lib/validation/prevention-module/miper.ts`, ya en la base), `applyEntryValues`
(`lib/prevention/miper/entry-values.ts`), `taskKeyOf`, `hrefToTask`, `navigateWorkspace`.

**Agregado a la Task 8 (resultado con cero escritos, ver C1):**
- `settlePatchedEntries` ya anota y aplica sólo los ids devueltos: no cambia. Un lote con
  `data.entries` vacío cierra el diálogo, termina la selección y avisa con el `message` del servidor.
- En los tres diálogos, si el resultado escribió 0 (`data.entries.length === 0` o `data.updated === 0`),
  avisar con `toast.info(result.message)` en vez de `toast.success`.
- Prueba nueva en `bulk-bar.test.tsx`: «"Cambiar ¿controlado?" sin nada que cambiar avisa con info y
  cierra» → mock `{ ok: true, message: "No había nada que cambiar en los riesgos seleccionados.", data: { entries: [] } }`;
  espera `toast.info` con ese texto, `sync.acknowledge` con `{}`, el diálogo cerrado y `onClear` llamado.

**Desvíos sobre el texto embebido:** sin pasos «Run tests» ni «Puertas»; pie Sonnet 5.5; números de
línea de `1143bf50` (ubicar por texto).

**Commits:** los asuntos del paso final de las Tasks 8, 9 y 10.
<!-- END:s2 -->

<!-- BEGIN:s3 -->
## S3 — Fase E servidor: programa en una lectura, detalle de una actividad, encabezado acotado, Excel RE-04.1 y descarga de evidencia

**Objetivo.** Todo lo de servidor de la Fase E del programa, más la ruta de evidencia.

**Propios:** `lib/services/miper/program-queries.ts`, `program-execution.ts`, `program.ts`,
`portfolio.ts`, `program-links.ts` (nuevo), `evidence-access.ts` (nuevo);
`lib/prevention/miper/evidence-url.ts` (+ `evidence-url.test.ts`);
`lib/validation/prevention-module/miper.ts` (+ su test); `lib/reports/miper-workbook.ts`
(+ `miper-workbook.test.ts`); `app/api/prevencion/miper/evidence/[name]/route.ts` (+ `route.test.ts`);
`app/(app)/prevencion/miper/[id]/program-actions.ts` (+ `program-actions.test.ts`); suites PGlite
`lib/__tests__/miper-program-queries.test.ts`, `miper-program.test.ts`, `miper-program-execution.test.ts`,
`miper-program-occurrences.test.ts` (todas ya registradas en `tests/pglite-files.ts`).

**No tocar:** `actions.ts` (S1), `queries.ts` (S6), `[id]/page.tsx` y todo componente (S4/S5),
`tests/pglite-files.ts`, `e2e/**`.

**Provee:** C3. **Consume:** C0.

### S3.1 Lectura del programa para la página
- `ProgramActionView.processId` (de `preventionRiskProgramActions.processId`).
- `ProgramWorkspace.processes`: `select id, name from prevention_risk_processes where worksite_id = <faena de la matriz> and is_active order by name` (la consulta que hoy hace `loadProgramWorkspaceAction` en `actions.ts:215-247`, que la integración borra). Se devuelve también cuando no hay programa.
- La autorización no cambia: `requireAccess(access, VIEW)` + `scopeAllows` antes de todo, y
  `RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")` fuera de alcance. La página la llama
  en paralelo con `getMiperWorkspace` (S4): por eso tiene que autorizar sola.

### S3.2 Retirar `getProgramProgress`
- Borrarlo de `program-execution.ts` (y `loadProgramByMatrix` si queda sin uso).
- `miper-program-occurrences.test.ts:149-154` y `miper-program-execution.test.ts:111`: afirmar el mismo
  avance con `(await getProgramWorkspace(matrixId, access)).progress` (y `actions[i].progress` para el
  avance por actividad). Mismos números que hoy.

### S3.3 `getProgramActionDetail(actionId, access)` — una sola llamada por actividad
- `requireAccess(access, VIEW)`. Contexto: actividad → programa (`worksiteId`); si no existe o
  `!scopeAllows(access.scope, program.worksiteId)` → `RiskLegalDomainError(OUT_OF_SCOPE)` (mismo error
  para «no existe» y «fuera de alcance», como `actions.ts:249`).
- Cuatro lecturas, ninguna por ocurrencia: ocurrencias de la actividad (por `dueOn`); registros
  `inArray(occurrenceId, …)` por `recordedAt desc`; evidencia `inArray(recordId, …)` por `uploadedAt`
  con `leftJoin prevention_evidence_uploads on path = evidence_upload_id and domain = 'miper'` para
  `mimeType`; `userNames(...)` de una vez.
- `fileName` = último segmento de `evidenceUploadId`; `inlineSafe = isInlineSafeMime(mimeType)`
  (`lib/security/file-response.ts`).
- La evidencia retirada y los registros anulados **se devuelven** (la UI los marca).

### S3.4 `program-actions.ts`
```ts
"use server"
import { getProgramActionDetail } from "@/lib/services/miper/program-queries"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { OUT_OF_SCOPE } from "@/lib/services/miper/shared"
import { guarded, stringFieldOf } from "../action-guard"

export async function loadProgramActionDetailAction(input: unknown) {
  return guarded("prevention:risk:view", input, (access) => {
    const actionId = stringFieldOf(input, "actionId")
    if (!actionId) throw new RiskLegalDomainError(OUT_OF_SCOPE)
    return getProgramActionDetail(actionId, access)
  }, { revalidate: false, data: (detail) => ({ ...detail }) })
}
```
Prueba `program-actions.test.ts` (mismo patrón de mocks que `actions.test.ts`): «sin permiso no llama
al servicio»; «sin actionId responde el error de alcance»; «devuelve el detalle en data»; «un
RiskLegalDomainError llega con su mensaje».

### S3.5 Encabezado acotado y «Completar antecedentes» con el programa vacío
- `programHeaderSchema` = `z.object({ matrixId: id, expectedVersion: version, elaboratedOn: isoDate.nullable(), programManagerUserId: id.nullable() })` (se va el `superRefine` de dotación). `ProgramHeaderInput` sigue derivado.
- `updateProgramHeader`: igual (ya llama a `ensureProgram`); `assertActiveUsers(tx, [data.programManagerUserId])`; `fields` = sólo las dos columnas.
- Pruebas:
  - validación: «el encabezado del programa sólo acepta fecha y encargado» (llaves de empresa y dotación se descartan: `parse` devuelve sólo las cuatro llaves);
  - PGlite `miper-program.test.ts`: «sin programa, guardar el encabezado con expectedVersion 1 lo crea y guarda fecha y encargado» (programa existe, `version === 2`, `programManagerUserId` y `elaboratedOn` guardados, una fila `program_header_updated`); «el encabezado no cambia los datos de empresa del programa aunque el input los traiga».

### S3.6 Hoja RE-04.1 del Excel
En `addProgramSheet` (`lib/reports/miper-workbook.ts`), los datos de empresa salen **sólo** del
encabezado de la foto que se exporta (`snapshot.header`: la viva en modo vivo, la sellada en sellado):
RAZÓN SOCIAL, RUT EMPLEADOR, DIRECCIÓN / COMUNA y REPRESENTANTE. Fecha de elaboración y encargado siguen
saliendo del programa (con la foto de respaldo para la fecha). Pruebas en `miper-workbook.test.ts`:
«en sellado, la hoja RE-04.1 toma la empresa de la foto sellada aunque el programa diga otra» y «en
vivo, la toma del encabezado vivo».

### S3.7 Un solo criterio de «medida vinculada a una actividad activa»
`program-links.ts` con `activeProgramControlLinks` (C3). `programLinkedControlIds` (`program-execution.ts`)
y `programLinkedControlIdsByMatrix` (`portfolio.ts`) pasan a usarlo. `queries.ts` lo adopta S6. Las
pruebas existentes de envío (Intolerable sin vínculo) y de portada cubren el comportamiento: no cambian.

### S3.8 Descarga de evidencia
`lib/services/miper/evidence-access.ts`:
```ts
export type MiperEvidenceFile = { storedPath: string; mimeType: string | null; withdrawnAt: string | null; recordVoidedAt: string | null }
/** null = no existe como evidencia de un registro, o está fuera del alcance. */
export async function findMiperEvidenceForDownload(client: Client, storedPath: string, scope: WorksiteScope): Promise<MiperEvidenceFile | null>
```
Cadena **evidencia → registro → ocurrencia → actividad → programa** (`innerJoin` en cada paso),
`leftJoin prevention_evidence_uploads (path = evidence_upload_id, domain = 'miper')`, `where
evidence_upload_id = storedPath` y, si `scope.mode !== "all"`, `inArray(programs.worksiteId, scope.ids)`;
`scope.mode === "none"` → `null` sin consultar. **Sin** filtro por retirada ni por anulado.

`app/api/prevencion/miper/evidence/[name]/route.ts` (patrón de `app/api/prevencion/higiene/evidence/[name]/route.ts`):
```ts
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  const { name } = await params
  const storedPath = `${MIPER_EVIDENCE_PATH_PREFIX}${name}`
  const absolutePath = resolveMiperEvidenceFile(storedPath)          // rechaza traversal y nombres inseguros
  if (!absolutePath) return NextResponse.json({ error: "Ruta inválida" }, { status: 400 })
  try {
    const found = await findMiperEvidenceForDownload(db, storedPath, resolveWorksiteScope(session))
    if (!found) return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    const mime = found.mimeType ?? "application/octet-stream"
    const disposition = fileDisposition(mime, new URL(request.url).searchParams.get("descargar") === "1")
    const buffer = await fs.readFile(absolutePath)
    return new NextResponse(new Uint8Array(buffer), { status: 200, headers: {
      "Content-Type": mime,
      "Content-Disposition": encodeContentDisposition(name, disposition),
      "Cache-Control": "private, max-age=300",
      ...UNTRUSTED_FILE_HEADERS,
    } })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return NextResponse.json({ error: "Evidencia no encontrada" }, { status: 404 })
    logger.error("[prevencion/miper/evidence GET]", err)
    return NextResponse.json({ error: "Error al servir la evidencia" }, { status: 500 })
  }
}
```
Sin CSP propia (el proxy la reescribe, `lib/security/file-response.ts`): la defensa es `attachment`
para todo lo que no es PDF/imagen + `nosniff`. Sin permisos ni rutas nuevas en `modules/**`
(`prevention:risk:view` ya existe; es una descarga de datos de la pestaña Programa).

`lib/prevention/miper/evidence-url.ts`: `miperEvidenceHref` (C3), `encodeURIComponent` del nombre.

**Pruebas:**
- `route.test.ts` (patrón de mocks de `app/api/prevencion/miper/[id]/export/route.test.ts`; mockear
  `@/lib/services/miper/evidence-access`, `node:fs` y `@/db`): «401 sin sesión»; «403 sin
  prevention:risk:view»; «400 con un nombre con traversal»; «404 si la subida no es evidencia de un
  registro o está fuera de alcance» (`findMiperEvidenceForDownload` → `null`); «PDF inline con nosniff»
  (`content-disposition` empieza con `inline;`, `x-content-type-options: nosniff`, `content-type:
  application/pdf`); «?descargar=1 fuerza attachment»; «un Word va siempre como attachment»; «404 si el
  archivo no está en disco».
- PGlite en `miper-program-execution.test.ts` (sus fixtures ya registran ocurrencias con evidencia):
  «findMiperEvidenceForDownload: en alcance devuelve el MIME de la subida»; «de otra faena → null»;
  «una subida sin fila de evidencia → null»; «retirada y de registro anulado se sirven (withdrawnAt /
  recordVoidedAt)»; «alcance none → null».
- `evidence-url.test.ts`: href inline, `?descargar=1`, `null` para otra carpeta, nombre con espacios
  codificado.
- PGlite en `miper-program-queries.test.ts`: «getProgramActionDetail trae todas las ocurrencias con sus
  registros y evidencia en una lectura» (3 ocurrencias, una con registro anulado y evidencia retirada:
  aparecen marcados; `mimeType` y `inlineSafe`); «fuera de alcance y actividad inexistente dan el mismo
  error»; «sin prevention:risk:view, rechaza»; «getProgramWorkspace trae processes y processId».

**Commits (en este orden):**
1. `refactor(miper): un solo criterio de medida vinculada a una actividad activa y el avance sale de la lectura del programa`
2. `feat(miper): el programa se lee en una sola consulta con procesos y el detalle de una actividad en una sola llamada`
3. `feat(miper): el encabezado del programa sólo guarda fecha y encargado, crea el programa si falta, y la hoja RE-04.1 toma la empresa de la foto exportada`
4. `feat(miper): descarga de la evidencia del programa con alcance por faena, attachment salvo PDF e imágenes y nosniff`
<!-- END:s3 -->

<!-- BEGIN:s4 -->
## S4 — Fase E cliente: el programa por props, tarjetas, filtros sin servidor, encabezado y `?actividad=`

**Objetivo.** La pestaña Programa se pinta desde props (cargadas por `page.tsx` en paralelo), como
tarjetas, con filtros en la URL sin ida al servidor, encabezado que toma la empresa de la ficha y la
vista `?actividad=` (cuyo contenido es de S5).

**Propios:** `[id]/page.tsx`, `[id]/miper-workspace.tsx`, `[id]/miper-workspace.test.tsx`,
`lib/prevention/miper/workspace-url.ts`(+test), `[id]/use-workspace-filter-navigation.ts` (nuevo, +test),
`[id]/matrix-filters-bar.tsx`(+test), `[id]/program-panel.tsx`, `[id]/program-panel.test.tsx` (nuevo),
`[id]/program-action-card.tsx` (nuevo), `[id]/program-action-dialog.tsx`,
`[id]/generate-actions-dialog.tsx`, `[id]/resumen-panel.tsx` (sólo si hace falta).

**No tocar:** `actions.ts`, todo archivo de S1/S2/S3/S5/S6, `e2e/**`. En `miper-workspace.tsx`
**no cambies** estas líneas, que la integración reemplaza por texto (W2): el bloque contiguo de imports
`import { TaskView } from "./task-view"` … `import { navigateWorkspace, WorkspaceLink } from "./workspace-nav"`;
la línea `useEffect(() => { knownVersionOf.current = autosave.versionOf }, …)` y las tres siguientes;
las líneas `const incomplete = …` y `const modified = …`; la línea `data={{ matrixId: … }} />` del
`RiskEditor` y el bloque `view.taskKey ? ( task ? <TaskView … /> : <EmptyState … /> )`; la línea
`<MatrixView … />` y sus tres líneas de handlers previas. Tampoco cambies el `<ReviewPanel …/>` ni el
`<HistoryPanel …/>` (W3). En `miper-workspace.test.tsx` no cambies el bloque `vi.mock("../actions", …)`
ni el último `it(...)` del archivo.

**Provee:** C4 y los nombres C7 de lista, filtros y encabezado. **Consume:** C3 (`ProgramWorkspace`,
`processId`, `processes`, `programHeaderSchema` acotado), C5 (`ProgramActivityView`, `OccurrenceDialog`,
`occurrenceBadge`/`recordBadge` de `./program-badges`),
C6 (`HistoryPanelProps`), `getProgramWorkspace`.

### S4.1 `page.tsx`
```ts
let program: ProgramWorkspace
try {
  ;[workspace, history, program] = await Promise.all([
    getMiperWorkspace(id, access), getMiperHistory(id, access), getProgramWorkspace(id, access),
  ])
} catch (error) {
  if (error instanceof RiskLegalDomainError) notFound()
  throw error
}
```
Las tres autorizan solas (`requireAccess` + `scopeAllows`), por eso pueden ir en paralelo. Se van
`getProgramProgress`, el import de `db` y el comentario de la Fase B. Pasa `program` a
`MiperWorkspaceView`.

### S4.2 `miper-workspace.tsx`
- Props según C4 (`history: HistoryPanelProps["history"]`, importando el tipo de `./history-panel`).
- `ResumenPanel … programProgress={program.progress}`.
- `<TabsContent value="programa">`: `<ProgramPanel matrixId mode userId users={workspace.responsibleOptions} program={program} rows={rows} header={source.header} activityId={view.activityId} />` (sale `onOpenRiskEntry`: el detalle usa enlaces).
- El `program` se lee **directo de props** en todo el árbol: ningún `useState` que lo copie (Atrás
  restaura payloads de renders anteriores; una copia quedaría vieja).

### S4.3 `workspace-url.ts`
C4. Código sutil de `readWorkspaceView`:
```ts
const entryId = params.get("fila") || null
const activityId = entryId ? null : params.get("actividad") || null
const taskKey = entryId || activityId ? null : params.get("tarea") || null
const tab: WorkspaceTab = entryId || taskKey ? "matriz" : activityId ? "programa"
  : (WORKSPACE_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as WorkspaceTab) : "matriz"
```
`CLEAR_VIEW = { tab: null, tarea: null, fila: null, paso: null, actividad: null }`;
`hrefToActivity = (p, q, id) => href(p, q, { ...CLEAR_VIEW, tab: "programa", actividad: id })`.
Pruebas (`workspace-url.test.ts`): «fila gana sobre actividad y actividad sobre tarea»; «con actividad
la pestaña es programa aunque diga otra»; «hrefToActivity limpia fila, tarea y paso y conserva los
filtros»; «hrefToTab, hrefToEntry y hrefToProgramOnly limpian actividad».

### S4.4 `useWorkspaceFilterNavigation(keys)`
Generaliza el cuerpo de `useMatrixFilterNavigation` (parte de `window.location.search`, aplica con
`navigateWorkspace(…, "replace")`), restringido a `keys`; `clearFilters()` borra sólo esas claves.
`matrix-filters-bar.tsx`: `export const useMatrixFilterNavigation = () => useWorkspaceFilterNavigation(MATRIX_FILTER_KEYS)`
(misma API que hoy). Pruebas: «setFilter sólo toca su clave y parte de la URL vigente»; «clearFilters
borra sólo sus claves»; «usa replace sin ida al servidor (navigateWorkspace)»; la prueba existente de
la barra sigue igual.

### S4.5 `program-panel.tsx` (reescrito) + `program-action-card.tsx`
- Sin `loadProgramWorkspaceAction`, sin `loadOccurrenceDetailAction`, sin `Sheet`, sin `details`, sin
  `load()`: todo sale de `program`. Tras guardar (actividad, generación, retiro, encabezado,
  registro), la acción revalida y llega un `program` nuevo; los `onSaved`/`onApplied` ya no recargan.
  Todo input de acción de programa lleva `matrixId` (revalidación explícita, C0).
- `activityId`: si existe la actividad → `<ProgramActivityView matrixId programId={program.program!.id} action={…} mode userId users rows processes={program.processes} />`;
  si no → `EmptyState` «Esta actividad ya no existe» con CTA `WorkspaceLink` «Volver al programa»
  (`hrefToTab(…, "programa")`, `restoreScroll`).
- Filtros: `useWorkspaceFilterNavigation(PROGRAM_FILTER_KEYS)`. La búsqueda es un `Input` propio
  rotulado (`Field label="Buscar actividad del programa"`), con espera de 300 ms como «Buscar en la
  matriz» (`matrix-filters-bar.tsx:54`); se va `FilterSearchInput` (hacía `router.replace`). Los dos
  `Select` y «Limpiar filtros» llaman a `setFilter`/`clearFilters`. Nunca `router.replace` aquí.
- Lista = tarjetas `ProgramActionCard` (patrón de `app/(app)/prevencion/pdtp/obligaciones/pdtp-obligations-workbench.tsx:150-160`):
  `<article aria-labelledby>` con `h2` «Actividad N° {n}», descripción, responsable, frecuencia
  (`SCHEDULE_KIND_LABEL`), **próxima ocurrencia** pendiente (la de menor `dueOn` con `outcome === "pending"`)
  y su vencimiento con `MetaBadge` (`occurrenceBadge` de `./program-badges`, C5), barra de avance
  (`ActionProgress`), y CTA «Registrar la ocurrencia del {fecha}» que abre `OccurrenceDialog`, con la
  misma condición que hoy usa el `Sheet` (`program-panel.tsx` ~l. 454):
  `canExecuteProgramAction(mode, { userId, responsibleUserId: action.responsibleUserId }) && action.status === "active" && occurrence.outcome !== "superseded"`.
  «Abrir el detalle…» es un `WorkspaceLink` a `hrefToActivity` (push).
  «Editar…» y «Retirar…» como hoy. Actividad retirada: marca «Retirada» + motivo, sin CTA.
- Encabezado (`ProgramHeader`): empresa, RUT, dirección, comuna y representante salen de `header`
  (la ficha, sólo lectura) con un enlace «Editar en la ficha» (`hrefToFicha`, sólo quien edita); del
  programa: período, fecha de elaboración, N° de centros, última revisión, encargado y avance.
- `ProgramHeaderDialog`: sólo `DatePicker` «Fecha de elaboración del programa» y `OptionSelect`
  «Encargado del programa» (usuarios) + «Guardar antecedentes». Envía
  `{ matrixId, expectedVersion: program?.version ?? 1, elaboratedOn, programManagerUserId }`. Se van los
  campos de empresa, dotación, representante y el campo mal rotulado. Abre también desde «Completar
  antecedentes» con `program === null`.
- `program-action-dialog.tsx`: el proceso actual sale de `action.processId` (sale `actionProcessIds`);
  `RetireActionDialog` manda `matrixId`. `generate-actions-dialog.tsx`: sin `load()`.

### S4.6 Pruebas
- `program-panel.test.tsx` (nuevo; mockear `./program-activity-view` con un doble que pinte
  «detalle {action.id}», `../actions` y `./program-actions`):
  - «pinta las tarjetas desde props sin llamar a ninguna acción al montar»;
  - «cada actividad es un article con h2 Actividad N° n y el enlace al detalle apunta a ?actividad=»;
  - «la búsqueda y los filtros cambian la URL con replace y sin servidor» (espía en `navigateWorkspace`);
  - «con actividad en la URL muestra el detalle; con una inexistente, el vacío con Volver al programa»;
  - «el encabezado muestra la empresa de la ficha y el diálogo sólo pide fecha y encargado»;
  - «Completar antecedentes sin programa envía expectedVersion 1».
- `miper-workspace.test.tsx`: los fixtures pasan `program` (un `ProgramWorkspace` mínimo); agregar
  `vi.mock("./program-activity-view", …)` y `vi.mock("./program-actions", …)`;
  «el Resumen muestra el avance de program.progress»; «con ?actividad= la pestaña activa es Programa».
  (El fixture de `history` lo cambia la integración, W3.)

**Commits:**
1. `feat(miper): la vista de una actividad en la URL (?actividad=) con prioridad fila > actividad > tarea, y filtros del espacio de trabajo generalizados`
2. `feat(miper): el programa se carga con la página y se lee de props, en tarjetas con próxima ocurrencia y filtros sin ida al servidor`
3. `fix(miper): el encabezado del programa toma la empresa de la ficha y su diálogo sólo pide fecha y encargado; «Completar antecedentes» crea el programa`
<!-- END:s4 -->

<!-- BEGIN:s5 -->
## S5 — Fase E cliente: el detalle de una actividad (`?actividad=`), evidencia y vínculos

**Objetivo.** Reemplazar el `Sheet` apilado del detalle por una vista que hace **una** llamada, abre un
solo diálogo por ocurrencia, deja abrir/descargar la evidencia (marcando retirada y anulado) y vincular
o desvincular medidas.

**Propios:** `[id]/program-activity-view.tsx` (nuevo) + `program-activity-view.test.tsx`,
`[id]/link-measures-dialog.tsx` (nuevo) + test, `[id]/evidence-sheet.tsx` + `evidence-sheet.test.tsx`
(nuevo), `[id]/occurrence-dialog.tsx`, `[id]/program-badges.ts` (nuevo) + `program-badges.test.ts`.

**No tocar:** `program-panel.tsx` (S4; tu worktree tiene la versión original: el `Sheet` de
`program-panel.tsx:372-560` es la fuente que portas), `actions.ts`, `e2e/**`.

**Provee:** C5 y los nombres C7 del detalle y de la evidencia. **Consume:** C3
(`loadProgramActionDetailAction`, tipos `ProgramActionDetail`/`ProgramRecordView`/`ProgramEvidenceView`,
`miperEvidenceHref`), C4 (`hrefToTab`, `hrefToEntry` ya existen), acciones existentes de `../actions`:
`recordOccurrenceAction`, `voidOccurrenceRecordAction`, `addOccurrenceEvidenceAction`,
`withdrawOccurrenceEvidenceAction`, `uploadProgramEvidenceAction`, `linkProgramControlsAction`.

### S5.1 `ProgramActivityView`
- `<section aria-labelledby>` con `h2` «Actividad N° {n}» (bajo el `PageHeader`, que es el `h1`).
  Enlace «‹ Volver al programa» = `WorkspaceLink` a `hrefToTab(pathname, params, "programa")` con
  `restoreScroll`.
- Ficha: proceso, responsable, centro de trabajo, frecuencia, inicio; retirada con su motivo.
- «Medidas del MIPER que ejecuta»: por medida, `WorkspaceLink` «Ver la fila {rowNumber} en la MIPER» a
  `hrefToEntry(pathname, params, entryId)`, con `entryId` derivado en el cliente de `rows`
  (`controlId → entryId`). Botón «Vincular medidas» (quien edita y actividad activa).
- Detalle: **una** llamada `loadProgramActionDetailAction({ matrixId, actionId })` al montar y otra tras
  cada escritura exitosa (registrar, anular, agregar o retirar evidencia). Esqueleto mientras carga;
  error en `Callout` `role="alert"` con «Reintentar». El estado del detalle se guarda junto con el
  `actionId` que lo pidió: una respuesta de otra actividad se descarta.
- Ocurrencias (por `dueOn`): fecha, `MetaBadge` del resultado vigente (rótulos de `occurrenceBadge`,
  nunca el enum), fecha efectiva; botones «Registrar la ocurrencia del {fecha}» (`OccurrenceDialog`) y
  «Ver la evidencia de la ocurrencia del {fecha}» (`EvidenceSheet`); registros con autor, fecha,
  resultado, motivo, y «Anulado» + motivo cuando corresponde; «Anular el registro del {fecha}» con
  `ConfirmDialog` (motivo ≥ 10 caracteres, como hoy). Todas las mutaciones con `useOperation` y
  `matrixId` en el input.

### S5.2 `EvidenceSheet` → diálogo «Evidencia de la ocurrencia»
- Ya no se apila sobre un `Sheet`: es un `Dialog` sobre la vista (conserva el nombre «Evidencia de la
  ocurrencia», la subida `EvidenceUploadField` y el retiro).
- Por archivo: «Abrir {archivo}» (`<a target="_blank" rel="noopener noreferrer" href={miperEvidenceHref(id)}>`,
  **sólo** si `inlineSafe`) y «Descargar {archivo}» (`href={miperEvidenceHref(id, { download: true })}`);
  la retirada lleva `Badge` «Retirada» + motivo y no ofrece retirar. El tipo `OccurrenceEvidenceView`
  pasa a ser `ProgramEvidenceView` (C3).

### S5.3 `LinkMeasuresDialog` «Medidas de la actividad N° {n}»
- Casillas por medida no retirada de `rows`, agrupadas por riesgo («Riesgo #{rowNumber}: {peligro}»),
  rotuladas «Fila {rowNumber}: {descripción}»; marcadas las de `action.controls`.
- «Guardar vínculos» (deshabilitado si nada cambió): lo agregado →
  `linkProgramControlsAction({ matrixId, programId, actionId, controlIds: agregados, link: true })`; lo
  quitado → la misma acción con `link: false` (una llamada por sentido; `programLinkSchema` ya admite
  `link: false`). Ayuda visible: «Quitar una medida no la borra del MIPER.» Error en `role="alert"`;
  el diálogo no se cierra mientras guarda.

### S5.4 `OccurrenceDialog` y `program-badges.ts`
- `OccurrenceDialog`: agrega `matrixId?: string` opcional y lo envía en sus acciones. Nada más cambia.
- `program-badges.ts`: copia exacta de `occurrenceBadge` y `recordBadge` de `program-panel.tsx:73-87`
  (S4 borra las suyas e importa éstas). Prueba `program-badges.test.ts`: «pendiente vencida = Vencida;
  hecha fuera de plazo = Fuera de plazo; reemplazada = Reemplazada; registro anulado = Anulado».

### S5.5 Pruebas
- `program-activity-view.test.tsx` (mock de `./program-actions`, `../actions`, `next/navigation`,
  `@/lib/toast`): «al montar hace una sola llamada aunque haya tres ocurrencias» (llamada única con
  `{ matrixId, actionId }`); «marca Anulado el registro anulado»; «Ver la fila n enlaza a ?fila= de su
  riesgo»; «Volver al programa apunta a tab=programa sin actividad»; «sin edición no ofrece Vincular
  medidas»; «tras registrar vuelve a pedir el detalle una vez»; «descarta la respuesta de otra actividad».
- `evidence-sheet.test.tsx`: «Abrir sólo para PDF e imágenes»; «Descargar lleva ?descargar=1»; «la
  retirada se marca Retirada y no ofrece retirar».
- `link-measures-dialog.test.tsx`: «marca las vinculadas»; «guarda agregadas con link true y quitadas
  con link false»; «sin cambios, Guardar vínculos deshabilitado».

**Commits:**
1. `feat(miper): el detalle de una actividad es una vista (?actividad=) que lee todo en una llamada y abre un solo diálogo por ocurrencia`
2. `feat(miper): la evidencia del programa se abre o descarga, marcada si está retirada o su registro anulado`
3. `feat(miper): vincular y desvincular medidas del MIPER desde el detalle de una actividad`
<!-- END:s5 -->

<!-- BEGIN:s6 -->
## S6 — Fase E: revisión, historial paginado y `controles/[id]`

**Objetivo.** El revisor recorre el editor con filtros rápidos y «Siguiente del filtro»; las
observaciones llevan al seguimiento del riesgo; la bitácora pagina por cursor; la ficha de un control
usa la clasificación RE-04 y migas completas.

**Propios:** `lib/services/miper/queries.ts`, `lib/__tests__/miper-queries.test.ts`,
`[id]/history-actions.ts` (nuevo, + `history-actions.test.ts`), `[id]/history-panel.tsx`
(+ `history-panel.test.tsx` nuevo), `[id]/review-panel.tsx` (+ `review-panel.test.tsx` nuevo),
`[id]/observation-item.tsx`, `[id]/risk-editor/risk-editor.tsx` (+ `risk-editor.test.tsx`),
`lib/prevention/miper/entry-navigation.ts` (+test), `lib/prevention/miper/review-walk.ts` (nuevo, +test),
`app/(app)/prevencion/miper/controles/[id]/page.tsx`.

**No tocar:** `miper-workspace.tsx` (S4; el cambio de props de `ReviewPanel` lo cablea la integración,
W3), `workspace-url.ts` (S4), `e2e/**` (S7), `program-*` (S3/S4/S5).

**Provee:** C6 y los nombres C7 de revisión, editor, observación, historial y controles. **Consume:** C0,
C3 (`activeProgramControlLinks`), `hrefToEntry`/`hrefToMatrixOnly` (ya existen), `filterRows`
(`grid-view.ts`), `parseMatrixFilters`.

### S6.1 Historial por cursor
- `getMiperHistory(matrixId, access, { cursor } = {})`: mismo filtro de entidad; orden
  `desc(createdAt), desc(id)`; trae `MIPER_HISTORY_PAGE_SIZE + 1` para saber si hay más. El cursor es
  `base64url(JSON.stringify([createdAt, id]))` del último evento devuelto; la página siguiente filtra
  ``sql`(${auditLog.createdAt}, ${auditLog.id}) < (${at}::timestamptz, ${id})` ``. Cursor ilegible
  (no decodifica, no es `[string, string]`) → `RiskLegalDomainError("No se pudo leer la página siguiente del historial; recarga la MIPER.")`.
  Autorización como hoy (`requireAccess` + `scopeAllows` antes de leer).
- `history-actions.ts`: `loadMiperHistoryPageAction` (C6) con `guarded("prevention:risk:view", …, { revalidate: false, data: (page) => ({ ...page }) })`, `matrixIdOf`/`stringFieldOf` de `../action-guard`.
- `HistoryPanel`: la primera página llega por props; «Cargar más» (`useOperation`) agrega páginas en
  estado local **atado a la `history` que extiende**: si llega otra `history` por props (revalidación),
  las páginas agregadas se descartan (ajuste de estado durante el render, guardando la `history`
  previa). `aria-live="polite"` «Mostrando {n} eventos». Sin `nextCursor`, no hay botón.
- `queries.ts` adopta `activeProgramControlLinks(db, [matrix.id])` para `controlActionLinks` (mismo
  orden y forma).
- Pruebas PGlite (`miper-queries.test.ts`, donde está `getMiperHistory` hoy, línea 81): «pagina de a 50
  sin repetir ni saltar, también con eventos del mismo instante» (120 eventos, 40 con el mismo
  `createdAt`: 50 + 50 + 20, ids únicos, `nextCursor` null al final); «un cursor ilegible se rechaza»;
  «fuera de alcance rechaza antes de leer». La aserción vieja de la línea 81 pasa a `.events`.
- `history-actions.test.ts`: sin permiso no llama; devuelve la página en `data`.
- `history-panel.test.tsx`: «Cargar más pide con el cursor y agrega»; «sin nextCursor no hay botón»;
  «una history nueva por props descarta las páginas agregadas».

### S6.2 Revisión: recorrer con filtros rápidos
- `review-walk.ts` (puro):
  `reviewQuickFilters(rows, { observed, modified, hasBaseline }): Array<{ key: "criticos" | "modificados" | "observados"; label: string; patch: Partial<Record<MatrixFilterKey, string>>; count: number; firstEntryId: string | null }>`
  con `criticos` = `{ clasificacion: "important,intolerable" }`, `modificados` = `{ marca: "modificados" }`
  (sólo si `hasBaseline`), `observados` = `{ marca: "observados" }`; `count`/`firstEntryId` calculados
  con `filterRows(rows, parseMatrixFilters(patch-como-params), { observed, modified, incomplete: new Set() })`
  en el orden de `rows`.
  `hrefToReviewWalk(pathname, params, patch, entryId): string` = `hrefToMatrixOnly(…, patch)` y luego
  `hrefToEntry` sobre esa URL: el editor abre el primero **con el filtro en la URL**, así `matching`
  (que ya arma el espacio de trabajo) es el filtro.
- `ReviewPanel` (props C6): `section aria-labelledby` «Recorrer la MIPER» antes de las observaciones,
  con un `WorkspaceLink` por filtro «{label} ({count})»; en cero, texto «Sin {label en minúscula}» (A4).
  Visible para todos los que ven la pestaña (es lectura).
- `risk-editor.tsx`: en el pie, si `!editable && matching` → «Siguiente del filtro»
  (`nextInScopeId(rows, entry.id, matching)`, conservando el paso: `hrefToEntry(…, id, step)`) o
  «No hay otros riesgos en este filtro.»; si `editable`, queda «Siguiente pendiente» como está.
- `entry-navigation.ts`: `nextInScopeId` = siguiente en el orden de `rows` dentro de `scope`, con vuelta
  al inicio, nunca el actual; `null` si no hay otro.
- `observation-item.tsx`: el botón con `observation.entryLabel` pasa a `WorkspaceLink` a
  `hrefToEntry(pathname, params, entryId, "seguimiento")` (hooks `usePathname`/`useSearchParams`);
  `onOpenEntry` queda opcional y sin uso.
- Pruebas: `entry-navigation.test.ts` «nextInScopeId sigue el orden, da la vuelta y no devuelve el
  actual»; `review-walk.test.ts` «cuenta y primer riesgo por filtro, sin modificados sin línea base» y
  «el href lleva el filtro y la fila»; `review-panel.test.tsx` «tres enlaces con conteo; en cero, texto»;
  `risk-editor.test.tsx` «el revisor con filtro ve Siguiente del filtro y quien edita ve Siguiente
  pendiente»; prueba de `observation-item` dentro de `review-panel.test.tsx`: «la observación de un
  riesgo enlaza a su paso de seguimiento».

### S6.3 `controles/[id]/page.tsx`
- Reemplazar `riskLevelLabel(effectiveRiskLevel(detail.entry) ?? "medium")` por
  `<RiskClassificationBadge classification={detail.entry.classification} magnitude={detail.entry.magnitude} />`
  (verifica los nombres de columna de clasificación y magnitud en el `entry` que devuelve
  `getRiskControlDetail`); si la fila es legacy sin clasificación: `riskLevelLabel(effectiveRiskLevel(entry))`
  sólo si existe (`residualLevel`), y si no «Sin evaluar». Nunca un `"medium"` por defecto.
  «Peligro: {hazard}» queda en su propio `<p>`.
- Migas: Prevención (`/prevencion`) › MIPER (`/prevencion/miper`) › «{faena} {período}»
  (`/prevencion/miper/{matrixId}`) › «Riesgo #{rowNumber}» (`/prevencion/miper/{matrixId}?fila={entryId}`) ›
  la medida.

**Commits:**
1. `feat(miper): la bitácora pagina de a 50 por cursor con «Cargar más»`
2. `feat(miper): el revisor recorre con filtros rápidos y «Siguiente del filtro», y las observaciones llevan al seguimiento del riesgo`
3. `fix(miper): la ficha de un control muestra la clasificación RE-04 y migas completas`
<!-- END:s6 -->

<!-- BEGIN:s7 -->
## S7 — E2E y siembra: Task 11 de D, V1 (revisión y sólo lectura) y las E2E de la Fase E

**Objetivo.** Todas las E2E nuevas y migradas, escritas **contra los contratos C7 y C8** (la UI la
construyen S2, S4, S5 y S6 en paralelo; no la ves). Nada se corre: la integración las corre desde un
worktree desechable y arregla localizadores.

**Propios:** todo `e2e/**`: `setup-db.ts`, `helpers.ts`, `miper-helpers.ts`, `accessibility.spec.ts`,
`accessibility-targets.ts` (+test), `prevencion-miper-*.spec.ts`, specs nuevas.

**No tocar:** nada fuera de `e2e/`.

**Consume:** C7 (nombres), C8 (siembra), los nombres de la Task 11 del plan D.

### S7.1 Task 11 de D (texto embebido al final)
Tal cual: `riskmatrix-masivas-e2e` en `setup-db.ts`, `e2e/prevencion-miper-masivas.spec.ts`, comentario
de `prevencion-miper-importacion.spec.ts`. Agregado: un caso en la spec de masivas que aplique
«Cambiar ¿controlado?» con el mismo valor que ya tienen los dos riesgos y espere el aviso
«No había nada que cambiar en los riesgos seleccionados.».

### S7.2 Siembra V1 y E (`setup-db.ts`)
- En `miperRoles`: `{ id: "rol-miper-lectura-e2e", name: "miper_lectura", label: "MIPER — sólo lectura", isGlobal: true, permissions: ["p-prev-risk-view"] }`;
  en `miperUsers`: `{ id: "user-miper-lectura-e2e", name: "MIPER Lectura E2E", email: "miper.lectura@e2e.chome.cl", roleId: "rol-miper-lectura-e2e", scoped: false }`.
  Buscar con `grep` si alguna spec o prueba cuenta los usuarios/roles sembrados y ajustarla.
- `riskmatrix-revision-e2e` (2041, Faena Restringida, borrador): copiar la forma de la vigente sembrada
  (encabezado completo, riesgos con medidas completas según D5 y la regla crítica, **sin Intolerables**
  para no exigir programa); un Importante controlado «Sí» y un Moderado con medida existente.
- 60 filas de `audit_log` sobre `riskmatrix-reemplazada-e2e` (`entityType: "risk_legal:risk:miper"`,
  `entityId` la matriz, `newState` `{"changeType":"entry_updated","object":"entry"}`, `createdAt`
  escalonado). **Sólo `INSERT`** (la tabla es append-only).

### S7.3 V1 — `e2e/prevencion-miper-revision-lectura.spec.ts` (serial)
1. admin envía `riskmatrix-revision-e2e` («Enviar a revisión»); queda la ronda abierta.
2. Jefa (`jefa.prevencion@e2e.chome.cl`): ve «Estás revisando la versión enviada»; en Revisión, la
   `region` «Recorrer la MIPER» y «Importantes e Intolerables (n)» abre el editor con el filtro en la
   URL; «Siguiente del filtro» avanza y da la vuelta; registra una observación sobre el riesgo; el
   enlace de la observación abre `paso=seguimiento`. Aprueba la revisión técnica.
3. Legal y RRHH (`legal.rrhh@e2e.chome.cl`): el editor sin campos editables; «Siguiente del filtro».
   No sella (la MIPER queda en revisión para el resto de la corrida).
4. `miper.lectura@e2e.chome.cl`: la portada lista las faenas; en `riskmatrix-revision-e2e` y en
   `riskmatrix-reemplazada-e2e` no hay «Nueva tarea», «Seleccionar», «Editar contexto», «Vincular
   medidas», «Editar antecedentes» ni campos editables en el editor; ve el aviso de sólo lectura de la
   reemplazada; en Historial de la reemplazada, 50 eventos, «Cargar más», más de 50 y el botón
   desaparece al terminar.
5. Teclado: desde la vista de la tarea, `Tab` recorre en orden visual hasta el primer riesgo y `Enter`
   abre el editor; cada foco tiene contorno visible (`outline-style` ≠ `none` o `box-shadow` ≠ `none`
   en el elemento enfocado).
6. axe (`AXE_TAGS`, `AXE_DISABLED_RULES` de `accessibility-targets.ts`) y sin scroll horizontal
   (`scrollWidth <= clientWidth`) a **768, 1024 y 1280 px** en: matriz, tarea, editor (cuatro pasos),
   Revisión, Programa (lista) y detalle de una actividad.

### S7.4 Fase E
- `prevencion-miper-programa.spec.ts` y `prevencion-miper-escenario.spec.ts`: de `dialog` «Actividad N°
  1» a `region` «Actividad N° 1»; «Abrir el detalle…» pasa de `button` a `link`; las filas de tabla del
  programa (`getByRole("row")`) pasan a `article`; «Ver la fila n…» pasa a `link`; el diálogo del
  encabezado del programa sólo tiene fecha y encargado. Revisar también `flujo`, `matriz`,
  `interacciones` y `accessibility.spec.ts` por usos del `Sheet` del programa.
- En `programa.spec.ts`, antes del envío a revisión: «vincular y desvincular»: «Vincular medidas» →
  desmarca «Fila 2: …» → «Guardar vínculos» → sólo queda «Ver la fila 1…»; vuelve a vincularla.
- En `programa.spec.ts`, después de registrar `e2e-ejecucion.png`: «la evidencia se descarga con
  encabezados seguros»: tomar el `href` de «Descargar e2e-ejecucion.png» y de «Abrir …»; con
  `page.request.get`: 200, `content-type: image/png`, `x-content-type-options: nosniff`,
  `content-disposition` `inline` sin `?descargar=1` y `attachment` con él; existe una cabecera
  `content-security-policy` (la pone el proxy); un nombre inventado → 404; sin sesión
  (`request.newContext()` limpio) → 401 o redirección al login (anotar cuál).
- `prevencion-miper-controles.spec.ts:38`: `"Peligro: Atrapamiento en correa transportadora E2E · riesgo Alto"`
  → dos aserciones: `textoVisible(page, "Peligro: Atrapamiento en correa transportadora E2E")` y
  `textoVisible(page, "Importante · MR 8")`; las migas «Riesgo #…».
- `accessibility-targets.ts` (+ `accessibility.spec.ts`): un objetivo nuevo para
  `/prevencion/miper/controles/<id del control sembrado que usa la spec de controles>`.

**Commits:**
1. `test(miper): E2E de las acciones masivas: medida a 2 riesgos, ¿controlado? en la matriz filtrada y «Editar contexto» con replace`
2. `test(miper): siembra de un usuario sólo-ver de MIPER, una MIPER lista para revisión y bitácora larga`
3. `test(miper): recorrido E2E de revisión y sólo lectura con teclado, axe y tres anchos`
4. `test(miper): E2E del programa sobre tarjetas y vista de actividad, vínculos, descarga de evidencia y la ficha de un control`
<!-- END:s7 -->

---

## Integración (controlador, cuando los siete reportaron)

### I-1. Orden de entrada
Sobre `feat/miper-acciones-masivas` (Fase 0 ya commiteada), **cherry-pick** de cada rama en este orden
(historia lineal, conserva asuntos): `git cherry-pick <BASE>..miper-resto/sN` para N = **1, 2, 3, 5, 6,
4, 7**. S4 va después de S5 y S6 porque consume sus componentes. Los archivos son disjuntos: un
conflicto significa que un stream tocó algo ajeno → revertir esa parte y llevarla al cableado.

### I-2. Cableado (un commit: `refactor(miper): cableado de las acciones masivas, el programa por props, la revisión y la bitácora paginada en el espacio de trabajo`)
- **W1 — `actions.ts`:** borrar `loadProgramWorkspaceAction`, `loadOccurrenceDetailAction`, el tipo
  `ProgramLoad` y los imports que queden sin uso (tablas de `@/db/schema`, `getProgramWorkspace`,
  `userNames`, `OUT_OF_SCOPE`/`scopeAllows` si ya no se usan). Quitar sus nombres de los `vi.mock("../actions")`
  sólo si molestan (sobran sin romper).
- **W2 — Task 9 de D en el espacio de trabajo:** aplicar en `miper-workspace.tsx` los cuatro reemplazos
  del Step 6 de la Task 9 del plan D (import de `BulkContext`; `const bulk` tras `newTaskOpen`;
  `<TaskView key={task.key} … bulk={bulk} />`; `<MatrixView … bulk={bulk}`), y en
  `miper-workspace.test.tsx` las dos ediciones de su Step 1 (los tres mocks `bulk…Action` y el test
  «acciones masivas (Fase D): quien edita ve «Seleccionar» en la tarea; en solo lectura, no»).
- **W3 — Revisión e historial en el espacio de trabajo:**
  `<ReviewPanel workspace={workspace} mode={mode} onOpenEntry={openEntry} rows={rows} observed={observedEntryIds} modified={modified} hasBaseline={baseline !== null} />`;
  en `miper-workspace.test.tsx`, `history={{ events: [], nextCursor: null }}` en todos los fixtures y
  `vi.mock("./history-actions", () => ({ loadMiperHistoryPageAction: vi.fn() }))`.
- **W4 — sólo si algún stream creó una suite PGlite nueva:** registrarla en `tests/pglite-files.ts`.
- Los «cableados pendientes» que reporten los streams.

### I-3. Puertas (en orden; cada una verde antes de la siguiente)
1. `npm run typecheck` — aquí aparecen las costuras de contrato (S2↔S1, S4↔S3/S5/S6, W1–W3).
2. `npm run lint`.
3. `npm run test:fast`.
4. PGlite **de a una**: `npm run test:pglite -- lib/__tests__/<suite>` para `miper-bulk`,
   `miper-entries`, `miper-program-queries`, `miper-program`, `miper-program-execution`,
   `miper-program-occurrences`, `miper-program-generation`, `miper-queries`, `miper-portfolio`,
   `miper-workflow`, `miper-snapshot-batch`, `miper-work-queue`, y `db/__tests__/miper-program-constraints`.
   (Las suites `*-postgres` van contra el contenedor E2E de :55432, de a una; si todas salen
   «skipped», el `/dev/shm` de 64 MB lo tumbó.)
5. `npm run check:secrets`, `npm run check:security-audit`, `npm run doctor`. `db:verify-migrations`
   sólo si hubo migración (no se prevé).
6. **Medición** del costo del programa en cada render: con la base E2E (o `EXPLAIN (ANALYZE)` de sólo
   lectura en `bodega_dev`), tiempo de `getProgramWorkspace` y de `getProgramActionDetail` sobre la
   MIPER de 222 riesgos. Índices **sólo** si una lectura pasa de ~50 ms por falta de índice; entonces
   `db/schema` + `npm run db:generate` + `node scripts/verify-migration-chain.mjs --update-checksums` +
   `npm run db:verify-migrations` y que `db:generate` quede en «No schema changes».
7. **E2E desde un worktree desechable del commit integrado** (nunca desde el checkout principal):
   ```bash
   cd /home/allopze/dev/chome/bodega
   SHA=$(git rev-parse --short HEAD)
   git worktree add /tmp/bodega-e2e-$SHA HEAD
   ln -s /home/allopze/dev/chome/bodega/node_modules /tmp/bodega-e2e-$SHA/node_modules
   ss -ltnp | grep ':3100 ' && echo "OCUPADO: matar por PID, nunca pkill -f"
   cd /tmp/bodega-e2e-$SHA
   npm run test:e2e -- e2e/prevencion-miper-masivas.spec.ts                       # construye
   E2E_SKIP_BUILD=true npm run test:e2e -- e2e/<siguiente>.spec.ts                # de a una
   cd /home/allopze/dev/chome/bodega && git worktree remove --force /tmp/bodega-e2e-$SHA
   ```
   Specs: `masivas`, `revision-lectura`, `programa`, `escenario`, `controles`, `flujo`, `matriz`,
   `interacciones`, `importacion`, `accessibility`, `densidad-kpi`. Sin copiar `.env.local` (apunta a
   `bodega_dev`); si la build pide una variable, copiar sólo `.env`. Un fallo: abrir el trace antes de
   tocar un localizador. Cada arreglo se commitea antes de volver a correr (el worktree toma sólo lo
   commiteado).
8. Ronda de arreglos: los fallos y los hallazgos de V1 se clasifican (AGENTS: product bug /
   functional / UX / automation warning / coverage gap) y se arreglan sólo los confirmados, con prueba
   de regresión si importan.

### I-4. Recorridos asistidos e informes
- **D (Task 12 del plan D):** recorrido de sólo lectura en `bodega_dev` (MIPER «Oficina Central 2099»):
  abrir los diálogos de lote y **cancelar**; la sonda de Server Functions no registra ninguna; recuentos
  iguales antes y después. Informe `qa/reports/2026-10-03-miper-d.md` (fecha real si cambia).
- **V1:** con la spec de S7 verde, recorrido asistido en el entorno E2E (:3100) de revisión y sólo
  lectura; informe `qa/reports/<fecha>-miper-revision-lectura.md`.
- **V2:** las E2E de arriba + recorrido en `bodega_dev` **sólo lectura** de la portada a la evidencia
  (abrir y descargar un archivo con `GET`; ningún `POST`), a 1440×900 y 390×844; informe
  `qa/reports/<fecha>-miper-cierre.md` con: cobertura recorrida y no recorrida, consola y red, tiempos
  medidos, y lo declarado (lector de pantalla real y producción fuera de alcance).
- Nunca imprimir credenciales ni el contenido de `playwright/.auth/monkeytest.json`.

### I-5. Docs (un commit `docs(miper): …`)
- Manual `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md`: §5 cambios
  en lote (Task 12 del plan D) + Programa (tarjetas, detalle, evidencia, vínculos, encabezado), Revisión
  (recorrer, siguiente del filtro), Historial («Cargar más»).
- Spec: línea 3 y §9 implementada (Task 12 del plan D); **enmiendas §10** (el programa se carga siempre
  con la página y se lee de props; `EntityTimeline` reemplazado por la bitácora propia paginada) y
  **§11** (`programHeaderSchema` acotado a fecha y encargado; acciones nuevas de E).
- Plan maestro: tachar lo hecho y anotar los desvíos de este plan.

---

## Riesgos

1. **Costuras ciegas.** S2 escribe contra C1, S4 contra C3/C5/C6, S7 contra C7/C8 sin verlos: la deriva
   aparece en `typecheck` y en las E2E. Mitigan los contratos exactos y la regla «si no puedes cumplir
   el contrato, dilo en la primera línea del reporte».
2. **S4 y S5 parten el `Sheet` del programa en dos archivos.** Riesgo de perder una capacidad (anular,
   retirar evidencia, registrar desde la tarjeta) o de duplicarla. Al integrar, cotejar contra el
   `program-panel.tsx` de la base.
3. **Datos por props con historia nativa.** Atrás restaura payloads viejos: el programa se lee de props
   (nunca copiado en estado) y el detalle se vuelve a pedir al montar y tras cada escritura.
4. **Costo de cargar el programa en cada render** de `[id]/page.tsx` (toda acción revalidante lo
   recalcula). Se mide en I-3.6; índices sólo con medición.
5. **Seguridad de la descarga:** alcance por la cadena completa, 404 indistinguible, `attachment` salvo
   PDF/imagen, `nosniff`; el proxy reescribe la CSP (no se agrega una propia).
6. **E2E escritas a ciegas** → muchos localizadores a corregir en la integración, y cada corrida
   resiembra. Las specs nuevas son seriales y de a una.
7. **V1 sembrada:** si la MIPER de revisión no pasa la completitud, el envío se bloquea; el diálogo de
   bloqueo dice qué falta y se arregla la siembra.
8. **Cursor del historial:** empates de `createdAt` (desempate por `id`) y precisión del timestamp en
   ida y vuelta (se compara en SQL con `::timestamptz`, nunca en JS).
9. **W2** depende de que S4 no haya tocado las líneas ancla de la Task 9: si no calzan, aplicar a mano
   con la misma intención.
10. **Lotes con 0 escritos:** mensaje propio y `toast.info`; la selección termina igual.

## Criterios de aceptación (plan maestro) y dónde se prueban

| Fase | Criterio | Evidencia |
|---|---|---|
| D | Una medida a 40 riesgos en una operación atómica; una versión vieja aborta todo. | PGlite `miper-bulk` (Task 4, ya escrita) + E2E `masivas`. |
| E | El escenario §12 pasa sobre la UI nueva. | E2E `escenario`. |
| E | La evidencia se descarga con encabezados seguros y sólo dentro del alcance. | `route.test.ts`, PGlite de `findMiperEvidenceForDownload`, E2E de encabezados en `programa`. |
| E | Abrir una actividad hace una sola llamada. | `program-activity-view.test.tsx` + red en el recorrido V2. |
| V1 | Revisión, sólo lectura y reemplazada recorridas con teclado, axe y 768/1024/1280. | E2E `revision-lectura` + informe V1. |
| V2 | Las E2E de MIPER y `accessibility` verdes desde un worktree; recorrido de la portada a la evidencia. | Informe `…-miper-cierre.md`. |
