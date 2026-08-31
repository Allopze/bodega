import { describe, expect, it } from "vitest"

import { AppToaster } from "@/components/ui/app-toaster"

describe("AppToaster", () => {
  it("mantiene el contenido compacto y la X dentro de la esquina superior derecha", () => {
    const props = AppToaster({}).props

    expect(props.position).toBe("top-right")
    expect(props.closeButton).toBe(true)
    expect(props.containerAriaLabel).toBe("Notificaciones")
    expect(props.style).toMatchObject({ "--width": "min(400px, calc(100vw - 24px))" })
    expect(props.toastOptions.closeButtonAriaLabel).toBe("Cerrar notificación")
    expect(props.toastOptions.classNames.title).toContain("line-clamp-3")
    expect(props.toastOptions.classNames.content).toContain("min-w-0")
    expect(props.toastOptions.classNames.closeButton).toContain("!right-1")
    expect(props.toastOptions.classNames.closeButton).toContain("!left-auto")
    expect(props.toastOptions.classNames.closeButton).toContain("!transform-none")
  })

  it("permite centrar el toaster de formularios públicos sin perder el mismo diseño", () => {
    expect(AppToaster({ position: "top-center" }).props.position).toBe("top-center")
  })
})
