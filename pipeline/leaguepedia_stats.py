"""Build a DraftMind stats pack from recent pro games on Leaguepedia.

Output (src/data/stats/pro.json): per-champion presence and win rate, plus lane
matchups (counter) and same-team pairs (synergy), all shrunk toward 50% so that
small samples do not dominate.

Usage: python3 pipeline/leaguepedia_stats.py --since 2026-07-01 [--out PATH]
       [--league LPL --league LCK ...] [--include-cached] [--max-wait 3600]
       [--offline] [--patch-min 26.13] [--patch-max 26.16]
Leaguepedia rate-limits hard; the script backs off and caches pages in .cache/.
--league limits the query to tournaments whose name starts with the prefix, and
--include-cached merges every page already cached by earlier runs, so a large
crawl can be finished in several smaller runs.
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

from statpack import build_pack

API = "https://lol.fandom.com/api.php"
UA = "DraftMind/0.1 (coach draft assistant; stats pipeline)"
ROLES = {"Top": "top", "Jungle": "jungle", "Mid": "mid", "Bot": "bot", "Support": "support"}
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
MAX_WAIT = None  # seconds of rate-limit waiting allowed per run; None = unlimited
_waited = 0


def cargo(params):
    os.makedirs(CACHE, exist_ok=True)
    query = urllib.parse.urlencode({"action": "cargoquery", "format": "json", **params})
    path = os.path.join(CACHE, hashlib.sha1(query.encode()).hexdigest() + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    global _waited
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
        if MAX_WAIT is not None and _waited + delay > MAX_WAIT:
            raise TimeoutError(f"rate limited for {_waited}s, giving up (raise --max-wait)")
        print(f"  rate limited, waiting {delay}s", file=sys.stderr)
        time.sleep(delay)
        _waited += delay
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-07-01")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "src", "data", "stats", "pro.json"))
    ap.add_argument("--champions", default=os.path.join(HERE, "..", "src", "data", "champions.json"))
    ap.add_argument("--league", action="append", default=[], help="tournament name prefix, e.g. LPL")
    ap.add_argument("--include-cached", action="store_true", help="also use pages cached by earlier runs")
    ap.add_argument("--offline", action="store_true", help="no network: build only from cached pages")
    ap.add_argument("--max-wait", type=int, default=None, help="max seconds to wait on rate limits")
    ap.add_argument("--patch-min", help="only use games on this patch or later, e.g. 26.13")
    ap.add_argument("--patch-max", help="only use games on this patch or earlier, e.g. 26.16 (for backtest training)")
    args = ap.parse_args()
    global MAX_WAIT
    MAX_WAIT = args.max_wait

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
    if args.league:
        prefixes = " OR ".join(f"SG.Tournament LIKE '{p}%'" for p in args.league)
        where += f" AND ({prefixes})"
    # ScoreboardGames lists each team's picks in role order (top, jungle, mid, bot, support),
    # so one table gives bans, picks, roles and the winner.
    games = [] if args.offline else fetch_all("ScoreboardGames=SG",
                      "SG.GameId,SG.Patch,SG.Tournament,SG.Team1Bans,SG.Team2Bans,SG.Team1Picks,SG.Team2Picks,SG.Winner",
                      where, "SG.GameId")
    if args.include_cached or args.offline:
        seen = {g["GameId"] for g in games}
        for name in sorted(os.listdir(CACHE)):
            with open(os.path.join(CACHE, name)) as f:
                for g in json.load(f):
                    if "Team1Picks" in g and g["GameId"] not in seen:
                        seen.add(g["GameId"])
                        games.append(g)

    def patch_key(p):
        try:
            return tuple(int(x) for x in p.split("."))
        except (AttributeError, ValueError):
            return None

    lo = patch_key(args.patch_min) if args.patch_min else None
    hi = patch_key(args.patch_max) if args.patch_max else None
    order = list(ROLES.values())
    parsed = []
    for g in games:
        pk = patch_key(g["Patch"])
        if (lo or hi) and (pk is None or (lo and pk < lo) or (hi and pk > hi)):
            continue
        t1, t2 = (g["Team1Picks"] or "").split(","), (g["Team2Picks"] or "").split(",")
        if len(t1) != 5 or len(t2) != 5 or g["Winner"] not in ("1", "2"):
            continue
        parsed.append({
            "id": g["GameId"],
            "patch": g["Patch"],
            "tournament": g["Tournament"],
            "bans": [cid(b) for col in ("Team1Bans", "Team2Bans") for b in (g[col] or "").split(",")
                     if b.strip() and b.strip() != "None"],
            "teams": [{"win": g["Winner"] == side, "roles": {r: cid(n) for r, n in zip(order, names)}}
                      for side, names in (("1", t1), ("2", t2))],
        })
    pack = build_pack(parsed, "Leaguepedia 职业赛", "CC BY-SA 3.0 (lol.fandom.com)", since=args.since)
    n_games = len(parsed)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{n_games} games, {len(pack['champions'])} champions -> {args.out}")


if __name__ == "__main__":
    main()
