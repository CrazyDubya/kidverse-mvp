import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../store/auth';

const Field = ({ label, id, ...props }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <input id={id} className="w-full rounded border border-gray-300 px-3 py-2" required {...props} />
  </div>
);

const Login = () => {
  const navigate = useNavigate();
  const token = useAuth((s) => s.token);
  const signIn = useAuth((s) => s.login);

  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ identifier: '', email: '', password: '', firstName: '', lastName: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (token) return <Navigate to="/" replace />;

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } =
        mode === 'login'
          ? await api.post('/auth/login', { identifier: form.identifier, password: form.password })
          : await api.post('/auth/register', {
              email: form.email,
              password: form.password,
              firstName: form.firstName,
              lastName: form.lastName
            });
      signIn({ token: data.token, user: data.user });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">
          {mode === 'login' ? 'Sign in to KidVerse' : 'Create a parent account'}
        </h1>

        {mode === 'login' ? (
          <Field label="Email or username" id="identifier" value={form.identifier} onChange={set('identifier')} autoComplete="username" />
        ) : (
          <>
            <Field label="First name" id="firstName" value={form.firstName} onChange={set('firstName')} autoComplete="given-name" />
            <Field label="Last name" id="lastName" value={form.lastName} onChange={set('lastName')} autoComplete="family-name" />
            <Field label="Email" id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" />
          </>
        )}
        <Field
          label="Password"
          id="password"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {mode === 'register' && (
          <p className="text-xs text-gray-500">8-72 characters with upper and lower case, a number, and a symbol.</p>
        )}

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <button type="submit" disabled={busy} className="w-full rounded bg-blue-600 py-2 font-medium text-white disabled:opacity-60">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="w-full text-sm text-blue-700 underline"
        >
          {mode === 'login' ? 'New parent? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
};

export default Login;
