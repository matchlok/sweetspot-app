import { useState } from "react";
import { api, ApiError } from "../api";

export function Login({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.login(pass);
      onDone();
    } catch (x) {
      const s = x instanceof ApiError ? x.status : 0;
      setErr(s === 401 ? "Wrong passphrase." : s === 429 ? "Too many tries. Wait a minute." : "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login shell" onSubmit={submit}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>Sweetspot</div>
      <input type="password" autoComplete="current-password" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Passphrase" autoFocus />
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn" disabled={busy || !pass}>Log in</button>
    </form>
  );
}
