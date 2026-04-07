import { auth, db } from './firebase-config.js';
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
  reporteActual: null
};

const FABRICAS = {
  caja_chica: 'Caja chica',
  caja_grande: 'Caja grande',
  neutro: 'Neutro',
  banado: 'Bañado'
};

const DAY_GROUPS = [
  {
    key: 'cajaChica',
    title: 'CAJA CHICA',
    colorClass: 'group-caja-chica',
    columns: [
      { key: 'lin', label: 'Lin' },
      { key: 'alv', label: 'Alv' },
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
    key: 'neutro',
    title: 'NEUTRO',
    colorClass: 'group-neutro',
    columns: [
      { key: 'banaPlus', label: 'baña+' },
      { key: 'masMenos', label: '+/-' },
      { key: 'total', label: 'TOTAL', readonly: true }
    ]
  },
  {
    key: 'banado',
    title: 'BAÑADO',
    colorClass: 'group-banado',
    columns: [
      { key: 'secando', label: 'secando' },
      { key: 'totalSecando', label: 'total secando' },
      { key: 'cosech', label: 'cosech' },
      { key: 'salida', label: 'salida' },
      { key: 'dif', label: 'dif' },
      { key: 'total', label: 'total', readonly: true },
      { key: 'banadoPlus', label: 'BAÑADO+' }
    ]
  }
];

const INITIAL_STOCK_COLUMNS = [
  { key: 'alvear', label: 'ALVEAR' },
  { key: 'moron', label: 'MORON' },
  { key: 'secando', label: 'SECANDO' },
  { key: 'banado', label: 'BAÑADO' }
];

const INPUT_GROUP_BY_FABRICA = {
  caja_chica: ['cajaChica'],
  caja_grande: ['cajaGrandeAlv', 'cajaGrandeMor'],
  neutro: ['neutro'],
  banado: ['banado']
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
    usuarios: 'Usuarios'
  };

  if ($('pageTitle')) $('pageTitle').textContent = titles[sectionId] || 'Varillas Control';
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
  if (!fabricaSelect) return;

  if (!isGerencia && state.perfil?.fabrica) {
    fabricaSelect.value = state.perfil.fabrica;
    fabricaSelect.disabled = true;
  } else {
    fabricaSelect.disabled = false;
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

function formatVisiblePara(arr = []) {
  return arr.map((v) => FABRICAS[v] || v).join(' · ');
}

function createEmptyGroupData(groupKey) {
  const group = DAY_GROUPS.find((g) => g.key === groupKey);
  const base = {};
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
      alvear: 0,
      moron: 0,
      secando: 0,
      banado: 0
    },
    groups: {}
  };

  DAY_GROUPS.forEach((group) => {
    row.groups[group.key] = createEmptyGroupData(group.key);
  });

  return row;
}

function getProductosParaFabrica(fabrica) {
  const activos = state.productos.filter((p) => p.activo !== false);
  if (state.perfil?.rol === 'gerencia') return activos;
  return activos.filter((p) => (p.visiblePara || []).includes(fabrica));
}

function buildDefaultRows(fabrica) {
  return getProductosParaFabrica(fabrica).map(createEmptyRow);
}

function getReporteId(fecha, fabrica) {
  return `${fecha}_${fabrica}`;
}

function num(v) {
  return Number(v || 0);
}

function computeGroupTotal(groupKey, data = {}) {
  switch (groupKey) {
    case 'cajaChica':
      return num(data.lin) + num(data.alv);
    case 'cajaGrandeAlv':
      return num(data.alvPlus) - num(data.alvMinus) + num(data.dif);
    case 'cajaChicaMor':
      return num(data.morPlus) - num(data.morMinus) + num(data.dif);
    case 'cajaGrandeMor':
      return num(data.morPlus) - num(data.morMinus) + num(data.dif);
    case 'neutro':
      return num(data.banaPlus) + num(data.masMenos);
    case 'banado':
      return num(data.secando) + num(data.totalSecando) + num(data.cosech) - num(data.salida) + num(data.dif) + num(data.banadoPlus);
    default:
      return 0;
  }
}

function computeStockInitialTotal(stock = {}) {
  return num(stock.alvear) + num(stock.moron) + num(stock.secando) + num(stock.banado);
}

