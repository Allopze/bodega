"use client"

/**
 * Documentos generados en Cloudreve: encendido, carpeta, orden de carpetas y
 * lo que quedó pendiente o falló, con su reintento.
 */
import { useActionState, useState } from "react"
import { FolderSimple, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/ui/submit-button"
import { INITIAL_STATE } from "@/lib/form-state"
import type { ActionState } from "@/lib/validation/masters"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import type { GeneratedArchiveQueueOverview, GeneratedArchiveQueueRow } from "@/lib/services/generated-documents/admin"
import {
  GENERATED_DOCUMENT_ERROR_LABELS,
  GENERATED_DOCUMENT_STATUS_LABELS,
} from "@/lib/services/generated-documents/kinds"
import {
  GENERATED_ARCHIVE_LAYOUT_LABELS,
  GENERATED_ARCHIVE_LAYOUTS,
  type GeneratedArchiveLayout,
} from "@/lib/services/generated-documents/remote-key"
import {
  retryGeneratedDocumentAction,
  saveGeneratedArchiveSettingsAction,
  testGeneratedArchiveFolderAction,
} from "./actions"

export interface GeneratedDocumentsCardProps {
  settings: {
    envEnabled: boolean
    switchOn: boolean
    basePath: string
    basePathInvalid: boolean
    layout: GeneratedArchiveLayout
  }
  credentialsConfigured: boolean
  overview: GeneratedArchiveQueueOverview
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "info" | "danger" | "neutral"> = {
  pending: "info",
  staged: "warning",
  uploaded: "success",
  failed: "danger",
  superseded: "neutral",
}

const LAYOUT_EXAMPLES: Record<GeneratedArchiveLayout, string> = {
  faena: "Faena › documento",
  anio_faena_modulo: "2026 › Faena › Inspecciones › documento",
}

function QueueItem({ row }: { row: GeneratedArchiveQueueRow }) {
  const retry = useOperation({ feedback: "toast" })
  const canRetry = row.status === "failed" || row.status === "pending" || row.status === "staged"
  const error = row.lastErrorCode ? GENERATED_DOCUMENT_ERROR_LABELS[row.lastErrorCode] ?? row.lastErrorCode : null
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)]">
          {row.kindLabel} · {row.milestone}
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {row.worksiteLabel ?? "Corporativo"} · {formatDateTime(row.occurredAt)}
          {row.fileName ? ` · ${row.fileName}` : ""}
        </p>
        {error && <p className="mt-0.5 text-xs text-[var(--color-danger-ink)]">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <MetaBadge meta={{ label: GENERATED_DOCUMENT_STATUS_LABELS[row.status] ?? row.status, variant: STATUS_VARIANT[row.status] ?? "neutral" }} size="sm" />
        {canRetry && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={retry.pending}
            onClick={() => retry.run(() => retryGeneratedDocumentAction(row.id))}
          >
            {retry.pending ? "Reintentando…" : "Reintentar"}
          </Button>
        )}
      </div>
    </li>
  )
}

