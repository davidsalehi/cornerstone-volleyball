// Cornerstone Volleyball Teams (Shared Sync, Fixed Teams)
// Tech: Firebase Auth (anonymous + admin email/password), Firestore, Storage
// Deploy: GitHub Pages (static)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-storage.js";

/* ===========================
   REQUIRED SETUP
=========================== */

// 1) Paste your Firebase config here (Project settings -> Your apps -> Web app config)
const firebaseConfig = {
apiKey: "AIzaSyC911FJT_ByP212GvHZyH69Tx-i1GeUz6w",
  authDomain: "cornerstone-volleyball-teams.firebaseapp.com",
  projectId: "cornerstone-volleyball-teams",
  storageBucket: "cornerstone-volleyball-teams.firebasestorage.app",
  messagingSenderId: "969371955303",
  appId: "1:969371955303:web:2685a92de276f61c25a4c2",
  measurementId: "G-VTRKHW3T6Y"
};

// 2) Set the admin email you will create in Firebase Authentication (Email/Password)
const ADMIN_EMAIL = "davidsalehi@outlook.com";

// App constants
const TEAM_SIZE = 6;
const SKILL_SCORE = { Beginner: 1, Intermediate: 2, Advanced: 3 };

/* ===========================
   INIT
=========================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

/* ===========================
   DOM
=========================== */

const authStatus = document.getElementById("authStatus");
const monthLabel = document.getElementById("monthLabel");

const adminBtn = document.getElementById("adminBtn");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");

const modalBackdrop = document.getElementById("modalBackdrop");
const adminModal = document.getElementById("adminModal");
const closeAdminModal = document.getElementById("closeAdminModal");
const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminPasscode = document.getElementById("adminPasscode");
const adminEmailHint = document.getElementById("adminEmailHint");

const prizeImg = document.getElementById("prizeImg");
const prizePlaceholder = document.getElementById("prizePlaceholder");
const prizeName = document.getElementById("prizeName");
const prizeAdminControls = document.getElementById("prizeAdminControls");
const prizeNameInput = document.getElementById("prizeNameInput");
const prizePhotoInput = document.getElementById("prizePhotoInput");
const savePrizeBtn = document.getElementById("savePrizeBtn");
const clearPrizeBtn = document.getElementById("clearPrizeBtn");

const playerForm = document.getElementById("playerForm");
const firstName = document.getElementById("firstName");
const lastName = document.getElementById("lastName");
const skill = document.getElementById("skill");
const playerPhoto = document.getElementById("playerPhoto");

const rosterEl = document.getElementById("roster");

const generateTeamsBtn = document.getElementById("generateTeamsBtn");
const clearAssignmentsBtn = document.getElementById("clearAssignmentsBtn");
const resetWinsBtn = document.getElementById("resetWinsBtn");

const teamMeta = document.getElementById("teamMeta");
const teamsEl = document.getElementById("teams");
const benchList = document.getElementById("benchList");

const galleryInput = document.getElementById("galleryInput");
const addGalleryBtn = document.getElementById("addGalleryBtn");
const galleryEl = document.getElementById("gallery");

/* ===========================
   STATE
=========================== */

let currentUser = null;
let isAdmin = false;

let players = [];          // [{id, first, last, skill, photoUrl, createdAt}]
let attendance = new Map(); // playerId -> { absent }
let assignments = new Map(); // playerId -> { teamId|null }
let prize = { name: "", photoUrl: "" };
let winsByTeam = new Map(); // teamId -> count
let photos = [];           // [{id, url, storagePath, createdAt}]

const monthKey = getMonthKey();

/* ===========================
   AUTH BOOT
=========================== */

adminEmailHint.textContent = `Admin account: ${ADMIN_EMAIL}`;
monthLabel.textContent = `Month: ${monthKey}`;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authStatus.textContent = "Signing in…";
    await signInAnonymously(auth);
    return;
  }
  currentUser = user;
  isAdmin = !!(user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && !user.isAnonymous);

  authStatus.textContent = isAdmin
    ? `Admin: ${ADMIN_EMAIL}`
    : `Connected`;

  updateAdminUI();
  startListeners();
});

async function adminLogin(pass) {
  if (!pass) throw new Error("Enter admin password.");
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pass);
}

async function adminLogout() {
  // Sign out and return to anonymous
  await signOut(auth);
  await signInAnonymously(auth);
}

/* ===========================
   LISTENERS
=========================== */

let unsubs = [];

