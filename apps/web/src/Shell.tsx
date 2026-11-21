import type { GoalKey } from "@sweetspot/engine";
import { useRef, useState } from "react";
import { api } from "./api";
import { Calendar } from "./screens/Calendar";
import { DaySheet } from "./screens/DaySheet";
import { Goal } from "./screens/Goal";
import { Home } from "./screens/Home";
import { Programming } from "./screens/Programming";

/** How far a pull must travel, in px after damping, before release refreshes. */
const PULL_TRIGGER = 50;
const PULL_MAX = 80;

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

  // Pull to refresh: drag down from the top of a screen, release past the trigger, and the server fetches new rides now.
  const [pull, setPull] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const startY = useRef<number | null>(null);

  async function refresh() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await api.sync();
      setVersion((v) => v + 1);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Couldn't refresh.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="shell">
      <main
        className="body"
        onTouchStart={(e) => {
          startY.current = !syncing && !sheet && e.currentTarget.scrollTop <= 0 ? e.touches[0]!.clientY : null;
        }}
        onTouchMove={(e) => {
          if (startY.current === null) return;
          const dy = e.touches[0]!.clientY - startY.current;
          setPull(dy > 0 ? Math.min(PULL_MAX, dy * 0.5) : 0);
        }}
        onTouchEnd={() => {
          const fire = startY.current !== null && pull >= PULL_TRIGGER;
          startY.current = null;
          setPull(0);
          if (fire) void refresh();
        }}
      >
        {(pull > 0 || syncing || syncMsg) && (
          <div className="ptr" role="status" style={{ height: syncing || syncMsg ? 24 : pull * 0.6 }}>
            {syncing ? "Fetching new rides…" : syncMsg ? <span className="err">{syncMsg}</span> : pull >= PULL_TRIGGER ? "Release to refresh" : "Pull to refresh"}
          </div>
        )}
        {tab === "home" ? (
          <Home key={version} onOpen={setSheet} />
        ) : tab === "calendar" ? (
          <Calendar refreshKey={version} onOpen={(s) => setSheet(s.id)} />
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
