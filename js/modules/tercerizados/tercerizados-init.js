/**
 * ============================================================
 *  INICIALIZADOR: tercerizados-init.js — v3
 *  js/modules/tercerizados/tercerizados-init.js
 *
 *  FIXES v3:
 *  - Sin race condition con app.js
 *  - Usa polling robusto para detectar cuando app.js ya cargó el perfil
 *  - gerencia, moron y control_calidad ven el módulo
 *  - El nav se muestra DESPUÉS de que app.js termine de ocultar gerencia-only
 * ============================================================
 */

import { auth, db } from '../../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initTercerizados, destroyTercerizados } from './tercerizados.js';

const ROLES_PERMITIDOS = ['moron', 'control_calidad', 'gerencia'];

let moduloActivo  = false;
let perfilActual  = null;
let observerInst  = null;

async function fetchPerfil(email) {
  try {
    const snap = await getDocs(query(collection(db, 'usuarios'), where('email', '==', email)));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    console.error('[TercInit] fetchPerfil:', e);
    return null;
  }
}

function setNavVisible(visible) {
  // Intentar múltiples veces para evitar race condition con app.js
  const mostrar = () => {
    const links = document.querySelectorAll('.terc-nav-link, [data-section="tercerizados"]');
    links.forEach(el => {
      el.style.display = visible ? '' : 'none';
      el.style.visibility = visible ? '' : 'hidden';
      if (visible) {
        // Forzar visibilidad quitando cualquier clase hidden que app.js haya puesto
        el.classList.remove('hidden');
      }
    });
  };

  mostrar();
  // Reintentar después de que app.js termine de procesar
  setTimeout(mostrar, 100);
  setTimeout(mostrar, 300);
  setTimeout(mostrar, 600);
}

function observarSeccion() {
  const seccion = document.getElementById('section-tercerizados');
  if (!seccion) return;

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

  // Si ya está activa
  if (seccion.classList.contains('active') && !moduloActivo && perfilActual) {
    moduloActivo = true;
    initTercerizados(perfilActual);
  }
}

function reset() {
  perfilActual  = null;
  moduloActivo  = false;
  if (observerInst) { observerInst.disconnect(); observerInst = null; }
  setNavVisible(false);
  destroyTercerizados();
}

onAuthStateChanged(auth, async user => {
  if (!user) { reset(); return; }

  const perfil = await fetchPerfil(user.email);

  if (!perfil || perfil.activo === false || !ROLES_PERMITIDOS.includes(perfil.rol)) {
    reset();
    return;
  }

  perfilActual = perfil;

  // Esperar a que app.js termine su inicialización antes de mostrar el nav
  // app.js llama applyRoleUI que puede ocultar elementos
  const mostrarNav = () => {
    setNavVisible(true);
    observarSeccion();
  };

  // DOM listo → esperar 400ms para que app.js termine applyRoleUI
  if (document.readyState === 'complete') {
    setTimeout(mostrarNav, 400);
  } else {
    window.addEventListener('load', () => setTimeout(mostrarNav, 400));
  }
});
