/**
 * ============================================================
 *  tercerizados-init.js  — v7 definitivo
 *  js/modules/tercerizados/tercerizados-init.js
 *
 *  FIX v7: mostrarNav usaba display='' que devolvía el control
 *  al CSS que tiene #nav-tercerizados { display:none }
 *  → el botón quedaba oculto igual.
 *  Corrección: display='block' cuando visible=true.
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

function mostrarNav(visible) {
  const btn = document.getElementById('nav-tercerizados');
  if (!btn) return;
  // ← CRÍTICO: usar 'block' y no '' para sobreescribir el CSS display:none
  btn.style.display = visible ? 'block' : 'none';
}

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
  if (sec.classList.contains('active')) arrancar();
}

function reset() {
  detener();
  if (observer) { observer.disconnect(); observer = null; }
  perfilActual = null;
  mostrarNav(false);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { reset(); return; }

  const perfil = await fetchPerfil(user.email);

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
