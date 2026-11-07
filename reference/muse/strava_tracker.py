#!/usr/bin/env python3
"""Strava adherence tracker for Narjit's off-season MTB plan.

Pulls activities from the Strava API, stores them in a local SQLite DB,
loads planned sessions from the Google Calendar "Training" calendar, and
matches the two to compute adherence.

Rides are matched by INTENSITY CATEGORY, not duration: each ride's zone
distribution (sensor power zones when available, otherwise heart-rate
zones, via Strava's /activities/{id}/zones endpoint) is categorized as
vo2 / sweet_spot / endurance by categorize(). Time-in-zone is stored per
ride so weekly zone totals can drive training-focus recommendations.
Lifts still match on activity type + a 15-minute floor.

Strava API access goes through the strava skill CLI
(~/workspace/skills/strava/bin/strava_api.py), which authenticates with the
vault-held custom.strava credential via authd surrogates. This app never
sees, stores, or prints a real token.
"""

import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("America/Denver")  # athlete-local tz; planned dates are Denver dates

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "strava.db")
STRAVA_CLI = os.path.expanduser("~/workspace/skills/strava/bin/strava_api.py")
TRAINING_CAL = "8425b878f7623570a7bfd8d481831c0f5d372a47448cb3feed2f46dd5b7b6aeb@group.calendar.google.com"

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY,               -- Strava activity id
    athlete_id INTEGER,
    name TEXT,
    sport_type TEXT,
    type TEXT,
    start_date TEXT,                      -- UTC ISO
    start_date_local TEXT,                -- athlete-local ISO
    timezone TEXT,
    elapsed_time INTEGER,                 -- seconds
    moving_time INTEGER,
    distance_m REAL,
    total_elevation_gain_m REAL,
    average_heartrate REAL,
    max_heartrate REAL,
    average_watts REAL,
    device_watts INTEGER,
    kilojoules REAL,
    synced_at TEXT,
    category TEXT,                        -- vo2 | sweet_spot | endurance | unknown (rides only)
    category_source TEXT                  -- power | heartrate
);
CREATE TABLE IF NOT EXISTS planned_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                   -- YYYY-MM-DD (athlete local)
    kind TEXT NOT NULL,                   -- lift_lower, lift_upper, endurance, sweet_spot, vo2, easy_spin
    variant TEXT DEFAULT 'standard',      -- standard | recovery
    title TEXT,
    calendar_event_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS adherence (
    planned_id INTEGER PRIMARY KEY REFERENCES planned_sessions(id),
    activity_id INTEGER REFERENCES activities(id),
    status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | done | missed
    matched_at TEXT,
    detected_kind TEXT                    -- ride category actually detected (rides only)
);
CREATE TABLE IF NOT EXISTS activity_zones (
    activity_id INTEGER NOT NULL REFERENCES activities(id),
    source TEXT NOT NULL,                 -- heartrate | power (power only when sensor-based)
    z1 INTEGER DEFAULT 0, z2 INTEGER DEFAULT 0, z3 INTEGER DEFAULT 0,
    z4 INTEGER DEFAULT 0, z5 INTEGER DEFAULT 0, z6 INTEGER DEFAULT 0,
    z7 INTEGER DEFAULT 0,                 -- seconds in each zone
    total_seconds INTEGER DEFAULT 0,
    raw TEXT,                             -- raw distribution buckets JSON, for reprocessing
    fetched_at TEXT,
    PRIMARY KEY (activity_id, source)
);
CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

RIDE_TYPES = {"Ride", "MountainBikeRide", "VirtualRide", "EBikeRide", "GravelRide", "Cyclocross"}
LIFT_TYPES = {"WeightTraining", "Workout", "Crossfit", "Yoga"}  # Yoga unlikely; harmless

# Lifts keep a minimum-time floor. Rides no longer do: the zone category decides.
LIFT_MIN_MINUTES = 15
# Fallback only for rides with no usable zone data at all, so a data gap
# doesn't manufacture a miss on an endurance / easy-spin day.
UNKNOWN_RIDE_FALLBACK_MIN = 30


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _add_column_if_missing(conn, table, column, decl):
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init_db():
    conn = db()
    conn.executescript(SCHEMA)
    _add_column_if_missing(conn, "activities", "category", "TEXT")
    _add_column_if_missing(conn, "activities", "category_source", "TEXT")
    _add_column_if_missing(conn, "adherence", "detected_kind", "TEXT")
    conn.commit()
    conn.close()
    print("DB initialized at", DB_PATH)


