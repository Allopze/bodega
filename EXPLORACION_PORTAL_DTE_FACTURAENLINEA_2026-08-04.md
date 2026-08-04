# Exploración del portal DTE FacturaEnLínea — qué hay y qué se puede hacer

**Fecha:** 2026-08-04
**Portal:** `https://clientes.dtefacturaenlinea.cl/facturaenlinea/`
**Cuenta explorada:** rut_emp `78.023.530-6` (usuario `6466452-2`)
**Método:** solo peticiones GET de lectura. **No se emitió, envió, anuló, pagó, cedió ni modificó ningún documento ni dato maestro.** Las credenciales no se transcriben aquí.

> Este documento es un inventario de superficie del proveedor. Complementa a
> `explicacion_integral_dte_facturaenlinea.md` (que describe la integración) con
> lo que el portal realmente expone hoy.

---

## 0. RESUELTO — las compras SÍ están en el portal, pero en otro panel

**La pregunta bloqueante ("¿dónde están los DTE de compra de Chome?") quedó respondida por evidencia el 2026-08-04.**

Las facturas de proveedores **no** están en el libro `com` de `paneldte.php` (que da 0). Están en el **Panel Correo → Bandeja de Entrada** (intercambio de correos DTE), endpoint `PanelCorreo/PNC_PanelCorreo.php`. Volumen real de la empresa 433:

- **2026-06: 681 documentos recibidos · 2026-04: 607.** Historial completo, filtrable por `mes`+`anio`.
- Cada fila trae **RUT emisor, razón social, tipo, folio, fecha, total y referencias** directo en la tabla — el RUT emisor está visible (esto **disuelve la Fase 3**: ya no hace falta el salto `estadodoc.php → dn.php`).
- XML y PDF del documento del proveedor descargables por fila.
- Detalle completo en **§7**.

**Por qué el libro `com` está en 0:** los documentos recibidos quedan **PENDIENTE** en la bandeja (pendientes de aceptación/rechazo Ley 19.983 y de "envío a la plataforma"). Nadie los está procesando hacia el libro de compras, así que `paneldte.php?rlib=com` nunca los ve.

**Consecuencia para la integración:** el scraping actual apunta al endpoint equivocado. La fuente de compras debe ser **`PNC_PanelCorreo.php`**, no `paneldte.php?rlib=com`.

**Lo único que queda por decidir (negocio, no técnico):** ¿el objetivo es solo *leer/conciliar* las compras recibidas (integración de lectura, segura), o además *aceptar/rechazar* desde Chome (acción con efecto tributario — Ley 19.983)? Lo primero es directo; lo segundo requiere decisión explícita y NO debe hacerse sin autorización.

---

## 1. Modelo de acceso

- **Sin sesión.** La autenticación va en el query string en **cada** petición: `rut_usr` (RUT del usuario), `rut_emp` (RUT de la empresa), `clave`. No hay cookie ni token. Cualquier URL con esos tres parámetros entra directo.
- **Dos empresas bajo el mismo login**, seleccionables por `CodEmp`:
  - `CodEmp=433` → "Servicios Industri…" (Servicios Industriales) — **empresa objetivo de Chome (confirmado 2026-08-04).**
  - `CodEmp=434` → "Aseos Industriales…" — fuera de alcance.
  - Ambas comparten `rut_emp 78023530-6`. La integración solo necesita `433`; el multi-empresa queda descartado.
- **TLS legacy.** El servidor rechaza el handshake TLS moderno de Node/curl por defecto (`ERR_SSL_WRONG_SIGNATURE_TYPE` / "wrong signature type"). Solo negocia con **TLS 1.2 + cipher SECLEVEL 0**. **Corrección:** el certificado sí valida correctamente (`ssl_verify_result=0`, X509_V_OK) — la nota original de "no valida" era un error de lectura de la exploración; no hace falta `rejectUnauthorized: false`. **Resuelto e implementado (2026-08-04):** `lib/services/dte-portal/client.ts` pasa un `dispatcher` de `undici` (`Agent` con `ciphers: "DEFAULT@SECLEVEL=0"`, `minVersion/maxVersion: "TLSv1.2"`) en cada `fetch`. El `fetch` global de Node ya es `undici` por debajo, así que esto no requiere cambiar la forma de invocar `fetch` ni rompe los tests que mockean `globalThis.fetch`. Verificado contra el portal real: sync completo de 681/681 documentos.
- PHP legacy, codificación **ISO-8859-1** (latin-1) en las respuestas.

