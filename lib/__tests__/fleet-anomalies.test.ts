import { describe, expect, it, vi } from "vitest"
import { uploadFleetDocument, deleteFleetDocument, type UploadFleetDocumentInput } from "@/lib/services/fleet"

// Mock audit and db
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

const mockFindFirstVehicle = vi.fn()
const mockFindFirstDoc = vi.fn()
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(true) })
const mockDelete = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(true) })

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelVehicles: {
        findFirst: (...args: unknown[]) => mockFindFirstVehicle(...args),
      },
      fleetVehicleDocuments: {
        findFirst: (...args: unknown[]) => mockFindFirstDoc(...args),
      },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

describe("Fleet Document Management (uploadFleetDocument / deleteFleetDocument)", () => {
  const dummySession: any = {
    user: { id: "user-1", email: "admin@chome.cl" },
  }

  it("validates required input parameters when uploading fleet document", async () => {
    const invalidInput: UploadFleetDocumentInput = {
      vehicleId: "",
      documentType: "SOAP",
      fileName: "soap.pdf",
      filePath: "/storage/soap.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    }

    await expect(uploadFleetDocument(invalidInput, dummySession, "all")).rejects.toThrow("Vehículo requerido")
  })

  it("validates vehicle existence when uploading fleet document", async () => {
    mockFindFirstVehicle.mockResolvedValueOnce(null)

    const input: UploadFleetDocumentInput = {
      vehicleId: "veh-nonexistent",
      documentType: "SOAP",
      fileName: "soap.pdf",
      filePath: "/storage/soap.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    }

    await expect(uploadFleetDocument(input, dummySession, "all")).rejects.toThrow("Vehículo no encontrado")
  })

  it("checks worksite scope permissions on upload", async () => {
    mockFindFirstVehicle.mockResolvedValueOnce({ id: "veh-1", worksiteId: "ws-restringida" })

    const input: UploadFleetDocumentInput = {
      vehicleId: "veh-1",
      documentType: "SOAP",
      fileName: "soap.pdf",
      filePath: "/storage/soap.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    }

    await expect(uploadFleetDocument(input, dummySession, ["ws-permitida"])).rejects.toThrow("Sin acceso a la faena de este vehículo")
  })

  it("rejects deleting non-existent fleet document", async () => {
    mockFindFirstDoc.mockResolvedValueOnce(null)

    await expect(deleteFleetDocument("doc-999", dummySession, "all")).rejects.toThrow("Documento no encontrado")
  })
})
