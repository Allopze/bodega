// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DteSyncList, type DteSyncRunRow } from "./dte-sync-list"

const run: DteSyncRunRow = {
  id: "run-1",
  periodo: "2026-08",
  trigger: "cron",
  status: "partial",
  error: "El portal declara 578 documentos y se pudieron leer 575: faltan 3.",
  reconciliationStatus: "success",
  reconciliationError: null,
  rowsSeen: 575,
  rowsInserted: 575,
  rowsUpdated: 0,
  startedAt: "2026-08-19T12:00:00.000Z",
  finishedAt: "2026-08-19T12:05:00.000Z",
}

describe("DteSyncList", () => {
  it("muestra el motivo de una corrida parcial: la alerta manda a diagnosticarlo acá", () => {
    render(<DteSyncList runs={[run]} />)

    expect(screen.getByText(/faltan 3/)).toBeInTheDocument()
  })

  it("no inventa texto cuando la corrida no dejó motivo", () => {
    render(<DteSyncList runs={[{ ...run, status: "success", error: null }]} />)

    expect(screen.queryByText(/faltan 3/)).not.toBeInTheDocument()
  })
})
