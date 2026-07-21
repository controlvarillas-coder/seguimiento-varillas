/* =====================================================================
   pedido-semanal.ui.js
   Vistas por rol:
     moron    → AROMA | CANTIDAD SOLICITADA | OBSERVACIÓN
     alvear   → solo productos pedidos | CANT. PEDIDA | FECHA ENTREGA | CANT. ENTREGADA | MOTIVOS | OBS
     gerencia → todo
   ===================================================================== */

import { getHistoryTitle, MOTIVOS_PREDEFINIDOS } from './pedido-semanal.service.js';

/* -----------------------------------------------------------------
   Calcula el total entregado según la fábrica destino del pedido.
   Bañado y Linares tienen sus propios campos de entrega.
----------------------------------------------------------------- */
function _calcEntregado(row) {
  const dest = row.moronFabricaDestino || 'alvear';
  if (dest === 'banado')  return Number(row.banadoCantidadEntregada  || 0);
  if (dest === 'linares') return Number(row.linaresCantidadEntregada || 0);
  return Number(row.alvearCantidadEntregada || 0);
}



/* -----------------------------------------------------------------
   Select de semanas — fix de texto invisible en tema oscuro
----------------------------------------------------------------- */
export function renderWeekOptions(selectEl, weeks = []) {
  if (!selectEl) return;

  const currentValue = selectEl.value || '';

  selectEl.innerHTML = `
    <option value="" style="background:#1a2540;color:#eef2ff;">-- Seleccioná semana --</option>
    ${weeks.map((week) => `
      <option value="${week.key}" style="background:#1a2540;color:#eef2ff;">${week.label}</option>
    `).join('')}
  `;

  if (weeks.some((w) => w.key === currentValue)) {
    selectEl.value = currentValue;
  } else if (!currentValue && weeks.length) {
    selectEl.value = weeks[0].key;
  }
}

