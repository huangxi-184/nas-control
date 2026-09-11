const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TTY = process.env.NAS_TTY || '/dev/tty1';
const SCHEDULE_PATH = path.join(__dirname, 'schedule.json');

// Fixed commands only — no arbitrary shell input.
// Run as root (e.g. `sudo pm2 start server.js`).
const COMMANDS = {
  off: `setterm --blank force --term linux <${TTY}`,
  on: `setterm --blank poke --term linux <${TTY}`,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let shutdownTimer = null;
let nextShutdownAt = null;

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function loadSchedule() {
  try {
    const raw = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
    return {
      enabled: Boolean(raw.enabled),
      time: typeof raw.time === 'string' && /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : null,
    };
  } catch {
    return { enabled: false, time: null };
  }
}

function saveSchedule(schedule) {
  fs.writeFileSync(SCHEDULE_PATH, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
}

function parseTime(time) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function nextOccurrence(time) {
  const parsed = parseTime(time);
  if (!parsed) return null;

  const now = new Date();
  const next = new Date(now);
  next.setHours(parsed.h, parsed.m, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function clearShutdownTimer() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  nextShutdownAt = null;
}

function runShutdown() {
  console.log('Scheduled shutdown triggered, powering off...');
  exec('shutdown -h now', { timeout: 5000 }, (error, _stdout, stderr) => {
    if (error) {
      console.error('Shutdown failed:', error.message, stderr || '');
    }
  });
}

function scheduleNextShutdown() {
  clearShutdownTimer();

  const schedule = loadSchedule();
  if (!schedule.enabled || !schedule.time) {
    console.log('Scheduled shutdown is disabled');
    return;
  }

  const next = nextOccurrence(schedule.time);
  if (!next) {
    console.log('Invalid schedule time, skip');
    return;
  }

  const delay = next.getTime() - Date.now();
  nextShutdownAt = next.toISOString();

  console.log(`Next scheduled shutdown: ${next.toLocaleString()} (in ${Math.round(delay / 1000)}s)`);
  shutdownTimer = setTimeout(runShutdown, delay);
}

function getSchedulePayload() {
  const schedule = loadSchedule();
  return {
    ok: true,
    enabled: schedule.enabled,
    time: schedule.time,
    nextShutdownAt,
  };
}

function handleScheduleGet(res) {
  sendJson(res, 200, getSchedulePayload());
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 4096) {
      req.destroy();
    }
  });
  req.on('end', () => cb(body));
}

function handleScheduleSet(req, res) {
  readBody(req, (body) => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
      return;
    }

    const enabled = Boolean(payload.enabled);
    const time = typeof payload.time === 'string' ? payload.time.trim() : null;

    if (enabled && !parseTime(time)) {
      sendJson(res, 400, { ok: false, error: '时间格式应为 HH:mm，例如 03:00' });
      return;
    }

    saveSchedule({ enabled, time: enabled ? time : null });
    scheduleNextShutdown();
    sendJson(res, 200, getSchedulePayload());
  });
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function handleScreenAction(action, res) {
  const cmd = COMMANDS[action];
  if (!cmd) {
    sendJson(res, 400, { ok: false, error: 'Unknown action' });
    return;
  }

  exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
    if (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        stderr: stderr || '',
        hint: 'Run this service as root (e.g. sudo pm2 start server.js).',
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      action,
      message: action === 'off' ? 'Screen blanked' : 'Screen woken',
    });
  });
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const url = (req.url || '/').split('?')[0];

  if (method === 'POST' && url === '/api/screen/off') {
    handleScreenAction('off', res);
    return;
  }

  if (method === 'POST' && url === '/api/screen/on') {
    handleScreenAction('on', res);
    return;
  }

  if (method === 'GET' && url === '/api/schedule') {
    handleScheduleGet(res);
    return;
  }

  if (method === 'POST' && url === '/api/schedule') {
    handleScheduleSet(req, res);
    return;
  }

  if (method === 'GET' && url === '/api/health') {
    sendJson(res, 200, { ok: true, tty: TTY, nextShutdownAt });
    return;
  }

  if (method === 'GET') {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { ok: false, error: 'Method not allowed' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NAS control listening on http://0.0.0.0:${PORT}`);
  console.log(`TTY target: ${TTY}`);
  scheduleNextShutdown();
});
