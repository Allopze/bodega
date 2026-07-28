"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/admin/sheet"
import {
  closeCampaignAction,
  createCampaignAction,
  recordCampaignAttendanceAction,
} from "./actions"
import type { preventionCampaigns } from "@/db/schema"

export type CampaignWithStats = typeof preventionCampaigns.$inferSelect & {
  worksiteName: string
  attendanceCount: number
}

interface WorkerItem {
  id: string
  name: string
  rut: string
  worksiteId: string
}

interface WorksitesItem {
  id: string
  name: string
  code: string
}

interface CampanasClientProps {
  initialCampaigns: CampaignWithStats[]
  worksites: WorksitesItem[]
  workers: WorkerItem[]
  canManage: boolean
}

export function CampanasClient({
  initialCampaigns,
  worksites,
  workers,
  canManage,
}: CampanasClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [attendanceCampaign, setAttendanceCampaign] = useState<CampaignWithStats | null>(null)
  const [closeCampaignItem, setCloseCampaignItem] = useState<CampaignWithStats | null>(null)

  // Form states
  const [newTitle, setNewTitle] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newWorksiteId, setNewWorksiteId] = useState("")
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [evidenceUrl, setEvidenceUrl] = useState("")

  const handleCreate = () => {
    if (!newWorksiteId || !newTitle.trim()) {
      setError("Completa el título y la faena.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createCampaignAction({
        worksiteId: newWorksiteId,
        title: newTitle,
        description: newDescription,
        pdtpActivityNumbers: [85],
      })
      if (res.ok) {
        setIsCreateOpen(false)
        setNewTitle("")
        setNewDescription("")
        setNewWorksiteId("")
        router.refresh()
      } else {
        setError(res.message ?? "Ocurrió un error")
      }
    })
  }

  const handleRecordAttendance = () => {
    if (!attendanceCampaign || selectedWorkerIds.length === 0) return
    setError(null)
    startTransition(async () => {
      const res = await recordCampaignAttendanceAction({
        campaignId: attendanceCampaign.id,
        workerIds: selectedWorkerIds,
      })
      if (res.ok) {
        setAttendanceCampaign(null)
        setSelectedWorkerIds([])
        router.refresh()
      } else {
        setError(res.message ?? "Ocurrió un error")
      }
    })
  }

  const handleCloseCampaign = () => {
    if (!closeCampaignItem) return
    setError(null)
    startTransition(async () => {
      const res = await closeCampaignAction({
        campaignId: closeCampaignItem.id,
        evidenceUrl: evidenceUrl.trim() || undefined,
      })
      if (res.ok) {
        setCloseCampaignItem(null)
        setEvidenceUrl("")
        router.refresh()
      } else {
        setError(res.message ?? "Ocurrió un error")
      }
    })
  }

  const workersInWorksite = attendanceCampaign
    ? workers.filter((w) => w.worksiteId === attendanceCampaign.worksiteId)
    : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas Preventivas (R9)"
        description="Registro de difusiones masivas y auto-acreditación PDTP por trabajadores alcanzados"
        actions={
          canManage ? (
            <Button onClick={() => setIsCreateOpen(true)} className="bg-[var(--color-primary)] text-white">
              + Nueva Campaña
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="p-3 text-sm text-[var(--color-danger-ink)] bg-[var(--color-danger-tint)] rounded-md border border-[var(--color-danger-border)]">
          {error}
        </div>
      )}

      {initialCampaigns.length === 0 ? (
        <EmptyState
          title="Sin campañas registradas"
          description="Crea la primera campaña preventiva para difundir medidas de seguridad y acreditar PDTP (R9)."
          action={
            canManage ? (
              <Button onClick={() => setIsCreateOpen(true)} className="bg-[var(--color-primary)] text-white">
                Crear Campaña
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[var(--color-surface-2)] th-type border-b border-[var(--color-border)]">
                <tr>
                  <th scope="col" className="px-4 py-3">Código</th>
                  <th scope="col" className="px-4 py-3">Título / Descripción</th>
                  <th scope="col" className="px-4 py-3">Faena</th>
                  <th scope="col" className="px-4 py-3">Asistentes</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {initialCampaigns.map((cmp) => (
                  <tr key={cmp.id} className="hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-3 font-mono font-medium">{cmp.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{cmp.title}</div>
                      {cmp.description && (
                        <div className="text-xs text-[var(--color-text-muted)] line-clamp-1">
                          {cmp.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{cmp.worksiteName}</td>
                    <td className="px-4 py-3 font-semibold text-[var(--color-primary-ink)]">
                      {cmp.attendanceCount} trabajadores
                    </td>
                    <td className="px-4 py-3">
                      {cmp.status === "active" && <Badge variant="primary">Activa</Badge>}
                      {cmp.status === "completed" && <Badge variant="success">Completada</Badge>}
                      {cmp.status === "cancelled" && <Badge variant="danger">Cancelada</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {canManage && cmp.status === "active" && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setAttendanceCampaign(cmp)
                              setSelectedWorkerIds([])
                            }}
                          >
                            + Asistencia
                          </Button>
                          <Button
                            size="sm"
                            className="bg-[var(--color-success-ink)] text-white hover:bg-[var(--color-success-ink)]/90"
                            onClick={() => setCloseCampaignItem(cmp)}
                          >
                            Cerrar Campaña
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Nueva Campaña */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Nueva Campaña Preventiva</DialogTitle>
            <DialogDescription>
              Registra una campaña de difusión preventiva para ser acreditada en PDTP (R9).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Faena</Label>
              <Select value={newWorksiteId} onValueChange={setNewWorksiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona una faena" />
                </SelectTrigger>
                <SelectContent>
                  {worksites.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Título de la Campaña</Label>
              <Input
                placeholder="Ej: Difusión de uso correcto de EPP"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción / Alcance (Opcional)</Label>
              <Input
                placeholder="Detalles sobre el tema o la maniobra abordada"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending ? "Guardando..." : "Crear Campaña"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sheet Asistencia */}
      <Sheet open={!!attendanceCampaign} onOpenChange={(open: boolean) => !open && setAttendanceCampaign(null)}>
        <SheetContent className="sm:max-w-[500px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Registrar Asistencia — {attendanceCampaign?.code}</SheetTitle>
            <SheetDescription>
              Selecciona los trabajadores que participaron en la actividad de difusión en {attendanceCampaign?.worksiteName}.
            </SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-3">
            <div className="text-xs text-[var(--color-text-muted)] font-medium">
              Trabajadores activos en la faena ({workersInWorksite.length}):
            </div>
            <div className="max-h-[350px] overflow-y-auto divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] p-2">
              {workersInWorksite.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--color-text-muted)]">
                  No hay trabajadores registrados en esta faena.
                </div>
              ) : (
                workersInWorksite.map((w) => {
                  const isChecked = selectedWorkerIds.includes(w.id)
                  return (
                    <label
                      key={w.id}
                      className="flex items-center gap-3 p-2 hover:bg-[var(--color-surface-hover)] cursor-pointer rounded-md"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedWorkerIds([...selectedWorkerIds, w.id])
                          } else {
                            setSelectedWorkerIds(selectedWorkerIds.filter((id) => id !== w.id))
                          }
                        }}
                        className="rounded text-[var(--color-primary)]"
                      />
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text)]">{w.name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">RUT: {w.rut}</div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
            <div className="pt-2 flex justify-between items-center text-xs text-[var(--color-text-muted)]">
              <span>{selectedWorkerIds.length} seleccionados</span>
              <Button
                size="sm"
                onClick={handleRecordAttendance}
                disabled={isPending || selectedWorkerIds.length === 0}
              >
                {isPending ? "Guardando..." : "Guardar Asistencia"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Dialog Cerrar Campaña */}
      <Dialog open={!!closeCampaignItem} onOpenChange={(open) => !open && setCloseCampaignItem(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Cerrar Campaña Preventiva</DialogTitle>
            <DialogDescription>
              Al completar la campaña se gatillará automáticamente la auto-acreditación en PDTP acreditando {closeCampaignItem?.attendanceCount} trabajadores.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Link de Evidencia / Acta Firmada (Opcional)</Label>
              <Input
                placeholder="https://... o referencia de documento"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCloseCampaignItem(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-[var(--color-success-ink)] text-white hover:bg-[var(--color-success-ink)]/90"
              onClick={handleCloseCampaign}
              disabled={isPending}
            >
              {isPending ? "Cerrando..." : "Confirmar Cierre y Acreditar PDTP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
