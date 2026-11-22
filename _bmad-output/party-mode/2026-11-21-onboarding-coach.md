# Party mode: onboarding and the coach (2026-11-21)

Room: 📋 John (PM), 🎨 Sally (UX). Topic: how a new program gets built, ending with the app writing the calendar, and an in-app cycling coach. Run without input from Narji, to a close.

---

📋 **John:** Before anyone draws a screen: why does onboarding exist here? Narji has one user, himself, and a program already. So "onboarding" is really *rebuild my program from nothing*. And the delete script tests exactly that. If the flow can't take an empty calendar to a written week, it doesn't work.

🎨 **Sally:** Agreed, but picture the person. It's 9:40 pm, kids finally down, phone in one hand. He doesn't want a setup wizard. He wants someone who already knows his riding to say "here's your next block, does this fit your week?"

📋 **John:** Which is why the first screen asks nothing. intervals.icu already knows FTP, zones, eight weeks of rides, which weekdays he actually rides, and CTL. Every question we ask that the data could answer is a tax.

🎨 **Sally:** So screen one is "Here's what I see." Hours per week, rides per week, the days he tends to ride, FTP and when it was set. One tap per line if it's wrong. I want it to feel like the coach did homework, not like a form.

📋 **John:** Fine. And then exactly two questions the data can't answer: what's the block for, and what does your week look like.

🎨 **Sally:** The week is the whole product, John. "Sweet spot" is the time window. I don't want a dropdown per day. I want a week strip he paints: tap Tuesday, it cycles off, 30, 45, 60, 90, 2 h+. Long-press for "trainer only" or "trail". And a running total against his usual 3.5 h.

📋 **John:** And fixed things? Kid pickups, the Thursday that's always gone?

🎨 **Sally:** Painted as "off". He doesn't need to explain why.

📋 **John:** Now the coach. Here's my problem. Anthropic spend isn't approved, and rule one in AGENTS.md is "code computes, the LLM proposes." If onboarding *requires* the coach, onboarding is blocked on a yes we don't have.

🎨 **Sally:** And I think the coach *is* the onboarding. A conversation is how a real coach builds a plan. You don't hand your coach a form.

📋 **John:** A real coach also doesn't invent your FTP. Look: the engine can generate a sane program from history plus availability with zero LLM. Endurance holds at 90, sweet spot progresses, VO2 progresses, threshold off, lifts one and one, recovery after three hit weeks. That's the defaults we already ship. Write a generator, done.

🎨 **Sally:** Then what's the coach for?

📋 **John:** The part a generator can't do: "I've got a stage race in May," "my knee's cranky," "I hate the trainer on weekdays," "why VO2 and not threshold?" Negotiation and explanation.

🎨 **Sally:** So the coach edits the program. It doesn't produce it from a blank page.

📋 **John:** Yes. And here's the line I won't give up: the coach writes into a **program card**, never only into the chat. The card is the artifact. Code validates every change to it. If the coach proposes VO2 the day after a lower-body lift, the rule gate flags it once, plainly, and Narji decides.

🎨 **Sally:** I'll take that, with one condition: the card lives *in* the conversation. Coach message, card, chips underneath: "Less intensity," "More lifting," "Explain this," "Looks good." The chat is how you change the card; the card is what you sign.

📋 **John:** Deal. And with no API key, the same screen works: the chips map to deterministic edits, and the free-text box says "Coach is off. Turn it on in settings."

🎨 **Sally:** That fallback screen is going to look sad.

📋 **John:** It's going to look *shipped*. Sad and shipped beats pretty and blocked.

🎨 **Sally:** *(sighs)* Fine. Next fight: how far ahead do we write the calendar? I want him to see the whole block, eight weeks with the recovery weeks marked. Seeing week 6 sweet spot at 25 min is motivating.

📋 **John:** Writing eight weeks into Google means rewriting eight weeks every time he misses a ride and targets stop stepping. Recurring series are what got us here: VO2 silently stopped existing after October because the series ended and nobody noticed.

🎨 **Sally:** Then show the block in the app and only write what's near.

📋 **John:** Two weeks, rolling. Sunday night the app writes week N+2. And the source of truth moves to Neon: the app keeps planned sessions in a table, and the calendar is a projection of it. Today the engine reads the plan *from* the calendar. That flips.

🎨 **Sally:** Which also answers your VO2 bug. If VO2 is a progress goal and the week has no VO2 session, that's the app's own fault, and it can't happen because the generator places it.

📋 **John:** Can't happen by construction, and a test asserts it.

🎨 **Sally:** Preview screen, then: two weeks laid out like the Calendar tab, the block strip underneath (W1 W2 W3 R W5…), and a forecast line. "If you hit your weeks, sweet spot reaches 23 min by Dec 14."

📋 **John:** Careful. Rule six: don't overclaim. That's a target, not fitness. And thesis: error bars. Say "target reaches 23 min if every week is hit; at your last-8-week hit rate (6 of 8), expect 22." That prediction gets logged and scored.

🎨 **Sally:** That's honestly the most *Sweetspot* sentence in the whole flow. Keep it.

📋 **John:** Last screen: commit. It says exactly what happens to the calendar. "Clears 42 events on Training. Writes 9 sessions for Nov 23 to Dec 6." One button. Logged as a decision.

🎨 **Sally:** And after onboarding, the coach doesn't disappear. The "What changed?" chips on Programming (Cooked, Short on time, Extra time, Something else) are the coach. Same sheet, same card, same rule gate.

📋 **John:** That's the angle I didn't walk in with. `/api/replan` and the coach are one feature. We were going to build both.

🎨 **Sally:** You're welcome.

📋 **John:** Ship order, then. One: program in Neon plus calendar writer plus the deterministic generator plus onboarding screens, with the coach box present but off. Two: coach with tools over the engine, once spend is a yes. Three: "What changed?" chips routed to the coach.

🎨 **Sally:** And re-onboarding is the same flow from Programming → "Build a new program", prefilled with the current one. That's how the delete script gets exercised every time.

📋 **John:** Still not settled: whether the coach may *ever* write the calendar without a tap.

🎨 **Sally:** Never. A tap every time.

📋 **John:** For moves inside a week I'd let auto-reshuffle do it. We'll fight about that when we build reshuffle.

---

## Outcome

- Onboarding is "build a program", and a rebuild runs the same flow. Steps: what I see (from data), the block's purpose, painting your week, the coach proposing a program card, previewing two weeks plus the block, then committing to the calendar.
- The program card is what gets signed. The coach edits it, and code validates every edit through the rule gate.
- Neon holds the plan. The calendar is a two-week rolling projection with no recurring series.
- A deterministic generator ships first. The coach comes second, once spend is approved, and is the same feature as `/api/replan`.
- Open: whether auto-reshuffle may write without a tap.