function setMonthlyDefault() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if ($('mesGerencia')) $('mesGerencia').value = ym;
  if ($('cargaFecha')) $('cargaFecha').value = new Date().toISOString().slice(0, 10);
}

function renderDashboard() {
  if ($('statProductos')) $('statProductos').textContent = state.productos.length;
  if ($('statReportes')) $('statReportes').textContent = state.reportes.length;
  if ($('statBorradores')) $('statBorradores').textContent = state.reportes.filter((r) => r.estado === 'borrador').length;
  if ($('statEnviados')) $('statEnviados').textContent = state.reportes.filter((r) => r.estado === 'enviada').length;

  if ($('tablaDashboardReportes')) {
    $('tablaDashboardReportes').innerHTML = state.reportes.slice().reverse().slice(0, 12).map((r) => `
      <tr>
        <td>${r.fecha || '-'}</td>
        <td>${FABRICAS[r.fabrica] || r.fabrica || '-'}</td>
        <td>${r.estado || '-'}</td>
        <td>${r.creadoPor || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="4">Sin reportes.</td></tr>';
  }
}

function renderProductos() {
  if ($('productosCount')) $('productosCount').textContent = state.productos.length;
  if ($('productosActivos')) $('productosActivos').textContent = state.productos.filter((p) => p.activo !== false).length;

  if (!$('productosList')) return;

  $('productosList').innerHTML = state.productos.map((p) => `
    <div class="product-row">
      <div class="product-main">
        <div class="product-title">${p.nombre || '-'}</div>
        <div class="product-sub">
          Código: ${p.codigo || '-'} · Categoría: ${p.categoria || '-'} · Visible para: ${formatVisiblePara(p.visiblePara || [])}
        </div>
      </div>
      <div class="product-actions">
        <button class="btn btn-outline btn-sm" data-toggle-producto="${p.id}">
          ${p.activo === false ? 'Activar' : 'Desactivar'}
        </button>
      </div>
    </div>
  `).join('') || '<div class="empty-state">Sin productos.</div>';

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
    creadoEn: serverTimestamp()
  });

  ev.target.reset();
  document.querySelectorAll('input[name="visiblePara"]').forEach((el) => (el.checked = true));

  toast('Producto guardado.');
  await refreshAll();
}

function getEditableGroupsForCurrentUser() {
  const fabrica = $('cargaFabrica')?.value;
  if (state.perfil?.rol === 'gerencia') return DAY_GROUPS.map((g) => g.key);
  return INPUT_GROUP_BY_FABRICA[fabrica] || [];
}

function currentReporteIsLocked() {
  if (!state.reporteActual) return false;
  if (state.perfil?.rol === 'gerencia') return false;
  return state.reporteActual.estado === 'enviada';
}

function renderCargaDiaria() {
  const table = $('tablaCargaDiaria');
  if (!table) return;

  const fecha = $('cargaFecha')?.value;
  const fabrica = $('cargaFabrica')?.value;
  const rows = state.reporteActual?.rows || buildDefaultRows(fabrica);
  const editableGroups = getEditableGroupsForCurrentUser();
  const locked = currentReporteIsLocked();

  if ($('estadoCarga')) {
    $('estadoCarga').textContent = state.reporteActual
      ? `Estado: ${state.reporteActual.estado || 'borrador'}`
      : `Nueva planilla ${fecha || ''}`;
  }

  if ($('btnGuardarReporte')) $('btnGuardarReporte').disabled = locked;
  if ($('btnEnviarReporte')) $('btnEnviarReporte').disabled = locked;

  let thead1 = `<tr><th class="sticky-col" rowspan="3">PRODUCTO</th><th colspan="${INITIAL_STOCK_COLUMNS.length}">STOCK INICIAL</th>`;
  let thead2 = '<tr>';
  let thead3 = '<tr>';

  INITIAL_STOCK_COLUMNS.forEach((col) => {
    thead2 += `<th rowspan="2" class="stock-head">${col.label}</th>`;
  });

  DAY_GROUPS.forEach((group) => {
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
  INITIAL_STOCK_COLUMNS.forEach((c) => (columnTotals[`stock_${c.key}`] = 0));
  DAY_GROUPS.forEach((g) => g.columns.forEach((c) => (columnTotals[`${g.key}_${c.key}`] = 0)));
  let grandTotal = 0;

  rows.forEach((row, rowIndex) => {
    let rowHtml = `<tr><td class="sticky-col product-name-cell">${row.productoNombre}</td>`;

    INITIAL_STOCK_COLUMNS.forEach((col) => {
      const value = num(row.stockInicial?.[col.key]);
      const canEdit = state.perfil?.rol === 'gerencia';

      rowHtml += `<td><input class="excel-input stock-input" data-row="${rowIndex}" data-area="stockInicial" data-key="${col.key}" type="number" value="${value}" ${canEdit ? '' : 'disabled'}></td>`;
      columnTotals[`stock_${col.key}`] += value;
    });

    DAY_GROUPS.forEach((group) => {
      group.columns.forEach((col) => {
        if (col.readonly) {
          const totalValue = computeGroupTotal(group.key, row.groups?.[group.key] || {});
          rowHtml += `<td class="readonly-cell ${group.colorClass}">${totalValue}</td>`;
          columnTotals[`${group.key}_${col.key}`] += totalValue;
        } else {
          const value = num(row.groups?.[group.key]?.[col.key]);
          const canEdit = editableGroups.includes(group.key) && !locked;
          rowHtml += `<td><input class="excel-input ${group.colorClass}" data-row="${rowIndex}" data-group="${group.key}" data-key="${col.key}" type="number" value="${value}" ${canEdit ? '' : 'disabled'}></td>`;
          columnTotals[`${group.key}_${col.key}`] += value;
        }
      });
    });

    const rowTotal = computeStockInitialTotal(row.stockInicial) +
      DAY_GROUPS.reduce((acc, g) => acc + computeGroupTotal(g.key, row.groups[g.key]), 0);

    grandTotal += rowTotal;
    rowHtml += `<td class="total-cell">${rowTotal}</td></tr>`;
    body += rowHtml;
  });

  let tfoot = `<tr><th class="sticky-col">TOTAL</th>`;
  INITIAL_STOCK_COLUMNS.forEach((col) => {
    tfoot += `<th>${columnTotals[`stock_${col.key}`]}</th>`;
  });
  DAY_GROUPS.forEach((group) => {
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
    input.addEventListener('input', (e) => {
      const rowIndex = Number(e.target.dataset.row);

      if (!state.reporteActual) {
        state.reporteActual = {
          id: getReporteId($('cargaFecha')?.value, $('cargaFabrica')?.value),
          fecha: $('cargaFecha')?.value,
          fabrica: $('cargaFabrica')?.value,
          estado: 'borrador',
          rows: buildDefaultRows($('cargaFabrica')?.value)
        };
      }

      if (e.target.dataset.area === 'stockInicial') {
        state.reporteActual.rows[rowIndex].stockInicial[e.target.dataset.key] = num(e.target.value);
      } else {
        const group = e.target.dataset.group;
        const key = e.target.dataset.key;
        state.reporteActual.rows[rowIndex].groups[group][key] = num(e.target.value);
      }

      renderCargaDiaria();
    });
  });
}

async function cargarReporteDiario() {
  const fecha = $('cargaFecha')?.value;
  const fabrica = $('cargaFabrica')?.value;

  if (!fecha || !fabrica) {
    toast('Seleccioná fecha y fábrica.');
    return;
  }

  const id = getReporteId(fecha, fabrica);
  const ref = doc(db, 'reportes_diarios', id);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    state.reporteActual = { id: snap.id, ...snap.data() };
    toast('Reporte cargado.');
  } else {
    state.reporteActual = {
      id,
      fecha,
      fabrica,
      estado: 'borrador',
      creadoPor: state.currentUser?.email || '',
      rows: buildDefaultRows(fabrica)
    };
    toast('Nueva planilla preparada.');
  }

  renderCargaDiaria();
}

async function guardarReporte(estado = 'borrador') {
  const fecha = $('cargaFecha')?.value;
  const fabrica = $('cargaFabrica')?.value;

  if (!fecha || !fabrica) {
    toast('Seleccioná fecha y fábrica.');
    return;
  }

  if (!state.reporteActual) {
    toast('Primero cargá la planilla.');
    return;
  }

  if (currentReporteIsLocked()) {
    toast('La planilla ya fue enviada y no puede editarse.');
    return;
  }

  const id = getReporteId(fecha, fabrica);
  const ref = doc(db, 'reportes_diarios', id);
  const snap = await getDoc(ref);

  const payload = {
    fecha,
    fabrica,
    estado,
    creadoPor: state.currentUser?.email || '',
    actualizadoEnTexto: new Date().toISOString(),
    actualizadoEn: serverTimestamp(),
    rows: state.reporteActual.rows
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
  toast(estado === 'enviada' ? 'Planilla enviada.' : 'Borrador guardado.');
  await refreshAll();
  await cargarReporteDiario();
}

function getReportForDateFactory(fecha, fabrica) {
  const id = getReporteId(fecha, fabrica);
  return state.reportes.find((r) => r.id === id) || null;
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
    const dayColspan = DAY_GROUPS.reduce((acc, g) => acc + g.columns.length, 0);
    header1 += `<th colspan="${dayColspan}" class="day-block">DÍA ${day}</th>`;

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

    const firstReportForMonth = state.reportes.find((r) =>
      r.fecha?.startsWith(monthValue) &&
      (r.rows || []).some((x) => x.productoId === producto.id)
    );

    const firstRow = firstReportForMonth?.rows?.find((x) => x.productoId === producto.id);

    INITIAL_STOCK_COLUMNS.forEach((col) => {
      row += `<td>${num(firstRow?.stockInicial?.[col.key])}</td>`;
    });

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      DAY_GROUPS.forEach((group) => {
        let rowData = null;

        Object.keys(FABRICAS).forEach((fabricaKey) => {
          const rep = getReportForDateFactory(dayStr, fabricaKey);
          const foundRow = rep?.rows?.find((x) => x.productoId === producto.id);

          if (foundRow && foundRow.groups && foundRow.groups[group.key]) {
            rowData = foundRow.groups[group.key];
          }
        });

        group.columns.forEach((col) => {
          if (col.readonly) {
            row += `<td class="${group.colorClass}">${computeGroupTotal(group.key, rowData || {})}</td>`;
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

async function seedBaseData() {
  const productosSnap = await getDocs(collection(db, 'productos'));

  if (productosSnap.empty) {
    const defaults = [
      ['PALO SANTO', 'Aromas'],
      ['P.S - INCIENSO', 'Aromas'],
      ['P.S - COPAL', 'Aromas'],
      ['P.S - MIRRA', 'Aromas'],
      ['P.S - JAZMIN', 'Aromas'],
      ['P.S - VAINILLA', 'Aromas'],
      ['P.S - ROMERO', 'Aromas'],
      ['P.S - CHAMPA', 'Aromas'],
      ['P.S - ROSA', 'Aromas'],
      ['P.S - YAGRA', 'Aromas'],
      ['P.S - LAVANDA', 'Aromas']
    ];

    for (const [nombre, categoria] of defaults) {
      await addDoc(collection(db, 'productos'), {
        nombre,
        codigo: '',
        categoria,
        visiblePara: ['caja_chica', 'caja_grande', 'neutro', 'banado'],
        activo: true,
        creadoEn: serverTimestamp()
      });
    }
  }
}

async function refreshAll() {
  state.productos = await loadCollection('productos');
  state.usuarios = await loadCollection('usuarios');
  state.reportes = await loadCollection('reportes_diarios');

  renderDashboard();
  renderProductos();
  renderUsuarios();
  renderCargaDiaria();
  renderGerenciaExcel();
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
  $('btnRefrescarGerencia')?.addEventListener('click', renderGerenciaExcel);

  $('cargaFecha')?.addEventListener('change', () => {
    state.reporteActual = null;
    renderCargaDiaria();
  });

  $('cargaFabrica')?.addEventListener('change', () => {
    state.reporteActual = null;
    renderCargaDiaria();
  });

  els.menuBtn?.addEventListener('click', () => {
    els.sidebar?.classList.toggle('open');
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.currentUser = null;
    state.perfil = null;
    state.reporteActual = null;
    setLoggedUI(false);
    return;
  }

  state.currentUser = user;

  try {
    console.log('AUTH OK:', user.email);

    await seedBaseData();

    state.perfil = await fetchPerfil(user.email);
    console.log('PERFIL EN FIRESTORE:', state.perfil);

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
