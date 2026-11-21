import type { GoalBar, HomeView } from "@sweetspot/engine";
import { useState } from "react";
import { api } from "../api";
import { Status } from "../Status";
import { useLoad } from "../useLoad";

const BAR_COLOR: Record<string, string> = {
  endurance: "var(--endurance)",
  vo2: "var(--vo2)",
  sweetSpot: "#e0b25c",
  threshold: "#e0b25c",
  upper: "var(--lift)",
  lower: "var(--lift)",
};
const PILL = {
  green: { bg: "#11231c", line: "#1f4a39", fg: "#8fe0bd", dot: "#5fd0a4" },
  yellow: { bg: "#2a2410", line: "#5a4a1c", fg: "#f0d48a", dot: "#e0b25c" },
  red: { bg: "#2a1215", line: "#5a2630", fg: "#f4a4ac", dot: "#ee7480" },
};

// "2026-11-10" -> "Tuesday" / "Nov 10". Parsed as a local date so the weekday never shifts.
function dayParts(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return {
    weekday: dt.toLocaleDateString("en-US", { weekday: "long" }),
    short: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M9 5l7 7-7 7" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bar({ g, onOpen }: { g: GoalBar; onOpen: (id: string) => void }) {
  const pct = g.target > 0 ? Math.min(100, (g.actual / g.target) * 100) : 0;
  return (
    <div className="g">
      <div className="row">
        <span className="n">{g.label}</span>
        <span className="f">
          {g.actual} <span>/{g.target}{g.unit === "min" ? " min" : ""}</span>
        </span>
      </div>
      <div className="track" role="progressbar" aria-valuenow={g.actual} aria-valuemax={g.target} aria-label={g.label}>
        <div className="fill" style={{ width: `${pct}%`, background: BAR_COLOR[g.key] ?? "var(--lift)" }} />
      </div>
      {g.nudge && (
        <button className="nudge" onClick={() => onOpen(g.nudge!.sessionId)}>
          <span>{g.nudge.text}</span>
          <Chevron />
        </button>
      )}
    </div>
  );
}

const LIGHT_COLOR = { green: "#5fd0a4", yellow: "#e0b25c", red: "#ee7480" };

/** What the pill was judged on. Provisional thresholds, and the page says so. */
function ReadinessWhy({ r }: { r: NonNullable<HomeView["readiness"]> }) {
  return (
    <div className="card" id="readiness-why">
      <div className="lbl">Why {r.label.toLowerCase()}</div>
      {r.reasons.length > 0 ? (
        r.reasons.map((t) => <div key={t} style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8, lineHeight: 1.4 }}>{t}</div>)
      ) : (
        <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 8 }}>Every input is in range.</div>
      )}
      <div style={{ marginTop: 10 }}>
        {r.inputs.map((i) => (
          <div key={i.key} style={{ padding: "8px 0", borderTop: "1px solid var(--track)" }}>
            <div className="row">
              <span className="n" style={{ fontSize: 14 }}>{i.label}</span>
              <span className="f" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {i.value}
                <span aria-label={i.light} style={{ width: 8, height: 8, borderRadius: 4, background: LIGHT_COLOR[i.light] }} />
              </span>
            </div>
            <div className="m">{i.rule}</div>
          </div>
        ))}
      </div>
      {r.missing.length > 0 && <div className="m" style={{ marginTop: 8 }}>Not available: {r.missing.join(", ")}.</div>}
      <div className="m" style={{ marginTop: 8 }}>The pill shows the worst of these. The thresholds are provisional: each reading is logged with a prediction and scored, and they change only when that record says so.</div>
    </div>
  );
}

function Stat({ value, name, sub }: { value: string; name: string; sub: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="k">{name}</div>
      <div className="ks">{sub}</div>
    </div>
  );
}

export function Home({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const load = useLoad(() => api.home());
  const [why, setWhy] = useState(false);
  const v = load.data;
  if (!v) return <Status load={load} />;

  const { weekday, short } = dayParts(v.date);
  const p = v.readiness ? PILL[v.readiness.light] : null;
  return (
    <>
      <div className="row">
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{weekday}</div>
          <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>{short} · {v.weekLabel}</div>
        </div>
        {v.readiness && p && (
          <button
            className="pill"
            style={{ background: p.bg, borderColor: p.line, color: p.fg, font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            aria-expanded={why}
            aria-controls="readiness-why"
            onClick={() => setWhy((x) => !x)}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: p.dot }} />
            {v.readiness.label}
          </button>
        )}
      </div>
      <Status load={load} />
      {why && v.readiness && <ReadinessWhy r={v.readiness} />}

      {v.today ? (
        <button className="card" onClick={() => onOpen(v.today!.id)} style={{ background: "var(--today-bg)", borderColor: "var(--today-line)" }}>
          <div className="row" style={{ gap: 12 }}>
            <div>
              <div className="lbl" style={{ color: "var(--accent)" }}>Today</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{v.today.title}</div>
              {v.today.detail && <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 4 }}>{v.today.detail}</div>}
            </div>
            <Chevron />
          </div>
        </button>
      ) : (
        <div className="card">
          <div className="lbl">Today</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>Open day</div>
        </div>
      )}

      <div className="card">
        <div className="lbl">This week</div>
        {v.goals.map((g) => <Bar key={g.key} g={g} onOpen={onOpen} />)}
        {v.offGoals.map((o, i) => (
          <div key={o.key} className="g" style={i === 0 ? { borderTop: "1px solid var(--track)", paddingTop: 12 } : undefined}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>{o.label}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{o.text}</div>
          </div>
        ))}
      </div>

      {v.fatigue && (
        <div className="card">
          <div className="lbl">Fatigue</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <Stat value={fmt(v.fatigue.form)} name="Form" sub="freshness" />
            {v.fatigue.ramp !== null && <Stat value={fmt(v.fatigue.ramp)} name="Ramp" sub="points per week" />}
            {v.fatigue.load !== null && <Stat value={String(v.fatigue.load)} name="Load" sub="this week so far" />}
          </div>
          {v.fatigue.note && <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 10, lineHeight: 1.4 }}>{v.fatigue.note}</div>}
        </div>
      )}
    </>
  );
}
