# Plan para reemplazar el control manual TAE por una PWA pública

Fecha de análisis: 2026-07-12  
Última actualización: 2026-07-12  
Archivo fuente: `CONTROL_MANUAL_COMBUSTIBLES_UNIFICADO.xlsx`  
Alcance: convertir el registro manual de cargas TAE de Copec en un formulario público, instalable y offline, siguiendo el patrón de PPA Digital; migrar el histórico y retirar el Excel como fuente operativa.

## 1. Corrección del límite funcional: TCT y TAE no son el mismo flujo

La plataforma debe mantener dos contextos claramente separados:

### TCT existente

- El sistema autenticado actual de `/combustibles` corresponde operativamente a **TCT**.
- Sus reportes, consumos por patente, facturas, cuenta corriente, sincronización e importaciones existentes no deben cambiar de significado por la incorporación de TAE.
- Los modelos actuales `fuel_consumption_records`, `fuel_loads` y `fuel_operation_records` se deben considerar parte del contexto TCT hasta que exista una decisión explícita de unificación.

### TAE nuevo

- El Excel analizado corresponde al **control manual TAE de Copec**.
- Debe reemplazarse con una **PWA pública sin login**, similar a PPA Digital.
- La captura pública debe vivir en `/tae` y poder abrirse desde un enlace o QR.
- La revisión autenticada debe vivir en `/combustibles/tae`.
- TAE necesita su propio modelo transaccional, evidencias, puntos de carga, estados, cola offline y dashboard.

Por lo tanto, la decisión anterior de extender directamente `fuel_operation_records` queda descartada. Se debe crear un contexto TAE explícito, por ejemplo:

- `fuel_tae_submissions`;
- `fuel_tae_evidence`;
- `fuel_tae_loading_points`;
- `fuel_tae_import_batches`;
- `fuel_tae_public_links`.

La separación no impide análisis conjuntos. TCT y TAE se podrán combinar después mediante consultas/read models, pero no compartiendo una tabla que oculte diferencias de origen, identidad, evidencia o reglas.

## 2. Relación con la integración Copec actual

La sincronización actual intenta descargar reportes TCT y TAE. Sin embargo, el propio código documenta que el TAE asociado a estanques fijos llega agregado por asignación/faena y no por patente; el parser por patente produce 0 filas para ese formato. Ese dato TAE no tiene hoy un modelo funcional propio.

La nueva función resuelve otro lado del problema:

- **PWA TAE:** fuente primaria de cada carga física individual, con equipo, conductor, lectura, litros, sellos y fotografías.
- **Reporte TAE Copec:** fuente agregada externa por faena/período, útil para conciliación.
- **TCT actual:** sigue siendo el sistema de consumos por patente y gestión financiera existente.

No se debe presentar la captura PWA como si fuera una importación Copec. La PWA registra la operación en terreno; Copec sirve posteriormente para contrastar totales.

El código actual todavía muestra `TAE` junto a `TCT` en algunos selectores de cargas, filtros e importaciones. Como la definición de negocio confirma que ese sistema corresponde a TCT, la implementación debe auditar esas apariciones y clasificarlas:

- restringir a TCT las pantallas cuyo proceso real sea TCT;
- mover al nuevo contexto TAE cualquier dato que sí represente el formulario o agregado TAE;
- evitar una opción “TAE” que guarde datos en el modelo TCT sin evidencias ni reglas TAE;
- conservar compatibilidad de lectura para datos históricos existentes antes de retirar una opción.

## 3. Patrón PPA Digital que se debe reutilizar

PPA Digital ya demuestra en este repositorio el patrón adecuado:

- ruta pública sin `AppShell` ni autenticación;
- acceso por enlace o QR;
- identificación de trabajador con exposición mínima de datos;
- validación Zod tanto en cliente como en servidor;
- rate limiting para formulario y búsquedas públicas;
- cola IndexedDB para envíos offline;
- sincronización automática al recuperar conexión;
- confirmación local que no depende de navegación RSC cuando no hay red;
- resultado consultable mediante token público revocable;
- service worker, manifest, iconos y experiencia instalable;
- panel autenticado separado para revisión.

La PWA TAE debe copiar esas decisiones de arquitectura, no el código específico de PPA.

### 3.1 Lo que no se puede compartir directamente

El PPA actual está acoplado a `/ppa`:

- `PwaRegister` registra `/sw.js` con scope `/ppa`;
- `public/manifest.json` tiene `start_url` y scope `/ppa`;
- `public/sw.js` solo intercepta rutas `/ppa`;
- IndexedDB usa `ppa-offline` y guarda payloads JSON sin archivos;
- la metadata del layout público está rotulada como PPA Digital.

TAE requiere cuatro fotografías. Su cola debe guardar `Blob`s, controlar cuota y reintentar cargas multipartes. Por eso no se debe reutilizar el mismo store de IndexedDB ni ampliar el scope del service worker PPA a toda la aplicación.

Implementación recomendada:

- mover el registro PPA específico desde `app/(public)/layout.tsx` a `app/(public)/ppa/layout.tsx`;
- parametrizar el registro de service workers o crear un registrador TAE separado;
- mantener `/sw.js` con scope `/ppa` para PPA;
- crear `/tae-sw.js` con scope `/tae`;
- mantener `/manifest.json` para PPA;
- crear `/tae-manifest.json` con `start_url` y scope `/tae`;
- crear una base IndexedDB independiente, `tae-offline`;
- usar iconos, nombre, colores y capturas propios de “Control TAE”.

Esto evita colisiones de cache, branding incorrecto y carreras entre service workers.

### 3.2 Reutilización obligatoria del modal QR de PPA Digital

El modal TAE debe ser el mismo modal base que PPA Digital, no una implementación visual paralela.

El componente actual `app/(app)/prevencion/ppa/ppa-access-panel.tsx` ya define el contrato visual que se debe conservar:

- botón secundario `QR / Enlace` con icono;
- `DialogContent` de ancho `max-w-md`;
- título y descripción de acceso público;
- selector superior;
- QR de 320 px generado solamente al abrir el modal;
- marco blanco de 176 × 176 px;
- botón secundario `Descargar QR`;
- PDF tamaño carta con título, subtítulo, QR y enlace;
- enlace directo truncado en tipografía monoespaciada;
- acción `Copiar` con toast de éxito/error.

Se debe extraer esa implementación a un componente compartido, por ejemplo:

`components/public-access/public-form-qr-dialog.tsx`

Contrato recomendado:

