import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { AuthCard, Field, SubmitButton } from './AuthCard';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Reset your password" onSubmit={submit}>
      {sent ? (
        <p role="status" className="text-sm text-gray-700">
          If that email belongs to a parent account, a reset link is on its way. It expires in an hour.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Enter your parent account email and we&apos;ll send you a link. Children: ask a parent to reset your password.
          </p>
          <Field label="Email" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
        </>
      )}
      <Link to="/login" className="block text-center text-sm text-blue-700 underline">Back to sign in</Link>
    </AuthCard>
  );
};

export default ForgotPassword;