---

## 2. Realidad de los datos (lo más importante)

Consultado el 2026-08-04, por período (`fil=1`, parámetros reales `mes` + `anio`):

| CodEmp | Libro | 2026-04 | 2026-05 | 2026-06 | 2026-07 |
|:------:|:-----:|:-------:|:-------:|:-------:|:-------:|
| 433 | ventas (`ven`) | 48 | 43 | 47 | 43 |
| 433 | compras (`com`) | **0** | **0** | **0** | **0** |
| 434 | ventas (`ven`) | 6 | 6 | 6 | 6 |
| 434 | compras (`com`) | **0** | **0** | **0** | **0** |

**Conclusión: el libro `com` de `paneldte.php` está vacío, pero eso NO significa que Chome no tenga compras.** Las compras llegan por otro canal — el Panel Correo / Bandeja de Entrada (ver §0 y §7) — y no se han procesado hacia el libro. Corrección respecto a la hipótesis inicial: **no** hace falta ir al RCV del SII; los DTE de compra están en este mismo portal, en otro endpoint.

- El default de `sync.ts` es `rlib: "com"` → **nunca traería nada.** La fuente de compras correcta es `PNC_PanelCorreo.php`, no este libro.
- El libro `ven` (ventas) sí tiene datos, pero es el lado que *no* aporta valor a Chome (espejo de lo que la empresa factura).
- Los "305 documentos" de la nota original son el acumulado de ventas (43-48/mes × meses), no compras.

**Corrección de contrato de consulta:** el período NO se filtra con `peri=YYYY-MM` (ese campo es derivado y se ignora). Se filtra con **`mes=MM` + `anio=YYYY`** (+ `CodEmp` + `rlib`). Revisar que `query.ts::queryByPeriodo` use `mes`/`anio` y no solo `peri`.

---

## 3. Libros disponibles (`rlib`)

`ven` ventas · `com` compras · `guia` guías de despacho · `bol` boletas · `otro` otros documentos (cotización 94, orden de compra 93, vale ingreso/salida 90/91, factoring, declaración ingreso 89, aviso cargo PAC 100, genérico 99).

---

## 4. Qué se puede hacer — mapa de capacidades

Marcado: **[LEE]** solo lectura · **[MUTA]** crea/modifica/borra/envía (no tocado en esta exploración).

### 4.1 Emisión de documentos — `index.php?Tipo_Doc=XX` **[MUTA]**
Crea documentos tributarios. **No usar desde la integración.** Tipos ofrecidos:

| Código | Documento | | Código | Documento |
|:---|:---|---|:---|:---|
| 33e | Factura Afecta Electrónica | | 39 | Boleta Afecta Electrónica |
| 34e | Factura Exenta Electrónica | | 41 | Boleta Exenta Electrónica |
| 52 | Guía de Despacho Electrónica | | 110e | Factura Exportación |
| 61 | Nota de Crédito Electrónica | | 111e/112e | ND/NC Exportación |
| 56 | Nota de Débito Electrónica | | 43 | Liquidación Factura |
| 45m/10m | Factura Afecta/Exenta Manual | | 21m/22m | NC/ND Manual |
| 13 | Factura a Tercero / de Compra | | 89 | Declaración de Ingreso |

### 4.2 Panel de Documentos — `paneldte.php` **[LEE + acciones por fila]**
El panel que ya integramos. Filtros:

| `fil` | Consulta | Parámetros clave |
|:---:|---|---|
| 1 | Por período | `mes`, `anio`, `CodEmp`, `rlib` |
| 2 | Por rango de fechas | `date13`, `date14` |
| 3 | Por folio | `NumFac1`, `NumFac2` |
| 4 | Por RUT cliente | `RutClien` |

- Orden por columna: `or=1..11`. Paginación `pagina=N` (en la práctica el portal devuelve todo en una respuesta; el `<select pagina>` lo llena JS y no refleja el total real en el HTML crudo).
- **Acciones por fila:**
  - `pdf_dte.php?post=<base64>&Ced=1` **[LEE]** — descarga PDF. El base64 decodifica a `Cod_Emp=<CodEmp>&Nreguist=<id>`. `Ced=1` = copia cedible.
  - XML: ícono `file-xml.png` → `estadodoc.php` → `dn.php?file=<RUT>_<TIPO>_<FOLIO>.xml` **[LEE]**. El nombre de archivo trae el RUT emisor (relevante para la Fase 3 pendiente).
  - `modidocu.php?...&Nreguist=` **[MUTA]** — modificar documento.
  - `adjuntar.php?...&Nreguist=` **[MUTA]** — adjuntar archivo.
  - `panelAceptacionSii.php` **[MUTA]** — aceptar/rechazar comercialmente un documento recibido.
  - Operaciones vía `paneldte.php?op=...&nif=`/`Nreguist=`: `op=des` (descargar), **`op=anul` (ANULAR) [MUTA]**, **`op=pag` (pagar) / `op=brp` (revertir pago) [MUTA]**.
  - Selección múltiple (`tbxIdsDocumentos`) + `impresionMasiva.php` **[LEE]** — impresión/descarga masiva.

