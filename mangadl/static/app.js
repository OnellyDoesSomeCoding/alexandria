"use strict";

const $ = (selector) => document.querySelector(selector);

const state = {
  series: null,      // { id, title, has_cover, chapters: [{ id, name, number }] }
  selected: new Set(),
  lastClicked: null, // index of the last clicked chip, for shift-click
  job: null,
  events: null,
};

// ---------- helpers ----------

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
  return data;
}

function showMessage(text) {
  $("#message").textContent = text || "";
  $("#message").hidden = !text;
}

const formatNumber = (n) => String(n); // 4 -> "4", 10.5 -> "10.5"

function formatSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- loading a series ----------

$("#load-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#load-btn");
  button.disabled = true;
  button.textContent = "Loading…";
  showMessage("");
  try {
    const series = await api("POST", "/api/series", { url: $("#url").value.trim() });
    renderSeries(series);
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Load";
  }
});

function renderSeries(series) {
  state.series = series;
  state.selected = new Set();
  state.lastClicked = null;

  $("#title").textContent = series.title;
  const numbered = series.chapters.filter((c) => c.number !== null).length;
  const extras = series.chapters.length - numbered;
  $("#chapter-count").textContent = `${numbered} chapters` + (extras ? `, ${extras} extras` : "");

  const cover = $("#cover");
  cover.hidden = !series.has_cover;
  if (series.has_cover) {
    cover.onerror = () => { cover.hidden = true; };
    cover.src = `/api/series/${series.id}/cover`;
  }

  const grid = $("#grid");
  grid.replaceChildren(...series.chapters.map((chapter, index) => {
    const label = document.createElement("label");
    label.className = chapter.number === null ? "chip extra" : "chip";
    label.title = chapter.name;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.index = index;
    const text = document.createElement("span");
    text.textContent = chapter.number === null ? chapter.name : formatNumber(chapter.number);
    label.append(input, text);
    return label;
  }));

  $("#range").value = "";
  $("#range-error").hidden = true;
  $("#series").hidden = false;
  updateSelectionUI();
}

// ---------- selecting chapters ----------

function setSelection(ids, { updateRange = true } = {}) {
  state.selected = new Set(ids);
  for (const input of $("#grid").querySelectorAll("input")) {
    input.checked = state.selected.has(state.series.chapters[input.dataset.index].id);
  }
  if (updateRange) $("#range").value = describeSelection();
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selected.size;
  $("#selected-count").textContent = `${count} chapter${count === 1 ? "" : "s"} selected`;
  const busy = state.job && (state.job.state === "queued" || state.job.state === "running");
  $("#download-btn").disabled = count === 0 || busy;
}

// Turn the ticked numbered chapters into text like "1-20,25,30-32".
function describeSelection() {
  const numbered = state.series.chapters.filter((c) => c.number !== null);
  if (numbered.length && numbered.every((c) => state.selected.has(c.id))) return "all";
  const parts = [];
  let runStart = null;
  numbered.forEach((chapter, i) => {
    const on = state.selected.has(chapter.id);
    if (on && runStart === null) runStart = i;
    const runEnds = runStart !== null && (!on || i === numbered.length - 1);
    if (runEnds) {
      const end = on ? i : i - 1;
      const a = numbered[runStart].number;
      const b = numbered[end].number;
      parts.push(a === b ? formatNumber(a) : `${formatNumber(a)}-${formatNumber(b)}`);
      runStart = null;
    }
  });
  return parts.join(",");
}

$("#grid").addEventListener("click", (event) => {
  const input = event.target.closest("input[type=checkbox]");
  if (!input) return;
  const index = Number(input.dataset.index);
  const chapters = state.series.chapters;
  if (event.shiftKey && state.lastClicked !== null) {
    const [from, to] = [Math.min(index, state.lastClicked), Math.max(index, state.lastClicked)];
    for (let i = from; i <= to; i++) {
      if (input.checked) state.selected.add(chapters[i].id);
      else state.selected.delete(chapters[i].id);
    }
  } else if (input.checked) {
    state.selected.add(chapters[index].id);
  } else {
    state.selected.delete(chapters[index].id);
  }
  state.lastClicked = index;
  $("#range-error").hidden = true;
  setSelection(state.selected);
});

