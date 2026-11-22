import type { MonthView, Session, WeekView } from "@sweetspot/engine";
import { useState } from "react";
import { api, fixtureMode } from "../api";
import { Status } from "../Status";
import { useLoad } from "../useLoad";

import { statusDotColor } from "./dots";

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

/**
 * Design rule (app-wide): a calendar tile shows at most 2 lines, the title and one short meta line,
 * each cut off with an ellipsis rather than wrapped. Status is carried by the dot (see dots.ts), never by
 * tile text. Anything longer, such as "Not logged", "Skipped" or "Moved to ...", belongs in the day detail
 * view (DaySheet). Don't add a third line here.
 */
function meta(s: Session, isToday: boolean): string {
  const d = s.minutes ? `${s.minutes} min` : (s.detail ?? "");
  return isToday ? `Today${d ? ` · ${d}` : ""}` : d;
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
                  <span key={s.id} className="dot" style={{ width: 7, height: 7, background: statusDotColor(s.status, s.kind) }} />
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
          <div className="muted" style={{ fontSize: 14, marginBottom: 4 }}>Tap a session to open it.</div>
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
                <div className="m" style={day.isToday ? { color: "var(--text-2)" } : undefined}>{meta(s, day.isToday)}</div>
              </div>
              <span className="dot" style={{ background: statusDotColor(s.status, s.kind) }} />
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
