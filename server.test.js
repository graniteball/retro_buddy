const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Use a temp data file so tests never touch data.json
const tmpFile = path.join(os.tmpdir(), `retro-test-${process.pid}.json`);
process.env.DATA_FILE = tmpFile;

const app = require('./server');
const supertest = require('supertest');
const request = supertest(app);

function cleanup() {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function setupUsersAndBoard() {
  await request.post('/api/signup').send({ email: 'userA@test.com', name: 'User A' });
  await request.post('/api/signup').send({ email: 'userB@test.com', name: 'User B' });
  const res = await request
    .post('/api/boards')
    .set('Cookie', 'retroUser=userA@test.com')
    .send({ name: 'Test Board' });
  return res.body.board.id;
}

// ── POST /api/boards/:id/cards ────────────────────────────────────────────────

test('adds a card to the specified column', async () => {
  cleanup();
  const boardId = await setupUsersAndBoard();

  const res = await request
    .post(`/api/boards/${boardId}/cards`)
    .set('Cookie', 'retroUser=userA@test.com')
    .send({ colId: 'went-well', card: { text: 'Great teamwork', cardId: 'c1', votes: {} } });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.card.text, 'Great teamwork');
  assert.equal(res.body.card.author, 'userA@test.com');

  const board = await request.get(`/api/boards/${boardId}`).set('Cookie', 'retroUser=userA@test.com');
  assert.equal(board.body.board.columns['went-well'].length, 1);
  assert.equal(board.body.board.columns['went-well'][0].text, 'Great teamwork');
});

test('rejects card addition when not signed in', async () => {
  cleanup();
  const boardId = await setupUsersAndBoard();

  const res = await request
    .post(`/api/boards/${boardId}/cards`)
    .send({ colId: 'went-well', card: { text: 'Ghost card', cardId: 'c1', votes: {} } });

  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
});

test('rejects card addition with missing text', async () => {
  cleanup();
  const boardId = await setupUsersAndBoard();

  const res = await request
    .post(`/api/boards/${boardId}/cards`)
    .set('Cookie', 'retroUser=userA@test.com')
    .send({ colId: 'went-well', card: { cardId: 'c1', votes: {} } });

  assert.equal(res.body.ok, false);
});

test('rejects card addition to invalid column', async () => {
  cleanup();
  const boardId = await setupUsersAndBoard();

  const res = await request
    .post(`/api/boards/${boardId}/cards`)
    .set('Cookie', 'retroUser=userA@test.com')
    .send({ colId: 'nonexistent', card: { text: 'Hi', cardId: 'c1', votes: {} } });

  assert.equal(res.body.ok, false);
});

test('saves action-item fields (responsible + dueDate)', async () => {
  cleanup();
  const boardId = await setupUsersAndBoard();

  const res = await request
    .post(`/api/boards/${boardId}/cards`)
    .set('Cookie', 'retroUser=userA@test.com')
    .send({
      colId: 'action-items',
      card: { text: 'Deploy fix', cardId: 'c1', responsible: 'Alice', dueDate: '2099-01-01' }
    });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.card.responsible, 'Alice');
  assert.equal(res.body.card.dueDate, '2099-01-01');
});

// ── Concurrent card creation — the core race condition ────────────────────────

test('concurrent POST /cards from two users preserves both cards', async () => {
  cleanup();
  const boardId = await setupUsersAndBoard();

  // Both users add a card at the same time
  const [resA, resB] = await Promise.all([
    request
      .post(`/api/boards/${boardId}/cards`)
      .set('Cookie', 'retroUser=userA@test.com')
      .send({ colId: 'went-well', card: { text: 'Card from A', cardId: 'card-a', votes: {} } }),
    request
      .post(`/api/boards/${boardId}/cards`)
      .set('Cookie', 'retroUser=userB@test.com')
      .send({ colId: 'went-well', card: { text: 'Card from B', cardId: 'card-b', votes: {} } }),
  ]);

  assert.equal(resA.body.ok, true, 'User A add-card should succeed');
  assert.equal(resB.body.ok, true, 'User B add-card should succeed');

  const board = await request.get(`/api/boards/${boardId}`).set('Cookie', 'retroUser=userA@test.com');
  const cards = board.body.board.columns['went-well'];

  assert.equal(cards.length, 2, 'Both cards must survive concurrent adds');
  const texts = cards.map(c => c.text);
  assert.ok(texts.includes('Card from A'), 'Card A must be present');
  assert.ok(texts.includes('Card from B'), 'Card B must be present');
});

test('concurrent PUT /boards/:id causes last-write-wins (documents old bug)', async () => {
  cleanup();
  const boardId = await setupUsersAndBoard();

  // Simulate the old behaviour: each client sends its own full DOM snapshot
  const [, ] = await Promise.all([
    request
      .put(`/api/boards/${boardId}`)
      .set('Cookie', 'retroUser=userA@test.com')
      .send({
        columns: {
          'went-well': [{ text: 'Card from A', cardId: 'card-a', votes: {} }],
          'to-improve': [],
          'action-items': []
        }
      }),
    request
      .put(`/api/boards/${boardId}`)
      .set('Cookie', 'retroUser=userB@test.com')
      .send({
        columns: {
          'went-well': [{ text: 'Card from B', cardId: 'card-b', votes: {} }],
          'to-improve': [],
          'action-items': []
        }
      }),
  ]);

  const board = await request.get(`/api/boards/${boardId}`).set('Cookie', 'retroUser=userA@test.com');
  const cards = board.body.board.columns['went-well'];

  // Only one card survives — this is the race condition that the fix resolves
  assert.equal(cards.length, 1, 'PUT last-write-wins: only one card survives');
});
