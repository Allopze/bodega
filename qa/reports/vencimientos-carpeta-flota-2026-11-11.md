# Carpeta «Flota y mantención Chome»: carga de vencimientos, 2026-11-11

Alcance: `scripts/apply-vencimientos-planilla-2026-11.ts` y su prueba. Sólo se ejecutó el
**dry-run** contra `bodega_dev` (127.0.0.1:5433); no se escribió nada (nunca `--apply`), no se
levantó ningún servidor y no se corrió E2E. Este informe no lleva RUT ni nombres de personas:
los trabajadores se citan como «fila N de Trabajadores» y los equipos por código o patente.

## 1. Marca, modelo y año de los 15 carros y bateas nuevos (C1)

`NEW_VEHICLE_DETAILS` tenía 15 patentes en `null`. Se completó con la hoja «Equipos» de
`08 Versiones más recientes en Descargas/plantilla-equipos-mantencion-completada.xlsx`, cruzando
por patente normalizada (`plateMatchKey`). Las 15 patentes están en esa hoja.

| Patente | Tipo | Marca | Modelo | Año |
|---|---|---|---|---|
| PWTD-82 | Carro | Emes | PLANO 2 EJES | 2022 |
| HGKG-54 | Carro | Rocongu | null (la plantilla repite la marca) | 2017 |
| JP-3896 | Carro | Rocongu | null (la plantilla dice «PLANO DE 2 EJES GENÉRICO») | 2015 |
| HGKG-53 | Carro | Rocongu | PLANO 2 EJES 6 MTS (se quitó el « .» final) | 2017 |
| PWTY-84, PWTY-85, PWYL-34, PWYL-35 | Carro | Rocongu | BASE CONTENEDOR | 2023 |
| JA-1225 | Carro | Rabalme | PLANO 2 EJES | 2004 |
| JN-6770 | Batea | Tremac | SRTT 20 3S | 2014 |
| JN-9374 | Batea | Tremac | SRTT20 3N | 2014 |
| JN-9376 | Batea | Tremac | SRTT 20 3N | 2014 |
| JWPY-64 | Batea | Randon | SR-BA-AB-03-20 | 2019 |
| PWTK-77 | Batea | Emes | Semiremolque MELO | 2025 |
| JK-2385 | Batea | Randon | Semiremolque Randon | 2012 |

Criterios: marca y modelo tal como los escribe la plantilla (todas las marcas ya vienen en
Title Case); modelo `null` cuando repite la marca o se declara genérico; año presente en las 15.
Ningún modelo era «SIN MODELO» ni «Hehizo». Decisión a confirmar: «PLANO DE 2 EJES GENÉRICO»
(JP-3896) se dejó en `null` por llevar «genérico»; si el usuario prefiere conservar
«PLANO DE 2 EJES», es un cambio de una línea.

Alcance real: el script usa estos datos **sólo al crear** el equipo. En `bodega_dev` las 15
patentes ya existen (de una carga anterior) con marca, modelo y año vacíos, y siguen así; en
producción, donde la carga aún no se corrió, nacerán completas.

## 2. `Chome_Control_Vencimientos_FINAL.xlsx` contra el consolidado (C2)

Se compararon `08 Versiones más recientes en Descargas/Chome_Control_Vencimientos_FINAL.xlsx`
(2026-11-08) y `Control_vencimientos_Chome_consolidado.xlsx` (raíz del checkout principal, el que
lee el script según su comentario; es idéntico, byte a byte, al de «02 Flota e inventario»).

| | Consolidado | FINAL |
|---|---|---|
| Hojas | Resumen, Máquinas, Trabajadores, Listas | Resumen, Máquinas, Trabajadores, Revisión, Listas, Fuentes |
| Fuentes | 3 archivos (Biodiversa, Masisa, Horcones) | 4 archivos: las 3 anteriores + `Control_vencimientos_Cholguan.xlsx` |
| Máquinas | 39 | 62 |
| Trabajadores | 32 (una fila con RUT repetido) | 70, sin RUT repetidos |
| Encabezados | fila 2 | fila 4 (2 filas de título + 1 vacía) |

Diferencias, fila por fila:

- **Máquinas.** Las 39 del consolidado están en FINAL con las mismas faena, código y las tres
  fechas (0 fechas distintas). La única diferencia es la capitalización de la columna «Máquina»
  (12 filas: «Tracto camión» ↔ «tracto»/«TRACTO CAMION», «Camión» ↔ «camion»/«CAMION»); el
  script la normaliza. Se **agregan 23**: 22 de Cholguán con patente (BPDH-41, DDZV-11, DHBL-45,
  DPFG-37, DZTD-52, DZTH-66, GKHJ-99, HKPF-56, HR-7933, JCKB-63, JE-6355, KLJZ-68, LCTC-21,
  LGHF-46, RJZS-63, RKHR-20, RKHR-21, RKHR-26, RKHR-28, RXBW-93, ZY-3970, ZY-4242) y TO-37 sin
  patente. Ninguna se quita.
- **Trabajadores.** Las 32 filas del consolidado calzan por nombre con FINAL, con la misma
  faena, cargo, clase, vencimiento y observación; la **única** diferencia es el RUT de la fila 7
  del consolidado (la que compartía RUT con otra y por eso el script la identificaba por
  nombre). Se **agregan 38** de Cholguán. Ninguna se quita.
- **Fila 7.** La hoja «Revisión» de FINAL la lista como RESUELTO («RUT compartido (corregido)»)
  y la otra persona del par queda confirmada «sin cambios». El RUT corregido es distinto, es
  único en FINAL y no choca con otro. En el dry-run con FINAL el aviso
  «Trabajadores identificados por nombre (RUT de la planilla a corregir)» pasa de 1 a 0.
- **«Fuentes» de FINAL** declara exactamente eso: 62 máquinas (16 + 15 + 8 + 23) y 70
  trabajadores (15 + 13 + 4 + 38) integrados desde 4 archivos originales.

### Decisión

FINAL es un superconjunto estricto, más nuevo y con el RUT corregido: **el script ahora lo
acepta**, y sigue aceptando el consolidado. No se quitó ninguna protección:

- **Encabezados.** `locateColumns` ya buscaba la fila de encabezados entre las 10 primeras y las
  columnas por nombre, así que la fila 4, las columnas extra (Archivo origen, Fila origen, Faena
  original) y «Venc. licencia conducir» (sin «de») se leen sin cambios. Se cubrió con prueba.
- **No se podía abrir.** FINAL está escrita con OpenXML SDK (XML con prefijo `x:`) **y** con las
  relaciones de hoja a tabla en ruta absoluta (`/xl/tables/table1.xml`). ExcelJS falla con
  «El archivo no es una planilla Excel válida». `lib/reports/xlsx-normalize.ts`
  (`loadXlsxTolerant`) arregla el prefijo, pero no las rutas absolutas, y la carga seguía
  fallando («Cannot read properties of undefined (reading 'name')»). Se agregó en el script
  `loadPlanillaWorkbook`, que reintenta pasando esas rutas a relativas. Conviene mover esa
  reescritura a `xlsx-normalize.ts` (el importador de equipos de mantención sufriría lo mismo con
  una plantilla con tablas); no se tocó porque está fuera del alcance de este encargo.
- **Respaldo por nombre (fila 7).** Se mantiene sin cambios: sólo actúa si el RUT está repetido
  en la planilla o no existe en Chome, y deja la nota «identificado por nombre». Con FINAL no se
  dispara, pero queda como red de seguridad.

### Cholguán: pendiente de decisión (no se cambió)

«Cholguán Máquinas» no resuelve a ninguna faena activa de Chome (existen «Cholguan - Arauco»
activa y «Cholguan» inactiva), así que el script **omite y informa** esas 60 filas (22 equipos y
38 trabajadores) en lugar de adivinar. Experimento descartado después (alias temporal a
«Cholguan - Arauco», dry-run): 52 por aplicar, 242 ya estaban, 35 omitidas, y salen decisiones
que no son del script:

- JCKB-63 pasaría de «Santa Fe» y LCTC-21 de «Pacifico» a Cholguan; los otros 19 equipos ya
  están en Cholguan - Arauco en `bodega_dev`.
- JE-6355 trae el tipo «CARRO DESECHOS», que no existe en el catálogo.
- 4 cargos fuera del plan: «Operador Cargador», «Operador Grua», «Administrador», «Jefe de Turno»
  (se crearían pendientes de revisión, sin capacidades). 27 trabajadores ya tienen otro cargo en
  Chome y no se les cambia.
- Trabajadores, fila 66: el RUT no pasa el dígito verificador (se omite). Trabajadores, filas 46,
  53, 55, 59, 65, 69, 73 y 74: sin clase de licencia.

Esos datos no se aplicarán hasta que el usuario confirme la faena y esos puntos.

## 3. Dry-run en `bodega_dev`

Comando (credenciales vía `.env.local`; el correo del responsable se tomó de un usuario activo
de la base, no se imprime):

