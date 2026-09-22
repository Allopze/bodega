"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { MapTrifold } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { useOperation } from "@/lib/hooks/use-operation"
import { normalizeRiskLevel, riskLevelColor, riskLevelLabel } from "@/lib/prevention/risk-levels"
import { addRiskMapMarkerAction, removeRiskMapMarkerAction } from "./actions"

interface RiskMapMarker {
  id: string
  xPct: number
  yPct: number
  label: string | null
  riskEntryId: string
  hazard: string
  residualLevel: string
}

interface RiskMapLayout {
  worksiteId: string
  worksiteName: string
  layoutId: string
  imagePath: string
  title: string
  markers: RiskMapMarker[]
}

interface RiskEntryOption {
  id: string
  hazard: string
  residualLevel: string
}

interface Props {
  worksites: { id: string; name: string }[]
  layouts: RiskMapLayout[]
  /** Entradas de riesgo publicadas por faena, para el picker al ubicar un marcador. */
  entriesByWorksite: Record<string, RiskEntryOption[]>
  canEdit: boolean
}

/**
 * Mapa de riesgos espacial (requisito Oro de la certificación Mutual): un
 * plano de planta por faena con marcadores sobre la imagen, cada uno enlazado
 * a un peligro de la MIPER publicada. No hay librería de mapas en el repo —
 * el overlay es CSS puro sobre una imagen responsiva.
 */
export function RiskMapPanel({ worksites, layouts, entriesByWorksite, canEdit }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedWorksiteId = searchParams.get("mapWorksite")
  const [worksiteId, setWorksiteId] = React.useState(() => (
    worksites.some((item) => item.id === requestedWorksiteId) ? requestedWorksiteId! : worksites[0]?.id ?? ""
  ))
  const layout = layouts.find((item) => item.worksiteId === worksiteId)
  const entries = entriesByWorksite[worksiteId] ?? []
  const navigateWorksite = React.useCallback((value: string) => {
    setWorksiteId(value)
    const params = new URLSearchParams(searchParams.toString())
    params.set("mapWorksite", value)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : "", { scroll: false })
  }, [router, searchParams])

  if (worksites.length === 0) {
    return <EmptyState icon={<MapTrifold size={24} />} title="Sin faenas en tu alcance" description="Cuando tengas faenas asignadas podrás cargar su plano de riesgos." />
  }

  return (
    <div className="space-y-4">
      <OptionSelect
        id="riskmap-worksite"
        aria-label="Faena"
        value={worksiteId}
        onValueChange={navigateWorksite}
        options={worksites.map((item) => ({ value: item.id, label: item.name }))}
        className="w-64"
      />

      {!layout ? (
        <EmptyState
          icon={<MapTrifold size={24} />}
          title="Esta faena no tiene plano de riesgos"
          description="Carga una imagen del plano de planta para empezar a ubicar los peligros identificados en la MIPER."
          action={canEdit ? <UploadLayoutDialog worksiteId={worksiteId} /> : undefined}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{layout.title} ({layout.markers.length} marcador{layout.markers.length === 1 ? "" : "es"})</h2>
            {canEdit && <UploadLayoutDialog worksiteId={worksiteId} replacing />}
          </div>
          <RiskMapImage layout={layout} entries={entries} canEdit={canEdit} />
        </div>
      )}
    </div>
  )
}

