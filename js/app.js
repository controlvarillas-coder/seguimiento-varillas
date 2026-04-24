import { auth, db } from './firebase-config.js';
import { computeAlvearMoronAlerts } from './modules/alertas/alertas.service.js';
import { renderGerenciaAlertsPanel, renderGerenciaMenuBadge } from './modules/alertas/alertas.ui.js';
import {
  buildWeeksForMonth,
  getWeekDocId,
  buildDefaultWeeklyRows,
  normalizeWeeklyRows,
  pushWeeklyHistory,
  evaluateWeekCompletion,
  computeProductividadAlvear,
  MOTIVOS_PREDEFINIDOS
} from './modules/pedido-semanal/pedido-semanal.service.js';
import {
  renderWeekOptions,
  renderWeekCalendar,
  renderPedidoSemanalTable,
  renderPedidoSemanalHistory
} from './modules/pedido-semanal/pedido-semanal.ui.js';

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

const MANUAL_INITIAL_MONTH = '2026-04';

const state = {
  currentUser: null,
  perfil: null,
  productos: [],
  usuarios: [],
  reportes: [],
  reporteActual: null,
  alertas: [],
  pedidoSemanas: [],
  pedidoSemanalActual: null,
  pedidoSemanalSelectedRow: null,
  pedidosSemanalesCache: {},
  cargaCategoriaFilter: '',
  cargaAromaFilter: '',
  productoFiltroCategoria: '',
  productoFiltroNombre: '',
  autoSaveTimer: null
};

const FABRICAS = {
  caja_chica: 'Caja chica',
  caja_grande: 'Caja grande',
  neutro: 'Bañado',
  banado: 'Bañado',
  alvear: 'Alvear',
  moron: 'Morón'
};

const DAY_GROUPS = [
  {
    key: 'alvear',
    title: 'ALVEAR',
    colorClass: 'group-alvear',
    columns: [
      { key: 'alv', label: 'ALVEAR ENTRADA' },
      { key: 'total', label: 'ALVEAR TOTAL', readonly: true }
    ]
  },
  {
    key: 'cajaChica',
    title: 'CAJA CHICA',
    colorClass: 'group-caja-chica',
    columns: [
      { key: 'alvPlus', label: 'ALVEAR ENTRADA' },
      { key: 'alvMinus', label: 'ALVEAR SALIDA' },
      { key: 'dif', label: 'ALVEAR DIFERENCIA' },
      { key: 'total', label: 'ALVEAR TOTAL', readonly: true }
    ]
  },
  {
    key: 'cajaGrandeAlv',
    title: 'CAJA GRANDE',
    colorClass: 'group-caja-grande',
    columns: [
      { key: 'alvPlus', label: 'ALVEAR ENTRADA' },
      { key: 'alvMinus', label: 'ALVEAR SALIDA' },
      { key: 'dif', label: 'ALVEAR DIFERENCIA' },
      { key: 'total', label: 'ALVEAR TOTAL', readonly: true }
    ]
  },
  {
    key: 'cajaChicaMor',
    title: 'CAJA CHICA',
    colorClass: 'group-caja-chica-2',
    columns: [
      { key: 'morPlus', label: 'MORÓN ENTRADA' },
      { key: 'morMinus', label: 'MORÓN SALIDA' },
      { key: 'dif', label: 'MORÓN DIFERENCIA' },
      { key: 'total', label: 'MORÓN TOTAL', readonly: true }
    ]
  },
  {
    key: 'cajaGrandeMor',
    title: 'CAJA GRANDE',
    colorClass: 'group-caja-grande-2',
    columns: [
      { key: 'morPlus', label: 'MORÓN ENTRADA' },
      { key: 'morMinus', label: 'MORÓN SALIDA' },
      { key: 'dif', label: 'MORÓN DIFERENCIA' },
      { key: 'total', label: 'MORÓN TOTAL', readonly: true }
    ]
  },
  {
    key: 'banadoChica',
    title: 'BAÑADO CAJA CHICA',
    colorClass: 'group-banado-chica',
    columns: [
      { key: 'banadoPlus', label: 'BAÑADO ENTRADA' },
      { key: 'secando', label: 'SECANDO' },
      { key: 'totalSecando', label: 'TOTAL SECANDO', readonly: true },
      { key: 'cosecha', label: 'COSECHA' },
      { key: 'salida', label: 'BAÑADO SALIDA' },
      { key: 'dif', label: 'BAÑADO DIFERENCIA' },
      { key: 'total', label: 'BAÑADO TOTAL', readonly: true }
    ]
  },
  {
    key: 'banadoGrande',
    title: 'BAÑADO CAJA GRANDE',
    colorClass: 'group-banado-grande',
    columns: [
      { key: 'banadoPlus', label: 'BAÑADO ENTRADA' },
      { key: 'secando', label: 'SECANDO' },
      { key: 'totalSecando', label: 'TOTAL SECANDO', readonly: true },
      { key: 'cosecha', label: 'COSECHA' },
      { key: 'salida', label: 'BAÑADO SALIDA' },
      { key: 'dif', label: 'BAÑADO DIFERENCIA' },
      { key: 'total', label: 'BAÑADO TOTAL', readonly: true }
    ]
  }
];

const MORON_INTERNAL_GROUPS = [
  {
    key: 'moronChicaInterna',
    title: 'CAJA CHICA',
    colorClass: 'group-caja-chica-2',
    columns: [
      { key: 'totalBase', label: 'TOTAL' },
      { key: 'entrada', label: 'ENTRADA' },
      { key: 'sobrante', label: 'SOBRANTE' },
      { key: 'pEmpaq', label: 'P/EMPAQ' },
      { key: 'salidaTotal', label: 'SALIDA TOTAL', readonly: true },
      { key: 'diferencia', label: 'DIFERENCIA' },
      { key: 'fallados', label: 'FALLADOS' },
      { key: 'devoluciones', label: 'DEVOLUCIONES' },
      { key: 'total', label: 'TOTAL', readonly: true }
    ]
  },
  {
    key: 'moronGrandeInterna',
    title: 'CAJA GRANDE',
    colorClass: 'group-caja-grande-2',
    columns: [
      { key: 'totalBase', label: 'TOTAL' },
      { key: 'entrada', label: 'ENTRADA' },
      { key: 'sobrante', label: 'SOBRANTE' },
      { key: 'pEmpaq', label: 'P/EMPAQ' },
      { key: 'salidaTotal', label: 'SALIDA TOTAL', readonly: true },
      { key: 'diferencia', label: 'DIFERENCIA' },
      { key: 'fallados', label: 'FALLADOS' },
      { key: 'devoluciones', label: 'DEVOLUCIONES' },
      { key: 'total', label: 'TOTAL', readonly: true }
    ]
  }
];

const INITIAL_STOCK_COLUMNS = [
  { key: 'alvearChica', label: 'ALVEAR CAJA CHICA' },
  { key: 'alvearGrande', label: 'ALVEAR CAJA GRANDE' },
  { key: 'moronChica', label: 'MORÓN CAJA CHICA' },
  { key: 'moronGrande', label: 'MORÓN CAJA GRANDE' },
  { key: 'secandoChica', label: 'SECANDO CAJA CHICA' },
  { key: 'secandoGrande', label: 'SECANDO CAJA GRANDE' },
  { key: 'banadoChica', label: 'BAÑADO CAJA CHICA' },
  { key: 'banadoGrande', label: 'BAÑADO CAJA GRANDE' }
];

const INPUT_GROUP_BY_FABRICA = {
  caja_chica: ['alvear', 'cajaChica'],
  caja_grande: ['cajaGrandeAlv', 'cajaGrandeMor'],
  banado: ['banadoChica', 'banadoGrande'],
  alvear: ['alvear', 'cajaChica', 'cajaGrandeAlv'],
  moron: ['moronChicaInterna', 'moronGrandeInterna'],
  neutro: []
};

const PEDIDO_FIELDS = {
  MORON_CHICA: 'moronPedidoChica',
  MORON_GRANDE: 'moronPedidoGrande',
  MORON_OBS: 'moronObservacion',
  ALVEAR_DIA: 'alvearDiaProduccion',
  ALVEAR_OBS: 'alvearObservacion',
  GERENCIA_OBS: 'gerenciaObservacion'
};

const els = {
  loginScreen: $('screen-login'),
  appScreen: $('screen-app'),
  loginForm: $('loginForm'),
  logoutBtn: $('logoutBtn'),
  toast: $('toast'),
  menuBtn: $('menuBtn'),
  sidebar: $('sidebar'),
  pageTitle: $('pageTitle')
};

function toast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 3500);
}

function setLoggedUI(logged) {
  if (els.loginScreen) els.loginScreen.classList.toggle('active', !logged);
  if (els.appScreen) els.appScreen.classList.toggle('active', logged);
}

function setSection(sectionId) {
  document.querySelectorAll('.section').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach((el) => {
    el.classList.toggle('active', el.dataset.section === sectionId);
  });

  const target = $(`section-${sectionId}`);
  if (target) target.classList.add('active');

  const titles = {
    dashboard: 'Dashboard',
    productos: 'Productos',
    gerencia: 'Excel gerencia',
    carga: 'Carga diaria',
    usuarios: 'Usuarios',
    'pedido-semanal': 'Orden de fabricación',
    reportes: 'Reportes',
    backup: 'Copia de seguridad'
  };

  if ($('pageTitle')) $('pageTitle').textContent = titles[sectionId] || 'Varillas Control';

  if (sectionId === 'pedido-semanal') {
    refreshPedidoWeeks();
    renderPedidoSemanal();
  }

  if (sectionId === 'reportes') {
    renderReportesFiltros();
  }

  if (sectionId === 'backup') {
    renderBackupPanel();
  }
}

function mountNavigation() {
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSection(btn.dataset.section);
      if (els.sidebar) els.sidebar.classList.remove('open');
    });
  });
}

function applyRoleUI() {
  const isGerencia = state.perfil?.rol === 'gerencia';

  document.querySelectorAll('.gerencia-only').forEach((el) => {
    el.classList.toggle('hidden', !isGerencia);
  });

  const fabricaSelect = $('cargaFabrica');
  if (fabricaSelect) {
    if (!isGerencia && state.perfil?.fabrica) {
      fabricaSelect.value = state.perfil.fabrica;
      fabricaSelect.disabled = true;
    } else {
      fabricaSelect.disabled = false;
    }
  }
}

function fillUserCard() {
  const name = state.perfil?.nombre || state.currentUser?.email || 'Usuario';
  const role = state.perfil?.rol || 'usuario';

  if ($('miniName')) $('miniName').textContent = name;
  if ($('miniRole')) $('miniRole').textContent = role;
  if ($('avatarMini')) $('avatarMini').textContent = name.trim().charAt(0).toUpperCase();
}

