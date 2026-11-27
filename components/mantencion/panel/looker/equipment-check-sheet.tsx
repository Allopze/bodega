"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { plural } from "@/lib/mantencion/format"
import { pendingText, type EquipmentCheckDetail } from "@/lib/services/mantencion/looker/equipment-check-summary"
import { closeSheetHref, sheetHref } from "@/lib/services/mantencion/looker/filter-hrefs"
import { cn, formatDate } from "@/lib/utils"
import { CheckDetailView } from "./check-detail-view"

/**
 * Cuándo se abrió la ficha: si ya hubo una navegación dentro de esta pantalla, la ficha se abrió con un `push` y
 * «atrás» la cierra; si la pantalla cargó con `ficha` en la dirección (un enlace compartido o una recarga), no hay
 * nada atrás a lo que volver y se cierra con `replace`. `FichaSessionMark` (siempre montado en el panel) marca el
 * primer montaje; la ficha lo lee al montarse.
 */
let panelMounted = false

export function FichaSessionMark() {
  React.useEffect(() => {
    panelMounted = true
  }, [])
  return null
}

/**
 * Ficha de un equipo en Preventivo: qué se hizo y qué no. El estado vive en la dirección (`ficha`, `pauta`): abrirla
 * es un `push`, elegir otra pauta un `replace`, y cerrarla vuelve atrás (`router.back()`) o, si se cargó con la ficha
 * abierta, quita sus parámetros. Un modal centrado de alto fijo (`stableHeight`: la caja no cambia de alto al pasar
 * de una pauta a otra); la tira de pautas no scrollea, sólo el panel.
 */
export function EquipmentCheckSheet({
  vehicleId,
  detail,
  historyHref,
}: {
  vehicleId: string
  /** `null`: el equipo no existe o no se puede ver. */
  detail: EquipmentCheckDetail | null
  /** Historial del equipo, ya filtrado a preventivas del período del panel. */
  historyHref: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(true)
  const [openedByPush] = React.useState(() => panelMounted)
  const [pending, startTransition] = React.useTransition()
  const selectedId = detail?.selected?.id ?? ""
  const [shownId, setShownId] = React.useOptimistic(selectedId)
  const current = React.useMemo(() => new URLSearchParams(Array.from(searchParams.entries())), [searchParams])

  function close() {
    setOpen(false)
    if (openedByPush) router.back()
    else router.replace(closeSheetHref(pathname, current), { scroll: false })
  }

  function choose(checkId: string) {
    startTransition(() => {
      setShownId(checkId)
      router.replace(sheetHref(pathname, current, vehicleId, checkId), { scroll: false })
    })
  }

  const vehicle = detail?.vehicle
  const name = vehicle ? vehicle.plate || vehicle.code || "Equipo" : "Equipo"
  const subtitle = vehicle ? [vehicle.plate ? vehicle.code : null, vehicle.typeName, vehicle.worksiteName].filter(Boolean).join(" · ") : ""
  const selected = detail?.selected ?? null
  const totalNotDone = detail?.checks.reduce((sum, check) => sum + check.notDone, 0) ?? 0

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) close() }}>
      <SheetContent stableHeight className="sm:max-w-3xl" aria-busy={pending || undefined}>
        <SheetHeader>
          <div className="min-w-0">
            <SheetTitle className="font-mono">{detail ? name : "Equipo no disponible"}</SheetTitle>
            <SheetDescription>
              {detail ? (subtitle || "Pautas preventivas del período") : "No se encontró el equipo o no tienes acceso a sus pautas."}
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>

        {detail && (
          <>
            <section aria-labelledby="ficha-pendiente" className="shrink-0 border-b border-[var(--color-border)] px-6 py-3">
              <h3 id="ficha-pendiente" className="text-eyebrow text-[var(--color-text)]">Pendiente en el período</h3>
              {detail.pending.length > 0 ? (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto" tabIndex={0} aria-label="Ítems pendientes">
                  {detail.pending.map((item) => (
                    <li key={item.name} className="text-sm text-[var(--color-text)]">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-[var(--color-text-muted)]"> · {item.system ?? "Sin sistema"} · </span>
                      <span className="text-[var(--color-signal-ink)]">{pendingText(item)}</span>
                    </li>
                  ))}
                </ul>
              ) : totalNotDone > 0 ? (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Hay {plural(totalNotDone, "ítem sin hacer", "ítems sin hacer")}, pero los formularios no traen su detalle.
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--color-success-ink)]">Todo se hizo en las pautas del período.</p>
              )}
            </section>

            {selected ? (
              <Tabs value={shownId} onValueChange={choose} className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 px-6 pt-3">
                  <TabsList aria-label={`Pautas del período de ${name}, la más reciente primero`} className="w-full">
                    {detail.checks.map((check) => (
                      <TabsTrigger key={check.id} value={check.id} className="flex-col items-start gap-0 px-3 py-1.5 text-left">
                        <span className="font-mono text-xs">{formatDate(check.date)} · {check.level}</span>
                        <span className={cn("text-2xs font-normal", check.notDone > 0 ? "text-[var(--color-signal-ink)]" : "text-[var(--color-text-muted)]")}>
                          {check.notDone} sin hacer
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                <TabsContent value={shownId} className={cn("mt-0 min-h-0 flex-1 overflow-y-auto px-6 py-4 transition-opacity", pending && "opacity-60")}>
                  <CheckDetailView detail={selected} equipment={name} />
                </TabsContent>
              </Tabs>
            ) : (
              <SheetBody>
                <p className="text-sm text-[var(--color-text-muted)]">Este equipo no tiene pautas preventivas en el período del panel.</p>
              </SheetBody>
            )}

            <SheetFooter className="justify-between">
              {historyHref ? (
                <Button asChild variant="secondary" size="sm"><Link href={historyHref}>Historial del equipo</Link></Button>
              ) : <span />}
              {selected?.recordId && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/mantencion/registros/${selected.recordId}`}>Ver el registro {selected.folio ?? ""}</Link>
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