function startListeners() {
  // clean up
  unsubs.forEach((u) => u && u());
  unsubs = [];

  // Players
  unsubs.push(
    onSnapshot(query(collection(db, "players"), orderBy("createdAt", "asc")), (snap) => {
      players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAll();
    }, (err) => showError(err))
  );

  // Attendance (current session)
  unsubs.push(
    onSnapshot(collection(db, "sessions", "current", "attendance"), (snap) => {
      attendance.clear();
      snap.forEach(d => attendance.set(d.id, d.data()));
      renderAll();
    }, (err) => showError(err))
  );

  // Assignments (fixed teams)
  unsubs.push(
    onSnapshot(collection(db, "sessions", "current", "assignments"), (snap) => {
      assignments.clear();
      snap.forEach(d => assignments.set(d.id, d.data()));
      renderAll();
    }, (err) => showError(err))
  );

  // Prize
  unsubs.push(
    onSnapshot(doc(db, "config", "prize"), (d) => {
      prize = d.exists() ? d.data() : { name: "", photoUrl: "" };
      renderAll();
    }, (err) => showError(err))
  );

  // Wins for this month
  unsubs.push(
    onSnapshot(collection(db, "months", monthKey, "wins"), (snap) => {
      winsByTeam.clear();
      snap.forEach(d => winsByTeam.set(Number(d.id), d.data().count || 0));
      renderAll();
    }, (err) => showError(err))
  );

  // Gallery photos
  unsubs.push(
    onSnapshot(query(collection(db, "photos"), orderBy("createdAt", "desc")), (snap) => {
      photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAll();
    }, (err) => showError(err))
  );
}

/* ===========================
   EVENTS
=========================== */

adminBtn.addEventListener("click", openAdminModal);
closeAdminModal.addEventListener("click", closeAdminModalFn);
modalBackdrop.addEventListener("click", closeAdminModalFn);

adminLoginBtn.addEventListener("click", async () => {
  try {
    const pass = adminPasscode.value.trim();
    await adminLogin(pass);
    adminPasscode.value = "";
    closeAdminModalFn();
  } catch (e) {
    alert(humanizeError(e));
  }
});

adminLogoutBtn.addEventListener("click", async () => {
  try {
    await adminLogout();
  } catch (e) {
    alert(humanizeError(e));
  }
});

playerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const f = firstName.value.trim();
    const l = lastName.value.trim();
    const s = skill.value;

    if (!f || !l) return;

    const file = playerPhoto.files?.[0] || null;

    await addPlayer({ first: f, last: l, skill: s, photoFile: file });

    firstName.value = "";
    lastName.value = "";
    skill.value = "Beginner";
    playerPhoto.value = "";
  } catch (e2) {
    alert(humanizeError(e2));
  }
});

savePrizeBtn?.addEventListener("click", async () => {
  if (!isAdmin) return;
  try {
    const name = prizeNameInput.value.trim();
    const file = prizePhotoInput.files?.[0] || null;
    await savePrize({ name, photoFile: file });
    prizeNameInput.value = "";
    prizePhotoInput.value = "";
  } catch (e) {
    alert(humanizeError(e));
  }
});

clearPrizeBtn?.addEventListener("click", async () => {
  if (!isAdmin) return;
  try {
    await setDoc(doc(db, "config", "prize"), {
      name: "",
      photoUrl: "",
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    }, { merge: true });
  } catch (e) {
    alert(humanizeError(e));
  }
});

generateTeamsBtn.addEventListener("click", async () => {
  if (!isAdmin) return;
  try {
    await generateTeamsFixed();
  } catch (e) {
    alert(humanizeError(e));
  }
});

clearAssignmentsBtn.addEventListener("click", async () => {
  if (!isAdmin) return;
  try {
    if (!confirm("Clear all team assignments? This will unassign everyone.")) return;

    const batch = writeBatch(db);
    for (const p of players) {
      batch.set(doc(db, "sessions", "current", "assignments", p.id), {
        teamId: null,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      }, { merge: true });
    }
    batch.set(doc(db, "sessions", "current"), {
      clearedAt: serverTimestamp(),
      clearedBy: currentUser.uid
    }, { merge: true });

    await batch.commit();
  } catch (e) {
    alert(humanizeError(e));
  }
});

