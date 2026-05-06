/**
 * ============================================================
 *  SEGUIMIENTO DE TERCERIZADOS — v3
 *  js/modules/tercerizados/tercerizados.js
 *
 *  NUEVO FLUJO:
 *  1. MORÓN crea pedido con renglones (materia prima + cantidad)
 *  2. Por cada renglón:
 *     - MORÓN marca ✅ "Armado" (check_moron) → registra fecha/hora/usuario
 *     - PLANIFICACIÓN/CQ marca ✅ "Validado" (check_validador) → registra fecha/hora
 *     - Cuando TODOS tienen ambos checks → estado: listo_para_envio
 *  3. MORÓN envía al tercerizado asignado → estado: enviado_tercerizado
 *  4. TERCERIZADO ve el pedido:
 *     → botón RECIBIDO → registra fecha/hora
 *     → botón ENTREGADO → registra fecha/hora
 *     → ambas fechas se muestran debajo del botón
 *  5. MORÓN registra ingreso por renglón:
 *     - Cantidad OK | Falladas | Devoluciones
 *     - Si falladas ≠ devoluciones → celda en rojo
 *     - Campo observación para explicar diferencia
 *     - Suma global de fallas acumuladas
 *  6. Estado final:
 *     - Sin fallas → cerrado
 *     - Con fallas → con_fallas
 *
 *  ROLES:
 *    moron           → crear · checks armado · enviar · registrar ingreso
 *    control_calidad → checks validador
 *    planificacion   → checks validador
 *    tercerizado     → recibir · entregar
 *    gerencia        → todo + reporte fallas
 *
 *  CÓMO AGREGAR UN TERCERIZADO EN FIREBASE:
 *  En Firestore → colección "usuarios" → nuevo documento:
 *    email:    "tercerizado1@empresa.com"
 *    nombre:   "Nombre del Tercerizado"
 *    rol:      "tercerizado"
 *    activo:   true
 *  Luego en Firebase Auth → crear usuario con ese email y contraseña.
 * ============================================================
 */

