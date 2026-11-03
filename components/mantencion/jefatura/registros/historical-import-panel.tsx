"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { FileDropzone } from "@/components/ui/file-dropzone"
import { useOperation } from "@/lib/hooks/use-operation"
import type { HistoricalPreview, HistoricalSummary } from "@/lib/services/mantencion/historical-import"
import { commitHistoricalAction, previewHistoricalAction } from "@/app/(app)/mantencion/registros/historicos/actions"
import { SectionCard } from "../shared/section-card"

type Stage = { name: "choose" } | { name: "preview"; file: File; preview: HistoricalPreview } | { name: "done"; summary: HistoricalSummary }

const subscribeHydration = () => () => {}
const clientHydrated = () => true
const serverNotHydrated = () => false

export function HistoricalImportPanel() {
  const [stage, setStage] = React.useState<Stage>({ name: "choose" })
  const hydrated = React.useSyncExternalStore(subscribeHydration, clientHydrated, serverNotHydrated)
  const read = useOperation()
  const commit = useOperation({ feedback: "toast" })

  function start(file: File) {
    const body = new FormData(); body.set("file", file)
    read.run(async () => {
      const result = await previewHistoricalAction(body)
      return { ok: result.ok, message: result.message, data: result.ok ? { preview: result.data } : undefined }
    }, (result) => { if (result.data?.preview) setStage({ name: "preview", file, preview: result.data.preview as HistoricalPreview }) })
  }
  function confirm(file: File) {
    const body = new FormData(); body.set("file", file)
    commit.run(async () => {
      const result = await commitHistoricalAction(body)
      return { ok: result.ok, message: result.message, data: result.ok ? { summary: result.data } : undefined }
    }, (result) => { if (result.data?.summary) setStage({ name: "done", summary: result.data.summary as HistoricalSummary }) })
  }
  if (stage.name === "done") return (
    <SectionCard title="Importación terminada">
      <p className="text-sm">{stage.summary.created} trabajos guardados · {stage.summary.relinked} vínculos completados · {stage.summary.unchanged} sin cambios.</p>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">{stage.summary.unmatched + stage.summary.conflicts} trabajos tienen el equipo pendiente de vincular y {stage.summary.unresolvedWorksites} tienen la faena pendiente.</p>
      <div className="mt-4 flex flex-wrap gap-2"><Button asChild><Link href="/mantencion/registros/historicos">Ver historial</Link></Button><Button variant="secondary" onClick={() => setStage({ name: "choose" })}>Revisar otra planilla</Button></div>
    </SectionCard>
  )
  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="1. Selecciona el consolidado" description="Usa el Excel de respuestas por faena. Se conservarán los datos de los trabajos.">
        <FileDropzone id="historical-import-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" acceptLabel="Planilla Excel (.xlsx)" description="Formato .xlsx, hasta 5 MB y 10.000 respuestas." disabled={!hydrated || read.pending} onFileSelect={start} />
        <div aria-live="polite" className="mt-3 text-sm">{read.pending && <p>Revisando la planilla…</p>}{read.message && read.messageTone === "error" && <Callout tone="danger" role="alert">{read.message}</Callout>}</div>
      </SectionCard>
      {stage.name === "preview" && <SectionCard title="2. Revisa y confirma" description={`${stage.file.name} · todavía no se ha guardado nada.`}>
        <p className="text-sm">{stage.preview.summary.total} respuestas · {stage.preview.summary.created} nuevas · {stage.preview.summary.unchanged} ya importadas · {stage.preview.summary.relinked} vínculos por completar.</p>
        <p className="mt-2 text-sm">{stage.preview.summary.linked} con equipo identificado · {stage.preview.summary.unmatched} sin coincidencia · {stage.preview.summary.conflicts} con identificadores que requieren revisión · {stage.preview.summary.unresolvedWorksites} con faena pendiente.</p>
        {stage.preview.pending.length > 0 && <Callout tone="warning" className="mt-3" title="Hay antecedentes pendientes de vincular">Se guardarán con los datos originales. Revisa los equipos y las faenas antes de asociarlos.</Callout>}
        {stage.preview.pending.length > 0 && <div className="mt-3 max-h-64 overflow-auto"><ul className="space-y-1 text-xs">{stage.preview.pending.map((row) => <li key={`${row.sheet}-${row.rowNumber}`}>{row.sheet}, fila {row.rowNumber}: {row.equipment || "sin equipo"} · {row.worksite || "sin faena"} — {row.issue}</li>)}</ul><p className="mt-2 text-xs text-[var(--color-text-muted)]">Se muestran hasta 50 filas pendientes.</p></div>}
        <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => confirm(stage.file)} loading={commit.pending} disabled={!stage.preview.summary.created && !stage.preview.summary.relinked}>Importar historial</Button><Button variant="secondary" onClick={() => setStage({ name: "choose" })} disabled={commit.pending}>Elegir otro archivo</Button></div>
        {commit.message && commit.messageTone === "error" && <Callout tone="danger" role="alert" className="mt-3">{commit.message}</Callout>}
      </SectionCard>}
    </div>
  )
}