export function GeneratedDocumentsCard({ settings, credentialsConfigured, overview }: GeneratedDocumentsCardProps) {
  // El aviso sale dentro de la acción y no de un efecto sobre el estado: al
  // revalidar, la página se vuelve a montar y un efecto nunca llegaba a ver el
  // resultado (el mismo patrón de `admin/desviaciones/deviation-form.tsx`).
  const [, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveGeneratedArchiveSettingsAction(prev, formData)
    if (result.ok) toast.success(result.message ?? "Configuración guardada")
    else if (result.message) toast.error(result.message)
    return result
  }, INITIAL_STATE)
  const [layout, setLayout] = useState<GeneratedArchiveLayout>(settings.layout)
  const probe = useOperation({ feedback: "toast" })

  const canEnable = settings.envEnabled && credentialsConfigured
  const { counts } = overview

  return (
    <section
      aria-labelledby="generated-docs-title"
      className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]"
    >
      <div className="mb-5">
        <h2 id="generated-docs-title" className="flex items-center gap-2 text-h2 text-[var(--color-text)]">
          <FolderSimple size={20} aria-hidden />
          Documentos generados
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Cada documento formal de Prevención queda en Cloudreve en el momento del hecho: comprobantes de entrega de EPP,
          informes de inspección, actas SST (salvo el RE-28), cierres y planillas RE-36 del PDTP, MIPER publicadas y
          expedientes de incidentes cerrados. Una copia nunca se sobrescribe: un cambio posterior deja otra.
        </p>
      </div>

      <div role="note" className="mb-5 flex gap-2 rounded-[var(--radius)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] px-4 py-3 text-sm text-[var(--color-warning-ink)]">
        <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          La carpeta debe ser restringida en Cloudreve: ahí no rigen los permisos de la plataforma, y los documentos
          llevan nombres, RUT y el detalle de los incidentes.
        </p>
      </div>

      {!settings.envEnabled && (
        <p className="mb-5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          Este servidor no tiene habilitado el archivado (<code>GENERATED_DOCS_ARCHIVE_ENABLED</code>). Solo producción lo
          habilita, para que un entorno de desarrollo nunca escriba en el drive de la empresa.
        </p>
      )}
      {settings.basePathInvalid && (
        <p role="alert" className="mb-5 text-sm text-[var(--color-danger-ink)]">
          La carpeta guardada no es válida y el archivado quedó detenido: escriba una carpeta nueva y guarde.
        </p>
      )}

      <form action={formAction}>
        <FieldGroup>
          <Checkbox
            id="gd-enabled"
            name="enabled"
            value="on"
            defaultChecked={settings.switchOn}
            disabled={!canEnable && !settings.switchOn}
            label="Archivar los documentos generados en Cloudreve"
          />
          {!credentialsConfigured && settings.envEnabled && (
            <p className="-mt-2 text-xs text-[var(--color-text-muted)]">Configure primero la conexión de arriba.</p>
          )}

          <Field
            label="Carpeta en Cloudreve"
            htmlFor="gd-base-path"
            helper="Carpeta propia, fuera de la biblioteca de Documentación y de los respaldos. Se crea con el primer documento."
          >
            <Input id="gd-base-path" name="basePath" type="text" defaultValue={settings.basePath} autoComplete="off" required />
          </Field>

          <fieldset>
            <legend className="text-sm font-medium text-[var(--color-text)]">Orden de carpetas</legend>
            <p className="text-xs text-[var(--color-text-muted)]">
              Cambiarlo solo afecta a lo que se suba desde ahora: lo ya subido no se mueve.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-6">
              {GENERATED_ARCHIVE_LAYOUTS.map((option) => (
                <label key={option} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="layout"
                    value={option}
                    checked={layout === option}
                    onChange={() => setLayout(option)}
                    className="mt-1"
                  />
                  <span>
                    {GENERATED_ARCHIVE_LAYOUT_LABELS[option]}
                    <span className="block text-xs text-[var(--color-text-muted)]">{LAYOUT_EXAMPLES[option]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </FieldGroup>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="secondary" onClick={() => probe.run(testGeneratedArchiveFolderAction)} disabled={probe.pending}>
            {probe.pending ? "Probando…" : "Probar carpeta"}
          </Button>
          <SubmitButton label="Guardar" loadingLabel="Guardando…" variant="primary" />
        </div>
      </form>

      <div className="mt-8">
        <h3 className="text-h3 text-[var(--color-text)]">Cola de archivado</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {counts.uploaded} subidos · {counts.staged} por subir · {counts.pending} pendientes · {counts.failed} fallidos · {counts.superseded} reemplazados
        </p>
        {overview.attention.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            No hay documentos pendientes ni fallidos. Los nuevos aparecen acá si algo impide subirlos.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
            {overview.attention.map((row) => <QueueItem key={row.id} row={row} />)}
          </ul>
        )}

        {overview.recentUploads.length > 0 && (
          <>
            <h3 className="mt-6 text-sm font-medium text-[var(--color-text)]">Últimos subidos</h3>
            <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
              {overview.recentUploads.map((row) => (
                <li key={row.id} className="break-all">
                  {row.remoteKey}
                  {row.lateRender ? " · generado con el estado actual" : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
