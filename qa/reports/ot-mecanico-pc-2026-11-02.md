# QA · OT: asignación por faena, sin «tomar» y registro desde el PC (2026-11-02)

Rama `feat/ot-mecanico-faena-pc`. Cambios:

1. La OT que crea el administrador de contrato nace asignada al mecánico (rol `mecanico`) de la faena del equipo. Si la faena tiene varios, se elige uno; si no tiene ninguno, la OT queda por asignar. La jefatura puede reasignarla.
2. El mecánico ya no toma OT, ni en la web ni en la app.
   - Quien sólo ejecuta no ve las OT «por asignar» y no tiene esa pestaña.
   - El catálogo de la app pasa a `CATALOG_FORMAT 3` y sólo trae las OT asignadas.
   - Un «take» antiguo que quedó en la cola de un teléfono recibe un 422 legible. Si ya se había aplicado, responde como duplicado.
3. En el PC, el mecánico abre `/mantencion/ot` y la ficha de la OT, ejecuta la OT y registra la correctiva o preventiva enlazada con el nuevo formulario «Registrar trabajo».

## Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `eslint` sobre los archivos cambiados | 0 errores; 1 aviso que ya existía (`ot-model.ts`, `operatorDriverId` sin uso) |
| `npm run test:fast` | 16 785 pasan, 277 omitidas, 0 fallan |
| `npm run test:pglite -- lib/__tests__/mantencion` | 13 suites, 292/292 (incluye la nueva `mantencion-work-orders-web-record-pglite`, con 12 pruebas) |
| E2E `mantencion-1-app` | 8/8 |
| E2E `mantencion-4-permisos` | 5/5. Cambio de expectativa: el mecánico ahora entra a `/mantencion/ot` |
| E2E `mantencion-5-ot` | 8/8 (a–g y b2) |

## Lo que la E2E recorrió en Chromium

- **Paso a:** el administrador elige el mecánico de Biodiversa al crear la OT. La OT queda «Asignada» y en su menú no aparece «Reasignar».
- **Paso b:** la jefatura recibe el aviso «Ya tiene mecánico asignado» y la reasigna a un mecánico de otra faena.
- **Paso b2:** el mecánico entra a la plataforma en el PC.
  - No ve «Nueva OT» ni la pestaña «Por asignar».
  - Abre su OT y ve «Registrar ingreso».
- **Paso e:** después del rechazo en la conformidad, el mecánico registra la correctiva nueva desde el PC con el formulario web.
  - Completa la lectura, los trabajos, los aceites, la descripción y el conductor.
  - Sube una foto JPG real. La compresión y el timbre (`capturePhoto`) corren en el navegador.
  - Firma, ve el aviso con el folio y registra la salida, y la OT pasa a «Por recibir».
- **Paso c:** sigue cubriendo el mismo flujo desde la app del teléfono.

## Cobertura que falta y riesgos

- **Sin recorrido manual sobre `bodega_dev`:** esa base está atrasada en migraciones. La validación con el navegador es la de la E2E.
- **Formulario de preventiva:** la versión web está cubierta por PGlite y por pruebas de componentes, pero no por la E2E.
- **Fotos HEIC de iPhone:** Chrome de escritorio no las abre. El formulario acepta sólo JPG o PNG y pide guardar la foto como JPG.
- **Timbre de la foto:** el timbre muestra la hora en que se carga la foto, no la de la toma. La fecha EXIF queda en `takenAtExif`.
- **`supervisor_mantencion`:** tiene `execute` pero no `manage`, así que también deja de poder tomar OT.
- **Teléfonos con la app vieja:** mientras no se actualicen, «Tomar» les responde con el rechazo legible. Al bajar el catálogo con formato 3 dejan de ver OT disponibles.
- **Proceso de otra sesión detenido:** para correr la E2E se detuvo, con autorización del usuario, un servidor E2E de otra sesión que ocupaba el puerto 3100.
