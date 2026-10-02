# MIPER sin planilla: plan de implementación de la Fase A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar la grilla de 19 columnas de la pestaña Matriz. En su lugar queda una navegación
por niveles (actividad › tarea › riesgo) con un editor del riesgo por pasos, guardado automático
visible y "Siguiente pendiente". El backend no cambia.

**Architecture:** las vistas viven en la URL del espacio de trabajo (`?tarea=`, `?fila=`, `?paso=`,
`?ficha=`), así siguen funcionando los enlaces de notificaciones. La lógica nueva es pura y está
probada en `lib/prevention/miper/` (árbol, navegación, filtros en la URL, siguiente paso,
chequeos). Los componentes cliente se apoyan en ella, en las acciones de servidor existentes y en
`useRowSaver`. Las primitivas compartidas se extienden en su capa (`Combobox` con valor libre) o
se componen (`ChoiceCardGroup` sobre `SelectableCard`).

**Tech Stack:** Next.js (App Router; leer `node_modules/next/dist/docs/` antes de usar una API de
navegación), React 19, TypeScript, Tailwind, Radix, Vitest + Testing Library (jsdom) y Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-miper-ui-sin-planilla-design.md` (§3–§6, §11–§14).
Contexto del modelo: `PLAN_REDISENO_MIPER_2026-09-30.md` Parte I.

## Global Constraints

- **Sin cambios de esquema ni migraciones** en esta fase. **Las acciones de servidor no cambian de firma.**
- Toda página sigue con `PageHeader` + `PageContainer`. El espacio de trabajo pasa de `width="full"` a `width="workbench"`.
- **Ningún `<h1>` propio** y **ningún buscador fuera de la matriz.** `/prevencion/miper/[id]` sigue en `OWN_SEARCH_PATTERNS`.
- **Filtros y pestañas:**
  - Se cambian con `router.replace(url, { scroll: false })` o con `useUrlFilters`.
  - Las vistas más profundas se abren con `<Link>` (push), así "atrás" vuelve con los filtros.
- **Fechas:** `DatePicker` y `formatDate`. Nunca `toLocaleDateString` ni `<input type="date">`.
- **Color de texto:** sólo tokens `-ink`.
- **El orange `signal` no indica "filtro activo".** Para eso se usa `--color-primary-tint` / `--color-primary-ink`.
- **Estados:** nunca un enum crudo. Usar `CLASSIFICATION_LABEL`, `CONTROLLED_STATUS_LABEL` y `CONTROL_HIERARCHY_LABEL`.
- **Validación:** los mensajes van en texto visible, nunca sólo en `title`. El estado de guardado se anuncia con `aria-live="polite"`.
- **Sin árboles duplicados** `md:hidden` / `hidden md:block` en las vistas nuevas: un solo árbol que se reacomoda.
- **Commits:** en español, estilo `feat(miper): …`, con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Rama:** `feat/miper-ui-sin-planilla`, creada desde `main`.
- **Pruebas unitarias:**
  - Comando: `npm run test:fast -- <archivo>`.
  - Las de componentes llevan `// @vitest-environment jsdom` en la primera línea y mockean `next/navigation` y `../actions` como en `use-row-saver.test.ts`.
- **E2E:** `npm run test:e2e -- e2e/<spec>`, de a un spec.

## Review Focus

1. **Un riesgo importado sin actividad o sin tarea** (`activity`/`task` nulos) tiene que poder alcanzarse y editarse. Se agrupa en "Sin actividad › Sin tarea", y esa tarea es navegable. Prueba: Task 1 y Task 9.
2. **Cambiar actividad o tarea desde el editor** saca el riesgo de su tarea. El editor tiene que seguir abierto y "Volver a la tarea" tiene que llevar a la tarea **nueva**. Prueba: Task 8.
3. **Un guardado rechazado en una tarjeta** (P, C, ¿controlado?) tiene que revertir la selección y mostrar el mensaje. Hoy la grilla deja en pantalla el valor no guardado. Prueba: Task 6 y Task 8.
4. **`?fila=` de un riesgo borrado o inexistente** (enlace viejo de una notificación) no puede romper la página. Muestra "Este riesgo ya no existe" con un enlace a la matriz. Prueba: Task 8.
5. **Basura en la URL** (`?clasificacion=foo,important&controlado=quizas&paso=x`) se ignora sin romper nada: queda `important`, `controlado=all` y el primer paso con errores. Prueba: Task 3 y Task 8.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/prevention/miper/matrix-tree.ts` (+test) | Árbol Actividad › Tarea, claves `taskKeyOf` / `activityKeyOf`, `findTask`, `mostFrequent` |
| `lib/prevention/miper/entry-navigation.ts` (+test) | Pasos del editor, campo → paso, anterior / siguiente / siguiente pendiente |
| `lib/prevention/miper/risk-checks.ts` (+test) | Chequeo del riesgo para el panel lateral |
| `lib/prevention/miper/next-step.ts` (+test) | `nextStepFor()`: la tarjeta "Siguiente paso" |
| `lib/prevention/miper/matrix-filters.ts` (+test) | `GridFilters` ⇄ URL, chips |
| `lib/prevention/miper/workspace-url.ts` (+test) | `readWorkspaceView`, `hrefToMatrix` / `Task` / `Entry` / `Tab` / `Ficha` |
| `lib/prevention/miper/entry-values.ts` (+test) | Aplicar o revertir valores de un riesgo (reclasifica) |
| `lib/prevention/miper/grid-view.ts` (modificar) | `onlyComplete`; se retiran `groupRows` / `GroupBy` |
| `components/ui/combobox.tsx` (modificar, +test nuevo) | `allowCustomValue`, `aria-label` |
| `components/ui/choice-card-group.tsx` (+test) | Grupo de radio con `SelectableCard` |
| `components/prevention/pc-choice.tsx` (+test) | Selector P×C con criterio RE-04 |
| `app/(app)/prevencion/miper/[id]/use-row-saver.ts` (modificar) | Expone `versionOf` |
| `app/(app)/prevencion/miper/[id]/use-entry-autosave.ts` (+test) | Guardado optimista con reversión y estado |
| `app/(app)/prevencion/miper/[id]/control-form.tsx`, `control-card.tsx` (+test) | Medida de control: alta, edición y borrado confirmado |
| `app/(app)/prevencion/miper/[id]/risk-editor/*.tsx` (+test) | Editor del riesgo: pasos, panel lateral, navegación |
| `app/(app)/prevencion/miper/[id]/risk-row.tsx`, `task-view.tsx` (+test) | Vista de la tarea |
| `app/(app)/prevencion/miper/[id]/matrix-view.tsx`, `activity-section.tsx`, `matrix-filters-bar.tsx`, `new-task-dialog.tsx` (+test) | Vista de estructura |
| `app/(app)/prevencion/miper/[id]/next-step-card.tsx`, `ficha-sheet.tsx` | Tarjeta "Siguiente paso", ficha del documento |
| `app/(app)/prevencion/miper/[id]/miper-workspace.tsx`, `workflow-bar.tsx`, `summary-strip.tsx`, `antecedentes-form.tsx`, `../new-miper-dialog.tsx` (modificar) | Integración |
| `matrix-grid.tsx`, `entry-sheet.tsx`, `components/prevention/pc-select.tsx` (+test) | **Se borran** |
| `e2e/miper-helpers.ts` (nuevo), `e2e/prevencion-miper-{interacciones,flujo,escenario,programa}.spec.ts` | E2E migradas |
| `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md` | §5 reescrito |

---

### Task 1: Árbol de la matriz y clave de tarea

**Files:**
- Create: `lib/prevention/miper/matrix-tree.ts`
- Test: `lib/prevention/miper/matrix-tree.test.ts`

**Interfaces:**
- Consumes: `normalizeMiperName` (`./names`), `RISK_CLASSIFICATIONS` / `RiskClassification` (`./methodology`), `MiperEntrySnapshot` (`./snapshot`).
- Produces: `taskKeyOf(entry): string`, `activityKeyOf(entry): string`, `buildMatrixTree(rows, ctx: TreeContext): ActivityNode[]`, `findTask(tree, key): TaskNode | null`, `mostFrequent<T>(values): T | null`; los tipos `TaskNode`, `ActivityNode`, `TreeContext` y `ClassificationCounts`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/prevention/miper/matrix-tree.test.ts
import { describe, expect, it } from "vitest"
import { buildMatrixTree, findTask, mostFrequent, taskKeyOf, type TreeContext } from "./matrix-tree"
import type { MiperEntrySnapshot } from "./snapshot"

const base: MiperEntrySnapshot = {
  id: "e", rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta",
  exposedFemale: 0, exposedMale: 2, exposedOther: 0, riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true,
  hazard: "H", risk: "R", probableDamage: "D", probability: 2, consequence: 4, magnitude: 8,
  classification: "important", controlledStatus: "no", controls: [],
}
const e = (overrides: Partial<MiperEntrySnapshot>): MiperEntrySnapshot => ({ ...base, ...overrides })
const ctx = (overrides: Partial<TreeContext> = {}): TreeContext => ({ incomplete: new Set(), observed: new Set(), modified: new Set(), matching: null, ...overrides })

describe("buildMatrixTree", () => {
  it("ordena actividades y tareas por el primer N° (orden RE-04), no alfabético", () => {
    const tree = buildMatrixTree([
      e({ id: "c", rowNumber: 3, activity: "Zeta", task: "T1" }),
      e({ id: "a", rowNumber: 1, activity: "Zeta", task: "T1" }),
      e({ id: "b", rowNumber: 2, activity: "Alfa", task: "T2" }),
    ], ctx())
    expect(tree.map((activity) => activity.label)).toEqual(["Zeta", "Alfa"])
    expect(tree[0]!.tasks[0]!.entries.map((entry) => entry.id)).toEqual(["a", "c"])
    expect(tree[0]!.tasks[0]!.lastRowNumber).toBe(3)
  })

  it("agrupa los nulos en «Sin actividad › Sin tarea» y la tarea se encuentra por su clave", () => {
    const tree = buildMatrixTree([e({ id: "x", activity: null, task: null })], ctx())
    expect(tree[0]!.label).toBe("Sin actividad")
    expect(tree[0]!.tasks[0]!.label).toBe("Sin tarea")
    expect(findTask(tree, taskKeyOf({ activity: null, task: null }))?.entries[0]!.id).toBe("x")
  })

  it("cuenta por clasificación, completos, observados y modificados; puestos sin repetir; máximo de expuestos", () => {
    const tree = buildMatrixTree([
      e({ id: "a", rowNumber: 1, classification: "important", position: "Conductor", exposedMale: 2 }),
      e({ id: "b", rowNumber: 2, classification: "tolerable", position: "conductor ", exposedMale: 5, exposedFemale: 1 }),
      e({ id: "c", rowNumber: 3, classification: "important", position: "Peoneta", exposedMale: 1 }),
    ], ctx({ incomplete: new Set(["a"]), observed: new Set(["b"]), modified: new Set(["b", "c"]) }))
    const task = tree[0]!.tasks[0]!
    expect(task.counts).toEqual({ tolerable: 1, moderate: 0, important: 2, intolerable: 0 })
    expect(task.complete).toBe(2)
    expect(task.observed).toBe(1)
    expect(task.modified).toBe(2)
    expect(task.positions).toEqual(["Conductor", "Peoneta"])
    expect(task.maxExposed).toBe(6)
    expect(tree[0]!.counts.important).toBe(2)
  })

  it("con filtro deja sólo tareas y actividades con coincidencias, sin perder los totales", () => {
    const tree = buildMatrixTree([
      e({ id: "a", rowNumber: 1, activity: "A1", task: "T1" }),
      e({ id: "b", rowNumber: 2, activity: "A1", task: "T2" }),
      e({ id: "c", rowNumber: 3, activity: "A2", task: "T3" }),
    ], ctx({ matching: new Set(["b"]) }))
    expect(tree).toHaveLength(1)
    expect(tree[0]!.tasks.map((task) => task.label)).toEqual(["T2"])
    expect(tree[0]!.entryCount).toBe(2)
    expect(tree[0]!.matchingCount).toBe(1)
    expect(tree[0]!.tasks[0]!.matching.map((entry) => entry.id)).toEqual(["b"])
  })
})

describe("taskKeyOf", () => {
  it("es estable ante mayúsculas, tildes y espacios, y separa actividad de tarea", () => {
    expect(taskKeyOf({ activity: "Gestión  Documental", task: "Trabajo" })).toBe(taskKeyOf({ activity: "gestion documental ", task: "TRABAJO" }))
    expect(taskKeyOf({ activity: "gestion", task: "documental trabajo" })).not.toBe(taskKeyOf({ activity: "gestion documental", task: "trabajo" }))
    expect(taskKeyOf({ activity: "A", task: "B" })).toMatch(/^[0-9a-z]+$/)
  })
})

describe("mostFrequent", () => {
  it("devuelve el más repetido, el primero en empate, e ignora nulos", () => {
    expect(mostFrequent(["a", "b", "b", null])).toBe("b")
    expect(mostFrequent(["a", "b"])).toBe("a")
    expect(mostFrequent([null])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- lib/prevention/miper/matrix-tree.test.ts`
Expected: FAIL, "Failed to resolve import ./matrix-tree".

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/prevention/miper/matrix-tree.ts
/**
 * La matriz como estructura de trabajo (spec 2026-10-02 §5): Actividad › Tarea ›
 * riesgos, en el orden del RE-04 —el menor N° de cada grupo—, no alfabético.
 * Reemplaza a `groupRows`, que agrupaba un solo nivel para la grilla.
 */
import { RISK_CLASSIFICATIONS, type RiskClassification } from "./methodology"
import { normalizeMiperName } from "./names"
import type { MiperEntrySnapshot } from "./snapshot"

export type ClassificationCounts = Record<RiskClassification, number>

export type TaskNode = {
  key: string
  activity: string | null
  task: string | null
  label: string
  positions: string[]
  locations: string[]
  /** Todos los riesgos de la tarea, por N°. */
  entries: MiperEntrySnapshot[]
  /** Los que pasan los filtros (todos, si no hay filtros). */
  matching: MiperEntrySnapshot[]
  counts: ClassificationCounts
  complete: number
  observed: number
  modified: number
  /** Máximo F+M+Otro de un riesgo: sumar contaría dos veces a las mismas personas. */
  maxExposed: number
  lastRowNumber: number
}

export type ActivityNode = {
  key: string
  activity: string | null
  label: string
  tasks: TaskNode[]
  entryCount: number
  matchingCount: number
  counts: ClassificationCounts
}

export type TreeContext = {
  incomplete: ReadonlySet<string>
  observed: ReadonlySet<string>
  modified: ReadonlySet<string>
  /** `null` = sin filtros: todo coincide. */
  matching: ReadonlySet<string> | null
}

const emptyCounts = (): ClassificationCounts =>
  Object.fromEntries(RISK_CLASSIFICATIONS.map((classification) => [classification, 0])) as ClassificationCounts

/** FNV-1a de 32 bits en base 36: corta para la URL y estable entre renders y recargas. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function activityKeyOf(entry: Pick<MiperEntrySnapshot, "activity">): string {
  return fnv1a(normalizeMiperName(entry.activity ?? ""))
}

/** Clave de `?tarea=`: misma igualdad que el diccionario de la faena (nombre normalizado). */
export function taskKeyOf(entry: Pick<MiperEntrySnapshot, "activity" | "task">): string {
  return fnv1a(`${normalizeMiperName(entry.activity ?? "")}\u001f${normalizeMiperName(entry.task ?? "")}`)
}

function pushDistinct(list: string[], value: string | null) {
  if (!value) return
  const key = normalizeMiperName(value)
  if (!list.some((item) => normalizeMiperName(item) === key)) list.push(value)
}

export function buildMatrixTree(rows: readonly MiperEntrySnapshot[], ctx: TreeContext): ActivityNode[] {
  const activities = new Map<string, ActivityNode>()
  const tasks = new Map<string, TaskNode>()
  for (const entry of [...rows].sort((a, b) => a.rowNumber - b.rowNumber)) {
    const activityKey = activityKeyOf(entry)
    let activity = activities.get(activityKey)
    if (!activity) {
      activity = { key: activityKey, activity: entry.activity, label: entry.activity ?? "Sin actividad", tasks: [], entryCount: 0, matchingCount: 0, counts: emptyCounts() }
      activities.set(activityKey, activity)
    }
    const taskKey = taskKeyOf(entry)
    let task = tasks.get(taskKey)
    if (!task) {
      task = {
        key: taskKey, activity: entry.activity, task: entry.task, label: entry.task ?? "Sin tarea",
        positions: [], locations: [], entries: [], matching: [], counts: emptyCounts(),
        complete: 0, observed: 0, modified: 0, maxExposed: 0, lastRowNumber: entry.rowNumber,
      }
      tasks.set(taskKey, task)
      activity.tasks.push(task)
    }
    task.entries.push(entry)
    task.lastRowNumber = entry.rowNumber
    pushDistinct(task.positions, entry.position)
    pushDistinct(task.locations, entry.location)
    if (entry.classification) {
      task.counts[entry.classification] += 1
      activity.counts[entry.classification] += 1
    }
    if (!ctx.incomplete.has(entry.id)) task.complete += 1
    if (ctx.observed.has(entry.id)) task.observed += 1
    if (ctx.modified.has(entry.id)) task.modified += 1
    task.maxExposed = Math.max(task.maxExposed, entry.exposedFemale + entry.exposedMale + entry.exposedOther)
    activity.entryCount += 1
    if (!ctx.matching || ctx.matching.has(entry.id)) {
      task.matching.push(entry)
      activity.matchingCount += 1
    }
  }
  const tree = [...activities.values()]
  if (!ctx.matching) return tree
  return tree
    .map((activity) => ({ ...activity, tasks: activity.tasks.filter((task) => task.matching.length > 0) }))
    .filter((activity) => activity.matchingCount > 0)
}

export function findTask(tree: readonly ActivityNode[], key: string): TaskNode | null {
  for (const activity of tree) for (const task of activity.tasks) if (task.key === key) return task
  return null
}