/* -----------------------------------------------------------------
   Calendario visual de semanas (badges coloreados)
   Solo visible para gerencia
----------------------------------------------------------------- */
export function renderWeekCalendar(containerEl, weeks = [], pedidosCache = {}, monthValue = '') {
  if (!containerEl) return;

  if (!weeks.length) {
    containerEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">Seleccioná un mes para ver el calendario.</div>';
    return;
  }

  const badges = weeks.map((week) => {
    const docId = `${monthValue}_${week.key}`;
    const doc = pedidosCache[docId];
    const rows = doc?.rows || [];
    const alvearConfirmado = !!doc?.alvearConfirmado;

    let color, bg, icon, label;

    if (!rows.some((r) => Number(r.moronCantidad) > 0)) {
      color = '#a5b1d8'; bg = 'rgba(255,255,255,0.04)'; icon = '—'; label = 'Sin pedido';
    } else if (!doc?.moronLocked) {
      color = '#a5b1d8'; bg = 'rgba(255,255,255,0.06)'; icon = '📝'; label = 'Sin confirmar';
    } else if (!alvearConfirmado) {
      color = '#ffd166'; bg = 'rgba(255,209,102,0.12)'; icon = '⏳'; label = 'Pendiente Alvear';
    } else {
      const pedidas = rows.filter((r) => Number(r.moronCantidad) > 0);
      const todas = pedidas.every((r) => {
        const dest = r.moronFabricaDestino || 'alvear';
        const ent = dest === 'banado'  ? Number(r.banadoCantidadEntregada  || 0)
                  : dest === 'linares' ? Number(r.linaresCantidadEntregada || 0)
                  : Number(r.alvearCantidadEntregada || 0);
        return ent >= Number(r.moronCantidad);
      });
      const alguna = pedidas.some((r) => {
        const dest = r.moronFabricaDestino || 'alvear';
        const ent = dest === 'banado'  ? Number(r.banadoCantidadEntregada  || 0)
                  : dest === 'linares' ? Number(r.linaresCantidadEntregada || 0)
                  : Number(r.alvearCantidadEntregada || 0);
        return ent >= Number(r.moronCantidad);
      });

      if (todas) { color = '#3ddc97'; bg = 'rgba(61,220,151,0.14)'; icon = '✅'; label = 'Completo'; }
      else if (alguna) { color = '#f9a825'; bg = 'rgba(249,168,37,0.14)'; icon = '🟡'; label = 'Parcial'; }
      else { color = '#ff5a5a'; bg = 'rgba(255,90,90,0.14)'; icon = '❌'; label = 'Incompleto'; }
    }

    return `
      <div style="
        padding:12px 14px;border-radius:14px;
        background:${bg};border:1px solid ${color}44;
        color:${color};font-size:13px;font-weight:600;
        display:flex;flex-direction:column;gap:4px;
      ">
        <span style="font-size:18px;">${icon}</span>
        <span style="color:var(--text);font-weight:700;">${week.label}</span>
        <span style="font-size:12px;">${label}</span>
        <span style="font-size:11px;color:var(--muted);">${week.start} → ${week.end}</span>
      </div>
    `;
  }).join('');

  containerEl.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
      ${badges}
    </div>
  `;
}

/* -----------------------------------------------------------------
   Tabla principal — despacha por viewMode
----------------------------------------------------------------- */
export function renderPedidoSemanalTable(tableEl, {
  rows = [],
  canEditField,
  selectedRowIndex = null,
  onFieldChange,
  onSelectHistory,
  viewMode = 'gerencia',
  alvearConfirmado = false
}) {
  if (!tableEl) return;

  if (viewMode === 'moron') {
    _renderTableMoron(tableEl, rows, canEditField, onFieldChange);
    return;
  }

  if (viewMode === 'alvear') {
    _renderTableAlvear(tableEl, rows, canEditField, onFieldChange, alvearConfirmado);
    return;
  }

  if (viewMode === 'banado' || viewMode === 'linares') {
    _renderTableDestinoFabrica(tableEl, rows, viewMode, canEditField, onFieldChange);
    return;
  }

  _renderTableGerencia(tableEl, rows, canEditField, selectedRowIndex, onFieldChange, onSelectHistory, alvearConfirmado);
}

/* =============================================================
   VISTA MORÓN — AROMA | CANTIDAD SOLICITADA | OBSERVACIÓN
============================================================= */
function _renderTableMoron(tableEl, rows, canEditField, onFieldChange) {
  let body = rows.map((row, rowIndex) => `
    <tr>
      <td class="sticky-col product-name-cell">${row.productoNombre || '-'}</td>
      <td class="pedido-col-moron" style="min-width:120px;">
        <input
          class="excel-input pedido-col-moron"
          data-row="${rowIndex}"
          data-field="moronCantidad"
          type="text" inputmode="numeric" autocomplete="off"
          value="${Number(row.moronCantidad) || 0}"
          ${canEditField('moronCantidad') ? '' : 'disabled'}
        />
      </td>
      <td class="pedido-col-moron" style="min-width:130px;">
        <select
          class="pedido-tipo-select"
          data-row="${rowIndex}"
          data-field="moronTipo"
          ${canEditField('moronTipo') ? '' : 'disabled'}
        >
          <option value="bultos" ${(row.moronTipo || 'bultos') === 'bultos' ? 'selected' : ''}>📦 BULTOS</option>
          <option value="carros" ${(row.moronTipo || 'bultos') === 'carros' ? 'selected' : ''}>🛒 CARROS</option>
        </select>
      </td>
      <td class="pedido-col-moron" style="min-width:140px;">
        <select
          class="pedido-tipo-select"
          data-row="${rowIndex}"
          data-field="moronFabricaDestino"
          ${canEditField('moronFabricaDestino') ? '' : 'disabled'}
        >
          <option value="alvear"  ${(row.moronFabricaDestino || 'alvear') === 'alvear'  ? 'selected' : ''}>🏭 Alvear</option>
          <option value="banado"  ${(row.moronFabricaDestino || 'alvear') === 'banado'  ? 'selected' : ''}>💧 Bañado</option>
          <option value="linares" ${(row.moronFabricaDestino || 'alvear') === 'linares' ? 'selected' : ''}>🌿 Linares</option>
        </select>
      </td>
      <td class="pedido-col-moron" style="min-width:220px;">
        <textarea
          class="pedido-textarea"
          data-row="${rowIndex}"
          data-field="moronObservacion"
          rows="2"
          ${canEditField('moronObservacion') ? '' : 'disabled'}
        >${row.moronObservacion || ''}</textarea>
      </td>
      <td class="pedido-col-alvear" style="min-width:140px;text-align:center;">
        ${(() => {
          const dest = row.moronFabricaDestino || 'alvear';
          const fecha = dest === 'banado'  ? row.banadoFechaEntrega
                      : dest === 'linares' ? row.linaresFechaEntrega
                      : row.alvearFechaEntrega;
          const color = dest === 'banado'  ? '#34d399'
                      : dest === 'linares' ? '#f9a8d4'
                      : '#a78bfa';
          return fecha
            ? `<div style="font-weight:700;color:${color}">${fecha}</div>`
            : '<span style="color:rgba(255,255,255,.25);font-size:12px;">Sin fecha</span>';
        })()}
      </td>
      <td class="pedido-col-alvear" style="min-width:120px;text-align:center;">
        ${(() => {
          const ped = Number(row.moronCantidad) || 0;
          const ent = _calcEntregado(row);
          if (ped === 0) return '<span style="color:rgba(255,255,255,.2);font-size:12px;">—</span>';
          if (ent >= ped)  return '<span class="pedido-estado-pill pedido-estado-completo">✅ Completo</span>';
          if (ent > 0)     return '<span class="pedido-estado-pill pedido-estado-parcial">⚠️ Parcial<br><small>' + ent + '/' + ped + '</small></span>';
          return '<span class="pedido-estado-pill pedido-estado-pendiente">🕐 Pendiente</span>';
        })()}
      </td>
      <td class="pedido-col-alvear" style="min-width:180px;">
        ${row.alvearObservacion
          ? `<div style="font-size:12px;color:#d8b4fe;padding:4px 6px;border-radius:8px;background:rgba(143,123,255,.10);border:1px solid rgba(143,123,255,.18);line-height:1.4;">${row.alvearObservacion}</div>`
          : '<span style="color:rgba(255,255,255,.2);font-size:12px;">—</span>'}
      </td>
    </tr>
  `).join('');

  if (!body) body = '<tr><td colspan="8">Sin productos.</td></tr>';

  tableEl.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col">AROMA</th>
        <th class="pedido-col-moron">CANTIDAD SOLICITADA</th>
        <th class="pedido-col-moron">TIPO</th>
        <th class="pedido-col-moron">FÁBRICA DESTINO</th>
        <th class="pedido-col-moron">OBSERVACIÓN</th>
        <th class="pedido-col-alvear">FECHA ENTREGA</th>
        <th class="pedido-col-alvear">ESTADO</th>
        <th class="pedido-col-alvear">OBS. ALVEAR</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;

  _bindInputs(tableEl, onFieldChange);
}

/* =============================================================
   VISTA ALVEAR
============================================================= */
function _renderTableAlvear(tableEl, rows, canEditField, onFieldChange, alvearConfirmado) {
  if (!rows.length) {
    tableEl.innerHTML = '<tbody><tr><td style="padding:20px;color:var(--muted);">Morón aún no cargó pedidos para esta semana.</td></tr></tbody>';
    return;
  }

  let body = rows.map((row, rowIndex) => {
    const ped = Number(row.moronCantidad);
    const ent = _calcEntregado(row);
    const faltante = ped - ent;
    const completo = faltante <= 0;

    return `
      <tr style="${completo ? 'background:rgba(61,220,151,0.05);' : ''}">
        <td class="sticky-col product-name-cell">${row.productoNombre || '-'}</td>
        <td class="pedido-col-moron" style="text-align:center;font-weight:700;">
          ${ped}
          <div class="pedido-tipo-badge pedido-tipo-badge-${row.moronTipo || 'bultos'}">
            ${(row.moronTipo || 'bultos') === 'bultos' ? '📦 BULTOS' : '🛒 CARROS'}
          </div>
        </td>
        <td class="pedido-col-alvear" style="min-width:150px;">
          <input
            class="excel-input"
            data-row="${rowIndex}"
            data-field="alvearFechaEntrega"
            type="date"
            value="${row.alvearFechaEntrega || ''}"
            ${canEditField('alvearFechaEntrega') ? '' : 'disabled'}
            style="min-width:130px;"
          />
        </td>
        <td class="pedido-col-alvear" style="min-width:120px;">
          <input
            class="excel-input pedido-col-alvear"
            data-row="${rowIndex}"
            data-field="alvearCantidadEntregada"
            type="text" inputmode="numeric" autocomplete="off"
            value="${ent}"
            ${canEditField('alvearCantidadEntregada') ? '' : 'disabled'}
          />
        </td>
        <td class="pedido-col-alvear" style="min-width:200px;">
          ${_renderMotivos(rowIndex, row.alvearMotivos || [], canEditField('alvearMotivos'))}
        </td>
        <td class="pedido-col-alvear" style="min-width:180px;">
          <textarea
            class="pedido-textarea"
            data-row="${rowIndex}"
            data-field="alvearObservacion"
            rows="2"
            ${canEditField('alvearObservacion') ? '' : 'disabled'}
          >${row.alvearObservacion || ''}</textarea>
        </td>
        <td style="text-align:center;font-weight:700;white-space:nowrap;color:${completo ? '#3ddc97' : '#ff5a5a'};">
          ${completo ? '✅ OK' : `Falta: ${faltante}`}
        </td>
        <td class="pedido-col-moron" style="min-width:180px;">
          ${row.moronObservacion
            ? `<div style="font-size:12px;color:#bfdbfe;padding:4px 6px;border-radius:8px;background:rgba(111,168,255,.10);border:1px solid rgba(111,168,255,.18);line-height:1.4;">${row.moronObservacion}</div>`
            : '<span style="color:rgba(255,255,255,.2);font-size:12px;">—</span>'}
        </td>
      </tr>
    `;
  }).join('');

  tableEl.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col">AROMA</th>
        <th class="pedido-col-moron">CANT. PEDIDA</th>
        <th class="pedido-col-alvear">FECHA ENTREGA</th>
        <th class="pedido-col-alvear">CANT. ENTREGADA</th>
        <th class="pedido-col-alvear">MOTIVOS</th>
        <th class="pedido-col-alvear">OBSERVACIÓN</th>
        <th>ESTADO</th>
        <th class="pedido-col-moron">NOTAS MORÓN</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;

  _bindInputs(tableEl, onFieldChange);
  _bindMotivos(tableEl, onFieldChange);
}

/* =============================================================
   VISTA BAÑADO / LINARES — editable: fecha entrega, cantidad, obs
============================================================= */
function _renderTableDestinoFabrica(tableEl, rows, viewMode, canEditField, onFieldChange) {
  const esBanado  = viewMode === 'banado';
  const nombreFab = esBanado ? '💧 Bañado' : '🌿 Linares';
  const prefijo   = esBanado ? 'banado' : 'linares';   // banadoFechaEntrega / linaresFechaEntrega etc.

  if (!rows.length) {
    tableEl.innerHTML = `<tbody><tr><td style="padding:20px;color:var(--muted);">Morón no cargó pedidos con destino ${nombreFab} para esta semana.</td></tr></tbody>`;
    return;
  }

  const canEditFecha = canEditField(`${prefijo}FechaEntrega`);
  const canEditCant  = canEditField(`${prefijo}CantidadEntregada`);
  const canEditObs   = canEditField(`${prefijo}Observacion`);

  const body = rows.map((row, rowIndex) => {
    const ped = Number(row.moronCantidad) || 0;
    const ent = Number(row[`${prefijo}CantidadEntregada`] || 0);
    const faltante = ped - ent;
    const completo = ent >= ped && ped > 0;

    return `
      <tr style="${completo ? 'background:rgba(61,220,151,0.05);' : ''}">
        <td class="sticky-col product-name-cell">
          <div style="font-weight:500">${row.productoNombre || '—'}</div>
          ${row.moronObservacion
            ? `<div style="font-size:11px;color:#bfdbfe;margin-top:3px;padding:3px 6px;border-radius:6px;background:rgba(111,168,255,.10);border:1px solid rgba(111,168,255,.15);">${row.moronObservacion}</div>`
            : ''}
        </td>
        <td class="pedido-col-moron" style="text-align:center;font-weight:700;">
          ${ped}
          <div class="pedido-tipo-badge pedido-tipo-badge-${row.moronTipo || 'bultos'}">
            ${(row.moronTipo || 'bultos') === 'bultos' ? '📦 BULTOS' : '🛒 CARROS'}
          </div>
        </td>
        <td style="min-width:150px;">
          <input
            class="excel-input"
            data-row="${rowIndex}"
            data-field="${prefijo}FechaEntrega"
            type="date"
            value="${row[`${prefijo}FechaEntrega`] || ''}"
            ${canEditFecha ? '' : 'disabled'}
            style="min-width:130px;"
          />
        </td>
        <td style="min-width:110px;">
          <input
            class="excel-input"
            data-row="${rowIndex}"
            data-field="${prefijo}CantidadEntregada"
            type="text" inputmode="numeric" autocomplete="off"
            value="${ent}"
            ${canEditCant ? '' : 'disabled'}
          />
        </td>
        <td style="min-width:180px;">
          <textarea
            class="pedido-textarea"
            data-row="${rowIndex}"
            data-field="${prefijo}Observacion"
            rows="2"
            ${canEditObs ? '' : 'disabled'}
          >${row[`${prefijo}Observacion`] || ''}</textarea>
        </td>
        <td style="text-align:center;font-weight:700;white-space:nowrap;
          color:${ped > 0 ? (completo ? '#3ddc97' : (ent > 0 ? '#f9a825' : '#ff5a5a')) : 'var(--muted)'};">
          ${ped === 0 ? '—' : completo
            ? '✅ OK'
            : ent > 0
              ? `⚠️ Parcial<br><small style="font-size:11px">${ent}/${ped}</small>`
              : `🕐 Pendiente`}
        </td>
      </tr>`;
  }).join('');

  tableEl.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col">AROMA</th>
        <th class="pedido-col-moron">CANT. PEDIDA</th>
        <th>FECHA ENTREGA</th>
        <th>CANT. ENTREGADA</th>
        <th>OBSERVACIÓN</th>
        <th>ESTADO</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;

  _bindInputs(tableEl, onFieldChange);
}

/* =============================================================
   VISTA GERENCIA
============================================================= */
function _renderTableGerencia(tableEl, rows, canEditField, selectedRowIndex, onFieldChange, onSelectHistory, alvearConfirmado) {
  let body = rows.map((row, rowIndex) => {
    const historyCount = Array.isArray(row.historial) ? row.historial.length : 0;
    const isSelected = selectedRowIndex === rowIndex;
    const ped = Number(row.moronCantidad);
    const ent = _calcEntregado(row);
    const faltante = ped - ent;
    const completo = ped > 0 && faltante <= 0;

    return `
      <tr class="${isSelected ? 'pedido-row-selected' : ''}" style="${completo ? 'background:rgba(61,220,151,0.04);' : ''}">
        <td class="sticky-col product-name-cell">
          ${row.productoNombre || '-'}
          ${historyCount ? '<span class="pedido-history-dot" title="Tiene historial"></span>' : ''}
        </td>
        <td class="pedido-col-moron" style="min-width:120px;">
          <input class="excel-input pedido-col-moron"
            data-row="${rowIndex}" data-field="moronCantidad"
            type="text" inputmode="numeric" autocomplete="off"
            value="${Number(row.moronCantidad) || 0}"
            ${canEditField('moronCantidad') ? '' : 'disabled'}
          />
        </td>
        <td class="pedido-col-moron" style="min-width:130px;">
          <select class="pedido-tipo-select"
            data-row="${rowIndex}" data-field="moronTipo"
            ${canEditField('moronCantidad') ? '' : 'disabled'}
          >
            <option value="bultos" ${(row.moronTipo || 'bultos') === 'bultos' ? 'selected' : ''}>📦 BULTOS</option>
            <option value="carros" ${(row.moronTipo || 'bultos') === 'carros' ? 'selected' : ''}>🛒 CARROS</option>
          </select>
        </td>
        <td class="pedido-col-moron" style="min-width:140px;">
          <select class="pedido-tipo-select"
            data-row="${rowIndex}" data-field="moronFabricaDestino"
            ${canEditField('moronFabricaDestino') ? '' : 'disabled'}
          >
            <option value="alvear"  ${(row.moronFabricaDestino || 'alvear') === 'alvear'  ? 'selected' : ''}>🏭 Alvear</option>
            <option value="banado"  ${(row.moronFabricaDestino || 'alvear') === 'banado'  ? 'selected' : ''}>💧 Bañado</option>
            <option value="linares" ${(row.moronFabricaDestino || 'alvear') === 'linares' ? 'selected' : ''}>🌿 Linares</option>
          </select>
        </td>
        <td class="pedido-col-moron" style="min-width:180px;">
          <textarea class="pedido-textarea"
            data-row="${rowIndex}" data-field="moronObservacion"
            rows="2" ${canEditField('moronObservacion') ? '' : 'disabled'}
          >${row.moronObservacion || ''}</textarea>
        </td>
        <td class="pedido-col-alvear" style="min-width:150px;">
          ${(() => {
            const dest = row.moronFabricaDestino || 'alvear';
            if (dest === 'banado') {
              const f = row.banadoFechaEntrega;
              return f
                ? `<div style="font-weight:700;color:#34d399;padding:6px">${f}</div>`
                : '<span style="color:rgba(255,255,255,.25);font-size:12px;padding:6px;display:block">Sin fecha</span>';
            }
            if (dest === 'linares') {
              const f = row.linaresFechaEntrega;
              return f
                ? `<div style="font-weight:700;color:#f9a8d4;padding:6px">${f}</div>`
                : '<span style="color:rgba(255,255,255,.25);font-size:12px;padding:6px;display:block">Sin fecha</span>';
            }
            // Alvear — editable
            return `<input class="excel-input"
              data-row="${rowIndex}" data-field="alvearFechaEntrega"
              type="date" value="${row.alvearFechaEntrega || ''}"
              ${canEditField('alvearFechaEntrega') ? '' : 'disabled'}
              style="min-width:130px;"
            />`;
          })()}
        </td>
        <td class="pedido-col-alvear" style="min-width:120px;">
          ${(() => {
            const dest = row.moronFabricaDestino || 'alvear';
            if (dest === 'banado') {
              return `<div style="font-weight:700;color:#34d399;text-align:center">${Number(row.banadoCantidadEntregada || 0)}</div>`;
            }
            if (dest === 'linares') {
              return `<div style="font-weight:700;color:#f9a8d4;text-align:center">${Number(row.linaresCantidadEntregada || 0)}</div>`;
            }
            return `<input class="excel-input pedido-col-alvear"
              data-row="${rowIndex}" data-field="alvearCantidadEntregada"
              type="text" inputmode="numeric" autocomplete="off"
              value="${ent}"
              ${canEditField('alvearCantidadEntregada') ? '' : 'disabled'}
            />`;
          })()}
        </td>
        <td class="pedido-col-alvear" style="min-width:200px;">
          ${_renderMotivos(rowIndex, row.alvearMotivos || [], canEditField('alvearMotivos'))}
        </td>
        <td class="pedido-col-alvear" style="min-width:180px;">
          <textarea class="pedido-textarea"
            data-row="${rowIndex}" data-field="alvearObservacion"
            rows="2" ${canEditField('alvearObservacion') ? '' : 'disabled'}
          >${row.alvearObservacion || ''}</textarea>
        </td>
        <td class="pedido-col-gerencia" style="min-width:180px;">
          <textarea class="pedido-textarea"
            data-row="${rowIndex}" data-field="gerenciaObservacion"
            rows="2" ${canEditField('gerenciaObservacion') ? '' : 'disabled'}
          >${row.gerenciaObservacion || ''}</textarea>
        </td>
        <td style="text-align:center;font-size:12px;white-space:nowrap;">
          ${row.banadoCantidadEntregada > 0
            ? `<span style="color:#3ddc97;font-weight:700">${row.banadoCantidadEntregada}</span>${row.banadoFechaEntrega ? `<br><span style="color:var(--muted);font-size:11px">${row.banadoFechaEntrega}</span>` : ''}`
            : '<span style="color:rgba(255,255,255,.2)">—</span>'}
        </td>
        <td style="text-align:center;font-size:12px;white-space:nowrap;">
          ${row.linaresCantidadEntregada > 0
            ? `<span style="color:#f9a8d4;font-weight:700">${row.linaresCantidadEntregada}</span>${row.linaresFechaEntrega ? `<br><span style="color:var(--muted);font-size:11px">${row.linaresFechaEntrega}</span>` : ''}`
            : '<span style="color:rgba(255,255,255,.2)">—</span>'}
        </td>
        <td style="text-align:center;font-weight:700;white-space:nowrap;
          color:${ped > 0 ? (completo ? '#3ddc97' : '#ff5a5a') : 'var(--muted)'};">
          ${ped > 0 ? (completo ? '✅ OK' : `Falta: ${faltante}`) : '—'}
        </td>
        <td class="pedido-readonly">
          <button type="button" class="btn btn-outline btn-sm pedido-history-btn" data-row="${rowIndex}">
            (${historyCount})
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (!body) body = '<tr><td colspan="12">Sin productos.</td></tr>';

  tableEl.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col">AROMA</th>
        <th class="pedido-col-moron">CANT. MORÓN</th>
        <th class="pedido-col-moron">TIPO</th>
        <th class="pedido-col-moron">FÁBRICA DESTINO</th>
        <th class="pedido-col-moron">OBS. MORÓN</th>
        <th class="pedido-col-alvear">FECHA ENTREGA</th>
        <th class="pedido-col-alvear">CANT. ENTREGADA</th>
        <th class="pedido-col-alvear">MOTIVOS</th>
        <th class="pedido-col-alvear">OBS. ALVEAR</th>
        <th class="pedido-col-gerencia">OBS. GERENCIA</th>
        <th style="white-space:nowrap">ENT. BAÑADO</th>
        <th style="white-space:nowrap">ENT. LINARES</th>
        <th>ESTADO</th>
        <th class="pedido-readonly">HIST.</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;

  _bindInputs(tableEl, onFieldChange);
  _bindMotivos(tableEl, onFieldChange);

  tableEl.querySelectorAll('.pedido-history-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (onSelectHistory) onSelectHistory(Number(btn.dataset.row));
    });
  });
}

