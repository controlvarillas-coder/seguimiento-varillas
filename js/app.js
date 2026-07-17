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

/* ================================================================
   PERFORMANCE — cache de running totals y TTL de colecciones estáticas
================================================================ */
const _runningTotalCache = new Map();
function _invalidateRunningTotalCache() { _runningTotalCache.clear(); }

let _lastProductosLoad = 0;
let _lastUsuariosLoad  = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

const state = {
  currentUser: null,
  perfil: null,
  pedidoSemanalSoloConCantidad: false,  // filtro morón: solo productos con cantidad
  cargaSoloConMovimientos: false,        // filtro carga diaria: solo títulos cargados
  totalesSoloConValor: false,            // filtro totales: solo productos con valor > 0
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
  autoSaveTimer: null,
  stockMensualCache: {}   // { "2026-04": { [productoId]: {alvearChica, ...} } }
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
    key: 'linares',
    title: 'LINARES',
    colorClass: 'group-linares-chica',
    columns: [
      { key: 'lin',   label: 'LINARES ENTRADA' },
      { key: 'total', label: 'LINARES TOTAL', readonly: true }
    ]
  },
  {
    key: 'linaresChica',
    title: 'CAJA CHICA',
    colorClass: 'group-linares-chica',
    columns: [
      { key: 'linPlus',  label: 'LINARES ENTRADA' },
      { key: 'linMinus', label: 'LINARES SALIDA' },
      { key: 'dif',      label: 'LINARES DIFERENCIA' },
      { key: 'total',    label: 'LINARES TOTAL', readonly: true }
    ]
  },
  {
    key: 'linaresGrande',
    title: 'CAJA GRANDE',
    colorClass: 'group-linares-grande',
    columns: [
      { key: 'linPlus',  label: 'LINARES ENTRADA' },
      { key: 'linMinus', label: 'LINARES SALIDA' },
      { key: 'dif',      label: 'LINARES DIFERENCIA' },
      { key: 'total',    label: 'LINARES TOTAL', readonly: true }
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

const LINARES_INTERNAL_GROUPS = [
  {
    key: 'linaresChicaInterna',
    title: 'CAJA CHICA',
    colorClass: 'group-linares-chica',
    columns: [
      { key: 'linPlus', label: 'ENTRADA' },
      { key: 'total',   label: 'TOTAL', readonly: true }
    ]
  },
  {
    key: 'linaresGrandeInterna',
    title: 'CAJA GRANDE',
    colorClass: 'group-linares-grande',
    columns: [
      { key: 'linPlus', label: 'ENTRADA' },
      { key: 'total',   label: 'TOTAL', readonly: true }
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
  { key: 'banadoChica',   label: 'BAÑADO CAJA CHICA' },
  { key: 'banadoGrande',  label: 'BAÑADO CAJA GRANDE' },
  { key: 'linaresChica',  label: 'LINARES CAJA CHICA' },
  { key: 'linaresGrande', label: 'LINARES CAJA GRANDE' }
];

const INPUT_GROUP_BY_FABRICA = {
  caja_chica: ['alvear', 'cajaChica'],
  caja_grande: ['cajaGrandeAlv', 'cajaGrandeMor'],
  banado:   ['banadoChica', 'banadoGrande'],
  linares:  ['linares', 'linaresChica', 'linaresGrande'],
  alvear:   ['alvear', 'cajaChica', 'cajaGrandeAlv'],
  moron:    ['moronChicaInterna', 'moronGrandeInterna'],
  neutro:   []
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
    backup: 'Copia de seguridad',
    totales: 'Totales por fábrica'
  };

  if ($('pageTitle')) $('pageTitle').textContent = titles[sectionId] || 'Varillas Control';

  // Auto-cargar al entrar a Carga Diaria si hay una fecha seleccionada
  if (sectionId === 'carga') {
    const fechaActual = $('cargaFecha')?.value;
    if (fechaActual) {
      cargarReporteDiario();
    }
    // Scroll al top de la sección para que la fecha sea visible
    setTimeout(() => {
      $('cargaFecha')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  if (sectionId === 'pedido-semanal') {
    refreshPedidoWeeks();
    // Auto-cargar la semana actual si hay mes y semana seleccionados
    const semanaVal = $('pedidoSemana')?.value;
    const mesVal    = $('pedidoMes')?.value;
    if (mesVal && semanaVal) {
      cargarPedidoSemanal();
    } else {
      renderPedidoSemanal();
    }
  }

  if (sectionId === 'reportes') {
    renderReportesFiltros();
  }

  if (sectionId === 'totales') {
    renderTotales();
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

// Roles que SOLO deben ver el módulo de tercerizados
const ROLES_SOLO_TERC = ['control_calidad', 'planificacion', 'tercerizado'];

function applyRoleUI() {
  const rol = state.perfil?.rol;
  const isGerencia = rol === 'gerencia';
  const soloTerc = ROLES_SOLO_TERC.includes(rol);

  // Ocultar/mostrar items de gerencia
  document.querySelectorAll('.gerencia-only').forEach((el) => {
    el.classList.toggle('hidden', !isGerencia);
  });

  // Roles que solo usan tercerizados: ocultar TODO el nav excepto tercerizados
  document.querySelectorAll('.nav-link').forEach((el) => {
    const section = el.dataset.section;
    if (soloTerc) {
      if (section === 'tercerizados') {
        el.style.display = 'block'; // tercerizados-init.js lo muestra también
      } else {
        el.style.display = 'none';
      }
    } else {
      // Restaurar visibilidad normal (no tocar #nav-tercerizados, lo maneja init.js)
      if (section !== 'tercerizados') {
        el.style.display = '';
      }
    }
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

function normalizeRowsForCurrentProducts(rows = [], fabrica = '', fecha = '') {
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

      // Si el stock del documento guardado es todo cero, buscar en otros reportes del mes
      const tieneStock = Object.values(existing.stockInicial || {}).some((v) => num(v) !== 0);
      if (!tieneStock && fecha) {
        const stockReal = getStockInitialAcumulado(fecha, producto.id);
        const tieneStockReal = Object.values(stockReal).some((v) => num(v) !== 0);
        if (tieneStockReal) existing.stockInicial = stockReal;
      }

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

    case 'linares':
      return num(data.lin);

    case 'linaresChica':
    case 'linaresGrande':
      return num(data.linPlus) - num(data.linMinus) + num(data.dif);

    case 'banadoChica':
      return (
        num(data.banadoPlus) +
        // totalSecando NO se suma: es readonly (running total acumulado), sumar causaría doble conteo
        num(data.cosecha) -
        num(data.salida) +
        num(data.dif)
      );

    case 'banadoGrande':
      return (
        num(data.banadoPlus) +
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

    case 'linaresChicaInterna':
    case 'linaresGrandeInterna':
      return num(data.linPlus);

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

  if (state.perfil?.rol === 'gerencia') {
    renderDashboardProductividad();
  }

  // ── KPI cards interactivas ────────────────────────────────────────
  _bindDashboardKpiCards({
    hoy, productosActivos, usuariosActivos, usuariosOperativos,
    fabricasOperativas, reportesHoy, pendientesHoy
  });
}

/* ================================================================
   MODAL SISTEMA — KPI interactivos
================================================================ */
function _showDashModal(title, icon, color, contentHtml) {
  // Remover modal previo si existe
  const prev = document.getElementById('dash-kpi-modal');
  if (prev) prev.remove();

  const modal = document.createElement('div');
  modal.id = 'dash-kpi-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9000;
    background:rgba(0,0,0,.72);backdrop-filter:blur(6px);
    display:flex;align-items:center;justify-content:center;padding:24px;
    animation:fadeInModal .18s ease;
  `;

  modal.innerHTML = `
    <style>
      @keyframes fadeInModal{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
      @keyframes slideUpModal{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      #dash-kpi-modal-inner{animation:slideUpModal .2s ease}
      #dash-kpi-modal table{width:100%;border-collapse:collapse;font-size:13px}
      #dash-kpi-modal th{padding:8px 12px;text-align:left;font-size:10px;font-weight:700;
        letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.45);
        border-bottom:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03)}
      #dash-kpi-modal td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px}
      #dash-kpi-modal tbody tr:last-child td{border-bottom:none}
      #dash-kpi-modal tbody tr:hover td{background:rgba(255,255,255,.03)}
      #dash-kpi-modal .modal-empty{padding:24px;text-align:center;color:rgba(255,255,255,.3);font-size:13px}
    </style>
    <div id="dash-kpi-modal-inner" style="
      width:100%;max-width:640px;max-height:80vh;
      background:rgba(10,16,34,.98);
      border:1px solid rgba(255,255,255,.12);
      border-radius:22px;
      box-shadow:0 32px 80px rgba(0,0,0,.7);
      overflow:hidden;display:flex;flex-direction:column;
    ">
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.08);
        background:${color}12;
        flex-shrink:0;
      ">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:22px">${icon}</span>
          <div>
            <div style="font-size:16px;font-weight:800;color:${color};letter-spacing:-.01em">${title}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:2px">Detalle del indicador</div>
          </div>
        </div>
        <button id="dash-kpi-modal-close" style="
          background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
          color:rgba(255,255,255,.5);border-radius:10px;width:34px;height:34px;
          cursor:pointer;font-size:16px;display:grid;place-items:center;
          transition:.15s;
        ">✕</button>
      </div>
      <div style="overflow-y:auto;padding:0 0 8px;flex:1">
        ${contentHtml}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Cerrar con X o click fuera
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById('dash-kpi-modal-close').addEventListener('click', () => modal.remove());
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', esc); }
  });
}

function _bindDashboardKpiCards({ hoy, productosActivos, usuariosActivos, usuariosOperativos, fabricasOperativas, reportesHoy, pendientesHoy }) {

  const FABRICAS_LABELS = { alvear:'Alvear', moron:'Morón', banado:'Bañado', linares:'Linares' };

  // Helper para agregar click a kpi-card por texto del label
  const bindCard = (statId, handler) => {
    const el = $(statId);
    if (!el) return;
    const card = el.closest('.kpi-card');
    if (!card) return;
    card.style.cursor = 'pointer';
    card.style.transition = 'transform .15s, box-shadow .15s, border-color .15s';
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-3px)'; card.style.boxShadow = '0 12px 36px rgba(0,0,0,.35)'; });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.boxShadow = ''; });
    card.addEventListener('click', handler);
  };

  // ── Productos activos ──
  bindCard('statProductos', () => {
    const cats = {};
    productosActivos.forEach((p) => {
      const c = p.categoria || 'Sin categoría';
      cats[c] = (cats[c] || 0) + 1;
    });
    const rows = Object.entries(cats).sort((a,b) => b[1]-a[1]).map(([c,n]) => `
      <tr>
        <td>${c}</td>
        <td style="text-align:right;font-weight:700;color:#6ea8ff">${n}</td>
        <td style="text-align:right;color:rgba(255,255,255,.4);font-size:12px">${Math.round(n/productosActivos.length*100)}%</td>
      </tr>`).join('');
    _showDashModal('Productos activos', '📦', '#6ea8ff', `
      <div style="padding:16px 22px 8px;display:flex;gap:16px;flex-wrap:wrap">
        <div style="background:rgba(110,168,255,.1);border:1px solid rgba(110,168,255,.2);border-radius:12px;padding:12px 18px;flex:1;min-width:120px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">ACTIVOS</div>
          <div style="font-size:28px;font-weight:900;color:#6ea8ff">${productosActivos.length}</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 18px;flex:1;min-width:120px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">TOTAL</div>
          <div style="font-size:28px;font-weight:900;color:rgba(255,255,255,.6)">${state.productos.length}</div>
        </div>
      </div>
      <table><thead><tr><th>Categoría</th><th style="text-align:right">Cantidad</th><th style="text-align:right">%</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="modal-empty">Sin datos</td></tr>'}</tbody></table>
    `);
  });

  // ── Reportes cargados ──
  bindCard('statReportes', () => {
    const porFabrica = {};
    const porEstado = { enviada: 0, borrador: 0 };
    state.reportes.forEach((r) => {
      const f = FABRICAS_LABELS[r.fabrica] || r.fabrica || 'Otro';
      porFabrica[f] = (porFabrica[f] || 0) + 1;
      if (r.estado === 'enviada') porEstado.enviada++;
      else porEstado.borrador++;
    });
    const rows = Object.entries(porFabrica).sort((a,b) => b[1]-a[1]).map(([f,n]) => `
      <tr><td>${f}</td><td style="text-align:right;font-weight:700;color:#a78bfa">${n}</td></tr>`).join('');
    _showDashModal('Reportes cargados', '📋', '#a78bfa', `
      <div style="padding:16px 22px 8px;display:flex;gap:10px;flex-wrap:wrap">
        <div style="background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">TOTAL</div>
          <div style="font-size:28px;font-weight:900;color:#a78bfa">${state.reportes.length}</div>
        </div>
        <div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.18);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">ENVIADAS</div>
          <div style="font-size:28px;font-weight:900;color:#34d399">${porEstado.enviada}</div>
        </div>
        <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.18);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">BORRADOR</div>
          <div style="font-size:28px;font-weight:900;color:#fbbf24">${porEstado.borrador}</div>
        </div>
      </div>
      <table><thead><tr><th>Fábrica</th><th style="text-align:right">Reportes</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2" class="modal-empty">Sin datos</td></tr>'}</tbody></table>
    `);
  });

  // ── Alertas activas ──
  bindCard('statAlertas', () => {
    const rows = state.alertas.slice().sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||''))).map((a) => `
      <tr>
        <td style="color:rgba(255,255,255,.6);font-size:12px">${a.fecha||'-'}</td>
        <td style="font-weight:600">${a.productoNombre||'-'}</td>
        <td style="color:rgba(255,255,255,.5);font-size:12px">${a.bloque||'-'}</td>
        <td style="font-weight:800;color:#f87171;text-align:right">${a.diferencia||0}</td>
      </tr>`).join('');
    _showDashModal('Alertas activas', '⚠️', '#f87171', `
      <div style="padding:14px 22px 8px">
        <div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:12px;padding:12px 18px;display:inline-block">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">ALERTAS ACTIVAS</div>
          <div style="font-size:28px;font-weight:900;color:#f87171">${state.alertas.length}</div>
        </div>
      </div>
      <table><thead><tr><th>Fecha</th><th>Producto</th><th>Bloque</th><th style="text-align:right">Diferencia</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="modal-empty">✅ Sin alertas activas</td></tr>'}</tbody></table>
    `);
  });

  // ── Fábricas pendientes hoy ──
  bindCard('statPendientesHoy', () => {
    const rows = fabricasOperativas.map((f) => {
      const cargó = fabricasHoy.has(f);
      const rep = reportesHoy.find((r) => r.fabrica === f);
      return `
        <tr>
          <td style="font-weight:600">${FABRICAS_LABELS[f] || f}</td>
          <td>
            <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;
              background:${cargó?'rgba(52,211,153,.12)':'rgba(248,113,113,.12)'};
              color:${cargó?'#34d399':'#f87171'};">
              ${cargó ? '✅ Cargó' : '⏳ Pendiente'}
            </span>
          </td>
          <td style="color:rgba(255,255,255,.5);font-size:12px">${rep ? (rep.estado === 'enviada' ? '✅ Enviada' : '📝 Borrador') : '—'}</td>
        </tr>`;
    }).join('');
    _showDashModal('Estado fábricas hoy', '🏭', '#fb923c', `
      <div style="padding:14px 22px 8px;display:flex;gap:10px;flex-wrap:wrap">
        <div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.18);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">CARGARON</div>
          <div style="font-size:28px;font-weight:900;color:#34d399">${reportesHoy.length}</div>
        </div>
        <div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.18);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">PENDIENTES</div>
          <div style="font-size:28px;font-weight:900;color:#f87171">${pendientesHoy.length}</div>
        </div>
      </div>
      <table><thead><tr><th>Fábrica</th><th>Estado hoy</th><th>Planilla</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="modal-empty">Sin fábricas registradas</td></tr>'}</tbody></table>
    `);
  });

  // ── Planillas cargadas hoy ──
  bindCard('statHoyCargadas', () => {
    const rows = reportesHoy.map((r) => `
      <tr>
        <td style="font-weight:600">${FABRICAS_LABELS[r.fabrica] || r.fabrica || '-'}</td>
        <td><span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;
          background:${r.estado==='enviada'?'rgba(52,211,153,.12)':'rgba(251,191,36,.12)'};
          color:${r.estado==='enviada'?'#34d399':'#fbbf24'};">
          ${r.estado === 'enviada' ? '✅ Enviada' : '📝 Borrador'}
        </span></td>
        <td style="color:rgba(255,255,255,.4);font-size:12px">${r.creadoPor || '-'}</td>
      </tr>`).join('');
    _showDashModal('Planillas de hoy', '📅', '#34d399', `
      <div style="padding:14px 22px 8px">
        <div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.18);border-radius:12px;padding:12px 18px;display:inline-block">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">CARGADAS HOY — ${hoy}</div>
          <div style="font-size:28px;font-weight:900;color:#34d399">${reportesHoy.length}</div>
        </div>
      </div>
      <table><thead><tr><th>Fábrica</th><th>Estado</th><th>Usuario</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="modal-empty">Ninguna planilla cargada hoy aún</td></tr>'}</tbody></table>
    `);
  });

  // ── Enviadas ──
  bindCard('statEnviados', () => {
    const enviadas = state.reportes.filter((r) => r.estado === 'enviada');
    const porFabrica = {};
    enviadas.forEach((r) => {
      const f = FABRICAS_LABELS[r.fabrica] || r.fabrica || 'Otro';
      porFabrica[f] = (porFabrica[f] || 0) + 1;
    });
    const recent = enviadas.slice().sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||'')));
    const rows = recent.map((r) => `
      <tr>
        <td style="color:rgba(255,255,255,.6);font-size:12px">${r.fecha||'-'}</td>
        <td style="font-weight:600">${FABRICAS_LABELS[r.fabrica]||r.fabrica||'-'}</td>
        <td style="color:rgba(255,255,255,.4);font-size:12px">${r.creadoPor||'-'}</td>
      </tr>`).join('');
    const summary = Object.entries(porFabrica).map(([f,n]) =>
      `<div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.14);border-radius:10px;padding:10px 14px;flex:1;min-width:90px">
        <div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:3px">${f.toUpperCase()}</div>
        <div style="font-size:22px;font-weight:900;color:#34d399">${n}</div>
      </div>`).join('');
    _showDashModal('Planillas enviadas', '✅', '#34d399', `
      <div style="padding:14px 22px 8px;display:flex;gap:8px;flex-wrap:wrap">${summary}</div>
      <div style="padding:0 22px 8px;font-size:11px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.06em">Últimas enviadas</div>
      <table><thead><tr><th>Fecha</th><th>Fábrica</th><th>Usuario</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="modal-empty">Sin planillas enviadas</td></tr>'}</tbody></table>
    `);
  });

  // ── En borrador ──
  bindCard('statBorradores', () => {
    const borradores = state.reportes.filter((r) => r.estado === 'borrador');
    const rows = borradores.slice().sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||''))).map((r) => `
      <tr>
        <td style="color:rgba(255,255,255,.6);font-size:12px">${r.fecha||'-'}</td>
        <td style="font-weight:600">${FABRICAS_LABELS[r.fabrica]||r.fabrica||'-'}</td>
        <td style="color:rgba(255,255,255,.4);font-size:12px">${r.creadoPor||'-'}</td>
      </tr>`).join('');
    _showDashModal('Planillas en borrador', '📝', '#fbbf24', `
      <div style="padding:14px 22px 8px">
        <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:12px;padding:12px 18px;display:inline-block">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">EN BORRADOR</div>
          <div style="font-size:28px;font-weight:900;color:#fbbf24">${borradores.length}</div>
        </div>
      </div>
      <table><thead><tr><th>Fecha</th><th>Fábrica</th><th>Usuario</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="modal-empty">Sin borradores</td></tr>'}</tbody></table>
    `);
  });

  // ── Usuarios activos ──
  bindCard('statUsuariosActivos', () => {
    const rows = usuariosActivos.map((u) => `
      <tr>
        <td style="font-weight:600">${u.nombre||u.email||'-'}</td>
        <td style="color:rgba(255,255,255,.5);font-size:12px">${u.email||'-'}</td>
        <td><span style="display:inline-flex;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;
          background:rgba(110,168,255,.1);color:#6ea8ff;border:1px solid rgba(110,168,255,.2)">
          ${u.rol||'operativo'}
        </span></td>
        <td style="color:rgba(255,255,255,.5);font-size:12px">${FABRICAS_LABELS[u.fabrica]||u.fabrica||'—'}</td>
      </tr>`).join('');
    _showDashModal('Usuarios activos', '👥', '#818cf8', `
      <div style="padding:14px 22px 8px;display:flex;gap:10px;flex-wrap:wrap">
        <div style="background:rgba(129,140,248,.1);border:1px solid rgba(129,140,248,.2);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">ACTIVOS</div>
          <div style="font-size:28px;font-weight:900;color:#818cf8">${usuariosActivos.length}</div>
        </div>
        <div style="background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.16);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">OPERATIVOS</div>
          <div style="font-size:28px;font-weight:900;color:#34d399">${usuariosOperativos.length}</div>
        </div>
        <div style="background:rgba(251,146,60,.08);border:1px solid rgba(251,146,60,.16);border-radius:12px;padding:12px 18px;flex:1;min-width:100px">
          <div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:4px">GERENCIA</div>
          <div style="font-size:28px;font-weight:900;color:#fb923c">${usuariosActivos.filter(u=>u.rol==='gerencia').length}</div>
        </div>
      </div>
      <table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Fábrica</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="modal-empty">Sin usuarios</td></tr>'}</tbody></table>
    `);
  });
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
            <label>
              <input type="checkbox" class="visibilidad-check" data-id="${p.id}" value="linares" ${visibles.includes('linares') ? 'checked' : ''}>
              Linares
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
        _lastProductosLoad = 0; await _refreshProductos(); renderProductos();
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
      _lastProductosLoad = 0; await _refreshProductos(); renderProductos();
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
      _lastProductosLoad = 0; await _refreshProductos(); renderProductos();
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
  _lastProductosLoad = 0; await _refreshProductos(); renderProductos();
}