import { db } from '../../firebase-config.js';
import {
  collection, addDoc, getDocs, doc, updateDoc,
  query, orderBy, where, serverTimestamp, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ─── HELPERS ──────────────────────────────────────────────────────────────── */

const $  = (id)  => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

function fmt(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' }) + ' ' +
         d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
}

function fmtFecha(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function nowStr() {
  return new Date().toLocaleString('es-AR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}

function iso() { return new Date().toISOString(); }

function toast(msg, tipo = 'info') {
  const el = $('terc-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `terc-toast terc-toast-${tipo} terc-toast-show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('terc-toast-show'), 4000);
}

/* ─── ESTADOS ──────────────────────────────────────────────────────────────── */

const ESTADOS = {
  en_armado:             { label: 'En armado',                cls: 'est-naranja', icon: '🔧' },
  listo_para_envio:      { label: 'Listo para envío',         cls: 'est-azul',    icon: '✅' },
  enviado_tercerizado:   { label: 'Enviado a tercerizado',    cls: 'est-cyan',    icon: '🚚' },
  recibido_tercerizado:  { label: 'Recibido por tercerizado', cls: 'est-purple',  icon: '📬' },
  entregado_tercerizado: { label: 'Entregado a Morón',        cls: 'est-verde-cl',icon: '📦' },
  cerrado:               { label: 'Cerrado',                  cls: 'est-verde',   icon: '🏁' },
  con_fallas:            { label: 'Con fallas',               cls: 'est-rojo',    icon: '❌' },
};

function badge(estado) {
  const e = ESTADOS[estado] || { label: estado || '—', cls: 'est-gris', icon: '•' };
  return `<span class="terc-badge ${e.cls}">${e.icon} ${e.label}</span>`;
}

function rolLabel(rol) {
  const m = { gerencia:'Gerencia', moron:'Morón', control_calidad:'Control de Calidad',
              planificacion:'Planificación', tercerizado:'Tercerizado' };
  return m[rol] || rol;
}

/* ─── STATE ────────────────────────────────────────────────────────────────── */

const M = {
  perfil:    null,
  productos: [],
  tercerizados: [],
  pedidos:   [],
  pedido:    null,
  accion:    null,
  vista:     'lista',
  unsub:     null,
};

/* ─── EXPORTS ──────────────────────────────────────────────────────────────── */

export async function initTercerizados(perfil) {
  M.perfil = perfil;
  M.vista  = 'lista';
  M.pedido = null;
  M.accion = null;
  buildShell();
  await Promise.all([cargarProductos(), cargarTercerizados()]);
  suscribirPedidos();
}

export function destroyTercerizados() {
  if (M.unsub) { M.unsub(); M.unsub = null; }
}

/* ─── FIRESTORE ────────────────────────────────────────────────────────────── */

async function cargarProductos() {
  try {
    const snap = await getDocs(collection(db, 'productos'));
    M.productos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.activo !== false)
      .sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999));
  } catch (e) { console.error('[Terc] productos:', e); }
}

async function cargarTercerizados() {
  try {
    const snap = await getDocs(
      query(collection(db, 'usuarios'), where('rol', '==', 'tercerizado'))
    );
    M.tercerizados = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.activo !== false);
  } catch (e) { console.error('[Terc] tercerizados:', e); }
}

function suscribirPedidos() {
  if (M.unsub) M.unsub();
  const q = query(collection(db, 'seguimiento_tercerizados'), orderBy('fecha_creacion', 'desc'));
  M.unsub = onSnapshot(q, snap => {
    M.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (M.pedido) {
      const fresco = M.pedidos.find(p => p.id === M.pedido.id);
      if (fresco) M.pedido = fresco;
    }
    renderVista();
  }, e => console.error('[Terc] stream:', e));
}

/* ─── SHELL ────────────────────────────────────────────────────────────────── */

function buildShell() {
  const root = $('terc-root');
  if (!root) return;

  const rol       = M.perfil.rol;
  const puedeCrear = ['moron', 'gerencia'].includes(rol);
  const esGerencia = rol === 'gerencia';

  const tabListaLabel = {
    moron:           'Mis pedidos',
    control_calidad: 'Para validar',
    planificacion:   'Para validar',
    tercerizado:     'Mis asignaciones',
    gerencia:        'Todos los pedidos',
  }[rol] || 'Pedidos';

  root.innerHTML = `
    <div id="terc-toast" class="terc-toast"></div>

    <div class="terc-header">
      <div class="terc-header-left">
        <div class="terc-header-icon">🏭</div>
        <div>
          <div class="terc-header-title">Seguimiento de Tercerizados</div>
          <div class="terc-header-sub">Gestión del flujo de producción externa</div>
        </div>
      </div>
      <div class="terc-header-right">
        <span class="terc-rol-badge">${rolLabel(rol)}</span>
        <span class="terc-usuario-badge">👤 ${M.perfil.nombre || M.perfil.email}</span>
      </div>
    </div>

    <div class="terc-tabs" id="terc-tabs">
      <button class="terc-tab active" data-view="lista">📋 ${tabListaLabel}</button>
      ${puedeCrear ? `<button class="terc-tab" data-view="nuevo">➕ Nuevo pedido</button>` : ''}
      ${esGerencia ? `<button class="terc-tab" data-view="fallas">❌ Reporte fallas</button>` : ''}
    </div>

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

/* ─── ROUTER ───────────────────────────────────────────────────────────────── */

function renderVista() {
  if (M.pedido)             { renderDetalle(); return; }
  if (M.vista === 'nuevo')  { renderNuevo();   return; }
  if (M.vista === 'fallas') { renderFallas();  return; }
  renderLista();
}

function irDetalle(id, accion) {
  M.pedido = M.pedidos.find(p => p.id === id) || null;
  M.accion = accion || null;
  renderDetalle();
}

function volver() {
  M.pedido = null;
  M.accion = null;
  $$('.terc-tab').forEach(b => b.classList.toggle('active', b.dataset.view === 'lista'));
  M.vista = 'lista';
  renderLista();
}

/* ─── KPI HELPER ───────────────────────────────────────────────────────────── */

function kpi(val, label, icon, cls) {
  return `<div class="terc-kpi ${cls}">
    <div class="terc-kpi-icon">${icon}</div>
    <div class="terc-kpi-val">${val}</div>
    <div class="terc-kpi-lbl">${label}</div>
  </div>`;
}

/* ─── LISTA ────────────────────────────────────────────────────────────────── */

function renderLista() {
  const rol = M.perfil.rol;
  if (rol === 'tercerizado')                           renderListaTercerizado();
  else if (rol === 'control_calidad' || rol === 'planificacion') renderListaValidador();
  else                                                  renderListaGeneral();
}

/* ── LISTA GENERAL (Morón + Gerencia) ─────────────────────────────────────── */

function renderListaGeneral() {
  const c = $('terc-content');
  if (!c) return;
  const todos     = M.pedidos;
  const activos   = todos.filter(p => !['cerrado','con_fallas'].includes(p.estado));
  const cerrados  = todos.filter(p => ['cerrado','con_fallas'].includes(p.estado));

  // Alertas urgentes
  const paraEnviar  = todos.filter(p => p.estado === 'listo_para_envio');
  const paraIngreso = todos.filter(p => p.estado === 'entregado_tercerizado');
  const urgentes    = paraEnviar.length + paraIngreso.length;

  c.innerHTML = `
    ${urgentes > 0 ? `
    <div class="terc-alerta-banner">
      <div class="terc-alerta-icon">🔔</div>
      <div class="terc-alerta-body">
        <div class="terc-alerta-titulo">${urgentes} pedido${urgentes>1?'s requieren':' requiere'} tu atención</div>
        <div class="terc-alerta-sub">
          ${paraEnviar.length > 0 ? `<span class="terc-chip chip-azul">🚚 ${paraEnviar.length} para enviar</span>` : ''}
          ${paraIngreso.length > 0 ? `<span class="terc-chip chip-verde">📥 ${paraIngreso.length} para registrar ingreso</span>` : ''}
        </div>
      </div>
    </div>` : ''}

    <div class="terc-kpis">
      ${kpi(todos.filter(p=>p.estado==='en_armado').length,             'En armado',        '🔧','kpi-naranja')}
      ${kpi(todos.filter(p=>p.estado==='listo_para_envio').length,      'Listo para envío', '✅','kpi-azul')}
      ${kpi(todos.filter(p=>['enviado_tercerizado','recibido_tercerizado'].includes(p.estado)).length, 'En tercerizado','🚚','kpi-cyan')}
      ${kpi(paraIngreso.length,                                          'Para ingreso',     '📥','kpi-purple')}
      ${kpi(todos.filter(p=>p.estado==='con_fallas').length,            'Con fallas',       '❌','kpi-rojo')}
      ${kpi(cerrados.filter(p=>p.estado==='cerrado').length,            'Cerrados',         '🏁','kpi-verde')}
    </div>

    <div class="terc-section-title">
      <span>Pedidos activos</span>
      <span class="terc-count-badge">${activos.length}</span>
    </div>

    ${activos.length === 0
      ? `<div class="terc-empty-state">
           <div class="terc-empty-icon">📭</div>
           <div>No hay pedidos activos.</div>
           ${['moron','gerencia'].includes(M.perfil.rol) ? `<button class="btn btn-primary" onclick="document.querySelector('[data-view=nuevo]').click()">➕ Nuevo pedido</button>` : ''}
         </div>`
      : `<div class="terc-cards-grid" id="terc-cards-activos"></div>`}

    <div class="terc-section-title" style="margin-top:32px;">
      <span>Cerrados / Con fallas</span>
      <span class="terc-count-badge">${cerrados.length}</span>
    </div>

    <div class="terc-panel"><div class="terc-table-wrap">
      <table class="terc-table">
        <thead><tr><th>Fecha</th><th>Renglones</th><th>Tercerizado</th><th>Estado</th><th></th></tr></thead>
        <tbody id="terc-tbody-cerr"></tbody>
      </table>
    </div></div>
  `;

  if (activos.length) {
    const grid = $('terc-cards-activos');
    grid.innerHTML = activos.map(p => cardGeneral(p)).join('');
    $$('[data-accion]', grid).forEach(b => b.addEventListener('click', () => irDetalle(b.dataset.id, b.dataset.accion)));
  }

  const tbody = $('terc-tbody-cerr');
  tbody.innerHTML = cerrados.length
    ? cerrados.map(p => `<tr>
        <td>${fmtFecha(p.fecha_creacion)}</td>
        <td>${(p.renglones||[]).length}</td>
        <td>${p.tercerizado_nombre || '—'}</td>
        <td>${badge(p.estado)}</td>
        <td><button class="terc-btn-icon" data-accion="ver" data-id="${p.id}">👁</button></td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="terc-td-empty">Sin pedidos cerrados.</td></tr>`;
  $$('[data-accion]', tbody).forEach(b => b.addEventListener('click', () => irDetalle(b.dataset.id, 'ver')));
}

function cardGeneral(p) {
  const rengs     = p.renglones || [];
  const ambos     = rengs.filter(r => r.check_moron && r.check_validador).length;
  const urgente   = ['listo_para_envio','entregado_tercerizado'].includes(p.estado);
  const btns      = [];

  if (['en_armado','listo_para_envio'].includes(p.estado))
    btns.push(`<button class="btn btn-primary terc-card-btn" data-accion="checks" data-id="${p.id}">🔧 Ver checks</button>`);
  if (p.estado === 'listo_para_envio')
    btns.push(`<button class="btn terc-btn-cyan terc-card-btn" data-accion="enviar" data-id="${p.id}">🚚 Enviar</button>`);
  if (p.estado === 'entregado_tercerizado')
    btns.push(`<button class="btn terc-btn-verde terc-card-btn" data-accion="ingreso" data-id="${p.id}">📥 Registrar ingreso</button>`);
  btns.push(`<button class="btn btn-outline terc-card-btn" data-accion="ver" data-id="${p.id}">👁 Ver</button>`);

  return `
    <div class="terc-card ${urgente ? 'terc-card-urgente' : ''}">
      <div class="terc-card-head">
        <div>
          <div class="terc-card-fecha">📅 ${fmtFecha(p.fecha_creacion)}</div>
          ${p.tercerizado_nombre ? `<div class="terc-card-sub">🏭 ${p.tercerizado_nombre}</div>` : ''}
        </div>
        ${badge(p.estado)}
      </div>
      <div class="terc-card-chips">
        <span class="terc-chip ${ambos===rengs.length&&rengs.length>0?'chip-verde':'chip-naranja'}">
          ✅ ${ambos}/${rengs.length} renglones confirmados
        </span>
      </div>
      ${p.observacion_general ? `<div class="terc-card-obs">📝 ${p.observacion_general}</div>` : ''}
      <div class="terc-card-actions">${btns.join('')}</div>
    </div>`;
}

/* ── LISTA VALIDADOR ───────────────────────────────────────────────────────── */

function renderListaValidador() {
  const c = $('terc-content');
  if (!c) return;

  const paraValidar = M.pedidos.filter(p =>
    (p.renglones || []).some(r => r.check_moron && !r.check_validador)
  );

  c.innerHTML = `
    ${paraValidar.length > 0
      ? `<div class="terc-alerta-banner terc-alerta-cq">
           <div class="terc-alerta-icon">✔️</div>
           <div class="terc-alerta-body">
             <div class="terc-alerta-titulo">${paraValidar.length} pedido${paraValidar.length>1?'s':''}  con renglones para validar</div>
           </div>
         </div>`
      : `<div class="terc-alerta-banner terc-alerta-ok">
           <div class="terc-alerta-icon">✅</div>
           <div class="terc-alerta-body"><div class="terc-alerta-titulo">¡Todo validado!</div></div>
         </div>`}

    <div class="terc-kpis">
      ${kpi(paraValidar.length, 'Para validar', '🔧','kpi-naranja')}
      ${kpi(M.pedidos.filter(p=>p.estado==='listo_para_envio').length, 'Listos','✅','kpi-azul')}
      ${kpi(M.pedidos.filter(p=>p.estado==='cerrado').length, 'Cerrados','🏁','kpi-verde')}
    </div>

    <div class="terc-section-title">
      <span>Pedidos para validar</span>
      <span class="terc-count-badge terc-count-badge-naranja">${paraValidar.length}</span>
    </div>

    ${paraValidar.length === 0
      ? `<div class="terc-empty-state"><div class="terc-empty-icon">🎉</div><div>Sin renglones pendientes.</div></div>`
      : `<div class="terc-cards-grid" id="terc-cq-cards"></div>`}

    <div class="terc-section-title" style="margin-top:32px;"><span>Historial</span></div>
    <div class="terc-panel"><div class="terc-table-wrap">
      <table class="terc-table">
        <thead><tr><th>Fecha</th><th>Renglones</th><th>Estado</th><th></th></tr></thead>
        <tbody id="terc-cq-hist"></tbody>
      </table>
    </div></div>
  `;

  if (paraValidar.length) {
    const grid = $('terc-cq-cards');
    grid.innerHTML = paraValidar.map(p => {
      const pend = (p.renglones||[]).filter(r => r.check_moron && !r.check_validador).length;
      return `
        <div class="terc-card terc-card-cq">
          <div class="terc-card-head">
            <div>
              <div class="terc-card-fecha">📅 ${fmtFecha(p.fecha_creacion)}</div>
              <div class="terc-card-sub">Por: ${p.usuario_creador_nombre || '—'}</div>
            </div>
            ${badge(p.estado)}
          </div>
          <div class="terc-card-chips">
            <span class="terc-chip chip-naranja">⏳ ${pend} pendiente${pend===1?'':'s'} de validar</span>
          </div>
          <div class="terc-card-actions">
            <button class="btn btn-primary terc-card-btn" data-accion="checks" data-id="${p.id}">✔️ Validar renglones</button>
            <button class="btn btn-outline terc-card-btn" data-accion="ver" data-id="${p.id}">👁 Ver</button>
          </div>
        </div>`;
    }).join('');
    $$('[data-accion]', grid).forEach(b => b.addEventListener('click', () => irDetalle(b.dataset.id, b.dataset.accion)));
  }

  const hist = M.pedidos.filter(p => !paraValidar.find(x => x.id === p.id));
  const tbody = $('terc-cq-hist');
  tbody.innerHTML = hist.length
    ? hist.map(p => `<tr>
        <td>${fmtFecha(p.fecha_creacion)}</td>
        <td>${(p.renglones||[]).length}</td>
        <td>${badge(p.estado)}</td>
        <td><button class="terc-btn-icon" data-accion="ver" data-id="${p.id}">👁</button></td>
      </tr>`).join('')
    : `<tr><td colspan="4" class="terc-td-empty">Sin historial.</td></tr>`;
  $$('[data-accion]', tbody).forEach(b => b.addEventListener('click', () => irDetalle(b.dataset.id, 'ver')));
}

/* ── LISTA TERCERIZADO ─────────────────────────────────────────────────────── */

function renderListaTercerizado() {
  const c = $('terc-content');
  if (!c) return;

  const miEmail = M.perfil.email;
  const misPed  = M.pedidos.filter(p => p.tercerizado_email === miEmail);
  const activos  = misPed.filter(p => !['cerrado','con_fallas'].includes(p.estado));
  const cerrados = misPed.filter(p => ['cerrado','con_fallas'].includes(p.estado));

  c.innerHTML = `
    <div class="terc-kpis">
      ${kpi(misPed.filter(p=>p.estado==='enviado_tercerizado').length,  'Para recibir','📬','kpi-azul')}
      ${kpi(misPed.filter(p=>p.estado==='recibido_tercerizado').length, 'En proceso',  '📦','kpi-cyan')}
      ${kpi(cerrados.length, 'Entregados','✅','kpi-verde')}
    </div>

    <div class="terc-section-title">
      <span>Mis pedidos activos</span>
      <span class="terc-count-badge">${activos.length}</span>
    </div>

    ${activos.length === 0
      ? `<div class="terc-empty-state"><div class="terc-empty-icon">📭</div><div>No tenés pedidos activos.</div></div>`
      : `<div class="terc-cards-grid" id="terc-cards-terc"></div>`}

    <div class="terc-section-title" style="margin-top:32px;">
      <span>Historial</span>
      <span class="terc-count-badge">${cerrados.length}</span>
    </div>
    <div class="terc-panel"><div class="terc-table-wrap">
      <table class="terc-table">
        <thead><tr><th>Fecha</th><th>Renglones</th><th>Recibido</th><th>Entregado</th><th></th></tr></thead>
        <tbody id="terc-tbody-terc"></tbody>
      </table>
    </div></div>
  `;

  if (activos.length) {
    const grid = $('terc-cards-terc');
    grid.innerHTML = activos.map(p => {
      const esEnviado   = p.estado === 'enviado_tercerizado';
      const esRecibido  = p.estado === 'recibido_tercerizado';
      const btns = [];
      if (esEnviado)  btns.push(`<button class="btn btn-primary terc-card-btn" data-accion="terc_recibir" data-id="${p.id}">📬 RECIBIDO</button>`);
      if (esRecibido) btns.push(`<button class="btn terc-btn-verde terc-card-btn" data-accion="terc_entregar" data-id="${p.id}">📦 ENTREGADO A MORÓN</button>`);
      btns.push(`<button class="btn btn-outline terc-card-btn" data-accion="ver" data-id="${p.id}">👁 Ver</button>`);

      return `
        <div class="terc-card ${esEnviado ? 'terc-card-urgente' : ''}">
          <div class="terc-card-head">
            <div>
              <div class="terc-card-fecha">📅 ${fmtFecha(p.fecha_creacion)}</div>
              <div class="terc-card-sub">${(p.renglones||[]).length} renglone${(p.renglones||[]).length===1?'':'s'}</div>
            </div>
            ${badge(p.estado)}
          </div>
          ${p.fecha_recibido ? `
            <div class="terc-ts-registro">
              <span class="terc-ts-label">📬 Recibido:</span>
              <span class="terc-ts-val">${p.fecha_recibido}</span>
            </div>` : ''}
          ${p.fecha_entregado ? `
            <div class="terc-ts-registro">
              <span class="terc-ts-label">📦 Entregado:</span>
              <span class="terc-ts-val">${p.fecha_entregado}</span>
            </div>` : ''}
          ${p.observacion_general ? `<div class="terc-card-obs">📝 ${p.observacion_general}</div>` : ''}
          <div class="terc-card-actions">${btns.join('')}</div>
        </div>`;
    }).join('');
    $$('[data-accion]', grid).forEach(b => b.addEventListener('click', () => irDetalle(b.dataset.id, b.dataset.accion)));
  }

  const tbody = $('terc-tbody-terc');
  tbody.innerHTML = cerrados.length
    ? cerrados.map(p => `<tr>
        <td>${fmtFecha(p.fecha_creacion)}</td>
        <td>${(p.renglones||[]).length}</td>
        <td style="font-size:12px;">${p.fecha_recibido || '—'}</td>
        <td style="font-size:12px;">${p.fecha_entregado || '—'}</td>
        <td><button class="terc-btn-icon" data-accion="ver" data-id="${p.id}">👁</button></td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="terc-td-empty">Sin historial.</td></tr>`;
  $$('[data-accion]', tbody).forEach(b => b.addEventListener('click', () => irDetalle(b.dataset.id, 'ver')));
}

/* ─── NUEVO PEDIDO ─────────────────────────────────────────────────────────── */

function renderNuevo() {
  const c = $('terc-content');
  if (!c) return;

  const cats  = [...new Set(M.productos.map(p => p.categoria || 'Sin categoría'))].sort();
  const optTerc = M.tercerizados.length
    ? M.tercerizados.map(u => `<option value="${u.email}" data-nombre="${u.nombre||u.email}">${u.nombre||u.email}</option>`).join('')
    : `<option value="">— Sin tercerizados cargados —</option>`;

  const filas = cats.map(cat => {
    const prods = M.productos.filter(p => (p.categoria || 'Sin categoría') === cat);
    return `
      <tr class="terc-cat-row"><td colspan="3"><span class="terc-cat-label">📂 ${cat}</span></td></tr>
      ${prods.map(p => `
        <tr>
          <td class="terc-prod-nombre">${p.nombre || p.id}</td>
          <td style="width:130px;">
            <input type="number" min="0" step="0.1"
              class="terc-inp-num terc-reng-cant"
              data-id="${p.id}"
              data-nombre="${(p.nombre||p.id).replace(/"/g,'&quot;')}"
              placeholder="0" />
          </td>
          <td>
            <input type="text" class="terc-inp terc-reng-obs"
              data-id="${p.id}" placeholder="Observación del renglón…" />
          </td>
        </tr>`).join('')}`;
  }).join('');

  c.innerHTML = `
    <div class="terc-panel">
      <div class="terc-panel-header">
        <div class="terc-panel-title">➕ Nuevo pedido de tercerizados</div>
      </div>
      <div class="terc-panel-body">

        <div class="terc-form-grid">
          <div class="terc-field">
            <label class="terc-lbl">Asignar a tercerizado <span class="terc-req">*</span></label>
            <select id="terc-sel-tercerizado" class="terc-select">
              <option value="">— Seleccionar —</option>
              ${optTerc}
            </select>
            ${M.tercerizados.length === 0 ? `
              <div class="terc-hint-small">
                💡 Para agregar tercerizados: en Firestore → colección "usuarios" → nuevo doc con
                <code>rol: "tercerizado"</code>, <code>activo: true</code>, <code>email</code> y <code>nombre</code>.
                Luego en Firebase Auth creá el usuario con ese email.
              </div>` : ''}
          </div>
          <div class="terc-field">
            <label class="terc-lbl">Observación general <span class="terc-opt">(opcional)</span></label>
            <input id="terc-obs-gral" type="text" class="terc-inp"
              placeholder="Ej: urgente, para el viernes…" />
          </div>
        </div>

        <div class="terc-hint" style="margin-top:16px;">
          💡 Completá solo los renglones con cantidad mayor a 0. Los vacíos se ignoran automáticamente.
        </div>

        <div class="terc-table-wrap" style="margin-top:16px;">
          <table class="terc-table">
            <thead>
              <tr>
                <th>Materia prima / Ítem</th>
                <th style="width:130px;text-align:center;">Cantidad</th>
                <th>Observación del renglón</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>

        <div class="terc-form-footer">
          <button id="terc-btn-guardar" class="btn btn-primary terc-btn-lg">💾 Guardar pedido</button>
          <button id="terc-btn-cancelar" class="btn btn-outline">Cancelar</button>
        </div>
      </div>
    </div>
  `;

  $('terc-btn-cancelar')?.addEventListener('click', () => { M.vista='lista'; renderLista(); });
  $('terc-btn-guardar')?.addEventListener('click', guardarPedido);
}

async function guardarPedido() {
  const btn = $('terc-btn-guardar');
  if (btn) { btn.disabled=true; btn.textContent='Guardando…'; }
  try {
    const selTerc    = $('terc-sel-tercerizado');
    const tercEmail  = selTerc?.value?.trim();
    const tercNombre = selTerc?.selectedOptions?.[0]?.dataset?.nombre || tercEmail;

    if (!tercEmail) {
      toast('Seleccioná un tercerizado.', 'error');
      if (btn) { btn.disabled=false; btn.textContent='💾 Guardar pedido'; }
      return;
    }

    const renglones = [];
    $$('.terc-reng-cant').forEach(inp => {
      const cant = parseFloat(inp.value) || 0;
      if (cant <= 0) return;
      const obs = document.querySelector(`.terc-reng-obs[data-id="${inp.dataset.id}"]`);
      renglones.push({
        item_id:     inp.dataset.id,
        item_nombre: inp.dataset.nombre,
        cantidad:    cant,
        observacion: obs?.value?.trim() || '',
        check_moron:            false,
        check_validador:        false,
        fecha_check_moron:      null,
        fecha_check_validador:  null,
        usuario_check_moron:    null,
        usuario_check_validador:null,
      });
    });

    if (!renglones.length) {
      toast('Cargá al menos un renglón con cantidad > 0.', 'error');
      if (btn) { btn.disabled=false; btn.textContent='💾 Guardar pedido'; }
      return;
    }

    await addDoc(collection(db, 'seguimiento_tercerizados'), {
      estado:                 'en_armado',
      observacion_general:    $('terc-obs-gral')?.value?.trim() || '',
      tercerizado_email:      tercEmail,
      tercerizado_nombre:     tercNombre,
      usuario_creador:        M.perfil.email,
      usuario_creador_nombre: M.perfil.nombre || M.perfil.email,
      fecha_creacion:         serverTimestamp(),
      renglones,
      ingresos: [],
      historial: [{
        tipo:          'creacion',
        fecha:         iso(),
        usuario:       M.perfil.email,
        usuario_nombre:M.perfil.nombre || M.perfil.email,
        detalle:       `Pedido creado con ${renglones.length} renglón${renglones.length===1?'':'es'} para ${tercNombre}.`,
      }],
    });

    toast('✅ Pedido guardado correctamente.', 'ok');
    M.vista = 'lista';
    $$('.terc-tab').forEach(b => b.classList.toggle('active', b.dataset.view==='lista'));
    renderLista();
  } catch (e) {
    console.error('[Terc] guardarPedido:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled=false; btn.textContent='💾 Guardar pedido'; }
  }
}

/* ─── DETALLE ──────────────────────────────────────────────────────────────── */

function renderDetalle() {
  const c = $('terc-content');
  const p = M.pedido;
  if (!c || !p) return;

  const renglones = p.renglones || [];

  // Tabla de renglones con checks
  const rengsHTML = renglones.map((r, i) => {
    const cmF = r.check_moron
      ? `<div class="terc-check-done">✅ ${r.usuario_check_moron||''}<br><span class="terc-check-ts">${r.fecha_check_moron||''}</span></div>`
      : `<div class="terc-check-pend">⏳ Pendiente</div>`;
    const cvF = r.check_validador
      ? `<div class="terc-check-done">✅ ${r.usuario_check_validador||''}<br><span class="terc-check-ts">${r.fecha_check_validador||''}</span></div>`
      : r.check_moron
        ? `<div class="terc-check-pend">⏳ Sin validar</div>`
        : `<div class="terc-check-lock">🔒 Esperando Morón</div>`;
    return `<tr>
      <td class="terc-prod-nombre">${r.item_nombre||r.item_id}</td>
      <td class="terc-td-c">${r.cantidad}</td>
      <td style="background:rgba(251,146,60,.05);">${cmF}</td>
      <td style="background:rgba(110,168,255,.05);">${cvF}</td>
      <td class="terc-obs-cell">${r.observacion||'—'}</td>
    </tr>`;
  }).join('');

  // Tabla de ingresos
  const tieneIngresos = (p.ingresos||[]).length > 0;
  const ingresosHTML = tieneIngresos
    ? (p.ingresos||[]).map((ing, i) => {
        const items = ing.items || [];
        return items.map((it, j) => {
          const diff = (it.falladas||0) - (it.devoluciones||0);
          const hayDiff = diff !== 0;
          return `<tr ${hayDiff ? 'class="terc-fila-falla"' : ''}>
            ${j===0 ? `<td rowspan="${items.length}" class="terc-td-c" style="color:var(--muted);font-size:12px;vertical-align:top;">Ing.${i+1}<br>${ing.fecha?new Date(ing.fecha).toLocaleDateString('es-AR'):'—'}</td>` : ''}
            <td class="terc-prod-nombre">${it.item_nombre||it.item_id||'—'}</td>
            <td class="terc-td-c" style="color:#34d399;font-weight:700;">${it.ok||0}</td>
            <td class="terc-td-c" style="color:#f87171;font-weight:700;">${it.falladas||0}</td>
            <td class="terc-td-c">${it.devoluciones||0}</td>
            <td class="terc-td-c" style="${hayDiff?'color:#f87171;font-weight:700;':'color:#34d399;'}">${hayDiff?'⚠️ '+diff:'✅'}</td>
            <td class="terc-obs-cell">${it.observacion||'—'}</td>
          </tr>`;
        }).join('');
      }).join('')
    : `<tr><td colspan="7" class="terc-td-empty">Sin ingresos registrados.</td></tr>`;

  // Historial
  const histHTML = (p.historial||[]).slice().reverse().map(h => `
    <div class="terc-hist-item">
      <div class="terc-hist-head">
        <span class="terc-hist-tipo">${h.tipo?.replace(/_/g,' ').toUpperCase()||'—'}</span>
        <span class="terc-hist-meta">${h.fecha?new Date(h.fecha).toLocaleString('es-AR'):'—'} · ${h.usuario_nombre||h.usuario||'—'}</span>
      </div>
      <div class="terc-hist-detalle">${h.detalle||''}</div>
    </div>`).join('') || `<div class="terc-muted" style="padding:12px 0;">Sin historial.</div>`;

  c.innerHTML = `
    <div class="terc-panel">
      <div class="terc-panel-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button class="terc-btn-back" id="terc-volver">← Volver</button>
          <div class="terc-panel-title">Detalle del pedido</div>
          ${badge(p.estado)}
        </div>
      </div>
      <div class="terc-panel-body">

        <div class="terc-meta-grid">
          <div class="terc-meta-item"><div class="terc-meta-lbl">Creado</div><div class="terc-meta-val">${fmt(p.fecha_creacion)}</div></div>
          <div class="terc-meta-item"><div class="terc-meta-lbl">Creado por</div><div class="terc-meta-val">${p.usuario_creador_nombre||'—'}</div></div>
          <div class="terc-meta-item"><div class="terc-meta-lbl">Tercerizado</div><div class="terc-meta-val">${p.tercerizado_nombre||'—'}</div></div>
          <div class="terc-meta-item"><div class="terc-meta-lbl">Observación</div><div class="terc-meta-val">${p.observacion_general||'—'}</div></div>
          ${p.fecha_recibido  ? `<div class="terc-meta-item"><div class="terc-meta-lbl">📬 Recibido por tercerizado</div><div class="terc-meta-val" style="color:#2dd4bf;">${p.fecha_recibido}</div></div>` : ''}
          ${p.fecha_entregado ? `<div class="terc-meta-item"><div class="terc-meta-lbl">📦 Entregado a Morón</div><div class="terc-meta-val" style="color:#34d399;">${p.fecha_entregado}</div></div>` : ''}
        </div>

        <div class="terc-section-mini">📋 Renglones y checks</div>
        <div class="terc-table-wrap">
          <table class="terc-table">
            <thead>
              <tr>
                <th>Ítem / Materia prima</th>
                <th style="text-align:center;">Cant.</th>
                <th style="text-align:center;background:rgba(251,146,60,.08);">✅ Check Morón</th>
                <th style="text-align:center;background:rgba(110,168,255,.08);">✅ Check Planificación</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>${rengsHTML}</tbody>
          </table>
        </div>

        ${tieneIngresos || ['cerrado','con_fallas','ingreso_registrado'].includes(p.estado) ? `
        <div class="terc-section-mini" style="margin-top:24px;">📥 Registro de ingresos</div>
        <div class="terc-table-wrap">
          <table class="terc-table">
            <thead>
              <tr>
                <th style="width:80px;">Ingreso</th>
                <th>Ítem</th>
                <th style="text-align:center;color:#34d399;">✅ OK</th>
                <th style="text-align:center;color:#f87171;">❌ Falladas</th>
                <th style="text-align:center;">↩ Dev.</th>
                <th style="text-align:center;">⚠️ Dif.</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>${ingresosHTML}</tbody>
          </table>
        </div>` : ''}

      </div>
    </div>

    <div id="terc-panel-accion" class="terc-panel" style="margin-top:20px;"></div>

    <div class="terc-panel" style="margin-top:20px;">
      <div class="terc-panel-header"><div class="terc-panel-title">📋 Historial</div></div>
      <div class="terc-panel-body"><div class="terc-hist-list">${histHTML}</div></div>
    </div>
  `;

  $('terc-volver')?.addEventListener('click', volver);

  // Montar panel de acción según rol y estado
  const panelAccion = $('terc-panel-accion');
  const accion = (M.accion === 'ver' ? null : M.accion) || inferirAccion(p);

  if      (accion === 'checks')        mountChecks(p, panelAccion);
  else if (accion === 'enviar')        mountEnviar(p, panelAccion);
  else if (accion === 'terc_recibir')  mountTercAction(p, panelAccion, 'recibir');
  else if (accion === 'terc_entregar') mountTercAction(p, panelAccion, 'entregar');
  else if (accion === 'ingreso')       mountIngreso(p, panelAccion);
  else {
    panelAccion.innerHTML = `
      <div class="terc-panel-header"><div class="terc-panel-title">ℹ️ Estado actual</div></div>
      <div class="terc-panel-body">
        <div class="terc-empty-inline">
          ${p.estado==='cerrado' ? '✅ Pedido cerrado correctamente.' :
            p.estado==='con_fallas' ? '⚠️ Pedido con fallas registradas.' :
            'Sin acciones disponibles para tu rol en este estado.'}
        </div>
      </div>`;
  }
}

function inferirAccion(p) {
  const rol  = M.perfil.rol;
  const rens = p.renglones || [];

  const sinCheckMoron  = rens.some(r => !r.check_moron);
  const sinCheckValid  = rens.some(r => r.check_moron && !r.check_validador);

  if ((rol==='moron'||rol==='gerencia') && sinCheckMoron)                    return 'checks';
  if ((rol==='control_calidad'||rol==='planificacion'||rol==='gerencia') && sinCheckValid) return 'checks';
  if ((rol==='moron'||rol==='gerencia') && p.estado==='listo_para_envio')    return 'enviar';
  if (rol==='tercerizado' && p.estado==='enviado_tercerizado')               return 'terc_recibir';
  if (rol==='tercerizado' && p.estado==='recibido_tercerizado')              return 'terc_entregar';
  if ((rol==='moron'||rol==='gerencia') && p.estado==='entregado_tercerizado') return 'ingreso';
  return null;
}

/* ─── CHECKS ───────────────────────────────────────────────────────────────── */

function mountChecks(p, container) {
  const rol     = M.perfil.rol;
  const rengs   = p.renglones || [];
  const esMoron = rol==='moron' || rol==='gerencia';
  const esValid = rol==='control_calidad' || rol==='planificacion' || rol==='gerencia';

  const filas = rengs.map((r, i) => {
    const cmCheck = r.check_moron
      ? `<div class="terc-check-done">✅ ${r.usuario_check_moron}<br><span class="terc-check-ts">${r.fecha_check_moron}</span></div>`
      : esMoron
        ? `<button class="btn terc-btn-orange terc-btn-check" data-idx="${i}" data-tipo="moron">☐ Marcar armado</button>`
        : `<div class="terc-check-pend">⏳ Sin marcar</div>`;

    const cvCheck = r.check_validador
      ? `<div class="terc-check-done">✅ ${r.usuario_check_validador}<br><span class="terc-check-ts">${r.fecha_check_validador}</span></div>`
      : r.check_moron && esValid
        ? `<button class="btn btn-primary terc-btn-check" data-idx="${i}" data-tipo="validador">☐ Marcar validado</button>`
        : r.check_moron
          ? `<div class="terc-check-pend">⏳ Sin validar</div>`
          : `<div class="terc-check-lock">🔒 Esperando Morón</div>`;

    return `<tr>
      <td class="terc-prod-nombre">${r.item_nombre||r.item_id}</td>
      <td class="terc-td-c">${r.cantidad}</td>
      <td style="background:rgba(251,146,60,.06);">${cmCheck}</td>
      <td style="background:rgba(110,168,255,.06);">${cvCheck}</td>
      <td class="terc-obs-cell">${r.observacion||'—'}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="terc-panel-header">
      <div class="terc-panel-title">🔧 Checks de confirmación por renglón</div>
    </div>
    <div class="terc-panel-body">
      <div class="terc-hint">
        <strong>Morón</strong> marca "Armado" cuando preparó el ítem.<br>
        <strong>Planificación / Control de Calidad</strong> marca "Validado" al verificar.<br>
        Cuando todos los renglones tienen ambos checks → el pedido queda <em>listo para envío</em>.
      </div>
      <div class="terc-table-wrap" style="margin-top:16px;">
        <table class="terc-table">
          <thead>
            <tr>
              <th>Ítem</th>
              <th style="text-align:center;">Cant.</th>
              <th style="text-align:center;background:rgba(251,146,60,.08);">✅ Check Morón</th>
              <th style="text-align:center;background:rgba(110,168,255,.08);">✅ Check Planificación / CQ</th>
              <th>Observación</th>
            </tr>
          </thead>
          <tbody id="terc-checks-tbody">${filas}</tbody>
        </table>
      </div>
    </div>`;

  $$('.terc-btn-check', container).forEach(btn => {
    btn.addEventListener('click', () => marcarCheck(p, parseInt(btn.dataset.idx), btn.dataset.tipo));
  });
}

async function marcarCheck(p, idx, tipo) {
  try {
    const renglones = JSON.parse(JSON.stringify(p.renglones || []));
    const r   = renglones[idx];
    if (!r) return;
    const ts  = nowStr();
    const quien = M.perfil.nombre || M.perfil.email;

    if (tipo === 'moron') {
      r.check_moron           = true;
      r.fecha_check_moron     = ts;
      r.usuario_check_moron   = quien;
    } else {
      r.check_validador           = true;
      r.fecha_check_validador     = ts;
      r.usuario_check_validador   = quien;
    }

    const todoAmbos   = renglones.every(rn => rn.check_moron && rn.check_validador);
    const nuevoEstado = todoAmbos ? 'listo_para_envio' : 'en_armado';

    await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
      renglones,
      estado: nuevoEstado,
      historial: [...(p.historial||[]), {
        tipo:          'check',
        fecha:         iso(),
        usuario:       M.perfil.email,
        usuario_nombre:quien,
        detalle:       `Check ${tipo==='moron'?'Morón':'Planificación/CQ'} marcado en renglón ${idx+1}: ${r.item_nombre}.${todoAmbos?' ✅ Pedido listo para envío.':''}`,
      }],
    });

    toast(todoAmbos
      ? '✅ ¡Todos los renglones confirmados! El pedido está listo para envío.'
      : `✅ Check de ${tipo==='moron'?'Morón':'Planificación'} registrado.`, 'ok');
  } catch (e) {
    console.error('[Terc] marcarCheck:', e);
    toast('Error: ' + e.message, 'error');
  }
}

/* ─── ENVIAR AL TERCERIZADO ────────────────────────────────────────────────── */

function mountEnviar(p, container) {
  const rens = p.renglones || [];
  container.innerHTML = `
    <div class="terc-panel-header"><div class="terc-panel-title">🚚 Enviar pedido al tercerizado</div></div>
    <div class="terc-panel-body">
      <div class="terc-salida-info">
        <div class="terc-salida-tercerizado">
          🏭 <strong>${p.tercerizado_nombre||'—'}</strong> (${p.tercerizado_email||'—'})
        </div>
        <div style="margin-top:12px;">${rens.map(r => `
          <div class="terc-salida-item">
            <span>${r.item_nombre||r.item_id}</span>
            <span class="terc-badge est-verde">✅ ${r.cantidad}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="terc-hint" style="margin-top:16px;">
        📌 Al confirmar se registra fecha y hora. El tercerizado verá el pedido en su panel.
      </div>
      <div class="terc-form-footer">
        <button id="terc-btn-enviar" class="btn btn-primary terc-btn-lg">🚚 CONFIRMAR ENVÍO</button>
      </div>
    </div>`;

  $('terc-btn-enviar')?.addEventListener('click', async () => {
    const btn = $('terc-btn-enviar');
    if (btn) { btn.disabled=true; btn.textContent='Enviando…'; }
    try {
      const ts = nowStr();
      await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
        estado:             'enviado_tercerizado',
        fecha_envio:        ts,
        usuario_envio:      M.perfil.email,
        historial: [...(p.historial||[]), {
          tipo:'envio', fecha:iso(),
          usuario:M.perfil.email, usuario_nombre:M.perfil.nombre||M.perfil.email,
          detalle:`Pedido enviado al tercerizado ${p.tercerizado_nombre}. Fecha: ${ts}.`,
        }],
      });
      toast('🚚 Pedido enviado al tercerizado.', 'ok');
      volver();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
      if (btn) { btn.disabled=false; btn.textContent='🚚 CONFIRMAR ENVÍO'; }
    }
  });
}

/* ─── TERCERIZADO: RECIBIR / ENTREGAR ─────────────────────────────────────── */

function mountTercAction(p, container, tipo) {
  const esRecibir = tipo === 'recibir';
  const titulo  = esRecibir ? '📬 Confirmar recepción del pedido' : '📦 Confirmar entrega a Morón';
  const btnText = esRecibir ? '📬 CONFIRMAR RECEPCIÓN' : '📦 CONFIRMAR ENTREGA A MORÓN';
  const hint    = esRecibir
    ? 'Al confirmar registrás que recibiste el pedido y comenzás a trabajar en él.'
    : 'Al confirmar registrás que entregaste el trabajo terminado a Morón. Morón podrá registrar el ingreso.';
  const btnId   = 'terc-btn-taction';

  container.innerHTML = `
    <div class="terc-panel-header"><div class="terc-panel-title">${titulo}</div></div>
    <div class="terc-panel-body">
      <div class="terc-hint">${hint}</div>
      <div class="terc-form-footer">
        <button id="${btnId}" class="btn btn-primary terc-btn-lg">${btnText}</button>
      </div>
    </div>`;

  $(btnId)?.addEventListener('click', async () => {
    const btn = $(btnId);
    if (btn) { btn.disabled=true; btn.textContent='Guardando…'; }
    try {
      const ts    = nowStr();
      const campo = esRecibir ? 'recibido' : 'entregado';
      await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
        estado:                               esRecibir ? 'recibido_tercerizado' : 'entregado_tercerizado',
        [`fecha_${campo}`]:                   ts,
        [`usuario_${campo}`]:                 M.perfil.email,
        [`usuario_${campo}_nombre`]:          M.perfil.nombre||M.perfil.email,
        historial: [...(p.historial||[]), {
          tipo:campo, fecha:iso(),
          usuario:M.perfil.email, usuario_nombre:M.perfil.nombre||M.perfil.email,
          detalle:`${esRecibir?'Recepción':'Entrega'} confirmada. Fecha: ${ts}.`,
        }],
      });
      toast(esRecibir ? '📬 Recepción confirmada.' : '📦 Entrega confirmada. Morón puede registrar el ingreso.', 'ok');
      volver();
    } catch (e) {
      toast('Error: ' + e.message, 'error');
      if (btn) { btn.disabled=false; btn.textContent=btnText; }
    }
  });
}

