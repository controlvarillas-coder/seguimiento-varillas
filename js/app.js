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
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

const state = {
  currentUser: null,
  perfil: null,
  productos: [],
  usuarios: [],
  planillas: [],
  planillaActual: null
};

const els = {
  loginScreen: $('screen-login'),
  appScreen: $('screen-app'),
  loginForm: $('loginForm'),
  logoutBtn: $('logoutBtn'),
  connectionPill: $('connectionPill'),
  toast: $('toast'),
  menuBtn: $('menuBtn'),
  sidebar: $('sidebar'),
  pageTitle: $('pageTitle')
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function setLoggedUI(logged) {
  els.loginScreen.classList.toggle('active', !logged);
  els.appScreen.classList.toggle('active', logged);
}

function setSection(sectionId) {
  document.querySelectorAll('.section').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach((el) => {
    el.classList.toggle('active', el.dataset.section === sectionId);
  });

  const target = $(`section-${sectionId}`);
  if (target) target.classList.add('active');

  const titles = {
    dashboard: 'Dashboard general',
    productos: 'Gestión de productos',
    movimientos: 'Planilla diaria',
    usuarios: 'Usuarios'
  };

  els.pageTitle.textContent = titles[sectionId] || 'Varillas Control';
}

function mountNavigation() {
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSection(btn.dataset.section);
      els.sidebar.classList.remove('open');
    });
  });
}

function fillUserCard() {
  const name = state.perfil?.nombre || state.currentUser?.email || 'Usuario';
  const role = state.perfil?.rol || 'usuario';

  $('miniName').textContent = name;
  $('miniRole').textContent = role;
  $('avatarMini').textContent = name.charAt(0).toUpperCase();
}

async function fetchPerfil(email) {
  const q = query(collection(db, 'usuarios'), where('email', '==', email));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function loadCollection(name, options = {}) {
  const ref = collection(db, name);
  const snap = options.queryBuilder ? await getDocs(options.queryBuilder(ref)) : await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderDashboard() {
  $('statProductos').textContent = state.productos.length;
  $('statPlanillas').textContent = state.planillas.length;
  $('statPendientes').textContent = state.planillas.filter((p) => p.estado === 'borrador').length;
  $('statEnviadas').textContent = state.planillas.filter((p) => p.estado === 'enviada').length;

  $('dashboardPlanillas').innerHTML = state.planillas.slice(0, 10).map((p) => `
    <tr>
      <td>${p.fecha || '-'}</td>
      <td>${labelFabrica(p.fabrica)}</td>
      <td>${p.estado || '-'}</td>
      <td>${p.creadoPor || '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Sin planillas cargadas.</td></tr>';
}

function labelFabrica(value) {
  const map = {
    caja_chica: 'Caja chica',
    caja_grande: 'Caja grande',
    neutro: 'Neutro',
    banado: 'Bañado'
  };
  return map[value] || value || '-';
}

function visibleParaTexto(arr = []) {
  return arr.map(labelFabrica).join(' · ');
}

function renderProductos() {
  $('productosCount').textContent = state.productos.length;
  $('productosActivos').textContent = state.productos.filter((p) => p.activo !== false).length;

  $('productosList').innerHTML = state.productos.map((p) => `
    <div class="product-row">
      <div class="product-main">
        <div class="product-title">${p.nombre || '-'}</div>
        <div class="product-sub">
          Código: ${p.codigo || '-'} · Categoría: ${p.categoria || '-'} · Visible para: ${visibleParaTexto(p.visiblePara || [])}
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
      const producto = state.productos.find((p) => p.id === id);
      if (!producto) return;

      await updateDoc(doc(db, 'productos', id), {
        activo: producto.activo === false ? true : false
      });

      toast('Producto actualizado.');
      await refreshAll();
    });
  });
}

