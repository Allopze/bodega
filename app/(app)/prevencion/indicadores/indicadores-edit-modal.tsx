"use client"

import { useState, useTransition } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { calcRates, type IndicatorCounters } from "@/lib/prevention/safety-indicators-calc"
import { saveSafetyIndicatorMonthAction } from "./actions"
import { toast } from "@/lib/toast"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

const FIELDS: Array<{ key: keyof IndicatorCounters; label: string }> = [
  { key: "trabajadores", label: "Cant. Trabajadores" },
  { key: "horasHombre", label: "Horas Hombre" },
  { key: "accConTiempoPerdido", label: "Acc. con Tiempo Perdido" },
  { key: "accSinTiempoPerdido", label: "Acc. sin Tiempo Perdido" },
  { key: "diasPerdidos", label: "Días Perdidos" },
  { key: "incidentes", label: "Nº Incidentes" },
  { key: "danoMaterial", label: "Inc. Daño Material" },
  { key: "danoAmbiental", label: "Inc. Daño Ambiental" },
]

export function IndicadoresEditModal({
  worksiteId,
  year,
  month,
  initial,
  onClose,
}: {
  worksiteId: string
  year: number
  month: number
  initial: IndicatorCounters
  onClose: () => void
}) {
  const [values, setValues] = useState<IndicatorCounters>(initial)
  const [pending, startTransition] = useTransition()
  const rates = calcRates(values)

  function setField(key: keyof IndicatorCounters, raw: string) {
    const n = raw === "" ? 0 : Number(raw)
    setValues((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : 0 }))
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveSafetyIndicatorMonthAction({ worksiteId, year, month, ...values })
      if (result.ok) {
        toast.success(`Datos de ${MONTHS[month - 1]} guardados`)
        onClose()
      } else {
        toast.error(result.message ?? "Error al guardar")
      }
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{MONTHS[month - 1]}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[var(--color-text-muted)]" htmlFor={`field-${key}`}>{label}</label>
              <Input
                id={`field-${key}`}
                type="number"
                min={0}
                step={key === "horasHombre" ? "0.01" : "1"}
                value={values[key] || ""}
                placeholder="0"
                onChange={(e) => setField(key, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--color-border)] pt-4 text-center">
          <div>
            <p className="text-[10px] font-medium uppercase text-[var(--color-text-subtle)]">Tasa Frecuencia</p>
            <p className="text-lg font-semibold text-[var(--color-text)]">{rates.tasaFrecuencia.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase text-[var(--color-text-subtle)]">Tasa Gravedad</p>
            <p className="text-lg font-semibold text-[var(--color-text)]">{rates.tasaGravedad.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase text-[var(--color-text-subtle)]">Total Accidentes</p>
            <p className="text-lg font-semibold text-[var(--color-text)]">{rates.totalAccidentes}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={pending}>{pending ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
