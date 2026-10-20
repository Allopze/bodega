// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChoiceCardGroup } from "./choice-card-group"

const OPTIONS = [{ value: "yes", title: "Sí" }, { value: "partial", title: "Parcialmente" }, { value: "no", title: "No" }] as const

describe("ChoiceCardGroup", () => {
  it("es un radiogroup con una sola tarjeta tabulable y avisa al elegir otra", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="¿Está controlado?" options={[...OPTIONS]} value="partial" onChange={onChange} />)
    const radios = screen.getAllByRole("radio")
    expect(screen.getByRole("radiogroup", { name: "¿Está controlado?" })).toBeTruthy()
    expect(radios.map((radio) => radio.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"])
    fireEvent.click(screen.getByRole("radio", { name: "Parcialmente" }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("radio", { name: "No" }))
    expect(onChange).toHaveBeenCalledWith("no")
  })
  it("las flechas mueven la selección y dan la vuelta", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="no" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "No" }), { key: "ArrowRight" })
    expect(onChange).toHaveBeenCalledWith("yes")
  })

  it("el nombre de cada tarjeta es su título; el criterio va como descripción accesible", () => {
    render(<ChoiceCardGroup label="Probabilidad" options={[{ value: 1, title: "1 · Baja", description: "Rara vez." }, { value: 2, title: "2 · Media", description: "A veces." }]} value={null} onChange={vi.fn()} />)
    const baja = screen.getByRole("radio", { name: "1 · Baja" })
    expect(baja).toHaveAccessibleDescription("Rara vez.")
  })

  it("Home y End llevan a la primera y a la última y mueven el foco", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="partial" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "Parcialmente" }), { key: "End" })
    expect(onChange).toHaveBeenLastCalledWith("no")
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "No" }))
    fireEvent.keyDown(screen.getByRole("radio", { name: "Parcialmente" }), { key: "Home" })
    expect(onChange).toHaveBeenLastCalledWith("yes")
  })

  it("Home sobre la ya elegida no vuelve a avisar (cada aviso es un guardado)", () => {
    const onChange = vi.fn()
    render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="yes" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "Sí" }), { key: "Home" })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("la variante por defecto sigue siendo la de tarjetas: tres columnas y sin ícono de check", () => {
    const { container } = render(<ChoiceCardGroup label="g" options={[...OPTIONS]} value="yes" onChange={vi.fn()} />)
    const group = screen.getByRole("radiogroup", { name: "g" })
    expect(group.className).toContain("sm:grid-cols-3")
    expect(group.className).not.toContain("auto-fit")
    expect(container.querySelector("svg")).toBeNull()
  })

  it("acepta aria-labelledby en lugar de label", () => {
    render(
      <>
        <p id="rotulo">Resultado de Manómetro</p>
        <ChoiceCardGroup aria-labelledby="rotulo" options={[...OPTIONS]} value={null} onChange={vi.fn()} />
      </>,
    )
    const group = screen.getByRole("radiogroup", { name: "Resultado de Manómetro" })
    expect(group.getAttribute("aria-labelledby")).toBe("rotulo")
    expect(group.hasAttribute("aria-label")).toBe(false)
  })

  describe("variant compact", () => {
    const COMPACT = [
      { value: "conforming", title: "Cumple", tone: "positive" as const },
      { value: "non_conforming", title: "No cumple", tone: "negative" as const },
      { value: "not_applicable", title: "No aplica", tone: "neutral" as const },
    ]

    it("usa la rejilla auto-fit y botones de 44 px en móvil y 36 px desde sm", () => {
      render(<ChoiceCardGroup variant="compact" label="Resultado" options={COMPACT} value={null} onChange={vi.fn()} />)
      const group = screen.getByRole("radiogroup", { name: "Resultado" })
      expect(group.className).toContain("grid-cols-[repeat(auto-fit,minmax(5rem,1fr))]")
      expect(group.className).toContain("gap-1.5")
      const radio = screen.getByRole("radio", { name: "Cumple" })
      expect(radio.className).toContain("min-h-11")
      expect(radio.className).toContain("sm:min-h-9")
      expect(radio.className).toContain("border-[var(--color-border-control)]")
    })

    it("elige por clic una sola vez: la ya elegida no vuelve a avisar", () => {
      const onChange = vi.fn()
      render(<ChoiceCardGroup variant="compact" label="Resultado" options={COMPACT} value="conforming" onChange={onChange} />)
      fireEvent.click(screen.getByRole("radio", { name: "Cumple" }))
      expect(onChange).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole("radio", { name: "No cumple" }))
      expect(onChange).toHaveBeenCalledWith("non_conforming")
    })

    it("flechas, Home y End mueven la elección y el foco, y sólo la elegida es tabulable", () => {
      const onChange = vi.fn()
      render(<ChoiceCardGroup variant="compact" label="Resultado" options={COMPACT} value="non_conforming" onChange={onChange} />)
      expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"])
      fireEvent.keyDown(screen.getByRole("radio", { name: "No cumple" }), { key: "ArrowRight" })
      expect(onChange).toHaveBeenLastCalledWith("not_applicable")
      expect(document.activeElement).toBe(screen.getByRole("radio", { name: "No aplica" }))
      fireEvent.keyDown(screen.getByRole("radio", { name: "No cumple" }), { key: "ArrowLeft" })
      expect(onChange).toHaveBeenLastCalledWith("conforming")
      fireEvent.keyDown(screen.getByRole("radio", { name: "No cumple" }), { key: "End" })
      expect(onChange).toHaveBeenLastCalledWith("not_applicable")
      fireEvent.keyDown(screen.getByRole("radio", { name: "No cumple" }), { key: "Home" })
      expect(onChange).toHaveBeenLastCalledWith("conforming")
    })

    it.each([
      ["conforming", "success"],
      ["non_conforming", "danger"],
      ["partial", "warning"],
    ] as const)("la opción elegida %s usa la tinta del tono %s, un anillo y un check", (value, token) => {
      // «Regular» (escala B/R/M) es el tono ámbar: no es conforme ni incumple del todo.
      const options = [...COMPACT, { value: "partial", title: "Regular", tone: "warning" as const }]
      const { container } = render(<ChoiceCardGroup variant="compact" label="Resultado" options={options} value={value} onChange={vi.fn()} />)
      const selected = screen.getByRole("radio", { checked: true })
      expect(selected.className).toContain(`text-[var(--color-${token}-ink)]`)
      expect(selected.className).toContain(`bg-[var(--color-${token}-tint)]`)
      expect(selected.className).toContain(`border-[var(--color-${token}-line)]`)
      expect(selected.className).toContain("ring-2")
      // El check sólo aparece en la elegida: la selección no depende del color.
      expect(selected.querySelector("svg")).not.toBeNull()
      expect(container.querySelectorAll("svg")).toHaveLength(1)
    })

    it("sin tono la elegida es neutra y las demás no llevan anillo ni check", () => {
      const { container } = render(
        <ChoiceCardGroup variant="compact" label="Resultado" options={[{ value: "a", title: "A" }, { value: "b", title: "B" }]} value="a" onChange={vi.fn()} />,
      )
      const selected = screen.getByRole("radio", { name: "A" })
      expect(selected.className).toContain("text-[var(--color-text)]")
      expect(selected.className).toContain("ring-2")
      const other = screen.getByRole("radio", { name: "B" })
      expect(other.className).not.toContain("ring-2")
      expect(other.querySelector("svg")).toBeNull()
      expect(container.querySelectorAll("svg")).toHaveLength(1)
    })

    it("aria-labelledby nombra al grupo y la descripción va como descripción accesible", () => {
      render(
        <>
          <span id="rotulo-compacto">Estado de la prenda</span>
          <ChoiceCardGroup
            variant="compact"
            aria-labelledby="rotulo-compacto"
            options={[{ value: "ok", title: "Bueno", description: "Sin daño visible.", tone: "positive" }, { value: "bad", title: "Malo", tone: "negative" }]}
            value={null}
            onChange={vi.fn()}
          />
        </>,
      )
      expect(screen.getByRole("radiogroup", { name: "Estado de la prenda" })).toBeTruthy()
      expect(screen.getByRole("radio", { name: "Bueno" })).toHaveAccessibleDescription("Sin daño visible.")
    })

    it("aria-describedby y required se pasan al grupo para anunciar el error y la obligatoriedad", () => {
      render(
        <>
          <p id="problema">Indica el motivo.</p>
          <ChoiceCardGroup variant="compact" label="Resultado" aria-describedby="problema" required options={COMPACT} value="non_conforming" onChange={vi.fn()} />
        </>,
      )
      const group = screen.getByRole("radiogroup", { name: "Resultado" })
      expect(group).toHaveAccessibleDescription("Indica el motivo.")
      expect(group).toHaveAttribute("aria-required", "true")
    })

    it("deshabilitado no avisa ni por clic ni por teclado", () => {
      const onChange = vi.fn()
      render(<ChoiceCardGroup variant="compact" label="Resultado" options={COMPACT} value="conforming" onChange={onChange} disabled />)
      fireEvent.click(screen.getByRole("radio", { name: "No cumple" }))
      fireEvent.keyDown(screen.getByRole("radio", { name: "Cumple" }), { key: "ArrowRight" })
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
