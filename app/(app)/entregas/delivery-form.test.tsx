// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { INITIAL_STATE } from "@/lib/form-state"
import { toast } from "@/lib/toast"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  registerWorkerDeliveryAction: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("@/components/ui/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({ min, max, ...props }: { min?: string; max?: string; [key: string]: unknown }) => (
    <input data-testid="delivery-date-picker" min={min} max={max} {...props} />
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, searchable, value, onValueChange }: PropsWithChildren<{
    searchable?: boolean
    value?: string
    onValueChange?: (value: string) => void
  }>) => (
    <select
      data-testid="select"
      data-searchable={String(searchable)}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: PropsWithChildren) => <>{children}</>,
  SelectItem: ({ children, value, disabled }: PropsWithChildren<{ value: string; disabled?: boolean }>) => (
    <option value={value} disabled={disabled}>{children}</option>
  ),
}))

afterEach(cleanup)

import { DeliveryForm } from "./delivery-form"

describe("DeliveryForm", () => {
  it("usa cantidades enteras para EPP y rechaza una fracción antes de agregarla", () => {
    vi.mocked(toast.error).mockClear()
    render(
      <DeliveryForm
        today="2026-08-31"
        worksites={[{ id: "faena-1", name: "Faena Santa Fe" }]}
        workers={[{
          id: "worker-1",
          name: "Andrea Rojas",
          worksiteId: "faena-1",
          worksiteName: "Faena Santa Fe",
          position: "Operaria",
          rut: "12.345.678-9",
          sizeTop: null,
          sizeBottom: null,
          sizeShoe: null,
          sizeGloves: null,
          sizeHelmet: null,
        }]}
        stockProducts={[{
          sourceWorksiteId: "faena-1",
          productId: "helmet",
          productName: "Casco dieléctrico",
          productSku: "EPP-001",
          isEpp: true,
          unitOfMeasure: "unidad",
          stockQuantity: 4,
          familyId: "fam-helmet",
          familyName: null,
          sizeLabel: null,
          sizeAttributeName: null,
        }]}
      />,
    )

    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-helmet" } })
    const quantityInput = screen.getByLabelText("Cantidad (máx. 4 unidades)")
    expect(quantityInput).toHaveAttribute("min", "1")
    expect(quantityInput).toHaveAttribute("step", "1")

    fireEvent.change(quantityInput, { target: { value: "0.02" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    expect(toast.error).toHaveBeenCalledWith("Los EPP se entregan en cantidades enteras")
    expect(screen.getByText("Agrega uno o más productos con stock para continuar.")).toBeDefined()
  })

  it("no muestra selector de solicitud y permite entregar stock general", () => {
    render(
      <DeliveryForm
        today="2026-08-31"
        worksites={[{ id: "faena-1", name: "Faena Santa Fe" }]}
        workers={[{
          id: "worker-1",
          name: "Andrea Rojas",
          worksiteId: "faena-1",
          worksiteName: "Faena Santa Fe",
          position: "Operaria",
          rut: "12.345.678-9",
          sizeTop: null,
          sizeBottom: null,
          sizeShoe: null,
          sizeGloves: null,
          sizeHelmet: null,
        }]}
        stockProducts={[{
          sourceWorksiteId: "faena-1",
          productId: "helmet",
          productName: "Casco dieléctrico",
          productSku: "EPP-001",
          isEpp: true,
          unitOfMeasure: "unidad",
          stockQuantity: 4,
          familyId: "fam-helmet",
          familyName: null,
          sizeLabel: null,
          sizeAttributeName: null,
        }]}
        initialSourceWorksiteId="faena-1"
      />,
    )

    fireEvent.change(screen.getAllByTestId("select")[1]!, { target: { value: "worker-1" } })
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-helmet" } })
    fireEvent.change(screen.getByLabelText("Cantidad (máx. 4 unidades)"), { target: { value: "1" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    expect(screen.queryByText("Agrega uno o más productos con stock para continuar.")).toBeNull()
    expect(screen.queryByText(/Vincular a solicitud/)).toBeNull()
    expect(screen.queryByText(/Sin vínculo de solicitud/)).toBeNull()
  })

  it("permite seleccionar cualquier fecha pasada y limita sólo el futuro", () => {
    render(
      <DeliveryForm
        today="2026-08-21"
        worksites={[{ id: "faena-1", name: "Faena Santa Fe" }]}
        workers={[{
          id: "worker-1",
          name: "Andrea Rojas",
          worksiteId: "faena-1",
          worksiteName: "Faena Santa Fe",
          position: "Operaria",
          rut: "12.345.678-9",
          sizeTop: null,
          sizeBottom: null,
          sizeShoe: null,
          sizeGloves: null,
          sizeHelmet: null,
        }]}
        stockProducts={[{
          sourceWorksiteId: "faena-1",
          productId: "helmet",
          productName: "Casco dieléctrico",
          productSku: "EPP-001",
          isEpp: true,
          unitOfMeasure: "unidad",
          stockQuantity: 4,
          familyId: "fam-helmet",
          familyName: null,
          sizeLabel: null,
          sizeAttributeName: null,
        }]}
      />,
    )

    const datePicker = screen.getByTestId("delivery-date-picker")
    expect(datePicker).not.toHaveAttribute("min")
    expect(datePicker).toHaveAttribute("max", "2026-08-21")
    expect(screen.getByText("Por defecto hoy. Puedes registrar cualquier fecha pasada.")).toBeDefined()
  })

  it("muestra sólo trabajadores de la faena seleccionada aunque no haya EPP pendiente", () => {
    render(
      <DeliveryForm
        today="2026-08-21"
        worksites={[
          { id: "faena-1", name: "Faena Santa Fe" },
          { id: "faena-2", name: "Faena Arauco" },
        ]}
        workers={[
          {
            id: "worker-1",
            name: "Andrea Rojas",
            worksiteId: "faena-1",
            worksiteName: "Faena Santa Fe",
            position: "Operaria",
            rut: "12.345.678-9",
            sizeTop: null,
            sizeBottom: null,
            sizeShoe: null,
            sizeGloves: null,
            sizeHelmet: null,
          },
          {
            id: "worker-2",
            name: "Bruno Soto",
            worksiteId: "faena-2",
            worksiteName: "Faena Arauco",
            position: "Supervisor",
            rut: "11.111.111-1",
            sizeTop: null,
            sizeBottom: null,
            sizeShoe: null,
            sizeGloves: null,
            sizeHelmet: null,
          },
        ]}
        stockProducts={[{
          sourceWorksiteId: "faena-1",
          productId: "helmet",
          productName: "Casco dieléctrico",
          productSku: "EPP-001",
          isEpp: true,
          unitOfMeasure: "unidad",
          stockQuantity: 4,
          familyId: "fam-helmet",
          familyName: null,
          sizeLabel: null,
          sizeAttributeName: null,
        }]}
        initialSourceWorksiteId="faena-1"
      />,
    )

    expect(screen.getByText("Andrea Rojas · Faena Santa Fe · Operaria")).toBeDefined()
    expect(screen.queryByText("Bruno Soto · Faena Arauco · Supervisor")).toBeNull()
    expect(screen.getAllByTestId("select").some((select) => select.dataset.searchable === "true")).toBe(true)
    expect(screen.queryByText(/firma/i)).toBeNull()

    fireEvent.change(screen.getAllByTestId("select")[0]!, { target: { value: "faena-2" } })

    expect(screen.queryByText("Andrea Rojas · Faena Santa Fe · Operaria")).toBeNull()
    expect(screen.getByText("Bruno Soto · Faena Arauco · Supervisor")).toBeDefined()
  })

  it("abre en una bodega con dotación, no en la bodega de oficina que sólo tiene stock", () => {
    render(
      <DeliveryForm
        today="2026-08-21"
        worksites={[
          { id: "ws-oficina", name: "Administración" },
          { id: "faena-1", name: "Faena Santa Fe" },
        ]}
        workers={[{
          id: "worker-1",
          name: "Andrea Rojas",
          worksiteId: "faena-1",
          worksiteName: "Faena Santa Fe",
          position: "Operaria",
          rut: "12.345.678-9",
          sizeTop: null,
          sizeBottom: null,
          sizeShoe: null,
          sizeGloves: null,
          sizeHelmet: null,
        }]}
        stockProducts={[
          {
            sourceWorksiteId: "ws-oficina",
            productId: "gloves",
            productName: "Guantes",
            productSku: "EPP-002",
            isEpp: true,
            unitOfMeasure: "unidad",
            stockQuantity: 10,
            familyId: "fam-gloves",
            familyName: null,
            sizeLabel: null,
            sizeAttributeName: null,
          },
          {
            sourceWorksiteId: "faena-1",
            productId: "helmet",
            productName: "Casco dieléctrico",
            productSku: "EPP-001",
            isEpp: true,
            unitOfMeasure: "unidad",
            stockQuantity: 4,
            familyId: "fam-helmet",
            familyName: null,
            sizeLabel: null,
            sizeAttributeName: null,
          },
        ]}
      />,
    )

    // Sin `initialSourceWorksiteId`, la oficina va primera en stock y en la
    // lista de bodegas, pero no tiene dotación: debe ganar la faena.
    expect((screen.getAllByTestId("select")[0] as HTMLSelectElement).value).toBe("faena-1")
    expect(screen.getByText("Andrea Rojas · Faena Santa Fe · Operaria")).toBeDefined()
  })
  /* ── Talla ────────────────────────────────────────────────────────────────
   * El defecto original: el catálogo guarda una fila por talla y la talla vive
   * en `product_attributes`, que esta pantalla no leía. El selector mostraba el
   * mismo nombre una vez por talla y no había forma de decir cuál se entregaba.
   */
  const SHOE_SIZES = ["40", "41", "42", "43"] as const
  const shoeStock = (worksiteId = "faena-1") => SHOE_SIZES.map((size, index) => ({
    sourceWorksiteId: worksiteId,
    productId: `shoe-${size}`,
    productName: "Zapato de seguridad SteelPro",
    productSku: `EPP-ZAP-${size}`,
    isEpp: true,
    unitOfMeasure: "unidad",
    stockQuantity: index + 1,
    familyId: "fam-shoe",
    familyName: "Zapato de seguridad SteelPro",
    sizeLabel: size,
    sizeAttributeName: "Talla calzado",
  }))

  const worker = (overrides: Record<string, unknown> = {}) => ({
    id: "worker-1",
    name: "Juan Pérez",
    worksiteId: "faena-1",
    worksiteName: "Faena Santa Fe",
    position: "Operario",
    rut: "12.345.678-9",
    sizeTop: null,
    sizeBottom: null,
    sizeShoe: null,
    sizeGloves: null,
    sizeHelmet: null,
    ...overrides,
  })

  function renderWithSizes(props: Record<string, unknown> = {}) {
    return render(
      <DeliveryForm
        today="2026-08-31"
        worksites={[{ id: "faena-1", name: "Faena Santa Fe" }]}
        workers={[worker(props.workerOverrides as Record<string, unknown>)]}
        stockProducts={shoeStock()}
        initialSourceWorksiteId="faena-1"
      />,
    )
  }

  it("pide la talla cuando el producto la usa y ofrece una opción por talla con stock", () => {
    renderWithSizes()
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })

    // El selector de talla aparece rotulado con el atributo del catálogo.
    expect(screen.getByText("Talla calzado")).toBeDefined()
    const sizeSelect = screen.getAllByTestId("select")[3]!
    const options = [...sizeSelect.querySelectorAll("option")]
    expect(options.map((option) => option.getAttribute("value")))
      .toEqual(["shoe-40", "shoe-41", "shoe-42", "shoe-43"])
    expect(options.map((option) => option.textContent)).toEqual([
      "40 · EPP-ZAP-40 · 1 unidad", "41 · EPP-ZAP-41 · 2 unidades", "42 · EPP-ZAP-42 · 3 unidades", "43 · EPP-ZAP-43 · 4 unidades",
    ])
  })

  it("agrupa las variantes en un solo producto elegible", () => {
    renderWithSizes()
    const productOptions = [...screen.getAllByTestId("select")[2]!.querySelectorAll("option")]
    expect(productOptions).toHaveLength(1)
    expect(productOptions[0]!.textContent).toBe("Zapato de seguridad SteelPro · 4 tallas · 10 unidades")
  })

  it("no permite agregar la línea hasta que se elige la talla", () => {
    renderWithSizes()
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })

    // Sin talla no hay variante y por tanto no hay stock ni cantidad posible.
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled()

    fireEvent.change(screen.getAllByTestId("select")[3]!, { target: { value: "shoe-42" } })
    fireEvent.change(screen.getByLabelText("Cantidad (máx. 3 unidades)"), { target: { value: "1" } })
    expect(screen.getByRole("button", { name: "Agregar" })).toBeEnabled()
  })

  it("descuenta la variante elegida y no el producto genérico", () => {
    renderWithSizes()
    fireEvent.change(screen.getAllByTestId("select")[1]!, { target: { value: "worker-1" } })
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })
    fireEvent.change(screen.getAllByTestId("select")[3]!, { target: { value: "shoe-42" } })
    fireEvent.change(screen.getByLabelText("Cantidad (máx. 3 unidades)"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    // Lo que viaja al servidor es el `productId` de la variante: la talla no es
    // un campo aparte que pudiera contradecir al producto.
    const payload = document.querySelector<HTMLInputElement>('input[name="itemsJson"]')!
    expect(JSON.parse(payload.value)).toEqual([{ productId: "shoe-42", quantity: 2, notes: null }])
    expect(screen.getByText("Talla calzado 42")).toBeDefined()
  })

  it("limita la cantidad al stock de esa talla y no al del producto", () => {
    renderWithSizes()
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })
    fireEvent.change(screen.getAllByTestId("select")[3]!, { target: { value: "shoe-40" } })
    // Talla 40 tiene 1 unidad aunque la familia sume 10.
    const quantityInput = screen.getByLabelText("Cantidad (máx. 1 unidad)")
    expect(quantityInput).toHaveAttribute("max", "1")

    vi.mocked(toast.error).mockClear()
    fireEvent.change(quantityInput, { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))
    expect(toast.error).toHaveBeenCalledWith("Stock disponible: 1 unidad")
  })

  it("limpia la talla al cambiar de producto y no arrastra una talla ajena", () => {
    render(
      <DeliveryForm
        today="2026-08-31"
        worksites={[{ id: "faena-1", name: "Faena Santa Fe" }]}
        workers={[worker()]}
        stockProducts={[
          ...shoeStock(),
          {
            sourceWorksiteId: "faena-1",
            productId: "glove-m",
            productName: "Guante anticorte",
            productSku: "EPP-GUA-M",
            isEpp: true,
            unitOfMeasure: "unidad",
            stockQuantity: 6,
            familyId: "fam-glove",
            familyName: "Guante anticorte",
            sizeLabel: "M",
            sizeAttributeName: "Talla guantes",
          },
        ]}
        initialSourceWorksiteId="faena-1"
      />,
    )

    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })
    fireEvent.change(screen.getAllByTestId("select")[3]!, { target: { value: "shoe-42" } })
    expect(screen.getByLabelText("Cantidad (máx. 3 unidades)")).toBeDefined()

    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-glove" } })

    // La talla del zapato no puede sobrevivir al cambio de producto: sin talla
    // elegida no hay variante, así que la cantidad no conoce ningún máximo y no
    // se puede agregar la línea.
    expect(screen.getByLabelText("Cantidad")).toBeDefined()
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled()
    expect(screen.getByText("Talla guantes")).toBeDefined()
    expect([...screen.getAllByTestId("select")[3]!.querySelectorAll("option")]
      .map((option) => option.getAttribute("value"))).toEqual(["glove-m"])
  })

  it("no pide talla para un producto que no la usa", () => {
    render(
      <DeliveryForm
        today="2026-08-31"
        worksites={[{ id: "faena-1", name: "Faena Santa Fe" }]}
        workers={[worker()]}
        stockProducts={[{
          sourceWorksiteId: "faena-1",
          productId: "helmet",
          productName: "Casco de seguridad",
          productSku: "EPP-001",
          isEpp: true,
          unitOfMeasure: "unidad",
          stockQuantity: 4,
          familyId: "fam-helmet",
          familyName: "Casco de seguridad",
          sizeLabel: null,
          sizeAttributeName: null,
        }]}
        initialSourceWorksiteId="faena-1"
      />,
    )

    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-helmet" } })
    expect(screen.queryByText(/^Talla/)).toBeNull()
    // La variante única queda elegida sola: la cantidad ya conoce su stock.
    expect(screen.getByLabelText("Cantidad (máx. 4 unidades)")).toBeDefined()
  })

  it("marca la talla habitual del trabajador sin bloquear las demás", () => {
    renderWithSizes({ workerOverrides: { sizeShoe: "42" } })
    fireEvent.change(screen.getAllByTestId("select")[1]!, { target: { value: "worker-1" } })
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })

    const options = [...screen.getAllByTestId("select")[3]!.querySelectorAll("option")]
    expect(options.map((option) => option.textContent)).toEqual([
      "40 · EPP-ZAP-40 · 1 unidad", "41 · EPP-ZAP-41 · 2 unidades", "42 · EPP-ZAP-42 · 3 unidades · talla habitual", "43 · EPP-ZAP-43 · 4 unidades",
    ])
    // Ninguna otra talla queda deshabilitada: la entrega excepcional es válida.
    expect(options.filter((option) => option.hasAttribute("disabled"))).toHaveLength(0)
  })

  it("avisa cuando la talla habitual no tiene stock en la bodega", () => {
    renderWithSizes({ workerOverrides: { sizeShoe: "45" } })
    fireEvent.change(screen.getAllByTestId("select")[1]!, { target: { value: "worker-1" } })
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })

    expect(screen.getByText("Talla habitual 45: sin stock en esta bodega.")).toBeDefined()
  })

  it("no ofrece dos veces la misma talla ya agregada a la entrega", () => {
    renderWithSizes()
    fireEvent.change(screen.getAllByTestId("select")[1]!, { target: { value: "worker-1" } })
    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })
    fireEvent.change(screen.getAllByTestId("select")[3]!, { target: { value: "shoe-42" } })
    fireEvent.change(screen.getByLabelText("Cantidad (máx. 3 unidades)"), { target: { value: "1" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })
    const options = [...screen.getAllByTestId("select")[3]!.querySelectorAll("option")]
    const added = options.find((option) => option.getAttribute("value") === "shoe-42")!
    expect(added).toHaveAttribute("disabled")
    expect(added.textContent).toBe("42 · EPP-ZAP-42 · 3 unidades · ya agregada")
    // Las demás tallas del mismo producto siguen disponibles.
    expect(options.filter((option) => option.hasAttribute("disabled"))).toHaveLength(1)
  })

  it("no mezcla el stock de otra bodega en las tallas ofrecidas", () => {
    render(
      <DeliveryForm
        today="2026-08-31"
        worksites={[
          { id: "faena-1", name: "Faena Santa Fe" },
          { id: "faena-2", name: "Faena Arauco" },
        ]}
        workers={[worker()]}
        stockProducts={[
          ...shoeStock("faena-1"),
          {
            sourceWorksiteId: "faena-2",
            productId: "shoe-45",
            productName: "Zapato de seguridad SteelPro",
            productSku: "EPP-ZAP-45",
            isEpp: true,
            unitOfMeasure: "unidad",
            stockQuantity: 99,
            familyId: "fam-shoe",
            familyName: "Zapato de seguridad SteelPro",
            sizeLabel: "45",
            sizeAttributeName: "Talla calzado",
          },
        ]}
        initialSourceWorksiteId="faena-1"
      />,
    )

    fireEvent.change(screen.getAllByTestId("select")[2]!, { target: { value: "fam-shoe" } })
    expect([...screen.getAllByTestId("select")[3]!.querySelectorAll("option")]
      .map((option) => option.getAttribute("value")))
      .toEqual(["shoe-40", "shoe-41", "shoe-42", "shoe-43"])
  })
})
