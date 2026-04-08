/**
 * alertas.service.js
 *
 * Lee la estructura REAL de Firestore:
 *   reporte.fabrica  → 'caja_chica' | 'caja_grande' | 'neutro' | 'banado'
 *   reporte.rows[]   → cada row tiene groups{}
 *
 *   groups.cajaChica      → { lin, alv }
 *   groups.cajaGrandeAlv  → { alvPlus, alvMinus, dif }
 *   groups.cajaChicaMor   → { morPlus, morMinus, dif }
 *   groups.cajaGrandeMor  → { morPlus, morMinus, dif }
 *   groups.neutro         → { banaPlus, masMenos }
 *   groups.banado         → { secando, totalSecando, cosech, salida, dif, banadoPlus }
 *
 * Regla etapa 1 — Alvear ↔ Morón:
 *   CAJA CHICA  → sale Alvear: cajaChica.alv          | entra Morón: cajaChicaMor.morPlus
 *   CAJA GRANDE → sale Alvear: cajaGrandeAlv.alvMinus  | entra Morón: cajaGrandeMor.morPlus
 *   NEUTRO / BAÑADO → etapa 2
 *
 * Nota: NO existen reportes separados con fabrica='alvear' o fabrica='moron'.
 * Alvear y Morón son columnas dentro del mismo reporte, en el mismo groups{}.
 */
 
function num(v) {
  return Number(v || 0);
}
 
function findRowByProduct(reporte, productoId) {
  if (!reporte || !Array.isArray(reporte.rows)) return null;
  return reporte.rows.find((r) => r.productoId === productoId) || null;
}
 
function getProductName(productos, productoId, fallbackRow = null) {
  const p = (productos || []).find((x) => x.id === productoId);
  return p?.nombre || fallbackRow?.productoNombre || productoId || 'Producto';
}
 
function getAllDates(reportes) {
  return [...new Set((reportes || []).map((r) => r.fecha).filter(Boolean))].sort().reverse();
}
 
function getAllProductIdsForDate(reportesDelDia, productos = []) {
  const ids = new Set();
  reportesDelDia.forEach((rep) => {
    (rep.rows || []).forEach((r) => r.productoId && ids.add(r.productoId));
  });
  productos.forEach((p) => p.id && ids.add(p.id));
  return [...ids];
}
 
/**
 * Extrae la salida de Alvear de una row según el bloque lógico.
 * Alvear y Morón están en la misma row dentro de groups distintos.
 */
function getAlvearSalida(row, boxKey) {
  if (!row?.groups) return 0;
  switch (boxKey) {
    case 'cajaChica':
      // cajaChica.alv = columna Alvear dentro del bloque caja chica
      return num(row.groups.cajaChica?.alv);
    case 'cajaGrande':
      // cajaGrandeAlv.alvMinus = salida de Alvear en caja grande
      return num(row.groups.cajaGrandeAlv?.alvMinus);
    case 'neutro':
    case 'banado':
    default:
      return 0; // etapa 2
  }
}
 
/**
 * Extrae el ingreso a Morón de una row según el bloque lógico.
 */
function getMoronIngreso(row, boxKey) {
  if (!row?.groups) return 0;
  switch (boxKey) {
    case 'cajaChica':
      // cajaChicaMor.morPlus = ingreso Morón en caja chica
      return num(row.groups.cajaChicaMor?.morPlus);
    case 'cajaGrande':
      // cajaGrandeMor.morPlus = ingreso Morón en caja grande
      return num(row.groups.cajaGrandeMor?.morPlus);
    case 'neutro':
    case 'banado':
    default:
      return 0; // etapa 2
  }
}
 
function createAlert({ fecha, productoId, productoNombre, boxKey, salidaAlvear, ingresoMoron }) {
  return {
    id: `${fecha}_${productoId}_${boxKey}`,
    fecha,
    productoId,
    productoNombre,
    boxKey,
    bloque: getBoxLabel(boxKey),
    salidaAlvear,
    ingresoMoron,
    diferencia: salidaAlvear - ingresoMoron,
    tipo: 'alvear_vs_moron',
    severity: 'high'
  };
}
 
// Bloques activos en etapa 1 — Alvear ↔ Morón
const BOX_KEYS_ETAPA1 = ['cajaChica', 'cajaGrande'];
 
/**
 * Analiza todos los reportes y devuelve alertas donde
 * la salida de Alvear no coincide con el ingreso a Morón.
 *
 * @param {Array} reportes - state.reportes
 * @param {Array} productos - state.productos
 * @returns {Array} alertas
 */
export function computeAlvearMoronAlerts(reportes = [], productos = []) {
  const fechas = getAllDates(reportes);
  const alerts = [];
 
  fechas.forEach((fecha) => {
    const reportesDelDia = reportes.filter((r) => r.fecha === fecha);
    if (!reportesDelDia.length) return;
 
    const productoIds = getAllProductIdsForDate(reportesDelDia, productos);
 
    productoIds.forEach((productoId) => {
      // Buscamos la row en cualquier reporte del día
      let row = null;
      for (const rep of reportesDelDia) {
        const found = findRowByProduct(rep, productoId);
        if (found) { row = found; break; }
      }
      if (!row) return;
 
      const productoNombre = getProductName(productos, productoId, row);
 
      BOX_KEYS_ETAPA1.forEach((boxKey) => {
        const salidaAlvear = getAlvearSalida(row, boxKey);
        const ingresoMoron = getMoronIngreso(row, boxKey);
 
        // Ignorar filas completamente vacías
        if (salidaAlvear === 0 && ingresoMoron === 0) return;
 
        if (salidaAlvear !== ingresoMoron) {
          alerts.push(createAlert({ fecha, productoId, productoNombre, boxKey, salidaAlvear, ingresoMoron }));
        }
      });
    });
  });
 
  return alerts.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return a.productoNombre.localeCompare(b.productoNombre, 'es');
  });
}
 
export function getBoxLabel(boxKey) {
  const map = { cajaChica: 'Caja Chica', cajaGrande: 'Caja Grande', neutro: 'Neutro', banado: 'Bañado' };
  return map[boxKey] || boxKey;
}
 
export function getAlertCount(alerts = []) {
  return alerts.length;
}
 
export function summarizeAlerts(alerts = []) {
  return {
    total: alerts.length,
    pendientes: alerts.filter((a) => a.diferencia !== 0).length
  };
}
 
