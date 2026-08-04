/**
 * Fixture HTML: paneldte.php con libro de compras, filtro por período.
 *
 * Representa una respuesta típica del portal con 2 facturas del
 * libro de compras, con iconos de estado SII e intercambio.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 8, 19
 */

export const PANELDTE_COMPRAS_PERIODO_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Panel DTE</title></head>
<body>
  <form method="post" name="act" action="paneldte.php">
    <input type="hidden" name="peri" value="2026-07" />
  </form>

  <select name="pagina">
    <option value="1" selected>1</option>
    <option value="2">2</option>
  </select>

  <table id="tabla">
    <thead>
      <tr>
        <th>Opciones</th>
        <th>Aceptación SII</th>
        <th>Fecha</th>
        <th>Documento</th>
        <th>Folio</th>
        <th>Razón Social</th>
        <th>Estado</th>
        <th>Total Neto</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <a href="pdf_dte.php?post=aW52b2ljZV9pZD0xMjcxNSZ0b2tlbj14eXo%3D">
            <img src="../../imagenes/pdf_buttonCED.png" alt="PDF" />
          </a>
          <img src="../../imagenes/file-xml.png" alt="XML" />
          <a href="#" onclick="Selecciona(1);">Seleccionar</a>
          <input type="hidden" name="nreg" value="12715" />
        </td>
        <td>
          <img src="../../imagenes/SiiEnvRec.png" alt="Aceptado SII" />
          <img src="../../imagenes/flag_green.png" alt="Intercambio aceptado" />
        </td>
        <td>15-01-2026</td>
        <td>33</td>
        <td>12715</td>
        <td>Proveedor SpA</td>
        <td>Emitido</td>
        <td>100.000</td>
        <td>119.000</td>
      </tr>
      <tr>
        <td>
          <a href="pdf_dte.php?post=bnJvbD0yJnRva2VuPWFzZGY%3D">
            <img src="../../imagenes/pdf_buttonCED.png" alt="PDF" />
          </a>
          <img src="../../imagenes/file-xml.png" alt="XML" />
          <a href="#" onclick="Selecciona(2);">Seleccionar</a>
          <input type="hidden" name="nreg" value="12716" />
        </td>
        <td>
          <img src="../../imagenes/SiiPen.png" alt="Pendiente SII" />
          <img src="../../imagenes/flag_blue.png" alt="Intercambio enviado" />
        </td>
        <td>20-01-2026</td>
        <td>61</td>
        <td>8901</td>
        <td>Señalética Ltda</td>
        <td>Emitido</td>
        <td>-50.000</td>
        <td>0</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`

/**
 * Segundo fixture: tabla vacía sin resultados (búsqueda sin coincidencias).
 */
export const PANELDTE_VACIO_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Panel DTE</title></head>
<body>
  <table id="tabla">
    <thead>
      <tr>
        <th>Opciones</th>
        <th>Aceptación SII</th>
        <th>Fecha</th>
        <th>Documento</th>
        <th>Folio</th>
        <th>Razón Social</th>
        <th>Estado</th>
        <th>Total Neto</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="9">No se encontraron documentos para los filtros seleccionados</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`