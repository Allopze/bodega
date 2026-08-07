// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it } from "vitest"
import { DeliveryFormReturn } from "@/app/(app)/entregas/delivery-form-return"

/**
 * La sección "Devolver EPP antiguo" se pliega con CSS, pero el formulario se
 * serializa desde el DOM: si los campos plegados siguen habilitados, se
 * persiste una devolución que la persona canceló y el comprobante firmado sale
 * con un EPP fantasma.
 */
function submittedNames(showReturn: boolean): string[] {
  const { container } = render(
    <form>
      <DeliveryFormReturn
        showReturn={showReturn}
        returnProductId=""
        setReturnProductId={() => {}}
        returnProducts={[{ id: "p-1", name: "Casco", sku: "SKU-1", unitOfMeasure: "un" }]}
        returnSectionRef={createRef<HTMLDivElement>()}
      />
    </form>,
  )
  const form = container.querySelector("form")!
  form.querySelector<HTMLInputElement>('input[name="returnQuantity"]')!.value = "1"
  form.querySelector<HTMLTextAreaElement>('textarea[name="returnNotes"]')!.value = "Roto"
  return [...new FormData(form).keys()]
}

describe("DeliveryFormReturn", () => {
  it("envía los campos de devolución cuando la sección está abierta", () => {
    expect(submittedNames(true)).toContain("returnQuantity")
  })

  it("no envía ningún campo cuando la sección está plegada", () => {
    expect(submittedNames(false)).toEqual([])
  })
})
