(function initialiseGameCentre(root, factory) {
  const api = factory();
  root.NHLTrackerGameCentre = api;
  if (typeof module === "object" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createGameCentreModule() {
  "use strict";

  function renderQuickView({
    selected,
    games,
    select,
    detail,
    browseNavigation,
    refreshButton,
    refreshStatus,
    viewButtons,
    normalize,
    londonTime,
    teamName,
    escape,
    prefetchDetailed = () => {},
    openDetailed,
    openCompleteView,
    reload = () => window.location.reload(),
  }) {
    const unavailable = selected && !games.some(game => String(game.id) === String(selected));
    select.innerHTML = (unavailable
      ? `<option value="${escape(selected)}">Requested game unavailable</option>`
      : "") + games.map(game =>
      `<option value="${escape(game.id)}">${escape(game.date || "")} · ${escape(game.away)} at ${escape(game.home)} · ${escape(normalize(game).label)}</option>`
    ).join("");
    if (selected) select.value = String(selected);

    const render = () => {
      const game = games.find(row => String(row.id) === select.value);
      if (!game) {
        detail.innerHTML = unavailable && select.value === String(selected)
          ? '<p class="notice">The requested game is not available in this release. Choose another game from the game window.</p>'
          : '<p class="notice">No game is available in this window.</p>';
        if (browseNavigation) browseNavigation.innerHTML = "";
        return;
      }
      const status = normalize(game);
      detail.innerHTML = `<article class="game-hero quick-game-hero"><span>${escape(status.label)} · ${escape(londonTime(game.startTimeUTC))} UK</span><h3>${escape(teamName(game.away))} ${game.awayScore ?? ""} · ${escape(teamName(game.home))} ${game.homeScore ?? ""}</h3><p>The stored schedule and score remain available. Detailed charts and live play-by-play load on demand.</p><button type="button" data-open-complete-game>Open detailed analysis</button></article>`;
      if (browseNavigation) {
        browseNavigation.innerHTML = '<button type="button" disabled>← Previous game</button><button type="button" data-open-complete-view>Browse library</button><button type="button" disabled>Next game →</button>';
        const browseButton = browseNavigation.querySelector?.("[data-open-complete-view]");
        if (browseButton) {
          browseButton.addEventListener("pointerenter", prefetchDetailed, { once: true });
          browseButton.addEventListener("focus", prefetchDetailed, { once: true });
          browseButton.onclick = openCompleteView;
        }
      }
      const detailedButton = detail.querySelector("[data-open-complete-game]");
      const primeDetailed = () => prefetchDetailed();
      detailedButton.addEventListener("pointerenter", primeDetailed, { once: true });
      detailedButton.addEventListener("focus", primeDetailed, { once: true });
      detailedButton.addEventListener("touchstart", primeDetailed, { once: true, passive: true });
      detailedButton.onclick = () => openDetailed(game);
    };

    select.onchange = render;
    refreshButton.onclick = async () => {
      if (refreshStatus) refreshStatus.textContent = "Checking the latest stored and live data…";
      refreshButton.disabled = true;
      try {
        await reload();
      } catch (error) {
        if (refreshStatus) refreshStatus.textContent = "Refresh failed. The stored game view remains available.";
        console.warn(error);
      } finally {
        refreshButton.disabled = false;
      }
    };
    viewButtons.forEach(button => {
      if (button.dataset.gameView !== "featured") {
        button.addEventListener("pointerenter", prefetchDetailed, { once: true });
        button.addEventListener("focus", prefetchDetailed, { once: true });
        button.onclick = openCompleteView;
      }
    });
    render();
  }

  function createDetailController({
    selectedGame,
    renderEmpty,
    renderLoading,
    renderSuccess,
    renderFallback,
    storedDetail,
    liveDetail,
    liveEnabled,
    archived,
  }) {
    let request = 0;

    async function officialGame(gameId) {
      const detail = storedDetail(gameId);
      if (liveEnabled() && !archived()) return liveDetail(gameId, detail);
      if (!detail) throw new Error("Detailed game snapshot is not available for this date");
      return detail;
    }

    async function render() {
      const current = ++request;
      const game = selectedGame();
      if (!game) {
        renderEmpty();
        return { status: "empty" };
      }

      renderLoading(game);
      try {
        const data = await officialGame(game.id);
        if (current !== request) return { status: "superseded" };
        renderSuccess(game, data);
        return { status: "ready", game };
      } catch (error) {
        if (current !== request) return { status: "superseded" };
        renderFallback(game, error);
        return { status: "fallback", game, error };
      }
    }

    return Object.freeze({ render, officialGame, cancel: () => { request += 1; } });
  }

  function createDetailView({
    detail,
    browseNavigation,
    renderNavigation,
    hero,
    context,
    lineup,
    matchup,
    injectBrief,
    storedSummary,
    moneyPanel,
    renderMoney,
  }) {
    const teamContext = game => `<div class="grid two game-context-grid">${context(game.away)}${context(game.home)}</div>`;

    const renderEmpty = () => {
      detail.innerHTML = '<p class="notice">No game selected.</p>';
      browseNavigation.innerHTML = "";
    };

    const renderLoading = game => {
      renderNavigation(game);
      detail.innerHTML = hero(game) + teamContext(game) + lineup(game) + matchup(game) + '<p class="notice game-loading">Loading official NHL game details…</p>';
      injectBrief(game);
    };

    const renderFallback = game => {
      const archived = storedSummary(game);
      const message = archived
        ? "This permanent summary remains available throughout the season archive. Full play-by-play is retained for the most recent games."
        : "Detailed NHL Game Centre information is temporarily unavailable. The stored schedule and score remain available.";
      detail.innerHTML = hero(game) + teamContext(game) + matchup(game) + moneyPanel(game.id, game.away, game.home) + archived + `<p class="notice">${message}</p>`;
      injectBrief(game);
      renderMoney(game.id, game.away, game.home);
    };

    return Object.freeze({ renderEmpty, renderLoading, renderFallback });
  }

  return Object.freeze({ renderQuickView, createDetailController, createDetailView });
}));
