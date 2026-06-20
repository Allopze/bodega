// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { INITIAL_STATE } from "@/components/admin/form-state"

const mockTestSmtpAction = vi.hoisted(() => vi.fn())

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("./actions", () => ({
  updateSmtpConfigAction: vi.fn(async () => INITIAL_STATE),
  testSmtpAction: mockTestSmtpAction,
  setEmailsEnabledAction: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ label }: { label: string }) => <button type="submit">{label}</button>,
}))

import { SmtpPageForms } from "./smtp-form"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SmtpPageForms", () => {
  it("builds test FormData from the SMTP form when the test button is clicked", async () => {
    mockTestSmtpAction.mockResolvedValueOnce({ ok: true, message: "ok" })

    render(
      <SmtpPageForms
        initialEmailsEnabled
        initialSmtpConfig={{
          source: "db",
          host:   "smtp.example.cl",
          port:   587,
          secure: false,
          user:   "bot@example.cl",
          pass:   "",
          from:   "Chome <bot@example.cl>",
        }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Enviar correo de prueba" }))

    await waitFor(() => expect(mockTestSmtpAction).toHaveBeenCalledOnce())
    const formData = mockTestSmtpAction.mock.calls[0]?.[1]
    expect(formData).toBeInstanceOf(FormData)
    expect(formData.get("smtpHost")).toBe("smtp.example.cl")
  })
})
