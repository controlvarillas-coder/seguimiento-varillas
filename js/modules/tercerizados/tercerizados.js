/**
 * ============================================================
 *  MÓDULO: SEGUIMIENTO DE TERCERIZADOS — v2
 *  js/modules/tercerizados/tercerizados.js
 *
 *  ROL → ACCIONES
 *  ─────────────────────────────────────────────────────────
 *  moron           → Crear pedido · Dar salida · Registrar ingreso
 *  control_calidad → Preparar pedidos (cargar cantidades preparadas)
 *  gerencia        → Vista completa + puede ejecutar todo
 * ============================================================
 */

import { db } from '../../firebase-config.js';
import {
  collection, addDoc, getDocs, doc, updateDoc,
  query, orderBy, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function fmt(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR') + ' ' +
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR');
}
function nowISO() { return new Date().toISOString(); }

function toast(msg, type = 'info') {
  const el = $('terc-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'terc-toast terc-toast-' + type + ' terc-toast-show';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('terc-toast-show'), 3800);
}

function pill(estado) {
  const MAP = {
    pendiente_preparacion: ['🕐 Pendiente preparación', 'pill-naranja'],
    preparado_completo:    ['✅ Preparado completo',    'pill-azul'],
    preparado_incompleto:  ['⚠️ Preparado incompleto', 'pill-amarillo'],
    enviado:               ['🚚 Enviado',               'pill-cyan'],
    pendiente_completar:   ['📭 Pendiente completar',   'pill-naranja'],
    con_fallas:            ['❌ Con fallas',             'pill-rojo'],
    cerrado:               ['✅ Cerrado',                'pill-verde'],
  };
  const [label, cls] = MAP[estado] || [estado || '—', 'pill-gris'];
  return `<span class="terc-pill ${cls}">${label}</span>`;
}

function labelRol(rol) {
  return {
    gerencia: 'Gerencia',
    moron: 'Morón',
    control_calidad: 'Control de calidad',
  }[rol] || rol;
}

function labelHist(tipo) {
  return {
    creacion:    '🆕 Creación',
    preparacion: '⚙️ Preparación',
    salida:      '🚚 Salida',
    ingreso:     '📥 Ingreso',
    cierre:      '✅ Cierre',
  }[tipo] || tipo;
}

function kpiBox(val, label, colorClass) {
  const COLOR = {
    'pill-naranja':  'color:#fb923c',
    'pill-azul':     'color:#93c5fd',
    'pill-amarillo': 'color:#fbbf24',
    'pill-cyan':     'color:#22d3ee',
    'pill-rojo':     'color:#f87171',
    'pill-verde':    'color:#34d399',
    '':              '',
  };
  return `
    <div class="terc-kpi">
      <div class="terc-kpi-val" style="${COLOR[colorClass] || ''}">${val}</div>
      <div class="terc-kpi-lbl">${label}</div>
    </div>`;
}

// ─── Estado del módulo ────────────────────────────────────────────────────────

const T = {
  perfil: null,
  productos: [],
  pedidos: [],
  unsub: null,
  vista: 'lista',
  pedidoActual: null,
  accionActual: null,
};

// ─── API pública ──────────────────────────────────────────────────────────────

export async function initTercerizados(perfil) {
  T.perfil = perfil;
  T.vista = 'lista';
  T.pedidoActual = null;
  T.accionActual = null;
  buildShell();
  await loadProductos();
  subscribeStream();
}

export function destroyTercerizados() {
  if (T.unsub) { T.unsub(); T.unsub = null; }
}

// ─── Datos ───────────────────────────────────────────────────────────────────

async function loadProductos() {
  try {
    const snap = await getDocs(collection(db, 'productos'));
    T.productos = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.activo !== false)
      .sort((a, b) =>
        (a.orden ?? 9999) - (b.orden ?? 9999) ||
        (a.nombre || '').localeCompare(b.nombre || ''));
  } catch (e) {
    console.error('[Terc] loadProductos:', e);
  }
}

function subscribeStream() {
  if (T.unsub) T.unsub();
  const q = query(
    collection(db, 'seguimiento_tercerizados'),
    orderBy('fecha_creacion', 'desc')
  );
  T.unsub = onSnapshot(q, snap => {
    T.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // mantener referencia fresca al pedido en detalle
    if (T.pedidoActual) {
      const fresco = T.pedidos.find(p => p.id === T.pedidoActual.id);
      if (fresco) T.pedidoActual = fresco;
    }
    renderVista();
  }, e => console.error('[Terc] stream:', e));
}

// ─── Shell ───────────────────────────────────────────────────────────────────

function buildShell() {
  const root = $('terc-root');
  if (!root) return;

  const canCreate = ['moron', 'gerencia'].includes(T.perfil.rol);

  root.innerHTML = `
    <div id="terc-toast" class="terc-toast"></div>

    <div class="terc-topbar">
      <div class="terc-topbar-left">
        <h2 class="terc-title">📦 Seguimiento de Tercerizados</h2>
        <span class="terc-badge-rol">${labelRol(T.perfil.rol)}</span>
      </div>
    </div>

    <div class="terc-tabs" id="terc-tabs">
      <button class="terc-tab active" data-view="lista">
        ${T.perfil.rol === 'control_calidad' ? '⚙️ Pedidos a preparar' : '📋 Pedidos'}
      </button>
      ${canCreate ? '<button class="terc-tab" data-view="nuevo">➕ Nuevo pedido</button>' : ''}
    </div>

    <div id="terc-content"></div>
  `;

  root.querySelectorAll('.terc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      T.vista = btn.dataset.view;
      T.pedidoActual = null;
      T.accionActual = null;
      root.querySelectorAll('.terc-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVista();
    });
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

function renderVista() {
  if (T.pedidoActual) { renderDetalle(); return; }
  if (T.vista === 'nuevo') { renderNuevo(); return; }
  renderLista();
}

// ═══════════════════════════════════════════════════════════════
//  LISTA — diferenciada por rol
// ═══════════════════════════════════════════════════════════════

function renderLista() {
  const rol = T.perfil.rol;
  if (rol === 'moron')           renderListaMoron();
  else if (rol === 'control_calidad') renderListaCQ();
  else                           renderListaGerencia();
}

// ── MORÓN ─────────────────────────────────────────────────────────────────────

function renderListaMoron() {
  const content = $('terc-content');
  if (!content) return;

  const pedidos  = T.pedidos;
  const activos  = pedidos.filter(p => p.estado !== 'cerrado');
  const cerrados = pedidos.filter(p => p.estado === 'cerrado');

  const conAccion = pedidos.filter(p =>
    ['preparado_completo','preparado_incompleto','enviado','pendiente_completar','con_fallas']
    .includes(p.estado)).length;

  content.innerHTML = `
    ${conAccion > 0 ? `
      <div class="terc-banner terc-banner-accion">
        <span class="terc-banner-icon">🔔</span>
        <div>
          <strong>${conAccion} pedido${conAccion > 1 ? 's' : ''} requieren tu atención</strong>
          <div style="font-size:13px;opacity:.85;margin-top:3px;">
            Hay pedidos listos para dar salida o para registrar el ingreso.
          </div>
        </div>
      </div>` : ''}

    <div class="terc-kpi-row">
      ${kpiBox(pedidos.filter(p=>p.estado==='pendiente_preparacion').length, 'En preparación', 'pill-naranja')}
      ${kpiBox(pedidos.filter(p=>p.estado==='preparado_completo'||p.estado==='preparado_incompleto').length, 'Listos para salida', 'pill-azul')}
      ${kpiBox(pedidos.filter(p=>p.estado==='enviado').length, 'Enviados', 'pill-cyan')}
      ${kpiBox(pedidos.filter(p=>p.estado==='pendiente_completar'||p.estado==='con_fallas').length, 'Pendientes ingreso', 'pill-rojo')}
      ${kpiBox(cerrados.length, 'Cerrados', 'pill-verde')}
    </div>

    <div class="panel-card mt-20">
      <div class="panel-header">
        <h3>Pedidos activos</h3>
        <span class="dash-badge">${activos.length}</span>
      </div>
      <div id="terc-cards-activos" class="terc-cards-grid"></div>
    </div>

    <div class="panel-card mt-20">
      <div class="panel-header">
        <h3>Historial — Pedidos cerrados</h3>
        <span class="dash-badge">${cerrados.length}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table terc-table">
          <thead>
            <tr>
              <th>Fecha</th><th>Productos</th><th>Chofer</th>
              <th>Fecha salida</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody id="terc-tbody-cerr"></tbody>
        </table>
      </div>
    </div>
  `;

  // Cards activos
  const cardsEl = $('terc-cards-activos');
  if (!activos.length) {
    cardsEl.innerHTML = `<div class="terc-empty" style="padding:28px">No hay pedidos activos.</div>`;
  } else {
    cardsEl.innerHTML = activos.map(p => buildCardMoron(p)).join('');
    cardsEl.querySelectorAll('[data-accion]').forEach(btn =>
      btn.addEventListener('click', () => abrirPedido(btn.dataset.id, btn.dataset.accion)));
  }

  // Tabla cerrados
  const tbodyCerr = $('terc-tbody-cerr');
  if (!cerrados.length) {
    tbodyCerr.innerHTML = `<tr><td colspan="6" class="terc-empty">Sin pedidos cerrados aún.</td></tr>`;
  } else {
    tbodyCerr.innerHTML = cerrados.map(p => `
      <tr>
        <td>${fmtDate(p.fecha_creacion)}</td>
        <td>${(p.items||[]).length} ítem(s)</td>
        <td>${p.chofer || '—'}</td>
        <td>${p.fecha_salida ? `${p.fecha_salida} ${p.hora_salida||''}` : '—'}</td>
        <td>${pill(p.estado)}</td>
        <td>
          <button class="btn btn-sm btn-outline" data-accion="ver" data-id="${p.id}">
            👁 Ver
          </button>
        </td>
      </tr>`).join('');
    tbodyCerr.querySelectorAll('[data-accion]').forEach(btn =>
      btn.addEventListener('click', () => abrirPedido(btn.dataset.id, 'ver')));
  }
}

function buildCardMoron(p) {
  const btns = [];

  if (p.estado === 'preparado_completo' || p.estado === 'preparado_incompleto') {
    btns.push(`<button class="btn btn-primary terc-btn-accion" data-accion="salida" data-id="${p.id}">🚚 Dar salida</button>`);
  }
  if (['enviado','pendiente_completar','con_fallas'].includes(p.estado)) {
    btns.push(`<button class="btn terc-btn-verde terc-btn-accion" data-accion="ingreso" data-id="${p.id}">📥 Registrar ingreso</button>`);
  }
  btns.push(`<button class="btn btn-outline terc-btn-accion" data-accion="ver" data-id="${p.id}">👁 Ver detalle</button>`);

  const nItems = (p.items || []).length;
  const chips  = (p.items || []).slice(0, 3).map(it =>
    `<span class="terc-item-chip">${it.producto_nombre || it.producto_id} × ${it.cantidad_solicitada}</span>`
  ).join('') + (nItems > 3 ? `<span class="terc-item-chip terc-chip-more">+${nItems-3} más</span>` : '');

  return `
    <div class="terc-card">
      <div class="terc-card-head">
        <div>
          <div class="terc-card-fecha">📅 ${fmtDate(p.fecha_creacion)}</div>
          <div class="terc-card-chips">${chips}</div>
        </div>
        ${pill(p.estado)}
      </div>
      ${p.observacion ? `<div class="terc-card-obs">📝 ${p.observacion}</div>` : ''}
      ${p.chofer ? `<div class="terc-card-meta">🚚 Chofer: <strong>${p.chofer}</strong> · ${p.fecha_salida||''} ${p.hora_salida||''}</div>` : ''}
      <div class="terc-card-actions">${btns.join('')}</div>
    </div>`;
}

// ── CONTROL DE CALIDAD ────────────────────────────────────────────────────────

function renderListaCQ() {
  const content = $('terc-content');
  if (!content) return;

  const pendientes = T.pedidos.filter(p => p.estado === 'pendiente_preparacion');
  const historial  = T.pedidos.filter(p => p.estado !== 'pendiente_preparacion');

  content.innerHTML = `
    ${pendientes.length > 0 ? `
      <div class="terc-banner terc-banner-accion">
        <span class="terc-banner-icon">⚙️</span>
        <div>
          <strong>${pendientes.length} pedido${pendientes.length > 1 ? 's' : ''} pendiente${pendientes.length > 1 ? 's' : ''} de preparación</strong>
          <div style="font-size:13px;opacity:.85;margin-top:3px;">
            Hacé click en "Preparar pedido" para cargar las cantidades preparadas.
          </div>
        </div>
      </div>` : `
      <div class="terc-banner terc-banner-ok">
        <span class="terc-banner-icon">✅</span>
        <div><strong>¡Todo al día!</strong> No hay pedidos pendientes de preparación.</div>
      </div>`}

    <div class="terc-kpi-row">
      ${kpiBox(pendientes.length, 'Pendientes', 'pill-naranja')}
      ${kpiBox(T.pedidos.filter(p=>p.estado==='preparado_completo').length, 'Preparados OK', 'pill-azul')}
      ${kpiBox(T.pedidos.filter(p=>p.estado==='preparado_incompleto').length, 'Preparados parcial', 'pill-amarillo')}
      ${kpiBox(T.pedidos.filter(p=>p.estado==='enviado').length, 'Enviados', 'pill-cyan')}
      ${kpiBox(T.pedidos.filter(p=>p.estado==='cerrado').length, 'Cerrados', 'pill-verde')}
    </div>

    <!-- Pedidos a preparar -->
    <div class="panel-card mt-20">
      <div class="panel-header">
        <h3>⚙️ Pedidos para preparar</h3>
        <span class="dash-badge dash-badge-orange">${pendientes.length} pendientes</span>
      </div>
      ${pendientes.length === 0
        ? `<div class="terc-empty" style="padding:28px">Sin pedidos pendientes de preparación.</div>`
        : `<div class="terc-cards-grid" id="terc-cq-cards"></div>`}
    </div>

    <!-- Historial -->
    <div class="panel-card mt-20">
      <div class="panel-header">
        <h3>📋 Historial de preparaciones</h3>
        <span class="dash-badge">${historial.length}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table terc-table">
          <thead>
            <tr>
              <th>Fecha pedido</th><th>Ítems</th>
              <th>Resultado preparación</th><th>Preparado por</th>
              <th>Estado actual</th><th></th>
            </tr>
          </thead>
          <tbody id="terc-cq-hist"></tbody>
        </table>
      </div>
    </div>
  `;

  if (pendientes.length) {
    const el = $('terc-cq-cards');
    el.innerHTML = pendientes.map(p => buildCardCQ(p)).join('');
    el.querySelectorAll('[data-accion]').forEach(btn =>
      btn.addEventListener('click', () => abrirPedido(btn.dataset.id, btn.dataset.accion)));
  }

  const tbody = $('terc-cq-hist');
  if (!historial.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="terc-empty">Sin historial aún.</td></tr>`;
  } else {
    tbody.innerHTML = historial.map(p => `
      <tr>
        <td>${fmtDate(p.fecha_creacion)}</td>
        <td>${(p.items||[]).length} ítem(s)</td>
        <td>
          ${p.usuario_preparacion_nombre
            ? (p.estado === 'preparado_completo'
                ? '<span class="terc-pill pill-verde">COMPLETO</span>'
                : '<span class="terc-pill pill-amarillo">INCOMPLETO</span>')
            : '—'}
        </td>
        <td>${p.usuario_preparacion_nombre || '—'}</td>
        <td>${pill(p.estado)}</td>
        <td>
          <button class="btn btn-sm btn-outline" data-accion="ver" data-id="${p.id}">
            👁 Ver
          </button>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-accion]').forEach(btn =>
      btn.addEventListener('click', () => abrirPedido(btn.dataset.id, 'ver')));
  }
}