function renderUsuarios() {
  $('tablaUsuarios').innerHTML = state.usuarios.map((u) => `
    <tr>
      <td>${u.nombre || '-'}</td>
      <td>${u.email || '-'}</td>
      <td>${u.rol || '-'}</td>
      <td>${labelFabrica(u.fabrica || '')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Sin usuarios.</td></tr>';
}

function getProductosVisiblesParaFabrica(fabrica) {
  if (state.perfil?.rol === 'gerencia') return state.productos.filter((p) => p.activo !== false);
  return state.productos.filter((p) => (p.activo !== false) && (p.visiblePara || []).includes(fabrica));
}

function buildDefaultRows(fabrica) {
  const productos = getProductosVisiblesParaFabrica(fabrica);

  return productos.map((p) => ({
    productoId: p.id,
    productoNombre: p.nombre,
    stockInicial: 0,
    cajaChica: 0,
    cajaGrande: 0,
    neutro: 0,
    banado: 0
  }));
}

function renderPlanilla() {
  const fabrica = $('planillaFabrica').value;
  const rows = state.planillaActual?.rows || buildDefaultRows(fabrica);
  const isGerencia = state.perfil?.rol === 'gerencia';
  const isBloqueada = state.planillaActual?.estado === 'enviada' && !isGerencia;

  $('planillaEstado').textContent = state.planillaActual
    ? `Estado: ${state.planillaActual.estado || 'borrador'}`
    : 'Sin cargar';

  $('btnGuardarPlanilla').disabled = isBloqueada;
  $('btnEnviarPlanilla').disabled = isBloqueada;

  $('excelBody').innerHTML = rows.map((row, index) => {
    const total = Number(row.stockInicial || 0) + Number(row.cajaChica || 0) + Number(row.cajaGrande || 0) + Number(row.neutro || 0) + Number(row.banado || 0);

    return `
      <tr>
        <td class="sticky-col product-name-cell">${row.productoNombre}</td>
        <td><input class="excel-input" data-row="${index}" data-field="stockInicial" type="number" value="${row.stockInicial || 0}" ${isBloqueada ? 'disabled' : ''}></td>
        <td><input class="excel-input cc" data-row="${index}" data-field="cajaChica" type="number" value="${row.cajaChica || 0}" ${isBloqueada ? 'disabled' : ''}></td>
        <td><input class="excel-input cg" data-row="${index}" data-field="cajaGrande" type="number" value="${row.cajaGrande || 0}" ${isBloqueada ? 'disabled' : ''}></td>
        <td><input class="excel-input ne" data-row="${index}" data-field="neutro" type="number" value="${row.neutro || 0}" ${isBloqueada ? 'disabled' : ''}></td>
        <td><input class="excel-input ba" data-row="${index}" data-field="banado" type="number" value="${row.banado || 0}" ${isBloqueada ? 'disabled' : ''}></td>
        <td class="total-cell">${total}</td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('.excel-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const rowIndex = Number(e.target.dataset.row);
      const field = e.target.dataset.field;
      const value = Number(e.target.value || 0);

      if (!state.planillaActual) {
        state.planillaActual = {
          fecha: $('planillaFecha').value,
          fabrica: $('planillaFabrica').value,
          estado: 'borrador',
          rows: buildDefaultRows($('planillaFabrica').value)
        };
      }

      state.planillaActual.rows[rowIndex][field] = value;
      renderPlanilla();
    });
  });

  renderPlanillaTotales();
}

function renderPlanillaTotales() {
  const rows = state.planillaActual?.rows || [];
  let stockInicial = 0;
  let cajaChica = 0;
  let cajaGrande = 0;
  let neutro = 0;
  let banado = 0;

  rows.forEach((r) => {
    stockInicial += Number(r.stockInicial || 0);
    cajaChica += Number(r.cajaChica || 0);
    cajaGrande += Number(r.cajaGrande || 0);
    neutro += Number(r.neutro || 0);
    banado += Number(r.banado || 0);
  });

  $('ftStockInicial').textContent = stockInicial;
  $('ftCajaChica').textContent = cajaChica;
  $('ftCajaGrande').textContent = cajaGrande;
  $('ftNeutro').textContent = neutro;
  $('ftBanado').textContent = banado;
  $('ftGeneral').textContent = stockInicial + cajaChica + cajaGrande + neutro + banado;
}

async function cargarPlanilla() {
  const fecha = $('planillaFecha').value;
  const fabrica = $('planillaFabrica').value;

  if (!fecha || !fabrica) {
    toast('Seleccioná fecha y fábrica.');
    return;
  }

  const q = query(
    collection(db, 'planillas'),
    where('fecha', '==', fecha),
    where('fabrica', '==', fabrica)
  );

  const snap = await getDocs(q);

  if (!snap.empty) {
    const d = snap.docs[0];
    state.planillaActual = { id: d.id, ...d.data() };
    toast('Planilla cargada.');
  } else {
    state.planillaActual = {
      fecha,
      fabrica,
      estado: 'borrador',
      rows: buildDefaultRows(fabrica)
    };
    toast('Nueva planilla creada en memoria.');
  }

  renderPlanilla();
}

