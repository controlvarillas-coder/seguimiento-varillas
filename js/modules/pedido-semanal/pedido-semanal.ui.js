import { getHistoryTitle } from './pedido-semanal.service.js';

const MOTIVOS = [
  '',
  'Falta de palitero',
  'Falta de esencia',
  'Falta de insumos',
  'Falta de personal',
  'Problema de secado',
  'Rotura / merma',
  'Demora de producción',
  'Prioridad a otro pedido',
  'Otro'
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
  } else if (!currentValue && weeks.length) {
    selectEl.value = weeks[0].key;
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

function renderDateInput({ rowIndex, fieldKey, value, disabled = false }) {
  return `
    <input
      type="date"
      class="excel-input pedido-col-alvear"
      data-row="${rowIndex}"
      data-field="${fieldKey}"
      value="${value || ''}"
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

function renderReasonSelect({ rowIndex, fieldKey, value, disabled = false }) {
  return `
    <select data-row="${rowIndex}" data-field="${fieldKey}" ${disabled ? 'disabled' : ''}>
      ${MOTIVOS.map((item) => `
        <option value="${item}" ${String(value || '') === item ? 'selected' : ''}>
          ${item || 'Sin definir'}
        </option>
      `).join('')}
    </select>
  `;
}

export function renderPedidoSemanalTable(tableEl, {
  rows = [],
  canEditField,
  selectedRowIndex = null,
  onFieldChange,
  onSelectHistory,
  viewMode = 'gerencia'
}) {
  if (!tableEl) return;

  let body = rows.map((row, rowIndex) => {
    const historyCount = Array.isArray(row.historial) ? row.historial.length : 0;
    const historyTitle = getHistoryTitle(row);
    const isSelected = selectedRowIndex === rowIndex;

    return `
      <tr class="${isSelected ? 'pedido-row-selected' : ''}">
        <td class="sticky-col product-name-cell">${row.productoNombre || '-'}</td>

        <td class="pedido-col-moron">
          ${renderTextInput({
            rowIndex,
            fieldKey: 'cantidadSolicitada',
            value: row.cantidadSolicitada ?? 0,
            disabled: !canEditField('cantidadSolicitada'),
            numeric: true,
            extraClass: 'pedido-col-moron'
          })}
        </td>

        <td class="pedido-col-alvear">
          ${renderDateInput({
            rowIndex,
            fieldKey: 'fechaEntrega',
            value: row.fechaEntrega || '',
            disabled: !canEditField('fechaEntrega')
          })}
        </td>

        <td class="pedido-col-alvear">
          ${renderTextInput({
            rowIndex,
            fieldKey: 'cantidadEntregada',
            value: row.cantidadEntregada ?? 0,
            disabled: !canEditField('cantidadEntregada'),
            numeric: true,
            extraClass: 'pedido-col-alvear'
          })}
        </td>

        <td class="pedido-col-alvear">
          ${renderReasonSelect({
            rowIndex,
            fieldKey: 'motivoIncumplimiento',
            value: row.motivoIncumplimiento || '',
            disabled: !canEditField('motivoIncumplimiento')
          })}
        </td>

        <td class="pedido-col-alvear">
          ${renderTextarea({
            rowIndex,
            fieldKey: 'motivoOtro',
            value: row.motivoOtro || '',
            disabled: !canEditField('motivoOtro'),
            extraClass: 'pedido-col-alvear'
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
    body = `<tr><td colspan="6">Sin productos para mostrar.</td></tr>`;
  }

  tableEl.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col">AROMA</th>
        <th class="pedido-col-moron">CANTIDAD SOLICITADA</th>
        <th class="pedido-col-alvear">FECHA ENTREGA</th>
        <th class="pedido-col-alvear">CANTIDAD ENTREGADA</th>
        <th class="pedido-col-alvear">MOTIVO</th>
        <th class="pedido-col-alvear">OTRO MOTIVO</th>
        <th class="pedido-readonly">HISTORIAL</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;

  tableEl.querySelectorAll('input[type="text"], input[type="date"], textarea, select').forEach((el) => {
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