```ts
interface PublicFormQrOption {
  id: string
  label: string
  url: string
  pdfTitle: string
  pdfFileName: string
}

interface PublicFormQrDialogProps {
  title: string
  description: string
  selectorLabel: string
  options: PublicFormQrOption[]
  selectedOptionId: string
  onSelectedOptionChange: (id: string) => void
  pdfSubtitle: string
  triggerLabel?: string
  qrAlt: (option: PublicFormQrOption) => string
}
```

La forma exacta de las props puede ajustarse durante la implementación, pero el límite debe mantenerse:

- el componente compartido controla `Dialog`, generación QR, estados de carga/error, copiar enlace y descarga PDF;
- `PpaAccessPanel` queda como adaptador delgado que construye las opciones general/por faena y conserva exactamente su comportamiento actual;
- `TaeAccessPanel` queda como adaptador delgado que recibe enlaces públicos TAE ya creados y revocables, agrupados por faena/punto de carga;
- la creación, rotación y revocación de tokens TAE permanece en servicios/actions TAE del servidor;
- el componente compartido recibe una URL lista para representar y nunca genera ni persiste secretos;
- PPA puede conservar “General (sin faena)”; TAE no debe ofrecer acceso general si el token exige faena/punto;
- los textos PDF cambian por configuración: `Formulario PPA Digital` versus `Formulario de carga TAE`;
- el PDF TAE debe mostrar faena y punto de carga para que el QR impreso sea identificable físicamente.

El trabajo de extracción debe hacerse antes de construir el modal TAE. No se debe copiar `ppa-access-panel.tsx` y cambiar nombres, porque eso produciría divergencia visual y dos implementaciones de QR/PDF/clipboard que mantener.

Actualmente no hay una prueba focalizada que cubra `PpaAccessPanel`. La extracción debe agregar pruebas del componente compartido y de ambos adaptadores:

- conserva URL general y URL por faena de PPA;
- usa exclusivamente la URL/token recibido en TAE;
- genera QR solo con el diálogo abierto;
- cambia QR/PDF al cambiar de opción;
- copia el enlace correcto y maneja fallo de clipboard;
- descarga PDF con título, subtítulo y nombre configurados;
- presenta fallback si `qrcode` o `jspdf` fallan;
- no muestra una opción general en TAE;
- revocar un enlace TAE lo elimina del selector al refrescar datos.

## 4. Qué contiene realmente el Excel

El libro tiene una sola hoja, `Cargas consolidadas`, con una tabla de `A1:R973`:

- 972 registros y 18 columnas;
- IDs consecutivos del 1 al 972, sin duplicados ni saltos;
- período entre 2025-12-19 y 2026-07-12;
- 4 faenas, 53 equipos, 80 conductores y 16 supervisores/líderes distintos;
- 131.771,887 litros válidos en 971 filas;
- 4 evidencias por registro, representadas por 3.888 enlaces de Google Drive;
- ninguna fórmula;
- ninguna validación de datos;
- ninguna imagen embebida: las fotografías existen solamente como enlaces externos;
- la columna `Carga nocturna (original)` está vacía en las 972 filas.

Distribución por faena:

| Faena en el Excel | Registros | Período observado | Lugar(es) de carga |
|---|---:|---|---|
| SANTA FE | 620 | 2025-12-19 a 2026-07-12 | SURTIDOR FIJO, ESTANQUE DE CAMIONETA |
| CHOLGUAN 1 | 182 | 2026-06-16 a 2026-07-12 | SURTUDOR FIJO CHOME, SURTIDOR CAMION CHOME |
| MININCO | 147 | 2026-04-06 a 2026-07-11 | ESTANQUE DE CAMIONETA |
| MASISA | 23 | 2026-07-01 a 2026-07-10 | TAE |

Conclusión: el Excel es una consolidación de formularios TAE, no una herramienta de cálculo. La función a reemplazar es la captura pública de terreno, su operación offline, las evidencias, validaciones, revisión y trazabilidad.

## 5. Problemas de calidad detectados

Estos problemas deben resolverse en el importador histórico y prevenirse en la PWA:

- El importador operacional actual no acepta el archivo. Una prueba con `parseFuelOperationsExcel` produjo 0 filas porque espera `Patente`, `Fecha` y `LT`, mientras este libro usa `Equipo`, `Fecha y hora` y `Litros`.
- `Equipo` no es una patente. Los valores son principalmente códigos internos como `CR-49`, `RR-07` o `KA-115`.
- De los 53 equipos distintos, solo 8 coinciden actualmente con `fuel_vehicles.code`; ninguno coincide directamente con `fuel_vehicles.plate`. Quedan 45 códigos por reconciliar.
- De las 4 faenas, solo `MASISA` coincide exactamente con el catálogo actual. Se requieren alias explícitos para `CHOLGUAN 1`, `MININCO` y `SANTA FE`, o crear/corregir las faenas después de revisión.
- De los 80 conductores, 22 tienen coincidencia segura con trabajadores actuales al comparar nombres sin depender del orden; 58 requieren vinculación o alta.
- Ninguno de los 16 supervisores coincide de forma segura con los catálogos actuales mediante esa comparación. No se deben crear usuarios automáticamente.
- `Odómetro` mezcla números y texto. Hay 35 valores no convertibles directamente, por ejemplo `Sin Odometro`, `Sin Horómetro`, `6778 / 94807` o `8191.o`.
- `Litros` tiene una fila inválida con `Q91`; debe quedar observada, no corregirse silenciosamente a 91.
- Los sellos mezclan números, texto y ceros a la izquierda. Hay 68 retirados y 55 instalados ausentes o equivalentes a “sin sello/0”.
- En 861 transiciones comparables del mismo equipo, 806 conservan continuidad entre sello instalado y siguiente sello retirado. Las 55 diferencias deben importarse como alertas. La continuidad observable es 93,6 %.
- Hay 62 valores numéricos anómalos en `Observaciones`; parte parecen fechas u horas serializadas.
- Hay 30 registros de MININCO cuya fecha/hora quedó a medianoche.
- `Hora (original)` solo tiene datos en las 620 filas de SANTA FE.
- `SURTUDOR FIJO CHOME` contiene un error ortográfico.
- No se detectaron duplicados con la llave `faena + fecha/hora + equipo + litros + lectura`.

## 6. Modelo TAE propuesto

### 6.1 Envíos públicos

Crear `fuel_tae_submissions` como fuente canónica de cargas TAE.

