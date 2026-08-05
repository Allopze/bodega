"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ListBullets, Plus } from "@phosphor-icons/react"
import { PdtpEvidenceThumbs } from "../../../pdtp-evidence-thumbs"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import {
  createPdtpActionPlanItemAction,
  verifyPdtpActionPlanItemAction,
  reopenPdtpActionPlanItemAction,
  addPdtpFollowupAction,
} from "../../../actions/checklist-actions"
// Import type-only para romper la cadena cliente → barrel → db → postgres → fs
import type { listFollowups, listActionPlanItems } from "@/lib/services/prevention-pdtp"
// Constantes y funciones puras del dominio (no usan db); se importan directo del
// módulo concreto, no del barrel, para no arrastrar postgres al bundle cliente.
import {
  PDTP_DANO_POTENCIAL_A_PRIORIDAD,
  plazoFromDañoPotencial,
} from "@/lib/services/pdtp/checklist-domain"

/** Catálogo de daño potencial (módulo 04). El label incluye el plazo derivado. */
const DANO_POTENCIAL_OPTIONS = [
  { value: "leve", label: "Leve · baja · 15 días" },
  { value: "moderado", label: "Moderado · media · 7 días" },
  { value: "grave", label: "Grave · alta · 48 h" },
  { value: "fatal", label: "Fatal · alta · inmediato" },
] as const

type ActionItem = Awaited<ReturnType<typeof listActionPlanItems>>[number]
type Followup = Awaited<ReturnType<typeof listFollowups>>[number]

const ESTADO_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado",
  verificado: "Verificado",
  reabierto: "Reabierto",
}

const FOLLOWUP_STATE_OPTIONS = [
  { value: "pendiente", label: "Pendiente" },
  { value: "en_proceso", label: "En proceso" },
  { value: "completado", label: "Completado" },
  { value: "reabierto", label: "Reabierto" },
] as const

function estadoVariant(estado: string, vencida: boolean): BadgeProps["variant"] {
  if (vencida) return "danger"
  switch (estado) {
    case "verificado": return "success"
    case "completado": return "info"
    case "en_proceso": return "warning"
    case "reabierto":  return "danger"
    default:           return "default"
  }
}