function buildCardCQ(p) {
  const nItems = (p.items || []).length;
  const preview = (p.items || []).slice(0, 4).map(it => `
    <div class="terc-cq-item-row">
      <span>${it.producto_nombre || it.producto_id}</span>
      <span class="terc-cq-cant">Solicitado: <strong>${it.cantidad_solicitada}</strong></span>
    </div>`).join('') +
    (nItems > 4 ? `<div class="terc-muted" style="font-size:12px;margin-top:4px;">+${nItems-4} productos más…</div>` : '');

  return `
    <div class="terc-card terc-card-cq">
      <div class="terc-card-head">
        <div>
          <div class="terc-card-fecha">📅 ${fmtDate(p.fecha_creacion)}</div>
          <div class="terc-muted" style="font-size:12px;margin-top:2px;">
            Por: ${p.usuario_creador_nombre || p.usuario_creador}
          </div>
        </div>
        ${pill(p.estado)}
      </div>
      <div class="terc-cq-items-preview">${preview}</div>
      ${p.observacion ? `<div class="terc-card-obs">📝 ${p.observacion}</div>` : ''}
      <div class="terc-card-actions">
        <button class="btn btn-primary terc-btn-accion" data-accion="preparar" data-id="${p.id}">
          ⚙️ Preparar pedido
        </button>
        <button class="btn btn-outline terc-btn-accion" data-accion="ver" data-id="${p.id}">
          👁 Ver detalle
        </button>
      </div>
    </div>`;
}