### 4.3 Panel de Informes — `panelinf.php` **[LEE]**
Reportería. Secciones visibles: **Documentos, Cobranza, Pagos, Stock, Consumo de Folios, Gráficos, Ventas, Ficha Cliente, Voucher, Libros, Consulta Envío.** Exportables a **Excel y PDF**:

- `popFecha.php?Tp=xls|pdf` — reporte de documentos por fecha.
- `popPago.php?Tp=xls|pdf` — pagos.
- `popFechaIT.php?Tp=xls|pdf` — (intercambio/tránsito).
- `filenv.php?Tp=xls|pdf` — envíos.
- `filemail.php?Tp=xls|pdf` — correos de intercambio.
- Cuentas: `cuencob.php` (por cobrar), `cuenco.php` (por pagar), `cuenbxls.php`/`cuenxls.php` (Excel), `pdfCtaCo1.php`/`pdfCtaPa.php` (PDF).
- `resdte.php?rut=` — resumen DTE. `dterech.php` — rechazados. `foliospen.php` — folios pendientes. `valida.php`, `interpen.php`, `enviapen.php` — validación/pendientes de intercambio/envío.
- `graf/graf.php?peri=YYYY-MM` — gráficos del período.
- `calefolios.php` — calendario/consumo de folios.

### 4.4 Panel Contador — `libroenlinea/menu.php` ("Panel de Cargas") **[LEE/MUTA]**
Libros electrónicos SII y carga contable. `libroenlinea/menu1.php` = **Panel de Importación** (carga masiva) **[MUTA]**.

### 4.5 Otros paneles **[LEE]**
- `panelcons.php` — Panel Consultas.
- `panelcorreo.php?fil=1` — Panel Correos (intercambio de emails DTE).
- `panelfor.php` — Panel Formatos (plantillas de impresión).
- `panelnotificacion.php` — notificaciones.
- `datosEjecutivo.php` — datos del ejecutivo de cuenta.

### 4.6 Maestros (catálogos) **[MUTA — CRUD]**
Vía `popup(...)`: Productos (`lispro.php`), Clientes/Proveedores (`lisven.php`/`lis.php`), Personal, Centro de Costo (`cencos.php`), Formas de Pago (`formp.php`), Concepto (`conccont.php`), Contador (`conta.php`), Obras (`obras.php`), Auxiliares (`auxiliar.php`), Bodega (`bod.php`), Bancos, Factoring (`lisfac.php`), Sucursales, Lista IP (`listaip.php`), Cuentas (`liscue.php`), Unidades (`lisuc.php`).

---

## 5. Implicaciones para Chome

1. **La fuente de compras es `PNC_PanelCorreo.php` (Bandeja de Entrada), no `paneldte.php?rlib=com`.** El scraping actual apunta al endpoint equivocado. Hay ~600-680 facturas de proveedores por mes, con historial. Ver §7.
2. **El default `rlib: "com"` de `sync.ts` no sirve** — ese libro está en 0. Reapuntar la consulta de compras al Panel Correo.
3. **La Fase 3 (obtener RUT emisor) se disuelve:** el Panel Correo ya trae RUT emisor, razón social, tipo, folio, fecha y total en la tabla. No hace falta el salto `estadodoc.php → dn.php`.
4. **Empresa objetivo: `CodEmp=433` (Servicios Industriales Chome Limitada).** Se descarta 434 (Aseos Industriales Recart Limitada). Sync de una sola empresa.
5. **Contrato de consulta por período:** en `paneldte.php` usar `mes`+`anio` (no `peri`); en `PNC_PanelCorreo.php` usar `cbxMesDocumento`+`cbxAnioDocumento` (POST, ver §7).
6. **TLS legacy:** el cliente HTTP debe forzar TLS 1.2 / cipher permisivo y tolerar cert no verificable. Verificar que el `DtePortalClient` no rompa en el servidor real.
7. **Decisión de negocio pendiente (solo-lectura vs. acción):** conciliar las compras recibidas contra OC/recepción es una integración de *lectura* segura y de alto valor. *Aceptar/rechazar* documentos desde Chome tiene efecto tributario (Ley 19.983) y **no** debe implementarse sin autorización explícita.
8. **NO construir "módulo de facturación" (ventas) sobre esto.** El lado de ventas es espejo de la emisión que el portal ya gestiona; no hay dominio de ventas/clientes en Chome. El valor está en compras.