/* ─── INGRESO ──────────────────────────────────────────────────────────────── */

function mountIngreso(p, container) {
  const rens = p.renglones || [];

  const filas = rens.map((r, i) => `
    <tr>
      <td class="terc-prod-nombre">${r.item_nombre||r.item_id}</td>
      <td class="terc-td-c">${r.cantidad}</td>
      <td class="terc-td-c">
        <input type="number" min="0" step="0.1" class="terc-ing-ok"   data-idx="${i}" placeholder="0" style="width:72px;text-align:center;" />
      </td>
      <td class="terc-td-c">
        <input type="number" min="0" step="0.1" class="terc-ing-fall" data-idx="${i}" placeholder="0" style="width:72px;text-align:center;" />
      </td>
      <td class="terc-td-c">
        <input type="number" min="0" step="0.1" class="terc-ing-dev"  data-idx="${i}" placeholder="0" style="width:72px;text-align:center;" />
        <div class="terc-ing-diff" id="terc-diff-${i}"></div>
      </td>
      <td>
        <input type="text" class="terc-ing-obs" data-idx="${i}" placeholder="Observación…" style="min-width:200px;" />
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="terc-panel-header">
      <div class="terc-panel-title">📥 Registrar ingreso de materiales</div>
    </div>
    <div class="terc-panel-body">
      <div class="terc-hint">
        <strong>OK:</strong> cantidad recibida en buen estado. &nbsp;
        <strong>Falladas:</strong> unidades con defecto. &nbsp;
        <strong>Devoluciones:</strong> unidades devueltas (debe coincidir con falladas).<br>
        Si Falladas ≠ Devoluciones → se marcará en rojo. Usá Observación para explicar la diferencia.
      </div>
      <div class="terc-table-wrap" style="margin-top:16px;overflow-x:auto;">
        <table class="terc-table" style="min-width:700px;">
          <thead>
            <tr>
              <th>Ítem</th>
              <th style="text-align:center;">Solicitado</th>
              <th style="text-align:center;color:#34d399;">✅ OK</th>
              <th style="text-align:center;color:#f87171;">❌ Falladas</th>
              <th style="text-align:center;">↩ Devoluciones</th>
              <th>Observación</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="terc-form-footer">
        <button id="terc-btn-ingreso" class="btn btn-primary terc-btn-lg">📥 CONFIRMAR INGRESO</button>
      </div>
    </div>`;

  // Indicador diferencia en tiempo real
  function actualizarDiff(idx) {
    const fall = parseFloat(document.querySelector(`.terc-ing-fall[data-idx="${idx}"]`)?.value) || 0;
    const dev  = parseFloat(document.querySelector(`.terc-ing-dev[data-idx="${idx}"]`)?.value)  || 0;
    const el   = $(`terc-diff-${idx}`);
    if (!el) return;
    const diff = fall - dev;
    el.innerHTML = diff > 0
      ? `<span style="color:#f87171;font-size:11px;font-weight:700;">⚠️ Falta devolver: ${diff}</span>`
      : diff < 0
        ? `<span style="color:#f87171;font-size:11px;font-weight:700;">⚠️ Excede: ${Math.abs(diff)}</span>`
        : fall > 0 ? `<span style="color:#34d399;font-size:11px;">✅ OK</span>` : '';
  }

  $$('.terc-ing-fall, .terc-ing-dev', container).forEach(inp => {
    inp.addEventListener('input', () => actualizarDiff(parseInt(inp.dataset.idx)));
  });

  $('terc-btn-ingreso')?.addEventListener('click', () => confirmarIngreso(p));
}

async function confirmarIngreso(p) {
  const btn = $('terc-btn-ingreso');
  if (btn) { btn.disabled=true; btn.textContent='Guardando…'; }
  try {
    const oks   = [...$$('.terc-ing-ok')];
    const falls = [...$$('.terc-ing-fall')];
    const devs  = [...$$('.terc-ing-dev')];
    const obss  = [...$$('.terc-ing-obs')];

    let algunoCargado = false;
    let hayDiff       = false;
    const ingresoItems = (p.renglones||[]).map((r, i) => {
      const ok   = parseFloat(oks[i]?.value)   || 0;
      const fall = parseFloat(falls[i]?.value) || 0;
      const dev  = parseFloat(devs[i]?.value)  || 0;
      const obs  = obss[i]?.value?.trim()      || '';
      if (ok || fall || dev) algunoCargado = true;
      if (fall !== dev) hayDiff = true;
      return { item_id:r.item_id, item_nombre:r.item_nombre, ok, falladas:fall, devoluciones:dev, observacion:obs };
    });

    if (!algunoCargado) {
      toast('Cargá al menos un valor.', 'error');
      if (btn) { btn.disabled=false; btn.textContent='📥 CONFIRMAR INGRESO'; }
      return;
    }

    const ingresos    = [...(p.ingresos||[]), { items:ingresoItems, fecha:iso(), usuario:M.perfil.email, usuario_nombre:M.perfil.nombre||M.perfil.email }];
    const nuevoEstado = hayDiff ? 'con_fallas' : 'cerrado';

    await updateDoc(doc(db, 'seguimiento_tercerizados', p.id), {
      estado: nuevoEstado,
      ingresos,
      historial: [...(p.historial||[]), {
        tipo:          nuevoEstado==='cerrado' ? 'cierre' : 'ingreso_fallas',
        fecha:         iso(),
        usuario:       M.perfil.email,
        usuario_nombre:M.perfil.nombre||M.perfil.email,
        detalle:       nuevoEstado==='cerrado'
          ? '✅ Ingreso registrado correctamente. Pedido cerrado.'
          : '⚠️ Ingreso registrado con diferencias entre falladas y devoluciones.',
      }],
    });

    toast(nuevoEstado==='cerrado'
      ? '✅ Ingreso confirmado. Pedido cerrado.'
      : '⚠️ Ingreso con fallas registrado. Revisá el reporte de fallas.', nuevoEstado==='cerrado'?'ok':'info');
    volver();
  } catch (e) {
    console.error('[Terc] ingreso:', e);
    toast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled=false; btn.textContent='📥 CONFIRMAR INGRESO'; }
  }
}

