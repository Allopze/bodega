"use client"

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Pagination } from "@/components/ui/pagination"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { choosePhraseType, type ImportDecisions, type PhraseDecision } from "@/lib/prevention/miper/import-decisions"
import { FREQUENCY_MAX_LENGTH, RESPONSIBLE_MAX_LENGTH, type DeadlineDecision, type MeasureAnalysis, type PhraseGroup, type ResponsibleDecision, type ValueGroup } from "@/lib/prevention/miper/re04-measures"
import { CONTROL_HIERARCHY_LABEL, type ControlHierarchy } from "@/lib/prevention/miper/snapshot"
import { countOf, todayInChile } from "@/lib/utils"

const HIERARCHY_OPTIONS = (Object.entries(CONTROL_HIERARCHY_LABEL) as Array<[ControlHierarchy, string]>).map(([value, label]) => ({ value, label }))
const AS_WRITTEN = "__excel__"
const NOBODY = "__nadie__"
const KIND_OPTIONS = [
  { value: "existing", label: "Ya implementadas: se verifican" },
  { value: "pending", label: "Por implementar: llevan plazo" },
]
/**
 * Frases por página. Un RE-04 real trae unas 222 frases distintas: sin páginas,
 * el paso pintaba 222 selectores y 222 botones seguidos, y responsables y plazos
 * quedaban debajo de todos ellos (también para quien recorre con el teclado).
 */
const PHRASES_PER_PAGE = 25
/** Nombre corto de una frase o un valor para los nombres accesibles. */
const short = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text)
const valueLabel = (group: { text: string | null }) => group.text ?? "(vacío)"

/**
 * La frecuencia con que nace una medida que se pasa a «Ya implementadas»: la
 * sugerida si el valor ya era existente (en un libro exportado, «Existente ·
 * Trimestral» sugiere «Trimestral»), y si no, el texto de PLAZOS.
 */
function existingFrequency(group: ValueGroup<DeadlineDecision>): string | null {
  if (group.suggestion.kind === "existing") return group.suggestion.frequency
  return group.text?.slice(0, FREQUENCY_MAX_LENGTH) ?? null
}

/**
 * El aviso de un plazo por implementar que vence el día de la importación o
 * antes: «INMEDIATO» se sugiere con la fecha de hoy, así que esas medidas nacen
 * venciendo. Se dice al lado de la decisión y con cuántas medidas afecta, para
 * que la persona elija otra fecha o «Ya implementadas» sabiendo lo que hace.
 */
function dueNotice(decision: DeadlineDecision, count: number, today: string): string | null {
  if (decision.kind !== "pending" || decision.dueDate === null || decision.dueDate > today) return null
  return decision.dueDate === today
    ? `${countOf(count, "medida vence", "medidas vencen")} hoy, el día de la importación.`
    : `${countOf(count, "medida nace vencida", "medidas nacen vencidas")}: la fecha ya pasó.`
}

/**
 * Enter sobre una opción del selector de tipo. Radix elige la opción en el
 * `keydown` y no lo cancela, así que el navegador además «hace clic» con Enter
 * (la activación del `keypress`) sobre lo que tenga el foco en ese instante.
 * Confirmar mueve el foco de inmediato al selector que queda en esa posición, y
 * ese clic lo abría: sin «Sólo sugeridas» se reabría el mismo selector, con el
 * filtro, el de la frase siguiente. Cancelar el `keydown` quita sólo ese clic,
 * porque Radix ya eligió. Espacio no lo necesita: Radix ya lo cancela.
 * Las opciones viven en un portal, pero los eventos de React suben por el árbol
 * de componentes y llegan a la celda.
 */
function cancelEnterClick(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Enter" && event.target instanceof Element && event.target.closest('[role="option"]')) event.preventDefault()
}

/** Una frase cuyo tipo nadie eligió y que ninguna palabra clave sugiere: el tipo es un descarte. */
const isNoHint = (phrase: PhraseGroup, decision: PhraseDecision | undefined) => phrase.suggestion.source === "default" && !decision?.confirmed

