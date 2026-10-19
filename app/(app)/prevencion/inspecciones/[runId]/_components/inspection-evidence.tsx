"use client"

import * as React from "react"
import { X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { compressPhoto } from "@/lib/pwa/image-compress"
import { toast } from "@/lib/toast"
import { removeAnswerEvidenceAction } from "../../actions"

/**
 * Evidencia fotográfica de una respuesta (función #1).
 *
 * `evidenceReference` existía en el esquema y en el export, y ninguna pantalla
 * adjuntaba nada: una inspección sin foto del hallazgo no sirve como evidencia.
 *
 * La foto cuelga de la respuesta, así que el ítem debe estar respondido y
 * guardado antes de poder adjuntar. Mientras no haya respuesta el control no se
 * pinta: con 24 ítems, un botón deshabilitado y su explicación por fila eran
 * ruido que la pantalla repetía 24 veces (P2-6).
 */
function inspectionEvidenceFileName(path: string) {
  return path.split("/").pop() ?? ""
}

type EvidenceItem = { id: string; path: string; caption: string | null }

/**
 * Referencia estable para «sin fotos». El llamador solía pasar `?? []`, un
 * arreglo nuevo en cada render: como la lista se copiaba a un estado en un
 * efecto que dependía de ella, la foto recién subida se borraba de la pantalla
 * en el render siguiente.
 */
const NO_EVIDENCE: readonly EvidenceItem[] = []

const OFFLINE_UPLOAD_MESSAGE = "Sin conexión: no se pudo subir la foto. Revisa la señal e inténtalo de nuevo."

/**
 * Una subida sin señal rechaza `fetch` con un `TypeError` cuyo texto
 * («Failed to fetch») no le dice nada a quien está en terreno.
 */
function uploadFailureMessage(error: unknown, fallback: string) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE_UPLOAD_MESSAGE
  if (error instanceof TypeError && /failed to fetch|fetch failed|network|load failed/i.test(error.message)) return OFFLINE_UPLOAD_MESSAGE
  return error instanceof Error && error.message ? error.message : fallback
}

/** Lo que trajo el servidor, más lo subido en esta pantalla, menos lo quitado; sin repetir ids. */
function mergeEvidence(server: readonly EvidenceItem[], uploaded: readonly EvidenceItem[], removed: ReadonlySet<string>) {
  const byId = new Map<string, EvidenceItem>()
  for (const item of server) byId.set(item.id, item)
  for (const item of uploaded) byId.set(item.id, item)
  return [...byId.values()].filter((item) => !removed.has(item.id))
}

