"use client"

import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  confirmIncidentDiffusionAction,
  createPreliminaryReportAction,
  markIncidentDiffusionAction,
  publishOnePageDiffusionAction,
  recordBiweeklyFollowupAction,
  recordIncidentStatementAction,
} from "../actions"
import { formatDateTime, todayInChile } from "@/lib/utils"

interface IncidentDiffusion {
  id: string
  kind: "shift" | "corrective_measures"
  summary: string
  status: "pending_confirmation" | "confirmed"
  markedAt: string
  confirmedAt?: string | null
}

interface RE20PanelProps {
  incidentId: string
  preliminaryReportText?: string | null
  preliminaryReportAt?: string | null
  canInvestigate: boolean
  canConfirmDiffusion?: boolean
  diffusions?: IncidentDiffusion[]
}

const diffusionKindLabel = (kind: "shift" | "corrective_measures") =>
  kind === "shift" ? "Difusión en turnos (Act. 71)" : "Difusión de medidas correctivas 48h (Act. 75)"

export function RE20Panel({
  incidentId,
  preliminaryReportText: initialPrelim,
  preliminaryReportAt: initialPrelimAt,
  canInvestigate,
  canConfirmDiffusion = false,
  diffusions = [],
}: RE20PanelProps) {
  const [activeTab, setActiveTab] = useState<"preliminary" | "statement" | "onepage" | "followup" | "diffusion">("preliminary")
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)

  // 1. Preliminar
  const [prelimText, setPrelimText] = useState(initialPrelim || "")

  // 2. Declaración
  const [stmtKind, setStmtKind] = useState<"involved" | "witness" | "cphs">("involved")
  const [stmtName, setStmtName] = useState("")
  const [stmtRole, setStmtRole] = useState("")
  const [stmtText, setStmtText] = useState("")

  // 3. ONE PAGE
  const [onePageSummary, setOnePageSummary] = useState("")
  const [onePageRootCause, setOnePageRootCause] = useState("")
  const [onePageActionPlan, setOnePageActionPlan] = useState("")

  // 4. Seguimiento
  const [followupDate, setFollowupDate] = useState(todayInChile())
  const [followupNote, setFollowupNote] = useState("")

  // 5. Difusiones (turnos / medidas correctivas)
  const [diffKind, setDiffKind] = useState<"shift" | "corrective_measures">("shift")
  const [diffSummary, setDiffSummary] = useState("")

  const handlePreliminary = () => {
    if (!prelimText.trim()) return
    setMessage(null)
    startTransition(async () => {
      const res = await createPreliminaryReportAction({
        incidentId,
        preliminaryReportText: prelimText,
      })
      setMessage({ text: res.message || "Informe preliminar guardado", isError: !res.ok })
    })
  }

  const handleStatement = () => {
    if (!stmtName.trim() || !stmtText.trim()) return
    setMessage(null)
    startTransition(async () => {
      const res = await recordIncidentStatementAction({
        incidentId,
        kind: stmtKind,
        deponentName: stmtName,
        deponentRole: stmtRole || undefined,
        statementText: stmtText,
      })
      if (res.ok) {
        setStmtName("")
        setStmtRole("")
        setStmtText("")
      }
      setMessage({ text: res.message || "Declaración registrada", isError: !res.ok })
    })
  }

  const handleOnePage = () => {
    if (!onePageSummary.trim() || !onePageRootCause.trim() || !onePageActionPlan.trim()) return
    setMessage(null)
    startTransition(async () => {
      const res = await publishOnePageDiffusionAction({
        incidentId,
        onePageSummary,
        rootCauseText: onePageRootCause,
        actionPlanSummary: onePageActionPlan,
      })
      if (res.ok) {
        setOnePageSummary("")
        setOnePageRootCause("")
        setOnePageActionPlan("")
      }
      setMessage({ text: res.message || "ONE PAGE publicado", isError: !res.ok })
    })
  }

  const handleFollowup = () => {
    if (!followupNote.trim()) return
    setMessage(null)
    startTransition(async () => {
      const res = await recordBiweeklyFollowupAction({
        incidentId,
        followupDate,
        note: followupNote,
      })
      if (res.ok) {
        setFollowupNote("")
      }
      setMessage({ text: res.message || "Seguimiento registrado", isError: !res.ok })
    })
  }

  const handleMarkDiffusion = () => {
    if (!diffSummary.trim()) return
    setMessage(null)
    startTransition(async () => {
      const res = await markIncidentDiffusionAction({ incidentId, kind: diffKind, summary: diffSummary })
      if (res.ok) setDiffSummary("")
      setMessage({ text: res.message || "Difusión marcada", isError: !res.ok })
    })
  }

  const handleConfirmDiffusion = (diffusionId: string) => {
    setMessage(null)
    startTransition(async () => {
      const res = await confirmIncidentDiffusionAction({ incidentId, diffusionId })
      setMessage({ text: res.message || "Difusión confirmada", isError: !res.ok })
    })
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            Flujo de Investigación RE-20 (DS 44)
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Cada hito completado dentro del plazo auto-acredita en PDTP (Actividades 66-78).
          </p>
        </div>
        <Badge variant="primary">RE-20 Versión 2</Badge>
      </div>

      {message && (
        <div
          className={`p-3 text-xs rounded-md border ${
            message.isError
              ? "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)] border-[var(--color-danger-border)]"
              : "bg-[var(--color-success-tint)] text-[var(--color-success-ink)] border-[var(--color-success-border)]"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Tabs selector */}
      <div className="flex gap-2 border-b border-[var(--color-border)] pb-2 text-xs font-medium">
        <button
          onClick={() => setActiveTab("preliminary")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "preliminary"
              ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] font-semibold"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          1. Informe Preliminar (3h)
        </button>
        <button
          onClick={() => setActiveTab("statement")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "statement"
              ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] font-semibold"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          2. Declaraciones / Entrevistas (24h)
        </button>
        <button
          onClick={() => setActiveTab("onepage")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "onepage"
              ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] font-semibold"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          3. ONE PAGE RE-20-06 (24h)
        </button>
        <button
          onClick={() => setActiveTab("followup")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "followup"
              ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] font-semibold"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          4. Seguimiento Quincenal (76)
        </button>
        <button
          onClick={() => setActiveTab("diffusion")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "diffusion"
              ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] font-semibold"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          5. Difusiones (71 / 75)
        </button>
      </div>

      {/* Tab 1: Preliminar */}
      {activeTab === "preliminary" && (
        <div className="space-y-3 pt-1">
          {initialPrelimAt && (
            <div className="text-xs text-[var(--color-success-ink)] font-medium">
              ✓ Informe preliminar emitido el {formatDateTime(initialPrelimAt)} (Acredita Act. 68, 70)
            </div>
          )}
          <div className="space-y-1">
            <Label>Resumen del Informe Preliminar (RE-20-02)</Label>
            <Textarea
              rows={4}
              disabled={!canInvestigate}
              className="min-h-0"
              placeholder="Describa brevemente los hechos observados, medidas de emergencia tomadas y estado de personas..."
              value={prelimText}
              onChange={(e) => setPrelimText(e.target.value)}
              aria-label="Resumen del Informe Preliminar (RE-20-02)"
            />
          </div>
          {canInvestigate && (
            <Button size="sm" onClick={handlePreliminary} disabled={!canInvestigate || isPending || !prelimText.trim()}>
              {isPending ? "Guardando..." : "Guardar Informe Preliminar y Acreditar PDTP"}
            </Button>
          )}
        </div>
      )}

      {/* Tab 2: Declaraciones */}
      {activeTab === "statement" && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Tipo de declarante</Label>
              <Select value={stmtKind} onValueChange={(val) => setStmtKind(val as "involved" | "witness" | "cphs")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="involved">Involucrado/Accidentado</SelectItem>
                  <SelectItem value="witness">Testigo</SelectItem>
                  <SelectItem value="cphs">Representante CPHS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Nombre del Declarante</Label>
              <Input
                placeholder="Nombre completo"
                value={stmtName}
                onChange={(e) => setStmtName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Cargo / Rol (Opcional)</Label>
              <Input
                placeholder="Ej: Operador de Grúa"
                value={stmtRole}
                onChange={(e) => setStmtRole(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Texto de la Declaración / Entrevista</Label>
            <Textarea
              rows={4}
              className="min-h-0"
              placeholder="Transcripción de la declaración o testimonio firmado..."
              value={stmtText}
              onChange={(e) => setStmtText(e.target.value)}
              aria-label="Texto de la Declaración / Entrevista"
            />
          </div>
          {canInvestigate && (
            <Button size="sm" onClick={handleStatement} disabled={!canInvestigate || isPending || !stmtName.trim() || !stmtText.trim()}>
              {isPending ? "Guardando..." : "Registrar Declaración Firmada (Acredita Act. 69)"}
            </Button>
          )}
        </div>
      )}

      {/* Tab 3: ONE PAGE RE-20-06 */}
      {activeTab === "onepage" && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <Label>Resumen Ejecutivo del Caso</Label>
            <Input
              placeholder="Descripción sintética de lo sucedido"
              value={onePageSummary}
              onChange={(e) => setOnePageSummary(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Causa Raíz Determinada</Label>
            <Input
              placeholder="Causa raíz identificada en la metodología de 5 Por Qué"
              value={onePageRootCause}
              onChange={(e) => setOnePageRootCause(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Resumen del Plan de Acción y Lección Aprendida</Label>
            <Textarea
              rows={3}
              className="min-h-0"
              placeholder="Medidas inmediatas y permanentes para evitar recurrencia..."
              value={onePageActionPlan}
              onChange={(e) => setOnePageActionPlan(e.target.value)}
              aria-label="Resumen del Plan de Acción y Lección Aprendida"
            />
          </div>
          {canInvestigate && (
            <Button
              size="sm"
              onClick={handleOnePage}
              disabled={!canInvestigate || isPending || !onePageSummary.trim() || !onePageRootCause.trim() || !onePageActionPlan.trim()}
            >
              {isPending ? "Publicando..." : "Publicar ONE PAGE y Acreditar PDTP (Act. 78)"}
            </Button>
          )}
        </div>
      )}

      {/* Tab 4: Seguimiento Quincenal */}
      {activeTab === "followup" && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Fecha del Seguimiento</Label>
              <DatePicker
                value={followupDate}
                onChange={setFollowupDate}
              />
            </div>
            <div className="space-y-1">
              <Label>Estado de Implementación de Medidas</Label>
              <Textarea
                rows={2}
                className="min-h-0"
                placeholder="Estado del avance quincenal de los compromisos..."
                value={followupNote}
                onChange={(e) => setFollowupNote(e.target.value)}
                aria-label="Estado de Implementación de Medidas"
              />
            </div>
          </div>
          {canInvestigate && (
            <Button size="sm" onClick={handleFollowup} disabled={!canInvestigate || isPending || !followupNote.trim()}>
              {isPending ? "Guardando..." : "Registrar Seguimiento Quincenal (Acredita Act. 76)"}
            </Button>
          )}
        </div>
      )}

      {/* Tab 5: Difusiones en turnos / medidas correctivas */}
      {activeTab === "diffusion" && (
        <div className="space-y-4 pt-1">
          <p className="text-xs text-[var(--color-text-muted)]">
            La prevencionista de faena marca la difusión; el supervisor de faena la confirma. La acreditación
            PDTP ocurre al confirmar.
          </p>

          {canInvestigate && (
            <div className="space-y-3 border-b border-[var(--color-border)] pb-4">
              <div className="space-y-1">
                <Label>Tipo de difusión</Label>
                <Select value={diffKind} onValueChange={(val) => setDiffKind(val as "shift" | "corrective_measures")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shift">Difusión en turnos (Act. 71)</SelectItem>
                    <SelectItem value="corrective_measures">Difusión de medidas correctivas 48h (Act. 75)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Resumen de lo comunicado</Label>
                <Textarea
                  rows={2}
                  className="min-h-0"
                  placeholder="Qué se comunicó, a qué turnos/personal, y cómo..."
                  value={diffSummary}
                  onChange={(e) => setDiffSummary(e.target.value)}
                  aria-label="Resumen de lo comunicado"
                />
              </div>
              <Button size="sm" onClick={handleMarkDiffusion} disabled={!canInvestigate || isPending || !diffSummary.trim()}>
                {isPending ? "Marcando..." : "Marcar difusión como completada"}
              </Button>
            </div>
          )}

          <div className="space-y-2">
            {diffusions.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">Aún no hay difusiones registradas.</p>
            ) : (
              diffusions.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border)] p-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-[var(--color-text)]">{diffusionKindLabel(d.kind)}</div>
                    <p className="text-xs text-[var(--color-text-muted)]">{d.summary}</p>
                    <Badge variant={d.status === "confirmed" ? "success" : "warning"}>
                      {d.status === "confirmed"
                        ? `Confirmada${d.confirmedAt ? ` el ${formatDateTime(d.confirmedAt)}` : ""}`
                        : "Pendiente de confirmación"}
                    </Badge>
                  </div>
                  {d.status === "pending_confirmation" && canConfirmDiffusion && (
                    <Button size="sm" variant="secondary" onClick={() => handleConfirmDiffusion(d.id)} disabled={isPending}>
                      {isPending ? "Confirmando..." : "Confirmar (Supervisor)"}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