---

## 6. Endpoints observados (referencia rápida)

`paneldte.php` · `index.php` · `panelinf.php` · `panelcons.php` · `panelcorreo.php` · `PanelCorreo/PNC_PanelCorreo.php` · `panelfor.php` · `panelnotificacion.php` · `panelAceptacionSii.php` · `pdf_dte.php` · `dtepdfX.php` · `estadodoc.php` · `dn.php` · `phpdf.php` · `modidocu.php` · `adjuntar.php` · `impresionMasiva.php` · `libroenlinea/menu.php` · `libroenlinea/menu1.php` · `datosEjecutivo.php` · `asignar.php` · `resdte.php` · `dterech.php` · `foliospen.php` · `valida.php` · `interpen.php` · `enviapen.php` · `graf/graf.php` · `calefolios.php` · reportes `popFecha/popFechaIT/popPago/filenv/filemail (Tp=xls|pdf)` · cuentas `cuencob/cuenco/cuenbxls/cuenxls/pdfCtaCo1/pdfCtaPa` · maestros `lispro/lisven/lis/cencos/formp/conccont/conta/obras/auxiliar/bod/lisfac/lisuc/liscue/listaip` · `acceso.php` (login/logout).

---

## 7. Panel Correo → Bandeja de Entrada — AQUÍ están las compras

Este es el hallazgo clave para la integración. El "Panel Correos" (`panelcorreo.php`) es un cascarón con un iframe que carga el panel real:

```
PanelCorreo/PNC_PanelCorreo.php?CODIGOEMPRESA=433&RUTUSUARIO=<rut_usr>
```

Es la **bandeja de intercambio de correos DTE**: donde los proveedores de Chome envían sus facturas electrónicas. **Es la fuente real de las compras.**

### 7.1 Consulta (read-only)
- Método: **POST** a `PNC_PanelCorreo.php?...&ACCION=1` con los filtros del formulario.
- Filtros: `cbxEstadoPlataforma` (`""`=Todos, `ENV`=Enviados, `PEN`=Pendientes, `BLO`=Bloqueados), `cbxMesDocumento` (01-12), `cbxAnioDocumento`, `cbxCodigoEmpresa` (433), `tbxRutProveedor`, `chkFechaRecepcion` (filtrar por fecha de recepción vs. fecha doc).
- Devuelve `tbxTotalRegistros` = total del período. **Verificado read-only:** 2026-06 → **681**, 2026-04 → **607**, agosto (parcial/pendientes) → 40.
- Historial completo filtrable por mes/año — sirve para backfill.
- **Sin paginación real** (verificado 2026-08-04): la respuesta a un único POST trae **todas** las filas del período (los 681 de junio confirmados). La respuesta puede tardar hasta ~80s en generarse para un mes de ese volumen — el cliente HTTP necesita un timeout generoso para este endpoint específico, no los ~30s de `paneldte.php`.
- **Ojo con el ancla de fila al parsear:** no usar la presencia del checkbox `chkRegistro` para detectar filas — solo las filas en estado PENDIENTE lo tienen (537 de 681 en junio); las demás (ENVIADO y otros) no llevan checkbox y se perderían. El ancla confiable es el propio `<tr>` (sin atributos especiales, a diferencia de `paneldte.php`) filtrado por contener `dtepdfX.php?post=` (aparece exactamente una vez por fila, 681/681 verificado).

### 7.2 Columnas por fila
`# · Fecha/Hora recepción · Estado plataforma · Fecha doc · Tipo (Factura/NC/…) · Folio · RUT emisor · Razón Social · Total · Tipo ref · Folio ref · Fecha ref`

Ejemplo real: `2026-06-01 09:09 | PENDIENTE | 2026-06-01 | Factura Electronica | 3017654 | 96542490-3 | TRECK S A | 49742 | 801 | 595 | 2026-04-20`

