/* ============================================================
   Foundry Run Watcher — app.js v01.00
   All logic: polling, rendering, helpers.
   Exposed on window.__helpers for Playwright golden tests.
   ============================================================ */
"use strict";

/* ---- Constants -------------------------------------------- */

const PHASES = [
  "intake", "research", "spec", "design", "test_authoring",
  "plan", "build_loop", "integration", "release", "retro", "done"
];

const DEFAULT_API_BASE = "http://127.0.0.1:7788";

/* ---- Pure helpers (no DOM, testable) ---------------------- */

function classifyPhase(index, activeIndex) {
  if (activeIndex < 0) return "pending";
  if (index < activeIndex) return "completed";
  if (index === activeIndex) return "current";
  return "pending";
}

function countdownSeconds(resetMs, now) {
  return Math.max(0, Math.round((resetMs - now) / 1000));
}

function secondsUntilResetFallback(secondsUntilReset, pollReceivedAt, now) {
  return Math.max(0, Math.round(secondsUntilReset - (now - pollReceivedAt) / 1000));
}

function diffPaths(previous, current) {
  const prevSet = new Set(Array.isArray(previous) ? previous : Array.from(previous));
  const result = [];
  const curr = Array.isArray(current) ? current : Array.from(current);
  for (const p of curr) {
    if (!prevSet.has(p)) result.push(p);
  }
  return result;
}

function isBinaryPreview(bytes) {
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x00) return true;
  }
  return false;
}

const STATUS_MAP = {
  running:          { label: "running",  icon: "▶", cls: "status-running" },
  paused:           { label: "paused",   icon: "⏸", cls: "status-paused" },
  done:             { label: "done",     icon: "✓", cls: "status-done" },
  failed:           { label: "failed",   icon: "✗", cls: "status-failed" },
  abandoned_user:   { label: "user",     icon: "⊘", cls: "status-abandoned-user" },
  abandoned_budget: { label: "budget",   icon: "$",  cls: "status-abandoned-budget" }
};

function classifyStatus(status) {
  return STATUS_MAP[status] || { label: String(status), icon: "·", cls: "status-unknown" };
}

/* Expose helpers for Playwright golden tests */
window.__helpers = {
  classifyPhase,
  countdownSeconds,
  secondsUntilResetFallback,
  diffPaths,
  isBinaryPreview,
  classifyStatus
};

/* ---- Resolve API base ------------------------------------- */

function resolveApiBase() {
  try {
    const p = new URLSearchParams(location.search);
    const override = p.get("api");
    return override ? override : DEFAULT_API_BASE;
  } catch (_) {
    return DEFAULT_API_BASE;
  }
}

const API_BASE = resolveApiBase();

/* ---- In-memory state ------------------------------------- */

let lastGoodState     = null;  // last successful /api/state body
let lastGoodPollMs    = null;  // Date.now() of last successful poll
let previousPaths     = new Set();  // artifact paths from previous poll
let flashTimers       = new Map();  // path → timeoutId
let currentController = null;  // AbortController for in-flight /api/state
let previewState      = null;  // {path, mtimeAtPreview}
let pauseState        = null;  // {resetMs, secondsUntilReset, pollReceivedAt}
let inspectedRun      = null;  // last /api/run/<id> response
let staleUpdateTimer  = null;  // setInterval handle for stale counter
let countdownTimer    = null;  // setInterval handle for 1Hz countdown

/* ---- Polling loop (R-07, R-08) --------------------------- */