/* -----------------------------------------------------------------
   Checkboxes de motivos
----------------------------------------------------------------- */
function _renderMotivos(rowIndex, selectedMotivos = [], canEdit = true) {
  return `
    <div style="display:grid;gap:3px;">
      ${MOTIVOS_PREDEFINIDOS.map((motivo) => {
        const checked = selectedMotivos.includes(motivo);
        return `
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;
            cursor:pointer;${canEdit ? '' : 'opacity:0.55;pointer-events:none;'}">
            <input type="checkbox" class="motivo-check"
              data-row="${rowIndex}" data-motivo="${motivo}"
              ${checked ? 'checked' : ''}
              ${canEdit ? '' : 'disabled'}
              style="width:auto;min-width:0;height:auto;padding:0;border-radius:3px;"
            />
            ${motivo}
          </label>
        `;
      }).join('')}
    </div>
  `;
}

/* -----------------------------------------------------------------
   Bind de inputs de texto / textarea / date
----------------------------------------------------------------- */
function _bindInputs(tableEl, onFieldChange) {
  tableEl.querySelectorAll('input[data-field]:not(.motivo-check), textarea[data-field], select[data-field]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const rowIndex = Number(e.target.dataset.row);
      const fieldKey = e.target.dataset.field;
      onFieldChange(rowIndex, fieldKey, e.target.value);
    });
  });
}

