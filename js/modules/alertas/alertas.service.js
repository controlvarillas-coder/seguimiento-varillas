/**
 * alertas.service.js
 *
 * Reglas:
 * 1) Producción Alvear:
 *    alvear.alv del día D debe ingresar en cajaChica.alvPlus o cajaGrandeAlv.alvPlus
 *    entre el día D y el día D+1.
 *
 * 2) Transferencia Alvear -> Morón:
 *    cajaChica.alvMinus debe coincidir con cajaChicaMor.morPlus
 *    cajaGrandeAlv.alvMinus debe coincidir con cajaGrandeMor.morPlus
 *    en la misma fecha.
 */

function num(v) {
  return Number(v || 0);
}

function hasAnyNonZeroValue(obj = {}) {
  return Object.values(obj || {}).some((value) => num(value) !== 0);
}

function getProductName(productos, productoId, fallbackRow = null) {
  const p = (productos || []).find((x) => x.id === productoId);
  return p?.nombre || fallbackRow?.productoNombre || productoId || 'Producto';
}

function getAllDates(reportes) {
  return [...new Set((reportes || []).map((r) => r.fecha).filter(Boolean))].sort();
}

function getAllProductIdsForDate(reportesDelDia, productos = []) {
  const ids = new Set();

  reportesDelDia.forEach((rep) => {
    (rep.rows || []).forEach((row) => {
      if (row.productoId) ids.add(row.productoId);
    });
  });

  productos.forEach((p) => {
    if (p.id) ids.add(p.id);
  });

  return [...ids];
}

function getRowsForProduct(reportesDelDia = [], productoId) {
  const rows = [];

  reportesDelDia.forEach((reporte) => {
    const row = reporte?.rows?.find((item) => item.productoId === productoId);
    if (row) rows.push(row);
  });

  return rows;
}

function getGroupDataForProduct(reportesDelDia = [], productoId, groupKey) {
  const rows = getRowsForProduct(reportesDelDia, productoId);
  let fallback = null;

  for (const row of rows) {
    const groupData = row?.groups?.[groupKey];
    if (!groupData) continue;

    if (!fallback) fallback = groupData;
    if (hasAnyNonZeroValue(groupData)) return groupData;
  }

  return fallback || {};
}

function getFallbackRow(reportesDelDia = [], productoId) {
  for (const reporte of reportesDelDia) {
    const row = reporte?.rows?.find((item) => item.productoId === productoId);
    if (row) return row;
  }
  return null;
}

function shiftDate(dateStr, daysToAdd) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

function getBoxLabel(boxKey) {
  const map = {
    alvearProduccion: 'Producción Alvear',
    cajaChica: 'Caja Chica',
    cajaGrande: 'Caja Grande'
  };

  return map[boxKey] || boxKey;
}

function createAlert({
  id,
  fecha,
  productoId,
  productoNombre,
  boxKey,
  origen,
  destino,
  origenLabel,
  destinoLabel,
  tipo
}) {
  return {
    id,
    fecha,
    productoId,
    productoNombre,
    boxKey,
    bloque: getBoxLabel(boxKey),
    origen,
    destino,
    origenLabel,
    destinoLabel,
    diferencia: origen - destino,
    tipo,
    severity: 'high'
  };
}