/** El valor más repetido (en empate, el primero en aparecer). Se hereda al agregar un peligro. */
export function mostFrequent<T>(values: readonly (T | null)[]): T | null {
  const counts = new Map<T, number>()
  let best: T | null = null
  let bestCount = 0
  for (const value of values) {
    if (value === null) continue
    const next = (counts.get(value) ?? 0) + 1
    counts.set(value, next)
    if (next > bestCount) { best = value; bestCount = next }
  }
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- lib/prevention/miper/matrix-tree.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/matrix-tree.ts lib/prevention/miper/matrix-tree.test.ts
git commit -m "feat(miper): árbol actividad › tarea de la matriz y clave estable de tarea"
```

---

### Task 2: Navegación entre riesgos, chequeo del riesgo y "Siguiente paso"

**Files:**
- Create: `lib/prevention/miper/entry-navigation.ts`, `lib/prevention/miper/risk-checks.ts`, `lib/prevention/miper/next-step.ts`
- Test: `lib/prevention/miper/entry-navigation.test.ts`, `lib/prevention/miper/risk-checks.test.ts`, `lib/prevention/miper/next-step.test.ts`

**Interfaces:**
- Consumes: `CompletenessIssue` (`./completeness`), `taskKeyOf` (Task 1), `MiperEntrySnapshot`, `WorkspaceMode` (`./workspace-mode`).
- Produces:
  - `EDITOR_STEPS`, `EditorStep`, `EDITOR_STEP_LABEL`, `isEditorStep(v)`, `stepOfField(field)`.
  - `firstStepWithErrors(issues)`, `errorCountByStep(issues)`.
  - `siblingsInTask(rows, entryId)`, `nextPendingId(rows, currentId, incomplete, scope)`, `firstPendingBySeverity(rows, incomplete)`.
  - `riskChecks(entry, issues): RiskCheck[]`.
  - `nextStepFor(input): NextStep | null`, con los tipos `NextStepAction` y `NextStepInput`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/prevention/miper/entry-navigation.test.ts
import { describe, expect, it } from "vitest"
import type { CompletenessIssue } from "./completeness"
import { errorCountByStep, firstPendingBySeverity, firstStepWithErrors, isEditorStep, nextPendingId, siblingsInTask, stepOfField } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"

const row = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
  id, rowNumber, activity: "A", task: "T", position: null, location: null, exposedFemale: 0, exposedMale: 0, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: null, hazard: null, risk: null, probableDamage: null, probability: null,
  consequence: null, magnitude: null, classification: null, controlledStatus: null, controls: [], ...overrides,
}) as MiperEntrySnapshot
const issue = (field: string, severity: "error" | "warning" = "error"): CompletenessIssue => ({ scope: "entry", entryId: "e", field, message: field, severity })

describe("pasos del editor", () => {
  it("asigna cada campo del validador a su paso", () => {
    expect(stepOfField("hazard")).toBe("identificacion")
    expect(stepOfField("consequence")).toBe("evaluacion")
    expect(stepOfField("dueDate")).toBe("medidas")
    expect(stepOfField("programLink")).toBe("seguimiento")
    expect(stepOfField("desconocido")).toBe("medidas")
  })
  it("abre en el primer paso con errores; sin errores, en Identificación; ignora advertencias", () => {
    expect(firstStepWithErrors([issue("controls"), issue("probability")])).toBe("evaluacion")
    expect(firstStepWithErrors([issue("classification", "warning")])).toBe("identificacion")
    expect(errorCountByStep([issue("controls"), issue("dueDate"), issue("hazard")])).toEqual({ identificacion: 1, evaluacion: 0, medidas: 2, seguimiento: 0 })
  })
  it("valida el paso que viene en la URL", () => {
    expect(isEditorStep("medidas")).toBe(true)
    expect(isEditorStep("x")).toBe(false)
    expect(isEditorStep(null)).toBe(false)
  })
})

describe("recorrido", () => {
  const rows = [row("a", 1), row("b", 2, { task: "Otra" }), row("c", 3), row("d", 4)]
  it("anterior y siguiente dentro de la misma tarea, por N°", () => {
    expect(siblingsInTask(rows, "c")).toEqual({ previousId: "a", nextId: "d", position: 2, total: 3 })
    expect(siblingsInTask(rows, "zzz")).toBeNull()
  })
  it("siguiente pendiente: el próximo por N°, da la vuelta y respeta el filtro", () => {
    const incomplete = new Set(["a", "b", "d"])
    expect(nextPendingId(rows, "b", incomplete, null)).toBe("d")
    expect(nextPendingId(rows, "d", incomplete, null)).toBe("a")
    expect(nextPendingId(rows, "a", incomplete, new Set(["d"]))).toBe("d")
    expect(nextPendingId(rows, "a", new Set(["a"]), null)).toBeNull()
  })
  it("primer pendiente por gravedad y luego por N°", () => {
    const graded = [row("a", 1, { classification: "moderate" }), row("b", 2, { classification: "intolerable" }), row("c", 3, { classification: "intolerable" }), row("d", 4)]
    expect(firstPendingBySeverity(graded, new Set(["a", "c", "d"]))).toBe("c")
    expect(firstPendingBySeverity(graded, new Set())).toBeNull()
  })
})
```

```ts
// lib/prevention/miper/risk-checks.test.ts
import { describe, expect, it } from "vitest"
import { riskChecks } from "./risk-checks"
import type { MiperEntrySnapshot } from "./snapshot"

const entry = { id: "e", classification: "intolerable" } as MiperEntrySnapshot
const issue = (field: string) => ({ scope: "entry" as const, entryId: "e", field, message: `falta ${field}`, severity: "error" as const })

describe("riskChecks", () => {
  it("un ítem por bloque, con los mensajes del validador y el paso al que lleva", () => {
    const checks = riskChecks(entry, [issue("hazard"), issue("dueDate"), issue("programLink")])
    expect(checks.map((check) => [check.key, check.ok])).toEqual([["identificacion", false], ["evaluacion", true], ["controlado", true], ["medidas", false], ["programa", false]])
    expect(checks[0]!.messages).toEqual(["falta hazard"])
    expect(checks[3]!.step).toBe("medidas")
  })
  it("el vínculo al programa sólo se chequea en un Intolerable", () => {
    expect(riskChecks({ ...entry, classification: "moderate" }, []).map((check) => check.key)).not.toContain("programa")
  })
})
```

```ts
// lib/prevention/miper/next-step.test.ts
import { describe, expect, it } from "vitest"
import { nextStepFor, type NextStepInput } from "./next-step"
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
  it("1. solo lectura muestra el motivo", () => {
    expect(nextStepFor(input({ mode: { ...mode, canEdit: false, readOnlyReason: "Reemplazada por 2027" } }))).toMatchObject({ tone: "info", title: "Reemplazada por 2027", action: null })
  })
  it("2. quien envió la ronda espera la revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, isSubmitter: true }, hasOpenRound: true }))?.title).toBe("Enviaste esta ronda: la revisa otra persona.")
  })
  it("3. el revisor parte por el riesgo más grave", () => {
    const step = nextStepFor(input({ mode: { ...mode, canEdit: false, canReviewTechnical: true }, hasOpenRound: true }))
    expect(step).toMatchObject({ title: "Revisa la versión enviada", action: { kind: "riesgo", entryId: "b" } })
    expect(step?.description).toBe("2 riesgos · 1 Importantes o Intolerables")
  })
  it("4. con observaciones por responder lleva a Revisión", () => {
    expect(nextStepFor(input({ mode: { ...mode, canRespond: true }, reviewState: "observed", openObservations: 3 }))).toMatchObject({ title: "Responde 3 observación(es)", action: { kind: "tab", tab: "revision" } })
  })
  it("5. los datos de cabecera van antes que los riesgos", () => {
    const step = nextStepFor(input({ issues: [{ scope: "header", field: "elaboratedOn", message: "Falta la fecha de elaboración.", severity: "error" }, entryIssue("a")] }))
    expect(step).toMatchObject({ title: "Completa la ficha del documento (1 dato(s))", description: "Falta la fecha de elaboración.", action: { kind: "ficha" } })
  })
  it("6. faltan datos: al pendiente más grave, con el filtro como alternativa", () => {
    const step = nextStepFor(input({ issues: [entryIssue("a"), entryIssue("b"), entryIssue("b")] }))
    expect(step).toMatchObject({ tone: "warning", title: "Faltan datos en 2 riesgo(s)", action: { kind: "riesgo", entryId: "b" }, secondary: { kind: "filtro" } })
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/entry-navigation.test.ts lib/prevention/miper/risk-checks.test.ts lib/prevention/miper/next-step.test.ts`
Expected: FAIL, imports sin resolver.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/prevention/miper/entry-navigation.ts
/**
 * Pasos del editor del riesgo y recorrido entre riesgos (spec 2026-10-02 §5.4).
 * El validador (`completeness.ts`) habla en campos; el editor, en pasos: este
 * mapa es el único punto donde se traducen.
 */
import type { CompletenessIssue } from "./completeness"
import { taskKeyOf } from "./matrix-tree"
import type { MiperEntrySnapshot } from "./snapshot"

export const EDITOR_STEPS = ["identificacion", "evaluacion", "medidas", "seguimiento"] as const
export type EditorStep = typeof EDITOR_STEPS[number]
export const EDITOR_STEP_LABEL: Record<EditorStep, string> = {
  identificacion: "Identificación", evaluacion: "Evaluación", medidas: "Medidas de control", seguimiento: "Seguimiento",
}

const STEP_OF_FIELD: Record<string, EditorStep> = {
  activity: "identificacion", task: "identificacion", position: "identificacion", location: "identificacion",
  riskFactorId: "identificacion", isRoutine: "identificacion", hazard: "identificacion", risk: "identificacion", probableDamage: "identificacion",
  probability: "evaluacion", consequence: "evaluacion", classification: "evaluacion",
  controlledStatus: "medidas", controls: "medidas", dueDate: "medidas", responsible: "medidas", description: "medidas",
  programLink: "seguimiento",
}

export function stepOfField(field: string): EditorStep {
  return STEP_OF_FIELD[field] ?? "medidas"
}

export function isEditorStep(value: string | null | undefined): value is EditorStep {
  return typeof value === "string" && (EDITOR_STEPS as readonly string[]).includes(value)
}

export function errorCountByStep(issues: readonly CompletenessIssue[]): Record<EditorStep, number> {
  const counts: Record<EditorStep, number> = { identificacion: 0, evaluacion: 0, medidas: 0, seguimiento: 0 }
  for (const issue of issues) if (issue.severity === "error") counts[stepOfField(issue.field)] += 1
  return counts
}

export function firstStepWithErrors(issues: readonly CompletenessIssue[]): EditorStep {
  const counts = errorCountByStep(issues)
  return EDITOR_STEPS.find((step) => counts[step] > 0) ?? "identificacion"
}

const byRow = (a: MiperEntrySnapshot, b: MiperEntrySnapshot) => a.rowNumber - b.rowNumber

export function siblingsInTask(rows: readonly MiperEntrySnapshot[], entryId: string) {
  const entry = rows.find((row) => row.id === entryId)
  if (!entry) return null
  const key = taskKeyOf(entry)
  const siblings = rows.filter((row) => taskKeyOf(row) === key).sort(byRow)
  const index = siblings.findIndex((row) => row.id === entryId)
  return { previousId: siblings[index - 1]?.id ?? null, nextId: siblings[index + 1]?.id ?? null, position: index + 1, total: siblings.length }
}

/** El próximo riesgo con errores por N°, dando la vuelta; con filtro, sólo dentro del filtro. */
export function nextPendingId(rows: readonly MiperEntrySnapshot[], currentId: string | null, incomplete: ReadonlySet<string>, scope: ReadonlySet<string> | null): string | null {
  const candidates = [...rows].sort(byRow).filter((row) => incomplete.has(row.id) && row.id !== currentId && (!scope || scope.has(row.id)))
  if (candidates.length === 0) return null
  const currentRow = rows.find((row) => row.id === currentId)?.rowNumber ?? 0
  return (candidates.find((row) => row.rowNumber > currentRow) ?? candidates[0]!).id
}

const SEVERITY: Record<string, number> = { intolerable: 0, important: 1, moderate: 2, tolerable: 3 }

/** Por dónde empezar: Intolerable > Importante > el resto; dentro de cada banda, por N°. */
export function firstPendingBySeverity(rows: readonly MiperEntrySnapshot[], incomplete: ReadonlySet<string>): string | null {
  const pending = rows.filter((row) => incomplete.has(row.id))
  pending.sort((a, b) => (SEVERITY[a.classification ?? ""] ?? 4) - (SEVERITY[b.classification ?? ""] ?? 4) || a.rowNumber - b.rowNumber)
  return pending[0]?.id ?? null
}
```

```ts
// lib/prevention/miper/risk-checks.ts
/** «Chequeo del riesgo» del panel lateral (spec §5.4): un ítem por bloque, con los mensajes del validador. */
import type { CompletenessIssue } from "./completeness"
import type { EditorStep } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"

export type RiskCheck = { key: "identificacion" | "evaluacion" | "controlado" | "medidas" | "programa"; label: string; ok: boolean; messages: string[]; step: EditorStep }

const BLOCKS: ReadonlyArray<Omit<RiskCheck, "ok" | "messages"> & { fields: readonly string[] }> = [
  { key: "identificacion", label: "Peligro, riesgo y daño definidos", step: "identificacion", fields: ["activity", "task", "position", "riskFactorId", "hazard", "risk", "probableDamage"] },
  { key: "evaluacion", label: "Evaluación P×C registrada", step: "evaluacion", fields: ["probability", "consequence"] },
  { key: "controlado", label: "«¿Está controlado?» indicado", step: "medidas", fields: ["controlledStatus"] },
  { key: "medidas", label: "Medidas de control suficientes", step: "medidas", fields: ["controls", "dueDate", "responsible", "description"] },
  { key: "programa", label: "Medida vinculada al Programa de Trabajo", step: "seguimiento", fields: ["programLink"] },
]

export function riskChecks(entry: Pick<MiperEntrySnapshot, "classification">, issues: readonly CompletenessIssue[]): RiskCheck[] {
  return BLOCKS
    .filter((block) => block.key !== "programa" || entry.classification === "intolerable")
    .map(({ fields, ...block }) => {
      const messages = issues.filter((issue) => issue.severity === "error" && fields.includes(issue.field)).map((issue) => issue.message)
      return { ...block, ok: messages.length === 0, messages }
    })
}
```

```ts
// lib/prevention/miper/next-step.ts
/**
 * La tarjeta «Siguiente paso» (spec §5.6): una sola recomendación, la primera
 * regla que aplica. Reemplaza al texto suelto que pintaba `WorkflowBar`.
 */
import type { CompletenessIssue } from "./completeness"
import { firstPendingBySeverity } from "./entry-navigation"
import type { MiperEntrySnapshot } from "./snapshot"
import type { WorkspaceMode } from "./workspace-mode"

export type NextStepAction =
  | { kind: "ficha" }
  | { kind: "riesgo"; entryId: string }
  | { kind: "tab"; tab: "revision" }
  | { kind: "filtro"; completitud: "pendientes" }

export type NextStep = { tone: "info" | "warning" | "success"; title: string; description: string; action: NextStepAction | null; secondary: NextStepAction | null }

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

const step = (tone: NextStep["tone"], title: string, description = "", action: NextStepAction | null = null, secondary: NextStepAction | null = null): NextStep => ({ tone, title, description, action, secondary })

export function nextStepFor(input: NextStepInput): NextStep | null {
  const { mode, rows } = input
  if (mode.readOnlyReason) return step("info", mode.readOnlyReason)
  if (mode.isSubmitter && input.hasOpenRound) return step("info", "Enviaste esta ronda: la revisa otra persona.", "Puedes seguir editando; los cambios quedan para la ronda siguiente.")
  if (mode.canReviewTechnical || mode.canApproveLegal) {
    const critical = rows.filter((row) => row.classification === "important" || row.classification === "intolerable")
    const target = firstPendingBySeverity(rows, new Set(critical.map((row) => row.id))) ?? [...rows].sort((a, b) => a.rowNumber - b.rowNumber)[0]?.id ?? null
    return step("warning", "Revisa la versión enviada", `${rows.length} riesgos · ${critical.length} Importantes o Intolerables`, target ? { kind: "riesgo", entryId: target } : null)
  }
  if (mode.canRespond && input.openObservations > 0) {
    return step("warning", `Responde ${input.openObservations} observación(es)`, "Cada respuesta queda junto a la observación; después reenvía a revisión.", { kind: "tab", tab: "revision" })
  }
  if (mode.canEdit) {
    const errors = input.issues.filter((issue) => issue.severity === "error")
    const header = errors.filter((issue) => issue.scope === "header")
    if (header.length > 0) return step("warning", `Completa la ficha del documento (${header.length} dato(s))`, header[0]!.message, { kind: "ficha" })
    const pending = new Set(errors.flatMap((issue) => (issue.entryId ? [issue.entryId] : [])))
    if (pending.size > 0) {
      const first = firstPendingBySeverity(rows, pending)
      return step("warning", `Faltan datos en ${pending.size} riesgo(s)`, "Empieza por los más graves; «Siguiente pendiente» te lleva al próximo.", first ? { kind: "riesgo", entryId: first } : null, { kind: "filtro", completitud: "pendientes" })
    }
    if (input.status === "draft" || input.reviewState === "observed") return step("success", "Lista para enviar a revisión", "Usa «Enviar a revisión» en la cabecera.")
  }
  if (input.status === "published" && input.hasPendingChanges) return step("info", `Hay cambios sin revisar desde ${input.versionLabel}`, "Envíalos a revisión cuando estén listos.")
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- lib/prevention/miper/entry-navigation.test.ts lib/prevention/miper/risk-checks.test.ts lib/prevention/miper/next-step.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/entry-navigation.ts lib/prevention/miper/entry-navigation.test.ts lib/prevention/miper/risk-checks.ts lib/prevention/miper/risk-checks.test.ts lib/prevention/miper/next-step.ts lib/prevention/miper/next-step.test.ts
git commit -m "feat(miper): pasos del editor, recorrido entre riesgos, chequeo y siguiente paso"
```

---

### Task 3: Filtros y vistas en la URL

**Files:**
- Create: `lib/prevention/miper/matrix-filters.ts`, `lib/prevention/miper/workspace-url.ts`
- Modify: `lib/prevention/miper/grid-view.ts` (agregar `onlyComplete`)
- Test: `lib/prevention/miper/matrix-filters.test.ts`, `lib/prevention/miper/workspace-url.test.ts`, `lib/prevention/miper/grid-view.test.ts` (un caso nuevo)

**Interfaces:**
- Consumes: `GridFilters`, `EMPTY_FILTERS` y `filterRows` (`./grid-view`); `isEditorStep` / `EditorStep` (Task 2).
- Produces:
  - `parseMatrixFilters(params): GridFilters`, `matrixFilterPatch(filters): Record<string, string | null>`.
  - `matrixFilterChips(filters, factors): MatrixFilterChip[]`, `hasEntryFilters(filters): boolean`, `MATRIX_FILTER_KEYS`.
  - `readWorkspaceView(params): WorkspaceView`, `hrefToMatrix(pathname, params)`, `hrefToTask(pathname, params, key)`.
  - `hrefToEntry(pathname, params, entryId, step?)`, `hrefToTab(pathname, params, tab)`, `hrefToFicha(pathname, params, open)`, `hrefToMatrixWith(pathname, params, patch)`.
  - `WORKSPACE_TABS`, `WorkspaceTab`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/prevention/miper/matrix-filters.test.ts
import { describe, expect, it } from "vitest"
import { EMPTY_FILTERS } from "./grid-view"
import { hasEntryFilters, matrixFilterChips, matrixFilterPatch, parseMatrixFilters } from "./matrix-filters"

const params = (query: string) => new URLSearchParams(query)

describe("filtros de la matriz en la URL", () => {
  it("lee cada clave y descarta valores desconocidos", () => {
    const filters = parseMatrixFilters(params("buscar=lodo&clasificacion=foo,important,important&controlado=quizas&completitud=pendientes&marca=observados&factor=f1"))
    expect(filters).toEqual({ ...EMPTY_FILTERS, search: "lodo", classifications: ["important"], controlled: "all", onlyIncomplete: true, onlyObserved: true, factorId: "f1" })
  })
  it("ida y vuelta: patch → URL → mismos filtros; vacío borra todas las claves", () => {
    const filters = { ...EMPTY_FILTERS, classifications: ["important" as const, "intolerable" as const], controlled: "no" as const, onlyComplete: true, onlyModified: true }
    const patch = matrixFilterPatch(filters)
    const url = new URLSearchParams(Object.entries(patch).flatMap(([key, value]) => (value ? [[key, value]] : [])))
    expect(parseMatrixFilters(url)).toEqual(filters)
    expect(Object.values(matrixFilterPatch(EMPTY_FILTERS)).every((value) => value === null)).toBe(true)
  })
  it("chips legibles con la clave de la URL para quitarlos", () => {
    const chips = matrixFilterChips({ ...EMPTY_FILTERS, classifications: ["important"], factorId: "f1", onlyIncomplete: true }, [{ id: "f1", name: "Mecánico" }])
    expect(chips.map((chip) => [chip.key, chip.displayValue])).toEqual([["clasificacion", "Importante"], ["completitud", "Con pendientes"], ["factor", "Mecánico"]])
    expect(hasEntryFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasEntryFilters({ ...EMPTY_FILTERS, search: "x" })).toBe(true)
  })
})
```

```ts
// lib/prevention/miper/workspace-url.test.ts
import { describe, expect, it } from "vitest"
import { hrefToEntry, hrefToFicha, hrefToMatrix, hrefToMatrixWith, hrefToTab, hrefToTask, readWorkspaceView } from "./workspace-url"

const P = "/prevencion/miper/m1"
const params = (query: string) => new URLSearchParams(query)

describe("vistas del espacio de trabajo", () => {
  it("fila > tarea > pestaña; la matriz es la pestaña por defecto", () => {
    expect(readWorkspaceView(params("tab=programa&fila=e1&paso=medidas"))).toEqual({ tab: "matriz", taskKey: null, entryId: "e1", step: "medidas", ficha: false })
    expect(readWorkspaceView(params("tarea=k1"))).toMatchObject({ tab: "matriz", taskKey: "k1", entryId: null })
    expect(readWorkspaceView(params("tab=nada"))).toMatchObject({ tab: "matriz" })
    expect(readWorkspaceView(params("paso=x&fila=e1")).step).toBeNull()
  })
  it("`tab=antecedentes` (enlace heredado) abre la ficha", () => {
    expect(readWorkspaceView(params("tab=antecedentes"))).toMatchObject({ tab: "matriz", ficha: true })
    expect(readWorkspaceView(params("ficha=1")).ficha).toBe(true)
  })
  it("los enlaces conservan los filtros y limpian la vista anterior", () => {
    const current = params("clasificacion=important&tarea=k1&tab=revision")
    expect(hrefToEntry(P, current, "e9", "evaluacion")).toBe(`${P}?clasificacion=important&fila=e9&paso=evaluacion`)
    expect(hrefToTask(P, params("fila=e9&paso=medidas&buscar=lodo"), "k2")).toBe(`${P}?buscar=lodo&tarea=k2`)
    expect(hrefToMatrix(P, current)).toBe(`${P}?clasificacion=important`)
    expect(hrefToTab(P, current, "programa")).toBe(`${P}?clasificacion=important&tab=programa`)
    expect(hrefToTab(P, params("tab=revision"), "matriz")).toBe(P)
    expect(hrefToFicha(P, params("tarea=k1"), true)).toBe(`${P}?tarea=k1&ficha=1`)
    expect(hrefToFicha(P, params("tab=antecedentes&ficha=1"), false)).toBe(P)
    expect(hrefToMatrixWith(P, params("tab=revision&buscar=x"), { completitud: "pendientes" })).toBe(`${P}?buscar=x&completitud=pendientes`)
  })
})
```

Agregar este caso a `lib/prevention/miper/grid-view.test.ts` (dentro del `describe` de `filterRows`, junto a la fila de prueba que ya define ese archivo; adapta el nombre de la fábrica si difiere):

```ts
  it("onlyComplete deja sólo los riesgos sin errores", () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b" })]
    const visible = filterRows(rows, { ...EMPTY_FILTERS, onlyComplete: true }, { observed: new Set(), modified: new Set(), incomplete: new Set(["a"]) })
    expect(visible.map((row) => row.id)).toEqual(["b"])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/matrix-filters.test.ts lib/prevention/miper/workspace-url.test.ts lib/prevention/miper/grid-view.test.ts`
Expected: FAIL (módulos nuevos y `onlyComplete` inexistentes).

- [ ] **Step 3: Write minimal implementation**

`grid-view.ts`:
- Agregar `onlyComplete: boolean` al tipo `GridFilters` y `onlyComplete: false` a `EMPTY_FILTERS`.
- En `activeFilterCount`, sumar `+ (filters.onlyComplete ? 1 : 0)`.
- En `filterRows`, después de la línea de `onlyIncomplete`:

```ts
    if (filters.onlyComplete && ctx.incomplete?.has(row.id)) return false
```

```ts
// lib/prevention/miper/matrix-filters.ts
/**
 * Filtros de la matriz en la URL (spec §3). Las claves no chocan con las del
 * programa (`q`, `estado`, `frecuencia`), que comparte la misma URL.
 */
import { activeFilterCount, EMPTY_FILTERS, type GridFilters } from "./grid-view"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS, type RiskClassification } from "./methodology"
import { CONTROLLED_STATUS_LABEL } from "./snapshot"

export const MATRIX_FILTER_KEYS = ["buscar", "clasificacion", "completitud", "controlado", "factor", "marca"] as const
export type MatrixFilterKey = typeof MATRIX_FILTER_KEYS[number]
export type MatrixFilterChip = { key: MatrixFilterKey; label: string; value: string; displayValue: string }

const csv = (value: string | null) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean)

export function parseMatrixFilters(params: { get(key: string): string | null }): GridFilters {
  const classifications = [...new Set(csv(params.get("clasificacion")))]
    .filter((value): value is RiskClassification => (RISK_CLASSIFICATIONS as readonly string[]).includes(value))
  const controlled = params.get("controlado")
  const completeness = params.get("completitud")
  const marks = csv(params.get("marca"))
  return {
    ...EMPTY_FILTERS,
    search: (params.get("buscar") ?? "").slice(0, 200),
    classifications,
    controlled: controlled === "yes" || controlled === "partial" || controlled === "no" ? controlled : "all",
    factorId: params.get("factor") || "all",
    onlyObserved: marks.includes("observados"),
    onlyModified: marks.includes("modificados"),
    onlyIncomplete: completeness === "pendientes",
    onlyComplete: completeness === "completos",
  }
}

export function matrixFilterPatch(filters: GridFilters): Record<MatrixFilterKey, string | null> {
  const marks = [filters.onlyObserved ? "observados" : null, filters.onlyModified ? "modificados" : null].filter(Boolean).join(",")
  return {
    buscar: filters.search.trim() || null,
    clasificacion: filters.classifications.length ? filters.classifications.join(",") : null,
    completitud: filters.onlyIncomplete ? "pendientes" : filters.onlyComplete ? "completos" : null,
    controlado: filters.controlled === "all" ? null : filters.controlled,
    factor: filters.factorId === "all" ? null : filters.factorId,
    marca: marks || null,
  }
}

export function hasEntryFilters(filters: GridFilters): boolean {
  return activeFilterCount(filters) > 0
}

export function matrixFilterChips(filters: GridFilters, factors: ReadonlyArray<{ id: string; name: string }>): MatrixFilterChip[] {
  const chips: MatrixFilterChip[] = []
  if (filters.search.trim()) chips.push({ key: "buscar", label: "Búsqueda", value: filters.search, displayValue: `«${filters.search.trim()}»` })
  if (filters.classifications.length) chips.push({ key: "clasificacion", label: "Clasificación", value: filters.classifications.join(","), displayValue: filters.classifications.map((c) => CLASSIFICATION_LABEL[c]).join(", ") })
  if (filters.onlyIncomplete || filters.onlyComplete) chips.push({ key: "completitud", label: "Estado", value: filters.onlyIncomplete ? "pendientes" : "completos", displayValue: filters.onlyIncomplete ? "Con pendientes" : "Completos" })
  if (filters.controlled !== "all") chips.push({ key: "controlado", label: "¿Controlado?", value: filters.controlled, displayValue: CONTROLLED_STATUS_LABEL[filters.controlled] })
  if (filters.factorId !== "all") chips.push({ key: "factor", label: "Factor", value: filters.factorId, displayValue: factors.find((factor) => factor.id === filters.factorId)?.name ?? "Factor" })
  if (filters.onlyObserved || filters.onlyModified) chips.push({ key: "marca", label: "Marcas", value: "", displayValue: [filters.onlyObserved && "Observados", filters.onlyModified && "Modificados"].filter(Boolean).join(", ") })
  return chips
}
```

```ts
// lib/prevention/miper/workspace-url.ts
/**
 * Contrato de URL del espacio de trabajo (spec §3). Prioridad: `fila` > `tarea`
 * > `tab`. Los enlaces conservan los filtros y limpian la vista anterior.
 */
import { isEditorStep, type EditorStep } from "./entry-navigation"

export const WORKSPACE_TABS = ["matriz", "programa", "revision", "historial"] as const
export type WorkspaceTab = typeof WORKSPACE_TABS[number]
export type WorkspaceView = { tab: WorkspaceTab; taskKey: string | null; entryId: string | null; step: EditorStep | null; ficha: boolean }

type Params = { get(key: string): string | null; toString(): string }

export function readWorkspaceView(params: Params): WorkspaceView {
  const rawTab = params.get("tab")
  const entryId = params.get("fila") || null
  const taskKey = entryId ? null : params.get("tarea") || null
  const tab: WorkspaceTab = entryId || taskKey ? "matriz" : (WORKSPACE_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as WorkspaceTab) : "matriz"
  const step = params.get("paso")
  return { tab, taskKey, entryId, step: entryId && isEditorStep(step) ? step : null, ficha: params.get("ficha") === "1" || rawTab === "antecedentes" }
}

function href(pathname: string, params: Params, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(params.toString())
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }
  const query = next.toString()
  return query ? `${pathname}?${query}` : pathname
}

const CLEAR_VIEW = { tab: null, tarea: null, fila: null, paso: null } as const

export const hrefToMatrix = (pathname: string, params: Params) => href(pathname, params, { ...CLEAR_VIEW, ficha: null })
export const hrefToTask = (pathname: string, params: Params, taskKey: string) => href(pathname, params, { ...CLEAR_VIEW, tarea: taskKey })
export const hrefToEntry = (pathname: string, params: Params, entryId: string, step?: EditorStep) => href(pathname, params, { ...CLEAR_VIEW, fila: entryId, paso: step ?? null })
export const hrefToTab = (pathname: string, params: Params, tab: WorkspaceTab) => href(pathname, params, { ...CLEAR_VIEW, tab: tab === "matriz" ? null : tab })
/** Abre o cierra la ficha sin tocar la vista; borra el alias heredado `tab=antecedentes`. */
export const hrefToFicha = (pathname: string, params: Params, open: boolean) =>
  href(pathname, params, { ficha: open ? "1" : null, ...(params.get("tab") === "antecedentes" ? { tab: null } : {}) })
/** La matriz (estructura) con filtros extra: lo usa la acción «Ver los pendientes» del siguiente paso. */
export const hrefToMatrixWith = (pathname: string, params: Params, patch: Record<string, string | null>) =>
  href(pathname, params, { ...CLEAR_VIEW, ...patch })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- lib/prevention/miper/matrix-filters.test.ts lib/prevention/miper/workspace-url.test.ts lib/prevention/miper/grid-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/matrix-filters.ts lib/prevention/miper/matrix-filters.test.ts lib/prevention/miper/workspace-url.ts lib/prevention/miper/workspace-url.test.ts lib/prevention/miper/grid-view.ts lib/prevention/miper/grid-view.test.ts
git commit -m "feat(miper): filtros de la matriz y vistas del espacio de trabajo en la URL"
```

---

### Task 4: `Combobox` con valor libre

**Files:**
- Modify: `components/ui/combobox.tsx`
- Test: `components/ui/combobox.test.tsx` (nuevo)

**Interfaces:**
- Produces: dos props nuevas, `allowCustomValue?: boolean` (por defecto `false`) y `"aria-label"?: string`. Los 8 consumidores actuales no cambian.

- [ ] **Step 1: Write the failing test**

```tsx
// components/ui/combobox.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Combobox } from "./combobox"

const OPTIONS = ["Camión en pendiente", "Ruido de motor"].map((value) => ({ value, label: value }))
const input = () => screen.getByRole("combobox", { name: "Peligro" }) as HTMLInputElement

describe("Combobox", () => {
  it("sin allowCustomValue, un texto que no está en la lista no cambia el valor", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="" onChange={onChange} />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "Otro peligro" } })
    fireEvent.blur(input())
    expect(onChange).not.toHaveBeenCalled()
  })

  it("con allowCustomValue ofrece «Usar «texto»» y Enter lo confirma", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="" onChange={onChange} allowCustomValue />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "Polvo en suspensión" } })
    expect(screen.getByRole("option", { name: "Usar «Polvo en suspensión»" })).toBeTruthy()
    fireEvent.keyDown(input(), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("Polvo en suspensión")
  })

  it("al salir del campo confirma lo escrito, recortado", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="" onChange={onChange} allowCustomValue />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "  Polvo  " } })
    fireEvent.blur(input())
    expect(onChange).toHaveBeenCalledWith("Polvo")
  })

  it("al enfocar deja editar el valor actual; salir sin escribir no cambia nada y vaciar lo borra", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="Polvo" onChange={onChange} allowCustomValue />)
    expect(input().value).toBe("Polvo")
    fireEvent.focus(input())
    expect(input().value).toBe("Polvo")
    fireEvent.blur(input())
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "" } })
    fireEvent.blur(input())
    expect(onChange).toHaveBeenCalledWith("")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- components/ui/combobox.test.tsx`
Expected: FAIL. El combobox no tiene nombre accesible ("Peligro") y no existe la opción "Usar «…»".

- [ ] **Step 3: Write minimal implementation**

En `ComboboxProps`, agregar:

```ts
  /**
   * Acepta un texto que no está en `options`: los diccionarios de la MIPER se
   * alimentan de lo que se escribe (spec MIPER 2026-10-02 §6.1). Muestra «Usar
   * «texto»» y, al salir del campo, confirma lo escrito. Al enfocarlo, el campo
   * conserva el valor actual para corregirlo en vez de vaciarse.
   */
  allowCustomValue?: boolean
  "aria-label"?: string
```

En el cuerpo de `Combobox`:
- Desestructurar `allowCustomValue = false`.
- Reemplazar el cálculo de `visible` y de `rows`, y los manejadores de `onFocus` y `onBlur`:

```ts
  const currentText = selected?.label ?? (allowCustomValue ? value : "")
  // Sin escribir, la lista no se filtra por el valor actual: se ve completa.
  const filterText = allowCustomValue && query === currentText ? "" : query

  const visible = React.useMemo(() => {
    const needle = normalize(filterText.trim())
    if (!needle) return options.slice(0, maxVisible)
    return options
      .filter((option) => normalize(`${option.label} ${option.hint ?? ""}`).includes(needle))
      .slice(0, maxVisible)
  }, [options, filterText, maxVisible])

  const typed = query.trim()
  const customRow: ComboboxOption[] = allowCustomValue && typed && typed !== currentText
    && !options.some((option) => normalize(option.label) === normalize(typed))
    ? [{ value: typed, label: `Usar «${typed}»` }]
    : []
  const rows: ComboboxOption[] = clearLabel && !query.trim()
    ? [{ value: "", label: clearLabel }, ...visible]
    : [...customRow, ...visible]
```

```tsx
          aria-label={rest["aria-label"]}
          value={listbox.open ? query : currentText}
          onFocus={() => {
            if (disabled) return
            if (allowCustomValue) setQuery(currentText)
            listbox.setOpen(true)
          }}
          onBlur={(event) => {
            if (!listbox.focusLeft(event)) return
            if (allowCustomValue && query.trim() !== currentText) onChange(query.trim())
            setQuery("")
            listbox.close()
          }}
```

- Borrar la constante `inputValue`, que queda reemplazada por la expresión de `value`.
- En el `<li>`, cambiar la `key` a ``key={customRow.length && index === 0 ? "__custom__" : row.value || "__clear__"}``.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- components/ui/combobox.test.tsx`
Expected: PASS (4 tests). Después, `npm run typecheck`: los 8 consumidores deben compilar sin cambios.

- [ ] **Step 5: Commit**

```bash
git add components/ui/combobox.tsx components/ui/combobox.test.tsx
git commit -m "feat(ui): Combobox acepta un valor libre y un nombre accesible propio"
```

---

### Task 5: `ChoiceCardGroup` y `PcChoice`

**Files:**
- Create: `components/ui/choice-card-group.tsx`, `components/prevention/pc-choice.tsx`
- Test: `components/ui/choice-card-group.test.tsx`, `components/prevention/pc-choice.test.tsx`

**Interfaces:**
- Consumes: `SelectableCard`, `SelectableCardTitle` y `SelectableCardDescription` (`./selectable-card`); `PROBABILITY_LEVELS`, `CONSEQUENCE_LEVELS`, `classify`, `magnitudeOf`, `isScaleValue`, `CLASSIFICATION_CRITERIA` y `MiperScaleValue` (`@/lib/prevention/miper/methodology`); `RiskClassificationBadge`.
- Produces: `ChoiceCardGroup<T>({ label, options: ChoiceCardOption<T>[], value, onChange, disabled?, className? })`; `PcChoice({ probability, consequence, onChange(patch), disabled? })`, con `patch: { probability?: MiperScaleValue; consequence?: MiperScaleValue }`.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/ui/choice-card-group.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChoiceCardGroup } from "./choice-card-group"

const OPTIONS = [{ value: "yes", title: "Sí" }, { value: "partial", title: "Parcialmente" }, { value: "no", title: "No" }] as const

describe("ChoiceCardGroup", () => {
  it("es un radiogroup con una sola tarjeta tabulable y avisa al elegir otra", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="¿Está controlado?" options={[...OPTIONS]} value="partial" onChange={onChange} />)
    const radios = screen.getAllByRole("radio")
    expect(screen.getByRole("radiogroup", { name: "¿Está controlado?" })).toBeTruthy()
    expect(radios.map((radio) => radio.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"])
    fireEvent.click(screen.getByRole("radio", { name: "Parcialmente" }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("radio", { name: "No" }))
    expect(onChange).toHaveBeenCalledWith("no")
  })
  it("las flechas mueven la selección y dan la vuelta", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="no" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "No" }), { key: "ArrowRight" })
    expect(onChange).toHaveBeenCalledWith("yes")
  })
})
```

```tsx
// components/prevention/pc-choice.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PcChoice } from "./pc-choice"

describe("PcChoice", () => {
  it("ofrece Baja, Media y Alta (1, 2, 4) para P y C con el texto del RE-04", () => {
    render(<PcChoice probability={null} consequence={null} onChange={() => {}} />)
    const probability = screen.getByRole("radiogroup", { name: "Probabilidad" })
    expect([...probability.querySelectorAll("[role=radio]")].map((radio) => radio.querySelector("p")?.textContent)).toEqual(["1 · Baja", "2 · Media", "4 · Alta"])
    expect(screen.getByText(/Elige probabilidad y consecuencia/)).toBeTruthy()
  })
  it("devuelve sólo el eje que cambió", () => {
    const onChange = vi.fn()
    render(<PcChoice probability={2} consequence={4} onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: /^4 · Alta(?! \()/ }))
    expect(onChange).toHaveBeenCalledWith({ probability: 4 })
  })
  it("4 × 4 muestra MR 16, Intolerable y su criterio", () => {
    render(<PcChoice probability={4} consequence={4} onChange={() => {}} />)
    const status = screen.getByRole("status")
    expect(status.textContent).toMatch(/16/)
    expect(status.textContent).toMatch(/Intolerable/)
    expect(status.textContent).toMatch(/se debe prohibir el trabajo/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- components/ui/choice-card-group.test.tsx components/prevention/pc-choice.test.tsx`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/ui/choice-card-group.tsx
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { SelectableCard, SelectableCardDescription, SelectableCardTitle } from "./selectable-card"

export type ChoiceCardOption<T extends string | number> = { value: T; title: string; description?: string }

/**
 * Grupo de radio hecho de `SelectableCard`. `SelectableCard` deja en manos de
 * quien lo usa el patrón de radio del WAI-ARIA (una sola tarjeta en el orden de
 * tabulación, flechas para moverse y elegir); este componente lo implementa una
 * vez. Lo usan P×C, «¿Está controlado?» y «¿Rutinaria?» de la MIPER.
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
  const selectedIndex = options.findIndex((option) => option.value === value)
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
    if (delta === 0 || disabled) return
    event.preventDefault()
    const next = (index + delta + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next]!.value)
  }

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={cn("grid gap-2 sm:grid-cols-3", className)}>
      {options.map((option, index) => (
        <SelectableCard
          key={String(option.value)}
          ref={(node) => { refs.current[index] = node }}
          selected={option.value === value}
          tabIndex={index === tabbable ? 0 : -1}
          disabled={disabled}
          onClick={() => { if (option.value !== value) onChange(option.value) }}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <SelectableCardTitle className="whitespace-normal">{option.title}</SelectableCardTitle>
          {option.description && <SelectableCardDescription className="mt-1">{option.description}</SelectableCardDescription>}
        </SelectableCard>
      ))}
    </div>
  )
}
```

```tsx
// components/prevention/pc-choice.tsx
"use client"

import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import {
  CLASSIFICATION_CRITERIA, CONSEQUENCE_LEVELS, PROBABILITY_LEVELS, classify, isScaleValue, magnitudeOf,
  type MiperScaleValue, type RiskClassification,
} from "@/lib/prevention/miper/methodology"
import { cn } from "@/lib/utils"

const TONE: Record<RiskClassification, string> = {
  tolerable: "bg-[var(--color-success-tint)]",
  moderate: "bg-[var(--color-warning-tint)]",
  important: "bg-[var(--color-danger-tint)]",
  intolerable: "bg-[var(--color-danger-tint)] border border-[var(--color-danger)]",
}
const probabilityOptions = PROBABILITY_LEVELS.map((level) => ({ value: level.value, title: `${level.value} · ${level.label}`, description: level.description }))
const consequenceOptions = CONSEQUENCE_LEVELS.map((level) => ({ value: level.value, title: `${level.value} · ${level.label}`, description: level.description }))

/**
 * Evaluación P×C del RE-04 (spec MIPER 2026-10-02 §6.3). Reemplaza al
 * `PcSelect` de la grilla: la persona elige leyendo el criterio, no un número
 * suelto. MR y clasificación se calculan al instante con `classify()`; la
 * columna generada de la base sigue siendo la autoridad.
 */
export function PcChoice({ probability, consequence, onChange, disabled = false }: {
  probability: number | null
  consequence: number | null
  onChange: (patch: { probability?: MiperScaleValue; consequence?: MiperScaleValue }) => void
  disabled?: boolean
}) {
  const p = isScaleValue(probability) ? probability : null
  const c = isScaleValue(consequence) ? consequence : null
  const classification = classify(p, c)
  const magnitude = magnitudeOf(p, c)
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Probabilidad</p>
        <ChoiceCardGroup label="Probabilidad" options={probabilityOptions} value={p} onChange={(value) => onChange({ probability: value })} disabled={disabled} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Consecuencia</p>
        <ChoiceCardGroup label="Consecuencia" options={consequenceOptions} value={c} onChange={(value) => onChange({ consequence: value })} disabled={disabled} />
      </div>
      <div role="status" aria-live="polite" className={cn("rounded-xl p-4", classification ? TONE[classification] : "bg-[var(--color-surface-2)]")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{magnitude ?? "—"}</span>{" "}
            <span className="text-[var(--color-text-subtle)]">magnitud del riesgo (P × C, máximo 16)</span>
          </p>
          <RiskClassificationBadge classification={classification} magnitude={magnitude} />
        </div>
        <p className="mt-2 text-sm">{classification ? CLASSIFICATION_CRITERIA[classification] : "Elige probabilidad y consecuencia para calcular la magnitud del riesgo."}</p>
      </div>
      <p className="text-xs text-[var(--color-text-subtle)]">Bandas del RE-04: 1–2 Tolerable · 4 Moderado · 8 Importante · 16 Intolerable</p>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- components/ui/choice-card-group.test.tsx components/prevention/pc-choice.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/choice-card-group.tsx components/ui/choice-card-group.test.tsx components/prevention/pc-choice.tsx components/prevention/pc-choice.test.tsx
git commit -m "feat(miper): selector P×C por tarjetas con el criterio del RE-04"
```

---

### Task 6: Guardado automático del editor con reversión

**Files:**
- Create: `lib/prevention/miper/entry-values.ts`, `app/(app)/prevencion/miper/[id]/use-entry-autosave.ts`
- Modify: `app/(app)/prevencion/miper/[id]/use-row-saver.ts` (exponer `versionOf`)
- Test: `lib/prevention/miper/entry-values.test.ts`, `app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts`

**Interfaces:**
- Consumes: `useRowSaver` (existente), `classify` / `magnitudeOf`, `MiperEntryValues` (`@/lib/validation/prevention-module/miper`).
- Produces:
  - `applyEntryValues(entry, values, riskFactors)`, `revertEntryFields(current, previous, fields)`.
  - `useEntryAutosave({ matrixId, entryVersions, setRows, riskFactors }): EntryAutosave`, con `EntryAutosave = { commit(entry, values): Promise<boolean>; status: SaveStatus; fieldError(entryId, field): string | undefined; versionOf(entryId): number | undefined }`.
  - `SaveStatus = { state: "idle" | "saving" | "saved" | "error"; savedAt: number | null; message: string | null }`.
  - `useRowSaver(...)` también devuelve `versionOf(entryId)`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/prevention/miper/entry-values.test.ts
import { describe, expect, it } from "vitest"
import { applyEntryValues, revertEntryFields } from "./entry-values"
import type { MiperEntrySnapshot } from "./snapshot"

const entry = { id: "e", probability: 2, consequence: 2, magnitude: 4, classification: "moderate", riskFactorId: "f1", riskFactor: "Mecánico", hazard: "H" } as MiperEntrySnapshot
const factors = [{ id: "f1", name: "Mecánico" }, { id: "f2", name: "Eléctrico" }]

describe("entry-values", () => {
  it("aplica valores, reclasifica y resuelve el nombre del factor", () => {
    const next = applyEntryValues(entry, { probability: 4, riskFactorId: "f2" }, factors)
    expect(next).toMatchObject({ probability: 4, magnitude: 8, classification: "important", riskFactor: "Eléctrico", hazard: "H" })
  })
  it("revierte sólo los campos indicados y vuelve a clasificar", () => {
    const changed = applyEntryValues(entry, { probability: 4, hazard: "X" }, factors)
    expect(revertEntryFields(changed, entry, ["probability"])).toMatchObject({ probability: 2, classification: "moderate", hazard: "X" })
  })
})
```

```ts
// app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { useEntryAutosave } from "./use-entry-autosave"

const entry = { id: "e1", rowNumber: 1, probability: 2, consequence: 2, magnitude: 4, classification: "moderate", riskFactorId: null, riskFactor: null } as MiperEntrySnapshot

function setup() {
  let rows: MiperEntrySnapshot[] = [entry]
  const setRows = (updater: (current: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => { rows = updater(rows) }
  const hook = renderHook(() => useEntryAutosave({ matrixId: "m1", entryVersions: { e1: 1 }, setRows, riskFactors: [] }))
  return { hook, rows: () => rows }
}

describe("useEntryAutosave", () => {
  beforeEach(() => saveMiperEntryAction.mockReset())

  it("guarda de forma optimista y queda en «guardado» con la versión nueva", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { version: 2, magnitude: 8, classification: "important" } })
    const { hook, rows } = setup()
    let ok = false
    await act(async () => { ok = await hook.result.current.commit(entry, { probability: 4 }) })
    expect(ok).toBe(true)
    expect(rows()[0]).toMatchObject({ probability: 4, classification: "important" })
    expect(hook.result.current.status.state).toBe("saved")
    expect(hook.result.current.versionOf("e1")).toBe(2)
  })

  it("si el servidor rechaza, revierte el campo y deja el mensaje en ese campo", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: false, message: "La fila cambió mientras la editabas. Recarga la matriz." })
    const { hook, rows } = setup()
    await act(async () => { await hook.result.current.commit(entry, { probability: 4 }) })
    expect(rows()[0]).toMatchObject({ probability: 2, classification: "moderate" })
    expect(hook.result.current.fieldError("e1", "probability")).toMatch(/cambió mientras la editabas/)
    expect(hook.result.current.status).toMatchObject({ state: "error" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- lib/prevention/miper/entry-values.test.ts "app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts"`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Write minimal implementation**

En `use-row-saver.ts`, antes del `return`, agregar el getter y exponerlo:

```ts
  /** Versión conocida de una fila: la que debe viajar al borrarla después de editarla. */
  const versionOf = useCallback((entryId: string) => versions.current[entryId], [])

  return { save, sync, versionOf }
```

```ts
// lib/prevention/miper/entry-values.ts
/** Cambio optimista de un riesgo: aplicar o revertir campos y reclasificar con la regla de la columna generada. */
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { classify, magnitudeOf } from "./methodology"
import type { MiperEntrySnapshot } from "./snapshot"

const reclassify = (entry: MiperEntrySnapshot): MiperEntrySnapshot => ({
  ...entry,
  magnitude: magnitudeOf(entry.probability, entry.consequence),
  classification: classify(entry.probability, entry.consequence),
})

export function applyEntryValues(entry: MiperEntrySnapshot, values: MiperEntryValues, riskFactors: ReadonlyArray<{ id: string; name: string }>): MiperEntrySnapshot {
  const next = { ...entry, ...values } as MiperEntrySnapshot
  if ("riskFactorId" in values) next.riskFactor = riskFactors.find((factor) => factor.id === values.riskFactorId)?.name ?? null
  return reclassify(next)
}

export function revertEntryFields(current: MiperEntrySnapshot, previous: MiperEntrySnapshot, fields: readonly string[]): MiperEntrySnapshot {
  const next: Record<string, unknown> = { ...current }
  for (const field of fields) {
    next[field] = (previous as unknown as Record<string, unknown>)[field]
    if (field === "riskFactorId") next.riskFactor = previous.riskFactor
  }
  return reclassify(next as unknown as MiperEntrySnapshot)
}
```

```ts
// app/(app)/prevencion/miper/[id]/use-entry-autosave.ts
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { applyEntryValues, revertEntryFields } from "@/lib/prevention/miper/entry-values"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { useRowSaver } from "./use-row-saver"

export type SaveStatus = { state: "idle" | "saving" | "saved" | "error"; savedAt: number | null; message: string | null }
export type EntryAutosave = {
  commit: (entry: MiperEntrySnapshot, values: MiperEntryValues) => Promise<boolean>
  status: SaveStatus
  fieldError: (entryId: string, field: string) => string | undefined
  versionOf: (entryId: string) => number | undefined
}

/**
 * Guardado del editor del riesgo (spec §5.5). Encima de la cola por fila de
 * `useRowSaver`: cambia la fila al instante, la reclasifica y, si el servidor
 * rechaza, REVIERTE esos campos y deja el motivo en el campo. La grilla dejaba
 * en pantalla el valor no guardado (H5 del diagnóstico).
 */
export function useEntryAutosave({ matrixId, entryVersions, setRows, riskFactors }: {
  matrixId: string
  entryVersions: Record<string, number>
  setRows: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  riskFactors: ReadonlyArray<{ id: string; name: string }>
}): EntryAutosave {
  const { save, sync, versionOf } = useRowSaver(matrixId, entryVersions)
  useEffect(() => { sync(entryVersions) }, [entryVersions, sync])
  const [status, setStatus] = useState<SaveStatus>({ state: "idle", savedAt: null, message: null })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const inFlight = useRef(0)

  const commit = useCallback(async (entry: MiperEntrySnapshot, values: MiperEntryValues) => {
    const fields = Object.keys(values)
    if (fields.length === 0) return true
    setRows((rows) => rows.map((row) => (row.id === entry.id ? applyEntryValues(row, values, riskFactors) : row)))
    inFlight.current += 1
    setStatus((current) => ({ ...current, state: "saving", message: null }))
    const result = await save(entry.id, values)
    inFlight.current -= 1
    const keys = fields.map((field) => `${entry.id}.${field}`)
    if (!result.ok) {
      setRows((rows) => rows.map((row) => (row.id === entry.id ? revertEntryFields(row, entry, fields) : row)))
      setErrors((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, result.message])) }))
      setStatus({ state: "error", savedAt: null, message: result.message })
      return false
    }
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key))))
    if (inFlight.current === 0) setStatus({ state: "saved", savedAt: Date.now(), message: null })
    return true
  }, [riskFactors, save, setRows])

  const fieldError = useCallback((entryId: string, field: string) => errors[`${entryId}.${field}`], [errors])
  return { commit, status, fieldError, versionOf }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- lib/prevention/miper/entry-values.test.ts "app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts" "app/(app)/prevencion/miper/[id]/use-row-saver.test.ts"`
Expected: PASS. `use-row-saver.test.ts` sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/prevention/miper/entry-values.ts lib/prevention/miper/entry-values.test.ts "app/(app)/prevencion/miper/[id]/use-entry-autosave.ts" "app/(app)/prevencion/miper/[id]/use-entry-autosave.test.ts" "app/(app)/prevencion/miper/[id]/use-row-saver.ts"
git commit -m "feat(miper): guardado del editor que revierte el campo rechazado y anuncia su estado"
```

---

### Task 7: Medida de control: formulario y tarjeta con borrado confirmado

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/control-form.tsx`, `app/(app)/prevencion/miper/[id]/control-card.tsx`
- Test: `app/(app)/prevencion/miper/[id]/control-card.test.tsx`

**Interfaces:**
- Consumes: `saveMiperControlAction` (`../actions`), `CONTROL_HIERARCHY_LABEL`, `MiperControlSnapshot`, `ControlHierarchy`, `OptionSelect`, `Combobox` (Task 4), `DatePicker`, `ConfirmDialog`, `formatDate`.
- Produces:
  - `ControlForm({ matrixId, entryId, control, controlVersion, responsibleOptions, measureSuggestions, onDone, onCancel })`.
  - `ControlCard({ control, linkedActionNumbers, editable, verifyHref, onEdit, onDelete, deleting })`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/(app)/prevencion/miper/[id]/control-card.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { ControlCard } from "./control-card"

const control: MiperControlSnapshot = { id: "c1", hierarchy: "ppe", description: "Uso de casco y guantes", responsibleUserId: null, responsibleName: "Supervisor", dueDate: "2026-10-30", status: "proposed" }

describe("ControlCard", () => {
  it("muestra tipo, responsable, plazo y actividades del programa", () => {
    render(<ControlCard control={control} linkedActionNumbers={[3]} editable verifyHref={null} onEdit={() => {}} onDelete={() => {}} deleting={false} />)
    expect(screen.getByText("V. Elementos de protección personal")).toBeTruthy()
    expect(screen.getByText(/Responsable: Supervisor · Plazo: 30-10-2026/)).toBeTruthy()
    expect(screen.getByText("En el programa: Actividad #3")).toBeTruthy()
  })
  it("eliminar pide confirmación antes de llamar a onDelete", () => {
    const onDelete = vi.fn()
    render(<ControlCard control={control} linkedActionNumbers={[]} editable verifyHref={null} onEdit={() => {}} onDelete={onDelete} deleting={false} />)
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar la medida/ }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Eliminar medida" }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
```

> Si `formatDate` no rinde `30-10-2026` (revisa `lib/utils`), ajusta sólo la expectativa de
> fecha al formato real de `formatDate("2026-10-30")`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/control-card.test.tsx"`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/(app)/prevencion/miper/[id]/control-card.tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CONTROL_HIERARCHY_LABEL, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { formatDate } from "@/lib/utils"

export function ControlCard({ control, linkedActionNumbers, editable, verifyHref, onEdit, onDelete, deleting }: {
  control: MiperControlSnapshot
  linkedActionNumbers: readonly number[]
  editable: boolean
  verifyHref: string | null
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const short = control.description.length > 60 ? `${control.description.slice(0, 60)}…` : control.description
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
          <Button size="sm" variant="secondary" aria-label={`Editar la medida: ${short}`} onClick={onEdit}>Editar</Button>
          <Button size="sm" variant="ghost" aria-label={`Eliminar la medida: ${short}`} onClick={() => setConfirming(true)}>Eliminar</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming} onOpenChange={setConfirming}
        title="Eliminar la medida" description={`Se elimina «${short}». El cambio queda en el historial de la MIPER.`}
        confirmLabel="Eliminar medida" variant="destructive" loading={deleting}
        onConfirm={() => { onDelete(); setConfirming(false) }}
      />
    </article>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/control-form.tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy, type MiperControlSnapshot } from "@/lib/prevention/miper/snapshot"
import { saveMiperControlAction } from "../actions"

const HIERARCHY_OPTIONS = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>).map(([value, label]) => ({ value, label }))
const OTHER = "__otra__"

/**
 * Alta y edición de una medida (spec §6.2). Sale de la ficha antigua
 * (`entry-sheet.tsx`) conservando los nombres accesibles que usan las E2E:
 * «Tipo de control», «Descripción de la medida», «Nombre o cargo
 * responsable», «Plazo de la medida».
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
  const [description, setDescription] = useState(control?.description ?? "")
  const [responsibleUserId, setResponsibleUserId] = useState(control?.responsibleUserId ?? "")
  const [responsibleName, setResponsibleName] = useState(control?.responsibleUserId ? "" : control?.responsibleName ?? "")
  const [dueDate, setDueDate] = useState(control?.dueDate ?? "")
  const operation = useOperation({ feedback: "toast", onSuccess: onDone })
  const save = () => operation.run(() => saveMiperControlAction({
    matrixId, entryId, controlId: control?.id, expectedVersion: control ? controlVersion : undefined,
    values: {
      hierarchy, description: description.trim(),
      responsibleUserId: responsibleUserId || null,
      responsibleName: responsibleUserId ? null : responsibleName.trim() || null,
      dueDate: dueDate || null,
    },
  }))
  return (
    <div role="group" aria-label={control ? "Editar medida de control" : "Nueva medida de control"} className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-2">
      <Field label="Tipo de control (jerarquía)" required>
        <OptionSelect aria-label="Tipo de control" options={HIERARCHY_OPTIONS} value={hierarchy} onValueChange={(value) => setHierarchy(value as ControlHierarchy)} />
      </Field>
      <Field label="Plazo" required helper="Fecha en que la medida debe estar implementada.">
        <DatePicker ariaLabel="Plazo de la medida" value={dueDate || undefined} onChange={setDueDate} />
      </Field>
      <Field label="Medida de control" required className="md:col-span-2">
        <Textarea aria-label="Descripción de la medida" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={3000} />
      </Field>
      {measureSuggestions.length > 0 && (
        <Field label="Usar una medida ya escrita en esta MIPER" className="md:col-span-2">
          <Combobox aria-label="Usar una medida ya escrita" options={measureSuggestions.map((value) => ({ value, label: value }))} value="" onChange={(value) => { if (value) setDescription(value) }} placeholder="Buscar medida…" />
        </Field>
      )}
      <Field label="Responsable">
        <OptionSelect
          aria-label="Responsable de la medida"
          options={[...responsibleOptions.map((option) => ({ value: option.id, label: option.name })), { value: OTHER, label: "Otra persona o cargo…" }]}
          value={responsibleUserId || OTHER}
          onValueChange={(value) => setResponsibleUserId(value === OTHER ? "" : value)}
        />
      </Field>
      {!responsibleUserId && (
        <Field label="Nombre o cargo responsable">
          <Input aria-label="Nombre o cargo responsable" value={responsibleName} onChange={(event) => setResponsibleName(event.target.value)} placeholder="Supervisor de turno" maxLength={300} />
        </Field>
      )}
      <div className="flex gap-2 md:col-span-2">
        <Button size="sm" loading={operation.pending} disabled={description.trim().length < 3} onClick={save}>{control ? "Guardar medida" : "Agregar medida"}</Button>
        <Button size="sm" variant="secondary" disabled={operation.pending} onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/control-card.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/prevencion/miper/[id]/control-form.tsx" "app/(app)/prevencion/miper/[id]/control-card.tsx" "app/(app)/prevencion/miper/[id]/control-card.test.tsx"
git commit -m "feat(miper): medida de control como tarjeta con edición y borrado confirmado"
```

---

### Task 8: Editor del riesgo

**Files:**
- Create in `app/(app)/prevencion/miper/[id]/risk-editor/`:
  - `types.ts`
  - `save-status.tsx`
  - `identification-step.tsx`
  - `evaluation-step.tsx`
  - `measures-step.tsx`
  - `follow-up-step.tsx`
  - `risk-aside.tsx`
  - `risk-editor.tsx`
- Test: `app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx`

**Interfaces:**
- Consumes:
  - De las tareas anteriores: `EntryAutosave` (Task 6), `PcChoice` y `ChoiceCardGroup` (Task 5), `Combobox` (Task 4), `ControlForm` / `ControlCard` (Task 7), `riskChecks` (Task 2) y los helpers `hrefTo*` (Task 3).
  - Existentes: `ObservationItem` (`../observation-item`), las acciones `duplicateMiperEntryAction`, `deleteMiperEntryAction`, `deleteMiperControlAction` y `addMiperObservationAction`, y `ENTRY_FIELD_LABEL`, `CONTROLLED_STATUS_LABEL` y `diff` (`changesByEntry` lo calcula el workspace).
- Produces: `RiskEditor(props: RiskEditorProps)` y `RiskEditorData`. Lo monta el workspace (Task 11) con `key={entryId}`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx
// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("fila=e1") }))
vi.mock("../../actions", () => ({ duplicateMiperEntryAction: vi.fn(), deleteMiperEntryAction: vi.fn(), deleteMiperControlAction: vi.fn(), addMiperObservationAction: vi.fn(), saveMiperControlAction: vi.fn(), respondMiperObservationAction: vi.fn(), resolveMiperObservationAction: vi.fn(), reopenMiperObservationAction: vi.fn() }))

import { RiskEditor, type RiskEditorProps } from "./risk-editor"

const entry = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
  id, rowNumber, activity: "Transporte", task: "Carga", position: "Conductor", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "R", probableDamage: "D",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [], ...overrides,
}) as MiperEntrySnapshot
const mode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: false, readOnlyReason: null } as WorkspaceMode
const commit = vi.fn(async () => true)
const props = (overrides: Partial<RiskEditorProps> = {}): RiskEditorProps => ({
  data: { matrixId: "m1", published: false, riskFactors: [{ id: "f1", name: "Mecánico", isActive: true }], dictionaries: { activities: [], tasks: [], positions: [], locations: [], hazards: [], risks: [], damages: [], measures: [] }, responsibleOptions: [], controlVersions: {}, controlActionLinks: [], observations: [] },
  rows: [entry("e1", 1), entry("e2", 2), entry("e3", 3, { task: "Otra" })],
  entryId: "e1", step: null,
  issuesByEntry: new Map([["e1", [{ scope: "entry", entryId: "e1", field: "controls", message: "Un riesgo Importante o Intolerable exige al menos una medida de control.", severity: "error" }]]]),
  incomplete: new Set(["e1", "e3"]), matching: null, editable: true, mode, change: null, baselineEntry: null,
  autosave: { commit, status: { state: "idle", savedAt: null, message: null }, fieldError: () => undefined, versionOf: () => 1 },
  ...overrides,
})

describe("RiskEditor", () => {
  it("abre en el primer paso con errores y muestra el mensaje en el chequeo", () => {
    render(<RiskEditor {...props()} />)
    expect(screen.getByRole("tab", { name: /Medidas de control/, selected: true })).toBeTruthy()
    expect(screen.getAllByText(/exige al menos una medida/).length).toBeGreaterThan(0)
  })
  it("respeta el paso de la URL", () => {
    render(<RiskEditor {...props({ step: "evaluacion" })} />)
    expect(screen.getByRole("tab", { name: /Evaluación/, selected: true })).toBeTruthy()
  })
  it("«Siguiente pendiente» salta al próximo riesgo con errores aunque sea de otra tarea", () => {
    render(<RiskEditor {...props()} />)
    expect(screen.getByRole("link", { name: "Siguiente pendiente" }).getAttribute("href")).toBe("/prevencion/miper/m1?fila=e3")
    expect(screen.getByRole("link", { name: "Siguiente ›" }).getAttribute("href")).toBe("/prevencion/miper/m1?fila=e2")
  })
  it("«Volver a la tarea» usa la tarea actual del riesgo (también después de moverlo)", () => {
    const { rerender } = render(<RiskEditor {...props()} />)
    const before = screen.getByRole("link", { name: /Volver a la tarea/ }).getAttribute("href")
    rerender(<RiskEditor {...props({ rows: [entry("e1", 1, { task: "Nueva tarea" })] })} />)
    expect(screen.getByRole("link", { name: /Volver a la tarea/ }).getAttribute("href")).not.toBe(before)
  })
  it("en modo lectura no hay controles editables", () => {
    render(<RiskEditor {...props({ editable: false, step: "identificacion" })} />)
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.getByText("Peligro 1", { selector: "h2" })).toBeTruthy()
  })
  it("un riesgo que no existe pide recargar y después avisa", async () => {
    router.refresh.mockClear()
    vi.useFakeTimers()
    render(<RiskEditor {...props({ entryId: "zzz" })} />)
    expect(router.refresh).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2600) })
    expect(screen.getByText("Este riesgo ya no existe")).toBeTruthy()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/(app)/prevencion/miper/[id]/risk-editor/types.ts
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { EditorStep } from "@/lib/prevention/miper/entry-navigation"
import type { EntryChange, MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperObservationView, MiperWorkspace } from "@/lib/services/miper/queries"
import type { EntryAutosave } from "../use-entry-autosave"

/** Lo que el editor necesita del espacio de trabajo: un subconjunto, para poder probarlo sin un `MiperWorkspace` completo. */
export type RiskEditorData = {
  matrixId: string
  published: boolean
  riskFactors: MiperWorkspace["riskFactors"]
  dictionaries: MiperWorkspace["dictionaries"]
  responsibleOptions: MiperWorkspace["responsibleOptions"]
  controlVersions: Record<string, number>
  controlActionLinks: MiperWorkspace["controlActionLinks"]
  observations: readonly MiperObservationView[]
}

export type RiskEditorProps = {
  data: RiskEditorData
  rows: MiperEntrySnapshot[]
  entryId: string
  step: EditorStep | null
  issuesByEntry: Map<string, CompletenessIssue[]>
  incomplete: ReadonlySet<string>
  /** Conjunto filtrado: «Siguiente pendiente» recorre sólo esto. `null` = sin filtros. */
  matching: ReadonlySet<string> | null
  editable: boolean
  mode: WorkspaceMode
  change: EntryChange | null
  baselineEntry: MiperEntrySnapshot | null
  autosave: EntryAutosave
}

export type StepProps = { entry: MiperEntrySnapshot; data: RiskEditorData; editable: boolean; autosave: EntryAutosave; issues: CompletenessIssue[] }
```

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/save-status.tsx
"use client"

import type { SaveStatus } from "../use-entry-autosave"

const TIME = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" })

export function SaveStatusIndicator({ status, editable }: { status: SaveStatus; editable: boolean }) {
  const text = !editable ? "Solo lectura"
    : status.state === "saving" ? "Guardando…"
    : status.state === "error" ? `No se guardó: ${status.message ?? "intenta de nuevo"}`
    : status.state === "saved" && status.savedAt ? `Guardado a las ${TIME.format(status.savedAt)}`
    : "Los cambios se guardan solos"
  const tone = status.state === "error" ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text-subtle)]"
  return <p role="status" aria-live="polite" className={`text-xs ${tone}`}>{text}</p>
}
```

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/identification-step.tsx
"use client"

import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { Combobox } from "@/components/ui/combobox"
import { DetailItem } from "@/components/ui/detail-item"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import type { RiskEditorData, StepProps } from "./types"

type TextField = "activity" | "task" | "position" | "location" | "hazard" | "risk" | "probableDamage"
const LIST: Record<TextField, keyof RiskEditorData["dictionaries"]> = {
  activity: "activities", task: "tasks", position: "positions", location: "locations", hazard: "hazards", risk: "risks", probableDamage: "damages",
}
const ROUTINE = [{ value: "yes", title: "Rutinaria" }, { value: "no", title: "No rutinaria" }] as const

export function IdentificationStep({ entry, data, editable, autosave, issues }: StepProps) {
  const commit = (values: MiperEntryValues) => { void autosave.commit(entry, values) }
  const missing = (field: string) => issues.find((issue) => issue.severity === "error" && issue.field === field)?.message
  const id = (field: string) => `${entry.id}-${field}`

  if (!editable) {
    return (
      <dl className="grid gap-3 sm:grid-cols-2">
        {([["Factor de riesgo", entry.riskFactor], ["Rutinaria", entry.isRoutine === null ? null : entry.isRoutine ? "Rutinaria" : "No rutinaria"], ["Peligro", entry.hazard], ["Riesgo", entry.risk], ["Daño probable", entry.probableDamage], ["Actividad", entry.activity], ["Tarea", entry.task], ["Puesto de trabajo", entry.position], ["Lugar específico", entry.location], ["Expuestos F / M / Otro", `${entry.exposedFemale} / ${entry.exposedMale} / ${entry.exposedOther}`]] as const).map(([label, value]) => (
          <DetailItem key={label} label={label} value={value ?? "—"} layout="stacked" />
        ))}
      </dl>
    )
  }

  const text = (field: TextField, label: string, required = true) => (
    <Field label={label} htmlFor={id(field)} required={required} error={autosave.fieldError(entry.id, field)} helper={missing(field)}>
      <Combobox id={id(field)} allowCustomValue options={data.dictionaries[LIST[field]].map((value) => ({ value, label: value }))} value={entry[field] ?? ""} placeholder="Escribe o elige…" onChange={(value) => commit({ [field]: value || null } as MiperEntryValues)} />
    </Field>
  )
  const exposed = (field: "exposedFemale" | "exposedMale" | "exposedOther", label: string) => (
    <Field label={label} htmlFor={id(field)} error={autosave.fieldError(entry.id, field)}>
      <Input id={id(field)} type="number" min={0} inputMode="numeric" defaultValue={entry[field]} key={`${field}-${entry[field]}`}
        onBlur={(event) => { const value = Math.max(0, Number(event.target.value) || 0); if (value !== entry[field]) commit({ [field]: value } as MiperEntryValues) }} />
    </Field>
  )
  const factors = data.riskFactors.filter((factor) => factor.isActive || factor.id === entry.riskFactorId)

  return (
    <div className="space-y-6">
      <section aria-labelledby={id("h-peligro")} className="space-y-3">
        <h3 id={id("h-peligro")} className="text-sm font-semibold">Peligro y riesgo</h3>
        <p className="text-sm text-[var(--color-text-subtle)]">Describe la fuente o situación observable y el daño que podría producir.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Factor de riesgo" required error={autosave.fieldError(entry.id, "riskFactorId")} helper={missing("riskFactorId")}>
            <OptionSelect aria-label="Factor de riesgo" emptyLabel="Sin factor" options={factors.map((factor) => ({ value: factor.id, label: factor.name }))} value={entry.riskFactorId ?? ""} onValueChange={(value) => commit({ riskFactorId: value || null })} />
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">¿Es una tarea rutinaria?</p>
            <ChoiceCardGroup label="¿Es una tarea rutinaria?" className="sm:grid-cols-2" options={[...ROUTINE]} value={entry.isRoutine === null ? null : entry.isRoutine ? "yes" : "no"} onChange={(value) => commit({ isRoutine: value === "yes" })} />
          </div>
          {text("hazard", "Peligro")}
          {text("risk", "Riesgo")}
          <div className="md:col-span-2">{text("probableDamage", "Daño probable")}</div>
        </div>
      </section>
      <section aria-labelledby={id("h-donde")} className="space-y-3">
        <h3 id={id("h-donde")} className="text-sm font-semibold">Dónde ocurre</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {text("position", "Puesto de trabajo")}
          {text("location", "Lugar específico", false)}
        </div>
        <div className="grid grid-cols-3 gap-3 md:max-w-md">
          {exposed("exposedFemale", "Expuestas (F)")}
          {exposed("exposedMale", "Expuestos (M)")}
          {exposed("exposedOther", "Expuestos (otro)")}
        </div>
      </section>
      <details className="rounded-xl border border-[var(--color-border)] p-3">
        <summary className="cursor-pointer text-sm font-medium">Mover a otra actividad o tarea</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {text("activity", "Actividad")}
          {text("task", "Tarea")}
        </div>
      </details>
    </div>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/evaluation-step.tsx
"use client"

import { PcChoice } from "@/components/prevention/pc-choice"
import type { StepProps } from "./types"

export function EvaluationStep({ entry, editable, autosave }: StepProps) {
  const error = autosave.fieldError(entry.id, "probability") ?? autosave.fieldError(entry.id, "consequence")
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-subtle)]">Selecciona probabilidad y consecuencia según los criterios del RE-04.</p>
      <PcChoice probability={entry.probability} consequence={entry.consequence} disabled={!editable} onChange={(patch) => { void autosave.commit(entry, patch) }} />
      {error && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/measures-step.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChoiceCardGroup } from "@/components/ui/choice-card-group"
import { useOperation } from "@/lib/hooks/use-operation"
import { CONTROLLED_STATUS_LABEL, type ControlledStatus } from "@/lib/prevention/miper/snapshot"
import { deleteMiperControlAction } from "../../actions"
import { ControlCard } from "../control-card"
import { ControlForm } from "../control-form"
import type { StepProps } from "./types"

const CONTROLLED = (["yes", "partial", "no"] as const).map((value) => ({ value, title: CONTROLLED_STATUS_LABEL[value] }))

export function MeasuresStep({ entry, data, editable, autosave, issues }: StepProps) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const deletion = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const done = () => { setEditing(null); router.refresh() }
  const controlMessages = issues.filter((issue) => issue.severity === "error" && ["controls", "dueDate", "responsible", "description"].includes(issue.field))
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-labelledby={`${entry.id}-h-controlado`}>
        <h3 id={`${entry.id}-h-controlado`} className="text-sm font-semibold">¿Está controlado el riesgo?</h3>
        <ChoiceCardGroup label="¿Está controlado el riesgo?" options={CONTROLLED} value={entry.controlledStatus} disabled={!editable}
          onChange={(value: ControlledStatus) => { void autosave.commit(entry, { controlledStatus: value }) }} />
        {autosave.fieldError(entry.id, "controlledStatus") && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{autosave.fieldError(entry.id, "controlledStatus")}</p>}
      </section>
      <section className="space-y-2" aria-labelledby={`${entry.id}-h-medidas`}>
        <h3 id={`${entry.id}-h-medidas`} className="text-sm font-semibold">Medidas de control ({entry.controls.length})</h3>
        {controlMessages.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]">
            {[...new Set(controlMessages.map((issue) => issue.message))].map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}
        {entry.controls.map((control) => editing === control.id ? (
          <ControlForm key={control.id} matrixId={data.matrixId} entryId={entry.id} control={control} controlVersion={data.controlVersions[control.id]} responsibleOptions={data.responsibleOptions} measureSuggestions={data.dictionaries.measures} onDone={done} onCancel={() => setEditing(null)} />
        ) : (
          <ControlCard key={control.id} control={control} editable={editable} deleting={deletion.pending}
            linkedActionNumbers={data.controlActionLinks.filter((link) => link.controlId === control.id).map((link) => link.actionNumber)}
            verifyHref={data.published ? `/prevencion/miper/controles/${control.id}` : null}
            onEdit={() => setEditing(control.id)}
            onDelete={() => deletion.run(() => deleteMiperControlAction({ matrixId: data.matrixId, controlId: control.id, expectedVersion: data.controlVersions[control.id]! }))} />
        ))}
        {editable && (editing === "new"
          ? <ControlForm matrixId={data.matrixId} entryId={entry.id} control={null} controlVersion={undefined} responsibleOptions={data.responsibleOptions} measureSuggestions={data.dictionaries.measures} onDone={done} onCancel={() => setEditing(null)} />
          : <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>Agregar medida</Button>)}
        {!editable && entry.controls.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">Sin medidas de control.</p>}
      </section>
    </div>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/follow-up-step.tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { CONTROLLED_STATUS_LABEL, ENTRY_FIELD_LABEL, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import { addMiperObservationAction } from "../../actions"
import { ObservationItem } from "../observation-item"
import type { RiskEditorData } from "./types"

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Rutinaria" : "No rutinaria"
  if (value === "yes" || value === "partial" || value === "no") return CONTROLLED_STATUS_LABEL[value]
  return String(value)
}

export function FollowUpStep({ entry, data, mode, change, baselineEntry }: { entry: MiperEntrySnapshot; data: RiskEditorData; mode: WorkspaceMode; change: EntryChange | null; baselineEntry: MiperEntrySnapshot | null }) {
  const router = useRouter()
  const [observation, setObservation] = useState("")
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const controlIds = new Set(entry.controls.map((control) => control.id))
  const activities = data.controlActionLinks.filter((link) => controlIds.has(link.controlId)).filter((link, index, all) => all.findIndex((other) => other.actionId === link.actionId) === index)
  const observations = data.observations.filter((item) => item.entryId === entry.id)
  return (
    <div className="space-y-6">
      <section aria-label="Programa de Trabajo del riesgo" className="space-y-2">
        <h3 className="text-sm font-semibold">Programa de Trabajo ({activities.length})</h3>
        {activities.length === 0
          ? <p className="text-sm text-[var(--color-text-subtle)]">Ninguna medida de este riesgo está programada todavía. <Link className="underline" href={`/prevencion/miper/${data.matrixId}?tab=programa`}>Ir al programa</Link></p>
          : <ul className="space-y-1 text-sm">{activities.map((activity) => <li key={activity.actionId}><span className="font-medium">Actividad #{activity.actionNumber}</span>: {activity.description}</li>)}</ul>}
      </section>
      <section aria-label="Observaciones del riesgo" className="space-y-2">
        <h3 className="text-sm font-semibold">Observaciones ({observations.length})</h3>
        {observations.map((item) => <ObservationItem key={item.id} observation={item} mode={mode} onChanged={() => router.refresh()} />)}
        {mode.canObserve && (
          <div className="space-y-2">
            <Textarea aria-label="Nueva observación" value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Ej.: Revisar consecuencia. De acuerdo con el daño probable debería evaluarse nuevamente la severidad." />
            <Button size="sm" disabled={operation.pending || observation.trim().length < 5} onClick={() => operation.run(() => addMiperObservationAction({ matrixId: data.matrixId, entryId: entry.id, body: observation }), () => setObservation(""))}>Registrar observación</Button>
          </div>
        )}
      </section>
      {change && change.kind !== "removed" && (
        <section aria-label="Cambios respecto de la revisión anterior" className="space-y-2">
          <h3 className="text-sm font-semibold">{change.kind === "added" ? "Riesgo nuevo en esta ronda" : "Cambios respecto de la revisión anterior"}</h3>
          {change.kind === "modified" && (
            <ul className="space-y-1 text-sm">
              {change.fields.filter((field) => field !== "controls").map((field) => (
                <li key={field}><span className="font-medium">{ENTRY_FIELD_LABEL[field]}:</span> <del className="text-[var(--color-text-subtle)]">{display(baselineEntry?.[field as keyof MiperEntrySnapshot])}</del> → <ins className="no-underline">{display(entry[field as keyof MiperEntrySnapshot])}</ins></li>
              ))}
              {change.fields.includes("controls") && <li><span className="font-medium">Medidas de control:</span> antes {baselineEntry?.controls.map((control) => control.description).join("; ") || "ninguna"} → ahora {entry.controls.map((control) => control.description).join("; ") || "ninguna"}</li>}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/risk-aside.tsx
"use client"

import { CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { DetailItem } from "@/components/ui/detail-item"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { EditorStep } from "@/lib/prevention/miper/entry-navigation"
import { riskChecks } from "@/lib/prevention/miper/risk-checks"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const card = "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"

export function RiskAside({ entry, issues, onGoToStep }: { entry: MiperEntrySnapshot; issues: CompletenessIssue[]; onGoToStep: (step: EditorStep) => void }) {
  return (
    <aside aria-label="Resumen del riesgo" className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <section className={card} aria-label="Contexto">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Contexto</h3>
        <dl className="space-y-1.5 text-sm">
          <DetailItem label="Actividad" value={entry.activity ?? "—"} />
          <DetailItem label="Tarea" value={entry.task ?? "—"} />
          <DetailItem label="Puesto" value={entry.position ?? "—"} />
          <DetailItem label="Expuestos" value={String(entry.exposedFemale + entry.exposedMale + entry.exposedOther)} mono />
        </dl>
      </section>
      <section className={card} aria-label="Chequeo del riesgo">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Chequeo del riesgo</h3>
        <ul className="space-y-2 text-sm">
          {riskChecks(entry, issues).map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              {check.ok
                ? <CheckCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-[var(--color-success-ink)]" />
                : <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-[var(--color-warning-ink)]" />}
              <span>
                <span className="sr-only">{check.ok ? "Listo: " : "Pendiente: "}</span>{check.label}
                {!check.ok && <button type="button" onClick={() => onGoToStep(check.step)} className="block text-left text-xs text-[var(--color-primary-ink)] underline">{check.messages[0]}</button>}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className={card} aria-label="Nivel de riesgo">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Nivel de riesgo</h3>
        {/* Sin magnitud a propósito: «Clasificación · MR n» vive una sola vez en pantalla (paso Evaluación). */}
        <RiskClassificationBadge classification={entry.classification} />
      </section>
    </aside>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EDITOR_STEPS, EDITOR_STEP_LABEL, errorCountByStep, firstStepWithErrors, isEditorStep, nextPendingId, siblingsInTask, type EditorStep } from "@/lib/prevention/miper/entry-navigation"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToMatrix, hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { deleteMiperEntryAction, duplicateMiperEntryAction } from "../../actions"
import { EvaluationStep } from "./evaluation-step"
import { FollowUpStep } from "./follow-up-step"
import { IdentificationStep } from "./identification-step"
import { MeasuresStep } from "./measures-step"
import { RiskAside } from "./risk-aside"
import { SaveStatusIndicator } from "./save-status"
import type { RiskEditorProps } from "./types"

export type { RiskEditorData, RiskEditorProps } from "./types"

/** Si el `fila` no está, se recarga una vez y, pasado este tiempo, se avisa. */
const MISSING_AFTER_MS = 2500

/**
 * Editor del riesgo a página completa (spec §5.4). El workspace lo monta con
 * `key={entryId}`: así el paso inicial —el primero con errores— se calcula una
 * vez por riesgo y no salta de paso cuando el usuario corrige el último error.
 */
export function RiskEditor(props: RiskEditorProps) {
  const { data, rows, entryId, step, issuesByEntry, incomplete, matching, editable, mode, change, baselineEntry, autosave } = props
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const entry = rows.find((row) => row.id === entryId) ?? null
  const [fallbackStep] = useState<EditorStep>(() => firstStepWithErrors(issuesByEntry.get(entryId) ?? []))
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
    return <EmptyState title="Este riesgo ya no existe" description="Puede haberse eliminado o ser de otra versión de la MIPER." action={<Button asChild><Link href={hrefToMatrix(pathname, params)}>Volver a la matriz</Link></Button>} />
  }

  const issues = issuesByEntry.get(entry.id) ?? []
  const current: EditorStep = isEditorStep(step) ? step : fallbackStep
  const counts = errorCountByStep(issues)
  const siblings = siblingsInTask(rows, entry.id)
  const nextPending = nextPendingId(rows, entry.id, incomplete, matching)
  const taskHref = hrefToTask(pathname, params, taskKeyOf(entry))
  const goToStep = (next: string) => router.replace(hrefToEntry(pathname, params, entry.id, next as EditorStep), { scroll: false })
  const stepProps = { entry, data, editable, autosave, issues }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={taskHref} className="text-sm font-medium text-[var(--color-primary-ink)] hover:underline">‹ Volver a la tarea</Link>
        <SaveStatusIndicator status={autosave.status} editable={editable} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{entry.hazard ?? "Peligro sin describir"}</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">Riesgo #{entry.rowNumber} · {entry.task ?? "Sin tarea"}{entry.position ? ` · ${entry.position}` : ""}</p>
        </div>
        {editable && <EntryMenu matrixId={data.matrixId} entry={entry} version={autosave.versionOf(entry.id)} taskHref={taskHref} entryHref={(id) => hrefToEntry(pathname, params, id)} />}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Tabs value={current} onValueChange={goToStep} className="min-w-0">
          <TabsList aria-label="Pasos del riesgo">
            {EDITOR_STEPS.map((value, index) => (
              <TabsTrigger key={value} value={value}>
                {index + 1}. {EDITOR_STEP_LABEL[value]}{value === "medidas" ? ` (${entry.controls.length})` : ""}
                {counts[value] > 0 && <span className="ml-1.5 rounded-full bg-[var(--color-warning-tint)] px-1.5 tabular-nums text-[var(--color-warning-ink)]">{counts[value]}<span className="sr-only"> pendientes</span></span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="identificacion"><IdentificationStep {...stepProps} /></TabsContent>
          <TabsContent value="evaluacion"><EvaluationStep {...stepProps} /></TabsContent>
          <TabsContent value="medidas"><MeasuresStep {...stepProps} /></TabsContent>
          <TabsContent value="seguimiento"><FollowUpStep entry={entry} data={data} mode={mode} change={change} baselineEntry={baselineEntry} /></TabsContent>
        </Tabs>
        <RiskAside entry={entry} issues={issues} onGoToStep={goToStep} />
      </div>
      <nav aria-label="Recorrer riesgos" className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] py-3">
        <div className="flex items-center gap-2">
          {siblings?.previousId ? <Button asChild size="sm" variant="secondary"><Link href={hrefToEntry(pathname, params, siblings.previousId)}>‹ Anterior</Link></Button> : <Button size="sm" variant="secondary" disabled>‹ Anterior</Button>}
          <span className="text-xs tabular-nums text-[var(--color-text-subtle)]">{siblings?.position} de {siblings?.total} en la tarea</span>
          {siblings?.nextId ? <Button asChild size="sm" variant="secondary"><Link href={hrefToEntry(pathname, params, siblings.nextId)}>Siguiente ›</Link></Button> : <Button size="sm" variant="secondary" disabled>Siguiente ›</Button>}
        </div>
        {nextPending
          ? <Button asChild size="sm"><Link href={hrefToEntry(pathname, params, nextPending)}>Siguiente pendiente</Link></Button>
          : <p className="text-sm text-[var(--color-success-ink)]">No quedan riesgos pendientes{matching ? " en este filtro" : ""}.</p>}
      </nav>
    </div>
  )
}

function EntryMenu({ matrixId, entry, version, taskHref, entryHref }: { matrixId: string; entry: MiperEntrySnapshot; version: number | undefined; taskHref: string; entryHref: (id: string) => string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  async function duplicate() {
    setBusy(true)
    const state = await duplicateMiperEntryAction({ matrixId, entryId: entry.id })
    setBusy(false)
    if (!state.ok) { toast.error(state.message ?? "No se pudo duplicar el riesgo."); return }
    toast.success(`Riesgo #${entry.rowNumber} duplicado.`)
    const id = (state.data as { id?: unknown } | undefined)?.id
    if (typeof id === "string") router.push(entryHref(id))
    else router.refresh()
  }
  async function remove() {
    setBusy(true)
    const state = await deleteMiperEntryAction({ matrixId, entryId: entry.id, expectedVersion: version })
    setBusy(false)
    setConfirming(false)
    if (!state.ok) { toast.error(state.message ?? "No se pudo eliminar el riesgo."); return }
    toast.success(`Riesgo #${entry.rowNumber} eliminado.`)
    router.push(taskHref)
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="secondary" disabled={busy} aria-label={`Más acciones del riesgo ${entry.rowNumber}`}>Más</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { void duplicate() }}>Duplicar riesgo</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirming(true)}>Eliminar riesgo</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Eliminar el riesgo #${entry.rowNumber}`}
        description="Se elimina el riesgo con sus medidas. Si tiene marcadores en el mapa de riesgos o medidas vinculadas al PDTP, el servidor rechaza el borrado."
        confirmLabel="Eliminar riesgo" variant="destructive" loading={busy} onConfirm={() => { void remove() }} />
    </>
  )
}
```

> Si `TabsTrigger` no expone `aria-selected` (Radix lo hace), el test "abre en el primer paso"
> debe buscar `data-state="active"`. No cambies la lógica.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/risk-editor/risk-editor.test.tsx"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/prevencion/miper/[id]/risk-editor"
git commit -m "feat(miper): editor del riesgo por pasos con chequeo, recorrido y guardado visible"
```

---

### Task 9: Vista de la tarea

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/risk-row.tsx`, `app/(app)/prevencion/miper/[id]/task-view.tsx`
- Test: `app/(app)/prevencion/miper/[id]/task-view.test.tsx`

**Interfaces:**
- Consumes: `TaskNode` y `mostFrequent` (Task 1); `hrefToEntry` / `hrefToMatrix` (Task 3); `saveMiperEntryAction` (`../actions`); `RiskClassificationBadge`, `EmptyState`.
- Produces:
  - `RiskRow({ entry, href, issueCount, observed, change, showPosition })`. También lo usa la vista de estructura (Task 10).
  - `TaskView({ matrixId, task, editable, incomplete, observed, changes, issuesByEntry })`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/(app)/prevencion/miper/[id]/task-view.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildMatrixTree } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("tarea=k&clasificacion=important") }))
const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { TaskView } from "./task-view"

const e = (id: string, rowNumber: number, overrides: Partial<MiperEntrySnapshot> = {}) => ({
  id, rowNumber, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${rowNumber}`, risk: "Choque", probableDamage: "Fracturas",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [], ...overrides,
}) as MiperEntrySnapshot
const rows = [e("a", 4), e("b", 7, { position: "Peoneta" })]
const task = buildMatrixTree(rows, { incomplete: new Set(["a"]), observed: new Set(), modified: new Set(), matching: null })[0]!.tasks[0]!
const base = { matrixId: "m1", task, incomplete: new Set(["a"]), observed: new Set<string>(), changes: new Map(), issuesByEntry: new Map([["a", [{ scope: "entry" as const, entryId: "a", field: "controls", message: "m", severity: "error" as const }]]]) }

describe("TaskView", () => {
  it("lista los riesgos como enlaces al editor, con estado y puesto cuando hay más de uno", () => {
    render(<TaskView {...base} editable />)
    const link = screen.getByRole("link", { name: /Riesgo #4: Peligro 4/ })
    expect(link.getAttribute("href")).toBe("/prevencion/miper/m1?clasificacion=important&fila=a")
    expect(screen.getByText("1 pendiente")).toBeTruthy()
    expect(screen.getByText("Completo")).toBeTruthy()
    expect(screen.getByText("Peoneta")).toBeTruthy()
    expect(screen.getByText("1 de 2 completos")).toBeTruthy()
  })
  it("«Agregar peligro» hereda el contexto, se inserta tras el último N° de la tarea y abre el editor", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
    render(<TaskView {...base} editable />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar peligro" }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m1?clasificacion=important&fila=nuevo&paso=identificacion"))
    expect(saveMiperEntryAction).toHaveBeenCalledWith({ matrixId: "m1", insertAfterRowNumber: 7, values: { activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", isRoutine: true } })
  })
  it("sin edición no ofrece agregar", () => {
    render(<TaskView {...base} editable={false} />)
    expect(screen.queryByRole("button", { name: "Agregar peligro" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/task-view.test.tsx"`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/(app)/prevencion/miper/[id]/risk-row.tsx
import Link from "next/link"
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { CONTROLLED_STATUS_LABEL, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const chip = "rounded-full px-2 py-0.5 text-xs font-medium"

/** Una fila de riesgo: peligro, riesgo · daño, clasificación, estado y marcas (spec §5.3). Lleva al editor. */
export function RiskRow({ entry, href, issueCount, observed, change, showPosition }: {
  entry: MiperEntrySnapshot; href: string; issueCount: number; observed: boolean; change: EntryChange | null; showPosition: boolean
}) {
  return (
    <Link href={href} aria-label={`Riesgo #${entry.rowNumber}: ${entry.hazard ?? "peligro sin describir"}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] md:grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto]">
      <div className="min-w-0">
        <p className="text-sm font-semibold"><span className="mr-1.5 tabular-nums text-[var(--color-text-subtle)]">#{entry.rowNumber}</span>{entry.hazard ?? "Peligro sin describir"}</p>
        <p className="text-xs text-[var(--color-text-subtle)]">{[entry.risk, entry.probableDamage].filter(Boolean).join(" · ") || "Sin riesgo ni daño"}{showPosition && entry.position ? <> · <span>{entry.position}</span></> : null}</p>
      </div>
      <div className="col-start-1 flex flex-wrap items-center gap-1.5 md:col-start-auto">
        <RiskClassificationBadge classification={entry.classification} magnitude={entry.magnitude} size="sm" />
        {entry.controlledStatus && <span className={`${chip} bg-[var(--color-surface-2)] text-[var(--color-text-muted)]`}>Controlado: {CONTROLLED_STATUS_LABEL[entry.controlledStatus]}</span>}
      </div>
      <span className="col-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-auto">{entry.controls.length} medida{entry.controls.length === 1 ? "" : "s"}</span>
      <div className="col-start-1 flex flex-wrap gap-1.5 md:col-start-auto">
        {issueCount > 0
          ? <span className={`${chip} bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]`}>{issueCount} pendiente{issueCount === 1 ? "" : "s"}</span>
          : <span className={`${chip} bg-[var(--color-success-tint)] text-[var(--color-success-ink)]`}>Completo</span>}
        {observed && <span className={`${chip} bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]`}>Observado</span>}
        {change && change.kind !== "removed" && <span className={`${chip} bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]`}>{change.kind === "added" ? "Nueva" : "Modificada"}</span>}
      </div>
      <CaretRight aria-hidden className="row-span-1 row-start-1 col-start-2 size-4 text-[var(--color-text-subtle)] md:col-start-auto md:row-start-auto" />
    </Link>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/task-view.tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import { mostFrequent, type TaskNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToMatrix } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { saveMiperEntryAction } from "../actions"
import { RiskRow } from "./risk-row"

export function TaskView({ matrixId, task, editable, incomplete, observed, changes, issuesByEntry }: {
  matrixId: string
  task: TaskNode
  editable: boolean
  incomplete: ReadonlySet<string>
  observed: ReadonlySet<string>
  changes: Map<string, EntryChange>
  issuesByEntry: Map<string, CompletenessIssue[]>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [adding, setAdding] = useState(false)

  async function addHazard() {
    setAdding(true)
    const state = await saveMiperEntryAction({
      matrixId,
      insertAfterRowNumber: task.lastRowNumber,
      values: {
        activity: task.activity, task: task.task,
        position: mostFrequent(task.entries.map((entry) => entry.position)),
        location: mostFrequent(task.entries.map((entry) => entry.location)),
        isRoutine: mostFrequent(task.entries.map((entry) => entry.isRoutine)),
      },
    })
    setAdding(false)
    const id = (state.data as { id?: unknown } | undefined)?.id
    if (!state.ok || typeof id !== "string") { toast.error(state.message ?? "No se pudo agregar el peligro."); return }
    router.push(hrefToEntry(pathname, params, id, "identificacion"))
  }

  const errorCount = (entryId: string) => (issuesByEntry.get(entryId) ?? []).filter((issue) => issue.severity === "error").length
  const facts: Array<[string, string]> = [
    ["Puestos", task.positions.join(", ") || "—"],
    ["Lugares", task.locations.join(", ") || "—"],
    ["Personas expuestas", task.maxExposed > 0 ? `hasta ${task.maxExposed}` : "—"],
    ["Estado", `${task.complete} de ${task.entries.length} completos`],
  ]
  return (
    <div className="space-y-4">
      <Link href={hrefToMatrix(pathname, params)} className="text-sm font-medium text-[var(--color-primary-ink)] hover:underline">‹ Volver a la matriz</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{task.label}</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">{task.activity ?? "Sin actividad"}</p>
        </div>
        {editable && <Button onClick={() => { void addHazard() }} loading={adding}>Agregar peligro</Button>}
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-[var(--color-surface)] px-3 py-2.5">
            <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="miper-task-risks" className="space-y-2">
        <h3 id="miper-task-risks" className="text-sm font-semibold">Peligros identificados ({task.entries.length})</h3>
        {task.entries.length === 0
          ? <EmptyState compact title="Esta tarea no tiene riesgos" description="Agrega el primer peligro de la tarea para evaluarlo." action={editable ? <Button onClick={() => { void addHazard() }}>Agregar peligro</Button> : undefined} />
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

> Si `saveMiperEntryAction` rechaza `isRoutine` nulo en `values`, `mostFrequent` devuelve `null`
> y el esquema (`z.boolean().nullable().optional()`) lo admite. No hace falta filtrar.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/task-view.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/prevencion/miper/[id]/risk-row.tsx" "app/(app)/prevencion/miper/[id]/task-view.tsx" "app/(app)/prevencion/miper/[id]/task-view.test.tsx"
git commit -m "feat(miper): vista de la tarea con sus peligros y alta que hereda el contexto"
```

---

### Task 10: Vista de estructura de la matriz y "Nueva tarea"

**Files:**
- Create:
  - `app/(app)/prevencion/miper/[id]/activity-section.tsx`
  - `app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx`
  - `app/(app)/prevencion/miper/[id]/matrix-view.tsx`
  - `app/(app)/prevencion/miper/[id]/new-task-dialog.tsx`
- Modify: `app/(app)/prevencion/miper/[id]/summary-strip.tsx`
- Test: `app/(app)/prevencion/miper/[id]/matrix-view.test.tsx`, `app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx`

**Interfaces:**
- Consumes:
  - Del Task 1: `ActivityNode` y `buildMatrixTree`.
  - Del Task 3: `parseMatrixFilters`, `matrixFilterPatch`, `matrixFilterChips` y `hasEntryFilters`.
  - Del Task 9: `RiskRow`.
  - Existentes: `useUrlFilters`, `FilterToolbar`, `Checkbox`, `OptionSelect`, `Combobox` (Task 4), `saveMiperEntryAction`.
- Produces:
  - `MatrixView({ tree, filtered, editable, incomplete, observed, changes, issuesByEntry, riskFactors, hasBaseline, onNewTask })`.
  - `MatrixFiltersBar({ filters, riskFactors, hasBaseline, collapsedAll, onToggleAll })`.
  - `NewTaskDialog({ open, onOpenChange, matrixId, rows, dictionaries })`.
  - `SummaryStrip` con props nuevas `taskCount`, `completeCount`, `pendingActive`, `onTogglePending`. Ya no muestra "Medidas sin responsable" ni "Medidas sin plazo".

- [ ] **Step 1: Write the failing tests**

```tsx
// app/(app)/prevencion/miper/[id]/matrix-view.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { buildMatrixTree, taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))

import { MatrixView } from "./matrix-view"

const e = (id: string, rowNumber: number, activity: string, task: string) => ({ id, rowNumber, activity, task, position: "P", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0, riskFactorId: null, riskFactor: null, isRoutine: true, hazard: `Peligro ${id}`, risk: "R", probableDamage: "D", probability: 1, consequence: 1, magnitude: 1, classification: "tolerable", controlledStatus: "yes", controls: [] }) as MiperEntrySnapshot
const rows = [e("a", 1, "Transporte", "Carga"), e("b", 2, "Transporte", "Descarga"), e("c", 3, "Oficina", "Archivo")]
const ctx = { incomplete: new Set(["a"]), observed: new Set<string>(), modified: new Set<string>() }
const base = { editable: true, incomplete: ctx.incomplete, observed: ctx.observed, changes: new Map(), issuesByEntry: new Map(), riskFactors: [], hasBaseline: false, onNewTask: vi.fn() }

describe("MatrixView", () => {
  it("muestra cada actividad con sus tareas como enlaces y el avance por tarea", () => {
    render(<MatrixView {...base} tree={buildMatrixTree(rows, { ...ctx, matching: null })} filtered={false} />)
    expect(screen.getByRole("heading", { level: 2, name: /Transporte/ })).toBeTruthy()
    const carga = screen.getByRole("link", { name: /Carga/ })
    expect(carga.getAttribute("href")).toBe(`/prevencion/miper/m1?tarea=${taskKeyOf({ activity: "Transporte", task: "Carga" })}`)
    expect(screen.getByText("0 de 1 completos")).toBeTruthy()
  })
  it("con filtro muestra los riesgos que coinciden bajo su tarea", () => {
    render(<MatrixView {...base} tree={buildMatrixTree(rows, { ...ctx, matching: new Set(["b"]) })} filtered />)
    expect(screen.getByRole("link", { name: "Riesgo #2: Peligro b" })).toBeTruthy()
    expect(screen.queryByRole("heading", { level: 2, name: /Oficina/ })).toBeNull()
  })
  it("plegar una actividad oculta sus tareas", () => {
    render(<MatrixView {...base} tree={buildMatrixTree(rows, { ...ctx, matching: null })} filtered={false} />)
    const toggle = screen.getByRole("button", { name: /Transporte/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("link", { name: /Carga/ })).toBeNull()
  })
  it("sin riesgos ofrece crear la primera tarea", () => {
    render(<MatrixView {...base} tree={[]} filtered={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }))
    expect(base.onNewTask).toHaveBeenCalled()
  })
})
```

```tsx
// app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("") }))
const saveMiperEntryAction = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ saveMiperEntryAction }))

import { NewTaskDialog } from "./new-task-dialog"

const rows = [{ id: "a", rowNumber: 5, activity: "Transporte" }, { id: "b", rowNumber: 9, activity: "transporte " }, { id: "c", rowNumber: 12, activity: "Oficina" }] as MiperEntrySnapshot[]
const dictionaries = { activities: ["Transporte"], tasks: [], positions: [], locations: [], hazards: [], risks: [], damages: [], measures: [] }
const type = (label: string, value: string) => {
  const input = screen.getByRole("combobox", { name: label, exact: true })
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe("NewTaskDialog", () => {
  it("exige actividad, tarea y puesto, crea el primer riesgo tras la actividad existente y abre su editor", async () => {
    saveMiperEntryAction.mockResolvedValueOnce({ ok: true, data: { id: "nuevo", version: 1 } })
    render(<NewTaskDialog open onOpenChange={() => {}} matrixId="m1" rows={rows} dictionaries={dictionaries} />)
    const create = screen.getByRole("button", { name: "Crear tarea" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    type("Actividad", "TRANSPORTE")
    type("Tarea", "Lavado de camión")
    type("Puesto de trabajo", "Conductor")
    fireEvent.click(create)
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/prevencion/miper/m1?fila=nuevo&paso=identificacion"))
    expect(saveMiperEntryAction).toHaveBeenCalledWith({ matrixId: "m1", insertAfterRowNumber: 9, values: { activity: "TRANSPORTE", task: "Lavado de camión", position: "Conductor", location: null, hazard: null } })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx"`
Expected: FAIL, módulos inexistentes.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/(app)/prevencion/miper/[id]/activity-section.tsx
"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { CaretDown, CaretRight } from "@phosphor-icons/react"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode, ClassificationCounts } from "@/lib/prevention/miper/matrix-tree"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { RiskRow } from "./risk-row"

function Counts({ counts }: { counts: ClassificationCounts }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {[...RISK_CLASSIFICATIONS].reverse().filter((cls) => counts[cls] > 0).map((cls) => (
        <span key={cls} className="inline-flex items-center gap-1"><RiskClassificationBadge classification={cls} size="sm" /><span className="text-xs tabular-nums">{counts[cls]}</span></span>
      ))}
    </span>
  )
}

export function ActivitySection({ activity, expanded, onToggle, filtered, incomplete, observed, changes, issuesByEntry }: {
  activity: ActivityNode; expanded: boolean; onToggle: () => void; filtered: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const headingId = `miper-activity-${activity.key}`
  const totals = filtered ? `${activity.matchingCount} de ${activity.entryCount} riesgos` : `${activity.tasks.length} tarea${activity.tasks.length === 1 ? "" : "s"} · ${activity.entryCount} riesgos`
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <h2 id={headingId} className="m-0">
        <button type="button" aria-expanded={expanded} onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-2)]">
          <span className="flex items-center gap-2">
            {expanded ? <CaretDown aria-hidden className="size-4" /> : <CaretRight aria-hidden className="size-4" />}
            <span>
              <span className="block text-sm font-semibold">{activity.label}</span>
              <span className="block text-xs font-normal text-[var(--color-text-subtle)]">{totals}</span>
            </span>
          </span>
          <Counts counts={activity.counts} />
        </button>
      </h2>
      {expanded && (
        <ul className="space-y-1 border-t border-[var(--color-border)] p-2">
          {activity.tasks.map((task) => (
            <li key={task.key} className="space-y-2">
              <Link href={hrefToTask(pathname, params, task.key)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2.5 hover:bg-[var(--color-surface-2)] md:grid-cols-[minmax(0,1.4fr)_auto_auto_auto]">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{task.label}</span>
                  <span className="block truncate text-xs text-[var(--color-text-subtle)]">{[task.positions[0], task.positions.length > 1 ? `+${task.positions.length - 1}` : null, task.locations[0]].filter(Boolean).join(" · ") || "Sin puesto"}</span>
                </span>
                <span className="col-start-1 md:col-start-auto"><Counts counts={task.counts} /></span>
                <span className="col-start-1 text-xs tabular-nums text-[var(--color-text-subtle)] md:col-start-auto">{task.complete} de {task.entries.length} completos{task.observed ? ` · ${task.observed} observado(s)` : ""}{task.modified ? ` · ${task.modified} modificado(s)` : ""}</span>
                <CaretRight aria-hidden className="col-start-2 row-start-1 size-4 text-[var(--color-text-subtle)] md:col-start-auto" />
              </Link>
              {filtered && (
                <ul className="space-y-2 pl-3">
                  {task.matching.map((entry) => (
                    <li key={entry.id}>
                      <RiskRow entry={entry} href={hrefToEntry(pathname, params, entry.id)} observed={observed.has(entry.id)} change={changes.get(entry.id) ?? null} showPosition={task.positions.length > 1}
                        issueCount={incomplete.has(entry.id) ? (issuesByEntry.get(entry.id) ?? []).filter((issue) => issue.severity === "error").length : 0} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx
"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { activeFilterCount, type GridFilters } from "@/lib/prevention/miper/grid-view"
import { matrixFilterChips, matrixFilterPatch } from "@/lib/prevention/miper/matrix-filters"
import { CLASSIFICATION_LABEL, RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"

/**
 * Barra de la matriz (spec §5.1, regla A2): búsqueda propia y «Contraer todo»
 * a la vista; el resto, en el cajón «Filtros (N)» de `FilterToolbar`, con chips.
 */
export function MatrixFiltersBar({ filters, riskFactors, hasBaseline, collapsedAll, onToggleAll }: {
  filters: GridFilters; riskFactors: ReadonlyArray<{ id: string; name: string }>; hasBaseline: boolean; collapsedAll: boolean; onToggleAll: () => void
}) {
  const { setFilters, setFilter } = useUrlFilters()
  const [search, setSearch] = useState(filters.search)
  useEffect(() => { setSearch(filters.search) }, [filters.search])
  useEffect(() => {
    if (search === filters.search) return
    const timer = setTimeout(() => setFilter("buscar", search.trim() || null), 300)
    return () => clearTimeout(timer)
  }, [search, filters.search, setFilter])
  const apply = (next: GridFilters) => setFilters(matrixFilterPatch(next))
  const chips = matrixFilterChips(filters, riskFactors)
  return (
    <FilterToolbar
      activeChips={chips}
      activeCount={activeFilterCount(filters) - (filters.search ? 1 : 0)}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => { setSearch(""); setFilters(matrixFilterPatch({ ...filters, search: "", classifications: [], controlled: "all", factorId: "all", onlyObserved: false, onlyModified: false, onlyIncomplete: false, onlyComplete: false })) }}
      actions={<Button variant="secondary" size="sm" onClick={onToggleAll}>{collapsedAll ? "Expandir todo" : "Contraer todo"}</Button>}
      overflowFilters={(
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Clasificación</legend>
            {[...RISK_CLASSIFICATIONS].reverse().map((cls) => (
              <Checkbox key={cls} label={CLASSIFICATION_LABEL[cls]} checked={filters.classifications.includes(cls)}
                onChange={(event) => apply({ ...filters, classifications: event.target.checked ? [...filters.classifications, cls] : filters.classifications.filter((item) => item !== cls) })} />
            ))}
          </fieldset>
          <Field label="Estado del riesgo">
            <OptionSelect aria-label="Estado del riesgo" emptyLabel="Todos" value={filters.onlyIncomplete ? "pendientes" : filters.onlyComplete ? "completos" : ""}
              options={[{ value: "pendientes", label: "Con pendientes" }, { value: "completos", label: "Completos" }]}
              onValueChange={(value) => apply({ ...filters, onlyIncomplete: value === "pendientes", onlyComplete: value === "completos" })} />
          </Field>
          <Field label="¿Está controlado?">
            <OptionSelect aria-label="¿Está controlado?" emptyLabel="Todos" value={filters.controlled === "all" ? "" : filters.controlled}
              options={[{ value: "yes", label: "Sí" }, { value: "partial", label: "Parcialmente" }, { value: "no", label: "No" }]}
              onValueChange={(value) => apply({ ...filters, controlled: (value || "all") as GridFilters["controlled"] })} />
          </Field>
          <Field label="Factor de riesgo">
            <OptionSelect aria-label="Factor de riesgo" emptyLabel="Todos" value={filters.factorId === "all" ? "" : filters.factorId}
              options={riskFactors.map((factor) => ({ value: factor.id, label: factor.name }))}
              onValueChange={(value) => apply({ ...filters, factorId: value || "all" })} />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Marcas</legend>
            <Checkbox label="Observados" checked={filters.onlyObserved} onChange={(event) => apply({ ...filters, onlyObserved: event.target.checked })} />
            {hasBaseline && <Checkbox label="Modificados" checked={filters.onlyModified} onChange={(event) => apply({ ...filters, onlyModified: event.target.checked })} />}
          </fieldset>
        </div>
      )}
    >
      <Field label="Buscar en la matriz" htmlFor="miper-matrix-search" className="w-full sm:w-80">
        <Input id="miper-matrix-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Actividad, tarea, peligro, medida…" />
      </Field>
    </FilterToolbar>
  )
}
```

> Revisa en `components/ui/filter-toolbar.tsx` cómo se rotula el botón que abre `overflowFilters`
> y cómo se pinta `activeCount`. La spec pide "Filtros (N)". Si el rótulo difiere, no lo cambies en
> la primitiva: usa el que ya tiene.

```tsx
// app/(app)/prevencion/miper/[id]/matrix-view.tsx
"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { ActivityNode } from "@/lib/prevention/miper/matrix-tree"
import type { EntryChange } from "@/lib/prevention/miper/snapshot"
import { ActivitySection } from "./activity-section"

export function MatrixView({ tree, filtered, editable, incomplete, observed, changes, issuesByEntry, onNewTask, toolbar }: {
  tree: ActivityNode[]; filtered: boolean; editable: boolean
  incomplete: ReadonlySet<string>; observed: ReadonlySet<string>; changes: Map<string, EntryChange>; issuesByEntry: Map<string, CompletenessIssue[]>
  riskFactors: ReadonlyArray<{ id: string; name: string }>; hasBaseline: boolean
  onNewTask: () => void
  /** La barra de filtros la arma el workspace (necesita la URL); queda como ranura para probar la vista sin ella. */
  toolbar?: (state: { collapsedAll: boolean; toggleAll: () => void }) => ReactNode
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const collapsedAll = tree.length > 0 && tree.every((activity) => collapsed.has(activity.key))
  const toggleAll = () => setCollapsed(collapsedAll ? new Set() : new Set(tree.map((activity) => activity.key)))
  const toggle = (key: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return (
    <div className="space-y-3">
      {toolbar?.({ collapsedAll, toggleAll })}
      {tree.length === 0 ? (
        filtered
          ? <EmptyState title="Ningún riesgo coincide con los filtros" description="Quita algún filtro o cambia la búsqueda." />
          : <EmptyState title="Esta MIPER todavía no tiene riesgos" description="Empieza por una tarea: indica la actividad, la tarea y el puesto, y después sus peligros." action={editable ? <Button onClick={onNewTask}>Nueva tarea</Button> : undefined} />
      ) : tree.map((activity) => (
        <ActivitySection key={activity.key} activity={activity} expanded={filtered || !collapsed.has(activity.key)} onToggle={() => toggle(activity.key)}
          filtered={filtered} incomplete={incomplete} observed={observed} changes={changes} issuesByEntry={issuesByEntry} />
      ))}
    </div>
  )
}
```

> Con filtros, las actividades siempre se muestran expandidas (`filtered ||`). El caso "plegar"
> del test corre sin filtros.

```tsx
// app/(app)/prevencion/miper/[id]/new-task-dialog.tsx
"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { normalizeMiperName } from "@/lib/prevention/miper/names"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry } from "@/lib/prevention/miper/workspace-url"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { toast } from "@/lib/toast"
import { saveMiperEntryAction } from "../actions"

/**
 * «Nueva tarea» (spec §2.3): en el RE-04 una tarea sin riesgos no existe, así
 * que esto crea el PRIMER riesgo de la tarea y abre su editor. Si la actividad
 * ya existe, el riesgo se inserta después de su último N° para que el RE-04
 * exportado conserve la actividad contigua.
 */
export function NewTaskDialog({ open, onOpenChange, matrixId, rows, dictionaries }: {
  open: boolean; onOpenChange: (open: boolean) => void; matrixId: string; rows: readonly MiperEntrySnapshot[]; dictionaries: MiperWorkspace["dictionaries"]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [values, setValues] = useState({ activity: "", task: "", position: "", location: "", hazard: "" })
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }))
  const ready = values.activity.trim() && values.task.trim() && values.position.trim()
  const field = (key: keyof typeof values, label: string, list: keyof MiperWorkspace["dictionaries"], required: boolean) => (
    <Field label={label} htmlFor={`miper-new-task-${key}`} required={required}>
      <Combobox id={`miper-new-task-${key}`} allowCustomValue options={dictionaries[list].map((value) => ({ value, label: value }))} value={values[key]} onChange={set(key)} placeholder="Escribe o elige…" />
    </Field>
  )
  async function create() {
    setBusy(true)
    const activityKey = normalizeMiperName(values.activity)
    const lastOfActivity = rows.filter((row) => normalizeMiperName(row.activity ?? "") === activityKey).reduce<number | null>((max, row) => (max === null || row.rowNumber > max ? row.rowNumber : max), null)
    const state = await saveMiperEntryAction({
      matrixId, insertAfterRowNumber: lastOfActivity,
      values: { activity: values.activity.trim(), task: values.task.trim(), position: values.position.trim(), location: values.location.trim() || null, hazard: values.hazard.trim() || null },
    })
    setBusy(false)
    const id = (state.data as { id?: unknown } | undefined)?.id
    if (!state.ok || typeof id !== "string") { toast.error(state.message ?? "No se pudo crear la tarea."); return }
    onOpenChange(false)
    setValues({ activity: "", task: "", position: "", location: "", hazard: "" })
    router.push(hrefToEntry(pathname, params, id, "identificacion"))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
          <DialogDescription>Indica dónde ocurre y, si quieres, el primer peligro. Después se completa su evaluación.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          {field("activity", "Actividad", "activities", true)}
          {field("task", "Tarea", "tasks", true)}
          {field("position", "Puesto de trabajo", "positions", true)}
          {field("location", "Lugar específico", "locations", false)}
          <div className="md:col-span-2">{field("hazard", "Primer peligro", "hazards", false)}</div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={() => { void create() }} disabled={!ready} loading={busy}>Crear tarea</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

`summary-strip.tsx`:
- Agregar las props `taskCount: number`, `completeCount: number`, `pendingActive?: boolean` y `onTogglePending?: () => void`.
- Borrar los cálculos `controls`, `noResponsible` y `noDeadline`, y sus dos `<div>` finales.
- Después de "Riesgos", agregar:

```tsx
      <div><dt className="inline text-[var(--color-text-subtle)]">Tareas </dt><dd className="inline tabular-nums">{taskCount}</dd></div>
      <div>
        <dt className="sr-only">Riesgos completos</dt>
        <dd>
          {onTogglePending ? (
            <button type="button" aria-pressed={pendingActive} onClick={onTogglePending} className={cn(toggleClass, pendingActive && activeClass)}
              aria-label={`Filtrar la matriz: con pendientes (${entries.length - completeCount})`}>
              <span className="text-[var(--color-text-subtle)]">Completos</span> <span className="tabular-nums">{completeCount} de {entries.length}</span>
            </button>
          ) : <><span className="text-[var(--color-text-subtle)]">Completos</span> <span className="tabular-nums">{completeCount} de {entries.length}</span></>}
        </dd>
      </div>
```

Y cambiar `activeClass` para que no use `signal` (regla de `DESIGN.md`):

```ts
const activeClass = "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-tint)]"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:fast -- "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/prevencion/miper/[id]/activity-section.tsx" "app/(app)/prevencion/miper/[id]/matrix-filters-bar.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.tsx" "app/(app)/prevencion/miper/[id]/matrix-view.test.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.tsx" "app/(app)/prevencion/miper/[id]/new-task-dialog.test.tsx" "app/(app)/prevencion/miper/[id]/summary-strip.tsx"
git commit -m "feat(miper): matriz por actividad y tarea con filtros en la URL y alta de tarea"
```

---

### Task 11: Integración del espacio de trabajo y retiro de la grilla

**Files:**
- Create: `app/(app)/prevencion/miper/[id]/next-step-card.tsx`, `app/(app)/prevencion/miper/[id]/ficha-sheet.tsx`
- Modify:
  - `app/(app)/prevencion/miper/[id]/miper-workspace.tsx`
  - `app/(app)/prevencion/miper/[id]/workflow-bar.tsx`
  - `app/(app)/prevencion/miper/[id]/antecedentes-form.tsx`
  - `app/(app)/prevencion/miper/new-miper-dialog.tsx`
  - `app/(app)/prevencion/miper/[id]/loading.tsx`
  - `lib/prevention/miper/grid-view.ts`
  - `lib/prevention/miper/grid-view.test.ts`
  - `components/layout/top-bar.tsx`
- Delete: `app/(app)/prevencion/miper/[id]/matrix-grid.tsx`, `app/(app)/prevencion/miper/[id]/entry-sheet.tsx`, `components/prevention/pc-select.tsx`, `components/prevention/pc-select.test.tsx`

**Interfaces:**
- Consumes: todo lo producido en las Tasks 1 a 10.
- Produces: el espacio de trabajo nuevo. Las E2E de la Task 12 lo recorren.

- [ ] **Step 1: Leer la documentación de navegación de Next de este repo**

Run: `ls node_modules/next/dist/docs/ && grep -ril "staleTimes\|router.push\|useSearchParams" node_modules/next/dist/docs | head`

Confirmar dos cosas antes de seguir:
1. Que un `router.push` a la misma ruta dinámica con otra query vuelve a pedir el payload RSC. El editor tiene de respaldo un `router.refresh()` (Task 8), pero se asume que el push trae la fila nueva.
2. Que `useSearchParams` en un componente cliente bajo una página dinámica no exige `<Suspense>` extra en esta versión.

Anotar lo que se encontró en el mensaje del commit.

- [ ] **Step 2: `next-step-card.tsx` y `ficha-sheet.tsx`**

```tsx
// app/(app)/prevencion/miper/[id]/next-step-card.tsx
"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import type { NextStep, NextStepAction } from "@/lib/prevention/miper/next-step"

const TONE = { info: "info", warning: "warning", success: "success" } as const
const LABEL: Record<NextStepAction["kind"], string> = { ficha: "Abrir la ficha", riesgo: "Ir al riesgo", tab: "Ir a Revisión", filtro: "Ver los pendientes" }

export function NextStepCard({ step, hrefFor }: { step: NextStep | null; hrefFor: (action: NextStepAction) => string }) {
  if (!step) return null
  return (
    <Callout tone={TONE[step.tone]} title={step.title}>
      {step.description && <p>{step.description}</p>}
      {(step.action || step.secondary) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {step.action && <Button asChild size="sm"><Link href={hrefFor(step.action)}>{step.action.kind === "riesgo" ? "Empezar por el más grave" : LABEL[step.action.kind]}</Link></Button>}
          {step.secondary && <Button asChild size="sm" variant="secondary"><Link href={hrefFor(step.secondary)} scroll={false}>{LABEL[step.secondary.kind]}</Link></Button>}
        </div>
      )}
    </Callout>
  )
}
```

```tsx
// app/(app)/prevencion/miper/[id]/ficha-sheet.tsx
"use client"

import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { AntecedentesForm } from "./antecedentes-form"

/** «Ficha del documento» (spec §5.7): los antecedentes RE-04 dejan de ser una pestaña. */
export function FichaSheet({ open, onClose, workspace, editable }: { open: boolean; onClose: () => void; workspace: MiperWorkspace; editable: boolean }) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <div className="min-w-0">
            <SheetTitle>Ficha del documento</SheetTitle>
            <SheetDescription>Antecedentes del RE-04: identificación, dotación y responsables.</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody><AntecedentesForm workspace={workspace} editable={editable} onSaved={onClose} /></SheetBody>
      </SheetContent>
    </Sheet>
  )
}
```

`antecedentes-form.tsx`:
- Agregar la prop opcional `onSaved?: () => void` a la firma.
- En el callback de éxito del `operation.run(...)` de la línea 107, llamar `onSaved?.()` después de lo que ya hace.
- Agregar aviso de cambios sin guardar con `useEffect`:

```ts
useEffect(() => {
  if (!dirty) return
  const warn = (event: BeforeUnloadEvent) => event.preventDefault()
  window.addEventListener("beforeunload", warn)
  return () => window.removeEventListener("beforeunload", warn)
}, [dirty])
```

  donde `dirty` compara el estado del formulario con el `workspace.matrix` inicial. Usar el `payload` que ya arma la línea 107.

- [ ] **Step 3: `workflow-bar.tsx`**

1. Agregar la prop `onOpenFicha?: () => void`. En el diálogo de bloqueos, los problemas de `scope === "header"` pasan a ser botones que hacen `close(); onOpenFicha?.()`, con el mismo estilo que los de fila.
2. Quitar del botón de envío el sufijo ``{blocking.length > 0 ? ` (${blocking.length} pendientes)` : ""}``. Si hay bloqueos, el botón sigue abriendo el diálogo `blocking`.
3. Pasar "Descargar vN (Excel)" y "Descartar borrador" a un `DropdownMenu` con el disparador `<Button variant="secondary">Más</Button>`. Los ítems son `DropdownMenuItem asChild` con `<a href=…>` para descargar y `onSelect={() => setDialog("discard")}` para descartar.
4. Borrar los dos `<span>` finales (`readOnlyReason` y "Enviaste esta ronda…"): ahora los dice `NextStepCard`.
5. Agregar el botón "Ficha del documento" (`variant="secondary"`, `onClick={onOpenFicha}`) como **primer** elemento de la barra.

- [ ] **Step 4: Reescribir `miper-workspace.tsx`**

Reemplazar el cuerpo del componente: el cálculo de `issues`, `linkedControlIds`, `changes`, `observedEntryIds` e `intolerable` se queda tal cual. Lo que cambia:

```tsx
// imports nuevos (además de los que siguen en uso)
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { buildMatrixTree, findTask } from "@/lib/prevention/miper/matrix-tree"
import { filterRows } from "@/lib/prevention/miper/grid-view"
import { hasEntryFilters, parseMatrixFilters } from "@/lib/prevention/miper/matrix-filters"
import { nextStepFor, type NextStepAction } from "@/lib/prevention/miper/next-step"
import { hrefToEntry, hrefToFicha, hrefToMatrixWith, hrefToTab, readWorkspaceView, type WorkspaceTab } from "@/lib/prevention/miper/workspace-url"
import { FichaSheet } from "./ficha-sheet"
import { MatrixFiltersBar } from "./matrix-filters-bar"
import { MatrixView } from "./matrix-view"
import { NewTaskDialog } from "./new-task-dialog"
import { NextStepCard } from "./next-step-card"
import { RiskEditor } from "./risk-editor/risk-editor"
import { TaskView } from "./task-view"
import { useEntryAutosave } from "./use-entry-autosave"
// borrar: AntecedentesForm, EntrySheet, MatrixGrid, EMPTY_FILTERS / GridFilters, el useState de filtros
```

```tsx
  const pathname = usePathname()
  const view = readWorkspaceView(searchParams)
  const filters = useMemo(() => parseMatrixFilters(searchParams), [searchParams])
  const filtered = hasEntryFilters(filters)
  const autosave = useEntryAutosave({ matrixId: workspace.matrix.id, entryVersions: workspace.entryVersions, setRows, riskFactors: workspace.riskFactors })
  const editable = mode.canEdit && !reviewing
  const [newTaskOpen, setNewTaskOpen] = useState(false)

  const incomplete = useMemo(() => new Set([...entryIssues].filter(([, list]) => list.some((issue) => issue.severity === "error")).map(([entryId]) => entryId)), [entryIssues])
  const modified = useMemo(() => new Set([...changes.values()].filter((change) => change.kind !== "removed").map((change) => change.entryId)), [changes])
  const matching = useMemo(() => (filtered ? new Set(filterRows(rows, filters, { observed: observedEntryIds, modified, incomplete }).map((row) => row.id)) : null), [filtered, rows, filters, observedEntryIds, modified, incomplete])
  const fullTree = useMemo(() => buildMatrixTree(rows, { incomplete, observed: observedEntryIds, modified, matching: null }), [rows, incomplete, observedEntryIds, modified])
  const tree = useMemo(() => (matching ? buildMatrixTree(rows, { incomplete, observed: observedEntryIds, modified, matching }) : fullTree), [matching, fullTree, rows, incomplete, observedEntryIds, modified])
  const task = view.taskKey ? findTask(fullTree, view.taskKey) : null

  const versionLabel = workspace.versions[0] ? `v${workspace.versions[0].versionNumber}` : "sin versión aprobada"
  const step = nextStepFor({
    mode, status: workspace.matrix.status, reviewState: workspace.matrix.reviewState, hasOpenRound: Boolean(workspace.openRound),
    hasPendingChanges: workspace.pendingDiff.hasChanges, versionLabel, issues, openObservations, rows,
  })
  const hrefFor = (action: NextStepAction) =>
    action.kind === "ficha" ? hrefToFicha(pathname, searchParams, true)
      : action.kind === "riesgo" ? hrefToEntry(pathname, searchParams, action.entryId)
      : action.kind === "tab" ? hrefToTab(pathname, searchParams, action.tab)
      : hrefToMatrixWith(pathname, searchParams, { completitud: action.completitud })
  const openFicha = () => router.replace(hrefToFicha(pathname, searchParams, true), { scroll: false })
  const openEntry = (entryId: string) => router.push(hrefToEntry(pathname, searchParams, entryId))
  const baseline = reviewing ? workspace.reviewBaselineSnapshot : workspace.lastVersionSnapshot
  const atRoot = !view.taskKey && !view.entryId
```

Y el JSX:

```tsx
    <PageContainer width="workbench">
      <PageHeader
        title={…igual…} description={workspace.label} breadcrumb={…igual…}
        actions={<div className="flex flex-wrap items-center gap-2">
          {editable && <Button variant="secondary" onClick={() => setNewTaskOpen(true)}>Nueva tarea</Button>}
          <WorkflowBar workspace={workspace} mode={mode} issues={issues} openObservations={openObservations} onOpenEntry={openEntry} onOpenFicha={openFicha} />
        </div>}
      />
      <div className="space-y-3">
        {atRoot && <NextStepCard step={step} hrefFor={hrefFor} />}
        {reviewing && <Callout tone="info" title="Estás revisando la versión enviada">Los cambios que la prevencionista haga después del envío quedan para la ronda siguiente.</Callout>}
        {intolerable > 0 && <Callout tone="danger" role="alert" title={`${intolerable} riesgo(s) Intolerable(s)`}>{CLASSIFICATION_CRITERIA.intolerable}</Callout>}
        <Tabs value={view.tab} onValueChange={(value) => router.replace(hrefToTab(pathname, searchParams, value as WorkspaceTab), { scroll: false })}>
          <TabsList>
            <TabsTrigger value="matriz">Matriz ({rows.length})</TabsTrigger>
            <TabsTrigger value="programa">Programa</TabsTrigger>
            <TabsTrigger value="revision">Revisión{openObservations > 0 ? ` (${openObservations})` : ""}</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>
          <TabsContent value="matriz" className="space-y-3">
            {view.entryId ? (
              <RiskEditor key={view.entryId} entryId={view.entryId} step={view.step} rows={rows} issuesByEntry={entryIssues} incomplete={incomplete} matching={matching}
                editable={editable} mode={mode} autosave={autosave} change={changes.get(view.entryId) ?? null}
                baselineEntry={baseline?.entries.find((entry) => entry.id === view.entryId) ?? null}
                data={{ matrixId: workspace.matrix.id, published: workspace.matrix.status === "published", riskFactors: workspace.riskFactors, dictionaries: workspace.dictionaries, responsibleOptions: workspace.responsibleOptions, controlVersions: workspace.controlVersions, controlActionLinks: workspace.controlActionLinks, observations: workspace.observations }} />
            ) : view.taskKey ? (
              task
                ? <TaskView matrixId={workspace.matrix.id} task={task} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues} />
                : <EmptyState title="Esta tarea ya no existe" description="Puede que sus riesgos se hayan movido o eliminado." action={<Button asChild><Link href={hrefToTab(pathname, searchParams, "matriz")}>Volver a la matriz</Link></Button>} />
            ) : (
              <>
                <SummaryStrip snapshot={liveSnapshot} authorName={null} submittedAt={workspace.openRound?.submittedAt ?? null} versionLabel={versionLabel}
                  taskCount={fullTree.reduce((sum, activity) => sum + activity.tasks.length, 0)} completeCount={rows.length - incomplete.size}
                  activeClassifications={filters.classifications} pendingActive={filters.onlyIncomplete} uncontrolledActive={filters.controlled === "no"}
                  onToggleClassification={(cls) => setFilter("clasificacion", (filters.classifications.includes(cls) ? filters.classifications.filter((item) => item !== cls) : [...filters.classifications, cls]).join(",") || null)}
                  onTogglePending={() => setFilter("completitud", filters.onlyIncomplete ? null : "pendientes")}
                  onToggleUncontrolled={() => setFilter("controlado", filters.controlled === "no" ? null : "no")} />
                <MatrixView tree={tree} filtered={filtered} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues}
                  riskFactors={workspace.riskFactors} hasBaseline={baseline !== null} onNewTask={() => setNewTaskOpen(true)}
                  toolbar={({ collapsedAll, toggleAll }) => <MatrixFiltersBar filters={filters} riskFactors={workspace.riskFactors} hasBaseline={baseline !== null} collapsedAll={collapsedAll} onToggleAll={toggleAll} />} />
              </>
            )}
          </TabsContent>
          <TabsContent value="programa"><ProgramPanel matrixId={workspace.matrix.id} mode={mode} userId={userId} users={workspace.responsibleOptions} onOpenRiskEntry={openEntry} /></TabsContent>
          <TabsContent value="revision"><ReviewPanel workspace={workspace} mode={mode} onOpenEntry={openEntry} /></TabsContent>
          <TabsContent value="historial"><HistoryPanel workspace={workspace} history={history} /></TabsContent>
        </Tabs>
      </div>
      <FichaSheet open={view.ficha} onClose={() => router.replace(hrefToFicha(pathname, searchParams, false), { scroll: false })} workspace={workspace} editable={editable} />
      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} matrixId={workspace.matrix.id} rows={rows} dictionaries={workspace.dictionaries} />
    </PageContainer>
```

donde `setFilter` sale de `const { setFilter } = useUrlFilters()`. `SummaryStrip` recibe `authorName={null}`: el nombre de quien elaboró era incorrecto (diagnóstico §1.1, defecto 5) y lo resuelve la Fase B con `submittedByName`.

- [ ] **Step 5: Retirar lo obsoleto**

```bash
git rm "app/(app)/prevencion/miper/[id]/matrix-grid.tsx" "app/(app)/prevencion/miper/[id]/entry-sheet.tsx" components/prevention/pc-select.tsx components/prevention/pc-select.test.tsx
```

- En `grid-view.ts`, borrar `groupRows` y `GroupBy`, y en `grid-view.test.ts` sus casos.
- En `new-miper-dialog.tsx:42`, cambiar `?tab=antecedentes` por `?ficha=1`.
- En `[id]/loading.tsx` y `../loading.tsx`, cambiar el título "MIPER y controles" por "Matriz IPER (MIPER)".
- En `components/layout/top-bar.tsx`, actualizar el comentario de `OWN_SEARCH_PATTERNS`: "la matriz y el programa tienen buscadores propios y rotulados". El patrón no cambia.
- Buscar consumidores sueltos con `rg -n "matrix-grid|entry-sheet|pc-select|groupRows" app lib components e2e docs` y corregir lo que aparezca (en `docs/` sólo el manual, Task 13).

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run lint && npm run test:fast -- lib/prevention/miper "app/(app)/prevencion/miper" components/prevention components/ui/combobox.test.tsx components/ui/choice-card-group.test.tsx components/layout/top-bar-own-search.test.ts`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add -A "app/(app)/prevencion/miper" lib/prevention/miper components/prevention components/layout/top-bar.tsx
git commit -m "feat(miper): espacio de trabajo por niveles y retiro de la grilla tipo planilla"
```

---

### Task 12: E2E migradas al editor

**Files:**
- Create: `e2e/miper-helpers.ts`
- Modify: `e2e/prevencion-miper-interacciones.spec.ts` (se reescribe), `e2e/prevencion-miper-flujo.spec.ts`, `e2e/prevencion-miper-escenario.spec.ts`, `e2e/prevencion-miper-programa.spec.ts`

**Interfaces:**
- Consumes: `login`, `expectPageTitle`, `pickCurrentMonthDate` y `textoVisible` (`e2e/helpers.ts`); las matrices sembradas `riskmatrix-teclado-e2e`, `riskmatrix-estructura-e2e` y `riskmatrix-concurrencia-e2e` (`e2e/setup-db.ts`).
- Produces: los helpers `crearTarea`, `campo`, `escribir`, `elegir`, `elegirOpcion`, `irAPaso`, `agregarMedida` y `abrirRiesgo`.

- [ ] **Step 1: Helpers**

```ts
// e2e/miper-helpers.ts
import { expect, type Page } from "@playwright/test"
import { pickCurrentMonthDate } from "./helpers"

/**
 * Helpers del editor del riesgo (spec MIPER 2026-10-02 §5.4). Reemplazan al
 * `cell(column, row)` de la grilla, que se retiró. Las vistas nuevas no
 * duplican árbol móvil/escritorio, así que los roles bastan: no hace falta
 * `textoVisible()` para estos campos.
 */
export const campo = (page: Page, label: string) => page.getByRole("combobox", { name: label, exact: true })

/** Escribe un campo de texto con sugerencias y lo confirma al salir (el Combobox con valor libre guarda en el blur). */
export async function escribir(page: Page, label: string, value: string) {
  const input = campo(page, label)
  await input.click()
  await input.fill(value)
  await input.press("Tab")
  await expect(input).toHaveValue(value)
}

/** Una tarjeta de un grupo de radio: P, C, ¿controlado?, rutinaria. */
export async function elegir(page: Page, grupo: string, opcion: string | RegExp) {
  await page.getByRole("radiogroup", { name: grupo }).getByRole("radio", { name: opcion }).click()
}

/** Un `OptionSelect` (Radix): factor de riesgo, tipo de control, responsable. */
export async function elegirOpcion(page: Page, label: string, opcion: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: opcion, exact: true }).click()
}

export async function irAPaso(page: Page, paso: "Identificación" | "Evaluación" | "Medidas de control" | "Seguimiento") {
  await page.getByRole("tab", { name: new RegExp(paso) }).click()
}

/**
 * «Nueva tarea» en la cabecera: crea el primer riesgo y deja el editor abierto en Identificación.
 * Las acciones del `PageHeader` viajan dos veces al DOM (TopBar y copia `lg:sr-only`); se acota
 * al `banner`, como hace `estado()` en el spec del flujo, en vez de tomar `.first()`.
 */
export async function crearTarea(page: Page, valores: { actividad: string; tarea: string; puesto: string; peligro?: string }) {
  await page.getByRole("banner").getByRole("button", { name: "Nueva tarea", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva tarea" })
  for (const [label, value] of [["Actividad", valores.actividad], ["Tarea", valores.tarea], ["Puesto de trabajo", valores.puesto], ["Primer peligro", valores.peligro]] as const) {
    if (!value) continue
    const input = dialog.getByRole("combobox", { name: label, exact: true })
    await input.click()
    await input.fill(value)
    await input.press("Tab")
  }
  await dialog.getByRole("button", { name: "Crear tarea" }).click()
  await expect(page).toHaveURL(/fila=[^&]+&paso=identificacion/)
  await expect(page.getByRole("tab", { name: /Identificación/, selected: true })).toBeVisible()
}

export async function agregarMedida(page: Page, valores: { tipo?: string; descripcion: string; responsable: string }) {
  await irAPaso(page, "Medidas de control")
  await page.getByRole("button", { name: "Agregar medida", exact: true }).click()
  if (valores.tipo) await elegirOpcion(page, "Tipo de control", valores.tipo)
  await page.getByLabel("Descripción de la medida").fill(valores.descripcion)
  await page.getByLabel("Nombre o cargo responsable").fill(valores.responsable)
  await pickCurrentMonthDate(page, "Plazo de la medida")
  await page.getByRole("button", { name: "Agregar medida", exact: true }).click()
  await expect(page.getByRole("article", { name: new RegExp(`Medida: ${valores.descripcion.slice(0, 20)}`) })).toBeVisible()
}

/** Desde la estructura: abre un riesgo por su N° visible usando el filtro de búsqueda. */
export async function abrirRiesgo(page: Page, numero: number, peligro: string) {
  await page.getByLabel("Buscar en la matriz").fill(peligro)
  await page.getByRole("link", { name: `Riesgo #${numero}: ${peligro}` }).click()
  await expect(page).toHaveURL(/fila=/)
}
```

> Revisa la firma real de `pickCurrentMonthDate` en `e2e/helpers.ts:175` (en el spec de
> interacciones recibe el nombre del botón del `DatePicker`) y ajusta la llamada si pide otros
> argumentos.

- [ ] **Step 2: Reescribir `prevencion-miper-interacciones.spec.ts`**

Conservar el comentario de cabecera sobre las matrices sembradas y reemplazar el resto por:

```ts
import { test, expect } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"
import { agregarMedida, campo, crearTarea, elegir, escribir, irAPaso } from "./miper-helpers"

const MATRIZ_TECLADO = "/prevencion/miper/riskmatrix-teclado-e2e"
const MATRIZ_ESTRUCTURA = "/prevencion/miper/riskmatrix-estructura-e2e"
const MATRIZ_CONCURRENCIA = "/prevencion/miper/riskmatrix-concurrencia-e2e"

test("navegación por niveles: tarea → riesgo → volver conserva los filtros", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_TECLADO)
  await expectPageTitle(page, "MIPER Faena Restringida E2E 2037")
  await crearTarea(page, { actividad: "Transporte de lodo", tarea: "Carga en planta", puesto: "Conductor", peligro: "Camión en movimiento" })
  await page.getByRole("link", { name: /Volver a la tarea/ }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Carga en planta" })).toBeVisible()
  await page.getByRole("link", { name: /Volver a la matriz/ }).click()
  await page.getByLabel("Buscar en la matriz").fill("camión")
  await expect(page).toHaveURL(/buscar=cami/)
  await page.getByRole("link", { name: /Riesgo #1: Camión en movimiento/ }).click()
  await page.goBack()
  await expect(page).toHaveURL(/buscar=cami/)
  await expect(page.getByLabel("Buscar en la matriz")).toHaveValue("camión")
})

test("«Agregar peligro» hereda la tarea y «Duplicar riesgo» copia el riesgo", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_ESTRUCTURA)
  await crearTarea(page, { actividad: "Mantención", tarea: "Cambio de neumáticos", puesto: "Mecánico", peligro: "Neumático presurizado" })
  await page.getByRole("link", { name: /Volver a la tarea/ }).click()
  await page.getByRole("button", { name: "Agregar peligro" }).click()
  await expect(page).toHaveURL(/paso=identificacion/)
  await expect(campo(page, "Puesto de trabajo")).toHaveValue("Mecánico")
  await escribir(page, "Peligro", "Gata hidráulica")
  await page.getByRole("button", { name: /Más acciones del riesgo 2/ }).click()
  await page.getByRole("menuitem", { name: "Duplicar riesgo" }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Gata hidráulica" })).toBeVisible()
  await expect(page.getByText(/Riesgo #3/)).toBeVisible()
})

test("el guardado automático persiste tras recargar y una evaluación Intolerable lo anuncia", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_TECLADO)
  await crearTarea(page, { actividad: "Bodega", tarea: "Apilado", puesto: "Bodeguero", peligro: "Carga suspendida" })
  await escribir(page, "Riesgo", "Golpeado por")
  await irAPaso(page, "Evaluación")
  await elegir(page, "Probabilidad", /^4 · Alta/)
  await elegir(page, "Consecuencia", /^4 · Alta/)
  await expect(page.getByRole("status").filter({ hasText: /Intolerable\s*·\s*MR 16/ })).toBeVisible()
  await expect(page.getByText(/Guardado a las/)).toBeVisible()
  await expect(async () => {
    await page.reload()
    await irAPaso(page, "Identificación")
    await expect(campo(page, "Riesgo")).toHaveValue("Golpeado por", { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await expect(page.getByRole("alert").filter({ hasText: "Intolerable" })).toBeVisible()
})

test("dos pestañas sobre el mismo riesgo: la segunda ve el conflicto en el campo y el valor vuelve atrás", async ({ browser }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  await login(first)
  await first.goto(MATRIZ_CONCURRENCIA)
  await crearTarea(first, { actividad: "Taller", tarea: "Soldadura", puesto: "Soldador", peligro: "Arco eléctrico" })
  const url = first.url()
  const second = await context.newPage()
  await second.goto(url)
  await escribir(first, "Riesgo", "Quemadura")
  const input = campo(second, "Riesgo")
  await input.click()
  await input.fill("Radiación UV")
  await input.press("Tab")
  // El motivo aparece dos veces, ambas visibles: bajo el campo (role=alert) y en el estado de guardado.
  await expect(second.getByRole("status").filter({ hasText: /No se guardó: La fila cambió mientras la editabas/ })).toBeVisible()
  await expect(second.getByRole("alert").filter({ hasText: /La fila cambió mientras la editabas/ })).toBeVisible()
  await expect(input).not.toHaveValue("Radiación UV")
  await context.close()
})

test("«Siguiente pendiente» recorre los riesgos con datos faltantes", async ({ page }) => {
  await login(page)
  await page.goto(MATRIZ_ESTRUCTURA)
  await crearTarea(page, { actividad: "Oficina", tarea: "Digitación", puesto: "Administrativo", peligro: "Postura prolongada" })
  await page.getByRole("link", { name: /Volver a la tarea/ }).click()
  await page.getByRole("button", { name: "Agregar peligro" }).click()
  await escribir(page, "Peligro", "Pantalla")
  await page.getByRole("link", { name: "Siguiente pendiente" }).click()
  await expect(page.getByRole("heading", { level: 2, name: /Postura prolongada/ })).toBeVisible()
  await agregarMedida(page, { tipo: "IV. Controles administrativos", descripcion: "Pausas activas cada dos horas", responsable: "Supervisor" })
})
```

> Las matrices "estructura" y "teclado" se reutilizan entre corridas. Si `setup-db.ts` no las
> vacía antes de cada corrida, el N° esperado (#1, #2, #3) puede variar: confirma que el seed las
> reinicia vacías, como dice el comentario de cabecera.

- [ ] **Step 3: Migrar `flujo`, `escenario` y `programa`**

Borrar la constante local `cell` y la función local `fill` / `escribir` de cada spec e importar
desde `./miper-helpers`. Reemplazos:

| Antes (grilla) | Después (editor) |
|---|---|
| `expect(page).toHaveURL(/…\?tab=antecedentes/)` tras crear la MIPER | `expect(page).toHaveURL(/…\?ficha=1/)` y `expect(page.getByRole("dialog", { name: "Ficha del documento" })).toBeVisible()` |
| `getByRole("tab", { name: /Matriz/ }).click()` + `getByRole("button", { name: "Agregar la primera fila" }).click()` + `fill("Actividad"/"Tarea"/"Puesto de trabajo"/"Peligro", …)` | `crearTarea(page, { actividad, tarea, puesto, peligro })` |
| `fill("Riesgo", v)`, `fill("Daño probable", v)` | `escribir(page, "Riesgo", v)`, `escribir(page, "Daño probable", v)` |
| `cell(page, "Factor de riesgo").selectOption({ label: "Mecánico" })` | `elegirOpcion(page, "Factor de riesgo", "Mecánico")` |
| `cell(page, "Rutinaria").selectOption("yes")` | `elegir(page, "¿Es una tarea rutinaria?", "Rutinaria")` |
| `cell(page, "Probabilidad").selectOption("4")` / `"Consecuencia"` | `irAPaso(page, "Evaluación")` + `elegir(page, "Probabilidad", /^4 · Alta/)` / `elegir(page, "Consecuencia", /^4 · Alta/)` |
| `cell(page, "¿Controlado?").selectOption("no")` | `irAPaso(page, "Medidas de control")` + `elegir(page, "¿Está controlado el riesgo?", "No")` |
| `getByRole("button", { name: "Medidas de control del riesgo 1" }).click()` + dialog "Riesgo #1" + `agregarMedida` local | `agregarMedida(page, { descripcion, responsable })` |
| `page.keyboard.press("Escape")` + `expect(page).not.toHaveURL(/fila=/)` | `page.getByRole("link", { name: /Volver a la tarea/ }).click()` + `expect(page).not.toHaveURL(/fila=/)` |
| `getByRole("button", { name: "Enviar a revisión (1 pendientes)", exact: true })` | `getByRole("button", { name: "Enviar a revisión", exact: true })`; el diálogo sigue llamándose "Faltan 1 datos para enviar" |
| La Jefa: `getByRole("button", { name: "Observar riesgo 1", exact: true })` | `abrirRiesgo(page, 1, "<peligro>")` + `irAPaso(page, "Seguimiento")` + `getByLabel("Nueva observación")` + "Registrar observación" |
| Badge "Modificada" en la grilla | `abrirRiesgo` no hace falta: en la vista de la tarea, `getByRole("link", { name: /Riesgo #1/ })` contiene "Modificada" |
| `escenario`: tras "Ver la fila 1 en la MIPER", URL con `tab=matriz` y `fila=` + dialog "Riesgo #1" con "Medidas de control (1)", "Programa de Trabajo (1)", "Actividad #1" | URL con `fila=` (sin `tab`), `getByRole("tab", { name: /Medidas de control \(1\)/ })`, y en `irAPaso(page, "Seguimiento")`: "Programa de Trabajo (1)" y "Actividad #1" |
| Antecedentes: `getByRole("tab", { name: "Antecedentes" })` | `getByRole("button", { name: "Ficha del documento" }).click()` |

- [ ] **Step 4: Correr las E2E de MIPER, una por vez**

Run, en orden:
1. `npm run test:e2e -- e2e/prevencion-miper-interacciones.spec.ts`
2. `npm run test:e2e -- e2e/prevencion-miper-flujo.spec.ts`
3. `npm run test:e2e -- e2e/prevencion-miper-escenario.spec.ts`
4. `npm run test:e2e -- e2e/prevencion-miper-programa.spec.ts`
5. `npm run test:e2e -- e2e/prevencion-miper-matriz.spec.ts e2e/prevencion-miper-controles.spec.ts`

Expected: todos PASS. Si una falla, abrir el trace (`npx playwright show-trace`) antes de tocar
el localizador. Que una acción "no ocurra" suele ser un nodo duplicado oculto (`AGENTS.md`,
"Locators in this repository").

- [ ] **Step 5: Commit**

```bash
git add e2e/miper-helpers.ts e2e/prevencion-miper-interacciones.spec.ts e2e/prevencion-miper-flujo.spec.ts e2e/prevencion-miper-escenario.spec.ts e2e/prevencion-miper-programa.spec.ts
git commit -m "test(miper): E2E sobre el editor del riesgo en vez de las celdas de la grilla"
```

---

### Task 13: Manual, verificación en navegador y puertas

**Files:**
- Modify: `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md` (§5 y las menciones a la grilla en las líneas 78, 139, 204 y 248)
- Create: `qa/reports/2026-10-XX-miper-ui-fase-a.md`. Reemplazar XX por la fecha real de la verificación.

- [ ] **Step 1: Manual**

Reescribir el §5 "La Grilla de la Matriz…" como **"§5 La matriz: actividades, tareas y el editor del riesgo"**, con estos subtítulos:

- Cómo se organiza (actividad › tarea › riesgo).
- Buscar y filtrar (filtros en la URL, chips, "Contraer todo").
- Agregar una tarea o un peligro.
- Editar un riesgo (los cuatro pasos, el chequeo y el guardado automático con su estado).
- Recorrer los pendientes ("Siguiente pendiente").
- En el celular (ya se puede editar).

Cambiar "la grilla" por "la matriz" en las otras menciones y borrar la afirmación vieja de que las
columnas "siguen el orden del RE-04". El orden del RE-04 queda **sólo** en la exportación Excel.

- [ ] **Step 2: Recorrido asistido en navegador**

Arrancar con `next dev` (:3001, `bodega_dev`). Antes, comparar `drizzle.__drizzle_migrations`
con el journal (memoria del repo). Usar el Chromium de `@playwright/test` con la sesión
`playwright/.auth/monkeytest.json`, **sin imprimir cookies**, sobre la MIPER de 222 riesgos
(`riskmatrix-7fJbp_csGgyQu8qUbYbiC`) a 1440×900 y a 390×844. Medir y registrar:

| Comprobación | Criterio |
|---|---|
| `document.documentElement.scrollWidth <= innerWidth` y ningún contenedor con `scrollWidth > clientWidth + 1` en la estructura, la tarea y el editor | Sin scroll horizontal |
| `document.querySelectorAll("input,select,textarea,button").length` en la estructura | < 400 (era 4.716) |
| Portada → MIPER → riesgo #25 (Importante, sin medidas) → "Agregar medida" → guardar → "Siguiente pendiente" | Sin salir del editor y sin scroll lateral |
| Error de guardado forzado (editar en dos pestañas) | Mensaje en el campo y valor revertido |
| Consola y red | Sin errores nuevos; el avatar de dicebear es ruido conocido |
| Modo revisión (usuario `jefa.prevencion@e2e.chome.cl` en una MIPER enviada del seed E2E, o declararlo como gap) | Editor en lectura, con "Registrar observación" en Seguimiento |

Escribir `qa/reports/2026-10-XX-miper-ui-fase-a.md` con PASS, hallazgos clasificados (PRODUCT
BUG, UX FINDING…) y COVERAGE GAP explícito para lo que no se recorrió: por ejemplo, Programa,
Revisión e Historial sólo como pestañas, porque se rediseñan en la Fase E.

- [ ] **Step 3: Puertas**

Run: `npm run typecheck && npm run lint && npm run test:fast && npm run check:secrets && npm run doctor`
Expected: verde. `test:pglite` y `db:verify-migrations` no aplican: no hay cambios de servicio ni
de esquema. Correrlos igual si el tiempo lo permite y anotar el resultado en el informe.

- [ ] **Step 4: Commit**

```bash
git add docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md qa/reports/
git commit -m "docs(miper): manual de la matriz por niveles e informe de verificación de la Fase A"
```

---

## Después de la Fase A

Escribir el plan de la **Fase B** (portada y Resumen, spec §7) con este mismo formato, apoyado en
`listMiperPortfolio`. Las Fases C (importación con medidas; **antes de escribirla, confirmar D5 y
D6 con el usuario**), D (acciones masivas) y E (programa, revisión, historial) siguen en ese
orden: cada una parte de la anterior ya integrada.
