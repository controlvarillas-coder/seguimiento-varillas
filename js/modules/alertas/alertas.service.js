const BOX_KEYS = ['cajaChica', 'cajaGrande', 'neutro', 'banado'];

function num(v) {
  return Number(v || 0);
}

function findRowByProduct(report, productoId) {
  if (!report || !Array.isArray(report.rows)) return null;
  return report.rows.find((r) => r.productoId === productoId) || null;
}

function getCellValue(cell) {
  if (cell == null) return 0;
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'object') {
    if ('valor' in cell) return num(cell.valor);
    if ('value' in cell) return num(cell.value);
  }
  return num(cell);
}

function getBoxObject(row, boxKey) {
  if (!row) return null;

  if (row[boxKey]) return row[boxKey];

  const legacyMap = {
    cajaChica: ['caja_chica', 'cajaChica'],
    cajaGrande: ['caja_grande', 'cajaGrande'],
    neutro: ['neutro'],
    banado: ['banado', 'bañado']
  };

  const aliases = legacyMap[boxKey] || [boxKey];

  for (const key of aliases) {
    if (row[key]) return row[key];
  }

  return null;
}

function getIngresos(row, boxKey) {
  const box = getBoxObject(row, boxKey);
  if (!box) return 0;
  return getCellValue(box.ingresos);
}

function getSalidas(row, boxKey) {
  const box = getBoxObject(row, boxKey);
  if (!box) return 0;
  return getCellValue(box.salidas);
}

function getDiferencias(row, boxKey) {
  const box = getBoxObject(row, boxKey);
  if (!box) return 0;
  return getCellValue(box.diferencias);
}

function getTotal(row, boxKey) {
  const box = getBoxObject(row, boxKey);
  if (!box) return 0;

  if (box.total != null) return getCellValue(box.total);

  return getIngresos(row, boxKey) - getSalidas(row, boxKey) + getDiferencias(row, boxKey);
}

function getAllDates(reportes) {
  return [...new Set((reportes || []).map((r) => r.fecha).filter(Boolean))].sort();
}

function getReport(reportes, fecha, fabrica) {
  return (reportes || []).find((r) => r.fecha === fecha && r.fabrica === fabrica) || null;
}

function getAllProductIdsForDate(alvearReport, moronReport, productos = []) {
  const ids = new Set();

  (alvearReport?.rows || []).forEach((r) => r.productoId && ids.add(r.productoId));
  (moronReport?.rows || []).forEach((r) => r.productoId && ids.add(r.productoId));
  (productos || []).forEach((p) => p.id && ids.add(p.id));

  return [...ids];
}

function getProductName(productos, productoId, fallbackRowA = null, fallbackRowM = null) {
  const p = (productos || []).find((x) => x.id === productoId);
  return (
    p?.nombre ||
    fallbackRowA?.productoNombre ||
    fallbackRowM?.productoNombre ||
    'Producto'
  );
}

function createAlert({
  fecha,
  productoId,
  productoNombre,
  boxKey,
  salidaAlvear,
  ingresoMoron
}) {
  return {
    id: `${fecha}_${productoId}_${boxKey}`,
    fecha,
    productoId,
    productoNombre,
    boxKey,
    salidaAlvear,
    ingresoMoron,
    diferencia: salidaAlvear - ingresoMoron,
    tipo: 'alvear_vs_moron',
    severity: 'high'
  };
}

export function computeAlvearMoronAlerts(reportes = [], productos = []) {
  const fechas = getAllDates(reportes);
  const alerts = [];

  fechas.forEach((fecha) => {
    const alvearReport = getReport(reportes, fecha, 'alvear');
    const moronReport = getReport(reportes, fecha, 'moron');

    if (!alvearReport && !moronReport) return;

    const productIds = getAllProductIdsForDate(alvearReport, moronReport, productos);

    productIds.forEach((productoId) => {
      const rowA = findRowByProduct(alvearReport, productoId);
      const rowM = findRowByProduct(moronReport, productoId);
      const productoNombre = getProductName(productos, productoId, rowA, rowM);

      BOX_KEYS.forEach((boxKey) => {
        const salidaAlvear = getSalidas(rowA, boxKey);
        const ingresoMoron = getIngresos(rowM, boxKey);

        if (salidaAlvear === 0 && ingresoMoron === 0) return;

        if (salidaAlvear !== ingresoMoron) {
          alerts.push(
            createAlert({
              fecha,
              productoId,
              productoNombre,
              boxKey,
              salidaAlvear,
              ingresoMoron
            })
          );
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
  const map = {
    cajaChica: 'Caja chica',
    cajaGrande: 'Caja grande',
    neutro: 'Neutro',
    banado: 'Bañado'
  };

  return map[boxKey] || boxKey;
}

export function getAlertCount(alerts = []) {
  return alerts.length;
}

export function summarizeAlerts(alerts = []) {
  const total = alerts.length;
  const pendientes = alerts.filter((a) => a.diferencia !== 0).length;

  return {
    total,
    pendientes
  };
}
