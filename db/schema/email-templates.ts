import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core"

/**
 * email_templates — Plantillas HTML editables para correos del sistema.
 *
 * Cada fila representa un tipo de correo (invitación, notificación, etc.)
 * con su asunto y cuerpo HTML editables desde el panel de administración.
 * El campo `isDefault` indica si el contenido actual es el original del
 * sistema (permite restaurar si el usuario lo personalizó).
 */
export const emailTemplates = pgTable("email_templates", {
  id:        text("id").primaryKey(),
  /** Slug único que identifica el tipo de template: "invitation", "notification", etc. */
  key:       text("key").notNull().unique(),
  /** Nombre humano legible: "Invitación", "Notificación", etc. */
  name:      text("name").notNull(),
  /** Asunto del correo con soporte para {{variables}} */
  subject:   text("subject").notNull(),
  /** Cuerpo HTML del correo con soporte para {{variables}} */
  bodyHtml:  text("body_html").notNull(),
  /** true si es el template original del sistema (permite restauración) */
  isDefault: boolean("is_default").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})
