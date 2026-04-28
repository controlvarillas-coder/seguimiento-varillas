/**
 * ============================================================
 *  MÓDULO: SEGUIMIENTO DE TERCERIZADOS
 *  Archivo: js/modules/tercerizados/tercerizados.js
 *
 *  Roles:
 *    moron         → crea pedido, da salida, registra ingreso
 *    control_calidad → prepara pedido
 *    gerencia      → vista completa de todo
 *
 *  Colecciones Firestore:
 *    seguimiento_tercerizados   (principal)
 *    productos                  (lectura)
 *    usuarios                   (lectura para perfil)
 * ============================================================
 */

import { db, auth } from '../../firebase-config.js';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  onSnapshot,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function fmt(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR');
}

function now() {
  return new Date().toISOString();
}

function toast(msg, type = 'info') {
  const el = $('terc-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'terc-toast terc-toast-' + type + ' terc-toast-show';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('terc-toast-show'), 3500);
}

function estadoPill(estado) {
  const map = {
    pendiente_preparacion: { label: 'Pendiente preparación', cls: 'pill-naranja' },
    preparado_completo:    { label: 'Preparado completo',    cls: 'pill-azul'    },
    preparado_incompleto:  { label: 'Preparado incompleto',  cls: 'pill-amarillo'},
    enviado:               { label: 'Enviado',               cls: 'pill-cyan'    },
    pendiente_completar:   { label: 'Pendiente completar',   cls: 'pill-naranja' },
    con_fallas:            { label: 'Con fallas',            cls: 'pill-rojo'    },
    cerrado:               { label: 'Cerrado',               cls: 'pill-verde'   },
  };
  const s = map[estado] || { label: estado || '—', cls: 'pill-gris' };
  return `<span class="terc-pill ${s.cls}">${s.label}</span>`;
}

// ─── estado del módulo ────────────────────────────────────────────────────────

const terc = {
  perfil: null,        // { rol, nombre, email, ... }
  productos: [],       // lista de productos activos
  pedidos: [],         // lista de pedidos (seguimiento_tercerizados)
  unsubscribe: null,   // listener en tiempo real
  vistaActual: 'lista',  // 'lista' | 'nuevo' | 'detalle'
  pedidoSeleccionado: null,
};

// ─── inicialización pública ───────────────────────────────────────────────────

export async function initTercerizados(perfil) {
  terc.perfil = perfil;
  renderShell();
  await cargarProductos();
  suscribirPedidos();
}

export function destroyTercerizados() {
  if (terc.unsubscribe) {
    terc.unsubscribe();
    terc.unsubscribe = null;
  }
}

// ─── carga de datos ───────────────────────────────────────────────────────────

async function cargarProductos() {
  try {
    const snap = await getDocs(collection(db, 'productos'));
    terc.productos = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.activo !== false)
      .sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || (a.nombre || '').localeCompare(b.nombre || ''));
  } catch (e) {
    console.error('[Tercerizados] Error cargando productos:', e);
  }
}

function suscribirPedidos() {
  if (terc.unsubscribe) terc.unsubscribe();

  const col = collection(db, 'seguimiento_tercerizados');
  let q;

  if (terc.perfil.rol === 'gerencia') {
    q = query(col, orderBy('fecha_creacion', 'desc'));
  } else if (terc.perfil.rol === 'control_calidad') {
    q = query(col, orderBy('fecha_creacion', 'desc'));
  } else {
    // moron: ver todos sus pedidos
    q = query(col, orderBy('fecha_creacion', 'desc'));
  }

  terc.unsubscribe = onSnapshot(q, (snap) => {
    terc.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderVista();
  }, (err) => {
    console.error('[Tercerizados] Error onSnapshot:', err);
  });
}

// ─── shell principal ──────────────────────────────────────────────────────────

