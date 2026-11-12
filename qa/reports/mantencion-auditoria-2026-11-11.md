# Mantención: auditoría e «Incorporar desde la flota» (2026-11-11)

Rama `feat/mantencion-auditoria-2026-11`. La auditoría de lectura del submódulo de Mantención encontró defectos; aquí está lo que se corrigió y cómo se verificó. Plan aprobado: `~/.claude/plans/impeccable-crea-un-plan-steady-lake.md`.

## Corregido

### Seguridad (fase 1)

| Hallazgo | Arreglo | Evidencia |
|---|---|---|
| I-1: la planilla movía o editaba equipos de otra faena (reproducido: un encargado de Biodiversa trasladó KA-941 desde Cholguán) | Para un vehículo existente, faena, patente y tipo de la flota son de sólo lectura en la importación. Además se exige el alcance de la faena de ORIGEN, revisado antes de resolver la fila, así que nunca se crea una faena por error. | `mantencion-seguridad-pglite` A4, 3 casos nuevos |
| I-2: incorporar movía un vehículo de flota de otra faena (planilla y formulario) | Planilla: el vehículo conserva su faena. Formulario: `createEquipment` exige alcance sobre la faena actual del vehículo que incorpora. | A4, caso nuevo |
| I-3: un equipo de una faena desactivada no se podía editar | Nueva opción `keepWorksiteId` en `resolveEquipment`: conservar la faena actual se acepta aunque esté inactiva. | A4, caso nuevo |
| Revocar un dispositivo no desconectaba: la app reemitía la credencial con la sesión web vigente | La credencial no se emite si jefatura revocó una credencial del usuario después del inicio de su sesión web, en cualquier dispositivo. Responde 403 `revoked`, y la app muestra «Acceso revocado» con el botón «Entrar de nuevo». | A5, caso nuevo + `bootstrap.test` |
| La credencial de la app sobrevivía a un restablecimiento de contraseña | La sincronización rechaza credenciales creadas antes de `sessionsValidFrom`. | A5, caso nuevo |
| La lista de Dispositivos mostraba todas las faenas | La página pasa el actor (`deviceManagerActor`, compartido con revocar). | Leído |
| Observar un registro no exigía poder leerlo | `observeRecord` también exige `canSeeRecord`. | Suites de registros |

### Interconexiones (fase 2)

- **OT ↔ CAPA:** la conformidad se rechaza si Prevención canceló la CAPA del hallazgo. Un hallazgo ya cerrado no bloquea. La prueba cancela la CAPA con el servicio real.
- **Compras:** al enviar se revalida que la OT vinculada siga abierta. La vía rápida ahora se calcula por ítem: una línea con OT ya no exime a otra línea cara sin OT (`fastPathCoversRequest`).
- **OT:** quien crea una OT puede anularla mientras esté «asignada» y sin ingreso a taller. Anular y desasignar ahora avisan al mecánico.
- **Fechas de OT:** se validan como fechas civiles reales, y un 31 de febrero se rechaza.
- **Hora del registro tras una devolución:** se compara `receivedAt` (reloj del servidor) en lugar de `signedAt` (reloj del teléfono).

### Correctitud (fase 3)

- **PDF del registro:** se regenera cuando cambian las observaciones o el taller (huella de lo mutable en el nombre del archivo).
- **Registros anulados:** ya no aparecen «en taller» (hoja de vida, Excel y detalle).
- **Tile «Equipos en taller»:** lleva a `/mantencion/equipos?taller=1`, que reproduce la misma cifra. «Días fuera de servicio» cambió su texto para no prometer el mismo conjunto.
- **Lectura anterior:** se obtiene con una consulta dirigida, sin el tope de 40 registros.
- **Pautas:** no se publica una pauta con un intervalo activo sin ítems.
- **Lecturas con decimales:** «5400,5» ahora se guarda como 5400.5. Hay un parser compartido, `parseLocaleNumber`, que también usa el importador.
- **Flota:** las OT de un equipo trasladado vuelven a contar.

### «Incorporar desde la flota» (fase 4)

- **Página `/mantencion/equipos/incorporar`:**
  - lista los vehículos activos de la flota, con odómetro u horómetro y sin ficha, dentro del alcance del usuario;
  - código, patente, tipo y faena se muestran como texto fijo;
  - la marca se sugiere desde la flota; marca y pauta se pueden aplicar en lote;
  - la lectura es opcional, y los errores se muestran en la fila correspondiente;
  - los vehículos sin código o con patente inválida aparecen con el motivo y no se pueden marcar.
