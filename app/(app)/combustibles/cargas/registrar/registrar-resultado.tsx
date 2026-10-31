"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle, Warning } from "@phosphor-icons/react"
import { BigButton } from "@/components/combustibles/field-load/big-controls"
import { Callout } from "@/components/ui/callout"
import { FLAG_REASON_LABELS, type FlagReason, type ReviewStatus } from "@/lib/combustibles/control/contracts"
import { inboxRowKey } from "@/lib/combustibles/inbox/types"
import { fuelInboxHref, fuelLoadHref } from "@/lib/combustibles/routes"
import { formatDateTime } from "@/lib/utils"

/** Lo que responde `POST /api/combustibles/cargas` cuando registra la carga. */
export interface RegistroResult {
  id: string
  duplicate?: boolean
  review?: { loadId: string; status: ReviewStatus; flagReasons: FlagReason[] } | null
}

/** Los motivos en palabras («Registrada después (fecha pasada)»), nunca el código. */
export function flagReasonsText(reasons: readonly FlagReason[]): string {
  return reasons.map((reason) => FLAG_REASON_LABELS[reason] ?? reason).join("; ")
}

/**
 * Pantalla final del registro: confirma la carga, la enlaza y dice con claridad si
 * quedó por decidir (y por qué) o sin observaciones. Sin diálogos: registrar es lo
 * rutinario y lo que sigue, si algo hay que decidir, es otra persona.
 */
export function RegistrarResultado({
  result,
  worksiteId,
  /** Hora de Chile (`2026-10-12T14:30`) cuando la carga fue de otro día. */
  pastLoadedAt,
  canView,
  onRestart,
}: {
  result: RegistroResult
  worksiteId: string
  pastLoadedAt?: string | null
  canView: boolean
  onRestart: () => void
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => { headingRef.current?.focus() }, [])
  const review = result.review ?? null
  const flagged = review?.status === "flagged"

  return (
    <div className="space-y-5" role="status">
      <div className="space-y-3 text-center">
        <CheckCircle size={56} weight="fill" aria-hidden="true" className="mx-auto text-[var(--color-success)]" />
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold outline-none">Carga registrada</h2>
        <p className="text-base text-[var(--color-text-muted)]">
          {result.duplicate
            ? "Esta carga ya estaba registrada: no se duplicó."
            : pastLoadedAt
              ? `Quedó guardada con la fecha y la hora que indicaste (${formatDateTime(pastLoadedAt)}), y con el día en que la ingresaste.`
              : "Quedó guardada con la fecha y la hora de la plataforma."}
        </p>
      </div>

      {flagged && review ? (
        <Callout tone="warning" role="none" icon={<Warning size={20} weight="fill" />} title="Quedó por decidir">
          <p>{flagReasonsText(review.flagReasons)}.</p>
          <p className="mt-1">Una persona con permiso la revisa y decide si cuenta en «Por revisar».</p>
          {canView && (
            <p className="mt-2">
              <Link href={fuelInboxHref({ tipo: "carga", item: inboxRowKey("carga", review.loadId), faena: worksiteId })} className="font-semibold underline">
                Ir a Por revisar
              </Link>
            </p>
          )}
        </Callout>
      ) : review ? (
        <p className="text-center text-base text-[var(--color-text-muted)]">La plataforma no encontró nada que revisar en esta carga.</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {canView && (
          <BigButton asChild>
            <Link href={fuelLoadHref({ origen: "terreno", id: result.id })}>Ver la carga</Link>
          </BigButton>
        )}
        <BigButton type="button" variant={canView ? "secondary" : "primary"} onClick={onRestart}>Registrar otra carga</BigButton>
      </div>
    </div>
  )
}
