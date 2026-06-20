/**
 * Tests for lib/storage/helpers.ts
 *
 * These functions wrap node:fs operations. We mock fs to avoid
 * touching the real filesystem in unit tests.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const mockMkdir   = vi.hoisted(() => vi.fn())
const mockWrite   = vi.hoisted(() => vi.fn())
const mockUnlink  = vi.hoisted(() => vi.fn())

vi.mock("node:fs", () => ({
  promises: {
    mkdir:    mockMkdir,
    writeFile: mockWrite,
    unlink:   mockUnlink,
  },
}))

import { mkdirp, writeBuffer, removeFile } from "@/lib/storage/helpers"

describe("mkdirp", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("creates directory recursively", async () => {
    mockMkdir.mockResolvedValue(undefined)
    await mkdirp("/tmp/test/deep/dir")
    expect(mockMkdir).toHaveBeenCalledWith("/tmp/test/deep/dir", { recursive: true })
  })

  it("forwards errors from fs.mkdir", async () => {
    mockMkdir.mockRejectedValue(new Error("EACCES"))
    await expect(mkdirp("/restricted")).rejects.toThrow("EACCES")
  })
})

describe("writeBuffer", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("writes buffer to file path", async () => {
    mockWrite.mockResolvedValue(undefined)
    const buf = Buffer.from("hello")
    await writeBuffer("/tmp/test/file.bin", buf)
    expect(mockWrite).toHaveBeenCalledWith("/tmp/test/file.bin", buf)
  })

  it("forwards errors from fs.writeFile", async () => {
    mockWrite.mockRejectedValue(new Error("ENOSPC"))
    await expect(writeBuffer("/full", Buffer.from("x"))).rejects.toThrow("ENOSPC")
  })
})

describe("removeFile", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("unlinks file path", async () => {
    mockUnlink.mockResolvedValue(undefined)
    await removeFile("/tmp/test/file.txt")
    expect(mockUnlink).toHaveBeenCalledWith("/tmp/test/file.txt")
  })

  it("forwards errors from fs.unlink", async () => {
    mockUnlink.mockRejectedValue(new Error("ENOENT"))
    await expect(removeFile("/gone")).rejects.toThrow("ENOENT")
  })
})
