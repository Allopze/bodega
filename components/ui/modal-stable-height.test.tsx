// @vitest-environment jsdom
import * as React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { INITIAL_STATE } from "@/lib/form-state"

/**
 * `stableHeight` es la garantía de que la caja de un modal no mide su
 * contenido. Si alguien la reemplaza por un `max-h` «porque se ve igual», estos
 * casos fallan antes de que la regresión llegue a la pantalla: con `max-h` el
 * modal vuelve a crecer y encogerse al cambiar de vista.
 */
afterEach(cleanup)

/** Clases exactas: `toContain` confundiría `h-[…]` con el `max-h-[…]` que lo contiene. */
function classesOf(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter(Boolean)
}

function dialogContent(): HTMLElement {
  return screen.getByRole("dialog")
}

describe("SheetContent stableHeight", () => {
  it("fija el alto y no deja la cota como max-height", () => {
    render(
      <Sheet open>
        <SheetContent stableHeight>
          <SheetTitle>Alto estable</SheetTitle>
        </SheetContent>
      </Sheet>,
    )

    const classes = classesOf(dialogContent())
    expect(classes).toContain("sm:h-[min(85vh,56rem)]")
    expect(classes).not.toContain("sm:max-h-[min(85vh,56rem)]")
  })

  it("sin la prop conserva el comportamiento anterior", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Alto según contenido</SheetTitle>
        </SheetContent>
      </Sheet>,
    )

    const classes = classesOf(dialogContent())
    expect(classes).toContain("sm:max-h-[min(85vh,56rem)]")
    expect(classes).not.toContain("sm:h-[min(85vh,56rem)]")
  })

  it("un alto más justo por className gana sobre la cota por defecto", () => {
    render(
      <Sheet open>
        <SheetContent stableHeight className="sm:h-[34rem]">
          <SheetTitle>Alto calibrado</SheetTitle>
        </SheetContent>
      </Sheet>,
    )

    const classes = classesOf(dialogContent())
    expect(classes).toContain("sm:h-[34rem]")
    expect(classes).not.toContain("sm:h-[min(85vh,56rem)]")
  })
})

describe("DialogContent stableHeight", () => {
  it("fija el alto y no deja la cota como max-height", () => {
    render(
      <Dialog open>
        <DialogContent stableHeight>
          <DialogTitle>Alto estable</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    const classes = classesOf(dialogContent())
    expect(classes).toContain("h-[min(90dvh,54rem)]")
    expect(classes).not.toContain("max-h-[min(90dvh,54rem)]")
  })

  it("sin la prop conserva el comportamiento anterior", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Alto según contenido</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    const classes = classesOf(dialogContent())
    expect(classes).toContain("max-h-[min(90dvh,54rem)]")
    expect(classes).not.toContain("h-[min(90dvh,54rem)]")
  })
})

describe("CatalogFormSheet", () => {
  it("reenvía stableHeight al SheetContent", () => {
    const action = async () => INITIAL_STATE
    render(
      <CatalogFormSheet
        open
        onClose={() => {}}
        isEdit={false}
        title="Nuevo equipo"
        create={action}
        update={action}
        submitLabel="Crear equipo"
        successMessage="Equipo creado"
        stableHeight
      >
        {() => <div />}
      </CatalogFormSheet>,
    )

    expect(classesOf(dialogContent())).toContain("sm:h-[min(85vh,56rem)]")
  })
})
