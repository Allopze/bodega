"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, QrCode } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PublicFormQrDialog, type PublicFormQrOption } from "@/components/public-access/public-form-qr-dialog"
import { createTaeLoadingPointAction, createTaePublicLinkAction, revokeTaePublicLinkAction, setTaeLoadingPointStorageAction } from "./actions"
import { toast } from "@/lib/toast"

interface Worksite { id: string; name: string }
interface LoadingPoint { id: string; worksiteId: string; name: string; type: string; storageLocationId: string | null }
interface StorageLocation { id: string; worksiteId: string; name: string }
interface ExistingLink { id: string; label: string; worksiteName: string; loadingPointName: string | null; revokedAt: string | null }

export function TaeAccessPanel({ worksites, loadingPoints, storageLocations, existingLinks }: { worksites: Worksite[]; loadingPoints: LoadingPoint[]; storageLocations: StorageLocation[]; existingLinks: ExistingLink[] }) {
  const router = useRouter()
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [loadingPointId, setLoadingPointId] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [newPointName, setNewPointName] = React.useState("")
  const [newPointStorageId, setNewPointStorageId] = React.useState("")
  const [generated, setGenerated] = React.useState<PublicFormQrOption[]>([])
  const [pending, startTransition] = React.useTransition()
  const points = loadingPoints.filter((point) => point.worksiteId === worksiteId)
  const worksiteStorageLocations = storageLocations.filter((location) => location.worksiteId === worksiteId)

  function createLink() {
    startTransition(async () => {
      const result = await createTaePublicLinkAction({ worksiteId, loadingPointId, label })
      if (!result.ok || !result.data) {
        toast.error(result.message ?? "No se pudo generar el QR")
        return
      }
      const point = loadingPoints.find((item) => item.id === loadingPointId)
      const worksite = worksites.find((item) => item.id === worksiteId)
      const option: PublicFormQrOption = {
        id: result.data.id,
        label: `${worksite?.name ?? "Faena"}${point ? ` · ${point.name}` : ""}`,
        url: `${window.location.origin}/tae/acceso/${result.data.accessToken}`,
        pdfTitle: worksite?.name ?? "Control TAE",
        pdfFileName: `tae-acceso-${result.data.id}.pdf`,
      }
      setGenerated([option])
      toast.success("Enlace TAE generado. Descarga o copia el QR ahora.")
    })
  }

  function createPoint() {
    startTransition(async () => {
      const result = await createTaeLoadingPointAction({ worksiteId, name: newPointName, type: "tae", storageLocationId: newPointStorageId || null })
      if (!result.ok) { toast.error(result.message); return }
      toast.success(result.message ?? "Punto de carga creado")
      setNewPointName("")
      setNewPointStorageId("")
      router.refresh()
    })
  }

  function setPointStorage(pointId: string, storageLocationId: string) {
    startTransition(async () => {
      const result = await setTaeLoadingPointStorageAction(pointId, storageLocationId === "none" ? null : storageLocationId)
      if (!result.ok) { toast.error(result.message); return }
      toast.success(result.message ?? "Vasija actualizada")
      router.refresh()
    })
  }

  return (
    <section className="border border-(--color-border) bg-(--color-surface) p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-eyebrow">Acceso público</p><h2 className="text-h3">QR de carga TAE</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">Cada QR queda delimitado por faena y punto de carga.</p></div><QrCode size={22} className="text-[var(--color-primary)]" /></div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div><Label>Faena</Label><Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setLoadingPointId("") }}><SelectTrigger aria-label="Faena"><SelectValue /></SelectTrigger><SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Punto de carga</Label><Select value={loadingPointId} onValueChange={setLoadingPointId}><SelectTrigger aria-label="Selecciona un punto"><SelectValue placeholder="Selecciona un punto" /></SelectTrigger><SelectContent>{points.map((point) => <SelectItem key={point.id} value={point.id}>{point.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Etiqueta opcional</Label><Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ej. Surtidor principal" /></div>
      </div>
      <div className="mt-3 flex max-w-2xl items-end gap-2"><div className="min-w-0 flex-1"><Label htmlFor="tae-new-point">Nuevo punto de carga</Label><Input id="tae-new-point" value={newPointName} onChange={(event) => setNewPointName(event.target.value)} placeholder="Ej. Surtidor principal" /></div><div className="min-w-0 flex-1"><Label>Vasija (opcional)</Label><Select value={newPointStorageId} onValueChange={setNewPointStorageId}><SelectTrigger aria-label="Sin vincular"><SelectValue placeholder="Sin vincular" /></SelectTrigger><SelectContent>{worksiteStorageLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent></Select></div><Button type="button" variant="secondary" size="sm" onClick={createPoint} disabled={!worksiteId || !newPointName.trim() || pending}><Plus size={14} /> Crear</Button></div>
      {points.length > 0 && <div className="mt-4 border-t border-(--color-border) pt-4"><p className="text-eyebrow">Vasija de cada punto de carga</p><p className="mt-1 text-xs text-(--color-text-muted)">Sin este enlace, lo que la PWA entrega en un punto no se descuenta del saldo de ninguna vasija.</p><div className="mt-2 space-y-2">{points.map((point) => <div key={point.id} className="flex items-center justify-between gap-3 text-sm"><span>{point.name}</span><Select value={point.storageLocationId ?? "none"} onValueChange={(value) => setPointStorage(point.id, value)}><SelectTrigger aria-label="Sin vincular" className="w-56"><SelectValue placeholder="Sin vincular" /></SelectTrigger><SelectContent><SelectItem value="none">Sin vincular</SelectItem>{worksiteStorageLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent></Select></div>)}</div></div>}
      <div className="mt-4 flex flex-wrap gap-2"><Button type="button" size="sm" onClick={createLink} disabled={!worksiteId || !loadingPointId || pending}><Plus size={14} /> Generar QR TAE</Button>{generated.length > 0 && <PublicFormQrDialog title="Acceso para carga TAE" description="Comparte este QR solo en el punto de carga indicado. El enlace es revocable." selectorLabel="Punto de carga" options={generated} selectedOptionId={generated[0]!.id} onSelectedOptionChange={() => {}} pdfSubtitle="Formulario de carga TAE" qrAlt={(option) => `Código QR TAE para ${option.label}`} />}</div>
      {existingLinks.length > 0 && <div className="mt-5 border-t border-(--color-border) pt-4"><p className="text-eyebrow">Enlaces emitidos</p><div className="mt-2 space-y-2">{existingLinks.map((link) => <div key={link.id} className="flex items-center justify-between gap-3 text-sm"><span>{link.label} <span className="text-[var(--color-text-muted)]">· {link.worksiteName}{link.loadingPointName ? ` / ${link.loadingPointName}` : ""}</span></span>{link.revokedAt ? <span className="text-[var(--color-danger)]">Revocado</span> : <Button type="button" variant="ghost" size="sm" onClick={() => startTransition(async () => { const result = await revokeTaePublicLinkAction(link.id); if (result.ok) toast.success(result.message ?? "Enlace revocado"); else toast.error(result.message) })}>Revocar</Button>}</div>)}</div></div>}
    </section>
  )
}
