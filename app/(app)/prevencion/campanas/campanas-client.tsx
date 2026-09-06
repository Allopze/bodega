"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
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
  setCampaignPdtpActivitiesAction,
} from "./actions"
import { PDTP_CAMPAIGN_ACTIVITIES } from "@/lib/services/prevention-campaigns.catalog"
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
  const [newActivity, setNewActivity] = useState("")
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [evidenceUrl, setEvidenceUrl] = useState("")

  const handleCreate = () => {
    if (!newWorksiteId || !newTitle.trim() || !newActivity) {
      setError("Completa la faena, el título y la actividad que acredita.")
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createCampaignAction({
        worksiteId: newWorksiteId,
        title: newTitle,
        description: newDescription,
        pdtpActivityNumbers: [Number(newActivity)],
      })
      if (res.ok) {
        setIsCreateOpen(false)
        setNewTitle("")
        setNewDescription("")
        setNewWorksiteId("")
        setNewActivity("")
        router.refresh()
      } else {
        setError(res.message ?? "Ocurrió un error")
      }
    })
  }

  /** El número declarado, o el primero si la campaña declara más de uno. */
  const activityOf = (campaign: CampaignWithStats): number => {
    const numbers = campaign.pdtpActivityNumbers
    return Array.isArray(numbers) && numbers.length > 0 ? Number(numbers[0]) : 85
  }

  const handleSetActivity = (campaignId: string, value: string) => {
    setError(null)
    startTransition(async () => {
      const res = await setCampaignPdtpActivitiesAction({
        campaignId,
        pdtpActivityNumbers: [Number(value)],
      })
      if (res.ok) router.refresh()
      else setError(res.message ?? "Ocurrió un error")
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
        if (res.data?.pdtpPending === true) setError(res.message ?? null)
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
            <TableRoot className="rounded-none border-0">
            <Table className="text-left">
              <caption className="sr-only">Campañas de capacitación</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead><TableHead>Título / Descripción</TableHead><TableHead>Faena</TableHead>
                  <TableHead>Acredita</TableHead>
                  <TableHead>Asistentes</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialCampaigns.map((cmp) => (
                  <TableRow key={cmp.id} className="hover:bg-[var(--color-surface-hover)]">
                    <TableCell className="font-mono font-medium">{cmp.code}</TableCell>
                    <TableCell>
                      <div className="font-medium text-[var(--color-text)]">{cmp.title}</div>
                      {cmp.description && (
                        <div className="text-xs text-[var(--color-text-muted)] line-clamp-1">
                          {cmp.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">{cmp.worksiteName}</TableCell>
                    <TableCell>
                      {/* Corregible mientras no esté cerrada: una campaña completada ya
                          acreditó, y cambiarle el número dejaría la ejecución apuntando a
                          otra actividad. */}
                      {canManage && cmp.status !== "completed" && cmp.status !== "cancelled" ? (
                        <Select
                          value={String(activityOf(cmp))}
                          onValueChange={(value) => handleSetActivity(cmp.id, value)}
                        >
                          <SelectTrigger className="h-8 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PDTP_CAMPAIGN_ACTIVITIES.map((activity) => (
                              <SelectItem key={activity.n} value={String(activity.n)}>
                                N°{activity.n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="font-mono text-xs text-[var(--color-text-muted)]">
                          N°{activityOf(cmp)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-[var(--color-primary-ink)]">
                      {cmp.attendanceCount} trabajadores
                    </TableCell>
                    <TableCell>
                      {cmp.status === "active" && <Badge variant="primary">Activa</Badge>}
                      {cmp.status === "completed" && <Badge variant="success">Completada</Badge>}
                      {cmp.status === "cancelled" && <Badge variant="danger">Cancelada</Badge>}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableRoot>
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
              <Label>Actividad del programa que acredita</Label>
              <Select value={newActivity} onValueChange={setNewActivity}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona la actividad" />
                </SelectTrigger>
                <SelectContent>
                  {PDTP_CAMPAIGN_ACTIVITIES.map((activity) => (
                    <SelectItem key={activity.n} value={String(activity.n)}>
                      N°{activity.n} — {activity.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[var(--color-text-muted)]">
                Antes quedaba fijo en la N°85, así que las otras cuatro campañas del programa no se podían
                declarar desde acá. Se puede corregir mientras la campaña no esté cerrada.
              </p>
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
            <SheetTitle>Registrar Asistencia: {attendanceCampaign?.code}</SheetTitle>
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
                    <div key={w.id} className="rounded-md p-2 hover:bg-[var(--color-surface-hover)]">
                      <Checkbox
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedWorkerIds([...selectedWorkerIds, w.id])
                          } else {
                            setSelectedWorkerIds(selectedWorkerIds.filter((id) => id !== w.id))
                          }
                        }}
                        label={<>
                          <span className="block text-sm font-medium text-[var(--color-text)]">{w.name}</span>
                          <span className="block text-xs text-[var(--color-text-muted)]">RUT: {w.rut}</span>
                        </>}
                      />
                    </div>
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
              Al completar la campaña se gatillará automáticamente la auto-acreditación en PDTP acreditando {closeCampaignItem?.attendanceCount} trabajadores, si la campaña declara actividades PDTP.
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