- **Plantilla:** viene precargada con esos vehículos y con las columnas de flota bloqueadas. Las listas desplegables llegan hasta la fila 2.001, y la hoja «Listas» dice en qué unidad se mide cada pauta.
- **Importación:** la pantalla de resultado muestra las filas con error. Las instrucciones explican «Sin pauta» y que la planilla no hace traslados.
- **Avisos:** Equipos e Importar enlazan a la incorporación.
- **Defecto previo corregido:** incorporar por planilla con Modelo y Año en blanco borraba los de la flota.

## Verificación

### Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run check:secrets` | OK |
| `npm run test:pglite` | 373 archivos, 4.888 pruebas OK |
| `npm run test:fast` | 1 falla, en un mock de `request-service-factory.test.ts` que quedó desactualizado con la fase 2. Se corrigió y ese archivo pasa 34/34. No se volvió a correr la suite completa. |

Después del último ajuste se volvieron a correr typecheck, `mantencion-seguridad` + `mantencion-equipment` (56/56) y las unitarias de Mantención (533 OK).

### Navegador

Dev en :3002 desde el worktree, contra `bodega_dev` con las migraciones al día, usuario QA administrador global. Datos creados: 2 vehículos `QA_veh_inc_*` (QA-INC1, QA-INC2), que quedan en `bodega_dev`.

| Pantalla o paso | Resultado |
|---|---|
| `/mantencion/equipos` | Muestra el aviso «… vehículos de la flota aún no están en Mantención». |
| Plantilla | Precarga 24 filas, incluye QA-INC1 y la hoja queda protegida. |
| Incorporar, primer intento | QA-INC2 no tiene marca: aparece «Elige la marca.» en su fila y no se envía nada. |
| Incorporar, segundo intento | Se incorporan los 2. En la base: lectura 12345.5 (escrita «12.345,5»), modelo y año conservados, faena sin cambios y historial «Incorporado a la mantención desde la flota». |
| Panel | El tile lleva a `?taller=1` y aparece el chip «En taller». |
| Errores | 0 errores de consola y 0 respuestas ≥ 400 en los recorridos finales. |
| Móvil (390 px) | Sin scroll horizontal de la página; la tabla se desplaza dentro de su contenedor. |

**Defecto encontrado en el navegador y corregido:** una opción «Sin pauta» con valor vacío rompía el `Select` de Radix y la página caía en «Algo salió mal». Ahora usa el `emptyLabel` de `OptionSelect`.

## Sin cubrir

- **E2E (`npm run test:e2e`):** no se corrió. Borra el `.next` del dev y debe correrse en un worktree desechable. Además, `e2e/mantencion-2-jefatura.spec.ts` se actualizó al enlace nuevo del tile, pero no se ejecutó.
- **Sin recorrer en navegador:**
  - el rechazo por faena siendo un encargado no global (el usuario QA es global; está cubierto por PGlite);
  - la pantalla «Acceso revocado» en la app del mecánico;
  - escribir decimales en la app del mecánico.
- **Sin prueba de render:** el panel de incorporación no tiene una prueba que habría detectado el defecto del `Select`.
- **No implementado, queda por decidir:**
  - Volver a derivar un hallazgo con su OT cerrada (`runs.ts`). El índice `mant_work_orders_finding_unique` lo impide; cambiarlo requiere una migración.
  - Reasignar una OT no avisa al mecánico anterior.
  - `records-filters.ts` sigue validando fechas con la regex antigua.
  - La fase 5 (fotos huérfanas, tope del multipart y menores).
- **Marcas de la flota fuera de la lista** (Maxus, Mahindra, etc.): hay que agregarlas al catálogo de marcas de Mantención antes de incorporar esos vehículos.

---

# Plan 2 (2026-11-12): lo que destapó la carpeta «Flota y mantención Chome»

## Corregido / nuevo

- **El importador abre planillas de OpenXML SDK.** La plantilla completada del equipo (216 filas) venía con el prefijo `x:` en el XML y rutas absolutas en las relaciones, y se rechazaba con «No se pudo leer el archivo». Ahora la carga es tolerante: `lib/reports/xlsx-normalize.ts` (`loadXlsxTolerant`) quita los prefijos y relativiza las rutas, con tope de tamaño descomprimido. Lo usan también el importador histórico y el script de vencimientos.
- **Avisos por fila en la importación:**
  - Los tipos sin medidor (carros, bateas) salen «No aplica», como aviso.
  - Si el equipo ya tiene registros, la lectura inicial se conserva con un aviso en vez de rechazar la fila.