| Campo funcional | Tipo/relación | Regla |
|---|---|---|
| `id` | texto | ID interno |
| `clientSubmissionId` | texto único | Idempotencia generada en el dispositivo, también offline |
| `importBatchId` | FK nullable | Solo para histórico importado |
| `source` | texto controlado | `public_pwa` o `legacy_xlsx` |
| `legacySourceId` | texto nullable | ID 1-972 del Excel |
| `publicResultToken` | texto único | Consulta del resultado sin login; revocable |
| `worksiteId` | FK a `worksites` | Derivado del enlace/QR y validado en servidor |
| `loadingPointId` | FK TAE | Punto de carga derivado o seleccionado dentro de la faena autorizada |
| `vehicleId` | FK a `fuel_vehicles` nullable | Equipo asociado cuando existe |
| `equipmentCodeSnapshot` | texto | Código mostrado al enviar |
| `plateSnapshot` | texto nullable | Patente histórica, si aplica |
| `loadedAt` | timestamp con zona | Instante real, presentado en `America/Santiago` |
| `submittedAt` | timestamp | Momento en que el servidor confirmó el envío |
| `driverWorkerId` | FK a `workers` nullable | Conductor identificado |
| `driverNameSnapshot` | texto | Identidad histórica/importada |
| `supervisorWorkerId` | FK a `workers` nullable | Supervisor/líder que registra o valida |
| `supervisorNameSnapshot` | texto | Identidad histórica/importada |
| `manualIdentity` | boolean | Marca identificación no vinculada |
| `meterType` | `odometer` o `hour_meter` | Según el equipo |
| `meterReading` | decimal nullable | Lectura válida |
| `meterUnavailableReason` | texto nullable | Requerido si falta lectura |
| `liters` | decimal positivo | Requerido |
| `removedSealNumber` | texto nullable | Preserva ceros a la izquierda |
| `installedSealNumber` | texto nullable | Preserva ceros a la izquierda |
| `noSealReason` | texto nullable | Requerido cuando falta sello esperado |
| `notes` | texto nullable | Observación real |
| `status` | estado controlado | `submitted`, `observed`, `validated`, `voided` |
| `reviewedBy` / `reviewedAt` | usuario/timestamp nullable | Revisión autenticada |
| `reviewNote` | texto nullable | Motivo o resolución |
| `rawRow` | JSON nullable | Fila completa del legado |
| `createdAt` / `updatedAt` | timestamp | Auditoría técnica |

La cola local usa estados `draft`, `pending`, `syncing`, `synced` y `failed`, pero esos estados pertenecen al dispositivo y no deben confundirse con el estado del registro confirmado en servidor.

### 6.2 Enlaces públicos y QR

Crear `fuel_tae_public_links`:

- token aleatorio almacenado como hash;
- faena obligatoria;
- punto de carga opcional o fijo;
- estado activo/revocado;
- expiración opcional;
- etiqueta para imprimir el QR;
- fecha de último uso.

Rutas recomendadas:

- `/tae/acceso/[accessToken]`: entrada desde QR; valida el enlace y vincula ese acceso al dispositivo;
- `/tae`: formulario y `start_url` estable de la PWA instalada.

Al abrir el QR, la PWA guarda el token de acceso en su IndexedDB y navega a `/tae`. Así, al abrir la aplicación instalada posteriormente, puede recuperar la misma configuración sin incluir el secreto en el manifest. Si no existe un acceso local válido, `/tae` debe pedir escanear o abrir nuevamente un QR.

El token determina qué faena y punto puede usar el formulario. No se deben exponer IDs internos editables como única barrera (`?faena=<id>` no basta para un formulario con carga de archivos y acceso a equipos/personas).

La administración de enlaces/QR debe hacerse desde `/combustibles/tae/configuracion` con login y permiso.

### 6.3 Puntos de carga TAE

Crear `fuel_tae_loading_points`:

- `id`, `worksiteId`, `name`, `type`, `isActive`;
- tipos iniciales: `fixed_dispenser`, `truck_dispenser`, `pickup_tank`, `tae`, `other`;
- alias de importación para `SURTIDOR FIJO`, `SURTUDOR FIJO CHOME`, `SURTIDOR CAMION CHOME`, `ESTANQUE DE CAMIONETA` y `TAE`;
- sin texto libre durante la captura normal.

### 6.4 Evidencias

Crear `fuel_tae_evidence`:

- `submissionId`;
- `kind`: `odometer`, `liter_meter`, `removed_seal`, `installed_seal`;
- `fileName`, `filePath`, `mimeType`, `fileSize`;
- `sha256` para integridad/detección de repetidos;
- `externalUrl` nullable solo para legado;
- `capturedAt`, `createdAt`.

Las nuevas fotos se guardan en storage privado. La ruta de lectura requiere login, permiso TAE y alcance de faena. El token público de resultado no debe entregar las fotografías.

Para las 3.888 evidencias históricas:

1. recomendada: copiar desde Drive al storage propio y conservar ID/URL original;
2. transitoria: guardar `externalUrl` con estado `external_pending_copy`;
3. no recomendada: depender indefinidamente de Drive.

## 7. Identificación en el formulario público

El formulario no requiere cuenta de usuario, pero sí debe identificar a las personas involucradas sin publicar el padrón de trabajadores.

**Decisión de Fase 0 (2026-07-12): el conductor del equipo es quien completa el formulario.** El conductor es la identidad "autor" del envío; el supervisor/líder queda como dato del envío (participante), no como quien opera el dispositivo. Esto ajusta el flujo recomendado original (que asumía al supervisor como primer paso):

1. el QR fija faena/punto;
2. el conductor ingresa su RUT (es quien tiene el dispositivo en mano);
3. el servidor valida y devuelve solo nombre enmascarado, igual que PPA;
4. el conductor indica o confirma quién es el supervisor/líder responsable (por RUT o selección, mismo mecanismo aprobado);
5. si no existe en catálogo, se permite identificación manual marcada para revisión, sin crear trabajador/usuario automáticamente.

Para uso offline:

- se puede reutilizar una identidad previamente verificada y almacenada de forma mínima en el dispositivo;
- una identidad nueva no verificable sin red queda `manualIdentity=true` y genera alerta;
- no se debe descargar el catálogo completo de trabajadores al navegador público;
- RUT y datos sensibles locales deben tener retención corta y borrarse después de sincronizar.

**Pendiente de implementación** (ver Fase 3): hoy `tae-form.tsx` no tiene búsqueda por RUT — captura `driverName`/`supervisorName` como texto libre y siempre guarda `manualIdentity: true`. Falta: endpoint de búsqueda por RUT con nombre enmascarado (mismo patrón que PPA), campos `driverWorkerId`/`supervisorWorkerId` en el payload cuando hay match, y el fallback manual observado que da nombre a este ítem del plan.

## 8. PWA pública TAE y funcionamiento offline

### 8.1 Rutas públicas