async function fetchPerfil(email) {
  const q = query(collection(db, 'usuarios'), where('email', '==', email));
  const snap = await getDocs(q);

  if (snap.empty) return null;

  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function loadCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function num(v) {
  return Number(v || 0);
}

function createEmptyGroupData(groupKey) {
  const allGroups = [...DAY_GROUPS, ...MORON_INTERNAL_GROUPS];
  const group = allGroups.find((g) => g.key === groupKey);
  const base = {};
  if (!group) return base;

  group.columns.forEach((col) => {
    if (!col.readonly) base[col.key] = 0;
  });

  return base;
}

function createEmptyRow(producto) {
  const row = {
    productoId: producto.id,
    productoNombre: producto.nombre,
    categoria: producto.categoria || '',
    stockInicial: {
      alvearChica: 0,
      alvearGrande: 0,
      moronChica: 0,
      moronGrande: 0,
      secandoChica: 0,
      secandoGrande: 0,
      banadoChica: 0,
      banadoGrande: 0
    },
    groups: {}
  };

  [...DAY_GROUPS, ...MORON_INTERNAL_GROUPS].forEach((group) => {
    row.groups[group.key] = createEmptyGroupData(group.key);
  });

  return row;
}

function normalizeExistingRow(row = {}) {
  const normalized = {
    productoId: row.productoId || '',
    productoNombre: row.productoNombre || '',
    categoria: row.categoria || '',
    stockInicial: {
      alvearChica: num(row.stockInicial?.alvearChica ?? row.stockInicial?.alvear ?? 0),
      alvearGrande: num(row.stockInicial?.alvearGrande),
      moronChica: num(row.stockInicial?.moronChica ?? row.stockInicial?.moron ?? 0),
      moronGrande: num(row.stockInicial?.moronGrande),
      secandoChica: num(row.stockInicial?.secandoChica ?? row.stockInicial?.secando ?? 0),
      secandoGrande: num(row.stockInicial?.secandoGrande),
      banadoChica: num(row.stockInicial?.banadoChica ?? row.stockInicial?.banado ?? 0),
      banadoGrande: num(row.stockInicial?.banadoGrande)
    },
    groups: {}
  };

  [...DAY_GROUPS, ...MORON_INTERNAL_GROUPS].forEach((group) => {
    normalized.groups[group.key] = createEmptyGroupData(group.key);
  });

  if (row.groups && typeof row.groups === 'object') {
    Object.keys(row.groups).forEach((groupKey) => {
      if (!normalized.groups[groupKey]) return;

      Object.keys(row.groups[groupKey] || {}).forEach((fieldKey) => {
        if (fieldKey in normalized.groups[groupKey]) {
          normalized.groups[groupKey][fieldKey] = num(row.groups[groupKey][fieldKey]);
        }
      });
    });
  }

  return normalized;
}

function getProductosParaFabrica(fabrica) {
  const activos = state.productos.filter((p) => p.activo !== false);
  if (state.perfil?.rol === 'gerencia') return activos;
  return activos.filter((p) => (p.visiblePara || []).includes(fabrica));
}

function getWeeklyProducts() {
  return state.productos.filter((p) => p.activo !== false && (
    (p.visiblePara || []).includes('moron') || (p.visiblePara || []).includes('alvear')
  ));
}

function buildDefaultRows(fabrica) {
  return getProductosParaFabrica(fabrica).map(createEmptyRow);
}

function normalizeRowsForCurrentProducts(rows = [], fabrica = '') {
  const allowedProducts = getProductosParaFabrica(fabrica);
  const byId = new Map();

  rows.forEach((row) => {
    const normalized = normalizeExistingRow(row);
    byId.set(normalized.productoId, normalized);
  });

  return allowedProducts.map((producto) => {
    const existing = byId.get(producto.id);
    if (existing) {
      existing.productoNombre = producto.nombre;
      existing.categoria = producto.categoria || '';
      return existing;
    }
    return createEmptyRow(producto);
  });
}

function getReporteId(fecha, fabrica) {
  return `${fecha}_${fabrica}`;
}

function computeGroupTotal(groupKey, data = {}) {
  switch (groupKey) {
    case 'alvear':
      return num(data.alv);

    case 'cajaChica':
      return num(data.alvPlus) - num(data.alvMinus) + num(data.dif);

    case 'cajaGrandeAlv':
      return num(data.alvPlus) - num(data.alvMinus) + num(data.dif);

    case 'cajaChicaMor':
      return num(data.morPlus) - num(data.morMinus) + num(data.dif);

    case 'cajaGrandeMor':
      return num(data.morPlus) - num(data.morMinus) + num(data.dif);

    case 'banadoChica':
      return (
        num(data.banadoPlus) +
        num(data.totalSecando) +
        num(data.cosecha) -
        num(data.salida) +
        num(data.dif)
      );

    case 'banadoGrande':
      return (
        num(data.banadoPlus) +
        num(data.totalSecando) +
        num(data.cosecha) -
        num(data.salida) +
        num(data.dif)
      );

    case 'moronChicaInterna':
      return (
        num(data.totalBase) +
        num(data.entrada) +
        num(data.sobrante) -
        num(data.pEmpaq) +
        num(data.diferencia)
      );

    case 'moronGrandeInterna':
      return (
        num(data.totalBase) +
        num(data.entrada) +
        num(data.sobrante) -
        num(data.pEmpaq) +
        num(data.diferencia)
      );

    default:
      return 0;
  }
}

function computeMoronInternalReadonly(groupKey, colKey, data = {}) {
  if (colKey === 'salidaTotal') {
    return num(data.pEmpaq) - num(data.sobrante);
  }

  if (colKey === 'total') {
    return computeGroupTotal(groupKey, data);
  }

  return 0;
}

function computeStockInitialTotal(stock = {}) {
  return (
    num(stock.alvearChica) +
    num(stock.alvearGrande) +
    num(stock.moronChica) +
    num(stock.moronGrande) +
    num(stock.secandoChica) +
    num(stock.secandoGrande) +
    num(stock.banadoChica) +
    num(stock.banadoGrande)
  );
}

function setMonthlyDefault() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if ($('mesGerencia')) $('mesGerencia').value = ym;
  if ($('cargaFecha')) $('cargaFecha').value = new Date().toISOString().slice(0, 10);
  if ($('pedidoMes')) $('pedidoMes').value = ym;
  if ($('reporteMes')) $('reporteMes').value = ym;
  state.pedidoSemanas = buildWeeksForMonth(ym);
  renderWeekOptions($('pedidoSemana'), state.pedidoSemanas);
}

function getTodayLocalISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeDashboardLogisticsSummary(reportes = [], productos = [], fecha = '') {
  const productosActivos = (productos || []).filter((p) => p.activo !== false);

  let esperadoChica = 0;
  let ingresadoChica = 0;
  let esperadoGrande = 0;
  let ingresadoGrande = 0;

  productosActivos.forEach((producto) => {
    const reporteAlvear = reportes.find((r) => r.fecha === fecha && r.fabrica === 'alvear');
    const reporteBanado = reportes.find((r) => r.fecha === fecha && r.fabrica === 'banado');
    const reporteMoron = reportes.find((r) => r.fecha === fecha && r.fabrica === 'moron');

    const rowAlvear = reporteAlvear?.rows?.find((x) => x.productoId === producto.id);
    const rowBanado = reporteBanado?.rows?.find((x) => x.productoId === producto.id);
    const rowMoron = reporteMoron?.rows?.find((x) => x.productoId === producto.id);

    esperadoChica +=
      num(rowAlvear?.groups?.cajaChica?.alvMinus) +
      num(rowBanado?.groups?.banadoChica?.salida);

    ingresadoChica += num(rowMoron?.groups?.moronChicaInterna?.entrada);

    esperadoGrande +=
      num(rowAlvear?.groups?.cajaGrandeAlv?.alvMinus) +
      num(rowBanado?.groups?.banadoGrande?.salida);

    ingresadoGrande += num(rowMoron?.groups?.moronGrandeInterna?.entrada);
  });

  return {
    esperadoChica,
    ingresadoChica,
    esperadoGrande,
    ingresadoGrande
  };
}


/* ================================================================
   DASHBOARD OPERATIVO — vista simplificada para no-gerencia
================================================================ */
function _renderDashboardOperativo(hoy) {
  const fabrica = state.perfil?.fabrica;
  const nombre = state.perfil?.nombre || state.currentUser?.email || 'Usuario';

  // Mis planillas (solo de mi fábrica)
  const misPlanillas = state.reportes
    .filter((r) => r.fabrica === fabrica)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  const planillaHoy = misPlanillas.find((r) => r.fecha === hoy);
  const totalEnviadas = misPlanillas.filter((r) => r.estado === 'enviada').length;
  const totalBorradores = misPlanillas.filter((r) => r.estado === 'borrador').length;

  const dashEl = document.getElementById('section-dashboard');
  if (!dashEl) return;

  const estadoHoy = planillaHoy
    ? (planillaHoy.estado === 'enviada'
        ? '<span class="estado-pill estado-enviada">✅ Publicada</span>'
        : '<span class="estado-pill estado-borrador">📝 En borrador</span>')
    : '<span class="estado-pill estado-nueva">— Sin cargar</span>';

  dashEl.innerHTML = `
    <div class="dash-kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
      <div class="kpi-card kpi-blue">
        <div class="kpi-icon">🏭</div>
        <div class="kpi-body">
          <div class="kpi-value" style="font-size:20px;">${(state.perfil?.fabrica || '').toUpperCase()}</div>
          <div class="kpi-label">Mi fábrica</div>
        </div>
      </div>
      <div class="kpi-card kpi-green">
        <div class="kpi-icon">📋</div>
        <div class="kpi-body">
          <div class="kpi-value">${totalEnviadas}</div>
          <div class="kpi-label">Planillas publicadas</div>
        </div>
      </div>
      <div class="kpi-card kpi-orange">
        <div class="kpi-icon">📝</div>
        <div class="kpi-body">
          <div class="kpi-value">${totalBorradores}</div>
          <div class="kpi-label">En borrador</div>
        </div>
      </div>
    </div>

    <div class="panel-card dash-panel mt-20">
      <div class="panel-header dash-panel-header">
        <h3>Estado de hoy · ${hoy}</h3>
        ${estadoHoy}
      </div>
      ${planillaHoy ? `
        <div style="font-size:13px;color:var(--muted);">
          Última actualización: ${planillaHoy.actualizadoEnTexto?.slice(0,16).replace('T',' ') || '-'}
          &nbsp;·&nbsp; Cargado por: ${planillaHoy.creadoPor || '-'}
        </div>
      ` : `
        <div class="carga-hint-row">
          <span class="hint-icon">💡</span>
          <span>Todavía no cargaste la planilla de hoy. Andá a <strong>Carga diaria</strong> para comenzar.</span>
        </div>
      `}
    </div>

    <div class="panel-card dash-panel mt-20">
      <div class="panel-header"><h3>Mis últimas planillas</h3></div>
      <div class="table-wrap">
        <table class="data-table dash-table">
          <thead>
            <tr><th>Fecha</th><th>Estado</th><th>Actualizado</th></tr>
          </thead>
          <tbody>
            ${misPlanillas.slice(0, 10).map((r) => `
              <tr>
                <td style="font-weight:600;">${r.fecha || '-'}</td>
                <td>
                  <span class="estado-pill ${r.estado === 'enviada' ? 'estado-enviada' : 'estado-borrador'}">
                    ${r.estado === 'enviada' ? '✅ Publicada' : '📝 Borrador'}
                  </span>
                </td>
                <td style="color:var(--muted);font-size:12px;">${(r.actualizadoEnTexto || r.fecha || '-').slice(0,16).replace('T',' ')}</td>
              </tr>
            `).join('') || '<tr><td colspan="3" style="color:var(--muted);">Sin planillas aún.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const hoy = getTodayLocalISO();
  const isGerencia = state.perfil?.rol === 'gerencia';

  const productosActivos = state.productos.filter((p) => p.activo !== false);
  const usuariosActivos = state.usuarios.filter((u) => u.activo !== false);
  const usuariosOperativos = usuariosActivos.filter((u) => u.rol !== 'gerencia' && u.fabrica);

  const fabricasOperativas = [...new Set(usuariosOperativos.map((u) => u.fabrica))];
  const reportesHoy = state.reportes.filter((r) => r.fecha === hoy);
  const fabricasHoy = new Set(reportesHoy.map((r) => r.fabrica));
  const pendientesHoy = fabricasOperativas.filter((f) => !fabricasHoy.has(f));

  if (!isGerencia) {
    // Vista simplificada para operativos
    _renderDashboardOperativo(hoy);
    return;
  }

  if ($('statProductos')) $('statProductos').textContent = productosActivos.length;
  if ($('statReportes')) $('statReportes').textContent = state.reportes.length;
  if ($('statBorradores')) $('statBorradores').textContent = state.reportes.filter((r) => r.estado === 'borrador').length;
  if ($('statEnviados')) $('statEnviados').textContent = state.reportes.filter((r) => r.estado === 'enviada').length;
  if ($('statAlertas')) $('statAlertas').textContent = state.alertas.length;
  if ($('badgeAlertas')) $('badgeAlertas').textContent = state.alertas.length;
  if ($('badgeReportes')) $('badgeReportes').textContent = state.reportes.length;
  if ($('statHoyCargadas')) $('statHoyCargadas').textContent = reportesHoy.length;
  if ($('statPendientesHoy')) $('statPendientesHoy').textContent = pendientesHoy.length;
  if ($('statUsuariosActivos')) $('statUsuariosActivos').textContent = usuariosActivos.length;

  if ($('tablaDashboardReportes')) {
    $('tablaDashboardReportes').innerHTML = state.reportes
      .slice()
      .sort((a, b) => {
        const fa = `${a.fecha || ''}_${a.fabrica || ''}`;
        const fb = `${b.fecha || ''}_${b.fabrica || ''}`;
        return fa < fb ? 1 : -1;
      })
      .slice(0, 12)
      .map((r) => `
        <tr>
          <td>${r.fecha || '-'}</td>
          <td>${FABRICAS[r.fabrica] || r.fabrica || '-'}</td>
          <td>${r.estado || '-'}</td>
          <td>${r.creadoPor || '-'}</td>
        </tr>
      `).join('') || '<tr><td colspan="4">Sin reportes.</td></tr>';
  }

  if ($('tablaDashboardFabricas')) {
    $('tablaDashboardFabricas').innerHTML = fabricasOperativas.map((f) => {
      const ultimo = state.reportes
        .filter((r) => r.fabrica === f)
        .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))[0];

      const estadoHoy = fabricasHoy.has(f) ? 'Cargó' : 'Pendiente';

      const cargó = fabricasHoy.has(f);
      return `
        <tr>
          <td style="font-weight:600;">${FABRICAS[f] || f}</td>
          <td>
            <span style="
              display:inline-flex;align-items:center;gap:5px;
              padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;
              background:${cargó ? 'rgba(61,220,151,.15)' : 'rgba(255,90,90,.15)'};
              color:${cargó ? '#3ddc97' : '#ff5a5a'};
            ">
              ${cargó ? '✅' : '⏳'} ${cargó ? 'Cargó' : 'Pendiente'}
            </span>
          </td>
          <td style="color:var(--muted);font-size:13px;">${ultimo?.fecha || '-'}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="3">Sin datos.</td></tr>';
  }

  const resumen = computeDashboardLogisticsSummary(state.reportes, state.productos, hoy);

  if ($('statEsperadoChica')) $('statEsperadoChica').textContent = resumen.esperadoChica;
  if ($('statIngresadoChica')) $('statIngresadoChica').textContent = resumen.ingresadoChica;
  if ($('statEsperadoGrande')) $('statEsperadoGrande').textContent = resumen.esperadoGrande;
  if ($('statIngresadoGrande')) $('statIngresadoGrande').textContent = resumen.ingresadoGrande;

  if ($('tablaDashboardAlertas')) {
    $('tablaDashboardAlertas').innerHTML = state.alertas
      .slice()
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      .slice(0, 10)
      .map((a) => `
        <tr>
          <td>${a.fecha || '-'}</td>
          <td>${a.productoNombre || '-'}</td>
          <td>${a.bloque || '-'}</td>
          <td style="font-weight:700;color:#ff5a5a;">${a.diferencia || 0}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" style="color:var(--muted);">Sin alertas.</td></tr>';
  }

  // Panel productividad Alvear — solo gerencia
  if (state.perfil?.rol === 'gerencia') {
    renderDashboardProductividad();
  }
}

function renderProductos() {
  if ($('productosCount')) $('productosCount').textContent = state.productos.length;
  if ($('productosActivos')) $('productosActivos').textContent = state.productos.filter((p) => p.activo !== false).length;

  if (!$('productosList')) return;

  const productosOrdenados = [...state.productos].sort((a, b) => {
    const oa = Number(a.orden || 0);
    const ob = Number(b.orden || 0);
    if (oa !== ob) return oa - ob;
    return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
  });

  // Aplicar filtros
  const productosFiltrados = productosOrdenados.filter((p) => {
    if (state.productoFiltroCategoria && (p.categoria || '') !== state.productoFiltroCategoria) return false;
    if (state.productoFiltroNombre) {
      const q = state.productoFiltroNombre.trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      const nombre = String(p.nombre || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (!nombre.includes(q)) return false;
    }
    return true;
  });

  // Actualizar select de categorías del filtro
  const selectFiltro = $('filtroCategoriaProd');
  if (selectFiltro) {
    const cats = [...new Set(productosOrdenados.filter((p) => p.categoria).map((p) => p.categoria))].sort();
    const cur = selectFiltro.value;
    selectFiltro.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map((c) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
  }

  const container = $('productosList');

  container.innerHTML = productosFiltrados.map((p) => {
    const visibles = p.visiblePara || [];

    return `
      <div class="product-row" draggable="true" data-product-id="${p.id}" data-orden="${p.orden || 0}"
        style="cursor:grab;position:relative;">
        <div class="product-drag-handle" title="Arrastrar para reordenar"
          style="position:absolute;left:0;top:0;bottom:0;width:28px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:16px;user-select:none;">
          ⠿
        </div>
        <div class="product-main" style="margin-left:28px;">
          <div class="product-title">${p.nombre || '-'}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
            <div class="product-sub">Código: ${p.codigo || '-'}</div>
            <input
              type="text"
              class="categoria-input"
              data-id="${p.id}"
              value="${p.categoria || ''}"
              placeholder="Categoría"
              style="
                border:1px solid var(--line);border-radius:8px;padding:4px 8px;
                background:rgba(255,255,255,.05);color:#fff;font-size:12px;
                width:140px;
              "
            />
          </div>
          <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
            <label>
              <input type="checkbox" class="visibilidad-check" data-id="${p.id}" value="alvear" ${visibles.includes('alvear') ? 'checked' : ''}>
              Alvear
            </label>
            <label>
              <input type="checkbox" class="visibilidad-check" data-id="${p.id}" value="moron" ${visibles.includes('moron') ? 'checked' : ''}>
              Morón
            </label>
            <label>
              <input type="checkbox" class="visibilidad-check" data-id="${p.id}" value="banado" ${visibles.includes('banado') ? 'checked' : ''}>
              Bañado
            </label>
          </div>
        </div>

        <div class="product-actions" style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn btn-primary btn-sm" data-save="${p.id}">Guardar</button>
          <button class="btn btn-outline btn-sm" data-toggle-producto="${p.id}">
            ${p.activo === false ? 'Activar' : 'Desactivar'}
          </button>
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Sin productos.</div>';

  // ── Drag & drop para reordenar ──────────────────────────────
  let dragSrc = null;

  container.querySelectorAll('.product-row[draggable]').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      dragSrc = row;
      row.style.opacity = '0.45';
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      container.querySelectorAll('.product-row').forEach((r) => r.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.product-row').forEach((r) => r.classList.remove('drag-over'));
      if (row !== dragSrc) row.classList.add('drag-over');
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === row) return;

      // Reordenar en el DOM
      const rows = [...container.querySelectorAll('.product-row')];
      const srcIdx = rows.indexOf(dragSrc);
      const dstIdx = rows.indexOf(row);

      if (srcIdx < dstIdx) {
        row.after(dragSrc);
      } else {
        row.before(dragSrc);
      }

      // Guardar nuevo orden en Firestore
      const newOrder = [...container.querySelectorAll('.product-row')];
      const updates = newOrder.map((r, i) => ({
        id: r.dataset.productId,
        orden: i + 1
      }));

      try {
        await Promise.all(updates.map(({ id, orden }) =>
          updateDoc(doc(db, 'productos', id), { orden })
        ));
        toast('Orden guardado.');
        await refreshAll();
      } catch (err) {
        toast('Error al guardar orden.');
        console.error(err);
      }
    });
  });

  // ── Toggle activo/inactivo ────────────────────────────────
  document.querySelectorAll('[data-toggle-producto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggleProducto;
      const item = state.productos.find((p) => p.id === id);
      if (!item) return;
      await updateDoc(doc(db, 'productos', id), { activo: item.activo === false ? true : false });
      toast('Producto actualizado.');
      await refreshAll();
    });
  });

  // ── Guardar: visibilidad + categoría ─────────────────────
  document.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.save;
      const checks = Array.from(document.querySelectorAll(`.visibilidad-check[data-id="${id}"]:checked`));
      const visiblePara = checks.map((c) => c.value);
      const catInput = document.querySelector(`.categoria-input[data-id="${id}"]`);
      const categoria = catInput ? catInput.value.trim() : '';

      await updateDoc(doc(db, 'productos', id), { visiblePara, categoria });
      toast('Producto guardado.');
      await refreshAll();
    });
  });
}

