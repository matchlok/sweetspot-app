# Onboarding prototype v1 (canvas dated 2026-11-21, fix 2026-11-22)

Ten screens for the program onboarding flow in [ONBOARDING-COACH.md](../../plans/ONBOARDING-COACH.md). The canvas is https://claude.ai/artifact/5U7s7ZvZTjHV7ZFHwDysD1 (private, canvas v1795299301-1d6c, `canvas.json` created 2026-11-21). Layout follows [v4](../2026-11-11-ui-mocks-v4/README.md): `source/` holds the artboard files.

- `source/` has `canvas.json` and the ten `*.dc.html` artboards: Main (1), WhatISee (2), Purpose (3), YourWeek (4), Proposal (5), Adjusting (6), Preview (7), WriteCalendar (8), Done (9), CoachSheet (10).
- The files load `./support.js`, which belongs to the Design editor and is not in this folder. They need the editor to render, so there is no `canvas.png` here.
- The screens were not reviewed in this pass (that is Narjit's). Only the screen 5 layout was fixed, and the screens that repeat that week were brought in line.

## The screen 5 problem

Screen 5 put sweet spot on Tuesday and the lower lift on Monday, the day before. That breaks the rule that no quality ride follows a lower-body lift. The paragraph and the card both said so ("sweet spot on Tuesday", "Lower 1 · Mon"). Screens 6, 7, 9 and 10 repeated the same layout.

## The fix: use what `generateProgram` returns

Run in a scratch script (esbuild bundle of `packages/engine/src/generate.ts`, nothing added to the repo):

Input, from screen 4 (YourWeek) and screen 3 (Purpose):

```
history:      { asOf: "2026-11-21", liftsPerWeek: 2 }
availability: { minutes: [0, 60, 0, 45, 0, 120, 45] }   // Mon..Sun: Off, 60, Off, 45, Off, 2 h+, 45
purpose:      { kind: "faster" }                          // "Get faster overall", the screen 3 default
```

Screen 4 shows Tue 60, Thu 45, Sat 2 h+ and Sun 45 (4 h 30 min), with lift pills on Mon and Thu. The availability holds all three quality or long rides, so no rides had to be dropped. The generator takes the lift count (2) and picks the lift days itself (decision 4 in the plan), so the Thu lift pill is not honored.

Output, week 1 (Nov 23 to Nov 29), 8 weeks, no assumptions:

| Day | Session |
|---|---|
| Mon 23 | Lift B, upper body, 30 min |
| Tue 24 | Sweet spot, 60 min |
| Wed 25 | none |
| Thu 26 | VO2, 45 min |
| Fri 27 | Lift A, lower body + core, 30 min |
| Sat 28 | Endurance, 120 min |
| Sun 29 | Easy spin, 45 min |

Recovery weeks come out as weeks 4 and 8, which matches the block strip on screen 7. The generator's own `gate()` accepted this layout (no hard violation, no back-to-back quality, endurance on the weekend). I also ran `planViolations` on the week repeated twice, Sunday into Monday included: no violations. Sat endurance is the only ride after the Friday lower lift. Sunday is an easy spin, so nothing hard follows Saturday either.

A test pins this week: `packages/engine/test/generate.test.ts`, "builds the onboarding prototype's week...".

## Edits to the prototype (all in `source/`)

Screen 5, Proposal.dc.html (the fix):
- Paragraph: "Lifts go on Monday and Thursday, the days with the least riding." became "Lifts go on Monday and Friday, your two off days, with the lower lift on Friday so no hard ride follows it. Sunday is an easy spin."
- Card, Lifts row: "Lower 1 · Mon, upper 1 · Thu" became "Lower 1 · Fri, upper 1 · Mon".
- Card: added an "Easy spin · 45 min · Sun" row, because the generator returns that Sunday session and the card had no row for it.
- Unchanged: Endurance "Hold 90 min · Sat" (the goal; the Saturday session is 120 min), Sweet spot Tue, VO2 Thu.

Edits to other screens, only where they repeated the changed week:
- Screen 6, Adjusting.dc.html: removed the sentence "It also takes sweet spot off the day after Monday's lower lift." The lower lift is now Friday, so it no longer applies. The diff rows, the 4 h 30 min to 3 h 30 min total, and the Sunday move still hold. The one-time "Rule check, flagged once ... Your call" for Sunday sweet spot after Saturday's trail ride is left as it was. After the move, the week (Mon upper, Thu VO2, Fri lower, Sat endurance, Sun sweet spot) also has no `planViolations`.
- Screen 7, Preview.dc.html: in weeks 1 and 2, the Thursday "Lift" tag moved to Friday (Nov 27 and Dec 4). The Monday lift tag stays (it is now the upper lift).
- Screen 9, Done.dc.html: "Next up: Monday, lower lift." became "Next up: Monday, upper lift."
- Screen 10, CoachSheet.dc.html: "trim the warm-up and the lift" became "trim the warm-up", because Thursday no longer has a lift.

Checked and unchanged: Screen 8 (10 sessions for two weeks is still 5 a week), the 3 h 30 min totals on 6, 7, 9 and 10 (ride time after the sweet spot move: 45 + 120 + 45), and screens 1 to 4.

## For Narjit

- Screen 4's lift pills (Mon, Thu) are not what the generator uses, and the card now shows Mon and Fri. The plan already says the pills may become a "keep lifts off this day" preference; this is one more reason to decide that.
- The 3 h 30 min week on screens 6 to 10 is a coach edit. Running the generator on that availability (Thu 45, Sat 120, Sun 45) would instead put sweet spot Thu and VO2 Sun, and the lower lift on Mon. The prototype keeps the chip's story (sweet spot to Sunday), which passes the rules.
- Still open, not decided here: what a "condensed week" is, whether "leg work" means only the lower lift, and a hard block vs a one-time warning.