function tick() {
  /* Abort any in-flight request from previous tick */
  if (currentController) currentController.abort();
  currentController = new AbortController();
  const ctrl = currentController;

  /* Schedule next tick NOW so it always fires exactly 2s after this one */
  setTimeout(tick, 2000);

  fetch(API_BASE + "/api/state", { signal: ctrl.signal })
    .then(function(r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function(state) {
      lastGoodState  = state;
      lastGoodPollMs = Date.now();
      clearStaleIndicator();
      render(state);
    })
    .catch(function(err) {
      /* Ignore self-inflicted aborts (normal 2s cycle) */
      if (err && err.name === "AbortError") return;
      /* Network / server error — show stale, keep last-known-good */
      showStaleIndicator();
      if (lastGoodState) render(lastGoodState);
    });
}

/* ---- Stale indicator ------------------------------------- */

function showStaleIndicator() {
  var el = document.getElementById("stale-indicator");
  if (!el) return;
  el.removeAttribute("hidden");
  updateStaleText();
  if (!staleUpdateTimer) {
    staleUpdateTimer = setInterval(updateStaleText, 1000);
  }
}

function clearStaleIndicator() {
  var el = document.getElementById("stale-indicator");
  if (!el) return;
  el.setAttribute("hidden", "");
  if (staleUpdateTimer) {
    clearInterval(staleUpdateTimer);
    staleUpdateTimer = null;
  }
}

function updateStaleText() {
  var el = document.getElementById("stale-indicator");
  if (!el || el.hasAttribute("hidden")) return;
  var secs = lastGoodPollMs ? Math.round((Date.now() - lastGoodPollMs) / 1000) : 0;
  el.textContent = "⚠ stale (last update " + secs + "s ago)";
}

/* ---- Countdown ticker (1Hz, independent of polls) -------- */

function updateCountdown() {
  var el = document.getElementById("pause-countdown");
  if (!el || !pauseState) return;
  var now = Date.now();
  var secs;
  if (pauseState.resetMs !== null) {
    secs = countdownSeconds(pauseState.resetMs, now);
  } else {
    secs = secondsUntilResetFallback(
      pauseState.secondsUntilReset,
      pauseState.pollReceivedAt,
      now
    );
  }
  el.textContent = secs + "s";
}

function startCountdownTicker() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdown, 1000);
}

/* ---- Main render ----------------------------------------- */

function render(state) {
  renderPhaseStrip(state.active_run ? state.active_run.phase : null);
  renderPauseBanner(state.pause || null);
  renderArtifactTree(state.artifacts || []);
  renderQueue(state.queue || []);
  renderRuns(state.runs || [], state.active_run ? state.active_run.run_id : null);
  renderLogTails(state.launchd_err_tail || "", state.launchd_out_tail || "");
  maybeRefreshPreview(state.artifacts || []);
}

/* ---- Phase strip ----------------------------------------- */

function renderPhaseStrip(activePhase) {
  var activeIndex = (activePhase != null) ? PHASES.indexOf(activePhase) : -1;
  var list = document.getElementById("phase-strip");
  if (!list) return;
  list.innerHTML = "";

  for (var i = 0; i < PHASES.length; i++) {
    var slug  = PHASES[i];
    var state = classifyPhase(i, activeIndex);

    var li = document.createElement("li");
    li.className = "phase-cell";
    li.setAttribute("data-slug", slug);
    li.setAttribute("data-state", state);
    li.setAttribute("aria-label", slug + " — " + state);

    var icon = document.createElement("span");
    icon.className = "phase-icon";
    icon.textContent = state === "completed" ? "✓"   /* ✓ */
                     : state === "current"   ? "▶"   /* ▶ */
                     :                         "○";  /* ○ */

    var slugEl = document.createElement("span");
    slugEl.className = "phase-slug";
    slugEl.textContent = slug;

    var labelEl = document.createElement("span");
    labelEl.className = "phase-label";
    labelEl.textContent = state;

    li.appendChild(icon);
    li.appendChild(slugEl);
    li.appendChild(labelEl);
    list.appendChild(li);
  }
}

/* ---- Pause banner ---------------------------------------- */

function renderPauseBanner(pause) {
  var banner = document.getElementById("pause-banner");
  if (!banner) return;

  if (!pause) {
    banner.setAttribute("hidden", "");
    pauseState = null;
    return;
  }

  banner.removeAttribute("hidden");

  /* Parse reset_at into epoch ms */
  var resetMs = NaN;
  if (pause.reset_at) resetMs = Date.parse(pause.reset_at);
  var pollReceivedAt = Date.now();

  if (!isNaN(resetMs)) {
    pauseState = { resetMs: resetMs, secondsUntilReset: null, pollReceivedAt: pollReceivedAt };
  } else {
    pauseState = {
      resetMs: null,
      secondsUntilReset: pause.seconds_until_reset || 0,
      pollReceivedAt: pollReceivedAt
    };
  }

  var kindEl = banner.querySelector(".pause-kind");
  if (kindEl) kindEl.textContent = pause.kind || "";

  var nodeEl = banner.querySelector(".pause-node");
  if (nodeEl) nodeEl.textContent = pause.node || "";

  var previewEl = banner.querySelector(".pause-preview");
  if (previewEl) previewEl.textContent = pause.raw_preview || "";

  /* Immediately update the countdown text */
  updateCountdown();
}

