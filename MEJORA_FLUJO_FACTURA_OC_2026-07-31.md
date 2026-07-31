# Adjuntar factura: de escondido a perseguido — 2026-07-31

**Motivo:** para adjuntar la factura de una OC había que *saber* que existía. Abrir la OC → elegir la pestaña «Facturación» (que nunca viene seleccionada) → bajar por el resumen y la lista → llegar a un `<p>` gris «Agregar factura» → y recién ahí, al **final** del formulario, el campo Archivo, que es justamente lo que autocompleta todo lo de arriba vía DTE/OCR.

Nada en el flujo guiado nombraba la factura: el stepper iba Compra → Recepción → cierre, el único CTA del rail era de recepción, `/pendientes` no generaba tarea, el listado mostraba `—` igual para una OC recién emitida que para una recibida hace un mes sin factura, y la advertencia «No hay facturas adjuntadas» sólo aparecía *dentro* del formulario de cierre, con el motivo ya escrito.

**Decisiones tomadas con el usuario:** las tres tandas; la factura **sólo advierte**, no bloquea el cierre; formulario expandido con el archivo primero. Las dos últimas se revisaron después —ver «Segunda tanda»—: el cierre sin conciliar hoy exige una confirmación explícita, y el formulario se pliega cuando ya hay facturas.

## Qué cambió

### Detalle de OC

- El campo **Archivo** es el primer control del formulario y el título subió a jerarquía real. Sin facturas, la sección *es* el formulario (regla A4), no un texto muerto.
- Nuevo `oc-invoice-cta.tsx` en el rail: «Falta la factura de esta orden» → `?tab=facturacion`. Secundario mientras la recepción siga siendo el paso dominante; sin permiso, texto en vez de botón muerto.
- Punto ámbar en la pestaña «Facturación» cuando corresponde y falta.
- `ocNextAction`: con OC recibida y sin factura, el stepper dice «Adjunta la factura y luego cierra la orden».
- El detalle de las advertencias de conciliación sigue dentro del formulario de cierre, ahora con atajo a Facturación. No se duplica en la barra de acciones: el CTA del rail ya lo dice, y repetirlo ponía el mismo texto dos veces en un viewport (precedente A-19).

### Persecución automática

- Nueva fuente `invoice` en la cola operacional (`/pendientes`), **con su contador de badge y su escalón en `resolveOperationalDetail`**: los tres comparten predicado, que es lo que evita el desfase rail/página del bug A-03.
- Listado: filtro `?factura=pendiente` aplicado en SQL antes de contar y paginar, chip «Sin factura» en la cabecera (sólo para quien puede adjuntar), chip removible «Sólo sin factura» en la barra de filtros y celda en tono signal cuando el estado ya lo exige. El export Excel respeta el filtro.

### Puente desde recepción

- El detalle de recepción ofrece «Adjuntar factura» con el N° de guía prellenado (`?nro=`), ya que ese número se tipea ahí, con el documento en la mano. Sin permiso, aviso de que lo hace quien compra.

## Bugs encontrados de paso (no eran parte del encargo)

| Dónde | Qué pasaba |
|---|---|
| `oc-detail-tabs.tsx` | El deep-link `?tab=` no cambiaba de pestaña si ya estabas en la página: `useState` ignora el nuevo `defaultTab` en una navegación suave. El CTA habría cambiado la URL dejando «Ítems» a la vista. |
| `oc-list-rows.tsx` | Las celdas **«Estado» y «Facturas» estaban cruzadas** respecto a `COLUMNS`: el badge de estado caía bajo «Facturas». Preexistente; el chip «Sin factura» lo hizo evidente. |
| `compras/[id]/page.tsx` | `receptionPending` derivado a mano daba `true` en una OC directo-a-faena ya recibida (ahí `quantityOfficeReceived` es 0 por diseño). Ahora usa `pendingReceptionStage`, el mismo criterio del CTA de recepción. |
| `e2e/oc-flow.spec.ts` | `toHaveURL(/\/recepcion\/[^/]+$/)` matchea `/recepcion/nueva`: la espera se cumplía sola y el test leía la OC antes de que el server action commiteara. Fallaba de forma reproducible con la máquina cargada. |
| Parser de facturas | Dos defectos que sólo aparecen con OCR real — ver `AUDITORIA_OCR_FACTURAS_2026-07-30.md`, «Segunda pasada de cierre». |

