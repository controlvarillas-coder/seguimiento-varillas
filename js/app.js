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
  getDoc,
  doc,
  setDoc,
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
  depositos: [],
  movimientos: [],
  stock: [],
  alertas: [],
  usuarios: []
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
  setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function formatDate(value) {
  if (!value) return '-';
  const date = value?.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-AR');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = value?.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-AR');
}

function badge(status) {
  const map = {
    pendiente: ['pending', 'Pendiente'],
    recibido_correcto: ['ok', 'Correcto'],
    recibido_con_diferencia: ['diff', 'Con diferencia']
  };
  const [cls, label] = map[status] || ['pending', status || 'Pendiente'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function setLoggedUI(logged) {
  els.loginScreen.classList.toggle('active', !logged);
  els.appScreen.classList.toggle('active', logged);
  els.logoutBtn.classList.toggle('hidden', !logged);
  els.connectionPill.textContent = logged ? 'Conectado a Firebase' : 'Modo demo';
}

function applyRoleUI() {
  const rol = state.perfil?.rol || 'deposito';
  document.querySelectorAll('.gerencia-only').forEach((el) => {
    el.classList.toggle('hidden', rol !== 'gerencia');
  });

  if (rol === 'gerencia') {
    els.pageTitle.textContent = 'Dashboard gerencial';
  } else if (rol === 'produccion') {
    els.pageTitle.textContent = 'Panel de producción';
  } else {
    els.pageTitle.textContent = 'Panel de depósito';
  }
}

function fillUserCard() {
  const name = state.perfil?.nombre || state.currentUser?.email || 'Usuario';
  const role = state.perfil?.rol || 'sin rol';
  $('miniName').textContent = name;
  $('miniRole').textContent = role;
  $('avatarMini').textContent = name.trim().charAt(0).toUpperCase();
}

function setSection(sectionId) {
  document.querySelectorAll('.section').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach((el) => el.classList.toggle('active', el.dataset.section === sectionId));
  $(`section-${sectionId}`).classList.add('active');
  const titles = {
    dashboard: 'Dashboard general',
    movimientos: 'Movimientos entre depósitos',
    stock: 'Stock por depósito',
    alertas: 'Alertas y diferencias',
    usuarios: 'Usuarios del sistema'
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

async function fetchPerfil(email) {
  const querySnap = await getDocs(query(collection(db, 'usuarios'), where('email', '==', email)));
  if (querySnap.empty) return null;
  const docSnap = querySnap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

async function loadCollection(name, options = {}) {
  let ref = collection(db, name);
  const snap = options.query ? await getDocs(options.query(ref)) : await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function byId(arr, id) {
  return arr.find((x) => x.id === id);
}

function populateSelects() {
  $('movProducto').innerHTML = state.productos.map((p) => `<option value="${p.id}">${p.nombre}</option>`).join('');
  $('movOrigen').innerHTML = state.depositos.map((d) => `<option value="${d.id}">${d.nombre}</option>`).join('');
  $('movDestino').innerHTML = state.depositos.map((d) => `<option value="${d.id}">${d.nombre}</option>`).join('');

  const pendientes = state.movimientos.filter((m) => m.estado === 'pendiente');
  $('recepcionMovimiento').innerHTML = pendientes.length
    ? pendientes.map((m) => {
        const producto = byId(state.productos, m.productoId)?.nombre || 'Producto';
        const origen = byId(state.depositos, m.origenId)?.nombre || 'Origen';
        const destino = byId(state.depositos, m.destinoId)?.nombre || 'Destino';
        return `<option value="${m.id}">${formatDate(m.fechaEnvio)} · ${producto} · ${origen} → ${destino} · ${m.cantidadEnviada}</option>`;
      }).join('')
    : '<option value="">No hay pendientes</option>';
}

function renderDashboard() {
  const hoy = new Date().toISOString().slice(0, 10);
  const movimientosHoy = state.movimientos.filter((m) => {
    const f = m.fechaSimple || (m.fechaEnvio ? new Date(m.fechaEnvio).toISOString().slice(0,10) : '');
    return f === hoy;
  });
  const pendientes = state.movimientos.filter((m) => m.estado === 'pendiente');
  const alertasAbiertas = state.alertas.filter((a) => !a.resuelta);
  const totalStock = state.stock.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);

  $('statMovimientos').textContent = movimientosHoy.length;
  $('statPendientes').textContent = pendientes.length;
  $('statAlertas').textContent = alertasAbiertas.length;
  $('statStock').textContent = totalStock;

  $('dashboardMovimientos').innerHTML = state.movimientos.slice(0, 8).map((m) => {
    const producto = byId(state.productos, m.productoId)?.nombre || '-';
    const origen = byId(state.depositos, m.origenId)?.nombre || '-';
    const destino = byId(state.depositos, m.destinoId)?.nombre || '-';
    return `<tr>
      <td>${formatDate(m.fechaEnvio)}</td>
      <td>${producto}</td>
      <td>${origen}</td>
      <td>${destino}</td>
      <td>${badge(m.estado)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">Sin movimientos cargados.</td></tr>';

  $('alertasList').innerHTML = alertasAbiertas.slice(0, 6).map((a) => `
    <div class="alert-item">
      <strong>${a.titulo || 'Diferencia detectada'}</strong>
      <p>${a.mensaje || ''}</p>
    </div>
  `).join('') || '<div class="alert-item"><strong>Sin alertas activas</strong><p>Todo viene correcto por ahora.</p></div>';
}

function renderMovimientos() {
  $('tablaMovimientos').innerHTML = state.movimientos.map((m) => {
    const producto = byId(state.productos, m.productoId)?.nombre || '-';
    const origen = byId(state.depositos, m.origenId)?.nombre || '-';
    const destino = byId(state.depositos, m.destinoId)?.nombre || '-';
    return `<tr>
      <td>${formatDate(m.fechaEnvio)}</td>
      <td>${producto}</td>
      <td>${m.cantidadEnviada ?? '-'}</td>
      <td>${m.cantidadRecibida ?? '-'}</td>
      <td>${origen}</td>
      <td>${destino}</td>
      <td>${badge(m.estado)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7">Todavía no hay movimientos.</td></tr>';
}

function renderStock() {
  $('tablaStock').innerHTML = state.stock.map((s) => {
    const producto = byId(state.productos, s.productoId)?.nombre || '-';
    const deposito = byId(state.depositos, s.depositoId)?.nombre || '-';
    return `<tr>
      <td>${producto}</td>
      <td>${deposito}</td>
      <td>${s.cantidad ?? 0}</td>
      <td>${formatDateTime(s.actualizadoEn)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4">Sin stock cargado todavía.</td></tr>';
}

function renderAlertas() {
  $('tablaAlertas').innerHTML = state.alertas.map((a) => `
    <tr>
      <td>${formatDate(a.fecha || a.creadoEn)}</td>
      <td>${a.movimientoId || '-'}</td>
      <td>${a.mensaje || '-'}</td>
      <td>${a.resuelta ? badge('recibido_correcto') : badge('recibido_con_diferencia')}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Sin alertas registradas.</td></tr>';
}

function renderUsuarios() {
  $('tablaUsuarios').innerHTML = state.usuarios.map((u) => {
    const deposito = byId(state.depositos, u.depositoId)?.nombre || '-';
    return `<tr>
      <td>${u.nombre || '-'}</td>
      <td>${u.email || '-'}</td>
      <td>${u.rol || '-'}</td>
      <td>${deposito}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4">Sin usuarios cargados.</td></tr>';
}

async function refreshAll() {
  state.productos = await loadCollection('productos');
  state.depositos = await loadCollection('depositos');
  state.movimientos = await loadCollection('movimientos', { query: (ref) => query(ref, orderBy('creadoEn', 'desc')) });
  state.stock = await loadCollection('stock');
  state.alertas = await loadCollection('alertas', { query: (ref) => query(ref, orderBy('creadoEn', 'desc')) });
  state.usuarios = await loadCollection('usuarios');

  populateSelects();
  renderDashboard();
  renderMovimientos();
  renderStock();
  renderAlertas();
  renderUsuarios();
}

async function updateStock(productoId, depositoId, delta) {
  const existing = state.stock.find((s) => s.productoId === productoId && s.depositoId === depositoId);
  if (existing) {
    const nuevaCantidad = Number(existing.cantidad || 0) + Number(delta || 0);
    await updateDoc(doc(db, 'stock', existing.id), {
      cantidad: nuevaCantidad,
      actualizadoEn: serverTimestamp()
    });
  } else {
    await addDoc(collection(db, 'stock'), {
      productoId,
      depositoId,
      cantidad: Number(delta || 0),
      actualizadoEn: serverTimestamp()
    });
  }
}

async function registrarMovimiento(ev) {
  ev.preventDefault();

  const fecha = $('movFecha').value;
  const productoId = $('movProducto').value;
  const origenId = $('movOrigen').value;
  const destinoId = $('movDestino').value;
  const cantidadEnviada = Number($('movCantidad').value || 0);
  const observaciones = $('movObs').value.trim();

  if (!fecha || !productoId || !origenId || !destinoId || cantidadEnviada <= 0) {
    toast('Completá todos los datos del movimiento.');
    return;
  }

  if (origenId === destinoId) {
    toast('El origen y destino no pueden ser iguales.');
    return;
  }

  await addDoc(collection(db, 'movimientos'), {
    fechaEnvio: fecha,
    fechaSimple: fecha,
    productoId,
    origenId,
    destinoId,
    cantidadEnviada,
    cantidadRecibida: null,
    estado: 'pendiente',
    observaciones,
    enviadoPor: state.currentUser.email,
    creadoEn: serverTimestamp()
  });

  await updateStock(productoId, origenId, -cantidadEnviada);

  ev.target.reset();
  $('movFecha').value = new Date().toISOString().slice(0,10);
  toast('Movimiento guardado correctamente.');
  await refreshAll();
}

async function confirmarRecepcion(ev) {
  ev.preventDefault();

  const movimientoId = $('recepcionMovimiento').value;
  const cantidadRecibida = Number($('recepcionCantidad').value || 0);
  const observacionesRecepcion = $('recepcionObs').value.trim();
  if (!movimientoId || cantidadRecibida <= 0) {
    toast('Seleccioná un movimiento y la cantidad recibida.');
    return;
  }

  const movimiento = state.movimientos.find((m) => m.id === movimientoId);
  if (!movimiento) {
    toast('No encontré ese movimiento.');
    return;
  }

  const hayDiferencia = Number(movimiento.cantidadEnviada) !== cantidadRecibida;
  const nuevoEstado = hayDiferencia ? 'recibido_con_diferencia' : 'recibido_correcto';

  await updateDoc(doc(db, 'movimientos', movimientoId), {
    cantidadRecibida,
    estado: nuevoEstado,
    recibidoPor: state.currentUser.email,
    fechaRecepcion: new Date().toISOString().slice(0,10),
    observacionesRecepcion
  });

  await updateStock(movimiento.productoId, movimiento.destinoId, cantidadRecibida);

  if (hayDiferencia) {
    await addDoc(collection(db, 'alertas'), {
      titulo: 'Diferencia entre envío y recepción',
      movimientoId,
      mensaje: `Se enviaron ${movimiento.cantidadEnviada} y se recibieron ${cantidadRecibida}.`,
      resuelta: false,
      fecha: new Date().toISOString().slice(0,10),
      creadoEn: serverTimestamp()
    });
  }

  ev.target.reset();
  toast(hayDiferencia ? 'Recepción guardada con diferencia.' : 'Recepción confirmada correctamente.');
  await refreshAll();
}

async function seedBaseData() {
  const deposits = await getDocs(collection(db, 'depositos'));
  if (deposits.empty) {
    const defaults = ['Bañado', 'Alvear', 'Morón', 'Producción', 'Gerencia'];
    for (const nombre of defaults) {
      await addDoc(collection(db, 'depositos'), { nombre, activo: true, creadoEn: serverTimestamp() });
    }
  }

  const products = await getDocs(collection(db, 'productos'));
  if (products.empty) {
    const defaults = ['Varilla clásica', 'Varilla premium', 'Varilla perfumada'];
    for (const nombre of defaults) {
      await addDoc(collection(db, 'productos'), { nombre, activo: true, creadoEn: serverTimestamp() });
    }
  }
}

function bindEvents() {
  els.loginForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
      toast('Sesión iniciada correctamente.');
    } catch (error) {
      console.error(error);
      toast('No se pudo iniciar sesión. Revisá email y contraseña.');
    }
  });

  els.logoutBtn.addEventListener('click', async () => {
    await signOut(auth);
    toast('Sesión cerrada.');
  });

  $('formMovimiento').addEventListener('submit', registrarMovimiento);
  $('formRecepcion').addEventListener('submit', confirmarRecepcion);

  els.menuBtn.addEventListener('click', () => els.sidebar.classList.toggle('open'));
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
    await seedBaseData();
    state.perfil = await fetchPerfil(user.email);
    setLoggedUI(true);
    applyRoleUI();
    fillUserCard();
    await refreshAll();
    setSection('dashboard');
  } catch (error) {
    console.error(error);
    toast('Error al cargar los datos del sistema.');
  }
});

mountNavigation();
bindEvents();
$('movFecha').value = new Date().toISOString().slice(0,10);
