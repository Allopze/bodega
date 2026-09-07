// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NewCommitteeDialog } from "./cphs-dialogs"

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