/* ─── REPORTE DE FALLAS ────────────────────────────────────────────────────── */

function renderFallas() {
  const c = $('terc-content');
  if (!c) return;

  let totalFall = 0, totalDev = 0;
  const rows = [];

  M.pedidos.forEach(p => {
    (p.ingresos||[]).forEach(ing => {
      (ing.items||[]).forEach(it => {
        const fall = it.falladas  || 0;
        const dev  = it.devoluciones || 0;
        if (fall === 0 && dev === 0) return;
        const diff = fall - dev;
        totalFall += fall;
        totalDev  += dev;
        rows.push({ p, ing, it, diff });
      });
    });
  });

  const conFallas = M.pedidos.filter(p =>
    (p.ingresos||[]).some(ing => (ing.items||[]).some(it => ((it.falladas||0)-(it.devoluciones||0)) !== 0))
  );

  c.innerHTML = `
    <div class="terc-kpis">
      ${kpi(conFallas.length,       'Pedidos con fallas',   '❌', 'kpi-rojo')}
      ${kpi(totalFall,               'Total falladas',       '⚠️', 'kpi-naranja')}
      ${kpi(totalDev,                'Total devueltas',      '↩',  'kpi-azul')}
      ${kpi(totalFall - totalDev,    'Diferencia neta',      '📊', totalFall-totalDev > 0 ? 'kpi-rojo' : 'kpi-verde')}
    </div>

    <div class="terc-panel" style="margin-top:20px;">
      <div class="terc-panel-header"><div class="terc-panel-title">❌ Detalle de fallas acumuladas</div></div>
      <div class="terc-panel-body">
        ${rows.length === 0
          ? `<div class="terc-empty-state"><div class="terc-empty-icon">🎉</div><div>Sin fallas registradas.</div></div>`
          : `<div class="terc-table-wrap">
              <table class="terc-table">
                <thead>
                  <tr>
                    <th>Pedido</th><th>Tercerizado</th><th>Ítem</th>
                    <th style="text-align:center;color:#f87171;">❌ Falladas</th>
                    <th style="text-align:center;">↩ Dev.</th>
                    <th style="text-align:center;">⚠️ Dif.</th>
                    <th>Observación</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(({p, ing, it, diff}) => `
                    <tr ${diff!==0?'class="terc-fila-falla"':''}>
                      <td style="font-size:12px;color:var(--muted);">${fmtFecha(p.fecha_creacion)}</td>
                      <td style="font-size:12px;">${p.tercerizado_nombre||'—'}</td>
                      <td><strong>${it.item_nombre||it.item_id||'—'}</strong></td>
                      <td class="terc-td-c" style="color:#f87171;font-weight:700;">${it.falladas||0}</td>
                      <td class="terc-td-c">${it.devoluciones||0}</td>
                      <td class="terc-td-c" style="${diff!==0?'color:#f87171;font-weight:700;':'color:#34d399;'}">${diff!==0?'⚠️ '+diff:'✅'}</td>
                      <td class="terc-obs-cell">${it.observacion||'—'}</td>
                      <td style="font-size:12px;color:var(--muted);">${ing.fecha?new Date(ing.fecha).toLocaleString('es-AR'):'—'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
      </div>
    </div>
  `;
}
