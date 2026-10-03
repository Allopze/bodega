"use client"

import { startTransition, useMemo, useState } from "react"
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
  /** Destino de la carga en curso: el botón que se apretó es el que muestra que está cargando. */
  const [committing, setCommitting] = useState<"draft" | "live" | null>(null)
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
      /* Dentro de la transición de la acción: el paso «Filas» aparece en el mismo
       * render en que la operación deja de estar pendiente. Fuera de ella se pintaba
       * antes, con «Siguiente» todavía deshabilitado, y un clic rápido se perdía. */
      startTransition(() => {
        setPreview(next)
        // Un lote nuevo trae su propio análisis: las decisiones de antes no valen para él.
        setDecisions(next ? initialDecisions(next.measureAnalysis) : null)
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

          {/* Montado siempre y oculto fuera de su paso: al volver a «Archivo» el campo
            * conserva el archivo elegido (un `<input type="file">` nuevo nace vacío). */}
          <div hidden={step !== "archivo"}>
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
          </div>

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
                  <Button type="button" variant="secondary" loading={operation.pending && committing === "live"} disabled={operation.pending || Boolean(live?.blockedReason)} onClick={() => commit("live")}>
                    Agregar al vigente
                  </Button>
                  <Button type="button" loading={operation.pending && committing === "draft"} disabled={operation.pending || Boolean(draft?.blockedReason)} onClick={() => commit("draft")}>
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
