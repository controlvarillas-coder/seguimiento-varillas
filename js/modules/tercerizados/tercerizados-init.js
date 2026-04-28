/**
 * ============================================================
 *  INICIALIZADOR: tercerizados-init.js
 *  Archivo: js/modules/tercerizados/tercerizados-init.js
 *
 *  PROPÓSITO:
 *    Conectar el módulo de Tercerizados al sistema existente
 *    SIN modificar app.js.
 *
 *  CÓMO FUNCIONA:
 *    1. Espera a que Firebase Auth esté listo (onAuthStateChanged)
 *    2. Lee el perfil del usuario desde Firestore (colección 'usuarios')
 *    3. Si el rol tiene acceso (moron / control_calidad / gerencia):
 *       - Muestra el ítem de menú
 *       - Intercepta el click en el nav-link
 *       - Inicializa el módulo cuando se activa la sección
 *    4. Si el usuario cierra sesión → destruye el módulo
 * ============================================================
 */

import { auth, db } from '../../firebase-config.js';
import {
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection,
  query,
  where,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initTercerizados, destroyTercerizados } from './tercerizados.js';

// ─── Roles con acceso al módulo ───────────────────────────────────────────────
const ROLES_PERMITIDOS = ['moron', 'control_calidad', 'gerencia'];

// ─── Estado local ─────────────────────────────────────────────────────────────
let moduloActivo = false;
let perfilActual = null;

// ─── Helper: leer perfil desde Firestore ─────────────────────────────────────
async function fetchPerfil(email) {
  try {
    const q = query(collection(db, 'usuarios'), where('email', '==', email));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    console.error('[TercInit] Error leyendo perfil:', e);
    return null;
  }
}

// ─── Helper: mostrar / ocultar nav-link ───────────────────────────────────────
function setNavVisible(visible) {
  const navLinks = document.querySelectorAll('.terc-nav-link');
  navLinks.forEach((el) => {
    el.style.display = visible ? '' : 'none';
  });
}

// ─── Intercepción de navegación ───────────────────────────────────────────────
//
// app.js ya registró listeners en TODOS los .nav-link usando querySelectorAll,
// así que el nav-link de tercerizados ya activa setSection() del sistema.
// Nosotros solo necesitamos REACCIONAR cuando esa sección se vuelve activa.
//
// Usamos un MutationObserver sobre #section-tercerizados para saber cuándo
// app.js le agrega la clase "active".
//
function observarSeccion() {
  const seccion = document.getElementById('section-tercerizados');
  if (!seccion) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const activa = seccion.classList.contains('active');
        if (activa && !moduloActivo && perfilActual) {
          moduloActivo = true;
          initTercerizados(perfilActual);
        } else if (!activa && moduloActivo) {
          moduloActivo = false;
          destroyTercerizados();
        }
      }
    });
  });

  observer.observe(seccion, { attributes: true });
}

// ─── Bootstrap principal ──────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Usuario deslogueado
    perfilActual = null;
    moduloActivo = false;
    setNavVisible(false);
    destroyTercerizados();
    return;
  }

  // Leer perfil
  const perfil = await fetchPerfil(user.email);

  if (!perfil || perfil.activo === false) {
    setNavVisible(false);
    return;
  }

  const rolPermitido = ROLES_PERMITIDOS.includes(perfil.rol);

  if (!rolPermitido) {
    setNavVisible(false);
    return;
  }

  // Guardar perfil y mostrar nav
  perfilActual = perfil;
  setNavVisible(true);

  // Observar la sección para inicializar cuando se active
  observarSeccion();

  // Si la sección ya está activa (poco probable en login normal, pero por si acaso)
  const seccion = document.getElementById('section-tercerizados');
  if (seccion?.classList.contains('active') && !moduloActivo) {
    moduloActivo = true;
    initTercerizados(perfilActual);
  }
});
