"""Build DraftMind data from Oracle's Elixir match data (https://oracleselixir.com).

Oracle's Elixir publishes one CSV per year with every pro game: 10 player rows (role,
champion, player, team) and 2 team rows (side, first pick, bans 1-5 and picks 1-5 in
draft order, result). It is the only free source with full draft order and the 2026
First Selection flag for LPL, LCK and the other major leagues.

  python3 pipeline/oracles_elixir.py stats  --since 2026-07-15 [--until DATE] [--league LPL ...]
  python3 pipeline/oracles_elixir.py drafts --since 2026-06-01 [--league ...]
  python3 pipeline/oracles_elixir.py teams  --since 2026-06-01 [--league ...]

The CSV is downloaded once to pipeline/.cache/ (or pass --csv PATH). Data: Oracle's Elixir,
free to use with credit to oracleselixir.com.
"""
import argparse
import csv
import json
import os
import sys
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from statpack import build_pack  # noqa: E402

# Google Drive file ids of the yearly CSVs in Oracle's Elixir's public folder.
DRIVE_IDS = {2026: "1hnpbrUpBMS1TZI7IovfpKeZfWJH1Aptm"}
ROLE = {"top": "top", "jng": "jungle", "mid": "mid", "bot": "bot", "sup": "support"}
SOURCE = "Oracle's Elixir 职业赛"
LICENSE = "oracleselixir.com"
# Top leagues and international events, used for backtest drafts and team pools.
MAJOR = ["LPL", "LCK", "LEC", "LCS", "LCP", "CBLOL", "WLDs", "MSI", "FST", "EWC", "LCKC"]


def load_csv(path, year):
    if not path:
        path = os.path.join(HERE, ".cache", f"oe-{year}.csv")
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            url = f"https://drive.usercontent.google.com/download?id={DRIVE_IDS[year]}&export=download&confirm=t"
            print(f"downloading {url}", file=sys.stderr)
            urllib.request.urlretrieve(url, path)
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def champion_ids():
    with open(os.path.join(HERE, "..", "src", "data", "champions.json")) as f:
        champs = json.load(f)["champions"]
    by_name = {c["nameEn"]: c["id"] for c in champs}
    by_name.update({c["id"]: c["id"] for c in champs})
    return by_name


def collect_games(rows, since, until, leagues):
    """Groups CSV rows into games: {"meta", "teams": [team row, team row], "players": [...]}."""
    games = defaultdict(lambda: {"teams": [], "players": []})
    for r in rows:
        if r["date"][:10] < since or (until and r["date"][:10] >= until):
            continue
        if leagues and r["league"] not in leagues:
            continue
        g = games[r["gameid"]]
        (g["teams"] if r["position"] == "team" else g["players"]).append(r)
    complete = []
    for gid, g in games.items():
        if len(g["teams"]) != 2 or len(g["players"]) != 10:
            continue
        if any(not t["pick5"] or t["result"] not in ("0", "1") for t in g["teams"]):
            continue
        complete.append({"id": gid, **g})
    complete.sort(key=lambda g: g["teams"][0]["date"])
    return complete


def cmd_stats(args, rows, cid):
    parsed = []
    for g in collect_games(rows, args.since, args.until, args.league):
        t0 = g["teams"][0]
        teams = []
        for t in g["teams"]:
            roles = {ROLE[p["position"]]: cid(p["champion"]) for p in g["players"] if p["teamid"] == t["teamid"]}
            teams.append({"win": t["result"] == "1", "roles": roles})
        if any(len(t["roles"]) != 5 for t in teams):
            continue
        parsed.append({
            "id": g["id"], "patch": t0["patch"], "tournament": f"{t0['league']} {t0['split']}".strip(),
            "bans": [cid(t[f"ban{i}"]) for t in g["teams"] for i in range(1, 6) if t[f"ban{i}"]],
            "teams": teams,
        })
    pack = build_pack(parsed, SOURCE, LICENSE, since=args.since, until=args.until)
    write(args.out or os.path.join(HERE, "..", "src", "data", "stats", "pro.json"), pack, compact=True)
    print(f"{len(parsed)} games, {len(pack['champions'])} champions", file=sys.stderr)


