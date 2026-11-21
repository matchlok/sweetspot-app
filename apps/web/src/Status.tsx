import type { Loaded } from "./useLoad";

/** Error with a retry, or the loading line. Returns null once `data` is there and there's nothing to say. */
export function Status({ load }: { load: Loaded<unknown> }) {
  if (load.error && !load.data) {
    return (
      <div className="card" role="alert">
        <div className="err">{load.error}</div>
        <button className="btn" style={{ marginTop: 10 }} onClick={load.reload}>Try again</button>
      </div>
    );
  }
  if (!load.data) return <div className="muted" role="status">Loading…</div>;
  if (load.error) {
    // Refresh failed but there is older data on screen.
    return (
      <div className="err" role="alert" style={{ fontSize: 13 }}>
        {load.error} <button className="link" onClick={load.reload}>Try again</button>
      </div>
    );
  }
  return null;
}
