"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { INSPECTION_KIND_LABELS } from "@/lib/prevention/inspections"
import {
  scaleSummary,
  type TemplatePreview,
  type TemplatePreviewItem,
  type TemplatePreviewPayload,
  type TemplatePreviewSection,
  type TemplatePreviewTechnical,
  type TemplatePreviewVersion,
} from "@/lib/prevention/inspection-template-preview"
import { formatDate } from "@/lib/utils"
import { parityStatusLabel, templateStatusVariant } from "../../_components/catalog-types"

/**
 * Qué plantilla se mira. Alcanza con esto para abrir la hoja: el resto lo pide
 * al servidor cuando se abre, porque el cuestionario de cada plantilla pesa
 * mucho más que el resumen que necesita la tabla.
 */
export type PreviewTarget = { id: string; name: string; versionLabel: string; kind: string }

type Loaded = { key: string; payload: TemplatePreviewPayload } | { key: string; error: string }

const MAX_LISTED_OPTIONS = 6

const previewUrl = (templateId: string) =>
  `/api/prevencion/inspecciones/plantillas/${encodeURIComponent(templateId)}/vista-previa`

/** El mensaje que el servidor dio, o uno propio si no llegó a darlo (sin red, cuerpo ilegible). */
async function readFailure(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === "string" && body.error) return body.error
  } catch { /* el cuerpo no era JSON: se usa el mensaje de abajo */ }
  return "No se pudo cargar el cuestionario."
}

/**
 * La vista previa del cuestionario de una plantilla, en solo lectura.
 *
 * Se abre desde el nombre de la fila, desde «Ver cuestionario» y desde los
 * diálogos de aprobar y de paridad —ahí apilada sobre el diálogo—: se decide
 * sobre lo que se pregunta, no sobre un nombre y un hash. Pide los datos al
 * abrirse (con `AbortController`, así que cerrar o cambiar de versión descarta
 * la respuesta en vuelo) y muestra esqueleto mientras llegan y «Reintentar» si
 * fallan. El panel la monta con una `key` nueva por apertura.
 */
export function TemplatePreviewSheet({ target, open, onOpenChange }: {
  target: PreviewTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Qué versión se lee: arranca en la que se pidió y cambia al elegir otra del historial.
  const [viewId, setViewId] = React.useState(target.id)
  const [attempt, setAttempt] = React.useState(0)
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const key = `${viewId}:${attempt}`

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    fetch(previewUrl(viewId), { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return setLoaded({ key, error: await readFailure(response) })
        setLoaded({ key, payload: await response.json() as TemplatePreviewPayload })
      })
      .catch((error: unknown) => {
        // Cerrar la hoja o pedir otra versión aborta la anterior: no es un fallo.
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return
        setLoaded({ key, error: "No se pudo cargar el cuestionario. Revisa la conexión e inténtalo de nuevo." })
      })
    return () => controller.abort()
  }, [open, viewId, key])

  // Lo que está en pantalla pertenece a otra petición hasta que llegue la de ésta.
  const current = loaded?.key === key ? loaded : null
  const payload = current && "payload" in current ? current.payload : null
  const failure = current && "error" in current ? current.error : null

  const template = payload?.template
  const name = template?.name ?? target.name
  const versionLabel = template?.versionLabel ?? target.versionLabel
  const kind = template?.kind ?? target.kind

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <div className="min-w-0">
            <SheetTitle>{name}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Cuestionario · {versionLabel} · {INSPECTION_KIND_LABELS[kind] ?? kind}</span>
              {template && <MetaBadge meta={{ label: template.statusLabel, variant: templateStatusVariant(template.status) }} />}
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody className="space-y-6">
          {!current && <PreviewSkeleton />}
          {failure && (
            <Callout tone="danger" role="alert" title="No se pudo cargar el cuestionario">
              <p>{failure}</p>
              <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setAttempt((value) => value + 1)}>
                Reintentar
              </Button>
            </Callout>
          )}
          {payload && (
            <>
              <QuestionnaireSummary preview={payload.questionnaire} />
              <VersionHistory versions={payload.versions} onSelect={setViewId} />
              <Questionnaire preview={payload.questionnaire} />
              <TechnicalDetail technical={payload.technical} />
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function PreviewSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Cargando el cuestionario">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="space-y-3 pt-2">
        {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
      </div>
    </div>
  )
}

/** Lo que el instrumento es, en una línea de datos y no en una fila de tarjetas. */
function QuestionnaireSummary({ preview }: { preview: TemplatePreview }) {
  const { totals } = preview
  const facts: { label: string; value: number; hint?: string }[] = [
    { label: totals.sections === 1 ? "sección" : "secciones", value: totals.sections },
    { label: totals.items === 1 ? "ítem" : "ítems", value: totals.items },
    { label: totals.effectiveRequired === 1 ? "obligatorio para cerrar" : "obligatorios para cerrar", value: totals.effectiveRequired, hint: "Lo que la inspección exige responder antes de declararse ejecutada." },
    { label: totals.scored === 1 ? "puntúa" : "puntúan", value: totals.scored, hint: "Entran en el porcentaje de cumplimiento." },
    { label: "con gravedad", value: totals.withDanoPotencial, hint: "Ítems con daño potencial declarado: de ahí salen la criticidad y el plazo del hallazgo." },
  ]
  return (
    <div className="space-y-3">
      {preview.objective && <p className="text-sm text-[var(--color-text-muted)]">{preview.objective}</p>}
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-text-muted)]">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline gap-1" title={fact.hint}>
            <dd className="font-mono text-sm font-semibold tabular-nums text-[var(--color-text)]">{fact.value}</dd>
            <dt>{fact.label}</dt>
          </div>
        ))}
      </dl>
      {preview.rowsFromWarehouse && (
        <Callout tone="info">
          Las prendas se arman con la bodega de la faena al crear la inspección; aquí ves solo las filas fijas.
        </Callout>
      )}
      {preview.recordsDeviations && (
        <Callout tone="info">
          Este instrumento no puntúa ítems: registra las desviaciones que se encuentran, tomadas de su catálogo de desviaciones.
        </Callout>
      )}
      {preview.recordsPreventiveActions && (
        <Callout tone="info">Este instrumento registra acciones preventivas que nacen directamente en CAPA.</Callout>
      )}
      {preview.closesOnCompletion && (
        <Callout tone="info">Se cierra al declararse ejecutado: declararlo ya es su revisión, no pasa por una segunda persona.</Callout>
      )}
    </div>
  )
}

