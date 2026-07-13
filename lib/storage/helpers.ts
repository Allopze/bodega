/**
 * Thin server-only wrappers for filesystem operations.
 *
 * Everything that touches node:fs / node:path lives here so that
 * Turbopack's NFT tracing can see a single, well-defined boundary
 * instead of chasing `fs` through business-logic services.
 */
import { promises as fs } from "node:fs"

export async function mkdirp(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function writeBuffer(filePath: string, buffer: Buffer): Promise<void> {
  await fs.writeFile(filePath, buffer)
}

export async function readBuffer(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath)
}

export async function removeFile(filePath: string): Promise<void> {
  await fs.unlink(filePath)
}
