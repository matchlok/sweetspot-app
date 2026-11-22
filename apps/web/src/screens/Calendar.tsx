import type { MonthView, Session, SessionKind, WeekView } from "@sweetspot/engine";
import { useState } from "react";
import { api, fixtureMode } from "../api";
import { Status } from "../Status";
import { useLoad } from "../useLoad";

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

function short(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Date arithmetic on "YYYY-MM-DD" strings, in UTC so the day never shifts. */
export function shiftDate(date: string, days: number) {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

function sub(s: Session, isToday: boolean): { text: string; color?: string } {
  if (s.status === "not_logged") return { text: "Not logged. Tap to reschedule", color: WARN };
  if (s.status === "done") return { text: s.shifted ? `Done · planned ${short(s.shifted.from)}` : "Done", color: "#8fe0bd" };
  if (s.shifted) return { text: `Moved from ${short(s.shifted.from)} to fit this week`, color: "var(--text-2)" };
  if (s.movedTo) return { text: `Moved to ${short(s.movedTo)}. Counts as missed this week.`, color: WARN };
  if (s.status === "skipped") return s.id.endsWith("~origin") ? { text: "Skipped" } : { text: "Skipped. Tap to reschedule", color: WARN };
  if (s.movedFrom) return { text: `Moved in from ${short(s.movedFrom)}`, color: "var(--text-2)" };
  const d = s.detail ?? (s.minutes ? `${s.minutes} min` : "");
  return { text: isToday ? `Today${d ? ` · ${d}` : ""}` : d, color: isToday ? "var(--text-2)" : undefined };
}

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function Arrow({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={dir === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Nav({ label, onPrev, onNext, onToday, prevLabel, nextLabel, atToday }: {
  label: string; onPrev: () => void; onNext: () => void; onToday: () => void; prevLabel: string; nextLabel: string; atToday: boolean;
}) {
  return (
    <div className="calnav">
      <div className="ttl">{label}</div>
      <div className="btns">
        {!atToday && <button className="iconb today" onClick={onToday}>Today</button>}
        <button className="iconb" aria-label={prevLabel} onClick={onPrev}><Arrow dir="prev" /></button>
        <button className="iconb" aria-label={nextLabel} onClick={onNext}><Arrow dir="next" /></button>
      </div>
    </div>
  );
}

function Month({ m, onPickDay }: { m: MonthView; onPickDay: (weekStart: string) => void }) {
  return (
    <div className="card" style={{ padding: "10px 8px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center" }}>
        {DOW.map((d, i) => <div key={i} className="lbl" style={{ fontSize: 11, padding: "4px 0" }}>{d}</div>)}
        {m.weeks.flatMap((w) =>
          w.days.map((d) => (
            <button
              key={d.date}
              className="mday"
              aria-label={`${short(d.date)}${d.sessions.length ? `, ${d.sessions.map((s) => s.title).join(", ")}` : ""}`}
              onClick={() => onPickDay(w.start)}
              style={{
                opacity: d.inMonth ? 1 : 0.35,
                background: d.isToday ? "var(--today-bg)" : "transparent",
                borderColor: d.isToday ? "var(--today-line)" : "transparent",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: d.isToday ? 700 : 500, color: d.isToday ? "var(--accent)" : "var(--text)" }}>{Number(d.date.slice(8))}</span>
              <span style={{ display: "flex", gap: 3, minHeight: 10, justifyContent: "center" }}>
                {d.sessions.map((s) => (
                  <span
                    key={s.id}
                    className="dot"
                    style={
                      s.status === "not_logged"
                        ? { width: 9, height: 9, border: `2px solid ${WARN}` }
                        : s.status === "skipped"
                          ? { width: 7, height: 7, border: "1.5px solid var(--muted)" }
                          : { width: 7, height: 7, background: DOT[s.kind] }
                    }
                  />
                ))}
              </span>
            </button>
          )),
        )}
      </div>
    </div>
  );
}

/** `refreshKey` changes when something elsewhere changed the plan or synced, so the open week reloads without losing its place. */
export function Calendar({ onOpen, refreshKey = 0 }: { onOpen: (s: Session) => void; refreshKey?: number }) {
  const [mode, setMode] = useState<"week" | "month">("week");
  // Undefined means the current week or month, which the server resolves with Denver's today.
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const [monthDate, setMonthDate] = useState<string | undefined>(undefined);
  const week = useLoad(() => api.week(weekStart), [weekStart, refreshKey]);
  const month = useLoad(() => (mode === "month" && !fixtureMode ? api.month(monthDate) : Promise.resolve(null as MonthView | null)), [mode, monthDate, refreshKey]);

  const w = week.data;
  const m = month.data;

  const toggle = (
    <div className="seg" role="group" aria-label="Calendar view">
      {(["week", "month"] as const).map((x) => (
        <button key={x} className={`sg${mode === x ? " on" : ""}`} aria-pressed={mode === x} onClick={() => setMode(x)}>
          {x === "week" ? "Week" : "Month"}
        </button>
      ))}
    </div>
  );

  if (mode === "month") {
    if (fixtureMode) return <><div style={{ fontSize: 24, fontWeight: 700 }}>Month</div>{toggle}<div className="muted">The month view needs the live server.</div></>;
    // Month navigation is by the first of the month, so a step never skips a short month.
    const base = m ? `${m.month}-01` : undefined;
    const step = (n: number) => {
      if (!base) return;
      const d = new Date(`${base}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + n);
      setMonthDate(d.toISOString().slice(0, 10));
    };
    return (
      <>
        <Nav
          label={m?.label ?? "Month"}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={() => setMonthDate(undefined)}
          prevLabel="Previous month"
          nextLabel="Next month"
          atToday={monthDate === undefined}
        />
        {toggle}
        {m ? <Month m={m} onPickDay={(ws) => { setWeekStart(ws); setMode("week"); }} /> : <Status load={month} />}
        {m && <Status load={month} />}
      </>
    );
  }

  const go = (n: number) => w && setWeekStart(shiftDate(w.start, 7 * n));
  return (
    <>
      <Nav
        label={w?.label ?? "Week"}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToday={() => setWeekStart(undefined)}
        prevLabel="Previous week"
        nextLabel="Next week"
        atToday={weekStart === undefined}
      />
      {toggle}
      {!w ? <Status load={week} /> : (
        <>
          <Status load={week} />
          <div className="muted" style={{ fontSize: 14, marginBottom: 4 }}>Tap a session to move, swap or skip it.</div>
          {w.scheduleGap && <div className="nudge" role="status" style={{ marginTop: 0, marginBottom: 8 }}>{w.scheduleGap.text}</div>}
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
              onClick={() => (s.status === "planned" || s.status === "not_logged" || (s.status === "skipped" && !s.id.endsWith("~origin"))) && onOpen(s)}
            >
              <div className="dn"><b style={day.isToday ? { color: "var(--accent)" } : undefined}>{dow}</b><span>{num}</span></div>
              <div className="dbody">
                <div className="t">{s.title}</div>
                <div className="m" style={t.color ? { color: t.color } : undefined}>{t.text}</div>
              </div>
              <span className="dot" style={hollow ? { border: `2px solid ${WARN}` } : { background: DOT[s.kind] }} />
            </button>
          );
        });
      })}
      {weekStart === undefined && w.nextWeekNote && (
        <div style={{ padding: "8px 2px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>Next week</div>
          <div className="m">{w.nextWeekNote}</div>
        </div>
      )}
        </>
      )}
    </>
  );
}