- `/tae/acceso/[accessToken]`: activación del acceso desde QR.
- `/tae`: formulario público y punto de entrada de la aplicación instalada.
- `/tae/resultado/[publicResultToken]`: confirmación y estado mínimo del envío.
- `/tae/offline`: shell/fallback offline.

Estas páginas no usan `PageHeader`, `PageContainer`, TopBar ni `AppShell`. Deben seguir el layout público compacto de PPA Digital.

### 8.2 Cola IndexedDB con fotografías

Crear `lib/pwa/tae-offline-queue.ts` con una base independiente:

- guardar payload y los cuatro `Blob`s en una misma entrada;
- generar `clientSubmissionId` antes del primer intento;
- estados `draft`, `pending`, `syncing`, `synced`, `failed`;
- reintentos con backoff y botón manual “Sincronizar ahora”;
- continuar con los demás elementos si uno falla;
- conservar el error exacto por envío;
- borrar blobs sincronizados después de **48 horas** (decisión de Fase 0, 2026-07-12) — implementado: `purgeSyncedTaeSubmissions` en `tae-offline-queue.ts`;
- nunca borrar automáticamente un pendiente no confirmado — el purgador solo mira `status === "synced"`, jamás `pending`/`syncing`;
- mostrar cantidad pendiente y espacio ocupado — cantidad pendiente sí (`pendingCount` en `tae-form.tsx`); espacio ocupado en disco no está implementado (no bloqueante, mejora futura).

Las fotos deben comprimirse/redimensionarse en cliente antes de encolar, sin perder legibilidad del odómetro, litros o sello. Límite decidido en Fase 0: **máx. ~5MB por foto, redimensionada a ~1600px** en su lado mayor antes de encolar — implementado en `lib/pwa/image-compress.ts` (`compressPhoto`), usado en `tae-form.tsx` al seleccionar cada foto. El servidor vuelve a validar tipo real, tamaño, cantidad y dimensiones.

Se debe manejar `QuotaExceededError` con un mensaje bloqueante: si el navegador no pudo guardar las fotos, no se puede afirmar que el formulario quedó guardado offline. Implementado en `tae-form.tsx`.

### 8.3 Sincronización atómica

El envío al servidor debe ser multipart y transaccional:

1. validar token público, rate limit e idempotencia;
2. validar payload y cuatro archivos;
3. escribir archivos en una ubicación temporal;
4. insertar envío y evidencias en una transacción;
5. promover los archivos a ubicación definitiva;
6. devolver `publicResultToken`;
7. marcar la entrada local como `synced`.

Si el servidor ya recibió el mismo `clientSubmissionId`, debe devolver el mismo resultado en vez de crear una carga duplicada.

### 8.4 Service worker y manifest

El service worker TAE debe:

- precachear el shell mínimo de `/tae`;
- usar network-first para navegación TAE;
- usar cache-first para assets versionados;
- mantener APIs/envíos como network-only;
- limitar y versionar el cache;
- no interceptar `/ppa` ni rutas autenticadas;
- permitir actualización controlada de la PWA sin perder pendientes IndexedDB.

El manifest TAE debe declarar nombre, iconos, `start_url`, scope, colores, orientación y capturas propias. La instalación debe probarse en Android/Chrome y iOS/Safari.

## 9. Formulario TAE

Orden recomendado:

1. estado de conexión y pendientes;
2. faena y punto de carga fijados por QR;
3. identificación del supervisor/líder;
4. identificación del conductor;
5. equipo buscable por código o patente, limitado a la faena;
6. fecha/hora actual;
7. tipo y lectura de medidor;
8. fotografía del medidor;
9. litros;
10. fotografía del medidor de litros;
11. sello retirado y fotografía;
12. sello instalado y fotografía;
13. observación;
14. resumen, declaración de veracidad y envío.

La fecha/hora debe tomarse automáticamente. La edición manual requiere justificación y debe quedar observada. Cada fotografía debe mostrar vista previa, opción de repetir y estado de almacenamiento local.

El resultado debe distinguir sin ambigüedad:

- `Guardado en este dispositivo, pendiente de sincronización`;
- `Sincronizando`;
- `Enviado y confirmado por la plataforma`;
- `No se pudo guardar ni enviar`.

## 10. Panel autenticado TAE

### 10.1 Rutas

- `/combustibles/tae`: dashboard/listado TAE.
- `/combustibles/tae/[id]`: detalle, evidencias, alertas y trazabilidad.
- `/combustibles/tae/configuracion`: puntos de carga, alias y enlaces/QR.
- `/combustibles/tae/importar`: dry-run e importación del Excel histórico.

Estas páginas sí deben usar `PageContainer` y `PageHeader`. Las acciones globales “Exportar XLSX”, “Importar histórico” y “Administrar accesos” van en `PageHeader.actions`. La búsqueda textual usa TopBar; fecha, faena, punto y estado son filtros estructurados.

La acción “Administrar accesos” debe abrir `TaeAccessPanel`, construido sobre el mismo `PublicFormQrDialog` usado por PPA Digital. La experiencia visual y las acciones deben ser idénticas; solo cambian el selector, la URL segura y los textos TAE.

### 10.2 Revisión

El detalle debe mostrar:

- datos y origen del envío;
- estado de sincronización/recepción;
- galería de cuatro evidencias;
- carga anterior y siguiente del equipo;
- continuidad de sello y lectura;
- alertas abiertas/resueltas;
- identidad vinculada o manual;
- historial de cambios y anulación.

Estados servidor:

1. `submitted`: recibido y válido estructuralmente;
2. `observed`: regla automática o revisor detectó inconsistencia;
3. `validated`: revisado/aceptado;
4. `voided`: anulado con motivo, sin borrado físico.

## 11. Validaciones, alertas y seguridad pública

### Validaciones bloqueantes

- token de acceso activo, no vencido y vinculado a faena/punto;
- `clientSubmissionId` válido e idempotente;
- equipo activo y permitido en la faena;
- litros numéricos y mayores que cero;
- lectura numérica o motivo explícito;
- cuatro evidencias presentes y válidas;
- número o motivo para sellos;
- límite de antigüedad/futuro de fecha;
- validación server-side de todas las relaciones, sin confiar en IDs del cliente.

### Alertas revisables

- sello retirado diferente del último instalado;
- sello instalado reutilizado;
- lectura menor que la anterior;
- salto de lectura o litros atípicos;
- posible duplicado por equipo/fecha/litros/lectura;
- identidad manual o sin match;
- fecha editada o envío sincronizado mucho después de la carga;
- evidencia repetida o ilegible;
- diferencia entre total PWA TAE y reporte agregado Copec TAE.

### Seguridad

