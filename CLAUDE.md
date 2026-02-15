# Retro Board — Project Context

## Overview
A retrospective board web app (single `index.html` + `server.js`) for team retros. Users sign in with email, create boards, and add cards to three columns: Went Well, To Improve, and Action Items.

## Tech Stack
- **Server**: Node.js + Express, single `server.js` file, data stored in `data.json`
- **Client**: Single `index.html` with inline CSS and JS (no build step, no framework)
- **No database** — flat JSON file read/written synchronously

## Architecture
- All views (sign-in, sign-up, boards list, board detail) are `<div>` sections toggled via `hidden` class
- Auth is cookie-based (`retroUser` cookie stores email)
- Cards are objects: `{ text, author, cardId, votes: { email: 1 } }`
- Board state saved via `PUT /api/boards/:id` with full column data

## Key Features

### Voting System
- **Toggle-based**: one click to vote, another to un-vote (no downvotes)
- **1 vote per card per user, 5 votes max per user per board**
- Outlined thumbs-up = not voted, solid = voted
- Vote data: `card.votes` is a map of `{ email: 1 }` entries
- Server endpoint: `POST /api/boards/:id/vote` with `{ cardId }` — toggles the vote
- `myTotalVotes` returned from both GET board and vote endpoints
- Sort button in Went Well / To Improve headers sorts by most votes descending

### Live Polling
- Board detail view polls `GET /api/boards/:id` every 4 seconds
- Boards list view polls `GET /api/boards` every 4 seconds
- Skips re-render if user is editing, typing in placeholder, or dragging
- `lastBoardJSON` snapshot prevents redundant re-renders from own saves

### Action Items
- Extra fields: responsible person + due date
- Due date defaults to tomorrow, minimum is today
- Past/invalid dates show a transient red toast and revert
- Cards cannot be dragged between action-items and other columns

### Card Editing
- Click on card **text** to edit (not the whole card area)
- `cardId` and `votes` are preserved through edits
- Migration in `migrateBoards()` assigns `cardId` and `votes: {}` to legacy cards

## Running
```bash
npm install
node server.js
# Open http://localhost:3000
```

## API Endpoints
- `POST /api/signup` — `{ email, name }`
- `POST /api/signin` — `{ email }`
- `GET /api/me` — current user from cookie
- `GET /api/boards` — list all boards
- `POST /api/boards` — `{ name }`
- `DELETE /api/boards/:id`
- `GET /api/boards/:id` — board + authors + myTotalVotes
- `PUT /api/boards/:id` — `{ columns }` save full board state
- `POST /api/boards/:id/vote` — `{ cardId }` toggle vote
