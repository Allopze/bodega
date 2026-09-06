"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ClipboardText, Plus } from "@phosphor-icons/react"
import { ChecklistSectionPanel, type ItemResponse } from "@/app/(app)/prevencion/[id]/checklist-section"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import {
  startPdtpExecutionChecklistAction,
  upsertPdtpChecklistResponsesAction,
  submitPdtpExecutionChecklistAction,
} from "../../../actions/checklist-actions"
import type { PdtpExecutionChecklistInstance } from "@/lib/services/prevention-pdtp"
import type { pdtpExecutionChecklistResponses } from "@/db/schema"

type ResponseRow = typeof pdtpExecutionChecklistResponses.$inferSelect

function responseKey(seccionId: string, itemId: string) {
  return `${seccionId}::${itemId}`
}

/** Opción canónica de sujeto para el selector de la faena. */
type SubjectOption = { id: string; label: string }

/** Catálogo de tipos de sujeto (multi-sujeto, PLAN_INTEGRACION §4).
 *  'equipo'|'carro' → selector de flota; 'trabajador' → selector de trabajadores;
 *  'extintor' y 'contenedor' → padrón canónico. Ninguno usa ya texto libre: el
 *  contenedor era el último, por no tener padrón, y ahora tiene catálogo. */
const SUBJECT_TYPES = [
  { value: "extintor", label: "Extintor", libre: false },
  { value: "equipo", label: "Equipo / Vehículo", libre: false },
  { value: "carro", label: "Carro", libre: false },
  { value: "contenedor", label: "Contenedor", libre: false },
  { value: "trabajador", label: "Trabajador", libre: false },
] as const

