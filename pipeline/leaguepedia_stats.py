"""Build a DraftMind stats pack from recent pro games on Leaguepedia.

Output (src/data/stats/pro.json): per-champion presence and win rate, plus lane
matchups (counter) and same-team pairs (synergy), all shrunk toward 50% so that
small samples do not dominate.

Usage: python3 pipeline/leaguepedia_stats.py --since 2026-07-01 [--out PATH]
Leaguepedia rate-limits hard; the script backs off and caches pages in .cache/.
Data: Leaguepedia (CC BY-SA 3.0), https://lol.fandom.com
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

API = "https://lol.fandom.com/api.php"
UA = "DraftMind/0.1 (coach draft assistant; stats pipeline)"
ROLES = {"Top": "top", "Jungle": "jungle", "Mid": "mid", "Bot": "bot", "Support": "support"}
PRIOR = 10  # pseudo-games at 50% used for Bayesian shrinkage
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")


def cargo(params):
    os.makedirs(CACHE, exist_ok=True)
    query = urllib.parse.urlencode({"action": "cargoquery", "format": "json", **params})
    path = os.path.join(CACHE, hashlib.sha1(query.encode()).hexdigest() + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    delay = 10
    while True:
        req = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as res:
            data = json.load(res)
        if "error" not in data:
            rows = [r["title"] for r in data["cargoquery"]]
            with open(path, "w") as f:
                json.dump(rows, f)
            time.sleep(3)
            return rows
        if data["error"].get("code") != "ratelimited":
            raise RuntimeError(data["error"])
        print(f"  rate limited, waiting {delay}s", file=sys.stderr)
        time.sleep(delay)
        delay = min(delay * 2, 300)


def fetch_all(table, fields, where, order):
    rows, offset = [], 0
    while True:
        page = cargo({"tables": table, "fields": fields, "where": where,
                      "order_by": order, "limit": 500, "offset": offset})
        rows += page
        print(f"  {table}: {len(rows)} rows", file=sys.stderr)
        if len(page) < 500:
            return rows
        offset += 500


def shrink(wins, games):
    return (wins + PRIOR * 0.5) / (games + PRIOR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-07-01")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "src", "data", "stats", "pro.json"))
    ap.add_argument("--champions", default=os.path.join(HERE, "..", "src", "data", "champions.json"))
    args = ap.parse_args()

    with open(args.champions) as f:
        champs = json.load(f)["champions"]
    by_name = {c["nameEn"]: c["id"] for c in champs}
    by_name.update({c["id"]: c["id"] for c in champs})

    def cid(name):
        name = name.strip()
        if name not in by_name:
            raise KeyError(f"unknown champion name from Leaguepedia: {name!r}")
        return by_name[name]

    where = f"SG.DateTime_UTC >= '{args.since}'"
    # ScoreboardGames lists each team's picks in role order (top, jungle, mid, bot, support),
    # so one table gives bans, picks, roles and the winner.
    games = fetch_all("ScoreboardGames=SG",
                      "SG.GameId,SG.Patch,SG.Tournament,SG.Team1Bans,SG.Team2Bans,SG.Team1Picks,SG.Team2Picks,SG.Winner",
                      where, "SG.GameId")

    picks = defaultdict(lambda: [0, 0])  # champion -> [games, wins]
    role_picks = defaultdict(lambda: defaultdict(int))
    bans = defaultdict(int)
    patches = defaultdict(int)
    lineups = {}  # (game, side) -> role -> (champ, win)
    order = list(ROLES.values())
    for g in games:
        t1, t2 = (g["Team1Picks"] or "").split(","), (g["Team2Picks"] or "").split(",")
        if len(t1) != 5 or len(t2) != 5 or g["Winner"] not in ("1", "2"):
            continue
        patches[g["Patch"]] += 1
        for col in ("Team1Bans", "Team2Bans"):
            for b in (g[col] or "").split(","):
                if b.strip() and b.strip() != "None":
                    bans[cid(b)] += 1
        for side, names in (("1", t1), ("2", t2)):
            win = g["Winner"] == side
            lineup = {}
            for role, name in zip(order, names):
                c = cid(name)
                lineup[role] = (c, win)
                picks[c][0] += 1
                picks[c][1] += win
                role_picks[c][role] += 1
            lineups[(g["GameId"], side)] = lineup
    n_games = sum(patches.values())

    matchups = defaultdict(lambda: [0, 0])  # (a, b) same role, opposite teams -> [games, a wins]
    pairs = defaultdict(lambda: [0, 0])  # sorted (a, b) same team -> [games, wins]
    for (game, side), lineup in lineups.items():
        other = lineups.get((game, "2" if side == "1" else "1"), {})
        for role, (c, win) in lineup.items():
            if role in other:
                m = matchups[(c, other[role][0])]
                m[0] += 1
                m[1] += win
        members = sorted(lineup.values())
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                pr = pairs[(members[i][0], members[j][0])]
                pr[0] += 1
                pr[1] += members[i][1]

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

    # Counter: how much better a does against b than a's own baseline (shrunk), in win-rate points.
    counters = {}
    for (a, b), (g, w) in matchups.items():
        if g >= 2:
            counters.setdefault(a, {})[b] = [round((w + PRIOR * base(a)) / (g + PRIOR) - base(a), 4), g]
    synergy = {}
    for (a, b), (g, w) in pairs.items():
        if g >= 3:
            expected = (base(a) + base(b)) / 2
            delta = round((w + PRIOR * expected) / (g + PRIOR) - expected, 4)
            synergy.setdefault(a, {})[b] = [delta, g]
            synergy.setdefault(b, {})[a] = [delta, g]

    pack = {
        "source": "Leaguepedia 职业赛",
        "license": "CC BY-SA 3.0 (lol.fandom.com)",
        "since": args.since,
        "games": n_games,
        "patches": dict(sorted(patches.items())),
        "generatedAt": time.strftime("%Y-%m-%d"),
        "champions": champions,
        "counters": counters,
        "synergy": synergy,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{n_games} games, {len(champions)} champions -> {args.out}")


if __name__ == "__main__":
    main()
