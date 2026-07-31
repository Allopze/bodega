# Adjuntar factura: de escondido a perseguido — 2026-07-31

**Motivo:** para adjuntar la factura de una OC había que *saber* que existía. Abrir la OC → elegir la pestaña «Facturación» (que nunca viene seleccionada) → bajar por el resumen y la lista → llegar a un `<p>` gris «Agregar factura» → y recién ahí, al **final** del formulario, el campo Archivo, que es justamente lo que autocompleta todo lo de arriba vía DTE/OCR.

Nada en el flujo guiado nombraba la factura: el stepper iba Compra → Recepción → cierre, el único CTA del rail era de recepción, `/pendientes` no generaba tarea, el listado mostraba `—` igual para una OC recién emitida que para una recibida hace un mes sin factura, y la advertencia «No hay facturas adjuntadas» sólo aparecía *dentro* del formulario de cierre, con el motivo ya escrito.

**Decisiones tomadas con el usuario:** las tres tandas; la factura **sólo advierte**, no bloquea el cierre; formulario expandido con el archivo primero.

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

## Lo que sigue abierto

- **La factura no bloquea el cierre.** Decisión del usuario: `closeOrderAction` cierra igual y loguea. Esto es visibilidad, no control.
- **A3 vs. formulario expandido:** con varias facturas ya adjuntas, el formulario queda expandido bajo la lista. Plegarlo es un cambio local si en uso resulta un muro.
- **OC `closed` sin factura:** excluida por diseño de la persecución (cerrada no admite trabajo pendiente). Auditar ese caso pide un reporte, no una tarea.
- **Matriz de fixtures OCR por proveedor/layout:** hay un solo layout sintético; documentos reales no se versionan aquí.
- **Node en CI:** los workflows pasaron de 20 a 22.13 para igualar `engines` y la imagen. No es verificable localmente; se ve en la primera corrida.
