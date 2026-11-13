"use client"

import * as React from "react"
import { QrCode } from "@phosphor-icons/react"
import { PublicFormQrDialog, type PublicFormQrOption } from "@/components/public-access/public-form-qr-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { taeAccessUrl } from "@/lib/combustibles/tae-access-url"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { createTaePublicLinkAction, revokeTaePublicLinkAction, setTaeLoadingPointStorageAction } from "../../tae/actions"
import { loadingPointTypeLabel, type LoadingPointRow, type PublicLinkRow, type StorageOption } from "./point-types"

const NO_STORAGE = "_none"

export function LoadingPointsPanel({ points, links, storageLocations, emptyAction }: {
  points: LoadingPointRow[]
  links: PublicLinkRow[]
  storageLocations: StorageOption[]
  /** El mismo «Nuevo punto de carga» de la cabecera, para el estado vacío. */
  emptyAction?: React.ReactNode
}) {
  const storage = useOperation({ feedback: "toast" })
  // Estanque elegido: se muestra de inmediato; si la acción falla, vuelve al guardado.
  const [storageOverrides, setStorageOverrides] = React.useState<Record<string, string | null>>({})
  const [generating, setGenerating] = React.useState<LoadingPointRow | null>(null)
  const [generated, setGenerated] = React.useState<{ option: PublicFormQrOption; pointName: string } | null>(null)
  const [revoking, setRevoking] = React.useState<PublicLinkRow | null>(null)
  const revoke = useOperation()

  function changeStorage(point: LoadingPointRow, value: string) {
    const next = value === NO_STORAGE ? null : value
    setStorageOverrides((current) => ({ ...current, [point.id]: next }))
    storage.run(
      () => setTaeLoadingPointStorageAction(point.id, next),
      undefined,
      () => setStorageOverrides((current) => { const { [point.id]: _failed, ...rest } = current; return rest }),
    )
  }

  function confirmRevoke() {
    if (!revoking) return
    const target = revoking
    revoke.run(
      () => revokeTaePublicLinkAction(target.id),
      (result) => {
        toast.success(result.message ?? "Enlace revocado")
        setRevoking(null)
      },
    )
  }

  const activeLinks = links.filter((link) => !link.revokedAt)
  const revokedLinks = links.filter((link) => link.revokedAt)

  return (
    <div className="space-y-8">
      {generated ? (
        <Callout tone="success" role="status" title={`QR listo para «${generated.pointName}»`}>
          <div className="flex flex-wrap items-center gap-3">
            <p className="max-w-2xl">Se muestra una sola vez: la plataforma no guarda el enlace, sólo puede revocarlo. Descarga o copia el QR ahora. Si lo pierdes, revoca este enlace y genera otro.</p>
            <PublicFormQrDialog
              title="Acceso para cargar en terreno"
              description="Pega este QR sólo en el punto de carga indicado. El enlace se puede revocar."
              selectorLabel="Punto de carga"
              options={[generated.option]}
              selectedOptionId={generated.option.id}
              onSelectedOptionChange={() => {}}
              hideSelector
              triggerLabel="Ver QR y enlace"
              pdfSubtitle="Formulario de carga en terreno"
              qrAlt={(option) => `Código QR para ${option.label}`}
            />
          </div>
        </Callout>
      ) : null}

      {points.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Aún no hay puntos de carga"
          description="Un punto de carga es el lugar donde se carga combustible: un surtidor fijo, un camión surtidor, el estanque de una camioneta, un bidón o una estación con tarjeta. Cada punto tiene su propio QR. Crea el primero."
          action={emptyAction}
        />
      ) : (
        <TableRoot aria-label="Puntos de carga">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead>Punto de carga</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estanque</TableHead>
                <TableHead className="text-right">Enlaces activos</TableHead>
                <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((point) => {
                const options = storageLocations.filter((location) => location.worksiteId === point.worksiteId)
                const storageId = point.id in storageOverrides ? storageOverrides[point.id] : point.storageLocationId
                return (
                  <TableRow key={point.id}>
                    <TableCell>
                      <span className="font-medium">{point.name}</span>
                      {point.isActive ? null : <Badge variant="neutral" className="ml-2">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">{point.worksiteName}</TableCell>
                    <TableCell>{loadingPointTypeLabel(point.type)}</TableCell>
                    <TableCell>
                      <Select value={storageId ?? NO_STORAGE} onValueChange={(value) => changeStorage(point, value)} disabled={storage.pending}>
                        <SelectTrigger className="w-52" aria-label={`Estanque de ${point.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_STORAGE}>Sin vincular</SelectItem>
                          {options.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {storageId ? null : <span className="mt-1 block max-w-52 text-xs text-[var(--color-text-subtle)]">Sin este enlace, lo que se entrega aquí no se descuenta del saldo de ningún estanque.</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{point.activeLinks}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => setGenerating(point)} disabled={!point.isActive} aria-label={`Generar QR de ${point.name}`}>
                        <QrCode size={15} aria-hidden />Generar QR
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      )}

      <section aria-labelledby="enlaces-emitidos-title" className="space-y-3">
        <div>
          <h2 id="enlaces-emitidos-title" className="text-h3 text-[var(--color-text)]">Enlaces emitidos</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Cada QR abre el formulario en terreno de un punto de carga. Al revocar un enlace, el QR impreso deja de funcionar al instante.
          </p>
        </div>
        {activeLinks.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No hay enlaces vigentes. Genera un QR desde un punto de carga.</p>
        ) : (
          <LinksTable rows={activeLinks} ariaLabel="Enlaces vigentes" onRevoke={setRevoking} />
        )}
        {revokedLinks.length > 0 ? (
          <details className="rounded-xl border border-[var(--color-border)] p-4 [&_summary]:cursor-pointer">
            <summary className="text-sm font-semibold text-[var(--color-text)]">Enlaces revocados ({revokedLinks.length})</summary>
            <div className="mt-3"><LinksTable rows={revokedLinks} ariaLabel="Enlaces revocados" framed={false} /></div>
          </details>
        ) : null}
      </section>

      {generating ? (
        <GenerateQrDialog
          point={generating}
          onClose={() => setGenerating(null)}
          onGenerated={(option) => { setGenerated({ option, pointName: generating.name }); setGenerating(null) }}
        />
      ) : null}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => { if (!next && !revoke.pending) { setRevoking(null); revoke.setMessage("") } }}
        title="Revocar enlace"
        description={revoking
          ? `El QR «${revoking.label}»${revoking.loadingPointName ? ` de ${revoking.loadingPointName}` : ""} dejará de funcionar al instante y no se puede reactivar. Para volver a cargar con ese punto tendrás que generar un QR nuevo e imprimirlo.`
          : ""}
        confirmLabel="Revocar enlace"
        variant="destructive"
        loading={revoke.pending}
        error={revoke.message || undefined}
        onConfirm={confirmRevoke}
      />
    </div>
  )
}

function LinksTable({ rows, ariaLabel, onRevoke, framed = true }: { rows: PublicLinkRow[]; ariaLabel: string; onRevoke?: (link: PublicLinkRow) => void; framed?: boolean }) {
  return (
    <TableRoot framed={framed} aria-label={ariaLabel}>
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>Enlace</TableHead>
            <TableHead>Punto de carga</TableHead>
            <TableHead>Emitido</TableHead>
            <TableHead>{onRevoke ? "Último uso" : "Revocado"}</TableHead>
            {onRevoke ? <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((link) => (
            <TableRow key={link.id}>
              <TableCell className="font-medium">{link.label}</TableCell>
              <TableCell className="text-[var(--color-text-muted)]">{link.worksiteName}{link.loadingPointName ? ` · ${link.loadingPointName}` : ""}</TableCell>
              <TableCell className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDateTime(link.createdAt)}</TableCell>
              <TableCell className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
                {onRevoke ? (link.lastUsedAt ? formatDateTime(link.lastUsedAt) : "Sin uso") : link.revokedAt ? formatDateTime(link.revokedAt) : "—"}
              </TableCell>
              {onRevoke ? (
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost-danger" onClick={() => onRevoke(link)} aria-label={`Revocar el enlace ${link.label}`}>Revocar</Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}

function GenerateQrDialog({ point, onClose, onGenerated }: { point: LoadingPointRow; onClose: () => void; onGenerated: (option: PublicFormQrOption) => void }) {
  const op = useOperation()
  const [label, setLabel] = React.useState("")

  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(
      () => createTaePublicLinkAction({ worksiteId: point.worksiteId, loadingPointId: point.id, label: label.trim() || point.name }),
      (result) => {
        const accessToken = typeof result.data?.accessToken === "string" ? result.data.accessToken : ""
        const id = typeof result.data?.id === "string" ? result.data.id : ""
        if (!accessToken || !id) { toast.error("No se pudo generar el QR"); return }
        onGenerated({
          id,
          label: `${point.worksiteName} · ${point.name}`,
          url: taeAccessUrl(window.location.origin, accessToken),
          pdfTitle: point.worksiteName,
          pdfFileName: `acceso-carga-${id}.pdf`,
        })
        toast.success("Enlace generado. Descarga o copia el QR ahora.")
      },
    )
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generar QR</DialogTitle>
          <DialogDescription>{point.worksiteName} · {point.name}. El QR queda limitado a este punto de carga.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field label="Etiqueta (opcional)" htmlFor="qr-label" helper="Para reconocer este enlace en la lista, p. ej. «Turno noche». Sin etiqueta usa el nombre del punto.">
              <Input id="qr-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={point.name} autoComplete="off" />
            </Field>
            {op.message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{op.message}</p> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={op.pending}>Generar QR</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
