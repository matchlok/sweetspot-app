import type { GoalDraft, GoalKey, GoalMode, GoalPreviewPoint, GoalView } from "@sweetspot/engine";
import { useEffect, useState } from "react";
import { api } from "../api";

const MODES: { id: GoalMode; label: string }[] = [
  { id: "progress", label: "Progress" },
  { id: "hold", label: "Hold" },
  { id: "off", label: "Off" },
];
const BLURB: Record<GoalMode, string> = {
  progress: "The target goes up only after a week you hit it. A miss repeats the same target.",
  hold: "The target stays the same every week it's planned.",
  off: "Not tracked and not shown on Home. The target below is kept for when you turn it back on.",
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function shortDate(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Stepper({ name, sub, value, label, onDec, onInc }: { name: string; sub: string; value: string; label: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="row">
      <div>
        <div className="n">{name}</div>
        <div className="m">{sub}</div>
      </div>
      <div className="step">
        <button className="sb" aria-label={`Lower the ${label}`} onClick={onDec}>−</button>
        <span className="val">{value}</span>
        <button className="sb" aria-label={`Raise the ${label}`} onClick={onInc}>+</button>
      </div>
    </div>
  );
}

export function Goal({ goalKey, onBack, onSaved }: { goalKey: GoalKey; onBack: () => void; onSaved: () => void }) {
  const [g, setG] = useState<GoalView | null>(null);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [preview, setPreview] = useState<GoalPreviewPoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setErr(null);
    api.goal(goalKey).then(
      (v) => {
        setG(v);
        setDraft({ mode: v.mode, target: v.target, stepMin: v.stepMin });
        setPreview(v.preview);
      },
      (e) => setErr(e.message),
    );
  }, [goalKey, attempt]);

  // Redraw the preview as the draft changes. The short delay keeps rapid taps on a stepper to one request.
  const dKey = draft ? `${draft.mode}|${draft.target}|${draft.stepMin}` : null;
  useEffect(() => {
    if (!draft || dKey === null) return;
    let stale = false;
    const t = setTimeout(() => {
      api.goalPreview(goalKey, draft).then(
        (r) => !stale && setPreview(r.preview),
        () => {},
      );
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dKey, goalKey]);

  const back = (
    <button className="back" onClick={onBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Programming
    </button>
  );

  if (err && !g) {
    return (
      <>
        <div>{back}</div>
        <div className="card" role="alert">
          <div className="err">{err}</div>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      </>
    );
  }
  if (!g || !draft) return <div className="muted">Loading…</div>;

  const set = (patch: Partial<GoalDraft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.saveGoal(goalKey, draft);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that.");
      setBusy(false);
    }
  };

  const max = Math.max(1, ...preview.map((p) => p.target));
  return (
    <>
      <div>
        {back}
        <div style={{ fontSize: 24, fontWeight: 700 }}>{g.label}</div>
        <div className="m">{g.definition}</div>
      </div>

      <div className="card">
        <div className="lbl">How it behaves</div>
        <div className="seg" role="group" aria-label="How it behaves" style={{ marginTop: 10 }}>
          {MODES.map((m) => (
            <button key={m.id} className={`sg${draft.mode === m.id ? " on" : ""}`} aria-pressed={draft.mode === m.id} onClick={() => set({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="m" style={{ marginTop: 8 }}>{BLURB[draft.mode]}</div>
      </div>

      {draft.mode !== "off" && (
        <>
          <div className="card">
            <Stepper name="Target" sub="From this week on" label="target" value={`${draft.target} min`}
              onDec={() => set({ target: clamp(draft.target - 1, 1, 180) })} onInc={() => set({ target: clamp(draft.target + 1, 1, 180) })} />
            {draft.mode === "progress" && (
              <>
                <div className="sep" />
                <Stepper name="Step" sub="After a hit week" label="step" value={`+${draft.stepMin} min`}
                  onDec={() => set({ stepMin: clamp(draft.stepMin - 1, 1, 10) })} onInc={() => set({ stepMin: clamp(draft.stepMin + 1, 1, 10) })} />
              </>
            )}
          </div>

          <div className="card">
            <div className="lbl">{draft.mode === "progress" ? "If you hit it every time it's planned" : "Held at the same target"}</div>
            <div className="bars">
              {preview.map((p) => (
                <div key={p.date} className="col">
                  <span className="bv">{p.target}</span>
                  <div className="bar" style={{ height: Math.round((p.target / max) * 72), background: p.isRecovery ? "var(--track)" : undefined, border: p.isRecovery ? "1px dashed #4f5262" : undefined }} />
                  <span className="bd">{shortDate(p.date)}</span>
                </div>
              ))}
            </div>
            <div className="m" style={{ marginTop: 10 }}>A recovery week runs at 60% and doesn't step up. It shows as a dashed bar.</div>
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />
      {err && <div className="err" role="alert">{err}</div>}
      <button className="cta" style={{ background: "var(--endurance)" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
    </>
  );
}
