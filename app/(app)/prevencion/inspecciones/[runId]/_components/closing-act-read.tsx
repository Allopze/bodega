"use client"

import * as React from "react"
import { formatSignatureRole, type ClosingActSpec } from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"
import type { RunInfo } from "./types"

/**
 * El acta de cierre ya declarada: resultado, restricciones y quiénes firmaron y
 * cuándo. Una lista de pares rótulo–valor separada por filetes, sin caja: el
 * acta no es una tarjeta dentro de la página. Los roles que la plantilla exige y
 * todavía no firmaron se dicen («Sin firma»), no se omiten.
 */
export function ClosingActRead({ closingAct, run }: {
  closingAct: ClosingActSpec
  run: Pick<RunInfo, "closingResult" | "closingRestrictions" | "closingSignatures">
}) {
  const signatures = run.closingSignatures ?? []
  const pendingRoles = closingAct.signatureRoles.filter((role) => !signatures.some((signature) => signature.role === role))
  return (
    // `id`: el resumen de arriba salta aquí.
    <section id="acta-cierre" aria-labelledby="acta-cierre-titulo" className="scroll-mt-20">
      <h2 id="acta-cierre-titulo" className="text-h2">{closingAct.title}</h2>
      <dl className="mt-1 divide-y divide-[var(--color-border)] text-sm">
        <ActRow label="Resultado">
          {closingAct.resultOptions.find((option) => option.value === run.closingResult)?.label ?? run.closingResult ?? "—"}
        </ActRow>
        {run.closingRestrictions && <ActRow label="Restricciones"><span className="whitespace-pre-wrap break-words">{run.closingRestrictions}</span></ActRow>}
        {signatures.map((signature) => (
          <ActRow key={signature.role} label={formatSignatureRole(signature.role)}>
            {signature.name} · {formatDateTime(signature.signedAt)}
          </ActRow>
        ))}
        {pendingRoles.map((role) => (
          <ActRow key={role} label={formatSignatureRole(role)}>
            <span className="text-[var(--color-text-subtle)]">Sin firma</span>
          </ActRow>
        ))}
      </dl>
    </section>
  )
}

function ActRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-x-4">
      <dt className="text-xs text-[var(--color-text-subtle)] md:pt-0.5">{label}</dt>
      <dd className="mt-0.5 font-medium md:mt-0">{children}</dd>
    </div>
  )
}