export function ExecutionChecklistPanel({
  executionId, programId, instances, responsesByInstance, canFill, vehicles, worksiteWorkers, emergencyResources = [], containers = [],
}: {
  executionId: string
  programId: string
  instances: PdtpExecutionChecklistInstance[]
  responsesByInstance: Record<string, ResponseRow[]>
  canFill: boolean
  vehicles: { id: string; plate: string; code: string | null; brand: string | null; model: string | null }[]
  worksiteWorkers: { id: string; firstName: string; lastName: string; position: string | null; rut: string | null }[]
  emergencyResources?: SubjectOption[]
  /** Contenedores del catálogo de la faena (sujeto del Anexo 14). */
  containers?: SubjectOption[]
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Drafts por instancia: Record<instanceId, Record<responseKey, ItemResponse>>
  const [draftsByInstance, setDraftsByInstance] = React.useState<Record<string, Record<string, ItemResponse>>>(() => {
    const map: Record<string, Record<string, ItemResponse>> = {}
    for (const inst of instances) {
      const instMap: Record<string, ItemResponse> = {}
      for (const r of responsesByInstance[inst.id] ?? []) {
        instMap[responseKey(r.seccionId, r.itemId)] = {
          estado: r.estado as ItemResponse["estado"],
          observacion: r.observacion ?? "",
          accionCorrectiva: r.accionCorrectiva ?? "",
        }
      }
      map[inst.id] = instMap
    }
    return map
  })

  // Los borradores sin guardar sobreviven a un remonte.
  //
  // Cualquier guardado de este panel llama router.refresh(), que al re-suspender
  // el render del servidor cruza el boundary de `loading.tsx` y hace que React
  // descarte y vuelva a montar este árbol (ver el comentario largo en
  // `editar/builder-tabs.tsx`). Como el estado inicial se siembra SÓLO de las
  // respuestas ya guardadas, guardar el sujeto A borraba en silencio las
  // respuestas sin guardar de los sujetos B..N — y multi-sujeto es el caso
  // normal: una instancia por extintor, equipo o trabajador inspeccionado.
  const storageKey = `pdtp-checklist-drafts:${executionId}`
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, Record<string, ItemResponse>>
        setDraftsByInstance((current) => {
          const merged = { ...current }
          for (const [instanceId, draft] of Object.entries(saved)) {
            // Una instancia que ya no existe (borrada en otra pestaña) se ignora.
            if (!(instanceId in merged)) continue
            merged[instanceId] = { ...merged[instanceId], ...draft }
          }
          return merged
        })
      }
    } catch {
      // Storage deshabilitado (modo privado, cuota, iframe sandboxeado) o JSON
      // corrupto: se sigue con lo que haya en el servidor.
    }
    setHydrated(true)
  }, [storageKey])

  React.useEffect(() => {
    // `hydrated` es state y no ref a propósito: mientras sea false este efecto
    // no escribe, así que el primer commit no pisa lo guardado con el mapa
    // recién sembrado del servidor.
    if (!hydrated) return
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(draftsByInstance))
    } catch {
      // Sin persistencia se pierde el borrador ante un remonte, como antes.
    }
  }, [hydrated, draftsByInstance, storageKey])

  async function handleStart() {
    setPending(true)
    setError(null)
    try {
      const result = await startPdtpExecutionChecklistAction({ executionId })
      if (!result.ok) setError(result.message ?? "Error al iniciar la verificación.")
      else router.refresh()
    } finally {
      setPending(false)
    }
  }

  function handleChange(instanceId: string, seccionId: string, itemId: string, patch: Partial<ItemResponse>) {
    setDraftsByInstance((prev) => {
      const inst = prev[instanceId] ?? {}
      const key = responseKey(seccionId, itemId)
      const current = inst[key] ?? { estado: null, observacion: "", accionCorrectiva: "" }
      return { ...prev, [instanceId]: { ...inst, [key]: { ...current, ...patch } } }
    })
  }

  async function handleSave(instanceId: string) {
    setPending(true)
    setError(null)
    try {
      const draft = draftsByInstance[instanceId] ?? {}
      const payload = Object.entries(draft).map(([key, resp]) => {
        const [seccionId, itemId] = key.split("::") as [string, string]
        return {
          seccionId, itemId,
          estado: resp.estado,
          observacion: resp.observacion || undefined,
          accionCorrectiva: resp.accionCorrectiva || undefined,
        }
      })
      if (payload.length === 0) return
      const result = await upsertPdtpChecklistResponsesAction({ instanceId, programId, responses: payload })
      if (!result.ok) setError(result.message ?? "Error al guardar las respuestas.")
      else router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function handleSubmit(instanceId: string) {
    setPending(true)
    setError(null)
    try {
      const result = await submitPdtpExecutionChecklistAction({ instanceId, programId })
      if (!result.ok) setError(result.message ?? "Error al enviar la revisión.")
      else router.refresh()
    } finally {
      setPending(false)
    }
  }

  // ── Caso 0 instancias: faena única (legacy, patrón B) ────────────────────
  if (instances.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-(--color-text)">Checklist de verificación</h2>
        <EmptyState
          compact
          icon={<ClipboardText size={20} />}
          title="Aún no se ha iniciado la verificación"
          description={canFill ? "Inicia el checklist para registrar el cumplimiento de esta ejecución." : "Un prevencionista de faena debe iniciar el checklist."}
          action={canFill ? (
            <Button size="sm" onClick={handleStart} disabled={pending}>
              {pending ? "Iniciando..." : "Iniciar verificación"}
            </Button>
          ) : undefined}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-(--color-text)">
          Checklist de verificación
          {instances.length > 1 && (
            <span className="ml-2 text-xs font-normal text-text-subtle">
              {instances.length} sujetos
            </span>
          )}
        </h2>
        {canFill && (
          <AddSubjectButton
            executionId={executionId}
            disabled={pending}
            vehicles={vehicles}
            worksiteWorkers={worksiteWorkers}
            emergencyResources={emergencyResources}
            containers={containers}
          />
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="space-y-6">
        {instances.map((instance) => (
          <InstanceCard
            key={instance.id}
            instance={instance}
            draft={draftsByInstance[instance.id] ?? {}}
            canFill={canFill}
            onChange={(s, i, p) => handleChange(instance.id, s, i, p)}
            onSave={() => handleSave(instance.id)}
            onSubmit={() => handleSubmit(instance.id)}
            pending={pending}
          />
        ))}
      </div>
    </section>
  )
}

// ── Card por instancia ──────────────────────────────────────────────────────

function InstanceCard({
  instance, draft, canFill, onChange, onSave, onSubmit, pending,
}: {
  instance: PdtpExecutionChecklistInstance
  draft: Record<string, ItemResponse>
  canFill: boolean
  onChange: (seccionId: string, itemId: string, patch: Partial<ItemResponse>) => void
  onSave: () => void
  onSubmit: () => void
  pending: boolean
}) {
  const readOnly = !canFill || instance.overallStatus === "completado"
  const subjectLabel = instance.subjectLabel?.trim() || null

  return (
    <div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-(--color-text)">
            {subjectLabel ?? "Verificación de faena"}
          </h3>
          {instance.subjectType && (
            <p className="text-xs text-text-subtle capitalize">{instance.subjectType}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MetaBadge meta={{ label: `${instance.overallStatus === "completado" ? "Completado" : instance.overallStatus === "en_proceso" ? "En proceso" : "Pendiente"}`, variant: instance.overallStatus === "completado" ? "success" : "warning" }} />
          {instance.porcentajeCumplimiento !== null && (
            <MetaBadge meta={{ label: `${instance.porcentajeCumplimiento}% cumplimiento`, variant: "info" }} />
          )}
        </div>
      </div>

      {instance.subjectType === "extintor"
        && instance.subjectResourceId
        && instance.overallStatus === "completado"
        && instance.porcentajeCumplimiento !== null
        && instance.porcentajeCumplimiento < 100 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-lg) border border-(--color-danger-line) bg-(--color-danger-tint) px-3 py-2">
            <p className="text-xs text-(--color-danger-ink)">
              La no conformidad mantiene su hallazgo y plan de acción. Si corresponde, inicia la recarga mediante Solicitudes.
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/solicitudes/nueva?tipo=otro&recursoEmergencia=${encodeURIComponent(instance.subjectResourceId)}`}>
                Solicitar recarga
              </Link>
            </Button>
          </div>
        )}

      {instance.definition.sections.map((section) => (
        <ChecklistSectionPanel
          key={section.id}
          section={section}
          readOnly={readOnly}
          responses={Object.fromEntries(
            section.items.map((item) => [
              item.id,
              draft[responseKey(section.id, item.id)] ?? { estado: null, observacion: "", accionCorrectiva: "" },
            ]),
          )}
          onChange={(seccionId, itemId, patch) => onChange(seccionId, itemId, patch)}
        />
      ))}

      {!readOnly && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onSave} disabled={pending}>
            {pending ? "Guardando..." : "Guardar respuestas"}
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={pending}>
            {pending ? "Enviando..." : "Enviar revisión"}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── "Agregar sujeto" — selectores canónicos de la faena ────────────────────

function AddSubjectButton({
  executionId, disabled, vehicles, worksiteWorkers, emergencyResources, containers,
}: {
  executionId: string
  disabled: boolean
  vehicles: { id: string; plate: string; code: string | null; brand: string | null; model: string | null }[]
  worksiteWorkers: { id: string; firstName: string; lastName: string; position: string | null; rut: string | null }[]
  emergencyResources: SubjectOption[]
  containers: SubjectOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [subjectType, setSubjectType] = React.useState<string>(SUBJECT_TYPES[0]!.value)
  // Para sujetos con inventario: id del vehículo/trabajador seleccionado.
  const [selectedId, setSelectedId] = React.useState<string>("")
  // Para sujetos libres (extintor/contenedor): texto tecleado.
  const [freeLabel, setFreeLabel] = React.useState("")

  const isLibre = SUBJECT_TYPES.find((t) => t.value === subjectType)?.libre ?? true

  // Opciones del selector según el tipo de sujeto.
  const options: SubjectOption[] = React.useMemo(() => {
    if (subjectType === "equipo" || subjectType === "carro") {
      return vehicles.map((v) => ({
        id: v.id,
        label: [v.plate, v.code && `(${v.code})`, v.brand, v.model].filter(Boolean).join(" ") || v.plate,
      }))
    }
    if (subjectType === "trabajador") {
      return worksiteWorkers.map((w) => ({
        id: w.id,
        label: [`${w.firstName} ${w.lastName}`, w.position && `· ${w.position}`].filter(Boolean).join(" "),
      }))
    }
    if (subjectType === "extintor") return emergencyResources
    if (subjectType === "contenedor") return containers
    return []
  }, [subjectType, vehicles, worksiteWorkers, emergencyResources, containers])

  // Resetea la selección al cambiar de tipo de sujeto. Se hace en el handler y
  // no en un efecto: si no, queda un frame con el id del sujeto anterior
  // seleccionado mientras ya se listan las opciones del tipo nuevo.
  function changeSubjectType(next: string) {
    setSubjectType(next)
    setSelectedId("")
    setFreeLabel("")
    setError(null)
  }

  async function handleAdd() {
    let subjectId: string
    let subjectLabel: string
    if (isLibre) {
      const label = freeLabel.trim()
      if (!label) {
        setError("Indica un identificador para el sujeto (p.ej. Extintor #7).")
        return
      }
      subjectId = label.toLowerCase().replace(/\s+/g, "-").slice(0, 100)
      subjectLabel = label
    } else {
      if (!selectedId) {
        setError("Selecciona un sujeto de la lista.")
        return
      }
      const opt = options.find((o) => o.id === selectedId)
      if (!opt) {
        setError("Sujeto no encontrado.")
        return
      }
      subjectId = selectedId
      subjectLabel = opt.label
    }

    setPending(true)
    setError(null)
    try {
      const result = await startPdtpExecutionChecklistAction({
        executionId,
        subjectType,
        subjectId,
        subjectResourceId: subjectType === "extintor" ? subjectId : undefined,
        subjectContainerId: subjectType === "contenedor" ? subjectId : undefined,
        subjectLabel,
      })
      if (!result.ok) setError(result.message ?? "Error al agregar el sujeto.")
      else {
        setOpen(false)
        setSelectedId("")
        setFreeLabel("")
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <Plus size={16} weight="bold" aria-hidden="true" />
        Agregar sujeto
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar sujeto de inspección</DialogTitle>
            <DialogDescription>
              Crea una instancia de checklist por sujeto (extintor, equipo, trabajador…). Cada uno se verifica y cierra de forma independiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Tipo de sujeto">
              <Select value={subjectType} onValueChange={changeSubjectType}>
                <SelectTrigger aria-label="Tipo de sujeto"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBJECT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {isLibre ? (
              <Field label="Identificador (código, ubicación)" hint="Texto libre sólo para sujetos que aún no tienen un padrón canónico.">
                <Input
                  autoFocus
                  placeholder="p.ej. Extintor #7 / acopio"
                  value={freeLabel}
                  onChange={(e) => setFreeLabel(e.target.value)}
                  maxLength={200}
                />
              </Field>
            ) : (
              <Field label={subjectType === "trabajador"
                    ? "Trabajador de la faena"
                    : subjectType === "extintor"
                      ? "Extintor del inventario"
                      : subjectType === "contenedor"
                        ? "Contenedor del catálogo"
                        : "Equipo / Vehículo de la faena"}>
                {options.length === 0 ? (
                  <p className="rounded-(--radius) border border-(--color-border) bg-(--color-surface-2) px-3 py-2 text-xs text-text-subtle">
                    No hay {subjectType === "trabajador" ? "trabajadores" : subjectType === "extintor" ? "extintores" : subjectType === "contenedor" ? "contenedores" : "vehículos"} disponibles en esta faena.
                    {subjectType === "contenedor" && <> Cárgalos en <Link href="/admin/contenedores" className="underline">Administración › Contenedores</Link>.</>}
                  </p>
                ) : (
                  <Select value={selectedId} onValueChange={setSelectedId}>
                    <SelectTrigger aria-label="Sujeto de inspección"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={pending || (!isLibre && options.length === 0)}>
              {pending ? "Agregando..." : "Agregar y verificar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