/**
 * Paso «Medidas detectadas» de la importación (Fase C, spec §8). La persona
 * decide UNA VEZ por valor distinto (D6), no fila por fila:
 * - el tipo I–V de cada frase: el Excel no lo trae y la plataforma lo sugiere.
 *   Revisarlo NO es obligatorio (decisión del usuario, 2026-10-03): un RE-04
 *   real trae 176 a 239 frases, y exigir confirmarlas todas convertía la
 *   importación en «corregir más de 100 cosas». La medida nace «Propuesta» y su
 *   tipo se cambia después en el riesgo. Las «sin pista» van primero;
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
  const [page, setPage] = useState(1)
  const noticeId = useId()
  const phraseTableRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  /** A dónde va el foco después de confirmar: el selector de esa fila de la página, o el filtro. */
  const pendingFocus = useRef<number | "filter" | null>(null)
  const today = todayInChile()
  /* Las «sin pista» van primero, siempre en el mismo orden: el orden sale de la
   * sugerencia (que no cambia) y no de lo elegido, para que una fila no salte de
   * lugar al elegirle un tipo. El filtro deja sólo las que siguen sin elegir. */
  const ordered = [
    ...analysis.phrases.filter((phrase) => phrase.suggestion.source === "default"),
    ...analysis.phrases.filter((phrase) => phrase.suggestion.source !== "default"),
  ]
  const noHint = ordered.filter((phrase) => isNoHint(phrase, decisions.phrases[phrase.key]))
  const phrases = onlySuggested ? noHint : ordered
  // Confirmar con «Sólo sugeridas» achica la lista: la página se acota a la última que queda.
  const currentPage = Math.min(page, Math.max(1, Math.ceil(phrases.length / PHRASES_PER_PAGE)))
  const pagePhrases = phrases.slice((currentPage - 1) * PHRASES_PER_PAGE, currentPage * PHRASES_PER_PAGE)
  const setResponsible = (key: string, decision: ResponsibleDecision) => onChange({ ...decisions, responsibles: { ...decisions.responsibles, [key]: decision } })
  const setDeadline = (key: string, decision: DeadlineDecision) => onChange({ ...decisions, deadlines: { ...decisions.deadlines, [key]: decision } })

  /* Confirmar saca de la pantalla el control que tenía el foco: el botón
   * «Confirmar», la fila entera con «Sólo sugeridas», o deja deshabilitado
   * «Aceptar sugerencias». El foco pasa al selector que queda en esa posición
   * (la frase que sigue) o, si no queda ninguna, al filtro. Va en un efecto de
   * layout para llegar antes de que el diálogo, al ver el foco perdido, lo
   * devuelva a su comienzo. */
  useLayoutEffect(() => {
    const request = pendingFocus.current
    if (request === null) return
    pendingFocus.current = null
    const selectors = phraseTableRef.current?.querySelectorAll<HTMLElement>('tbody [role="combobox"]')
    const target = request !== "filter" && selectors?.length ? selectors[Math.min(request, selectors.length - 1)] : filterRef.current
    target?.focus()
  })

  function choosePhrase(index: number, key: string, hierarchy: ControlHierarchy) {
    pendingFocus.current = index
    onChange(choosePhraseType(decisions, key, hierarchy))
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="importar-tipos" className="space-y-3">
        <div className="space-y-1">
          <h3 id="importar-tipos" className="text-sm font-semibold">Tipo de cada medida</h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            {countOf(analysis.measures.length, "medida")} en {countOf(analysis.phrases.length, "frase distinta", "frases distintas")}. El Excel no trae
            el tipo (I a V): la plataforma lo sugiere por las palabras de cada frase. Corrige el que quieras; no hace falta revisarlos para
            seguir, y el tipo se puede cambiar después en cada medida.
          </p>
        </div>
        {/* Un solo bloque para el filtro: al elegir la última «sin pista» el aviso se va,
          * pero el checkbox sigue en el mismo lugar y conserva el foco. */}
        {(noHint.length > 0 || onlySuggested) && (
          <div className="flex flex-wrap items-center gap-3">
            {noHint.length > 0 && (
              <p className="text-sm">
                {countOf(noHint.length, "frase sin pista", "frases sin pista")}: ninguna palabra clave calzó y {noHint.length === 1 ? "se carga" : "se cargan"} como{" "}
                {CONTROL_HIERARCHY_LABEL[noHint[0]!.suggestion.hierarchy]} si no eliges otro tipo. Van primero.
              </p>
            )}
            <Checkbox ref={filterRef} label="Sólo sin pista" checked={onlySuggested} onChange={(event) => { setOnlySuggested(event.target.checked); setPage(1) }} />
          </div>
        )}
        <div>
          <TableRoot ref={phraseTableRef} aria-label="Tipo de cada medida detectada">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medida</TableHead>
                  <TableHead className="text-right">Veces</TableHead>
                  <TableHead>Tipo de control</TableHead>
                  <TableHead>Origen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagePhrases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-[var(--color-text-muted)]">No quedan frases sin pista.</TableCell>
                  </TableRow>
                )}
                {pagePhrases.map((phrase, index) => {
                  const decision = decisions.phrases[phrase.key]!
                  return (
                    <TableRow key={phrase.key}>
                      <TableCell className="min-w-64 whitespace-normal">{phrase.text}</TableCell>
                      <TableCell className="text-right tabular-nums">{phrase.count}</TableCell>
                      <TableCell className="min-w-56" onKeyDown={cancelEnterClick}>
                        {/* En una «sin pista» el tipo es un descarte: se muestra como marcador y no
                          * como valor, y así elegir ESE mismo tipo también cuenta como elegido (el
                          * selector no avisa cuando el valor no cambia). La sugerida por palabra
                          * clave se muestra como valor: ya es lo que se carga. */}
                        <OptionSelect aria-label={`Tipo de control de «${short(phrase.text)}»`} options={HIERARCHY_OPTIONS}
                          value={isNoHint(phrase, decision) ? "" : decision.hierarchy} placeholder={CONTROL_HIERARCHY_LABEL[decision.hierarchy]}
                          onValueChange={(value) => choosePhrase(index, phrase.key, value as ControlHierarchy)} />
                      </TableCell>
                      <TableCell>
                        <PhraseOrigin phrase={phrase} decision={decision} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>
          <Pagination page={currentPage} total={phrases.length} perPage={PHRASES_PER_PAGE} onPage={setPage} />
        </div>
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
                // Al largo que acepta el servidor, como la sugerencia: un RESPONSABLE más largo no puede rechazar la carga.
                const asWritten = { kind: "text" as const, name: (group.text ?? "").slice(0, RESPONSIBLE_MAX_LENGTH) }
                return (
                  <TableRow key={group.key}>
                    <TableCell className="min-w-48 whitespace-normal">{valueLabel(group)}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.count}</TableCell>
                    <TableCell className="min-w-64">
                      <OptionSelect aria-label={`Responsable para «${short(valueLabel(group))}»`} options={options} value={value}
                        onValueChange={(next) => setResponsible(group.key, next === AS_WRITTEN ? asWritten : next === NOBODY ? { kind: "none" } : { kind: "user", userId: next })} />
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
              {analysis.deadlines.map((group, index) => {
                const decision = decisions.deadlines[group.key]!
                const label = short(valueLabel(group))
                const notice = dueNotice(decision, group.count, today)
                const noticeElementId = `${noticeId}-plazo-${index}`
                return (
                  <TableRow key={group.key}>
                    <TableCell className="min-w-48 whitespace-normal">{valueLabel(group)}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.count}</TableCell>
                    <TableCell className="min-w-56">
                      <OptionSelect aria-label={`Cómo se cargan las medidas con «${label}»`} options={KIND_OPTIONS} value={decision.kind}
                        onValueChange={(kind) => setDeadline(group.key, kind === "existing"
                          ? { kind: "existing", frequency: existingFrequency(group) }
                          : { kind: "pending", dueDate: todayInChile() })} />
                    </TableCell>
                    <TableCell className="min-w-48">
                      {decision.kind === "existing" ? (
                        <Input aria-label={`Frecuencia de verificación para «${label}»`} value={decision.frequency ?? ""} maxLength={FREQUENCY_MAX_LENGTH} placeholder="Trimestral"
                          onChange={(event) => setDeadline(group.key, { kind: "existing", frequency: event.target.value || null })} />
                      ) : (
                        <div className="space-y-1">
                          <DatePicker ariaLabel={`Plazo para «${label}»`} value={decision.dueDate ?? undefined} aria-describedby={notice ? noticeElementId : undefined}
                            onChange={(iso) => setDeadline(group.key, { kind: "pending", dueDate: iso })} />
                          {notice && <p id={noticeElementId} className="text-xs font-medium text-[var(--color-warning-ink)]">{notice}</p>}
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

/** De dónde sale el tipo: el Excel, una persona, una palabra clave o un descarte («sin pista»). */
function PhraseOrigin({ phrase, decision }: { phrase: PhraseGroup; decision: PhraseDecision }) {
  if (isNoHint(phrase, decision)) return <Badge variant="warning" size="sm">Sin pista</Badge>
  const fromExcel = phrase.suggestion.source === "prefix" && decision.hierarchy === phrase.suggestion.hierarchy
  const label = fromExcel ? "Del Excel" : decision.confirmed ? "Elegida" : "Sugerida"
  return <span className="text-xs text-[var(--color-text-subtle)]">{label}</span>
}
