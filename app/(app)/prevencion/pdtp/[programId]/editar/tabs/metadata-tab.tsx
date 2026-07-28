"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SubmitButton } from "@/components/admin/submit-button"
import { updatePdtpProgramAction, deletePdtpProgramAction } from "../../../actions"
import { setPdtpProgramWorksitesAction, excludeActivityForWorksiteAction, includeActivityForWorksiteAction } from "../../../actions/worksites-actions"

import type { pdtpPrograms } from "@/db/schema"

import type { PdtpActivityRow } from "./types"

const AUTOSAVE_DEBOUNCE_MS = 1500

export function MetadataTab({ program, canDelete, activities = [], visibleWorksites = [], memberWorksiteIds = [], exclusions = [] }: {
  program: typeof pdtpPrograms.$inferSelect
  canDelete: boolean
  activities?: PdtpActivityRow[]
  visibleWorksites?: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds?: string[]
  exclusions?: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const router = useRouter()
  const [updateState, updateAction, updatePending] = useActionState(updatePdtpProgramAction, null)
  const [deleteState, deleteAction, deletePending] = useActionState(deletePdtpProgramAction, null)

  const [title, setTitle] = React.useState(program.title)
  const [complianceTarget, setComplianceTarget] = React.useState(String(program.complianceTarget))
  // Último valor confirmado por el servidor; state (no ref) porque isDirty
  // se lee durante el render.
  const [savedValues, setSavedValues] = React.useState({ title: program.title, complianceTarget: String(program.complianceTarget) })
  // Snapshot exacto de lo último enviado al servidor. Es un ref (no dispara
  // render) y solo se lee/escribe en efectos/handlers, nunca durante el
  // render: evita que, si el usuario sigue tecleando mientras el envío en
  // vuelo todavía no responde, se marque como "guardado" un valor que en
  // realidad nunca se envió.
  const submittedRef = React.useRef(savedValues)
  const isDirty = title !== savedValues.title || complianceTarget !== savedValues.complianceTarget

  // Bug A: llamar router.refresh()/push() en el cuerpo del componente los
  // dispara en cada render (useActionState no limpia su estado solo), lo
  // que producía un loop de refetch. En un efecto, corren una sola vez por
  // transición de estado.
  React.useEffect(() => {
    if (updateState?.ok) {
      setSavedValues(submittedRef.current)
      router.refresh()
    }
  }, [updateState, router])

  React.useEffect(() => {
    if (deleteState?.ok) router.push("/prevencion/pdtp")
  }, [deleteState, router])

  // Autoguardado: reenvía la misma acción de servidor ya usada por el botón
  // "Guardar cambios" tras una pausa de tecleo, sin bloquear al usuario con
  // un submit explícito. Advierte con beforeunload si queda algo sin guardar.
  React.useEffect(() => {
    // No agenda un nuevo autoguardado mientras el anterior sigue en vuelo:
    // evita dos envíos superpuestos si el usuario retoma la escritura justo
    // cuando el autoguardado previo todavía no responde.
    if (!isDirty || updatePending) return
    const timeout = setTimeout(() => {
      const snapshot = { title, complianceTarget }
      submittedRef.current = snapshot
      const formData = new FormData()
      formData.set("programId", program.id)
      formData.set("title", snapshot.title)
      formData.set("complianceTarget", snapshot.complianceTarget)
      // El dispatch de useActionState debe invocarse dentro de una transición
      // fuera de un submit nativo; si no, isPending no se actualiza.
      React.startTransition(() => updateAction(formData))
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [title, complianceTarget, isDirty, updatePending, program.id, updateAction])

  React.useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [isDirty])

  const autosaveStatus = updatePending ? "Guardando…" : isDirty ? "Cambios sin guardar" : "Guardado"

  return (
    <div className="space-y-6">
      <form
        action={updateAction}
        className="max-w-md space-y-4"
        onSubmit={() => { submittedRef.current = { title, complianceTarget } }}
      >
        <input type="hidden" name="programId" value={program.id} />

        <div className="flex items-center justify-between">
          <span className="sr-only" aria-live="polite">{autosaveStatus}</span>
          <span
            aria-hidden
            className={
              updatePending
                ? "text-xs text-[var(--color-text-subtle)]"
                : isDirty
                  ? "text-xs font-medium text-[var(--color-warning)]"
                  : "text-xs text-[var(--color-text-subtle)]"
            }
          >
            {autosaveStatus}
          </span>
        </div>

        <FieldGroup className="gap-4">
          <Field label="Título del programa" htmlFor="meta-title" required>
            <Input id="meta-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>

          <Field label="Año" htmlFor="meta-year">
            <Input id="meta-year" name="year" value={program.year} disabled className="bg-[var(--color-surface-2)]" />
          </Field>

          <Field
            label="Meta de cumplimiento"
            htmlFor="meta-compliance"
            required
            helper="Valor entre 0 y 1. Ej: 0.90 = 90% de cumplimiento esperado."
            error={updateState?.message && !updateState.ok ? updateState.message : undefined}
          >
            <Input
              id="meta-compliance"
              name="complianceTarget"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={complianceTarget}
              onChange={(e) => setComplianceTarget(e.target.value)}
              required
            />
          </Field>
        </FieldGroup>

        <SubmitButton label="Guardar cambios" loadingLabel="Guardando..." size="sm" />
      </form>

      {visibleWorksites.length > 0 && (
        <WorksiteScopePanel
          programId={program.id}
          activities={activities}
          visibleWorksites={visibleWorksites}
          memberWorksiteIds={memberWorksiteIds}
          exclusions={exclusions}
        />
      )}

      {canDelete && (
        <div className="max-w-md border-t border-[var(--color-border)] pt-6">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-danger)]">Zona de peligro</h3>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            Eliminar este programa borrará todas sus actividades y hojas asociadas. Esta acción no se puede deshacer.
          </p>
          <form action={deleteAction}>
            <input type="hidden" name="programId" value={program.id} />
            <Button type="submit" variant="destructive" size="sm" disabled={deletePending}>
              {deletePending ? "Eliminando..." : "Eliminar programa"}
            </Button>
          </form>
          {deleteState?.message && !deleteState.ok && (
            <p className="mt-2 rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {deleteState.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Membresía de faenas del programa. Sin ninguna seleccionada, el programa
 * aplica a todas las faenas del scope del usuario (comportamiento por
 * defecto, retrocompatible con todo programa existente) — seleccionar
 * faenas aquí las restringe a esas, no crea copias del programa.
 */
export function WorksiteScopePanel({ programId, activities, visibleWorksites, memberWorksiteIds, exclusions }: {
  programId: string
  activities: PdtpActivityRow[]
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds: string[]
  exclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<string[]>(memberWorksiteIds)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // `memberWorksiteIds` es un array: trae identidad nueva en cada render del
  // padre, así que un efecto con esa dep re-adoptaba el valor del servidor y
  // borraba la selección sin guardar cada vez que otra fila hacía router.refresh().
  // Se compara por contenido y se ajusta durante el render.
  const savedMembers = JSON.stringify([...memberWorksiteIds].sort())
  const [lastSavedMembers, setLastSavedMembers] = React.useState(savedMembers)
  if (lastSavedMembers !== savedMembers) {
    setLastSavedMembers(savedMembers)
    setSelected(memberWorksiteIds)
  }

  const isDirty = JSON.stringify([...selected].sort()) !== savedMembers

  function toggle(worksiteId: string) {
    setSelected((current) => current.includes(worksiteId) ? current.filter((id) => id !== worksiteId) : [...current, worksiteId])
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      const result = await setPdtpProgramWorksitesAction({ programId, worksiteIds: selected })
      if (!result.ok) setError(result.message ?? "Error al guardar las faenas.")
      else router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-md border-t border-[var(--color-border)] pt-6">
      <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Faenas que cubre este programa</h3>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Sin ninguna faena marcada, el programa aplica a todas tus faenas autorizadas. Marca faenas solo si este programa no debe cubrirlas todas.
      </p>
      <ul className="space-y-1">
        {visibleWorksites.map((worksite) => (
          <li key={worksite.id}>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input type="checkbox" checked={selected.includes(worksite.id)} onChange={() => toggle(worksite.id)} />
              {worksite.name} <span className="text-xs text-[var(--color-text-subtle)]">({worksite.code})</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending || !isDirty} onClick={save}>{pending ? "Guardando..." : "Guardar faenas"}</Button>
        <span className="text-xs text-[var(--color-text-subtle)]">
          {selected.length === 0 ? "Aplica a todas las faenas autorizadas" : `${selected.length} faena(s) seleccionada(s)`}
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}

      <ActivityExclusionsEditor programId={programId} activities={activities} visibleWorksites={visibleWorksites} exclusions={exclusions} />
    </div>
  )
}

/**
 * Excepción puntual de herencia: una faena no ve una actividad concreta.
 * No cambia la cantidad planificada (eso es `pdtpActivityScheduleOverrides`,
 * ver overrides.ts) — excluye la actividad completa para esa faena.
 */
function ActivityExclusionsEditor({ programId, activities, visibleWorksites, exclusions }: {
  programId: string
  activities: PdtpActivityRow[]
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  exclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const router = useRouter()
  const [activityId, setActivityId] = React.useState(activities[0]?.id ?? "")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const worksiteById = new Map(visibleWorksites.map((w) => [w.id, w]))
  const activityById = new Map(activities.map((a) => [a.id, a]))
  const reasonReady = reason.trim().length >= 10

  async function add() {
    if (!activityId || !worksiteId || !reasonReady) {
      setError("Selecciona actividad, faena e indica un motivo de al menos 10 caracteres.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await excludeActivityForWorksiteAction({ programId, activityId, worksiteId, reason })
      if (!result.ok) setError(result.message ?? "Error al excluir la actividad.")
      else { setReason(""); router.refresh() }
    } finally {
      setPending(false)
    }
  }

  async function remove(exclusion: { activityId: string; worksiteId: string }) {
    if (!reasonReady) {
      setError("Escribe un motivo de al menos 10 caracteres para volver a incluir la actividad.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await includeActivityForWorksiteAction({ programId, activityId: exclusion.activityId, worksiteId: exclusion.worksiteId, reason })
      if (!result.ok) setError(result.message ?? "Error al incluir la actividad.")
      else { setReason(""); router.refresh() }
    } finally {
      setPending(false)
    }
  }

  if (activities.length === 0 || visibleWorksites.length === 0) return null

  return (
    <div className="mt-5 border-t border-[var(--color-border)] pt-4">
      <h4 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Excluir una actividad de una faena</h4>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Escribe el motivo abajo antes de excluir o de volver a incluir una actividad.
      </p>
      {exclusions.length > 0 && (
        <ul className="mb-3 space-y-1">
          {exclusions.map((exclusion) => (
            <li key={`${exclusion.activityId}-${exclusion.worksiteId}`} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
              <span>N°{activityById.get(exclusion.activityId)?.n ?? "?"} — {worksiteById.get(exclusion.worksiteId)?.name ?? exclusion.worksiteId}</span>
              <Button type="button" variant="ghost" size="sm" disabled={pending || !reasonReady} onClick={() => remove(exclusion)}>Quitar</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={activityId} onValueChange={setActivityId}>
          <SelectTrigger aria-label="Actividad a excluir"><SelectValue placeholder="Actividad" /></SelectTrigger>
          <SelectContent>{activities.map((a) => <SelectItem key={a.id} value={a.id}>N°{a.n} — {a.activity.slice(0, 40)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger aria-label="Faena a excluir"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>{visibleWorksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (mín. 10 caracteres)" />
      </div>
      <Button type="button" size="sm" className="mt-2" disabled={pending || !activityId || !worksiteId || !reasonReady} onClick={add}>{pending ? "Guardando..." : "Excluir"}</Button>
      {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}