/* ---- Artifact tree --------------------------------------- */

function renderArtifactTree(artifacts) {
  var list = document.getElementById("artifact-list");
  if (!list) return;

  var currPaths = new Set(artifacts.map(function(a) { return a.path; }));
  var newPaths  = new Set(diffPaths(Array.from(previousPaths), artifacts.map(function(a) { return a.path; })));

  list.innerHTML = "";

  if (artifacts.length === 0) {
    var empty = document.createElement("li");
    empty.className = "artifact-empty";
    empty.textContent = "No artifacts yet";
    list.appendChild(empty);
    previousPaths = currPaths;
    return;
  }

  for (var i = 0; i < artifacts.length; i++) {
    var art = artifacts[i];
    var li = createArtifactRow(art, newPaths.has(art.path));
    list.appendChild(li);
  }

  previousPaths = currPaths;
}

function createArtifactRow(art, isNew) {
  var li = document.createElement("li");
  li.className = "artifact-row";
  li.setAttribute("role", "button");
  li.setAttribute("tabindex", "0");

  if (previewState && previewState.path === art.path) {
    li.classList.add("selected");
    li.setAttribute("aria-selected", "true");
  }

  var pathEl = document.createElement("span");
  pathEl.className = "artifact-path";
  pathEl.textContent = art.path;

  var sizeEl = document.createElement("span");
  sizeEl.className = "artifact-size";
  sizeEl.textContent = String(art.size);

  li.appendChild(pathEl);
  li.appendChild(sizeEl);

  if (isNew) {
    li.classList.add("flash");
    /* Cancel any existing timer for this path (from old DOM element) */
    if (flashTimers.has(art.path)) clearTimeout(flashTimers.get(art.path));
    var path = art.path;
    var timer = setTimeout(function() {
      li.classList.remove("flash");
      flashTimers.delete(path);
    }, 1500);
    flashTimers.set(art.path, timer);
  }

  var capturedPath  = art.path;
  var capturedMtime = art.mtime;
  li.addEventListener("click", function() { onArtifactClick(capturedPath, capturedMtime); });
  li.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") onArtifactClick(capturedPath, capturedMtime);
  });

  return li;
}

function onArtifactClick(path, mtime) {
  previewState = { path: path, mtimeAtPreview: mtime };

  /* Update selected styling */
  var rows = document.querySelectorAll("#artifact-list .artifact-row");
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rowPath = row.querySelector(".artifact-path");
    if (rowPath && rowPath.textContent === path) {
      row.classList.add("selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.classList.remove("selected");
      row.removeAttribute("aria-selected");
    }
  }

  fetchPreview(path);
}

/* ---- File preview panel ---------------------------------- */

function fetchPreview(path) {
  var pane    = document.getElementById("preview-pane");
  var content = document.getElementById("preview-content");
  if (!pane || !content) return;

  pane.style.display = "flex";
  pane.style.flexDirection = "column";

  fetch(API_BASE + "/api/file?path=" + encodeURIComponent(path))
    .then(function(r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    })
    .then(function(buf) {
      var bytes = new Uint8Array(buf);
      if (isBinaryPreview(bytes)) {
        content.textContent = "binary file — preview unavailable";
        return;
      }
      var decoder = new TextDecoder("utf-8");
      content.textContent = decoder.decode(bytes);
    })
    .catch(function(err) {
      content.textContent = "Error loading file: " + err.message;
    });
}

function maybeRefreshPreview(artifacts) {
  if (!previewState) return;
  for (var i = 0; i < artifacts.length; i++) {
    var art = artifacts[i];
    if (art.path === previewState.path) {
      if (art.mtime > previewState.mtimeAtPreview) {
        previewState.mtimeAtPreview = art.mtime;
        fetchPreview(previewState.path);
      }
      return;
    }
  }
}

