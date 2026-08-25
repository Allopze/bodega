// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AnswerEvidence } from "./inspection-run-detail"

vi.mock("@/lib/pwa/image-compress", () => ({
  compressPhoto: (file: File) => Promise.resolve(file),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("AnswerEvidence", () => {
  it("saves a new answer inside the same photo gesture and then uploads", async () => {
    const ensureAnswerId = vi.fn().mockResolvedValue("answer-1")
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "evidence-1",
      path: "storage/inspection-evidence/photo.jpg",
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    render(
      <AnswerEvidence
        answerId={null}
        evidence={[]}
        editable
        readyToPersist
        ensureAnswerId={ensureAnswerId}
      />,
    )

    expect(screen.getByRole("button", { name: "Adjuntar fotos" })).toBeEnabled()
    expect(screen.getByLabelText("Adjuntar evidencia fotográfica")).toHaveClass("sr-only")

    fireEvent.change(screen.getByLabelText("Adjuntar evidencia fotográfica"), {
      target: { files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })] },
    })

    await waitFor(() => expect(ensureAnswerId).toHaveBeenCalledOnce())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get("answerId")).toBe("answer-1")
  })
})
