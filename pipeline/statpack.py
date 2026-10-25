"""Shared stats-pack builder for the DraftMind data pipelines.

A game is {"id", "patch", "tournament", "bans": [champion ids], "teams": [team, team]}
where team = {"win": bool, "roles": {"top"|"jungle"|"mid"|"bot"|"support": champion id}}.

The pack holds per-champion presence and win rate, lane matchups (counter) and same-team
pairs (synergy). Win rates are shrunk toward a prior so small samples do not dominate.
"""
import time
from collections import defaultdict

PRIOR = 10  # pseudo-games at 50% used for Bayesian shrinkage of champion win rates
PAIR_PRIOR = 25  # stronger shrinkage for matchups and pairs, which have far fewer games


def shrink(wins, games, prior=PRIOR, mean=0.5):
    return (wins + prior * mean) / (games + prior)


def build_pack(games, source, license, since=None, until=None):
    picks = defaultdict(lambda: [0, 0])  # champion -> [games, wins]
    role_picks = defaultdict(lambda: defaultdict(int))
    bans = defaultdict(int)
    patches = defaultdict(int)
    tournaments = defaultdict(int)
    matchups = defaultdict(lambda: [0, 0])  # (a, b) same role, opposite teams -> [games, a wins]
    pairs = defaultdict(lambda: [0, 0])  # sorted (a, b) same team -> [games, wins]

    for g in games:
        patches[g["patch"]] += 1
        tournaments[g["tournament"]] += 1
        for b in g["bans"]:
            if b:
                bans[b] += 1
        for t, team in enumerate(g["teams"]):
            other = g["teams"][1 - t]["roles"]
            win = team["win"]
            for role, c in team["roles"].items():
                picks[c][0] += 1
                picks[c][1] += win
                role_picks[c][role] += 1
                if role in other:
                    m = matchups[(c, other[role])]
                    m[0] += 1
                    m[1] += win
            members = sorted(team["roles"].values())
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    pr = pairs[(members[i], members[j])]
                    pr[0] += 1
                    pr[1] += win

    n_games = len(games)

    def base(c):
        g, w = picks.get(c, (0, 0))
        return shrink(w, g)

    champions = {}
    for c in set(picks) | set(bans):
        g, w = picks.get(c, (0, 0))
        champions[c] = {
            "picks": g, "bans": bans.get(c, 0),
            "presence": round((g + bans.get(c, 0)) / max(n_games, 1), 4),
            "winRate": round(shrink(w, g), 4),
            "roles": dict(role_picks.get(c, {})),
        }

    # Counter: how much better a does against b than a's own baseline, in win-rate points.
    counters = {}
    for (a, b), (g, w) in matchups.items():
        if g >= 2:
            counters.setdefault(a, {})[b] = [round(shrink(w, g, PAIR_PRIOR, base(a)) - base(a), 4), g]
    synergy = {}
    for (a, b), (g, w) in pairs.items():
        if g >= 3:
            expected = (base(a) + base(b)) / 2
            delta = round(shrink(w, g, PAIR_PRIOR, expected) - expected, 4)
            synergy.setdefault(a, {})[b] = [delta, g]
            synergy.setdefault(b, {})[a] = [delta, g]

    pack = {
        "source": source,
        "license": license,
        "since": since,
        "games": n_games,
        "patches": dict(sorted(patches.items())),
        "tournaments": dict(sorted(tournaments.items(), key=lambda kv: -kv[1])),
        "generatedAt": time.strftime("%Y-%m-%d"),
        "champions": champions,
        "counters": counters,
        "synergy": synergy,
    }
    if until:
        pack["until"] = until
    return pack
