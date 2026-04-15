import { getHistoryTitle } from './pedido-semanal.service.js';

const DIAS_PRODUCCION = [
  '',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo'
];

export function renderWeekOptions(selectEl, weeks = []) {
  if (!selectEl) return;

  const currentValue = selectEl.value || '';

  selectEl.innerHTML = `
    <option value="">Seleccionar semana</option>
    ${weeks.map((week) => `<option value="${week.key}">${week.label}</option>`).join('')}
  `;

  if (weeks.some((w) => w.key === currentValue)) {
    selectEl.value = currentValue;
  }
}

function renderTextInput({ rowIndex, fieldKey, value, disabled = false, numeric = false, extraClass = '' }) {
  return `
    <input
      class="excel-input ${extraClass}"
      data-row="${rowIndex}"
      data-field="${fieldKey}"
      type="text"
      ${numeric ? 'inputmode="numeric"' : ''}
      autocomplete="off"
      value="${value ?? ''}"
      ${disabled ? 'disabled' : ''}
    />
  `;
}

function renderTextarea({ rowIndex, fieldKey, value, disabled = false, extraClass = '' }) {
  return `
    <textarea
      class="${extraClass}"
      data-row="${rowIndex}"
      data-field="${fieldKey}"
      rows="2"
      ${disabled ? 'disabled' : ''}
    >${value ?? ''}</textarea>
  `;
}

function renderDaySelect({ rowIndex, fieldKey, value, disabled = false }) {
  return `
    <select data-row="${rowIndex}" data-field="${fieldKey}" ${disabled ? 'disabled' : ''}>
      ${DIAS_PRODUCCION.map((dia) => `
        <option value="${dia}" ${String(value || '') === dia ? 'selected' : ''}>${dia || 'Sin definir'}</option>
      `).join('')}
    </select>
  `;
}

export function renderPedidoSemanalTable(tableEl, {
  rows = [],
  canEditField,
  selectedRowIndex = null,
  onFieldChange,
  onSelectHistory
}) {
  if (!tableEl) return;

  let body = rows.map((row, rowIndex) => {
    const historyCount = Array.isArray(row.historial) ? row.historial.length : 0;
    const historyTitle = getHistoryTitle(row);
    const isSelected = selectedRowIndex === rowIndex;

    return `
      <tr class="${isSelected ? 'pedido-row-selected' : ''}">
        <td class="sticky-col product-name-cell">
          ${row.productoNombre || '-'}
          ${historyCount ? '<span class="pedido-history-dot" title="Tiene historial"></span>' : ''}
        </td>

        <td class="pedido-col-moron">
          ${renderTextInput({
            rowIndex,
            fieldKey: 'moronPedidoChica',
            value: row.moronPedidoChica ?? 0,
            disabled: !canEditField('moronPedidoChica'),
            numeric: true,
            extraClass: 'pedido-col-moron'
          })}
        </td>

        <td class="pedido-col-moron">
          ${renderTextInput({
            rowIndex,
            fieldKey: 'moronPedidoGrande',
            value: row.moronPedidoGrande ?? 0,
            disabled: !canEditField('moronPedidoGrande'),
            numeric: true,
            extraClass: 'pedido-col-moron'
          })}
        </td>

        <td class="pedido-col-moron">
          ${renderTextarea({
            rowIndex,
            fieldKey: 'moronObservacion',
            value: row.moronObservacion || '',
            disabled: !canEditField('moronObservacion'),
            extraClass: 'pedido-col-moron'
          })}
        </td>

        <td class="pedido-col-alvear">
          ${renderDaySelect({
            rowIndex,
            fieldKey: 'alvearDiaProduccion',
            value: row.alvearDiaProduccion || '',
            disabled: !canEditField('alvearDiaProduccion')
          })}
        </td>

        <td class="pedido-col-alvear">
          ${renderTextarea({
            rowIndex,
            fieldKey: 'alvearObservacion',
            value: row.alvearObservacion || '',
            disabled: !canEditField('alvearObservacion'),
            extraClass: 'pedido-col-alvear'
          })}
        </td>

        <td class="pedido-col-gerencia">
          ${renderTextarea({
            rowIndex,
            fieldKey: 'gerenciaObservacion',
            value: row.gerenciaObservacion || '',
            disabled: !canEditField('gerenciaObservacion'),
            extraClass: 'pedido-col-gerencia'
          })}
        </td>

        <td class="pedido-readonly" title="${historyTitle}">
          <button type="button" class="btn btn-outline btn-sm pedido-history-btn" data-row="${rowIndex}">
            Ver (${historyCount})
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (!body) {
    body = `<tr><td colspan="8">Sin productos.</td></tr>`;
  }

  tableEl.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col">AROMA</th>
        <th class="pedido-col-moron">PEDIDO MORÓN CH</th>
        <th class="pedido-col-moron">PEDIDO MORÓN GR</th>
        <th class="pedido-col-moron">OBS. MORÓN</th>
        <th class="pedido-col-alvear">DÍA PRODUCCIÓN ALVEAR</th>
        <th class="pedido-col-alvear">OBS. ALVEAR</th>
        <th class="pedido-col-gerencia">OBS. GERENCIA</th>
        <th class="pedido-readonly">HISTORIAL</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;

  tableEl.querySelectorAll('[data-field]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const rowIndex = Number(e.target.dataset.row);
      const fieldKey = e.target.dataset.field;
      onFieldChange(rowIndex, fieldKey, e.target.value);
    });
  });

  tableEl.querySelectorAll('.pedido-history-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      onSelectHistory(Number(btn.dataset.row));
    });
  });
}

export function renderPedidoSemanalHistory(containerEl, row) {
  if (!containerEl) return;

  if (!row) {
    containerEl.innerHTML = 'Sin historial.';
    return;
  }

  const historial = Array.isArray(row.historial) ? row.historial.slice().reverse() : [];

  if (!historial.length) {
    containerEl.innerHTML = `
      <div class="history-box">
        <div class="history-item">
          <div class="history-meta">${row.productoNombre || '-'}</div>
          <div class="history-value">Sin historial para este aroma.</div>
        </div>
      </div>
    `;
    return;
  }

  containerEl.innerHTML = `
    <div class="history-box">
      ${historial.map((item) => `
        <div class="history-item">
          <div class="history-meta">
            ${row.productoNombre || '-'} · ${String(item.fecha || '').replace('T', ' ').slice(0, 16)} · ${item.usuario || 'Usuario'}
          </div>
          <div class="history-value">
            <strong>${item.fieldKey}</strong><br>
            Antes: ${item.previousValue || '-'}<br>
            Ahora: ${item.newValue || '-'}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
