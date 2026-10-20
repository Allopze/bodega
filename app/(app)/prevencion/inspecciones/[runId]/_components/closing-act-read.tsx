"use client"

import * as React from "react"
import { formatSignatureRole, type ClosingActSpec } from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"
import type { RunInfo } from "./types"

/** El acta de cierre ya declarada: resultado, restricciones y quiénes firmaron y cuándo. */
export function ClosingActRead({ closingAct, run }: {
  closingAct: ClosingActSpec
  run: Pick<RunInfo, "closingResult" | "closingRestrictions" | "closingSignatures">
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{closingAct.title}</h2>
      <div className="space-y-1 rounded-lg border border-[var(--color-border)] p-4 text-sm">
        <p>
          <span className="text-[var(--color-text-subtle)]">Resultado: </span>
          {closingAct.resultOptions.find((option) => option.value === run.closingResult)?.label ?? run.closingResult ?? "—"}
        </p>
        {run.closingRestrictions && <p><span className="text-[var(--color-text-subtle)]">Restricciones: </span>{run.closingRestrictions}</p>}
        {run.closingSignatures?.map((signature) => (
          <p key={signature.role}>
            <span className="text-[var(--color-text-subtle)]">{formatSignatureRole(signature.role)}: </span>
            {signature.name} · {formatDateTime(signature.signedAt)}
          </p>
        ))}
      </div>
    </section>
  )
}
