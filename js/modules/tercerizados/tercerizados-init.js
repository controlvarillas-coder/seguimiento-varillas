/**
 * tercerizados-init.js — v5
 * FIX: busca #nav-tercerizados (ahora con ID correcto en HTML)
 * + retry para evitar race condition con app.js
 */

import { auth, db } from '../../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initTercerizados, destroyTercerizados } from './tercerizados.js';

const ROLES_PERMITIDOS = ['moron', 'control_calidad', 'gerencia'];

let perfilActual = null;
let moduloActivo = false;
let observer     = null;

async function fetchPerfil(email) {
  try {
    const snap = await getDocs(query(collection(db, 'usuarios'), where('email', '==', email)));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) { return null; }
}

function mostrarNav(visible) {
  const btn = document.getElementById('nav-tercerizados');
  if (!btn) return;
  if (visible) {
    btn.style.display = 'block';
    btn.classList.remove('hidden');
  } else {
    btn.style.display = 'none';
  }
}

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
  if (seccion.classList.contains('active')) arrancarModulo();
}

function resetTodo() {
  detenerModulo();
  if (observer) { observer.disconnect(); observer = null; }
  perfilActual = null;
  mostrarNav(false);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { resetTodo(); return; }

  const perfil = await fetchPerfil(user.email);
  if (!perfil || perfil.activo === false || !ROLES_PERMITIDOS.includes(perfil.rol)) {
    resetTodo();
    return;
  }

  perfilActual = perfil;

  // Mostrar nav inmediatamente y reintentar varias veces
  // para evitar que app.js lo oculte con applyRoleUI
  mostrarNav(true);
  [100, 300, 600, 1000, 1800].forEach(ms => setTimeout(() => mostrarNav(true), ms));

  observarSeccion();
});
