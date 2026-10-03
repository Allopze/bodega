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
