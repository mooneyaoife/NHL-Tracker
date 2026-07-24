NHLTrackerRoutes.register("explore",{
  league:context=>{context.analytics();context.league();context.renderNstSkaterExplorer();context.renderNstGoalieExplorer()},
  power:context=>context.power(),
  trends:context=>context.renderTrends(),
  playoffs:context=>context.playoffs(),
  guide:context=>context.renderGuide(),
  status:context=>{context.status();context.renderTrackerModelStatus();context.naturalStatTrickRefresh()},
});
