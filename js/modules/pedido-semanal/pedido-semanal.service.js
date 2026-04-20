/* =====================================================================
   pedido-semanal.service.js
   ===================================================================== */

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
        label: `Sem ${index} · ${formatDateShort(weekStart)}-${formatDateShort(weekEnd)}`
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

/* -----------------------------------------------------------------
   Schema unificado de una fila de pedido semanal.
   Campos nuevos conviven con compatibilidad hacia schema viejo.
----------------------------------------------------------------- */
export function createEmptyWeeklyRow(producto) {
  return {
    productoId: producto.id,
    productoNombre: producto.nombre,
    categoria: producto.categoria || '',
    moronCantidad: 0,
    moronObservacion: '',
    alvearFechaEntrega: '',
    alvearCantidadEntregada: 0,
    alvearMotivos: [],
    alvearObservacion: '',
    gerenciaObservacion: '',
    alvearConfirmado: false,
    historial: []
  };
}

export function buildDefaultWeeklyRows(productos = []) {
  return (productos || []).map(createEmptyWeeklyRow);
}

/* -----------------------------------------------------------------
   Normaliza rows desde Firestore.
   Acepta schema viejo (moronPedidoChica, entregadoChica, alvearDiaProduccion…)
   y schema nuevo (moronCantidad, alvearCantidadEntregada, alvearFechaEntrega…).
----------------------------------------------------------------- */
export function normalizeWeeklyRows(rows = [], productos = []) {
  const byId = new Map();

  (rows || []).forEach((row) => {
    const moronCantidad = Number(
      row.moronCantidad ??
      row.moronPedidoChica ??
      row.cantidadSolicitada ?? 0
    );

    const alvearCantidadEntregada = Number(
      row.alvearCantidadEntregada ??
      row.cantidadEntregada ?? 0
    );

    const alvearFechaEntrega = String(
      row.alvearFechaEntrega ||
      row.alvearDiaProduccion ||
      row.fechaEntrega || ''
    );

    byId.set(row.productoId, {
      productoId: row.productoId || '',
      productoNombre: row.productoNombre || '',
      categoria: row.categoria || '',
      moronCantidad,
      moronObservacion: String(row.moronObservacion || ''),
      alvearFechaEntrega,
      alvearCantidadEntregada,
      alvearMotivos: Array.isArray(row.alvearMotivos) ? row.alvearMotivos : [],
      alvearObservacion: String(row.alvearObservacion || ''),
      gerenciaObservacion: String(row.gerenciaObservacion || ''),
      alvearConfirmado: !!row.alvearConfirmado,
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

/* -----------------------------------------------------------------
   Historial de cambios
----------------------------------------------------------------- */
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
    .slice(-5).reverse()
    .map((item) => {
      const fecha = String(item.fecha || '').replace('T', ' ').slice(0, 16);
      return `${fecha} · ${item.usuario}: ${item.fieldKey} → ${item.newValue}`;
    })
    .join('\n');
}

/* -----------------------------------------------------------------
   Evaluación de completitud de la semana para el calendario.
   Devuelve: 'completo' | 'parcial' | 'incompleto' | 'pendiente' | 'sin_pedido'
----------------------------------------------------------------- */
export function evaluateWeekCompletion(rows = [], alvearConfirmado = false) {
  const pedidas = (rows || []).filter((r) => Number(r.moronCantidad) > 0);

  if (!pedidas.length) return 'sin_pedido';
  if (!alvearConfirmado) return 'pendiente';

  const todasCompletas = pedidas.every(
    (r) => Number(r.alvearCantidadEntregada) >= Number(r.moronCantidad)
  );
  const algunaCompleta = pedidas.some(
    (r) => Number(r.alvearCantidadEntregada) >= Number(r.moronCantidad)
  );

  if (todasCompletas) return 'completo';
  if (algunaCompleta) return 'parcial';
  return 'incompleto';
}

/* -----------------------------------------------------------------
   Productividad Alvear — para dashboard gerencia
----------------------------------------------------------------- */
export function computeProductividadAlvear(pedidosCache = {}) {
  const docs = Object.values(pedidosCache);

  let totalPedido = 0;
  let totalEntregado = 0;
  let semanasCerradas = 0;
  let semanasCompletas = 0;
  const motivosTotales = {};
  const porSemana = [];

  docs.forEach((doc) => {
    const rows = doc.rows || [];
    const completion = evaluateWeekCompletion(rows, !!doc.alvearConfirmado);

    if (completion === 'sin_pedido' || completion === 'pendiente') return;

    semanasCerradas++;
    if (completion === 'completo') semanasCompletas++;

    let pedSemana = 0;
    let entSemana = 0;

    rows.forEach((row) => {
      const ped = Number(row.moronCantidad || 0);
      const ent = Number(row.alvearCantidadEntregada || 0);
      if (ped === 0) return;

      pedSemana += ped;
      entSemana += ent;

      if (ent < ped && Array.isArray(row.alvearMotivos)) {
        row.alvearMotivos.forEach((motivo) => {
          if (!motivo) return;
          motivosTotales[motivo] = (motivosTotales[motivo] || 0) + 1;
        });
      }
    });

    totalPedido += pedSemana;
    totalEntregado += entSemana;

    porSemana.push({
      id: doc.id,
      weekLabel: doc.weekLabel || doc.weekKey || doc.id,
      pedido: pedSemana,
      entregado: entSemana,
      porcentaje: pedSemana > 0 ? Math.round((entSemana / pedSemana) * 100) : 0,
      completion
    });
  });

  const porcentajeGlobal = totalPedido > 0
    ? Math.round((totalEntregado / totalPedido) * 100)
    : 0;

  return {
    totalPedido,
    totalEntregado,
    porcentajeGlobal,
    semanasCerradas,
    semanasCompletas,
    motivosTotales,
    porSemana: porSemana.sort((a, b) => a.id.localeCompare(b.id))
  };
}

export const MOTIVOS_PREDEFINIDOS = [
  'Falta de palitero',
  'Falta de esencia',
  'Falta de materia prima',
  'Problema de máquina',
  'Ausentismo de personal',
  'Problema de calidad',
  'Falta de packaging',
  'Otro'
];
