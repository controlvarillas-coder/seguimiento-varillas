import { auth, db } from './firebase-config.js';
import { computeAlvearMoronAlerts } from './modules/alertas/alertas.service.js';
import { renderGerenciaAlertsPanel, renderGerenciaMenuBadge } from './modules/alertas/alertas.ui.js';
import {
  buildWeeksForMonth,
  getWeekDocId,
  buildDefaultWeeklyRows,
  normalizeWeeklyRows,
  pushWeeklyHistory
} from './modules/pedido-semanal/pedido-semanal.service.js';
import {
  renderWeekOptions,
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
  pedidoSemanalSelectedRow: null
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
      { key: 'alv', label: 'Alv' },
      { key: 'total', label: 'Total', readonly: true }
    ]
  },
  {
    key: 'cajaChica',
    title: 'CAJA CHICA',
    colorClass: 'group-caja-chica',
    columns: [
      { key: 'alvPlus', label: 'Alve +' },
      { key: 'alvMinus', label: 'Alve -' },
      { key: 'dif', label: 'DIF' },
      { key: 'total', label: 'Total', readonly: true }
    ]
  },
  {
    key: 'cajaGrandeAlv',
    title: 'CAJA GRANDE',
    colorClass: 'group-caja-grande',
    columns: [
      { key: 'alvPlus', label: 'Alve +' },
      { key: 'alvMinus', label: 'Alve -' },
      { key: 'dif', label: 'DIF' },
      { key: 'total', label: 'Total', readonly: true }
    ]
  },
  {
    key: 'cajaChicaMor',
    title: 'CAJA CHICA',
    colorClass: 'group-caja-chica-2',
    columns: [
      { key: 'morPlus', label: 'MOR+' },
      { key: 'morMinus', label: 'MOR-' },
      { key: 'dif', label: 'DIF' },
      { key: 'total', label: 'TOTAL', readonly: true }
    ]
  },
  {
    key: 'cajaGrandeMor',
    title: 'CAJA GRANDE',
    colorClass: 'group-caja-grande-2',
    columns: [
      { key: 'morPlus', label: 'MOR+' },
      { key: 'morMinus', label: 'MOR-' },
      { key: 'dif', label: 'DIF' },
      { key: 'total', label: 'TOTAL', readonly: true }
    ]
  },
  {
    key: 'banadoChica',
    title: 'BAÑADO CAJA CHICA',
    colorClass: 'group-banado-chica',
    columns: [
      { key: 'banadoPlus', label: 'BAÑADO+' },
      { key: 'masMenos', label: '+/-' },
      { key: 'secando', label: 'SECANDO' },
      { key: 'totalSecando', label: 'TOTAL SECANDO' },
      { key: 'cosecha', label: 'COSECHA' },
      { key: 'salida', label: 'SALIDA' },
      { key: 'dif', label: 'DIF' },
      { key: 'total', label: 'TOTAL', readonly: true }
    ]
  },
  {
    key: 'banadoGrande',
    title: 'BAÑADO CAJA GRANDE',
    colorClass: 'group-banado-grande',
    columns: [
      { key: 'banadoPlus', label: 'BAÑADO+' },
      { key: 'masMenos', label: '+/-' },
      { key: 'secando', label: 'SECANDO' },
      { key: 'totalSecando', label: 'TOTAL SECANDO' },
      { key: 'cosecha', label: 'COSECHA' },
      { key: 'salida', label: 'SALIDA' },
      { key: 'dif', label: 'DIF' },
      { key: 'total', label: 'TOTAL', readonly: true }
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
 { key: 'alvearChica', label: 'ALV CH' },
  { key: 'alvearGrande', label: 'ALV GR' },
  { key: 'moronChica', label: 'MOR CH' },
  { key: 'moronGrande', label: 'MOR GR' },
  { key: 'secandoChica', label: 'SEC CH' },
  { key: 'secandoGrande', label: 'SEC GR' },
  { key: 'banadoChica', label: 'BAÑ CH' },
  { key: 'banadoGrande', label: 'BAÑ GR' }
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
    'pedido-semanal': 'Pedido semanal'
  };

  if ($('pageTitle')) $('pageTitle').textContent = titles[sectionId] || 'Varillas Control';

  if (sectionId === 'pedido-semanal') {
    renderPedidoSemanal();
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
        num(data.masMenos) +
        num(data.totalSecando) +
        num(data.cosecha) -
        num(data.salida) +
        num(data.dif)
      );

    case 'banadoGrande':
      return (
        num(data.banadoPlus) +
        num(data.masMenos) +
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

function renderDashboard() {
  const hoy = getTodayLocalISO();

  const productosActivos = state.productos.filter((p) => p.activo !== false);
  const usuariosActivos = state.usuarios.filter((u) => u.activo !== false);
  const usuariosOperativos = usuariosActivos.filter((u) => u.rol !== 'gerencia' && u.fabrica);

  const fabricasOperativas = [...new Set(usuariosOperativos.map((u) => u.fabrica))];
  const reportesHoy = state.reportes.filter((r) => r.fecha === hoy);
  const fabricasHoy = new Set(reportesHoy.map((r) => r.fabrica));
  const pendientesHoy = fabricasOperativas.filter((f) => !fabricasHoy.has(f));

  if ($('statProductos')) $('statProductos').textContent = productosActivos.length;
  if ($('statReportes')) $('statReportes').textContent = state.reportes.length;
  if ($('statBorradores')) $('statBorradores').textContent = state.reportes.filter((r) => r.estado === 'borrador').length;
  if ($('statEnviados')) $('statEnviados').textContent = state.reportes.filter((r) => r.estado === 'enviada').length;
  if ($('statAlertas')) $('statAlertas').textContent = state.alertas.length;
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

      return `
        <tr>
          <td>${FABRICAS[f] || f}</td>
          <td>${estadoHoy}</td>
          <td>${ultimo?.fecha || '-'}</td>
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
          <td>${a.diferencia || 0}</td>
        </tr>
      `).join('') || '<tr><td colspan="4">Sin alertas.</td></tr>';
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

  $('productosList').innerHTML = productosOrdenados.map((p) => {
    const visibles = p.visiblePara || [];

    return `
      <div class="product-row">
        <div class="product-main">
          <div class="product-title">${p.nombre || '-'}</div>
          <div class="product-sub">
            Código: ${p.codigo || '-'} · Categoría: ${p.categoria || '-'}
          </div>
          <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
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

        <div class="product-actions" style="display:flex; flex-direction:column; gap:8px;">
          <button class="btn btn-primary btn-sm" data-save="${p.id}">
            Guardar
          </button>
          <button class="btn btn-outline btn-sm" data-toggle-producto="${p.id}">
            ${p.activo === false ? 'Activar' : 'Desactivar'}
          </button>
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Sin productos.</div>';

  document.querySelectorAll('[data-toggle-producto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggleProducto;
      const item = state.productos.find((p) => p.id === id);
      if (!item) return;

      await updateDoc(doc(db, 'productos', id), {
        activo: item.activo === false ? true : false
      });

      toast('Producto actualizado.');
      await refreshAll();
    });
  });

  document.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.save;
      const checks = Array.from(
        document.querySelectorAll(`.visibilidad-check[data-id="${id}"]:checked`)
      );
      const visiblePara = checks.map((c) => c.value);

      await updateDoc(doc(db, 'productos', id), {
        visiblePara
      });

      toast('Visibilidad guardada.');
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
    return DAY_GROUPS;
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

  if (state.perfil?.rol === 'gerencia') return DAY_GROUPS.map((g) => g.key);

  if (fabrica === 'moron') {
    return MORON_INTERNAL_GROUPS.map((g) => g.key);
  }

  return INPUT_GROUP_BY_FABRICA[fabrica] || [];
}

function currentReporteIsLocked() {
  if (!state.reporteActual) return false;
  if (state.perfil?.rol === 'gerencia') return false;
  return !!state.reporteActual.idYaExistia;
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

function renderCargaDiaria() {
  const table = $('tablaCargaDiaria');
  if (!table) return;

  let fecha = $('cargaFecha')?.value;
  let fabrica = $('cargaFabrica')?.value;

  if (state.perfil?.rol !== 'gerencia' && state.perfil?.fabrica) {
    fabrica = state.perfil.fabrica;
    if ($('cargaFabrica')) $('cargaFabrica').value = fabrica;
  }

  const rows = state.reporteActual?.rows || buildDefaultRows(fabrica);
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
    if (fechaInput) fechaInput.disabled = locked;
    if (fabricaSelect) fabricaSelect.disabled = true;
    if (btnCargarReporte) btnCargarReporte.disabled = locked;
  }

  if ($('estadoCarga')) {
    if (state.reporteActual?.idYaExistia && state.perfil?.rol !== 'gerencia') {
      $('estadoCarga').textContent = `Planilla ya cargada para ${fecha || ''} - solo lectura`;
    } else {
      $('estadoCarga').textContent = state.reporteActual
        ? `Estado: ${state.reporteActual.estado || 'borrador'}`
        : `Nueva planilla ${fecha || ''}`;
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
      const canEdit = state.perfil?.rol === 'gerencia';

      rowHtml += `<td>${renderCellInput({
        rowIndex,
        area: 'stockInicial',
        key: col.key,
        value,
        canEdit,
        extraClass: 'stock-input'
      })}</td>`;

      columnTotals[`stock_${col.key}`] += value;
    });

    visibleGroups.forEach((group) => {
      group.columns.forEach((col) => {
       if (col.readonly) {
  let totalValue = 0;

  if (group.key === 'moronChicaInterna' || group.key === 'moronGrandeInterna') {
    totalValue = computeMoronInternalReadonly(group.key, col.key, row.groups?.[group.key] || {});
  } else if (group.key === 'banadoChica' || group.key === 'banadoGrande') {
    const fechaActual = $('cargaFecha')?.value || '';

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
      visibleGroups.reduce((acc, g) => acc + computeGroupTotal(g.key, row.groups[g.key]), 0);

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

function bindCargaInputs() {
  document.querySelectorAll('#tablaCargaDiaria input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      const allowed = [
        'Backspace', 'Delete', 'Tab', 'Enter',
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'
      ];

      if (allowed.includes(e.key)) return;
      if (/^[0-9]$/.test(e.key)) return;

      e.preventDefault();
    });

    input.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (!/^\d*$/.test(pasted)) {
        e.preventDefault();
      }
    });

    input.addEventListener('change', (e) => {
      const rowIndex = Number(e.target.dataset.row);
      const cleanValue = String(e.target.value || '').replace(/[^\d]/g, '');
      const numericValue = cleanValue === '' ? 0 : Number(cleanValue);

      e.target.value = numericValue;

      if (!state.reporteActual) {
        let fabrica = $('cargaFabrica')?.value;
        if (!fabrica && state.perfil?.fabrica) {
          fabrica = state.perfil.fabrica;
        }

        state.reporteActual = {
          id: getReporteId($('cargaFecha')?.value, fabrica),
          fecha: $('cargaFecha')?.value,
          fabrica,
          estado: 'borrador',
          idYaExistia: false,
          rows: buildDefaultRows(fabrica)
        };
      }

      if (e.target.dataset.area === 'stockInicial') {
        state.reporteActual.rows[rowIndex].stockInicial[e.target.dataset.key] = numericValue;
      } else {
        const group = e.target.dataset.group;
        const key = e.target.dataset.key;
        state.reporteActual.rows[rowIndex].groups[group][key] = numericValue;
      }

      renderCargaDiaria();
    });

    input.addEventListener('blur', (e) => {
      const cleanValue = String(e.target.value || '').replace(/[^\d]/g, '');
      e.target.value = cleanValue === '' ? 0 : Number(cleanValue);
    });
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
    state.reporteActual = {
      ...loaded,
      idYaExistia: true,
      rows: normalizeRowsForCurrentProducts(loaded.rows || [], fabrica)
    };

    if (state.perfil?.rol === 'gerencia') {
      toast('Reporte cargado.');
    } else {
      toast('Esta fecha ya fue cargada para esta fábrica. Solo lectura.');
    }
  } else {
    state.reporteActual = {
      id,
      fecha,
      fabrica,
      estado: 'borrador',
      creadoPor: state.currentUser?.email || '',
      idYaExistia: false,
      rows: buildDefaultRows(fabrica)
    };
    toast('Nueva planilla preparada.');
  }

  renderCargaDiaria();
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
    toast('Esta fábrica ya cargó una planilla para esa fecha.');
    return;
  }

  const id = getReporteId(fecha, fabrica);
  const ref = doc(db, 'reportes_diarios', id);
  const snap = await getDoc(ref);

  if (snap.exists() && state.perfil?.rol !== 'gerencia') {
    toast('Esta fábrica ya cargó una planilla para esa fecha.');
    state.reporteActual.idYaExistia = true;
    renderCargaDiaria();
    return;
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

function getAlvearRunningTotal(dayStr, productoId, stockInicial = {}) {
  const { year, month, day } = getDateParts(dayStr);
  let total = num(stockInicial?.alvearChica) + num(stockInicial?.alvearGrande);

  for (let d = 1; d <= day; d++) {
    const currentDate = buildDateStr(year, month, d);
    const rowData = getMergedGroupDataForDay(currentDate, productoId, 'alvear');
    total += num(rowData?.alv);
  }

  return total;
}
function getEffectiveGroupDataForDay(fecha, productoId, groupKey) {
  const currentFecha = $('cargaFecha')?.value;
  let currentFabrica = $('cargaFabrica')?.value;

  if (!currentFabrica && state.perfil?.fabrica) {
    currentFabrica = state.perfil.fabrica;
  }

  const isBanadoGroup = groupKey === 'banadoChica' || groupKey === 'banadoGrande';

  if (
    state.reporteActual &&
    state.reporteActual.fecha === fecha &&
    currentFabrica === 'banado' &&
    isBanadoGroup
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
      num(rowData?.masMenos) +
      num(rowData?.cosecha) -
      num(rowData?.salida) +
      num(rowData?.dif);
  }

  return total;
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

    const firstRow = getFirstRowForMonth(producto.id, monthValue);
    const stockInicial = firstRow?.stockInicial || {
      alvearChica: 0,
      alvearGrande: 0,
      moronChica: 0,
      moronGrande: 0,
      banadoChica: 0,
      banadoGrande: 0
    };

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
    totalValue = getAlvearRunningTotal(dayStr, producto.id, stockInicial);
  } else if (group.key === 'banadoChica' || group.key === 'banadoGrande') {
    if (col.key === 'totalSecando') {
      totalValue = getBanadoSecandoRunningTotal(
        dayStr,
        producto.id,
        group.key,
        stockInicial
      );
    } else if (col.key === 'total') {
      totalValue = getBanadoRunningTotal(
        dayStr,
        producto.id,
        group.key,
        stockInicial
      );
    }
  }

  row += `<td class="${group.colorClass}">${totalValue}</td>`;
}else {
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

  if (isGerencia) return true;

  if (isMoron) {
    if (moronLocked) return false;
    return [PEDIDO_FIELDS.MORON_CHICA, PEDIDO_FIELDS.MORON_GRANDE, PEDIDO_FIELDS.MORON_OBS].includes(fieldKey);
  }

  if (isAlvear) {
    return [PEDIDO_FIELDS.ALVEAR_DIA, PEDIDO_FIELDS.ALVEAR_OBS].includes(fieldKey);
  }

  return false;
}

function getPedidoEstadoText() {
  if (!state.pedidoSemanalActual) return 'Sin cargar';
  const moronLocked = !!state.pedidoSemanalActual.moronLocked;

  if (moronLocked) {
    return 'Morón ya guardó su pedido. Morón bloqueado.';
  }

  return 'Borrador editable';
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
  const isGerencia = state.perfil?.rol === 'gerencia';

  if (isMoron && state.pedidoSemanalActual.moronLocked) {
    toast('Morón ya guardó esta semana y no puede modificarla.');
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

  toast('Pedido semanal guardado.');
  renderPedidoSemanal();
}

function handlePedidoFieldChange(rowIndex, fieldKey, newValue) {
  ensurePedidoDraft();
  if (!state.pedidoSemanalActual) return;

  const row = state.pedidoSemanalActual.rows[rowIndex];
  if (!row) return;

  const oldValue = row[fieldKey] ?? '';
  const normalizedNewValue = typeof oldValue === 'number' || fieldKey === PEDIDO_FIELDS.MORON_CHICA || fieldKey === PEDIDO_FIELDS.MORON_GRANDE
    ? num(newValue)
    : String(newValue || '');

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

  const rows = state.pedidoSemanalActual?.rows || buildDefaultWeeklyRows(getWeeklyProducts());

  renderPedidoSemanalTable(table, {
    rows,
    canEditField,
    selectedRowIndex: state.pedidoSemanalSelectedRow,
    onFieldChange: handlePedidoFieldChange,
    onSelectHistory: (rowIndex) => {
      state.pedidoSemanalSelectedRow = rowIndex;
      renderPedidoSemanal();
    }
  });

  const selectedRow = typeof state.pedidoSemanalSelectedRow === 'number'
    ? rows[state.pedidoSemanalSelectedRow]
    : null;

  renderPedidoSemanalHistory(historyBox, selectedRow);
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

  state.alertas = computeAlvearMoronAlerts(state.reportes, state.productos);

  renderDashboard();
  renderProductos();
  renderUsuarios();
  renderCargaDiaria();
  renderGerenciaExcel();
  renderPedidoSemanal();

  renderGerenciaMenuBadge(state.alertas);
  renderGerenciaAlertsPanel(state.alertas);
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
  });

  $('cargaFabrica')?.addEventListener('change', () => {
    state.reporteActual = null;
    renderCargaDiaria();
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
