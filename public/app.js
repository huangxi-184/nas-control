const btnOff = document.getElementById('btn-off');
const btnOn = document.getElementById('btn-on');
const scheduleTime = document.getElementById('schedule-time');
const scheduleEnabled = document.getElementById('schedule-enabled');
const btnSaveSchedule = document.getElementById('btn-save-schedule');
const scheduleInfo = document.getElementById('schedule-info');
const statusEl = document.getElementById('status');
const ttyEl = document.getElementById('tty');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ''}`;
}

function setBusy(busy) {
  btnOff.disabled = busy;
  btnOn.disabled = busy;
}

function formatLocal(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function renderSchedule(data) {
  scheduleEnabled.checked = Boolean(data.enabled);
  if (data.time) {
    scheduleTime.value = data.time;
  }

  if (!data.enabled || !data.time) {
    scheduleInfo.textContent = '当前：未启用定时关机';
    return;
  }

  const nextText = formatLocal(data.nextShutdownAt) || '服务重启后生效';
  scheduleInfo.textContent = `当前：每天 ${data.time} 关机 · 下次：${nextText}`;
}

async function callScreen(action) {
  setBusy(true);
  setStatus(action === 'off' ? '正在关闭屏幕…' : '正在唤醒屏幕…', 'busy');

  try {
    const res = await fetch(`/api/screen/${action}`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.stderr || `HTTP ${res.status}`);
    }

    setStatus(data.message || '完成', 'ok');
  } catch (err) {
    setStatus(`失败：${err.message}`, 'err');
  } finally {
    setBusy(false);
  }
}

async function loadSchedule() {
  try {
    const res = await fetch('/api/schedule');
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    renderSchedule(data);
  } catch (err) {
    scheduleInfo.textContent = `读取计划失败：${err.message}`;
  }
}

async function saveSchedule() {
  const enabled = scheduleEnabled.checked;
  const time = scheduleTime.value;

  if (enabled && !time) {
    setStatus('请选择关机时间', 'err');
    return;
  }

  btnSaveSchedule.disabled = true;
  setStatus('正在保存定时关机计划…', 'busy');

  try {
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, time }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    renderSchedule(data);
    setStatus(enabled ? `已启用每天 ${time} 关机` : '已关闭定时关机', 'ok');
  } catch (err) {
    setStatus(`保存失败：${err.message}`, 'err');
  } finally {
    btnSaveSchedule.disabled = false;
  }
}

async function loadHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    ttyEl.textContent = data.ok ? `TTY: ${data.tty}` : 'TTY: unknown';
  } catch {
    ttyEl.textContent = 'TTY: offline';
  }
}

btnOff.addEventListener('click', () => callScreen('off'));
btnOn.addEventListener('click', () => callScreen('on'));
btnSaveSchedule.addEventListener('click', saveSchedule);

loadHealth();
loadSchedule();
