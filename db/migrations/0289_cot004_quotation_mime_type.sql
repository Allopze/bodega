-- COT-004: persistir el MIME autoritativo de la cotización.
--
-- La carga valida PDF/JPG/PNG por bytes mágicos y devuelve el tipo real, pero
-- ese valor se descartaba: la fila sólo guardaba el nombre del cliente y una
-- ruta cuya extensión venía de ese mismo nombre. Al servir el archivo, ambas
-- rutas respondían `application/pdf` sólo si la ruta terminaba en `.pdf`, y
-- toda imagen legítima salía como `application/octet-stream` —una evidencia
-- válida que el navegador descarga en vez de mostrar—.
--
-- El CHECK acota la columna a los tres tipos que `MimeType.QUOTATION` acepta.
-- Es la mitad que no puede saltarse ningún camino de escritura: sin él, una
-- carga futura podría persistir `text/html` y la descarga lo serviría desde el
-- mismo origen de la aplicación.
--
-- NULL sigue permitido: las filas anteriores a esta migración no tienen MIME
-- registrado y no se puede inventar sin releer cada archivo. La descarga las
-- resuelve por extensión, como hasta ahora.
ALTER TABLE repuesto_quotations ADD COLUMN IF NOT EXISTS mime_type text;
--> statement-breakpoint
ALTER TABLE service_quotations ADD COLUMN IF NOT EXISTS mime_type text;
--> statement-breakpoint
ALTER TABLE repuesto_quotations DROP CONSTRAINT IF EXISTS repuesto_quotations_mime_type_valid;
--> statement-breakpoint
ALTER TABLE repuesto_quotations ADD CONSTRAINT repuesto_quotations_mime_type_valid
  CHECK (mime_type IS NULL OR mime_type IN ('application/pdf', 'image/jpeg', 'image/png'));
--> statement-breakpoint
ALTER TABLE service_quotations DROP CONSTRAINT IF EXISTS service_quotations_mime_type_valid;
--> statement-breakpoint
ALTER TABLE service_quotations ADD CONSTRAINT service_quotations_mime_type_valid
  CHECK (mime_type IS NULL OR mime_type IN ('application/pdf', 'image/jpeg', 'image/png'));