// ── GERENCIA ──────────────────────────────────────────────────────────────────

function renderListaGerencia() {
  const content = $('terc-content');
  if (!content) return;

  const pedidos = T.pedidos;

  content.innerHTML = `
    <div class="terc-kpi-row">
      ${kpiBox(pedidos.length, 'Total', '')}
      ${kpiBox(pedidos.filter(p=>p.estado==='pendiente_preparacion').length, 'Pend. preparación', 'pill-naranja')}
      ${kpiBox(pedidos.filter(p=>p.estado==='preparado_completo'||p.estado==='preparado_incompleto').length, 'Preparados', 'pill-azul')}
      ${kpiBox(pedidos.filter(p=>p.estado==='enviado').length, 'Enviados', 'pill-cyan')}
      ${kpiBox(pedidos.filter(p=>p.estado==='con_fallas').length, 'Con fallas', 'pill-rojo')}
      ${kpiBox(pedidos.filter(p=>p.estado==='pendiente_completar').length, 'Pend. completar', 'pill-naranja')}
      ${kpiBox(pedidos.filter(p=>p.estado==='cerrado').length, 'Cerrados', 'pill-verde')}
    </div>

    <div class="terc-filtros" style="margin-top:16px;">
      <label class="terc-label">Filtrar por estado:</label>
      <select id="terc-filtro" class="terc-select terc-select-sm">
        <option value="">Todos</option>
        <option value="pendiente_preparacion">Pendiente preparación</option>
        <option value="preparado_completo">Preparado completo</option>
        <option value="preparado_incompleto">Preparado incompleto</option>
        <option value="enviado">Enviado</option>
        <option value="pendiente_completar">Pendiente completar</option>
        <option value="con_fallas">Con fallas</option>
        <option value="cerrado">Cerrado</option>
      </select>
    </div>

    <div class="panel-card mt-20">
      <div class="panel-header">
        <h3>Todos los pedidos</h3>
        <span class="dash-badge" id="terc-ger-count">${pedidos.length} registros</span>
      </div>
      <div class="table-wrap">
        <table class="data-table terc-table">
          <thead>
            <tr>
              <th>#</th><th>Fecha</th><th>Creado por</th><th>Ítems</th>
              <th>Estado</th><th>Preparado por</th><th>Chofer</th><th>Salida</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody id="terc-tbody-ger"></tbody>
        </table>
      </div>
    </div>
  `;

  renderTbodyGer(pedidos);

  $('terc-filtro')?.addEventListener('change', e => {
    const v = e.target.value;
    const filt = v ? pedidos.filter(p => p.estado === v) : pedidos;
    const count = $('terc-ger-count');
    if (count) count.textContent = filt.length + ' registros';
    renderTbodyGer(filt);
  });
}