function renderUsuarios() {
  if (!$('tablaUsuarios')) return;

  $('tablaUsuarios').innerHTML = state.usuarios.map((u) => `
    <tr>
      <td>${u.nombre || '-'}</td>
      <td>${u.email || '-'}</td>
      <td>${u.rol || '-'}</td>
      <td>${FABRICAS[u.fabrica] || '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Sin usuarios.</td></tr>';
}

async function registrarProducto(ev) {
  ev.preventDefault();

  const nombre = $('prodNombre')?.value.trim();
  const codigo = $('prodCodigo')?.value.trim();
  const categoria = $('prodCategoria')?.value.trim();
  const visiblePara = Array.from(document.querySelectorAll('input[name="visiblePara"]:checked')).map((el) => el.value);

  if (!nombre) {
    toast('Ingresá el nombre del producto.');
    return;
  }

  await addDoc(collection(db, 'productos'), {
    nombre,
    codigo,
    categoria,
    visiblePara,
    activo: true,
    creadoEn: serverTimestamp(),
    orden: state.productos.length + 1
  });

  ev.target.reset();
  document.querySelectorAll('input[name="visiblePara"]').forEach((el) => {
    el.checked = true;
  });

  toast('Producto guardado.');
  await refreshAll();
}

function getVisibleGroupsForCurrentView() {
  let fabrica = $('cargaFabrica')?.value;

  if (!fabrica && state.perfil?.fabrica) {
    fabrica = state.perfil.fabrica;
  }

  if (state.perfil?.rol === 'gerencia') {
    return [...DAY_GROUPS, ...MORON_INTERNAL_GROUPS];
  }

  if (fabrica === 'moron') {
    return MORON_INTERNAL_GROUPS;
  }

  const groupsByFactory = {
    alvear: ['alvear', 'cajaChica', 'cajaGrandeAlv'],
    banado: ['banadoChica', 'banadoGrande']
  };

  const allowedKeys = groupsByFactory[fabrica] || [];
  return DAY_GROUPS.filter((g) => allowedKeys.includes(g.key));
}

function getEditableGroupsForCurrentUser() {
  let fabrica = $('cargaFabrica')?.value;

  if (!fabrica && state.perfil?.fabrica) {
    fabrica = state.perfil.fabrica;
  }

  if (state.perfil?.rol === 'gerencia') {
    return [...DAY_GROUPS, ...MORON_INTERNAL_GROUPS].map((g) => g.key);
  }

  if (fabrica === 'moron') {
    return MORON_INTERNAL_GROUPS.map((g) => g.key);
  }

  return INPUT_GROUP_BY_FABRICA[fabrica] || [];
}

function currentReporteIsLocked() {
  if (!state.reporteActual) return false;
  if (state.perfil?.rol === 'gerencia') return false;
  // Para operativos: bloqueado si fue publicada (estado 'enviada')
  return state.reporteActual.estado === 'enviada';
}

function renderCellInput({
  rowIndex,
  groupKey = '',
  area = '',
  key,
  value,
  canEdit,
  extraClass = ''
}) {
  const attrs = [
    `class="excel-input ${extraClass}"`,
    `data-row="${rowIndex}"`,
    key ? `data-key="${key}"` : '',
    groupKey ? `data-group="${groupKey}"` : '',
    area ? `data-area="${area}"` : '',
    'type="text"',
    'inputmode="numeric"',
    'autocomplete="off"',
    `value="${value}"`
  ].filter(Boolean).join(' ');

  return `<input ${attrs} ${canEdit ? '' : 'disabled'}>`;
}

function hasAnyNonZeroValue(obj = {}) {
  return Object.values(obj || {}).some((value) => num(value) !== 0);
}

function getMergedGroupDataForDay(fecha, productoId, groupKey) {
  const reportesDelDia = state.reportes.filter((r) => r.fecha === fecha);
  let fallback = null;

  for (const reporte of reportesDelDia) {
    const row = (reporte.rows || []).find((x) => x.productoId === productoId);
    if (!row?.groups?.[groupKey]) continue;

    const groupData = row.groups[groupKey];
    if (!fallback) fallback = groupData;

    if (hasAnyNonZeroValue(groupData)) {
      return groupData;
    }
  }

  return fallback || createEmptyGroupData(groupKey);
}

function getFirstRowForMonth(productoId, monthValue) {
  const reportesDelMes = state.reportes
    .filter((r) => r.fecha?.startsWith(monthValue))
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

  for (const reporte of reportesDelMes) {
    const row = (reporte.rows || []).find((x) => x.productoId === productoId);
    if (row) return normalizeExistingRow(row);
  }

  return null;
}

function getDateParts(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return { year, month, day };
}

function buildDateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getPreviousMonthValue(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const prev = new Date(year, month - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function getLastAvailableDateForMonth(monthValue) {
  const fechas = state.reportes
    .filter((r) => r.fecha?.startsWith(monthValue))
    .map((r) => r.fecha)
    .sort();

  return fechas.length ? fechas[fechas.length - 1] : null;
}

function getAnyRowForDateProduct(fecha, productoId) {
  const reportesDelDia = state.reportes.filter((r) => r.fecha === fecha);

  for (const reporte of reportesDelDia) {
    const row = (reporte.rows || []).find((x) => x.productoId === productoId);
    if (row) return normalizeExistingRow(row);
  }

  return null;
}

function getEffectiveGroupDataForDay(fecha, productoId, groupKey) {
  const currentFecha = $('cargaFecha')?.value;
  let currentFabrica = $('cargaFabrica')?.value;

  if (!currentFabrica && state.perfil?.fabrica) {
    currentFabrica = state.perfil.fabrica;
  }

  const isCurrentReportGroup =
    ['banadoChica', 'banadoGrande', 'moronChicaInterna', 'moronGrandeInterna', 'alvear', 'cajaChica', 'cajaGrandeAlv', 'cajaChicaMor', 'cajaGrandeMor']
      .includes(groupKey);

  if (
    state.reporteActual &&
    state.reporteActual.fecha === fecha &&
    isCurrentReportGroup
  ) {
    const row = state.reporteActual.rows?.find((r) => r.productoId === productoId);
    if (row?.groups?.[groupKey]) {
      return row.groups[groupKey];
    }
  }

  return getMergedGroupDataForDay(fecha, productoId, groupKey);
}

function getBanadoSecandoRunningTotal(dayStr, productoId, groupKey, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);

  let total =
    groupKey === 'banadoChica'
      ? num(stockInicial?.secandoChica)
      : num(stockInicial?.secandoGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, groupKey);

    total += num(rowData?.secando) - num(rowData?.cosecha);
  }

  return total;
}

function getBanadoRunningTotal(dayStr, productoId, groupKey, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);

  let total =
    groupKey === 'banadoChica'
      ? num(stockInicial?.banadoChica)
      : num(stockInicial?.banadoGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, groupKey);

    total +=
      num(rowData?.banadoPlus) +
      num(rowData?.cosecha) -
      num(rowData?.salida) +
      num(rowData?.dif);
  }

  return total;
}

function getMoronRunningTotal(dayStr, productoId, groupKey, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);

  let total =
    groupKey === 'moronChicaInterna'
      ? num(stockInicial?.moronChica)
      : num(stockInicial?.moronGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, groupKey);

    total +=
      num(rowData?.entrada) +
      num(rowData?.sobrante) -
      num(rowData?.pEmpaq) +
      num(rowData?.diferencia);
  }

  return total;
}

function getCajaChicaAlvearRunningTotal(dayStr, productoId, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);
  let total = num(stockInicial?.alvearChica);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'cajaChica');

    total +=
      num(rowData?.alvPlus) -
      num(rowData?.alvMinus) +
      num(rowData?.dif);
  }

  return total;
}

function getCajaGrandeAlvearRunningTotal(dayStr, productoId, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);
  let total = num(stockInicial?.alvearGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'cajaGrandeAlv');

    total +=
      num(rowData?.alvPlus) -
      num(rowData?.alvMinus) +
      num(rowData?.dif);
  }

  return total;
}

function getCajaChicaMoronRunningTotal(dayStr, productoId, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);
  let total = num(stockInicial?.moronChica);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'cajaChicaMor');

    total +=
      num(rowData?.morPlus) -
      num(rowData?.morMinus) +
      num(rowData?.dif);
  }

  return total;
}

function getCajaGrandeMoronRunningTotal(dayStr, productoId, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);
  let total = num(stockInicial?.moronGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'cajaGrandeMor');

    total +=
      num(rowData?.morPlus) -
      num(rowData?.morMinus) +
      num(rowData?.dif);
  }

  return total;
}

function getClosingStockFromPreviousMonth(productoId, monthValue) {
  if (!monthValue || monthValue === MANUAL_INITIAL_MONTH) return null;

  const previousMonth = getPreviousMonthValue(monthValue);
  const lastDate = getLastAvailableDateForMonth(previousMonth);
  if (!lastDate) return null;

  const lastRow = getAnyRowForDateProduct(lastDate, productoId);
  if (!lastRow) return null;

  return {
    alvearChica: getCajaChicaAlvearRunningTotal(lastDate, productoId, lastRow.stockInicial || {}),
    alvearGrande: getCajaGrandeAlvearRunningTotal(lastDate, productoId, lastRow.stockInicial || {}),
    moronChica: getCajaChicaMoronRunningTotal(lastDate, productoId, lastRow.stockInicial || {}),
    moronGrande: getCajaGrandeMoronRunningTotal(lastDate, productoId, lastRow.stockInicial || {}),
    secandoChica: getBanadoSecandoRunningTotal(lastDate, productoId, 'banadoChica', lastRow.stockInicial || {}),
    secandoGrande: getBanadoSecandoRunningTotal(lastDate, productoId, 'banadoGrande', lastRow.stockInicial || {}),
    banadoChica: getBanadoRunningTotal(lastDate, productoId, 'banadoChica', lastRow.stockInicial || {}),
    banadoGrande: getBanadoRunningTotal(lastDate, productoId, 'banadoGrande', lastRow.stockInicial || {})
  };
}

function applyPreviousMonthInitialStock(rows = [], monthValue = '') {
  if (!monthValue || monthValue === MANUAL_INITIAL_MONTH) return rows;

  return rows.map((row) => {
    const closing = getClosingStockFromPreviousMonth(row.productoId, monthValue);
    if (!closing) return row;

    return {
      ...row,
      stockInicial: {
        ...row.stockInicial,
        ...closing
      }
    };
  });
}

function getInitialStockForMonth(productoId, monthValue) {
  // Buscar el primer reporte del mes que tenga stock inicial no-cero
  // ordenado por fecha ASC, sin filtrar por fábrica
  const reportesDelMes = state.reportes
    .filter((r) => r.fecha?.startsWith(monthValue))
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

  for (const reporte of reportesDelMes) {
    const row = (reporte.rows || []).find((x) => x.productoId === productoId);
    if (!row) continue;
    const s = row.stockInicial;
    if (!s) continue;
    // Devolver si tiene al menos un valor no cero
    const tieneStock = Object.values(s).some((v) => num(v) !== 0);
    if (tieneStock) return normalizeExistingRow({ ...row }).stockInicial;
  }

  // Fallback: cualquier row del mes aunque sea todo cero
  for (const reporte of reportesDelMes) {
    const row = (reporte.rows || []).find((x) => x.productoId === productoId);
    if (row?.stockInicial) return normalizeExistingRow({ ...row }).stockInicial;
  }

  const closing = getClosingStockFromPreviousMonth(productoId, monthValue);
  if (closing) return closing;

  return {
    alvearChica: 0, alvearGrande: 0,
    moronChica: 0, moronGrande: 0,
    secandoChica: 0, secandoGrande: 0,
    banadoChica: 0, banadoGrande: 0
  };
}

function getAlvearRunningTotal(dayStr, productoId) {
  const { year, month, day } = getDateParts(dayStr);
  let total = 0;

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'alvear');
    total += num(rowData?.alv);
  }

  return total;
}

function renderCargaDiaria() {
  const table = $('tablaCargaDiaria');
  if (!table) return;

  let fecha = $('cargaFecha')?.value;
  let fabrica = $('cargaFabrica')?.value;

  if (state.perfil?.rol !== 'gerencia' && state.perfil?.fabrica) {
    fabrica = state.perfil.fabrica;
    if ($('cargaFabrica')) $('cargaFabrica').value = fabrica;
  }

  const rows = (() => {
    const base = state.reporteActual?.rows || buildDefaultRows(fabrica);
    const isMoronUser = (fabrica === 'moron') && state.perfil?.rol !== 'gerencia';
    let filtered = base;

    // Filtro categoría (solo Morón operativo)
    if (isMoronUser && state.cargaCategoriaFilter) {
      filtered = filtered.filter((r) => (r.categoria || '') === state.cargaCategoriaFilter);
    }

    // Filtro aroma — disponible para todos
    if (state.cargaAromaFilter) {
      const q = state.cargaAromaFilter.trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      filtered = filtered.filter((r) => {
        const nombre = String(r.productoNombre || '')
          .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return nombre.includes(q);
      });
    }

    return filtered;
  })();
  const editableGroups = getEditableGroupsForCurrentUser();
  const visibleGroups = getVisibleGroupsForCurrentView();
  const locked = currentReporteIsLocked();

  const fechaInput = $('cargaFecha');
  const fabricaSelect = $('cargaFabrica');
  const btnCargarReporte = $('btnCargarReporte');

  if (state.perfil?.rol === 'gerencia') {
    if (fechaInput) fechaInput.disabled = false;
    if (fabricaSelect) fabricaSelect.disabled = false;
    if (btnCargarReporte) btnCargarReporte.disabled = false;
  } else {
    // Operativo: fábrica siempre fija, fecha y cargar disponibles
    // Solo se deshabilitan si la planilla está publicada (locked)
    if (fechaInput) fechaInput.disabled = locked;
    if (fabricaSelect) fabricaSelect.disabled = true;
    if (btnCargarReporte) btnCargarReporte.disabled = false; // siempre puede cargar
  }

  // Estado visual con color y texto descriptivo
  const estadoEl = $('estadoCarga');
  if (estadoEl) {
    if (!state.reporteActual) {
      estadoEl.innerHTML = `<span class="estado-pill estado-nueva">✦ Nueva planilla ${fecha || ''}</span>`;
    } else {
      const est = state.reporteActual.estado || 'borrador';
      const isLocked = locked;
      if (est === 'enviada') {
        estadoEl.innerHTML = `<span class="estado-pill estado-enviada">✅ Publicada · Solo lectura${state.perfil?.rol === 'gerencia' ? ' · <button class="btn-volver-borrador" id="btnVolverBorrador">Volver a borrador</button>' : ''}</span>`;
      } else if (est === 'borrador') {
        estadoEl.innerHTML = `<span class="estado-pill estado-borrador">📝 Borrador · Guardando automáticamente</span>`;
      } else {
        estadoEl.innerHTML = `<span class="estado-pill estado-nueva">✦ ${est}</span>`;
      }
    }
    // Bind botón volver a borrador si existe
    const btnVolver = document.getElementById('btnVolverBorrador');
    if (btnVolver) {
      btnVolver.addEventListener('click', () => volverABorrador());
    }
  }

  if ($('btnGuardarReporte')) $('btnGuardarReporte').disabled = locked;
  if ($('btnEnviarReporte')) $('btnEnviarReporte').disabled = locked;

  let thead1 = `<tr><th class="sticky-col" rowspan="3">PRODUCTO</th><th colspan="${INITIAL_STOCK_COLUMNS.length}">STOCK INICIAL</th>`;
  let thead2 = '<tr>';
  let thead3 = '<tr>';

  INITIAL_STOCK_COLUMNS.forEach((col) => {
    thead2 += `<th rowspan="2" class="stock-head">${col.label}</th>`;
  });

  visibleGroups.forEach((group) => {
    thead1 += `<th colspan="${group.columns.length}" class="${group.colorClass}">${group.title}</th>`;
    group.columns.forEach((col) => {
      thead2 += `<th class="${group.colorClass}" rowspan="2">${col.label}</th>`;
    });
  });

  thead1 += '<th rowspan="3" class="total-head">TOTAL FILA</th></tr>';
  thead2 += '</tr>';
  thead3 += '</tr>';

  let body = '';
  const columnTotals = {};
  INITIAL_STOCK_COLUMNS.forEach((c) => {
    columnTotals[`stock_${c.key}`] = 0;
  });
  visibleGroups.forEach((g) => g.columns.forEach((c) => {
    columnTotals[`${g.key}_${c.key}`] = 0;
  }));
  let grandTotal = 0;

  rows.forEach((row, rowIndex) => {
    let rowHtml = `<tr><td class="sticky-col product-name-cell">${row.productoNombre}</td>`;

    INITIAL_STOCK_COLUMNS.forEach((col) => {
      const value = num(row.stockInicial?.[col.key]);
      const isGerencia = state.perfil?.rol === 'gerencia';

      if (isGerencia) {
        // Gerencia: input editable siempre
        rowHtml += `<td>${renderCellInput({
          rowIndex,
          area: 'stockInicial',
          key: col.key,
          value,
          canEdit: true,
          extraClass: 'stock-input'
        })}</td>`;
      } else {
        // Operativo: solo muestra el valor (readonly, sin input)
        rowHtml += `<td class="readonly-cell stock-readonly">${value}</td>`;
      }

      columnTotals[`stock_${col.key}`] += value;
    });

    visibleGroups.forEach((group) => {
      group.columns.forEach((col) => {
        if (col.readonly) {
          let totalValue = 0;
          const fechaActual = $('cargaFecha')?.value || '';

          if (group.key === 'moronChicaInterna' || group.key === 'moronGrandeInterna') {
            if (col.key === 'salidaTotal') {
              totalValue = computeMoronInternalReadonly(group.key, col.key, row.groups?.[group.key] || {});
            } else if (col.key === 'total') {
              totalValue = getMoronRunningTotal(
                fechaActual,
                row.productoId,
                group.key,
                row.stockInicial || {}
              );
            }
          } else if (group.key === 'banadoChica' || group.key === 'banadoGrande') {
            if (col.key === 'totalSecando') {
              totalValue = getBanadoSecandoRunningTotal(
                fechaActual,
                row.productoId,
                group.key,
                row.stockInicial || {}
              );
            } else if (col.key === 'total') {
              totalValue = getBanadoRunningTotal(
                fechaActual,
                row.productoId,
                group.key,
                row.stockInicial || {}
              );
            }
          } else if (group.key === 'alvear') {
            totalValue = getAlvearRunningTotal(
              fechaActual,
              row.productoId
            );
          } else if (group.key === 'cajaChica') {
            totalValue = getCajaChicaAlvearRunningTotal(
              fechaActual,
              row.productoId,
              row.stockInicial || {}
            );
          } else if (group.key === 'cajaGrandeAlv') {
            totalValue = getCajaGrandeAlvearRunningTotal(
              fechaActual,
              row.productoId,
              row.stockInicial || {}
            );
          } else if (group.key === 'cajaChicaMor') {
            totalValue = getCajaChicaMoronRunningTotal(
              fechaActual,
              row.productoId,
              row.stockInicial || {}
            );
          } else if (group.key === 'cajaGrandeMor') {
            totalValue = getCajaGrandeMoronRunningTotal(
              fechaActual,
              row.productoId,
              row.stockInicial || {}
            );
          } else {
            totalValue = computeGroupTotal(group.key, row.groups?.[group.key] || {});
          }

          rowHtml += `<td class="readonly-cell ${group.colorClass}">${totalValue}</td>`;
          columnTotals[`${group.key}_${col.key}`] += totalValue;
        } else {
          const value = num(row.groups?.[group.key]?.[col.key]);
          const canEdit = editableGroups.includes(group.key) && !locked;

          rowHtml += `<td>${renderCellInput({
            rowIndex,
            groupKey: group.key,
            key: col.key,
            value,
            canEdit,
            extraClass: group.colorClass
          })}</td>`;

          columnTotals[`${group.key}_${col.key}`] += value;
        }
      });
    });

    const rowTotal =
      computeStockInitialTotal(row.stockInicial) +
      visibleGroups.reduce((acc, g) => {
        const groupData = row.groups[g.key] || {};
        return acc + computeGroupTotal(g.key, groupData);
      }, 0);

    grandTotal += rowTotal;
    rowHtml += `<td class="total-cell">${rowTotal}</td></tr>`;
    body += rowHtml;
  });

  let tfoot = `<tr><th class="sticky-col">TOTAL</th>`;
  INITIAL_STOCK_COLUMNS.forEach((col) => {
    tfoot += `<th>${columnTotals[`stock_${col.key}`]}</th>`;
  });
  visibleGroups.forEach((group) => {
    group.columns.forEach((col) => {
      tfoot += `<th>${columnTotals[`${group.key}_${col.key}`]}</th>`;
    });
  });
  tfoot += `<th>${grandTotal}</th></tr>`;

  table.innerHTML = `<thead>${thead1}${thead2}${thead3}</thead><tbody>${body || '<tr><td colspan="999">Sin productos.</td></tr>'}</tbody><tfoot>${tfoot}</tfoot>`;

  bindCargaInputs();
}

function _parseDecimal(val) {
  const str = String(val || '').trim().replace(',', '.');
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function bindCargaInputs() {
  document.querySelectorAll('#tablaCargaDiaria input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      const allowed = ['Backspace','Delete','Tab','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','.',','];
      if (allowed.includes(e.key)) return;
      if (/^[0-9]$/.test(e.key)) return;
      e.preventDefault();
    });

    input.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (!/^[0-9]*[.,]?[0-9]*$/.test(pasted.trim())) e.preventDefault();
    });

    input.addEventListener('change', (e) => {
      const rowIndex = Number(e.target.dataset.row);
      const numericValue = _parseDecimal(e.target.value);
      e.target.value = numericValue;

      if (!state.reporteActual) {
        let fabrica = $('cargaFabrica')?.value;
        if (!fabrica && state.perfil?.fabrica) fabrica = state.perfil.fabrica;
        state.reporteActual = {
          id: getReporteId($('cargaFecha')?.value, fabrica),
          fecha: $('cargaFecha')?.value, fabrica,
          estado: 'borrador', idYaExistia: false,
          rows: buildDefaultRows(fabrica)
        };
      }

      if (e.target.dataset.area === 'stockInicial') {
        state.reporteActual.rows[rowIndex].stockInicial[e.target.dataset.key] = numericValue;
      } else {
        state.reporteActual.rows[rowIndex].groups[e.target.dataset.group][e.target.dataset.key] = numericValue;
      }

      renderCargaDiaria();

      if (!currentReporteIsLocked()) {
        clearTimeout(state.autoSaveTimer);
        state.autoSaveTimer = setTimeout(async () => { await _autoGuardarReporte(); }, 1500);
      }
    });

    input.addEventListener('blur', (e) => { e.target.value = _parseDecimal(e.target.value); });
  });
}


async function cargarReporteDiario() {
  const fecha = $('cargaFecha')?.value;
  let fabrica = $('cargaFabrica')?.value;

  if (!fabrica && state.perfil?.fabrica) {
    fabrica = state.perfil.fabrica;
    if ($('cargaFabrica')) $('cargaFabrica').value = fabrica;
  }

  if (!fecha || !fabrica) {
    toast('Seleccioná fecha y fábrica.');
    return;
  }

  const id = getReporteId(fecha, fabrica);
  const ref = doc(db, 'reportes_diarios', id);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const loaded = { id: snap.id, ...snap.data() };
    const estadoFirestore = loaded.estado || 'borrador';
    const isOperativo = state.perfil?.rol !== 'gerencia';
    const bloqueado = isOperativo && estadoFirestore === 'enviada';

    state.reporteActual = {
      ...loaded,
      estado: estadoFirestore,
      idYaExistia: true,
      rows: normalizeRowsForCurrentProducts(loaded.rows || [], fabrica)
    };

    if (state.perfil?.rol === 'gerencia') {
      toast('Reporte cargado.');
    } else if (bloqueado) {
      toast('Esta planilla ya fue publicada. Solo lectura.');
    } else {
      // borrador → operativo puede editar libremente
      toast('Planilla en borrador. Podés modificar y publicar.');
    }
  } else {
    const monthValue = String(fecha).slice(0, 7);
    let rows = buildDefaultRows(fabrica);
    rows = applyPreviousMonthInitialStock(rows, monthValue);

    state.reporteActual = {
      id,
      fecha,
      fabrica,
      estado: 'borrador',
      creadoPor: state.currentUser?.email || '',
      idYaExistia: false,
      rows
    };

    toast(
      monthValue === MANUAL_INITIAL_MONTH
        ? 'Nueva planilla preparada. Este mes usa stock inicial manual.'
        : 'Nueva planilla preparada con stock inicial del mes anterior.'
    );
  }

  renderCargaDiaria();
  _actualizarSelectCategoriaCarga();
}

async function guardarReporte(estado = 'borrador') {
  const fecha = $('cargaFecha')?.value;
  let fabrica = $('cargaFabrica')?.value;

  if (!fabrica && state.perfil?.fabrica) {
    fabrica = state.perfil.fabrica;
    if ($('cargaFabrica')) $('cargaFabrica').value = fabrica;
  }

  if (!fecha || !fabrica) {
    toast('Seleccioná fecha y fábrica.');
    return;
  }

  if (!state.reporteActual) {
    toast('Primero cargá la planilla.');
    return;
  }

  if (currentReporteIsLocked()) {
    toast('Esta planilla ya fue publicada. Solo lectura.');
    return;
  }

  const id = getReporteId(fecha, fabrica);
  const ref = doc(db, 'reportes_diarios', id);
  const snap = await getDoc(ref);

  if (snap.exists() && state.perfil?.rol !== 'gerencia') {
    const snapEstado = snap.data()?.estado || 'borrador';
    if (snapEstado === 'enviada') {
      toast('Esta planilla ya fue publicada y no puede modificarse.');
      state.reporteActual.idYaExistia = true;
      state.reporteActual.estado = 'enviada';
      renderCargaDiaria();
      return;
    }
  }

  const payload = {
    fecha,
    fabrica,
    estado,
    creadoPor: state.currentUser?.email || '',
    actualizadoEnTexto: new Date().toISOString(),
    actualizadoEn: serverTimestamp(),
    rows: state.reporteActual.rows.map(normalizeExistingRow)
  };

  if (!snap.exists()) {
    await setDoc(ref, {
      ...payload,
      creadoEn: serverTimestamp()
    });
  } else {
    await updateDoc(ref, payload);
  }

  state.reporteActual.estado = estado;
  state.reporteActual.idYaExistia = true;

  toast(estado === 'enviada' ? 'Planilla enviada.' : 'Planilla guardada.');
  await refreshAll();
  await cargarReporteDiario();
}

function renderGerenciaExcel() {
  const table = $('tablaGerenciaExcel');
  if (!table) return;

  const monthValue = $('mesGerencia')?.value;
  if (!monthValue) {
    table.innerHTML = '<tbody><tr><td>Seleccioná un mes.</td></tr></tbody>';
    return;
  }

  const [year, month] = monthValue.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  let header1 = `<tr><th class="sticky-col" rowspan="3">PRODUCTO</th><th colspan="${INITIAL_STOCK_COLUMNS.length}">STOCK INICIAL</th>`;
  let header2 = '<tr>';
  let header3 = '<tr>';

  INITIAL_STOCK_COLUMNS.forEach((col) => {
    header2 += `<th class="stock-head" rowspan="2">${col.label}</th>`;
  });

  for (let day = 1; day <= daysInMonth; day++) {
    const dayColspan = 1 + DAY_GROUPS.reduce((acc, g) => acc + g.columns.length, 0);
    header1 += `<th colspan="${dayColspan}" class="day-block">DÍA ${day}</th>`;

    header2 += `<th class="stock-head" rowspan="2">AROMA</th>`;

    DAY_GROUPS.forEach((group) => {
      header2 += `<th colspan="${group.columns.length}" class="${group.colorClass}">${group.title}</th>`;
      group.columns.forEach((col) => {
        header3 += `<th class="${group.colorClass}">${col.label}</th>`;
      });
    });
  }

  header1 += '</tr>';
  header2 += '</tr>';
  header3 += '</tr>';

  const productos = state.productos.filter((p) => p.activo !== false);
  let body = '';

  productos.forEach((producto) => {
    let row = `<tr><td class="sticky-col product-name-cell">${producto.nombre}</td>`;

    const stockInicial = getInitialStockForMonth(producto.id, monthValue);

    INITIAL_STOCK_COLUMNS.forEach((col) => {
      row += `<td>${num(stockInicial?.[col.key])}</td>`;
    });

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      row += `<td class="product-name-cell">${producto.nombre}</td>`;

      DAY_GROUPS.forEach((group) => {
        const rowData = getMergedGroupDataForDay(dayStr, producto.id, group.key);

        group.columns.forEach((col) => {
          if (col.readonly) {
            let totalValue = computeGroupTotal(group.key, rowData || {});

            if (group.key === 'alvear') {
              totalValue = getAlvearRunningTotal(dayStr, producto.id);
            } else if (group.key === 'cajaChica') {
              totalValue = getCajaChicaAlvearRunningTotal(dayStr, producto.id, stockInicial);
            } else if (group.key === 'cajaGrandeAlv') {
              totalValue = getCajaGrandeAlvearRunningTotal(dayStr, producto.id, stockInicial);
            } else if (group.key === 'cajaChicaMor') {
              totalValue = getCajaChicaMoronRunningTotal(dayStr, producto.id, stockInicial);
            } else if (group.key === 'cajaGrandeMor') {
              totalValue = getCajaGrandeMoronRunningTotal(dayStr, producto.id, stockInicial);
            } else if (group.key === 'moronChicaInterna' || group.key === 'moronGrandeInterna') {
              if (col.key === 'salidaTotal') {
                totalValue = computeMoronInternalReadonly(group.key, col.key, rowData || {});
              } else if (col.key === 'total') {
                totalValue = getMoronRunningTotal(dayStr, producto.id, group.key, stockInicial);
              }
            } else if (group.key === 'banadoChica' || group.key === 'banadoGrande') {
              if (col.key === 'totalSecando') {
                totalValue = getBanadoSecandoRunningTotal(dayStr, producto.id, group.key, stockInicial);
              } else if (col.key === 'total') {
                totalValue = getBanadoRunningTotal(dayStr, producto.id, group.key, stockInicial);
              }
            }

            row += `<td class="${group.colorClass}">${totalValue}</td>`;
          } else {
            row += `<td class="${group.colorClass}">${num(rowData?.[col.key])}</td>`;
          }
        });
      });
    }

    row += '</tr>';
    body += row;
  });

  table.innerHTML = `<thead>${header1}${header2}${header3}</thead><tbody>${body || '<tr><td colspan="999">Sin datos.</td></tr>'}</tbody>`;
}

/* ========= PEDIDO SEMANAL ========= */

function refreshPedidoWeeks() {
  const monthValue = $('pedidoMes')?.value;
  state.pedidoSemanas = buildWeeksForMonth(monthValue);
  renderWeekOptions($('pedidoSemana'), state.pedidoSemanas);
}

function getSelectedWeekMeta() {
  const weekKey = $('pedidoSemana')?.value;
  return state.pedidoSemanas.find((w) => w.key === weekKey) || null;
}

function getPedidoDocId() {
  const monthValue = $('pedidoMes')?.value;
  const weekMeta = getSelectedWeekMeta();
  if (!monthValue || !weekMeta) return null;
  return getWeekDocId(monthValue, weekMeta.key);
}

function canEditPedidoField(fieldKey) {
  const isGerencia = state.perfil?.rol === 'gerencia';
  const isMoron = state.perfil?.fabrica === 'moron' && state.perfil?.rol !== 'gerencia';
  const isAlvear = state.perfil?.fabrica === 'alvear' && state.perfil?.rol !== 'gerencia';
  const moronLocked = !!state.pedidoSemanalActual?.moronLocked;
  const alvearConfirmado = !!state.pedidoSemanalActual?.alvearConfirmado;

  if (isGerencia) return true;

  if (isMoron) {
    if (moronLocked) return false;
    return ['moronCantidad', 'moronObservacion'].includes(fieldKey);
  }

  if (isAlvear) {
    if (alvearConfirmado) return false;
    return [
      'alvearFechaEntrega',
      'alvearCantidadEntregada',
      'alvearMotivos',
      'alvearObservacion'
    ].includes(fieldKey);
  }

  return false;
}

function getPedidoEstadoText() {
  if (!state.pedidoSemanalActual) return 'Sin cargar';
  const moronLocked = !!state.pedidoSemanalActual.moronLocked;
  const alvearConfirmado = !!state.pedidoSemanalActual.alvearConfirmado;

  if (alvearConfirmado) return '✅ Semana cerrada — Alvear confirmó la entrega';
  if (moronLocked) return '⏳ Pedido enviado por Morón — Alvear cargando entregas';
  return '📝 Borrador — Morón puede editar';
}

function getPedidoSemanalViewMode() {
  if (state.perfil?.rol === 'gerencia') return 'gerencia';
  if (state.perfil?.fabrica === 'moron') return 'moron';
  if (state.perfil?.fabrica === 'alvear') return 'alvear';
  return 'otro';
}

function getPedidoSemanalRowsForView(rows = []) {
  const viewMode = getPedidoSemanalViewMode();

  if (viewMode === 'gerencia') return rows;
  if (viewMode === 'moron') return rows;

  if (viewMode === 'alvear') {
    // Alvear solo ve productos donde Morón haya pedido algo
    return rows.filter((row) => num(row.moronCantidad) > 0);
  }

  return [];
}

function hasWeeklyPendingRows(rows = []) {
  return rows.some((row) =>
    (num(row.moronPedidoChica) > 0 && !row.entregadoChica) ||
    (num(row.moronPedidoGrande) > 0 && !row.entregadoGrande)
  );
}

function getWeeklyPendingDatesForMonth(monthValue) {
  const weeks = buildWeeksForMonth(monthValue);
  const pendingDates = new Set();

  weeks.forEach((week) => {
    const id = getWeekDocId(monthValue, week.key);
    const current = state.pedidoSemanalActual?.id === id ? state.pedidoSemanalActual : null;

    let rows = current?.rows || [];
    if (!rows.length) {
      const docRows = [];
      const existingWeekly = state.pedidosSemanalesCache?.[id];
      if (existingWeekly?.rows) rows = existingWeekly.rows;
    }

    if (hasWeeklyPendingRows(rows)) {
      pendingDates.add(week.start);
    }
  });

  return pendingDates;
}
function ensurePedidoDraft() {
  if (state.pedidoSemanalActual) return;

  const weekMeta = getSelectedWeekMeta();
  const monthValue = $('pedidoMes')?.value;
  if (!weekMeta || !monthValue) return;

  state.pedidoSemanalActual = {
    id: getWeekDocId(monthValue, weekMeta.key),
    monthValue,
    weekKey: weekMeta.key,
    weekLabel: weekMeta.label,
    weekStart: weekMeta.start,
    weekEnd: weekMeta.end,
    moronLocked: false,
    alvearConfirmado: false,
    rows: buildDefaultWeeklyRows(getWeeklyProducts())
  };
}

async function cargarPedidoSemanal() {
  const monthValue = $('pedidoMes')?.value;
  const weekMeta = getSelectedWeekMeta();

  if (!monthValue || !weekMeta) {
    toast('Seleccioná mes y semana.');
    return;
  }

  const id = getWeekDocId(monthValue, weekMeta.key);
  const ref = doc(db, 'pedidos_semanales', id);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data() || {};
    state.pedidoSemanalActual = {
      id,
      ...data,
      rows: normalizeWeeklyRows(data.rows || [], getWeeklyProducts())
    };
    toast('Pedido semanal cargado.');
  } else {
    state.pedidoSemanalActual = {
      id,
      monthValue,
      weekKey: weekMeta.key,
      weekLabel: weekMeta.label,
      weekStart: weekMeta.start,
      weekEnd: weekMeta.end,
      moronLocked: false,
      alvearConfirmado: false,
      rows: buildDefaultWeeklyRows(getWeeklyProducts())
    };
    toast('Nueva semana preparada.');
  }

  state.pedidoSemanalSelectedRow = null;
  renderPedidoSemanal();
}

async function guardarPedidoSemanal() {
  const monthValue = $('pedidoMes')?.value;
  const weekMeta = getSelectedWeekMeta();

  if (!monthValue || !weekMeta) {
    toast('Seleccioná mes y semana.');
    return;
  }

  ensurePedidoDraft();
  if (!state.pedidoSemanalActual) {
    toast('Primero cargá la semana.');
    return;
  }

  const isMoron = state.perfil?.fabrica === 'moron' && state.perfil?.rol !== 'gerencia';
  const isAlvear = state.perfil?.fabrica === 'alvear' && state.perfil?.rol !== 'gerencia';
  const isGerencia = state.perfil?.rol === 'gerencia';

  if (isMoron && state.pedidoSemanalActual.moronLocked) {
    toast('Morón ya confirmó esta semana y no puede modificarla.');
    return;
  }

  if (isAlvear && state.pedidoSemanalActual.alvearConfirmado) {
    toast('La semana ya está cerrada.');
    return;
  }

  const id = getWeekDocId(monthValue, weekMeta.key);
  const ref = doc(db, 'pedidos_semanales', id);
  const currentRows = normalizeWeeklyRows(state.pedidoSemanalActual.rows || [], getWeeklyProducts());

  const payload = {
    monthValue,
    weekKey: weekMeta.key,
    weekLabel: weekMeta.label,
    weekStart: weekMeta.start,
    weekEnd: weekMeta.end,
    moronLocked: isGerencia ? !!state.pedidoSemanalActual.moronLocked : (isMoron ? true : !!state.pedidoSemanalActual.moronLocked),
    alvearConfirmado: !!state.pedidoSemanalActual.alvearConfirmado,
    updatedBy: state.currentUser?.email || '',
    updatedAtText: new Date().toISOString(),
    updatedAt: serverTimestamp(),
    rows: currentRows
  };

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
      createdBy: state.currentUser?.email || ''
    });
  }

  state.pedidoSemanalActual = {
    id,
    ...payload
  };

  if (isMoron) toast('✅ Pedido confirmado y enviado a Alvear.');
  else toast('Pedido semanal guardado.');
  await refreshAll();
  renderPedidoSemanal();
}

function handlePedidoFieldChange(rowIndex, fieldKey, newValue) {
  ensurePedidoDraft();
  if (!state.pedidoSemanalActual) return;

  const visibleRows = getPedidoSemanalRowsForView(state.pedidoSemanalActual.rows || []);
  const visibleRow = visibleRows[rowIndex];
  if (!visibleRow) return;

  const realIndex = state.pedidoSemanalActual.rows.findIndex((r) => r.productoId === visibleRow.productoId);
  if (realIndex < 0) return;

  const row = state.pedidoSemanalActual.rows[realIndex];
  const oldValue = row[fieldKey] ?? '';

  let normalizedNewValue = newValue;

  if ([
    'moronPedidoChica',
    'moronPedidoGrande',
    'moronCantidad',
    'alvearCantidadEntregada'
  ].includes(fieldKey)) {
    normalizedNewValue = num(newValue);
  } else if ([
    'entregadoChica',
    'entregadoGrande'
  ].includes(fieldKey)) {
    normalizedNewValue = !!newValue;
  } else if (fieldKey === 'alvearMotivos') {
    normalizedNewValue = Array.isArray(newValue) ? newValue : [];
  } else {
    normalizedNewValue = String(newValue || '');
  }

  row[fieldKey] = normalizedNewValue;

  const actor = state.perfil?.nombre || state.currentUser?.email || 'Usuario';
  pushWeeklyHistory(row, fieldKey, oldValue, normalizedNewValue, actor);

  state.pedidoSemanalSelectedRow = rowIndex;
  renderPedidoSemanal();
}

function renderPedidoSemanal() {
  const table = $('tablaPedidoSemanal');
  const historyBox = $('pedidoSemanalHistorial');
  const statusBox = $('pedidoEstado');

  if (!table) return;

  if (!state.pedidoSemanas.length) {
    refreshPedidoWeeks();
  }

  if (statusBox) {
    statusBox.textContent = getPedidoEstadoText();
  }

  const allRows = state.pedidoSemanalActual?.rows || buildDefaultWeeklyRows(getWeeklyProducts());
  const rows = getPedidoSemanalRowsForView(allRows);
  const viewMode = getPedidoSemanalViewMode();
  const alvearConfirmado = !!state.pedidoSemanalActual?.alvearConfirmado;

  // Botón confirmar Alvear
  const btnConfirmarContainer = $('btnConfirmarAlvear');
  if (btnConfirmarContainer) {
    const mostrar = (viewMode === 'alvear' || viewMode === 'gerencia')
      && !!state.pedidoSemanalActual?.moronLocked
      && !alvearConfirmado;
    btnConfirmarContainer.style.display = mostrar ? 'block' : 'none';
  }

  renderPedidoSemanalTable(table, {
    rows,
    viewMode,
    canEditField: canEditPedidoField,
    selectedRowIndex: state.pedidoSemanalSelectedRow,
    onFieldChange: handlePedidoFieldChange,
    onSelectHistory: (rowIndex) => {
      state.pedidoSemanalSelectedRow = rowIndex;
      renderPedidoSemanal();
    },
    alvearConfirmado
  });

  const selectedRow = typeof state.pedidoSemanalSelectedRow === 'number'
    ? rows[state.pedidoSemanalSelectedRow]
    : null;

  renderPedidoSemanalHistory(historyBox, selectedRow);

  // Calendario semanal
  const calendario = $('pedidoCalendario');
  if (calendario) {
    const monthValue = $('pedidoMes')?.value || '';
    renderWeekCalendar(calendario, state.pedidoSemanas, state.pedidosSemanalesCache || {}, monthValue);
  }
}


/* ================================================================
   PRODUCTIVIDAD ALVEAR — panel en dashboard (gerencia only)
================================================================ */

function renderDashboardProductividad() {
  const prod = computeProductividadAlvear(state.pedidosSemanalesCache || {});

  if ($('statTotalPedido')) $('statTotalPedido').textContent = prod.totalPedido;
  if ($('statTotalEntregado')) $('statTotalEntregado').textContent = prod.totalEntregado;
  if ($('statPorcentaje')) $('statPorcentaje').textContent = `${prod.porcentajeGlobal}%`;
  if ($('statSemanasCompletas')) $('statSemanasCompletas').textContent = `${prod.semanasCompletas} / ${prod.semanasCerradas}`;

  const motivosEl = $('dashMotivosContent');
  if (motivosEl) {
    const motivos = Object.entries(prod.motivosTotales).sort((a, b) => b[1] - a[1]);
    if (!motivos.length) {
      motivosEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">Sin motivos registrados.</div>';
    } else {
      motivosEl.innerHTML = motivos.map(([motivo, count]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);">
          <span style="font-size:13px;">${motivo}</span>
          <span style="font-weight:700;color:#ff5a5a;">${count}</span>
        </div>
      `).join('');
    }
  }
}

