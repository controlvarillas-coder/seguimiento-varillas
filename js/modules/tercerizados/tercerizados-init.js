/**
 * ============================================================
 *  INICIALIZADOR: tercerizados-init.js  — v2
 *  js/modules/tercerizados/tercerizados-init.js
 *
 *  PROPÓSITO:
 *    Conectar el módulo al sistema SIN tocar app.js.
 *
 *  FIX v2:
 *    - El nav-link ahora arranca OCULTO con display:none en CSS.
 *    - Este script lo muestra SOLO cuando el rol es permitido.
 *    - Funciona para moron, control_calidad y gerencia.
 *    - Usa MutationObserver para detectar cuándo app.js activa
 *      la sección "tercerizados" y lanza el módulo.
 * ============================================================
 */

import { auth, db } from '../../firebase-config.js';
import {
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection, query, where, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initTercerizados, destroyTercerizados } from './tercerizados.js';

// ─── Roles permitidos ─────────────────────────────────────────────────────────
const ROLES = ['moron', 'control_calidad', 'gerencia'];

// ─── Estado ───────────────────────────────────────────────────────────────────
let moduloActivo  = false;
let perfilActual  = null;
let observerInst  = null;

// ─── Leer perfil desde Firestore ──────────────────────────────────────────────
async function fetchPerfil(email) {
  try {
    const snap = await getDocs(
      query(collection(db, 'usuarios'), where('email', '==', email))
    );
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    console.error('[TercInit] fetchPerfil:', e);
    return null;
  }
}

// ─── Mostrar / ocultar nav-link ───────────────────────────────────────────────
function setNavVisible(visible) {
  // Buscar tanto por clase como por data-section (doble seguridad)
  document.querySelectorAll(
    '.terc-nav-link, [data-section="tercerizados"]'
  ).forEach(el => {
    el.style.display = visible ? '' : 'none';
  });
}

// ─── Observar cuándo app.js activa la sección ────────────────────────────────
function observarSeccion() {
  const seccion = document.getElementById('section-tercerizados');
  if (!seccion) return;

  // Evitar duplicar observer
  if (observerInst) { observerInst.disconnect(); observerInst = null; }

  observerInst = new MutationObserver(mutations => {
    mutations.forEach(m => {
      if (m.type !== 'attributes' || m.attributeName !== 'class') return;
      const activa = seccion.classList.contains('active');
      if (activa && !moduloActivo && perfilActual) {
        moduloActivo = true;
        initTercerizados(perfilActual);
      } else if (!activa && moduloActivo) {
        moduloActivo = false;
        destroyTercerizados();
      }
    });
  });

  observerInst.observe(seccion, { attributes: true });

  // Si por alguna razón ya está activa al momento de llamar esto
  if (seccion.classList.contains('active') && !moduloActivo && perfilActual) {
    moduloActivo = true;
    initTercerizados(perfilActual);
  }
}

// ─── Reset completo ───────────────────────────────────────────────────────────
function reset() {
  perfilActual = null;
  moduloActivo = false;
  if (observerInst) { observerInst.disconnect(); observerInst = null; }
  setNavVisible(false);
  destroyTercerizados();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { reset(); return; }

  const perfil = await fetchPerfil(user.email);

  // Sin perfil, inactivo o sin rol permitido → ocultar todo
  if (!perfil || perfil.activo === false || !ROLES.includes(perfil.rol)) {
    reset();
    return;
  }

  perfilActual = perfil;
  setNavVisible(true);
  observarSeccion();
});
