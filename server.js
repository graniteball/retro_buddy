const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// --- Data helpers ---
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    const data = { users: [], boards: [] };
    saveData(data);
    return data;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    cookies[name] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function migrateBoards(data) {
  let changed = false;
  data.boards.forEach(board => {
    for (const colId of Object.keys(board.columns)) {
      board.columns[colId] = board.columns[colId].map(item => {
        if (typeof item === 'string') {
          changed = true;
          item = { text: item, author: 'unknown' };
        }
        if (!item.cardId) {
          item.cardId = generateId();
          changed = true;
        }
        if (!item.votes) {
          item.votes = {};
          changed = true;
        }
        return item;
      });
    }
  });
  if (changed) saveData(data);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(__dirname));

// --- API Routes ---

// Sign up
app.post('/api/signup', (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) return res.json({ ok: false, error: 'Email and name are required.' });
  const data = loadData();
  if (data.users.find(u => u.email === email)) {
    return res.json({ ok: false, error: 'An account with that email already exists.' });
  }
  const user = { email, name };
  data.users.push(user);
  saveData(data);
  res.json({ ok: true, user });
});

// Sign in
app.post('/api/signin', (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ ok: false, error: 'Email is required.' });
  const data = loadData();
  const user = data.users.find(u => u.email === email);
  if (!user) return res.json({ ok: false, error: 'No account found for that email. Please sign up first.' });
  res.json({ ok: true, user });
});

// Current user from cookie
app.get('/api/me', (req, res) => {
  const cookies = parseCookies(req);
  const email = cookies.retroUser;
  if (!email) return res.status(404).json({ error: 'Not signed in' });
  const data = loadData();
  const user = data.users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// List all boards
app.get('/api/boards', (req, res) => {
  const data = loadData();
  migrateBoards(data);
  res.json({ boards: data.boards });
});

// Create board
app.post('/api/boards', (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ ok: false, error: 'Name is required.' });
  const data = loadData();
  const board = {
    id: generateId(),
    name,
    columns: { 'went-well': [], 'to-improve': [], 'action-items': [] }
  };
  data.boards.unshift(board);
  saveData(data);
  res.json({ board });
});

// Reorder boards
app.put('/api/boards/order', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.json({ ok: false, error: 'ids required.' });
  const data = loadData();
  const boardMap = {};
  data.boards.forEach(b => { boardMap[b.id] = b; });
  data.boards = ids.map(id => boardMap[id]).filter(Boolean);
  saveData(data);
  res.json({ ok: true });
});

// Delete board
app.delete('/api/boards/:id', (req, res) => {
  const data = loadData();
  data.boards = data.boards.filter(b => b.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

// Rename board
app.patch('/api/boards/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, error: 'Name is required.' });
  const data = loadData();
  const board = data.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ ok: false, error: 'Board not found.' });
  board.name = name.trim();
  saveData(data);
  res.json({ ok: true, board });
});

// Get single board + authors map
app.get('/api/boards/:id', (req, res) => {
  const data = loadData();
  migrateBoards(data);
  const board = data.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });

  // Build authors map from all cards in this board
  const authorEmails = new Set();
  for (const colId of Object.keys(board.columns)) {
    board.columns[colId].forEach(item => {
      if (item.author && item.author !== 'unknown') authorEmails.add(item.author);
    });
  }
  const authors = {};
  authorEmails.forEach(email => {
    const user = data.users.find(u => u.email === email);
    authors[email] = user ? user.name : email;
  });

  // Compute requesting user's total votes on this board
  const cookies = parseCookies(req);
  const reqEmail = cookies.retroUser || '';
  let myTotalVotes = 0;
  for (const colId of ['went-well', 'to-improve']) {
    (board.columns[colId] || []).forEach(card => {
      if (card.votes && card.votes[reqEmail]) myTotalVotes++;
    });
  }

  res.json({ board, authors, myTotalVotes });
});

// Toggle vote on a card (1 vote per user per card, 5 votes max per user per board)
app.post('/api/boards/:id/vote', (req, res) => {
  const { cardId } = req.body;
  if (!cardId) return res.json({ ok: false, error: 'cardId required.' });

  const cookies = parseCookies(req);
  const email = cookies.retroUser;
  if (!email) return res.status(401).json({ ok: false, error: 'Not signed in.' });

  const data = loadData();
  const board = data.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ ok: false, error: 'Board not found.' });

  // Find card in went-well or to-improve only
  let card = null;
  for (const colId of ['went-well', 'to-improve']) {
    card = (board.columns[colId] || []).find(c => c.cardId === cardId);
    if (card) break;
  }
  if (!card) return res.json({ ok: false, error: 'Card not found.' });

  if (!card.votes) card.votes = {};

  const hasVoted = !!card.votes[email];

  if (hasVoted) {
    // Remove vote
    delete card.votes[email];
  } else {
    // Check user's total votes across the board
    let myTotalVotes = 0;
    for (const colId of ['went-well', 'to-improve']) {
      (board.columns[colId] || []).forEach(c => {
        if (c.votes && c.votes[email]) myTotalVotes++;
      });
    }
    if (myTotalVotes >= 5) return res.json({ ok: false, error: 'No votes remaining.' });
    card.votes[email] = 1;
  }

  // Recompute myTotalVotes after change
  let myTotalVotes = 0;
  for (const colId of ['went-well', 'to-improve']) {
    (board.columns[colId] || []).forEach(c => {
      if (c.votes && c.votes[email]) myTotalVotes++;
    });
  }

  saveData(data);
  res.json({ ok: true, votes: card.votes, myTotalVotes });
});

// Save card state
app.put('/api/boards/:id', (req, res) => {
  const { columns } = req.body;
  if (!columns) return res.json({ ok: false, error: 'Columns are required.' });
  const data = loadData();
  const board = data.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ ok: false, error: 'Board not found' });
  board.columns = columns;
  saveData(data);
  res.json({ ok: true });
});

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Retro server running on port ${PORT}`);
});
