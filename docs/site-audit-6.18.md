# Site audit 6.18 — contextual matchup handoffs

## Outcome

The cross-season comparison added in 6.17 is now reachable at the moment an upcoming game is encountered. Tonight and the Selected Game briefing hand the exact game directly to Matchup Intelligence with the complete 2025–26 evidence selected.

## Simplification without loss

- Matchup Intelligence remains the one authoritative comparison workspace.
- Tonight adds a concise comparison action rather than copying team, player and goalie reports into every card.
- Selected Game adds the same handoff beside its existing schedule, report and model sources.
- Completed games retain the existing review path and do not show a prior-season pregame action.
- The selected game, evidence season, browser preference and shareable route are updated together.

## Interaction behavior

- The handoff opens the Matchup Intelligence tab.
- It preserves the exact game ID.
- It selects and remembers the available prior-season profile.
- It respects reduced-motion preferences when moving to Game Centre.
- Tonight actions stack on mobile and remain visually distinct in light and dark modes.

## Verification

- JavaScript syntax check passed.
- All 15 season-rollover tests passed.
- Selected Game and Tonight handoffs both restored the exact 2026–27 game with 2025–26 evidence.
- The resulting route contained both `game` and `matchupEvidence` state.
- Mobile and dark-mode rendering were checked at 390 × 844, then the viewport and theme were reset.