// Retorna true si la fila tiene al menos un movimiento en los grupos visibles para el usuario actual
function rowTieneMovimientos(row) {
  const visibleGroups = getVisibleGroupsForCurrentView();
  return visibleGroups.some((group) => {
    const groupData = row.groups?.[group.key] || {};
    return group.columns.some((col) => num(groupData[col.key]) !== 0);
  });
}

function getVisibleGroupsForCurrentView() {
  let fabrica = $('cargaFabrica')?.value;
  if (!fabrica && state.perfil?.fabrica) fabrica = state.perfil.fabrica;

  if (state.perfil?.rol === 'gerencia') {
    return [...DAY_GROUPS, ...MORON_INTERNAL_GROUPS, ...LINARES_INTERNAL_GROUPS];
  }

  if (fabrica === 'moron') return MORON_INTERNAL_GROUPS;
  if (fabrica === 'linares') return LINARES_INTERNAL_GROUPS;

  const groupsByFactory = {
    alvear:  ['alvear', 'cajaChica', 'cajaGrandeAlv'],
    banado:  ['banadoChica', 'banadoGrande'],
  };

  const allowedKeys = groupsByFactory[fabrica] || [];
  return DAY_GROUPS.filter((g) => allowedKeys.includes(g.key));
}

function getEditableGroupsForCurrentUser() {
  let fabrica = $('cargaFabrica')?.value;
  if (!fabrica && state.perfil?.fabrica) fabrica = state.perfil.fabrica;

  if (state.perfil?.rol === 'gerencia') {
    return [...DAY_GROUPS, ...MORON_INTERNAL_GROUPS, ...LINARES_INTERNAL_GROUPS].map((g) => g.key);
  }

  if (fabrica === 'moron')   return MORON_INTERNAL_GROUPS.map((g) => g.key);
  if (fabrica === 'linares') return LINARES_INTERNAL_GROUPS.map((g) => g.key);

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
  extraClass = '',
  comentario = ''
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

  const hasComment = !!comentario;
  const comentarioAttrs = [
    `class="cell-comment-btn${hasComment ? ' has-comment' : ''}"`,
    `data-row="${rowIndex}"`,
    key ? `data-key="${key}"` : '',
    groupKey ? `data-group="${groupKey}"` : '',
    area ? `data-area="${area}"` : '',
    `title="${hasComment ? comentario.replace(/"/g,'&quot;') : 'Agregar comentario'}"`,
    `data-comment="${(comentario || '').replace(/"/g,'&quot;')}"`
  ].filter(Boolean).join(' ');

  return `<div class="cell-wrap"><input ${attrs} ${canEdit ? '' : 'disabled'}><button type="button" ${comentarioAttrs}>💬</button>${hasComment ? `<div class="cell-comment-indicator" title="${comentario.replace(/"/g,'&quot;')}"></div>` : ''}</div>`;
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

// Mapa: groupKey → fábrica propietaria del dato
const GROUP_FABRICA_OWNER = {
  alvear:               'alvear',
  cajaChica:            'alvear',
  cajaGrandeAlv:        'alvear',
  cajaChicaMor:         'moron',
  cajaGrandeMor:        'moron',
  moronChicaInterna:    'moron',
  moronGrandeInterna:   'moron',
  banadoChica:          'banado',
  banadoGrande:         'banado',
  linaresChica:         'linares',
  linaresGrande:        'linares',
  linares:              'linares',
  linaresChicaInterna:  'linares',
  linaresGrandeInterna: 'linares'
};

// ─── FUENTE DE VERDAD DEL STOCK INICIAL ──────────────────────────────────────
// Siempre usa stock_mensual (Firestore cache) como fuente canónica.
// NO usa row.stockInicial del reporte abierto, que puede variar según qué
// planilla esté en pantalla. Esto elimina los totales cambiantes entre fechas.
function getStockInicialCanonicoParaFecha(fecha, productoId) {
  if (!fecha) return EMPTY_STOCK();
  const monthValue = String(fecha).slice(0, 7);
  return getStockMensualForProduct(monthValue, productoId);
}

function getEffectiveGroupDataForDay(fecha, productoId, groupKey) {
  const ownerFabrica = GROUP_FABRICA_OWNER[groupKey];

  if (
    state.reporteActual &&
    state.reporteActual.fecha === fecha &&
    ownerFabrica &&
    state.reporteActual.fabrica === ownerFabrica &&
    // BUG #3 FIX: solo usar datos en memoria si el reporte ya fue guardado
    // en Firestore (idYaExistia=true) o fue guardado en esta sesión.
    // Evita que ediciones sin guardar contaminen running totals.
    (state.reporteActual.idYaExistia || state.reporteActual._guardadoEnSesion)
  ) {
    const row = state.reporteActual.rows?.find((r) => r.productoId === productoId);
    if (row?.groups?.[groupKey]) {
      return row.groups[groupKey];
    }
  }

  return getMergedGroupDataForDay(fecha, productoId, groupKey);
}

function getBanadoSecandoRunningTotal(dayStr, productoId, groupKey, _stockIgnorado = {}) {
  const _ck = `bsec|${dayStr}|${productoId}|${groupKey||""}`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);

  let total =
    groupKey === 'banadoChica'
      ? num(stockInicial?.secandoChica)
      : num(stockInicial?.secandoGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, groupKey);

    total += num(rowData?.secando) - num(rowData?.cosecha);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}

function getLinaresRunningTotal(dayStr, productoId, groupKey, _stockIgnorado = {}) {
  const _ck = `lin|${dayStr}|${productoId}|${groupKey||""}`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);

  let total =
    groupKey === 'linaresChica'
      ? num(stockInicial?.linaresChica)
      : num(stockInicial?.linaresGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, groupKey);

    total +=
      num(rowData?.linPlus) -
      num(rowData?.linMinus) +
      num(rowData?.dif);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}

function getBanadoRunningTotal(dayStr, productoId, groupKey, _stockIgnorado = {}) {
  const _ck = `ban|${dayStr}|${productoId}|${groupKey||""}`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);

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

  _runningTotalCache.set(_ck, total);
  return total;
}

function getMoronRunningTotal(dayStr, productoId, groupKey, _stockIgnorado = {}) {
  const _ck = `mor|${dayStr}|${productoId}|${groupKey||""}`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);

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

  _runningTotalCache.set(_ck, total);
  return total;
}


function getLinaresInternalRunningTotal(dayStr, productoId, groupKey, _stockIgnorado = {}) {
  const _ck = `linint|${dayStr}|${productoId}|${groupKey||""}`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);

  let total =
    groupKey === 'linaresChicaInterna'
      ? num(stockInicial?.linaresChica)
      : num(stockInicial?.linaresGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, groupKey);

    total +=
      num(rowData?.entrada) +
      num(rowData?.sobrante) -
      num(rowData?.pEmpaq) +
      num(rowData?.diferencia);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}

function getCajaChicaAlvearRunningTotal(dayStr, productoId, _stockIgnorado = {}) {
  const _ck = `ccalv|${dayStr}|${productoId}|cajaChica`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);
  let total = num(stockInicial?.alvearChica);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'cajaChica');

    total +=
      num(rowData?.alvPlus) -
      num(rowData?.alvMinus) +
      num(rowData?.dif);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}

function getCajaGrandeAlvearRunningTotal(dayStr, productoId, _stockIgnorado = {}) {
  const _ck = `cgalv|${dayStr}|${productoId}|cajaGrandeAlv`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);
  let total = num(stockInicial?.alvearGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'cajaGrandeAlv');

    total +=
      num(rowData?.alvPlus) -
      num(rowData?.alvMinus) +
      num(rowData?.dif);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}

function getCajaChicaMoronRunningTotal(dayStr, productoId, _stockIgnorado = {}) {
  const _ck = `ccmor|${dayStr}|${productoId}|moronChicaInterna`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);
  let total = num(stockInicial?.moronChica);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    // Morón carga en moronChicaInterna (entrada, sobrante, pEmpaq, diferencia)
    // cajaChicaMor son columnas de gerencia/Alvear que Morón no usa
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'moronChicaInterna');

    total +=
      num(rowData?.entrada) +
      num(rowData?.sobrante) -
      num(rowData?.pEmpaq) +
      num(rowData?.diferencia);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}

function getCajaGrandeMoronRunningTotal(dayStr, productoId, _stockIgnorado = {}) {
  const _ck = `cgmor|${dayStr}|${productoId}|moronGrandeInterna`;  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);
  let total = num(stockInicial?.moronGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    // Morón carga en moronGrandeInterna (entrada, sobrante, pEmpaq, diferencia)
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'moronGrandeInterna');

    total +=
      num(rowData?.entrada) +
      num(rowData?.sobrante) -
      num(rowData?.pEmpaq) +
      num(rowData?.diferencia);
  }

  _runningTotalCache.set(_ck, total);
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

function applyPreviousMonthInitialStock(rows = [], monthValue = '', fecha = '') {
  // Si es el mes manual inicial y no hay fecha → no tocar
  if (!monthValue) return rows;

  return rows.map((row) => {
    // Con fecha concreta: calcular stock acumulado hasta el día anterior
    if (fecha && monthValue !== MANUAL_INITIAL_MONTH) {
      const stock = getStockInitialAcumulado(fecha, row.productoId);
      const tieneAlgo = Object.values(stock).some((v) => num(v) !== 0);
      if (tieneAlgo) {
        return { ...row, stockInicial: { ...row.stockInicial, ...stock } };
      }
    }

    // Sin fecha concreta o mismo mes inicial: usar cierre del mes anterior
    if (monthValue !== MANUAL_INITIAL_MONTH) {
      const closing = getClosingStockFromPreviousMonth(row.productoId, monthValue);
      if (closing) {
        return { ...row, stockInicial: { ...row.stockInicial, ...closing } };
      }
    }

    return row;
  });
}

