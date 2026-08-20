/**
 * Fixture HTML: PanelCorreo/PNC_PanelCorreo.php (Bandeja de Entrada), respuesta
 * al POST con ACCION=1 y filtro de período.
 *
 * Estructura sanitizada a partir de HTML real capturado del portal el
 * 2026-08-04 (RUT/razón social/folios/montos reemplazados por valores
 * ficticios, pero con la misma forma). Preserva las particularidades reales
 * verificadas:
 * - Las filas son bloques `<tr>` sueltos (bare, sin atributos — a diferencia
 *   de paneldte.php que usa `<tr onmouseover=...>`).
 * - El ancla confiable de fila es `dtepdfX.php?post=`, no el checkbox
 *   `chkRegistro` (solo aparece, a veces `disabled`, en algunas filas).
 * - La celda de "Estado plataforma" es un COMENTARIO HTML nunca renderizado
 *   (`<!--<td>...PENDIENTE...</td>-->`) — no es texto real, y el parser lo
 *   descarta antes de numerar las celdas (por eso no ocupa un índice).
 * - El estado real se transmite por un ícono `penplata.gif` (title da el
 *   texto) cuando el documento no se ha enviado a la plataforma; ausente en
 *   los demás casos.
 * - El XML del proveedor es un enlace directo, sin salto intermedio:
 *   `../empr/Chome/DTEProveedores/PRV_<RUT>_<TIPO>_<FOLIO>.xml`.
 * - Layout físico de columnas (`<td>` de nivel superior, 0-indexado, sin
 *   contar los comentarios HTML):
 *   0=#, 1=íconos Opciones, 2=checkbox, 3=fecha/hora recepción,
 *   4=punto de color (sin mapear), 5=spacer vacío, 6=fecha doc,
 *   7=tipo (texto), 8=folio, 9=RUT emisor, 10=razón social,
 *   11=ícono/spacer, 12=total, 13=tipo ref, 14=folio ref, 15=fecha ref.
 *
 * @see EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md § 7
 */

const ROW_PENDIENTE = `<tr>
				<td align='center'>1</td><td align='center' width='80px'><a href='#' onclick="AceptarRechazar('433','9000001')"><img src='../img/flag_blue.png' width='16' heigth='16' title='Respuesta de Recepcion Enviada
Para Aceptar o Rechazar haga clic'></a>&nbsp;<a href='#' onclick="VerMail('433','fixture-mail-id-1@example.com','2026-06-01')"><img src='../img/email_open.png' width='16' heigth='16' title='Correo Proveedor'></a>&nbsp;<a href=../empr/Chome/DTEProveedores/PRV_11111111-1_33_100001.xml target='_blank'><img src='../img/file-xml.png' height='16' width='16' border='0' title='XML proveedor'/></a>&nbsp;</td>
					<td align='center'><input type='checkbox' name='chkRegistro' id='chkRegistro1' disabled='disabled' title='Para enviar a plataforma debe aceptar el documento' ></td>
				<td align='center'>2026-06-01 09:09</td>
				<!--<td align='center'><span style='color:red'>PENDIENTE</span></td>-->
				<td align='center'><a href='#' style='TEXT-DECORATION: none;' onclick="AceptarRechazar('433','9000001')"><span style='display:inline-block;width: 10px;height: 10px;-moz-border-radius: 50%;-webkit-border-radius: 50%;border-radius: 50%;background: #0485F5;'></span> </a></td>
				<td align='center'></td>
				<td align='center'>2026-06-01</td>
				<td align='center'><a href='../dtepdfX.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9OTAwMDAwMQ==' style='font-style:normal; font-weight:normal; color:#0000FF' target='_blank' title='Visualizacion del Documento'>Factura Electronica</a></td>
				<td align='center' title='9000001' >100001</td>
				<td align='center'>11111111-1</td>
				<td align='center'>PROVEEDOR UNO SPA</td>
				<td align='center'><img src='../img/penplata.gif' title='Pendiente de envio a la Plataforma' height='20' width='20' /></td>
				<td align='right'>50000</td>
				<td align='right'>801</td>
				<td align='right'>0</td>
				<td align='right'>2026-06-01</td>
			</tr>`

const ROW_ENVIADA = `<tr>
				<td align='center'>2</td><td align='center' width='80px'><a href='#' onclick="AceptarRechazar('433','9000002')"><img src='../img/flag_blue.png' width='16' heigth='16' title='Respuesta de Recepcion Enviada
Para Aceptar o Rechazar haga clic'></a>&nbsp;<a href='#' onclick="VerMail('433','fixture-mail-id-2@example.com','2026-06-01')"><img src='../img/email_open.png' width='16' heigth='16' title='Correo Proveedor'></a>&nbsp;<a href=../empr/Chome/DTEProveedores/PRV_22222222-2_52_200002.xml target='_blank'><img src='../img/file-xml.png' height='16' width='16' border='0' title='XML proveedor'/></a>&nbsp;</td>
					<td align='center'></td>
				<td align='center'>2026-06-01 09:08</td>
				<!--<td align='center'><span style='color:red'>PENDIENTE</span></td>-->
				<td align='center'></td>
				<td align='center'></td>
				<td align='center'>2026-06-01</td>
				<td align='center'><a href='../dtepdfX.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9OTAwMDAwMg==' style='font-style:normal; font-weight:normal; color:#0000FF' target='_blank' title='Visualizacion del Documento'>Guia de Despacho Electronica</a></td>
				<td align='center' title='9000002' >200002</td>
				<td align='center'>22222222-2</td>
				<td align='center'>PROVEEDOR DOS S.A.</td>
				<td align='center'></td>
				<td align='right'>632180</td>
				<td align='right'>OBS</td>
				<td align='right'>0</td>
				<td align='right'>2026-06-01</td>
			</tr>`

