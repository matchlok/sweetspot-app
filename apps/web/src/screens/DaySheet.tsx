import type { DayOptionsView } from "@sweetspot/engine";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { denverToday, markDoneSummary, optionSummary, sheetStatus } from "./sheetModel";

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
  /** The chosen option: an index into data.options, "done" for Mark done manually, or nothing yet. */
  const [sel, setSel] = useState<number | "done" | null>(null);
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
    setSel(null);
    setErr(null);
    api.options(sessionId, action).then(setData, (e) => setErr(e.message));
  }, [sessionId, action]);

  const skipped = data?.session.status === "skipped";
  // A skipped session is just not done yet, so it gets the same move-or-mark-done view as a missed one.
  const missed = data?.session.status === "not_logged" || skipped;
  const status = data ? sheetStatus(data.session, denverToday()) : null;
  const doneSel = sel === "done";
  // Skip has one option and the Skip tab is the choice, so its summary shows at once.
  const opt = action === "skip" ? data?.options[0] : typeof sel === "number" ? data?.options[sel] : undefined;
  // A session that can't move has one blocked entry that explains why, not a day.
  const lockedReason =
    data && data.options.length === 0 && data.blocked.length === 1 && ["Completed", "Moved", "Skipped"].includes(data.blocked[0]!.heading)
      ? data.blocked[0]!.reason
      : null;
  const canMarkDone = !!data?.canMarkDone && action === "move";
  const summary =
    doneSel && data
      ? markDoneSummary(data.session.title)
      : opt
        ? optionSummary(opt)
        : action === "skip"
          ? "Nothing else moves."
          : null;
  const warn = !doneSel && !!opt?.effects.some((e) => e.tone === "warn");
  const ready = doneSel || action === "skip" || !!opt;

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
    if (!data || !ready) return;
    if (doneSel) return run(() => api.markDone(sessionId));
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
        {data && status ? (
          <>
            <div>
              <div className="lbl">{longDate(data.session.date)}</div>
              <div className="sh-head">
                <div className="sh-title">{data.session.title}</div>
                <div className="sh-status" data-testid="sheet-status">
                  <span className="dot" aria-hidden="true" style={{ background: status.color }} />
                  {status.label}
                </div>
              </div>
              <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
                {data.session.detail ?? (data.session.minutes ? `About ${data.session.minutes} min` : "")}
              </div>
              {data.session.movedTo && (
                <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
                  Moved to {longDate(data.session.movedTo)}. Counts as missed this week.
                </div>
              )}
              {data.session.shifted && (
                <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
                  {data.session.status === "done" ? `Done. Planned for ${longDate(data.session.shifted.from)}.` : `Moved from ${longDate(data.session.shifted.from)} to fit this week.`}
                </div>
              )}
              {data.session.movedFrom && (
                <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>Moved in from {longDate(data.session.movedFrom)}.</div>
              )}
            </div>

            {!missed && (
              <div className="acts">
                {(["move", "swap", "skip"] as Action[]).map((a) => (
                  <button key={a} className={`act${action === a ? " on" : ""}`} aria-pressed={action === a} onClick={() => setAction(a)}>
                    {a[0]!.toUpperCase() + a.slice(1)}
                  </button>
                ))}
              </div>
            )}

            {/* Design rule: a list of choices carries one line per tile. What a choice does is said once, in the tray summary. */}
            {canMarkDone && (
              <button className={`opt${doneSel ? " pick" : ""}`} aria-pressed={doneSel} onClick={() => setSel("done")}>
                <span className={`radio${doneSel ? " on" : ""}`} />
                <span className="oh">Mark done manually</span>
              </button>
            )}

            {action !== "skip" && !lockedReason && (data.options.length > 0 || data.blocked.length > 0) && (
              <div className="lbl" style={{ marginTop: 4 }}>
                {action === "swap" ? "Trade days with which session?" : missed ? "Move to another day" : "Where should it go?"}
              </div>
            )}

            {action === "skip" ? null : lockedReason ? (
              <div className="note">{lockedReason}</div>
            ) : data.options.length === 0 && data.blocked.length === 0 ? (
              <div className="note">No day works under the current rules.</div>
            ) : (
              <>
                {data.options.map((o, i) => (
                  <button key={o.id} className={`opt${i === sel ? " pick" : ""}`} aria-pressed={i === sel} onClick={() => setSel(i)}>
                    <span className={`radio${i === sel ? " on" : ""}`} />
                    <span className="oh">{o.heading}</span>
                  </button>
                ))}
                {data.blocked.map((b) => (
                  <button key={b.heading} className="opt blocked" disabled>
                    <span className="radio" />
                    <span className="oh">{b.heading}</span>
                    <span className="why">{b.reason}</span>
                  </button>
                ))}
              </>
            )}

            <div className="tray">
              {summary && <div className={`summary${warn ? " warn" : ""}`} data-testid="sheet-summary">{summary}</div>}
              {err && <div className="err" role="alert">{err}</div>}
              <button className="cta" disabled={busy || !ready} onClick={apply}>
                {doneSel ? "Mark done" : action === "skip" ? "Skip it" : (opt?.cta ?? "Choose an option")}
              </button>
              <button className="ghostb" onClick={onClose}>{missed ? "Leave it" : "Cancel"}</button>
            </div>
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
