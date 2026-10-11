const mongoose = require('mongoose');
const User = require('../models/User');

const familyId = new mongoose.Types.ObjectId();
const base = { passwordHash: 'x', firstName: 'Ann', lastName: 'Lee', familyId };

// validate() (unlike validateSync) runs the pre('validate') hook with the role rules
const errorsFor = async (fields) => {
  try {
    await new User(fields).validate();
    return {};
  } catch (err) {
    return err.errors;
  }
};

describe('User schema rules', () => {
  it('requires an email for parents', async () => {
    expect((await errorsFor({ ...base, role: 'parent' })).email).toBeDefined();
    expect(await errorsFor({ ...base, role: 'parent', email: 'a@b.co' })).toEqual({});
  });

  it('requires a username (not an email) for children', async () => {
    expect((await errorsFor({ ...base, role: 'child' })).username).toBeDefined();
    expect(await errorsFor({ ...base, role: 'child', username: 'kid_1' })).toEqual({});
  });

  it('requires a family for non-admins', async () => {
    const { familyId: _omit, ...noFamily } = base;
    expect((await errorsFor({ ...noFamily, role: 'parent', email: 'a@b.co' })).familyId).toBeDefined();
  });

  it('rejects unknown roles and malformed usernames', async () => {
    expect((await errorsFor({ ...base, role: 'root', email: 'a@b.co' })).role).toBeDefined();
    expect((await errorsFor({ ...base, role: 'child', username: 'bad name!' })).username).toBeDefined();
  });

  it('never serializes secrets', () => {
    const json = new User({ ...base, role: 'parent', email: 'a@b.co', lockUntil: new Date() }).toJSON();
    expect(json).not.toHaveProperty('passwordHash');
    expect(json).not.toHaveProperty('lockUntil');
    expect(json).not.toHaveProperty('failedLoginAttempts');
  });
});