const applyRange = debounce(async () => {
  const spec = $("#range").value.trim();
  const error = $("#range-error");
  if (!spec) {
    error.hidden = true;
    setSelection([], { updateRange: false });
    return;
  }
  try {
    const { chapter_ids } = await api("POST", "/api/select", {
      series_id: state.series.id,
      spec,
      include_extras: $("#include-extras").checked,
    });
    error.hidden = true;
    setSelection(chapter_ids, { updateRange: false });
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
}, 300);

$("#range").addEventListener("input", applyRange);
$("#include-extras").addEventListener("change", applyRange);

document.querySelectorAll("[data-select]").forEach((button) => {
  button.addEventListener("click", () => {
    const chapters = state.series.chapters;
    const numbered = chapters.filter((c) => c.number !== null);
    const choice = button.dataset.select;
    $("#range-error").hidden = true;
    if (choice === "all") setSelection(numbered.map((c) => c.id));
    if (choice === "none") setSelection([]);
    if (choice === "latest") setSelection(numbered.slice(-10).map((c) => c.id));
  });
});

// ---------- downloading ----------

$("#download-btn").addEventListener("click", async () => {
  showMessage("");
  try {
    const job = await api("POST", "/api/jobs", {
      series_id: state.series.id,
      chapter_ids: [...state.selected],
    });
    followJob(job);
  } catch (error) {
    showMessage(error.message);
  }
});

$("#cancel-btn").addEventListener("click", async () => {
  if (!state.job) return;
  try {
    await api("DELETE", `/api/jobs/${state.job.id}`);
  } catch (error) {
    showMessage(error.message);
  }
});

function followJob(job) {
  if (state.events) state.events.close();
  $("#job").hidden = false;
  renderJob(job);
  const events = new EventSource(`/api/jobs/${job.id}/events`);
  state.events = events;
  events.onmessage = (message) => {
    const snapshot = JSON.parse(message.data);
    renderJob(snapshot);
    if (["done", "failed", "cancelled"].includes(snapshot.state)) events.close();
  };
  events.onerror = () => {
    // The stream closes normally when the job finishes; only report a real drop.
    if (state.job && (state.job.state === "queued" || state.job.state === "running")) {
      events.close();
      $("#job-status").textContent = "Lost contact with the app. Is it still running?";
    }
  };
}

function renderJob(job) {
  state.job = job;
  const fill = $("#bar-fill");
  const status = $("#job-status");
  const active = job.state === "queued" || job.state === "running";
  $("#cancel-btn").hidden = !active;
  $("#job-done").hidden = job.state !== "done";
  fill.classList.toggle("busy", job.state === "running" && job.stage === "building");

  if (job.state === "queued") {
    status.textContent = "Waiting to start…";
    fill.style.width = "0";
  } else if (job.state === "running" && job.stage === "building") {
    status.textContent = "Building PDF…";
  } else if (job.state === "running") {
    const pages = job.page_total ? ` · page ${job.page_done}/${job.page_total}` : "";
    const name = job.chapter_name ? ` (${job.chapter_name})` : "";
    status.textContent = `Chapter ${job.chapter_index} of ${job.chapter_total}${name}${pages}`;
    const chapterShare = job.page_total ? job.page_done / job.page_total : 0;
    const percent = ((Math.max(job.chapter_index - 1, 0) + chapterShare) / job.chapter_total) * 100;
    fill.style.width = `${percent.toFixed(1)}%`;
  } else if (job.state === "done") {
    status.textContent = "Done";
    fill.style.width = "100%";
    $("#job-file").textContent = `${job.filename} · ${job.page_count} pages · ${formatSize(job.size)}`;
    $("#save-link").href = `/api/jobs/${job.id}/file`;
  } else if (job.state === "cancelled") {
    status.textContent = "Cancelled. Downloaded images were kept, so downloading the same chapters again resumes.";
  } else if (job.state === "failed") {
    status.textContent = `Failed: ${job.error}`;
  }
  updateSelectionUI();
}
