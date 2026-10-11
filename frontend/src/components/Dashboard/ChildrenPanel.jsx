import { useState } from 'react';
import { errorMessage } from '../../api/client';

const EMPTY = { username: '', password: '', firstName: '', lastName: '', dateOfBirth: '' };

const ageOf = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const ms = Date.now() - new Date(dateOfBirth).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / (365.25 * 24 * 3600 * 1000));
};

const Input = ({ label, id, ...props }) => (
  <div>
    <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
    <input id={id} required className="w-full rounded border border-gray-300 px-2 py-1 text-sm" {...props} />
  </div>
);

// `kids` (not `children`) to avoid clashing with React's reserved prop
const ChildrenPanel = ({ kids, onCreate }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(form);
      setForm(EMPTY);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Children</h3>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          {open ? 'Cancel' : 'Add child'}
        </button>
      </div>

      {kids.length === 0 ? (
        <p className="text-sm text-gray-600">No children added yet. Add one to start monitoring.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {kids.map((kid) => (
            <li key={kid.id} className="py-2 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-800">
                {kid.firstName} {kid.lastName}
              </span>
              <span className="text-gray-500">
                @{kid.username}
                {ageOf(kid.dateOfBirth) !== null && ` • ${ageOf(kid.dateOfBirth)} yrs`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First name" id="child-first" value={form.firstName} onChange={set('firstName')} autoComplete="off" />
            <Input label="Last name" id="child-last" value={form.lastName} onChange={set('lastName')} autoComplete="off" />
          </div>
          <Input label="Date of birth" id="child-dob" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Username" id="child-username" value={form.username} onChange={set('username')} autoComplete="off" />
            <Input label="Password" id="child-password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
          </div>
          <p className="text-xs text-gray-500">
            Username: 3-30 letters, numbers or underscores. Password: 8-72 characters with upper and lower case, a number and a symbol.
            Ages 3-17 only.
          </p>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {busy ? 'Adding…' : 'Create child account'}
          </button>
        </form>
      )}
    </div>
  );
};

export default ChildrenPanel;
