# NHL Tracker 6.7 — Round 3 interpretive layer

## Outcome

Round 3 adds optional guidance around the existing evidence without changing the evidence itself or turning the tracker into an opinion engine.

The two additions are:

1. An optional League Analysis journey moving through **Results → Form → Process → Outlook**.
2. Chart-specific interaction overlays with definitions, reading guidance, interaction instructions, limitations and source attribution.

No analytical renderer, route, filter, table, chart, comparison, saved item or data source was removed.

## Guided analytical journey

The journey uses the same followed teams at every stage so the user can change the analytical question while keeping the comparison group stable.

| Stage | Question | Context shown | Complete evidence destination |
| --- | --- | --- | --- |
| Results | What has happened? | Standings points, record, goal differential and points rate | League Analysis → Team Rankings → Results |
| Form | What is changing? | Recent points rate and difference from season rate | League Analysis → Form & Trends |
| Process | What is driving it? | Expected-goals share and distance from 50% | League Analysis → Team Rankings → Five-on-five process |
| Outlook | What could follow? | Playoff probability, or remaining-season context when no model is available | Playoff Path |

The journey is collapsed by default. It is orientation rather than another full report, and its “Open complete evidence” action routes to the authoritative workspace.

## Chart guidance

Specialised views now provide chart-specific answers to five questions:

- What does this measure?
- How should the visual encodings be read?
- Which interactions reveal more detail?
- Which definitions are required to understand it?
- What limitation should remain visible before comparing or interpreting it?

Definitions are displayed inside the overlay. Selecting one opens the Stat Guide with that term already searched. The complete Stat Guide remains authoritative.

Detailed guidance is included for performance maps, form and sustainability plots, ranking history, leaderboards, schedule density/difficulty/rest, Power Index, team goal drivers, rolling team balance, player impact and neighbours, team/player comparisons, playoff paths, goaltending and special-teams maps. Other charts retain a safe contextual fallback.

## Interaction and accessibility

- Journey stages are real buttons with pressed state.
- Stage movement changes the evidence and meter positions rather than adding decorative motion.
- The journey’s movement is removed under `prefers-reduced-motion`.
- Chart-help dialogs return focus to the invoking control when dismissed.
- Dialog sections use plain-language labels and keyboard-reachable definition controls.
- Mobile uses a two-column stage selector and one-column team evidence without page overflow.
- Light and dark surfaces preserve readable contrast.

## Verification

- JavaScript syntax and diff checks passed.
- All 15 season-rollover tests passed.
- Browser QA passed for opening the optional journey, switching stages, routing Process to its authoritative ranking category, opening a chart-specific overlay, displaying inline definitions, and routing a definition into the filtered Stat Guide.
- The 390 px mobile journey has no page-level horizontal overflow.
- Light mode and dark mode were visually checked.
- No browser console warnings or errors were observed.