resetWinsBtn.addEventListener("click", async () => {
  if (!isAdmin) return;
  try {
    if (!confirm(`Reset wins for ${monthKey}?`)) return;

    // Delete each win doc
    const batch = writeBatch(db);
    for (const [teamId] of winsByTeam.entries()) {
      batch.delete(doc(db, "months", monthKey, "wins", String(teamId)));
    }
    await batch.commit();
  } catch (e) {
    alert(humanizeError(e));
  }
});

addGalleryBtn.addEventListener("click", async () => {
  try {
    const files = Array.from(galleryInput.files || []);
    if (!files.length) return alert("Select one or more photos.");

    for (const file of files) {
      await uploadGamePhoto(file);
    }
    galleryInput.value = "";
  } catch (e) {
    alert(humanizeError(e));
  }
});

/* ===========================
   FIRESTORE / STORAGE MUTATIONS
=========================== */

async function addPlayer({ first, last, skill, photoFile }) {
  // Upload photo first (optional)
  let photoUrl = "";
  let storagePath = "";

  if (photoFile) {
    const playerIdForPath = crypto.randomUUID();
    storagePath = `playerPhotos/${playerIdForPath}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, photoFile);
    photoUrl = await getDownloadURL(storageRef);
  }

  await addDoc(collection(db, "players"), {
    first,
    last,
    skill,
    photoUrl,
    photoStoragePath: storagePath || "",
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid
  });
}

async function setAbsent(playerId, absentBool) {
  await setDoc(doc(db, "sessions", "current", "attendance", playerId), {
    absent: !!absentBool,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  }, { merge: true });
}

async function savePrize({ name, photoFile }) {
  let photoUrl = prize.photoUrl || "";
  let storagePath = prize.storagePath || "prize/current";

  if (photoFile) {
    storagePath = "prize/current";
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, photoFile);
    photoUrl = await getDownloadURL(storageRef);
  }

  await setDoc(doc(db, "config", "prize"), {
    name: name || "",
    photoUrl,
    storagePath,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  }, { merge: true });
}

async function addWin(teamId, delta) {
  if (!isAdmin) throw new Error("Admin only");
  const current = winsByTeam.get(teamId) || 0;
  const next = Math.max(0, current + delta);

  await setDoc(doc(db, "months", monthKey, "wins", String(teamId)), {
    count: next,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  }, { merge: true });
}

async function uploadGamePhoto(file) {
  const photoId = crypto.randomUUID();
  const storagePath = `gamePhotos/${photoId}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  await setDoc(doc(db, "photos", photoId), {
    url,
    storagePath,
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid
  });
}

async function deleteGamePhoto(photo) {
  if (!isAdmin) return;
  if (!confirm("Delete this photo?")) return;

  // Delete Storage object then Firestore doc
  try {
    if (photo.storagePath) {
      await deleteObject(ref(storage, photo.storagePath));
    }
  } catch {
    // If storage delete fails (e.g., missing object), still try to remove metadata
  }
  await deleteDoc(doc(db, "photos", photo.id));
}

async function deletePlayer(player) {
  if (!isAdmin) return;
  if (!confirm(`Delete ${player.first} ${player.last}?`)) return;

  // Attempt to delete player photo from storage (if stored)
  try {
    if (player.photoStoragePath) {
      await deleteObject(ref(storage, player.photoStoragePath));
    }
  } catch {
    // ignore storage errors
  }

  // Delete player doc
  await deleteDoc(doc(db, "players", player.id));

  // Cleanup attendance + assignment
  try {
    await deleteDoc(doc(db, "sessions", "current", "attendance", player.id));
  } catch {}
  try {
    await deleteDoc(doc(db, "sessions", "current", "assignments", player.id));
  } catch {}
}

async function movePlayer(playerId, teamIdOrNull) {
  if (!isAdmin) return;
  await setDoc(doc(db, "sessions", "current", "assignments", playerId), {
    teamId: teamIdOrNull,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  }, { merge: true });
}

/* ===========================
   TEAM GENERATION (FIXED)
=========================== */

function skillScore(skill) {
  return SKILL_SCORE[skill] || 1;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBalancedAssignments(presentPlayers) {
  const numTeams = Math.floor(presentPlayers.length / TEAM_SIZE);
  const seats = numTeams * TEAM_SIZE;

  const ordered = presentPlayers
    .slice()
    .sort((a, b) => skillScore(b.skill) - skillScore(a.skill));

  // Add randomness so repeated clicks can yield different (still balanced) teams
  const shuffled = shuffle(ordered);

  const selected = shuffled.slice(0, seats);
  const bench = shuffled.slice(seats);

  const teams = Array.from({ length: numTeams }, (_, i) => ({
    id: i + 1,
    skillSum: 0,
    members: []
  }));

  for (const p of selected) {
    teams.sort((a, b) => (a.skillSum - b.skillSum) || (a.members.length - b.members.length));
    const t = teams[0];
    t.members.push(p);
    t.skillSum += skillScore(p.skill);
  }

  const assignmentMap = new Map(); // playerId -> teamId|null
  for (const t of teams) {
    for (const p of t.members) assignmentMap.set(p.id, t.id);
  }
  for (const p of bench) assignmentMap.set(p.id, null);

  return { numTeams, assignmentMap };
}

async function generateTeamsFixed() {
  if (!isAdmin) throw new Error("Admin only");

  const present = players.filter(p => !(attendance.get(p.id)?.absent === true));
  const { numTeams, assignmentMap } = buildBalancedAssignments(present);

  const batch = writeBatch(db);

  // Write assignment for every player: absent -> null, present -> teamId or null (bench)
  for (const p of players) {
    const absent = attendance.get(p.id)?.absent === true;
    const teamId = absent ? null : (assignmentMap.has(p.id) ? assignmentMap.get(p.id) : null);

    batch.set(doc(db, "sessions", "current", "assignments", p.id), {
      teamId,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    }, { merge: true });
  }

  batch.set(doc(db, "sessions", "current"), {
    generatedAt: serverTimestamp(),
    generatedBy: currentUser.uid,
    teamSize: TEAM_SIZE,
    numTeams
  }, { merge: true });

  await batch.commit();
}

/* ===========================
   RENDER
=========================== */
function renderAll() {
  renderPrize();
  renderRoster();
  renderTeams();
  renderGallery();
  updateAdminUI();
}

function updateAdminUI() {
  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !isAdmin);
  });
  adminLogoutBtn.classList.toggle("hidden", !isAdmin);

  prizeAdminControls.classList.toggle("hidden", !isAdmin);
}

