"use client"

import * as React from "react"
import Link from "next/link"
import { DownloadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { downloadBase64Xlsx } from "@/components/ui/export-button"
import { FileDropzone } from "@/components/ui/file-dropzone"
import { useOperation } from "@/lib/hooks/use-operation"
import { plural } from "@/lib/mantencion/format"
import type { ImportPreview, ImportSummary } from "@/lib/services/mantencion/equipment-import"
import { commitImportAction, downloadTemplateAction, previewImportAction } from "@/app/(app)/mantencion/equipos/actions"
import { ImportPreviewTable, ImportSummaryLine } from "./equipment-import-preview"
import { SectionCard } from "../shared/section-card"

type Stage = { name: "choose" } | { name: "preview"; file: File; preview: ImportPreview } | { name: "done"; summary: ImportSummary }

/**
 * Importación de equipos y lecturas iniciales en tres pasos: plantilla →
 * vista previa → confirmar. El archivo se sube dos veces a propósito: la
 * confirmación vuelve a leerlo y a validarlo en el servidor, de modo que lo
 * que se escribe es lo que el servidor valida en ese momento, no lo que vio la
 * pantalla.
 */
export function EquipmentImportPanel() {
  const [stage, setStage] = React.useState<Stage>({ name: "choose" })
  const read = useOperation()
  const commit = useOperation({ feedback: "toast" })
  const template = useOperation({ feedback: "toast" })

  function startPreview(file: File) {
    const body = new FormData()
    body.set("file", file)
    read.run(async () => {
      const result = await previewImportAction(body)
      return { ok: result.ok, message: result.message, data: result.ok ? { preview: result.data } : undefined }
    }, (result) => setStage({ name: "preview", file, preview: result.data?.preview as ImportPreview }))
  }

  function confirm(file: File) {
    const body = new FormData()
    body.set("file", file)
    commit.run(async () => {
      const result = await commitImportAction(body)
      return { ok: result.ok, message: result.message, data: result.ok ? { summary: result.data } : undefined }
    }, (result) => setStage({ name: "done", summary: result.data?.summary as ImportSummary }))
  }

  function downloadTemplate() {
    template.run(async () => {
      const result = await downloadTemplateAction()
      if (result.ok && result.data) downloadBase64Xlsx(result.data.base64, result.data.filename)
      return { ok: result.ok, message: result.ok ? "Plantilla descargada" : result.message }
    })
  }

  if (stage.name === "done") {
    const { summary } = stage
    return (
      <SectionCard title="Importación lista" description="Los cambios ya están en la plataforma y en el historial de cada equipo.">
        <ImportSummaryLine summary={summary} written />
        {summary.newWorksites.length > 0 && <p className="mt-2 text-sm text-[var(--color-text-muted)]">Faenas creadas: {summary.newWorksites.join(", ")}.</p>}
        {summary.errors > 0 && <p className="mt-2 text-sm text-[var(--color-danger-ink)]">{plural(summary.errors, "fila con error no se importó", "filas con error no se importaron")}: corrígelas en la planilla y vuelve a subirla.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild><Link href="/mantencion/equipos">Ver los equipos</Link></Button>
          <Button variant="secondary" onClick={() => setStage({ name: "choose" })}>Importar otra planilla</Button>
        </div>
      </SectionCard>
    )
  }

  const preview = stage.name === "preview" ? stage.preview : null
  const writable = preview ? preview.summary.created + preview.summary.incorporated + preview.summary.updated : 0

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="1. Descarga la plantilla" description="Trae las listas de tipos, marcas, faenas y pautas, e instrucciones.">
        <Button variant="secondary" size="sm" onClick={downloadTemplate} loading={template.pending}>
          <DownloadSimple size={14} aria-hidden />Descargar plantilla (.xlsx)
        </Button>
      </SectionCard>
      <SectionCard title="2. Sube la planilla" description="Una fila por equipo. Si el código ya existe, la fila actualiza ese equipo; lo que dejes en blanco no se toca.">
        <FileDropzone
          id="equipment-import-file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          acceptLabel="Planilla de Excel (.xlsx)"
          description="Formato .xlsx, hasta 5 MB y 2.000 filas."
          disabled={read.pending}
          onFileSelect={startPreview}
        />
        <div aria-live="polite" className="mt-3 text-sm">
          {read.pending && <p className="text-[var(--color-text-muted)]">Revisando la planilla…</p>}
          {read.message && read.messageTone === "error" && <Callout tone="danger" role="alert">{read.message}</Callout>}
        </div>
      </SectionCard>
      {preview && stage.name === "preview" && (
        <SectionCard title="3. Revisa y confirma" description={`${stage.file.name} · nada se guarda hasta que confirmes.`}>
          <ImportSummaryLine summary={preview.summary} written={false} />
          {preview.summary.newWorksites.length > 0 && (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Se crearán las faenas: {preview.summary.newWorksites.join(", ")}.</p>
          )}
          {preview.summary.errors > 0 && (
            <Callout tone="warning" className="mt-3" title={`${plural(preview.summary.errors, "fila trae error", "filas traen error")}`}>
              Esas filas no se importarán. Puedes corregirlas en la planilla y subirla de nuevo, o importar solo las válidas.
            </Callout>
          )}
          <div className="mt-4"><ImportPreviewTable rows={preview.rows} /></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => confirm(stage.file)} loading={commit.pending} disabled={writable === 0}>
              {writable === 0 ? "No hay nada que importar" : `Importar ${plural(writable, "equipo", "equipos")}`}
            </Button>
            <Button variant="secondary" onClick={() => setStage({ name: "choose" })} disabled={commit.pending}>Elegir otro archivo</Button>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
