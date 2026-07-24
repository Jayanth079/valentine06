/* Voyage renderer — talks to main process only via window.voyage (preload.js) */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- stage definitions (the 7-stage pipeline from the README) ----------
const STAGES = [
  { key: "intake", label: "1 Intake", web: false,
    instr: `Stage 1 — INTAKE. Produce a document checklist and status table for this student's Italy application. Cover: passport, 10th/12th marksheets, degree + transcripts (if Master), English proficiency proof, CV, SOP, LORs, CIMEA Statement of Comparability OR Declaration of Value (flag the 2-3 month lead time), apostille/attestation, Universitaly pre-enrolment, ISEE Parificato income documents, financial proof for visa, health insurance, accommodation proof. Output a markdown table: Document | Status (have / missing / in progress — infer from the profile, else 'unknown') | Notes/lead time. End with the 3 most urgent items.` },
  { key: "profile", label: "2 Profile", web: false,
    instr: `Stage 2 — PROFILE BUILD. Write a clean applicant profile from the data provided: academic summary, strengths, weaknesses/risks (backlogs, low scores, missing English proof), positioning for Italian public-university admissions (English-taught programmes only), and what to emphasise in the SOP. Be honest about weaknesses and how to mitigate each.` },
  { key: "shortlist", label: "3 Shortlist", web: true,
    instr: `Stage 3 — SHORTLIST. Using web search, build a Reach / Match / Safe shortlist (2-3 each) of ENGLISH-TAUGHT programmes at Italian PUBLIC universities matching this student's field, level, and profile. For each: university, exact programme name, why it fits, entry requirements, and the application deadline. Mark every deadline "VERIFY" and give the official source URL you used. Do not invent programmes — only ones you confirmed via search.` },
  { key: "gaps", label: "4 Gaps", web: false,
    instr: `Stage 4 — ELIGIBILITY & GAPS. Compare the student's profile against typical requirements for their target level/field at Italian public universities. List concrete gaps and a to-do list with realistic lead times: CIMEA/DoV (2-3 months), English test booking-to-result (~1-2 months), apostille, ISEE Parificato. Output as a prioritised action table: Action | Owner (student/consultant) | Lead time | Deadline risk.` },
  { key: "application", label: "5 Application", web: false,
    instr: `Stage 5 — APPLICATION PACK. Draft the application materials: (a) tailored motivation letter (~400 words) for the top-choice programme, (b) CV bullet points in Europass style, (c) the portal fields/answers likely required. Where information is missing, insert [FILL: ...] placeholders. End the output with the line "=== HUMAN REVIEW REQUIRED — do not send without counsellor approval ===".` },
  { key: "scholarships", label: "6 Scholarships", web: true,
    instr: `Stage 6 — SCHOLARSHIPS. Using web search, list scholarships this student should target: regional DSU (name the correct regional agency for the shortlisted universities' regions, ISEE Parificato requirement, typical benefit, bando deadline), university merit scholarships, Invest Your Talent in Italy, MAECI grants. For each: eligibility vs this student's income/profile, required financial documents, and the deadline marked "VERIFY" with the official source URL.` },
];

const SYSTEM_BASE = (settings) => `You are Voyage, the AI engine inside a desktop app used by an Indian study-abroad consultancy${settings.counsellorName ? ` (counsellor: ${settings.counsellorName})` : ""} that places students into ENGLISH-TAUGHT programmes at Italian PUBLIC universities for the ${settings.academicYear || "upcoming"} intake.
Rules: consider only public (state) universities and only programmes taught in English. Students know English, not Italian. Be precise and honest; never invent deadlines, fees, or programmes — when using web search cite the official source URL, otherwise say what must be verified on Universitaly (universitaly.it). Use markdown. Amounts in EUR (with INR approximations where helpful). Today's date: ${new Date().toISOString().slice(0, 10)}.`;

// ---------- state ----------
let DB = { students: [] };
let SETTINGS = { hasApiKey: false, counsellorName: "", academicYear: "", encryptionAvailable: true };
let view = { nav: "dash", studentId: null, stage: "intake" };
let running = false;

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.voyage.saveData(DB).catch(() => {}), 400);
}

const curStudent = () => DB.students.find((s) => s.id === view.studentId) || null;