- rate limit separado para consulta de identidad, configuración pública y envío;
- token público almacenado como hash y revocable;
- respuesta pública con PII mínima;
- no listar trabajadores, equipos de otras faenas ni enlaces activos;
- proteger contra enumeración de RUT y tokens;
- no servir fotos mediante `publicResultToken`;
- validar firmas MIME/magic bytes, tamaño y cantidad;
- sanitizar metadata/nombres de archivos;
- auditoría de revisión, anulación, accesos y cambios de configuración;
- política de retención para RUT y datos offline locales.

## 12. Mapeo del Excel al modelo TAE

| Columna del Excel | Destino | Tratamiento |
|---|---|---|
| ID | `legacySourceId` | Referencia, no PK |
| Faena | `worksiteId` + snapshot | Resolver por alias |
| Fecha y hora | `loadedAt` | Revisar las 30 fechas a medianoche |
| Lugar de carga | `loadingPointId` | Normalizar a punto TAE |
| Supervisor / líder | supervisor FK + snapshot | Match asistido |
| Conductor | conductor FK + snapshot | Match asistido |
| Equipo | `vehicleId` + código snapshot | Buscar por `fuel_vehicles.code` |
| Odómetro | tipo, lectura, motivo | Observar valores ambiguos |
| Imagen odómetro | evidencia `odometer` | Copiar desde Drive o dejar pendiente |
| Litros | `liters` | Observar `Q91` |
| Imagen medidor de litros | evidencia `liter_meter` | Copiar o dejar pendiente |
| N.º sello retirado | `removedSealNumber` | Texto, preservar ceros |
| Imagen sello retirado | evidencia `removed_seal` | Copiar o dejar pendiente |
| N.º sello instalado | `installedSealNumber` | Texto; vacío exige motivo |
| Imagen sello instalado | evidencia `installed_seal` | Copiar o dejar pendiente |
| Observaciones | `notes` | Limpiar placeholders, observar seriales |
| Hora (original) | `rawRow` | Solo reconstrucción/verificación |
| Carga nocturna (original) | no migrar | Calcular desde `loadedAt` |

Cada fila debe conservarse completa en `rawRow`.

## 13. Permisos

La captura pública no usa permisos de sesión; usa enlace/QR revocable, rate limit y validación del alcance del token.

Agregar al manifiesto autenticado:

- `combustibles:tae_view`;
- `combustibles:tae_review`;
- `combustibles:tae_manage_config`;
- `combustibles:tae_import`;
- `combustibles:tae_export`.

No reutilizar `combustibles:create`, que hoy corresponde a cargas/facturas TCT. El alcance por faena aplica al panel, archivos, exportaciones y revisiones.

## 14. Plan de implementación

### Fase 0 — Cerrar decisiones operativas

Decisiones aprobadas por el usuario el 2026-07-12:

- [x] Confirmar quién completa el formulario TAE: **el conductor del equipo** completa el formulario en su propio dispositivo. El conductor es la identidad "autor" del envío; el supervisor/líder queda como dato del envío. Pendiente de implementación: la sección 7 (identificación por RUT) debe rediseñarse con el conductor como flujo principal — ver Fase 3.
- [x] Inventariar los usos actuales de `TAE` en pantallas/modelos TCT y aprobar cuáles se restringen, migran o quedan solo como compatibilidad histórica. **Auditoría realizada el 2026-07-12**: todos los usos restantes son de facturación o reportes agregados, no captura operacional — `fuel_loads.serviceType` (`TCT`/`TAE`, con IEC/IVA/monto, del Excel "CONTROL FACTURAS COMBUSTIBLES") y sus selectores en `fuel-filters.tsx`, `new-fuel-load-form.tsx`, `edit-fuel-load-form.tsx`; y la descarga de reportes Copec TCT/TAE en `copec-sync.ts`/`copec-reports.ts` (fuente agregada externa reservada para la conciliación de Fase 6). **Decisión: se dejan tal cual**, sin cambios de código — no son el patrón que el plan buscaba evitar.
- [x] Confirmar que `SANTA FE` corresponde a `Santa Fe Gruas` y `CHOLGUAN 1` a `Cholguan`. **Confirmado**: se usan como alias de importación de esas dos faenas existentes.
- [x] Definir `MININCO` en el catálogo de faenas. **Decisión corregida el 2026-07-12**: `MININCO` es alias de la faena existente `Pacifico` (`ws-pacifico`, código FA-007) — el propio seed de prevención ya la describe como "Faena Pacífico (Mininco)". Las 147 filas del Excel se importan contra `ws-pacifico`, sin crear faena nueva. (Se corrige aquí la primera respuesta del usuario, que asumía crear una faena nueva sin conocer este alias interno ya existente.)
- [ ] Reconciliar los 45 códigos de equipo pendientes. **Método aprobado**: generar un reporte de mapeo sugerido (fuzzy-match contra `fuel_vehicles`) en XLSX con nivel de confianza, para revisión y aprobación fila por fila antes de importar. **Pendiente de ejecución.**
- [ ] Vincular o crear 58 conductores y 16 supervisores pendientes de match seguro. **Mismo método aprobado que equipos**: reporte de mapeo sugerido (fuzzy-match contra `workers`) para revisión manual; no crear trabajadores automáticamente. **Pendiente de ejecución.**
- [x] Aprobar puntos de carga y alias. **Aprobado tal cual sección 6.3**: `SURTIDOR FIJO` y `SURTUDOR FIJO CHOME` (con error ortográfico del Excel) → `fixed_dispenser`; `SURTIDOR CAMION CHOME` → `truck_dispenser`; `ESTANQUE DE CAMIONETA` → `pickup_tank`; `TAE` → `tae`.
- [x] Aprobar el mecanismo de QR/token y su rotación. **Decisión**: revocación manual desde el panel es suficiente; no se agrega expiración ni rotación automática de tokens.
- [x] Aprobar retención/copia de fotos de Drive. **Decisión**: no migrar evidencia histórica de Drive. Las 972 filas del histórico se importan solo con sus datos; las fotos de Google Drive no quedan disponibles en la plataforma (se documenta esta limitación al usuario final). Esto simplifica la Fase 5: no hace falta copiar ni inventariar las 3.888 evidencias.
- [x] Definir límites de tamaño/calidad de fotografías y retención offline. **Decisión (default razonable)**: máx. ~5MB por foto, comprimida/redimensionada a ~1600px en el cliente antes de encolar; los blobs ya sincronizados se limpian de IndexedDB a las 48 horas. Pendiente de implementación en `lib/pwa/tae-offline-queue.ts` y `tae-form.tsx` (hoy no hay compresión ni límite de tamaño ni limpieza automática).

