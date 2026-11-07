# UI mocks v3 (2026-11-07)

These are the second and third rounds of the UX/PM brainstorm (BMAD party mode with Sally and John), following [v1](../2026-11-07-ui-mocks-v1/README.md). The canvas is https://claude.ai/artifact/FFY3jjpET1Nbd96jPdjXF9 (private). All numbers are sample data.

- `canvas-v3.png` shows the five screens in dark (top row) and light (bottom row). It was rendered locally from `static/` using `snapshot.html`.
- `source/` holds the canvas artboard files (`*.dc.html`, `canvas.json`) at this point.
- `static/` holds plain-HTML copies for local rendering. Month's calendar grid is pre-rendered there, because `<sc-for>` only expands inside the canvas.
- `kit/` holds the generator. Screen bodies live in `*.tpl`, and the shared color tokens for both themes live in `theme.css`. `build.js` writes `<Screen>.dc.html` and `<Screen>Light.dc.html` into `../project/`. `snapshot.js <dir>` rebuilds this folder.

## Decided in this round

- **Theme: dark, for now.** Light mode was mocked side by side and is kept for comparison. Both themes share one set of tokens, so switching later, or following the phone setting, is cheap.
- **Information architecture: Home · [Change the plan] · Calendar.**
  - Home is today's workout plus a ledger of the week's zones.
  - The middle button is an action, not a tab. It opens "What changed?", which offers quick chips (can't ride today, short on time, feeling cooked, got extra time), concrete moves with the trade-off stated, and a "Something else" text or voice box that goes to Claude.
  - Calendar shows the week by default and has a toggle to zoom out to the month.
- **Zone colors:** Z1 grey, Z2 blue, Z3 green, Z4 yellow, Z5+ red. The Calendar screen shows each zone's heart-rate range from intervals.icu.
- **Copy voice: coach, not assistant.** Say what to do or why it matters, and never grade the week. Banned: "Needs attention" panels and summary verdicts like "On track, one gap". Example of the right voice: "Hard minutes are light, and that's fine. Tuesday's 2×8 on the trainer fixes it."
- **One phrase everywhere.** "Locked in" is used both on the push notification action and on the Home button.
- **The push notification is kept** as the front door, at 6:05 am.

## Feedback on v2 (fixed in v3)

- Each artboard showed scrollbars. Screens are now clipped to the frame size.
- An iPhone bezel was tried and dropped, because its rounded corners left white gaps on the canvas. The final screens use a flat 390×844 frame with an iOS status bar and home indicator, the same way a Figma frame does.
- Light versions were added so the two themes could be compared. Dark was chosen.

## Still open

- **Middle button:** the same icon every day (John), or one that changes with the day, such as "+" on rest days (Sally). The default is the same icon every day.
- **Stack:** see [NEXT-STEPS](../../NEXT-STEPS.md).