/* ================================================================
   CONFIRMAR ENTREGA ALVEAR — cierra la semana
================================================================ */

async function confirmarEntregaAlvear() {
  const monthValue = $('pedidoMes')?.value;
  const weekMeta = getSelectedWeekMeta();
  if (!monthValue || !weekMeta) { toast('Seleccioná mes y semana.'); return; }

  ensurePedidoDraft();
  if (!state.pedidoSemanalActual) { toast('Primero cargá la semana.'); return; }

  const isAlvear = state.perfil?.fabrica === 'alvear' && state.perfil?.rol !== 'gerencia';
  const isGerencia = state.perfil?.rol === 'gerencia';
  if (!isAlvear && !isGerencia) { toast('Solo Alvear puede confirmar la entrega.'); return; }

  if (!confirm('¿Confirmás la entrega de esta semana? Una vez confirmada no podrás modificar los datos.')) return;

  const id = getWeekDocId(monthValue, weekMeta.key);
  const ref = doc(db, 'pedidos_semanales', id);
  const currentRows = normalizeWeeklyRows(state.pedidoSemanalActual.rows || [], getWeeklyProducts());

  const payload = {
    ...state.pedidoSemanalActual,
    alvearConfirmado: true,
    alvearConfirmadoPor: state.currentUser?.email || '',
    alvearConfirmadoEn: new Date().toISOString(),
    updatedAt: serverTimestamp(),
    rows: currentRows
  };

  // Eliminar campos no serializables
  delete payload.id;

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
  }

  state.pedidoSemanalActual = { id, ...payload };
  toast('✅ Semana cerrada. El calendario se actualizará.');
  await refreshAll();
  renderPedidoSemanal();
}

