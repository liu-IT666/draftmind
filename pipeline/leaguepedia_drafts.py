"""Fetch full pro drafts (ban/pick order) from Leaguepedia for backtesting.

Output (pipeline/data/drafts.json): one entry per game with the first-pick team's and
the second-pick team's bans and picks in draft order, the role of each pick, side,
patch, date, tournament and winner.

Leaguepedia's PicksAndBansS7 lists Team1 as the team that picked first; SwitchedSides
marks games where that team played on red (2026 First Selection). The script checks
this against ScoreboardGames, whose Team1 is always blue.

Usage: python3 pipeline/leaguepedia_drafts.py --since 2026-06-01 --league "LPL 2026" ...
Data: Leaguepedia (CC BY-SA 3.0), https://lol.fandom.com
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leaguepedia_stats as lp  # noqa: E402

ROLE = {"Top": "top", "Jungle": "jungle", "Mid": "mid", "Bot": "bot", "Support": "support"}
DEFAULT_LEAGUES = ["LPL 2026", "LCK 2026", "LEC 2026", "LCS 2026", "LCP 2026", "CBLOL 2026",
                   "Worlds 2026", "MSI 2026", "Esports World Cup 2026"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-06-01")
    ap.add_argument("--league", action="append", default=[])
    ap.add_argument("--max-wait", type=int, default=None)
    ap.add_argument("--out", default=os.path.join(lp.HERE, "data", "drafts.json"))
    ap.add_argument("--champions", default=os.path.join(lp.HERE, "..", "src", "data", "champions.json"))
    args = ap.parse_args()
    lp.MAX_WAIT = args.max_wait
    leagues = args.league or DEFAULT_LEAGUES

    with open(args.champions) as f:
        champs = json.load(f)["champions"]
    by_name = {c["nameEn"]: c["id"] for c in champs}
    by_name.update({c["id"]: c["id"] for c in champs})

    def cid(name):
        name = (name or "").strip()
        if not name or name == "None":
            return None
        if name not in by_name:
            raise KeyError(f"unknown champion name from Leaguepedia: {name!r}")
        return by_name[name]

    pb_fields = [f"PB.Team{t}{k}{i}" for t in (1, 2) for k in ("Ban", "Pick", "Role") for i in range(1, 6)]
    fields = ",".join(pb_fields + ["PB.Team1", "PB.Team2", "PB.Winner", "PB.SwitchedSides", "PB.GameId",
                                   "SG.Patch", "SG.DateTime_UTC", "SG.Tournament", "SG.Team1Picks", "SG.Team1=BlueTeam"])
    prefixes = " OR ".join(f"SG.Tournament LIKE '{p}%'" for p in leagues)
    where = f"SG.DateTime_UTC >= '{args.since}' AND ({prefixes})"
    rows = []
    offset = 0
    while True:
        page = lp.cargo({"tables": "PicksAndBansS7=PB,ScoreboardGames=SG", "join_on": "PB.GameId=SG.GameId",
                         "fields": fields, "where": where, "order_by": "SG.DateTime_UTC", "limit": 500,
                         "offset": offset})
        rows += page
        print(f"  drafts: {len(rows)} rows", file=sys.stderr)
        if len(page) < 500:
            break
        offset += 500

    games, skipped, side_checks = [], 0, [0, 0]
    for r in rows:
        try:
            t = {}
            for n in (1, 2):
                t[n] = {
                    "team": r[f"Team{n}"],
                    "bans": [cid(r[f"Team{n}Ban{i}"]) for i in range(1, 6)],
                    "picks": [cid(r[f"Team{n}Pick{i}"]) for i in range(1, 6)],
                    "roles": [ROLE.get(r[f"Team{n}Role{i}"]) for i in range(1, 6)],
                }
            if any(p is None for n in (1, 2) for p in t[n]["picks"]):
                raise ValueError("incomplete picks")
        except (KeyError, ValueError) as e:
            skipped += 1
            print(f"  skip {r.get('GameId')}: {e}", file=sys.stderr)
            continue
        switched = r["SwitchedSides"] in ("1", "Yes", "true", True)
        first_blue = not switched
        # Cross-check: ScoreboardGames.Team1 is the blue team.
        blue = r.get("BlueTeam")
        if blue:
            side_checks[0 if (blue == t[1]["team"]) == first_blue else 1] += 1
        games.append({
            "gameId": r["GameId"],
            "date": r["DateTime UTC"],
            "patch": r["Patch"],
            "tournament": r["Tournament"],
            "firstPickSide": "blue" if first_blue else "red",
            "first": t[1],
            "second": t[2],
            "winner": "first" if r["Winner"] == "1" else "second" if r["Winner"] == "2" else None,
        })

    print(f"{len(games)} drafts, {skipped} skipped; side check ok={side_checks[0]} mismatch={side_checks[1]}",
          file=sys.stderr)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump({"source": "Leaguepedia PicksAndBansS7", "license": "CC BY-SA 3.0 (lol.fandom.com)",
                   "since": args.since, "leagues": leagues, "games": games}, f, ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()