function computeProduccionAlerts(reportes = [], productos = []) {
  const fechas = getAllDates(reportes);
  const alerts = [];

  fechas.forEach((fecha) => {
    const reportesDelDia = reportes.filter((r) => r.fecha === fecha);
    if (!reportesDelDia.length) return;

    const fechaSiguiente = shiftDate(fecha, 1);
    const reportesDiaSiguiente = reportes.filter((r) => r.fecha === fechaSiguiente);

    const productoIds = getAllProductIdsForDate(reportesDelDia, productos);

    productoIds.forEach((productoId) => {
      const fallbackRow = getFallbackRow(reportesDelDia, productoId);
      const productoNombre = getProductName(productos, productoId, fallbackRow);

      const producido = num(getGroupDataForProduct(reportesDelDia, productoId, 'alvear')?.alv);

      if (producido === 0) return;

      const ingresoMismoDia =
        num(getGroupDataForProduct(reportesDelDia, productoId, 'cajaChica')?.alvPlus) +
        num(getGroupDataForProduct(reportesDelDia, productoId, 'cajaGrandeAlv')?.alvPlus);

      const ingresoDiaSiguiente =
        num(getGroupDataForProduct(reportesDiaSiguiente, productoId, 'cajaChica')?.alvPlus) +
        num(getGroupDataForProduct(reportesDiaSiguiente, productoId, 'cajaGrandeAlv')?.alvPlus);

      const ingresoPermitido = ingresoMismoDia + ingresoDiaSiguiente;

      if (producido !== ingresoPermitido) {
        alerts.push(createAlert({
          id: `prod_${fecha}_${productoId}`,
          fecha,
          productoId,
          productoNombre,
          boxKey: 'alvearProduccion',
          origen: producido,
          destino: ingresoPermitido,
          origenLabel: 'Fabricado en ALV',
          destinoLabel: 'Ingresado en ALVE+ (día actual + siguiente)',
          tipo: 'produccion_alvear'
        }));
      }
    });
  });

  return alerts;
}

function computeTransferAlerts(reportes = [], productos = []) {
  const fechas = getAllDates(reportes);
  const alerts = [];

  fechas.forEach((fecha) => {
    const reportesDelDia = reportes.filter((r) => r.fecha === fecha);
    if (!reportesDelDia.length) return;

    const productoIds = getAllProductIdsForDate(reportesDelDia, productos);

    productoIds.forEach((productoId) => {
      const fallbackRow = getFallbackRow(reportesDelDia, productoId);
      const productoNombre = getProductName(productos, productoId, fallbackRow);

      const salidaChica = num(getGroupDataForProduct(reportesDelDia, productoId, 'cajaChica')?.alvMinus);
      const ingresoMoronChica = num(getGroupDataForProduct(reportesDelDia, productoId, 'cajaChicaMor')?.morPlus);

      if (!(salidaChica === 0 && ingresoMoronChica === 0) && salidaChica !== ingresoMoronChica) {
        alerts.push(createAlert({
          id: `transf_chica_${fecha}_${productoId}`,
          fecha,
          productoId,
          productoNombre,
          boxKey: 'cajaChica',
          origen: salidaChica,
          destino: ingresoMoronChica,
          origenLabel: 'Sale de Alvear',
          destinoLabel: 'Entra a Morón',
          tipo: 'alvear_vs_moron'
        }));
      }

      const salidaGrande = num(getGroupDataForProduct(reportesDelDia, productoId, 'cajaGrandeAlv')?.alvMinus);
      const ingresoMoronGrande = num(getGroupDataForProduct(reportesDelDia, productoId, 'cajaGrandeMor')?.morPlus);

      if (!(salidaGrande === 0 && ingresoMoronGrande === 0) && salidaGrande !== ingresoMoronGrande) {
        alerts.push(createAlert({
          id: `transf_grande_${fecha}_${productoId}`,
          fecha,
          productoId,
          productoNombre,
          boxKey: 'cajaGrande',
          origen: salidaGrande,
          destino: ingresoMoronGrande,
          origenLabel: 'Sale de Alvear',
          destinoLabel: 'Entra a Morón',
          tipo: 'alvear_vs_moron'
        }));
      }
    });
  });

  return alerts;
}

export function computeAlvearMoronAlerts(reportes = [], productos = []) {
  const produccion = computeProduccionAlerts(reportes, productos);
  const transferencias = computeTransferAlerts(reportes, productos);

  return [...produccion, ...transferencias].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return String(a.productoNombre || '').localeCompare(String(b.productoNombre || ''), 'es');
  });
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