Mezcla típica (junio 2026, muestra): ~90% Factura Electrónica, resto Factura Exenta y Notas de Crédito. Proveedores reales vistos: FINNING, KUPFER, COPEC, ENEX, IMPLEMENTOS, VERISURE, ABUTER, ÁRIDOS COIHUE, seguros, arriendo de maquinaria, etc.

**La columna "Estado plataforma" NO es texto — es markup muerto.** El texto literal `PENDIENTE` que parecía aparecer en el 79% de las filas (537/681, junio) está en realidad dentro de un comentario HTML nunca renderizado: `<!--<td align='center'><span style='color:red'>PENDIENTE</span></td>-->` (verificado: las 537 ocurrencias coinciden exactamente con ese patrón comentado). Es un vestigio del template, no una señal real — contar ese substring fue un artefacto de la exploración, no un hecho del portal.

La señal real de estado combina, por fila:
- Un punto de color inline (`<span style='...background: #hex'>`) justo después de la columna de fecha/hora — mismo patrón no mapeado que los puntos de "Aceptación SII" del panel de ventas; se ignora deliberadamente, igual criterio.
- El ícono `penplata.gif` (`title="Pendiente de envio a la Plataforma"`), presente cuando el documento aún no se envía al libro — es la señal más útil y barata de extraer.
- El checkbox `chkRegistro` puede existir `disabled='disabled'` (`title="Para enviar a plataforma debe aceptar el documento"`) incluso en filas "pendientes" — su sola presencia/ausencia NO distingue de forma limpia un estado de negocio.

Para `dteDocuments.estadoPlataforma` (texto libre, nullable): usar el `title` de `penplata.gif` si está presente; si no, `null`. No forzar un enum — el portal no lo expone de forma confiable como tal.

### 7.3 Acciones por fila
- `dtepdfX.php?post=<base64>` **[LEE]** — PDF del documento del proveedor (base64 = `Cod_Emp=433&Nreguist=<id>`).
- **XML del proveedor — enlace directo, sin salto intermedio** (verificado 2026-08-04): `<a href=../empr/Chome/DTEProveedores/PRV_<RUT_EMISOR>_<TIPO>_<FOLIO>.xml target='_blank'>` envolviendo el ícono `file-xml.png`. Verificado 681/681 filas de junio con este patrón exacto; carpeta siempre `Chome` (fija para esta cuenta); tipos vistos en el nombre de archivo: `33` (483), `52` (143), `34` (40), `61` (14), `39` (1) — coinciden con los códigos ya definidos en `DteTipo` (`types.ts`). A diferencia del flujo de ventas (que requiere `estadodoc.php → dn.php`), acá **no hace falta ningún salto**: el RUT emisor, tipo y folio del nombre de archivo son redundantes con las columnas ya parseadas de la fila, útiles como verificación cruzada.
- `VerMail(...)` → `PNC_CorreosIntercambio.php` **[LEE]** — ver el correo de intercambio.
- `AceptarRechazar(...)` → `PNC_AceptarRechazar.php` **[MUTA]** — aceptar/rechazar (Ley 19.983). **No tocado.**
- `PNC_EnviarPlataforma.php` **[MUTA]** — enviar el documento a la plataforma (procesarlo al libro). **No tocado.**
- `PNC_ActualizarCorreos.php` **[MUTA]** — traer correos nuevos desde el buzón. **No tocado.**
- `blodoc.php` **[MUTA]** — bloquear documento. **No tocado.**

### 7.4 Por qué el libro `com` está en 0
Los documentos de la bandeja llegan por correo pero nadie ejecuta `PNC_EnviarPlataforma.php` para procesarlos hacia el libro — el libro de compras (`paneldte.php?rlib=com`) solo se pobla en ese paso, y como no ocurre, queda vacío. La bandeja es el buzón crudo; el libro es lo ya contabilizado. (No hay un desglose confiable de cuántos documentos están en cada sub-estado dentro de la bandeja — ver nota sobre "Estado plataforma" arriba — pero es irrelevante para la integración: todos son igualmente compras reales de Chome, procesadas o no hacia el libro.)

### 7.5 Qué habilita para la integración
- **Conciliación de compras real:** RUT emisor + folio + tipo + total por fila → cruce directo con `suppliers.rut` y `purchaseOrderInvoices`. Sin el problema de la Fase 3.
- **XML del proveedor descargable** → neto/IVA/detalle de ítems para conciliación fina y para el reporte Libro de Compras.
- **Backfill** por mes/año.
- Todo lo necesario es **de lectura**. La aceptación/rechazo (efecto tributario) queda deliberadamente fuera salvo autorización.

