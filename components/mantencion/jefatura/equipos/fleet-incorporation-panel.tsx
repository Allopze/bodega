"use client"

import * as React from "react"
import Link from "next/link"
import { Truck } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import { plural, unitName } from "@/lib/mantencion/format"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import type { IncorporationCandidate, IncorporationResult } from "@/lib/services/mantencion/fleet-incorporation"
import { incorporateFleetAction } from "@/app/(app)/mantencion/equipos/actions"

interface Draft { brandId: string; scheduleId: string; reading: string; date: string }

const UNIT_SHORT: Record<MantUnit, string> = { km: "km", h: "h" }

/**
 * «Incorporar desde la flota»: la flota ya tiene código, patente, tipo y faena
 * de cada vehículo; aquí sólo se completa lo de Mantención. Esos cuatro datos
 * se muestran como texto, no como campos: no se cambian desde esta pantalla.
 * La búsqueda de la barra superior filtra la tabla (una sola tabla en la página).
 */
export function FleetIncorporationPanel({ candidates, brands, schedules, today }: {
  candidates: IncorporationCandidate[]
  brands: Array<{ id: string; name: string }>
  schedules: Array<{ id: string; name: string; unit: MantUnit }>
  today: string
}) {
  const { searchQuery } = useSafeShellHeader()
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() => Object.fromEntries(candidates.map((item) => [item.vehicleId, {
    brandId: item.suggestedBrandId ?? "", scheduleId: item.suggestedScheduleId ?? "", reading: "", date: "",
  }])))
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [worksiteId, setWorksiteId] = React.useState("")
  const op = useOperation({ feedback: "toast" })

  // Lo incorporado desaparece al revalidar: se olvida su selección y sus errores.
  React.useEffect(() => {
    const alive = new Set(candidates.map((item) => item.vehicleId))
    setSelected((current) => new Set([...current].filter((id) => alive.has(id))))
    setDrafts((current) => {
      const next = { ...current }
      for (const item of candidates) {
        next[item.vehicleId] ??= { brandId: item.suggestedBrandId ?? "", scheduleId: item.suggestedScheduleId ?? "", reading: "", date: "" }
      }
      return next
    })
  }, [candidates])

  const worksites = React.useMemo(
    () => [...new Map(candidates.map((item) => [item.worksiteId, item.worksiteName])).entries()].map(([value, label]) => ({ value, label })),
    [candidates],
  )
  const visible = React.useMemo(() => {
    const needle = nameKey(searchQuery)
    return candidates.filter((item) =>
      (!worksiteId || item.worksiteId === worksiteId)
      && (!needle || nameKey(`${item.code ?? ""} ${item.plate} ${item.typeName} ${item.fleetBrand ?? ""}`).includes(needle)))
  }, [candidates, searchQuery, worksiteId])
  const selectable = visible.filter((item) => !item.blocker)
  const allVisibleSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.vehicleId))
  const someVisibleSelected = selectable.some((item) => selected.has(item.vehicleId))
  const blocked = candidates.filter((item) => item.blocker).length
  const brandOptions = brands.map((brand) => ({ value: brand.id, label: brand.name }))
  // «Sin pauta» es el valor vacío: lo pinta `emptyLabel` (Radix no admite una opción con valor "").
  const scheduleOptions = (unit: MantUnit) => schedules
    .filter((schedule) => schedule.unit === unit)
    .map((schedule) => ({ value: schedule.id, label: schedule.name }))
  const selectedUnits = new Set(candidates.filter((item) => selected.has(item.vehicleId)).map((item) => item.unit))

  const selectAllRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected
  }, [someVisibleSelected, allVisibleSelected])

  function patch(vehicleId: string, change: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [vehicleId]: { ...current[vehicleId]!, ...change } }))
    setErrors((current) => (current[vehicleId] ? { ...current, [vehicleId]: [] } : current))
  }
  function toggle(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })
  }
  /** Marca o pauta para todos los marcados; una pauta sólo cae en los equipos de su unidad. */
  function applyToSelected(change: { brandId?: string; scheduleId?: string; unit?: MantUnit }) {
    setDrafts((current) => {
      const next = { ...current }
      for (const item of candidates) {
        if (!selected.has(item.vehicleId)) continue
        if (change.brandId !== undefined) next[item.vehicleId] = { ...next[item.vehicleId]!, brandId: change.brandId }
        if (change.scheduleId !== undefined && item.unit === change.unit) next[item.vehicleId] = { ...next[item.vehicleId]!, scheduleId: change.scheduleId }
      }
      return next
    })
  }

  function submit() {
    const chosen = candidates.filter((item) => selected.has(item.vehicleId) && !item.blocker)
    const missing = chosen.filter((item) => !drafts[item.vehicleId]?.brandId)
    if (missing.length) {
      setErrors((current) => ({ ...current, ...Object.fromEntries(missing.map((item) => [item.vehicleId, ["Elige la marca."]])) }))
      op.setMessage(`${plural(missing.length, "equipo marcado no tiene", "equipos marcados no tienen")} marca.`, "error")
      return
    }
    op.run(async () => {
      const result = await incorporateFleetAction({
        rows: chosen.map((item) => {
          const draft = drafts[item.vehicleId]!
          return {
            vehicleId: item.vehicleId, brandId: draft.brandId, scheduleId: draft.scheduleId || null,
            initialReading: draft.reading, initialReadingDate: draft.reading.trim() ? draft.date || null : null,
          }
        }),
      })
      if (!result.ok) return { ok: false, message: result.message }
      const data = result.data as IncorporationResult
      setErrors(Object.fromEntries(data.rows.filter((row) => !row.ok).map((row) => [row.vehicleId, row.messages])))
      const failed = data.rows.length - data.incorporated
      return {
        ok: data.incorporated > 0,
        message: failed && !data.incorporated ? `Ningún equipo se incorporó: revisa ${plural(failed, "la fila marcada", "las filas marcadas")}.` : result.message,
      }
    })
  }

  const chosenCount = candidates.filter((item) => selected.has(item.vehicleId) && !item.blocker).length
  const header = (
    <PageHeader
      title="Incorporar desde la flota"
      description="Vehículos de la flota que aún no están en Mantención. Elige su marca y su pauta: código, patente, tipo y faena se quedan como están en la flota."
      breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Equipos", href: "/mantencion/equipos" }, { label: "Incorporar desde la flota" }]}
      actions={candidates.length > 0 ? (
        <Button size="sm" onClick={submit} loading={op.pending} disabled={chosenCount === 0}>
          {chosenCount === 0 ? "Marca los equipos" : `Incorporar ${plural(chosenCount, "equipo", "equipos")}`}
        </Button>
      ) : undefined}
    />
  )

  if (candidates.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Truck size={20} aria-hidden />}
          title="Toda la flota de tus faenas ya está en Mantención"
          description="Cuando se agregue un vehículo con odómetro u horómetro en Vehículos, aparecerá aquí para completarle marca y pauta."
          action={<Button asChild variant="secondary"><Link href="/mantencion/equipos">Ver los equipos</Link></Button>}
        />
      </>
    )
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        {blocked > 0 && (
          <Callout tone="info" title={`${plural(blocked, "vehículo necesita", "vehículos necesitan")} un arreglo en Vehículos antes de incorporarse`}>
            Les falta el código interno o su patente no es válida. Se muestran con el motivo y no se pueden marcar.
          </Callout>
        )}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          {worksites.length > 1 && (
            <OptionSelect aria-label="Filtrar por faena" className="h-9 w-full sm:w-52" emptyLabel="Todas las faenas" options={worksites} value={worksiteId} onValueChange={setWorksiteId} />
          )}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Aplicar a los marcados">
              <span className="font-medium text-[var(--color-text)]">{plural(selected.size, "marcado", "marcados")}:</span>
              <OptionSelect aria-label="Marca para todos los marcados" className="h-9 w-full sm:w-44" placeholder="Marca para todos" options={brandOptions} value="" onValueChange={(value) => applyToSelected({ brandId: value })} />
              {[...selectedUnits].map((unit) => (
                <OptionSelect
                  key={unit} aria-label={`Pauta para los marcados que se miden en ${unitName(unit)}`} className="h-9 w-full sm:w-52"
                  placeholder={selectedUnits.size > 1 ? `Pauta (${unitName(unit)})` : "Pauta para todos"}
                  options={scheduleOptions(unit)} value="" onValueChange={(value) => applyToSelected({ scheduleId: value, unit })}
                />
              ))}
            </div>
          )}
        </div>
        {op.message && op.messageTone === "error" && <Callout tone="danger" role="alert">{op.message}</Callout>}
        <TableRoot aria-label="Vehículos de la flota por incorporar">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    ref={selectAllRef} id="incorporar-todos" labelHidden label="Marcar todos los visibles"
                    checked={allVisibleSelected} disabled={selectable.length === 0}
                    onChange={(event) => toggle(selectable.map((item) => item.vehicleId), event.target.checked)}
                  />
                </TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Tipo y faena</TableHead>
                <TableHead className="min-w-44">Marca</TableHead>
                <TableHead className="min-w-52">Pauta</TableHead>
                <TableHead className="min-w-36">Lectura actual</TableHead>
                <TableHead className="min-w-40">Fecha de la lectura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-[var(--color-text-muted)]">Ningún vehículo coincide con la búsqueda o la faena elegida.</TableCell>
                </TableRow>
              )}
              {visible.map((item) => {
                const draft = drafts[item.vehicleId] ?? { brandId: "", scheduleId: "", reading: "", date: "" }
                const rowErrors = errors[item.vehicleId] ?? []
                const label = item.code ?? item.plate
                return (
                  <TableRow key={item.vehicleId} className={rowErrors.length ? "bg-[var(--color-danger-tint)]/40" : undefined}>
                    <TableCell className="align-top">
                      <Checkbox
                        id={`incorporar-${item.vehicleId}`} labelHidden label={`Incorporar ${label}`}
                        checked={selected.has(item.vehicleId)} disabled={!!item.blocker}
                        onChange={(event) => toggle([item.vehicleId], event.target.checked)}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="whitespace-nowrap font-mono text-[13px] font-semibold text-[var(--color-text)]">{item.code ?? "Sin código"}</div>
                      <div className="whitespace-nowrap font-mono text-xs text-[var(--color-text-muted)]">{item.plate}</div>
                      {rowErrors.length > 0 && <p className="mt-1 max-w-56 text-xs text-[var(--color-danger-ink)]">{rowErrors.join(" ")}</p>}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <div className="text-[var(--color-text)]">{item.typeName}</div>
                      <div className="text-[var(--color-text-muted)]">{item.worksiteName}</div>
                    </TableCell>
                    {item.blocker ? (
                      <TableCell colSpan={4} className="align-top text-sm text-[var(--color-warning-ink)]">{item.blocker}</TableCell>
                    ) : (
                      <>
                        <TableCell className="align-top">
                          <OptionSelect
                            aria-label={`Marca de ${label}`} className="h-9 w-full" placeholder="Elige la marca"
                            options={brandOptions} value={draft.brandId} error={rowErrors.length > 0 && !draft.brandId}
                            onValueChange={(value) => patch(item.vehicleId, { brandId: value })}
                          />
                          {item.fleetBrand && !item.suggestedBrandId && (
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">En la flota dice «{item.fleetBrand}».</p>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <OptionSelect
                            aria-label={`Pauta de ${label}`} className="h-9 w-full" emptyLabel="Sin pauta" options={scheduleOptions(item.unit)}
                            value={draft.scheduleId} onValueChange={(value) => patch(item.vehicleId, { scheduleId: value })}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex items-center gap-1.5">
                            <Input
                              aria-label={`Lectura actual de ${label}, en ${unitName(item.unit)}`} inputMode="decimal" className="h-9 w-full tabular-nums"
                              placeholder="Opcional" value={draft.reading} onChange={(event) => patch(item.vehicleId, { reading: event.target.value })}
                            />
                            <span className="text-xs text-[var(--color-text-muted)]">{UNIT_SHORT[item.unit]}</span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <DatePicker
                            ariaLabel={`Fecha de la lectura de ${label}`} className="h-9 w-full" placeholder="Hoy" max={today}
                            value={draft.date} disabled={!draft.reading.trim()} onChange={(value) => patch(item.vehicleId, { date: value })}
                          />
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      </div>
    </>
  )
}
