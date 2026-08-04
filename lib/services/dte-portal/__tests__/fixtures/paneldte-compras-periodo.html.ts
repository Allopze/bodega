/**
 * Fixture HTML: paneldte.php, libro de ventas, filtro por período.
 *
 * Estructura sanitizada a partir de HTML real capturado del portal el
 * 2026-08-04 (rut/razón social/montos reemplazados por valores ficticios).
 * Preserva las particularidades reales verificadas:
 * - Las filas de datos NO están dentro de <table id="tabla"> (esa tabla solo
 *   contiene el encabezado); son bloques `<tr onmouseover=...>` sueltos.
 * - Cada celda "top-level" (Opciones, Estado) contiene una subtabla propia.
 * - "Aceptación SII" trae puntos de color inline, no íconos.
 * - Los íconos Sii*.png / flag_*.png / Corr*.png viven en la columna "Estado".
 * - "Documento" trae el nombre en español ("Factura Electronica"), no el código.
 * - La fecha viene en ISO (yyyy-mm-dd).
 * - El <select name="pagina"> siempre trae una sola opción en el HTML crudo
 *   (se llena por JS en el navegador); tbxTotalDocumentos sí es confiable.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 8, 19
 */

const ROW_ANULADA = `
  <tr onmouseover='this.style.background="#ECECFF"' onmouseout='this.style.background="white"'>
    <td background="#F4F4F4" align="center">
       <table width="131" border="0" cellspacing="0" cellpadding="0">
      <tr>
       <td width="43" align="center" background="img/#F4F4F4">
                                <img src="img/file-xml.png" height="16" width="16" border="0" title="XML pendiente envio"/>
                                                        <a href="pdf_dte.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9MTAwMDAwMQ==&Ced=1" target="_blank">
                                                    <img src="img/pdf_buttonCED.png" border="0" title="Cedible"/>
                                            </a>
                                    </td>
       <td width="1" bgcolor="#000000"></td>
       <td width="51" align="center" background="img/#F4F4F4">
                        <input name="Nreguist[]" type="checkbox" value="1000001" onClick="window.location='paneldte.php?fil=1&CodEmp=433&rlib=ven&op=des&clave=xxx&rut_usr=1-9&rut_emp=2-7&peri=2026-07&Nreguist=1000001&anio=2026&mes=07&FchCon='" checked title="Quitar del LIBRO">
              <a href="#" onClick="popup4('modidocu.php?fil=1&CodEmp=433&rut_usr=1-9&Nreguist=1000001')" title="Modificar Documento"><img src="img/modi.png" border="0"></a>
                             </td>
       <td width="1" bgcolor="#000000"></td>
       <td width="45" align="center" background="img/#F4F4F4">
                <input type="checkbox" name="Sel[]" id="mail_1000001" value="1000001" onclick='Selecciona(this)' title="Enviar Email"/>
              <a href="#" onClick="popupadd('adjuntar.php?CodEmp=433&Nreguist=1000001')" title="Adjuntar Archivo"><img src="img/atta.png" border="0"/></a>
               </td>
      </tr>
     </table>    </td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center"><a href="#" onclick="AceptacionSii('433','1000001')" style="text-decoration:none"><span style='display:inline-block;width: 10px;height: 10px;border-radius: 50%;background: #0485F5;'></span> </a></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center"><font style="font-size:10px">2026-01-15</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center">
       <a href="pdf_dte.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9MTAwMDAwMQ==" style="color:#0000FF" target="_blank" title="Documento Original">
Factura Electronica</a>
       <a href="pdf_dte_tira.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9MTAwMDAwMQ==" style="color:#0000FF" target="_blank" title="Documento Original">
       [POS]        </a>
        </td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center"><font style="font-size:10px" title="N. Interno: 1000001">12715</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="left" title="Proveedor Ficticio SpA"><font style="font-size:10px">Proveedor Ficticio SpA</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center">
       <table width="96" height="18" border="0" align="center" cellpadding="0" cellspacing="0">
        <tr align="center">
                  <td width="21" align="center"><img src='img/SiiAnu.png' title='Documento Anulado' /></td>
            <td width="5">&nbsp;&nbsp;</td>
         <td width="30" align="left"></td>
         <td width="25" align="center"><img src='img/CorrPen.png' title='Email Comercial Pendiente de Envio' /></td>
         <td width="25" align="center"></td>
        </tr>
       </table>
               </td>
    <td bgcolor="#000000" width="1"></td>
    <td align="right"><font style="font-size:10px">0</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="right"><font style="font-size:10px">0</font></td>
    <td bgcolor="#000000" width="1"></td>
  </tr>
  <tr>
    <td></td>
    <td colspan="16" bgcolor="#000000" height="1"></td>
  </tr>`

