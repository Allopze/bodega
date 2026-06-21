import { describe, it, expect, vi, beforeEach } from "vitest"
import { recordAudit, recordStatusChange, cleanupOldAuditLog, archiveOldInventoryMovements } from "../audit"
import { auditLog, statusHistory } from "@/db/schema"

const mockValues = vi.fn().mockResolvedValue(undefined)
const mockInsert = vi.fn((_table?: unknown) => ({ values: mockValues }))
const mockExecute = vi.fn()

vi.mock("@/db", () => ({
  db: {
    insert: (table: unknown) => mockInsert(table),
    execute: (query: unknown) => mockExecute(query),
  },
}))

describe("audit helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValues.mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: mockValues } as never)
  })

  describe("recordAudit", () => {
    it("calls insert and values with correct parameters", async () => {
      const params = {
        userId: "user-1",
        userEmail: "user@example.com",
        action: "create" as const,
        entityType: "request",
        entityId: "req-1",
        entityCode: "REQ-001",
        oldState: { status: "draft" },
        newState: { status: "submitted" },
        reason: "For testing",
        ipAddress: "192.168.1.1",
      }

      await recordAudit(params)

      expect(mockInsert).toHaveBeenCalledWith(auditLog)
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          userId: "user-1",
          userEmail: "user@example.com",
          action: "create",
          entityType: "request",
          entityId: "req-1",
          entityCode: "REQ-001",
          oldState: JSON.stringify(params.oldState),
          newState: JSON.stringify(params.newState),
          reason: "For testing",
          ipAddress: "192.168.1.1",
        })
      )
    })

    it("handles null states correctly", async () => {
      const params = {
        userId: null,
        action: "delete" as const,
        entityType: "request",
        entityId: "req-1",
      }

      await recordAudit(params)

      expect(mockInsert).toHaveBeenCalledWith(auditLog)
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          oldState: null,
          newState: null,
        })
      )
    })
  })

  describe("recordStatusChange", () => {
    it("calls insert and values with correct parameters", async () => {
      const params = {
        entityType: "request",
        entityId: "req-1",
        fromStatus: "draft",
        toStatus: "submitted",
        changedBy: "user-1",
        reason: "Approved by manager",
      }

      await recordStatusChange(params)

      expect(mockInsert).toHaveBeenCalledWith(statusHistory)
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          entityType: "request",
          entityId: "req-1",
          fromStatus: "draft",
          toStatus: "submitted",
          changedBy: "user-1",
          reason: "Approved by manager",
        })
      )
    })
  })

  describe("cleanupOldAuditLog", () => {
    it("throws an error if keepYears is less than 5", async () => {
      await expect(cleanupOldAuditLog(4)).rejects.toThrow("keepYears must be ≥ 5 (legal requirement DS N°44/2024)")
      expect(mockExecute).not.toHaveBeenCalled()
    })

    it("calls db.execute with the query for keepYears >= 5 and parses return value", async () => {
      mockExecute.mockResolvedValue([{ cleanup_old_audit_log: "123" }])
      
      const count = await cleanupOldAuditLog(6)
      
      expect(count).toBe(123)
      expect(mockExecute).toHaveBeenCalled()
    })

    it("returns 0 if execute response is empty or invalid", async () => {
      mockExecute.mockResolvedValue([])
      const count = await cleanupOldAuditLog(5)
      expect(count).toBe(0)
    })
  })

  describe("archiveOldInventoryMovements", () => {
    it("calls db.execute and parses return value", async () => {
      mockExecute.mockResolvedValue([{ archive_old_inventory_movements: "456" }])
      
      const count = await archiveOldInventoryMovements(12)
      
      expect(count).toBe(456)
      expect(mockExecute).toHaveBeenCalled()
    })

    it("returns 0 if execute response is empty or invalid", async () => {
      mockExecute.mockResolvedValue([])
      const count = await archiveOldInventoryMovements()
      expect(count).toBe(0)
    })
  })
})