/* -----------------------------------------------------------------
   Bind de checkboxes de motivos
----------------------------------------------------------------- */
function _bindMotivos(tableEl, onFieldChange) {
  tableEl.querySelectorAll('.motivo-check').forEach((el) => {
    el.addEventListener('change', () => {
      const rowIndex = Number(el.dataset.row);
      const allChecks = tableEl.querySelectorAll(`.motivo-check[data-row="${rowIndex}"]`);
      const motivos = Array.from(allChecks).filter((c) => c.checked).map((c) => c.dataset.motivo);
      onFieldChange(rowIndex, 'alvearMotivos', motivos);
    });
  });
}

/* -----------------------------------------------------------------
   Panel de historial
----------------------------------------------------------------- */
export function renderPedidoSemanalHistory(containerEl, row) {
  if (!containerEl) return;

  if (!row) {
    containerEl.innerHTML = '<div style="color:var(--muted);">Sin historial.</div>';
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
            ${row.productoNombre || '-'} ·
            ${String(item.fecha || '').replace('T', ' ').slice(0, 16)} ·
            ${item.usuario || 'Usuario'}
          </div>
          <div class="history-value">
            <strong>${item.fieldKey}</strong><br>
            Antes: ${Array.isArray(item.previousValue) ? item.previousValue.join(', ') || '—' : (item.previousValue || '—')}<br>
            Ahora: ${Array.isArray(item.newValue) ? item.newValue.join(', ') || '—' : (item.newValue || '—')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
