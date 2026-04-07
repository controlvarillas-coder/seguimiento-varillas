import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const $ = (id) => document.getElementById(id);

function toast(message) {
  const el = $('toast');
  if (!el) {
    alert(message);
    return;
  }
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function setLoggedUI(logged, email = '') {
  const loginScreen = $('screen-login');
  const appScreen = $('screen-app');

  if (loginScreen) loginScreen.classList.toggle('active', !logged);
  if (appScreen) appScreen.classList.toggle('active', logged);

  const miniName = $('miniName');
  const miniRole = $('miniRole');
  const avatarMini = $('avatarMini');

  if (miniName) miniName.textContent = email || 'Usuario';
  if (miniRole) miniRole.textContent = logged ? 'logueado' : 'sin sesión';
  if (avatarMini) avatarMini.textContent = (email || 'U').charAt(0).toUpperCase();
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = $('loginForm');
  const logoutBtn = $('logoutBtn');

  if (loginForm) {
    loginForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();

      const email = $('email')?.value?.trim();
      const password = $('password')?.value;

      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        console.log('LOGIN OK', cred.user.email);
        toast('Sesión iniciada correctamente');
      } catch (error) {
        console.error('ERROR LOGIN', error);
        toast(`Error login: ${error.code || error.message}`);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await signOut(auth);
      toast('Sesión cerrada');
    });
  }

  onAuthStateChanged(auth, (user) => {
    console.log('AUTH STATE', user?.email || null);
    if (user) {
      setLoggedUI(true, user.email);
    } else {
      setLoggedUI(false);
    }
  });
});
