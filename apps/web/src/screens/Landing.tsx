import { useState } from "react";
import { api, ApiError } from "../api";

/**
 * Marketing page for logged-out visitors. Every product render below reuses the app's CSS classes with
 * hard-coded sample numbers and shows no real data. The only call it makes is the waitlist signup.
 */
function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setErr(null);
    try {
      await api.joinWaitlist(email.trim(), trap);
      setState("done");
    } catch (x) {
      const s = x instanceof ApiError ? x.status : 0;
      setErr(s === 400 ? "That doesn't look like an email address." : s === 429 ? "A lot of people are signing up. Try again in a minute." : "Couldn't save that. Try again in a moment.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="lp-thanks" role="status">
        <div className="lp-thanks-t">You're on the list.</div>
        <div className="lp-thanks-d">We'll let you know when it's available.</div>
      </div>
    );
  }
  return (
    <form className="lp-form" onSubmit={submit} noValidate>
      <div className="lp-form-row">
        <input
          className="lp-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {/* Honeypot: hidden from people and screen readers, filled in by bots. */}
        <input className="lp-trap" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} />
        <button className="lp-btn lp-btn-main" disabled={state === "sending" || !email.trim()}>
          {state === "sending" ? "Joining…" : "Join waitlist"}
        </button>
      </div>
      {err && <div className="lp-form-err" role="alert">{err}</div>}
      <div className="lp-fine">One email when Sweetspot opens. We only use your address for that.</div>
    </form>
  );
}

function Sample() {
  return <div className="lp-sample">Sample data</div>;
}

function Pill({ tone, label }: { tone: "green" | "yellow" | "red"; label: string }) {
  return (
    <span className={`pill lp-pill ${tone}`}>
      <span className="lp-pdot" aria-hidden="true" />
      {label}
    </span>
  );
}