/* ================================================================
   REPORTES — filtros y tabla
================================================================ */

function renderReportesFiltros() {
  const selectCat = $('reporteCategoria');
  if (selectCat) {
    const categorias = [...new Set(
      state.productos.filter((p) => p.categoria).map((p) => p.categoria)
    )].sort();
    const current = selectCat.value;
    selectCat.innerHTML = '<option value="">Todas las categorías</option>' +
      categorias.map((c) => `<option value="${c}" ${c === current ? 'selected' : ''}>${c}</option>`).join('');
  }
}

function renderReportes() {
  const categoria = $('reporteCategoria')?.value || '';
  const mes = $('reporteMes')?.value || '';

  const docs = Object.values(state.pedidosSemanalesCache || {});
  const filteredDocs = docs.filter((d) => !mes || (d.monthValue || d.id || '').startsWith(mes));

  const filas = [];

  filteredDocs
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
    .forEach((docData) => {
      (docData.rows || []).forEach((row) => {
        const ped = num(row.moronCantidad ?? row.moronPedidoChica ?? 0);
        if (ped === 0) return;
        if (categoria && row.categoria !== categoria) return;

        const ent = num(row.alvearCantidadEntregada ?? 0);
        const pct = ped > 0 ? Math.round((ent / ped) * 100) : 0;
        const motivos = Array.isArray(row.alvearMotivos) ? row.alvearMotivos.join(', ') : '';

        let estadoLabel = '📝 Sin confirmar';
        let estadoColor = 'var(--muted)';
        if (docData.alvearConfirmado) {
          if (ent >= ped) { estadoLabel = '✅ Completo'; estadoColor = '#3ddc97'; }
          else { estadoLabel = '❌ Incompleto'; estadoColor = '#ff5a5a'; }
        } else if (docData.moronLocked) {
          estadoLabel = '⏳ En proceso'; estadoColor = '#ffd166';
        }

        filas.push({ docData, row, ped, ent, pct, motivos, estadoLabel, estadoColor });
      });
    });

  const tbody = $('tablaReportesBody');
  if (tbody) {
    tbody.innerHTML = filas.map((f) => `
      <tr>
        <td>${f.docData.weekLabel || f.docData.weekKey || f.docData.id}</td>
        <td style="font-weight:600;">${f.row.productoNombre || '-'}</td>
        <td style="color:var(--muted);">${f.row.categoria || '-'}</td>
        <td style="text-align:center;font-weight:700;">${f.ped}</td>
        <td style="text-align:center;">${f.ent}</td>
        <td style="text-align:center;font-weight:700;color:${f.pct >= 100 ? '#3ddc97' : f.pct >= 50 ? '#ffd166' : '#ff5a5a'};">${f.pct}%</td>
        <td style="font-size:12px;color:var(--muted);">${f.motivos || '—'}</td>
        <td style="font-weight:600;color:${f.estadoColor};">${f.estadoLabel}</td>
      </tr>
    `).join('') || '<tr><td colspan="8" style="color:var(--muted);">Sin datos para los filtros seleccionados.</td></tr>';
  }

  // Productividad en sección reportes (gerencia)
  if (state.perfil?.rol === 'gerencia') {
    const prod = computeProductividadAlvear(state.pedidosSemanalesCache || {});

    const prodContent = $('productividadContent');
    if (prodContent) {
      prodContent.innerHTML = `
        <div class="summary-boxes">
          <div class="mini-stat"><span>Total pedido</span><strong>${prod.totalPedido}</strong></div>
          <div class="mini-stat"><span>Total entregado</span><strong>${prod.totalEntregado}</strong></div>
          <div class="mini-stat"><span>% cumplimiento</span><strong style="color:${prod.porcentajeGlobal >= 90 ? '#3ddc97' : prod.porcentajeGlobal >= 60 ? '#ffd166' : '#ff5a5a'}">${prod.porcentajeGlobal}%</strong></div>
          <div class="mini-stat"><span>Semanas completas</span><strong>${prod.semanasCompletas} / ${prod.semanasCerradas}</strong></div>
        </div>
      `;
    }

    const motivosContent = $('motivosContent');
    if (motivosContent) {
      const motivos = Object.entries(prod.motivosTotales).sort((a, b) => b[1] - a[1]);
      motivosContent.innerHTML = motivos.length
        ? motivos.map(([m, c]) => `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);">
            <span style="font-size:13px;">${m}</span>
            <span style="font-weight:700;color:#ff5a5a;">${c}</span>
          </div>`).join('')
        : '<div style="color:var(--muted);font-size:13px;">Sin motivos registrados.</div>';
    }
  }
}


