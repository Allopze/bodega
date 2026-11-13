import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { ConsultaPanelData } from "@/lib/combustibles/panel/data"
import { variationSentence } from "@/lib/combustibles/panel/figures"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS, fuelInboxHref } from "@/lib/combustibles/routes"
import { formatQty } from "@/lib/utils"

/**
 * Panel de consulta: el combustible de las faenas de la persona en tres frases
 * con cifras reales, cada una con su enlace. Sin tiles ni tira de pasos: quien
 * sólo mira necesita saber cuánto se cargó, qué equipos rinden mal y si hay
 * patentes por vincular, no el avance del cierre.
 */

const answer = "text-base leading-relaxed text-[var(--color-text)]"
const link = "inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary-ink)] hover:underline"
const muted = "text-base leading-relaxed text-[var(--color-text-muted)]"

export function ConsultaPanel({
  data,
  period,
  canLinkPlates,
  withPeriod,
}: {
  data: ConsultaPanelData
  period: ResolvedFuelPeriod
  /** Puede vincular patentes (`manage_vehicles`): si no, el enlace sólo las muestra. */
  canLinkPlates: boolean
  withPeriod: (href: string) => string
}) {
  const { figures, worse, measured, unlinkedPlates } = data
  const liters = figures?.liters
  const hasLoads = Boolean(liters && liters.value !== null)

  const codes = worse?.examples.map((example) => example.code) ?? []
  const remaining = worse ? worse.count - codes.length : 0

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        {figures === null ? (
          <p className={muted}>No se pudieron calcular los litros de {period.inLabel}. Reintenta en un momento.</p>
        ) : hasLoads && liters ? (
          <p className={answer}>
            En {period.inLabel} tus faenas cargaron <b className="font-semibold tabular-nums">{liters.value} L</b> en{" "}
            <b>{formatQty(figures.equipmentCount)} {figures.equipmentCount === 1 ? "equipo" : "equipos"}</b>
            {liters.variation ? `, ${variationSentence(liters.variation)}` : ""}.
          </p>
        ) : (
          <p className={muted}>En {period.inLabel} tus faenas todavía no tienen cargas registradas.</p>
        )}
        <div className="mt-3">
          <Link href={withPeriod(FUEL_PATHS.cargas)} className={link}>
            Ver las cargas <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </div>
      </Card>

      <Card className="p-5">
        {worse === null ? (
          <p className={muted}>No se pudo calcular el rendimiento de los equipos. Reintenta en un momento.</p>
        ) : worse.count > 0 ? (
          <p className={answer}>
            {codes.length > 0 ? (
              <>
                {codes.map((code, index) => (
                  <span key={code}>
                    {index > 0 ? (index === codes.length - 1 && remaining <= 0 ? " y " : ", ") : ""}
                    <b>{code}</b>
                  </span>
                ))}
                {remaining > 0 ? ` y ${formatQty(remaining)} más` : ""}
              </>
            ) : (
              <b>{formatQty(worse.count)} equipos</b>
            )}{" "}
            <FuelTerm term="Rinde peor">{worse.count === 1 ? "rinde" : "rinden"} más de 10 % peor</FuelTerm> que otros equipos de su mismo modelo.
          </p>
        ) : measured === false ? (
          <p className={muted}>Todavía no hay cargas con rendimiento calculado en {period.inLabel}.</p>
        ) : (
          <p className={answer}>Ningún equipo rinde más de 10 % peor que otros de su mismo modelo.</p>
        )}
        <div className="mt-3">
          <Link href={withPeriod(FUEL_PATHS.consumo)} className={link}>
            Ver el rendimiento <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </div>
      </Card>

      <Card className="p-5">
        {unlinkedPlates === null ? (
          <p className={muted}>No se pudo contar las patentes de tarjeta sin vincular. Reintenta en un momento.</p>
        ) : unlinkedPlates > 0 ? (
          <>
            <p className={answer}>
              <b>{formatQty(unlinkedPlates)} {unlinkedPlates === 1 ? "patente" : "patentes"}</b> de tarjeta no {unlinkedPlates === 1 ? "está" : "están"} en la flota y sus litros no cuentan en ningún equipo.
              {canLinkPlates ? " Puedes vincularlas." : ""}
            </p>
            <div className="mt-3">
              {canLinkPlates ? (
                <Button asChild size="sm">
                  <Link href={withPeriod(fuelInboxHref({ tipo: "patente" }))}>Vincular patentes</Link>
                </Button>
              ) : (
                <Link href={withPeriod(fuelInboxHref({ tipo: "patente" }))} className={link}>
                  Ver las patentes <ArrowRight size={14} weight="bold" aria-hidden />
                </Link>
              )}
            </div>
          </>
        ) : (
          <p className={answer}>Todas las patentes de tarjeta están vinculadas a un equipo.</p>
        )}
      </Card>
    </div>
  )
}
