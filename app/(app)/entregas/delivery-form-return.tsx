"use client"

import type { DeliveryReturnProductOption } from "./delivery-form.types"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

interface DeliveryFormReturnProps {
  showReturn: boolean
  returnProductId: string
  setReturnProductId: (value: string) => void
  returnProducts?: DeliveryReturnProductOption[]
  returnSectionRef: React.RefObject<HTMLDivElement | null>
}

export function DeliveryFormReturn({
  showReturn,
  returnProductId,
  setReturnProductId,
  returnProducts,
  returnSectionRef,
}: DeliveryFormReturnProps) {
  return (
    <div
      ref={returnSectionRef}
      className={[
        "flex flex-col gap-4 overflow-hidden transition-all duration-300 ease-[var(--ease-out)]",
        showReturn
          ? "max-h-[2000px] opacity-100 lg:animate-in lg:fade-in-0 lg:slide-in-from-right-4"
          : "max-h-0 opacity-0 pointer-events-none",
      ].join(" ")}
    >
      <div className="hidden lg:block">
        <h2 className="text-base font-semibold text-(--color-text)">Devolver EPP antiguo</h2>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Registra la devolución del EPP antiguo del trabajador.
        </p>
      </div>

      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 flex flex-col gap-4">
        <p className="text-sm font-medium text-[var(--color-text)]">Datos del EPP devuelto</p>

        <Field label="Producto (catálogo)" htmlFor="returnProductId">
          <Select searchable value={returnProductId} onValueChange={setReturnProductId}>
            <SelectTrigger id="returnProductId">
              <SelectValue placeholder="Selecciona producto devuelto" />
            </SelectTrigger>
            <SelectContent>
              {(returnProducts ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.sku ? `${p.sku} · ` : ""}{p.name} · {p.unitOfMeasure}
                </SelectItem>
              ))}
              {(!returnProducts || returnProducts.length === 0) && (
                <SelectItem value="__none__" disabled>Sin productos disponibles</SelectItem>
              )}
            </SelectContent>
          </Select>
          <input type="hidden" name="returnProductId" value={returnProductId} />
        </Field>

        <Field label="O descríbelo" htmlFor="returnProductNameFree" helper="Si no está en el catálogo">
          <Input
            id="returnProductNameFree"
            name="returnProductNameFree"
            placeholder="Ej: Casco de seguridad marca X"
            disabled={!!returnProductId}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Cantidad" htmlFor="returnQuantity">
            <Input
              id="returnQuantity"
              name="returnQuantity"
              type="number"
              min="0.01"
              step="0.01"
              className="tabular-nums"
            />
          </Field>

          <Field label="Motivo" htmlFor="returnReason">
            <Select name="returnReason">
              <SelectTrigger id="returnReason">
                <SelectValue placeholder="Selecciona motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desgastado">Desgastado</SelectItem>
                <SelectItem value="dañado">Dañado</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Notas" htmlFor="returnNotes">
          <Textarea
            id="returnNotes"
            name="returnNotes"
            rows={2}
            placeholder="Condición del EPP devuelto, observaciones..."
          />
        </Field>
      </div>
    </div>
  )
}
