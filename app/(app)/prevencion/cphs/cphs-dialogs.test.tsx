// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { CphsCreateButton, NewCommitteeDialog } from "./cphs-dialogs"

afterEach(cleanup)

describe("NewCommitteeDialog", () => {
  it("preselecciona la faena recibida desde la tarea preventiva", () => {
    render(<NewCommitteeDialog
      worksites={[
        { id: "ws-a", name: "Faena A" },
        { id: "ws-b", name: "Faena B" },
      ]}
      initialWorksiteId="ws-b"
    />)

    fireEvent.click(screen.getByRole("button", { name: "Nuevo comité" }))

    expect(document.querySelector('input[name="worksiteId"]')).toHaveValue("ws-b")
  })
})

describe("CphsCreateButton — un solo Nuevo en el header", () => {
  const worksites = [{ id: "ws-a", name: "Faena A" }, { id: "ws-b", name: "Faena B" }]

  it("con sólo cphs:manage abre directo la constitución del comité", () => {
    render(<CphsCreateButton worksites={worksites} initialWorksiteId="ws-b" canManage canReview={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Nuevo comité" }))
    expect(screen.getByRole("dialog", { name: "Constituir comité paritario" })).toBeInTheDocument()
    expect(document.querySelector('input[name="worksiteId"]')).toHaveValue("ws-b")
  })

  it("con los dos permisos pregunta qué crear; la revisión abre con la fecha prellenada", async () => {
    render(<CphsCreateButton worksites={worksites} canManage canReview />)
    fireEvent.click(screen.getByRole("button", { name: "Nuevo" }))
    const chooser = screen.getByRole("dialog", { name: "¿Qué quieres crear?" })
    expect(within(chooser).getAllByRole("button", { name: /Comité paritario|Revisión por la dirección/ })).toHaveLength(2)
    fireEvent.click(within(chooser).getByRole("button", { name: /Revisión por la dirección/ }))

    const dialog = await screen.findByRole("dialog", { name: "Nueva revisión por la dirección" })
    // Abierto sin `DialogTrigger`, el "parte de cero al abrir" corre igual.
    await waitFor(() => expect(within(dialog).getByLabelText("Realizada el")).not.toHaveValue(""))
  })

  it("sin permisos de alta no hay botón", () => {
    const { container } = render(<CphsCreateButton worksites={worksites} canManage={false} canReview={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
