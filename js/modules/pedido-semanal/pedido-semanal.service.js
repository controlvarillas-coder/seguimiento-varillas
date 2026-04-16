function startOfWeekMonday(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeekSunday(date) {
  const d = new Date(startOfWeekMonday(date));
  d.setDate(d.getDate() + 6);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateShort(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}

export function buildWeeksForMonth(monthValue) {
  if (!monthValue) return [];

  const [year, month] = monthValue.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  const firstWeekStart = startOfWeekMonday(monthStart);
  const weeks = [];

  let cursor = new Date(firstWeekStart);
  let index = 1;

  while (cursor <= monthEnd) {
    const weekStart = new Date(cursor);
    const weekEnd = endOfWeekSunday(weekStart);

    if (weekEnd >= monthStart && weekStart <= monthEnd) {
      weeks.push({
        key: `semana_${index}`,
        index,
        start: formatDateISO(weekStart),
        end: formatDateISO(weekEnd),
        label: `Semana ${index} (${formatDateShort(weekStart)} al ${formatDateShort(weekEnd)})`
      });
      index++;
    }

    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks;
}

export function getWeekDocId(monthValue, weekKey) {
  return `${monthValue}_${weekKey}`;
}

export function createEmptyWeeklyRow(producto) {
  return {
    productoId: producto.id,
    productoNombre: producto.nombre,
    categoria: producto.categoria || '',
    cantidadSolicitada: 0,
    fechaEntrega: '',
    cantidadEntregada: 0,
    motivoIncumplimiento: '',
    motivoOtro: '',
    historial: []
  };
}

export function buildDefaultWeeklyRows(productos = []) {
  return (productos || []).map(createEmptyWeeklyRow);
}

export function normalizeWeeklyRows(rows = [], productos = []) {
  const byId = new Map();

  (rows || []).forEach((row) => {
    byId.set(row.productoId, {
      productoId: row.productoId || '',
      productoNombre: row.productoNombre || '',
      categoria: row.categoria || '',
      cantidadSolicitada: Number(row.cantidadSolicitada || 0),
      fechaEntrega: String(row.fechaEntrega || ''),
      cantidadEntregada: Number(row.cantidadEntregada || 0),
      motivoIncumplimiento: String(row.motivoIncumplimiento || ''),
      motivoOtro: String(row.motivoOtro || ''),
      historial: Array.isArray(row.historial) ? row.historial : []
    });
  });

  return (productos || []).map((producto) => {
    const existing = byId.get(producto.id);
    if (existing) {
      existing.productoNombre = producto.nombre;
      existing.categoria = producto.categoria || '';
      return existing;
    }
    return createEmptyWeeklyRow(producto);
  });
}

export function pushWeeklyHistory(row, fieldKey, previousValue, newValue, usuario) {
  const prev = previousValue ?? '';
  const next = newValue ?? '';

  if (String(prev) === String(next)) return row;

  if (!Array.isArray(row.historial)) row.historial = [];

  row.historial.push({
    fieldKey,
    previousValue: prev,
    newValue: next,
    usuario: usuario || 'Usuario',
    fecha: new Date().toISOString()
  });

  return row;
}

export function getHistoryTitle(row) {
  if (!row || !Array.isArray(row.historial) || !row.historial.length) return 'Sin historial';

  return row.historial
    .slice(-5)
    .reverse()
    .map((item) => {
      const fecha = String(item.fecha || '').replace('T', ' ').slice(0, 16);
      return `${fecha} · ${item.usuario}: ${item.fieldKey} → ${item.newValue}`;
    })
    .join('\n');
}
