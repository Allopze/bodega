"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { updateTaeMeterReadingAction } from "../actions"

export function MeterCorrectionDialog({
  submissionId,
  currentMeterType,
  currentMeterReading,
  suggestedMeterReading,
  currentStatus,
}: {
  submissionId: string
  currentMeterType: string
  currentMeterReading: number | null
  suggestedMeterReading: number | null
  currentStatus: "submitted" | "observed" | "validated" | "voided"
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [meterType, setMeterType] = React.useState(() => currentMeterType)
  const [meterReading, setMeterReading] = React.useState(() => currentMeterReading != null ? String(currentMeterReading) : suggestedMeterReading != null ? String(suggestedMeterReading) : "")
  const [reason, setReason] = React.useState("")

  function handleSubmit() {
    const value = Number(meterReading)
    if (isNaN(value) || value < 0) {
      toast.error("Ingresa una lectura válida")
      return
    }
    if (!reason.trim()) {
      toast.error("Indica el motivo de la corrección")
      return
    }
    startTransition(async () => {
      const result = await updateTaeMeterReadingAction({
        id: submissionId,
        expectedStatus: currentStatus,
        meterReading: value,
        meterType: meterType as "odometer" | "hour_meter",
        reason: reason.trim(),
      })
      if (result.ok) {
        toast.success(result.message ?? "Lectura actualizada")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={currentStatus === "voided"}>Corregir lectura</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corregir lectura del medidor</DialogTitle>
          <DialogDescription>
            Confirma o corrige la lectura y deja el motivo. Si existe una sugerencia OCR, no se aplica hasta guardar esta confirmación.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="corr-meter-type">Tipo de lectura</Label>
            <Select value={meterType} onValueChange={setMeterType}>
              <SelectTrigger id="corr-meter-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="odometer">Odómetro</SelectItem>
                <SelectItem value="hour_meter">Horómetro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="corr-meter-reading">Lectura</Label>
            <Input
              id="corr-meter-reading"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={meterReading}
              onChange={(e) => setMeterReading(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="corr-reason">Motivo</Label>
            <Textarea
              id="corr-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: el OCR leyó mal el dígito, la foto estaba borrosa..."
              rows={3}
            />
          </div>
          <Button onClick={handleSubmit} disabled={pending} className="w-full">
            {pending ? "Guardando..." : "Guardar corrección"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