/* ================================================================
   FILTRO CATEGORÍA EN CARGA DIARIA — solo visible para Morón
================================================================ */

function _actualizarSelectCategoriaCarga() {
  const sel = $('cargaCategoriaFilter');
  if (!sel) return;

  const fabrica = $('cargaFabrica')?.value || state.perfil?.fabrica || '';
  const isMoronUser = (fabrica === 'moron') && state.perfil?.rol !== 'gerencia';

  const wrapper = $('cargaCategoriaWrapper');
  if (wrapper) wrapper.style.display = isMoronUser ? '' : 'none';

  if (!isMoronUser) return;

  const categorias = [...new Set(
    getProductosParaFabrica(fabrica)
      .filter((p) => p.categoria)
      .map((p) => p.categoria)
  )].sort();

  const current = sel.value;
  sel.innerHTML = '<option value="">Todas las categorías</option>' +
    categorias.map((c) => `<option value="${c}" ${c === current ? 'selected' : ''}>${c}</option>`).join('');
}

/* ================================================================
   CARGA MASIVA DE CATEGORÍAS EN PRODUCTOS
================================================================ */

function procesarCargaMasivaCategorias() {
  const file = $('fileCargaCategorias')?.files?.[0];
  if (!file) { toast('Seleccioná un archivo.'); return; }

  const reader = new FileReader();
  reader.onload = async function(e) {
    const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) { toast('Excel vacío.'); return; }

    const headers = rows[0].map((h) =>
      String(h || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
    );

    const idxProducto = headers.indexOf('PRODUCTO');
    const idxCategoria = headers.indexOf('CATEGORIA');

    if (idxProducto < 0 || idxCategoria < 0) {
      toast('El Excel debe tener columnas PRODUCTO y CATEGORIA.');
      return;
    }

    let actualizados = 0;

    for (let i = 1; i < rows.length; i++) {
      const nombreExcel = String(rows[i][idxProducto] || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
      const categoriaExcel = String(rows[i][idxCategoria] || '').trim();

      if (!nombreExcel) continue;

      const producto = state.productos.find((p) =>
        String(p.nombre || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase() === nombreExcel
      );

      if (!producto) continue;

      try {
        await updateDoc(doc(db, 'productos', producto.id), { categoria: categoriaExcel });
        actualizados++;
      } catch (err) {
        console.error('Error actualizando', producto.nombre, err);
      }
    }

    toast(`${actualizados} categorías actualizadas.`);
    await refreshAll();
  };

  reader.readAsArrayBuffer(file);
}


/* ================================================================
   AUTO-SAVE — guarda silenciosamente como borrador
================================================================ */
async function _autoGuardarReporte() {
  if (!state.reporteActual || currentReporteIsLocked()) return;

  const fecha = $('cargaFecha')?.value;
  let fabrica = $('cargaFabrica')?.value;
  if (!fabrica && state.perfil?.fabrica) fabrica = state.perfil.fabrica;
  if (!fecha || !fabrica) return;

  const id = getReporteId(fecha, fabrica);
  const ref = doc(db, 'reportes_diarios', id);
  const snap = await getDoc(ref);

  // No auto-save si ya fue publicada y el usuario no es gerencia
  if (snap.exists()) {
    const data = snap.data();
    if (data.estado === 'enviada' && state.perfil?.rol !== 'gerencia') return;
  }

  const payload = {
    fecha,
    fabrica,
    estado: 'borrador',
    creadoPor: state.currentUser?.email || '',
    actualizadoEnTexto: new Date().toISOString(),
    actualizadoEn: serverTimestamp(),
    rows: state.reporteActual.rows.map(normalizeExistingRow)
  };

  if (!snap.exists()) {
    await setDoc(ref, { ...payload, creadoEn: serverTimestamp() });
  } else {
    await updateDoc(ref, payload);
  }

  state.reporteActual.estado = 'borrador';
  state.reporteActual.idYaExistia = true;

  // Indicador visual silencioso
  const estadoEl = $('estadoCarga');
  if (estadoEl) {
    const orig = estadoEl.innerHTML;
    estadoEl.innerHTML = `<span class="estado-pill estado-guardando">💾 Guardando…</span>`;
    setTimeout(() => { renderCargaDiaria(); }, 800);
  }
}

/* ================================================================
   VOLVER A BORRADOR — solo gerencia
================================================================ */
async function volverABorrador() {
  if (state.perfil?.rol !== 'gerencia') {
    toast('Solo gerencia puede volver a borrador.');
    return;
  }
  if (!state.reporteActual) {
    toast('Cargá primero la planilla.');
    return;
  }

  const fecha = $('cargaFecha')?.value;
  let fabrica = $('cargaFabrica')?.value;
  if (!fabrica && state.perfil?.fabrica) fabrica = state.perfil.fabrica;

  const id = getReporteId(fecha, fabrica);
  const ref = doc(db, 'reportes_diarios', id);

  await updateDoc(ref, {
    estado: 'borrador',
    actualizadoEnTexto: new Date().toISOString(),
    actualizadoEn: serverTimestamp()
  });

  state.reporteActual.estado = 'borrador';
  state.reporteActual.idYaExistia = true;

  toast('Planilla vuelta a borrador. Ahora podés editarla.');
  renderCargaDiaria();
}

/* ================================================================
   STOCK INICIAL — plantilla y carga masiva
================================================================ */
function descargarPlantillaStockInicial() {
  const fecha = $('cargaFecha')?.value;
  let fabrica = $('cargaFabrica')?.value;
  if (!fabrica && state.perfil?.fabrica) fabrica = state.perfil.fabrica;

  if (!fabrica) { toast('Seleccioná fábrica primero.'); return; }

  const productos = getProductosParaFabrica(fabrica);

  // Headers: PRODUCTO + las 8 columnas de stock inicial
  const headers = ['PRODUCTO', ...INITIAL_STOCK_COLUMNS.map((c) => c.key)];
  const rows = [
    headers,
    ...productos.map((p) => {
      const row = new Array(headers.length).fill(0);
      row[0] = p.nombre;
      return row;
    })
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'StockInicial');
  XLSX.writeFile(wb, `stock_inicial_${fabrica}_${fecha || 'plantilla'}.xlsx`);
}

function procesarCargaMasivaStockInicial() {
  const file = $('fileStockInicial')?.files?.[0];
  if (!file) { toast('Seleccioná un archivo Excel.'); return; }

  let fabrica = $('cargaFabrica')?.value;
  if (!fabrica && state.perfil?.fabrica) fabrica = state.perfil.fabrica;
  const fecha = $('cargaFecha')?.value;

  if (!fabrica || !fecha) { toast('Seleccioná fecha y fábrica primero.'); return; }

  // Crear draft si no existe
  if (!state.reporteActual) {
    const monthValue = String(fecha).slice(0, 7);
    let rows = buildDefaultRows(fabrica);
    rows = applyPreviousMonthInitialStock(rows, monthValue);
    state.reporteActual = {
      id: getReporteId(fecha, fabrica),
      fecha, fabrica,
      estado: 'borrador',
      creadoPor: state.currentUser?.email || '',
      idYaExistia: false,
      rows
    };
  }

  const normalizeStr = (v) => String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

  const reader = new FileReader();
  reader.onload = function(e) {
    const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: 0 });

    if (rows.length < 2) { toast('Excel vacío.'); return; }

    const headers = rows[0].map((h) => normalizeStr(h));
    const idxProducto = headers.indexOf('PRODUCTO');
    if (idxProducto < 0) { toast('Falta columna PRODUCTO.'); return; }

    // Mapear columnas de stock
    const colMap = {};
    INITIAL_STOCK_COLUMNS.forEach((col) => {
      const idx = headers.indexOf(normalizeStr(col.key));
      if (idx >= 0) colMap[col.key] = idx;
    });

    const productoMap = new Map();
    state.reporteActual.rows.forEach((r, i) => {
      productoMap.set(normalizeStr(r.productoNombre), i);
    });

    let actualizados = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const nombre = normalizeStr(row[idxProducto]);
      if (!nombre) continue;

      const idx = productoMap.get(nombre);
      if (idx === undefined) continue;

      Object.entries(colMap).forEach(([key, colIdx]) => {
        const val = Number(row[colIdx] || 0);
        state.reporteActual.rows[idx].stockInicial[key] = val;
      });

      actualizados++;
    }

    renderCargaDiaria();
    if ($('estadoStockInicial')) {
      $('estadoStockInicial').textContent = `✅ ${actualizados} productos actualizados. Guardá la planilla para confirmar.`;
    }
    toast(`Stock inicial cargado para ${actualizados} productos.`);
  };
  reader.readAsArrayBuffer(file);
}


