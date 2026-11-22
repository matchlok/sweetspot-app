import type { DayOptionsView } from "@sweetspot/engine";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

type Action = "move" | "swap" | "skip";

/** Pulled this far down, the sheet closes on release. */
const CLOSE_DRAG_PX = 90;

function longDate(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function DaySheet({ sessionId, onClose, onChanged }: { sessionId: string; onClose: () => void; onChanged: () => void }) {
  const [action, setAction] = useState<Action>("move");
  const [data, setData] = useState<DayOptionsView | null>(null);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; id: number } | null>(null);

  // Escape closes, like the scrim.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setData(null);
    setPick(0);
    setErr(null);
    api.options(sessionId, action).then(setData, (e) => setErr(e.message));
  }, [sessionId, action]);

  const skipped = data?.session.status === "skipped";
  // A skipped session is just not done yet, so it gets the same move-or-mark-done view as a missed one.
  const missed = data?.session.status === "not_logged" || skipped;
  const opt = data?.options[pick];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (x) {
      setErr(
        x instanceof ApiError && x.code === "conflict"
          ? "The plan changed since this was shown. Reopen the day."
          : x instanceof Error
            ? x.message
            : "Failed",
      );
      setBusy(false);
    }
  }

  const apply = () => {
    if (!data || (action !== "skip" && !opt)) return;
    // A skip has one option from the engine; use it if present.
    const optionId = opt?.id ?? "skip";
    return run(() => api.apply(sessionId, { action, optionId, planVersion: data.planVersion }));
  };

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ opacity: Math.max(0.2, 1 - dy / 400) }} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Session options"
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: drag.current ? "none" : "transform .18s ease-out" }}
      >
        {/* Drag the handle down to close. A short drag snaps back. */}
        <div
          className="grabzone"
          data-testid="sheet-handle"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, id: e.pointerId };
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y));
          }}
          onPointerUp={(e) => {
            if (!drag.current) return;
            const moved = Math.max(0, e.clientY - drag.current.y);
            drag.current = null;
            if (moved > CLOSE_DRAG_PX) onClose();
            else setDy(0);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDy(0);
          }}
        >
          <div className="grab" />
        </div>
        {data ? (
          <>
            <div>
              <div className="lbl">{longDate(data.session.date)}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{data.session.title}</div>
              <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
                {missed
                  ? skipped
                    ? "Skipped. Not done yet."
                    : "Planned for this day. Nothing was logged."
                  : (data.session.detail ?? (data.session.minutes ? `About ${data.session.minutes} min` : ""))}
              </div>
            </div>

            {missed && data.canMarkDone && (
              <div className="did">
                <span>Lifted without recording it?</span>
                <button disabled={busy} onClick={() => run(() => api.markDone(sessionId))}>Mark it done</button>
              </div>
            )}

            {!missed && (
              <div className="acts">
                {(["move", "swap", "skip"] as Action[]).map((a) => (
                  <button key={a} className={`act${action === a ? " on" : ""}`} aria-pressed={action === a} onClick={() => setAction(a)}>
                    {a[0]!.toUpperCase() + a.slice(1)}
                  </button>
                ))}
              </div>
            )}

            <div className="lbl" style={{ marginTop: 4 }}>
              {action === "skip"
                ? "What skipping does"
                : action === "swap"
                  ? "Trade days with which session?"
                  : missed
                    ? "Or move it to a day that is left"
                    : "Where should it go?"}
            </div>

            {action === "skip" ? (
              <div className="note">{opt ? opt.effects.map((e) => e.text).join(" ") : "Nothing else moves."}</div>
            ) : data.options.length === 0 ? (
              <div className="note">No day works under the current rules.</div>
            ) : (
              data.options.map((o, i) => (
                <button key={o.id} className={`opt${i === pick ? " pick" : ""}`} aria-pressed={i === pick} onClick={() => setPick(i)}>
                  <span className={`radio${i === pick ? " on" : ""}`} />
                  <span style={{ flex: 1 }}>
                    <span className="oh">{o.heading}</span>
                    {o.effects.map((e, j) => (
                      <span key={j} className={`eff${e.tone === "warn" ? " warn" : ""}`}>{e.text}</span>
                    ))}
                  </span>
                </button>
              ))
            )}

            {err && <div className="err" role="alert">{err}</div>}
            <button className="cta" disabled={busy || (action !== "skip" && !opt)} onClick={apply}>
              {action === "skip" ? "Skip it" : (opt?.cta ?? "Choose a day")}
            </button>
            <button className="ghostb" onClick={onClose}>{missed ? "Leave it" : "Cancel"}</button>
          </>
        ) : err ? (
          <>
            <div className="err" role="alert">{err}</div>
            <button className="ghostb" onClick={onClose}>Close</button>
          </>
        ) : (
          <div className="muted" style={{ padding: 24 }}>Loading…</div>
        )}
      </div>
    </>
  );
}