/* ---- Queue list ------------------------------------------ */

function renderQueue(queue) {
  var list = document.getElementById("queue-list");
  if (!list) return;
  list.innerHTML = "";

  if (queue.length === 0) {
    var empty = document.createElement("li");
    empty.textContent = "No pending briefs";
    list.appendChild(empty);
    return;
  }

  for (var i = 0; i < queue.length; i++) {
    var item = queue[i];
    var li = document.createElement("li");
    li.className = "queue-row";

    var nameEl = document.createElement("span");
    nameEl.className = "queue-name";
    nameEl.textContent = item.app_name || "";
    li.appendChild(nameEl);

    if (item.created_at) {
      var dateEl = document.createElement("span");
      dateEl.className = "queue-time";
      dateEl.textContent = relativeTime(item.created_at);
      li.appendChild(dateEl);
    }

    list.appendChild(li);
  }
}

/* ---- Runs list ------------------------------------------- */

function renderRuns(runs, activeRunId) {
  var list = document.getElementById("runs-list");
  if (!list) return;
  list.innerHTML = "";

  var slice = runs.slice(0, 10);

  if (slice.length === 0) {
    var empty = document.createElement("li");
    empty.textContent = "No runs yet";
    list.appendChild(empty);
    return;
  }

  for (var i = 0; i < slice.length; i++) {
    var run = slice[i];
    list.appendChild(createRunRow(run, run.run_id === activeRunId));
  }
}

function createRunRow(run, isLive) {
  var li = document.createElement("li");
  li.className = "run-row";
  li.setAttribute("role", "button");
  li.setAttribute("tabindex", "0");

  var statusInfo = classifyStatus(run.status);

  /* Top line: app_name + live badge + status pill */
  var topLine = document.createElement("div");
  topLine.className = "run-top";

  var appName = document.createElement("span");
  appName.className = "run-app-name";
  appName.textContent = run.app_name || "";
  topLine.appendChild(appName);

  if (isLive) {
    var badge = document.createElement("span");
    badge.className = "run-live-badge";
    badge.textContent = "live";
    topLine.appendChild(badge);
  }

  var pill = document.createElement("span");
  pill.className = "run-status " + statusInfo.cls;

  var iconEl = document.createElement("span");
  iconEl.className = "status-icon";
  iconEl.textContent = statusInfo.icon;

  var labelEl = document.createElement("span");
  labelEl.className = "status-label";
  labelEl.textContent = statusInfo.label;

  pill.appendChild(iconEl);
  pill.appendChild(labelEl);
  topLine.appendChild(pill);

  /* Bottom line: run_id + phase + created_at */
  var botLine = document.createElement("div");
  botLine.className = "run-bot";

  var runIdEl = document.createElement("span");
  runIdEl.className = "run-id";
  runIdEl.textContent = run.run_id || "";

  var phaseEl = document.createElement("span");
  phaseEl.className = "run-phase";
  phaseEl.textContent = (run.phase != null && run.phase !== undefined) ? run.phase : "—";

  var timeEl = document.createElement("span");
  timeEl.className = "run-time";
  timeEl.textContent = relativeTime(run.created_at);

  botLine.appendChild(runIdEl);
  botLine.appendChild(phaseEl);
  botLine.appendChild(timeEl);

  li.appendChild(topLine);
  li.appendChild(botLine);

  var capturedId = run.run_id;
  li.addEventListener("click", function() { onRunClick(capturedId); });
  li.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") onRunClick(capturedId);
  });

  return li;
}

/* ---- Click-to-inspect ------------------------------------ */

