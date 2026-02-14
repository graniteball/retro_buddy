# Retro Buddy

A collaborative retrospective board app for teams. Create boards, add cards to "Went Well", "To Improve", and "Action Items" columns, and share them across machines.

## Getting Started

```bash
npm install
node server.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Features

- **User accounts** — sign up with email and name, sign in across sessions
- **Shared boards** — all users see the same boards and cards
- **Drag and drop** — move cards between columns
- **Card authors** — each card shows who created it
- **Persistent storage** — data saved to `data.json` on the server

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/signup` | Register a new user |
| `POST` | `/api/signin` | Sign in an existing user |
| `GET` | `/api/me` | Get current user from cookie |
| `GET` | `/api/boards` | List all boards |
| `POST` | `/api/boards` | Create a new board |
| `DELETE` | `/api/boards/:id` | Delete a board |
| `GET` | `/api/boards/:id` | Get board with author names |
| `PUT` | `/api/boards/:id` | Save card state |
