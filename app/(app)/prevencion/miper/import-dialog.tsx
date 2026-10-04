"use client"

import { startTransition, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DataTable } from "@/components/ui/data-table"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { suggestedFactorMapping, unknownFactorsOf, waitsForFactor } from "@/lib/prevention/miper/factor-suggestion"
import { decisionsToMappings, importSummary, initialDecisions, type ImportDecisions } from "@/lib/prevention/miper/import-decisions"
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
  { value: "filas", label: "Revisar riesgos" },
  { value: "medidas", label: "Revisar medidas" },
  { value: "confirmar", label: "Confirmar destino" },
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

function previewRow(row: RiskImportRowView, mapping: Readonly<Record<string, string>>): PreviewTableRow {
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
    status: row.status === "needs_review" && !waitsForFactor(row, mapping) ? "Lista · factor asignado" : STATUS_LABEL[row.status],
  }
}

/** Código estable del catálogo a partir del nombre del Excel. */
function factorCodeOf(name: string) {
  const code = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)
  return code.length >= 2 ? code : `factor_${code}`.slice(0, 60).padEnd(2, "_")
}

export function ImportMiperDialog({ worksites, currentYear, canManageCatalog, open: controlledOpen, onOpenChange, hideTrigger = false, initialWorksiteId }: {
  worksites: CreationWorksite[]
  currentYear: number
  canManageCatalog: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  initialWorksiteId?: string | null
}) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [discardOpen, setDiscardOpen] = useState(false)
  const [step, setStep] = useState<Step>("archivo")
  const [worksiteId, setWorksiteId] = useState(initialWorksiteId ?? worksites[0]?.id ?? "")
  const [period, setPeriod] = useState(String(currentYear))
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<RiskImportPreview | null>(null)
  const [decisions, setDecisions] = useState<ImportDecisions | null>(null)
  /** FACTORES DE RIESGO que el catálogo no reconoce → factor del catálogo elegido para ellos. */
  const [factorMapping, setFactorMapping] = useState<Record<string, string>>({})
  const [revisionReason, setRevisionReason] = useState("")
  /** Destino de la carga en curso: el botón que se apretó es el que muestra que está cargando. */
  const [committing, setCommitting] = useState<"draft" | "live" | null>(null)
  const operation = useOperation()

  const tableRows = useMemo(() => (preview?.rows ?? []).map((row) => previewRow(row, factorMapping)), [preview, factorMapping])
  // Los factores que el catálogo no reconoce: se asignan a uno que existe o se crean.
  const unknownFactors = useMemo(() => unknownFactorsOf(preview?.rows ?? []), [preview])
  const hasMeasures = (preview?.measureAnalysis.measures.length ?? 0) > 0
  // Se cargan las «listas» y las que esperaban su factor y ya lo tienen asignado.
  const loadableRows = useMemo(
    () => (preview?.rows ?? []).filter((row) => row.status === "ready" || (row.status === "needs_review" && !waitsForFactor(row, factorMapping))),
    [preview, factorMapping],
  )
  const waitingRows = (preview?.totals.needsReview ?? 0) - loadableRows.filter((row) => row.status === "needs_review").length
  const summary = useMemo(() => {
    if (!preview || !decisions) return null
    return importSummary(preview.measureAnalysis, new Set(loadableRows.map((row) => row.rowNumber)), decisions.deadlines)
  }, [preview, decisions, loadableRows])

  /** Cambiar faena, período o archivo invalida lo revisado: hay que volver a revisar. */
  function discardPreview() {
    setPreview(null)
    setDecisions(null)
    setFactorMapping({})
  }

  useEffect(() => {
    if (open && initialWorksiteId && worksites.some((worksite) => worksite.id === initialWorksiteId)) setWorksiteId(initialWorksiteId)
  }, [open, initialWorksiteId, worksites])

  function finishOpen(next: boolean) {
    setInternalOpen(next)
    onOpenChange?.(next)
    if (!next) {
      discardPreview()
      setFile(null)
      setRevisionReason("")
      setStep("archivo")
      operation.setMessage("")
    }
  }

  function handleOpen(next: boolean) {
    if (operation.pending) return
    if (!next && preview) { setDiscardOpen(true); return }
    finishOpen(next)
  }

  function runPreview() {
    if (!file || !worksiteId) return
    // Retroceder no invalida un lote revisado; sólo cambiar archivo/faena/período lo hace.
    if (preview) { setStep("filas"); return }
    const form = new FormData()
    form.set("file", file)
    form.set("worksiteId", worksiteId)
    form.set("period", period)
    operation.run(() => previewRiskImportAction(form), (result) => {
      const next = (result.data?.preview ?? null) as RiskImportPreview | null
      /* Dentro de la transición de la acción: el paso «Filas» aparece en el mismo
       * render en que la operación deja de estar pendiente. Fuera de ella se pintaba
       * antes, con «Siguiente» todavía deshabilitado, y un clic rápido se perdía. */
      startTransition(() => {
        setPreview(next)
        // Un lote nuevo trae su propio análisis: las decisiones de antes no valen para él.
        setDecisions(next ? initialDecisions(next.measureAnalysis) : null)
        setFactorMapping(next ? suggestedFactorMapping(next.rows, next.factorOptions) : {})
        // El motivo del alta sólo se propone; quien importa lo puede cambiar.
        setRevisionReason((current) => current.length > 0 ? current : `Importación RE-04 desde ${file.name}`)
        setStep("filas")
      })
    })
  }

  function createFactor(name: string) {
    operation.run(() => saveRiskFactorAction({ code: factorCodeOf(name), name, sortOrder: 200 }), runPreview)
  }

  function commit(target: "draft" | "live") {
    if (!preview || !decisions) return
    setCommitting(target)
    operation.run(() => commitRiskImportAction({
      batchId: preview.batchId,
      worksiteId,
      target,
      period: Number(period),
      revisionReason,
      ...decisionsToMappings(decisions),
      factorMapping,
    }), (result) => {
      finishOpen(false)
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
  const worksite = worksites.find((candidate) => candidate.id === worksiteId)
  const worksiteName = worksite?.name ?? "Faena no disponible"

  return (
    <>
    <Sheet open={open} onOpenChange={handleOpen}>
      {!hideTrigger && <SheetTrigger asChild>
        <Button
          variant="secondary"
          disabled={worksites.length === 0}
          title={worksites.length === 0 ? "No hay faenas activas a tu alcance" : undefined}
        >
          Importar
        </Button>
      </SheetTrigger>}
      <SheetContent className="sm:max-w-5xl">
        <SheetHeader>
          <div>
            <SheetTitle>Importar el RE-04</SheetTitle>
            <SheetDescription>
              Trae los riesgos y las medidas de tu Excel. Primero revisas lo que se cargará y después eliges el documento de destino.
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

          {/* Montado siempre y oculto fuera de su paso: al volver a «Archivo» el campo
            * conserva el archivo elegido (un `<input type="file">` nuevo nace vacío). */}
          <div hidden={step !== "archivo"}>
            <div className="space-y-4">
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
            <details className="rounded-xl border border-[var(--color-border)] p-3">
              <summary className="cursor-pointer text-sm font-medium">Formato del archivo y evaluación</summary>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">Usa un Excel .xlsx con la hoja «RE-04 IPER». Se leen sus riesgos y medidas. La plataforma calcula la clasificación con probabilidad × consecuencia; sólo admite los valores 1, 2 y 4. Las filas fuera de esa escala no se cargan y se muestran en la revisión.</p>
            </details>
            </div>
          </div>

          {step === "filas" && preview && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--color-text-subtle)]">
                {countOf(preview.totals.total, "fila")} en «{preview.sheetName}»: {preview.totals.ready} para cargar, {preview.totals.needsReview} por
                revisar y {preview.totals.rejected} sin cargar.
              </p>
              <ul aria-label="Resultado de la revisión del archivo" className="grid gap-2 text-sm sm:grid-cols-3">
                <li className="rounded-lg bg-[var(--color-success-tint)] p-3"><strong className="text-[var(--color-success-ink)]">Listos · {preview.totals.ready}</strong><span className="block text-[var(--color-text-muted)]">Se cargan tal como vienen.</span></li>
                <li className="rounded-lg bg-[var(--color-warning-tint)] p-3"><strong className="text-[var(--color-warning-ink)]">Requieren tu revisión · {preview.totals.needsReview}</strong><span className="block text-[var(--color-text-muted)]">Un factor de riesgo no reconocido: asígnalo abajo o la fila no se carga.</span></li>
                <li className="rounded-lg bg-[var(--color-danger-tint)] p-3"><strong className="text-[var(--color-danger-ink)]">No se cargarán · {preview.totals.rejected}</strong><span className="block text-[var(--color-text-muted)]">Probabilidad o consecuencia fuera de 1, 2 y 4. La causa está en la tabla.</span></li>
              </ul>
              {unknownFactors.length > 0 && (
                <section aria-labelledby="importar-factores" className="space-y-2 rounded-lg border border-[var(--color-border)] p-3 text-sm">
                  <h3 id="importar-factores" className="font-medium">Factores de riesgo que el catálogo no reconoce</h3>
                  <p className="text-[var(--color-text-subtle)]">
                    Asigna cada uno a un factor del catálogo; cuando el parecido es claro («MCANICO» → Mecánico) ya viene elegido.
                    {canManageCatalog ? " Si es un factor nuevo, créalo." : ""} Sin asignar, esas filas no se cargan.
                  </p>
                  <ul className="space-y-2">
                    {unknownFactors.map((factor) => (
                      <li key={factor.key} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 sm:w-72 sm:shrink-0">«{factor.name}» <span className="text-[var(--color-text-subtle)]">· {countOf(factor.rows, "fila")}</span></span>
                        <OptionSelect className="w-60" aria-label={`Factor del catálogo para «${factor.name}»`}
                          options={preview.factorOptions.map((option) => ({ value: option.id, label: option.name }))}
                          emptyLabel="Sin asignar: no se cargan" placeholder="Sin asignar: no se cargan" value={factorMapping[factor.key] ?? ""}
                          onValueChange={(value) => setFactorMapping((current) => {
                            const next = { ...current }
                            if (value) next[factor.key] = value
                            else delete next[factor.key]
                            return next
                          })} />
                        {canManageCatalog && (
                          <Button type="button" size="sm" variant="ghost" disabled={operation.pending} onClick={() => createFactor(factor.name)}>Crear «{factor.name}»</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
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
                // El buscador del TopBar queda detrás del diálogo: si filtrara esta tabla, una
                // búsqueda hecha en la portada escondería filas sin que se vea por qué.
                disableInternalSearch
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
              <section aria-labelledby="importar-destino" className="space-y-3 rounded-xl bg-[var(--color-surface-2)] p-4">
                <h3 id="importar-destino" className="text-sm font-semibold">Elige dónde cargar en {worksiteName}</h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div><dt className="text-sm font-medium">Borrador nuevo · período {draft?.period ?? period}</dt>
                    <dd className="mt-1 text-sm text-[var(--color-text-muted)]">Queda en elaboración para completar los datos y enviarlo a revisión. No reemplaza una versión vigente.</dd></div>
                  <div><dt className="text-sm font-medium">{live?.matrixId ? `${live.title ?? "Matriz vigente"} · vigente` : "Sin matriz vigente disponible"}</dt>
                    <dd className="mt-1 text-sm text-[var(--color-text-muted)]">Agregar riesgos al vigente incorpora cambios pendientes de revisión. No aprueba una nueva versión.</dd></div>
                </dl>
              </section>
              <section aria-labelledby="importar-resumen" className="space-y-2 rounded-xl border border-[var(--color-border)] p-4">
                <h3 id="importar-resumen" className="text-sm font-semibold">Qué se va a cargar</h3>
                <ul className="space-y-1 text-sm">
                  <li>{countOf(loadableRows.length, "riesgo listo", "riesgos listos")} para cargar.</li>
                  {waitingRows > 0 && (
                    <li>{countOf(waitingRows, "fila espera", "filas esperan")} su factor de riesgo: no tiene uno asignado y se carga sólo si el factor existe al confirmar.</li>
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
                  <Button type="button" variant="secondary" loading={operation.pending && committing === "live"} disabled={operation.pending || Boolean(live?.blockedReason)} onClick={() => commit("live")}>
                    Agregar al vigente
                  </Button>
                  <Button type="button" loading={operation.pending && committing === "draft"} disabled={operation.pending || Boolean(draft?.blockedReason)} onClick={() => commit("draft")}>
                    Cargar en borrador
                  </Button>
                </>
              ) : (
                <Button type="button" disabled={operation.pending} onClick={goNext}>Siguiente</Button>
              )}
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen}
      title="¿Descartar la importación?"
      description="Ya revisaste el archivo. Si descartas, se perderán la vista previa y las decisiones de esta importación. Todavía no se ha cargado ningún riesgo."
      cancelLabel="Continuar importación" confirmLabel="Descartar" variant="destructive"
      onConfirm={() => { setDiscardOpen(false); finishOpen(false) }} />
    </>
  )
}
