const assert = require("node:assert/strict");
const gameCentre = require("../site/game-centre.js");

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

(async () => {
  let selected = { id: 1 }, successes = [], fallbacks = [];
  const first = deferred(), second = deferred();
  const controller = gameCentre.createDetailController({
    selectedGame: () => selected,
    renderEmpty: () => assert.fail("a selected game should not render empty"),
    renderLoading: () => {},
    renderSuccess: game => successes.push(game.id),
    renderFallback: game => fallbacks.push(game.id),
    storedDetail: id => ({ id }),
    liveDetail: id => id === 1 ? first.promise : second.promise,
    liveEnabled: () => true,
    archived: () => false,
  });

  const oldRequest = controller.render();
  selected = { id: 2 };
  const currentRequest = controller.render();
  second.resolve({ id: 2 });
  assert.equal((await currentRequest).status, "ready");
  first.resolve({ id: 1 });
  assert.equal((await oldRequest).status, "superseded");
  assert.deepEqual(successes, [2], "a late response cannot replace the newly selected game");
  assert.deepEqual(fallbacks, []);

  let fallbackMessage = "";
  const unavailable = gameCentre.createDetailController({
    selectedGame: () => ({ id: 3 }),
    renderEmpty: () => {},
    renderLoading: () => {},
    renderSuccess: () => assert.fail("missing data should not render as ready"),
    renderFallback: (_game, error) => { fallbackMessage = error.message; },
    storedDetail: () => null,
    liveDetail: () => assert.fail("archive views must not request live data"),
    liveEnabled: () => true,
    archived: () => true,
  });
  assert.equal((await unavailable.render()).status, "fallback");
  assert.match(fallbackMessage, /snapshot is not available/);

  let opened = null;
  const button = { dataset: { gameView: "featured" } };
  const detail = { innerHTML: "", querySelector: () => ({ onclick: null }) };
  const select = { innerHTML: "", value: "" };
  gameCentre.renderQuickView({
    selected: null,
    games: [],
    select,
    detail,
    browseNavigation: { innerHTML: "stale" },
    refreshButton: {},
    refreshStatus: {},
    viewButtons: [button],
    normalize: () => ({ label: "Scheduled" }),
    londonTime: () => "19:00",
    teamName: value => value,
    escape: value => String(value),
    openDetailed: game => { opened = game; },
    openCompleteView: () => {},
    reload: () => {},
  });
  assert.match(detail.innerHTML, /No game is available/);
  assert.equal(opened, null);

  const detailViewHost = { innerHTML: "" }, navigation = { innerHTML: "stale" };
  let briefingGame = null, moneyGame = null;
  const view = gameCentre.createDetailView({
    detail: detailViewHost,
    browseNavigation: navigation,
    renderNavigation: game => { navigation.innerHTML = `game-${game.id}`; },
    hero: game => `<header>${game.away}–${game.home}</header>`,
    context: team => `<article>${team}</article>`,
    lineup: () => "<section>Lineups</section>",
    matchup: () => "<section>Matchup</section>",
    injectBrief: game => { briefingGame = game.id; },
    storedSummary: () => "",
    moneyPanel: () => "<section>MoneyPuck</section>",
    renderMoney: id => { moneyGame = id; },
  });
  view.renderLoading({ id: 10, away: "MTL", home: "TOR" });
  assert.match(detailViewHost.innerHTML, /Loading official NHL game details/);
  assert.equal(navigation.innerHTML, "game-10");
  view.renderFallback({ id: 10, away: "MTL", home: "TOR" });
  assert.match(detailViewHost.innerHTML, /temporarily unavailable/);
  assert.equal(briefingGame, 10);
  assert.equal(moneyGame, 10);
  view.renderEmpty();
  assert.match(detailViewHost.innerHTML, /No game selected/);
  assert.equal(navigation.innerHTML, "");

  console.log("Game Centre module: all checks passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
