import { getAlertCount, getBoxLabel } from './alertas.service.js';

function ensureGerenciaPanel() {
  const gerenciaSection = document.getElementById('section-gerencia');
  if (!gerenciaSection) return null;

  let panel = document.getElementById('gerenciaAlertasPanel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'gerenciaAlertasPanel';
  panel.className = 'panel-card mt-20';
  panel.innerHTML = `
    <div class="panel-header">
      <h3>Alertas Alvear / Morón</h3>
    </div>
    <div id="gerenciaAlertasBody"></div>
  `;

  gerenciaSection.prepend(panel);
  return panel;
}

export function renderGerenciaMenuBadge(alerts = []) {
  const target = document.querySelector('.nav-link[data-section="gerencia"]');
  if (!target) return;

  const count = getAlertCount(alerts);

  let badge = target.querySelector('.menu-alert-badge');

  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'menu-alert-badge';
    badge.style.marginLeft = '8px';
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '999px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '700';
    badge.style.background = 'rgba(255, 80, 80, 0.18)';
    badge.style.color = '#ffd5d5';
    badge.style.border = '1px solid rgba(255, 80, 80, 0.28)';
    target.appendChild(badge);
  }

  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
  } else {
    badge.style.display = 'none';
  }
}

export function renderGerenciaAlertsPanel(alerts = []) {
  ensureGerenciaPanel();

  const body = document.getElementById('gerenciaAlertasBody');
  if (!body) return;

  if (!alerts.length) {
    body.innerHTML = `
      <div class="empty-state">
        No hay alertas entre salidas de Alvear e ingresos de Morón.
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Tipo</th>
            <th>Salida Alvear</th>
            <th>Ingreso Morón</th>
            <th>Diferencia</th>
          </tr>
        </thead>
        <tbody>
          ${alerts.map((a) => `
            <tr>
              <td>${a.fecha}</td>
              <td>${a.productoNombre}</td>
              <td>${getBoxLabel(a.boxKey)}</td>
              <td>${a.salidaAlvear}</td>
              <td>${a.ingresoMoron}</td>
              <td style="color:${a.diferencia !== 0 ? '#ff8d8d' : 'inherit'}; font-weight:700;">
                ${a.diferencia}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
