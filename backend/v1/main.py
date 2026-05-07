"""
FitWise API  —  main.py
========================
Install dependencies:
    pip install fastapi uvicorn[standard] python-jose[cryptography] python-multipart
    python -m pip install "bcrypt<5" passlib[bcrypt] --upgrade

    Notes:
    - python-multipart is required for OAuth2PasswordRequestForm (form login). Without it, /auth/login returns 422.
    - passlib is not compatible with bcrypt 5+. The second command pins bcrypt to a working version.
      If login returns a 500 or you see a bcrypt-related error in the terminal, run that line again.

Run:
    uvicorn main:app --reload

Then open http://127.0.0.1:8000/docs to test everything in Swagger UI.
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


# =============================================================================
# SETUP
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="FitWise API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secret key for signing JWTs.
# ⚠️  Without a fixed key, tokens break on every server restart (new random key = old tokens invalid).
# Fix: run this once in your terminal, then restart uvicorn:
#
#     export FITWISE_SECRET_KEY="pick-any-long-string-and-keep-it"
#
# In production: always use a proper environment variable, never the default.
SECRET_KEY = os.environ.get("FITWISE_SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7   # tokens last 1 week

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

DB_NAME = "workouts.db"


# =============================================================================
# EXERCISE CLASSIFIER
# More specific terms come first (e.g. "romanian deadlift" before "deadlift")
# =============================================================================

KEYWORD_RULES = [
    # Chest
    ("bench press", "Chest"), ("chest press", "Chest"), ("chest fly", "Chest"),
    ("incline press", "Chest"), ("decline press", "Chest"), ("pec deck", "Chest"),
    ("cable fly", "Chest"), ("push up", "Chest"), ("pushup", "Chest"), ("dip", "Chest"),
    # Back
    ("pull up", "Back"), ("pullup", "Back"), ("chin up", "Back"), ("chinup", "Back"),
    ("lat pulldown", "Back"), ("pull down", "Back"), ("seated row", "Back"),
    ("cable row", "Back"), ("bent over row", "Back"), ("barbell row", "Back"),
    ("t-bar row", "Back"), ("t bar row", "Back"), ("face pull", "Back"),
    ("good morning", "Back"), ("hyperextension", "Back"), ("back extension", "Back"),
    # Legs
    ("romanian deadlift", "Legs"), ("stiff leg deadlift", "Legs"), ("rdl", "Legs"),
    ("bulgarian split", "Legs"), ("split squat", "Legs"), ("hack squat", "Legs"),
    ("sumo deadlift", "Legs"), ("sumo squat", "Legs"), ("leg press", "Legs"),
    ("leg curl", "Legs"), ("leg extension", "Legs"), ("calf raise", "Legs"),
    ("hip thrust", "Legs"), ("glute bridge", "Legs"), ("step up", "Legs"),
    ("box jump", "Legs"), ("lunge", "Legs"), ("squat", "Legs"), ("deadlift", "Legs"),
    # Shoulders
    ("overhead press", "Shoulders"), ("shoulder press", "Shoulders"),
    ("military press", "Shoulders"), ("ohp", "Shoulders"), ("arnold press", "Shoulders"),
    ("lateral raise", "Shoulders"), ("front raise", "Shoulders"),
    ("upright row", "Shoulders"), ("rear delt", "Shoulders"),
    ("reverse fly", "Shoulders"), ("shrug", "Shoulders"),
    # Arms
    ("skull crusher", "Arms"), ("preacher curl", "Arms"), ("concentration curl", "Arms"),
    ("hammer curl", "Arms"), ("zottman curl", "Arms"), ("spider curl", "Arms"),
    ("cable curl", "Arms"), ("barbell curl", "Arms"), ("ez bar curl", "Arms"),
    ("bicep curl", "Arms"), ("biceps curl", "Arms"), ("close grip bench", "Arms"),
    ("overhead extension", "Arms"), ("tricep pushdown", "Arms"),
    ("tricep extension", "Arms"), ("tricep dip", "Arms"),
    ("tricep", "Arms"), ("triceps", "Arms"), ("curl", "Arms"),
    # Core
    ("ab wheel", "Core"), ("dragon flag", "Core"), ("hanging leg raise", "Core"),
    ("leg raise", "Core"), ("cable crunch", "Core"), ("russian twist", "Core"),
    ("pallof press", "Core"), ("wood chop", "Core"), ("hollow hold", "Core"),
    ("l-sit", "Core"), ("v-up", "Core"), ("sit up", "Core"), ("situp", "Core"),
    ("crunch", "Core"), ("plank", "Core"),
    # Cardio
    ("jump rope", "Cardio"), ("jumping jack", "Cardio"), ("mountain climber", "Cardio"),
    ("high knee", "Cardio"), ("sled push", "Cardio"), ("rowing machine", "Cardio"),
    ("elliptical", "Cardio"), ("treadmill", "Cardio"), ("stair climber", "Cardio"),
    ("stair", "Cardio"), ("cycling", "Cardio"), ("stationary bike", "Cardio"),
    ("burpee", "Cardio"), ("sprint", "Cardio"), ("running", "Cardio"),
    ("jogging", "Cardio"), ("swimming", "Cardio"), ("hiit", "Cardio"),
    ("walk", "Cardio"), ("run", "Cardio"), ("bike", "Cardio"),
    ("swim", "Cardio"), ("jog", "Cardio"),
]


def classify_exercise(name: str) -> str:
    lowered = re.sub(r"[-_/]", " ", name.lower().strip())
    for keyword, group in KEYWORD_RULES:
        if keyword in lowered:
            return group
    return "Other"


# =============================================================================
# MODELS
# =============================================================================

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=100)

    @field_validator("username")
    @classmethod
    def clean_username(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_\-]+$", v):
            raise ValueError("Username may only contain letters, numbers, _ and -")
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


# =============================================================================
# DATABASE
# =============================================================================

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


def _add_col_if_missing(conn, table: str, col: str, definition: str):
    """Safely add a column — does nothing if it already exists."""
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise


def init_db():
    with get_db() as conn:
        # Users table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                username     TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                hashed_pw    TEXT NOT NULL,
                created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Workouts table — owned by a user via user_id
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
        # Safe migration for older databases that may be missing columns
        _add_col_if_missing(conn, "workouts", "user_id",      "INTEGER NOT NULL DEFAULT 0")
        _add_col_if_missing(conn, "workouts", "notes",        "TEXT DEFAULT ''")
        _add_col_if_missing(conn, "workouts", "weight",       "REAL NOT NULL DEFAULT 0")
        _add_col_if_missing(conn, "workouts", "muscle_group", "TEXT DEFAULT 'Other'")


init_db()


# =============================================================================
# AUTH HELPERS
# =============================================================================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


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
            "SELECT id, username, display_name FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
    return dict(row) if row else None


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Dependency — validates the JWT and returns the logged-in user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token. Please log in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        raise credentials_exception

    user = get_user_by_id(user_id)
    if not user:
        raise credentials_exception
    return user


# =============================================================================
# ROUTES — General
# =============================================================================

@app.get("/")
def read_root():
    return {"message": "FitWise API is running"}


@app.get("/classify")
def classify_endpoint(exercise: str):
    """Quick endpoint to classify an exercise name into a muscle group."""
    return {"group": classify_exercise(exercise)}


# =============================================================================
# ROUTES — Auth
# =============================================================================

@app.post("/auth/register", status_code=201)
def register(user: UserRegister):
    """
    Create a new account.
    Send JSON: { "username": "...", "password": "...", "display_name": "..." }
    """
    if get_user_by_username(user.username):
        raise HTTPException(status_code=409, detail="Username already taken")

    display = (user.display_name or "").strip() or user.username
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, display_name, hashed_pw) VALUES (?, ?, ?)",
                (user.username, display, hash_password(user.password)),
            )
        logger.info("Registered user: %s", user.username)
        return {"message": "Account created. You can now log in."}
    except Exception:
        logger.exception("Registration failed")
        raise HTTPException(status_code=500, detail="Could not create account")


@app.post("/auth/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Log in and receive a JWT token.
    MUST send application/x-www-form-urlencoded with fields: username, password
    (This is the standard OAuth2 format — Swagger UI handles it automatically.)
    """
    user = get_user_by_username(form_data.username)
    if not user or not verify_password(form_data.password, user["hashed_pw"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(user["id"])
    logger.info("Login: %s", user["username"])
    return Token(
        access_token=token,
        token_type="bearer",
        display_name=user["display_name"],
        username=user["username"],
    )


@app.get("/auth/me")
def me(current_user: dict = Depends(get_current_user)):
    """Returns the currently logged-in user's info."""
    return {
        "id": current_user["id"],
        "username": current_user["username"],
        "display_name": current_user["display_name"],
    }


# =============================================================================
# ROUTES — Workouts
# All routes are protected — users only see their own data.
# =============================================================================

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




@app.get("/recommendation")
def get_recommendation(current_user: dict = Depends(get_current_user)):
    """
    Lightweight recommendation endpoint.
    This is a rule based AI style feature, not a full machine learning model.
    It reviews the user's logged workouts, finds the least trained muscle group,
    and recommends a balanced next workout focus.
    """
    all_groups = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Cardio"]
    exercise_map = {
        "Chest": ["Bench Press", "Incline Press", "Pec Deck Fly"],
        "Back": ["Lat Pulldown", "Seated Row", "Cable Row"],
        "Legs": ["Squat", "Leg Press", "Romanian Deadlift"],
        "Shoulders": ["Shoulder Press", "Lateral Raise", "Rear Delt Fly"],
        "Arms": ["Bicep Curl", "Tricep Pushdown", "Hammer Curl"],
        "Core": ["Plank", "Cable Crunch", "Leg Raise"],
        "Cardio": ["Treadmill", "Bike", "Jump Rope"],
    }

    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT muscle_group FROM workouts WHERE user_id = ?",
                (current_user["id"],)
            ).fetchall()

        if not rows:
            return {
                "focus": "Start Training",
                "reason": "No workout data has been logged yet. FitWise recommends starting with a balanced full body workout.",
                "exercises": ["Bench Press", "Squat", "Lat Pulldown"],
                "confidence": "Low",
            }

        counts = {group: 0 for group in all_groups}
        for row in rows:
            group = row["muscle_group"] or "Other"
            if group in counts:
                counts[group] += 1

        least_trained = min(all_groups, key=lambda g: counts[g])
        most_trained = max(all_groups, key=lambda g: counts[g])

        return {
            "focus": least_trained,
            "reason": f"{least_trained} has been trained less than your other muscle groups. Your most trained area is {most_trained}, so FitWise recommends balancing your next session toward {least_trained}.",
            "exercises": exercise_map.get(least_trained, ["Full Body Workout"]),
            "confidence": "Medium" if len(rows) >= 5 else "Low",
            "group_counts": counts,
        }
    except Exception:
        logger.exception("Failed to generate recommendation for user %s", current_user["id"])
        raise HTTPException(status_code=500, detail="Failed to generate recommendation")


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
        logger.info("Created workout id=%s for user=%s", cursor.lastrowid, current_user["username"])
        return {"message": "Workout created", "id": cursor.lastrowid, "muscle_group": group}
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
        logger.exception("Failed to update workout %s", workout_id)
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
        logger.exception("Failed to delete workout %s", workout_id)
        raise HTTPException(status_code=500, detail="Failed to delete workout")
