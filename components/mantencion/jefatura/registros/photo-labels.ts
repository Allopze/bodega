import { PHOTO_KIND_LABEL } from "@/lib/mantencion/format"
import type { MantPhotoKind } from "@/lib/mantencion/types"

/**
 * Nombre de una foto dentro de su registro. Las preventivas llevan una de
 * filtros y una del sticker; las correctivas, de una a tres «fotos del trabajo»,
 * que se numeran («Foto del trabajo 2 de 3») para poder nombrarlas en el visor.
 */
export function photoCaption(photos: ReadonlyArray<{ kind: MantPhotoKind }>, index: number): string {
  const photo = photos[index]
  if (!photo) return ""
  const sameKind = photos.filter((item) => item.kind === photo.kind)
  if (sameKind.length <= 1) return PHOTO_KIND_LABEL[photo.kind]
  const position = photos.slice(0, index + 1).filter((item) => item.kind === photo.kind).length
  return `${PHOTO_KIND_LABEL[photo.kind]} ${position} de ${sameKind.length}`
}