/* ================================================================
   BACKUP — PDF del Excel de gerencia
================================================================ */
function renderBackupPanel() {
  const panel = $('backupPanel');
  if (!panel) return;

  const meses = [...new Set(state.reportes.map((r) => r.fecha?.slice(0,7)).filter(Boolean))].sort().reverse();

  panel.innerHTML = `
    <div style="display:grid;gap:14px;">
      <div class="field">
        <label for="backupMes">Mes a exportar</label>
        <select id="backupMes" style="max-width:220px;">
          ${meses.map((m) => `<option value="${m}">${m}</option>`).join('')}
        </select>
      </div>
      <div class="actions-row">
        <button id="btnGenerarPDF" class="btn btn-primary" type="button">⬇ Generar PDF</button>
        <button id="btnDescargarJSON" class="btn btn-outline" type="button">⬇ Descargar JSON (respaldo completo)</button>
      </div>
      <div class="hint-box">
        El PDF exporta la vista del Excel de gerencia del mes seleccionado.
        El JSON incluye todos los datos de Firestore para restauración completa.
      </div>
    </div>
  `;

  $('btnGenerarPDF')?.addEventListener('click', () => generarPDFGerencia());
  $('btnDescargarJSON')?.addEventListener('click', () => descargarJSONBackup());
}

function generarPDFGerencia() {
  const mesEl = $('backupMes');
  const mes = mesEl?.value || $('mesGerencia')?.value;

  if (!mes) { toast('Seleccioná un mes.'); return; }

  // Setear el mes en el select de gerencia y renderizar
  if ($('mesGerencia')) $('mesGerencia').value = mes;
  renderGerenciaExcel();

  // Abrir ventana de impresión después de un tick
  setTimeout(() => {
    const tabla = $('tablaGerenciaExcel');
    if (!tabla) { toast('No hay datos para exportar.'); return; }

    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Excel Gerencia ${mes}</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 10px; color: #000; background: #fff; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: center; white-space: nowrap; }
          th { background: #e8e8e8; font-weight: bold; }
          .sticky-col { font-weight: bold; text-align: left; background: #f5f5f5; }
          @page { size: landscape; margin: 10mm; }
          @media print { body { -webkit-print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <h2 style="margin-bottom:8px;">Excel Gerencia · ${mes}</h2>
        <p style="color:#666;margin-bottom:12px;font-size:11px;">Generado: ${new Date().toLocaleString('es-AR')}</p>
        ${tabla.outerHTML}
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  }, 300);
}

function descargarJSONBackup() {
  const backup = {
    fecha: new Date().toISOString(),
    productos: state.productos,
    usuarios: state.usuarios.map((u) => ({ ...u, email: u.email })),
    reportes: state.reportes,
    pedidosSemanales: Object.values(state.pedidosSemanalesCache || {})
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_varillas_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup JSON descargado.');
}

async function seedBaseData() {
  return;
}

async function refreshAll() {
  state.productos = (await loadCollection('productos'))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));

  state.usuarios = await loadCollection('usuarios');
  state.reportes = (await loadCollection('reportes_diarios')).map((reporte) => ({
    ...reporte,
    rows: (reporte.rows || []).map(normalizeExistingRow)
  }));

 const pedidosSemanales = await loadCollection('pedidos_semanales');
  state.pedidosSemanalesCache = {};
  pedidosSemanales.forEach((item) => {
    state.pedidosSemanalesCache[item.id] = item;
  });

  state.alertas = computeAlvearMoronAlerts(state.reportes, state.productos);

  renderDashboard();
  renderProductos();
  renderUsuarios();
  renderCargaDiaria();
  _actualizarSelectCategoriaCarga();
  renderGerenciaExcel();
  renderPedidoSemanal();

  renderGerenciaMenuBadge(state.alertas);
  renderGerenciaAlertsPanel(state.alertas);
  renderReportesFiltros();
}

function bindEvents() {
  if (els.loginForm) {
    els.loginForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();

      try {
        const cred = await signInWithEmailAndPassword(auth, $('email')?.value, $('password')?.value);
        console.log('LOGIN OK:', cred.user?.email);
        toast('Sesión iniciada correctamente.');
      } catch (error) {
        console.error('ERROR LOGIN:', error);
        toast(`Error login: ${error.code || error.message}`);
      }
    });
  }

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', async () => {
      await signOut(auth);
    });
  }

  $('formProducto')?.addEventListener('submit', registrarProducto);
  $('btnCargarReporte')?.addEventListener('click', cargarReporteDiario);
  $('btnGuardarReporte')?.addEventListener('click', () => guardarReporte('borrador'));
  $('btnEnviarReporte')?.addEventListener('click', () => guardarReporte('enviada'));

  $('btnRefrescarGerencia')?.addEventListener('click', () => {
    renderGerenciaExcel();
    state.alertas = computeAlvearMoronAlerts(state.reportes, state.productos);
    renderGerenciaMenuBadge(state.alertas);
    renderGerenciaAlertsPanel(state.alertas);
    renderDashboard();
  });

  $('cargaFecha')?.addEventListener('change', () => {
    state.reporteActual = null;
    renderCargaDiaria();
    _actualizarSelectCategoriaCarga();
  });

  // Búsqueda de aroma en carga diaria
  document.addEventListener('input', (e) => {
    if (e.target?.id === 'cargaAromaSearch') {
      state.cargaAromaFilter = e.target.value;
      renderCargaDiaria();
    }
  });

  $('cargaFabrica')?.addEventListener('change', () => {
    state.reporteActual = null;
    state.cargaCategoriaFilter = '';
    state.cargaAromaFilter = '';
    const sel = $('cargaCategoriaFilter');
    if (sel) sel.value = '';
    const inp = $('cargaAromaSearch');
    if (inp) inp.value = '';
    renderCargaDiaria();
    _actualizarSelectCategoriaCarga();
  });

  document.addEventListener('change', (e) => {
    if (e.target?.id === 'cargaCategoriaFilter') {
      state.cargaCategoriaFilter = e.target.value;
      renderCargaDiaria();
    }
  });

  $('pedidoMes')?.addEventListener('change', () => {
    state.pedidoSemanalActual = null;
    state.pedidoSemanalSelectedRow = null;
    refreshPedidoWeeks();
    renderPedidoSemanal();
  });

  $('pedidoSemana')?.addEventListener('change', () => {
    state.pedidoSemanalActual = null;
    state.pedidoSemanalSelectedRow = null;
    renderPedidoSemanal();
  });

  $('btnCargarPedidoSemanal')?.addEventListener('click', cargarPedidoSemanal);
  $('btnGuardarPedidoSemanal')?.addEventListener('click', guardarPedidoSemanal);

  // Botón confirmar Alvear — se inserta dinámicamente en el HTML
  document.addEventListener('click', (e) => {
    if (e.target?.id === 'btnConfirmarPedidoAlvear') confirmarEntregaAlvear();
  });

  $('btnGenerarReporte')?.addEventListener('click', renderReportes);
  $('reporteCategoria')?.addEventListener('change', renderReportes);
  $('reporteMes')?.addEventListener('change', renderReportes);

  els.menuBtn?.addEventListener('click', () => {
    els.sidebar?.classList.toggle('open');
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.currentUser = null;
    state.perfil = null;
    state.reporteActual = null;
    state.alertas = [];
    state.pedidoSemanas = [];
    state.pedidoSemanalActual = null;
    state.pedidoSemanalSelectedRow = null;
    state.pedidosSemanalesCache = {};
    setLoggedUI(false);
    return;
  }

  state.currentUser = user;

  try {
    await seedBaseData();

    state.perfil = await fetchPerfil(user.email);

    if (!state.perfil) {
      toast('El login funcionó, pero falta tu usuario en Firestore/usuarios.');
      await signOut(auth);
      setLoggedUI(false);
      return;
    }

    if (state.perfil.activo === false) {
      toast('Tu usuario está inactivo en Firestore.');
      await signOut(auth);
      setLoggedUI(false);
      return;
    }

    setLoggedUI(true);
    fillUserCard();
    applyRoleUI();

    if ($('cargaFabrica') && state.perfil?.rol !== 'gerencia' && state.perfil?.fabrica) {
      $('cargaFabrica').value = state.perfil.fabrica;
    }

    setMonthlyDefault();
    await refreshAll();
    setSection('dashboard');
  } catch (error) {
    console.error('ERROR CARGANDO SISTEMA:', error);
    toast(`Error sistema: ${error.code || error.message || error}`);
  }
});