const ROW_NOTA_CREDITO = `<tr>
				<td align='center'>3</td><td align='center' width='80px'><a href='#' onclick="AceptarRechazar('433','9000003')"><img src='../img/flag_blue.png' width='16' heigth='16' title='Respuesta de Recepcion Enviada
Para Aceptar o Rechazar haga clic'></a>&nbsp;<a href='#' onclick="VerMail('433','fixture-mail-id-3@example.com','2026-06-02')"><img src='../img/email_open.png' width='16' heigth='16' title='Correo Proveedor'></a>&nbsp;<a href=../empr/Chome/DTEProveedores/PRV_11111111-1_61_100050.xml target='_blank'><img src='../img/file-xml.png' height='16' width='16' border='0' title='XML proveedor'/></a>&nbsp;</td>
					<td align='center'><input type='checkbox' name='chkRegistro' id='chkRegistro3' title='Para enviar a plataforma debe aceptar el documento' ></td>
				<td align='center'>2026-06-02 10:15</td>
				<!--<td align='center'><span style='color:red'>PENDIENTE</span></td>-->
				<td align='center'><a href='#' style='TEXT-DECORATION: none;' onclick="AceptarRechazar('433','9000003')"><span style='display:inline-block;width: 10px;height: 10px;-moz-border-radius: 50%;-webkit-border-radius: 50%;border-radius: 50%;background: #0485F5;'></span> </a></td>
				<td align='center'></td>
				<td align='center'>2026-06-02</td>
				<td align='center'><a href='../dtepdfX.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9OTAwMDAwMw==' style='font-style:normal; font-weight:normal; color:#0000FF' target='_blank' title='Visualizacion del Documento'>Nota de Credito Electronica</a></td>
				<td align='center' title='9000003' >100050</td>
				<td align='center'>11111111-1</td>
				<td align='center'>PROVEEDOR UNO SPA</td>
				<td align='center'><img src='../img/penplata.gif' title='Pendiente de envio a la Plataforma' height='20' width='20' /></td>
				<td align='right'>15000</td>
				<td align='right'>33</td>
				<td align='right'>100001</td>
				<td align='right'>2026-06-01</td>
			</tr>`

/** Fixture con 3 filas y tbxTotalRegistros=3 (sin discrepancia). */
export const PANELCORREO_BANDEJA_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Untitled Document</title></head>
<body>
<form name="thisform" method="post">
  <select name="cbxEstadoPlataforma"><option value="">Todos</option></select>
  <select name="cbxMesDocumento"><option value="06" selected>Junio</option></select>
  <select name="cbxAnioDocumento"><option value="2026" selected>2026</option></select>
  <select name="cbxCodigoEmpresa"><option value="433" selected>Servicios Industriales Chome Limitada</option></select>
  <input type="text" name="tbxRutProveedor" value="" />
  <table id="resultados">
    <tr><th>#</th><th>Opciones</th><th>Sel</th><th>Fecha/Hora</th><th>Estado</th><th>Punto</th><th></th><th>Fecha Doc</th><th>Documento</th><th>Folio</th><th>RUT</th><th>Razon Social</th><th>Plataforma</th><th>Total</th><th>Tipo Ref</th><th>Folio Ref</th><th>Fecha Ref</th></tr>
    ${ROW_PENDIENTE}
    ${ROW_ENVIADA}
    ${ROW_NOTA_CREDITO}
  </table>
  <input type="hidden" name="tbxTotalRegistros" id="tbxTotalRegistros" value="3">
  <input type="hidden" name="tbxRutUsuario" value="6466452-2">
  <input type="hidden" name="tbxCodigoEmpresa" value="433">
</form>
</body>
</html>`

/** Misma fixture pero con tbxTotalRegistros=5 (declara más de lo que trae, para probar el aviso de discrepancia). */
export const PANELCORREO_BANDEJA_DISCREPANCIA_FIXTURE = PANELCORREO_BANDEJA_FIXTURE.replace(
  "value=\"3\">",
  "value=\"5\">",
)

/** Fixture sin filas (período sin documentos recibidos). */
export const PANELCORREO_BANDEJA_VACIA_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Untitled Document</title></head>
<body>
<form name="thisform" method="post">
  <table id="resultados">
    <tr><th>#</th><th>Opciones</th></tr>
  </table>
  <input type="hidden" name="tbxTotalRegistros" id="tbxTotalRegistros" value="0">
</form>
</body>
</html>`