function renderPrize() {
  const hasPhoto = !!prize.photoUrl;
  if (hasPhoto) {
    prizeImg.src = prize.photoUrl;
    prizeImg.style.display = "block";
    prizePlaceholder.style.display = "none";
  } else {
    prizeImg.removeAttribute("src");
    prizeImg.style.display = "none";
    prizePlaceholder.style.display = "flex";
  }

  const name = (prize.name || "").trim();
  prizeName.textContent = name ? name : "Not set";
}

function renderRoster() {
  if (!players.length) {
    rosterEl.innerHTML = `<div class="muted small">No players yet.</div>`;
    return;
  }

  const sorted = players.slice().sort((a, b) => {
    const aAbsent = attendance.get(a.id)?.absent === true;
    const bAbsent = attendance.get(b.id)?.absent === true;
    if (aAbsent !== bAbsent) return aAbsent ? 1 : -1;
    const an = `${a.last} ${a.first}`.toLowerCase();
    const bn = `${b.last} ${b.first}`.toLowerCase();
    return an.localeCompare(bn);
  });

  rosterEl.innerHTML = "";
  for (const p of sorted) {
    const absent = attendance.get(p.id)?.absent === true;

    const row = document.createElement("div");
    row.className = "player-row";

    const left = document.createElement("div");
    left.className = "player-left";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.innerHTML = `<img alt="" src="${p.photoUrl || placeholderAvatar(p)}" />`;

    const info = document.createElement("div");
    info.style.minWidth = "0";
    info.innerHTML = `
      <div class="player-name">
        ${escapeHtml(p.first)} ${escapeHtml(p.last)}
        <span class="badge">${escapeHtml(p.skill)}</span>
      </div>
      <div class="muted small">${absent ? "Absent today" : "Active"}</div>
    `;

    left.appendChild(avatar);
    left.appendChild(info);

    const right = document.createElement("div");
    right.className = "row wrap end";

    const absentLabel = document.createElement("label");
    absentLabel.className = "muted small";
    absentLabel.style.display = "flex";
    absentLabel.style.alignItems = "center";
    absentLabel.style.gap = "6px";
    absentLabel.innerHTML = `<input type="checkbox" ${absent ? "checked" : ""} /> Absent`;
    absentLabel.querySelector("input").addEventListener("change", async (e) => {
      try {
        await setAbsent(p.id, e.target.checked);
      } catch (err) {
        alert(humanizeError(err));
      }
    });

    right.appendChild(absentLabel);

    if (isAdmin) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        try {
          await deletePlayer(p);
        } catch (err) {
          alert(humanizeError(err));
        }
      });
      right.appendChild(delBtn);
    }

    row.appendChild(left);
    row.appendChild(right);
    rosterEl.appendChild(row);
  }
}

