"use client"

import { WarningCircle } from "@phosphor-icons/react"
import { todayInChile } from "@/lib/utils"
import { newRe20Id } from "../../workspace-data"
import {
  Re20AttachmentList,
  Re20AttachmentPicker,
  Re20Block,
  Re20CatalogSelect,
  Re20Date,
  Re20DateTime,
  Re20RepeatableList,
  Re20Text,
  Re20TextArea,
} from "../../fields"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { ID } from "./checks"

/** B69, literal. */
const STORY_HELP = "Relato en tercera persona y en orden temporal: quién, qué tarea, cuándo, dónde, cómo, equipos, materiales, condiciones y consecuencia. Solo hechos respaldados. No uses «descuido», «falta de atención», «imprudencia» o «error humano» sin describir el hecho concreto."

const JUDGMENT_WORDS = /descuido|falta de atenci[oó]n|imprudencia|error humano|negligen/gi

/** Palabras de juicio que la regla B69 pide no usar sin un hecho concreto detrás. */
export function findJudgmentWords(text: string | null | undefined): string[] {
  if (!text) return []
  return [...new Set((text.match(JUDGMENT_WORDS) ?? []).map((word) => word.toLowerCase()))]
}

export function EvidenceSection({ ws }: { ws: Re20WorkspaceApi }) {
  const items = ws.data.evidences
  const complete = items.length > 0 && items.every((item) => item.type?.trim() && item.description?.trim())

  return (
    <Re20Block
      id={ID("block-evidences")}
      title="Evidencias (5)"
      summary={items.length === 0 ? "Sin evidencias" : `${items.length} ${items.length === 1 ? "evidencia" : "evidencias"}`}
      complete={complete}
      defaultOpen={items.length === 0}
    >
      <Re20RepeatableList
        id={ID("evidences")}
        title="Evidencias reunidas"
        description="Cada hecho del árbol debe poder respaldarse con alguna de estas."
        items={items}
        getKey={(item) => item.id}
        itemLabel={(item, index) => item.type?.trim() ? `evidencia ${index + 1}, ${item.type}` : `evidencia ${index + 1}`}
        addLabel="Agregar evidencia"
        emptyTitle="Aún no hay evidencias"
        emptyDescription="Registra fotos, declaraciones, procedimientos, registros o mediciones. Anota dónde quedan resguardadas."
        onAdd={() => ws.update((data) => ({ ...data, evidences: [...data.evidences, { id: newRe20Id("evidence"), type: null, description: null, origin: null, date: null, custody: null, attachmentId: null }] }))}
        onRemove={(index) => {
          const attachmentId = items[index]?.attachmentId
          ws.update((data) => ({ ...data, evidences: data.evidences.filter((_, i) => i !== index) }))
          if (attachmentId) ws.removeAttachment(attachmentId)
        }}
        renderItem={(item, index) => (
          <div className="space-y-3">
            <div className="grid gap-4 md:grid-cols-2">
              <Re20CatalogSelect id={ID(`evidence-${index}-type`)} label="Tipo" category="evidence_type" required value={item.type} onChange={(value) => ws.patch(["evidences", index, "type"], value)} />
              <Re20Date id={ID(`evidence-${index}-date`)} label="Fecha" value={item.date} max={todayInChile()} onChange={(value) => ws.patch(["evidences", index, "date"], value)} />
            </div>
            <Re20TextArea id={ID(`evidence-${index}-description`)} label="Descripción o identificación" required rows={2} maxLength={2000} value={item.description} onChange={(value) => ws.patch(["evidences", index, "description"], value)} />
            <div className="grid gap-4 md:grid-cols-2">
              <Re20Text id={ID(`evidence-${index}-origin`)} label="Origen" maxLength={500} value={item.origin} onChange={(value) => ws.patch(["evidences", index, "origin"], value)} placeholder="Quién la entregó o dónde se obtuvo" />
              <Re20Text id={ID(`evidence-${index}-custody`)} label="Custodia o ubicación" maxLength={500} value={item.custody} onChange={(value) => ws.patch(["evidences", index, "custody"], value)} placeholder="Dónde queda resguardada" />
            </div>
            {item.attachmentId ? (
              <Re20AttachmentList
                ids={[item.attachmentId]}
                onRemove={(attachmentId) => {
                  ws.patch(["evidences", index, "attachmentId"], null)
                  ws.removeAttachment(attachmentId)
                }}
              />
            ) : (
              <Re20AttachmentPicker
                id={ID(`evidence-${index}-attachment`)}
                label="Adjuntar archivo (opcional)"
                multiple={false}
                onAdded={(added) => added[0] && ws.patch(["evidences", index, "attachmentId"], added[0].id)}
              />
            )}
          </div>
        )}
      />
    </Re20Block>
  )
}