export function FindingEvidence({ findingId, evidence, editable }: {
  findingId: string
  evidence: { id: string; path: string; caption: string | null }[]
  editable: boolean
}) {
  const [uploadedItems, setUploadedItems] = React.useState<EvidenceItem[]>([])
  const [caption, setCaption] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const items = React.useMemo(() => {
    const byId = new Map(evidence.map((item) => [item.id, item]))
    for (const item of uploadedItems) byId.set(item.id, item)
    return [...byId.values()]
  }, [evidence, uploadedItems])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError("")
    try {
      for (const file of Array.from(files)) {
        const compressed = await compressPhoto(file)
        const body = new FormData()
        body.set("file", compressed)
        body.set("findingId", findingId)
        body.set("caption", caption)
        const response = await fetch("/api/prevencion/inspecciones/finding-evidence", { method: "POST", body })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}))
          throw new Error(failure.error ?? "No se pudo subir la evidencia.")
        }
        const json = await response.json()
        setUploadedItems((current) => [...current, { id: json.id, path: json.path, caption: json.caption }])
      }
      setCaption("")
    } catch (err) {
      setError(uploadFailureMessage(err, "No se pudo subir la evidencia."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && <div className="flex flex-wrap gap-2">{items.map((item) => {
        const name = inspectionEvidenceFileName(item.path)
        return <a key={item.id} href={`/api/prevencion/inspecciones/evidence/${name}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL autenticada y dinámica. */}
          <img src={`/api/prevencion/inspecciones/evidence/${name}`} alt={item.caption ?? "Evidencia del hallazgo"} className="h-16 w-16 rounded border border-[var(--color-border)] object-cover" />
        </a>
      })}</div>}
      {editable && <div className="flex flex-wrap items-end gap-2">
        <Field label="Leyenda de la evidencia"><Input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} /></Field>
        <input ref={inputRef} type="file" accept="image/*" multiple aria-label="Adjuntar evidencias del hallazgo" className="sr-only" onChange={(event) => { void upload(event.target.files); event.target.value = "" }} />
        <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => inputRef.current?.click()}>{busy ? "Subiendo…" : "Adjuntar fotos"}</Button>
      </div>}
      {error && <p role="alert" className="text-xs text-[var(--color-danger-ink)]">{error}</p>}
    </div>
  )
}

export function AnswerEvidence({
  answerId,
  evidence = NO_EVIDENCE,
  editable,
  readyToPersist,
  ensureAnswerId,
  itemLabel,
  onEvidenceChange,
  blockedReason,
}: {
  answerId: string | null
  evidence?: readonly EvidenceItem[]
  editable: boolean
  /** Existe una respuesta válida en el borrador y puede guardarse. */
  readyToPersist: boolean
  /** Autosave que crea la fila persistida cuando la foto es el primer guardado. */
  ensureAnswerId?: () => Promise<string>
  /** Nombre del ítem: da nombre accesible a cada control, que si no se llamarían igual en las 24 filas. */
  itemLabel?: string
  /**
   * Cuántas fotos tiene ahora la respuesta, tras subir o quitar una. El detalle
   * lo necesita para no dejar «Sin responder» un ítem con fotos: el servidor lo
   * rechaza y la fila quedaría retenida sin que la persona sepa por qué.
   */
  onEvidenceChange?: (count: number) => void
  /** Por qué todavía no se puede adjuntar (p. ej. falta el motivo). Reemplaza al botón. */
  blockedReason?: string
}) {
  const [uploadedItems, setUploadedItems] = React.useState<EvidenceItem[]>([])
  const [removedIds, setRemovedIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  // La confirmación conserva su objetivo al cerrarse: si `target` se borrara con
  // `open`, el texto del diálogo cambiaría mientras se desvanece.
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<{ id: string; position: number }>({ id: "", position: 0 })
  const operation = useOperation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const addButtonRef = React.useRef<HTMLButtonElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  // A dónde vuelve el foco al cerrar la confirmación: la foto que se iba a quitar
  // si se desiste, y «Agregar fotos» si se la quitó (la miniatura ya no existe).
  const focusTargetRef = React.useRef<HTMLElement | null>(null)

  const items = React.useMemo(() => mergeEvidence(evidence, uploadedItems, removedIds), [evidence, uploadedItems, removedIds])
  const subject = itemLabel ? ` de ${itemLabel}` : ""
  const canAttach = editable && readyToPersist && !blockedReason

  async function upload(files: FileList | null) {
    if (!files?.length || !canAttach) return
    setBusy(true)
    setError("")
    try {
      const persistedAnswerId = answerId ?? await ensureAnswerId?.()
      if (!persistedAnswerId) throw new Error("No se pudo guardar la respuesta antes de adjuntar la foto.")
      let count = items.length
      // Secuencial y no en paralelo: en terreno la conexión es escasa y varias
      // subidas simultáneas se estorban entre sí.
      for (const file of Array.from(files)) {
        const compressed = await compressPhoto(file)
        const body = new FormData()
        body.set("file", compressed)
        body.set("answerId", persistedAnswerId)
        const response = await fetch("/api/prevencion/inspecciones/evidence", { method: "POST", body })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}))
          throw new Error(failure.error ?? "No se pudo subir la foto.")
        }
        const json = await response.json()
        setUploadedItems((current) => [...current, { id: json.id, path: json.path, caption: null }])
        count += 1
        onEvidenceChange?.(count)
      }
    } catch (err) {
      setError(uploadFailureMessage(err, "No se pudo subir la foto."))
    } finally {
      setBusy(false)
    }
  }

  function askToRemove(item: EvidenceItem, position: number, trigger: HTMLElement) {
    focusTargetRef.current = trigger
    setRemoveTarget({ id: item.id, position })
    operation.setMessage("")
    setRemoveOpen(true)
  }

  function remove() {
    const target = removeTarget
    operation.run(() => removeAnswerEvidenceAction({ evidenceId: target.id }), (result) => {
      // Si el servidor no devolvió la cuenta, se descuenta de lo que se ve.
      const remaining = typeof result.data?.remaining === "number" ? result.data.remaining : Math.max(0, items.length - 1)
      setRemovedIds((current) => new Set(current).add(target.id))
      focusTargetRef.current = addButtonRef.current
        ?? containerRef.current?.querySelector<HTMLElement>(`[data-remove-photo]:not([data-evidence-id="${target.id}"])`)
        ?? containerRef.current
      setRemoveOpen(false)
      onEvidenceChange?.(remaining)
      toast.success("Foto quitada.")
    })
  }

  return (
    <div ref={containerRef} tabIndex={-1} className="space-y-2 outline-none">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => {
            const position = index + 1
            const src = `/api/prevencion/inspecciones/evidence/${inspectionEvidenceFileName(item.path)}`
            return (
              // El botón de quitar queda en la esquina, fuera del enlace: tocar la
              // miniatura abre la foto y tocar la esquina la quita, sin ambigüedad.
              <div key={item.id} className="relative size-20 sm:size-16">
                <a href={src} target="_blank" rel="noreferrer" aria-label={`Ver foto ${position}${subject}`} className="block size-full">
                  {/* eslint-disable-next-line @next/next/no-img-element -- la ruta es dinámica y autenticada; next/image no aporta aquí. */}
                  <img
                    src={src}
                    alt={item.caption ?? "Evidencia de la inspección"}
                    className="size-full rounded border border-[var(--color-border)] object-cover"
                  />
                </a>
                {editable && (
                  <button
                    type="button"
                    data-remove-photo
                    data-evidence-id={item.id}
                    aria-label={`Quitar foto ${position}${subject}`}
                    disabled={busy || operation.pending}
                    onClick={(event) => askToRemove(item, position, event.currentTarget)}
                    className="absolute right-0 top-0 flex size-11 items-center justify-center disabled:opacity-45 sm:size-8"
                  >
                    <span className="flex size-6 items-center justify-center rounded-full border border-[var(--color-border-control)] bg-[var(--color-surface)] text-[var(--color-danger-ink)] shadow-[var(--shadow-xs)]">
                      <X size={12} weight="bold" aria-hidden />
                    </span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {editable && blockedReason && <p className="text-xs text-[var(--color-text-subtle)]">{blockedReason}</p>}
      {canAttach && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            tabIndex={-1}
            onChange={(event) => { void upload(event.target.files); event.target.value = "" }}
            aria-label={itemLabel ? `Adjuntar fotos de ${itemLabel}` : "Adjuntar evidencia fotográfica"}
            className="sr-only"
          />
          <Button
            ref={addButtonRef}
            type="button"
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Subiendo…" : items.length > 0 ? "Agregar fotos" : "Adjuntar fotos"}
          </Button>
          {!answerId && <p className="text-xs text-[var(--color-text-subtle)]">Al elegir una foto, esta respuesta se guardará automáticamente.</p>}
        </>
      )}
      {error && <p role="alert" className="text-xs text-[var(--color-danger-ink)]">{error}</p>}
      {/* Se monta al primer intento de quitar: son hasta 75 ítems por pantalla y
          casi ninguno llega a abrir la confirmación. */}
      {editable && removeTarget.id !== "" && <ConfirmDialog
        open={removeOpen}
        // Mientras la acción corre no se cierra: una foto a medio quitar que el
        // diálogo ya no muestra dejaría a la persona sin saber qué pasó.
        onOpenChange={(next) => { if (next || !operation.pending) setRemoveOpen(next) }}
        title="Quitar foto"
        description={`La foto ${removeTarget.position}${itemLabel ? ` de «${itemLabel}»` : ""} se quitará de la inspección. No se puede deshacer.`}
        confirmLabel="Quitar foto"
        cancelLabel="Volver"
        variant="destructive"
        loading={operation.pending}
        error={operation.messageTone === "error" ? operation.message : undefined}
        returnFocusRef={focusTargetRef}
        onConfirm={remove}
      />}
    </div>
  )
}
