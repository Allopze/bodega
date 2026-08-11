// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DteCredentialsForm } from "./credentials-form"

vi.mock("./settings-actions", () => ({
  saveDteSettingsAction: vi.fn(async () => ({ ok: true })),
  clearDteSettingsAction: vi.fn(async () => ({ ok: true, message: "ok" })),
  convertLegacyDteSettingsAction: vi.fn(async () => ({ ok: true, message: "ok" })),
  rotateDteSettingsKeyringAction: vi.fn(async () => ({ ok: true, message: "ok" })),
}))

const status = {
  configured: true,
  syncEnabled: true,
  hasStoredSettings: true,
  cutoverComplete: false,
  source: "system_settings" as const,
  encryptionMode: "compat" as const,
  encryptionStatus: "encrypted" as const,
  canMigrateLegacy: false,
  fields: {
    rutUsr: { configured: true, source: "system_settings" as const },
    rutEmp: { configured: true, source: "system_settings" as const },
    clave: { configured: true, source: "system_settings" as const },
    codEmp: { configured: true, source: "system_settings" as const },
    importerEmail: { configured: true, source: "system_settings" as const },
  },
}

describe("DteCredentialsForm", () => {
  it("renders a safe status DTO without serializing effective credential values", () => {
    const { container } = render(<DteCredentialsForm status={status} />)

    expect(screen.getByLabelText("RUT del usuario")).toHaveValue("")
    expect(screen.getByLabelText("RUT de la empresa")).toHaveValue("")
    expect(screen.getByLabelText("Código de empresa (CodEmp)")).toHaveValue("")
    expect(screen.getByLabelText("Email del usuario técnico (importer)")).toHaveValue("")
    expect(container.innerHTML).not.toContain("DTE_PORTAL_CLAVE")
    expect(screen.queryByLabelText("URL base del portal")).not.toBeInTheDocument()
  })

  it("makes clear that re-ciphering the keyring preserves the portal credentials", () => {
    render(<DteCredentialsForm status={{
      ...status,
      cutoverComplete: true,
      encryptionMode: "encrypted_only",
      encryptionStatus: "encrypted_only",
    }} />)

    expect(screen.getByRole("heading", { name: "Re-cifrado del keyring" })).toBeInTheDocument()
    expect(screen.getByText(/no cambia el RUT, la contraseña, CodEmp ni el email técnico del portal/i)).toBeInTheDocument()
  })
})
