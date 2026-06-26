const REPO_OWNER = "snakebam";
const REPO_NAME = "sheepfold";
const DATA_PATH = "data.json";
const BRANCH = "master";

let state = null;
let dataSha = null;
let editing = false;
let token = sessionStorage.getItem("sf_token") || null;

const calendarEl = document.getElementById("calendar");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const daysLeftLabel = document.getElementById("daysLeftLabel");
const editToggle = document.getElementById("editToggle");
const saveBtn = document.getElementById("saveBtn");
const statusMsg = document.getElementById("statusMsg");
const tokenModal = document.getElementById("tokenModal");
const tokenInput = document.getElementById("tokenInput");
const tokenCancel = document.getElementById("tokenCancel");
const tokenConfirm = document.getElementById("tokenConfirm");

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function loadData() {
  // cache-bust so viewers always see the latest committed state
  const res = await fetch(`${DATA_PATH}?t=${Date.now()}`);
  state = await res.json();
  render();
}

function render() {
  calendarEl.innerHTML = "";
  const today = todayStr();
  let total = 0, done = 0;

  state.days.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (day.gray) cell.classList.add("gray");
    if (day.date === today) cell.classList.add("today");
    cell.dataset.date = day.date;

    const dateLabel = document.createElement("div");
    dateLabel.className = "day-date";
    dateLabel.textContent = formatDate(day.date);
    cell.appendChild(dateLabel);

    const list = document.createElement("ul");
    list.className = "day-tasks";
    list.dataset.date = day.date;

    day.tasks.forEach((task) => {
      total++;
      if (task.done) done++;
      list.appendChild(renderTask(task));
    });

    cell.appendChild(list);

    if (editing) {
      const addBtn = document.createElement("button");
      addBtn.className = "add-task-btn";
      addBtn.type = "button";
      addBtn.textContent = "+ add task";
      addBtn.addEventListener("click", () => addTask(day));
      cell.appendChild(addBtn);
    }

    calendarEl.appendChild(cell);

    if (editing) initSortable(list);
  });

  const pct = total ? Math.round((done / total) * 100) : 0;
  progressFill.style.width = pct + "%";
  progressLabel.textContent = `${done} / ${total} tasks complete (${pct}%)`;

  const daysRemaining = state.days.filter((d) => !d.gray && d.date >= today).length;
  daysLeftLabel.textContent = `${daysRemaining} days left`;
}

function renderTask(task) {
  const li = document.createElement("li");
  li.className = "task-item" + (task.done ? " done" : "");
  li.dataset.id = task.id;

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!task.done;
  cb.disabled = !editing;
  cb.addEventListener("change", () => {
    task.done = cb.checked;
    li.classList.toggle("done", cb.checked);
  });

  const span = document.createElement("span");
  span.textContent = task.text;

  li.appendChild(cb);
  li.appendChild(span);

  if (editing) {
    const del = document.createElement("button");
    del.className = "delete-task-btn";
    del.type = "button";
    del.textContent = "×";
    del.title = "Delete task";
    del.addEventListener("click", () => deleteTask(task.id));
    li.appendChild(del);
  }

  return li;
}

function addTask(day) {
  const text = prompt("New task:");
  if (!text || !text.trim()) return;
  const id = "t" + Date.now() + Math.floor(Math.random() * 1000);
  day.tasks.push({ id, text: text.trim(), done: false });
  render();
}

function deleteTask(taskId) {
  state.days.forEach((day) => {
    day.tasks = day.tasks.filter((t) => t.id !== taskId);
  });
  render();
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initSortable(listEl) {
  Sortable.create(listEl, {
    group: "tasks",
    animation: 150,
    onEnd: syncOrderFromDom,
  });
}

function syncOrderFromDom() {
  const lists = calendarEl.querySelectorAll(".day-tasks");
  const byId = {};
  state.days.forEach((d) => d.tasks.forEach((t) => (byId[t.id] = t)));

  lists.forEach((list) => {
    const date = list.dataset.date;
    const day = state.days.find((d) => d.date === date);
    const ids = Array.from(list.children).map((li) => li.dataset.id);
    day.tasks = ids.map((id) => byId[id]);
  });
}

function enterEditMode() {
  editing = true;
  document.body.classList.add("editing");
  editToggle.textContent = "Cancel";
  saveBtn.classList.remove("hidden");
  render();
}

function exitEditMode() {
  editing = false;
  document.body.classList.remove("editing");
  editToggle.textContent = "Edit";
  saveBtn.classList.add("hidden");
  render();
}

editToggle.addEventListener("click", () => {
  if (editing) {
    exitEditMode();
    return;
  }
  if (token) {
    enterEditMode();
  } else {
    tokenModal.classList.remove("hidden");
    tokenInput.focus();
  }
});

tokenCancel.addEventListener("click", () => tokenModal.classList.add("hidden"));
tokenConfirm.addEventListener("click", () => {
  const val = tokenInput.value.trim();
  if (!val) return;
  token = val;
  sessionStorage.setItem("sf_token", token);
  tokenModal.classList.add("hidden");
  tokenInput.value = "";
  enterEditMode();
});

saveBtn.addEventListener("click", saveData);

async function saveData() {
  if (!token) return;
  statusMsg.textContent = "Saving...";
  try {
    const shaRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}?ref=${BRANCH}&_=${Date.now()}`,
      { headers: { Authorization: `token ${token}` }, cache: "no-store" }
    );
    if (!shaRes.ok) {
      const errBody = await shaRes.json().catch(() => ({}));
      if (shaRes.status === 401) {
        token = null;
        sessionStorage.removeItem("sf_token");
      }
      throw new Error(
        `Could not fetch current file (HTTP ${shaRes.status}: ${errBody.message || "unknown error"}).`
      );
    }
    const shaJson = await shaRes.json();
    dataSha = shaJson.sha;

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(state, null, 2))));

    const putRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Update progress",
          content,
          sha: dataSha,
          branch: BRANCH,
        }),
      }
    );
    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || "Save failed.");
    }
    statusMsg.textContent = "Saved. Live for everyone within a minute.";
    exitEditMode();
  } catch (e) {
    statusMsg.textContent = "Error: " + e.message;
  }
}

loadData();
