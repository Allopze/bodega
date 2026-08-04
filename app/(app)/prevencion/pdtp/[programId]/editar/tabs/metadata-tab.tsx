"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { SubmitButton } from "@/components/admin/submit-button"
import { updatePdtpProgramAction, deletePdtpProgramAction } from "../../../actions"
import { setPdtpProgramWorksitesAction } from "../../../actions/worksites-actions"

import type { pdtpPrograms } from "@/db/schema"

import type { PdtpActivityRow } from "./types"

const AUTOSAVE_DEBOUNCE_MS = 1500

/**
 * La UI habla en porcentaje entero (90) porque es como el usuario expresa la
 * meta; el modelo guarda la fracción 0-1 (0.90) que exige el CHECK de
 * `pdtp_programs` y consume `compliance.ts`. La conversión de vuelta ocurre en
 * `updatePdtpProgramAction`, que acepta `complianceTargetPercent`.
 */
const toPercent = (fraction: number) => String(Math.round(fraction * 100))

export function MetadataTab({ program, canDelete, activities = [] }: {
  program: typeof pdtpPrograms.$inferSelect
  canDelete: boolean
  /** Solo para decir cuántas actividades se llevaría el borrado. */
  activities?: PdtpActivityRow[]
}) {
  const router = useRouter()
  const [updateState, updateAction, updatePending] = useActionState(updatePdtpProgramAction, null)
  const [deleteState, deleteAction, deletePending] = useActionState(deletePdtpProgramAction, null)

  const [title, setTitle] = React.useState(program.title)
  const [compliancePercent, setCompliancePercent] = React.useState(toPercent(program.complianceTarget))
  // Último valor confirmado por el servidor; state (no ref) porque isDirty
  // se lee durante el render.
  const [savedValues, setSavedValues] = React.useState({ title: program.title, compliancePercent: toPercent(program.complianceTarget) })
  // Snapshot exacto de lo último enviado al servidor. Es un ref (no dispara
  // render) y solo se lee/escribe en efectos/handlers, nunca durante el
  // render: evita que, si el usuario sigue tecleando mientras el envío en
  // vuelo todavía no responde, se marque como "guardado" un valor que en
  // realidad nunca se envió.
  const submittedRef = React.useRef(savedValues)
  const isDirty = title !== savedValues.title || compliancePercent !== savedValues.compliancePercent

  const [confirmDelete, setConfirmDelete] = React.useState(false)

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
    // El error se muestra en la tarjeta, no en el diálogo: hay que cerrarlo
    // para que no lo tape.
    else if (deleteState) setConfirmDelete(false)
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
      const snapshot = { title, compliancePercent }
      submittedRef.current = snapshot
      const formData = new FormData()
      formData.set("programId", program.id)
      formData.set("title", snapshot.title)
      formData.set("complianceTargetPercent", snapshot.compliancePercent)
      // El dispatch de useActionState debe invocarse dentro de una transición
      // fuera de un submit nativo; si no, isPending no se actualiza.
      React.startTransition(() => updateAction(formData))
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [title, compliancePercent, isDirty, updatePending, program.id, updateAction])

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
    // Dos columnas en pantallas anchas: el formulario en columna única de
    // ~28rem es la forma correcta para 3 campos, pero apilar la zona de
    // peligro debajo dejaba la pantalla entera en el 20% izquierdo.
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,28rem)_minmax(0,24rem)]">
      <Card>
        <CardHeader>
          <CardTitle>Datos del programa</CardTitle>
          <CardDescription className="text-xs">
            Se guardan solos al dejar de escribir. El botón está para forzar el guardado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={updateAction}
            className="space-y-4"
            onSubmit={() => { submittedRef.current = { title, compliancePercent } }}
          >
            <input type="hidden" name="programId" value={program.id} />

            <FieldGroup className="gap-4">
              <Field label="Título del programa" htmlFor="meta-title" required>
                <Input id="meta-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </Field>

              {/* readOnly, no disabled: `disabled` lo saca del orden de
                  tabulación y lo pinta como campo vacío con placeholder. */}
              <Field label="Año" htmlFor="meta-year" helper="El año se fija al crear el programa y no se puede cambiar.">
                <Input id="meta-year" value={program.year} readOnly />
              </Field>

              <Field
                label="Meta de cumplimiento (%)"
                htmlFor="meta-compliance"
                required
                helper="Porcentaje de actividades ejecutadas que se considera cumplido. Ej: 90."
                error={updateState?.message && !updateState.ok ? updateState.message : undefined}
              >
                <Input
                  id="meta-compliance"
                  name="complianceTargetPercent"
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={compliancePercent}
                  onChange={(e) => setCompliancePercent(e.target.value)}
                  required
                  // Las flechas nativas miden ~7px: un objetivo imposible
                  // (Ley de Fitts) para un valor que se escribe una vez al año.
                  className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </Field>
            </FieldGroup>

            {/* El estado del autoguardado va junto al botón que hace lo mismo:
                separados, parecían dos mecanismos sin relación. */}
            <div className="flex items-center gap-3">
              <SubmitButton label="Guardar cambios" loadingLabel="Guardando..." size="sm" />
              <span className="sr-only" aria-live="polite">{autosaveStatus}</span>
              <span
                aria-hidden
                // El mismo rótulo se pinta dos veces a propósito: uno `sr-only`
                // con `aria-live` y este visible. Sin un ancla, una prueba que
                // busque el texto encuentra los dos.
                data-autosave-status
                className={
                  isDirty && !updatePending
                    ? "text-xs font-medium text-[var(--color-warning)]"
                    : "text-xs text-[var(--color-text-muted)]"
                }
              >
                {autosaveStatus}
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {canDelete && (
        <Card className="border-[var(--color-danger-line)]">
          <CardHeader>
            <CardTitle className="text-[var(--color-danger)]">Zona de peligro</CardTitle>
            <CardDescription className="text-xs">
              Eliminar este programa borrará todas sus actividades y hojas asociadas. Esta acción no se puede deshacer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deletePending}
              onClick={() => setConfirmDelete(true)}
            >
              {deletePending ? "Eliminando..." : "Eliminar programa"}
            </Button>
            {deleteState?.message && !deleteState.ok && (
              <p className="mt-2 rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
                {deleteState.message}
              </p>
            )}
          </CardContent>
          {/* Antes era un submit directo: un clic borraba el programa entero
              sin confirmar, mientras borrar UNA actividad sí la pedía. */}
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Eliminar el programa completo"
            description={`Se borrarán «${program.title}», sus ${activities.length} actividad(es) y todas las hojas asociadas. Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar definitivamente"
            variant="destructive"
            loading={deletePending}
            onConfirm={() => {
              const formData = new FormData()
              formData.set("programId", program.id)
              React.startTransition(() => deleteAction(formData))
            }}
          />
        </Card>
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
export function WorksiteScopePanel({ programId, visibleWorksites, memberWorksiteIds }: {
  programId: string
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds: string[]
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
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Faenas que cubre este programa</CardTitle>
        <CardDescription className="text-xs">
          Sin ninguna faena marcada, el programa aplica a todas tus faenas autorizadas. Marca faenas solo si este programa no debe cubrirlas todas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* space-y-2 y no -1: con casillas de 16px, 8px de separación deja el
            objetivo táctil de cada fila por sobre el mínimo de WCAG 2.5.8. */}
        <ul className="space-y-2">
          {visibleWorksites.map((worksite) => (
            <li key={worksite.id}>
              <Checkbox
                id={`ws-${worksite.id}`}
                checked={selected.includes(worksite.id)}
                onChange={() => toggle(worksite.id)}
                label={<>{worksite.name} <span className="text-xs text-[var(--color-text-subtle)]">({worksite.code})</span></>}
              />
            </li>
          ))}
        </ul>
        {/* El resumen es una línea propia y no un texto al lado del botón:
            ahí se leía como hint del botón en vez de como estado del programa.
            Cuando hay cambios pendientes, explica por qué el botón se habilita
            (y, al revés, por qué está deshabilitado el resto del tiempo). */}
        <p className={isDirty ? "text-xs font-medium text-[var(--color-warning)]" : "text-xs text-[var(--color-text-muted)]"}>
          {isDirty
            ? "Cambios sin guardar."
            : selected.length === 0
              ? `Aplica a todas las faenas autorizadas (${visibleWorksites.length}).`
              : `${selected.length} de ${visibleWorksites.length} faenas marcadas.`}
        </p>
        <Button type="button" size="sm" disabled={pending || !isDirty} onClick={save}>{pending ? "Guardando..." : "Guardar faenas"}</Button>
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

      </CardContent>
    </Card>
  )
}
