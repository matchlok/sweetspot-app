import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { Shell } from "./Shell";
import { Landing } from "./screens/Landing";
import { Login } from "./screens/Login";

type Auth = { state: "loading" } | { state: "in" } | { state: "out" } | { state: "error"; message: string };

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Logged-out visitors see the landing page first; Sign in switches to the login form.
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    setAuth({ state: "loading" });
    api.me().then(
      () => setAuth({ state: "in" }),
      (e: unknown) => {
        // Only a 401 means "log in". An unreachable server is not a logout.
        if (e instanceof ApiError && e.status === 401) setAuth({ state: "out" });
        else setAuth({ state: "error", message: e instanceof Error ? e.message : "Can't reach the server." });
      },
    );
  }, [attempt]);

  if (auth.state === "loading") return null;
  if (auth.state === "error") {
    return (
      <div className="login shell" role="alert">
        <div style={{ fontSize: 24, fontWeight: 700 }}>Sweetspot</div>
        <div className="err">{auth.message}</div>
        <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  if (auth.state === "out") {
    if (!signingIn) return <Landing onSignIn={() => setSigningIn(true)} />;
    return <Login onDone={() => { setSigningIn(false); setAuth({ state: "in" }); }} />;
  }
  return <Shell onLogout={() => api.logout().finally(() => setAuth({ state: "out" }))} />;
}