function renderTeams() {
  const activeCount = players.filter(p => !(attendance.get(p.id)?.absent === true)).length;

  // Determine if teams exist by checking any assignment with teamId != null
  const teamIds = [];
  for (const a of assignments.values()) {
    if (a && a.teamId) teamIds.push(a.teamId);
  }
  const maxTeamId = teamIds.length ? Math.max(...teamIds) : 0;

  if (!maxTeamId) {
    teamMeta.textContent = `Active players: ${activeCount}. Teams have not been generated yet.`;
    teamsEl.innerHTML = "";
    benchList.innerHTML = players.length
      ? players
          .filter(p => !(attendance.get(p.id)?.absent === true))
          .map(p => benchPill(p))
          .join("")
      : `<div class="muted small">No active players.</div>`;
    return;
  }

  const teams = Array.from({ length: maxTeamId }, (_, i) => ({
    id: i + 1,
    members: []
  }));

  const bench = [];

  // Group players into teams by assignment
  for (const p of players) {
    const absent = attendance.get(p.id)?.absent === true;
    const teamId = absent ? null : (assignments.get(p.id)?.teamId ?? null);

    if (teamId && teams[teamId - 1]) teams[teamId - 1].members.push(p);
    else if (!absent) bench.push(p);
  }

  // Sort each team by skill then name (presentation only)
  for (const t of teams) {
    t.members.sort((a, b) => {
      const ds = skillScore(b.skill) - skillScore(a.skill);
      if (ds !== 0) return ds;
      return `${a.last} ${a.first}`.toLowerCase().localeCompare(`${b.last} ${b.first}`.toLowerCase());
    });
  }

  teamsEl.innerHTML = "";

  // Meta: team sizes + warning if not exactly 6
  const sizes = teams.map(t => t.members.length);
  const anyNotSix = sizes.some(n => n !== TEAM_SIZE);
  teamMeta.textContent =
    `Active players: ${activeCount} • Teams: ${teams.length} • Bench: ${bench.length}` +
    (anyNotSix ? " • Note: Some teams are not size 6 (admin can move players or regenerate)." : "");

  for (const t of teams) {
    const card = document.createElement("div");
    card.className = "team-card";

    const wins = winsByTeam.get(t.id) || 0;
    const skillSum = t.members.reduce((sum, p) => sum + skillScore(p.skill), 0);

    const head = document.createElement("div");
    head.className = "team-head";

    head.innerHTML = `
      <div>
        <h3>Team ${t.id}</h3>
        <div class="team-meta">Players: ${t.members.length}/${TEAM_SIZE} • Skill total: ${skillSum} • Wins: ${wins}</div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "row end wrap";

    if (isAdmin) {
      const winPlus = document.createElement("button");
      winPlus.className = "btn primary";
      winPlus.textContent = "+ Win";
      winPlus.addEventListener("click", async () => {
        try { await addWin(t.id, +1); } catch (e) { alert(humanizeError(e)); }
      });

      const winMinus = document.createElement("button");
      winMinus.className = "btn secondary";
      winMinus.textContent = "− Win";
      winMinus.addEventListener("click", async () => {
        try { await addWin(t.id, -1); } catch (e) { alert(humanizeError(e)); }
      });

      actions.appendChild(winPlus);
      actions.appendChild(winMinus);
    }

    head.appendChild(actions);

    const list = document.createElement("div");
    list.className = "team-players";

    for (const p of t.members) {
      const chip = document.createElement("div");
      chip.className = "player-chip";

      const left = document.createElement("div");
      left.className = "chip-left";
      left.innerHTML = `
        <div class="avatar"><img alt="" src="${p.photoUrl || placeholderAvatar(p)}"></div>
        <div style="min-width:0">
          <div class="chip-name">${escapeHtml(p.first)} ${escapeHtml(p.last)}</div>
          <div class="chip-skill">${escapeHtml(p.skill)}</div>
        </div>
      `;

      const right = document.createElement("div");
      right.className = "chip-actions";

      if (isAdmin) {
        const sel = document.createElement("select");
        sel.innerHTML = [
          `<option value="">Move to…</option>`,
          ...teams.map(tt => `<option value="${tt.id}">Team ${tt.id}</option>`),
          `<option value="bench">Bench</option>`
        ].join("");

        sel.addEventListener("change", async (e) => {
          try {
            const v = e.target.value;
            if (!v) return;
            const teamId = (v === "bench") ? null : Number(v);
            await movePlayer(p.id, teamId);
            sel.value = "";
          } catch (err) {
            alert(humanizeError(err));
          }
        });

        right.appendChild(sel);
      }

      chip.appendChild(left);
      chip.appendChild(right);
      list.appendChild(chip);
    }

    card.appendChild(head);
    card.appendChild(list);
    teamsEl.appendChild(card);
  }

  // Render bench with admin "Move to..." dropdown
benchList.innerHTML = "";

if (!bench.length) {
  benchList.innerHTML = `<span class="muted small">No bench players.</span>`;
} else {
  for (const p of bench) {
    const chip = document.createElement("div");
    chip.className = "player-chip";

    const left = document.createElement("div");
    left.className = "chip-left";
    left.innerHTML = `
      <div class="avatar"><img alt="" src="${p.photoUrl || placeholderAvatar(p)}"></div>
      <div style="min-width:0">
        <div class="chip-name">${escapeHtml(p.first)} ${escapeHtml(p.last)}</div>
        <div class="chip-skill">${escapeHtml(p.skill)}</div>
      </div>
    `;

    const right = document.createElement("div");
    right.className = "chip-actions";

    // Admin move dropdown (from Bench -> Team X)
    if (isAdmin) {
      const sel = document.createElement("select");
      sel.innerHTML = [
        `<option value="">Move to…</option>`,
        ...teams.map(tt => `<option value="${tt.id}">Team ${tt.id}</option>`)
      ].join("");

      sel.addEventListener("change", async (e) => {
        try {
          const v = e.target.value;
          if (!v) return;
          await movePlayer(p.id, Number(v)); // move from bench to selected team
          sel.value = "";
        } catch (err) {
          alert(humanizeError(err));
        }
      });

      right.appendChild(sel);
    }

    chip.appendChild(left);
    chip.appendChild(right);
    benchList.appendChild(chip);
  }
}

function renderGallery() {
  if (!photos.length) {
    galleryEl.innerHTML = `<div class="muted small">No photos uploaded yet.</div>`;
    return;
  }

  galleryEl.innerHTML = "";
  for (const ph of photos) {
    const card = document.createElement("div");
    card.className = "photo-card";

    const img = document.createElement("img");
    img.src = ph.url;
    img.alt = "Game photo";

    card.appendChild(img);

    if (isAdmin) {
      const actions = document.createElement("div");
      actions.className = "photo-actions";

      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        try {
          await deleteGamePhoto(ph);
        } catch (e) {
          alert(humanizeError(e));
        }
      });

      actions.appendChild(del);
      card.appendChild(actions);
    }

    galleryEl.appendChild(card);
  }
}

/* ===========================
   MODAL
=========================== */

function openAdminModal() {
  modalBackdrop.classList.remove("hidden");
  adminModal.classList.remove("hidden");
  adminPasscode.value = "";
  adminPasscode.focus();
}

function closeAdminModalFn() {
  modalBackdrop.classList.add("hidden");
  adminModal.classList.add("hidden");
}

/* ===========================
   HELPERS
=========================== */

function getMonthKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function placeholderAvatar(p) {
  const initials = `${(p.first || " ")[0] || "?"}${(p.last || " ")[0] || "?"}`.toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
      <rect width="100%" height="100%" rx="18" ry="18" fill="#0a0f1c"/>
      <text x="50%" y="54%" text-anchor="middle" font-size="64" font-family="Arial" fill="#a7b2cc">${initials}</text>
    </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function benchPill(p) {
  return `<span class="bench-pill">${escapeHtml(p.first)} ${escapeHtml(p.last)} (${escapeHtml(p.skill)})</span>`;
}

function showError(err) {
  // Avoid spamming alerts from listener permissions during setup;
  // You can convert this to UI banners if desired.
  console.error(err);
}

function humanizeError(e) {
  if (!e) return "Unknown error.";
  if (typeof e === "string") return e;
  const msg = e.message || "Error.";
  // Helpful Firebase auth codes
  if (e.code === "auth/invalid-credential" || e.code === "auth/wrong-password") return "Incorrect admin password.";
  if (e.code === "auth/user-not-found") return "Admin account not found in Firebase Auth.";
  if (e.code === "permission-denied") return "Permission denied (check Firestore/Storage rules).";
  return msg;

}



