const TIPO_COLORS = {
  alvearProduccion: '#d68910',
  cajaChica: '#e67e22',
  cajaGrande: '#c0392b',
  neutro: '#8e44ad',
  banado: '#2980b9'
};

export function renderGerenciaMenuBadge(alertas = []) {
  const navLink = document.querySelector('.nav-link[data-section="gerencia"]');
  if (!navLink) return;

  let badge = navLink.querySelector('#alertasBadge');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'alertasBadge';
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 10px;
      background: #e74c3c;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      margin-left: 8px;
      line-height: 1;
    `;
    navLink.appendChild(badge);
  }

  const count = alertas.length;
  if (count === 0) {
    badge.style.display = 'none';
    badge.textContent = '';
  } else {
    badge.style.display = 'inline-flex';
    badge.textContent = count > 99 ? '99+' : String(count);
  }
}

export function renderGerenciaAlertsPanel(alertas = []) {
  let panel = document.getElementById('gerenciaAlertsPanel');

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'gerenciaAlertsPanel';
    const tabla = document.getElementById('tablaGerenciaExcel');
    if (tabla?.parentNode) {
      tabla.parentNode.insertBefore(panel, tabla);
    } else {
      const seccion = document.getElementById('section-gerencia');
      if (seccion) seccion.prepend(panel);
    }
  }

  if (alertas.length === 0) {
    panel.innerHTML = `
      <div style="
        margin: 0 0 16px 0;
        padding: 12px 16px;
        border-radius: 8px;
        background: #d4edda;
        border: 1px solid #c3e6cb;
        color: #155724;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      ">
        <span style="font-size: 18px;">✅</span>
        <strong>Sin alertas.</strong> Producción y movimientos Alvear + Bañado ↔ Morón en orden.
      </div>
    `;
    return;
  }

  const porBloque = {};
  alertas.forEach((a) => {
    if (!porBloque[a.boxKey]) porBloque[a.boxKey] = [];
    porBloque[a.boxKey].push(a);
  });

  panel.innerHTML = `
    <div style="
      margin: 0 0 16px 0;
      border-radius: 8px;
      border: 1px solid #f5c6cb;
      background: #fff;
      overflow: hidden;
      font-size: 13px;
    ">
      <div style="
        padding: 12px 16px;
        background: #e74c3c;
        color: white;
        font-weight: 700;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      ">
        <span>⚠️ Alertas detectadas — ${alertas.length}</span>
        <button
          style="
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.4);
            color: white;
            border-radius: 4px;
            padding: 3px 10px;
            cursor: pointer;
            font-size: 12px;
          "
          onclick="
            const d = document.getElementById('alertasDetalle');
            if (d) {
              const show = d.style.display === 'none';
              d.style.display = show ? 'block' : 'none';
              this.textContent = show ? 'Ocultar detalle' : 'Ver detalle';
            }
          "
        >Ver detalle</button>
      </div>

      <div style="
        padding: 12px 16px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        background: #fff5f5;
        border-bottom: 1px solid #f5c6cb;
      ">
        ${Object.entries(porBloque).map(([boxKey, items]) => `
          <span style="
            padding: 4px 12px;
            border-radius: 20px;
            background: ${TIPO_COLORS[boxKey] || '#777'};
            color: white;
            font-size: 12px;
            font-weight: 600;
          ">${items[0].bloque}
            <strong style="
              background: rgba(0,0,0,0.2);
              border-radius: 10px;
              padding: 0 6px;
              margin-left: 4px;
            ">${items.length}</strong>
          </span>
        `).join('')}
      </div>

      <div id="alertasDetalle" style="display:none; overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:12px; min-width:720px;">
          <thead>
            <tr style="background:#f8f9fa; border-bottom:2px solid #dee2e6;">
              <th style="padding:8px 12px; text-align:left;">Fecha</th>
              <th style="padding:8px 12px; text-align:left;">Bloque</th>
              <th style="padding:8px 12px; text-align:left;">Producto</th>
              <th style="padding:8px 12px; text-align:left;">Origen</th>
              <th style="padding:8px 12px; text-align:left;">Destino</th>
              <th style="padding:8px 12px; text-align:right;">Valor origen</th>
              <th style="padding:8px 12px; text-align:right;">Valor destino</th>
              <th style="padding:8px 12px; text-align:right;">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            ${alertas.map((a, i) => `
              <tr style="border-bottom:1px solid #f0f0f0; background:${i % 2 === 0 ? '#fff' : '#fafafa'};">
                <td style="padding:7px 12px; white-space:nowrap; color:#555;">${a.fecha}</td>
                <td style="padding:7px 12px;">
                  <span style="
                    padding:2px 8px;
                    border-radius:4px;
                    background:${TIPO_COLORS[a.boxKey] || '#777'};
                    color:white;
                    font-size:11px;
                    font-weight:600;
                  ">${a.bloque}</span>
                </td>
                <td style="padding:7px 12px; font-weight:500;">${a.productoNombre}</td>
                <td style="padding:7px 12px;">${a.origenLabel || '-'}</td>
                <td style="padding:7px 12px;">${a.destinoLabel || '-'}</td>
                <td style="padding:7px 12px; text-align:right; color:#c0392b; font-weight:600;">${a.origen}</td>
                <td style="padding:7px 12px; text-align:right; color:#27ae60; font-weight:600;">${a.destino}</td>
                <td style="padding:7px 12px; text-align:right; font-weight:700; color:#e74c3c;">
                  ${a.diferencia > 0 ? '+' : ''}${a.diferencia}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