function renderTbodyGer(pedidos) {
  const tbody = $('terc-tbody-ger');
  if (!tbody) return;

  if (!pedidos.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="terc-empty">Sin pedidos.</td></tr>`;
    return;
  }

  tbody.innerHTML = pedidos.map((p, i) => {
    const btns = [`<button class="btn btn-sm btn-outline" data-accion="ver" data-id="${p.id}">👁 Ver</button>`];
    if (p.estado === 'pendiente_preparacion')
      btns.push(`<button class="btn btn-sm btn-primary" data-accion="preparar" data-id="${p.id}">⚙️ Preparar</button>`);
    if (p.estado === 'preparado_completo' || p.estado === 'preparado_incompleto')
      btns.push(`<button class="btn btn-sm terc-btn-cyan" data-accion="salida" data-id="${p.id}">🚚 Salida</button>`);
    if (['enviado','pendiente_completar','con_fallas'].includes(p.estado))
      btns.push(`<button class="btn btn-sm terc-btn-verde" data-accion="ingreso" data-id="${p.id}">📥 Ingreso</button>`);

    return `
      <tr>
        <td><span class="terc-num">${pedidos.length - i}</span></td>
        <td>${fmtDate(p.fecha_creacion)}</td>
        <td>${p.usuario_creador_nombre || p.usuario_creador || '—'}</td>
        <td>${(p.items||[]).length} ítem(s)</td>
        <td>${pill(p.estado)}</td>
        <td>${p.usuario_preparacion_nombre || '—'}</td>
        <td>${p.chofer || '—'}</td>
        <td>${p.fecha_salida ? `${p.fecha_salida} ${p.hora_salida||''}` : '—'}</td>
        <td><div class="terc-acciones">${btns.join('')}</div></td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-accion]').forEach(btn =>
    btn.addEventListener('click', () => abrirPedido(btn.dataset.id, btn.dataset.accion)));
}

// ─── Helper navegación ────────────────────────────────────────────────────────

function abrirPedido(id, accion) {
  const p = T.pedidos.find(x => x.id === id);
  if (!p) return;
  T.pedidoActual = p;
  T.accionActual = accion;
  renderVista();
}

// ═══════════════════════════════════════════════════════════════
//  NUEVO PEDIDO (Morón / Gerencia)
// ═══════════════════════════════════════════════════════════════

