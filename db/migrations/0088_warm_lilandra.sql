CREATE TABLE "size_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"code" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "size_catalog_family_code_unique" ON "size_catalog" USING btree ("family","code");
--> statement-breakpoint
-- Canonical size catalog seed (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO "size_catalog" ("id", "family", "code", "display_order") VALUES
  ('size-ropa-xs',   'ropa',    'XS',   0),
  ('size-ropa-s',    'ropa',    'S',    1),
  ('size-ropa-m',    'ropa',    'M',    2),
  ('size-ropa-l',    'ropa',    'L',    3),
  ('size-ropa-xl',   'ropa',    'XL',   4),
  ('size-ropa-2xl',  'ropa',    '2XL',  5),
  ('size-ropa-3xl',  'ropa',    '3XL',  6),
  ('size-calzado-36','calzado', '36',   0),
  ('size-calzado-37','calzado', '37',   1),
  ('size-calzado-38','calzado', '38',   2),
  ('size-calzado-39','calzado', '39',   3),
  ('size-calzado-40','calzado', '40',   4),
  ('size-calzado-41','calzado', '41',   5),
  ('size-calzado-42','calzado', '42',   6),
  ('size-calzado-43','calzado', '43',   7),
  ('size-calzado-44','calzado', '44',   8),
  ('size-calzado-45','calzado', '45',   9),
  ('size-calzado-46','calzado', '46',  10),
  ('size-guantes-s', 'guantes', 'S',    0),
  ('size-guantes-m', 'guantes', 'M',    1),
  ('size-guantes-l', 'guantes', 'L',    2),
  ('size-guantes-xl','guantes', 'XL',   3),
  ('size-casco-u',   'casco',   'Única',0)
ON CONFLICT ("family", "code") DO NOTHING;