"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react"

type InspectionListProps = {
  templates: Array<{ id: string; code: string; title: string; frequency: string }>
  runs: Array<{ id: string; templateId: string; worksiteId: string; startedAt: string; completedAt: string | null; status: string }>
  observations: Array<{ id: string; worksiteId: string; antecedent: string; behavior: string; consequence: string; severity: string }>
  canManage: boolean
}

const STATUS_MAP: Record<string, string> = {
  open: "Abierta",
  in_review: "En revisión",
  closed: "Cerrada",
}

const SEVERITY_MAP: Record<string, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
  critico: "Crítico",
}

export function InspectionList({ templates, runs, observations, canManage }: InspectionListProps) {
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Inspecciones ({runs.length})</CardTitle>
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => router.push("/prevencion/inspecciones/nueva")}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Nueva
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">Sin inspecciones registradas.</p>
            ) : (
              <div className="space-y-2">
                {runs.slice(0, 10).map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded border p-2 cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/prevencion/inspecciones/${run.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium truncate max-w-[300px]">{run.id}</p>
                      <p className="text-xs text-muted-foreground">{run.worksiteId} · {run.startedAt?.slice(0, 10)}</p>
                    </div>
                    <Badge variant={run.status === "open" ? "primary" : run.status === "closed" ? "outline" : "warning"}>
                      {STATUS_MAP[run.status] ?? run.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Observaciones conductuales ({observations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {observations.length === 0 ? (
              <p className="text-muted-foreground text-sm">Sin observaciones registradas.</p>
            ) : (
              <div className="space-y-2">
                {observations.slice(0, 10).map((obs) => (
                  <div key={obs.id} className="rounded border p-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium truncate max-w-[250px]">{obs.antecedent}</p>
                      <Badge variant={obs.severity === "critico" ? "danger" : "outline"}>{SEVERITY_MAP[obs.severity] ?? obs.severity}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{obs.behavior} → {obs.consequence}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Plantillas ({templates.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3">
            {templates.map((tpl) => (
              <div key={tpl.id} className="rounded border p-3">
                <p className="text-sm font-medium">{tpl.title}</p>
                <p className="text-xs text-muted-foreground">{tpl.code} · {tpl.frequency}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