async function guardarPlanilla(estadoFinal = 'borrador') {
  const fecha = $('planillaFecha').value;
  const fabrica = $('planillaFabrica').value;

  if (!fecha || !fabrica) {
    toast('Seleccioná fecha y fábrica.');
    return;
  }

  if (!state.planillaActual) {
    toast('Primero cargá la planilla.');
    return;
  }

  const esGerencia = state.perfil?.rol === 'gerencia';

  if (state.planillaActual.estado === 'enviada' && !esGerencia) {
    toast('La planilla ya fue enviada y no puede modificarse.');
    return;
  }

  const q = query(
    collection(db, 'planillas'),
    where('fecha', '==', fecha),
    where('fabrica', '==', fabrica)
  );

  const snap = await getDocs(q);

  const payload = {
    fecha,
    fabrica,
    estado: estadoFinal,
    rows: state.planillaActual.rows || [],
    creadoPor: state.currentUser?.email || '',
    actualizadoEn: new Date().toISOString(),
    creadoEn: state.planillaActual.creadoEn || new Date().toISOString()
  };

  if (snap.empty) {
    await addDoc(collection(db, 'planillas'), {
      ...payload,
      creadoTimestamp: serverTimestamp()
    });
  } else {
    const docId = snap.docs[0].id;
    await updateDoc(doc(db, 'planillas', docId), payload);
  }

  toast(estadoFinal === 'enviada' ? 'Planilla enviada correctamente.' : 'Borrador guardado.');
  await refreshAll();
  await cargarPlanilla();
}

async function registrarProducto(ev) {
  ev.preventDefault();

  const nombre = $('prodNombre').value.trim();
  const codigo = $('prodCodigo').value.trim();
  const categoria = $('prodCategoria').value.trim();
  const visiblePara = Array.from(document.querySelectorAll('input[name="visiblePara"]:checked')).map((i) => i.value);

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
  document.querySelectorAll('input[name="visiblePara"]').forEach((i) => i.checked = true);

  toast('Producto guardado.');
  await refreshAll();
}

async function seedBaseData() {
  const productosSnap = await getDocs(collection(db, 'productos'));
  if (productosSnap.empty) {
    const defaults = [
      { nombre: 'P.S. Incienso', categoria: 'Aromas' },
      { nombre: 'P.S. Copal', categoria: 'Aromas' },
      { nombre: 'P.S. Mirra', categoria: 'Aromas' },
      { nombre: 'P.S. Jazmín', categoria: 'Aromas' },
      { nombre: 'P.S. Vainilla', categoria: 'Aromas' }
    ];

    for (const item of defaults) {
      await addDoc(collection(db, 'productos'), {
        ...item,
        codigo: '',
        visiblePara: ['caja_chica', 'caja_grande', 'neutro', 'banado'],
        activo: true,
        creadoEn: serverTimestamp()
      });
    }
  }
}

async function refreshAll() {
  state.productos = await loadCollection('productos', {
    queryBuilder: (ref) => query(ref, orderBy('nombre'))
  });

  state.usuarios = await loadCollection('usuarios');
  state.planillas = await loadCollection('planillas', {
    queryBuilder: (ref) => query(ref, orderBy('creadoTimestamp', 'desc'))
  });

  renderDashboard();
  renderProductos();
  renderUsuarios();
  renderPlanilla();
}

function bindEvents() {
  els.loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    try {
      await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
      toast('Sesión iniciada correctamente.');
    } catch (error) {
      console.error(error);
      toast('No se pudo iniciar sesión.');
    }
  });

  els.logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
  });

  $('formProducto').addEventListener('submit', registrarProducto);
  $('btnCargarPlanilla').addEventListener('click', cargarPlanilla);
  $('btnGuardarPlanilla').addEventListener('click', () => guardarPlanilla('borrador'));
  $('btnEnviarPlanilla').addEventListener('click', () => guardarPlanilla('enviada'));

  $('planillaFecha').addEventListener('change', () => {
    state.planillaActual = null;
    renderPlanilla();
  });

  $('planillaFabrica').addEventListener('change', () => {
    state.planillaActual = null;
    renderPlanilla();
  });

  els.menuBtn.addEventListener('click', () => {
    els.sidebar.classList.toggle('open');
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.currentUser = null;
    state.perfil = null;
    state.planillaActual = null;
    setLoggedUI(false);
    return;
  }

  state.currentUser = user;

  try {
    await seedBaseData();
    state.perfil = await fetchPerfil(user.email);
    setLoggedUI(true);
    fillUserCard();
    await refreshAll();
    setSection('dashboard');
  } catch (error) {
    console.error(error);
    toast('Error al cargar el sistema.');
  }
});

mountNavigation();
bindEvents();
$('planillaFecha').value = new Date().toISOString().slice(0, 10);