def cmd_drafts(args, rows, cid):
    out = []
    for g in collect_games(rows, args.since, args.until, args.league or MAJOR):
        first = [t for t in g["teams"] if t["firstPick"] == "1"]
        if len(first) != 1:
            continue
        first = first[0]
        second = next(t for t in g["teams"] if t is not first)

        def side(t):
            by_champ = {p["champion"]: ROLE[p["position"]] for p in g["players"] if p["teamid"] == t["teamid"]}
            picks = [t[f"pick{i}"] for i in range(1, 6)]
            return {
                "team": t["teamname"],
                "bans": [cid(t[f"ban{i}"]) if t[f"ban{i}"] else None for i in range(1, 6)],
                "picks": [cid(p) for p in picks],
                "roles": [by_champ.get(p) for p in picks],
            }

        out.append({
            "gameId": g["id"], "date": first["date"], "patch": first["patch"],
            "tournament": f"{first['league']} {first['split']}".strip(), "league": first["league"],
            "game": int(first["game"] or 1),
            "firstPickSide": first["side"].lower(),
            "first": side(first), "second": side(second),
            "winner": "first" if first["result"] == "1" else "second",
        })
    write(args.out or os.path.join(HERE, "data", "drafts.json"),
          {"source": SOURCE, "license": LICENSE, "since": args.since, "games": out}, compact=True)
    sides = sum(1 for d in out if d["firstPickSide"] == "red")
    print(f"{len(out)} drafts ({sides} with first pick on red)", file=sys.stderr)


def cmd_teams(args, rows, cid):
    """Per team: each role's most-played player and that player's champions (games, wins)."""
    teams = {}
    for g in collect_games(rows, args.since, args.until, args.league or MAJOR):
        for p in g["players"]:
            t = teams.setdefault(p["teamid"], {"name": p["teamname"], "leagues": defaultdict(int), "last": "", "roles": {}})
            t["name"] = p["teamname"]
            if p["position"] == "top":
                t["leagues"][p["league"]] += 1
            t["last"] = max(t["last"], p["date"])
            role = t["roles"].setdefault(ROLE[p["position"]], {})
            pl = role.setdefault(p["playername"], {"games": 0, "last": "", "champions": {}})
            pl["games"] += 1
            pl["last"] = max(pl["last"], p["date"])
            c = pl["champions"].setdefault(cid(p["champion"]), [0, 0])
            c[0] += 1
            c[1] += p["result"] == "1"
    out = []
    for t in teams.values():
        players = {}
        for role, cands in t["roles"].items():
            # The starter is whoever played the role most recently, ties broken by games played.
            name, pl = max(cands.items(), key=lambda kv: (kv[1]["last"][:10], kv[1]["games"]))
            players[role] = {"name": name, "games": pl["games"],
                             "champions": dict(sorted(pl["champions"].items(), key=lambda kv: -kv[1][0]))}
        if len(players) == 5:
            # Home league = where the team played most (not an international event it ended on).
            league = max(t["leagues"].items(), key=lambda kv: kv[1])[0]
            out.append({"name": t["name"], "league": league, "lastGame": t["last"][:10], "players": players})
    out.sort(key=lambda t: (t["league"], t["name"]))
    write(args.out or os.path.join(HERE, "..", "src", "data", "proTeams.json"),
          {"source": SOURCE, "license": LICENSE, "since": args.since, "teams": out}, compact=True)
    print(f"{len(out)} teams", file=sys.stderr)


def write(path, data, compact=False):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":") if compact else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["stats", "drafts", "teams"])
    ap.add_argument("--since", default="2026-07-15")
    ap.add_argument("--until", help="exclude games on or after this date (for backtest training packs)")
    ap.add_argument("--league", action="append", default=[], help="Oracle's Elixir league code, e.g. LPL")
    ap.add_argument("--csv", help="path to an already downloaded CSV")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--out")
    args = ap.parse_args()
    by_name = champion_ids()

    def cid(name):
        if name not in by_name:
            raise KeyError(f"unknown champion name from Oracle's Elixir: {name!r}")
        return by_name[name]

    rows = load_csv(args.csv, args.year)
    {"stats": cmd_stats, "drafts": cmd_drafts, "teams": cmd_teams}[args.command](args, rows, cid)


if __name__ == "__main__":
    main()