/** Las demás versiones del mismo instrumento, incluidas las reemplazadas y las retiradas. */
function VersionHistory({ versions, onSelect }: { versions: TemplatePreviewVersion[]; onSelect: (id: string) => void }) {
  if (versions.length <= 1) return null
  return (
    <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-[var(--color-text)]">
        Versiones de este instrumento ({versions.length})
      </summary>
      <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{version.versionLabel}</span>
                <MetaBadge meta={{ label: version.statusLabel, variant: templateStatusVariant(version.status) }} />
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">{versionDates(version)}</p>
            </div>
            {version.current
              ? <span className="text-xs font-medium text-[var(--color-text-muted)]">Estás viendo esta</span>
              : (
                <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(version.id)} aria-label={`Ver la versión ${version.versionLabel}`}>
                  Ver
                </Button>
              )}
          </li>
        ))}
      </ul>
    </details>
  )
}

function versionDates(version: TemplatePreviewVersion): string {
  const parts = [`Creada ${formatDate(version.createdAt)}`]
  if (version.approvedAt) parts.push(`aprobada ${formatDate(version.approvedAt)}`)
  if (version.supersededAt) parts.push(`${version.statusLabel === "Retirada" ? "retirada" : "reemplazada"} ${formatDate(version.supersededAt)}`)
  return parts.join(" · ")
}

function Questionnaire({ preview }: { preview: TemplatePreview }) {
  if (preview.sections.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        {preview.recordsDeviations
          ? "No tiene ítems: lo que se registra son las desviaciones de su catálogo."
          : "Esta versión no tiene preguntas."}
      </p>
    )
  }
  return (
    <div className="space-y-8">
      {preview.sections.map((section, index) => (
        <SectionBlock key={section.id} section={section} index={index} total={preview.sections.length} />
      ))}
      {preview.closingAct && <ClosingAct act={preview.closingAct} />}
    </div>
  )
}

function SectionBlock({ section, index, total }: { section: TemplatePreviewSection; index: number; total: number }) {
  return (
    <section aria-labelledby={`preview-section-${section.id}`} className="space-y-2">
      <div>
        <h3 id={`preview-section-${section.id}`} className="font-display text-h3 text-[var(--color-text)]">{section.title}</h3>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          Sección {index + 1} de {total} · {section.items.length} {section.items.length === 1 ? "ítem" : "ítems"}
          {!section.countsForCompliance && " · no cuenta para el cumplimiento"}
        </p>
        {section.description && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{section.description}</p>}
      </div>
      <ol className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {section.items.map((item) => <ItemRow key={item.id} item={item} />)}
      </ol>
    </section>
  )
}

