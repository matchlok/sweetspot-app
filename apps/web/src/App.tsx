import { useEffect, useState } from "react";
import { api } from "./api";
import { Shell } from "./Shell";
import { Login } from "./screens/Login";

type Auth = "loading" | "in" | "out";

export function App() {
  const [auth, setAuth] = useState<Auth>("loading");
  useEffect(() => {
    api.me().then(() => setAuth("in"), () => setAuth("out"));
  }, []);
  if (auth === "loading") return null;
  if (auth === "out") return <Login onDone={() => setAuth("in")} />;
  return <Shell onLogout={() => api.logout().finally(() => setAuth("out"))} />;
}
