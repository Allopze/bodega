// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// jsdom no implementa `scrollIntoView` (Radix) ni las URL de blobs (miniaturas).
Element.prototype.scrollIntoView = function scrollIntoView() {}
URL.createObjectURL = vi.fn(() => "blob:foto")
URL.revokeObjectURL = vi.fn()

const refresh = vi.fn()
const registerWorkOrderRecordAction = vi.fn()
const toastSuccess = vi.fn()
const capturePhoto = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }))
vi.mock("@/app/(app)/mantencion/ot/[id]/actions", () => ({ registerWorkOrderRecordAction }))
vi.mock("@/lib/toast", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/mantencion/client/photo-capture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mantencion/client/photo-capture")>()),
  capturePhoto: (...args: unknown[]) => capturePhoto(...args),
}))

const { OtRecordSheet } = await import("./ot-record-sheet")
const { otRecordForm } = await import("../ot-fixtures")

const SHA = "a".repeat(64)

function renderSheet(kind: "C" | "P" = "C", onClose = vi.fn()) {
  render(<OtRecordSheet kind={kind} workOrderId="ot-1" folio="OT-BIO-0001" userId="u-mec" userName="Javier Roa" form={otRecordForm()} onClose={onClose} />)
  return { sheet: within(screen.getByRole("dialog")), onClose }
}

const photo = (type = "image/jpeg") => new File(["foto"], "foto.jpg", { type })

async function fillCorrective(sheet: ReturnType<typeof within>) {
  fireEvent.change(sheet.getByRole("textbox", { name: /Odómetro actual/ }), { target: { value: "120100" } })
  fireEvent.click(sheet.getByRole("button", { name: "Continuar" }))
  expect(await sheet.findByText(/Paso 2 de 4 · Trabajo/)).toBeTruthy()

  fireEvent.click(within(sheet.getByRole("group", { name: "Agregar trabajo" })).getByRole("button", { name: /Mecánico/ }))
  fireEvent.click(sheet.getByRole("checkbox", { name: "No se usaron repuestos" }))
  fireEvent.click(sheet.getByRole("checkbox", { name: "No se cambió aceite" }))
  fireEvent.change(sheet.getByRole("textbox", { name: /Trabajo realizado/ }), { target: { value: "Cambio de manguera hidráulica" } })
  const drivers = sheet.getByRole("combobox", { name: /Conductores de las últimas 24 h/ })
  fireEvent.focus(drivers)
  fireEvent.change(drivers, { target: { value: "AEDO" } })
  fireEvent.mouseDown(await sheet.findByRole("option", { name: "AEDO POLANCO JOSE A." }))
  expect(sheet.getByRole("button", { name: "Quitar a AEDO POLANCO JOSE A." })).toBeTruthy()
  fireEvent.click(sheet.getByRole("button", { name: "Continuar a fotos" }))
  expect(await sheet.findByText(/Paso 3 de 4 · Fotos/)).toBeTruthy()
}