mountNavigation();
bindEvents();

/* =========================================================
   app.js COMPLETO + CARGA MASIVA EXCEL
   PEGAR AL FINAL DE TU app.js ACTUAL
   (NO reemplaza todo tu sistema, agrega funcionalidad)
========================================================= */

/* =========================================================
   CONFIG CARGA MASIVA
========================================================= */

const MASS_UPLOAD_COLUMN_MAPS = {
  alvear: {
    alv: ['ALV'],
    cajaChica: {
      alvPlus: ['ALV_PLUS_CH'],
      alvMinus: ['ALV_MINUS_CH'],
      dif: ['DIF_CH']
    },
    cajaGrandeAlv: {
      alvPlus: ['ALV_PLUS_GR'],
      alvMinus: ['ALV_MINUS_GR'],
      dif: ['DIF_GR']
    }
  },

  banado: {
    banadoChica: {
      banadoPlus: ['BANADO_PLUS_CH'],
      secando: ['SECANDO_CH'],
      cosecha: ['COSECHA_CH'],
      salida: ['SALIDA_CH'],
      dif: ['DIF_CH']
    },
    banadoGrande: {
      banadoPlus: ['BANADO_PLUS_GR'],
      secando: ['SECANDO_GR'],
      cosecha: ['COSECHA_GR'],
      salida: ['SALIDA_GR'],
      dif: ['DIF_GR']
    }
  },

  moron: {
    moronChicaInterna: {
      totalBase: ['TOTAL_BASE_CH'],
      entrada: ['ENTRADA_CH'],
      sobrante: ['SOBRANTE_CH'],
      pEmpaq: ['P_EMPAQ_CH'],
      diferencia: ['DIFERENCIA_CH'],
      fallados: ['FALLADOS_CH'],
      devoluciones: ['DEVOLUCIONES_CH']
    },

    moronGrandeInterna: {
      totalBase: ['TOTAL_BASE_GR'],
      entrada: ['ENTRADA_GR'],
      sobrante: ['SOBRANTE_GR'],
      pEmpaq: ['P_EMPAQ_GR'],
      diferencia: ['DIFERENCIA_GR'],
      fallados: ['FALLADOS_GR'],
      devoluciones: ['DEVOLUCIONES_GR']
    }
  }
};


/* =========================================================
   HELPERS
========================================================= */

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function normalizeProduct(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function numExcel(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function findHeader(headers, aliases = []) {
  const normalized = headers.map(normalizeHeader);

  for (const alias of aliases) {
    const idx = normalized.indexOf(normalizeHeader(alias));
    if (idx >= 0) return idx;
  }

  return -1;
}

function getCurrentFactory() {
  let fabrica = $('cargaFabrica')?.value;

  if (!fabrica && state.perfil?.fabrica) {
    fabrica = state.perfil.fabrica;
  }

  return fabrica;
}


/* =========================================================
   CREAR BORRADOR SI NO EXISTE
========================================================= */

function ensureMassiveDraft() {
  const fecha = $('cargaFecha')?.value;
  const fabrica = getCurrentFactory();

  if (!fecha || !fabrica) {
    toast('Seleccioná fecha y fábrica.');
    return false;
  }

  if (!state.reporteActual) {
    state.reporteActual = {
      id: `${fecha}_${fabrica}`,
      fecha,
      fabrica,
      estado: 'borrador',
      rows: buildDefaultRows(fabrica)
    };
  }

  return true;
}


/* =========================================================
   DESCARGAR PLANTILLA
========================================================= */

function getTemplateHeaders(fabrica) {

  if (fabrica === 'alvear') {
    return [
      'PRODUCTO',
      'ALV',
      'ALV_PLUS_CH',
      'ALV_MINUS_CH',
      'DIF_CH',
      'ALV_PLUS_GR',
      'ALV_MINUS_GR',
      'DIF_GR'
    ];
  }

  if (fabrica === 'banado') {
    return [
      'PRODUCTO',
      'BANADO_PLUS_CH',
      'SECANDO_CH',
      'COSECHA_CH',
      'SALIDA_CH',
      'DIF_CH',
      'BANADO_PLUS_GR',
      'SECANDO_GR',
      'COSECHA_GR',
      'SALIDA_GR',
      'DIF_GR'
    ];
  }

  if (fabrica === 'moron') {
    return [
      'PRODUCTO',
      'TOTAL_BASE_CH',
      'ENTRADA_CH',
      'SOBRANTE_CH',
      'P_EMPAQ_CH',
      'DIFERENCIA_CH',
      'FALLADOS_CH',
      'DEVOLUCIONES_CH',
      'TOTAL_BASE_GR',
      'ENTRADA_GR',
      'SOBRANTE_GR',
      'P_EMPAQ_GR',
      'DIFERENCIA_GR',
      'FALLADOS_GR',
      'DEVOLUCIONES_GR'
    ];
  }

  return ['PRODUCTO'];
}

function descargarPlantillaCargaMasiva() {

  const fabrica = getCurrentFactory();

  if (!fabrica) {
    toast('Seleccioná fábrica.');
    return;
  }

  const headers = getTemplateHeaders(fabrica);

  const productos = getProductosParaFabrica(fabrica);

  const rows = [
    headers,
    ...productos.map(p => {
      const row = new Array(headers.length).fill('');
      row[0] = p.nombre;
      return row;
    })
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, 'Carga');

  XLSX.writeFile(wb, `plantilla_${fabrica}.xlsx`);
}


/* =========================================================
   IMPORTAR EXCEL
========================================================= */

function procesarCargaMasivaExcel() {

  const file = $('fileCargaMasiva')?.files?.[0];
  const fabrica = getCurrentFactory();

  if (!file) {
    toast('Seleccioná archivo.');
    return;
  }

  if (!ensureMassiveDraft()) return;

  const reader = new FileReader();

  reader.onload = function(e) {

    const data = new Uint8Array(e.target.result);

    const workbook = XLSX.read(data, { type: 'array' });

    const ws = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: ''
    });

    if (rows.length < 2) {
      toast('Excel vacío.');
      return;
    }

    const headers = rows[0];

    const idxProducto = findHeader(headers, ['PRODUCTO']);

    if (idxProducto < 0) {
      toast('Debe existir columna PRODUCTO.');
      return;
    }

    const mapRows = new Map();

    state.reporteActual.rows.forEach((r, i) => {
      mapRows.set(normalizeProduct(r.productoNombre), i);
    });

    let cargados = 0;

    for (let i = 1; i < rows.length; i++) {

      const row = rows[i];

      const producto = normalizeProduct(row[idxProducto]);

      if (!producto) continue;

      const targetIndex = mapRows.get(producto);

      if (targetIndex === undefined) continue;

      const target = state.reporteActual.rows[targetIndex];

      if (fabrica === 'alvear') {

        const idxAlv = findHeader(headers, ['ALV']);
        if (idxAlv >= 0) target.groups.alvear.alv = numExcel(row[idxAlv]);

        target.groups.cajaChica.alvPlus =
          numExcel(row[findHeader(headers, ['ALV_PLUS_CH'])]);

        target.groups.cajaChica.alvMinus =
          numExcel(row[findHeader(headers, ['ALV_MINUS_CH'])]);

        target.groups.cajaChica.dif =
          numExcel(row[findHeader(headers, ['DIF_CH'])]);

        target.groups.cajaGrandeAlv.alvPlus =
          numExcel(row[findHeader(headers, ['ALV_PLUS_GR'])]);

        target.groups.cajaGrandeAlv.alvMinus =
          numExcel(row[findHeader(headers, ['ALV_MINUS_GR'])]);

        target.groups.cajaGrandeAlv.dif =
          numExcel(row[findHeader(headers, ['DIF_GR'])]);
      }

      if (fabrica === 'banado') {

        target.groups.banadoChica.banadoPlus =
          numExcel(row[findHeader(headers, ['BANADO_PLUS_CH'])]);

        target.groups.banadoChica.secando =
          numExcel(row[findHeader(headers, ['SECANDO_CH'])]);

        target.groups.banadoChica.cosecha =
          numExcel(row[findHeader(headers, ['COSECHA_CH'])]);

        target.groups.banadoChica.salida =
          numExcel(row[findHeader(headers, ['SALIDA_CH'])]);

        target.groups.banadoChica.dif =
          numExcel(row[findHeader(headers, ['DIF_CH'])]);

        target.groups.banadoGrande.banadoPlus =
          numExcel(row[findHeader(headers, ['BANADO_PLUS_GR'])]);

        target.groups.banadoGrande.secando =
          numExcel(row[findHeader(headers, ['SECANDO_GR'])]);

        target.groups.banadoGrande.cosecha =
          numExcel(row[findHeader(headers, ['COSECHA_GR'])]);

        target.groups.banadoGrande.salida =
          numExcel(row[findHeader(headers, ['SALIDA_GR'])]);

        target.groups.banadoGrande.dif =
          numExcel(row[findHeader(headers, ['DIF_GR'])]);
      }

      if (fabrica === 'moron') {

        target.groups.moronChicaInterna.totalBase =
          numExcel(row[findHeader(headers, ['TOTAL_BASE_CH'])]);

        target.groups.moronChicaInterna.entrada =
          numExcel(row[findHeader(headers, ['ENTRADA_CH'])]);

        target.groups.moronChicaInterna.sobrante =
          numExcel(row[findHeader(headers, ['SOBRANTE_CH'])]);

        target.groups.moronChicaInterna.pEmpaq =
          numExcel(row[findHeader(headers, ['P_EMPAQ_CH'])]);

        target.groups.moronChicaInterna.diferencia =
          numExcel(row[findHeader(headers, ['DIFERENCIA_CH'])]);

        target.groups.moronGrandeInterna.totalBase =
          numExcel(row[findHeader(headers, ['TOTAL_BASE_GR'])]);

        target.groups.moronGrandeInterna.entrada =
          numExcel(row[findHeader(headers, ['ENTRADA_GR'])]);

        target.groups.moronGrandeInterna.sobrante =
          numExcel(row[findHeader(headers, ['SOBRANTE_GR'])]);

        target.groups.moronGrandeInterna.pEmpaq =
          numExcel(row[findHeader(headers, ['P_EMPAQ_GR'])]);

        target.groups.moronGrandeInterna.diferencia =
          numExcel(row[findHeader(headers, ['DIFERENCIA_GR'])]);
      }

      cargados++;
    }

    renderCargaDiaria();

    $('estadoCargaMasiva').textContent =
      `Importación correcta. ${cargados} productos cargados.`;

    toast('Carga masiva completada.');
  };

  reader.readAsArrayBuffer(file);
}


/* =========================================================
   EVENTOS
========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  $('btnDescargarPlantillaCarga')
    ?.addEventListener('click', descargarPlantillaCargaMasiva);

  $('btnProcesarCargaMasiva')
    ?.addEventListener('click', procesarCargaMasivaExcel);

  $('btnProcesarCargaCategorias')
    ?.addEventListener('click', procesarCargaMasivaCategorias);
  $('btnDescargarStockInicial')
    ?.addEventListener('click', descargarPlantillaStockInicial);
  $('btnProcesarStockInicial')
    ?.addEventListener('click', procesarCargaMasivaStockInicial);

  // Filtros de la lista de productos
  document.addEventListener('change', (e) => {
    if (e.target?.id === 'filtroCategoriaProd') {
      state.productoFiltroCategoria = e.target.value;
      renderProductos();
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target?.id === 'filtroNombreProd') {
      state.productoFiltroNombre = e.target.value;
      renderProductos();
    }
  });

});
