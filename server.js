// ============================================================
// BACKEND: Node.js server (no libraries needed)
// Run with:  node server.js     then open http://localhost:3000
// It stores all data in data.json and gives the frontend an API.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG = { POINTS_PER_HELP: 10 };   // points for confirmed peer help

// ---------- DATA (kept in memory, saved to data.json) ----------
const fresh = () => ({
  topics: ['Waterfall model', 'Evolutionary model', 'V-model', 'Spiral model', 'Incremental model']
    .map(t => ({ t, on: 1 })),
  link: 'https://kahoot.it',
  resp: [],      // every student response
  kq: {},        // Kahoot % correct per topic
  reqs: [],      // peer help requests
  pts: 0,
  helped: 0,
  shared: 0
});
let state;
try { state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { state = fresh(); }
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));

// ---------- VALIDATION (the backend never trusts the browser) ----------
const cleanStr = (s, n) => String(s || '').trim().slice(0, n);
function validResponse(b) {
  if (!b || typeof b.r !== 'object' || b.r === null) return 'Missing ratings';
  const topics = Object.keys(b.r);
  if (!topics.length) return 'No topics rated';
  for (const t of topics) if (![0, 1, 2].includes(b.r[t])) return 'Rating must be 0, 1 or 2';
  if (!['', 'peers', 'teacher'].includes(b.help)) return 'Invalid help choice';
  if (b.help === 'teacher' && !cleanStr(b.name, 40)) return 'Name required for teacher help';
  return null;
}

// ---------- API ACTIONS ----------
function addResponse(b) {
  
  const r = {};
  Object.keys(b.r).forEach(t => { r[cleanStr(t, 60)] = b.r[t]; });
  const name = b.help === 'teacher' ? cleanStr(b.name, 40) : '';
  state.resp.push({ r, help: b.help, name });
  if (b.help === 'peers') {
    Object.keys(r).filter(t => r[t] > 0).forEach(t => state.reqs.unshift({ t, h: 0, o: 0, c: 0 }));
  }
}
function setConfig(b) {
  if (Array.isArray(b.topics)) {
    const topics = b.topics.map(x => ({ t: cleanStr(x.t, 60), on: x.on ? 1 : 0 })).filter(x => x.t);
    if (topics.some(x => x.on)) state.topics = topics;
  }
  if (typeof b.link === 'string' && /^https?:\/\//.test(b.link)) state.link = b.link.slice(0, 300);
  if (b.shared !== undefined) state.shared = b.shared ? 1 : 0;
  if (b.kq && typeof b.kq === 'object') {
    const kq = {};
    Object.keys(b.kq).forEach(t => {
      const v = b.kq[t];
      if (v === '') kq[t] = '';
      else if (typeof v === 'number' && v >= 0 && v <= 100) kq[t] = v;
    });
    state.kq = kq;
  }
}
function helpAction(b) {
  const r = state.reqs[b.i];
  if (!r) return;
  if (b.action === 'offer' && !r.o) { r.h++; r.o = 1; }
  if (b.action === 'confirm' && r.o && !r.c) { r.c = 1; state.pts += CONFIG.POINTS_PER_HELP; state.helped++; }
}

// ---------- SERVER ----------
const readBody = req => new Promise(resolve => {
  let d = '';
  req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
});
const sendJSON = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // Frontend page
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  // API
  if (url === '/api/state' && req.method === 'GET') return sendJSON(res, 200, state);
  if (req.method === 'POST' && url.startsWith('/api/')) {
    const b = await readBody(req);
    if (url === '/api/response') {
      const err = validResponse(b);
      if (err) return sendJSON(res, 400, { error: err });
      addResponse(b);
    } else if (url === '/api/config') setConfig(b);
    else if (url === '/api/help') helpAction(b);
    else if (url === '/api/reset') state = fresh();
    else return sendJSON(res, 404, { error: 'Unknown route' });
    save();
    return sendJSON(res, 200, state);
  }
  sendJSON(res, 404, { error: 'Not found' });
}).listen(PORT, '0.0.0.0', () => {
  console.log('Backend running.');
  console.log('  This laptop : http://localhost:' + PORT);
  Object.values(os.networkInterfaces()).flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .forEach(i => console.log('  Phones (same Wi-Fi): http://' + i.address + ':' + PORT));
});