Criterio de salida: actores, enlaces, catálogos y política de evidencia aprobados. **Estado: 9/10 decisiones cerradas el 2026-07-12.** Queda un solo pendiente, que no es una decisión sino ejecución: el reporte de mapeo sugerido (fuzzy-match) de los 45 equipos / 58 conductores / 16 supervisores, a construir en Fase 5.

### Fase 1 — Separar infraestructura PWA PPA/TAE

Estado: completa el 2026-07-12, incluida cobertura E2E e iconografía propia. Al construir el test E2E aparecieron y se corrigieron dos bugs reales que dejaban la PWA TAE completamente inaccesible — ver el aviso al final de esta fase.

- [x] Extraer el modal actual de `PpaAccessPanel` a `PublicFormQrDialog` compartido sin cambiar su UI ni comportamiento.
- [x] Convertir `PpaAccessPanel` en adaptador del componente compartido y verificar regresión visual/funcional.
- [x] Crear el contrato/adaptador `TaeAccessPanel` para enlaces revocables por faena/punto, sin duplicar QR, clipboard ni PDF.
- [x] Agregar prueba focalizada de generación QR compartida; faltan pruebas PDF/clipboard.
- [x] Sacar metadata/registro PPA específico del layout público común.
- [x] Conservar PPA con `/sw.js`, `/manifest.json` y scope `/ppa`.
- [x] Crear registrador, `/tae-sw.js`, `/tae-manifest.json` y scope `/tae`.
- [x] Crear cola `tae-offline` con soporte de `Blob` y reintento de sincronización.
- [x] Iconografía propia TAE (`public/tae-icon-192.png`, `tae-icon-512.png`, `tae-icon-maskable-512.png`) — antes `tae-manifest.json` reutilizaba `/ppa-icon-*`, violando la regla de la sección 3.1 de no mezclar branding. Quedan pendientes las capturas (`screenshots`) del manifest — no bloqueante, es solo mejora cosmética del prompt de instalación.
- [x] Probar que instalar/actualizar TAE no altera PPA ni elimina pendientes. `e2e/tae-ppa-coexistence.spec.ts` (3 tests, pasan): scopes de SW distintos y sin scope `/`, IndexedDB `ppa-offline` intacta después de visitar/instalar TAE con un pendiente en cola, y manifest/iconos propios accesibles sin reutilizar `/ppa-icon-*`.

**Dos bugs reales encontrados y corregidos al construir este test** (no eran fallas del test, bloqueaban la funcionalidad para cualquier usuario real):

1. `proxy.ts` (el `middleware.ts` de este fork de Next.js) nunca incluía `/tae` ni las rutas API públicas del formulario en `publicPaths` — **toda la PWA pública TAE redirigía a `/login`**, exactamente lo que la sección 1 dice que no debe pasar ("PWA pública sin login"). Se agregaron `/tae`, `/api/tae/access`, `/api/tae/submit` y `/api/tae/identity` (no `/api/tae` completo: `/api/tae/evidence/[id]` —lectura privada de fotos— debe seguir protegida también a nivel de proxy, no solo dentro del handler).
2. `app/(public)/tae/page.tsx` no usaba ninguna API dinámica, así que Next.js lo prerenderizaba como página **estática** en build. Next.js omite el nonce de CSP en páginas estáticas (un nonce por request es incompatible con HTML generado una sola vez en build) — con la CSP `strict-dynamic` de este proyecto, eso bloqueaba **todos** los scripts de la página, la app nunca hidrataba. Se agregó `export const dynamic = "force-dynamic"`.

Criterio de salida: ambas PWA se instalan y funcionan offline de forma independiente.

### Fase 2 — Dominio TAE y migración de esquema

Estado: implementada y migrada localmente el 2026-07-12. RBAC sincronizado.

- [x] Crear `db/schema/fuel-tae.ts` con submissions, evidence, loading points, public links e import batches.
- [x] Agregar relaciones e índices por faena/fecha, equipo/fecha, estado, sellos e idempotencia.
- [x] Crear servicios en `lib/services/fuel-tae.ts` (archivo único, no directorio; sigue la convención del resto de `lib/services`) y validación en `lib/validation/fuel-tae.ts`.
- [x] Generar la migración `0041_broken_mockingbird` con `npm run db:generate`; no editar migraciones ni `_journal.json`.
- [x] Aplicar `npm run db:migrate` localmente y confirmar que un segundo `npm run db:generate` indique `No schema changes`.

Criterio de salida: esquema migrable y pruebas de consistencia aprobadas sin modificar el modelo TCT.

### Fase 3 — Formulario público y sincronización

Estado: completa el 2026-07-12 — flujo base, evidencia, identidad por RUT, compresión de fotos y purga de blobs sincronizados.

- [x] Crear `/tae/acceso/[accessToken]`, `/tae` y `/tae/resultado/[publicResultToken]`.
- [x] Implementar token público, rate limit e idempotencia.
- [x] Implementar captura de cuatro fotos JPEG/PNG y validación de contenido en servidor.
- [x] Implementar guardado offline, sincronización multipart y estados inequívocos.
- [x] Implementar fallback manual observado para identidades no verificables offline. `useTaeIdentity` (`app/(public)/tae/use-tae-identity.ts`) verifica RUT del conductor y del supervisor contra `/api/tae/identity` (rate-limited, nombre enmascarado, igual criterio que PPA), acotado a la faena del enlace TAE (`findTaeWorkerByRut` en `lib/services/fuel-tae.ts`). La identidad verificada se cachea en IndexedDB (`saveTaeIdentity`/`getTaeIdentity` en `tae-offline-queue.ts`) para reutilizarse sin red. Si no hay match (online o offline), el nombre se completa a mano y `manualIdentity` queda en `true` — la alerta correspondiente ya la muestra el detalle TAE (Fase 4).
- [x] Implementar almacenamiento privado y lectura autenticada de evidencias (`app/api/tae/evidence/[id]/route.ts`, valida `combustibles:tae_view` + alcance de faena).
- [x] Compresión de fotos en cliente (~1600px, máx. ~5MB) — `lib/pwa/image-compress.ts` (`compressPhoto`, con test), llamado en `tae-form.tsx` al seleccionar cada foto (`createImageBitmap` + canvas + `toBlob` con reducción de calidad en pasos hasta caer bajo el máximo; si el canvas falla o el resultado queda más pesado que el original, se usa el archivo tal cual — nunca bloquea el envío).
- [x] Purga de blobs sincronizados a las 48h — `purgeSyncedTaeSubmissions` en `tae-offline-queue.ts` (con test), llamada al abrir el formulario y tras cada sincronización exitosa; nunca toca `pending`/`syncing`, solo `synced` con `syncedAt` vencido.
- [x] `QuotaExceededError` con mensaje bloqueante — `tae-form.tsx` ya no reporta "guardado offline" si `enqueueTaeSubmission` falla (antes ese caso caía al `catch` genérico, reintentaba el mismo `enqueueTaeSubmission` que iba a fallar igual, y mostraba éxito/advertencia de todos modos — una afirmación falsa exactamente contraria a lo que pide la sección 8.2). Ahora distingue `QuotaExceededError` y muestra un error explícito sin marcar nada como guardado.
- [x] Lectura automática del medidor por OCR — `lib/services/tae-ocr.ts` (`extractMeterReading`, con test): preprocesa la foto del odómetro/horómetro con `sharp` (escala de grises, normalizado, nitidez, umbral binario) y reconoce dígitos con `tesseract.js`, con reintento en otro modo de segmentación si la confianza es baja. Se ejecuta en `app/api/tae/submit/route.ts` sobre la evidencia `odometer` al confirmar el envío; el resultado (`meterReadingSource: "ocr"`, `ocrConfidence`, `ocrProcessedAt`) queda en `fuel_tae_submissions` (migración `0042_opposite_bug`). El formulario público ya no pide la lectura manual (`meterReading`/`meterUnavailableReason` se envían vacíos) — corregirla es tarea del revisor en el panel (ver Fase 4).