// ---------- tiny markdown-ish renderer (safe: escapes first) ----------
function md(text) {
  let h = esc(text);
  h = h.replace(/^#{1,4}\s*(.+)$/gm, "<h3x>$1</h3x>");
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<bx>$1</bx>");
  h = h.replace(/^[-*]\s+/gm, "• ");
  return h;
}

// ---------- sidebar ----------
function renderSidebar() {
  const rows = $("stuRows");
  rows.innerHTML = DB.students.map((s) => {
    const initials = (s.name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    return `<div class="stuRow ${view.nav === "student" && view.studentId === s.id ? "on" : ""}" data-stu="${s.id}">
      <div class="dotp">${esc(initials)}</div><div>${esc(s.name || "Unnamed")}</div></div>`;
  }).join("") || `<div style="padding:6px 16px;font-size:12px;color:var(--mut)">No students yet</div>`;
  rows.querySelectorAll("[data-stu]").forEach((el) => el.onclick = () => { view = { nav: "student", studentId: el.dataset.stu, stage: view.stage }; render(); });

  document.querySelectorAll(".navbtn").forEach((b) => b.classList.toggle("on", view.nav === b.dataset.nav));
  const ks = $("keyState");
  if (SETTINGS.hasApiKey) { ks.textContent = "✓ API key saved" + (SETTINGS.encryptionAvailable ? " (encrypted)" : " (plaintext!)"); ks.className = ""; }
  else { ks.textContent = "⚠ No API key — open Settings"; ks.className = "err"; }
}

// ---------- views ----------
function render() {
  renderSidebar();
  const body = $("body"); const title = $("title"); const hb = $("headBtns");
  hb.innerHTML = "";
  if (view.nav === "dash") return renderDash(body, title, hb);
  if (view.nav === "verify") return renderVerify(body, title);
  if (view.nav === "settings") return renderSettings(body, title);
  if (view.nav === "student") return renderStudent(body, title, hb);
}

// ----- dashboard (stage 7: digest) -----
function renderDash(body, title) {
  title.textContent = "Dashboard";
  const rows = DB.students.map((s) => {
    const chips = STAGES.map((st) => `<span class="chip ${s.stages && s.stages[st.key] ? "done" : ""}">${st.label.split(" ")[0]}</span>`).join("");
    return `<tr data-open="${s.id}"><td><b>${esc(s.name)}</b><div style="color:var(--mut);font-size:11.5px">${esc(s.level || "")} · ${esc(s.field || "")}</div></td><td>${chips}</td><td>${esc(s.notes || "").slice(0, 60)}</td></tr>`;
  }).join("");
  body.innerHTML = `
    <div class="card"><table>
      <tr><th>Student</th><th>Stages completed</th><th>Notes</th></tr>
      ${rows || `<tr><td colspan="3" style="color:var(--mut)">Add a student to begin (＋ button, bottom left).</td></tr>`}
    </table></div>
    <div class="card">
      <label>Stage 7 — Pipeline digest (urgency-sorted, risk flags, next action + owner)</label>
      <div class="runrow"><button class="btn" id="digestBtn" ${DB.students.length ? "" : "disabled"}>Generate digest</button><div class="spin"></div></div>
      <div class="out" id="digestOut">${DB.digest ? md(DB.digest) : ""}</div>
    </div>`;
  body.querySelectorAll("[data-open]").forEach((tr) => tr.onclick = () => { view = { nav: "student", studentId: tr.dataset.open, stage: "intake" }; render(); });
  $("digestBtn").onclick = async () => {
    const summary = DB.students.map((s) => {
      const done = STAGES.filter((st) => s.stages && s.stages[st.key]).map((st) => st.key).join(", ") || "none";
      return `- ${s.name}: ${s.level || "?"} in ${s.field || "?"}; stages done: ${done}; shortlist: ${(s.stages && s.stages.shortlist && s.stages.shortlist.output || "").slice(0, 600)}`;
    }).join("\n");
    await runStage($("digestBtn"), $("digestOut"), false,
      `Stage 7 — PIPELINE DIGEST. Here is the whole student pipeline:\n${summary}\n\nProduce an urgency-sorted digest: per student, current status, biggest risk flag, and the single next action with owner (student or consultant). Then a short "this week" priority list for the consultant.`,
      (text) => { DB.digest = text; persist(); });
  };
}

// ----- deadline verifier -----
function renderVerify(body, title) {
  title.textContent = "Deadline Verifier";
  body.innerHTML = `
    <div class="card">
      <div class="warn">Verifies one deadline live via web search and reports the official URL it used. Types: admission call, Universitaly pre-enrolment, DSU scholarship bando, visa appointment, TOLC/entry test.</div>
      <div class="grid">
        <div><label>University / body</label><input id="vUni" placeholder="e.g. University of Bologna"></div>
        <div><label>Programme (optional)</label><input id="vProg" placeholder="e.g. MSc Artificial Intelligence"></div>
        <div><label>Deadline type</label><select id="vType"><option>Admission application</option><option>Universitaly pre-enrolment</option><option>DSU scholarship bando</option><option>Visa appointment</option><option>TOLC / entry test</option></select></div>
      </div>
      <div class="runrow"><button class="btn" id="vBtn">Verify now</button><div class="spin"></div></div>
      <div class="out" id="vOut"></div>
    </div>`;
  $("vBtn").onclick = () => {
    const uni = $("vUni").value.trim(); if (!uni) return alert("Enter a university.");
    runStage($("vBtn"), $("vOut"), true,
      `DEADLINE VERIFIER. Using web search, find the current official deadline for: ${$("vType").value} — ${uni}${$("vProg").value ? `, programme: ${$("vProg").value}` : ""}, for the ${SETTINGS.academicYear || "next"} intake. Report: the deadline date(s), the official URL where you found it, when the page was last updated if visible, and a confidence note. If you cannot confirm from an official source, say so explicitly.`);
  };
}

// ----- settings -----
function renderSettings(body, title) {
  title.textContent = "Settings";
  body.innerHTML = `
    <div class="card">
      <div class="frow"><label>Anthropic API key ${SETTINGS.hasApiKey ? '<span class="ok">— saved ✓</span>' : '<span class="bad">— not set</span>'}</label>
        <input id="sKey" type="password" placeholder="${SETTINGS.hasApiKey ? "•••••••• (paste to replace, leave empty to keep)" : "sk-ant-…  (platform.claude.com → API keys)"}">
        <div class="meta">${SETTINGS.encryptionAvailable ? "Stored encrypted with your OS keychain." : "⚠ OS encryption unavailable — key will be stored in a plaintext file readable only by your user."}</div></div>
      <div class="grid">
        <div class="frow"><label>Counsellor name</label><input id="sName" value="${esc(SETTINGS.counsellorName)}"></div>
        <div class="frow"><label>Academic year</label><input id="sYear" placeholder="2026/27" value="${esc(SETTINGS.academicYear)}"></div>
      </div>
      <div class="btnrow">
        <button class="btn" id="sSave">Save settings</button>
        <button class="btn2" id="sTest">Test connection</button>
        <span id="sMsg" class="meta"></span>
      </div>
    </div>
    <div class="card">
      <label>Data</label>
      <div class="meta" style="margin-bottom:10px">All student data lives on this machine only. Export to back up or move between your Windows laptop and Mac.</div>
      <div class="btnrow"><button class="btn2" id="sExp">⤓ Export data</button><button class="btn2" id="sImp">⤒ Import data</button></div>
    </div>`;
  $("sSave").onclick = async () => {
    const key = $("sKey").value.trim();
    await window.voyage.setSettings({ ...(key ? { apiKey: key } : {}), counsellorName: $("sName").value.trim(), academicYear: $("sYear").value.trim() });
    SETTINGS = await window.voyage.getSettings();
    $("sKey").value = ""; $("sMsg").textContent = "Saved."; renderSidebar(); renderSettings(body, title);
  };
  $("sTest").onclick = async () => {
    $("sMsg").textContent = "Testing…";
    const r = await window.voyage.testAI();
    $("sMsg").innerHTML = r.ok ? `<span class="ok">✓ Connected — ${esc(r.model)} replied "${esc(r.reply.trim())}"</span>` : `<span class="bad">✗ ${esc(r.message)}</span>`;
  };
  $("sExp").onclick = () => window.voyage.exportData(DB);
  $("sImp").onclick = async () => {
    const r = await window.voyage.importData();
    if (!r) return;
    if (r.ok === false) return alert(r.message);
    const data = r.ok ? r.data : r; // tolerate old backup handler shape
    if (!data || !Array.isArray(data.students)) return alert("That file doesn't look like a Voyage backup.");
    if (!confirm(`Replace current data with ${data.students.length} imported student(s)?`)) return;
    DB = data; persist(); view = { nav: "dash", studentId: null, stage: "intake" }; render();
  };
}

// ----- student + 7 stages -----
function renderStudent(body, title, hb) {
  const s = curStudent();
  if (!s) { view.nav = "dash"; return render(); }
  title.textContent = s.name || "Student";
  hb.innerHTML = `<button class="btn2" id="editStu">Edit profile</button> <button class="btnD" id="delStu">Delete</button>`;
  $("editStu").onclick = () => studentModal(s);
  $("delStu").onclick = () => { if (confirm(`Delete ${s.name}? This removes all stage outputs.`)) { DB.students = DB.students.filter((x) => x.id !== s.id); persist(); view = { nav: "dash", studentId: null, stage: "intake" }; render(); } };

  const st = STAGES.find((x) => x.key === view.stage) || STAGES[0];
  const saved = (s.stages && s.stages[st.key]) || null;
  body.innerHTML = `
    <div class="card"><div class="grid">
      <div><label>Level / Field</label>${esc(s.level || "—")} · ${esc(s.field || "—")}</div>
      <div><label>10th / 12th / UG</label>${esc(s.m10 || "—")} / ${esc(s.m12 || "—")} / ${esc(s.ug || "—")}</div>
      <div><label>English</label>${esc(s.english || "—")}</div>
      <div><label>Family income</label>${esc(s.income || "—")}</div>
    </div></div>
    <div id="stageTabs">${STAGES.map((x) => `<button data-st="${x.key}" class="${x.key === st.key ? "on" : ""}">${x.label}${s.stages && s.stages[x.key] ? '<span class="done">✓</span>' : ""}</button>`).join("")}</div>
    <div class="card">
      <label>${esc(st.label)} ${st.web ? '<span class="webbadge">uses web search</span>' : ""}</label>
      <textarea id="extraNotes" placeholder="Optional extra instructions for this run (e.g. 'focus on Lombardy universities', 'budget max €1500/yr tuition')…"></textarea>
      <div class="runrow"><button class="btn" id="runBtn">${saved ? "Re-run stage" : "Run stage"}</button><div class="spin"></div>
        ${saved ? `<span class="meta">last run ${new Date(saved.ranAt).toLocaleString()}</span>` : ""}</div>
      <div class="out" id="stageOut">${saved ? md(saved.output) : ""}</div>
      <div class="srcs" id="stageSrcs">${saved && saved.sources && saved.sources.length ? "<label>Sources</label>" + saved.sources.map((x) => `<a data-url="${esc(x.url)}">↗ ${esc(x.title)}</a>`).join("") : ""}</div>
    </div>`;
  body.querySelectorAll("#stageTabs [data-st]").forEach((b) => b.onclick = () => { view.stage = b.dataset.st; render(); });
  wireSources(body);
  $("runBtn").onclick = () => {
    const profile = `STUDENT PROFILE
Name: ${s.name} | Applying for: ${s.level || "?"} in ${s.field || "?"} | Intake: ${SETTINGS.academicYear || "?"}
10th: ${s.m10 || "?"} | 12th: ${s.m12 || "?"} | UG: ${s.ug || "n/a"} | Backlogs: ${s.backlogs || "0"}
English proof: ${s.english || "none yet"} | Family income: ${s.income || "?"} | Budget note: ${s.budget || "?"}
Counsellor notes: ${s.notes || "—"}
Prior stage outputs available: ${Object.keys(s.stages || {}).join(", ") || "none"}${s.stages && s.stages.shortlist ? `\n\nCURRENT SHORTLIST (from stage 3):\n${s.stages.shortlist.output.slice(0, 3000)}` : ""}`;
    const extra = $("extraNotes").value.trim();
    runStage($("runBtn"), $("stageOut"), st.web,
      `${st.instr}\n\n${profile}${extra ? `\n\nADDITIONAL INSTRUCTIONS FROM COUNSELLOR: ${extra}` : ""}`,
      (text, sources) => {
        s.stages = s.stages || {};
        s.stages[st.key] = { output: text, sources, ranAt: Date.now() };
        persist(); render();
      });
  };
}

function studentModal(existing) {
  const s = existing || {};
  openModal(`
    <h2>${existing ? "Edit student" : "Add student"}</h2>
    <div class="grid">
      <div class="frow"><label>Full name *</label><input id="mName" value="${esc(s.name || "")}"></div>
      <div class="frow"><label>Applying for</label><select id="mLevel"><option ${s.level === "Bachelor" ? "selected" : ""}>Bachelor</option><option ${s.level !== "Bachelor" ? "selected" : ""}>Master</option></select></div>
      <div class="frow"><label>Field / subject</label><input id="mField" value="${esc(s.field || "")}" placeholder="Data Science"></div>
      <div class="frow"><label>10th %</label><input id="mM10" value="${esc(s.m10 || "")}"></div>
      <div class="frow"><label>12th %</label><input id="mM12" value="${esc(s.m12 || "")}"></div>
      <div class="frow"><label>UG % / CGPA</label><input id="mUg" value="${esc(s.ug || "")}"></div>
      <div class="frow"><label>Backlogs</label><input id="mBack" value="${esc(s.backlogs || "")}"></div>
      <div class="frow"><label>English proof + score</label><input id="mEng" value="${esc(s.english || "")}" placeholder="IELTS 6.5"></div>
      <div class="frow"><label>Family income (₹/yr)</label><input id="mInc" value="${esc(s.income || "")}" placeholder="4.5 LPA"></div>
      <div class="frow"><label>Budget note</label><input id="mBud" value="${esc(s.budget || "")}"></div>
    </div>
    <div class="frow"><label>Counsellor notes</label><textarea id="mNotes">${esc(s.notes || "")}</textarea></div>
    <div class="btnrow"><button class="btn" id="mSave">Save</button><button class="btn2" id="mCancel">Cancel</button></div>`);
  $("mCancel").onclick = closeModal;
  $("mSave").onclick = () => {
    const name = $("mName").value.trim(); if (!name) return alert("Name is required.");
    const upd = { name, level: $("mLevel").value, field: $("mField").value.trim(), m10: $("mM10").value.trim(), m12: $("mM12").value.trim(), ug: $("mUg").value.trim(), backlogs: $("mBack").value.trim(), english: $("mEng").value.trim(), income: $("mInc").value.trim(), budget: $("mBud").value.trim(), notes: $("mNotes").value.trim() };
    if (existing) Object.assign(existing, upd);
    else { const ns = { id: "s" + Date.now(), stages: {}, ...upd }; DB.students.push(ns); view = { nav: "student", studentId: ns.id, stage: "intake" }; }
    persist(); closeModal(); render();
  };
}

// ---------- AI runner (streaming) ----------
async function runStage(btn, outEl, useWebSearch, prompt, onSaved) {
  if (running) return;
  if (!SETTINGS.hasApiKey) { view.nav = "settings"; render(); return; }
  running = true;
  btn.disabled = true; btn.parentElement.classList.add("running");
  outEl.textContent = "";
  let acc = "";
  const res = await window.voyage.runAI(
    { system: SYSTEM_BASE(SETTINGS), prompt, useWebSearch },
    (delta) => { acc += delta; outEl.innerHTML = md(acc); outEl.scrollTop = outEl.scrollHeight; }
  ).catch((e) => ({ ok: false, code: "IPC", message: String(e && e.message || e) }));
  running = false; btn.disabled = false; btn.parentElement.classList.remove("running");

  if (!res || res.ok === false) {
    outEl.innerHTML = (res && res.partial ? md(res.partial) : "") +
      `<div class="errbox">✗ ${esc(res ? res.message : "Unknown error")}${res && res.code === "NO_API_KEY" ? ' — <u style="cursor:pointer" id="goSet">open Settings</u>' : ""}</div>`;
    const gs = outEl.querySelector("#goSet"); if (gs) gs.onclick = () => { view.nav = "settings"; render(); };
    return;
  }
  let warn = "";
  if (res.refusal) warn = "The model declined part of this request (safety classifier). Rephrase and re-run.";
  else if (res.truncated) warn = "⚠ Output hit the length limit — the answer above is INCOMPLETE. Re-run with narrower instructions.";
  else if (res.exhausted) warn = "⚠ Web research was cut off before finishing — treat results as partial and re-run.";
  outEl.innerHTML = md(res.text) + (warn ? `<div class="errbox">${esc(warn)}</div>` : "");
  if (onSaved && !res.refusal) onSaved(res.text, res.sources || []);
  // sources for ad-hoc panels (verifier) that don't re-render
  const srcEl = outEl.parentElement.querySelector(".srcs");
  if (srcEl && res.sources && res.sources.length) {
    srcEl.innerHTML = "<label>Sources</label>" + res.sources.map((x) => `<a data-url="${esc(x.url)}">↗ ${esc(x.title)}</a>`).join("");
    wireSources(srcEl);
  }
}

function wireSources(root) {
  root.querySelectorAll("[data-url]").forEach((a) => a.onclick = () => window.voyage.openExternal(a.dataset.url));
}

// ---------- modal ----------
function openModal(html) { $("modal").innerHTML = html; $("mask").classList.add("on"); }
function closeModal() { $("mask").classList.remove("on"); }
$("mask").addEventListener("click", (e) => { if (e.target === $("mask")) closeModal(); });

// ---------- boot ----------
document.querySelectorAll(".navbtn").forEach((b) => b.onclick = () => { view.nav = b.dataset.nav; view.studentId = null; render(); });
$("addStu").onclick = () => studentModal(null);

(async function boot() {
  try { SETTINGS = await window.voyage.getSettings(); } catch {}
  try { const d = await window.voyage.loadData(); if (d && Array.isArray(d.students)) DB = d; } catch {}
  if (!SETTINGS.hasApiKey) view.nav = "settings";
  render();
})();
