# Propuesta de correcciones a la planilla de equipos (P3)

Para: Alexis. Fecha: 31-10-2026.

La carga inicial de mantención tomó 120 equipos de la planilla «INVENTARIO EQUIPOS (ACTUALIZADO 21-08-26)». Al cruzarla con la flota hay siete equipos con datos que parecen errores de la planilla. **No se ha cambiado nada**: cada fila de abajo es una propuesta. Marca «Sí» o «No» en la última columna.

Los datos «actuales» son los que hoy tiene la base de desarrollo (`bodega_dev`) y la planilla. Producción puede diferir; el script revisa cada fila antes de tocarla y se salta la que ya no coincide.

## 1. KA-71 y KA-91: dos camiones, una sola ficha

**Qué pasa.** La planilla trae dos camiones distintos:

| Código en planilla | Patente | Marca y modelo | Año | Faena |
|---|---|---|---|---|
| KA-71 | CBJY-18 | Freightliner M2 | 2010 | Cabrero |
| KA-91 | YX-2749 | Iveco MLC-160 E 23 RSU | 2005 | Flor del Laja |

En la flota ya existía **una sola ficha**: código **KA-91**, patente **CBJY-18**, Freightliner M2-106, 2010, faena Masisa. Es decir, la patente y la marca son las del KA-71 de la planilla, pero el código es el del KA-91.

La carga primero busca por código. Encontró KA-91 en la flota y le puso el perfil de mantención (pauta «Camiones y tractos»). Cuando llegó a KA-71, lo buscó por patente (CBJY-18), encontró esa misma ficha, que ya tenía perfil, y no hizo nada. Resultado en `bodega_dev`:

- 119 perfiles de mantención para 120 equipos de la planilla.
- El Iveco KA-91 (YX-2749) no existe en la flota: no hay ninguna ficha con esa patente.
- La ficha CBJY-18 aparece como KA-91, y no existe ningún KA-71.
- Esa ficha tiene 2 asignaciones Copec activas (tarjetas diesel y BlueMax, clave `CBJY18`). Van por vehículo y patente, no por código, así que cambiar el código no las afecta.
- No tiene lecturas de medidor ni registros de mantención, así que hoy renombrarla es seguro.

Esto es un conflicto de dato, no de programa: sólo tú puedes decir si la planilla o la flota tiene razón.

| Equipo | Dato actual en flota | Cambio propuesto | Por qué | ¿Aprobado? |
|---|---|---|---|---|
| Ficha CBJY-18 | Código KA-91, Freightliner M2-106, 2010, Masisa | Cambiar el código a **KA-71** | La planilla asigna KA-71 a CBJY-18 (Freightliner 2010, Cabrero). El código KA-91 es del Iveco YX-2749. | Sí / No |
| Iveco YX-2749 | No existe en la flota | Darlo de alta como **KA-91** (Iveco MLC-160 E 23 RSU, 2005, Flor del Laja, camión, pauta «Camiones y tractos») | Queda libre el código KA-91. Lo crea la carga inicial al volver a correrla (ver «Cómo se aplica»). | Sí / No |

Pregunta abierta: la faena de la ficha CBJY-18 es hoy Masisa y la planilla dice Cabrero. Este cambio no la mueve; se decide aparte.

## 2. Cinco equipos «sin patente» que parecen tener patente real

**Qué pasa.** Para estos equipos la planilla repite el código en la columna de patente («CPSG-30 | CPSG-30»). La carga lo interpreta como «sin patente» y los marca así. Pero los cinco calzan con un formato de patente válido (`BCDF-12` o `AB-1234`), por lo que podrían ser la patente real y que el equipo use la patente como código.

Hoy en `bodega_dev` la patente de la ficha ya es ese mismo valor; lo único incorrecto es la marca «Sin patente» del perfil. En total hay 11 equipos con esa marca; estos cinco son los que tienen formato válido.

