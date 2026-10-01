"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import type { RiskImportPreview, RiskImportRowView } from "@/lib/services/miper/import"
import { commitRiskImportAction, previewRiskImportAction, saveRiskFactorAction } from "./actions"
import type { CreationWorksite } from "./new-miper-dialog"

/**
 * Importación del RE-04 real (§9.3, F3).
 *
 * Dos pasos explícitos: primero se **revisa** el archivo —la vista previa
 * congela el lote y devuelve los problemas por fila, con la fila del Excel, el
 * valor leído y el cálculo que manda la plataforma— y recién después se carga,
 * en un borrador nuevo o agregando las filas al MIPER vigente.
 *
 * Lo que la vista previa muestra y lo que la carga hace son lo mismo que decidió
 * el servidor: acá no se recalcula nada. Las filas con P o C fuera de la escala
 * tienen el estado «No se carga» y el servidor no las escribe aunque se apriete
 * el botón; las que sólo avisan de un MR distinto sí se cargan y lo que se
 * guarda es `p × c`.
 */

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
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [period, setPeriod] = useState(String(currentYear))
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<RiskImportPreview | null>(null)
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

  function handleOpen(next: boolean) {
    setOpen(next)
    if (!next) { setPreview(null); setFile(null); setRevisionReason("") }
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
      // El motivo del alta sólo se propone; quien importa lo puede cambiar.
      setRevisionReason((current) => current.length > 0 ? current : `Importación RE-04 desde ${file.name}`)
    })
  }

  function createFactor(name: string) {
    operation.run(() => saveRiskFactorAction({ code: factorCodeOf(name), name, sortOrder: 200 }), runPreview)
  }

  function commit(target: "draft" | "live") {
    if (!preview) return
    operation.run(() => commitRiskImportAction({
      batchId: preview.batchId,
      worksiteId,
      target,
      period: Number(period),
      revisionReason,
    }), (result) => {
      setOpen(false)
      setPreview(null)
      setFile(null)
      const matrixId = result.data?.matrixId
      if (typeof matrixId === "string") router.push(`/prevencion/miper/${matrixId}`)
      else router.refresh()
    })
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
              Lee la hoja «RE-04 IPER» del Excel real. La matriz y la clasificación del archivo se informan, pero manda el cálculo
              de la plataforma (P × C): una fila con probabilidad o consecuencia fuera de 1, 2, 4 no se carga.
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>

        <SheetBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Faena" required>
              <Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setPreview(null) }}>
                <SelectTrigger><SelectValue placeholder="Selecciona la faena" /></SelectTrigger>
                <SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Período del borrador" helper="Sólo se usa al cargar en un borrador nuevo.">
              <Input type="number" min={2000} max={2100} value={period} onChange={(event) => { setPeriod(event.target.value); setPreview(null) }} />
            </Field>
            <Field label="Archivo del RE-04" required helper="Excel .xlsx, hoja «RE-04 IPER».">
              <Input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null) }}
              />
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={runPreview} disabled={operation.pending || !file || !worksiteId}>Revisar el archivo</Button>
            {preview && (
              <p className="text-sm text-[var(--color-text-subtle)]">
                {preview.totals.total} fila(s) en «{preview.sheetName}»: {preview.totals.ready} lista(s), {preview.totals.needsReview} por
                revisar, {preview.totals.rejected} que no se cargan.
              </p>
            )}
          </div>

          {operation.message && <p role="status" className="text-sm text-[var(--color-danger-ink)]">{operation.message}</p>}

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

          {preview && (
            <>
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

              <Field label="Motivo del borrador" helper="Queda en la bitácora del MIPER si se carga en un borrador nuevo.">
                <Textarea value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} minLength={10} />
              </Field>

              {(draft?.blockedReason || live?.blockedReason) && (
                <div className="space-y-1 text-sm text-[var(--color-text-subtle)]">
                  {draft?.blockedReason && <p>Borrador: {draft.blockedReason}</p>}
                  {live?.blockedReason && <p>Al vigente: {live.blockedReason}</p>}
                </div>
              )}
            </>
          )}
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpen(false)}>Cancelar</Button>
          <Button
            type="button"
            variant="secondary"
            disabled={operation.pending || !preview || Boolean(live?.blockedReason)}
            onClick={() => commit("live")}
          >
            Agregar al vigente
          </Button>
          <Button
            type="button"
            disabled={operation.pending || !preview || Boolean(draft?.blockedReason)}
            onClick={() => commit("draft")}
          >
            Cargar en borrador
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