```bash
set -a; . ./.env.local; set +a
npx tsx --tsconfig tsconfig.json scripts/apply-vencimientos-planilla-2026-11.ts \
  --file <xlsx> --actor-email <usuario activo>      # sin --apply: dry-run
```

| Archivo | Por aplicar | Ya estaban | Omitidas | «A revisar» |
|---|---|---|---|---|
| Consolidado | 0 | 189 | 0 | 11 |
| FINAL | 0 | 189 | 61 | 71 |

- `bodega_dev` ya tiene aplicado el consolidado, por eso no hay nada por aplicar con ninguno de
  los dos. Con FINAL, lo común es idéntico (189 ya estaban).
- Las 61 omitidas de FINAL son la faena Cholguán sin resolver (1) más sus 22 equipos y 38
  trabajadores. Las 71 notas de «A revisar» son esas 61 filas omitidas más 10: 2 equipos con todo
  vencido hace más de un año (ZT-3947, HGKG-54), 3 licencias vencidas con prórroga u observación
  legal, 2 conductores con clase insuficiente para su cargo, 2 datos vacíos (JFDB-89 sin fechas
  de documentos y una licencia sin fecha de vencimiento, Trabajadores fila 7 en FINAL) y 1
  trabajador en otra faena que la de la planilla (fila 34, no se movió). Con el consolidado son
  esas mismas 10 notas más el aviso «identificado por nombre», con las filas desplazadas porque
  sus encabezados están en la fila 2.

## 4. Los 17 pendientes de la hoja «Revisión» de FINAL

La hoja dice «19 hallazgos originales • 2 resueltos (RUT) • 17 pendientes». «Fila origen» es la
fila en el archivo de origen, no en FINAL.

| # | Prioridad | Tipo | Faena | Entidad | Fila origen | Acción sugerida |
|---|---|---|---|---|---|---|
| 1 | ALTA | Patente ausente | Cholguán Máquinas | TO-37 | 23 | Identificar el equipo y completar la patente |
| 2 | MEDIA | Sin vencimientos | Cholguán Máquinas | TO-33 / HR-7933 | 22 | Confirmar si SOAP, permiso y revisión aplican |
| 3 | MEDIA | Sin vencimientos | Cholguán Máquinas | TO-37 | 23 | ídem |
| 4 | MEDIA | Sin vencimientos | Masisa Maderas | KA-120 / JFDB-89 | 4 | ídem |
| 5 | REVISAR | Licencia sin fecha | Biodiversa | Trabajador, cargo Conductor | 5 | Validar si requiere licencia por su función |
| 6 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Mecánico | 12 | ídem |
| 7 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Auxiliar | 19 | ídem |
| 8 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Soldador | 21 | ídem |
| 9 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Supervisor | 25 | ídem |
| 10 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Jefe de Turno | 31 | ídem |
| 11 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Prevencionista | 32 | ídem |
| 12 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Soldador | 35 | ídem |
| 13 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Auxiliar | 39 | ídem |
| 14 | REVISAR | Licencia sin fecha | Cholguán Máquinas | Trabajador, cargo Auxiliar | 40 | ídem |
| 15 | REVISAR | Observación legal («LEY 21.806») | Horcones | Trabajador | 5 | Confirmar vigencia legal sin modificar la fecha |
| 16 | REVISAR | Observación legal (prórroga por 6 meses) | Masisa Maderas | Trabajador | 14 | ídem |
| 17 | REVISAR | Observación legal (prórroga por 6 meses) | Masisa Tableros | Trabajador | 6 | ídem |

Por tipo: 1 patente ausente, 3 equipos sin vencimientos, 10 licencias sin fecha, 3
observaciones legales.

## 5. Verificación ejecutada

- `npx vitest run --config vitest.pglite.config.ts scripts/__tests__/apply-vencimientos-planilla-2026-11.test.ts`:
  22 pruebas, todas verdes (5 nuevas: planilla FINAL con título de 3 filas, tablas y XML de
  OpenXML SDK; datos de los 15 equipos, estáticos y al crear). Se comprobó que la prueba de FINAL
  falla si se quita la reescritura de rutas absolutas.
- `npm run typecheck`: sin errores. `npx eslint` sobre el script y su prueba: sin hallazgos.
- Sin E2E ni navegador: el cambio es un script de línea de comandos sin superficie web.
- Brechas: no se corrió `--apply` (ni en dev ni en prod); el comportamiento con FINAL sobre una
  base que aún no tenga el consolidado aplicado se cubrió con pruebas PGlite, no con datos reales.