function getInitialStockForMonth(productoId, monthValue) {
  // Prioridad 1: stock_mensual (fuente canónica, actualizada por gerencia)
  const stockMensual = getStockMensualForProduct(monthValue, productoId);
  const tieneStockMensual = Object.values(stockMensual).some((v) => num(v) !== 0);
  if (tieneStockMensual) return stockMensual;

  // Prioridad 2: primer reporte del mes con stock (fallback)
  const reportesDelMes = state.reportes
    .filter((r) => r.fecha?.startsWith(monthValue))
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

  for (const reporte of reportesDelMes) {
    const row = (reporte.rows || []).find((x) => x.productoId === productoId);
    if (!row?.stockInicial) continue;
    const tieneStock = Object.values(row.stockInicial).some((v) => num(v) !== 0);
    if (tieneStock) return normalizeExistingRow({ ...row }).stockInicial;
  }

  // Sin stock manual cargado → usar cierre del mes anterior
  const closing = getClosingStockFromPreviousMonth(productoId, monthValue);
  if (closing) return closing;

  return EMPTY_STOCK();
}

function getAlvearRunningTotal(dayStr, productoId) {
  const cacheKey = `alv|${dayStr}|${productoId}`;
  if (_runningTotalCache.has(cacheKey)) return _runningTotalCache.get(cacheKey);

  const { year, month, day } = getDateParts(dayStr);
  let total = 0;

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'alvear');
    total += num(rowData?.alv);
  }

  _runningTotalCache.set(cacheKey, total);
  return total;
}

function getLinaresMainRunningTotal(dayStr, productoId) {
  const cacheKey = `linmain|${dayStr}|${productoId}`;
  if (_runningTotalCache.has(cacheKey)) return _runningTotalCache.get(cacheKey);

  const { year, month, day } = getDateParts(dayStr);
  let total = 0;

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'linares');
    total += num(rowData?.lin);
  }

  _runningTotalCache.set(cacheKey, total);
  return total;
}

function getCajaChicaLinaresRunningTotal(dayStr, productoId, _stockIgnorado = {}) {
  const _ck = `cclin|${dayStr}|${productoId}|linaresChica`;
  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);
  let total = num(stockInicial?.linaresChica);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'linaresChica');
    total += num(rowData?.linPlus) - num(rowData?.linMinus) + num(rowData?.dif);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}

function getCajaGrandeLinaresRunningTotal(dayStr, productoId, _stockIgnorado = {}) {
  const _ck = `cglin|${dayStr}|${productoId}|linaresGrande`;
  if (_runningTotalCache.has(_ck)) return _runningTotalCache.get(_ck);
  const { year, month, day } = getDateParts(dayStr);
  const stockInicial = getStockInicialCanonicoParaFecha(dayStr, productoId);
  let total = num(stockInicial?.linaresGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getEffectiveGroupDataForDay(currentDate, productoId, 'linaresGrande');
    total += num(rowData?.linPlus) - num(rowData?.linMinus) + num(rowData?.dif);
  }

  _runningTotalCache.set(_ck, total);
  return total;
}


/* ================================================================
   STOCK INICIAL PARA UNA FECHA DADA
   Busca el stock inicial real para un producto en una fecha concreta.
   Estrategia:
   1. Buscar en el mismo mes cualquier reporte (cualquier fábrica)
      que tenga stockInicial con valores no-cero → ese es el stock del mes.
   2. Si no hay nada en el mes → cierre del mes anterior.
   3. Si tampoco → 0.
   
   NOTA: El stock inicial del mes es FIJO (lo carga gerencia una vez).
   No se acumula con movimientos diarios — eso es para los running totals
   de los grupos (Alvear Total, Morón Total, etc.), no para el stock inicial.
================================================================ */
function getStockInitialAcumulado(fecha, productoId) {
  const { year, month } = getDateParts(fecha);
  const monthValue = `${year}-${String(month).padStart(2, '0')}`;

  // Buscar en TODOS los reportes del mes (sin filtrar por fábrica ni por fecha)
  // el primero que tenga stockInicial con algún valor no-cero
  const reportesDelMes = state.reportes
    .filter((r) => r.fecha?.startsWith(monthValue))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));

  for (const reporte of reportesDelMes) {
    const row = (reporte.rows || []).find((x) => x.productoId === productoId);
    if (!row?.stockInicial) continue;
    const tieneStock = Object.values(row.stockInicial).some((v) => num(v) !== 0);
    if (tieneStock) {
      return { ...normalizeExistingRow(row).stockInicial };
    }
  }

  // Sin stock en el mes → cierre del mes anterior
  const closing = getClosingStockFromPreviousMonth(productoId, monthValue);
  if (closing) return closing;

  return EMPTY_STOCK();
}


/* ================================================================
   APLICA STOCK INICIAL DESDE FIRESTORE
   Busca en Firestore (no en state.reportes) todos los docs del mes,
   extrae el stockInicial real por productoId y lo aplica a las rows.
   Esto garantiza que siempre se lean los valores más actuales,
   sin depender del cache local state.reportes.
================================================================ */
async function _aplicarStockInicialDesdeFirestore(rows, monthValue, fecha) {
  if (!monthValue || monthValue === MANUAL_INITIAL_MONTH) return rows;

  try {
    // Buscar todos los docs del mes en Firestore
    const snap = await getDocs(
      query(collection(db, 'reportes_diarios'),
        where('fecha', '>=', `${monthValue}-01`),
        where('fecha', '<=', `${monthValue}-31`)
      )
    );

    // Construir mapa productoId → stockInicial más completo (no-cero)
    const stockMap = {};

    snap.docs.forEach((d) => {
      const data = d.data();
      (data.rows || []).forEach((row) => {
        if (!row.productoId || !row.stockInicial) return;
        const existing = stockMap[row.productoId];
        const tieneStock = Object.values(row.stockInicial).some((v) => Number(v || 0) !== 0);
        if (!tieneStock) return;
        // Tomar el primero no-cero que encontremos (ordenado por fecha del doc)
        if (!existing) stockMap[row.productoId] = row.stockInicial;
      });
    });

    if (Object.keys(stockMap).length === 0) {
      // Sin stock en el mes → intentar state.reportes como fallback
      return applyPreviousMonthInitialStock(rows, monthValue, fecha);
    }

    // Aplicar el stock a cada row
    return rows.map((row) => {
      const stock = stockMap[row.productoId];
      if (!stock) return row;
      const tieneStock = Object.values(stock).some((v) => Number(v || 0) !== 0);
      if (!tieneStock) return row;
      return {
        ...row,
        stockInicial: {
          alvearChica:  Number(stock.alvearChica  || 0),
          alvearGrande: Number(stock.alvearGrande || 0),
          moronChica:   Number(stock.moronChica   || 0),
          moronGrande:  Number(stock.moronGrande  || 0),
          secandoChica: Number(stock.secandoChica || 0),
          secandoGrande:Number(stock.secandoGrande|| 0),
          banadoChica:  Number(stock.banadoChica  || 0),
          banadoGrande: Number(stock.banadoGrande || 0),
          linaresChica:  Number(stock.linaresChica  || 0),  // FIX BUG#8
          linaresGrande: Number(stock.linaresGrande || 0)   // FIX BUG#8
        }
      };
    });

  } catch (err) {
    console.error('Error cargando stock inicial desde Firestore:', err);
    // Fallback seguro: usar state.reportes
    return applyPreviousMonthInitialStock(rows, monthValue, fecha);
  }
}


/* ================================================================
   STOCK MENSUAL — colección propia en Firestore
   Doc ID: "2026-04"
   Solo gerencia puede escribir. Todos pueden leer.
================================================================ */

const EMPTY_STOCK = () => ({
  alvearChica: 0, alvearGrande: 0,
  moronChica: 0, moronGrande: 0,
  secandoChica: 0, secandoGrande: 0,
  banadoChica: 0, banadoGrande: 0,
  linaresChica: 0, linaresGrande: 0   // FIX BUG#1: faltaban en EMPTY_STOCK
});

// Lee el stock mensual de Firestore y lo guarda en cache
async function loadStockMensual(monthValue) {
  if (!monthValue) return;
  try {
    const snap = await getDoc(doc(db, 'stock_mensual', monthValue));
    if (snap.exists()) {
      state.stockMensualCache[monthValue] = snap.data().stocks || {};
      return;
    }
    // No existe → migrar automáticamente desde reportes_diarios
    const migrados = await _migrarStockDesdereportes(monthValue);
    state.stockMensualCache[monthValue] = migrados;
    if (Object.keys(migrados).length > 0) {
      await setDoc(doc(db, 'stock_mensual', monthValue), {
        monthValue, stocks: migrados,
        actualizadoPor: 'auto-migrado', actualizadoEn: serverTimestamp()
      });
    }
  } catch (err) {
    console.error('Error leyendo stock_mensual:', err);
    state.stockMensualCache[monthValue] = {};
  }
}

// Migra stock desde reportes_diarios cuando stock_mensual no existe
async function _migrarStockDesdereportes(monthValue) {
  try {
    const snap = await getDocs(
      query(collection(db, 'reportes_diarios'),
        where('fecha', '>=', `${monthValue}-01`),
        where('fecha', '<=', `${monthValue}-31`)
      )
    );
    const stocksMap = {};
    snap.docs
      .sort((a, b) => String(a.data().fecha).localeCompare(String(b.data().fecha)))
      .forEach((d) => {
        const data = d.data();
        (data.rows || []).forEach((row) => {
          if (!row.productoId || stocksMap[row.productoId]) return;
          const st = row.stockInicial;
          if (!st) return;
          const tieneStock = Object.values(st).some((v) => Number(v || 0) !== 0);
          if (!tieneStock) return;
          stocksMap[row.productoId] = {
            alvearChica: Number(st.alvearChica || 0),
            alvearGrande: Number(st.alvearGrande || 0),
            moronChica: Number(st.moronChica || 0),
            moronGrande: Number(st.moronGrande || 0),
            secandoChica: Number(st.secandoChica || 0),
            secandoGrande: Number(st.secandoGrande || 0),
            banadoChica: Number(st.banadoChica || 0),
            banadoGrande: Number(st.banadoGrande || 0),
            linaresChica:  Number(st.linaresChica  || 0),  // FIX BUG#8
            linaresGrande: Number(st.linaresGrande || 0)   // FIX BUG#8
          };
        });
      });
    return stocksMap;
  } catch (err) {
    console.error('Error migrando stock:', err);
    return {};
  }
}

// Devuelve el stockInicial de un producto para un mes dado
// Si no hay stock mensual cargado, devuelve ceros
function getStockMensualForProduct(monthValue, productoId) {
  const mesCache = state.stockMensualCache[monthValue];
  if (!mesCache) return EMPTY_STOCK();
  const s = mesCache[productoId];
  if (!s) return EMPTY_STOCK();
  return {
    alvearChica:   Number(s.alvearChica   || 0),
    alvearGrande:  Number(s.alvearGrande  || 0),
    moronChica:    Number(s.moronChica    || 0),
    moronGrande:   Number(s.moronGrande   || 0),
    secandoChica:  Number(s.secandoChica  || 0),
    secandoGrande: Number(s.secandoGrande || 0),
    banadoChica:   Number(s.banadoChica   || 0),
    banadoGrande:  Number(s.banadoGrande  || 0),
    linaresChica:  Number(s.linaresChica  || 0),  // FIX BUG#1
    linaresGrande: Number(s.linaresGrande || 0)   // FIX BUG#1
  };
}

// Guarda el stock mensual completo en Firestore (solo gerencia)
async function saveStockMensual(monthValue, stocksObj) {
  if (state.perfil?.rol !== 'gerencia') return;
  const ref = doc(db, 'stock_mensual', monthValue);
  await setDoc(ref, {
    monthValue,
    stocks: stocksObj,
    actualizadoPor: state.currentUser?.email || '',
    actualizadoEn: serverTimestamp()
  }, { merge: true });
  state.stockMensualCache[monthValue] = stocksObj;
}

// Aplica el stock mensual a un array de rows
function aplicarStockMensualARows(rows, monthValue) {
  return rows.map((row) => ({
    ...row,
    stockInicial: getStockMensualForProduct(monthValue, row.productoId)
  }));
}

