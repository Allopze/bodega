import { StyleSheet } from "@/components/pdf/lib/pdf-primitives";
import type { PdfcnTheme } from "@/components/pdf/types/pdf-themes";

/**
 * Creates compact-mode cell and text styles for the DataTable component.
 * Used when `size="compact"` to render denser rows with smaller font sizes.
 * @param t - The resolved PdfcnTheme instance.
 */
export const createCompactStyles = (t: PdfcnTheme) => {
  const { spacing, fontWeights, lineHeights } = t.primitives;
  return StyleSheet.create({
    cell: {
      // Reparación local (ver components/pdf/README.md): upstream usa
      // `spacing[2]` = 8 pt por lado, o sea 16 pt por columna. En una tabla de
      // ocho columnas eso son 128 pt de los 527 útiles de un A4 —una cuarta
      // parte de la hoja en aire— y obliga a declarar columnas fijas anchas,
      // que se los quitan a la única columna con texto largo.
      paddingHorizontal: 3,
      paddingVertical: spacing[0.5],
    },
    footerText: {
      color: t.colors.foreground,
      fontFamily: t.typography.body.fontFamily,
      fontSize: t.primitives.typography.xs,
      fontWeight: fontWeights.semibold,
      lineHeight: lineHeights.normal,
    },
    headerText: {
      color: t.colors.foreground,
      fontFamily: t.typography.body.fontFamily,
      fontSize: t.primitives.typography.xs,
      fontWeight: fontWeights.semibold,
      lineHeight: lineHeights.normal,
    },
    text: {
      color: t.colors.foreground,
      fontFamily: t.typography.body.fontFamily,
      fontSize: t.primitives.typography.xs,
      lineHeight: lineHeights.normal,
    },
  });
};

/**
 * Converts an arbitrary cell value to a display string.
 * Returns an empty string for null/undefined values.
 * @param value - The raw cell value to format.
 */
export const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value);
};
