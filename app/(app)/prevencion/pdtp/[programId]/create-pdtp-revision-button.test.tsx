// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("../actions", () => ({ createPdtpRevisionAction: vi.fn() }))

import { CreatePdtpRevisionButton } from "./create-pdtp-revision-button"

describe("CreatePdtpRevisionButton", () => {
  it("ofrece crear una nueva revisión del programa", () => {
    render(<CreatePdtpRevisionButton sourceProgramId="p1" />)
    expect(screen.getByRole("button", { name: /crear revisi/i })).toBeInTheDocument()
  })
})