Criterio de salida: una carga completa puede capturarse sin señal y sincronizarse una sola vez al volver la conexión.

### Fase 4 — Panel autenticado y controles

Estado: listado, detalle, configuración QR, evidencia privada, continuidad de sellos/lecturas, alertas, revisión y exportación XLSX implementados el 2026-07-12.

- [x] Crear `/combustibles/tae`, detalle y configuración base.
- [x] Implementar puntos, enlaces QR, revocación y alcance por faena.
- [x] Implementar continuidad de sellos y lecturas (`getTaeSubmissionContext` en `lib/services/fuel-tae.ts`; carga anterior/siguiente del equipo visible en el detalle).
- [x] Implementar alertas, revisión, resolución y anulación con motivo. Alertas cubiertas: identidad manual, sello retirado no coincide con el último instalado, sello instalado repetido, lectura menor que la anterior, posible duplicado por equipo/fecha/litros/lectura. Pendientes de Fase 6 (requieren el agregado Copec, aún no modelado): salto de lectura/litros atípico, evidencia repetida o ilegible, diferencia PWA vs Copec. Resolución vía `ReviewControls` (observar/validar/anular con nota).
- [x] Implementar auditoría (ya vía `recordAudit`/`recordStatusChange`) y exportación XLSX (`exportTaeSubmissionsXlsxAction`, botón en `PageHeader.actions`, respeta alcance de faena y permiso `combustibles:tae_export`).
- [x] Corrección manual de la lectura OCR — `MeterCorrectionDialog` en el detalle (`app/(app)/combustibles/tae/[id]/meter-correction-dialog.tsx`) + `updateTaeMeterReadingAction`, con motivo obligatorio y auditoría (`recordAudit`, guarda `meterReadingSource: "manual"`). El detalle ya muestra el origen de la lectura (OCR con % de confianza, o manual) junto al valor.

Criterio de salida: un revisor puede explicar cada carga, evidencia y alerta TAE.

**Housekeeping 2026-07-12 (segunda pasada, tras agregarse OCR)**: al auditar el estado real del repo aparecieron tres problemas más, corregidos:

- La migración `0042_opposite_bug` (columnas OCR) estaba generada pero **nunca aplicada** a la base de datos local — `npm run db:generate` reportaba "sin cambios" (coherente con el esquema) pero `fuel_tae_submissions` no tenía las columnas en la BD real. Se ejecutó `npm run db:migrate`; confirmado con `\d fuel_tae_submissions` y con `db:generate` volviendo a reportar "No schema changes".
- `scripts/capture-all-routes.ts` (inventario de páginas para el capturador de screenshots) no tenía registradas las 6 páginas nuevas de TAE (`/tae`, `/tae/access/[accessToken]`, `/tae/resultado/[token]`, `/combustibles/tae`, `/combustibles/tae/[id]`, `/combustibles/tae/importar`) — el test `scripts/capture-all-routes.test.ts` lo detectaba. Se agregaron las 6 entradas y sus muestras dinámicas correspondientes.
- `lib/services/tae-ocr.ts` pasaba `load_system_dawg`/`load_freq_dawg` a `worker.setParameters()`, pero son parámetros "init only" de Tesseract — se ignoraban en silencio (con warning en consola) y el diccionario de inglés seguía activo, pudiendo "corregir" una lectura numérica hacia una palabra parecida. Se movieron al 4º argumento (`config`) de `createWorker()`, que es donde Tesseract realmente los lee.

Suite completa verificada tras estos tres fixes: 2338/2343 tests (5 skips intencionales), 0 fallas.

### Fase 5 — Importación histórica

Estado: parser + reporte de mapeo sugerido (dry-run de solo lectura) implementados el 2026-07-12. Falta la importación por lote real (escritura en `fuel_tae_submissions`).

- [x] Crear parser específico del Excel TAE, separado del parser TCT actual.
- [x] Detectar formato por encabezados y conservar `rawRow`.
- [x] Hacer dry-run con asociaciones, pendientes y observaciones. **Implementado el 2026-07-12**: `lib/combustibles/tae-import-report.ts` (`buildTaeImportReport` + `renderTaeImportReportXlsx`, con test) hace fuzzy-match de faena (con los alias de Fase 0, incluida la corrección MININCO→Pacifico), equipo (contra `fuel_vehicles.code`/`plate`) y conductor/supervisor (contra `workers`, acotado primero a la faena resuelta) con nivel de confianza (`exacta`/`probable`/`posible`/`sin_match`), más observaciones de continuidad de sello y lecturas no numéricas. Expuesto en `/combustibles/tae/importar` (permiso `combustibles:tae_import`, botón "Importar histórico" en el `PageHeader` de `/combustibles/tae`) vía `generateTaeImportReportAction` → `generateTaeImportDryRunReport` en `lib/services/fuel-tae.ts`. **No escribe nada en la base de datos** — es solo el reporte para aprobación manual fila por fila.
  - **Resultado contra el Excel real (`CONTROL_MANUAL_COMBUSTIBLES_UNIFICADO.xlsx`, 2026-07-12)**: 971/972 filas válidas (1 fila con litros inválidos, `Q91`, ya capturada en la hoja "Errores"), 131.771,887 L válidos — coincide con la auditoría original de la sección 4. De 53 equipos, 3 quedan sin ningún match sugerido; de 80 conductores, 29 sin match; de 16 supervisores, 4 sin match (el resto tiene sugerencia "probable"/"posible" a revisar, no aprobación automática). El reporte completo quedó en `TAE_REPORTE_MAPEO_HISTORICO.xlsx` (raíz del repo, sin trackear) para revisión.
  - **Discrepancia a investigar**: el reporte cuenta 96 observaciones de continuidad de sello (comparando `installedSealNumber` de una carga contra `removedSealNumber` de la siguiente carga del mismo equipo, ordenadas por fecha); la auditoría original de la sección 4/5 reportaba 55 diferencias sobre 861 transiciones comparables. La diferencia puede deberse a distinto criterio de "transición comparable" (ej. si el análisis original excluye pares con sello vacío de forma distinta, o agrupa por punto de carga además de equipo) — revisar antes de usar el número para aprobar/rechazar continuidad.