// Calcula el stock de cierre de un mes usando running totals
// y lo guarda como stock del mes siguiente
async function generarStockProximoMes(monthValue) {
  if (state.perfil?.rol !== 'gerencia') return;

  const [year, month] = monthValue.split('-').map(Number);
  const nextMonth = month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;

  // Verificar que ya existe un stock del próximo mes para no sobreescribir
  const snapNext = await getDoc(doc(db, 'stock_mensual', nextMonth));
  if (snapNext.exists()) {
    toast(`Ya existe stock para ${nextMonth}. No se sobreescribió.`);
    return;
  }

  // Último día del mes
  const lastDay = new Date(year, month, 0).getDate();
  const lastDate = `${monthValue}-${String(lastDay).padStart(2, '0')}`;

  const stockActual = state.stockMensualCache[monthValue] || {};
  const productos = state.productos.filter((p) => p.activo !== false);
  const nuevoStock = {};

  productos.forEach((producto) => {
    const stockMes = stockActual[producto.id] || EMPTY_STOCK();
    nuevoStock[producto.id] = {
      alvearChica:   getCajaChicaAlvearRunningTotal(lastDate, producto.id, stockMes),
      alvearGrande:  getCajaGrandeAlvearRunningTotal(lastDate, producto.id, stockMes),
      moronChica:    getCajaChicaMoronRunningTotal(lastDate, producto.id, stockMes),
      moronGrande:   getCajaGrandeMoronRunningTotal(lastDate, producto.id, stockMes),
      secandoChica:  getBanadoSecandoRunningTotal(lastDate, producto.id, 'banadoChica', stockMes),
      secandoGrande: getBanadoSecandoRunningTotal(lastDate, producto.id, 'banadoGrande', stockMes),
      banadoChica:   getBanadoRunningTotal(lastDate, producto.id, 'banadoChica', stockMes),
      banadoGrande:  getBanadoRunningTotal(lastDate, producto.id, 'banadoGrande', stockMes),
      linaresChica:  getCajaChicaLinaresRunningTotal(lastDate, producto.id, stockMes),  // FIX BUG#1
      linaresGrande: getCajaGrandeLinaresRunningTotal(lastDate, producto.id, stockMes)  // FIX BUG#1
    };
  });

  await saveStockMensual(nextMonth, nuevoStock);
  toast(`✅ Stock de ${nextMonth} generado automáticamente desde el cierre de ${monthValue}.`);
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

    // Filtro "solo títulos cargados" — productos con movimientos en grupos visibles
    if (state.cargaSoloConMovimientos) {
      filtered = filtered.filter((r) => rowTieneMovimientos(r));
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
    // Operativo: fecha SIEMPRE disponible para poder navegar entre días
    // La fábrica es fija (disabled). El botón Cargar siempre habilitado.
    if (fechaInput) fechaInput.disabled = false;   // ← nunca bloquear la fecha
    if (fabricaSelect) fabricaSelect.disabled = true;
    if (btnCargarReporte) btnCargarReporte.disabled = false;
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

  const isGerenciaView = state.perfil?.rol === 'gerencia';

  // ── Botón "Solo títulos cargados" ──
  let filtroCargaEl = document.getElementById('carga-filtro-movimientos-wrap');
  if (!filtroCargaEl) {
    filtroCargaEl = document.createElement('div');
    filtroCargaEl.id = 'carga-filtro-movimientos-wrap';
    filtroCargaEl.className = 'carga-filtro-wrap';
    filtroCargaEl.innerHTML = `
      <button id="btn-filtro-movimientos" class="btn btn-sm ${state.cargaSoloConMovimientos ? 'btn-primary' : 'btn-outline'}">
        ${state.cargaSoloConMovimientos ? '✅' : '☐'} Solo títulos cargados
      </button>
      <span id="carga-filtro-hint" class="carga-filtro-hint">
        ${state.cargaSoloConMovimientos ? 'Mostrando solo productos con movimientos' : 'Mostrando todos los productos'}
      </span>
    `;
    const panelCarga = table.closest('.panel-card') || table.parentElement?.parentElement;
    if (panelCarga?.parentElement) {
      panelCarga.parentElement.insertBefore(filtroCargaEl, panelCarga);
    }
  } else {
    const btn = document.getElementById('btn-filtro-movimientos');
    if (btn) {
      btn.textContent = (state.cargaSoloConMovimientos ? '✅' : '☐') + ' Solo títulos cargados';
      btn.className = `btn btn-sm ${state.cargaSoloConMovimientos ? 'btn-primary' : 'btn-outline'}`;
    }
    const hint = document.getElementById('carga-filtro-hint');
    if (hint) hint.textContent = state.cargaSoloConMovimientos
      ? 'Mostrando solo productos con movimientos'
      : 'Mostrando todos los productos';
  }
  // Registrar listener solo una vez
  const filtroBtn = document.getElementById('btn-filtro-movimientos');
  if (filtroBtn && !filtroBtn._bound) {
    filtroBtn._bound = true;
    filtroBtn.addEventListener('click', () => {
      state.cargaSoloConMovimientos = !state.cargaSoloConMovimientos;
      renderCargaDiaria();
    });
  }

  // ── Íconos y colores por fábrica para encabezados premium ──
  const FAB_META = {
    'group-alvear':         { icon: '🏭', fab: 'ALVEAR',   accent: '#f97316' },
    'group-caja-chica':     { icon: '🏭', fab: 'ALVEAR',   accent: '#f97316' },
    'group-caja-grande':    { icon: '🏭', fab: 'ALVEAR',   accent: '#f97316' },
    'group-caja-chica-2':   { icon: '🔧', fab: 'MORÓN',    accent: '#8b5cf6' },
    'group-caja-grande-2':  { icon: '🔧', fab: 'MORÓN',    accent: '#8b5cf6' },
    'group-linares-chica':  { icon: '🌿', fab: 'LINARES',  accent: '#ec4899' },
    'group-linares-grande': { icon: '🌿', fab: 'LINARES',  accent: '#ec4899' },
    'group-banado-chica':   { icon: '💧', fab: 'BAÑADO',   accent: '#10b981' },
    'group-banado-grande':  { icon: '💧', fab: 'BAÑADO',   accent: '#10b981' },
  };

  // Fila 1: fábricas agrupadas con ícono + nombre + colspan total
  // Agrupar grupos consecutivos de la misma fábrica
  const fabGroups = [];
  visibleGroups.forEach((group) => {
    const meta = FAB_META[group.colorClass] || { icon: '📋', fab: group.title, accent: '#64748b' };
    const last = fabGroups[fabGroups.length - 1];
    if (last && last.fab === meta.fab) {
      last.colspan += group.columns.length;
      last.groups.push(group);
    } else {
      fabGroups.push({ fab: meta.fab, icon: meta.icon, accent: meta.accent, colspan: group.columns.length, groups: [group] });
    }
  });

  let thead1 = `<tr>
    <th class="sticky-col th-producto" rowspan="3" style="vertical-align:middle;text-align:center;font-size:11px;letter-spacing:.08em;font-weight:700;color:var(--text-muted);">PRODUCTO</th>`;

  if (isGerenciaView) {
    thead1 += `<th colspan="${INITIAL_STOCK_COLUMNS.length}" style="text-align:center;padding:8px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);border-bottom:0.5px solid var(--border);">📦 STOCK INICIAL</th>`;
  }

  fabGroups.forEach((fg, i) => {
    const borderLeft = i > 0 ? 'border-left:2px solid rgba(255,255,255,.07);' : '';
    thead1 += `<th colspan="${fg.colspan}"
      style="text-align:center;padding:9px 14px;font-size:12px;font-weight:700;letter-spacing:.05em;
      color:${fg.accent};${borderLeft}
      border-bottom:2px solid ${fg.accent}33;
      background:${fg.accent}11;">
      ${fg.icon} ${fg.fab}
    </th>`;
  });

  thead1 += `<th rowspan="3" class="total-head" style="vertical-align:middle;text-align:center;font-size:11px;letter-spacing:.06em;font-weight:700;color:var(--text-muted);">TOTAL<br>FILA</th></tr>`;

  // Fila 2: subgrupos (CAJA CHICA / CAJA GRANDE / etc.)
  let thead2 = '<tr>';
  if (isGerenciaView) {
    INITIAL_STOCK_COLUMNS.forEach((col) => {
      thead2 += `<th rowspan="2" class="stock-head" style="font-size:10px;text-align:center;white-space:nowrap;padding:6px 8px;">${col.label}</th>`;
    });
  }

  let prevFab = null;
  visibleGroups.forEach((group) => {
    const meta = FAB_META[group.colorClass] || { accent: '#64748b' };
    const borderLeft = (prevFab && prevFab !== meta.fab) ? `border-left:2px solid rgba(255,255,255,.07);` : '';
    prevFab = meta.fab || group.colorClass;
    thead2 += `<th colspan="${group.columns.length}" class="${group.colorClass}"
      style="text-align:center;padding:6px 10px;font-size:11px;font-weight:600;
      letter-spacing:.04em;white-space:nowrap;${borderLeft}">
      ${group.title}
    </th>`;
  });
  thead2 += '</tr>';

  // Fila 3: columnas individuales
  let thead3 = '<tr>';
  prevFab = null;
  visibleGroups.forEach((group) => {
    const meta = FAB_META[group.colorClass] || { accent: '#64748b' };
    group.columns.forEach((col, ci) => {
      const borderLeft = (ci === 0 && prevFab && prevFab !== meta.fab) ? 'border-left:2px solid rgba(255,255,255,.07);' : '';
      const readonlyStyle = col.readonly
        ? `background:${meta.accent}18;color:${meta.accent};font-style:italic;`
        : '';
      thead3 += `<th class="${group.colorClass}"
        style="font-size:10px;padding:5px 8px;text-align:center;white-space:nowrap;
        letter-spacing:.03em;${borderLeft}${readonlyStyle}">
        ${col.readonly ? '⟳ ' : ''}${col.label}
      </th>`;
      prevFab = meta.fab || group.colorClass;
    });
  });
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

    if (isGerenciaView) {
      INITIAL_STOCK_COLUMNS.forEach((col) => {
        const value = num(row.stockInicial?.[col.key]);
        rowHtml += `<td>${renderCellInput({
          rowIndex,
          area: 'stockInicial',
          key: col.key,
          value,
          canEdit: true,
          extraClass: 'stock-input'
        })}</td>`;
        columnTotals[`stock_${col.key}`] += value;
      });
    }

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

          const comentario = row.comentarios?.[`${group.key}_${col.key}`] || '';
          rowHtml += `<td>${renderCellInput({
            rowIndex,
            groupKey: group.key,
            key: col.key,
            value,
            canEdit,
            extraClass: group.colorClass,
            comentario
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
  if (isGerenciaView) {
    INITIAL_STOCK_COLUMNS.forEach((col) => {
      tfoot += `<th>${columnTotals[`stock_${col.key}`]}</th>`;
    });
  }
  visibleGroups.forEach((group) => {
    group.columns.forEach((col) => {
      tfoot += `<th>${columnTotals[`${group.key}_${col.key}`]}</th>`;
    });
  });
  tfoot += `<th>${grandTotal}</th></tr>`;

  table.innerHTML = `<thead>${thead1}${thead2}${thead3}</thead><tbody>${body || '<tr><td colspan="999">Sin productos.</td></tr>'}</tbody><tfoot>${tfoot}</tfoot>`;

  bindCargaInputs();
}

/* ================================================================
   SECCIÓN TOTALES — Solo gerencia
   Muestra el total actualizado por producto de cada fábrica,
   tomando el reporte más reciente de cada fábrica.
================================================================ */
function renderTotales() {
  const root = document.getElementById('totales-root');
  if (!root) return;

  if (state.perfil?.rol !== 'gerencia') {
    root.innerHTML = `<div class="hint-box">Esta sección es solo para gerencia.</div>`;
    return;
  }

  const productos = state.productos || [];
  if (!productos.length) {
    root.innerHTML = `<div class="hint-box">Sin productos cargados.</div>`;
    return;
  }

  // ── Obtener el reporte más reciente por fábrica ──
  const fabricas = ['alvear', 'moron', 'banado', 'linares'];
  const ultimoReportePorFabrica = {};

  fabricas.forEach((fab) => {
    const reportesFab = (state.reportes || [])
      .filter((r) => r.fabrica === fab && r.rows?.length > 0)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    ultimoReportePorFabrica[fab] = reportesFab[0] || null;
  });

  // ── Columnas de totales — exactamente las columnas TOTAL de la tabla gerencial ──
  const COLS_TOTALES = [
    { key: 'alv_caja_chica',  fab: 'alvear', group: 'cajaChica',         label: 'CAJA CHICA',  cls: 'tot-col-alv' },
    { key: 'alv_caja_grande', fab: 'alvear', group: 'cajaGrandeAlv',     label: 'CAJA GRANDE', cls: 'tot-col-alv' },
    { key: 'alv_total',       fab: null,     group: null,                 label: 'TOTAL ALV',   cls: 'tot-col-alv-total', isTotal: true, keys: ['alv_caja_chica','alv_caja_grande'] },
    { key: 'mor_int_chica',   fab: 'moron',  group: 'moronChicaInterna', label: 'CAJA CHICA',  cls: 'tot-col-mor' },
    { key: 'mor_int_grande',  fab: 'moron',  group: 'moronGrandeInterna',label: 'CAJA GRANDE', cls: 'tot-col-mor' },
    { key: 'mor_total',       fab: null,     group: null,                 label: 'TOTAL MOR',   cls: 'tot-col-mor-total', isTotal: true, keys: ['mor_int_chica','mor_int_grande'] },
    { key: 'ban_chica',       fab: 'banado', group: 'banadoChica',       label: 'BAÑADO CHICA',cls: 'tot-col-ban' },
    { key: 'ban_grande',      fab: 'banado', group: 'banadoGrande',      label: 'BAÑADO GRANDE',cls: 'tot-col-ban' },
    { key: 'ban_total',       fab: null,     group: null,                 label: 'TOTAL BÑ',    cls: 'tot-col-ban-total', isTotal: true, keys: ['ban_chica','ban_grande'] },
    { key: 'lin_chica',       fab: 'linares', group: 'linaresChica',      label: 'LIN CHICA',   cls: 'tot-col-lin' },
    { key: 'lin_grande',      fab: 'linares', group: 'linaresGrande',     label: 'LIN GRANDE',  cls: 'tot-col-lin' },
    { key: 'lin_total',       fab: null,      group: null,                 label: 'TOTAL LIN',   cls: 'tot-col-lin-total', isTotal: true, keys: ['lin_chica','lin_grande'] },
  ];

  // ── Construir mapa productoId → totales usando las mismas funciones que la tabla ──
  const totalesMap = {};
  productos.forEach((p) => { totalesMap[p.id] = {}; });

  // Primero calcular columnas con fab definido
  COLS_TOTALES.filter(cd => !cd.isTotal).forEach((colDef) => {
    const reporte = ultimoReportePorFabrica[colDef.fab];
    if (!reporte) return;
    const fecha = reporte.fecha; // fecha del último reporte de esa fábrica

    (reporte.rows || []).forEach((row) => {
      if (!totalesMap[row.productoId]) return;
      const stockInicial = row.stockInicial || {};
      let val = 0;

      // Usar exactamente las mismas funciones de running total que la tabla gerencial
      switch (colDef.group) {
        case 'cajaChica':
          val = getCajaChicaAlvearRunningTotal(fecha, row.productoId, stockInicial);
          break;
        case 'cajaGrandeAlv':
          val = getCajaGrandeAlvearRunningTotal(fecha, row.productoId, stockInicial);
          break;
        case 'cajaChicaMor':
          val = getCajaChicaMoronRunningTotal(fecha, row.productoId, stockInicial);
          break;
        case 'cajaGrandeMor':
          val = getCajaGrandeMoronRunningTotal(fecha, row.productoId, stockInicial);
          break;
        case 'moronChicaInterna':
          val = getMoronRunningTotal(fecha, row.productoId, 'moronChicaInterna', stockInicial);
          break;
        case 'moronGrandeInterna':
          val = getMoronRunningTotal(fecha, row.productoId, 'moronGrandeInterna', stockInicial);
          break;
        case 'linaresChicaInterna':
          val = getLinaresInternalRunningTotal(fecha, row.productoId, 'linaresChicaInterna', stockInicial);
          break;
        case 'linaresGrandeInterna':
          val = getLinaresInternalRunningTotal(fecha, row.productoId, 'linaresGrandeInterna', stockInicial);
          break;
        case 'linares':
          val = getLinaresMainRunningTotal(fecha, row.productoId);
          break;
        case 'linaresChica':
          val = getCajaChicaLinaresRunningTotal(fecha, row.productoId, stockInicial);
          break;
        case 'linaresGrande':
          val = getCajaGrandeLinaresRunningTotal(fecha, row.productoId, stockInicial);
          break;
        case 'banadoChica':
          val = getBanadoRunningTotal(fecha, row.productoId, 'banadoChica', stockInicial);
          break;
        case 'banadoGrande':
          val = getBanadoRunningTotal(fecha, row.productoId, 'banadoGrande', stockInicial);
          break;
        default:
          val = computeGroupTotal(colDef.group, row.groups?.[colDef.group] || {});
      }

      totalesMap[row.productoId][colDef.key] = val;
    });
  });

  // Calcular columnas TOTAL (suma de chica + grande)
  COLS_TOTALES.filter(cd => cd.isTotal).forEach((colDef) => {
    Object.keys(totalesMap).forEach((prodId) => {
      const suma = (colDef.keys || []).reduce((s, k) => s + num(totalesMap[prodId]?.[k]), 0);
      totalesMap[prodId][colDef.key] = suma;
    });
  });

  // ── Fechas de los últimos reportes ──
  const fechaLabels = fabricas.map((fab) => {
    const r = ultimoReportePorFabrica[fab];
    const nombre = { alvear: 'Alvear', moron: 'Morón', banado: 'Bañado' }[fab] || fab;
    return r
      ? `<span class="tot-fecha-item"><span class="tot-fecha-fab">${nombre}</span><span class="tot-fecha-val">${r.fecha}</span></span>`
      : `<span class="tot-fecha-item tot-fecha-sin"><span class="tot-fecha-fab">${nombre}</span><span class="tot-fecha-val">Sin datos</span></span>`;
  }).join('');

  // ── Filtro: solo mostrar productos con al menos un total > 0 ──
  const TOTAL_KEYS = COLS_TOTALES.map((c) => c.key);
  const productosFiltrados = productos.filter((p) => {
    if (!state.totalesSoloConValor) return true;
    return TOTAL_KEYS.some((k) => num(totalesMap[p.id]?.[k]) !== 0);
  });

  // ── Render ──
  root.innerHTML = `
    <div class="tot-header">
      <div>
        <h2 class="tot-titulo">📊 Totales por fábrica</h2>
        <div class="tot-subtitle">Datos del último reporte cargado por cada fábrica</div>
        <div class="tot-fechas-wrap">${fechaLabels}</div>
      </div>
      <div class="tot-actions">
        <button id="btn-tot-filtro" class="btn ${state.totalesSoloConValor ? 'btn-primary' : 'btn-outline'} btn-sm">
          ${state.totalesSoloConValor ? '✅' : '☐'} Solo con valores
        </button>
        <button id="btn-tot-refresh" class="btn btn-outline btn-sm">🔄 Actualizar</button>
      </div>
    </div>

    <div class="tot-table-wrap panel-card" style="margin-top:16px;">
      <div class="table-wrap">
        <table class="data-table tot-table">
          <thead>
            <tr>
              <th class="sticky-col tot-th-prod" rowspan="2">PRODUCTO</th>
              <th colspan="3" class="tot-th-fab tot-th-alv">ALVEAR</th>
              <th colspan="3" class="tot-th-fab tot-th-mor">MORÓN</th>
              <th colspan="3" class="tot-th-fab tot-th-ban">BAÑADO</th>
              <th colspan="3" class="tot-th-fab tot-th-lin">LINARES</th>
            </tr>
            <tr>
              ${COLS_TOTALES.map((col) => `<th class="tot-th-col ${col.cls}">${col.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${productosFiltrados.map((p) => {
              const tots = totalesMap[p.id] || {};
              const filaVacia = TOTAL_KEYS.every((k) => !num(tots[k]));
              return `
                <tr class="${filaVacia ? 'tot-row-empty' : ''}">
                  <td class="sticky-col tot-td-prod">${p.nombre || p.id}</td>
                  ${COLS_TOTALES.map((colDef) => {
                    const v = num(tots[colDef.key]);
                    return `<td class="tot-td-val ${colDef.cls} ${v < 0 ? 'tot-neg' : v > 0 ? 'tot-pos' : 'tot-zero'}">${v !== 0 ? v : '—'}</td>`;
                  }).join('')}
                </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="tot-tfoot">
              <th class="sticky-col">TOTAL</th>
              ${COLS_TOTALES.map((colDef) => {
                const total = productosFiltrados.reduce((s, p) => s + num(totalesMap[p.id]?.[colDef.key]), 0);
                return `<th class="tot-td-val ${colDef.cls}">${total || '—'}</th>`;
              }).join('')}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  // Botón filtro
  document.getElementById('btn-tot-filtro')?.addEventListener('click', () => {
    state.totalesSoloConValor = !state.totalesSoloConValor;
    renderTotales();
  });
  // Botón refresh
  document.getElementById('btn-tot-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-tot-refresh');
    if (btn) { btn.disabled = true; btn.textContent = 'Actualizando…'; }
    await refreshAll();
    renderTotales();
  });
}

function _parseDecimal(val) {
  const str = String(val || '').trim().replace(',', '.');
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function showCommentModal(btn) {
  const rowIndex  = Number(btn.dataset.row);
  const groupKey  = btn.dataset.group || '';
  const area      = btn.dataset.area  || '';
  const key       = btn.dataset.key   || '';
  const cellKey   = area ? `${area}_${key}` : `${groupKey}_${key}`;
  const current   = btn.dataset.comment || '';

  document.getElementById('cell-comment-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'cell-comment-modal';
  modal.className = 'cell-comment-modal';
  modal.innerHTML = `
    <div class="cell-comment-modal-inner">
      <div class="cell-comment-modal-header">
        <span>💬 Comentario de celda</span>
        <button class="cell-comment-modal-close" id="ccm-close">✕</button>
      </div>
      <textarea id="ccm-textarea" class="cell-comment-textarea" placeholder="Escribí tu comentario…" rows="4">${current}</textarea>
      <div class="cell-comment-modal-footer">
        <button id="ccm-guardar" class="btn btn-primary">Guardar</button>
        ${current ? '<button id="ccm-borrar" class="btn btn-outline" style="color:#f87171;border-color:#f87171;">Borrar</button>' : ''}
        <button id="ccm-cancelar" class="btn btn-outline">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const textarea = document.getElementById('ccm-textarea');
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  function guardarComentario(texto) {
    if (!state.reporteActual) return;
    if (!state.reporteActual.comentarios) state.reporteActual.comentarios = {};
    if (texto) {
      state.reporteActual.comentarios[`${rowIndex}_${cellKey}`] = texto;
    } else {
      delete state.reporteActual.comentarios[`${rowIndex}_${cellKey}`];
    }
    const filas = state.reporteActual.rows;
    if (filas && filas[rowIndex]) {
      if (!filas[rowIndex].comentarios) filas[rowIndex].comentarios = {};
      if (texto) {
        filas[rowIndex].comentarios[cellKey] = texto;
      } else {
        delete filas[rowIndex].comentarios[cellKey];
      }
    }
    btn.dataset.comment = texto;
    btn.title = texto || 'Agregar comentario';
    btn.classList.toggle('has-comment', !!texto);
    autoGuardarReporte();
    modal.remove();
    renderCargaDiaria();
  }

  document.getElementById('ccm-guardar')?.addEventListener('click', () => {
    guardarComentario(textarea.value.trim());
  });
  document.getElementById('ccm-borrar')?.addEventListener('click', () => {
    guardarComentario('');
  });
  document.getElementById('ccm-cancelar')?.addEventListener('click', () => modal.remove());
  document.getElementById('ccm-close')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/* ================================================================
   ACTUALIZACIÓN EN VIVO — solo celdas calculadas, sin re-render
   Se llama cuando el usuario cambia un valor. Actualiza:
   - Celdas readonly (totales acumulados) de la fila afectada
   - Total de fila
   - Totales de columna (pie de tabla)
   - Grand total
   Sin tocar los inputs editables → no se pierde el foco
================================================================ */
function _updateCargaReadonlyCells(changedRowIndex) {
  const table = $('tablaCargaDiaria');
  if (!table) return;

  const fecha = $('cargaFecha')?.value || '';
  const visibleGroups = getVisibleGroupsForCurrentView();
  const isGerenciaView = state.perfil?.rol === 'gerencia';

  const baseRows = state.reporteActual?.rows || buildDefaultRows($('cargaFabrica')?.value);
  const filterQuery = state.cargaAromaFilter?.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') || '';
  const rows = baseRows.filter((r) => {
    if (!filterQuery) return true;
    const nombre = String(r.productoNombre || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return nombre.includes(filterQuery);
  });

  // ── Actualizar celdas readonly de la fila cambiada ──────────────
  const tbodyRows = table.querySelectorAll('tbody tr');
  rows.forEach((row, rowIndex) => {
    const tr = tbodyRows[rowIndex];
    if (!tr) return;
    // Para rendimiento, solo actualizar la fila que cambió
    // y la fila de totales (siempre)
    if (rowIndex !== changedRowIndex) return;

    const readonlyCells = tr.querySelectorAll('.readonly-cell');
    let cellIdx = 0;

    visibleGroups.forEach((group) => {
      group.columns.forEach((col) => {
        if (!col.readonly) return;
        const td = readonlyCells[cellIdx++];
        if (!td) return;

        let val = 0;
        if (group.key === 'moronChicaInterna' || group.key === 'moronGrandeInterna') {
          if (col.key === 'salidaTotal') {
            val = computeMoronInternalReadonly(group.key, col.key, row.groups?.[group.key] || {});
          } else if (col.key === 'total') {
            val = getMoronRunningTotal(fecha, row.productoId, group.key);
          }
        } else if (group.key === 'linaresChicaInterna' || group.key === 'linaresGrandeInterna') {
          if (col.key === 'salidaTotal') {
            val = computeMoronInternalReadonly(group.key, col.key, row.groups?.[group.key] || {});
          } else if (col.key === 'total') {
            val = getLinaresInternalRunningTotal(fecha, row.productoId, group.key);
          }
        } else if (group.key === 'banadoChica' || group.key === 'banadoGrande') {
          if (col.key === 'totalSecando') {
            val = getBanadoSecandoRunningTotal(fecha, row.productoId, group.key);
          } else if (col.key === 'total') {
            val = getBanadoRunningTotal(fecha, row.productoId, group.key);
          }
        } else if (group.key === 'linaresChica' || group.key === 'linaresGrande') {
          if (col.key === 'total') {
            val = group.key === 'linaresChica'
              ? getCajaChicaLinaresRunningTotal(fecha, row.productoId)
              : getCajaGrandeLinaresRunningTotal(fecha, row.productoId);
          }
        } else if (group.key === 'linares') {
          val = getLinaresMainRunningTotal(fecha, row.productoId);
        } else if (group.key === 'alvear') {
          val = getAlvearRunningTotal(fecha, row.productoId);
        } else if (group.key === 'cajaChica') {
          val = getCajaChicaAlvearRunningTotal(fecha, row.productoId);
        } else if (group.key === 'cajaGrandeAlv') {
          val = getCajaGrandeAlvearRunningTotal(fecha, row.productoId);
        } else if (group.key === 'cajaChicaMor') {
          val = getCajaChicaMoronRunningTotal(fecha, row.productoId);
        } else if (group.key === 'cajaGrandeMor') {
          val = getCajaGrandeMoronRunningTotal(fecha, row.productoId);
        } else {
          val = computeGroupTotal(group.key, row.groups?.[group.key] || {});
        }
        td.textContent = val;
      });
    });

    // Actualizar total de fila
    const totalCell = tr.querySelector('.total-cell');
    if (totalCell) {
      const rowTotal =
        computeStockInitialTotal(row.stockInicial) +
        visibleGroups.reduce((acc, g) => acc + computeGroupTotal(g.key, row.groups?.[g.key] || {}), 0);
      totalCell.textContent = rowTotal;
    }
  });

  // ── Recalcular totales de columna (tfoot) ────────────────────────
  const tfoot = table.querySelector('tfoot tr');
  if (!tfoot) return;

  const columnTotals = {};
  if (isGerenciaView) {
    INITIAL_STOCK_COLUMNS.forEach((c) => { columnTotals[`stock_${c.key}`] = 0; });
  }
  visibleGroups.forEach((g) => g.columns.forEach((c) => {
    columnTotals[`${g.key}_${c.key}`] = 0;
  }));
  let grandTotal = 0;

  rows.forEach((row) => {
    if (isGerenciaView) {
      INITIAL_STOCK_COLUMNS.forEach((c) => {
        columnTotals[`stock_${c.key}`] += num(row.stockInicial?.[c.key]);
      });
    }
    visibleGroups.forEach((g) => {
      g.columns.forEach((c) => {
        if (c.readonly) {
          // Leer el valor ya renderizado en la celda para no recalcular todo
          const trEl = table.querySelectorAll('tbody tr')[rows.indexOf(row)];
          const readonlyCells = trEl?.querySelectorAll('.readonly-cell') || [];
          let rIdx = 0;
          visibleGroups.forEach((gg) => {
            gg.columns.forEach((cc) => {
              if (!cc.readonly) return;
              if (gg.key === g.key && cc.key === c.key) {
                columnTotals[`${g.key}_${c.key}`] += Number(readonlyCells[rIdx]?.textContent || 0);
              }
              rIdx++;
            });
          });
        } else {
          columnTotals[`${g.key}_${c.key}`] += num(row.groups?.[g.key]?.[c.key]);
        }
      });
    });
    grandTotal +=
      computeStockInitialTotal(row.stockInicial) +
      visibleGroups.reduce((acc, g) => acc + computeGroupTotal(g.key, row.groups?.[g.key] || {}), 0);
  });

  // Actualizar celdas del tfoot
  const tfootCells = tfoot.querySelectorAll('th');
  let tfIdx = 1; // 0 = label "TOTAL"
  if (isGerenciaView) {
    INITIAL_STOCK_COLUMNS.forEach((c) => {
      if (tfootCells[tfIdx]) tfootCells[tfIdx].textContent = columnTotals[`stock_${c.key}`];
      tfIdx++;
    });
  }
  visibleGroups.forEach((g) => {
    g.columns.forEach((c) => {
      if (tfootCells[tfIdx]) tfootCells[tfIdx].textContent = columnTotals[`${g.key}_${c.key}`];
      tfIdx++;
    });
  });
  // Grand total (última celda del tfoot)
  if (tfootCells[tfIdx]) tfootCells[tfIdx].textContent = grandTotal;
}

function bindCargaInputs() {
  // Handler comentarios por celda
  document.querySelectorAll('#tablaCargaDiaria .cell-comment-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentReporteIsLocked() && state.perfil?.rol !== 'gerencia') return;
      showCommentModal(btn);
    });
  });

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

      // Invalidar cache de running totals para este producto
      _invalidateRunningTotalCache();

      // Actualizar solo celdas calculadas — sin re-renderizar toda la tabla
      _updateCargaReadonlyCells(rowIndex);

      if (!currentReporteIsLocked()) {
        clearTimeout(state.autoSaveTimer);
        state.autoSaveTimer = setTimeout(async () => { await _autoGuardarReporte(); }, 1500);
      }
    });

    input.addEventListener('blur', (e) => { e.target.value = _parseDecimal(e.target.value); });
  });
}


async function cargarReporteDiario() {
  _invalidateRunningTotalCache(); // PERF: invalidar cache al cargar nuevo reporte
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

    // Cargar stock mensual si no está en cache
    const monthValueLoaded = String(fecha).slice(0, 7);
    if (!state.stockMensualCache[monthValueLoaded]) {
      await loadStockMensual(monthValueLoaded);
    }

    let loadedRows = normalizeRowsForCurrentProducts(loaded.rows || [], fabrica, fecha);
    // Si alguna row tiene stockInicial todo-cero, completar con stock mensual
    loadedRows = loadedRows.map((row) => {
      const tieneSt = Object.values(row.stockInicial || {}).some((v) => Number(v || 0) !== 0);
      if (tieneSt) return row;
      const stMensual = getStockMensualForProduct(monthValueLoaded, row.productoId);
      const tieneStMensual = Object.values(stMensual).some((v) => Number(v || 0) !== 0);
      return tieneStMensual ? { ...row, stockInicial: stMensual } : row;
    });

    state.reporteActual = {
      ...loaded,
      estado: estadoFirestore,
      idYaExistia: true,
      rows: loadedRows,
      comentarios: loaded.comentarios || {}
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

    // Cargar stock mensual si no está en cache
    if (!state.stockMensualCache[monthValue]) {
      await loadStockMensual(monthValue);
    }

    let rows = buildDefaultRows(fabrica);
    rows = aplicarStockMensualARows(rows, monthValue);

    state.reporteActual = {
      id,
      fecha,
      fabrica,
      estado: 'borrador',
      creadoPor: state.currentUser?.email || '',
      idYaExistia: false,
      rows
    };

    toast('Nueva planilla preparada.');
  }

  renderCargaDiaria();
  _actualizarSelectCategoriaCarga();
}

async function guardarReporte(estado = 'borrador') {
  _invalidateRunningTotalCache(); // PERF: invalidar cache al guardar
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
      state.reporteActual._guardadoEnSesion = true;
      state.reporteActual.estado = 'enviada';
      renderCargaDiaria();
      return;
    }
  }

  const normalizedRows = state.reporteActual.rows.map(normalizeExistingRow);

  // Si gerencia guarda, actualizar stock_mensual con los stockInicial de esta planilla
  if (state.perfil?.rol === 'gerencia') {
    const monthValue = String(fecha).slice(0, 7);
    const stocksObj = state.stockMensualCache[monthValue] || {};
    let changed = false;
    normalizedRows.forEach((row) => {
      const st = row.stockInicial;
      if (!st) return;
      const tieneStock = Object.values(st).some((v) => Number(v || 0) !== 0);
      if (tieneStock) {
        stocksObj[row.productoId] = { ...st };
        changed = true;
      }
    });
    if (changed) {
      await saveStockMensual(monthValue, stocksObj);
    }
  }

  const payload = {
    fecha,
    fabrica,
    estado,
    creadoPor: state.currentUser?.email || '',
    actualizadoEnTexto: new Date().toISOString(),
    actualizadoEn: serverTimestamp(),
    rows: normalizedRows,
    comentarios: state.reporteActual.comentarios || {}
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
      state.reporteActual._guardadoEnSesion = true;

  toast(estado === 'enviada' ? 'Planilla enviada.' : 'Planilla guardada.');
  await _refreshReportes(); await _refreshStock();
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

  const GER_FAB_META = {
    'group-alvear':         { icon: '🏭', fab: 'ALVEAR',   accent: '#f97316' },
    'group-caja-chica':     { icon: '🏭', fab: 'ALVEAR',   accent: '#f97316' },
    'group-caja-grande':    { icon: '🏭', fab: 'ALVEAR',   accent: '#f97316' },
    'group-caja-chica-2':   { icon: '🔧', fab: 'MORÓN',    accent: '#8b5cf6' },
    'group-caja-grande-2':  { icon: '🔧', fab: 'MORÓN',    accent: '#8b5cf6' },
    'group-linares-chica':  { icon: '🌿', fab: 'LINARES',  accent: '#ec4899' },
    'group-linares-grande': { icon: '🌿', fab: 'LINARES',  accent: '#ec4899' },
    'group-banado-chica':   { icon: '💧', fab: 'BAÑADO',   accent: '#10b981' },
    'group-banado-grande':  { icon: '💧', fab: 'BAÑADO',   accent: '#10b981' },
  };

  let header1 = `<tr>
    <th class="sticky-col" rowspan="3" style="vertical-align:middle;text-align:center;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--text-muted);">PRODUCTO</th>
    <th colspan="${INITIAL_STOCK_COLUMNS.length}" style="text-align:center;padding:8px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-muted);">📦 STOCK INICIAL</th>`;
  let header2 = '<tr>';
  let header3 = '<tr>';

  INITIAL_STOCK_COLUMNS.forEach((col) => {
    header2 += `<th class="stock-head" rowspan="2" style="font-size:10px;text-align:center;white-space:nowrap;padding:6px 8px;">${col.label}</th>`;
  });

  for (let day = 1; day <= daysInMonth; day++) {
    const dayColspan = 1 + DAY_GROUPS.reduce((acc, g) => acc + g.columns.length, 0);
    header1 += `<th colspan="${dayColspan}" class="day-block"
      style="text-align:center;padding:8px 6px;font-size:12px;font-weight:700;letter-spacing:.04em;">
      📅 DÍA ${day}
    </th>`;

    header2 += `<th class="stock-head" rowspan="2" style="font-size:10px;text-align:center;padding:5px 6px;">AROMA</th>`;

    DAY_GROUPS.forEach((group) => {
      const meta = GER_FAB_META[group.colorClass] || { accent: '#64748b' };
      header2 += `<th colspan="${group.columns.length}" class="${group.colorClass}"
        style="text-align:center;padding:5px 8px;font-size:10px;font-weight:600;
        letter-spacing:.04em;white-space:nowrap;border-bottom:2px solid ${meta.accent}33;">
        ${group.title}
      </th>`;
      group.columns.forEach((col) => {
        const readonlyStyle = col.readonly
          ? `background:${meta.accent}18;color:${meta.accent};font-style:italic;`
          : '';
        header3 += `<th class="${group.colorClass}"
          style="font-size:9px;padding:4px 6px;text-align:center;white-space:nowrap;${readonlyStyle}">
          ${col.readonly ? '⟳ ' : ''}${col.label}
        </th>`;
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
        // Para cajaChicaMor y cajaGrandeMor leer datos de los grupos internos de Morón
        // porque el operativo de Morón carga en moronChicaInterna/moronGrandeInterna
        const internalKey = group.key === 'cajaChicaMor'  ? 'moronChicaInterna'
                          : group.key === 'cajaGrandeMor' ? 'moronGrandeInterna'
                          : group.key;
        const rawData  = getMergedGroupDataForDay(dayStr, producto.id, internalKey);

        // Adaptar los campos del grupo interno a los campos esperados por DAY_GROUPS
        // moronChicaInterna: entrada→morPlus, pEmpaq→morMinus, diferencia→dif
        let rowData = rawData;
        if (group.key === 'cajaChicaMor' || group.key === 'cajaGrandeMor') {
          rowData = {
            morPlus:  num(rawData?.entrada),
            morMinus: num(rawData?.pEmpaq),
            dif:      num(rawData?.diferencia),
          };
        }

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
  const isMoron    = state.perfil?.fabrica === 'moron'   && state.perfil?.rol !== 'gerencia';
  const isAlvear   = state.perfil?.fabrica === 'alvear'  && state.perfil?.rol !== 'gerencia';
  const isBanado   = state.perfil?.fabrica === 'banado'  && state.perfil?.rol !== 'gerencia';
  const isLinares  = state.perfil?.fabrica === 'linares' && state.perfil?.rol !== 'gerencia';

  const moronLocked      = !!state.pedidoSemanalActual?.moronLocked;
  const alvearConfirmado = !!state.pedidoSemanalActual?.alvearConfirmado;
  const banadoConfirmado = !!state.pedidoSemanalActual?.banadoConfirmado;
  const linaresConfirmado= !!state.pedidoSemanalActual?.linaresConfirmado;

  if (isGerencia) return true;

  if (isMoron) {
    if (moronLocked) return false;
    return ['moronCantidad', 'moronObservacion', 'moronFabricaDestino', 'moronTipo'].includes(fieldKey);
  }

  if (isAlvear) {
    if (alvearConfirmado) return false;
    return ['alvearFechaEntrega', 'alvearCantidadEntregada', 'alvearMotivos', 'alvearObservacion'].includes(fieldKey);
  }

  if (isBanado) {
    if (banadoConfirmado) return false;
    return ['banadoFechaEntrega', 'banadoCantidadEntregada', 'banadoObservacion'].includes(fieldKey);
  }

  if (isLinares) {
    if (linaresConfirmado) return false;
    return ['linaresFechaEntrega', 'linaresCantidadEntregada', 'linaresObservacion'].includes(fieldKey);
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
  const rol = state.perfil?.rol;
  if (rol === 'gerencia') return 'gerencia';
  const fab = state.perfil?.fabrica;
  if (fab === 'moron')                       return 'moron';
  if (fab === 'alvear')                      return 'alvear';
  if (fab === 'banado' || fab === 'bañado')  return 'banado';
  if (fab === 'linares')                     return 'linares';
  if (rol === 'moron')                       return 'moron';
  if (rol === 'alvear')                      return 'alvear';
  if (rol === 'linares')                     return 'linares';
  return 'gerencia';
}

function getPedidoSemanalRowsForView(rows = []) {
  const viewMode = getPedidoSemanalViewMode();

  if (viewMode === 'gerencia') {
    if (state.pedidoSemanalSoloConCantidad) {
      const conCantidad = rows.filter((row) =>
        num(row.moronCantidad) > 0 ||
        num(row.moronPedidoChica) > 0 ||
        num(row.moronPedidoGrande) > 0
      );
      return conCantidad.length > 0 ? conCantidad : rows;
    }
    return rows;
  }
  if (viewMode === 'banado') {
    // Bañado solo ve productos con fabricaDestino === 'banado' y cantidad > 0
    const filtradas = rows.filter((row) =>
      row.moronFabricaDestino === 'banado' && num(row.moronCantidad) > 0
    );
    return filtradas;
  }
  if (viewMode === 'linares') {
    // Linares solo ve productos donde moronFabricaDestino === 'linares'
    const filtradas = rows.filter((row) => row.moronFabricaDestino === 'linares' && num(row.moronCantidad) > 0);
    return filtradas.length > 0 ? filtradas : [];
  }

  if (viewMode === 'moron') {
    // Filtro opcional: solo productos con cantidad cargada
    if (state.pedidoSemanalSoloConCantidad) {
      const conCantidad = rows.filter((row) =>
        num(row.moronCantidad) > 0 ||
        num(row.moronPedidoChica) > 0 ||
        num(row.moronPedidoGrande) > 0
      );
      return conCantidad.length > 0 ? conCantidad : rows;
    }
    return rows;
  }

  if (viewMode === 'alvear') {
    // Alvear ve solo productos con fabricaDestino === 'alvear' (o sin destino = default alvear)
    // Excluye explícitamente los destinados a banado o linares
    const filtradas = rows.filter((row) =>
      num(row.moronCantidad) > 0 &&
      (!row.moronFabricaDestino || row.moronFabricaDestino === 'alvear')
    );
    return filtradas;
  }

  return rows;
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

  const _mapRow = (row) => ({
    productoId:              row.productoId || '',
    productoNombre:          row.productoNombre || '',
    categoria:               row.categoria || '',
    moronCantidad:           Number(row.moronCantidad ?? 0),
    moronTipo:               row.moronTipo || 'bultos',
    moronFabricaDestino:     row.moronFabricaDestino || 'alvear',
    moronObservacion:        String(row.moronObservacion || ''),
    alvearFechaEntrega:      String(row.alvearFechaEntrega || ''),
    alvearCantidadEntregada: Number(row.alvearCantidadEntregada ?? 0),
    alvearMotivos:           Array.isArray(row.alvearMotivos) ? row.alvearMotivos : [],
    alvearObservacion:       String(row.alvearObservacion || ''),
    banadoFechaEntrega:      String(row.banadoFechaEntrega || ''),
    banadoCantidadEntregada: Number(row.banadoCantidadEntregada ?? 0),
    banadoObservacion:       String(row.banadoObservacion || ''),
    linaresFechaEntrega:     String(row.linaresFechaEntrega || ''),
    linaresCantidadEntregada:Number(row.linaresCantidadEntregada ?? 0),
    linaresObservacion:      String(row.linaresObservacion || ''),
    gerenciaObservacion:     String(row.gerenciaObservacion || ''),
    alvearConfirmado:        !!row.alvearConfirmado,
    historial:               Array.isArray(row.historial) ? row.historial : []
  });

  if (snap.exists()) {
    const data = snap.data() || {};
    state.pedidoSemanalActual = {
      id,
      ...data,
      rows: (data.rows || []).map(_mapRow)
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
      banadoConfirmado: false,
      linaresConfirmado: false,
      rows: buildDefaultWeeklyRows(getWeeklyProducts())
    };
    toast('Nueva semana preparada.');
  }

  state.pedidoSemanalSelectedRow = null;
  renderPedidoSemanal();
}

async function _autoGuardarPedidoSemanal() {
  if (!state.pedidoSemanalActual) return;
  const monthValue = $('pedidoMes')?.value;
  const weekMeta = getSelectedWeekMeta();
  if (!monthValue || !weekMeta) return;

  const id = getWeekDocId(monthValue, weekMeta.key);
  const ref = doc(db, 'pedidos_semanales', id);

  // Guardar rows DIRECTAMENTE desde el estado en memoria
  // sin pasar por normalizeWeeklyRows que descarta campos de Bañado/Linares
  const rows = (state.pedidoSemanalActual.rows || []).map((row) => ({
    productoId:              row.productoId || '',
    productoNombre:          row.productoNombre || '',
    categoria:               row.categoria || '',
    moronCantidad:           Number(row.moronCantidad ?? 0),
    moronTipo:               row.moronTipo || 'bultos',
    moronFabricaDestino:     row.moronFabricaDestino || 'alvear',
    moronObservacion:        String(row.moronObservacion || ''),
    alvearFechaEntrega:      String(row.alvearFechaEntrega || ''),
    alvearCantidadEntregada: Number(row.alvearCantidadEntregada ?? 0),
    alvearMotivos:           Array.isArray(row.alvearMotivos) ? row.alvearMotivos : [],
    alvearObservacion:       String(row.alvearObservacion || ''),
    banadoFechaEntrega:      String(row.banadoFechaEntrega || ''),
    banadoCantidadEntregada: Number(row.banadoCantidadEntregada ?? 0),
    banadoObservacion:       String(row.banadoObservacion || ''),
    linaresFechaEntrega:     String(row.linaresFechaEntrega || ''),
    linaresCantidadEntregada:Number(row.linaresCantidadEntregada ?? 0),
    linaresObservacion:      String(row.linaresObservacion || ''),
    gerenciaObservacion:     String(row.gerenciaObservacion || ''),
    alvearConfirmado:        !!row.alvearConfirmado,
    historial:               Array.isArray(row.historial) ? row.historial : []
  }));

  const payload = {
    monthValue,
    weekKey:   weekMeta.key,
    weekLabel: weekMeta.label,
    weekStart: weekMeta.start,
    weekEnd:   weekMeta.end,
    moronLocked:       !!state.pedidoSemanalActual.moronLocked,
    alvearConfirmado:  !!state.pedidoSemanalActual.alvearConfirmado,
    banadoConfirmado:  !!state.pedidoSemanalActual.banadoConfirmado,
    linaresConfirmado: !!state.pedidoSemanalActual.linaresConfirmado,
    updatedBy:     state.currentUser?.email || '',
    updatedAtText: new Date().toISOString(),
    updatedAt:     serverTimestamp(),
    rows
  };

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp(), createdBy: state.currentUser?.email || '' });
    }
  } catch (e) {
    console.warn('Autosave pedido semanal error:', e);
  }
}

async function guardarPedidoSemanal() {
  // Guarda en borrador SIN cerrar la semana — para cualquier fábrica
  const monthValue = $('pedidoMes')?.value;
  const weekMeta = getSelectedWeekMeta();

  if (!monthValue || !weekMeta) { toast('Seleccioná mes y semana.'); return; }

  ensurePedidoDraft();
  if (!state.pedidoSemanalActual) { toast('Primero cargá la semana.'); return; }

  const isMoron   = state.perfil?.fabrica === 'moron'   && state.perfil?.rol !== 'gerencia';
  const isAlvear  = state.perfil?.fabrica === 'alvear'  && state.perfil?.rol !== 'gerencia';
  const isBanado  = state.perfil?.fabrica === 'banado'  && state.perfil?.rol !== 'gerencia';
  const isLinares = state.perfil?.fabrica === 'linares' && state.perfil?.rol !== 'gerencia';

  if (isMoron   && state.pedidoSemanalActual.moronLocked)      { toast('Morón ya confirmó esta semana.'); return; }
  if (isAlvear  && state.pedidoSemanalActual.alvearConfirmado) { toast('La semana ya está cerrada.'); return; }
  if (isBanado  && state.pedidoSemanalActual.banadoConfirmado) { toast('Bañado ya confirmó esta semana.'); return; }
  if (isLinares && state.pedidoSemanalActual.linaresConfirmado){ toast('Linares ya confirmó esta semana.'); return; }

  await _autoGuardarPedidoSemanal();
  toast('💾 Guardado.');
  await _refreshPedidos();
  renderPedidoSemanal();
}

async function confirmarPedidoSemanal() {
  // Cierra/confirma la semana según la fábrica — acción irreversible sin gerencia
  const monthValue = $('pedidoMes')?.value;
  const weekMeta = getSelectedWeekMeta();

  if (!monthValue || !weekMeta) { toast('Seleccioná mes y semana.'); return; }

  ensurePedidoDraft();
  if (!state.pedidoSemanalActual) { toast('Primero cargá la semana.'); return; }

  const isMoron   = state.perfil?.fabrica === 'moron'   && state.perfil?.rol !== 'gerencia';
  const isAlvear  = state.perfil?.fabrica === 'alvear'  && state.perfil?.rol !== 'gerencia';
  const isBanado  = state.perfil?.fabrica === 'banado'  && state.perfil?.rol !== 'gerencia';
  const isLinares = state.perfil?.fabrica === 'linares' && state.perfil?.rol !== 'gerencia';
  const isGerencia = state.perfil?.rol === 'gerencia';

  if (isMoron   && state.pedidoSemanalActual.moronLocked)      { toast('Morón ya confirmó esta semana.'); return; }
  if (isAlvear  && state.pedidoSemanalActual.alvearConfirmado) { toast('La semana ya está cerrada.'); return; }
  if (isBanado  && state.pedidoSemanalActual.banadoConfirmado) { toast('Bañado ya confirmó esta semana.'); return; }
  if (isLinares && state.pedidoSemanalActual.linaresConfirmado){ toast('Linares ya confirmó esta semana.'); return; }

  const id = getWeekDocId(monthValue, weekMeta.key);
  const ref = doc(db, 'pedidos_semanales', id);
  const currentRows = (state.pedidoSemanalActual.rows || []).map((row) => ({
    productoId:              row.productoId || '',
    productoNombre:          row.productoNombre || '',
    categoria:               row.categoria || '',
    moronCantidad:           Number(row.moronCantidad ?? 0),
    moronTipo:               row.moronTipo || 'bultos',
    moronFabricaDestino:     row.moronFabricaDestino || 'alvear',
    moronObservacion:        String(row.moronObservacion || ''),
    alvearFechaEntrega:      String(row.alvearFechaEntrega || ''),
    alvearCantidadEntregada: Number(row.alvearCantidadEntregada ?? 0),
    alvearMotivos:           Array.isArray(row.alvearMotivos) ? row.alvearMotivos : [],
    alvearObservacion:       String(row.alvearObservacion || ''),
    banadoFechaEntrega:      String(row.banadoFechaEntrega || ''),
    banadoCantidadEntregada: Number(row.banadoCantidadEntregada ?? 0),
    banadoObservacion:       String(row.banadoObservacion || ''),
    linaresFechaEntrega:     String(row.linaresFechaEntrega || ''),
    linaresCantidadEntregada:Number(row.linaresCantidadEntregada ?? 0),
    linaresObservacion:      String(row.linaresObservacion || ''),
    gerenciaObservacion:     String(row.gerenciaObservacion || ''),
    alvearConfirmado:        !!row.alvearConfirmado,
    historial:               Array.isArray(row.historial) ? row.historial : []
  }));

  const payload = {
    monthValue,
    weekKey:   weekMeta.key,
    weekLabel: weekMeta.label,
    weekStart: weekMeta.start,
    weekEnd:   weekMeta.end,
    // Solo marca como confirmada la fábrica actual
    moronLocked:       isMoron   ? true : !!state.pedidoSemanalActual.moronLocked,
    alvearConfirmado:  isAlvear  ? true : !!state.pedidoSemanalActual.alvearConfirmado,
    banadoConfirmado:  isBanado  ? true : !!state.pedidoSemanalActual.banadoConfirmado,
    linaresConfirmado: isLinares ? true : !!state.pedidoSemanalActual.linaresConfirmado,
    updatedBy:     state.currentUser?.email || '',
    updatedAtText: new Date().toISOString(),
    updatedAt:     serverTimestamp(),
    rows: currentRows
  };

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, { ...payload, createdAt: serverTimestamp(), createdBy: state.currentUser?.email || '' });
  }

  state.pedidoSemanalActual = { id, ...payload };

  if (isMoron)        toast('✅ Pedido confirmado y enviado a las fábricas.');
  else if (isBanado)  toast('✅ Bañado confirmó la semana.');
  else if (isLinares) toast('✅ Linares confirmó la semana.');
  else if (isAlvear)  toast('✅ Alvear confirmó la entrega.');
  else toast('Semana confirmada.');

  await _refreshPedidos();
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
    'alvearCantidadEntregada',
    'banadoCantidadEntregada',
    'linaresCantidadEntregada'
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

  // Autosave para Bañado y Linares (no tienen botón de guardar parcial)
  const isBanadoOrLinares =
    (state.perfil?.fabrica === 'banado' || state.perfil?.fabrica === 'linares') &&
    state.perfil?.rol !== 'gerencia';

  if (isBanadoOrLinares) {
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(async () => {
      await _autoGuardarPedidoSemanal();
    }, 1500);
  }

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
  const viewMode = getPedidoSemanalViewMode();

  // ── Filtro: botón toggle "Solo con cantidad" (Morón y Gerencia) ──
  const filtroWrap = $('pedido-filtro-cantidad-wrap');
  const filtroBtn  = $('btn-filtro-solo-cantidad');
  const filtroHint = $('pedido-filtro-hint');
  const mostrarFiltro = viewMode === 'moron' || viewMode === 'gerencia';

  if (filtroWrap) {
    filtroWrap.style.display = mostrarFiltro ? 'flex' : 'none';
  }
  if (filtroBtn) {
    filtroBtn.textContent = (state.pedidoSemanalSoloConCantidad ? '✅' : '☐') + ' Solo productos con cantidad';
    filtroBtn.className   = `btn ${state.pedidoSemanalSoloConCantidad ? 'btn-primary' : 'btn-outline'} btn-sm`;
    // Registrar listener solo una vez
    if (!filtroBtn._listenerRegistrado) {
      filtroBtn.addEventListener('click', () => {
        state.pedidoSemanalSoloConCantidad = !state.pedidoSemanalSoloConCantidad;
        renderPedidoSemanal();
      });
      filtroBtn._listenerRegistrado = true;
    }
  }
  if (filtroHint) {
    filtroHint.textContent = state.pedidoSemanalSoloConCantidad
      ? 'Mostrando solo productos con cantidad cargada'
      : 'Mostrando todos los productos';
  }

  const rows = getPedidoSemanalRowsForView(allRows);
  const alvearConfirmado  = !!state.pedidoSemanalActual?.alvearConfirmado;
  const banadoConfirmado  = !!state.pedidoSemanalActual?.banadoConfirmado;
  const linaresConfirmado = !!state.pedidoSemanalActual?.linaresConfirmado;
  const moronLocked       = !!state.pedidoSemanalActual?.moronLocked;

  // ── Botón confirmar Alvear ──────────────────────────────────────────
  const btnConfirmarContainer = $('btnConfirmarAlvear');
  if (btnConfirmarContainer) {
    const mostrar = (viewMode === 'alvear' || viewMode === 'gerencia')
      && moronLocked && !alvearConfirmado;
    btnConfirmarContainer.style.display = mostrar ? 'block' : 'none';
  }

  // ── Botones confirmar Bañado y Linares — creados dinámicamente ──────
  const _ensureConfirmBtn = (id, label, color, fabrica, confirmado, mostrar) => {
    let btn = $(id);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = id;
      btn.className = 'btn btn-primary btn-sm';
      btn.style.cssText = `margin:8px 0;background:${color};border:none`;
      btn.textContent = label;
      btn.addEventListener('click', () => confirmarPedidoSemanal());
      const ancla = $('btnConfirmarAlvear') || table;
      ancla.parentNode?.insertBefore(btn, ancla.nextSibling);
    }
    btn.style.display = mostrar && !confirmado ? 'inline-flex' : 'none';
    btn.textContent = label;
  };

  _ensureConfirmBtn(
    'btnConfirmarBanado',
    '💧 Confirmar semana — Bañado',
    'linear-gradient(135deg,#059669,#10b981)',
    'banado',
    banadoConfirmado,
    viewMode === 'banado' && moronLocked
  );

  _ensureConfirmBtn(
    'btnConfirmarLinares',
    '🌿 Confirmar semana — Linares',
    'linear-gradient(135deg,#be185d,#ec4899)',
    'linares',
    linaresConfirmado,
    viewMode === 'linares' && moronLocked
  );

  // ── Mensaje cuando ya confirmó ──────────────────────────────────────
  let confirmedMsg = $('pedido-confirmed-msg');
  const showConfirmed =
    (viewMode === 'banado'  && banadoConfirmado)  ||
    (viewMode === 'linares' && linaresConfirmado) ||
    (viewMode === 'alvear'  && alvearConfirmado);

  if (!confirmedMsg) {
    confirmedMsg = document.createElement('div');
    confirmedMsg.id = 'pedido-confirmed-msg';
    confirmedMsg.style.cssText = 'display:none;margin:8px 0;padding:10px 16px;border-radius:12px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);color:#34d399;font-size:13px;font-weight:600';
    const ancla = $('btnConfirmarAlvear') || table;
    ancla.parentNode?.insertBefore(confirmedMsg, ancla.nextSibling);
  }
  confirmedMsg.style.display = showConfirmed ? 'flex' : 'none';
  confirmedMsg.textContent = showConfirmed ? '✅ Esta semana ya fue confirmada. Gerencia puede restablecerla en borrador si es necesario.' : '';

  // ── Botones Restablecer en Borrador (solo gerencia) ─────────────────
  const isGerencia = state.perfil?.rol === 'gerencia';
  let resetContainer = $('pedido-reset-borradores');
  if (!resetContainer && isGerencia) {
    // Crear el contenedor dinámicamente la primera vez y ubicarlo junto al btnConfirmarAlvear
    resetContainer = document.createElement('div');
    resetContainer.id = 'pedido-reset-borradores';
    resetContainer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;';
    const ancla = $('btnConfirmarAlvear') || table;
    ancla.parentNode?.insertBefore(resetContainer, ancla);
  }
  if (resetContainer) {
    if (isGerencia) {
      const ped = state.pedidoSemanalActual;
      const btnsDef = [
        { fabrica: 'moron',   label: '↩ Borrador Morón',   activo: !!ped?.moronLocked },
        { fabrica: 'alvear',  label: '↩ Borrador Alvear',  activo: !!ped?.alvearConfirmado },
        { fabrica: 'banado',  label: '↩ Borrador Bañado',  activo: !!ped?.banadoConfirmado },
        { fabrica: 'linares', label: '↩ Borrador Linares', activo: !!ped?.linaresConfirmado },
      ];
      resetContainer.innerHTML = btnsDef.map(({ fabrica, label, activo }) => `
        <button
          class="btn btn-sm ${activo ? 'btn-danger' : 'btn-outline'}"
          style="font-size:12px;opacity:${activo ? '1' : '0.45'};cursor:${activo ? 'pointer' : 'not-allowed'};"
          data-reset-fabrica="${fabrica}"
          ${activo ? '' : 'disabled'}
          title="${activo ? `Restablecer ${fabrica} en borrador` : `${fabrica} ya está en borrador`}"
        >${label}</button>
      `).join('');
      // Bind clicks (recreamos el contenido cada render, así no acumulamos listeners)
      resetContainer.querySelectorAll('[data-reset-fabrica]').forEach((btn) => {
        btn.addEventListener('click', () => restablecerPedidoEnBorrador(btn.dataset.resetFabrica));
      });
      resetContainer.style.display = 'flex';
    } else {
      resetContainer.style.display = 'none';
    }
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
  const currentRows = (state.pedidoSemanalActual.rows || []).map((row) => ({
    productoId:              row.productoId || '',
    productoNombre:          row.productoNombre || '',
    categoria:               row.categoria || '',
    moronCantidad:           Number(row.moronCantidad ?? 0),
    moronTipo:               row.moronTipo || 'bultos',
    moronFabricaDestino:     row.moronFabricaDestino || 'alvear',
    moronObservacion:        String(row.moronObservacion || ''),
    alvearFechaEntrega:      String(row.alvearFechaEntrega || ''),
    alvearCantidadEntregada: Number(row.alvearCantidadEntregada ?? 0),
    alvearMotivos:           Array.isArray(row.alvearMotivos) ? row.alvearMotivos : [],
    alvearObservacion:       String(row.alvearObservacion || ''),
    banadoFechaEntrega:      String(row.banadoFechaEntrega || ''),
    banadoCantidadEntregada: Number(row.banadoCantidadEntregada ?? 0),
    banadoObservacion:       String(row.banadoObservacion || ''),
    linaresFechaEntrega:     String(row.linaresFechaEntrega || ''),
    linaresCantidadEntregada:Number(row.linaresCantidadEntregada ?? 0),
    linaresObservacion:      String(row.linaresObservacion || ''),
    gerenciaObservacion:     String(row.gerenciaObservacion || ''),
    alvearConfirmado:        !!row.alvearConfirmado,
    historial:               Array.isArray(row.historial) ? row.historial : []
  }));

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
  await _refreshPedidos();
  renderPedidoSemanal();
}

/* ================================================================
   RESTABLECER EN BORRADOR — solo gerencia
   fabrica: 'moron' | 'alvear' | 'banado' | 'linares'
================================================================ */
async function restablecerPedidoEnBorrador(fabrica) {
  if (state.perfil?.rol !== 'gerencia') { toast('Solo gerencia puede restablecer.'); return; }
  if (!state.pedidoSemanalActual) { toast('No hay pedido cargado.'); return; }

  const nombres = { moron: 'Morón', alvear: 'Alvear', banado: 'Bañado', linares: 'Linares' };
  const nombre = nombres[fabrica] || fabrica;

  if (!confirm(`¿Restablecer borrador de ${nombre}? Esto le permite volver a editar su pedido/entrega.`)) return;

  const monthValue = $('pedidoMes')?.value || '';
  const weekMeta = state.pedidoSemanas.find((w) => w.key === state.pedidoSemanalActual?.weekKey)
    || state.pedidoSemanas[0];
  if (!weekMeta) { toast('No se encontró la semana.'); return; }

  const id = getWeekDocId(monthValue, weekMeta.key);
  const ref = doc(db, 'pedidos_semanales', id);

  // Campos a resetear según la fábrica
  const resetPayload = { updatedAt: serverTimestamp() };
  if (fabrica === 'moron') {
    resetPayload.moronLocked = false;
  } else if (fabrica === 'alvear') {
    resetPayload.alvearConfirmado = false;
    resetPayload.alvearConfirmadoPor = null;
    resetPayload.alvearConfirmadoEn = null;
  } else if (fabrica === 'banado') {
    resetPayload.banadoConfirmado = false;
    resetPayload.banadoConfirmadoPor = null;
    resetPayload.banadoConfirmadoEn = null;
  } else if (fabrica === 'linares') {
    resetPayload.linaresConfirmado = false;
    resetPayload.linaresConfirmadoPor = null;
    resetPayload.linaresConfirmadoEn = null;
  }

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, resetPayload);
  } else {
    await setDoc(ref, { ...state.pedidoSemanalActual, ...resetPayload, createdAt: serverTimestamp() });
  }

  // Actualizar estado local
  Object.assign(state.pedidoSemanalActual, resetPayload);
  delete state.pedidoSemanalActual.updatedAt;

  toast(`✅ ${nombre} restablecido en borrador.`);
  await _refreshPedidos();
  renderPedidoSemanal();
}



/* ================================================================
   REFRESH PARCIALES — cada función solo recarga lo mínimo necesario
   y re-renderiza solo el módulo visible.
================================================================ */

function _seccionActiva() {
  const active = document.querySelector('.section.active');
  return active?.id?.replace('section-', '') || '';
}

function _renderSeccionActiva() {
  const sec = _seccionActiva();
  if (sec === 'dashboard')           renderDashboard();
  else if (sec === 'productos')      renderProductos();
  else if (sec === 'usuarios')       renderUsuarios();
  else if (sec === 'carga')          renderCargaDiaria();
  else if (sec === 'gerencia')       renderGerenciaExcel();
  else if (sec === 'pedido-semanal') renderPedidoSemanal();
  else if (sec === 'totales')        renderTotales();
  else if (sec === 'reportes')       renderReportesFiltros();
  state.alertas = computeAlvearMoronAlerts(state.reportes, state.productos);
  renderGerenciaMenuBadge(state.alertas);
  renderGerenciaAlertsPanel(state.alertas);
}

async function _refreshProductos() {
  if (Date.now() - _lastProductosLoad < CACHE_TTL) return; // usar cache si es reciente
  state.productos = (await loadCollection('productos'))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  _lastProductosLoad = Date.now();
}

async function _refreshReportes() {
  const now = new Date();
  const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mesCarga  = $('cargaFecha')?.value?.slice(0, 7) || mesActual;

  // BUG #4 FIX: incluir el mes anterior al mes de carga para que los
  // running totals del día 1 tengan los reportes completos del mes anterior
  const [y, m] = mesCarga.split('-').map(Number);
  const mesAnteriorAlCarga = m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`;

  const meses = [...new Set([mesActual, mesCarga, mesAnteriorAlCarga])];

  const snaps = await Promise.all(meses.map((mes) =>
    getDocs(query(collection(db, 'reportes_diarios'),
      where('fecha', '>=', `${mes}-01`),
      where('fecha', '<=', `${mes}-31`)
    ))
  ));

  // Merge: conservar meses anteriores ya cargados, reemplazar solo los traídos
  const porId = new Map(state.reportes.map((r) => [r.id, r]));
  snaps.forEach((snap) => {
    snap.forEach((d) => {
      porId.set(d.id, { id: d.id, ...d.data(), rows: (d.data().rows || []).map(normalizeExistingRow) });
    });
  });
  state.reportes = [...porId.values()];
}

async function _refreshPedidos() {
  const pedidosSemanales = await loadCollection('pedidos_semanales');
  state.pedidosSemanalesCache = {};
  pedidosSemanales.forEach((item) => {
    state.pedidosSemanalesCache[item.id] = item;
  });
}

async function _refreshStock() {
  const now = new Date();
  const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mesAnterior = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  await Promise.all([loadStockMensual(mesActual), loadStockMensual(mesAnterior)]);
}

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
    await _refreshProductos();
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
      state.reporteActual._guardadoEnSesion = true;

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
      state.reporteActual._guardadoEnSesion = true;

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

    // ── Propagar el nuevo stock inicial a TODOS los reportes del mes ──
    const monthValue = String(fecha).slice(0, 7);
    actualizarStockInicialEnReportesMes(monthValue, state.reporteActual.rows)
      .then((reportesActualizados) => {
        const msg = `✅ ${actualizados} productos actualizados en ${reportesActualizados} planilla${reportesActualizados !== 1 ? 's' : ''} del mes ${monthValue}.`;
        if ($('estadoStockInicial')) $('estadoStockInicial').textContent = msg;
        toast(msg);
      })
      .catch((err) => {
        console.error('Error actualizando reportes:', err);
        if ($('estadoStockInicial')) {
          $('estadoStockInicial').textContent = `✅ ${actualizados} productos actualizados en planilla actual. Guardá para confirmar.`;
        }
        toast(`Stock inicial cargado para ${actualizados} productos.`);
      });
  };
  reader.readAsArrayBuffer(file);
}

// Actualiza el stockInicial en TODOS los reportes del mes en Firestore
// sin tocar ningún otro dato (cantidades, estados, observaciones, etc.)
async function actualizarStockInicialEnReportesMes(monthValue, rowsConNuevoStock) {
  if (state.perfil?.rol !== 'gerencia') return 0;

  // Construir mapa productoId → nuevo stockInicial
  const nuevoStockMap = {};
  rowsConNuevoStock.forEach((row) => {
    if (!row.productoId || !row.stockInicial) return;
    const tieneStock = Object.values(row.stockInicial).some((v) => num(v) !== 0);
    if (tieneStock) nuevoStockMap[row.productoId] = { ...row.stockInicial };
  });

  if (!Object.keys(nuevoStockMap).length) return 0;

  // Buscar todos los reportes del mes en Firestore
  const { getDocs: _getDocs, collection: _collection, query: _query, where: _where } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  const snap = await _getDocs(
    _query(_collection(db, 'reportes_diarios'), _where('fecha', '>=', `${monthValue}-01`), _where('fecha', '<=', `${monthValue}-31`))
  );

  if (snap.empty) return 0;

  // Actualizar cada reporte: solo cambiar stockInicial en cada fila
  const lote = [];
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const rows = data.rows || [];
    let modified = false;

    const updatedRows = rows.map((row) => {
      if (nuevoStockMap[row.productoId]) {
        modified = true;
        return { ...row, stockInicial: { ...nuevoStockMap[row.productoId] } };
      }
      return row;
    });

    if (modified) {
      lote.push({ ref: docSnap.ref, rows: updatedRows });
    }
  });

  // Ejecutar actualizaciones
  await Promise.all(lote.map(({ ref, rows }) =>
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
      .then(({ updateDoc }) => updateDoc(ref, { rows }))
  ));

  // Actualizar caché local también
  state.reportes.forEach((r) => {
    if (!r.fecha?.startsWith(monthValue)) return;
    r.rows = (r.rows || []).map((row) => {
      if (nuevoStockMap[row.productoId]) {
        return { ...row, stockInicial: { ...nuevoStockMap[row.productoId] } };
      }
      return row;
    });
  });

  // Actualizar stock_mensual también
  const stocksObj = {};
  Object.entries(nuevoStockMap).forEach(([id, st]) => { stocksObj[id] = st; });
  await saveStockMensual(monthValue, stocksObj);

  return lote.length;
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

  const selectMesBackup = document.getElementById('backupMes');
  if (selectMesBackup) {
    const btnProxMes = document.createElement('button');
    btnProxMes.className = 'btn btn-outline';
    btnProxMes.style.marginTop = '8px';
    btnProxMes.textContent = '📅 Generar stock del próximo mes desde cierre de este mes';
    btnProxMes.addEventListener('click', async () => {
      const mes = selectMesBackup.value;
      if (!mes) { toast('Seleccioná un mes.'); return; }
      if (!state.stockMensualCache[mes]) await loadStockMensual(mes);
      await generarStockProximoMes(mes);
    });
    document.querySelector('#backupPanel .actions-row')?.appendChild(btnProxMes);
  }
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
  // Carga en paralelo todo lo que no depende entre sí
  await Promise.all([
    _refreshProductos(),
    (async () => {
      if (Date.now() - _lastUsuariosLoad >= CACHE_TTL) {
        state.usuarios = await loadCollection('usuarios');
        _lastUsuariosLoad = Date.now();
      }
    })(),
    _refreshStock(),
    _refreshReportes(),
    _refreshPedidos(),
  ]);

  _actualizarSelectCategoriaCarga();

  // Renderiza SOLO la sección visible + badges — no re-renderiza todo
  _renderSeccionActiva();

  // Dashboard siempre actualizado (es liviano)
  if (_seccionActiva() !== 'dashboard') renderDashboard();
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
    state.cargaSoloConMovimientos = false; // reset filtro al cambiar fecha
    // Limpiar botón del filtro para que se regenere
    document.getElementById('carga-filtro-movimientos-wrap')?.remove();
    const fechaEl = $('cargaFecha');
    if (fechaEl) fechaEl.style.opacity = '0.5';
    cargarReporteDiario().finally(() => {
      if (fechaEl) fechaEl.style.opacity = '';
      fechaEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
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
    // Auto-cargar la semana seleccionada
    cargarPedidoSemanal();
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

    if (ROLES_SOLO_TERC.includes(state.perfil?.rol)) {
      // Estos roles solo necesitan tercerizados — no cargar todo el sistema
      setSection('tercerizados');
    } else {
      await refreshAll();
      setSection('dashboard');
    }
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
  // Headers con nombres reales del sistema (igual a lo que se ve en pantalla)
  if (fabrica === 'alvear') {
    return [
      'PRODUCTO',
      'ALVEAR ENTRADA',         // alvear.alv
      'CAJA CHICA ALVEAR ENTRADA',  // cajaChica.alvPlus
      'CAJA CHICA ALVEAR SALIDA',   // cajaChica.alvMinus
      'CAJA CHICA ALVEAR DIFERENCIA', // cajaChica.dif
      'CAJA GRANDE ALVEAR ENTRADA', // cajaGrandeAlv.alvPlus
      'CAJA GRANDE ALVEAR SALIDA',  // cajaGrandeAlv.alvMinus
      'CAJA GRANDE ALVEAR DIFERENCIA' // cajaGrandeAlv.dif
    ];
  }

  if (fabrica === 'banado') {
    return [
      'PRODUCTO',
      'BAÑADO CHICA ENTRADA',   // banadoChica.banadoPlus
      'BAÑADO CHICA SECANDO',   // banadoChica.secando
      'BAÑADO CHICA COSECHA',   // banadoChica.cosecha
      'BAÑADO CHICA SALIDA',    // banadoChica.salida
      'BAÑADO CHICA DIFERENCIA',// banadoChica.dif
      'BAÑADO GRANDE ENTRADA',  // banadoGrande.banadoPlus
      'BAÑADO GRANDE SECANDO',  // banadoGrande.secando
      'BAÑADO GRANDE COSECHA',  // banadoGrande.cosecha
      'BAÑADO GRANDE SALIDA',   // banadoGrande.salida
      'BAÑADO GRANDE DIFERENCIA'// banadoGrande.dif
    ];
  }

  if (fabrica === 'moron') {
    return [
      'PRODUCTO',
      'CAJA CHICA TOTAL',       // moronChicaInterna.totalBase
      'CAJA CHICA ENTRADA',     // moronChicaInterna.entrada
      'CAJA CHICA SOBRANTE',    // moronChicaInterna.sobrante
      'CAJA CHICA P/EMPAQ',     // moronChicaInterna.pEmpaq
      'CAJA CHICA DIFERENCIA',  // moronChicaInterna.diferencia
      'CAJA CHICA FALLADOS',    // moronChicaInterna.fallados
      'CAJA CHICA DEVOLUCIONES',// moronChicaInterna.devoluciones
      'CAJA GRANDE TOTAL',      // moronGrandeInterna.totalBase
      'CAJA GRANDE ENTRADA',    // moronGrandeInterna.entrada
      'CAJA GRANDE SOBRANTE',   // moronGrandeInterna.sobrante
      'CAJA GRANDE P/EMPAQ',    // moronGrandeInterna.pEmpaq
      'CAJA GRANDE DIFERENCIA', // moronGrandeInterna.diferencia
      'CAJA GRANDE FALLADOS',   // moronGrandeInterna.fallados
      'CAJA GRANDE DEVOLUCIONES'// moronGrandeInterna.devoluciones
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
        const idxAlv = findHeader(headers, ['ALVEAR ENTRADA', 'ALV']);
        if (idxAlv >= 0) target.groups.alvear.alv = numExcel(row[idxAlv]);

        target.groups.cajaChica.alvPlus =
          numExcel(row[findHeader(headers, ['CAJA CHICA ALVEAR ENTRADA', 'ALV_PLUS_CH'])]);

        target.groups.cajaChica.alvMinus =
          numExcel(row[findHeader(headers, ['CAJA CHICA ALVEAR SALIDA', 'ALV_MINUS_CH'])]);

        target.groups.cajaChica.dif =
          numExcel(row[findHeader(headers, ['CAJA CHICA ALVEAR DIFERENCIA', 'DIF_CH'])]);

        target.groups.cajaGrandeAlv.alvPlus =
          numExcel(row[findHeader(headers, ['CAJA GRANDE ALVEAR ENTRADA', 'ALV_PLUS_GR'])]);

        target.groups.cajaGrandeAlv.alvMinus =
          numExcel(row[findHeader(headers, ['CAJA GRANDE ALVEAR SALIDA', 'ALV_MINUS_GR'])]);

        target.groups.cajaGrandeAlv.dif =
          numExcel(row[findHeader(headers, ['CAJA GRANDE ALVEAR DIFERENCIA', 'DIF_GR'])]);
      }

      if (fabrica === 'banado') {
        target.groups.banadoChica.banadoPlus =
          numExcel(row[findHeader(headers, ['BAÑADO CHICA ENTRADA', 'BANADO_PLUS_CH'])]);

        target.groups.banadoChica.secando =
          numExcel(row[findHeader(headers, ['BAÑADO CHICA SECANDO', 'SECANDO_CH'])]);

        target.groups.banadoChica.cosecha =
          numExcel(row[findHeader(headers, ['BAÑADO CHICA COSECHA', 'COSECHA_CH'])]);

        target.groups.banadoChica.salida =
          numExcel(row[findHeader(headers, ['BAÑADO CHICA SALIDA', 'SALIDA_CH'])]);

        target.groups.banadoChica.dif =
          numExcel(row[findHeader(headers, ['BAÑADO CHICA DIFERENCIA', 'DIF_CH'])]);

        target.groups.banadoGrande.banadoPlus =
          numExcel(row[findHeader(headers, ['BAÑADO GRANDE ENTRADA', 'BANADO_PLUS_GR'])]);

        target.groups.banadoGrande.secando =
          numExcel(row[findHeader(headers, ['BAÑADO GRANDE SECANDO', 'SECANDO_GR'])]);

        target.groups.banadoGrande.cosecha =
          numExcel(row[findHeader(headers, ['BAÑADO GRANDE COSECHA', 'COSECHA_GR'])]);

        target.groups.banadoGrande.salida =
          numExcel(row[findHeader(headers, ['BAÑADO GRANDE SALIDA', 'SALIDA_GR'])]);

        target.groups.banadoGrande.dif =
          numExcel(row[findHeader(headers, ['BAÑADO GRANDE DIFERENCIA', 'DIF_GR'])]);
      }

      if (fabrica === 'moron') {
        // Acepta tanto los headers nuevos (nombres reales) como los viejos (códigos)
        target.groups.moronChicaInterna.totalBase =
          numExcel(row[findHeader(headers, ['CAJA CHICA TOTAL', 'TOTAL_BASE_CH'])]);

        target.groups.moronChicaInterna.entrada =
          numExcel(row[findHeader(headers, ['CAJA CHICA ENTRADA', 'ENTRADA_CH'])]);

        target.groups.moronChicaInterna.sobrante =
          numExcel(row[findHeader(headers, ['CAJA CHICA SOBRANTE', 'SOBRANTE_CH'])]);

        target.groups.moronChicaInterna.pEmpaq =
          numExcel(row[findHeader(headers, ['CAJA CHICA P/EMPAQ', 'P_EMPAQ_CH'])]);

        target.groups.moronChicaInterna.diferencia =
          numExcel(row[findHeader(headers, ['CAJA CHICA DIFERENCIA', 'DIFERENCIA_CH'])]);

        target.groups.moronChicaInterna.fallados =
          numExcel(row[findHeader(headers, ['CAJA CHICA FALLADOS', 'FALLADOS_CH'])]);

        target.groups.moronChicaInterna.devoluciones =
          numExcel(row[findHeader(headers, ['CAJA CHICA DEVOLUCIONES', 'DEVOLUCIONES_CH'])]);

        target.groups.moronGrandeInterna.totalBase =
          numExcel(row[findHeader(headers, ['CAJA GRANDE TOTAL', 'TOTAL_BASE_GR'])]);

        target.groups.moronGrandeInterna.entrada =
          numExcel(row[findHeader(headers, ['CAJA GRANDE ENTRADA', 'ENTRADA_GR'])]);

        target.groups.moronGrandeInterna.sobrante =
          numExcel(row[findHeader(headers, ['CAJA GRANDE SOBRANTE', 'SOBRANTE_GR'])]);

        target.groups.moronGrandeInterna.pEmpaq =
          numExcel(row[findHeader(headers, ['CAJA GRANDE P/EMPAQ', 'P_EMPAQ_GR'])]);

        target.groups.moronGrandeInterna.diferencia =
          numExcel(row[findHeader(headers, ['CAJA GRANDE DIFERENCIA', 'DIFERENCIA_GR'])]);

        target.groups.moronGrandeInterna.fallados =
          numExcel(row[findHeader(headers, ['CAJA GRANDE FALLADOS', 'FALLADOS_GR'])]);

        target.groups.moronGrandeInterna.devoluciones =
          numExcel(row[findHeader(headers, ['CAJA GRANDE DEVOLUCIONES', 'DEVOLUCIONES_GR'])]);
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
