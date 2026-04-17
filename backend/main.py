"""
FitWise API  —  main.py
========================
Install dependencies before running:
    pip install fastapi uvicorn[standard] python-jose[cryptography] passlib[bcrypt]

Run:
    uvicorn main:app --reload
"""

from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional
import sqlite3
import logging
import re
import os
import secrets

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field, field_validator
from jose import JWTError, jwt
from passlib.context import CryptContext

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="FitWise API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Security config ────────────────────────────────────────────────────────────
# In production: set FITWISE_SECRET_KEY as an environment variable — never commit the default.
SECRET_KEY = os.environ.get("FITWISE_SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 1 week tokens

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

DB_NAME = "workouts.db"

# ── Keyword classifier ─────────────────────────────────────────────────────────
KEYWORD_RULES = [
    ("bench press","Chest"), ("chest press","Chest"), ("chest fly","Chest"),
    ("incline press","Chest"), ("decline press","Chest"), ("pec deck","Chest"),
    ("cable fly","Chest"), ("push up","Chest"), ("pushup","Chest"), ("dip","Chest"),
    ("pull up","Back"), ("pullup","Back"), ("chin up","Back"), ("chinup","Back"),
    ("lat pulldown","Back"), ("pull down","Back"), ("seated row","Back"),
    ("cable row","Back"), ("bent over row","Back"), ("barbell row","Back"),
    ("t-bar row","Back"), ("t bar row","Back"), ("face pull","Back"),
    ("good morning","Back"), ("hyperextension","Back"), ("back extension","Back"),
    ("romanian deadlift","Legs"), ("stiff leg deadlift","Legs"), ("rdl","Legs"),
    ("bulgarian split","Legs"), ("split squat","Legs"), ("hack squat","Legs"),
    ("sumo deadlift","Legs"), ("sumo squat","Legs"), ("leg press","Legs"),
    ("leg curl","Legs"), ("leg extension","Legs"), ("calf raise","Legs"),
    ("hip thrust","Legs"), ("glute bridge","Legs"), ("step up","Legs"),
    ("box jump","Legs"), ("lunge","Legs"), ("squat","Legs"), ("deadlift","Legs"),
    ("overhead press","Shoulders"), ("shoulder press","Shoulders"),
    ("military press","Shoulders"), ("ohp","Shoulders"), ("arnold press","Shoulders"),
    ("lateral raise","Shoulders"), ("front raise","Shoulders"),
    ("upright row","Shoulders"), ("rear delt","Shoulders"),
    ("reverse fly","Shoulders"), ("shrug","Shoulders"),
    ("skull crusher","Arms"), ("preacher curl","Arms"), ("concentration curl","Arms"),
    ("hammer curl","Arms"), ("zottman curl","Arms"), ("spider curl","Arms"),
    ("cable curl","Arms"), ("barbell curl","Arms"), ("ez bar curl","Arms"),
    ("bicep curl","Arms"), ("biceps curl","Arms"), ("close grip bench","Arms"),
    ("overhead extension","Arms"), ("tricep pushdown","Arms"),
    ("tricep extension","Arms"), ("tricep dip","Arms"), ("tricep","Arms"),
    ("triceps","Arms"), ("curl","Arms"),
    ("ab wheel","Core"), ("dragon flag","Core"), ("hanging leg raise","Core"),
    ("leg raise","Core"), ("cable crunch","Core"), ("russian twist","Core"),
    ("pallof press","Core"), ("wood chop","Core"), ("hollow hold","Core"),
    ("l-sit","Core"), ("v-up","Core"), ("sit up","Core"), ("situp","Core"),
    ("crunch","Core"), ("plank","Core"),
    ("jump rope","Cardio"), ("jumping jack","Cardio"), ("mountain climber","Cardio"),
    ("high knee","Cardio"), ("sled push","Cardio"), ("rowing machine","Cardio"),
    ("elliptical","Cardio"), ("treadmill","Cardio"), ("stair climber","Cardio"),
    ("stair","Cardio"), ("cycling","Cardio"), ("stationary bike","Cardio"),
    ("burpee","Cardio"), ("sprint","Cardio"), ("running","Cardio"),
    ("jogging","Cardio"), ("swimming","Cardio"), ("hiit","Cardio"),
    ("walk","Cardio"), ("run","Cardio"), ("bike","Cardio"),
    ("swim","Cardio"), ("jog","Cardio"),
]

ALL_GROUPS = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Cardio"]
PUSH_GROUPS = {"Chest", "Shoulders"}
PULL_GROUPS = {"Back", "Arms"}
LEG_GROUPS  = {"Legs"}


def classify_exercise(name: str) -> str:
    lowered = re.sub(r"[-_/]", " ", name.lower().strip())
    for keyword, group in KEYWORD_RULES:
        if keyword in lowered:
            return group
    return "Other"


# ── Pydantic models ────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=100)

    @field_validator("username")
    @classmethod
    def username_clean(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_\-]+$", v):
            raise ValueError("Username may only contain letters, numbers, underscores, and hyphens")
        return v.lower().strip()


class Token(BaseModel):
    access_token: str
    token_type: str
    display_name: str
    username: str


class Workout(BaseModel):
    exercise: str = Field(..., min_length=1, max_length=200)
    sets: int = Field(..., gt=0, le=100)
    reps: int = Field(..., gt=0, le=1000)
    weight: float = Field(default=0.0, ge=0.0, le=2000.0)
    notes: Optional[str] = Field(default="", max_length=500)

    @field_validator("exercise")
    @classmethod
    def no_html(cls, v: str) -> str:
        if re.search(r"[<>\"']", v):
            raise ValueError("Exercise name contains invalid characters")
        return v.strip()

    @field_validator("notes")
    @classmethod
    def sanitize_notes(cls, v: Optional[str]) -> str:
        if not v:
            return ""
        return re.sub(r"<[^>]*>", "", v).strip()


# ── Database ───────────────────────────────────────────────────────────────────

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _add_col(conn, table: str, col: str, defn: str):
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {defn}")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                username     TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                hashed_pw    TEXT NOT NULL,
                created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workouts (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL DEFAULT 0,
                exercise     TEXT NOT NULL,
                sets         INTEGER NOT NULL,
                reps         INTEGER NOT NULL,
                weight       REAL NOT NULL DEFAULT 0,
                notes        TEXT DEFAULT '',
                muscle_group TEXT DEFAULT 'Other',
                created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        # Safe migration: add columns that may be missing from older DBs
        _add_col(conn, "workouts", "user_id",      "INTEGER NOT NULL DEFAULT 0")
        _add_col(conn, "workouts", "notes",        "TEXT DEFAULT ''")
        _add_col(conn, "workouts", "weight",       "REAL NOT NULL DEFAULT 0")
        _add_col(conn, "workouts", "muscle_group", "TEXT DEFAULT 'Other'")


init_db()


# ── Auth helpers ───────────────────────────────────────────────────────────────

def hash_password(pw: str) -> str:
    return pwd_context.hash(pw)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_user_by_username(username: str) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, display_name, hashed_pw FROM users WHERE username = ?",
            (username.lower(),)
        ).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: int) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, display_name FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return dict(row) if row else None


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        raise exc
    user = get_user_by_id(user_id)
    if not user:
        raise exc
    return user


