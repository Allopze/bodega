"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { EvidenceField } from "@/components/prevention/evidence-field"
import { Field } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { closeCampaignAction, setCampaignPdtpActivitiesAction } from "./actions"
import type { preventionCampaigns } from "@/db/schema"
import { PdtpActivityPicker, type PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"

export type CampaignRow = typeof preventionCampaigns.$inferSelect & {
  worksiteName: string
}

interface CampanasClientProps {
  initialCampaigns: CampaignRow[]
  canManage: boolean
  catalogActivities: PdtpActivityPickerOption[]
  catalogBindings: Record<string, string[]>
}

/**
 * Task 13 (2026-09-23): las campañas nuevas del programa 2026 (N°85-89) ya no
 * se crean acá — nacen como ítems CAM-* del catálogo de capacitación en
 * `/prevencion/capacitacion`, la única vía viva desde ahora para acreditarlas
 * (ver `lib/prevention/training-occurrences-catalog.ts`). Esta pantalla queda
 * en modo lectura + cierre de lo pendiente: conserva "Marcar como hecha" y la
 * corrección de actividad para las campañas que ya existían antes de este
 * cambio, para no dejarlas huérfanas.
 */
const TRAINING_ROUTE = "/prevencion/capacitacion"

export function CampanasClient({
  initialCampaigns,
  canManage,
  catalogActivities,
  catalogBindings,
}: CampanasClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [doneCampaignItem, setDoneCampaignItem] = useState<CampaignRow | null>(null)
  const [evidenceUrl, setEvidenceUrl] = useState("")
  const [heldOn, setHeldOn] = useState("")

  /** El número declarado, o el primero si la campaña declara más de uno. */
  const activityOf = (campaign: CampaignRow): string => {
    const catalogId = catalogBindings[campaign.id]?.[0]
    if (catalogId) return catalogId
    const numbers = campaign.pdtpActivityNumbers
    return Array.isArray(numbers) && numbers.length > 0 ? `legacy:${String(numbers[0])}` : ""
  }

  const handleSetActivity = (campaignId: string, value: string) => {
    setError(null)
    startTransition(async () => {
      const res = await setCampaignPdtpActivitiesAction({
        campaignId,
        pdtpActivityNumbers: [],
        catalogActivityIds: [value],
      })
      if (res.ok) router.refresh()
      else setError(res.message ?? "Ocurrió un error")
    })
  }

  const handleMarkDone = () => {
    if (!doneCampaignItem || !evidenceUrl.trim() || !heldOn) return
    setError(null)
    startTransition(async () => {
      const res = await closeCampaignAction({
        campaignId: doneCampaignItem.id,
        heldOn,
        evidenceUrl: evidenceUrl.trim(),
      })
      if (res.ok) {
        setDoneCampaignItem(null)
        setEvidenceUrl("")
        setHeldOn("")
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
        description="Registro histórico. Las campañas del programa 2026 (N°85-89) ya no se crean acá."
        actions={
          <Button asChild variant="secondary">
            <Link href={TRAINING_ROUTE}>Ir a Capacitación</Link>
          </Button>
        }
      />

      <Callout tone="info">
        Esta pantalla dejó de aceptar campañas nuevas: las N°85 a N°89 del programa 2026
        se registran y cierran ahora desde{" "}
        <Link href={TRAINING_ROUTE} className="font-medium underline underline-offset-2">
          Capacitación
        </Link>
        , que es la única vía que acredita el PDTP para esas actividades. Acá se pueden
        seguir cerrando las campañas que ya estaban pendientes antes de este cambio.
      </Callout>

      {error && (
        <div className="p-3 text-sm text-[var(--color-danger-ink)] bg-[var(--color-danger-tint)] rounded-md border border-[var(--color-danger-border)]">
          {error}
        </div>
      )}

      {initialCampaigns.length === 0 ? (
        <EmptyState
          title="Sin campañas pendientes en esta faena"
          description="Las campañas del programa 2026 (N°85 a N°89) se registran y cierran desde Capacitación."
          action={
            <Button asChild>
              <Link href={TRAINING_ROUTE}>Ir a Capacitación</Link>
            </Button>
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
                        <PdtpActivityPicker label="Actividad" options={catalogActivities} value={activityOf(cmp).startsWith("legacy:") ? "" : activityOf(cmp)} onChange={(value) => handleSetActivity(cmp.id, value)} />
                      ) : (
                        <span className="font-mono text-xs text-[var(--color-text-muted)]">
                          {catalogActivities.find((activity) => activity.id === activityOf(cmp))?.title ?? (activityOf(cmp).replace("legacy:", "N°") || "No vinculada")}
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
            <Field label="Fecha en que se hizo la campaña" htmlFor="campaign-held-on" helper="Es la fecha con la que el PDTP cuenta el cumplimiento, no la de hoy.">
              <DatePicker id="campaign-held-on" ariaLabel="Fecha en que se hizo la campaña" value={heldOn} onChange={setHeldOn} />
            </Field>
            <EvidenceField
              label="Evidencia de difusión (foto, lista de asistencia, acta)"
              helper="Sube el archivo, o pega el enlace si ya vive en Drive/SharePoint."
              uploadUrl="/api/prevencion/campanas/evidence"
              value={evidenceUrl}
              onChange={setEvidenceUrl}
              disabled={isPending}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDoneCampaignItem(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-[var(--color-success-ink)] text-white hover:bg-[var(--color-success-ink)]/90"
              onClick={handleMarkDone}
              disabled={isPending || !evidenceUrl.trim() || !heldOn}
            >
              {isPending ? "Guardando..." : "Confirmar y Acreditar PDTP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