function renderShell() {
  const container = $('terc-root');
  if (!container) return;

  container.innerHTML = `
    <div id="terc-toast" class="terc-toast"></div>

    <!-- Header del módulo -->
    <div class="terc-topbar">
      <div class="terc-topbar-left">
        <h2 class="terc-title">📦 Seguimiento de Tercerizados</h2>
        <span class="terc-badge-rol">${labelRol(terc.perfil.rol)}</span>
      </div>
      <div id="terc-topbar-actions"></div>
    </div>

    <!-- Tabs de navegación interna -->
    <div class="terc-tabs" id="terc-tabs">
      <button class="terc-tab active" data-view="lista">Pedidos</button>
      ${puedeCrear() ? '<button class="terc-tab" data-view="nuevo">+ Nuevo pedido</button>' : ''}
    </div>

    <!-- Área de contenido -->
    <div id="terc-content"></div>
  `;

  // Navegación entre tabs
  container.querySelectorAll('.terc-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      terc.vistaActual = btn.dataset.view;
      terc.pedidoSeleccionado = null;
      container.querySelectorAll('.terc-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderVista();
    });
  });
}

function labelRol(rol) {
  const map = { gerencia: 'Gerencia', moron: 'Morón', control_calidad: 'Control de calidad' };
  return map[rol] || rol;
}

function puedeCrear() {
  return ['moron', 'gerencia'].includes(terc.perfil.rol);
}

// ─── enrutador de vista ───────────────────────────────────────────────────────

function renderVista() {
  if (terc.pedidoSeleccionado) {
    renderDetalle(terc.pedidoSeleccionado);
    return;
  }
  if (terc.vistaActual === 'nuevo') {
    renderFormNuevo();
    return;
  }
  renderLista();
}

// ─── VISTA 1: LISTA DE PEDIDOS ────────────────────────────────────────────────

