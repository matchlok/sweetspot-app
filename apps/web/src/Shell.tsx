import type { GoalKey } from "@sweetspot/engine";
import { useState } from "react";
import { Calendar } from "./screens/Calendar";
import { DaySheet } from "./screens/DaySheet";
import { Goal } from "./screens/Goal";
import { Home } from "./screens/Home";
import { Programming } from "./screens/Programming";

type Tab = "home" | "calendar" | "programming";

const ICONS: Record<Tab, JSX.Element> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  programming: (
    <>
      <path d="M5 7h9M18 7h1M5 17h1M10 17h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8" cy="17" r="2" stroke="currentColor" strokeWidth="1.8" />
    </>
  ),
};
const LABELS: Record<Tab, string> = { home: "Home", calendar: "Calendar", programming: "Programming" };

export function Shell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [sheet, setSheet] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [goal, setGoal] = useState<GoalKey | null>(null);
  return (
    <div className="shell">
      <main className="body">
        {tab === "home" ? (
          <Home key={version} onOpen={setSheet} />
        ) : tab === "calendar" ? (
          <Calendar key={version} onOpen={(s) => setSheet(s.id)} />
        ) : goal ? (
          <Goal
            goalKey={goal}
            onBack={() => setGoal(null)}
            onSaved={() => {
              setGoal(null);
              setVersion((v) => v + 1);
            }}
          />
        ) : (
          <Programming key={version} onOpenGoal={setGoal} onLogout={onLogout} />
        )}
      </main>
      {sheet && (
        <DaySheet
          sessionId={sheet}
          onClose={() => setSheet(null)}
          onChanged={() => {
            setSheet(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
      <nav className="nav" aria-label="Main">
        {(Object.keys(LABELS) as Tab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">{ICONS[t]}</svg>
            {LABELS[t]}
          </button>
        ))}
      </nav>
    </div>
  );
}