| Equipo | Dato actual | Cambio propuesto | Por qué | ¿Aprobado? |
|---|---|---|---|---|
| CPSG-30 | Camión Chevrolet NPR 815, 2011, Flor del Laja, pauta Camiones y tractos. Patente = código, marcado «Sin patente». | Quitar «Sin patente»: la patente es CPSG-30. | Formato `BCDF-12` válido. | Sí / No |
| DLFZ-34 | Cargador frontal Caterpillar 950H, 2012, Servimar, pauta Maquinaria pesada. Patente = código, marcado «Sin patente». | Quitar «Sin patente»: la patente es DLFZ-34. | Formato `BCDF-12` válido. | Sí / No |
| XX-7493 | Excavadora Caterpillar 312C, 2005, Flor del Laja, pauta Maquinaria pesada. Patente = código, marcado «Sin patente». | Quitar «Sin patente»: la patente es XX-7493. | Formato `AB-1234` válido. | Sí / No |
| RT-5367 | Camión Mercedes L 222154, 1998, Sin ubicación, pauta Camiones y tractos. Patente = código, marcado «Sin patente». | Quitar «Sin patente»: la patente es RT-5367. | Formato `AB-1234` válido. | Sí / No |
| SX-2728 | Camión Mercedes L 222154, 1999, Sin ubicación, pauta Camiones y tractos. Patente = código, marcado «Sin patente». | Quitar «Sin patente»: la patente es SX-2728. | Formato `AB-1234` válido. | Sí / No |

Nota: en el inventario estos equipos aparecen igual (patente = código), así que el dato no sale de un error de carga. Es posible que el equipo sea de maquinaria o antiguo y el código sea su patente. Si alguno es de maquinaria (excavadora, cargador) sin patente de circulación, la respuesta correcta es «No».

## 3. LC-1315: parece una grúa horquilla, no un camión

| Equipo | Dato actual | Cambio propuesto | Por qué | ¿Aprobado? |
|---|---|---|---|---|
| LC-1315 | Camión (km), Nissan CPC 14 BTLT, 1993, Sin ubicación, pauta «Camiones y tractos». Patente = código, marcado «Sin patente». | Pasarlo a **Grúa horquilla** (horas), con la pauta **«Maquinaria pesada»** | «CPC 14» es la nomenclatura de grúas horquilla Nissan; un camión no tendría esa sigla ni el año 1993 con patente-código. El inventario lo trae como camión de DIAL SPA, con faena «BUSCAR». | Sí / No |

Condición: el script no lo cambia si el equipo ya tiene lecturas, registros de mantención o lectura inicial en km. Hoy no tiene ninguna.

## Cómo se aplica

1. Alexis responde esta tabla.
2. Quien aplica carga las filas aprobadas en la constante `P3_APPROVED` de `scripts/apply-mantencion-correcciones-2026-10-31.ts`. Hoy está vacía y, vacía, el script no toca ningún equipo. Hay tres tipos de cambio:
   ```ts
   export const P3_APPROVED: readonly P3Correction[] = [
     { kind: "renombrar-codigo", code: "KA-91", newCode: "KA-71", plateExpected: "CBJY-18" },
     { kind: "patente-real", code: "CPSG-30" },
     { kind: "patente-real", code: "DLFZ-34" },
     { kind: "patente-real", code: "XX-7493" },
     { kind: "patente-real", code: "RT-5367" },
     { kind: "patente-real", code: "SX-2728" },
     { kind: "a-horas", code: "LC-1315", typeName: "Grúa horquilla", scheduleName: "Maquinaria pesada" },
   ]
   ```
   Se incluye sólo lo aprobado.
3. Simular: `npx tsx scripts/apply-mantencion-correcciones-2026-10-31.ts --actor-email <correo>`. Sin `--apply` no escribe nada; muestra qué haría y qué se salta (por ejemplo, un equipo cuyo estado ya cambió).
4. Aplicar: el mismo comando con `--apply`. Todo ocurre en una transacción y queda en la bitácora y en el historial de cada ficha. Repetirlo no cambia nada.
5. Si se aprobó el alta del Iveco KA-91: volver a correr la carga inicial (`seed-mantencion`). Como el código KA-91 queda libre, la carga crea la ficha con sus datos de la planilla. Es el único camino que usa los 120 equipos del archivo sin duplicar.
6. Actualizar el seed para que el archivo describa lo que quedó en la base:
   - En `db/seed/mantencion-seed.json`: KA-71 ya está correcto; LC-1315 pasa a tipo «Grúa horquilla», unidad `h`, pauta `p-maquinaria`.
   - Los cinco con patente real necesitan que el seed pueda decir «esta patente es real aunque sea igual al código». Hoy `patente == codigo` significa «sin patente»: hace falta un campo explícito en el archivo y un ajuste en `seed-equipment.ts` y en el parser. Es un cambio de código chico, aparte de este script.
   - Copiar el archivo a `docs/mantencion/referencias/seed-mantencion.json` y actualizar `VALIDATED_REFERENCE_SHA256` y la cuenta de «sin patente» (hoy 11) en `lib/mantencion/__tests__/seed-data.test.ts`. Con los cinco aprobados queda en 6.

El cambio de la **descripción de las pautas** no depende de esta tabla: el mismo script lo aplica siempre (sólo donde la descripción siga siendo el texto viejo).
