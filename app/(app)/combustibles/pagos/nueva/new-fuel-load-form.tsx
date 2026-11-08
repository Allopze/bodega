"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createFuelLoadAction } from "../../actions"
import type { ActionState } from "@/lib/validation/masters"
import { calculateFuelAmounts } from "@/lib/combustibles/calculations"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { formatCLP } from "@/lib/utils"
import { SERVICE_TYPE_LABELS } from "../invoice-params"

interface NewFuelLoadData {
  /** `label` es «CM-11 · AA-BB-11» (o sólo la patente); `hint`, el tipo de equipo. */
  vehicles: ComboboxOption[]
  suppliers: Array<{ id: string; name: string }>
  worksites: Array<{ id: string; name: string }>
}

const PRODUCTS = [
  { value: "PETROLEO DIESEL", label: "Petróleo diésel" },
  { value: "BLUEMAX", label: "BlueMax" },
]

/**
 * Alta de una carga facturada. Los montos salen de los litros y el neto con las
 * mismas tasas de IEC que usa el servidor (`autoCalc`), así que lo que se ve
 * aquí es lo que se guarda. Al guardar, la acción redirige a «Pagos › Facturas».
 */
export function NewFuelLoadForm({ data, rates }: { data: NewFuelLoadData; rates: { iecFixedRate: number | null; iecVariableRate: number | null } }) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createFuelLoadAction, { ok: false, message: "" })
  const [vehicleId, setVehicleId] = useState("")

  const [litersText, setLitersText] = useState("")
  const [baseText, setBaseText] = useState("")
  // Derivado en render: los montos son función pura de litros y neto, así que los
  // inputs ocultos que viajan al servidor salen correctos en el primer render. Las
  // tasas de IEC vienen del servidor (las mismas que `actions-module/loads.ts`
  // lee de system_settings con autoCalc).
  const { iecFixed, iecVariable, iecTotal, ivaAmount, totalAmount } = calculateFuelAmounts({
    liters: Number(litersText) || 0,
    baseAmount: Number(baseText) || 0,
    iecFixedRate: rates.iecFixedRate,
    iecVariableRate: rates.iecVariableRate,
  })

  // En éxito, createFuelLoadAction redirige desde el servidor: este efecto sólo
  // muestra los errores (nunca llega a observar `ok: true`).
  useEffect(() => {
    if (state.message && !state.ok) toast.error(state.message)
  }, [state])

  const err = (field: string) => state.fieldErrors?.[field]?.[0]

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="autoCalc" value="true" />
      <input type="hidden" name="iecFixed" value={iecFixed} />
      <input type="hidden" name="iecVariable" value={iecVariable} />
      <input type="hidden" name="iecTotal" value={iecTotal} />
      <input type="hidden" name="ivaAmount" value={ivaAmount} />
      <input type="hidden" name="totalAmount" value={totalAmount} />
      <input type="hidden" name="vehicleId" value={vehicleId} />

      <Card>
        <CardHeader><CardTitle as="h2">Datos de la carga</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Fecha" htmlFor="loadDate" required error={err("loadDate")}>
            <DatePicker id="loadDate" name="loadDate" error={Boolean(err("loadDate"))} />
          </Field>

          <Field
            label="Tipo de tarjeta"
            htmlFor="serviceType"
            required
            error={err("serviceType")}
            helper="De equipos: el equipo carga con su tarjeta. De abastecimiento: carga un estanque que reparte en faena."
          >
            <OptionSelect
              id="serviceType"
              name="serviceType"
              placeholder="Seleccionar"
              options={Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              error={Boolean(err("serviceType"))}
            />
          </Field>

          <Field label="Equipo" htmlFor="vehicleCombobox" required error={err("vehicleId")}>
            <Combobox
              id="vehicleCombobox"
              options={data.vehicles}
              value={vehicleId}
              onChange={setVehicleId}
              placeholder="Buscar por patente o código"
            />
          </Field>

          <Field label="Proveedor" htmlFor="fuelSupplierId" required error={err("fuelSupplierId")}>
            <OptionSelect
              id="fuelSupplierId"
              name="fuelSupplierId"
              placeholder="Seleccionar"
              options={data.suppliers.map((s) => ({ value: s.id, label: s.name }))}
              error={Boolean(err("fuelSupplierId"))}
            />
          </Field>

          <Field label="Faena" htmlFor="worksiteId" required error={err("worksiteId")}>
            <OptionSelect
              id="worksiteId"
              name="worksiteId"
              placeholder="Seleccionar"
              options={data.worksites.map((w) => ({ value: w.id, label: w.name }))}
              error={Boolean(err("worksiteId"))}
            />
          </Field>

          <Field label="Producto" htmlFor="product" required error={err("product")}>
            <OptionSelect id="product" name="product" placeholder="Seleccionar" options={PRODUCTS} error={Boolean(err("product"))} />
          </Field>

          <Field label="N.º de factura o boleta" htmlFor="receiptNumber">
            <Input id="receiptNumber" name="receiptNumber" />
          </Field>

          <Field label="Kilometraje" htmlFor="odometerReading" error={err("odometerReading")}>
            <Input id="odometerReading" name="odometerReading" type="number" step="0.01" min="0" inputMode="decimal" />
          </Field>

          <Field label="Horómetro" htmlFor="hourMeterReading" error={err("hourMeterReading")}>
            <Input id="hourMeterReading" name="hourMeterReading" type="number" step="0.01" min="0" inputMode="decimal" />
          </Field>

          {/*
            COM-002 (auditoría 2026-09-14): la casilla apagaba la validación de
            regresión y no quedaba registrada en ninguna parte, así que la
            carga aparecía después como una lectura normal y nadie podía saber
            que la serie del equipo estaba partida. Ahora la declaración exige
            motivo y se guarda con la carga.
          */}
          <div className="space-y-2 md:col-span-2 lg:col-span-3">
            <Checkbox name="meterReplaced" value="1" label="El medidor fue reemplazado o reiniciado" />
            <p className="text-xs text-[var(--color-text-muted)]">
              Márcalo sólo si el equipo estrenó medidor. Sin esto, una lectura menor que la anterior se rechaza como error de tipeo. Queda registrado en la carga con tu explicación.
            </p>
            <Field label="Motivo del reemplazo" htmlFor="meterReplacementReason" error={err("meterReplacementReason")}>
              <Textarea
                id="meterReplacementReason"
                name="meterReplacementReason"
                rows={2}
                placeholder="Qué pasó con el medidor y quién lo constató (mínimo 10 caracteres)"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle as="h2">Montos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Litros" htmlFor="liters" required error={err("liters")}>
              <Input id="liters" name="liters" type="number" step="0.01" min="0" inputMode="decimal" required value={litersText} onChange={(e) => setLitersText(e.target.value)} />
            </Field>

            <Field label="Neto (base afecta, en pesos)" htmlFor="baseAmount" required error={err("baseAmount")}>
              <Input id="baseAmount" name="baseAmount" type="number" step="0.01" min="0" inputMode="decimal" required value={baseText} onChange={(e) => setBaseText(e.target.value)} />
            </Field>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] p-4 text-sm md:grid-cols-4">
            <div><dt className="text-xs text-[var(--color-text-subtle)]">IEC fijo</dt><dd className="font-mono tabular-nums">{formatCLP(iecFixed)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-subtle)]">IEC variable</dt><dd className="font-mono tabular-nums">{formatCLP(iecVariable)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-subtle)]">IVA (19 %)</dt><dd className="font-mono tabular-nums">{formatCLP(ivaAmount)}</dd></div>
            <div><dt className="text-xs font-semibold text-[var(--color-text)]">Total</dt><dd className="font-mono text-base font-semibold tabular-nums">{formatCLP(totalAmount)}</dd></div>
          </dl>
          <p className="text-xs text-[var(--color-text-muted)]">
            El IEC (impuesto específico a los combustibles) y el IVA se calculan solos con los litros y el neto.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle as="h2">Notas</CardTitle></CardHeader>
        <CardContent>
          <Field label="Observaciones" htmlFor="notes" hint="Opcional">
            <Textarea id="notes" name="notes" rows={3} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={isPending}>{isPending ? "Guardando…" : "Registrar factura"}</Button>
      </div>
    </form>
  )
}
