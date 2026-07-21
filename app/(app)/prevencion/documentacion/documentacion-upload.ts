import { createAndUploadSstDocumentAction, createSstDocumentFolderAction } from "./actions"

type GeneralLibraryDataClass = "operational" | "personal" | "sensitive_preventive" | "client_secret"

/**
 * Sube archivos o una carpeta completa creando un documento por archivo. La
 * caché guarda promesas para que cargas concurrentes que comparten ruta creen
 * cada carpeta una sola vez. Cuatro workers limitan la presión sobre acciones y
 * storage sin serializar lotes grandes.
 */
export async function uploadFilesAsDocuments(
  files: File[],
  currentFolderId: string | null,
  dataClass: GeneralLibraryDataClass,
  onProgress: (done: number, failed: number) => void,
): Promise<void> {
  const folderCache = new Map<string, Promise<string | null>>()
  folderCache.set("", Promise.resolve(currentFolderId ?? null))

  const ensureFolder = (dirPath: string): Promise<string | null> => {
    const cached = folderCache.get(dirPath)
    if (cached) return cached

    const creation = (async () => {
      const parts = dirPath.split("/")
      const name = parts[parts.length - 1] ?? ""
      const parentId = await ensureFolder(parts.slice(0, -1).join("/"))
      const result = await createSstDocumentFolderAction({ name, parentId })
      if (!result.ok || !result.data?.id) {
        throw new Error(result.message ?? `No se pudo crear la carpeta ${name}.`)
      }
      return result.data.id
    })()
    folderCache.set(dirPath, creation)
    void creation.catch(() => folderCache.delete(dirPath))
    return creation
  }

  let done = 0
  let failed = 0
  const uploadOne = async (file: File) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ""
    const dirPath = relativePath.includes("/") ? relativePath.split("/").slice(0, -1).join("/") : ""
    try {
      const folderId = await ensureFolder(dirPath)
      const formData = new FormData()
      formData.set("file", file)
      formData.set("title", file.name.replace(/\.[^.]+$/, ""))
      formData.set("dataClass", dataClass)
      if (folderId) formData.set("folderId", folderId)
      const result = await createAndUploadSstDocumentAction(formData)
      if (!result.ok) failed += 1
    } catch {
      failed += 1
    }
    done += 1
    onProgress(done, failed)
  }

  const concurrency = Math.min(4, files.length)
  const runWorker = async (index: number): Promise<void> => {
    if (index >= files.length) return
    await uploadOne(files[index]!)
    return runWorker(index + concurrency)
  }
  await Promise.all(Array.from({ length: concurrency }, (_, index) => runWorker(index)))
}
