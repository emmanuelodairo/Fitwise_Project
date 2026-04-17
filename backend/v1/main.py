from contextlib import contextmanager
from datetime import datetime, timezone
import sqlite3
import logging
import re
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
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

DB_NAME = "workouts.db"


# =========================
# KEYWORD CLASSIFIER
# Ordered list — more specific terms come before generic ones.
# e.g. "romanian deadlift" must appear before plain "deadlift"
# =========================
KEYWORD_RULES = [
    # Chest
    ("bench press",        "Chest"),
    ("chest press",        "Chest"),
    ("chest fly",          "Chest"),
    ("incline press",      "Chest"),
    ("decline press",      "Chest"),
    ("pec deck",           "Chest"),
    ("cable fly",          "Chest"),
    ("push up",            "Chest"),
    ("pushup",             "Chest"),
    ("dip",                "Chest"),

    # Back
    ("pull up",            "Back"),
    ("pullup",             "Back"),
    ("chin up",            "Back"),
    ("chinup",             "Back"),
    ("lat pulldown",       "Back"),
    ("pull down",          "Back"),
    ("seated row",         "Back"),
    ("cable row",          "Back"),
    ("bent over row",      "Back"),
    ("barbell row",        "Back"),
    ("t-bar row",          "Back"),
    ("t bar row",          "Back"),
    ("face pull",          "Back"),
    ("good morning",       "Back"),
    ("hyperextension",     "Back"),
    ("back extension",     "Back"),

    # Legs — specifics first
    ("romanian deadlift",  "Legs"),
    ("stiff leg deadlift", "Legs"),
    ("rdl",                "Legs"),
    ("bulgarian split",    "Legs"),
    ("split squat",        "Legs"),
    ("hack squat",         "Legs"),
    ("sumo deadlift",      "Legs"),
    ("sumo squat",         "Legs"),
    ("leg press",          "Legs"),
    ("leg curl",           "Legs"),
    ("leg extension",      "Legs"),
    ("calf raise",         "Legs"),
    ("hip thrust",         "Legs"),
    ("glute bridge",       "Legs"),
    ("step up",            "Legs"),
    ("box jump",           "Legs"),
    ("lunge",              "Legs"),
    ("squat",              "Legs"),
    ("deadlift",           "Legs"),  # plain deadlift after all variants

    # Shoulders
    ("overhead press",     "Shoulders"),
    ("shoulder press",     "Shoulders"),
    ("military press",     "Shoulders"),
    ("ohp",                "Shoulders"),
    ("arnold press",       "Shoulders"),
    ("lateral raise",      "Shoulders"),
    ("front raise",        "Shoulders"),
    ("upright row",        "Shoulders"),
    ("rear delt",          "Shoulders"),
    ("reverse fly",        "Shoulders"),
    ("shrug",              "Shoulders"),

    # Arms — specifics first
    ("skull crusher",      "Arms"),
    ("preacher curl",      "Arms"),
    ("concentration curl", "Arms"),
    ("hammer curl",        "Arms"),
    ("zottman curl",       "Arms"),
    ("spider curl",        "Arms"),
    ("cable curl",         "Arms"),
    ("barbell curl",       "Arms"),
    ("ez bar curl",        "Arms"),
    ("bicep curl",         "Arms"),
    ("biceps curl",        "Arms"),
    ("close grip bench",   "Arms"),
    ("overhead extension", "Arms"),
    ("tricep pushdown",    "Arms"),
    ("tricep extension",   "Arms"),
    ("tricep dip",         "Arms"),
    ("tricep",             "Arms"),
    ("triceps",            "Arms"),
    ("curl",               "Arms"),   # catch-all curl after specifics

    # Core
    ("ab wheel",           "Core"),
    ("dragon flag",        "Core"),
    ("hanging leg raise",  "Core"),
    ("leg raise",          "Core"),
    ("cable crunch",       "Core"),
    ("russian twist",      "Core"),
    ("pallof press",       "Core"),
    ("wood chop",          "Core"),
    ("hollow hold",        "Core"),
    ("l-sit",              "Core"),
    ("v-up",               "Core"),
    ("sit up",             "Core"),
    ("situp",              "Core"),
    ("crunch",             "Core"),
    ("plank",              "Core"),

    # Cardio
    ("jump rope",          "Cardio"),
    ("jumping jack",       "Cardio"),
    ("mountain climber",   "Cardio"),
    ("high knee",          "Cardio"),
    ("sled push",          "Cardio"),
    ("rowing machine",     "Cardio"),
    ("elliptical",         "Cardio"),
    ("treadmill",          "Cardio"),
    ("stair climber",      "Cardio"),
    ("stair",              "Cardio"),
    ("cycling",            "Cardio"),
    ("stationary bike",    "Cardio"),
    ("burpee",             "Cardio"),
    ("sprint",             "Cardio"),
    ("running",            "Cardio"),
    ("jogging",            "Cardio"),
    ("swimming",           "Cardio"),
    ("hiit",               "Cardio"),
    ("walk",               "Cardio"),
    ("run",                "Cardio"),
    ("bike",               "Cardio"),
    ("swim",               "Cardio"),
    ("jog",                "Cardio"),
]


