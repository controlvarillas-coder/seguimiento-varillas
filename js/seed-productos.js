import { db } from './firebase-config.js';
import {
  collection,
  addDoc,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { PRODUCT_MASTER } from './productos_master.js';

async function seedProductos() {
  try {
    const existentes = await getDocs(collection(db, 'productos'));
    if (!existentes.empty) {
      alert('La colección productos no está vacía. Vaciala antes de correr la carga masiva.');
      return;
    }

    let ok = 0;

    for (const item of PRODUCT_MASTER) {
      const payload = {
        nombre: item.name?.trim() || '',
        codigo: item.code?.trim() || '',
        categoria: item.category?.trim() || '',
        visiblePara: ['alvear', 'moron', 'banado'],
        activo: item.active !== false,
        orden: Number(item.order || 0)
      };

      await addDoc(collection(db, 'productos'), payload);
      ok++;
      console.log(`✅ ${ok} - ${payload.nombre}`);
    }

    alert(`Carga completada. Se crearon ${ok} productos.`);
    console.log('🔥 Carga finalizada');
  } catch (error) {
    console.error('❌ Error cargando productos:', error);
    alert(`Error cargando productos: ${error.message || error}`);
  }
}

window.seedProductos = seedProductos;
console.log('✅ Script listo. Ejecutá: seedProductos()');