const ROW_ACEPTADA = `
  <tr onmouseover='this.style.background="#ECECFF"' onmouseout='this.style.background="white"'>
    <td background="#FFF3E8" align="center">
       <table width="131" border="0" cellspacing="0" cellpadding="0">
      <tr>
       <td width="43" align="center" background="img/#FFF3E8">
                    <a onClick="popupd('estadodoc.php?codemp=433&folio=12716&tipodoc=61&Nreguist=1000002')" style="cursor:pointer">
                                            <img src="img/file-xml.png" height="16" width="16" border="0"/>
                    </a>
                                                        <a href="pdf_dte.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9MTAwMDAwMg==&Ced=1" target="_blank">
                                                    <img src="img/pdf_buttonCED.png" border="0" title="Cedible"/>
                                            </a>
                                    </td>
       <td width="1" bgcolor="#000000"></td>
       <td width="51" align="center" background="img/#FFF3E8">
                        <input name="Nreguist[]" type="checkbox" value="1000002" onClick="window.location='paneldte.php?fil=1&CodEmp=433&rlib=ven&op=des&clave=xxx&rut_usr=1-9&rut_emp=2-7&peri=2026-01&Nreguist=1000002&anio=2026&mes=01&FchCon='" checked title="Quitar del LIBRO">
              <a href="#" onClick="popup4('modidocu.php?fil=1&CodEmp=433&rut_usr=1-9&Nreguist=1000002')" title="Modificar Documento"><img src="img/modi.png" border="0"></a>
                             </td>
       <td width="1" bgcolor="#000000"></td>
       <td width="45" align="center" background="img/#FFF3E8">
                <input type="checkbox" name="Sel[]" id="mail_1000002" value="1000002" onclick='Selecciona(this)' title="Enviar Email"/>
              <a href="#" onClick="popupadd('adjuntar.php?CodEmp=433&Nreguist=1000002')" title="Adjuntar Archivo"><img src="img/atta.png" border="0"/></a>
               </td>
      </tr>
     </table>    </td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center"><a href="#" onclick="AceptacionSii('433','1000002')" style="text-decoration:none"><span style='display:inline-block;width: 10px;height: 10px;border-radius: 50%;background: #5cb85c;'></span> <span style='display:inline-block;width: 10px;height: 10px;border-radius: 50%;background: #5cb85c;'></span></a></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center"><font style="font-size:10px">2026-01-20</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center">
       <a href="pdf_dte.php?post=Q29kX0VtcD00MzMmTnJlZ3Vpc3Q9MTAwMDAwMg==" style="color:#0000FF" target="_blank" title="Documento Original">
Nota de Credito Electronica</a>
        </td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center"><font style="font-size:10px" title="N. Interno: 1000002">8901</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="left" title="Señalética Ltda"><font style="font-size:10px">Señalética Ltda</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="center">
       <table width="96" height="18" border="0" align="center" cellpadding="0" cellspacing="0">
        <tr align="center">
                  <td width="21" align="center"><img src='img/SiiEnvRec.png' title='Enviado al SII, DOK DTE Recibido' /></td>
            <td width="5">&nbsp;&nbsp;</td>
         <td width="30" align="left"><img src='img/flag_green.png' title='DTE Enviado a Cliente, Recibido OK' height='16' /></td>
         <td width="25" align="center"><img src='img/CorrEnv.png' title='Email Comercial Enviado' /></td>
         <td width="25" align="center"></td>
        </tr>
       </table>
               </td>
    <td bgcolor="#000000" width="1"></td>
    <td align="right"><font style="font-size:10px">-50.000</font></td>
    <td bgcolor="#000000" width="1"></td>
    <td align="right"><font style="font-size:10px">-59.500</font></td>
    <td bgcolor="#000000" width="1"></td>
  </tr>
  <tr>
    <td></td>
    <td colspan="16" bgcolor="#000000" height="1"></td>
  </tr>`

export const PANELDTE_COMPRAS_PERIODO_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Panel DTE</title></head>
<body>
  <form method="post" name="act" action="paneldte.php">
    <input type="hidden" name="peri" value="2026-07" />
  </form>
  <table width="1018" border="0" id="tabla">
    <tr>
      <td colspan="18" bgcolor="#000000" height="1"></td>
    </tr>
    <tr bgcolor="#F8F8F8" align="center">
      <td width="131">Opciones</td>
      <td width="70">Aceptacion SII</td>
      <td width="70">Fecha</td>
      <td width="180">Documento</td>
      <td width="75">Folio</td>
      <td width="260">Razon Social</td>
      <td width="114">Estado</td>
      <td width="90">Total Neto</td>
      <td width="90">Total</td>
    </tr>
    <tr>
      <td colspan="18" bgcolor="#000000" height="1"></td>
    </tr>
  </table>
  <table width="1018" height="52" border="0">
    <tr>
      <td>
        <select onChange="envfor();" name="pagina">
<option value="1"  selected="selected" >Pagina  1</option>
</select>
      </td>
    </tr>
  </table>
  <form method="post" name="p4" action="asignar.php?fil=1&CodEmp=433">
    <input type="hidden" name="peri" value="2026-07">
    ${ROW_ANULADA}
    ${ROW_ACEPTADA}
    <input type="hidden" value="" name="tbxIdsDocumentos" id="tbxIdsDocumentos" />
    <input type="hidden" name="tbxTotalDocumentos" id="tbxTotalDocumentos" value="2" />
  </form>
</body>
</html>`

/**
 * Segundo fixture: tabla vacía sin resultados (búsqueda sin coincidencias).
 * Verificado contra el portal real: tbxTotalDocumentos="0" y ningún
 * `<tr onmouseover=...>`.
 */
export const PANELDTE_VACIO_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Panel DTE</title></head>
<body>
  <table width="1018" border="0" id="tabla">
    <tr bgcolor="#F8F8F8" align="center">
      <td width="131">Opciones</td>
      <td width="70">Aceptacion SII</td>
      <td width="70">Fecha</td>
      <td width="180">Documento</td>
      <td width="75">Folio</td>
      <td width="260">Razon Social</td>
      <td width="114">Estado</td>
      <td width="90">Total Neto</td>
      <td width="90">Total</td>
    </tr>
  </table>
  <form method="post" name="p4" action="asignar.php?fil=1&CodEmp=433">
    <input type="hidden" name="tbxTotalDocumentos" id="tbxTotalDocumentos" value="0" />
  </form>
  No se encontraron documentos para los filtros seleccionados
</body>
</html>`
