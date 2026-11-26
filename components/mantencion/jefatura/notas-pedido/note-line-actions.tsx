"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { rejectNoteItemAction, resolveNoteItemFromStockAction } from "@/app/(app)/mantencion/notas-pedido/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useOperation } from "@/lib/hooks/use-operation"
import type { PartsNoteDetailLine } from "@/lib/services/mantencion/parts/types"
import { toast } from "@/lib/toast"
import { formatQty } from "@/lib/utils"
import { NoteReasonDialog } from "./note-reason-dialog"
import { parseQty, qtyInputText } from "./parts-notes-format"

/** Sacar de la bodega: cuánto hay libre en la faena de la OT, cuánto sacar y confirmar. */
function TakeFromStockDialog({ noteId, line, worksiteName, onOpenChange }: {
  noteId: string
  line: PartsNoteDetailLine
  worksiteName: string
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const op = useOperation()
  const free = line.freeInWorksite ?? 0
  const max = Math.min(line.quantity, free)
  const [quantity, setQuantity] = React.useState(qtyInputText(max))
  const parsed = parseQty(quantity)
  const tooMuch = parsed > max
  const valid = max > 0 && parsed > 0 && !tooMuch
  const name = line.productName ?? line.description

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || !line.productId) return
    const productId = line.productId
    op.run(
      () => resolveNoteItemFromStockAction({ noteId, itemId: line.id, productId, quantity: parsed }),
      (result) => {
        toast.success(result.message ?? "Línea resuelta desde la bodega")
        onOpenChange(false)
        router.refresh()
      },
      (result) => { if (/otra persona|otra sesi[oó]n|ya no/i.test(result.message ?? "")) router.refresh() },
    )
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Sacar de bodega</DialogTitle>
            <DialogDescription>{name}: queda reservado para esta orden de trabajo y el mecánico lo ve disponible.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p role="status" className={free > 0 ? "text-sm font-semibold text-[var(--color-text)]" : "text-sm font-semibold text-[var(--color-warning-ink)]"}>
              {formatQty(free)} libres en {worksiteName}
            </p>
            {free <= 0 && <p className="text-sm text-[var(--color-text-muted)]">No hay stock libre de este repuesto en la faena: cómpralo o espera a que llegue.</p>}
            <Field
              label="Cantidad a sacar"
              htmlFor="np-take-quantity"
              required
              helper={`Pediste ${formatQty(line.quantity)}${max < line.quantity && free > 0 ? `; el tope es lo libre (${formatQty(free)}).` : "."}`}
              error={tooMuch ? `Puedes sacar hasta ${formatQty(max)}.` : undefined}
            >
              <Input id="np-take-quantity" inputMode="decimal" value={quantity} disabled={free <= 0} onChange={(event) => setQuantity(event.target.value)} />
            </Field>
          </div>
          {op.message && <p role="alert" className="mt-2 text-sm text-[var(--color-danger-ink)]">{op.message}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={op.pending}>Cancelar</Button>
            <Button type="submit" loading={op.pending} disabled={!valid}>Sacar de bodega</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Las tres salidas de una línea pendiente: «Sacar de bodega», «Comprar» (abre la solicitud de repuestos con la
 * nota precargada) y «Rechazar» (con motivo). Sólo se dibuja para quien administra la nota y mientras la línea
 * siga pendiente; el servidor vuelve a validar permiso, alcance y estado en cada acción.
 */
export function NoteLineActions({ noteId, line, worksiteName, buyHref }: {
  noteId: string
  line: PartsNoteDetailLine
  worksiteName: string
  /** `/solicitudes/nueva?tipo=repuestos&np=<id>`; `null` si quien mira no puede crear solicitudes de repuestos. */
  buyHref: string | null
}) {
  const [dialog, setDialog] = React.useState<"take" | "reject" | null>(null)
  const canTake = line.productId !== null
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={!canTake} onClick={() => setDialog("take")}>Sacar de bodega</Button>
        {buyHref && <Button asChild variant="secondary" size="sm"><Link href={buyHref}>Comprar</Link></Button>}
        <Button type="button" variant="ghost-danger" size="sm" onClick={() => setDialog("reject")}>Rechazar</Button>
      </div>
      {!canTake && <p className="text-xs text-[var(--color-text-muted)]">Este repuesto no está en el catálogo: no hay stock que sacar. Se puede comprar o rechazar.</p>}
      {dialog === "take" && <TakeFromStockDialog noteId={noteId} line={line} worksiteName={worksiteName} onOpenChange={(open) => { if (!open) setDialog(null) }} />}
      {dialog === "reject" && (
        <NoteReasonDialog
          onOpenChange={(open) => { if (!open) setDialog(null) }}
          title="Rechazar la línea"
          description={`${line.description}: el mecánico verá tu motivo y la línea no se compra ni se saca de la bodega.`}
          submitLabel="Rechazar"
          destructive
          action={(reason) => rejectNoteItemAction({ noteId, itemId: line.id, reason })}
          successMessage="Línea rechazada"
        />
      )}
    </div>
  )
}
