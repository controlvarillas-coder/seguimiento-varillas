import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';

import { PRODUCT_MASTER } from './js/product-master.js';

const firebaseConfig = {
  apiKey: "AIzaSyBZoy3U28mBcGpG58kSPa-djyDbSeBZ4Hg",
  authDomain: "varillas-8421d.firebaseapp.com",
  projectId: "varillas-8421d",
  storageBucket: "varillas-8421d.firebasestorage.app",
  messagingSenderId: "1008238915036",
  appId: "1:1008238915036:web:f9ef6de0c6230579def319"
};

const EMAIL = 'federico.baez@gmail.com';
const PASSWORD = '123456';

async function main() {
  try {
    console.log('🔥 Iniciando Firebase...');
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    console.log('🔐 Logueando...');
    await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
    console.log('✅ Login OK');

    console.log('📦 Verificando colección productos...');
    const snap = await getDocs(collection(db, 'productos'));

    if (!snap.empty) {
      console.log('❌ La colección productos NO está vacía.');
      console.log('👉 Borralos desde Firebase primero.');
      return;
    }

    console.log(`🚀 Cargando ${PRODUCT_MASTER.length} productos...\n`);

    let count = 0;

    for (const item of PRODUCT_MASTER) {
      const payload = {
        nombre: String(item.name || '').trim(),
        codigo: String(item.code || '').trim(),
        categoria: String(item.category || '').trim(),
        visiblePara: ['alvear', 'moron', 'banado'],
        activo: item.active !== false,
        orden: Number(item.order || 0),
        creadoEn: serverTimestamp()
      };

      await addDoc(collection(db, 'productos'), payload);
      count++;
      console.log(`✅ ${count} - ${payload.nombre}`);
    }

    console.log(`\n🔥 LISTO. Se cargaron ${count} productos.`);
  } catch (error) {
    console.error('\n❌ ERROR:');
    console.error(error);
  }
}

main();
