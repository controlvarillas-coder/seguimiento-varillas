/**
 * ============================================================
 *  tercerizados-init.js  — v6 definitivo
 *  js/modules/tercerizados/tercerizados-init.js
 *
 *  ROLES con acceso:
 *    moron           → crear · checks armado · enviar · ingreso
 *    control_calidad → checks validador
 *    planificacion   → checks validador
 *    tercerizado     → recibir · entregar
 *    gerencia        → todo + reporte fallas
 *
 *  FIXES v6:
 *    - ROLES incluye todos los que usa tercerizados.js
 *    - Cuando el rol no está en la lista NO llama reset()
 *      → evita interferir con onAuthStateChanged de app.js
 *    - Sin setTimeouts múltiples (race condition)
 *    - Un único setTimeout(500ms) para esperar que app.js
 *      termine refreshAll() antes de mostrar el nav
 * ============================================================
 */

import { auth, db } from '../../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initTercerizados, destroyTercerizados } from './tercerizados.js';

const ROLES = ['moron', 'planificacion', 'control_calidad', 'tercerizado', 'gerencia'];

let perfilActual = null;
let moduloActivo = false;
let observer     = null;

// ─── Leer perfil desde Firestore ─────────────────────────────────────────────
async function fetchPerfil(email) {
  try {
    const snap = await getDocs(
      query(collection(db, 'usuarios'), where('email', '==', email))
    );
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, uid: d.id, ...d.data() };
  } catch (e) {
    console.error('[TercInit] fetchPerfil:', e);
    return null;
  }
}

// ─── Mostrar / ocultar nav ───────────────────────────────────────────────────
function mostrarNav(visible) {
  const btn = document.getElementById('nav-tercerizados');
  if (!btn) return;
  btn.style.display = visible ? '' : 'none';
}

// ─── Arrancar / detener módulo ───────────────────────────────────────────────
function arrancar() {
  if (moduloActivo || !perfilActual) return;
  moduloActivo = true;
  initTercerizados(perfilActual);
}

function detener() {
  if (!moduloActivo) return;
  moduloActivo = false;
  destroyTercerizados();
}

// ─── Observar cuando app.js activa la sección ────────────────────────────────
function observarSeccion() {
  const sec = document.getElementById('section-tercerizados');
  if (!sec) return;
  if (observer) { observer.disconnect(); observer = null; }

  observer = new MutationObserver(() => {
    const activa = sec.classList.contains('active');
    if (activa && !moduloActivo) arrancar();
    else if (!activa && moduloActivo) detener();
  });

  observer.observe(sec, { attributes: true, attributeFilter: ['class'] });

  // por si la sección ya está activa al momento de inicializar
  if (sec.classList.contains('active')) arrancar();
}

// ─── Reset completo al cerrar sesión ─────────────────────────────────────────
function reset() {
  detener();
  if (observer) { observer.disconnect(); observer = null; }
  perfilActual = null;
  mostrarNav(false);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    reset();
    return;
  }

  const perfil = await fetchPerfil(user.email);

  // Rol no permitido → solo ocultar nav
  // NO llamar reset() para no interferir con app.js
  if (!perfil || perfil.activo === false || !ROLES.includes(perfil.rol)) {
    mostrarNav(false);
    return;
  }

  perfilActual = perfil;

  // Esperar que app.js termine su refreshAll() antes de mostrar el nav
  setTimeout(() => {
    mostrarNav(true);
    observarSeccion();
  }, 500);
});
