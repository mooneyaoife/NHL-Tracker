NHLTrackerRoutes.register("season",{
  schedule:context=>{context.renderScheduleReleaseEditorial();context.renderScheduleIntelligenceEditorial();context.calendar();context.calendarSubscriptions();context.setupScheduleStory()},
});