describe("OtRecordSheet: registrar la correctiva de la OT desde el PC", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturePhoto.mockResolvedValue({
      blob: new Blob(["timbrada"], { type: "image/jpeg" }), width: 640, height: 480, sha256: SHA,
      stampedAt: "2026-11-02T15:00:00.000Z", takenAtExif: null, exif: null,
    })
  })
  afterEach(cleanup)

  it("pasos «n de 4» sin el de equipo, errores por paso y el FormData que se envía", async () => {
    registerWorkOrderRecordAction.mockResolvedValue({ ok: true, message: "Registro MC-BIO-0008 guardado y enlazado a la OT.", data: { recordId: "r", folio: "MC-BIO-0008", duplicate: false, warnings: [] } })
    const { sheet, onClose } = renderSheet()
    expect(sheet.getByText("Paso 1 de 4 · Lectura y fecha")).toBeTruthy()
    expect(sheet.getByText("KA-135 · RBYD-98")).toBeTruthy()
    // Sin lectura no sigue.
    fireEvent.click(sheet.getByRole("button", { name: "Continuar" }))
    expect(await sheet.findByText("Ingresa la lectura del odómetro.")).toBeTruthy()
    expect(sheet.queryByRole("button", { name: "Volver" })).toBeNull()

    await fillCorrective(sheet)
    // Sin foto no se revisa.
    fireEvent.click(sheet.getByRole("button", { name: "Revisar registro" }))
    expect(await sheet.findByText("Falta al menos una foto.")).toBeTruthy()
    fireEvent.change(sheet.getByLabelText("Agregar foto del trabajo"), { target: { files: [photo()] } })
    expect(await sheet.findByRole("img", { name: "Foto 1 del trabajo" })).toBeTruthy()
    expect(capturePhoto).toHaveBeenCalledWith(expect.any(File), { code: "KA-135", plate: "RBYD-98" })
    fireEvent.click(sheet.getByRole("button", { name: "Revisar registro" }))
    expect(await sheet.findByText(/Paso 4 de 4 · Revisar y firmar/)).toBeTruthy()
    expect(sheet.getByText("Cambio de manguera hidráulica")).toBeTruthy()

    fireEvent.click(sheet.getByRole("button", { name: "Firmar y guardar" }))
    await waitFor(() => expect(registerWorkOrderRecordAction).toHaveBeenCalledTimes(1))
    const data = registerWorkOrderRecordAction.mock.calls[0]![0] as FormData
    const record = JSON.parse(String(data.get("record")))
    expect(record).toMatchObject({
      kind: "C", vehicleId: "veh-1", reading: 120_100, workOrderId: "ot-1", inWorkshop: false, workOrder: null,
      noOilChange: true, oilIds: [], driverIds: ["dr-1"], executor: { kind: "yo" },
      jobs: [{ workTypeId: "wt-mec", hours: 1, noParts: true, parts: [] }],
    })
    expect(record.photos).toHaveLength(1)
    const photoId = record.photos[0].id as string
    expect(record.photos[0].kind).toBe("correctiva")
    expect(data.get(`photo:${photoId}`)).toBeInstanceOf(File)
    expect(JSON.parse(String(data.get(`meta:${photoId}`)))).toMatchObject({ kind: "correctiva", sha256: SHA, width: 640, height: 480 })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Registro MC-BIO-0008 guardado y enlazado a la OT.")
    expect(refresh).toHaveBeenCalled()
  })

  it("sólo acepta JPG o PNG, con un mensaje claro (HEIC no)", async () => {
    const { sheet } = renderSheet()
    await fillCorrective(sheet)
    fireEvent.change(sheet.getByLabelText("Agregar foto del trabajo"), { target: { files: [photo("image/heic")] } })
    expect((await sheet.findByRole("alert")).textContent).toMatch(/JPG o PNG/)
    expect(capturePhoto).not.toHaveBeenCalled()
  })

  it("un salto de lectura se confirma en la misma pantalla y sigue al paso siguiente", async () => {
    const { sheet } = renderSheet()
    fireEvent.change(sheet.getByRole("textbox", { name: /Odómetro actual/ }), { target: { value: "190000" } })
    fireEvent.click(sheet.getByRole("button", { name: "Continuar" }))
    expect(await sheet.findByText(/más que la última vez\. ¿Está bien\?/)).toBeTruthy()
    fireEvent.click(sheet.getByRole("button", { name: "Sí, está bien" }))
    expect(await sheet.findByText(/Paso 2 de 4 · Trabajo/)).toBeTruthy()
  })

  it("un rechazo del servidor lleva al paso del campo con el mensaje a la vista", async () => {
    registerWorkOrderRecordAction.mockResolvedValue({ ok: false, message: "La lectura es menor que la del 01-10-2026.", fieldErrors: { reading: ["La lectura es menor que la del 01-10-2026."] } })
    const { sheet, onClose } = renderSheet()
    await fillCorrective(sheet)
    fireEvent.change(sheet.getByLabelText("Agregar foto del trabajo"), { target: { files: [photo()] } })
    await sheet.findByRole("img", { name: "Foto 1 del trabajo" })
    fireEvent.click(sheet.getByRole("button", { name: "Revisar registro" }))
    fireEvent.click(await sheet.findByRole("button", { name: "Firmar y guardar" }))
    expect(await sheet.findByText(/Paso 1 de 4 · Lectura y fecha/)).toBeTruthy()
    expect(sheet.getByText("La lectura es menor que la del 01-10-2026.")).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("cerrar con datos escritos pide confirmar; sin nada escrito cierra directo", async () => {
    const first = renderSheet()
    fireEvent.click(first.sheet.getByRole("button", { name: "Cerrar" }))
    expect(first.onClose).toHaveBeenCalledTimes(1)
    cleanup()

    const { sheet, onClose } = renderSheet()
    fireEvent.change(sheet.getByRole("textbox", { name: /Odómetro actual/ }), { target: { value: "120100" } })
    fireEvent.click(sheet.getByRole("button", { name: "Cerrar" }))
    const confirm = within(await screen.findByRole("alertdialog").catch(() => screen.getAllByRole("dialog").at(-1)!))
    expect(confirm.getByText("¿Descartar el registro?")).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(confirm.getByRole("button", { name: "Descartar" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("OtRecordSheet: preventiva", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("dice qué pauta toca, pide marcar los ítems y exige filtros, sticker y notas", async () => {
    const { sheet } = renderSheet("P")
    fireEvent.change(sheet.getByRole("textbox", { name: /Odómetro actual/ }), { target: { value: "120100" } })
    expect(sheet.getByText(/toca la de 20\.000 km/)).toBeTruthy()
    fireEvent.click(sheet.getByRole("button", { name: "Continuar" }))
    expect(await sheet.findByText(/Paso 2 de 4 · Pauta/)).toBeTruthy()
    fireEvent.click(sheet.getByRole("button", { name: "Continuar a fotos" }))
    expect(await sheet.findByText("Falta 1 ítem por marcar.")).toBeTruthy()
    fireEvent.click(within(sheet.getByRole("group", { name: "Revisión aceite motor" })).getByRole("button", { name: "No realizado" }))
    fireEvent.click(sheet.getByRole("button", { name: "Continuar a fotos" }))
    expect(await sheet.findByText(/Falta el motivo/)).toBeTruthy()
    fireEvent.change(sheet.getByRole("textbox", { name: /¿Por qué no se realizó/ }), { target: { value: "Falta repuesto" } })
    fireEvent.click(sheet.getByRole("button", { name: "Continuar a fotos" }))
    expect(await sheet.findByText(/Paso 3 de 4 · Fotos/)).toBeTruthy()
    fireEvent.click(sheet.getByRole("button", { name: "Revisar registro" }))
    expect(await sheet.findByText("Falta la foto de los filtros usados.")).toBeTruthy()
    expect(sheet.getByText("Falta la foto del sticker de mantención.")).toBeTruthy()
    expect(sheet.getByLabelText("Cargar foto: filtros usados")).toBeTruthy()
    expect(sheet.getByLabelText("Cargar foto: sticker de mantención realizada")).toBeTruthy()
  })
})