---

## 8. Inventario completo de menús y dropdowns

Barrido de todos los paneles y desplegables (2026-08-04, solo lectura). El holding tiene **2 empresas**: `433` Servicios Industriales Chome Limitada · `434` Aseos Industriales Recart Limitada (ambas con resolución SII 2014-08-22).

### 8.1 Catálogo de tipos de documento (todos los menús de emisión)
`e`=electrónico · `m`=manual. **Todos [MUTA]** — referencia, no usar desde la integración.

| Cód | Documento | Cód | Documento |
|:---|:---|:---|:---|
| 33 | Factura Afecta Electrónica | 45m | Factura Afecta Manual |
| 34 | Factura Exenta Electrónica | 10m | Factura Exenta Manual |
| 61 | Nota de Crédito Electrónica | 21m | Nota de Crédito Manual |
| 56 | Nota de Débito Electrónica | 22m | Nota de Débito Manual |
| 52 | Guía de Despacho Electrónica | 50 | Guía de Despacho Manual |
| 39 / 41 | Boleta Afecta / Exenta | 89 | Declaración de Ingreso |
| 43 / 40 | Liquidación Factura (e / m) | 103m | Liquidación |
| 110e | Factura Exportación | 88 | Factura Exportación Manual |
| 112e / 111e | NC / ND Exportación Elec. | 106m / 104m | NC / ND Exportación Manual |
| 87 | **Factura de Compra Electrónica** | 92 | Factura de Compra Manual |
| 13 / 14 | Factura a Tercero (m / e) | 93m | Orden de Compra |
| 94m | Cotización | 100m | Aviso Cargo PAC |
| 90 / 91 | Vale Ingreso / Salida | 102e | Factura Venta Exenta Zona Franca |
| 901e | Factura Exenta Ley 18.392 | 1108e | Solicitud Registro Factura |
| 1909e | Factura Venta Módulo ZF | 1910e | Solicitud Traslado Zona Franca |
| 95-99 | Documentos guardados (borradores) | 99 | Doc. Genérico |

Los "Otros Documentos" viven en `otrodoc.php` (no electrónicos) y `otrodocc.php` (electrónicos).

### 8.2 Panel Documentos (`paneldte.php`) — dropdowns
- **Libro** (`rlib`): ventas · compras · guías · boletas · otros.
- **Otro Doc** (dropdown): 99 genérico · 94 cotización · 93 orden compra · 90/91 vale ingreso/salida · FAC factoring · 89 declaración ingreso · 100 aviso cargo PAC.
- **Empresa** (`CodEmp`): 433 · 434. **Mes/Año** para el período.

### 8.3 Panel Informes (`panelinf.php`) **[LEE]** — árbol completo
| Sección | Qué ofrece | Endpoints |
|---|---|---|
| Documentos | Listar por tipo, exportar | `popFecha.php` (xls/pdf) |
| Cobranza | Cuentas por cobrar | `cuenbxls.php` (xls) · `pdfCtaCo1.php` (pdf) |
| Pagos | Cuentas por pagar | `cuenxls.php` (xls) · `pdfCtaPa.php` (pdf) · `popPago.php` |
| Stock | Ingreso (90) / Salida (91) / Listar | `ControlStock()` · `Stock/STK_Listado.php` |
| Consumo de Folios | Calendario de envío, folios | `calefolios.php` · `foliospen.php` |
| Envío / Validar / Intercambio | Gestión de intercambio SII | `enviapen.php` · `valida.php` · `interpen.php` · `filenv.php` · `filemail.php` |
| Rechazos SII | Documentos rechazados | `dterech.php` |
| Gráficos | Gráfico por período | `graf/graf.php?peri=YYYY-MM` |

Los selectores de reporte (`popFecha` / `popFechaIT` / `popPago` / `filenv` / `filemail`) comparten dropdowns: **Mes** (01-12), **Año** (2007-2026), **Empresa** (433/434), y **TipoDoc** (`00` Todos · `33` · `34` · `61` · `56` · `52` · `14` Factura de Compra Electrónica). Cada uno genera **Excel o PDF**.