# ── Recommendation engine ──────────────────────────────────────────────────────

def build_recommendations(workouts: list) -> list:
    """
    Analyse a user's complete workout history and return up to 8 ranked recommendations.
    Each recommendation:  { priority, type, title, message, group }
    Lower priority = more urgent / shown first.
    """
    if not workouts:
        return [{
            "priority": 1, "type": "welcome", "group": None,
            "title": "Welcome to FitWise",
            "message": "Start logging workouts to unlock personalised training recommendations.",
        }]

    now = datetime.now(timezone.utc)

    def parse_dt(iso):
        s = iso if (iso.endswith("Z") or "+" in iso) else iso + "Z"
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    # Time windows
    cutoff_7  = now - timedelta(days=7)
    cutoff_14 = now - timedelta(days=14)
    cutoff_30 = now - timedelta(days=30)

    recent_7  = [w for w in workouts if parse_dt(w["created_at"]) >= cutoff_7]
    recent_14 = [w for w in workouts if parse_dt(w["created_at"]) >= cutoff_14]
    recent_30 = [w for w in workouts if parse_dt(w["created_at"]) >= cutoff_30]

    def group_counts(ws):
        c = {}
        for w in ws:
            g = w.get("muscle_group") or "Other"
            c[g] = c.get(g, 0) + 1
        return c

    all_counts    = group_counts(workouts)
    recent_counts = group_counts(recent_7)

    trained_recently = set(recent_counts.keys()) - {"Other", "Cardio"}
    ever_trained     = set(all_counts.keys()) - {"Other", "Cardio"}
    neglected_7d     = ever_trained - trained_recently
    never_trained    = set(ALL_GROUPS) - set(all_counts.keys()) - {"Cardio"}

    # Volume per group (last 14 days) for push/pull/leg analysis
    def vol(w):
        return w["sets"] * w["reps"] * w["weight"] if w["weight"] > 0 else w["sets"] * w["reps"]

    group_vol_14 = {}
    for w in recent_14:
        g = w.get("muscle_group") or "Other"
        group_vol_14[g] = group_vol_14.get(g, 0) + vol(w)

    push_vol = sum(group_vol_14.get(g, 0) for g in PUSH_GROUPS)
    pull_vol = sum(group_vol_14.get(g, 0) for g in PULL_GROUPS)
    leg_vol  = sum(group_vol_14.get(g, 0) for g in LEG_GROUPS)
    combined = push_vol + pull_vol + leg_vol or 1
    push_pct = push_vol / combined * 100
    pull_pct = pull_vol / combined * 100
    leg_pct  = leg_vol  / combined * 100

    # Progression stall: compare avg weight of last 3 vs previous 3 sessions per exercise
    exercise_map = {}
    for w in workouts:
        if w["weight"] <= 0:
            continue
        key = w["exercise"].lower().strip()
        if key not in exercise_map:
            exercise_map[key] = {"name": w["exercise"], "group": w.get("muscle_group", "Other"), "logs": []}
        exercise_map[key]["logs"].append({"weight": w["weight"], "dt": parse_dt(w["created_at"])})

    stalled = []
    for ex in exercise_map.values():
        logs = sorted(ex["logs"], key=lambda x: x["dt"])
        if len(logs) < 6:
            continue
        recent_avg   = sum(l["weight"] for l in logs[-3:]) / 3
        previous_avg = sum(l["weight"] for l in logs[-6:-3]) / 3
        if previous_avg > 0:
            chg = (recent_avg - previous_avg) / previous_avg * 100
            if -2 < chg < 2:
                stalled.append({"name": ex["name"], "group": ex["group"], "change_pct": round(chg, 1)})

    active_days_7  = len(set(w["created_at"][:10] for w in recent_7))
    active_days_30 = len(set(w["created_at"][:10] for w in recent_30))
    core_count_30  = sum(1 for w in recent_30 if (w.get("muscle_group") or "") == "Core")

    recs = []

    # R1 — No workouts this week
    if active_days_7 == 0 and workouts:
        recs.append({
            "priority": 1, "type": "frequency", "group": None,
            "title": "No workouts this week",
            "message": "You haven't logged anything in the past 7 days. Even a short session will help maintain your momentum.",
        })

    # R2 — Overtraining a single group
    for group, count in recent_counts.items():
        if group in ("Other", "Cardio"):
            continue
        if count >= 3:
            recs.append({
                "priority": 1, "type": "recovery", "group": group,
                "title": f"High {group} frequency",
                "message": f"You've hit {group} {count} times this week. Give it at least 48 hours before training it again — recovery is where growth happens.",
            })

    # R3 — Neglected group (trained before, not in last 7 days)
    for group in sorted(neglected_7d):
        last_w = max(
            (w for w in workouts if (w.get("muscle_group") or "Other") == group),
            key=lambda w: parse_dt(w["created_at"]), default=None
        )
        days_since = (now - parse_dt(last_w["created_at"])).days if last_w else 99
        if days_since >= 7:
            recs.append({
                "priority": 2, "type": "neglected", "group": group,
                "title": f"{group} needs attention",
                "message": f"You haven't trained {group} in {days_since} day{'s' if days_since != 1 else ''}. Schedule a {group} session this week to maintain balanced development.",
            })

    # R4 — Push/pull imbalance
    if push_pct > 0 and pull_pct > 0:
        if push_pct > pull_pct * 1.6:
            recs.append({
                "priority": 2, "type": "imbalance", "group": "Back",
                "title": "Push > Pull imbalance",
                "message": f"Your pushing volume ({round(push_pct)}%) significantly outweighs pulling ({round(pull_pct)}%) over the last 2 weeks. Add rows or pull-ups to protect your shoulder health.",
            })
        elif pull_pct > push_pct * 1.6:
            recs.append({
                "priority": 2, "type": "imbalance", "group": "Chest",
                "title": "Pull > Push imbalance",
                "message": f"Your pulling volume ({round(pull_pct)}%) significantly outweighs pushing ({round(push_pct)}%) over the last 2 weeks. Consider adding more pressing movements.",
            })

    # R5 — Low leg volume
    if leg_pct < 15 and (push_pct + pull_pct) > 0:
        recs.append({
            "priority": 2, "type": "imbalance", "group": "Legs",
            "title": "Lower body volume is low",
            "message": f"Leg training represents only {round(leg_pct)}% of your recent volume. A dedicated leg session — squats, deadlifts, or lunges — is recommended for a balanced programme.",
        })

    # R6 — Core neglect
    if len(recent_30) >= 4 and core_count_30 < 2:
        recs.append({
            "priority": 3, "type": "neglected", "group": "Core",
            "title": "Core work is limited",
            "message": f"Only {core_count_30} core session{'s' if core_count_30 != 1 else ''} in the last 30 days. Core stability underpins every compound lift — add planks, ab wheel, or cable crunches to your next session.",
        })

    # R7 — Progression stalls
    for stall in stalled[:2]:
        recs.append({
            "priority": 3, "type": "stall", "group": stall["group"],
            "title": f"{stall['name']} has plateaued",
            "message": f"Your {stall['name']} weight has barely changed over your last 6 sessions ({stall['change_pct']:+.1f}%). Try a deload week, shift rep ranges (e.g. 3×5 → 4×8), or add a technique variation to break through.",
        })

    # R8 — Low training frequency
    if active_days_7 > 0 and active_days_30 < 4 and len(workouts) >= 3:
        recs.append({
            "priority": 3, "type": "frequency", "group": None,
            "title": "Training frequency is low",
            "message": f"You've only trained on {active_days_30} day{'s' if active_days_30 != 1 else ''} in the last 30 days. Aim for 3–4 sessions per week to see consistent progress.",
        })

    # R9 — Never-trained groups (only after 5+ total sessions)
    if len(workouts) >= 5:
        for group in sorted(never_trained):
            recs.append({
                "priority": 4, "type": "new_group", "group": group,
                "title": f"Never trained {group}",
                "message": f"You haven't logged any {group} exercises yet. A balanced programme should include {group} work — consider adding it to your rotation.",
            })

    # R10 — Positive: strong consistency
    if active_days_7 >= 4:
        recs.append({
            "priority": 5, "type": "positive", "group": None,
            "title": "Excellent consistency",
            "message": f"You've trained {active_days_7} days this week — great work. Just make sure you're scheduling at least one full rest day to let your muscles repair and grow.",
        })

    recs.sort(key=lambda r: r["priority"])
    return recs[:8]