- [x] ~~Copiar o inventariar las 3.888 evidencias de Drive.~~ **Descartado por decisión de Fase 0 (2026-07-12)**: no se migra evidencia histórica de Drive. Las filas se importan solo con sus datos; `evidenceUrls` del parser queda en `rawRow` como referencia, sin crear registros en `fuel_tae_evidence`.
- [ ] Importar por lote con hash, `legacySourceId`, idempotencia y reversión. **Pendiente**: requiere que el reporte de mapeo (punto anterior) sea revisado y aprobado fila por fila primero — no se debe automatizar el alta de equipos/conductores/supervisores sin esa revisión.
- [x] Generar errores y pendientes exclusivamente en XLSX (hojas "Errores", "Lecturas observadas" y "Sellos faltantes" del mismo reporte de mapeo).

Criterio de salida: las 972 filas tienen destino u observación explícita y la suma válida de 131.771,887 litros queda reconciliada. **Aún no cumplido**: el reporte identifica destino/observación sugerido, pero falta la aprobación humana y la importación por lote que persista esos destinos.

### Fase 6 — Conciliación Copec TAE y corte

- [ ] Modelar/importar el agregado TAE por faena y período desde Copec.
- [ ] Comparar agregado Copec versus suma de envíos PWA por faena/período.
- [ ] Mostrar diferencias sin alterar los datos fuente.
- [ ] Pilotear en una faena y comparar diariamente con el Excel.
- [ ] Capacitar, publicar QR y guía breve.
- [ ] Fijar fecha de corte y dejar el Excel en solo lectura.
- [ ] Revisar fotos, pendientes offline y respaldos después del corte.

Criterio de salida: las nuevas cargas TAE nacen solamente en la PWA y TCT continúa operando sin cambio semántico.

## 15. Pruebas mínimas

### PWA/offline

- primera carga online e instalación;
- apertura posterior sin red;
- cuatro fotografías persistidas como blobs;
- `QuotaExceededError` y almacenamiento denegado;
- cierre/reapertura del navegador con pendientes;
- reconexión, backoff, reintento manual y fallos parciales;
- mismo `clientSubmissionId` enviado varias veces;
- actualización del service worker con pendientes existentes;
- coexistencia de PPA y TAE instaladas.

### Dominio/importación

- fechas Chile/UTC sin cambio de día;
- código de equipo versus patente;
- ceros a la izquierda en sellos;
- `Q91`, lecturas textuales, seriales y fechas a medianoche;
- aliases de faenas/puntos;
- continuidad de sellos;
- hash de archivo, `legacySourceId`, reversión y totales.

### Seguridad pública

- token válido, revocado, vencido y manipulado;
- rate limit detrás de NAT compartido;
- enumeración de RUT/tokens;
- IDs de otra faena enviados manualmente;
- archivos con extensión falsa o contenido inválido;
- evidencia inaccesible con token de resultado;
- PII mínima y limpieza de IndexedDB.

### Panel autenticado

- alcance por faena;
- revisión/anulación auditada;
- búsqueda TopBar y filtros estructurados;
- exportación XLSX;
- galería y accesibilidad móvil/escritorio.

### Regresión TCT/PPA

- PPA online, offline, instalación y resultados;
- sincronización Copec TCT existente;
- dashboard TCT, importaciones, facturas y cuenta corriente;
- catálogos de vehículos/proveedores;
- build de producción y pruebas E2E de ambas PWA.

## 16. Archivos principales a intervenir

- nuevo `db/schema/fuel-tae.ts`
- `db/schema/index.ts`
- nueva migración generada en `db/migrations/`
- nuevos `lib/services/fuel-tae/**`
- nuevo `lib/validation/fuel-tae.ts`
- nuevo `lib/combustibles/tae-import.ts`
- nuevo `lib/pwa/tae-offline-queue.ts`
- nuevo `components/public-access/public-form-qr-dialog.tsx`
- `app/(app)/prevencion/ppa/ppa-access-panel.tsx` convertido en adaptador
- nuevo adaptador TAE bajo `app/(app)/combustibles/tae/`
- hooks PWA TAE bajo `lib/pwa/` o `app/(public)/tae/`
- `app/(public)/layout.tsx`
- `app/(public)/ppa/layout.tsx`
- nuevo `app/(public)/tae/**`
- nuevo `app/(app)/combustibles/tae/**`
- rutas de envío público y evidencia privada TAE
- nuevo `public/tae-sw.js`
- nuevo `public/tae-manifest.json`
- iconos/capturas TAE en `public/`
- `modules/combustibles/manifest.ts`
- pruebas unitarias, acciones/API y E2E PWA
- pruebas focalizadas del QR compartido, PDF, clipboard y adaptadores PPA/TAE

No se debe crear lógica de negocio dentro de `modules/combustibles`; allí solo corresponde manifiesto, navegación y permisos.

## 17. Orden recomendado de entrega

1. **Separación PWA:** aislar PPA y crear shell/cola TAE sin tocar TCT.
2. **Captura pública:** QR, identidad, formulario, fotos, offline y sincronización.
3. **Control interno:** listado, detalle, configuración, alertas y exportación.
4. **Migración:** dry-run, evidencias y carga de las 972 filas.
5. **Conciliación y corte:** reporte agregado Copec TAE, piloto y retiro del Excel.

El primer hito de migración sigue siendo un dry-run donde cada fila tenga destino o una observación explícita. El primer hito funcional, en cambio, es demostrar que una carga TAE con cuatro fotos puede registrarse sin conexión y sincronizarse exactamente una vez, sin afectar PPA ni el sistema TCT existente.
