# Changelog

All notable changes to FitWise are documented here.

## Current Version - Auth, Recommendations, and Multi User Support

### Added
- User registration system
- User login system with JWT authentication
- Protected API routes requiring a valid token
- Multi user workout separation using `user_id`
- Personalized workout recommendation engine
- Recommendation logic for:
  - neglected muscle groups
  - push/pull imbalance
  - low leg volume
  - core neglect
  - stalled progression
  - low training frequency
  - never trained muscle groups
  - positive consistency feedback

### Improved
- Upgraded from single user workout tracking to account based tracking
- Improved database structure by separating users from workouts
- Improved backend security with password hashing
- Improved data ownership by making workouts belong to authenticated users only
- Improved system scalability for future multi user growth

### Backend Changes
- Added `/auth/register`
- Added `/auth/login`
- Added `/auth/me`
- Protected `/workouts` routes with authentication
- Added `/recommendations`
- Added JWT token creation and verification
- Added password hashing and verification with bcrypt
- Added `users` table
- Added `user_id` foreign key support in workouts table

### Notes
- This version represents the transition from a single user prototype to a more complete application
- This is the main production direction of the project going forward

---

## Version 2 - Analytics, Insights, and Progress Tracking

### Added
- Automatic exercise classification into muscle groups
- Weight field for more accurate workout tracking
- Muscle group storage in the database
- Dashboard analytics
- Volume calculation using sets × reps × weight
- Personal record tracking
- Streak tracking
- Active days tracking
- Best session volume tracking
- Progression charts
- Training insights
- Dark mode and light mode toggle
- Improved workout history filtering
- Better UI and layout structure

### Improved
- Expanded the system beyond basic CRUD functionality
- Improved visual presentation of data
- Improved workout tracking depth by including weight
- Improved user experience with a more polished frontend
- Improved usefulness of the system by showing trends instead of only storing entries

### Backend Changes
- Added keyword based muscle group classification
- Stored `muscle_group` with each workout
- Added `weight` and `notes` support
- Improved validation and sanitization

### Frontend Changes
- Added dashboard page
- Added history page filters
- Added progression page
- Added insights page
- Added live exercise classification preview
- Added PR display cards
- Added volume charts
- Added week activity grid
- Added theme switching

### Notes
- This version moved FitWise from a simple tracker into a training analytics system
- This was the version used for Milestone 3 presentation and report

---

## Version 1 - Core Workout Tracking System

### Added
- Basic FastAPI backend
- SQLite database connection
- Core CRUD functionality
- Create workout
- Retrieve workouts
- Update workout
- Delete workout
- Basic React frontend
- Workout input form
- Workout history display
- Initial frontend and backend integration
- Input validation for workout fields

### Improved
- Replaced manual note taking with structured workout storage
- Established the base architecture for later upgrades

### Backend Changes
- Added `workouts` table
- Added endpoints for create, read, update, and delete
- Added basic validation with Pydantic

### Frontend Changes
- Added workout logging interface
- Added workout list display
- Added edit and delete controls
- Connected frontend to backend API

### Notes
- This was the original working prototype
- This version focused on proving end to end functionality

---

## Design and Planning Phase

### Completed
- Defined project scope and motivation
- Wrote functional requirements
- Wrote non functional requirements
- Created use cases
- Created UML diagrams
- Created sequence diagrams
- Designed layered architecture
- Planned backend, frontend, and database structure

### Notes
- This phase established the system foundation before full implementation
- It shaped the later versions of the project

---

## Overall Project Evolution

### FitWise started as:
- a simple workout logging system

### FitWise evolved into:
- a workout analytics platform with progression tracking

### FitWise now supports:
- authentication
- multi user structure
- personalized recommendations
- intelligent exercise classification
- training insights
- progression analysis