# ── Routes: Root ───────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    return {"message": "FitWise API is running"}


# ── Routes: Auth ───────────────────────────────────────────────────────────────

@app.post("/auth/register", status_code=201)
def register(user: UserRegister):
    if get_user_by_username(user.username):
        raise HTTPException(status_code=409, detail="Username already taken")
    display = (user.display_name or "").strip() or user.username
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, display_name, hashed_pw) VALUES (?, ?, ?)",
                (user.username, display, hash_password(user.password)),
            )
        logger.info("Registered: %s", user.username)
        return {"message": "Account created. You can now log in."}
    except Exception:
        logger.exception("Registration failed")
        raise HTTPException(status_code=500, detail="Could not create account")


@app.post("/auth/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    db_user = get_user_by_username(form_data.username)
    if not db_user or not verify_password(form_data.password, db_user["hashed_pw"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(
        data={"sub": str(db_user["id"])},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    logger.info("Login: %s", db_user["username"])
    return Token(access_token=token, token_type="bearer",
                 display_name=db_user["display_name"], username=db_user["username"])


@app.get("/auth/me")
def me(current_user: dict = Depends(get_current_user)):
    return {
        "id": current_user["id"],
        "username": current_user["username"],
        "display_name": current_user["display_name"],
    }


# ── Routes: Classify ───────────────────────────────────────────────────────────

@app.get("/classify")
def classify_endpoint(exercise: str):
    return {"group": classify_exercise(exercise)}


# ── Routes: Workouts ───────────────────────────────────────────────────────────

@app.get("/workouts")
def get_workouts(current_user: dict = Depends(get_current_user)):
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT id, exercise, sets, reps, weight, notes, muscle_group, created_at "
                "FROM workouts WHERE user_id = ? ORDER BY created_at DESC",
                (current_user["id"],)
            ).fetchall()
        return [dict(row) for row in rows]
    except Exception:
        logger.exception("Failed to fetch workouts for user %s", current_user["id"])
        raise HTTPException(status_code=500, detail="Failed to fetch workouts")


@app.post("/workouts", status_code=201)
def create_workout(workout: Workout, current_user: dict = Depends(get_current_user)):
    try:
        now = datetime.now(timezone.utc).isoformat()
        group = classify_exercise(workout.exercise)
        with get_db() as conn:
            cursor = conn.execute(
                "INSERT INTO workouts (user_id, exercise, sets, reps, weight, notes, muscle_group, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (current_user["id"], workout.exercise, workout.sets, workout.reps,
                 workout.weight, workout.notes, group, now),
            )
            wid = cursor.lastrowid
        logger.info("Created workout id=%s user=%s", wid, current_user["username"])
        return {"message": "Workout created", "id": wid, "muscle_group": group}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to create workout")
        raise HTTPException(status_code=500, detail="Failed to create workout")


@app.put("/workouts/{workout_id}")
def update_workout(workout_id: int, workout: Workout, current_user: dict = Depends(get_current_user)):
    try:
        group = classify_exercise(workout.exercise)
        with get_db() as conn:
            cursor = conn.execute(
                "UPDATE workouts SET exercise=?, sets=?, reps=?, weight=?, notes=?, muscle_group=? "
                "WHERE id=? AND user_id=?",
                (workout.exercise, workout.sets, workout.reps,
                 workout.weight, workout.notes, group, workout_id, current_user["id"]),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Workout not found")
        return {"message": "Workout updated", "muscle_group": group}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to update workout id=%s", workout_id)
        raise HTTPException(status_code=500, detail="Failed to update workout")


@app.delete("/workouts/{workout_id}")
def delete_workout(workout_id: int, current_user: dict = Depends(get_current_user)):
    try:
        with get_db() as conn:
            cursor = conn.execute(
                "DELETE FROM workouts WHERE id=? AND user_id=?",
                (workout_id, current_user["id"])
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Workout not found")
        return {"message": "Workout deleted"}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to delete workout id=%s", workout_id)
        raise HTTPException(status_code=500, detail="Failed to delete workout")


# ── Routes: Recommendations ────────────────────────────────────────────────────

@app.get("/recommendations")
def get_recommendations(current_user: dict = Depends(get_current_user)):
    """
    Returns personalised training recommendations for the current user based on:
    - Muscle group frequency & neglect (7-day and 30-day windows)
    - Push / pull / leg volume balance (14-day window)
    - Progression stall detection (last 6 sessions per exercise)
    - Consistency / training frequency
    - Core neglect
    - Groups never trained
    """
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT exercise, sets, reps, weight, muscle_group, created_at "
                "FROM workouts WHERE user_id = ? ORDER BY created_at ASC",
                (current_user["id"],)
            ).fetchall()
        recs = build_recommendations([dict(r) for r in rows])
        return {"recommendations": recs}
    except Exception:
        logger.exception("Failed to build recommendations for user %s", current_user["id"])
        raise HTTPException(status_code=500, detail="Failed to generate recommendations")
