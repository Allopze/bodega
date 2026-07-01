"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import type { InspectionRun, InspectionItem, BehavioralObservation, InspectionTemplate } from "@/db/schema"
import { updateInspectionItemAction, closeInspectionRunAction } from "../actions"
import { INSPECTION_ITEM_STATUS_LABELS, inspectionItemStatusVariant } from "@/lib/prevention/badges"

const STATUS_OPTIONS = [
  { value: "ok", label: "OK" },
  { value: "no_conforme", label: "No conforme" },
  { value: "critico", label: "Crítico" },
  { value: "na", label: "N/A" },
]

type InspectionDetailProps = {
  data: {
    run: InspectionRun
    template: InspectionTemplate | null
    items: InspectionItem[]
    observations: BehavioralObservation[]
  }
  canManage: boolean
  canClose: boolean
}

export function InspectionDetail({ data, canManage, canClose }: InspectionDetailProps) {
  const router = useRouter()
  const [closing, setClosing] = useState(false)

  const handleClose = async () => {
    setClosing(true)
    try {
      await closeInspectionRunAction(data.run.id)
      router.refresh()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Ítems de inspección</CardTitle>
          {canClose && data.run.status !== "closed" && (
            <Button size="sm" variant="secondary" disabled={closing} onClick={handleClose}>
              Cerrar inspección
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.items.map((item) => (
              <div key={item.id} className="rounded border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{item.itemKey}</p>
                    <p className="text-xs text-muted-foreground">Esperado: {item.expected}</p>
                  </div>
                  <Badge variant={
                    item.status === "critico" ? "danger" :
                    item.status === "no_conforme" ? "warning" :
                    item.status === "pendiente" ? "outline" : "success"
                  }>
                    {item.status === "pendiente" ? "Pendiente" : item.status}
                  </Badge>
                </div>
                {item.observed && <p className="text-sm mt-2">Observado: {item.observed}</p>}
                {item.note && <p className="text-xs text-muted-foreground mt-1">{item.note}</p>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {data.observations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Observaciones conductuales ({data.observations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.observations.map((obs) => (
                <div key={obs.id} className="rounded border p-2">
                  <p className="text-sm">{obs.antecedent} → {obs.behavior} → {obs.consequence}</p>
                  <Badge variant="outline" className="mt-1">{obs.severity}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
