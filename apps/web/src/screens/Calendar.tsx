import type { Session, SessionKind, WeekView } from "@sweetspot/engine";
import { useEffect, useState } from "react";
import { api } from "../api";

const DOT: Record<SessionKind, string> = {
  endurance: "#7c8cf8",
  sweet_spot: "#e0b25c",
  threshold: "#e0b25c",
  vo2: "#ee7480",
  easy_spin: "#7c8cf8",
  lift_upper: "#c4c6d2",
  lift_lower: "#c4c6d2",
};
const WARN = "#e8bd62";

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return { dow: dt.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(), num: d };
}

function sub(s: Session, isToday: boolean): { text: string; color?: string } {
  if (s.status === "not_logged") return { text: "Not logged. Tap to reschedule", color: WARN };
  if (s.status === "done") return { text: "Done", color: "#8fe0bd" };
  if (s.status === "skipped") return { text: "Skipped" };
  const d = s.detail ?? (s.minutes ? `${s.minutes} min` : "");
  return { text: isToday ? `Today${d ? ` · ${d}` : ""}` : d, color: isToday ? "var(--text-2)" : undefined };
}

export function Calendar({ onOpen }: { onOpen: (s: Session) => void }) {
  const [w, setW] = useState<WeekView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.week().then(setW, (e) => setErr(e.message));
  }, []);

  if (err) return <div className="card err" role="alert">{err}</div>;
  if (!w) return <div className="muted">Loading…</div>;

  return (
    <>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{w.label}</div>
      <div className="muted" style={{ fontSize: 14, marginBottom: 4 }}>Tap a session to move, swap or skip it.</div>
      {w.days.map((day) => {
        const { dow, num } = parts(day.date);
        if (day.sessions.length === 0) {
          return (
            <div key={day.date} className="day open">
              <div className="dn"><b>{dow}</b><span>{num}</span></div>
              <div className="m" style={{ margin: 0 }}>Open day</div>
            </div>
          );
        }
        return day.sessions.map((s) => {
          const t = sub(s, day.isToday);
          const hollow = s.status === "not_logged";
          return (
            <button
              key={s.id}
              className="day"
              style={day.isToday ? { borderColor: "var(--today-line)", background: "var(--today-bg)" } : undefined}
              onClick={() => (s.status === "planned" || s.status === "not_logged") && onOpen(s)}
            >
              <div className="dn"><b style={day.isToday ? { color: "var(--accent)" } : undefined}>{dow}</b><span>{num}</span></div>
              <div style={{ flex: 1 }}>
                <div className="t">{s.title}</div>
                <div className="m" style={t.color ? { color: t.color } : undefined}>{t.text}</div>
              </div>
              <span className="dot" style={hollow ? { border: `2px solid ${WARN}` } : { background: DOT[s.kind] }} />
            </button>
          );
        });
      })}
      {w.nextWeekNote && (
        <div style={{ padding: "8px 2px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>Next week</div>
          <div className="m">{w.nextWeekNote}</div>
        </div>
      )}
    </>
  );
}
