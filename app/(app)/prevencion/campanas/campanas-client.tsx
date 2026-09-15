"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  closeCampaignAction,
  createCampaignAction,
  setCampaignPdtpActivitiesAction,
} from "./actions"
import { PDTP_CAMPAIGN_ACTIVITIES } from "@/lib/services/prevention-campaigns.catalog"
import type { preventionCampaigns } from "@/db/schema"

export type CampaignRow = typeof preventionCampaigns.$inferSelect & {
  worksiteName: string
}

interface WorksitesItem {
  id: string
  name: string
  code: string
}

interface CampanasClientProps {
  initialCampaigns: CampaignRow[]
  worksites: WorksitesItem[]
  canManage: boolean
}

export function CampanasClient({
  initialCampaigns,
  worksites,
  canManage,
}: CampanasClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [doneCampaignItem, setDoneCampaignItem] = useState<CampaignRow | null>(null)

  // Form states
  const [newTitle, setNewTitle] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newWorksiteId, setNewWorksiteId] = useState("")
  const [newActivity, setNewActivity] = useState("")
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
  const activityOf = (campaign: CampaignRow): number => {
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

  const handleMarkDone = () => {
    if (!doneCampaignItem || !evidenceUrl.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await closeCampaignAction({
        campaignId: doneCampaignItem.id,
        evidenceUrl: evidenceUrl.trim(),
      })
      if (res.ok) {
        setDoneCampaignItem(null)
        setEvidenceUrl("")
        if (res.data?.pdtpPending === true) setError(res.message ?? null)
        router.refresh()
      } else {
        setError(res.message ?? "Ocurrió un error")
      }
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas Preventivas (R9)"
        description="Se hizo / no se hizo, con evidencia de difusión — auto-acredita el PDTP"
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
                  <TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
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
                      {/* Corregible mientras no esté hecha: una campaña hecha ya
                          acreditó, y cambiarle el número dejaría la ejecución apuntando a
                          otra actividad. */}
                      {canManage && cmp.status !== "done" ? (
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
                    <TableCell>
                      {cmp.status === "pending" && <MetaBadge meta={{ label: "Pendiente", variant: "warning" }} />}
                      {cmp.status === "done" && <MetaBadge meta={{ label: "Hecha", variant: "success" }} />}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {canManage && cmp.status === "pending" && (
                        <Button
                          size="sm"
                          className="bg-[var(--color-success-ink)] text-white hover:bg-[var(--color-success-ink)]/90"
                          onClick={() => setDoneCampaignItem(cmp)}
                        >
                          Marcar como hecha
                        </Button>
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

      {/* Dialog Marcar como hecha */}
      <Dialog open={!!doneCampaignItem} onOpenChange={(open) => !open && setDoneCampaignItem(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Marcar Campaña como Hecha</DialogTitle>
            <DialogDescription>
              Se gatillará automáticamente la auto-acreditación en PDTP, si la campaña declara actividades PDTP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Evidencia de difusión (foto, lista de asistencia, acta)</Label>
              <Input
                placeholder="https://..."
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
              />
              <p className="text-xs text-[var(--color-text-muted)]">
                Pega el enlace al documento (Drive, SharePoint, etc.).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDoneCampaignItem(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-[var(--color-success-ink)] text-white hover:bg-[var(--color-success-ink)]/90"
              onClick={handleMarkDone}
              disabled={isPending || !evidenceUrl.trim()}
            >
              {isPending ? "Guardando..." : "Confirmar y Acreditar PDTP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