function renderLista() {
  const content = $('terc-content');
  if (!content) return;

  const pedidos = filtrarPedidosPorRol();

  // KPIs rápidos
  const total     = pedidos.length;
  const pendPrep  = pedidos.filter((p) => p.estado === 'pendiente_preparacion').length;
  const enviados  = pedidos.filter((p) => p.estado === 'enviado').length;
  const cerrados  = pedidos.filter((p) => p.estado === 'cerrado').length;
  const conFallas = pedidos.filter((p) => p.estado === 'con_fallas').length;

  content.innerHTML = `
    <!-- KPIs -->
    <div class="terc-kpi-row">
      <div class="terc-kpi">
        <div class="terc-kpi-val">${total}</div>
        <div class="terc-kpi-lbl">Total pedidos</div>
      </div>
      <div class="terc-kpi terc-kpi-naranja">
        <div class="terc-kpi-val">${pendPrep}</div>
        <div class="terc-kpi-lbl">Pendientes preparación</div>
      </div>
      <div class="terc-kpi terc-kpi-cyan">
        <div class="terc-kpi-val">${enviados}</div>
        <div class="terc-kpi-lbl">Enviados</div>
      </div>
      <div class="terc-kpi terc-kpi-rojo">
        <div class="terc-kpi-val">${conFallas}</div>
        <div class="terc-kpi-lbl">Con fallas</div>
      </div>
      <div class="terc-kpi terc-kpi-verde">
        <div class="terc-kpi-val">${cerrados}</div>
        <div class="terc-kpi-lbl">Cerrados</div>
      </div>
    </div>

    <!-- Filtro por estado -->
    <div class="terc-filtros">
      <label class="terc-label">Filtrar por estado:</label>
      <select id="terc-filtro-estado" class="terc-select terc-select-sm">
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

    <!-- Tabla de pedidos -->
    <div class="panel-card mt-20">
      <div class="panel-header">
        <h3>Lista de pedidos</h3>
        <span class="dash-badge">${pedidos.length} registros</span>
      </div>
      <div class="table-wrap">
        <table class="data-table terc-table" id="terc-tabla-pedidos">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Creado por</th>
              <th>Observación</th>
              <th>Estado</th>
              <th>Salida</th>
              <th>Chofer</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="terc-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  renderTbody(pedidos);

  // Filtro en tiempo real
  $('terc-filtro-estado')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const filtrados = val ? pedidos.filter((p) => p.estado === val) : pedidos;
    renderTbody(filtrados);
  });
}

function filtrarPedidosPorRol() {
  const rol = terc.perfil.rol;
  if (rol === 'gerencia') return terc.pedidos;
  if (rol === 'control_calidad') return terc.pedidos;
  // moron: todos (creados por él o no)
  return terc.pedidos;
}

function renderTbody(pedidos) {
  const tbody = $('terc-tbody');
  if (!tbody) return;

  if (!pedidos.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="terc-empty">No hay pedidos registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = pedidos.map((p, i) => {
    const acciones = buildAccionesPill(p);
    return `
      <tr>
        <td><span class="terc-num">${pedidos.length - i}</span></td>
        <td>${fmtDate(p.fecha_creacion)}</td>
        <td>${p.usuario_creador_nombre || p.usuario_creador || '—'}</td>
        <td class="terc-obs">${p.observacion || '—'}</td>
        <td>${estadoPill(p.estado)}</td>
        <td>${p.fecha_salida ? `${p.fecha_salida} ${p.hora_salida || ''}` : '—'}</td>
        <td>${p.chofer || '—'}</td>
        <td><div class="terc-acciones">${acciones}</div></td>
      </tr>
    `;
  }).join('');

  // Botones de acción
  tbody.querySelectorAll('[data-accion]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const accion = btn.dataset.accion;
      const pedido = terc.pedidos.find((p) => p.id === id);
      if (!pedido) return;

      if (accion === 'ver') {
        terc.pedidoSeleccionado = pedido;
        renderDetalle(pedido);
      } else if (accion === 'preparar') {
        terc.pedidoSeleccionado = pedido;
        renderDetalle(pedido, 'preparar');
      } else if (accion === 'salida') {
        terc.pedidoSeleccionado = pedido;
        renderDetalle(pedido, 'salida');
      } else if (accion === 'ingreso') {
        terc.pedidoSeleccionado = pedido;
        renderDetalle(pedido, 'ingreso');
      }
    });
  });
}

function buildAccionesPill(p) {
  const rol = terc.perfil.rol;
  const btns = [];

  // VER siempre disponible
  btns.push(`<button class="btn btn-sm btn-outline" data-accion="ver" data-id="${p.id}">👁 Ver</button>`);

  // CONTROL CALIDAD: preparar pedidos pendientes
  if ((rol === 'control_calidad' || rol === 'gerencia') && p.estado === 'pendiente_preparacion') {
    btns.push(`<button class="btn btn-sm btn-primary" data-accion="preparar" data-id="${p.id}">⚙️ Preparar</button>`);
  }

  // MORON / GERENCIA: dar salida cuando está preparado
  if ((rol === 'moron' || rol === 'gerencia') && (p.estado === 'preparado_completo' || p.estado === 'preparado_incompleto')) {
    btns.push(`<button class="btn btn-sm terc-btn-cyan" data-accion="salida" data-id="${p.id}">🚚 Dar salida</button>`);
  }

  // MORON / GERENCIA: registrar ingreso cuando está enviado o pendiente completar
  if ((rol === 'moron' || rol === 'gerencia') && (p.estado === 'enviado' || p.estado === 'pendiente_completar' || p.estado === 'con_fallas')) {
    btns.push(`<button class="btn btn-sm terc-btn-verde" data-accion="ingreso" data-id="${p.id}">📥 Registrar ingreso</button>`);
  }

  return btns.join('');
}

// ─── VISTA 2: NUEVO PEDIDO ────────────────────────────────────────────────────

function renderFormNuevo() {
  const content = $('terc-content');
  if (!content) return;

  const prods = terc.productos;
  if (!prods.length) {
    content.innerHTML = `<div class="terc-empty-card">No hay productos activos cargados en el sistema.</div>`;
    return;
  }

  const filas = prods.map((p) => `
    <tr>
      <td>${p.nombre || p.id}</td>
      <td>${p.categoria || '—'}</td>
      <td>
        <input
          type="number"
          min="0"
          class="terc-input-num"
          data-prod-id="${p.id}"
          data-prod-nombre="${(p.nombre || p.id).replace(/"/g, '&quot;')}"
          placeholder="0"
        />
      </td>
      <td>
        <input
          type="text"
          class="terc-input-obs"
          data-prod-id="${p.id}"
          placeholder="Observación…"
          style="min-width:140px;"
        />
      </td>
    </tr>
  `).join('');

  content.innerHTML = `
    <div class="panel-card">
      <div class="panel-header">
        <h3>Nuevo pedido de tercerizados</h3>
      </div>

      <div class="terc-field-row" style="margin-bottom:16px;">
        <label class="terc-label">Observación general del pedido</label>
        <input id="terc-obs-general" type="text" class="terc-input" placeholder="Ej: urgente, para esta semana…" />
      </div>

      <div class="hint-box" style="margin-bottom:16px;">
        Cargá las cantidades solicitadas por producto. Dejá en 0 (o vacío) los que no necesitás.
      </div>

      <div class="table-wrap">
        <table class="data-table terc-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Cantidad solicitada</th>
              <th>Observación</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>

      <div class="terc-form-actions" style="margin-top:20px;">
        <button id="terc-btn-guardar-pedido" class="btn btn-primary">💾 Guardar pedido</button>
        <button id="terc-btn-cancelar-nuevo" class="btn btn-outline">Cancelar</button>
      </div>
      <div id="terc-nuevo-feedback" style="margin-top:12px;"></div>
    </div>
  `;

  $('terc-btn-cancelar-nuevo')?.addEventListener('click', () => {
    terc.vistaActual = 'lista';
    $('terc-content').querySelectorAll('.terc-tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('#terc-tabs .terc-tab').forEach((b) => {
      if (b.dataset.view === 'lista') b.classList.add('active');
    });
    renderLista();
  });

  $('terc-btn-guardar-pedido')?.addEventListener('click', guardarNuevoPedido);
}

async function guardarNuevoPedido() {
  const btn = $('terc-btn-guardar-pedido');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const items = [];
    document.querySelectorAll('[data-prod-id].terc-input-num').forEach((input) => {
      const cant = parseInt(input.value) || 0;
      if (cant > 0) {
        const prodId = input.dataset.prodId;
        const obsEl = document.querySelector(`.terc-input-obs[data-prod-id="${prodId}"]`);
        items.push({
          producto_id: prodId,
          producto_nombre: input.dataset.prodNombre,
          cantidad_solicitada: cant,
          observacion_item: obsEl?.value?.trim() || '',
        });
      }
    });

    if (!items.length) {
      toast('Cargá al menos un producto con cantidad mayor a 0.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar pedido'; }
      return;
    }

    const obsGeneral = $('terc-obs-general')?.value?.trim() || '';

    const pedido = {
      estado: 'pendiente_preparacion',
      observacion: obsGeneral,
      usuario_creador: terc.perfil.email,
      usuario_creador_nombre: terc.perfil.nombre || terc.perfil.email,
      fecha_creacion: serverTimestamp(),
      items,
      historial: [
        {
          tipo: 'creacion',
          fecha: now(),
          usuario: terc.perfil.email,
          usuario_nombre: terc.perfil.nombre || terc.perfil.email,
          detalle: `Pedido creado con ${items.length} ítem(s).`,
        }
      ],
    };

    await addDoc(collection(db, 'seguimiento_tercerizados'), pedido);
    toast('¡Pedido guardado correctamente!', 'ok');

    // volver a lista
    terc.vistaActual = 'lista';
    document.querySelectorAll('#terc-tabs .terc-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === 'lista');
    });
    renderLista();

  } catch (e) {
    console.error('[Tercerizados] Error guardando pedido:', e);
    toast('Error al guardar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar pedido'; }
  }
}

// ─── VISTA 3: DETALLE / ACCIONES ─────────────────────────────────────────────

function renderDetalle(pedido, accionDirecta) {
  const content = $('terc-content');
  if (!content) return;

  const histHTML = (pedido.historial || []).slice().reverse().map((h) => `
    <div class="terc-hist-item">
      <div class="terc-hist-header">
        <span class="terc-hist-tipo">${labelHistorial(h.tipo)}</span>
        <span class="terc-hist-fecha">${h.fecha ? new Date(h.fecha).toLocaleString('es-AR') : '—'} · ${h.usuario_nombre || h.usuario || '—'}</span>
      </div>
      <div class="terc-hist-detalle">${h.detalle || ''}</div>
    </div>
  `).join('') || '<div class="terc-empty" style="padding:12px 0">Sin historial.</div>';

  const itemsHTML = (pedido.items || []).map((item) => {
    const prep = item.cantidad_preparada ?? '—';
    const solicitada = item.cantidad_solicitada;
    let estadoPrep = '';
    if (item.cantidad_preparada !== undefined) {
      estadoPrep = item.cantidad_preparada >= solicitada
        ? '<span class="terc-pill pill-verde">COMPLETO</span>'
        : '<span class="terc-pill pill-amarillo">INCOMPLETO</span>';
    }

    const recibidoHTML = (item.ingresos || []).length
      ? item.ingresos.map((ing, i) => `
          <div class="terc-ingreso-row">
            <span>Ingreso ${i + 1} — ✅${ing.ok ?? 0} / ❌${ing.falladas ?? 0} / 📭${ing.faltantes ?? 0}</span>
            ${ing.motivo_falla ? `<span class="terc-falla">${ing.motivo_falla}</span>` : ''}
            <span class="terc-muted">${ing.fecha ? new Date(ing.fecha).toLocaleString('es-AR') : ''}</span>
          </div>
        `).join('')
      : '';

    return `
      <tr>
        <td>${item.producto_nombre || item.producto_id}</td>
        <td class="terc-center">${solicitada}</td>
        <td class="terc-center">${prep} ${estadoPrep}</td>
        <td>${item.observacion_item || '—'}</td>
        <td>${recibidoHTML || '—'}</td>
      </tr>
    `;
  }).join('');

  content.innerHTML = `
    <div class="terc-detalle-grid">

      <!-- Info del pedido -->
      <div class="panel-card">
        <div class="panel-header">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <button id="terc-btn-volver" class="btn btn-sm btn-outline">← Volver</button>
            <h3 style="margin:0;">Detalle del pedido</h3>
            ${estadoPill(pedido.estado)}
          </div>
        </div>

        <div class="terc-meta-grid">
          <div><span class="terc-label">Creado</span><br>${fmt(pedido.fecha_creacion)}</div>
          <div><span class="terc-label">Creado por</span><br>${pedido.usuario_creador_nombre || pedido.usuario_creador || '—'}</div>
          <div><span class="terc-label">Observación</span><br>${pedido.observacion || '—'}</div>
          ${pedido.chofer ? `<div><span class="terc-label">Chofer</span><br>${pedido.chofer}</div>` : ''}
          ${pedido.fecha_salida ? `<div><span class="terc-label">Salida</span><br>${pedido.fecha_salida} ${pedido.hora_salida || ''}</div>` : ''}
          ${pedido.usuario_salida_nombre ? `<div><span class="terc-label">Registró salida</span><br>${pedido.usuario_salida_nombre}</div>` : ''}
        </div>

        <!-- Tabla de ítems -->
        <div class="table-wrap" style="margin-top:18px;">
          <table class="data-table terc-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Solicitado</th>
                <th>Preparado</th>
                <th>Observación</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>${itemsHTML}</tbody>
          </table>
        </div>
      </div>

      <!-- Acciones según rol y estado -->
      <div id="terc-panel-accion" class="panel-card"></div>

      <!-- Historial -->
      <div class="panel-card terc-hist-card">
        <div class="panel-header"><h3>Historial</h3></div>
        <div class="terc-hist-list">${histHTML}</div>
      </div>
    </div>
  `;

  $('terc-btn-volver')?.addEventListener('click', () => {
    terc.pedidoSeleccionado = null;
    renderLista();
  });

  // Renderizar panel de acción según estado y rol
  const panelAccion = $('terc-panel-accion');
  if (panelAccion) {
    const accion = accionDirecta || inferirAccion(pedido);
    switch (accion) {
      case 'preparar':
        renderPanelPreparar(pedido, panelAccion);
        break;
      case 'salida':
        renderPanelSalida(pedido, panelAccion);
        break;
      case 'ingreso':
        renderPanelIngreso(pedido, panelAccion);
        break;
      default:
        panelAccion.innerHTML = `
          <div class="panel-header"><h3>Información</h3></div>
          <div class="terc-empty" style="padding:16px 0;">
            No hay acciones disponibles para este pedido en su estado actual.
          </div>
        `;
    }
  }
}

function inferirAccion(pedido) {
  const rol = terc.perfil.rol;
  if ((rol === 'control_calidad' || rol === 'gerencia') && pedido.estado === 'pendiente_preparacion') return 'preparar';
  if ((rol === 'moron' || rol === 'gerencia') && (pedido.estado === 'preparado_completo' || pedido.estado === 'preparado_incompleto')) return 'salida';
  if ((rol === 'moron' || rol === 'gerencia') && (pedido.estado === 'enviado' || pedido.estado === 'pendiente_completar' || pedido.estado === 'con_fallas')) return 'ingreso';
  return null;
}

function labelHistorial(tipo) {
  const map = {
    creacion: '🆕 Creación',
    preparacion: '⚙️ Preparación',
    salida: '🚚 Salida',
    ingreso: '📥 Ingreso',
    cierre: '✅ Cierre',
  };
  return map[tipo] || tipo;
}

// ─── PANEL PREPARAR ───────────────────────────────────────────────────────────

function renderPanelPreparar(pedido, container) {
  const filas = (pedido.items || []).map((item, i) => `
    <tr>
      <td>${item.producto_nombre || item.producto_id}</td>
      <td class="terc-center"><strong>${item.cantidad_solicitada}</strong></td>
      <td>
        <input
          type="number"
          min="0"
          class="terc-input-num terc-prep-input"
          data-idx="${i}"
          data-solicitada="${item.cantidad_solicitada}"
          value="${item.cantidad_preparada ?? ''}"
          placeholder="0"
        />
      </td>
      <td id="terc-estado-prep-${i}" class="terc-center">—</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="panel-header">
      <h3>⚙️ Cargar preparación</h3>
      <span class="terc-badge-rol">Control de calidad</span>
    </div>

    <div class="hint-box" style="margin-bottom:16px;">
      Cargá la cantidad preparada para cada producto. El sistema determinará automáticamente si está COMPLETO o INCOMPLETO.
    </div>

    <div class="table-wrap">
      <table class="data-table terc-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Solicitado</th>
            <th>Preparado</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div class="terc-form-actions" style="margin-top:20px;">
      <button id="terc-btn-confirmar-prep" class="btn btn-primary">✅ Confirmar preparación</button>
    </div>
    <div id="terc-prep-resumen" style="margin-top:12px;"></div>
  `;

  // Calcular estado en tiempo real
  container.querySelectorAll('.terc-prep-input').forEach((input) => {
    input.addEventListener('input', () => {
      const idx = input.dataset.idx;
      const solicitada = parseInt(input.dataset.solicitada) || 0;
      const preparada = parseInt(input.value) || 0;
      const estadoEl = $(`terc-estado-prep-${idx}`);
      if (estadoEl) {
        if (input.value === '') {
          estadoEl.innerHTML = '—';
        } else if (preparada >= solicitada) {
          estadoEl.innerHTML = '<span class="terc-pill pill-verde">COMPLETO</span>';
        } else {
          estadoEl.innerHTML = '<span class="terc-pill pill-amarillo">INCOMPLETO</span>';
        }
      }
    });
  });

  $('terc-btn-confirmar-prep')?.addEventListener('click', () => confirmarPreparacion(pedido));
}

async function confirmarPreparacion(pedido) {
  const btn = $('terc-btn-confirmar-prep');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const inputs = document.querySelectorAll('.terc-prep-input');
    let todosCompletos = true;
    let algunoIngresado = false;

    const itemsActualizados = pedido.items.map((item, i) => {
      const input = inputs[i];
      const preparada = parseInt(input?.value) || 0;
      algunoIngresado = true;
      if (preparada < item.cantidad_solicitada) todosCompletos = false;
      return { ...item, cantidad_preparada: preparada };
    });

    if (!algunoIngresado) {
      toast('Cargá al menos una cantidad preparada.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar preparación'; }
      return;
    }

    const estadoNuevo = todosCompletos ? 'preparado_completo' : 'preparado_incompleto';
    const histEntry = {
      tipo: 'preparacion',
      fecha: now(),
      usuario: terc.perfil.email,
      usuario_nombre: terc.perfil.nombre || terc.perfil.email,
      detalle: `Preparación confirmada: ${estadoNuevo === 'preparado_completo' ? 'COMPLETO' : 'INCOMPLETO'}`,
    };

    await updateDoc(doc(db, 'seguimiento_tercerizados', pedido.id), {
      estado: estadoNuevo,
      items: itemsActualizados,
      fecha_preparacion: serverTimestamp(),
      usuario_preparacion: terc.perfil.email,
      usuario_preparacion_nombre: terc.perfil.nombre || terc.perfil.email,
      historial: [...(pedido.historial || []), histEntry],
    });

    toast(`Preparación confirmada: ${estadoNuevo === 'preparado_completo' ? 'COMPLETO ✅' : 'INCOMPLETO ⚠️'}`, 'ok');
    terc.pedidoSeleccionado = null;
    renderLista();

  } catch (e) {
    console.error('[Tercerizados] Error preparación:', e);
    toast('Error al guardar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar preparación'; }
  }
}

// ─── PANEL DAR SALIDA ─────────────────────────────────────────────────────────

function renderPanelSalida(pedido, container) {
  container.innerHTML = `
    <div class="panel-header">
      <h3>🚚 Dar salida</h3>
      <span class="terc-badge-rol">Morón</span>
    </div>

    <div class="hint-box" style="margin-bottom:16px;">
      Ingresá el nombre del chofer y confirmá la salida. Se registrará la fecha y hora automáticamente.
    </div>

    <div class="terc-field-row">
      <label class="terc-label">Nombre del chofer *</label>
      <input id="terc-chofer" type="text" class="terc-input" placeholder="Nombre del chofer…" />
    </div>

    <div class="terc-form-actions" style="margin-top:20px;">
      <button id="terc-btn-confirmar-salida" class="btn btn-primary">🚚 DAR SALIDA</button>
    </div>
  `;

  $('terc-btn-confirmar-salida')?.addEventListener('click', () => confirmarSalida(pedido));
}

async function confirmarSalida(pedido) {
  const chofer = $('terc-chofer')?.value?.trim();
  if (!chofer) {
    toast('Ingresá el nombre del chofer.', 'error');
    return;
  }

  const btn = $('terc-btn-confirmar-salida');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const ahora = new Date();
    const fecha_salida = ahora.toLocaleDateString('es-AR');
    const hora_salida = ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    const histEntry = {
      tipo: 'salida',
      fecha: now(),
      usuario: terc.perfil.email,
      usuario_nombre: terc.perfil.nombre || terc.perfil.email,
      detalle: `Salida registrada. Chofer: ${chofer}. ${fecha_salida} ${hora_salida}`,
    };

    await updateDoc(doc(db, 'seguimiento_tercerizados', pedido.id), {
      estado: 'enviado',
      chofer,
      fecha_salida,
      hora_salida,
      usuario_salida: terc.perfil.email,
      usuario_salida_nombre: terc.perfil.nombre || terc.perfil.email,
      historial: [...(pedido.historial || []), histEntry],
    });

    toast('¡Salida registrada correctamente!', 'ok');
    terc.pedidoSeleccionado = null;
    renderLista();

  } catch (e) {
    console.error('[Tercerizados] Error salida:', e);
    toast('Error al guardar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🚚 DAR SALIDA'; }
  }
}

// ─── PANEL REGISTRAR INGRESO ──────────────────────────────────────────────────

function renderPanelIngreso(pedido, container) {
  const filas = (pedido.items || []).map((item, i) => {
    const totalOkPrevio = (item.ingresos || []).reduce((s, ing) => s + (ing.ok ?? 0), 0);
    const totalFallasPrevio = (item.ingresos || []).reduce((s, ing) => s + (ing.falladas ?? 0), 0);
    const totalFaltantesPrevio = (item.ingresos || []).reduce((s, ing) => s + (ing.faltantes ?? 0), 0);
    const pendiente = item.cantidad_preparada !== undefined
      ? Math.max(0, item.cantidad_preparada - totalOkPrevio - totalFallasPrevio - totalFaltantesPrevio)
      : '?';

    return `
      <tr>
        <td>${item.producto_nombre || item.producto_id}</td>
        <td class="terc-center">${item.cantidad_solicitada}</td>
        <td class="terc-center">${item.cantidad_preparada ?? '—'}</td>
        <td class="terc-center">${totalOkPrevio}</td>
        <td class="terc-center" style="color:#f59e0b;">${pendiente}</td>
        <td>
          <input type="number" min="0" class="terc-input-num terc-ing-ok"     data-idx="${i}" placeholder="0" />
        </td>
        <td>
          <input type="number" min="0" class="terc-input-num terc-ing-falla"  data-idx="${i}" placeholder="0" />
        </td>
        <td>
          <input type="number" min="0" class="terc-input-num terc-ing-falt"   data-idx="${i}" placeholder="0" />
        </td>
        <td>
          <input type="text" class="terc-input-motivo" data-idx="${i}" placeholder="Motivo falla…" style="min-width:120px;" />
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="panel-header">
      <h3>📥 Registrar ingreso</h3>
      <span class="terc-badge-rol">Morón</span>
    </div>

    <div class="hint-box" style="margin-bottom:16px;">
      Cargá las cantidades recibidas. Podés hacer múltiples ingresos parciales hasta completar el pedido.
    </div>

    <div class="table-wrap">
      <table class="data-table terc-table" style="min-width:900px;">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Solicitado</th>
            <th>Preparado</th>
            <th>Recibido OK</th>
            <th>Pendiente</th>
            <th>✅ OK este ingreso</th>
            <th>❌ Falladas</th>
            <th>📭 Faltantes</th>
            <th>Motivo falla</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div class="terc-form-actions" style="margin-top:20px;">
      <button id="terc-btn-confirmar-ingreso" class="btn btn-primary">📥 Confirmar ingreso</button>
    </div>
  `;

  $('terc-btn-confirmar-ingreso')?.addEventListener('click', () => confirmarIngreso(pedido));
}

async function confirmarIngreso(pedido) {
  const btn = $('terc-btn-confirmar-ingreso');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const items = pedido.items || [];
    let algunoCargado = false;
    let hayFallas = false;
    let hayFaltantes = false;

    const itemsActualizados = items.map((item, i) => {
      const ok        = parseInt(document.querySelectorAll('.terc-ing-ok')[i]?.value) || 0;
      const falladas  = parseInt(document.querySelectorAll('.terc-ing-falla')[i]?.value) || 0;
      const faltantes = parseInt(document.querySelectorAll('.terc-ing-falt')[i]?.value) || 0;
      const motivo    = document.querySelectorAll('.terc-input-motivo')[i]?.value?.trim() || '';

      if (ok > 0 || falladas > 0 || faltantes > 0) algunoCargado = true;
      if (falladas > 0) hayFallas = true;
      if (faltantes > 0) hayFaltantes = true;

      const nuevoIngreso = { ok, falladas, faltantes, motivo_falla: motivo, fecha: now() };
      const ingresos = [...(item.ingresos || []), nuevoIngreso];

      return { ...item, ingresos };
    });

    if (!algunoCargado) {
      toast('Cargá al menos un valor en este ingreso.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📥 Confirmar ingreso'; }
      return;
    }

    // Calcular estado general
    let estadoNuevo = 'cerrado';
    let todosCerrado = true;

    itemsActualizados.forEach((item) => {
      const preparado = item.cantidad_preparada ?? item.cantidad_solicitada;
      const totalOk = (item.ingresos || []).reduce((s, ing) => s + (ing.ok ?? 0), 0);
      const totalFalladas = (item.ingresos || []).reduce((s, ing) => s + (ing.falladas ?? 0), 0);
      const totalFaltantes = (item.ingresos || []).reduce((s, ing) => s + (ing.faltantes ?? 0), 0);
      const totalRegistrado = totalOk + totalFalladas + totalFaltantes;

      if (totalRegistrado < preparado) todosCerrado = false;
    });

    if (!todosCerrado) {
      if (hayFallas) estadoNuevo = 'con_fallas';
      else estadoNuevo = 'pendiente_completar';
    } else {
      if (hayFallas) estadoNuevo = 'con_fallas';
      else estadoNuevo = 'cerrado';
    }

    const histEntry = {
      tipo: 'ingreso',
      fecha: now(),
      usuario: terc.perfil.email,
      usuario_nombre: terc.perfil.nombre || terc.perfil.email,
      detalle: `Ingreso registrado. Estado resultante: ${estadoNuevo}.`,
    };

    if (estadoNuevo === 'cerrado') {
      histEntry.tipo = 'cierre';
      histEntry.detalle = 'Pedido cerrado correctamente. Todas las unidades recibidas.';
    }

    await updateDoc(doc(db, 'seguimiento_tercerizados', pedido.id), {
      estado: estadoNuevo,
      items: itemsActualizados,
      historial: [...(pedido.historial || []), histEntry],
    });

    const msgEstado = {
      cerrado: '✅ Pedido cerrado. Todas las unidades recibidas correctamente.',
      pendiente_completar: '⚠️ Ingreso registrado. Faltan unidades por recibir.',
      con_fallas: '❌ Ingreso registrado con fallas.',
    };

    toast(msgEstado[estadoNuevo] || 'Ingreso guardado.', estadoNuevo === 'cerrado' ? 'ok' : 'info');
    terc.pedidoSeleccionado = null;
    renderLista();

  } catch (e) {
    console.error('[Tercerizados] Error ingreso:', e);
    toast('Error al guardar: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📥 Confirmar ingreso'; }
  }
}