function onRunClick(runId) {
  fetch(API_BASE + "/api/run/" + runId)
    .then(function(r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function(data) {
      inspectedRun = data;
      renderInspect(data);
    })
    .catch(function(err) {
      var pane = document.getElementById("inspect-pane");
      if (pane) {
        var emptyEl = document.getElementById("inspect-empty");
        if (emptyEl) { emptyEl.style.display = ""; emptyEl.textContent = "Error: " + err.message; }
      }
    });
}

function renderInspect(run) {
  var pane = document.getElementById("inspect-pane");
  if (!pane) return;

  var emptyEl = document.getElementById("inspect-empty");
  if (emptyEl) emptyEl.style.display = "none";

  var existing = pane.querySelector(".inspect-content");
  if (existing) pane.removeChild(existing);

  var content = document.createElement("div");
  content.className = "inspect-content";

  var statusInfo = classifyStatus(run.status || "");

  /* Header */
  var header = document.createElement("div");
  header.className = "inspect-header";

  var appNameEl = document.createElement("span");
  appNameEl.className = "inspect-app-name";
  appNameEl.textContent = run.app_name || "";

  var runIdEl = document.createElement("span");
  runIdEl.className = "inspect-run-id";
  runIdEl.textContent = run.run_id || "";

  var pill = document.createElement("span");
  pill.className = "run-status " + statusInfo.cls;
  var sIcon = document.createElement("span");
  sIcon.className = "status-icon";
  sIcon.textContent = statusInfo.icon;
  var sLabel = document.createElement("span");
  sLabel.className = "status-label";
  sLabel.textContent = statusInfo.label;
  pill.appendChild(sIcon);
  pill.appendChild(sLabel);

  header.appendChild(appNameEl);
  header.appendChild(runIdEl);
  header.appendChild(pill);
  content.appendChild(header);

  /* Artifacts */
  var artHead = document.createElement("h4");
  artHead.textContent = "Artifacts";
  content.appendChild(artHead);

  var artList = document.createElement("ul");
  artList.className = "inspect-artifacts";
  var arts = run.artifacts || [];
  for (var i = 0; i < arts.length; i++) {
    var a = arts[i];
    var artLi = document.createElement("li");
    artLi.className = "inspect-artifact-row";
    var pEl = document.createElement("span");
    pEl.className = "artifact-path";
    pEl.textContent = a.path;
    var sEl = document.createElement("span");
    sEl.className = "artifact-size";
    sEl.textContent = String(a.size);
    artLi.appendChild(pEl);
    artLi.appendChild(sEl);
    artList.appendChild(artLi);
  }
  content.appendChild(artList);

  /* Node history */
  var nodeHead = document.createElement("h4");
  nodeHead.textContent = "Node history";
  content.appendChild(nodeHead);

  var nodeList = document.createElement("ol");
  nodeList.className = "inspect-nodes";
  var nodes = run.nodes || run.node_history || [];
  for (var j = 0; j < nodes.length; j++) {
    var n = nodes[j];
    var nodeLi = document.createElement("li");
    nodeLi.className = "inspect-node";
    var nName = document.createElement("span");
    nName.className = "node-name";
    nName.textContent = n.node || "";
    var nStatus = document.createElement("span");
    nStatus.className = "node-status";
    nStatus.textContent = n.status || "";
    nodeLi.appendChild(nName);
    nodeLi.appendChild(nStatus);
    nodeList.appendChild(nodeLi);
  }
  content.appendChild(nodeList);

  pane.appendChild(content);
}

/* ---- Log tails ------------------------------------------- */

function renderLogTails(err, out) {
  var errEl = document.getElementById("launchd-err-tail");
  if (errEl) errEl.textContent = err;
  var outEl = document.getElementById("launchd-out-tail");
  if (outEl) outEl.textContent = out;
}

/* ---- Utility --------------------------------------------- */

function relativeTime(isoStr) {
  if (!isoStr) return "";
  var ts = Date.parse(isoStr);
  if (isNaN(ts)) return isoStr;
  var diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60)    return diff + "s ago";
  if (diff < 3600)  return Math.round(diff / 60) + "m ago";
  if (diff < 86400) return Math.round(diff / 3600) + "h ago";
  return Math.round(diff / 86400) + "d ago";
}

/* ---- Bootstrap ------------------------------------------- */

function bootstrap() {
  /* On desktop, force-open the artifact details */
  var details = document.getElementById("artifact-details");
  if (details && window.innerWidth >= 1280) {
    details.open = true;
  }

  /* Re-apply on resize */
  window.addEventListener("resize", function() {
    var det = document.getElementById("artifact-details");
    if (det && window.innerWidth >= 1280) det.open = true;
  });

  startCountdownTicker();
  tick();
}

document.addEventListener("DOMContentLoaded", bootstrap);
