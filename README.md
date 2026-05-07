# FitWise — Workout Tracking & Training Insights System

> Full-stack workout tracking and training insights application built with React, FastAPI, and SQLite, featuring JWT authentication, dashboard analytics, progression charts, and personalized workout recommendations.

**CS499 Senior Seminar · Southern Illinois University Carbondale · May 2026**

---

## 🔗 Live Links

| | URL |
|---|---|
| **Live App** | https://fitwise-project.vercel.app |
| **Backend API Docs** | https://fitwise-project.onrender.com/docs |
| **GitHub Repo** | https://github.com/emmanuelodairo/Fitwise_Project |

---

## 📖 Overview

FitWise transforms raw workout data into meaningful insights. Unlike basic tracking apps that only store data, FitWise analyzes workout history to surface progression trends, identify undertrained muscle groups, and generate personalized recommendations.

---

## ✨ Features

- **Workout Logging** — Log exercises with sets, reps, and weight
- **Auto Exercise Classification** — Classifies exercises into 8 muscle groups
- **Dashboard Analytics** — Volume, personal records, streaks, muscle group distribution
- **Progression Charts** — Strength gains over time with estimated 1RM (Epley formula)
- **Training Insights** — Balance warnings, most improved exercise, consistency rate
- **Smart Recommendations** — Identifies undertrained areas and suggests exercises
- **JWT Authentication** — Secure registration and login with bcrypt password hashing
- **Multi-User Support** — Each user's data is fully isolated and secured

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, JavaScript |
| Backend | FastAPI, Python 3 |
| Database | SQLite, SQLAlchemy ORM |
| Authentication | JWT, bcrypt, passlib |
| Server | Uvicorn (ASGI) |
| Frontend Hosting | Vercel |
| Backend Hosting | Render |

---

## 🏗 System Architecture

\`\`\`
LAYER 1 — User / Browser
LAYER 2 — React Frontend (Vite) — Dashboard, Logger, Insights, Progress
LAYER 3 — FastAPI Backend — REST API, CRUD endpoints, input validation
LAYER 4 — JWT Auth Service — Token generation, bcrypt hashing, protected routes
LAYER 5 — Business Logic — ExerciseClassifier, AnalyticsService, RecommendationService
LAYER 6 — SQLite Database — Users table, Workouts table
\`\`\`

---

## 🚀 Running Locally

### Prerequisites
- Python 3.11+
- Node.js 18+

### Backend
\`\`\`bash
cd backend/v1
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
\`\`\`
Backend runs at http://localhost:8000
Swagger docs at http://localhost:8000/docs

### Frontend
\`\`\`bash
cd frontend/fitwise-app
npm install
npm run dev
\`\`\`
Frontend runs at http://localhost:5173

---

## 🧪 Test Cases

| Test | Expected Result |
|---|---|
| Register new user | Account created successfully |
| Login with valid credentials | JWT token returned |
| Login with invalid credentials | 401 Unauthorized |
| Create workout | Stored in database |
| Edit workout | Updated correctly |
| Delete workout | Removed from database |
| Invalid input | 422 Validation error |
| Access another user's data | 403 Access denied |
| Generate recommendation | Recommendation displayed |

---

## 🔮 Future Improvements

- Mobile application (React Native)
- Machine learning based recommendations
- Plateau detection and progression optimization
- Cloud database (PostgreSQL) for persistent storage
- Password reset and session management

---

## 👤 Author

**Emmanuel Dairo**
Computer Science · Southern Illinois University Carbondale · Class of 2026
GitHub: [@emmanuelodairo](https://github.com/emmanuelodairo)
