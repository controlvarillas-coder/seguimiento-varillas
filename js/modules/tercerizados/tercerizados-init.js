/**
 * ============================================================
 *  tercerizados-init.js  — v6 DEFINITIVO
 *  js/modules/tercerizados/tercerizados-init.js
 *
 *  FIXES v6:
 *  - ROLES corregidos: incluye TODOS los que usa tercerizados.js
 *  - NO llama reset() cuando el rol no está en la lista
 *    (evita interferir con el login de app.js)
 *  - Sin setTimeouts múltiples que causaban race conditions
 *  - mostrarNav con un solo delay de 500ms para respetar
 *    que app.js termine su inicialización primero
 * ============================================================
 */

import { auth, db } from '../../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initTercerizados, destroyTercerizados } from './tercerizados.js';

// ← Todos los roles que maneja tercerizados.js
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

// ─── Observar sección ────────────────────────────────────────────────────────
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

  // Por si ya está activa al momento de inicializar
  if (sec.classList.contains('active')) arrancar();
}

// ─── Reset al cerrar sesión ──────────────────────────────────────────────────
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

  // Rol no permitido → solo ocultar nav, NO llamar reset()
  // para no interferir con el onAuthStateChanged de app.js
  if (!perfil || perfil.activo === false || !ROLES.includes(perfil.rol)) {
    mostrarNav(false);
    return;
  }

  perfilActual = perfil;

  // Esperar que app.js termine su propia inicialización (refreshAll, etc.)
  // antes de mostrar el nav y observar la sección
  setTimeout(() => {
    mostrarNav(true);
    observarSeccion();
  }, 500);
});