### 8.4 Panel Contador (`libroenlinea/menu.php` → `LIB_Informe.php`) **[LEE/MUTA]**
**Libro Electrónico SII (IECV / RCV).** Dropdown `cbxTipoLibro`: **1 Compras · 2 Ventas · 3 Boletas · 4 Guías**. `cbxEmpresa`: 433/434 (+ año).
- Vista por período (2026-01…): columnas Fecha · Período · Total · Estado · Track ID · Tipo.
- **Estado actual: vacío** (totales en "-", períodos sin generar) — igual que el libro `com`. Es la herramienta de *generar y enviar* el libro al SII, no una fuente poblada.
- Sub-pestañas: Reportes · Archivo · Resumen · Cierre. Acciones: `Resumen` (LEE) · **Importar / Enviar / Validar / Ajuste / Rectifica / Cierre (MUTA)**.

### 8.5 Otros paneles
- **Panel Correos** (`panelcorreo.php` → `PNC_PanelCorreo.php`): bandeja de compras, ver §7. Dropdowns: Estado (Todos/Enviados/Pendientes/Bloqueados) · Mes · Año · Empresa · Rut Proveedor.
- **Panel Consultas** (`panelcons.php`): sección "CONSULTAS / Guía Inicio" + Buscar (seguimiento/consulta de documentos). Contenido mínimo.
- **Panel Formatos** (`panelfor.php`): plantillas de impresión ("FORMATOS").
- **Panel Notificaciones** (`panelnotificacion.php`): 24 avisos, paginado.
- **Panel Importación** (`libroenlinea/menu1.php` · `LIB_ImportarMovimientos.php`): carga masiva de movimientos **[MUTA]**.

### 8.6 Maestros (catálogos) **[LEE listar / MUTA editar]**
Cada uno abre en popup: **Productos** (`lispro.php` — con "Maestro Lista de Precio" y "Maestro Lista de SKU") · **Clientes/Proveedores** (`lisven.php`, `lis.php`) · **Centros de Costo** (`cencos.php`) · **Formas de Pago** (`formp.php`) · **Conceptos Contables** (`conccont.php`) · **Contador** (`conta.php`) · **Obras** (`obras.php`) · **Auxiliares** (`auxiliar.php` + Explorar) · **Bodega** (`bod.php`) · **Bancos** · **Factoring** (`lisfac.php`) · **Sucursales** · **Lista IP** (`listaip.php`) · **Cuentas** (`liscue.php`) · **Unidades** (`lisuc.php`).

### 8.7 Nota sobre fuentes de compras (resumen)
Tres lugares tocan "compras", solo uno tiene datos:

| Fuente | Endpoint | Estado |
|---|---|---|
| Libro compras (Panel Documentos) | `paneldte.php?rlib=com` | **vacío (0)** |
| Libro Electrónico SII (Contador) | `LIB_Informe.php` tipo 1 | **vacío (sin generar)** |
| **Bandeja de Entrada (Panel Correo)** | **`PNC_PanelCorreo.php`** | **✅ 600-680/mes, con historial** |

→ La integración de compras debe leer de `PNC_PanelCorreo.php`. Los otros dos se poblarían solo si alguien procesa/acepta los documentos de la bandeja hacia el libro.

---

## 9. Constancia consolidada — todo lo que se puede hacer en el portal

Catálogo completo de capacidades (2026-08-04). **[LEE]** = solo lectura · **[MUTA]** = crea/modifica/envía/borra. **Ninguna capacidad [MUTA] fue ejecutada en esta exploración** — solo se leyó.

