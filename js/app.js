import { db, auth } from "./firebase-config.js";

import {
  collection,
  getDocs,
  addDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


// ===============================
// LOGIN (SE MANTIENE)
// ===============================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    document.getElementById("screen-login").classList.add("active");
    document.getElementById("screen-app").classList.remove("active");
  } else {
    document.getElementById("screen-login").classList.remove("active");
    document.getElementById("screen-app").classList.add("active");
  }
});

document.getElementById("logoutBtn")?.addEventListener("click", () => {
  signOut(auth);
});


// ===============================
// PRODUCTOS
// ===============================

// 🔹 Guardar producto (COMPATIBLE con tu form)
document.getElementById("formProducto")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nombre = document.getElementById("prodNombre").value;
  const codigo = document.getElementById("prodCodigo").value;
  const categoria = document.getElementById("prodCategoria").value;

  const checks = document.querySelectorAll("input[name='visiblePara']:checked");

  let visiblePara = [];
  let flags = {
    caja_chica: false,
    caja_grande: false,
    neutro: false,
    banado: false
  };

  checks.forEach(c => {
    visiblePara.push(c.value);
    flags[c.value] = true;
  });

  await addDoc(collection(db, "productos"), {
    nombre,
    codigo,
    categoria,
    subcategoria: "",
    orden: Date.now(), // temporal hasta cargar orden real
    activo: true,
    visiblePara,
    ...flags
  });

  alert("Producto guardado");
  e.target.reset();
});


// 🔹 Obtener productos por sector
async function obtenerProductos(sector) {
  const snap = await getDocs(collection(db, "productos"));

  let productos = [];

  snap.forEach(doc => {
    const d = doc.data();

    // compatibilidad con sistema viejo
    const visible =
      d[sector] === true ||
      (Array.isArray(d.visiblePara) && d.visiblePara.includes(sector));

    if (visible && d.activo !== false) {
      productos.push({ id: doc.id, ...d });
    }
  });

  productos.sort((a, b) => (a.orden || 0) - (b.orden || 0));

  return productos;
}


// ===============================
// CARGA DIARIA
// ===============================

// 🔹 Render tabla dinámica
async function renderFabrica() {
  const sector = document.getElementById("cargaFabrica").value;
  const tabla = document.getElementById("tablaCargaDiaria");

  const productos = await obtenerProductos(sector);

  let html = `
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
        <tr style="background:#1e293b;font-weight:bold;">
          <td colspan="2">${categoriaActual}</td>
        </tr>
      `;
    }

    html += `
      <tr>
        <td>${p.nombre}</td>
        <td>
          <input type="number" class="excel-input input-cantidad" data-id="${p.id}" />
        </td>
      </tr>
    `;
  });

  html += `</tbody>`;

  tabla.innerHTML = html;
}


// 🔹 Evento cambio de fábrica
document.getElementById("cargaFabrica")?.addEventListener("change", renderFabrica);


// 🔹 Cargar inicial
setTimeout(() => {
  if (document.getElementById("cargaFabrica")) {
    renderFabrica();
  }
}, 500);


// 🔹 Guardar carga
document.getElementById("btnGuardarReporte")?.addEventListener("click", async () => {
  const fecha = document.getElementById("cargaFecha").value;
  const sector = document.getElementById("cargaFabrica").value;

  if (!fecha) return alert("Seleccioná fecha");

  const q = query(
    collection(db, "cargas"),
    where("sector", "==", sector),
    where("fecha", "==", fecha)
  );

  const snap = await getDocs(q);

  if (!snap.empty) {
    return alert("Ya existe carga para esa fecha");
  }

  const inputs = document.querySelectorAll(".input-cantidad");

  let datos = [];

  inputs.forEach(i => {
    const val = Number(i.value) || 0;

    if (val > 0) {
      datos.push({
        productoId: i.dataset.id,
        cantidad: val
      });
    }
  });

  await addDoc(collection(db, "cargas"), {
    fecha,
    sector,
    datos,
    editable: false,
    ts: new Date()
  });

  alert("Guardado correctamente");
});
