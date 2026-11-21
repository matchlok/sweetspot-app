import type { GoalKey, ProgramView } from "@sweetspot/engine";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Status } from "../Status";
import { useLoad } from "../useLoad";

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M9 5l7 7-7 7" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="row" style={{ padding: "7px 0" }}>
      <div className="n">{label}</div>
      <div className="step">
        <button className="sb" aria-label={`One fewer ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button>
        <span style={{ fontSize: 18, fontWeight: 700, width: 16, textAlign: "center" }}>{value}</span>
        <button className="sb" aria-label={`One more ${label.toLowerCase()}`} disabled={value >= 7} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

export function Programming({ onOpenGoal, onLogout }: { onOpenGoal: (key: GoalKey) => void; onLogout: () => void }) {
  const load = useLoad(() => api.program());
  const [p, setP] = useState<ProgramView | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  useEffect(() => {
    if (load.data) setP(load.data);
  }, [load.data]);

  if (!p) return <Status load={load} />;

  const setLift = async (which: "upper" | "lower", n: number) => {
    const prev = p.lifts;
    const next = { ...prev, [which]: n };
    setP({ ...p, lifts: next });
    setSaveErr(null);
    try {
      await api.saveLifts(next);
    } catch (e) {
      setP((cur) => (cur ? { ...cur, lifts: prev } : cur));
      setSaveErr(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };

  const r = p.recovery;
  return (
    <>
      <div style={{ fontSize: 24, fontWeight: 700 }}>Programming</div>

      <div className="card">
        <div className="lbl">Zone goals, minutes per week</div>
        <div style={{ marginTop: 4 }}>
          {p.goals.map((g, i) => (
            <button key={g.key} className="gl" style={i === 0 ? { borderTop: 0 } : undefined} onClick={() => onOpenGoal(g.key)}>
              <div>
                <div className="n" style={g.mode === "off" ? { color: "var(--muted)" } : undefined}>{g.label}</div>
                <div className="m">{g.mode === "off" ? "Off. Tap to turn it on" : g.summary}</div>
              </div>
              <Chevron />
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="lbl">Strength, sessions per week</div>
        <Stepper label="Upper lift" value={p.lifts.upper} onChange={(n) => setLift("upper", n)} />
        <Stepper label="Lower lift" value={p.lifts.lower} onChange={(n) => setLift("lower", n)} />
        {saveErr && <div className="err" role="alert" style={{ marginTop: 6 }}>{saveErr}</div>}
      </div>

      <div className="card">
        <div className="row">
          <div className="lbl">Recovery week</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{r.streak} of {r.after} hit weeks</div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {Array.from({ length: r.after }, (_, i) => (
            <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < r.streak ? "var(--endurance)" : "var(--track)" }} />
          ))}
        </div>
        <div className="m" style={{ marginTop: 8 }}>{r.text}</div>
      </div>

      <button className="ghostb" onClick={onLogout}>Log out</button>
    </>
  );
}
