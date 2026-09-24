"use client"

/**
 * Carpeta de requisitos legales (N°19) de una faena: qué documentos exige el
 * programa preventivo, en qué estado está cada uno y si el mes en curso ya
 * quedó acreditado. Cada fila faltante ofrece cargar el documento con el tipo
 * y la faena ya declarados.
 */
import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import {
  legalFolderItemStateLabel,
  type LegalFolderAssessment,
  type LegalFolderItemState,
} from "@/lib/prevention/legal-folder"
import { formatDate } from "@/lib/utils"
import { TypedUploadForm, type TypedUploadTypeOption, type TypedUploadWorksiteOption } from "./typed-upload-form"

const STATE_VARIANT: Record<LegalFolderItemState, "success" | "warning" | "info" | "danger"> = {
  vigente: "success",
  desactualizado: "warning",
  vencido: "warning",
  en_tramite: "info",
  falta: "danger",
}

export type LegalFolderPanelData = {
  activityNumber: number
  worksiteId: string
  assessment: LegalFolderAssessment
  month: { year: number; month: number; planned: boolean; executionStatus: string | null }
}

const MONTH_STATUS_TONE: Record<"success" | "info" | "warning" | "neutral", string> = {
  success: "text-[var(--color-success-ink)]",
  info: "text-[var(--color-info-ink)]",
  warning: "text-[var(--color-warning-ink)]",
  neutral: "text-[var(--color-text-muted)]",
}

function monthStatus(month: LegalFolderPanelData["month"], complete: boolean): { label: string; variant: "success" | "info" | "warning" | "neutral" } {
  if (!month.planned) return { label: "Sin actividad planificada este mes", variant: "neutral" }
  if (month.executionStatus === "approved") return { label: "Mes acreditado y aprobado", variant: "success" }
  if (month.executionStatus === "submitted") return { label: "Mes acreditado, pendiente de aprobación", variant: "info" }
  if (month.executionStatus === "rejected") return { label: "Acreditación del mes rechazada", variant: "warning" }
  return complete
    ? { label: "Carpeta completa: el mes se acredita en la próxima revisión", variant: "info" }
    : { label: "El mes se acredita cuando la carpeta esté completa", variant: "warning" }
}

export function LegalFolderPanel({
  data,
  worksites,
  types,
  canManage,
  canUploadCorporate,
}: {
  data: LegalFolderPanelData | null
  worksites: TypedUploadWorksiteOption[]
  types: TypedUploadTypeOption[]
  canManage: boolean
  canUploadCorporate: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [upload, setUpload] = React.useState<{ typeId: string; worksiteId: string | null } | null>(null)

  function selectWorksite(worksiteId: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (worksiteId) params.set("faena", worksiteId)
    else params.delete("faena")
    // Cambiar de faena es un filtro de la vista, no una navegación.
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const closeHref = (() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("carpeta")
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  })()

  return (
    <section
      aria-labelledby="legal-folder-title"
      className="mb-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="legal-folder-title" className="text-h3 text-[var(--color-text)]">
            Carpeta de requisitos legales{data ? ` (N°${data.activityNumber})` : ""}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            El programa preventivo acredita el mes cuando la faena tiene vigentes todos estos documentos.
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-2">
          {/* Quien opera una sola faena ve su carpeta: no hay nada que elegir. */}
          {worksites.length === 1 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Faena: <span className="font-medium text-[var(--color-text)]">{worksites[0]!.name}</span>
            </p>
          ) : (
            <Field label="Faena" htmlFor="legal-folder-worksite" className="min-w-52">
              <WorksiteSelect
                id="legal-folder-worksite"
                aria-label="Faena de la carpeta"
                worksites={worksites}
                value={data?.worksiteId ?? ""}
                onChange={selectWorksite}
                includeAll={false}
                placeholder="Selecciona la faena"
              />
            </Field>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href={closeHref} scroll={false}>Cerrar</Link>
          </Button>
        </div>
      </div>

      {!data ? (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          {worksites.length === 0
            ? "No tienes faenas asignadas en el programa preventivo activo."
            : "Selecciona una faena para ver su carpeta. Si no aparece nada, el programa activo todavía no declara qué documentos debe contener."}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-[var(--color-text)]">
              {data.assessment.satisfied} de {data.assessment.total} documentos vigentes
            </span>
            {/* Una frase, no un rótulo: en un badge no parte línea y en móvil se cortaba. */}
            <span className={`text-xs font-medium ${MONTH_STATUS_TONE[monthStatus(data.month, data.assessment.complete).variant]}`}>
              {monthStatus(data.month, data.assessment.complete).label}
            </span>
          </div>
          <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
            {data.assessment.items.map((item) => {
              const doc = item.document
              const corporate = item.requirement.scope === "corporativo"
              return (
                <li key={item.requirement.documentTypeId} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{item.requirement.documentTypeName}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {corporate ? "Corporativo" : "De la faena"}
                      {doc ? (
                        <>
                          {" · "}
                          <Link href={`/prevencion/documentacion/${doc.documentId}`} className="underline underline-offset-2 hover:text-[var(--color-text)]">
                            {doc.title}{doc.version ? ` v${doc.version}` : ""}
                          </Link>
                          {doc.expiresAt ? ` · vence ${formatDate(doc.expiresAt)}` : ""}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <MetaBadge meta={{ label: legalFolderItemStateLabel(item.state), variant: STATE_VARIANT[item.state] }} size="sm" />
                    {canManage && item.state !== "vigente" && item.state !== "en_tramite" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setUpload({
                          typeId: item.requirement.documentTypeId,
                          // Un requisito corporativo se carga como documento de la
                          // empresa si la persona puede; si no, en su faena, que
                          // también lo cumple.
                          worksiteId: corporate && canUploadCorporate ? null : data.worksiteId,
                        })}
                      >
                        Cargar
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <Dialog open={upload !== null} onOpenChange={(open) => { if (!open) setUpload(null) }}>
        <DialogContent
          className="sm:max-w-2xl"
          // El tipo ya viene declarado: el foco inicial en su buscador lo
          // desplegaría y ocultaría el tipo elegido. Lo que falta es el archivo.
          onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById("typed-upload-file")?.focus() }}
        >
          <DialogHeader>
            <DialogTitle>Cargar documento de la carpeta</DialogTitle>
            <DialogDescription>El tipo y la faena ya están declarados; adjunta el archivo.</DialogDescription>
          </DialogHeader>
          {upload && (
            <TypedUploadForm
              types={types}
              worksites={worksites}
              canUploadCorporate={canUploadCorporate}
              currentFolderId={null}
              folderWorksiteId={null}
              initialTypeId={upload.typeId}
              initialWorksiteId={upload.worksiteId}
              onDone={() => setUpload(null)}
              onCancel={() => setUpload(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