const DANO_VARIANT = { fatal: "danger", grave: "warning", moderado: "neutral", leve: "outline" } as const

function ItemRow({ item }: { item: TemplatePreviewItem }) {
  const dano = item.danoPotencial ? DANO_VARIANT[item.danoPotencial as keyof typeof DANO_VARIANT] ?? "outline" : null
  const listed = item.options.slice(0, MAX_LISTED_OPTIONS).map((option) => option.label)
  const hidden = item.options.length - listed.length
  return (
    <li className="space-y-0.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--color-text)]">{item.label}</p>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {item.effectiveRequired && <span className="text-xs text-[var(--color-text-muted)]">Obligatorio</span>}
          {dano && item.danoPotencialLabel && (
            <MetaBadge
              meta={{ label: item.danoPotencialLabel, variant: dano }}
              title={`Gravedad si falla: ${item.danoPotencialLabel}`}
            />
          )}
        </span>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        {item.scale.length > 0
          ? scaleSummary(item.scale)
          : [
            item.dataKindLabel,
            listed.length > 0 ? `${listed.join(" · ")}${hidden > 0 ? ` y ${hidden} más` : ""}` : null,
          ].filter(Boolean).join(": ")}
      </p>
    </li>
  )
}

function ClosingAct({ act }: { act: NonNullable<TemplatePreview["closingAct"]> }) {
  return (
    <section aria-labelledby="preview-closing-act" className="space-y-2">
      <h3 id="preview-closing-act" className="font-display text-h3 text-[var(--color-text)]">{act.title}</h3>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-[var(--color-text-muted)]">Resultado</dt>
        <dd>{act.resultOptions.map((option) => option.label).join(" · ")}</dd>
        {act.signatureRoles.length > 0 && (
          <>
            <dt className="text-[var(--color-text-muted)]">Firman</dt>
            <dd>{act.signatureRoles.map((role) => role.label).join(" · ")}</dd>
          </>
        )}
        {act.hasRestrictions && (
          <>
            <dt className="text-[var(--color-text-muted)]">Restricciones</dt>
            <dd>Se pueden registrar al cerrar.</dd>
          </>
        )}
      </dl>
    </section>
  )
}

/** Con qué se coteja contra el anexo oficial. Plegado: no es lo que se lee para decidir. */
function TechnicalDetail({ technical }: { technical: TemplatePreviewTechnical }) {
  const { source, parity } = technical
  return (
    <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-[var(--color-text)]">
        Detalle técnico
      </summary>
      <dl className="grid gap-x-4 gap-y-2 border-t border-[var(--color-border)] p-3 text-xs sm:grid-cols-[10rem_1fr]">
        <dt className="text-[var(--color-text-muted)]">Código interno</dt>
        <dd className="font-mono">{technical.code}</dd>

        <dt className="text-[var(--color-text-muted)]">Definición de origen</dt>
        <dd className="font-mono">{technical.sourceDefinitionCode ?? "Sin origen en el catálogo"}</dd>

        <dt className="text-[var(--color-text-muted)]">Procedencia</dt>
        <dd>{technical.provenanceLabel}</dd>

        <dt className="text-[var(--color-text-muted)]">Planilla vinculada</dt>
        <dd>
          {source ? (
            <>
              <a className="underline" href={`/api/prevencion/documentacion/${source.documentId}/version/${source.versionId}`}>{source.fileName}</a>
              {source.revision ? ` · ${source.revision}` : ""}
            </>
          ) : "Ninguna"}
        </dd>

        {source && (
          <>
            <dt className="text-[var(--color-text-muted)]">SHA-256 de la planilla</dt>
            <dd className="break-all font-mono">{source.checksumSha256}</dd>
          </>
        )}

        <dt className="text-[var(--color-text-muted)]">Hash JSON del cuestionario</dt>
        <dd className="break-all font-mono">{technical.contentHash}</dd>

        <dt className="text-[var(--color-text-muted)]">Paridad</dt>
        <dd className="space-y-1">
          <p>
            {parityStatusLabel(parity?.status)}
            {parity?.verifiedAt ? ` · ${formatDate(parity.verifiedAt)}` : ""}
          </p>
          {parity && (parity.expectedItems !== null || parity.actualItems !== null) && (
            <p className="text-[var(--color-text-muted)]">
              Ítems del anexo: {parity.expectedItems ?? "sin dato"} · transcritos: {parity.actualItems ?? "sin dato"}
            </p>
          )}
          {parity && parity.differences.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-warning-ink)]">
              {parity.differences.map((difference) => <li key={difference}>{difference}</li>)}
            </ul>
          )}
        </dd>
      </dl>
    </details>
  )
}
