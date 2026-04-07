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
  query,
  where,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

const state = {
  currentUser: null,
  perfil: null,
  productos: [],
  usuarios: []
};

const FABRICAS = {
  caja_chica: 'Caja chica',
  caja_grande: 'Caja grande',
  neutro: 'Neutro',
  banado: 'Bañado'
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
  if (!els.toast) {
    alert(message);
    return;
  }
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 3000);
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

function renderDashboard() {
  if ($('statProductos')) $('statProductos').textContent = state.productos.length;
  if ($('statReportes')) $('statReportes').textContent = 0;
  if ($('statBorradores')) $('statBorradores').textContent = 0;
  if ($('statEnviados')) $('statEnviados').textContent = 0;

  if ($('tablaDashboardReportes')) {
    $('tablaDashboardReportes').innerHTML = `
      <tr>
        <td colspan="4">Todavía no cargamos reportes en esta versión intermedia.</td>
      </tr>
    `;
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

  $('productosList').innerHTML = productosOrdenados.map((p) => `
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

function renderCargaDiaria() {
  const table = $('tablaCargaDiaria');
  if (!table) return;

  table.innerHTML = `
    <thead>
      <tr>
        <th>Producto</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="2">La carga diaria la armamos en el siguiente paso.</td>
      </tr>
    </tbody>
  `;

  if ($('estadoCarga')) $('estadoCarga').textContent = 'Módulo pendiente';
}

function renderGerenciaExcel() {
  const table = $('tablaGerenciaExcel');
  if (!table) return;

  table.innerHTML = `
    <thead>
      <tr>
        <th>Vista gerencial</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>La planilla mensual la armamos en el siguiente paso.</td>
      </tr>
    </tbody>
  `;
}

async function refreshAll() {
  state.productos = await loadCollection('productos');
  state.usuarios = await loadCollection('usuarios');

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
      toast('Sesión cerrada.');
    });
  }

  $('formProducto')?.addEventListener('submit', registrarProducto);

  $('btnRefrescarGerencia')?.addEventListener('click', renderGerenciaExcel);

  els.menuBtn?.addEventListener('click', () => {
    els.sidebar?.classList.toggle('open');
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.currentUser = null;
    state.perfil = null;
    setLoggedUI(false);
    return;
  }

  state.currentUser = user;

  try {
    console.log('AUTH OK:', user.email);

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
    await refreshAll();
    setSection('dashboard');
  } catch (error) {
    console.error('ERROR CARGANDO SISTEMA:', error);
    toast(`Error sistema: ${error.code || error.message || error}`);
  }
});

mountNavigation();
bindEvents();
