// @vitest-environment jsdom

/**
 * P3-7: un `.docx` o una hoja de cálculo subida como planilla se pintaba dentro de
 * un `<img>` y salía como imagen rota. Ahora es una tarjeta con «Abrir documento».
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RunDocumentInfo } from "./types"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

const { SourceFormUpload, SourceFormViewer } = await import("./source-form")

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function runDocument(name: string, caption: string | null = null): RunDocumentInfo {
  return { id: `doc-${name}`, path: `storage/inspection-evidence/${name}`, caption, createdAt: "2026-10-19T12:00:00.000Z" }
}

describe("SourceFormViewer", () => {
  it.each([
    ["reporte.docx", "Documento de Word"],
    ["reporte.xlsx", "Planilla de Excel"],
    ["reporte.xls", "Planilla de Excel"],
  ])("%s se ofrece como documento para abrir y no como imagen", (name, label) => {
    const { container } = render(<SourceFormViewer documents={[runDocument(name)]} />)

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Abrir documento" })).toHaveAttribute("href", `/api/prevencion/inspecciones/documento/${name}`)
    expect(container.querySelector("img")).toBeNull()
    // Ampliar o reducir no tiene sentido sobre un documento que no se puede mostrar.
    expect(screen.queryByRole("button", { name: "Ampliar la planilla" })).toBeNull()
  })

  it("una imagen sigue mostrándose con sus controles de zoom", () => {
    const { container } = render(<SourceFormViewer documents={[runDocument("foto.png", "Hoja 1 del turno")]} />)

    expect(container.querySelector("img")).toHaveAttribute("src", "/api/prevencion/inspecciones/documento/foto.png")
    expect(screen.getByRole("button", { name: "Ampliar la planilla" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Abrir documento" })).toBeNull()
  })

  it("un PDF sigue yendo en un visor incrustado, sin controles de zoom", () => {
    const { container } = render(<SourceFormViewer documents={[runDocument("planilla.pdf")]} />)

    expect(container.querySelector("object")).toHaveAttribute("data", "/api/prevencion/inspecciones/documento/planilla.pdf")
    expect(screen.queryByRole("button", { name: "Ampliar la planilla" })).toBeNull()
  })

  it("al cambiar de hoja entre una imagen y un documento, el visor sigue al archivo elegido", () => {
    const { container } = render(<SourceFormViewer documents={[runDocument("foto.png"), runDocument("anexo.docx")]} />)
    expect(container.querySelector("img")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Hoja 2" }))

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByRole("link", { name: "Abrir documento" })).toBeInTheDocument()
  })
})

describe("SourceFormUpload", () => {
  it("la ayuda dice el máximo", () => {
    render(<SourceFormUpload runId="run-1" hasDocuments={false} />)

    expect(screen.getByText(/Máximo 25 MB\./)).toBeInTheDocument()
  })

  it("un archivo más grande que el máximo se rechaza sin subirlo, como alerta", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    render(<SourceFormUpload runId="run-1" hasDocuments={false} />)

    const big = new File(["x"], "enorme.pdf", { type: "application/pdf" })
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText("Subir la planilla física"), { target: { files: [big] } })

    expect(await screen.findByRole("alert")).toHaveTextContent("El archivo supera el máximo permitido de 25 MB.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("un rechazo del servidor se dice como alerta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Formato no permitido." }), { status: 400, headers: { "Content-Type": "application/json" } }))
    render(<SourceFormUpload runId="run-1" hasDocuments={false} />)

    fireEvent.change(screen.getByLabelText("Subir la planilla física"), {
      target: { files: [new File(["x"], "planilla.png", { type: "image/png" })] },
    })

    expect(await screen.findByRole("alert")).toHaveTextContent("Formato no permitido.")
  })

  it("una subida correcta se dice como estado y no como alerta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "doc-1", path: "storage/inspection-evidence/a.png" }), { status: 201, headers: { "Content-Type": "application/json" } }))
    render(<SourceFormUpload runId="run-1" hasDocuments={false} />)

    fireEvent.change(screen.getByLabelText("Subir la planilla física"), {
      target: { files: [new File(["x"], "planilla.png", { type: "image/png" })] },
    })

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Planilla cargada"))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
