import {
  FileArchive,
  FileAudio,
  FileCode,
  FileCss,
  FileCsv,
  FileDoc,
  FileHtml,
  FileImage,
  FileJpg,
  FileJs,
  FileMd,
  FilePdf,
  FilePng,
  FilePpt,
  FileSvg,
  FileText,
  FileTs,
  FileTsx,
  FileTxt,
  FileVideo,
  FileXls,
  type IconProps,
} from "@phosphor-icons/react"
import * as React from "react"

export type FileIconDescriptor = {
  Icon: React.ComponentType<IconProps>
  label: string
  /** CSS color (oklch / var / hex). Use the project's design tokens. */
  color: string
}

function byExtension(name: string, fallback: FileIconDescriptor): FileIconDescriptor {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  switch (ext) {
    case "pdf":
      return { Icon: FilePdf, label: "PDF", color: "oklch(0.55 0.18 27)" }
    case "doc":
    case "docx":
    case "rtf":
      return { Icon: FileDoc, label: "Word", color: "oklch(0.50 0.15 250)" }
    case "xls":
    case "xlsx":
    case "ods":
      return { Icon: FileXls, label: "Excel", color: "var(--color-success)" }
    case "ppt":
    case "pptx":
    case "odp":
      return { Icon: FilePpt, label: "PowerPoint", color: "oklch(0.65 0.16 62)" }
    case "csv":
      return { Icon: FileCsv, label: "CSV", color: "var(--color-success)" }
    case "txt":
      return { Icon: FileTxt, label: "Texto", color: "var(--color-text-muted)" }
    case "md":
    case "markdown":
      return { Icon: FileMd, label: "Markdown", color: "var(--color-text)" }
    case "html":
    case "htm":
      return { Icon: FileHtml, label: "HTML", color: "oklch(0.55 0.15 30)" }
    case "css":
    case "scss":
    case "sass":
    case "less":
      return { Icon: FileCss, label: "CSS", color: "oklch(0.55 0.15 280)" }
    case "js":
    case "mjs":
    case "cjs":
      return { Icon: FileJs, label: "JavaScript", color: "oklch(0.70 0.15 80)" }
    case "ts":
      return { Icon: FileTs, label: "TypeScript", color: "oklch(0.55 0.13 240)" }
    case "tsx":
    case "jsx":
      return { Icon: FileTsx, label: "React", color: "oklch(0.55 0.13 240)" }
    case "json":
    case "xml":
    case "yml":
    case "yaml":
      return { Icon: FileCode, label: "Código", color: "var(--color-text-muted)" }
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return { Icon: FileArchive, label: "Comprimido", color: "var(--color-text-muted)" }
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
    case "m4a":
      return { Icon: FileAudio, label: "Audio", color: "oklch(0.55 0.12 195)" }
    case "mp4":
    case "mov":
    case "avi":
    case "mkv":
    case "webm":
      return { Icon: FileVideo, label: "Video", color: "oklch(0.55 0.18 340)" }
    case "svg":
      return { Icon: FileSvg, label: "SVG", color: "oklch(0.55 0.15 280)" }
    case "png":
      return { Icon: FilePng, label: "PNG", color: "oklch(0.55 0.18 290)" }
    case "jpg":
    case "jpeg":
      return { Icon: FileJpg, label: "JPEG", color: "oklch(0.55 0.18 290)" }
    case "gif":
    case "webp":
    case "bmp":
    case "avif":
    case "heic":
      return { Icon: FileImage, label: "Imagen", color: "oklch(0.55 0.18 290)" }
    default:
      return fallback
  }
}

/**
 * Pick an icon, label and accent color for a stored document. The lookup is
 * MIME-type first (most reliable signal), then extension, then a generic
 * `File` glyph. Designed for the document grid: large duotone, single accent.
 */
export function getFileIcon(input: {
  mimeType?: string | null
  fileName?: string | null
}): FileIconDescriptor {
  const mime = input.mimeType?.toLowerCase() ?? ""
  const name = input.fileName ?? ""

  if (mime === "application/pdf") {
    return { Icon: FilePdf, label: "PDF", color: "oklch(0.55 0.18 27)" }
  }
  if (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.oasis.opendocument.text" ||
    mime === "application/rtf"
  ) {
    return { Icon: FileDoc, label: "Word", color: "oklch(0.50 0.15 250)" }
  }
  if (
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.oasis.opendocument.spreadsheet"
  ) {
    return { Icon: FileXls, label: "Excel", color: "var(--color-success)" }
  }
  if (
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.oasis.opendocument.presentation"
  ) {
    return { Icon: FilePpt, label: "PowerPoint", color: "oklch(0.65 0.16 62)" }
  }
  if (mime === "text/csv") {
    return { Icon: FileCsv, label: "CSV", color: "var(--color-success)" }
  }
  if (mime === "text/markdown") {
    return { Icon: FileMd, label: "Markdown", color: "var(--color-text)" }
  }
  if (mime === "text/html") {
    return { Icon: FileHtml, label: "HTML", color: "oklch(0.55 0.15 30)" }
  }
  if (mime === "text/css") {
    return { Icon: FileCss, label: "CSS", color: "oklch(0.55 0.15 280)" }
  }
  if (mime === "text/javascript" || mime === "application/javascript") {
    return { Icon: FileJs, label: "JavaScript", color: "oklch(0.70 0.15 80)" }
  }
  if (mime === "application/typescript") {
    return { Icon: FileTs, label: "TypeScript", color: "oklch(0.55 0.13 240)" }
  }
  if (mime === "application/json" || mime === "application/xml" || mime === "text/xml") {
    return { Icon: FileCode, label: "Código", color: "var(--color-text-muted)" }
  }
  if (mime === "text/plain") {
    return { Icon: FileTxt, label: "Texto", color: "var(--color-text-muted)" }
  }
  if (
    mime === "application/zip" ||
    mime === "application/x-rar-compressed" ||
    mime === "application/x-7z-compressed" ||
    mime === "application/x-tar" ||
    mime === "application/gzip"
  ) {
    return { Icon: FileArchive, label: "Comprimido", color: "var(--color-text-muted)" }
  }
  if (mime.startsWith("image/svg")) {
    return { Icon: FileSvg, label: "SVG", color: "oklch(0.55 0.15 280)" }
  }
  if (mime === "image/png") {
    return { Icon: FilePng, label: "PNG", color: "oklch(0.55 0.18 290)" }
  }
  if (mime === "image/jpeg") {
    return { Icon: FileJpg, label: "JPEG", color: "oklch(0.55 0.18 290)" }
  }
  if (mime.startsWith("image/")) {
    return { Icon: FileImage, label: "Imagen", color: "oklch(0.55 0.18 290)" }
  }
  if (mime.startsWith("video/")) {
    return { Icon: FileVideo, label: "Video", color: "oklch(0.55 0.18 340)" }
  }
  if (mime.startsWith("audio/")) {
    return { Icon: FileAudio, label: "Audio", color: "oklch(0.55 0.12 195)" }
  }

  return byExtension(name, { Icon: FileText, label: "Archivo", color: "var(--color-text-muted)" })
}
