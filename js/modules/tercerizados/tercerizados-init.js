/**
 * ============================================================
 *  tercerizados-init.js  — v2
 *  js/modules/tercerizados/tercerizados-init.js
 *
 *  CONECTA el módulo al sistema SIN tocar app.js.
 *
 *  CÓMO FUNCIONA:
 *  1. Escucha onAuthStateChanged en paralelo a app.js
 *  2. Lee el perfil del usuario desde Firestore (colección 'usuarios')
 *  3. Si el rol es moron / control_calidad / gerencia:
 *     → muestra el nav-link #nav-tercerizados
 *     → instala MutationObserver sobre #section-tercerizados
 *     → cuando app.js le agrega clase 'active' → lanza initTercerizados()
 *     → cuando la pierde → llama destroyTercerizados()
 *  4. Al cerrar sesión → resetea todo
 * ============================================================
 */

import { auth, db } from '../../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initTercerizados, destroyTercerizados } from './tercerizados.js';

const ROLES_PERMITIDOS = ['moron', 'control_calidad', 'gerencia'];

let perfilActual  = null;
let moduloActivo  = false;
let observer      = null;

// ─── Leer perfil ──────────────────────────────────────────────────────────────
async function fetchPerfil(email) {
  try {
    const snap = await getDocs(
      query(collection(db, 'usuarios'), where('email', '==', email))
    );
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    console.error('[TercInit] fetchPerfil error:', e);
    return null;
  }
}

// ─── Mostrar / ocultar nav ────────────────────────────────────────────────────
function mostrarNav(visible) {
  const btn = document.getElementById('nav-tercerizados');
  if (btn) btn.style.display = visible ? '' : 'none';
}

// ─── Arrancar / detener módulo ────────────────────────────────────────────────
function arrancarModulo() {
  if (moduloActivo || !perfilActual) return;
  moduloActivo = true;
  initTercerizados(perfilActual);
}

function detenerModulo() {
  if (!moduloActivo) return;
  moduloActivo = false;
  destroyTercerizados();
}

// ─── Observar la sección ──────────────────────────────────────────────────────
function observarSeccion() {
  const seccion = document.getElementById('section-tercerizados');
  if (!seccion) return;

  if (observer) { observer.disconnect(); observer = null; }

  observer = new MutationObserver(() => {
    const activa = seccion.classList.contains('active');
    if (activa && !moduloActivo) arrancarModulo();
    else if (!activa && moduloActivo) detenerModulo();
  });

  observer.observe(seccion, { attributes: true, attributeFilter: ['class'] });

  // por si ya está activa al momento de inicializar
  if (seccion.classList.contains('active')) arrancarModulo();
}

// ─── Reset completo al cerrar sesión ─────────────────────────────────────────
function resetTodo() {
  detenerModulo();
  if (observer) { observer.disconnect(); observer = null; }
  perfilActual = null;
  mostrarNav(false);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { resetTodo(); return; }

  const perfil = await fetchPerfil(user.email);

  if (!perfil || perfil.activo === false || !ROLES_PERMITIDOS.includes(perfil.rol)) {
    resetTodo();
    return;
  }

  perfilActual = perfil;
  mostrarNav(true);
  observarSeccion();
});