function renderNuevo() {
  const content = $('terc-content');
  if (!content) return;

  if (!T.productos.length) {
    content.innerHTML = `<div class="panel-card terc-empty-card">No hay productos activos cargados en el sistema.</div>`;
    return;
  }

  const categorias = [...new Set(T.productos.map(p => p.categoria || 'Sin categoría'))].sort();

  const filasPorCat = categorias.map(cat => {
    const prods = T.productos.filter(p => (p.categoria || 'Sin categoría') === cat);
    return `
      <tr class="terc-cat-header"><td colspan="3">📂 ${cat}</td></tr>
      ${prods.map(p => `
        <tr>
          <td>${p.nombre || p.id}</td>
          <td>
            <input type="number" min="0"
              class="terc-input-num terc-np-cant"
              data-prod-id="${p.id}"
              data-prod-nombre="${(p.nombre || p.id).replace(/"/g, '&quot;')}"
              placeholder="0" />
          </td>
          <td>
            <input type="text"
              class="terc-input-obs terc-np-obs"
              data-prod-id="${p.id}"
              placeholder="Observación…" />
          </td>
        </tr>`).join('')}`;
  }).join('');

  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h3>➕ Nuevo pedido de tercerizados</h3>
      </div>

      <div class="terc-field-row" style="max-width:520px;margin-bottom:20px;">
        <label class="terc-label">Observación general (opcional)</label>
        <input id="terc-obs-gral" type="text" class="terc-input"
          placeholder="Ej: urgente, para esta semana…" />
      </div>

      <div class="hint-box" style="margin-bottom:16px;">
        Completá solo los productos que necesitás. Los que queden en 0 o vacíos se ignoran.
      </div>

      <div class="table-wrap">
        <table class="data-table terc-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad solicitada</th>
              <th>Observación del ítem</th>
            </tr>
          </thead>
          <tbody>${filasPorCat}</tbody>
        </table>
      </div>

      <div class="terc-form-actions" style="margin-top:24px;">
        <button id="terc-btn-save" class="btn btn-primary">💾 Guardar pedido</button>
        <button id="terc-btn-cancel" class="btn btn-outline">Cancelar</button>
      </div>
    </div>
  `;

  $('terc-btn-cancel')?.addEventListener('click', () => {
    T.vista = 'lista';
    document.querySelectorAll('#terc-tabs .terc-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.view === 'lista'));
    renderLista();
  });

  $('terc-btn-save')?.addEventListener('click', guardarPedido);
}

async function guardarPedido() {
  const btn = $('terc-btn-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const items = [];
    document.querySelectorAll('.terc-np-cant').forEach(inp => {
      const cant = parseInt(inp.value) || 0;
      if (cant > 0) {
        const pid = inp.dataset.prodId;
        const obs = document.querySelector(`.terc-np-obs[data-prod-id="${pid}"]`);
        items.push({
          producto_id: pid,
          producto_nombre: inp.dataset.prodNombre,
          cantidad_solicitada: cant,
          observacion_item: obs?.value?.trim() || '',
        });
      }
    });

    if (!items.length) {
      toast('Cargá al menos un producto con cantidad mayor a 0.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar pedido'; }
      return;
    }

    await addDoc(collection(db, 'seguimiento_tercerizados'), {
      estado: 'pendiente_preparacion',
      observacion: $('terc-obs-gral')?.value?.trim() || '',
      usuario_creador: T.perfil.email,
      usuario_creador_nombre: T.perfil.nombre || T.perfil.email,
      fecha_creacion: serverTimestamp(),
      items,
      historial: [{
        tipo: 'creacion',
        fecha: nowISO(),
        usuario: T.perfil.email,
        usuario_nombre: T.perfil.nombre || T.perfil.email,
        detalle: `Pedido creado con ${items.length} ítem(s).`,
      }],
    });

    toast('✅ Pedido guardado correctamente.', 'ok');
    T.vista = 'lista';
    document.querySelectorAll('#terc-tabs .terc-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.view === 'lista'));
    renderLista();

  } catch (e) {
    console.error('[Terc] guardar:', e);
    toast('Error al guardar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar pedido'; }
  }
}

// ═══════════════════════════════════════════════════════════════
//  DETALLE + ACCIÓN
// ═══════════════════════════════════════════════════════════════

function renderDetalle() {
  const content = $('terc-content');
  const p = T.pedidoActual;
  if (!content || !p) return;

  const histHTML = (p.historial || []).slice().reverse().map(h => `
    <div class="terc-hist-item">
      <div class="terc-hist-header">
        <span class="terc-hist-tipo">${labelHist(h.tipo)}</span>
        <span class="terc-hist-fecha">
          ${h.fecha ? new Date(h.fecha).toLocaleString('es-AR') : '—'} · ${h.usuario_nombre || h.usuario || '—'}
        </span>
      </div>
      <div class="terc-hist-detalle">${h.detalle || ''}</div>
    </div>`).join('') || `<div class="terc-empty" style="padding:12px 0">Sin historial.</div>`;

  const itemsHTML = (p.items || []).map(item => {
    const prep = item.cantidad_preparada ?? '—';
    const estadoPrep = item.cantidad_preparada !== undefined
      ? (item.cantidad_preparada >= item.cantidad_solicitada
          ? '<span class="terc-pill pill-verde">COMPLETO</span>'
          : '<span class="terc-pill pill-amarillo">INCOMPLETO</span>')
      : '';

    const ingresosHTML = (item.ingresos || []).length
      ? item.ingresos.map((ing, i) => `
          <div class="terc-ingreso-row">
            <span class="terc-muted">Ingreso ${i+1}:</span>
            <span>✅ ${ing.ok ?? 0}</span>
            <span>❌ ${ing.falladas ?? 0}</span>
            <span>📭 ${ing.faltantes ?? 0}</span>
            ${ing.motivo_falla ? `<span class="terc-falla">"${ing.motivo_falla}"</span>` : ''}
            <span class="terc-muted">${ing.fecha ? new Date(ing.fecha).toLocaleString('es-AR') : ''}</span>
          </div>`).join('')
      : '<span class="terc-muted">—</span>';

    return `
      <tr>
        <td>${item.producto_nombre || item.producto_id}</td>
        <td class="terc-center">${item.cantidad_solicitada}</td>
        <td class="terc-center">${prep} ${estadoPrep}</td>
        <td class="terc-obs">${item.observacion_item || '—'}</td>
        <td>${ingresosHTML}</td>
      </tr>`;
  }).join('');

  content.innerHTML = `
    <div class="terc-detalle-grid">

      <!-- Cabecera del pedido -->
      <div class="panel-card">
        <div class="panel-header">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <button id="terc-volver" class="btn btn-sm btn-outline">← Volver</button>
            <h3 style="margin:0">Detalle del pedido</h3>
            ${pill(p.estado)}
          </div>
        </div>

        <div class="terc-meta-grid">
          <div><span class="terc-label">Creado</span><br>${fmt(p.fecha_creacion)}</div>
          <div><span class="terc-label">Creado por</span><br>${p.usuario_creador_nombre || p.usuario_creador || '—'}</div>
          <div><span class="terc-label">Observación</span><br>${p.observacion || '—'}</div>
          ${p.usuario_preparacion_nombre ? `<div><span class="terc-label">Preparado por</span><br>${p.usuario_preparacion_nombre}</div>` : ''}
          ${p.chofer ? `<div><span class="terc-label">Chofer</span><br>${p.chofer}</div>` : ''}
          ${p.fecha_salida ? `<div><span class="terc-label">Salida</span><br>${p.fecha_salida} ${p.hora_salida||''}</div>` : ''}
          ${p.usuario_salida_nombre ? `<div><span class="terc-label">Registró salida</span><br>${p.usuario_salida_nombre}</div>` : ''}
        </div>

        <div class="table-wrap" style="margin-top:18px;">
          <table class="data-table terc-table">
            <thead>
              <tr>
                <th>Producto</th><th>Solicitado</th>
                <th>Preparado</th><th>Observación</th><th>Ingresos</th>
              </tr>
            </thead>
            <tbody>${itemsHTML}</tbody>
          </table>
        </div>
      </div>

      <!-- Panel de acción -->
      <div id="terc-panel-accion" class="panel-card"></div>

      <!-- Historial -->
      <div class="panel-card">
        <div class="panel-header"><h3>📋 Historial de movimientos</h3></div>
        <div class="terc-hist-list">${histHTML}</div>
      </div>

    </div>
  `;

  $('terc-volver')?.addEventListener('click', () => {
    T.pedidoActual = null;
    T.accionActual = null;
    renderLista();
  });

  const panelAccion = $('terc-panel-accion');
  if (panelAccion) {
    const accion = T.accionActual === 'ver' ? null : (T.accionActual || inferAccion(p));
    if      (accion === 'preparar') mountPreparar(p, panelAccion);
    else if (accion === 'salida')   mountSalida(p, panelAccion);
    else if (accion === 'ingreso')  mountIngreso(p, panelAccion);
    else panelAccion.innerHTML = `
      <div class="panel-header"><h3>ℹ️ Estado actual</h3></div>
      <div class="terc-empty" style="padding:18px 0">
        ${p.estado === 'cerrado'
          ? '✅ Este pedido está cerrado. No hay acciones pendientes.'
          : 'No hay acciones disponibles para este estado con tu rol actual.'}
      </div>`;
  }
}

function inferAccion(p) {
  const rol = T.perfil.rol;
  if ((rol === 'control_calidad' || rol === 'gerencia') && p.estado === 'pendiente_preparacion') return 'preparar';
  if ((rol === 'moron' || rol === 'gerencia') && (p.estado === 'preparado_completo' || p.estado === 'preparado_incompleto')) return 'salida';
  if ((rol === 'moron' || rol === 'gerencia') && ['enviado','pendiente_completar','con_fallas'].includes(p.estado)) return 'ingreso';
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  ACCIÓN: PREPARAR — Control de calidad
// ═══════════════════════════════════════════════════════════════

function mountPreparar(p, container) {
  const filas = (p.items || []).map((item, i) => `
    <tr>
      <td><strong>${item.producto_nombre || item.producto_id}</strong></td>
      <td class="terc-center">
        <span class="terc-pill pill-azul">${item.cantidad_solicitada}</span>
      </td>
      <td class="terc-center">
        <input type="number" min="0"
          class="terc-input-num terc-prep-inp"
          data-idx="${i}"
          data-sol="${item.cantidad_solicitada}"
          value="${item.cantidad_preparada ?? ''}"
          placeholder="0" />
      </td>
      <td id="terc-ep-${i}" class="terc-center">—</td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="panel-header">
      <h3>⚙️ Preparar pedido</h3>
      <span class="terc-badge-rol">Control de calidad</span>
    </div>

    <div class="hint-box" style="margin-bottom:16px;">
      Cargá la cantidad <strong>real preparada</strong> por cada producto.
      El sistema calcula automáticamente si está completo o incompleto.
    </div>

    <div class="table-wrap">
      <table class="data-table terc-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th style="text-align:center">Solicitado</th>
            <th style="text-align:center">Preparado</th>
            <th style="text-align:center">Estado</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div id="terc-prep-resumen" class="terc-resumen-prep" style="display:none;margin-top:16px;"></div>

    <div class="terc-form-actions" style="margin-top:20px;">
      <button id="terc-btn-prep" class="btn btn-primary">✅ Confirmar preparación</button>
    </div>
  `;

  function actualizarResumen() {
    let completos = 0, incompletos = 0, sinCargar = 0;
    container.querySelectorAll('.terc-prep-inp').forEach(inp => {
      const idx = inp.dataset.idx;
      const sol = parseInt(inp.dataset.sol) || 0;
      const val = inp.value;
      const prep = parseInt(val);
      const el = $(`terc-ep-${idx}`);
      if (!val || isNaN(prep)) {
        if (el) el.innerHTML = '—';
        sinCargar++;
      } else if (prep >= sol) {
        if (el) el.innerHTML = '<span class="terc-pill pill-verde">COMPLETO</span>';
        completos++;
      } else {
        if (el) el.innerHTML = '<span class="terc-pill pill-amarillo">INCOMPLETO</span>';
        incompletos++;
      }
    });
    const res = $('terc-prep-resumen');
    if (res && (completos || incompletos)) {
      res.style.display = 'flex';
      res.innerHTML = `
        <span style="font-weight:600;margin-right:8px;">Resumen:</span>
        ${completos  ? `<span class="terc-pill pill-verde">${completos} completo${completos>1?'s':''}</span>` : ''}
        ${incompletos? `<span class="terc-pill pill-amarillo">${incompletos} incompleto${incompletos>1?'s':''}</span>` : ''}
        ${sinCargar  ? `<span class="terc-pill pill-gris">${sinCargar} sin cargar</span>` : ''}`;
    } else if (res) res.style.display = 'none';
  }

  container.querySelectorAll('.terc-prep-inp').forEach(inp =>
    inp.addEventListener('input', actualizarResumen));

  $('terc-btn-prep')?.addEventListener('click', () => confirmarPreparacion(p, container));
}

async function confirmarPreparacion(p, container) {
  const btn = $('terc-btn-prep');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const inputs = container.querySelectorAll('.terc-prep-inp');
    let todosOk = true;

    const items = p.items.map((item, i) => {
      const prep = parseInt(inputs[i]?.value) || 0;
      if (prep < item.cantidad_solicitada) todosOk = false;
      return { ...item, cantidad_preparada: prep };
    });

    const estadoNuevo = todosOk ? 'preparado_completo' : 'preparado_incompleto';

    await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
      estado: estadoNuevo,
      items,
      fecha_preparacion: serverTimestamp(),
      usuario_preparacion: T.perfil.email,
      usuario_preparacion_nombre: T.perfil.nombre || T.perfil.email,
      historial: [...(p.historial || []), {
        tipo: 'preparacion',
        fecha: nowISO(),
        usuario: T.perfil.email,
        usuario_nombre: T.perfil.nombre || T.perfil.email,
        detalle: `Preparación ${todosOk ? 'COMPLETA' : 'INCOMPLETA'} confirmada por ${T.perfil.nombre || T.perfil.email}.`,
      }],
    });

    toast(todosOk ? '✅ Preparación completa confirmada.' : '⚠️ Preparación incompleta registrada.', 'ok');
    T.pedidoActual = null;
    T.accionActual = null;
    renderLista();
  } catch (e) {
    console.error('[Terc] preparar:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar preparación'; }
  }
}

// ═══════════════════════════════════════════════════════════════
//  ACCIÓN: DAR SALIDA — Morón
// ═══════════════════════════════════════════════════════════════

function mountSalida(p, container) {
  const resumen = (p.items || []).map(it => `
    <div class="terc-salida-item">
      <span>${it.producto_nombre || it.producto_id}</span>
      <span class="terc-pill ${(it.cantidad_preparada ?? 0) >= it.cantidad_solicitada ? 'pill-verde' : 'pill-amarillo'}">
        Preparado: ${it.cantidad_preparada ?? '—'} / Sol: ${it.cantidad_solicitada}
      </span>
    </div>`).join('');

  container.innerHTML = `
    <div class="panel-header">
      <h3>🚚 Dar salida al pedido</h3>
      <span class="terc-badge-rol">Morón</span>
    </div>

    <div class="terc-salida-resumen" style="margin-bottom:20px;">
      <div class="terc-label" style="margin-bottom:10px;">Productos que salen:</div>
      ${resumen}
    </div>

    <div class="terc-field-row" style="max-width:380px;">
      <label class="terc-label">Nombre del chofer *</label>
      <input id="terc-chofer" type="text" class="terc-input" placeholder="Ej: Juan García" />
    </div>

    <div class="hint-box" style="margin-top:14px;">
      Al confirmar se registrará la fecha y hora de salida automáticamente.
    </div>

    <div class="terc-form-actions" style="margin-top:20px;">
      <button id="terc-btn-salida" class="btn btn-primary" style="font-size:15px;padding:14px 28px;">
        🚚 CONFIRMAR SALIDA
      </button>
    </div>
  `;

  $('terc-btn-salida')?.addEventListener('click', () => confirmarSalida(p));
}

async function confirmarSalida(p) {
  const chofer = $('terc-chofer')?.value?.trim();
  if (!chofer) { toast('Ingresá el nombre del chofer.', 'error'); return; }

  const btn = $('terc-btn-salida');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const ahora = new Date();
    await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
      estado: 'enviado',
      chofer,
      fecha_salida: ahora.toLocaleDateString('es-AR'),
      hora_salida:  ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      usuario_salida: T.perfil.email,
      usuario_salida_nombre: T.perfil.nombre || T.perfil.email,
      historial: [...(p.historial || []), {
        tipo: 'salida',
        fecha: nowISO(),
        usuario: T.perfil.email,
        usuario_nombre: T.perfil.nombre || T.perfil.email,
        detalle: `Salida confirmada. Chofer: ${chofer}.`,
      }],
    });

    toast('🚚 Salida registrada correctamente.', 'ok');
    T.pedidoActual = null;
    T.accionActual = null;
    renderLista();
  } catch (e) {
    console.error('[Terc] salida:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🚚 CONFIRMAR SALIDA'; }
  }
}

// ═══════════════════════════════════════════════════════════════
//  ACCIÓN: REGISTRAR INGRESO — Morón
// ═══════════════════════════════════════════════════════════════

function mountIngreso(p, container) {
  const filas = (p.items || []).map((item, i) => {
    const prevOk    = (item.ingresos||[]).reduce((s,x) => s+(x.ok??0), 0);
    const prevFall  = (item.ingresos||[]).reduce((s,x) => s+(x.falladas??0), 0);
    const prevFalt  = (item.ingresos||[]).reduce((s,x) => s+(x.faltantes??0), 0);
    const preparado = item.cantidad_preparada ?? item.cantidad_solicitada;
    const pendiente = Math.max(0, preparado - prevOk - prevFall - prevFalt);

    return `
      <tr>
        <td><strong>${item.producto_nombre || item.producto_id}</strong></td>
        <td class="terc-center">${item.cantidad_solicitada}</td>
        <td class="terc-center">${preparado}</td>
        <td class="terc-center" style="color:#34d399;font-weight:700;">${prevOk}</td>
        <td class="terc-center" style="color:#f59e0b;font-weight:700;">${pendiente}</td>
        <td class="terc-center">
          <input type="number" min="0" class="terc-input-num terc-ing-ok"
            data-idx="${i}" placeholder="0"/>
        </td>
        <td class="terc-center">
          <input type="number" min="0" class="terc-input-num terc-ing-fall"
            data-idx="${i}" placeholder="0"/>
        </td>
        <td class="terc-center">
          <input type="number" min="0" class="terc-input-num terc-ing-falt"
            data-idx="${i}" placeholder="0"/>
        </td>
        <td>
          <input type="text" class="terc-input terc-ing-motivo"
            data-idx="${i}"
            placeholder="Motivo (si hay falla)…"
            style="min-width:150px;padding:8px 10px;font-size:13px;"/>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="panel-header">
      <h3>📥 Registrar ingreso</h3>
      <span class="terc-badge-rol">Morón</span>
    </div>

    <div class="hint-box" style="margin-bottom:16px;">
      Cargá las cantidades de este ingreso. Podés hacer múltiples ingresos parciales.
      Si hay unidades <strong>falladas</strong>, el motivo es obligatorio.
    </div>

    <div class="table-wrap">
      <table class="data-table terc-table" style="min-width:820px;">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Solicitado</th>
            <th>Preparado</th>
            <th style="color:#34d399">✅ Recibido OK</th>
            <th style="color:#f59e0b">⏳ Pendiente</th>
            <th>✅ OK (este ingreso)</th>
            <th>❌ Falladas</th>
            <th>📭 Faltantes</th>
            <th>Motivo falla</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div class="terc-form-actions" style="margin-top:24px;">
      <button id="terc-btn-ingreso" class="btn btn-primary" style="font-size:15px;padding:14px 28px;">
        📥 CONFIRMAR INGRESO
      </button>
    </div>
  `;

  $('terc-btn-ingreso')?.addEventListener('click', () => confirmarIngreso(p));
}

async function confirmarIngreso(p) {
  const btn = $('terc-btn-ingreso');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const items = p.items || [];
    let algunoCargado = false;
    let hayFallas     = false;

    // Validar: motivo obligatorio si hay falladas
    const ingFall   = document.querySelectorAll('.terc-ing-fall');
    const ingMotivo = document.querySelectorAll('.terc-ing-motivo');
    let motivoFalta = false;
    ingFall.forEach((inp, i) => {
      if ((parseInt(inp.value) || 0) > 0 && !ingMotivo[i]?.value?.trim()) {
        motivoFalta = true;
      }
    });
    if (motivoFalta) {
      toast('Ingresá el motivo de falla para los productos con unidades falladas.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📥 CONFIRMAR INGRESO'; }
      return;
    }

    const ingOk   = document.querySelectorAll('.terc-ing-ok');
    const ingFalt = document.querySelectorAll('.terc-ing-falt');

    const itemsUpd = items.map((item, i) => {
      const ok       = parseInt(ingOk[i]?.value)     || 0;
      const falladas = parseInt(ingFall[i]?.value)   || 0;
      const faltantes= parseInt(ingFalt[i]?.value)   || 0;
      const motivo   = ingMotivo[i]?.value?.trim()   || '';

      if (ok || falladas || faltantes) algunoCargado = true;
      if (falladas) hayFallas = true;

      return {
        ...item,
        ingresos: [...(item.ingresos || []), {
          ok, falladas, faltantes,
          motivo_falla: motivo,
          fecha: nowISO(),
        }],
      };
    });

    if (!algunoCargado) {
      toast('Cargá al menos un valor en este ingreso.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📥 CONFIRMAR INGRESO'; }
      return;
    }

    // Calcular si todos los ítems están completos
    let todosCompletos = true;
    itemsUpd.forEach(item => {
      const preparado = item.cantidad_preparada ?? item.cantidad_solicitada;
      const totalReg  = (item.ingresos || []).reduce(
        (s, x) => s + (x.ok ?? 0) + (x.falladas ?? 0) + (x.faltantes ?? 0), 0);
      if (totalReg < preparado) todosCompletos = false;
    });

    let estadoNuevo;
    if (todosCompletos) estadoNuevo = hayFallas ? 'con_fallas' : 'cerrado';
    else                estadoNuevo = hayFallas ? 'con_fallas' : 'pendiente_completar';

    const histEntry = {
      tipo: estadoNuevo === 'cerrado' ? 'cierre' : 'ingreso',
      fecha: nowISO(),
      usuario: T.perfil.email,
      usuario_nombre: T.perfil.nombre || T.perfil.email,
      detalle: estadoNuevo === 'cerrado'
        ? 'Pedido cerrado. Todas las unidades recibidas correctamente.'
        : `Ingreso parcial registrado. Estado actualizado a: ${estadoNuevo}.`,
    };

    await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
      estado: estadoNuevo,
      items: itemsUpd,
      historial: [...(p.historial || []), histEntry],
    });

    const msgs = {
      cerrado:              '✅ ¡Pedido cerrado! Todas las unidades recibidas.',
      pendiente_completar:  '⚠️ Ingreso registrado. Quedan unidades pendientes.',
      con_fallas:           '❌ Ingreso registrado. Se detectaron fallas.',
    };
    toast(msgs[estadoNuevo] || 'Ingreso guardado.', estadoNuevo === 'cerrado' ? 'ok' : 'info');
    T.pedidoActual = null;
    T.accionActual = null;
    renderLista();

  } catch (e) {
    console.error('[Terc] ingreso:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📥 CONFIRMAR INGRESO'; }
  }
}
