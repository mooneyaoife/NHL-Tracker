# NHL Tracker 6.12 — Explore as one investigation path

## Outcome

Teams, Players, League, Power Index, Compare and News now read as one connected Explore path while retaining separate authoritative workspaces.

The path answers six progressively broader questions:

1. Teams — What is this team?
2. Players — Who is driving it?
3. League — How does it compare?
4. Power Index — How strong is the full profile?
5. Compare — Where is the edge?
6. Movement — What changed around it?

## Shared investigation layer

- The Explore context navigation is now a numbered file rail with one active state.
- Every Explore workspace receives a compact lens explaining its question, purpose and next useful step.
- Redundant page-title blocks on Players, League, Power, Compare and News are removed from view.
- Existing specialist subnavigation remains authoritative: Team sections, Player sections, League Analysis tabs, Compare tabs and News topics are unchanged.

## Context-preserving handoffs

- Moving from a selected Team to Players carries the team into the player selector.
- Moving from Teams or Players into League carries the team into league context.
- Continuing through Power Index into Compare carries the same team into the first comparison slot.
- Direct Explore rail navigation uses the same context-preserving behavior where a compatible team context exists.

## Simplification without loss

- No Team, Player, League, Power, Compare or News renderer was removed.
- Team Overview, Performance, Special Teams, Trends and Games remain intact.
- Player Overview, Impact, League Explorer and Goalies remain intact.
- League Overview, Rankings, Form, Power and Leaders remain intact.
- Team and player comparison controls, copyable routes and exact saved-view behavior remain intact.
- Power Rankings now has one active navigation state rather than a hidden duplicate League subrail state.

## Responsive and theme review

- The desktop Explore rail no longer overlaps the investigation lens.
- The phone rail scrolls horizontally and keeps the current workspace visible.
- Player selectors and Team profile headings remain usable beneath the shared lens.
- Compare retains zero page-level horizontal overflow in both Team and Player modes.
- Light mode remains the visual priority; dark mode preserves readable rails, questions, controls and comparison surfaces.

## Verification

- JavaScript syntax and diff checks passed.
- All 15 season-rollover tests passed.
- Browser QA covered Team-to-Player context, Player-to-League context, League-to-Power-to-Compare context, single active rail state, Team/Player Compare switching, copyable route restoration, mobile rail positioning and dark mode.
- No horizontal overflow was observed at 390px or 1536px.