| # | Área | Capacidad | Tipo | Endpoint |
|:--:|---|---|:--:|---|
| 1 | Acceso | Entrar con rut_usr + rut_emp + clave (sin sesión) | LEE | `acceso.php` / cualquier `*.php` |
| 2 | Acceso | Cambiar entre empresas 433 / 434 del holding | LEE | `CodEmp=` |
| 3 | **Emisión** | Emitir factura afecta/exenta, NC, ND, guía, boleta, exportación, liquidación, factura de compra, etc. (~30 tipos, §8.1) | **MUTA** | `index.php?Tipo_Doc=` · `otrodoc.php` · `otrodocc.php` |
| 4 | Documentos | Consultar emitidos por período / rango / folio / RUT | LEE | `paneldte.php?fil=1..4` |
| 5 | Documentos | Descargar PDF (tributario y cedible) | LEE | `pdf_dte.php` |
| 6 | Documentos | Descargar XML | LEE | `estadodoc.php` → `dn.php` |
| 7 | Documentos | Impresión / descarga masiva (multi-selección) | LEE | `impresionMasiva.php` |
| 8 | Documentos | Modificar documento | **MUTA** | `modidocu.php` |
| 9 | Documentos | Anular documento | **MUTA** | `paneldte.php?op=anul` |
| 10 | Documentos | Marcar pagado / revertir pago | **MUTA** | `op=pag` / `op=brp` |
| 11 | Documentos | Adjuntar archivo a un documento | **MUTA** | `adjuntar.php` |
| 12 | Documentos | Aceptación SII comercial de un documento | **MUTA** | `panelAceptacionSii.php` |
| 13 | **Compras** | Ver Bandeja de Entrada (DTE recibidos de proveedores, §7) | LEE | `PNC_PanelCorreo.php` |
| 14 | Compras | Descargar PDF / XML del documento del proveedor | LEE | `dtepdfX.php` · `file-xml.png` |
| 15 | Compras | Ver el correo de intercambio | LEE | `PNC_CorreosIntercambio.php` |
| 16 | Compras | Aceptar / rechazar documento recibido (Ley 19.983) | **MUTA** | `PNC_AceptarRechazar.php` |
| 17 | Compras | Enviar documento a la plataforma (procesar al libro) | **MUTA** | `PNC_EnviarPlataforma.php` |
| 18 | Compras | Traer correos nuevos desde el buzón | **MUTA** | `PNC_ActualizarCorreos.php` |
| 19 | Compras | Bloquear documento | **MUTA** | `blodoc.php` |
| 20 | Informes | Reporte de documentos por fecha/tipo → Excel/PDF | LEE | `popFecha.php` · `filenv.php` · `filemail.php` |
| 21 | Informes | Cuentas por cobrar (cobranza) → Excel/PDF | LEE | `cuenbxls.php` · `pdfCtaCo1.php` |
| 22 | Informes | Cuentas por pagar (pagos) → Excel/PDF | LEE | `cuenxls.php` · `pdfCtaPa.php` · `popPago.php` |
| 23 | Informes | Stock: ingreso/salida/listado | LEE/MUTA | `Stock/STK_*.php` · `index.php?Tipo_Doc=90/91` |
| 24 | Informes | Consumo/calendario de folios, folios pendientes | LEE | `calefolios.php` · `foliospen.php` |
| 25 | Informes | Gestión intercambio: envíos, validación, rechazos SII | LEE | `enviapen.php` · `valida.php` · `interpen.php` · `dterech.php` |
| 26 | Informes | Gráficos por período | LEE | `graf/graf.php` |
| 27 | **Libro SII** | Ver libro electrónico Compras/Ventas/Boletas/Guías (IECV/RCV) | LEE | `LIB_Informe.php` (`cbxTipoLibro` 1-4) |
| 28 | Libro SII | Resumen del libro de un período | LEE | `LIB_Resumen.php` |
| 29 | Libro SII | Importar movimientos al libro | **MUTA** | `LIB_ImportarMovimientos.php` |
| 30 | Libro SII | Generar / enviar / validar / ajustar / rectificar / cerrar libro | **MUTA** | `LIB_Informe.php?ACCION=` |
| 31 | Maestros | Listar catálogos (productos+precios+SKU, clientes/proveedores, centros de costo, formas de pago, conceptos, obras, auxiliares, bodega, bancos, factoring, sucursales, lista IP, cuentas, unidades) | LEE | `lispro/lisven/lis/cencos/formp/conccont/conta/obras/auxiliar/bod/lisfac/lisuc/listaip/liscue.php` |
| 32 | Maestros | Crear / editar / borrar registros de cualquier catálogo | **MUTA** | (mismos endpoints, formularios) |
| 33 | Otros | Panel Consultas (seguimiento de documentos) | LEE | `panelcons.php` |
| 34 | Otros | Panel Formatos (plantillas de impresión) | LEE | `panelfor.php` |
| 35 | Otros | Panel Notificaciones | LEE | `panelnotificacion.php` |
| 36 | Otros | Panel Importación (carga masiva) | **MUTA** | `libroenlinea/menu1.php` |
| 37 | Otros | Datos del ejecutivo de cuenta | LEE | `datosEjecutivo.php` |

**Resumen:** el portal es un ERP tributario completo de FacturaEnLínea (emisión, recepción, libros SII, cuentas por cobrar/pagar, stock, maestros). Para Chome, la superficie **de lectura útil** es: consulta de documentos, **Bandeja de Entrada de compras (§7)**, informes/exportes Excel-PDF, y libro electrónico. Todo lo demás emite o modifica y queda fuera del alcance de solo-lectura.