def state_get(conn, key):
    row = conn.execute("SELECT value FROM sync_state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def state_set(conn, key, value):
    conn.execute("INSERT INTO sync_state(key,value) VALUES(?,?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def fetch_activities(after):
    """Yield Strava activities starting after epoch `after`, via the skill CLI."""
    page = 1
    while True:
        out = subprocess.run(
            [sys.executable, STRAVA_CLI, "activities", "--after", str(after),
             "--page", str(page), "--per-page", "100"],
            capture_output=True, text=True)
        if out.returncode != 0:
            raise RuntimeError("strava skill CLI failed: " + out.stderr.strip())
        acts = json.loads(out.stdout)
        if not acts:
            return
        yield from acts
        page += 1


def fetch_zones(activity_id):
    """Return Strava zone distributions for one activity via the skill CLI."""
    out = subprocess.run(
        [sys.executable, STRAVA_CLI, "zones", "--id", str(activity_id)],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"strava zones failed for {activity_id}: " + out.stderr.strip())
    return json.loads(out.stdout)


def categorize(source, zone_seconds):
    """Light intensity classifier from time-in-zone (seconds per zone).

    power: 7 zones (Z1 recovery .. Z5 VO2, Z6 anaerobic, Z7 neuromuscular).
           Sweet spot (~88-94% FTP) straddles upper Z3 tempo / Z4 threshold.
    heartrate: 5 custom zones (Z4 threshold band, Z5 VO2 band). HR lags on
           short intervals, so the VO2 bar is a few minutes in Z5, or a
           smaller Z5 dose on top of a big Z4+Z5 total.
    Returns 'vo2' | 'sweet_spot' | 'endurance' | 'unknown'.
    """
    total = sum(zone_seconds)
    if total <= 0:
        return "unknown"
    m = [s / 60.0 for s in zone_seconds]
    if source == "power":
        vo2_min = sum(m[4:7])              # Z5+Z6+Z7
        ss_min = m[3] + 0.5 * m[2]         # Z4 + half of Z3
        if vo2_min >= 5:
            return "vo2"
        if ss_min >= 10:
            return "sweet_spot"
        return "endurance"
    # heartrate
    vo2_min = m[4] if len(m) > 4 else 0.0  # Z5
    ss_min = m[3] if len(m) > 3 else 0.0   # Z4
    total_min = total / 60.0
    vo2_share = vo2_min / total_min
    if vo2_min >= 3 and vo2_share >= 0.04:
        return "vo2"
    # HR-lag path for interval sessions; long rides need the share test
    # above, or every hilly endurance ride would read as VO2.
    if total_min <= 100 and vo2_min >= 1.5 and (vo2_min + ss_min) >= 14:
        return "vo2"
    if ss_min >= 8:
        return "sweet_spot"
    return "endurance"


def store_zones(conn, activity_id, zones_payload):
    """Store zone distributions and (re)categorize one activity.

    Power buckets are stored only when sensor_based (Strava's estimated
    power uses fixed 50W buckets that don't reflect real zones).
    Categorization prefers sensor power, falls back to heart rate.
    Returns the category.
    """
    per_source = {}
    for entry in zones_payload or []:
        ztype = entry.get("type")
        buckets = entry.get("distribution_buckets") or []
        times = [int(b.get("time") or 0) for b in buckets]
        if ztype == "heartrate" and times:
            per_source["heartrate"] = (times, entry)
        elif ztype == "power" and entry.get("sensor_based") and 0 < len(times) <= 8:
            per_source["power"] = (times, entry)
    for source, (times, entry) in per_source.items():
        z = (times + [0] * 7)[:7]
        conn.execute(
            """INSERT INTO activity_zones(activity_id, source, z1, z2, z3, z4, z5, z6, z7,
               total_seconds, raw, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(activity_id, source) DO UPDATE SET
                 z1=excluded.z1, z2=excluded.z2, z3=excluded.z3, z4=excluded.z4,
                 z5=excluded.z5, z6=excluded.z6, z7=excluded.z7,
                 total_seconds=excluded.total_seconds, raw=excluded.raw,
                 fetched_at=excluded.fetched_at""",
            (activity_id, source, *z, sum(times), json.dumps(entry),
             datetime.now(timezone.utc).isoformat()))
    category, cat_source = "unknown", None
    for source in ("power", "heartrate"):
        if source in per_source:
            times = per_source[source][0]
            c = categorize(source, (times + [0] * 7)[:7])
            if c != "unknown":
                category, cat_source = c, source
                break
    conn.execute("UPDATE activities SET category=?, category_source=? WHERE id=?",
                 (category, cat_source, activity_id))
    return category


def ensure_zones(conn, limit=None):
    """Fetch + store zones for ride activities that don't have them yet."""
    rows = conn.execute(
        "SELECT a.id FROM activities a WHERE (a.sport_type IN ({}) OR a.type IN ({})) "
        "AND NOT EXISTS (SELECT 1 FROM activity_zones z WHERE z.activity_id=a.id) "
        "ORDER BY a.start_date_local".format(
            ",".join("?" * len(RIDE_TYPES)), ",".join("?" * len(RIDE_TYPES))),
        tuple(RIDE_TYPES) + tuple(RIDE_TYPES)).fetchall()
    if limit:
        rows = rows[:limit]
    done = 0
    for r in rows:
        try:
            payload = fetch_zones(r["id"])
        except RuntimeError as e:
            print(f"  zones fetch failed for {r['id']}: {e}")
            continue
        cat = store_zones(conn, r["id"], payload)
        conn.commit()
        done += 1
        print(f"  zones {r['id']}: category={cat}")
    return done


def sync_activities():
    conn = db()
    last = state_get(conn, "last_activity_start")
    after = int(last) if last else int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())
    total_new, newest = 0, after
    for a in fetch_activities(after):
        conn.execute(
            """INSERT INTO activities(id, athlete_id, name, sport_type, type, start_date,
               start_date_local, timezone, elapsed_time, moving_time, distance_m,
               total_elevation_gain_m, average_heartrate, max_heartrate, average_watts,
               device_watts, kilojoules, synced_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET name=excluded.name, moving_time=excluded.moving_time""",
            (a["id"], a["athlete"]["id"], a.get("name"), a.get("sport_type"), a.get("type"),
             a.get("start_date"), a.get("start_date_local"), a.get("timezone"),
             a.get("elapsed_time"), a.get("moving_time"), a.get("distance"),
             a.get("total_elevation_gain"), a.get("average_heartrate"), a.get("max_heartrate"),
             a.get("average_watts"), 1 if a.get("device_watts") else 0, a.get("kilojoules"),
             datetime.now(timezone.utc).isoformat()))
        total_new += 1
        ts = int(datetime.fromisoformat(a["start_date"].replace("Z", "+00:00")).timestamp())
        newest = max(newest, ts)
    state_set(conn, "last_activity_start", str(newest))
    conn.commit()
    print(f"Synced {total_new} activities (new/updated).")
    n = ensure_zones(conn)
    if n:
        print(f"Fetched zones for {n} ride(s).")
    conn.commit()
    conn.close()


def classify(title):
    t = title.lower()
    if "lift a" in t:
        return "lift_lower", "standard"
    if "lift b" in t:
        return "lift_upper", "standard"
    if "easy spin" in t:
        return "easy_spin", "recovery"
    if "sweet spot" in t:
        return "sweet_spot", "standard"
    if "vo2" in t:
        return "vo2", "standard"
    if "endurance ride" in t:
        return "endurance", "recovery" if "recovery" in t else "standard"
    return None, None


def load_planned():
    params = {"calendarId": TRAINING_CAL,
              "timeMin": "2026-10-01T00:00:00-06:00",
              "timeMax": "2027-04-02T00:00:00-06:00",
              "maxResults": 2500, "singleEvents": True}
    out = subprocess.run(["hatch_gws_cli", "calendar", "events", "list",
                          "--params", json.dumps(params)],
                         capture_output=True, text=True, check=True).stdout
    items = json.loads(out).get("items", [])
    conn = db()
    n = 0
    for it in items:
        kind, variant = classify(it.get("summary", ""))
        if not kind:
            continue
        date = (it.get("start", {}).get("date") or it.get("start", {}).get("dateTime", ""))[:10]
        cur = conn.execute(
            "INSERT OR IGNORE INTO planned_sessions(date, kind, variant, title, calendar_event_id) "
            "VALUES (?,?,?,?,?)", (date, kind, variant, it.get("summary"), it.get("id")))
        if cur.rowcount:
            conn.execute("INSERT INTO adherence(planned_id, status) VALUES (?, 'scheduled')",
                         (cur.lastrowid,))
            n += 1
    conn.commit()
    total = conn.execute("SELECT COUNT(*) c FROM planned_sessions").fetchone()["c"]
    print(f"Loaded {n} new planned sessions ({total} total).")
    conn.close()


QUALITY_KINDS = {"vo2", "sweet_spot"}


def _ride_match(planned_kind, rides):
    """Pick the ride that satisfies a planned ride session, by category.

    rides: activity rows for the planned date (ride types only).
    Returns (activity_row_or_None, detected_kind).
    - exact category match wins;
    - a quality plan (vo2/sweet spot) is satisfied by either quality
      category — the substitution is recorded via detected_kind;
    - an endurance plan is satisfied by any categorized ride;
    - an easy-spin plan is satisfied by any ride at all;
    - a quality plan with only an endurance-category ride does NOT match
      (the ride is recorded as detected so reports can say what happened);
    - a ride with no zone data ('unknown') can satisfy endurance/easy
      plans if it's at least UNKNOWN_RIDE_FALLBACK_MIN long, so missing
      HR/power data doesn't manufacture a miss.
    """
    if not rides:
        return None, None
    by_cat = {}
    for r in rides:
        by_cat.setdefault(r["category"] or "unknown", []).append(r)
    if planned_kind in by_cat:
        return by_cat[planned_kind][0], planned_kind
    if planned_kind in QUALITY_KINDS:
        for cat in ("vo2", "sweet_spot"):
            if cat in by_cat:
                return by_cat[cat][0], cat
        if "endurance" in by_cat:
            return None, "endurance"
        return None, (rides[0]["category"] or "unknown")
    if planned_kind == "endurance":
        for cat in ("endurance", "sweet_spot", "vo2"):
            if cat in by_cat:
                return by_cat[cat][0], cat
        unk = [r for r in by_cat.get("unknown", [])
               if (r["moving_time"] or 0) >= UNKNOWN_RIDE_FALLBACK_MIN * 60]
        if unk:
            return unk[0], "unknown"
        return None, "unknown" if by_cat.get("unknown") else None
    if planned_kind == "easy_spin":
        r = rides[0]
        return r, r["category"] or "unknown"
    return None, None


def match():
    conn = db()
    now_local = datetime.now(LOCAL_TZ)
    today = now_local.strftime("%Y-%m-%d")
    rows = conn.execute(
        "SELECT p.* FROM planned_sessions p JOIN adherence a ON a.planned_id=p.id "
        "WHERE p.date<=? AND a.status='scheduled' ORDER BY p.date", (today,)).fetchall()
    done = missed = 0
    for p in rows:
        if p["date"] == today and now_local.hour < 21:
            continue  # don't judge today's session before the evening sync
        day_acts = conn.execute(
            "SELECT * FROM activities WHERE substr(start_date_local,1,10)=? "
            "ORDER BY moving_time DESC", (p["date"],)).fetchall()
        if p["kind"].startswith("lift"):
            min_sec = LIFT_MIN_MINUTES * 60
            hit = next((c for c in day_acts
                        if (c["sport_type"] in LIFT_TYPES or c["type"] in LIFT_TYPES)
                        and (c["moving_time"] or 0) >= min_sec), None)
            detected = None
        else:
            rides = [c for c in day_acts
                     if c["sport_type"] in RIDE_TYPES or c["type"] in RIDE_TYPES]
            hit, detected = _ride_match(p["kind"], rides)
        if hit:
            conn.execute("UPDATE adherence SET status='done', activity_id=?, detected_kind=?, "
                         "matched_at=? WHERE planned_id=?",
                         (hit["id"], detected, datetime.now(timezone.utc).isoformat(), p["id"]))
            done += 1
        else:
            conn.execute("UPDATE adherence SET status='missed', activity_id=?, detected_kind=? "
                         "WHERE planned_id=?",
                         (rides[0]["id"] if not p["kind"].startswith("lift") and rides else None,
                          detected, p["id"]))
            missed += 1
    conn.commit()
    print(f"Matched: {done} done, {missed} missed.")
    conn.close()


def _fmt_min(seconds):
    return f"{seconds/60:.0f}"


def weekly_zone_rows(conn, weeks_back=4):
    """HR time-in-zone totals per ISO week (Mon-Sun), most recent first."""
    today = datetime.now(LOCAL_TZ).date()
    monday = today - timedelta(days=today.weekday())
    out = []
    for w in range(weeks_back):
        start = monday - timedelta(weeks=w)
        end = start + timedelta(days=7)
        row = conn.execute(
            "SELECT COALESCE(SUM(z.z1),0) z1, COALESCE(SUM(z.z2),0) z2, "
            "COALESCE(SUM(z.z3),0) z3, COALESCE(SUM(z.z4),0) z4, "
            "COALESCE(SUM(z.z5),0) z5, COUNT(DISTINCT z.activity_id) rides "
            "FROM activity_zones z JOIN activities a ON a.id=z.activity_id "
            "WHERE z.source='heartrate' AND substr(a.start_date_local,1,10)>=? "
            "AND substr(a.start_date_local,1,10)<?",
            (start.isoformat(), end.isoformat())).fetchone()
        out.append((start, row))
    return out


def focus_hints(weeks):
    """Simple week-on-week focus signals from HR zone totals."""
    hints = []
    if not weeks:
        return hints
    cur = weeks[0][1]
    if cur["rides"] < 2:
        return hints  # not enough riding yet this week to read a trend
    total = cur["z1"] + cur["z2"] + cur["z3"] + cur["z4"] + cur["z5"]
    if total > 0:
        easy_share = (cur["z1"] + cur["z2"]) / total
        if cur["z5"] < 4 * 60:
            hints.append("Top-end (Z5) time is under 4 min this week — VO2 work is the gap "
                         "if a quality day is coming up.")
        if easy_share < 0.45:
            hints.append("Less than half of this week's ride time is Z1-Z2 — the mix is "
                         "running hot; protect the easy endurance day.")
    if len(weeks) > 1:
        prev = weeks[1][1]
        if prev["z4"] >= 10 * 60 and cur["z4"] < prev["z4"] * 0.5 and total > 0:
            hints.append("Sweet-spot/threshold (Z4) time dropped by more than half vs last "
                         "week — fine in a recovery week, otherwise give Tuesday's quality "
                         "ride the Z4 work.")
    return hints


# Weekly zone target bands (minutes of HR time-in-zone), added Oct 17, 2026.
# Sessions stay the plan (calendar); these bands are the scorecard that
# judges how the week actually rode. Easy = Z1+Z2 (honest endurance),
# quality = Z4+Z5 (sweet spot / VO2 work), Z3 is watched for tempo drift.
ZONE_BANDS = {
    "normal":   {"easy_min": 60, "quality_min": 12, "quality_max": 30},
    "recovery": {"easy_min": 35, "quality_min": 0,  "quality_max": 30},
}


def week_plan_kinds(conn, start, end):
    rows = conn.execute(
        "SELECT DISTINCT kind FROM planned_sessions WHERE date>=? AND date<?",
        (start.isoformat(), end.isoformat())).fetchall()
    return {r["kind"] for r in rows}


def zone_scorecard(conn, weeks):
    """Compare each planned week's HR zone totals against the target bands."""
    today = datetime.now(LOCAL_TZ).date()
    lines = []
    for start, row in weeks:
        end = start + timedelta(days=7)
        kinds = week_plan_kinds(conn, start, end)
        if not kinds:
            continue  # pre-plan week: actuals only, no scorecard
        recovery = "easy_spin" in kinds
        band = ZONE_BANDS["recovery" if recovery else "normal"]
        current = start <= today < end
        tag = "recovery" if recovery else "normal"
        if current:
            tag += ", in progress"
        if not row["rides"]:
            lines.append(f"  week of {start} ({tag}): no rides" + (" yet" if current else ""))
            continue
        easy = (row["z1"] + row["z2"]) / 60.0
        quality = (row["z4"] + row["z5"]) / 60.0
        z3 = row["z3"] / 60.0
        bits = [f"easy Z1+Z2 {easy:.0f}m (floor {band['easy_min']}) "
                + ("OK" if easy >= band["easy_min"] else "BELOW")]
        if band["quality_min"]:
            q = ("OK" if band["quality_min"] <= quality <= band["quality_max"]
                 else "BELOW" if quality < band["quality_min"] else "HIGH")
            bits.append(f"quality Z4+Z5 {quality:.0f}m "
                        f"(target {band['quality_min']}-{band['quality_max']}) {q}")
        else:
            bits.append(f"quality Z4+Z5 {quality:.0f}m (recovery week, no target)")
        if z3 > easy and z3 >= 20:
            bits.append(f"TEMPO DRIFT: Z3 {z3:.0f}m exceeds easy time")
        lines.append(f"  week of {start} ({tag}): " + "; ".join(bits))
    return lines


def report():
    conn = db()
    for row in conn.execute(
            "SELECT status, COUNT(*) c FROM adherence GROUP BY status"):
        print(f"{row['status']}: {row['c']}")
    for row in conn.execute(
            "SELECT p.kind, SUM(a.status='done') d, SUM(a.status='missed') m "
            "FROM planned_sessions p JOIN adherence a ON a.planned_id=p.id GROUP BY p.kind"):
        print(f"  {row['kind']}: {row['d']} done, {row['m']} missed")
    n = conn.execute("SELECT COUNT(*) c FROM activities").fetchone()["c"]
    print("Activities in DB:", n)

    print("\nRecent rides (category by zones):")
    for r in conn.execute(
            "SELECT a.*, z.z4, z.z5 FROM activities a "
            "LEFT JOIN activity_zones z ON z.activity_id=a.id AND z.source='heartrate' "
            "WHERE a.sport_type IN ('Ride','MountainBikeRide','VirtualRide','EBikeRide','GravelRide') "
            "ORDER BY a.start_date_local DESC LIMIT 8"):
        ztxt = ""
        if r["z4"] is not None:
            ztxt = f" | HR Z4 {_fmt_min(r['z4'])}m, Z5 {_fmt_min(r['z5'])}m"
        print(f"  {r['start_date_local'][:10]} {r['name'][:38]:38} "
              f"{(r['moving_time'] or 0)/60:.0f}m -> {r['category'] or '?'}{ztxt}")

    weeks = weekly_zone_rows(conn)
    print("\nWeekly HR time-in-zone (minutes):")
    for start, row in weeks:
        if not row["rides"]:
            print(f"  week of {start}: no rides")
            continue
        print(f"  week of {start}: Z1 {_fmt_min(row['z1'])} / Z2 {_fmt_min(row['z2'])} / "
              f"Z3 {_fmt_min(row['z3'])} / Z4 {_fmt_min(row['z4'])} / Z5 {_fmt_min(row['z5'])} "
              f"({row['rides']} rides)")
    hints = focus_hints(weeks)
    if hints:
        print("\nFocus hints:")
        for h in hints:
            print(" -", h)
    score = zone_scorecard(conn, weeks)
    if score:
        print("\nZone targets scorecard:")
        for line in score:
            print(line)
    conn.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd == "init":
        init_db()
    elif cmd == "load-planned":
        init_db(); load_planned()
    elif cmd == "sync":
        init_db(); sync_activities(); match()
    elif cmd == "match":
        match()
    elif cmd == "zones":
        init_db()
        conn = db()
        n = ensure_zones(conn)
        conn.commit(); conn.close()
        print(f"Zone backfill complete: {n} rides processed.")
    elif cmd == "recat":
        # Recompute ride categories from stored zones (after threshold tuning).
        init_db()
        conn = db()
        ids = [r["activity_id"] for r in conn.execute(
            "SELECT DISTINCT activity_id FROM activity_zones")]
        for aid in ids:
            rows = {r["source"]: r for r in conn.execute(
                "SELECT * FROM activity_zones WHERE activity_id=?", (aid,))}
            category, cat_source = "unknown", None
            for source in ("power", "heartrate"):
                if source in rows:
                    r = rows[source]
                    z = [r["z1"], r["z2"], r["z3"], r["z4"], r["z5"], r["z6"], r["z7"]]
                    c = categorize(source, z)
                    if c != "unknown":
                        category, cat_source = c, source
                        break
            conn.execute("UPDATE activities SET category=?, category_source=? WHERE id=?",
                         (category, cat_source, aid))
        conn.commit(); conn.close()
        print(f"Recategorized {len(ids)} rides.")
    elif cmd == "report":
        report()
    else:
        print("usage: strava_tracker.py [init|load-planned|sync|match|zones|recat|report]")
        sys.exit(1)
