/**
 * Unit tests for admin/proveedores actions — CRUD, validation, RBAC.
 *
 * Covers:
 *  1. Permission denied
 *  2. Validation errors (missing name, RUT conflict)
 *  3. Create happy path
 *  4. Update happy path
 *  5. Toggle active
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

// El guard de módulo consulta `system_settings` en cada verificación de permiso
// (CO-007). Estas pruebas mockean sólo las tablas de su caso, así que se
// declara aquí que ningún módulo está apagado; el guard tiene sus propias
// regresiones en lib/__tests__/module-toggles.test.ts.
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
  getNavigationToggleState: vi.fn(async () => ({ enabledModuleIds: new Set<string>(), disabledSubmoduleHrefs: new Set<string>() })),
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

const mockInsertValues = vi.fn().mockResolvedValue(undefined)
const mockUpdateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))

const mockDb = {
  query: { suppliers: { findFirst: vi.fn() } },
  insert: vi.fn(() => ({ values: mockInsertValues })),
  update: vi.fn(() => ({ set: mockUpdateSet })),
}

vi.mock("@/db", () => ({ db: mockDb }))

function makeSession(perm: string): Session {
  return {
    user: {
      id: "user-1",
      name: "Admin",
      email: "admin@chome.cl",
      permissions: [perm],
      roles: ["administrador"],
      worksiteIds: [],
      isGlobal: true,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as unknown as Session
}

describe("proveedores actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.suppliers.findFirst.mockResolvedValue(null)
    mockRecordAudit.mockResolvedValue(undefined)
  })

  // ── createSupplier ──────────────────────────────────────────────────────

  describe("createSupplier", () => {
    it("denies without admin:suppliers permission", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { createSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("name", "Proveedor Test")
      const result = await createSupplier({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("rejects missing name", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      const { createSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("name", "")
      const result = await createSupplier({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.fieldErrors).toBeDefined()
    })

    it("rejects duplicate RUT", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      mockDb.query.suppliers.findFirst.mockResolvedValue({ id: "existing", rut: "12345678-9" })
      const { createSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("name", "Proveedor Test")
      fd.set("rut", "12345678-9")
      const result = await createSupplier({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.fieldErrors?.rut).toBeDefined()
    })

    it("creates supplier with valid data", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      const { createSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("name", "Proveedor Nuevo")
      fd.set("email", "contacto@proveedor.cl")
      fd.set("isActive", "on")
      const result = await createSupplier({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("creado")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: "create",
        entityType: "supplier",
      }))
    })
  })

  // ── updateSupplier ──────────────────────────────────────────────────────

  describe("updateSupplier", () => {
    it("denies without permission", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { updateSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("id", "sup-1")
      fd.set("name", "Updated")
      const result = await updateSupplier({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("rejects missing id (schema validation)", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      const { updateSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("name", "Updated")
      // No id set — FormData.get returns null, z.string().optional() rejects null
      const result = await updateSupplier({ ok: false }, fd)
      expect(result.ok).toBe(false)
      // Schema rejects null id, so it returns fieldErrors
    })

    it("returns error when supplier not found", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      mockDb.query.suppliers.findFirst.mockResolvedValue(null)
      const { updateSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("id", "nonexistent")
      fd.set("name", "Updated")
      const result = await updateSupplier({ ok: false }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("no encontrado")
    })

    it("updates supplier with valid data", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      mockDb.query.suppliers.findFirst.mockResolvedValueOnce({ id: "sup-1", name: "Old Name" })
      const { updateSupplier } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("id", "sup-1")
      fd.set("name", "New Name")
      fd.set("isActive", "on")
      const result = await updateSupplier({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("actualizado")
    })
  })

  // ── toggleSupplierActive ────────────────────────────────────────────────

  describe("toggleSupplierActive", () => {
    it("denies without permission", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { toggleSupplierActive } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("id", "sup-1")
      fd.set("activate", "true")
      const result = await toggleSupplierActive({ ok: false }, fd)
      expect(result.ok).toBe(false)
    })

    it("toggles active state", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      const { toggleSupplierActive } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("id", "sup-1")
      fd.set("activate", "true")
      const result = await toggleSupplierActive({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("activado")
    })

    it("toggles inactive state", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:suppliers"))
      const { toggleSupplierActive } = await import("@/app/(app)/admin/proveedores/actions")
      const fd = new FormData()
      fd.set("id", "sup-1")
      fd.set("activate", "false")
      const result = await toggleSupplierActive({ ok: false }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("desactivado")
    })
  })
})
