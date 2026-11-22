import type { GoalBar, HomeView, StrengthBar } from "@sweetspot/engine";
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

/** One Strength bar: every strength activity counts, and a tag puts it under Upper or Lower. */
function Strength({ s, onOpen, onTag, busy }: { s: StrengthBar; onOpen: (id: string) => void; onTag: (id: string, tag: "upper" | "lower" | null) => void; busy: boolean }) {
  const pct = s.target > 0 ? Math.min(100, (s.actual / s.target) * 100) : 0;
  const chip = (on: boolean): React.CSSProperties => ({
    minHeight: 44, minWidth: 72, padding: "0 14px", borderRadius: 12, font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--card-line)"}`, background: on ? "var(--accent)" : "#0f1116", color: on ? "#0b0c10" : "var(--text-2)",
  });
  return (
    <div className="g">
      <div className="row">
        <span className="n">{s.label}</span>
        <span className="f">
          {s.actual} <span>/{s.target}</span>
        </span>
      </div>
      <div className="track" role="progressbar" aria-valuenow={s.actual} aria-valuemax={s.target} aria-label={s.label}>
        <div className="fill" style={{ width: `${pct}%`, background: "var(--lift)" }} />
      </div>
      <div className="m" style={{ marginTop: 6 }}>
        Upper {s.upper.actual}/{s.upper.target} · Lower {s.lower.actual}/{s.lower.target}
        {s.untagged > 0 ? ` · ${s.untagged} to tag` : ""}
      </div>
      {s.lifts.map((l) => (
        <div key={l.id} style={{ marginTop: 10 }}>
          <div className="m" style={{ marginBottom: 6 }}>
            {dayParts(l.date).weekday} {dayParts(l.date).short}
            {l.tag ? "" : " · tag it"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["upper", "lower"] as const).map((k) => (
              <button
                key={k}
                style={chip(l.tag === k)}
                disabled={busy}
                aria-pressed={l.tag === k}
                onClick={() => onTag(l.id, l.tag === k ? null : k)}
              >
                {k === "upper" ? "Upper" : "Lower"}
              </button>
            ))}
          </div>
        </div>
      ))}
      {s.nudge && (
        <button className="nudge" onClick={() => onOpen(s.nudge!.sessionId)}>
          <span>{s.nudge.text}</span>
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
  const [tagging, setTagging] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const v = load.data;
  if (!v) return <Status load={load} />;

  const onTag = (id: string, tag: "upper" | "lower" | null) => {
    setTagging(true);
    setTagError(null);
    api.tagLift(id, tag).then(
      () => { setTagging(false); load.reload(); },
      (e: unknown) => { setTagging(false); setTagError(e instanceof Error ? e.message : "Couldn't save the tag."); },
    );
  };

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

      {v.scheduleGap && (
        <button className="nudge" style={{ marginTop: 0, marginBottom: 12 }} onClick={() => onOpen(v.scheduleGap!.sessionIds[0]!)}>
          <span>{v.scheduleGap.text}</span>
          <Chevron />
        </button>
      )}

      <div className="card">
        <div className="lbl">This week</div>
        {v.goals.map((g) => <Bar key={g.key} g={g} onOpen={onOpen} />)}
        {v.strength && <Strength s={v.strength} onOpen={onOpen} onTag={onTag} busy={tagging} />}
        {tagError && <div className="m" role="alert" style={{ marginTop: 8, color: "#f4a4ac" }}>{tagError}</div>}
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
