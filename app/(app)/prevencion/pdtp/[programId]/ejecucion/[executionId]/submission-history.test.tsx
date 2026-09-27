// @vitest-environment jsdom

/**
 * PREV-I04: la sección "Historial de envíos" del detalle muestra cada intento,
 * quién lo hizo, el motivo de un rechazo y los archivos de ese momento.
 */
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { PdtpExecutionHistoryEntry } from "@/lib/services/pdtp/execution-history"
import { SubmissionHistory } from "./submission-history"

afterEach(() => cleanup())

const base: Omit<PdtpExecutionHistoryEntry, "id" | "changeType" | "at"> = {
  actorUserId: "u-1", actorName: "Ana Pérez", attempt: 1, status: "submitted", reason: null,
  executedQuantity: 1, evidenceText: null, files: [],
}

describe("SubmissionHistory", () => {
  it("lista cada transición con su etiqueta, autor, intento y motivo", () => {
    render(<SubmissionHistory entries={[
      { ...base, id: "h1", changeType: "submitted", at: "2026-09-20T12:00:00.000Z", files: ["storage/pdtp-evidence/a.pdf"] },
      { ...base, id: "h2", changeType: "rejected", at: "2026-09-21T12:00:00.000Z", actorName: "Luis Soto", status: "rejected", reason: "Falta la firma" },
      { ...base, id: "h3", changeType: "resubmitted", at: "2026-09-22T12:00:00.000Z", attempt: 2, files: ["storage/pdtp-evidence/b.pdf", "storage/pdtp-evidence/a.pdf"] },
    ]} />)

    const list = screen.getByRole("list", { name: "Historial de envíos" })
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(within(items[0]!).getByText("Enviado")).toBeTruthy()
    expect(within(items[0]!).getByText(/Ana Pérez/)).toBeTruthy()
    expect(within(items[0]!).getByText(/Intento 1/)).toBeTruthy()
    expect(within(items[1]!).getByText("Rechazado")).toBeTruthy()
    expect(within(items[1]!).getByText(/Falta la firma/)).toBeTruthy()
    expect(within(items[2]!).getByText("Reenviado")).toBeTruthy()
    expect(within(items[2]!).getByText(/Intento 2/)).toBeTruthy()
    expect(within(items[2]!).getAllByRole("link")).toHaveLength(2)
  })

  it("una revocación sin autor la atribuye al sistema", () => {
    render(<SubmissionHistory entries={[
      { ...base, id: "h1", changeType: "revoked", at: "2026-09-20T12:00:00.000Z", actorUserId: null, actorName: null, reason: "Ocurrencia anulada", status: "draft" },
    ]} />)
    expect(screen.getByText("Revertido")).toBeTruthy()
    expect(screen.getByText(/Sistema/)).toBeTruthy()
    expect(screen.getByText(/Ocurrencia anulada/)).toBeTruthy()
  })

  it("sin historia lo dice en lenguaje de usuario", () => {
    render(<SubmissionHistory entries={[]} />)
    expect(screen.getByText(/no tiene envíos registrados/i)).toBeTruthy()
  })
})
