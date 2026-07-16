# Site audit 6.13 — Workspace files

## Finding

Workspace preserved every saved and preference capability, but presented them as one long settings page. The 32-team picker alone occupied most of the first viewport, while saved analysis, players, display choices and installation competed at the same level.

## Change

Workspace is now a five-file control room:

1. **Saved views** is the authoritative home for exact analytical contexts.
2. **Players** manages the browser-local watchlist.
3. **Teams** manages the followed teams that shape Home, Tonight, Season and Explore.
4. **Preferences** contains display choices and a direct hand-off to Home layout editing.
5. **App** contains installation guidance.

The numbered file rail uses small, purposeful movement to show a change of context. Only the selected file is rendered, removing the repeated settings wall without removing any capability.

## State and sharing

- The selected file is remembered in `localStorage` as `nhl-workspace-chapter-v1`.
- It is also encoded as `workspaceChapter` in the route, so a Workspace file can be bookmarked or shared.
- Saved views, players, followed teams, display choices and Home layout remain browser-local.
- The Workspace header reports saved-view, player and team counts without duplicating their underlying detail.

## Visual and responsive treatment

- The command header and numbered file rail extend the editorial/file language already established on Home, Tonight, Season and Explore.
- Desktop keeps the rail sticky while moving between focused files.
- Mobile turns the rail into a horizontally scrollable index and keeps the active file centred.
- Dark mode uses the same semantic surface, rule and brand tokens as the rest of the design system.
- Reduced-motion preferences disable the file transition.

## Capability check

Existing element IDs and handlers were retained for saved view reopening/removal, player saving, team filtering/saving/resetting, dark and compact modes, and app installation. The new Home layout button opens Home in edit mode rather than recreating those controls in Workspace.
