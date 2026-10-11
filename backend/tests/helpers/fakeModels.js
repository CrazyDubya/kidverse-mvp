// Minimal in-memory stand-ins for the Mongoose User/Family models so route tests
// run without a MongoDB server. Schema rules are covered separately in models.test.js.
const mongoose = require('mongoose');

const matches = (doc, filter) =>
  Object.entries(filter).every(([k, v]) => String(doc[k]) === String(v));

const query = (fn) => ({
  select() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve().then(fn).then(resolve, reject);
  }
});

const makeStore = (extra = {}) => {
  const rows = [];
  const model = {
    rows,
    reset: () => { rows.length = 0; },
    USERNAME_PATTERN: /^[a-z0-9_]{3,30}$/,
    async create(data) {
      const clash = rows.find((r) =>
        ['email', 'username'].some((f) => data[f] && r[f] && r[f] === data[f])
      );
      if (clash) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      const row = { _id: new mongoose.Types.ObjectId(), isActive: true, failedLoginAttempts: 0, ...data };
      rows.push(row);
      return row;
    },
    findOne: (filter) => query(() => rows.find((r) => matches(r, filter)) || null),
    findById: (id) => query(() => rows.find((r) => String(r._id) === String(id)) || null),
    findByIdAndUpdate: (id, update) =>
      query(() => {
        const row = rows.find((r) => String(r._id) === String(id));
        if (row && update.$inc) {
          for (const [k, v] of Object.entries(update.$inc)) row[k] = (row[k] || 0) + v;
        }
        return row || null;
      }),
    async updateOne(filter, update) {
      const row = rows.find((r) => matches(r, filter));
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set || {});
      for (const k of Object.keys(update.$unset || {})) delete row[k];
      return { matchedCount: 1 };
    },
    async deleteOne(filter) {
      const i = rows.findIndex((r) => matches(r, filter));
      if (i >= 0) rows.splice(i, 1);
    },
    ...extra
  };
  return model;
};

module.exports = { makeStore };
