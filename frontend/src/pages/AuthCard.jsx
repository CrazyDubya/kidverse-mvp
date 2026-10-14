export const Field = ({ label, id, ...props }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <input id={id} className="w-full rounded border border-gray-300 px-3 py-2" required {...props} />
  </div>
);

export const AuthCard = ({ title, onSubmit, children }) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
    <form onSubmit={onSubmit} className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 w-full max-w-md space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      {children}
    </form>
  </div>
);

export const SubmitButton = ({ busy, children }) => (
  <button type="submit" disabled={busy} className="w-full rounded bg-blue-600 py-2 font-medium text-white disabled:opacity-60">
    {busy ? 'Please wait…' : children}
  </button>
);
