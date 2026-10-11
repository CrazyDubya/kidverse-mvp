// In-memory stand-in for a Mongoose model. Filters are evaluated by mingo (a real MongoDB
// query-language engine), so $gte/$in/etc behave like the server. ObjectIds are normalised
// to strings so equality works regardless of whether a route passed a string or an ObjectId.
const mongoose = require('mongoose');
const { Query } = require('mingo');

const isOid = (v) => v instanceof mongoose.Types.ObjectId;

const norm = (v) => {
  if (isOid(v)) return v.toString();
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
};

const setPath = (obj, path, value) => {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach((k) => {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  });
  cur[keys[keys.length - 1]] = value;
};

const clone = (row) => (row ? JSON.parse(JSON.stringify(row), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(v) ? new Date(v) : v)) : row);

// Chainable, thenable query supporting the subset of the Mongoose API the routes use
const chain = (run) => {
  const state = { sort: null, skip: 0, limit: Infinity };
  const q = {
    select: () => q,
    lean: () => q,
    sort: (s) => ((state.sort = s), q),
    skip: (n) => ((state.skip = n), q),
    limit: (n) => ((state.limit = n), q),
    then: (res, rej) => Promise.resolve().then(() => run(state)).then(res, rej)
  };
  return q;
};

const makeCollection = ({ defaults = () => ({}), unique = [] } = {}) => {
  const rows = [];
  const match = (filter) => {
    const test = new Query(norm(filter));
    return rows.filter((r) => test.test(r));
  };
  const c = {
    rows,
    reset: () => { rows.length = 0; },
    async create(data) {
      const row = norm({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...defaults(), ...data });
      for (const f of unique) {
        if (row[f] && rows.some((r) => r[f] === row[f])) {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }
      }
      rows.push(row);
      return { ...row, _id: new mongoose.Types.ObjectId(row._id) };
    },
    find: (filter = {}) =>
      chain((s) => {
        let out = match(filter);
        if (s.sort) {
          const [[k, dir]] = Object.entries(s.sort);
          out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
        }
        return out.slice(s.skip, s.skip + s.limit).map(clone);
      }),
    findOne: (filter = {}) => chain(() => clone(match(filter)[0]) || null),
    findById: (id) => c.findOne({ _id: id }),
    countDocuments: async (filter = {}) => match(filter).length,
    findByIdAndUpdate: (id, update) =>
      chain(() => {
        const row = match({ _id: id })[0];
        if (!row) return null;
        for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
        return clone(row);
      }),
    async updateOne(filter, update) {
      const row = match(filter)[0];
      if (!row) return { matchedCount: 0 };
      for (const [k, v] of Object.entries(norm(update.$set || {}))) setPath(row, k, v);
      for (const k of Object.keys(update.$unset || {})) delete row[k];
      return { matchedCount: 1 };
    },
    findOneAndUpdate: (filter, update, opts = {}) =>
      chain(() => {
        let row = match(filter)[0];
        if (!row && opts.upsert) {
          row = norm({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || isOid(v))) });
          rows.push(row);
        }
        if (!row) return null;
        for (const [k, v] of Object.entries(norm(update.$set || {}))) setPath(row, k, v);
        row.updatedAt = new Date();
        return clone(row);
      })
  };
  return c;
};

module.exports = { makeCollection };
