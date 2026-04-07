import { db } from "./firebase-config.js";
import {
  collection,
  getDocs,
  addDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// 🔹 PRODUCTOS POR SECTOR
export async function obtenerProductosPorSector(sector) {
  const snapshot = await getDocs(collection(db, "productos"));

  let productos = [];

  snapshot.forEach(doc => {
    const data = doc.data();

    if (data[sector] === true && data.activo !== false) {
      productos.push({
        id: doc.id,
        ...data
      });
    }
  });

  productos.sort((a, b) => a.orden - b.orden);

  return productos;
}


// 🔹 RENDER
export async function renderFabrica(sector) {
  const cont = document.getElementById("contenido");

  const productos = await obtenerProductosPorSector(sector);

  let html = `
    <div class="fabrica-container">
      <div class="top-fabrica">
        <h2>${sector.replace("_", " ").toUpperCase()}</h2>
        <input type="date" id="fecha" />
      </div>

      <table class="tabla-fabrica">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cantidad</th>
          </tr>
        </thead>
        <tbody>
  `;

  let categoriaActual = "";

  productos.forEach(p => {
    if (p.categoria !== categoriaActual) {
      categoriaActual = p.categoria;

      html += `
        <tr class="categoria">
          <td colspan="2">${categoriaActual}</td>
        </tr>
      `;
    }

    html += `
      <tr>
        <td>${p.nombre}</td>
        <td>
          <input 
            type="number"
            class="input-cantidad"
            data-id="${p.id}"
            placeholder="0"
          />
        </td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>

      <button class="btn-guardar" onclick="guardarCarga('${sector}')">
        Guardar
      </button>
    </div>
  `;

  cont.innerHTML = html;
}


// 🔹 GUARDAR
export async function guardarCarga(sector) {
  const fecha = document.getElementById("fecha").value;

  if (!fecha) {
    alert("Seleccioná una fecha");
    return;
  }

  const q = query(
    collection(db, "cargas"),
    where("sector", "==", sector),
    where("fecha", "==", fecha)
  );

  const snap = await getDocs(q);

  if (!snap.empty) {
    alert("⚠ Ya existe carga para esa fecha");
    return;
  }

  const inputs = document.querySelectorAll(".input-cantidad");

  let datos = [];

  inputs.forEach(input => {
    const valor = Number(input.value) || 0;

    if (valor > 0) {
      datos.push({
        productoId: input.dataset.id,
        cantidad: valor
      });
    }
  });

  await addDoc(collection(db, "cargas"), {
    sector,
    fecha,
    datos,
    editable: false,
    timestamp: new Date()
  });

  alert("✅ Guardado");
}