def classify_exercise(name: str) -> str:
    """Return muscle group for any exercise name using ordered keyword rules."""
    lowered = re.sub(r"[-_/]", " ", name.lower().strip())
    for keyword, group in KEYWORD_RULES:
        if keyword in lowered:
            return group
    return "Other"


# =========================
# MODELS
# =========================
class Workout(BaseModel):
    user: str = Field(..., min_length=1, max_length=100)
    exercise: str = Field(..., min_length=1, max_length=200)
    sets: int = Field(..., gt=0, le=100)
    reps: int = Field(..., gt=0, le=1000)
    weight: float = Field(default=0.0, ge=0.0, le=2000.0)
    notes: Optional[str] = Field(default="", max_length=500)
    muscle_group: Optional[str] = Field(default=None, max_length=50)

    @field_validator("user")
    @classmethod
    def no_html_in_user(cls, v: str) -> str:
        if re.search(r"[<>\"']", v):
            raise ValueError("Name contains invalid characters")
        return v.strip()

    @field_validator("exercise")
    @classmethod
    def no_html_in_exercise(cls, v: str) -> str:
        if re.search(r"[<>\"']", v):
            raise ValueError("Exercise name contains invalid characters")
        return v.strip()

    @field_validator("notes")
    @classmethod
    def sanitize_notes(cls, v: Optional[str]) -> str:
        if not v:
            return ""
        # Strip HTML-like tags from notes
        return re.sub(r"<[^>]*>", "", v).strip()


# =========================
# DATABASE
# =========================
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


def _add_column_if_missing(conn, column: str, definition: str):
    try:
        conn.execute(f"ALTER TABLE workouts ADD COLUMN {column} {definition}")
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e).lower():
            raise


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workouts (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user         TEXT NOT NULL,
                exercise     TEXT NOT NULL,
                sets         INTEGER NOT NULL,
                reps         INTEGER NOT NULL,
                weight       REAL NOT NULL DEFAULT 0,
                notes        TEXT DEFAULT '',
                muscle_group TEXT DEFAULT 'Other',
                created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        _add_column_if_missing(conn, "notes",        "TEXT DEFAULT ''")
        _add_column_if_missing(conn, "weight",       "REAL NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "muscle_group", "TEXT DEFAULT 'Other'")


init_db()


# =========================
# ROOT
# =========================
@app.get("/")
def read_root():
    return {"message": "FitWise API is running"}


# =========================
# CLASSIFY (instant, no external call needed)
# =========================
@app.get("/classify")
def classify_endpoint(exercise: str):
    return {"group": classify_exercise(exercise)}


# =========================
# GET ALL WORKOUTS
# =========================
@app.get("/workouts")
def get_workouts():
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT id, user, exercise, sets, reps, weight, notes, muscle_group, created_at "
                "FROM workouts ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        logger.exception("Failed to fetch workouts")
        raise HTTPException(status_code=500, detail="Failed to fetch workouts")


# =========================
# CREATE WORKOUT
# =========================
@app.post("/workouts", status_code=201)
def create_workout(workout: Workout):
    try:
        now = datetime.now(timezone.utc).isoformat()
        group = classify_exercise(workout.exercise)
        with get_db() as conn:
            cursor = conn.execute(
                "INSERT INTO workouts (user, exercise, sets, reps, weight, notes, muscle_group, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (workout.user, workout.exercise, workout.sets, workout.reps,
                 workout.weight, workout.notes, group, now),
            )
            workout_id = cursor.lastrowid
        logger.info("Created workout id=%s exercise=%s", workout_id, workout.exercise)
        return {"message": "Workout created", "id": workout_id, "muscle_group": group}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create workout")
        raise HTTPException(status_code=500, detail="Failed to create workout")


# =========================
# UPDATE WORKOUT
# =========================
@app.put("/workouts/{workout_id}")
def update_workout(workout_id: int, workout: Workout):
    try:
        group = classify_exercise(workout.exercise)
        with get_db() as conn:
            cursor = conn.execute(
                "UPDATE workouts SET user=?, exercise=?, sets=?, reps=?, weight=?, notes=?, muscle_group=? "
                "WHERE id=?",
                (workout.user, workout.exercise, workout.sets, workout.reps,
                 workout.weight, workout.notes, group, workout_id),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Workout not found")
        logger.info("Updated workout id=%s", workout_id)
        return {"message": "Workout updated", "muscle_group": group}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to update workout id=%s", workout_id)
        raise HTTPException(status_code=500, detail="Failed to update workout")


# =========================
# DELETE WORKOUT
# =========================
@app.delete("/workouts/{workout_id}")
def delete_workout(workout_id: int):
    try:
        with get_db() as conn:
            cursor = conn.execute("DELETE FROM workouts WHERE id=?", (workout_id,))
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Workout not found")
        logger.info("Deleted workout id=%s", workout_id)
        return {"message": "Workout deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete workout id=%s", workout_id)
        raise HTTPException(status_code=500, detail="Failed to delete workout")
