  <div style="padding: 6px 20px 0; display: flex; align-items: center; justify-content: space-between">
    <span style="font-size: 18px; font-weight: 700">What changed?</span>
    <a href="Main.dc.html" aria-label="Close" style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--card-bd); border-radius: 12px; background: var(--card)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </a>
  </div>

  <div style="margin: 14px 20px 0; display: flex; flex-wrap: wrap; gap: 8px">
    <button style="height: 36px; padding: 0 14px; border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent-soft-ink); border-radius: 999px; font: 600 13px Inter, system-ui, sans-serif">Can't ride today</button>
    <button style="height: 36px; padding: 0 14px; border: 1px solid var(--btn2-bd); background: var(--card); color: var(--text); border-radius: 999px; font: 500 13px Inter, system-ui, sans-serif">Short on time</button>
    <button style="height: 36px; padding: 0 14px; border: 1px solid var(--btn2-bd); background: var(--card); color: var(--text); border-radius: 999px; font: 500 13px Inter, system-ui, sans-serif">Feeling cooked</button>
    <button style="height: 36px; padding: 0 14px; border: 1px solid var(--btn2-bd); background: var(--card); color: var(--text); border-radius: 999px; font: 500 13px Inter, system-ui, sans-serif">Got extra time</button>
  </div>

  <span style="margin: 22px 20px 8px; font-size: 11px; font-weight: 600; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase">Where the long ride can go</span>

  <div style="margin: 0 12px; display: flex; flex-direction: column; gap: 8px">
    <div style="background: var(--card); border: 1px solid var(--accent-bd); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--card-sh)">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span style="font-size: 16px; font-weight: 600">Sun · 1:00 – 3:00</span>
        <span style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--z3-ink)"><span style="width: 7px; height: 7px; border-radius: 50%; background: var(--z3); box-shadow: var(--g3)"></span>Outside</span>
      </div>
      <span style="font-size: 13px; color: var(--text2); line-height: 1.45">Go after the family thing wraps. 58° and calm, and you'll be home with daylight to spare.</span>
      <button style="height: 44px; border: 0; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font: 600 15px Inter, system-ui, sans-serif">Move it here</button>
    </div>

    <div style="background: var(--card2); border: 1px solid var(--card2-bd); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span style="font-size: 16px; font-weight: 600">Tue · 3:00 · 75 min</span>
        <span style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--z4-ink)"><span style="width: 7px; height: 7px; border-radius: 50%; background: var(--z4); box-shadow: var(--g4)"></span>Trainer</span>
      </div>
      <span style="font-size: 13px; color: var(--text2); line-height: 1.45">Works, but it bumps your threshold to Wednesday, right before Thursday. Two hard days in a row. Your call.</span>
      <button style="height: 44px; border: 1px solid var(--btn2-bd); border-radius: 10px; background: transparent; color: var(--text); font: 500 15px Inter, system-ui, sans-serif">Move it here</button>
    </div>

    <div style="background: var(--card2); border: 1px solid var(--card2-bd); border-radius: 16px; padding: 14px 16px; display: flex; align-items: center; gap: 12px">
      <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1">
        <span style="font-size: 15px; font-weight: 600">Drop it</span>
        <span style="font-size: 13px; color: var(--text2); line-height: 1.4">You'd land at 2h 40m. A light week, not a lost one.</span>
      </div>
      <button style="height: 44px; padding: 0 16px; border: 1px solid var(--btn2-bd); border-radius: 10px; background: transparent; color: var(--text); font: 500 14px Inter, system-ui, sans-serif">Drop</button>
    </div>
  </div>

  <div style="flex-grow: 1"></div>

  <div style="margin: 0 12px 34px; background: var(--card); border: 1px solid var(--card-bd); border-radius: 16px; padding: 12px 12px 12px 16px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--card-sh)">
    <label for="else" style="font-size: 12px; font-weight: 600; color: var(--muted)">Something else</label>
    <div style="display: flex; gap: 8px; align-items: center">
      <input id="else" type="text" placeholder="Kid's sick, maybe 40 min after bedtime…" style="flex-grow: 1; min-width: 0; height: 44px; border: 0; background: transparent; color: var(--text); font: 400 15px Inter, system-ui, sans-serif; outline: none">
      <button aria-label="Speak it" style="width: 44px; height: 44px; flex-shrink: 0; border: 1px solid var(--btn2-bd); border-radius: 12px; background: var(--card2); display: flex; align-items: center; justify-content: center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg>
      </button>
      <button aria-label="Send" style="width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 12px; background: var(--accent); display: flex; align-items: center; justify-content: center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
      </button>
    </div>
  </div>
