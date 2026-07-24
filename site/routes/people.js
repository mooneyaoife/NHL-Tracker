NHLTrackerRoutes.register("people",{
  teams:context=>context.teamPage(),
  players:context=>{context.playerOptions();context.goalies();context.playerPage()},
  availability:context=>context.renderAvailability(),
  compare:context=>context.setupComparisons(),
  news:context=>{context.rosterMoves();context.renderNewsDesk()},
  watchlist:context=>{context.watchlist();context.setupWorkspaceStory()},
});