export function ReconstructionSection({ ws }: { ws: Re20WorkspaceApi }) {
  const d = ws.data.definitive
  const flagged = findJudgmentWords(d.reconstruction)
  const chronology = d.chronology
  return (
    <div>
      <Re20Block
        id={ID("block-story")}
        title="Relato del evento (7)"
        summary={d.reconstruction?.trim() ? d.reconstruction : "Falta el relato"}
        complete={Boolean(d.reconstruction?.trim())}
        defaultOpen={!d.reconstruction?.trim()}
      >
        <p className="text-sm text-[var(--color-text-muted)]">{STORY_HELP}</p>
        <Re20TextArea id={ID("reconstruction")} label="Relato en tercera persona" required rows={8} maxLength={10000} value={d.reconstruction} onChange={(value) => ws.patch(["definitive", "reconstruction"], value)} />
        {flagged.length > 0 && (
          <p role="status" className="flex items-start gap-2 text-sm text-[var(--color-warning-ink)]">
            <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
            <span>El relato usa {flagged.map((word) => `«${word}»`).join(", ")}. Reemplázalo por el hecho concreto que lo muestra: qué se hizo o dejó de hacer, dónde y cuándo.</span>
          </p>
        )}
      </Re20Block>

      <Re20Block
        id={ID("block-chronology")}
        title="Cronología"
        summary={chronology.length === 0 ? "Sin hechos en la cronología" : `${chronology.length} ${chronology.length === 1 ? "hecho" : "hechos"}`}
        complete={chronology.length > 0 && chronology.every((row) => row.description.trim())}
      >
        <Re20RepeatableList
          id={ID("chronology")}
          title="Hechos en orden"
          description="Cada fila es un hecho verificable, con la hora y lo que lo respalda."
          items={chronology}
          max={30}
          getKey={(_, index) => `chronology-${index}`}
          itemLabel={(_, index) => `hecho ${index + 1} de la cronología`}
          addLabel="Agregar hecho"
          emptyTitle="Aún no hay cronología"
          emptyDescription="Ordena en el tiempo lo que ocurrió, desde la tarea previa hasta la atención de la persona afectada."
          onAdd={() => ws.update((data) => ({ ...data, definitive: { ...data.definitive, chronology: [...data.definitive.chronology, { occurredAt: null, description: "", evidenceReference: null, observations: null }] } }))}
          onRemove={(index) => ws.update((data) => ({ ...data, definitive: { ...data.definitive, chronology: data.definitive.chronology.filter((_, i) => i !== index) } }))}
          renderItem={(row, index) => (
            <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <Re20DateTime id={ID(`chronology-${index}-occurredAt`)} label="Hora" value={row.occurredAt} onChange={(value) => ws.patch(["definitive", "chronology", index, "occurredAt"], value)} />
              <Re20TextArea id={ID(`chronology-${index}-description`)} label="Hecho verificable" required rows={2} maxLength={2000} value={row.description} onChange={(value) => ws.patch(["definitive", "chronology", index, "description"], value)} />
              <Re20Text id={ID(`chronology-${index}-evidenceReference`)} label="Fuente o evidencia" maxLength={1000} value={row.evidenceReference} onChange={(value) => ws.patch(["definitive", "chronology", index, "evidenceReference"], value)} />
              <Re20Text id={ID(`chronology-${index}-observations`)} label="Observaciones" maxLength={1000} value={row.observations} onChange={(value) => ws.patch(["definitive", "chronology", index, "observations"], value)} />
            </div>
          )}
        />
      </Re20Block>
    </div>
  )
}
