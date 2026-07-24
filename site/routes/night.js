NHLTrackerRoutes.register("night",{
  tonight:context=>context.renderTonight(),
  games:context=>{context.gamesCentre();context.renderGameDay()},
});
