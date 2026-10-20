"use client"

import { useState } from "react"
import { CheckCircle, LockSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { formatDateTime } from "@/lib/utils"
import { publishOnePageDiffusionAction } from "../../../actions"
import type { Re20StageModule, Re20StageProgress, Re20StageProps } from "../stages"
import { re20RelativeTime } from "../deadlines"
import { Re20Block, Re20Text, Re20TextArea } from "../fields"
import type { Re20WorkspaceApi } from "../use-re20-workspace"
import { withRe20TaskStatus } from "../workspace-data"
import { DiffusionLane } from "./difusion/diffusion-lane"
import { buildOnePage, latestReviewApproves } from "./difusion/model"
import { OnePagePreview } from "./difusion/one-page-preview"

/* Etapa 6 — Difusión (RE-20-06, 24 h tras la aprobación de calidad).
 * El ONE PAGE se genera desde las medidas del expediente; la difusión en turnos y de
 * medidas correctivas tiene doble confirmación (una persona marca, otra confirma). */

const ID = (field: string) => `re20-difusion-${field}`

function progress(ws: Re20WorkspaceApi): Re20StageProgress {
  const confirmed = (kind: string) => ws.diffusions.some((item) => item.kind === kind && item.status === "confirmed")
  const checks = [
    { ok: ws.onePageDiffusions.length > 0 || ws.task("diffusion").status === "completed", label: "Publicar el ONE PAGE (RE-20-06)", fieldId: ID("onepage") },
    { ok: confirmed("shift"), label: "Difusión en turnos marcada y confirmada", fieldId: ID("shift") },
    { ok: confirmed("corrective_measures"), label: "Difusión de las medidas correctivas marcada y confirmada", fieldId: ID("measures") },
  ]
  return { done: checks.filter((check) => check.ok).length, total: checks.length, missing: checks.filter((check) => !check.ok).map(({ label, fieldId }) => ({ label, fieldId })) }
}

function DifusionStage({ ws, stage }: Re20StageProps) {
  const page = buildOnePage({ data: ws.data, incident: ws.incident, people: ws.people })
  const approved = latestReviewApproves(ws.qualityReviews)
  const task = ws.task("diffusion")
  const lastOnePage = ws.onePageDiffusions[0] ?? null
  const published = lastOnePage !== null || task.status === "completed"
  const [learning, setLearning] = useState<string | null>(null)
  const [evidence, setEvidence] = useState("")
  const [busy, setBusy] = useState(false)
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set())
  const learningText = learning ?? page.learning
  const deadline = stage.deadline
  const confirmedCount = ws.diffusions.filter((item) => item.status === "confirmed").length
  const canPublish = !ws.readOnly && approved && page.problems.length === 0 && !busy

  async function publish() {
    setBusy(true)
    const result = await ws.runServerAction(
      () => publishOnePageDiffusionAction({
        incidentId: ws.incident.id,
        ...(learningText.trim() ? { learning: learningText.trim() } : {}),
        ...(evidence.trim() ? { evidenceRef: evidence.trim() } : {}),
      }),
    )
    if (result?.ok) await ws.save((data) => withRe20TaskStatus(data, "diffusion", "completed"))
    setBusy(false)
  }

  // El servidor aún no informa quién marcó: se recuerdan (por tipo y texto) las que marcó esta persona en esta sesión.
  const remember = (kind: string) => (summary: string) => setMarked((current) => new Set([...current, `${kind}:${summary}`]))

  return (
    <div className="space-y-3">
      {!approved && (
        <Callout tone="warning" role="status" icon={<LockSimple aria-hidden className="size-4" />} title="La difusión espera la revisión de calidad">
          <p>El ONE PAGE solo se publica con la revisión de calidad aprobada (con o sin observaciones). Mientras tanto puedes ver cómo quedaría.</p>
          <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => ws.setStage("calidad")}>Ir a la revisión de calidad</Button>
        </Callout>
      )}

      {approved && deadline && !published && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Plazo: {deadline.rule}. Vence <span className="font-mono tabular-nums">{formatDateTime(deadline.dueAt)}</span>
          {" "}(<span className={stage.deadlineState === "overdue" ? "font-medium text-[var(--color-signal-ink)]" : undefined}>{re20RelativeTime(deadline.dueAt, ws.now)}</span>).
        </p>
      )}

      <div>
        <Re20Block
          id={ID("block-onepage")}
          title="ONE PAGE (RE-20-06)"
          summary={published ? `Publicado el ${formatDateTime(lastOnePage?.diffusedAt ?? task.completedAt ?? "")}${lastOnePage?.createdByName ? ` por ${lastOnePage.createdByName}` : ""}` : page.problems.length > 0 ? "Faltan datos en el expediente" : "Listo para publicar"}
          complete={published}
          defaultOpen={!published}
        >
          <div id={ID("onepage")} className="space-y-4">
            {published && (
              <Callout tone="success" icon={<CheckCircle aria-hidden className="size-4" weight="fill" />} title="ONE PAGE publicado y acreditado en el PDTP">
                <p>Si cambiaste el aprendizaje o las medidas, puedes publicar una versión nueva.</p>
              </Callout>
            )}
            {page.problems.length > 0 && (
              <Callout tone="warning" title="Falta información en la investigación para armarlo">
                <ul className="list-inside list-disc">{page.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => ws.setStage("investigacion")}>Ir a la investigación</Button>
              </Callout>
            )}
            <OnePagePreview page={page} learning={learningText} />
            <Re20TextArea id={ID("learning")} label="Aprendizaje para otras faenas" rows={3} maxLength={3000} value={learningText} onChange={setLearning} helper="Se toma del cierre de la investigación; edítalo aquí si quieres afinarlo para el ONE PAGE." />
            <Re20Text id={ID("evidence")} label="Referencia de la constancia" value={evidence} onChange={setEvidence} maxLength={4000} helper="Opcional: dónde quedó publicado el informativo." />
            {!ws.readOnly && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void publish()} disabled={!canPublish} loading={busy}>
                  {published ? "Publicar una versión nueva" : "Publicar el ONE PAGE"}
                </Button>
                {!approved && <p className="text-xs text-[var(--color-text-muted)]">Se habilita con la revisión de calidad aprobada.</p>}
                {approved && page.problems.length > 0 && <p className="text-xs text-[var(--color-text-muted)]">Completa lo que falta en la investigación.</p>}
              </div>
            )}
          </div>
        </Re20Block>

        <Re20Block
          id={ID("block-shift")}
          title="Difusión en turnos"
          summary={laneSummary(ws, "shift")}
          complete={ws.diffusions.some((item) => item.kind === "shift" && item.status === "confirmed")}
          defaultOpen={approved && published}
        >
          <DiffusionLane id={ID("shift")} ws={ws} kind="shift" markedHere={marked} onMarked={remember("shift")} />
        </Re20Block>

        <Re20Block
          id={ID("block-measures")}
          title="Difusión de medidas correctivas"
          summary={laneSummary(ws, "corrective_measures")}
          complete={ws.diffusions.some((item) => item.kind === "corrective_measures" && item.status === "confirmed")}
        >
          <DiffusionLane id={ID("measures")} ws={ws} kind="corrective_measures" markedHere={marked} onMarked={remember("corrective_measures")} />
        </Re20Block>
      </div>
      <p className="text-xs text-[var(--color-text-subtle)]">{confirmedCount} de {ws.diffusions.length} difusiones confirmadas.</p>
    </div>
  )
}

function laneSummary(ws: Re20WorkspaceApi, kind: string) {
  const items = ws.diffusions.filter((item) => item.kind === kind)
  if (items.length === 0) return "Sin marcar"
  const confirmed = items.filter((item) => item.status === "confirmed").length
  return confirmed === items.length ? "Confirmada" : `${items.length - confirmed} por confirmar`
}

export const difusionStage: Re20StageModule = { Component: DifusionStage, progress }
