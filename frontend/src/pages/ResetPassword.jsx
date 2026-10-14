import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { AuthCard, Field, SubmitButton } from './AuthCard';

// The emailed link is /reset-password#token=...; the fragment never reaches a server or log
const tokenFromHash = (hash) => new URLSearchParams(hash.replace(/^#/, '')).get('token') || '';

const ResetPassword = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => tokenFromHash(location.hash));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Take the token into memory and keep it out of the address bar and history. Runs on every
  // hash change: opening a newer link in this same tab only changes the fragment, so the page
  // isn't remounted and would otherwise keep submitting the old (expired or used) token.
  useEffect(() => {
    if (!location.hash) return;
    const fresh = tokenFromHash(location.hash);
    if (fresh) {
      setToken(fresh);
      setDone(false);
      setError(null);
    }
    navigate({ pathname: location.pathname, hash: '' }, { replace: true });
  }, [location.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token && !done) {
    return (
      <AuthCard title="Reset your password" onSubmit={(e) => e.preventDefault()}>
        <p role="alert" className="text-sm text-red-700">This reset link is invalid or has expired.</p>
        <Link to="/forgot-password" className="block text-center text-sm text-blue-700 underline">Request a new link</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" onSubmit={submit}>
      {done ? (
        <>
          <p role="status" className="text-sm text-gray-700">Your password was changed. Sign in with your new password.</p>
          <Link to="/login" className="block text-center text-sm text-blue-700 underline">Go to sign in</Link>
        </>
      ) : (
        <>
          <Field label="New password" id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Field label="Confirm new password" id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          <p className="text-xs text-gray-500">8-72 characters with upper and lower case, a number, and a symbol.</p>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <SubmitButton busy={busy}>Change password</SubmitButton>
          <Link to="/forgot-password" className="block text-center text-sm text-blue-700 underline">Request a new link</Link>
        </>
      )}
    </AuthCard>
  );
};

export default ResetPassword;
