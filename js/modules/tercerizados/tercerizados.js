/**
 * ============================================================
 *  MÓDULO: SEGUIMIENTO DE TERCERIZADOS  — v2
 *  js/modules/tercerizados/tercerizados.js
 *
 *  FLUJO COMPLETO:
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  MORÓN crea pedido           → pendiente_preparacion    │
 *  │  CONTROL CALIDAD prepara     → preparado_completo /     │
 *  │                                preparado_incompleto     │
 *  │  MORÓN da salida (+ chofer)  → enviado                  │
 *  │  MORÓN registra ingreso(s)   → cerrado /                │
 *  │                                pendiente_completar /    │
 *  │                                con_fallas               │
 *  └─────────────────────────────────────────────────────────┘
 *
 *  ROLES:
 *    moron           → crear · dar salida · registrar ingreso
 *    control_calidad → preparar
 *    gerencia        → todo + visión completa
 * ============================================================
 */

import { db } from '../../firebase-config.js';
import {
  collection, addDoc, getDocs, doc, updateDoc,
  query, orderBy, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const $  = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

function fmt(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR') + ' ' +
         d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
function fmtFecha(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR');
}
function iso() { return new Date().toISOString(); }

function toast(msg, tipo = 'info') {
  const el = $('terc-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `terc-toast terc-toast-${tipo} terc-toast-show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('terc-toast-show'), 3800);
}

const ESTADOS = {
  pendiente_preparacion: { label: 'Pendiente preparación', cls: 'est-naranja', icon: '🕐' },
  preparado_completo:    { label: 'Preparado completo',    cls: 'est-azul',    icon: '✅' },
  preparado_incompleto:  { label: 'Preparado incompleto',  cls: 'est-amarillo',icon: '⚠️' },
  enviado:               { label: 'Enviado',               cls: 'est-cyan',    icon: '🚚' },
  pendiente_completar:   { label: 'Pendiente completar',   cls: 'est-naranja', icon: '📭' },
  con_fallas:            { label: 'Con fallas',            cls: 'est-rojo',    icon: '❌' },
  cerrado:               { label: 'Cerrado',               cls: 'est-verde',   icon: '✅' },
};

function badge(estado) {
  const e = ESTADOS[estado] || { label: estado || '—', cls: 'est-gris', icon: '•' };
  return `<span class="terc-badge ${e.cls}">${e.icon} ${e.label}</span>`;
}

function rolLabel(rol) {
  return { gerencia: 'Gerencia', moron: 'Morón', control_calidad: 'Control de Calidad' }[rol] || rol;
}

function histLabel(tipo) {
  return {
    creacion:    '🆕 Creación',
    preparacion: '⚙️ Preparación',
    salida:      '🚚 Salida',
    ingreso:     '📥 Ingreso',
    cierre:      '✅ Cierre',
  }[tipo] || tipo;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ESTADO GLOBAL DEL MÓDULO
// ─────────────────────────────────────────────────────────────────────────────

const M = {
  perfil:    null,
  productos: [],
  pedidos:   [],
  unsub:     null,
  vista:     'lista',        // 'lista' | 'nuevo' | 'detalle'
  pedido:    null,           // pedido en detalle
  accion:    null,           // 'preparar' | 'salida' | 'ingreso' | 'ver'
};

// ─────────────────────────────────────────────────────────────────────────────
//  API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

export async function initTercerizados(perfil) {
  M.perfil = perfil;
  M.vista  = 'lista';
  M.pedido = null;
  M.accion = null;
  buildShell();
  await cargarProductos();
  suscribirPedidos();
}

export function destroyTercerizados() {
  if (M.unsub) { M.unsub(); M.unsub = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FIRESTORE
// ─────────────────────────────────────────────────────────────────────────────

async function cargarProductos() {
  try {
    const snap = await getDocs(collection(db, 'productos'));
    M.productos = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.activo !== false)
      .sort((a, b) =>
        (a.orden ?? 9999) - (b.orden ?? 9999) ||
        (a.nombre || '').localeCompare(b.nombre || ''));
  } catch (e) {
    console.error('[Terc] cargarProductos:', e);
  }
}

function suscribirPedidos() {
  if (M.unsub) M.unsub();
  const q = query(
    collection(db, 'seguimiento_tercerizados'),
    orderBy('fecha_creacion', 'desc')
  );
  M.unsub = onSnapshot(q, snap => {
    M.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (M.pedido) {
      const fresco = M.pedidos.find(p => p.id === M.pedido.id);
      if (fresco) M.pedido = fresco;
    }
    renderVista();
  }, e => console.error('[Terc] stream:', e));
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHELL PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

function buildShell() {
  const root = $('terc-root');
  if (!root) return;

  const puedeCrear = ['moron', 'gerencia'].includes(M.perfil.rol);

  root.innerHTML = `
    <div id="terc-toast" class="terc-toast"></div>

    <!-- ── Header del módulo ── -->
    <div class="terc-header">
      <div class="terc-header-left">
        <div class="terc-header-icon">📦</div>
        <div>
          <h2 class="terc-header-title">Seguimiento de Tercerizados</h2>
          <div class="terc-header-sub">Gestión completa de pedidos externos</div>
        </div>
      </div>
      <div class="terc-header-right">
        <span class="terc-rol-badge">${rolLabel(M.perfil.rol)}</span>
        <span class="terc-usuario-badge">👤 ${M.perfil.nombre || M.perfil.email}</span>
      </div>
    </div>

    <!-- ── Tabs ── -->
    <div class="terc-tabs" id="terc-tabs">
      <button class="terc-tab active" data-view="lista">
        <span class="terc-tab-icon">${M.perfil.rol === 'control_calidad' ? '⚙️' : '📋'}</span>
        ${M.perfil.rol === 'control_calidad' ? 'Pedidos a preparar' : 'Todos los pedidos'}
      </button>
      ${puedeCrear ? `
        <button class="terc-tab" data-view="nuevo">
          <span class="terc-tab-icon">➕</span>
          Nuevo pedido
        </button>` : ''}
    </div>

    <!-- ── Contenido dinámico ── -->
    <div id="terc-content"></div>
  `;

  $$('.terc-tab', root).forEach(btn => {
    btn.addEventListener('click', () => {
      M.vista  = btn.dataset.view;
      M.pedido = null;
      M.accion = null;
      $$('.terc-tab', root).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVista();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTER
// ─────────────────────────────────────────────────────────────────────────────

function renderVista() {
  if (M.pedido)           { renderDetalle();  return; }
  if (M.vista === 'nuevo'){ renderNuevo();    return; }
  renderLista();
}

function irDetalle(id, accion) {
  M.pedido = M.pedidos.find(p => p.id === id);
  if (!M.pedido) return;
  M.accion = accion || null;
  renderDetalle();
}

function volver() {
  M.pedido = null;
  M.accion = null;
  $$('.terc-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.view === 'lista'));
  M.vista = 'lista';
  renderLista();
}

// ─────────────────────────────────────────────────────────────────────────────
//  LISTA — enrutada por rol
// ─────────────────────────────────────────────────────────────────────────────

function renderLista() {
  if (M.perfil.rol === 'moron')            renderListaMoron();
  else if (M.perfil.rol === 'control_calidad') renderListaCQ();
  else                                      renderListaGerencia();
}

// ══════════════════════════════════════════════════════════════════════════════
//  LISTA — MORÓN
// ══════════════════════════════════════════════════════════════════════════════

function renderListaMoron() {
  const content = $('terc-content');
  if (!content) return;

  const todos    = M.pedidos;
  const activos  = todos.filter(p => p.estado !== 'cerrado');
  const cerrados = todos.filter(p => p.estado === 'cerrado');

  // Pedidos que piden acción ahora mismo
  const urgentesSalida   = todos.filter(p => ['preparado_completo','preparado_incompleto'].includes(p.estado));
  const urgentesIngreso  = todos.filter(p => ['enviado','pendiente_completar','con_fallas'].includes(p.estado));
  const totalUrgentes    = urgentesSalida.length + urgentesIngreso.length;

  content.innerHTML = `

    ${totalUrgentes > 0 ? `
    <div class="terc-alerta-banner">
      <div class="terc-alerta-icon">🔔</div>
      <div class="terc-alerta-body">
        <div class="terc-alerta-titulo">
          ${totalUrgentes} pedido${totalUrgentes > 1 ? 's requieren' : ' requiere'} tu atención
        </div>
        <div class="terc-alerta-sub">
          ${urgentesSalida.length > 0 ? `<span class="terc-chip-mini chip-azul">🚚 ${urgentesSalida.length} para dar salida</span>` : ''}
          ${urgentesIngreso.length > 0 ? `<span class="terc-chip-mini chip-verde">📥 ${urgentesIngreso.length} para registrar ingreso</span>` : ''}
        </div>
      </div>
    </div>` : ''}

    <!-- KPIs -->
    <div class="terc-kpis">
      ${kpi(todos.filter(p=>p.estado==='pendiente_preparacion').length, 'En preparación', '⚙️', 'kpi-naranja')}
      ${kpi(urgentesSalida.length, 'Listos para salida', '🚚', 'kpi-azul')}
      ${kpi(urgentesIngreso.length, 'Esperando ingreso', '📥', 'kpi-cyan')}
      ${kpi(cerrados.length, 'Cerrados', '✅', 'kpi-verde')}
    </div>

    <!-- Pedidos activos -->
    <div class="terc-section-title">
      <span>Pedidos activos</span>
      <span class="terc-count-badge">${activos.length}</span>
    </div>

    ${activos.length === 0
      ? `<div class="terc-empty-state">
           <div class="terc-empty-icon">📭</div>
           <div>No hay pedidos activos en este momento.</div>
           <button class="btn btn-primary" onclick="document.querySelector('[data-view=nuevo]').click()">
             ➕ Crear nuevo pedido
           </button>
         </div>`
      : `<div class="terc-cards-grid" id="terc-cards-activos"></div>`
    }

    <!-- Historial cerrados -->
    <div class="terc-section-title" style="margin-top:32px;">
      <span>Historial — Pedidos cerrados</span>
      <span class="terc-count-badge">${cerrados.length}</span>
    </div>

    <div class="terc-panel">
      <div class="terc-table-wrap">
        <table class="terc-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Ítems</th>
              <th>Chofer</th>
              <th>Fecha salida</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="terc-tbody-cerr"></tbody>
        </table>
      </div>
    </div>
  `;

  // Montar cards
  if (activos.length > 0) {
    const grid = $('terc-cards-activos');
    grid.innerHTML = activos.map(p => cardMoron(p)).join('');
    $$('[data-accion]', grid).forEach(btn =>
      btn.addEventListener('click', () => irDetalle(btn.dataset.id, btn.dataset.accion)));
  }

  // Tabla cerrados
  const tbody = $('terc-tbody-cerr');
  if (!cerrados.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="terc-td-empty">Sin pedidos cerrados aún.</td></tr>`;
  } else {
    tbody.innerHTML = cerrados.map(p => `
      <tr>
        <td>${fmtFecha(p.fecha_creacion)}</td>
        <td>${(p.items||[]).length} ítem(s)</td>
        <td>${p.chofer || '—'}</td>
        <td>${p.fecha_salida ? `${p.fecha_salida} ${p.hora_salida||''}` : '—'}</td>
        <td>${badge(p.estado)}</td>
        <td>
          <button class="terc-btn-icon" data-accion="ver" data-id="${p.id}" title="Ver detalle">👁</button>
        </td>
      </tr>`).join('');
    $$('[data-accion]', tbody).forEach(btn =>
      btn.addEventListener('click', () => irDetalle(btn.dataset.id, 'ver')));
  }
}

function cardMoron(p) {
  const btns = [];
  if (['preparado_completo','preparado_incompleto'].includes(p.estado)) {
    btns.push(`<button class="btn btn-primary terc-card-btn" data-accion="salida" data-id="${p.id}">🚚 Dar salida</button>`);
  }
  if (['enviado','pendiente_completar','con_fallas'].includes(p.estado)) {
    btns.push(`<button class="btn terc-btn-verde terc-card-btn" data-accion="ingreso" data-id="${p.id}">📥 Registrar ingreso</button>`);
  }
  btns.push(`<button class="btn btn-outline terc-card-btn" data-accion="ver" data-id="${p.id}">👁 Ver detalle</button>`);

  const chips = (p.items||[]).slice(0,3).map(it =>
    `<span class="terc-item-chip">${it.producto_nombre||it.producto_id} <strong>×${it.cantidad_solicitada}</strong></span>`
  ).join('') + ((p.items||[]).length > 3
    ? `<span class="terc-item-chip terc-chip-mas">+${(p.items||[]).length-3} más</span>` : '');

  const urgente = ['preparado_completo','preparado_incompleto','enviado','pendiente_completar','con_fallas'].includes(p.estado);

  return `
    <div class="terc-card ${urgente ? 'terc-card-urgente' : ''}">
      <div class="terc-card-head">
        <div class="terc-card-meta-top">
          <span class="terc-card-fecha">📅 ${fmtFecha(p.fecha_creacion)}</span>
          ${badge(p.estado)}
        </div>
        <div class="terc-card-chips">${chips}</div>
      </div>
      ${p.observacion ? `<div class="terc-card-obs">📝 ${p.observacion}</div>` : ''}
      ${p.chofer ? `<div class="terc-card-info">🚚 Chofer: <strong>${p.chofer}</strong> · ${p.fecha_salida||''} ${p.hora_salida||''}</div>` : ''}
      <div class="terc-card-actions">${btns.join('')}</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  LISTA — CONTROL DE CALIDAD
// ══════════════════════════════════════════════════════════════════════════════

function renderListaCQ() {
  const content = $('terc-content');
  if (!content) return;

  const pendientes = M.pedidos.filter(p => p.estado === 'pendiente_preparacion');
  const historial  = M.pedidos.filter(p => p.estado !== 'pendiente_preparacion');

  content.innerHTML = `

    ${pendientes.length > 0 ? `
    <div class="terc-alerta-banner terc-alerta-cq">
      <div class="terc-alerta-icon">⚙️</div>
      <div class="terc-alerta-body">
        <div class="terc-alerta-titulo">
          ${pendientes.length} pedido${pendientes.length > 1 ? 's pendientes' : ' pendiente'} de preparación
        </div>
        <div class="terc-alerta-sub">
          Revisá cada pedido y cargá las cantidades preparadas.
        </div>
      </div>
    </div>` : `
    <div class="terc-alerta-banner terc-alerta-ok">
      <div class="terc-alerta-icon">✅</div>
      <div class="terc-alerta-body">
        <div class="terc-alerta-titulo">¡Todo al día!</div>
        <div class="terc-alerta-sub">No hay pedidos pendientes de preparación.</div>
      </div>
    </div>`}

    <!-- KPIs -->
    <div class="terc-kpis">
      ${kpi(pendientes.length, 'Pendientes', '🕐', 'kpi-naranja')}
      ${kpi(M.pedidos.filter(p=>p.estado==='preparado_completo').length, 'Preparados OK', '✅', 'kpi-azul')}
      ${kpi(M.pedidos.filter(p=>p.estado==='preparado_incompleto').length, 'Preparados parcial', '⚠️', 'kpi-amarillo')}
      ${kpi(M.pedidos.filter(p=>p.estado==='enviado').length, 'Enviados', '🚚', 'kpi-cyan')}
      ${kpi(M.pedidos.filter(p=>p.estado==='cerrado').length, 'Cerrados', '✅', 'kpi-verde')}
    </div>

    <!-- Pedidos para preparar -->
    <div class="terc-section-title">
      <span>⚙️ Pedidos para preparar</span>
      <span class="terc-count-badge terc-count-badge-naranja">${pendientes.length} pendientes</span>
    </div>

    ${pendientes.length === 0
      ? `<div class="terc-empty-state"><div class="terc-empty-icon">🎉</div><div>Sin pedidos pendientes.</div></div>`
      : `<div class="terc-cards-grid terc-cards-cq" id="terc-cq-cards"></div>`
    }

    <!-- Historial -->
    <div class="terc-section-title" style="margin-top:32px;">
      <span>📋 Historial de preparaciones</span>
      <span class="terc-count-badge">${historial.length}</span>
    </div>

    <div class="terc-panel">
      <div class="terc-table-wrap">
        <table class="terc-table">
          <thead>
            <tr>
              <th>Fecha pedido</th>
              <th>Ítems</th>
              <th>Resultado preparación</th>
              <th>Preparado por</th>
              <th>Estado actual</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="terc-cq-hist"></tbody>
        </table>
      </div>
    </div>
  `;

  if (pendientes.length) {
    const grid = $('terc-cq-cards');
    grid.innerHTML = pendientes.map(p => cardCQ(p)).join('');
    $$('[data-accion]', grid).forEach(btn =>
      btn.addEventListener('click', () => irDetalle(btn.dataset.id, btn.dataset.accion)));
  }

  const tbody = $('terc-cq-hist');
  if (!historial.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="terc-td-empty">Sin historial aún.</td></tr>`;
  } else {
    tbody.innerHTML = historial.map(p => `
      <tr>
        <td>${fmtFecha(p.fecha_creacion)}</td>
        <td>${(p.items||[]).length} ítem(s)</td>
        <td>
          ${p.usuario_preparacion_nombre
            ? (p.estado === 'preparado_completo'
                ? `<span class="terc-badge est-azul">✅ Completo</span>`
                : `<span class="terc-badge est-amarillo">⚠️ Incompleto</span>`)
            : '—'}
        </td>
        <td>${p.usuario_preparacion_nombre || '—'}</td>
        <td>${badge(p.estado)}</td>
        <td>
          <button class="terc-btn-icon" data-accion="ver" data-id="${p.id}" title="Ver">👁</button>
        </td>
      </tr>`).join('');
    $$('[data-accion]', tbody).forEach(btn =>
      btn.addEventListener('click', () => irDetalle(btn.dataset.id, 'ver')));
  }
}

function cardCQ(p) {
  const items = (p.items||[]);
  const preview = items.slice(0,4).map(it => `
    <div class="terc-cq-row">
      <span class="terc-cq-prod">${it.producto_nombre||it.producto_id}</span>
      <span class="terc-cq-cant">Solicitado: <strong>${it.cantidad_solicitada}</strong></span>
    </div>`).join('') +
    (items.length > 4 ? `<div class="terc-cq-mas">+${items.length-4} productos más…</div>` : '');

  return `
    <div class="terc-card terc-card-cq">
      <div class="terc-card-head">
        <div>
          <div class="terc-card-fecha">📅 ${fmtFecha(p.fecha_creacion)}</div>
          <div class="terc-card-creador">Por: ${p.usuario_creador_nombre||p.usuario_creador||'—'}</div>
        </div>
        ${badge(p.estado)}
      </div>
      <div class="terc-cq-preview">${preview}</div>
      ${p.observacion ? `<div class="terc-card-obs">📝 ${p.observacion}</div>` : ''}
      <div class="terc-card-actions">
        <button class="btn btn-primary terc-card-btn" data-accion="preparar" data-id="${p.id}">
          ⚙️ Preparar pedido
        </button>
        <button class="btn btn-outline terc-card-btn" data-accion="ver" data-id="${p.id}">
          👁 Ver detalle
        </button>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  LISTA — GERENCIA
// ══════════════════════════════════════════════════════════════════════════════

function renderListaGerencia() {
  const content = $('terc-content');
  if (!content) return;

  const todos = M.pedidos;

  content.innerHTML = `

    <!-- KPIs -->
    <div class="terc-kpis">
      ${kpi(todos.length, 'Total pedidos', '📦', '')}
      ${kpi(todos.filter(p=>p.estado==='pendiente_preparacion').length, 'Pend. preparación', '🕐', 'kpi-naranja')}
      ${kpi(todos.filter(p=>['preparado_completo','preparado_incompleto'].includes(p.estado)).length, 'Preparados', '⚙️', 'kpi-azul')}
      ${kpi(todos.filter(p=>p.estado==='enviado').length, 'Enviados', '🚚', 'kpi-cyan')}
      ${kpi(todos.filter(p=>p.estado==='pendiente_completar').length, 'Pend. completar', '📭', 'kpi-naranja')}
      ${kpi(todos.filter(p=>p.estado==='con_fallas').length, 'Con fallas', '❌', 'kpi-rojo')}
      ${kpi(todos.filter(p=>p.estado==='cerrado').length, 'Cerrados', '✅', 'kpi-verde')}
    </div>

    <!-- Filtro -->
    <div class="terc-toolbar">
      <label class="terc-lbl">Filtrar por estado:</label>
      <select id="terc-filtro-ger" class="terc-select">
        <option value="">Todos los estados</option>
        <option value="pendiente_preparacion">Pendiente preparación</option>
        <option value="preparado_completo">Preparado completo</option>
        <option value="preparado_incompleto">Preparado incompleto</option>
        <option value="enviado">Enviado</option>
        <option value="pendiente_completar">Pendiente completar</option>
        <option value="con_fallas">Con fallas</option>
        <option value="cerrado">Cerrado</option>
      </select>
      <span id="terc-ger-count" class="terc-count-badge">${todos.length} registros</span>
    </div>

    <!-- Tabla completa -->
    <div class="terc-panel" style="margin-top:14px;">
      <div class="terc-table-wrap">
        <table class="terc-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Creado por</th>
              <th>Ítems</th>
              <th>Estado</th>
              <th>Preparado por</th>
              <th>Chofer</th>
              <th>Salida</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="terc-tbody-ger"></tbody>
        </table>
      </div>
    </div>
  `;

  renderTablaGerencia(todos);

  $('terc-filtro-ger')?.addEventListener('change', e => {
    const v = e.target.value;
    const filt = v ? todos.filter(p => p.estado === v) : todos;
    const cnt = $('terc-ger-count');
    if (cnt) cnt.textContent = filt.length + ' registros';
    renderTablaGerencia(filt);
  });
}

function renderTablaGerencia(lista) {
  const tbody = $('terc-tbody-ger');
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="terc-td-empty">Sin pedidos para mostrar.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((p, i) => {
    const acciones = [`<button class="terc-btn-icon" data-accion="ver" data-id="${p.id}" title="Ver">👁</button>`];
    if (p.estado === 'pendiente_preparacion')
      acciones.push(`<button class="terc-btn-sm terc-btn-primary" data-accion="preparar" data-id="${p.id}">⚙️ Preparar</button>`);
    if (['preparado_completo','preparado_incompleto'].includes(p.estado))
      acciones.push(`<button class="terc-btn-sm terc-btn-cyan" data-accion="salida" data-id="${p.id}">🚚 Salida</button>`);
    if (['enviado','pendiente_completar','con_fallas'].includes(p.estado))
      acciones.push(`<button class="terc-btn-sm terc-btn-verde" data-accion="ingreso" data-id="${p.id}">📥 Ingreso</button>`);

    return `
      <tr>
        <td><span class="terc-num">${lista.length - i}</span></td>
        <td>${fmtFecha(p.fecha_creacion)}</td>
        <td>${p.usuario_creador_nombre||p.usuario_creador||'—'}</td>
        <td>${(p.items||[]).length}</td>
        <td>${badge(p.estado)}</td>
        <td>${p.usuario_preparacion_nombre||'—'}</td>
        <td>${p.chofer||'—'}</td>
        <td>${p.fecha_salida ? `${p.fecha_salida} ${p.hora_salida||''}` : '—'}</td>
        <td><div class="terc-td-acciones">${acciones.join('')}</div></td>
      </tr>`;
  }).join('');

  $$('[data-accion]', tbody).forEach(btn =>
    btn.addEventListener('click', () => irDetalle(btn.dataset.id, btn.dataset.accion)));
}

// ─── Helper KPI ───────────────────────────────────────────────────────────────
function kpi(val, label, icon, cls) {
  return `
    <div class="terc-kpi ${cls}">
      <div class="terc-kpi-icon">${icon}</div>
      <div class="terc-kpi-val">${val}</div>
      <div class="terc-kpi-lbl">${label}</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  NUEVO PEDIDO  (Morón / Gerencia)
// ══════════════════════════════════════════════════════════════════════════════

function renderNuevo() {
  const content = $('terc-content');
  if (!content) return;

  if (!M.productos.length) {
    content.innerHTML = `
      <div class="terc-empty-state">
        <div class="terc-empty-icon">📦</div>
        <div>No hay productos activos cargados en el sistema.</div>
      </div>`;
    return;
  }

  const categorias = [...new Set(M.productos.map(p => p.categoria || 'Sin categoría'))].sort();

  const filas = categorias.map(cat => {
    const prods = M.productos.filter(p => (p.categoria || 'Sin categoría') === cat);
    return `
      <tr class="terc-cat-row"><td colspan="3">📂 ${cat}</td></tr>
      ${prods.map(p => `
        <tr>
          <td>${p.nombre||p.id}</td>
          <td class="terc-td-num">
            <input type="number" min="0"
              class="terc-inp-num terc-np-cant"
              data-id="${p.id}"
              data-nombre="${(p.nombre||p.id).replace(/"/g,'&quot;')}"
              placeholder="0" />
          </td>
          <td>
            <input type="text"
              class="terc-inp terc-np-obs"
              data-id="${p.id}"
              placeholder="Observación…" />
          </td>
        </tr>`).join('')}`;
  }).join('');

  content.innerHTML = `
    <div class="terc-panel">

      <div class="terc-panel-header">
        <div class="terc-panel-title">➕ Nuevo pedido de tercerizados</div>
      </div>

      <div class="terc-panel-body">

        <div class="terc-field">
          <label class="terc-lbl">Observación general <span class="terc-optional">(opcional)</span></label>
          <input id="terc-obs-gral" type="text" class="terc-inp"
            placeholder="Ej: urgente, para esta semana, envío especial…" style="max-width:540px;" />
        </div>

        <div class="terc-hint">
          💡 Cargá solo los productos que necesitás. Los que queden en 0 o vacío se ignoran.
        </div>

        <div class="terc-table-wrap" style="margin-top:16px;">
          <table class="terc-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th style="width:140px;text-align:center">Cantidad solicitada</th>
                <th>Observación del ítem</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>

        <div class="terc-form-footer">
          <button id="terc-btn-guardar" class="btn btn-primary" style="min-width:180px;">
            💾 Guardar pedido
          </button>
          <button id="terc-btn-cancelar" class="btn btn-outline">Cancelar</button>
        </div>

      </div>
    </div>
  `;

  $('terc-btn-cancelar')?.addEventListener('click', () => {
    $$('.terc-tab').forEach(b => b.classList.toggle('active', b.dataset.view === 'lista'));
    M.vista = 'lista';
    renderLista();
  });

  $('terc-btn-guardar')?.addEventListener('click', guardarPedido);
}

async function guardarPedido() {
  const btn = $('terc-btn-guardar');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const items = [];
    $$('.terc-np-cant').forEach(inp => {
      const cant = parseInt(inp.value) || 0;
      if (cant > 0) {
        const obs = document.querySelector(`.terc-np-obs[data-id="${inp.dataset.id}"]`);
        items.push({
          producto_id:       inp.dataset.id,
          producto_nombre:   inp.dataset.nombre,
          cantidad_solicitada: cant,
          observacion_item:  obs?.value?.trim() || '',
        });
      }
    });

    if (!items.length) {
      toast('Cargá al menos un producto con cantidad mayor a 0.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar pedido'; }
      return;
    }

    await addDoc(collection(db, 'seguimiento_tercerizados'), {
      estado:                 'pendiente_preparacion',
      observacion:            $('terc-obs-gral')?.value?.trim() || '',
      usuario_creador:        M.perfil.email,
      usuario_creador_nombre: M.perfil.nombre || M.perfil.email,
      fecha_creacion:         serverTimestamp(),
      items,
      historial: [{
        tipo:          'creacion',
        fecha:         iso(),
        usuario:       M.perfil.email,
        usuario_nombre:M.perfil.nombre || M.perfil.email,
        detalle:       `Pedido creado con ${items.length} ítem(s).`,
      }],
    });

    toast('✅ Pedido guardado correctamente.', 'ok');
    $$('.terc-tab').forEach(b => b.classList.toggle('active', b.dataset.view === 'lista'));
    M.vista = 'lista';
    renderLista();

  } catch (e) {
    console.error('[Terc] guardarPedido:', e);
    toast('Error al guardar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar pedido'; }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DETALLE  +  ACCIONES
// ══════════════════════════════════════════════════════════════════════════════

function renderDetalle() {
  const content = $('terc-content');
  const p = M.pedido;
  if (!content || !p) return;

  // ── tabla ítems ──
  const itemsHTML = (p.items||[]).map(it => {
    const prep   = it.cantidad_preparada ?? '—';
    const epill  = it.cantidad_preparada !== undefined
      ? (it.cantidad_preparada >= it.cantidad_solicitada
          ? `<span class="terc-badge est-verde" style="font-size:10px">OK</span>`
          : `<span class="terc-badge est-amarillo" style="font-size:10px">INCOMPLETO</span>`)
      : '';

    const ings = (it.ingresos||[]).length
      ? it.ingresos.map((ing, j) => `
          <div class="terc-ing-log">
            <span class="terc-ing-num">Ing.${j+1}</span>
            <span title="OK">✅ ${ing.ok??0}</span>
            <span title="Falladas">❌ ${ing.falladas??0}</span>
            <span title="Faltantes">📭 ${ing.faltantes??0}</span>
            ${ing.motivo_falla ? `<span class="terc-ing-falla">"${ing.motivo_falla}"</span>` : ''}
            <span class="terc-muted">${ing.fecha ? new Date(ing.fecha).toLocaleString('es-AR') : ''}</span>
          </div>`).join('')
      : '<span class="terc-muted">—</span>';

    return `
      <tr>
        <td>${it.producto_nombre||it.producto_id}</td>
        <td class="terc-td-c">${it.cantidad_solicitada}</td>
        <td class="terc-td-c">${prep} ${epill}</td>
        <td class="terc-obs-cell">${it.observacion_item||'—'}</td>
        <td>${ings}</td>
      </tr>`;
  }).join('');

  // ── historial ──
  const histHTML = (p.historial||[]).slice().reverse().map(h => `
    <div class="terc-hist-item">
      <div class="terc-hist-head">
        <span class="terc-hist-tipo">${histLabel(h.tipo)}</span>
        <span class="terc-hist-meta">
          ${h.fecha ? new Date(h.fecha).toLocaleString('es-AR') : '—'}
          · ${h.usuario_nombre||h.usuario||'—'}
        </span>
      </div>
      <div class="terc-hist-detalle">${h.detalle||''}</div>
    </div>`).join('') ||
    `<div class="terc-muted" style="padding:12px 0">Sin historial.</div>`;

  content.innerHTML = `

    <!-- Cabecera del pedido -->
    <div class="terc-panel">
      <div class="terc-panel-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button class="terc-btn-back" id="terc-volver">← Volver</button>
          <div class="terc-panel-title">Detalle del pedido</div>
          ${badge(p.estado)}
        </div>
      </div>

      <div class="terc-panel-body">

        <!-- Meta info -->
        <div class="terc-meta-grid">
          <div class="terc-meta-item">
            <div class="terc-meta-lbl">Creado</div>
            <div class="terc-meta-val">${fmt(p.fecha_creacion)}</div>
          </div>
          <div class="terc-meta-item">
            <div class="terc-meta-lbl">Creado por</div>
            <div class="terc-meta-val">${p.usuario_creador_nombre||p.usuario_creador||'—'}</div>
          </div>
          <div class="terc-meta-item">
            <div class="terc-meta-lbl">Observación</div>
            <div class="terc-meta-val">${p.observacion||'—'}</div>
          </div>
          ${p.usuario_preparacion_nombre ? `
          <div class="terc-meta-item">
            <div class="terc-meta-lbl">Preparado por</div>
            <div class="terc-meta-val">${p.usuario_preparacion_nombre}</div>
          </div>` : ''}
          ${p.chofer ? `
          <div class="terc-meta-item">
            <div class="terc-meta-lbl">Chofer</div>
            <div class="terc-meta-val">${p.chofer}</div>
          </div>` : ''}
          ${p.fecha_salida ? `
          <div class="terc-meta-item">
            <div class="terc-meta-lbl">Fecha/hora salida</div>
            <div class="terc-meta-val">${p.fecha_salida} ${p.hora_salida||''}</div>
          </div>` : ''}
          ${p.usuario_salida_nombre ? `
          <div class="terc-meta-item">
            <div class="terc-meta-lbl">Registró salida</div>
            <div class="terc-meta-val">${p.usuario_salida_nombre}</div>
          </div>` : ''}
        </div>

        <!-- Tabla ítems -->
        <div class="terc-table-wrap" style="margin-top:20px;">
          <table class="terc-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th style="text-align:center">Solicitado</th>
                <th style="text-align:center">Preparado</th>
                <th>Observación</th>
                <th>Ingresos recibidos</th>
              </tr>
            </thead>
            <tbody>${itemsHTML}</tbody>
          </table>
        </div>

      </div>
    </div>

    <!-- Panel de acción -->
    <div id="terc-panel-accion" class="terc-panel" style="margin-top:20px;"></div>

    <!-- Historial -->
    <div class="terc-panel" style="margin-top:20px;">
      <div class="terc-panel-header">
        <div class="terc-panel-title">📋 Historial de movimientos</div>
      </div>
      <div class="terc-panel-body">
        <div class="terc-hist-list">${histHTML}</div>
      </div>
    </div>

  `;

  $('terc-volver')?.addEventListener('click', volver);

  // montar acción
  const panelAccion = $('terc-panel-accion');
  const accion = (M.accion === 'ver' ? null : M.accion) || inferirAccion(p);

  if (accion === 'preparar')      mountPreparar(p, panelAccion);
  else if (accion === 'salida')   mountSalida(p, panelAccion);
  else if (accion === 'ingreso')  mountIngreso(p, panelAccion);
  else {
    panelAccion.innerHTML = `
      <div class="terc-panel-header"><div class="terc-panel-title">ℹ️ Estado actual</div></div>
      <div class="terc-panel-body">
        <div class="terc-empty-inline">
          ${p.estado === 'cerrado'
            ? '✅ Este pedido está cerrado. No hay acciones pendientes.'
            : 'No hay acciones disponibles para este estado con tu rol.'}
        </div>
      </div>`;
  }
}

function inferirAccion(p) {
  const rol = M.perfil.rol;
  if ((rol === 'control_calidad' || rol === 'gerencia') && p.estado === 'pendiente_preparacion') return 'preparar';
  if ((rol === 'moron' || rol === 'gerencia') && ['preparado_completo','preparado_incompleto'].includes(p.estado)) return 'salida';
  if ((rol === 'moron' || rol === 'gerencia') && ['enviado','pendiente_completar','con_fallas'].includes(p.estado)) return 'ingreso';
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
//  ACCIÓN: PREPARAR
// ══════════════════════════════════════════════════════════════════════════════

function mountPreparar(p, container) {
  const filas = (p.items||[]).map((it, i) => `
    <tr>
      <td><strong>${it.producto_nombre||it.producto_id}</strong></td>
      <td class="terc-td-c">
        <span class="terc-badge est-azul">${it.cantidad_solicitada}</span>
      </td>
      <td class="terc-td-c">
        <input type="number" min="0"
          class="terc-inp-num terc-prep-inp"
          data-idx="${i}" data-sol="${it.cantidad_solicitada}"
          value="${it.cantidad_preparada??''}"
          placeholder="0" />
      </td>
      <td class="terc-td-c" id="terc-ep-${i}">—</td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="terc-panel-header">
      <div class="terc-panel-title">⚙️ Preparar pedido</div>
      <span class="terc-rol-badge">Control de Calidad</span>
    </div>
    <div class="terc-panel-body">

      <div class="terc-hint">
        Cargá la cantidad <strong>real preparada</strong> por cada producto.
        El sistema calcula automáticamente si está completo o incompleto.
      </div>

      <div class="terc-table-wrap" style="margin-top:16px;">
        <table class="terc-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th style="text-align:center;width:130px">Solicitado</th>
              <th style="text-align:center;width:140px">Preparado</th>
              <th style="text-align:center;width:130px">Estado</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>

      <div id="terc-prep-resumen" class="terc-resumen" style="display:none;margin-top:16px;"></div>

      <div class="terc-form-footer">
        <button id="terc-btn-prep" class="btn btn-primary" style="min-width:220px;">
          ✅ Confirmar preparación
        </button>
      </div>

    </div>`;

  function actualizarResumen() {
    let ok = 0, inc = 0, sin = 0;
    $$('.terc-prep-inp', container).forEach(inp => {
      const idx  = inp.dataset.idx;
      const sol  = parseInt(inp.dataset.sol) || 0;
      const prep = parseInt(inp.value);
      const el   = $(`terc-ep-${idx}`);
      if (!inp.value || isNaN(prep)) {
        if (el) el.innerHTML = '—'; sin++;
      } else if (prep >= sol) {
        if (el) el.innerHTML = `<span class="terc-badge est-verde">✅ OK</span>`; ok++;
      } else {
        if (el) el.innerHTML = `<span class="terc-badge est-amarillo">⚠️ Incompleto</span>`; inc++;
      }
    });
    const res = $('terc-prep-resumen');
    if (!res) return;
    if (ok || inc) {
      res.style.display = 'flex';
      res.innerHTML = `
        <strong>Resumen:</strong>
        ${ok  ? `<span class="terc-badge est-verde">${ok} completo${ok>1?'s':''}</span>` : ''}
        ${inc ? `<span class="terc-badge est-amarillo">${inc} incompleto${inc>1?'s':''}</span>` : ''}
        ${sin ? `<span class="terc-badge est-gris">${sin} sin cargar</span>` : ''}`;
    } else res.style.display = 'none';
  }

  $$('.terc-prep-inp', container).forEach(inp => inp.addEventListener('input', actualizarResumen));
  $('terc-btn-prep')?.addEventListener('click', () => confirmarPreparacion(p, container));
}

async function confirmarPreparacion(p, container) {
  const btn = $('terc-btn-prep');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const inputs = $$('.terc-prep-inp', container);
    let todosOk = true;
    const items = p.items.map((it, i) => {
      const prep = parseInt(inputs[i]?.value) || 0;
      if (prep < it.cantidad_solicitada) todosOk = false;
      return { ...it, cantidad_preparada: prep };
    });

    const estado = todosOk ? 'preparado_completo' : 'preparado_incompleto';

    await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
      estado,
      items,
      fecha_preparacion:         serverTimestamp(),
      usuario_preparacion:       M.perfil.email,
      usuario_preparacion_nombre:M.perfil.nombre || M.perfil.email,
      historial: [...(p.historial||[]), {
        tipo:          'preparacion',
        fecha:         iso(),
        usuario:       M.perfil.email,
        usuario_nombre:M.perfil.nombre || M.perfil.email,
        detalle:       `Preparación ${todosOk ? 'COMPLETA' : 'INCOMPLETA'} confirmada.`,
      }],
    });

    toast(todosOk ? '✅ Preparación completa confirmada.' : '⚠️ Preparación incompleta registrada.', 'ok');
    volver();
  } catch (e) {
    console.error('[Terc] preparar:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar preparación'; }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ACCIÓN: DAR SALIDA
// ══════════════════════════════════════════════════════════════════════════════

function mountSalida(p, container) {
  const resumen = (p.items||[]).map(it => `
    <div class="terc-salida-item">
      <span>${it.producto_nombre||it.producto_id}</span>
      <span class="terc-badge ${(it.cantidad_preparada??0) >= it.cantidad_solicitada ? 'est-verde' : 'est-amarillo'}">
        Preparado: ${it.cantidad_preparada??'—'} / ${it.cantidad_solicitada}
      </span>
    </div>`).join('');

  container.innerHTML = `
    <div class="terc-panel-header">
      <div class="terc-panel-title">🚚 Dar salida al pedido</div>
      <span class="terc-rol-badge">Morón</span>
    </div>
    <div class="terc-panel-body">

      <div class="terc-salida-resumen">
        <div class="terc-lbl" style="margin-bottom:10px;">Productos que salen:</div>
        ${resumen}
      </div>

      <div class="terc-field" style="margin-top:20px;max-width:400px;">
        <label class="terc-lbl">Nombre del chofer <span style="color:#f87171">*</span></label>
        <input id="terc-chofer" type="text" class="terc-inp"
          placeholder="Ej: Juan García" />
      </div>

      <div class="terc-hint" style="margin-top:14px;">
        📌 Al confirmar se registrará la fecha y hora de salida automáticamente.
      </div>

      <div class="terc-form-footer">
        <button id="terc-btn-salida" class="btn btn-primary" style="min-width:220px;font-size:15px;padding:14px 28px;">
          🚚 CONFIRMAR SALIDA
        </button>
      </div>

    </div>`;

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
      estado:              'enviado',
      chofer,
      fecha_salida:        ahora.toLocaleDateString('es-AR'),
      hora_salida:         ahora.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }),
      usuario_salida:      M.perfil.email,
      usuario_salida_nombre: M.perfil.nombre || M.perfil.email,
      historial: [...(p.historial||[]), {
        tipo:          'salida',
        fecha:         iso(),
        usuario:       M.perfil.email,
        usuario_nombre:M.perfil.nombre || M.perfil.email,
        detalle:       `Salida confirmada. Chofer: ${chofer}.`,
      }],
    });

    toast('🚚 Salida registrada correctamente.', 'ok');
    volver();
  } catch (e) {
    console.error('[Terc] salida:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🚚 CONFIRMAR SALIDA'; }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ACCIÓN: REGISTRAR INGRESO
// ══════════════════════════════════════════════════════════════════════════════

function mountIngreso(p, container) {
  const filas = (p.items||[]).map((it, i) => {
    const prevOk   = (it.ingresos||[]).reduce((s,x) => s+(x.ok??0), 0);
    const prevFall = (it.ingresos||[]).reduce((s,x) => s+(x.falladas??0), 0);
    const prevFalt = (it.ingresos||[]).reduce((s,x) => s+(x.faltantes??0), 0);
    const prep     = it.cantidad_preparada ?? it.cantidad_solicitada;
    const pendiente= Math.max(0, prep - prevOk - prevFall - prevFalt);

    return `
      <tr>
        <td><strong>${it.producto_nombre||it.producto_id}</strong></td>
        <td class="terc-td-c">${it.cantidad_solicitada}</td>
        <td class="terc-td-c">${prep}</td>
        <td class="terc-td-c terc-val-ok">${prevOk}</td>
        <td class="terc-td-c terc-val-pend ${pendiente > 0 ? 'terc-pend-warn' : ''}">${pendiente}</td>
        <td class="terc-td-c">
          <input type="number" min="0" class="terc-inp-num terc-ing-ok"   data-idx="${i}" placeholder="0"/>
        </td>
        <td class="terc-td-c">
          <input type="number" min="0" class="terc-inp-num terc-ing-fall" data-idx="${i}" placeholder="0"/>
        </td>
        <td class="terc-td-c">
          <input type="number" min="0" class="terc-inp-num terc-ing-falt" data-idx="${i}" placeholder="0"/>
        </td>
        <td>
          <input type="text" class="terc-inp terc-ing-motivo"
            data-idx="${i}" placeholder="Motivo falla…"
            style="min-width:150px;font-size:13px;padding:7px 10px;"/>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="terc-panel-header">
      <div class="terc-panel-title">📥 Registrar ingreso</div>
      <span class="terc-rol-badge">Morón</span>
    </div>
    <div class="terc-panel-body">

      <div class="terc-hint">
        📌 Cargá las cantidades de <strong>este ingreso parcial</strong>.
        Podés hacer múltiples ingresos hasta completar el pedido.
        El motivo es <strong>obligatorio</strong> si hay unidades falladas.
      </div>

      <div class="terc-table-wrap" style="margin-top:16px;overflow-x:auto;">
        <table class="terc-table" style="min-width:860px;">
          <thead>
            <tr>
              <th>Producto</th>
              <th style="text-align:center">Solicitado</th>
              <th style="text-align:center">Preparado</th>
              <th style="text-align:center;color:#34d399">✅ Recibido</th>
              <th style="text-align:center;color:#f59e0b">⏳ Pendiente</th>
              <th style="text-align:center">✅ OK hoy</th>
              <th style="text-align:center">❌ Falladas</th>
              <th style="text-align:center">📭 Faltantes</th>
              <th>Motivo falla</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>

      <div class="terc-form-footer">
        <button id="terc-btn-ingreso" class="btn btn-primary" style="min-width:220px;font-size:15px;padding:14px 28px;">
          📥 CONFIRMAR INGRESO
        </button>
      </div>

    </div>`;

  $('terc-btn-ingreso')?.addEventListener('click', () => confirmarIngreso(p));
}

async function confirmarIngreso(p) {
  const btn = $('terc-btn-ingreso');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    // Validación motivo
    const falls   = $$('.terc-ing-fall');
    const motivos = $$('.terc-ing-motivo');
    let faltaMotivo = false;
    falls.forEach((inp, i) => {
      if ((parseInt(inp.value)||0) > 0 && !motivos[i]?.value?.trim()) faltaMotivo = true;
    });
    if (faltaMotivo) {
      toast('El motivo de falla es obligatorio cuando hay unidades falladas.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📥 CONFIRMAR INGRESO'; }
      return;
    }

    const oks    = $$('.terc-ing-ok');
    const falts  = $$('.terc-ing-falt');
    let algunoCargado = false;
    let hayFallas = false;

    const itemsUpd = p.items.map((it, i) => {
      const ok      = parseInt(oks[i]?.value)   || 0;
      const falladas= parseInt(falls[i]?.value) || 0;
      const faltantes=parseInt(falts[i]?.value) || 0;
      const motivo  = motivos[i]?.value?.trim() || '';

      if (ok || falladas || faltantes) algunoCargado = true;
      if (falladas) hayFallas = true;

      return {
        ...it,
        ingresos: [...(it.ingresos||[]), {
          ok, falladas, faltantes,
          motivo_falla: motivo,
          fecha: iso(),
        }],
      };
    });

    if (!algunoCargado) {
      toast('Cargá al menos un valor en este ingreso.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📥 CONFIRMAR INGRESO'; }
      return;
    }

    // Calcular estado
    let todosCompletos = true;
    itemsUpd.forEach(it => {
      const prep  = it.cantidad_preparada ?? it.cantidad_solicitada;
      const total = (it.ingresos||[]).reduce((s,x) => s+(x.ok??0)+(x.falladas??0)+(x.faltantes??0), 0);
      if (total < prep) todosCompletos = false;
    });

    let nuevoEstado;
    if (todosCompletos) nuevoEstado = hayFallas ? 'con_fallas' : 'cerrado';
    else                nuevoEstado = hayFallas ? 'con_fallas' : 'pendiente_completar';

    const hist = {
      tipo:          nuevoEstado === 'cerrado' ? 'cierre' : 'ingreso',
      fecha:         iso(),
      usuario:       M.perfil.email,
      usuario_nombre:M.perfil.nombre || M.perfil.email,
      detalle:       nuevoEstado === 'cerrado'
        ? 'Pedido cerrado. Todas las unidades recibidas correctamente.'
        : `Ingreso parcial registrado. Estado: ${nuevoEstado}.`,
    };

    await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
      estado: nuevoEstado,
      items:  itemsUpd,
      historial: [...(p.historial||[]), hist],
    });

    const msgs = {
      cerrado:             '✅ ¡Pedido cerrado! Todo recibido correctamente.',
      pendiente_completar: '⚠️ Ingreso registrado. Quedan unidades pendientes.',
      con_fallas:          '❌ Ingreso registrado. Se detectaron fallas.',
    };
    toast(msgs[nuevoEstado] || 'Ingreso guardado.', nuevoEstado === 'cerrado' ? 'ok' : 'info');
    volver();

  } catch (e) {
    console.error('[Terc] ingreso:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📥 CONFIRMAR INGRESO'; }
  }
}
