import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../store/auth';
import { AuthCard, Field, SubmitButton } from './AuthCard';

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
    <AuthCard title={mode === 'login' ? 'Sign in to KidVerse' : 'Create a parent account'} onSubmit={submit}>
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

      <SubmitButton busy={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</SubmitButton>

      {mode === 'login' && (
        <Link to="/forgot-password" className="block text-center text-sm text-blue-700 underline">Forgot your password?</Link>
      )}

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
    </AuthCard>
  );
};

export default Login;
