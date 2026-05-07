/**
 * tercerizados-init.js — v7
 *
 * FIXES:
 * - ROLES incluye todos los que usa el módulo
 * - mostrarNav usa display='block' (no '' que devuelve control al CSS display:none)
 * - Cuando rol no está en lista NO llama resetTodo() para no interferir con app.js
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
  // 'block' sobreescribe el CSS display:none del archivo tercerizados.css
  btn.style.display = visible ? 'block' : 'none';
  if (visible) btn.classList.remove('hidden');
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

  // Rol no permitido → solo ocultar nav, NO resetear nada más
  // (para no interferir con el onAuthStateChanged de app.js)
  if (!perfil || perfil.activo === false || !ROLES.includes(perfil.rol)) {
    mostrarNav(false);
    return;
  }

  perfilActual = perfil;

  // Esperar que app.js termine su refreshAll antes de mostrar el nav
  setTimeout(() => {
    mostrarNav(true);
    observarSeccion();
  }, 800);
});
