/**
 * Re-export por compatibilidad del vocabulario de movimientos de inventario.
 * El canónico vive en `lib/movement-labels.ts` (2026-08-25) para que los
 * servicios de exportación no dependan de una carpeta de feature.
 */
export {
  MOVEMENT_TYPE_LABELS,
  MOVEMENT_TONE_CLASS,
  MOVEMENT_NEUTRAL_TONE,
  movementLabel,
  movementToneClass,
} from "@/lib/movement-labels"
