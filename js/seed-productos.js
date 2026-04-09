import { db } from './firebase-config.js';
import { PRODUCT_MASTER } from './product-master.js';
import {
  collection,
  getDocs,
  addDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

async function seedProductos() {
  try {
    const snap = await getDocs(collection(db, 'productos'));

    if (!snap.empty) {
      alert('La colección productos no está vacía. Vaciala antes de correr la carga masiva.');
      return;
    }

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

    alert(`Carga completada. Se crearon ${count} productos.`);
  } catch (error) {
    console.error('❌ Error cargando productos:', error);
    alert(`Error cargando productos: ${error.code || error.message || error}`);
  }
}

window.seedProductos = seedProductos;
console.log('✅ Seed listo. Ejecutá seedProductos() en la consola.');
