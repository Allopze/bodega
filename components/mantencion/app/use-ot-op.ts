"use client"

import { useCallback, useState } from "react"
import { workOrderOpSchema, type WorkOrderOpPayload } from "@/lib/mantencion/contracts"
import { StorageFullError } from "@/lib/mantencion/client/db"
import type { OtView } from "@/lib/mantencion/client/ot-model"
import { enqueueSimple, newWorkOrderItem } from "@/lib/mantencion/client/queue"
import { useAppActions, useAppData } from "./app-context"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** Lo propio de la operación; el id, la OT, la hora y el dispositivo los pone el hook. */
export type OtOpBody = DistributiveOmit<WorkOrderOpPayload, "id" | "workOrderId" | "createdAt" | "deviceId">

/**
 * Guarda una operación sobre una OT en la cola del teléfono (se envía sola, con
 * o sin señal) y avisa. La valida con el MISMO esquema del servidor antes de
 * encolar: lo que no pasa aquí no se guarda como «pendiente» para que el
 * servidor lo rechace horas después.
 */
export function useOtOp(view: OtView) {
  const { account, deviceId, online } = useAppData()
  const { syncNow, toast } = useAppActions()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async (body: OtOpBody, done: string): Promise<boolean> => {
    setError(null)
    const parsed = workOrderOpSchema.safeParse({ ...body, id: crypto.randomUUID(), workOrderId: view.ot.id, createdAt: new Date().toISOString(), deviceId })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Revisa los datos."); return false }
    setSaving(true)
    try {
      await enqueueSimple(newWorkOrderItem({
        authorUserId: account.userId,
        payload: parsed.data,
        summary: { workOrderId: view.ot.id, folio: view.ot.folio, equipmentCode: view.ot.equipmentCode, equipmentPlate: view.ot.equipmentPlate },
      }))
      toast(online ? `${done} Enviando a la plataforma…` : `${done} Guardado en el teléfono.`)
      syncNow()
      return true
    } catch (cause) {
      setError(cause instanceof StorageFullError ? cause.message : "No pudimos guardarlo. Intenta de nuevo.")
      return false
    } finally {
      setSaving(false)
    }
  }, [account.userId, deviceId, online, syncNow, toast, view.ot.id, view.ot.folio, view.ot.equipmentCode, view.ot.equipmentPlate])

  return { submit, saving, error, setError }
}