## Código eliminado

`buildWorkTasks`, `getWorkQueueSnapshot` (`lib/services/dashboard-snapshot.ts`), `buildActor` y los tipos de fila que sólo ellos usaban: ~880 líneas que **ninguna pantalla consumía**. `/pendientes`, el dashboard y los badges leen la proyección SQL de `operational-work-queue.ts`. Mantener las dos era una trampa activa: al agregar la tarea «Adjuntar factura», sólo una de las dos la conocía.

## Segunda tanda (misma fecha): lo que quedaba abierto

Con el flujo ya entregado, se cerró el resto de la lista de pendientes.

### Producto

- **Cerrar sin factura conciliada exige confirmarlo.** No se prohíbe —hay cierres legítimos sin factura: servicios, notas de crédito, acuerdos— pero deja de ser el camino por defecto: hay que marcar la casilla, y la confirmación queda escrita en el motivo que guarda el historial. El servidor revalida; la casilla no es la única defensa.
- **El formulario se pliega cuando ya hay facturas** (`<details>` nativo, preferencia recordada). Sin facturas sigue expandido: ahí el formulario *es* el contenido. Resuelve la tensión con A3 que se había dejado anotada.
- **Reporte «OC cerradas sin factura»**, con el motivo del cierre. Una OC cerrada sale de la cola operacional, así que sin esto la decisión de cerrar sin respaldo no quedaba visible en ninguna pantalla.

### Defectos encontrados al cerrar la lista

| Dónde | Qué pasaba |
|---|---|
| `components/admin/data-table.tsx` | Ocultar una columna quitaba su `<th>` pero no sus `<td>`: la fila se corría y cada valor quedaba bajo el encabezado equivocado. Afectaba a los **7 listados** con selector de columnas. Ahora las celdas se ocultan por posición y un invariante avisa en desarrollo si un llamador rompe el orden. |
| `compras/page.tsx`, `solicitudes/page.tsx` | `if (listParams.estados)` es siempre verdadero (es un arreglo): el href de export mandaba `status=` vacío. |
| Parser de facturas | La fecha no se leía con guías entre rótulo y valor (`Fecha de Emisión ——: 14/07/2026`), y un nombre que empieza con «Proveedor» se truncaba porque el rótulo se detectaba sin exigir los dos puntos. |

### Corrección a la pasada anterior de OCR

La primera pasada afirmó que el P0 de runtime «no se reproduce». **Era falso**, y lo destapó validar contra la factura real del repo en vez de sólo contra fixtures sintéticos: un PDF sintético simple sí rasteriza en Node 20, pero `DOC-33-3064428.pdf` da **9 caracteres y confianza 0,35** ahí, contra **2.597 y 0,62** en Node 26. Ver `AUDITORIA_OCR_FACTURAS_2026-07-30.md` para la evidencia y los dos frentes de corrección.

## Lo que sigue abierto

- **Fixtures OCR de proveedores reales:** la matriz sintética cubre las degradaciones del motor (ordinal, rótulos, ruido, inclinación), no los layouts de cada proveedor. Documentos tributarios reales no se versionan aquí.
- **OCR de un escaneado sigue siendo asistido:** en la muestra real la caja de totales es gráfica, así que no hay total que leer y el sistema devuelve `manual` con advertencias. Es la conducta correcta, no un pendiente de código.
- **Node en CI:** los workflows pasaron de 20 a 22.13 para igualar `engines` y la imagen —el runtime que la evidencia demostró necesario—. No es verificable localmente; se ve en la primera corrida.
- **Interferencia entre specs e2e en paralelo:** varios specs comparten fixtures y se pisan con 2 workers (`repuestos-servicios-oc-flow` encuentra dos botones «Aprobar» cuando otro spec creó solicitudes). Preexistente y ajeno a este trabajo; pasa al correr cada spec solo.