function RiskMapImage({ layout, entries, canEdit }: { layout: RiskMapLayout; entries: RiskEntryOption[]; canEdit: boolean }) {
  const imgRef = React.useRef<HTMLImageElement>(null)
  const [pendingPoint, setPendingPoint] = React.useState<{ xPct: number; yPct: number } | null>(null)
  const [selectedMarker, setSelectedMarker] = React.useState<RiskMapMarker | null>(null)

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!canEdit || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const xPct = Math.round(((event.clientX - rect.left) / rect.width) * 10_000) / 100
    const yPct = Math.round(((event.clientY - rect.top) / rect.height) * 10_000) / 100
    setPendingPoint({ xPct, yPct })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canEdit || event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    setPendingPoint({ xPct: 50, yPct: 50 })
  }

  return (
    <div className="space-y-2">
      <div
        className="relative overflow-hidden rounded-lg border border-[var(--color-border)]"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        aria-label={canEdit ? "Plano de riesgos: clic para ubicar un marcador o presiona Enter para ubicarlo al centro" : "Plano de riesgos"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- imagen servida por ruta autenticada, no un asset de build */}
        <img
          ref={imgRef}
          src={`/api/prevencion/cgrd/mapa/${layout.imagePath.split("/").pop()}`}
          alt={layout.title}
          className="block w-full select-none"
          draggable={false}
        />
        {layout.markers.map((marker) => {
          // El marcador es un punto de color sin texto: el `title` solo lo
          // nombraba al pasar el mouse, así que con lector de pantalla o con
          // teclado era un botón anónimo. `aria-label` lo nombra en serio.
          const nombre = `${marker.hazard} · ${riskLevelLabel(marker.residualLevel)}`
          return (
            <button
              key={marker.id}
              type="button"
              className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${marker.xPct}%`, top: `${marker.yPct}%`, backgroundColor: riskLevelColor(marker.residualLevel) }}
              aria-label={`Marcador de riesgo: ${nombre}`}
              title={nombre}
              onClick={(event) => { event.stopPropagation(); setSelectedMarker(marker) }}
            />
          )
        })}
      </div>
      {canEdit && (
        <p className="text-xs text-[var(--color-text-subtle)]">Clic sobre el plano para ubicar un marcador nuevo; clic sobre un marcador para verlo o quitarlo.</p>
      )}

      {pendingPoint && (
        <PlaceMarkerDialog
          layoutId={layout.layoutId}
          point={pendingPoint}
          entries={entries}
          onClose={() => setPendingPoint(null)}
        />
      )}
      {selectedMarker && (
        <MarkerDetailDialog marker={selectedMarker} canEdit={canEdit} onClose={() => setSelectedMarker(null)} />
      )}
    </div>
  )
}

function UploadLayoutDialog({ worksiteId, replacing }: { worksiteId: string; replacing?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState("")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    const form = new FormData(event.currentTarget)
    const file = form.get("file")
    const title = String(form.get("title") ?? "").trim()
    if (!(file instanceof File) || file.size === 0) { setError("Selecciona una imagen."); return }

    setUploading(true)
    try {
      const uploadForm = new FormData()
      uploadForm.set("file", file)
      uploadForm.set("worksiteId", worksiteId)
      uploadForm.set("title", title)
      const response = await fetch("/api/prevencion/cgrd/mapa", { method: "POST", body: uploadForm })
      const body = await response.json()
      if (!response.ok) { setError(body.error ?? "No se pudo subir la imagen."); return }
      setOpen(false)
      router.refresh()
    } catch {
      setError("No se pudo conectar con el servidor para cargar la imagen.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">{replacing ? "Reemplazar plano" : "Cargar plano"}</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{replacing ? "Reemplazar plano de riesgos" : "Cargar plano de riesgos"}</DialogTitle>
            <DialogDescription>
              {replacing ? "El plano anterior queda archivado, con sus marcadores, como historial." : "Una imagen del plano de planta (JPEG o PNG)."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Título" htmlFor="riskmap-title" hint="Ej. Planta principal, nivel 1.">
            <Input id="riskmap-title" name="title" required minLength={3} maxLength={200} />
          </Field>
          <Field label="Imagen" htmlFor="riskmap-file">
            <Input id="riskmap-file" name="file" type="file" accept="image/jpeg,image/png" required />
          </Field>
          {error && <p role="status" className="text-sm">{error}</p>}
          <DialogFooter><Button type="submit" disabled={uploading}>Cargar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PlaceMarkerDialog({ layoutId, point, entries, onClose }: {
  layoutId: string
  point: { xPct: number; yPct: number }
  entries: RiskEntryOption[]
  onClose: () => void
}) {
  const [riskEntryId, setRiskEntryId] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const label = String(form.get("label") ?? "").trim()
    operation.run(() => addRiskMapMarkerAction({
      layoutId, riskEntryId, xPct: point.xPct, yPct: point.yPct, label: label || null,
    }), onClose)
  }

  return (
    <Dialog open onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Ubicar marcador</DialogTitle>
            <DialogDescription>Elige el peligro de la MIPER publicada que corresponde a este punto del plano.</DialogDescription>
          </DialogHeader>
          {entries.length === 0 ? (
            <p className="text-sm text-[var(--color-text-subtle)]">Esta faena no tiene una matriz MIPER publicada con peligros que ubicar.</p>
          ) : (
            <Field label="Peligro">
              <OptionSelect
                id="riskmap-entry"
                value={riskEntryId}
                onValueChange={setRiskEntryId}
                placeholder="Selecciona peligro"
                options={entries.map((entry) => ({
                  value: entry.id,
                  label: `${entry.hazard} · ${riskLevelLabel(entry.residualLevel)}`,
                }))}
              />
            </Field>
          )}
          <Field label="Etiqueta" hint="Opcional. Ej. Bodega 3.">
            <Input name="label" maxLength={200} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !riskEntryId}>Ubicar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MarkerDetailDialog({ marker, canEdit, onClose }: { marker: RiskMapMarker; canEdit: boolean; onClose: () => void }) {
  const operation = useOperation()

  return (
    <Dialog open onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{marker.hazard}</DialogTitle>
          <DialogDescription>{marker.label ?? "Sin etiqueta."}</DialogDescription>
        </DialogHeader>
        <MetaBadge meta={{ label: `${riskLevelLabel(marker.residualLevel)}`, variant: ["high", "critical"].includes(normalizeRiskLevel(marker.residualLevel) ?? "") ? "danger" : "warning" }} />
        {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
        <DialogFooter>
          {canEdit && (
            <Button
              variant="destructive"
              disabled={operation.pending}
              onClick={() => operation.run(() => removeRiskMapMarkerAction({ markerId: marker.id }), onClose)}
            >
              Quitar marcador
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