export function ExecutionActionPlanPanel({ executionId, worksiteId, items, followupsByItem, canManage, canVerify }: {
  executionId: string
  worksiteId: string
  items: ActionItem[]
  followupsByItem: Record<string, Followup[]>
  canManage: boolean
  canVerify: boolean
}) {
  const router = useRouter()
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [showDraft, setShowDraft] = React.useState(false)

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--color-text)">Plan de acción correctiva</h2>
        {canManage && !showDraft && (
          <Button size="sm" variant="secondary" onClick={() => setShowDraft(true)}>
            <Plus size={14} weight="bold" className="mr-1" />
            Agregar acción
          </Button>
        )}
      </div>

      {items.length === 0 && !showDraft && (
        <EmptyState
          compact
          icon={<ListBullets size={20} />}
          title="Sin acciones"
          description="No hay acciones correctivas para esta ejecución. Se generan automáticamente al completar el checklist con ítems 'No cumple'."
        />
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface)">
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-(--color-text)">#{item.n} — {item.hallazgo}</p>
                <p className="truncate text-xs text-text-subtle">{item.accion} · Responsable: {item.responsable} · Plazo: {item.plazo}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={estadoVariant(item.estado, item.vencida)}>
                  {item.vencida ? "Vencida" : ESTADO_LABELS[item.estado] ?? item.estado}
                </Badge>
                <Badge variant="outline">{item.prioridad}</Badge>
              </div>
            </button>
            {expandedId === item.id && (
              <div className="border-t border-(--color-border) px-4 py-3">
                <ActionFollowupTimeline
                  key={`${item.id}:${item.estado}`}
                  itemId={item.id}
                  estado={item.estado}
                  worksiteId={worksiteId}
                  followups={followupsByItem[item.id] ?? []}
                  canManage={canManage}
                  canVerify={canVerify}
                  onChange={() => router.refresh()}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {showDraft && (
        <NewActionDraft
          executionId={executionId}
          onCancel={() => setShowDraft(false)}
          onSaved={() => { setShowDraft(false); router.refresh() }}
        />
      )}
    </section>
  )
}

function NewActionDraft({ executionId, onCancel, onSaved }: {
  executionId: string
  onCancel: () => void
  onSaved: () => void
}) {
  const [hallazgo, setHallazgo] = React.useState("")
  const [accion, setAccion] = React.useState("")
  const [responsable, setResponsable] = React.useState("")
  const [responsableRole, setResponsableRole] = React.useState("prevencionista_faena")
  const [plazo, setPlazo] = React.useState("")
  const [prioridad, setPrioridad] = React.useState("media")
  // Daño potencial (módulo 04): al seleccionarlo deriva prioridad + plazo.
  const [dañoPotencial, setDañoPotencial] = React.useState<string>("")
  // Anexo 8, columna "Normativa legal aplicable".
  const [normativaLegal, setNormativaLegal] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  /** Al cambiar el daño potencial, recalcula prioridad y plazo derivados. */
  function handleDañoPotencialChange(value: string) {
    setDañoPotencial(value)
    if (value === "leve" || value === "moderado" || value === "grave" || value === "fatal") {
      setPrioridad(PDTP_DANO_POTENCIAL_A_PRIORIDAD[value])
      setPlazo(plazoFromDañoPotencial(value))
    }
  }

  async function handleSave() {
    if (!hallazgo.trim() || !accion.trim() || !responsable.trim() || !plazo.trim()) {
      setError("Completa hallazgo, acción, responsable y plazo.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await createPdtpActionPlanItemAction({
        executionId, hallazgo, accion, responsable, responsableRole, plazo, prioridad,
        // dañoPotencial solo se envía cuando se seleccionó (módulo 04).
        ...(dañoPotencial ? { dañoPotencial } : {}),
        ...(normativaLegal.trim() ? { normativaLegal: normativaLegal.trim() } : {}),
      })
      if (!result.ok) setError(result.message ?? "Error al crear la acción.")
      else onSaved()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-(--radius-lg) border border-(--color-border) bg-surface-2 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Nuevo hallazgo / acción</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Hallazgo" htmlFor="np-hallazgo">
          <Textarea id="np-hallazgo" value={hallazgo} onChange={(e) => setHallazgo(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        <Field label="Acción correctiva" htmlFor="np-accion">
          <Textarea id="np-accion" value={accion} onChange={(e) => setAccion(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        {/* Daño potencial (módulo 04): deriva prioridad + plazo automáticamente. */}
        <Field label="Daño potencial" htmlFor="np-dano" helper="Opcional — al seleccionarlo, prioridad y plazo se calculan solos.">
          <Select value={dañoPotencial} onValueChange={handleDañoPotencialChange}>
            <SelectTrigger id="np-dano"><SelectValue placeholder="Sin clasificar" /></SelectTrigger>
            <SelectContent>
              {DANO_POTENCIAL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {/* Anexo 8: "Normativa legal aplicable". */}
        <Field label="Normativa legal aplicable" htmlFor="np-normativa" helper="Opcional — p. ej. Ley 21.512 art. 32, DS 40.">
          <Input id="np-normativa" value={normativaLegal} onChange={(e) => setNormativaLegal(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Responsable" htmlFor="np-responsable">
          <Input id="np-responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Rol responsable" htmlFor="np-role">
          <Select value={responsableRole} onValueChange={setResponsableRole}>
            <SelectTrigger id="np-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prevencionista_faena">Prevencionista de faena</SelectItem>
              <SelectItem value="admin_contrato">Admin. de contrato</SelectItem>
              <SelectItem value="jefe_faena">Jefe de faena</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Plazo" htmlFor="np-plazo" helper={dañoPotencial ? "Calculado desde el daño potencial." : undefined}>
          <DatePicker id="np-plazo" value={plazo} onChange={setPlazo} />
        </Field>
        <Field label="Prioridad" htmlFor="np-prioridad" helper={dañoPotencial ? "Calculada desde el daño potencial." : undefined}>
          <Select value={prioridad} onValueChange={setPrioridad}>
            <SelectTrigger id="np-prioridad"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="media">Media</SelectItem>
              <SelectItem value="baja">Baja</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={pending}>{pending ? "Guardando..." : "Guardar hallazgo"}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>
      </div>
    </div>
  )
}

function ActionFollowupTimeline({ itemId, estado, worksiteId, followups, canManage, canVerify, onChange }: {
  itemId: string
  estado: string
  worksiteId: string
  followups: Followup[]
  canManage: boolean
  canVerify: boolean
  onChange: () => void
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [observacion, setObservacion] = React.useState("")
  const [effectivenessAssessment, setEffectivenessAssessment] = React.useState("")
  const [selectedStatus, setSelectedStatus] = React.useState<string | null>(null)
  const filesRef = React.useRef<File[]>([])
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const estadoNuevo = selectedStatus ?? estado

  async function handleAddFollowup() {
    if (!observacion.trim() && estadoNuevo === estado && filesRef.current.length === 0) {
      setError("Ingresa una observación, cambia el estado o adjunta evidencia.")
      return
    }
    setPending(true)
    setError(null)
    try {
      // Sube cada foto/PDF de evidencia igual que el registro de ejecución
      // (pdtp-execution-form.tsx): POST a /api/prevencion/pdtp/evidence por
      // archivo, se acumulan los `path` devueltos en evidenciaPhotos.
      const evidenciaPhotos: string[] = []
      for (const file of filesRef.current) {
        const uploadData = new FormData()
        uploadData.set("file", file)
        uploadData.set("worksiteId", worksiteId)
        const res = await fetch("/api/prevencion/pdtp/evidence", { method: "POST", body: uploadData })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          setError(json.error ?? "Error al subir la evidencia.")
          return
        }
        const json = await res.json()
        evidenciaPhotos.push(json.path)
      }

      const result = await addPdtpFollowupAction({
        actionPlanItemId: itemId,
        observacion: observacion || undefined,
        estadoNuevo: estadoNuevo !== estado ? estadoNuevo : undefined,
        evidenciaPhotos: evidenciaPhotos.length > 0 ? evidenciaPhotos : undefined,
      })
      if (!result.ok) setError(result.message ?? "Error al registrar seguimiento.")
      else {
        setObservacion("")
        setSelectedStatus(null)
        filesRef.current = []
        if (fileInputRef.current) fileInputRef.current.value = ""
        onChange()
      }
    } finally {
      setPending(false)
    }
  }

  async function handleVerify() {
    if (effectivenessAssessment.trim().length < 5) {
      setError("Documenta cómo se comprobó la eficacia de la acción.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await verifyPdtpActionPlanItemAction({
        itemId,
        observacion: observacion || undefined,
        effectivenessAssessment,
      })
      if (!result.ok) setError(result.message ?? "Error al verificar.")
      else {
        setEffectivenessAssessment("")
        onChange()
      }
    } finally {
      setPending(false)
    }
  }

  async function handleReopen() {
    const motivo = window.prompt("Motivo de la reapertura:")
    if (!motivo) return
    setPending(true)
    setError(null)
    try {
      const result = await reopenPdtpActionPlanItemAction({ itemId, motivo })
      if (!result.ok) setError(result.message ?? "Error al reabrir.")
      else onChange()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Seguimiento</p>
      {followups.length === 0 ? (
        <p className="text-xs text-text-subtle">Sin registros de seguimiento aún.</p>
      ) : (
        <ul className="space-y-2">
          {followups.map((f) => (
            <li key={f.id} className="rounded-(--radius) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-xs">
              <p className="font-medium text-(--color-text)">{f.fecha} — {ESTADO_LABELS[f.estadoNuevo] ?? f.estadoNuevo}</p>
              {f.observacion && <p className="mt-1 text-text-subtle">{f.observacion}</p>}
              {(f.evidenciaUrl || (Array.isArray(f.evidenciaPhotos) && f.evidenciaPhotos.length > 0)) && (
                <div className="mt-1">
                  <PdtpEvidenceThumbs
                    evidenceUrl={f.evidenciaUrl}
                    evidencePhotos={Array.isArray(f.evidenciaPhotos) ? f.evidenciaPhotos as string[] : []}
                    evidenceText={null}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Textarea
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              rows={2}
              placeholder="Observación de seguimiento..."
              maxLength={2000}
            />
            <Select value={estadoNuevo} onValueChange={setSelectedStatus}>
              <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FOLLOWUP_STATE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FileInput
            ref={fileInputRef}
            accept="image/jpeg,image/png,application/pdf"
            multiple
            onFilesChange={(nextFiles) => { filesRef.current = nextFiles }}
          />
          {canVerify && estado === "completado" && (
            <Textarea
              value={effectivenessAssessment}
              onChange={(e) => setEffectivenessAssessment(e.target.value)}
              rows={2}
              placeholder="Cómo se comprobó la eficacia del control..."
              maxLength={3000}
              aria-label="Evaluación de eficacia"
            />
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={handleAddFollowup} disabled={pending}>
              {pending ? "Guardando..." : "Registrar seguimiento"}
            </Button>
            {canVerify && estado === "completado" && (
              <Button size="sm" onClick={handleVerify} disabled={pending}>Verificar eficacia</Button>
            )}
            {canVerify && estado === "verificado" && (
              <Button size="sm" variant="destructive" onClick={handleReopen} disabled={pending}>Reabrir</Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
