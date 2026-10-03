// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"
import { scrollToWhenReady, WorkspaceLink } from "./workspace-nav"

const HREF = "/prevencion/miper/m1?tarea=k"

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ""
  sessionStorage.clear()
})

describe("WorkspaceLink", () => {
  it("un clic normal usa pushState y previene la navegación", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    render(<WorkspaceLink href={HREF}>Carga</WorkspaceLink>)
    expect(fireEvent.click(screen.getByRole("link", { name: "Carga" }))).toBe(false)
    expect(push).toHaveBeenCalledWith(null, "", HREF)
  })

  it("ctrl+clic y clic medio no navegan por historial", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    render(<WorkspaceLink href={HREF}>Carga</WorkspaceLink>)
    const link = screen.getByRole("link", { name: "Carga" })
    link.addEventListener("click", (event) => event.preventDefault())
    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { button: 1 })
    expect(push).not.toHaveBeenCalled()
  })

  it("no intercepta target distinto de _self ni download", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    render(<><WorkspaceLink href={HREF} target="_blank">Nueva</WorkspaceLink><WorkspaceLink href={HREF} download>Bajar</WorkspaceLink></>)
    for (const name of ["Nueva", "Bajar"]) {
      const link = screen.getByRole("link", { name })
      link.addEventListener("click", (event) => event.preventDefault())
      fireEvent.click(link)
    }
    expect(push).not.toHaveBeenCalled()
  })

  it("con replace usa replaceState", () => {
    const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    render(<WorkspaceLink href={HREF} replace>Carga</WorkspaceLink>)
    fireEvent.click(screen.getByRole("link", { name: "Carga" }))
    expect(replace).toHaveBeenCalledWith(null, "", HREF)
    expect(push).not.toHaveBeenCalled()
  })

  it("al hacer push sube el pozo del shell al inicio", () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {})
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    const scrollTo = vi.fn()
    well.scrollTo = scrollTo
    document.body.appendChild(well)
    render(<WorkspaceLink href={HREF}>Carga</WorkspaceLink>)
    fireEvent.click(screen.getByRole("link", { name: "Carga" }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it("push y replace guardan el scroll de la vista que se deja y olvidan el del destino; sólo push sube el pozo", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?buscar=cami")
    // Los dos cambian la URL de verdad: así la prueba distingue «la vista que se deja» de «el destino».
    const realReplace = window.history.replaceState.bind(window.history)
    const push = vi.spyOn(window.history, "pushState").mockImplementation((_state, _unused, url) => realReplace(null, "", url))
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, url) => realReplace(null, "", url))
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 480
    const scrollTo = vi.fn(() => { well.scrollTop = 0 })
    well.scrollTo = scrollTo as unknown as typeof well.scrollTo
    document.body.appendChild(well)
    // Claves viejas de los dos destinos: tienen que desaparecer.
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?paso=x", "90")
    sessionStorage.setItem(`miper:scroll:${HREF}`, "300")
    render(<><WorkspaceLink href={HREF}>Carga</WorkspaceLink><WorkspaceLink href="/prevencion/miper/m1?paso=x" replace>Paso</WorkspaceLink></>)

    // replace (cambiar de pestaña o de paso) también es ir hacia adelante.
    fireEvent.click(screen.getByRole("link", { name: "Paso" }))
    expect(replace).toHaveBeenCalledWith(null, "", "/prevencion/miper/m1?paso=x")
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?buscar=cami")).toBe("480")
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?paso=x")).toBeNull()
    expect(scrollTo).not.toHaveBeenCalled()

    // push desde la vista nueva: guarda ANTES de cambiar de URL y de subir el pozo.
    fireEvent.click(screen.getByRole("link", { name: "Carga" }))
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?paso=x")).toBe("480")
    expect(sessionStorage.getItem(`miper:scroll:${HREF}`)).toBeNull()
    expect(push).toHaveBeenCalledWith(null, "", HREF)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it("restoreScroll guarda el scroll que se deja pero conserva el del destino: es un «volver»", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?tarea=k")
    const realReplace = window.history.replaceState.bind(window.history)
    vi.spyOn(window.history, "pushState").mockImplementation((_state, _unused, url) => realReplace(null, "", url))
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 120
    well.scrollTo = vi.fn() as unknown as typeof well.scrollTo
    document.body.appendChild(well)
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1", "700")
    render(<WorkspaceLink href="/prevencion/miper/m1" restoreScroll>Volver</WorkspaceLink>)
    fireEvent.click(screen.getByRole("link", { name: "Volver" }))
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k")).toBe("120")
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1")).toBe("700")
  })

  it("funciona dentro de Button asChild como un único <a>", () => {
    const { container } = render(<Button asChild><WorkspaceLink href={HREF}>Ir</WorkspaceLink></Button>)
    expect(container.querySelectorAll("a")).toHaveLength(1)
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector("a")!.className.length).toBeGreaterThan(0)
  })
})

describe("scrollToWhenReady", () => {
  it("espera a que la vista pinte el destino, lo lleva a la vista y le pasa el foco a su botón", () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    try {
      scrollToWhenReady("destino")
      frames.shift()!(0) // primer cuadro: el destino todavía no existe
      const target = document.createElement("h2")
      target.id = "destino"
      target.innerHTML = "<button type=\"button\">Actividad</button>"
      target.scrollIntoView = vi.fn()
      document.body.appendChild(target)
      frames.shift()!(0) // segundo cuadro: ya está
      expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" })
      expect(document.activeElement).toBe(target.querySelector("button"))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("si el destino nunca aparece, se rinde sin error", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0 })
    try {
      expect(() => scrollToWhenReady("no-existe", 3)).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