function Bar({ label, actual, target, unit, color }: { label: string; actual: number; target: number; unit?: string; color: string }) {
  return (
    <div className="g">
      <div className="row">
        <span className="n">{label}</span>
        <span className="f">
          {actual} <span>/{target}{unit ? ` ${unit}` : ""}</span>
        </span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${Math.min(100, (actual / target) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function ScorecardRender() {
  return (
    <div className="lp-render">
      <div className="card">
        <div className="lbl">This week</div>
        <Bar label="Endurance" actual={60} target={90} unit="min" color="var(--endurance)" />
        <Bar label="Sweet spot" actual={8} target={22} unit="min" color="var(--sweet)" />
        <Bar label="VO2" actual={8} target={8} unit="min" color="var(--vo2)" />
        <Bar label="Strength" actual={1} target={2} color="var(--lift)" />
      </div>
      <Sample />
    </div>
  );
}

function ReadinessRender() {
  return (
    <div className="lp-render">
      <div className="card">
        <div className="lbl">Readiness</div>
        <div className="lp-pills">
          <Pill tone="green" label="Ready" />
          <Pill tone="yellow" label="Go easier" />
          <Pill tone="red" label="Rest" />
        </div>
        <div className="lp-why">
          <div className="row">
            <span className="n">Recent hard days</span>
            <span className="f">1 in 3</span>
          </div>
          <div className="m">The light shows the worst of the inputs.</div>
        </div>
      </div>
      <Sample />
    </div>
  );
}

function ReshuffleRender() {
  return (
    <div className="lp-render">
      <div className="day">
        <div className="dn"><b>TUE</b><span>10</span></div>
        <div className="dbody">
          <div className="t">VO2 intervals</div>
          <div className="m">5 × 3 min · 55 min</div>
        </div>
        <span className="dot" style={{ background: "var(--vo2)" }} />
      </div>
      <div className="card">
        <div className="lbl">Move to</div>
        <div className="opt"><span className="radio" /><span className="oh">Wednesday</span></div>
        <div className="opt pick"><span className="radio on" /><span className="oh">Thursday</span></div>
        <div className="opt"><span className="radio" /><span className="oh">Friday</span></div>
        <div className="summary">VO2 intervals moves to Thursday. Lower lift moves to Wednesday so it isn't the day before.</div>
      </div>
      <Sample />
    </div>
  );
}

function PressureRender() {
  return (
    <div className="lp-render">
      <div className="card">
        <div className="lbl">At the trailhead</div>
        <div className="lp-psi">
          <div><div className="lp-psi-n">20</div><div className="k">Front</div></div>
          <div><div className="lp-psi-n">22</div><div className="k">Rear</div></div>
        </div>
        <div className="m">Dry, rocky, 2.4 in tires</div>
      </div>
      <Sample />
    </div>
  );
}

function HeroRender() {
  return (
    <div className="lp-render lp-hero-render">
      <div className="lp-device">
        <div className="row">
          <div>
            <div className="lp-h-day">Tuesday</div>
            <div className="m">Nov 10 · Week 2</div>
          </div>
          <Pill tone="green" label="Ready" />
        </div>
        <div className="card lp-today">
          <div className="lbl" style={{ color: "var(--accent)" }}>Today</div>
          <div className="lp-today-t">VO2 intervals</div>
          <div className="lp-today-d">5 × 3 min, 55 minutes total.</div>
        </div>
        <div className="card">
          <div className="lbl">This week</div>
          <Bar label="Endurance" actual={60} target={90} unit="min" color="var(--endurance)" />
          <Bar label="Tempo" actual={10} target={20} unit="min" color="var(--tempo)" />
          <Bar label="VO2" actual={2} target={8} unit="min" color="var(--vo2)" />
          <Bar label="Strength" actual={1} target={2} color="var(--lift)" />
        </div>
      </div>
      <Sample />
    </div>
  );
}

const FEATURES: { id: string; title: string; text: string; render: JSX.Element; soon?: boolean }[] = [
  {
    id: "scorecard",
    title: "See the week in zones",
    text: "Every ride is sorted by time in zone, so you can see what the week has covered and what is still open. Zones and FTP come from intervals.icu, and a ride with no zone data shows as unknown rather than a guess.",
    render: <ScorecardRender />,
  },
  {
    id: "readiness",
    title: "Readiness indicator takes the guesswork out",
    text: "Intelligent fatigue and fitness calculations allow you to focus on getting in what you need.",
    render: <ReadinessRender />,
  },
  {
    id: "reshuffle",
    title: "Move a day without breaking the week",
    text: "Missed Tuesday? Move the workout to a new day and have updates automatically update your favorite calendar app.",
    render: <ReshuffleRender />,
  },
  {
    id: "pressure",
    title: "Tire pressure at the trailhead",
    text: "Tell it the tires, the trail and the conditions, and get a starting pressure for each wheel.",
    render: <PressureRender />,
    soon: true,
  },
];

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="landing">
      <header className="lp-bar">
        <div className="lp-wrap lp-bar-in">
          <span className="lp-brand">Sweetspot<span className="lp-brand-bike">.bike</span></span>
          <button className="lp-btn lp-btn-quiet" onClick={onSignIn}>Sign in</button>
        </div>
      </header>

      <main>
        <section className="lp-wrap lp-hero">
          <h1>A simplified training app for busy cyclists.</h1>
          <p className="lp-lede">
            Sweetspot is a training system for busy cyclists and parents. It reads your week from the free cycling performance analyzer, intervals.icu, and tells you which session fits your schedule, and automatically reshuffles workouts if something needs to change.
          </p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn-main" href="#waitlist">Join waitlist</a>
            <a className="lp-btn lp-btn-quiet" href="#features">See how it works</a>
          </div>
          <HeroRender />
        </section>

        <div id="features">
          {FEATURES.map((f) => (
            <section key={f.id} className="lp-wrap lp-feat" aria-labelledby={`f-${f.id}`}>
              <div className="lp-copy">
                {f.soon && <span className="lp-tag">In the works</span>}
                <h2 id={`f-${f.id}`}>{f.title}</h2>
                <p>{f.text}</p>
              </div>
              <div className="lp-vis">{f.render}</div>
            </section>
          ))}
        </div>

        <section id="waitlist" className="lp-wrap lp-end">
          <span className="lp-tag">Early access</span>
          <h2>Be first in line.</h2>
          <p className="lp-end-p">Sweetspot is opening to a small group of busy riders. Leave your email and we'll let you know when it's available.</p>
          <WaitlistForm />
        </section>
      </main>

      <footer className="lp-wrap lp-foot">Sweetspot. Plans sync with intervals.icu and Google Calendar.</footer>
    </div>
  );
}
