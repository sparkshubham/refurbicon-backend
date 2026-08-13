export function ok(res, data, meta) {
  return res.json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function fail(res, status, message, errors) {
  return res.status(status).json({ success: false, message, ...(errors ? { errors } : {}) });
}

export function paginate(query) {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function money(n) {
  if (n == null || n === '') return 0;
  if (typeof n === 'object' && typeof n.toNumber === 'function') return n.toNumber();
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function genNo(prefix) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${stamp}-${rand}`;
}

function isPrismaDecimal(value) {
  if (value == null || typeof value !== 'object') return false;
  if (value instanceof Date || Array.isArray(value)) return false;
  if (typeof value.toNumber === 'function' && typeof value.toFixed === 'function') return true;
  if (value.constructor?.name === 'Decimal') return true;
  // Broken/plain copy of decimal.js shape { s, e, d }
  return Object.prototype.hasOwnProperty.call(value, 's')
    && Object.prototype.hasOwnProperty.call(value, 'e')
    && Object.prototype.hasOwnProperty.call(value, 'd')
    && Array.isArray(value.d);
}

export function decimalToNumber(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'object' && obj instanceof Date) return obj;
  if (isPrismaDecimal(obj)) {
    if (typeof obj.toNumber === 'function') return obj.toNumber();
    if (typeof obj.toString === 'function' && obj.constructor?.name === 'Decimal') return Number(obj.toString());
    // Last resort for plain {s,e,d} copies
    try {
      const sign = obj.s < 0 ? -1 : 1;
      const digits = (obj.d || []).join('');
      if (!digits) return 0;
      return sign * Number(`${digits}e${(obj.e ?? 0) - (digits.length - 1)}`);
    } catch {
      return Number(obj) || 0;
    }
  }
  if (Array.isArray(obj)) return obj.map(decimalToNumber);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = decimalToNumber(v);
    return out;
  }
  return obj;
}