- **Faenas y marcas nuevas sólo con casilla explícita**, y sólo para quien ve todas las faenas.
  - «Sin ubicación», «Por asignar» y similares nunca se crean como faena.
  - Una faena inactiva sugiere su reemplazo activo.
  - La vista previa avisa de las marcas parecidas: «Mercedes Benz → ¿es Mercedes?».
- **`/mantencion/catalogos`:** marcas, talleres, conductores, tipos de trabajo y aceites, con alta, renombre y desactivación, auditoría y usos.
  - Los catálogos son comunes a todas las faenas: sólo la jefatura global los edita; un encargado de faena los ve en modo lectura.
  - «Crear marca» también está disponible al importar y al incorporar desde la flota.
- **Vencimientos:**
  - Se completaron marca, modelo y año de los 15 carros y bateas.
  - El script lee la planilla FINAL (2026-11-08), en la que viene corregido el RUT de la fila 7.
  - El detalle está en `qa/reports/vencimientos-carpeta-flota-2026-11-11.md`.
- **Robustez:**
  - Cron diario de fotos huérfanas, en `scripts/cron-runner.mjs` y en el crontab de `docker-compose.yml` a las 04:40.
  - El formulario web descarta sus fotos cuando el registro se rechaza.
  - La subida de fotos aplica su tope leyendo el flujo; ya no exige `Content-Length`.
  - Una huella distinta se puede reintentar.
  - Menores: fechas civiles en los filtros de registros, el Excel de pautas exporta la versión publicada, alcance en el Excel del panel, motivo de 10 caracteres, la paginación de OT se ajusta a la última página y reasignar una OT avisa al mecánico anterior.
- **Revisión final (Opus):**
  - **Alta, cerrada:** con «Sin patente», la planilla podía incorporar un vehículo de otra faena. La regresión falla sin el arreglo.
  - **Medias, cerradas:**
    - Revocar un dispositivo cierra todas las sesiones de la persona.
    - El tope de las fotos se aplica por flujo.
    - Catálogos sólo con alcance global.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run lint` | OK |
| `npm run test:fast` | 1.325 archivos, 19.953 pruebas OK |
| `npm run test:pglite` | 375 archivos, 4.931 pruebas OK |
| `npm run check:secrets` | OK |
| `npm run typecheck` | OK tras corregir el tipo del cuerpo de la foto |

La pasada completa de `test:pglite` terminó con 1 rechazo sin manejar, causado por el `cancel()` del flujo. Se corrigió y esa suite se volvió a correr, ya sin errores.

Navegador (:3002 contra `bodega_dev`):

| Recorrido | Resultado |
|---|---|
| Importar el `.xlsx` real de la carpeta | Abre con 24 equipos nuevos, 21 por incorporar, 44 por actualizar, 47 sin cambios, 24 «No aplica» y 56 con error. Aparecen la casilla de 17 marcas nuevas y las sugerencias de marca parecida. No se confirmó: los datos reales no se escribieron. |
| `/mantencion/catalogos` | Se creó, renombró y desactivó la marca `QA_Marca Verificada`, que queda inactiva en `bodega_dev`. |
| Móvil, catálogos e incorporar | Sin scroll horizontal. |

En el recorrido hubo 0 errores de consola y 0 respuestas ≥ 400.

## Pendiente de decisión

- Si «Cholguán Máquinas» es un alias de «Cholguan - Arauco». Sin el alias, la planilla FINAL omite las 61 filas de Cholguán. Con él aparecen dos traslados de faena, un tipo «CARRO DESECHOS», cuatro cargos fuera del plan, el RUT inválido de la fila 66 y ocho licencias sin clase.
- El modelo de JP-3896: «PLANO DE 2 EJES» o vacío.
- Volver a derivar un hallazgo cuya OT está cerrada: lo bloquea el índice `mant_work_orders_finding_unique`.
- El mensaje de huella con código 409 `retry` sólo lo entienden los PWA actualizados. Un teléfono con la versión vieja lo sigue tratando como rechazo.
