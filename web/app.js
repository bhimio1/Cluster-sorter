import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FIELDS = "id,label,make,models,year_start,year_end,part_numbers,tier,notes,source,updated_at,unknown_seen,last_seen_at";

let tiers = [];          // [{code,color_name,hex,description,sort_order}]
let clusters = [];
let photo = null;        // { base64, type }
let filterTier = null;

// ---------------- Auth ----------------
let recovering = false; // true while the user is setting a new password from a reset email

async function boot() {
  // A password-reset link lands here with "type=recovery" in the URL.
  recovering = /type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange((event, s) => {
    if (event === "PASSWORD_RECOVERY") recovering = true;
    if (recovering && s) return showNewPassword(s.user.email);
    showApp(!!s);
  });
  const { data: { session } } = await sb.auth.getSession();
  if (recovering && session) showNewPassword(session.user.email);
  else showApp(!!session);
}

function showNewPassword(email) {
  $("#app").hidden = true;
  $("#view-login").hidden = false;
  $("#login-form").hidden = true;
  $("#newpw-form").hidden = false;
  $("#newpw-email").textContent = email;
  $("#login-msg").textContent = "";
}

$("#newpw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#newpw").value });
  if (error) return ($("#login-msg").textContent = error.message);
  recovering = false;
  history.replaceState(null, "", location.pathname);
  $("#newpw-form").hidden = true;
  $("#login-form").hidden = false;
  toast("Password saved");
  showApp(true);
});

$("#forgot-btn").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  if (!email) return ($("#login-msg").textContent = "Type your email above first.");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $("#login-msg").textContent = error ? error.message : "Check your email for a link to set a new password.";
});

async function showApp(signedIn) {
  $("#view-login").hidden = signedIn;
  $("#app").hidden = !signedIn;
  if (signedIn && !tiers.length) await loadData();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $("#email").value, password: $("#password").value });
  $("#login-msg").textContent = error ? error.message : "";
});
$("#signup-btn").addEventListener("click", async () => {
  const email = $("#email").value, password = $("#password").value;
  if (!email || password.length < 6) return ($("#login-msg").textContent = "Enter an email and a password of 6+ characters.");
  // Send the confirmation link back to this page, not Supabase's default localhost URL.
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  $("#login-msg").textContent = error ? error.message : data.session ? "" : "Check your email to confirm, then sign in.";
});
$("#signout").addEventListener("click", () => sb.auth.signOut());

// ---------------- Data ----------------
async function loadData() {
  const [t, c] = await Promise.all([
    sb.from("tiers").select("*").order("sort_order"),
    sb.from("clusters").select(FIELDS).order("label"),
  ]);
  if (t.error || c.error) return toast((t.error || c.error).message);
  tiers = t.data;
  clusters = c.data;
  renderFilter();
  renderList();
}
const tierOf = (code) => tiers.find((t) => t.code === code) || { code, color_name: "?", hex: "#666", description: "" };
const dot = (code, cls = "") => `<span class="dot ${cls}" style="background:${tierOf(code).hex}">${esc(code)}</span>`;
const years = (c) => (c.year_start ? (c.year_end && c.year_end !== c.year_start ? `${c.year_start}–${c.year_end}` : `${c.year_start}`) : "");

function upsertLocal(c) {
  const i = clusters.findIndex((x) => x.id === c.id);
  if (i >= 0) clusters[i] = { ...clusters[i], ...c }; else clusters.push(c);
  clusters.sort((a, b) => a.label.localeCompare(b.label));
  renderFilter();
  renderList();
}

async function setTier(id, code) {
  const { data, error } = await sb.from("clusters").update({ tier: code }).eq("id", id).select(FIELDS).single();
  if (error) return toast(error.message), null;
  upsertLocal(data);
  toast(`Set to ${code} — ${tierOf(code).color_name}`);
  return data;
}

// ---------------- Tabs ----------------
document.querySelectorAll(".tabbar button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabbar button").forEach((x) => x.classList.toggle("active", x === b));
    $("#view-scan").hidden = b.dataset.view !== "scan";
    $("#view-list").hidden = b.dataset.view !== "list";
  }),
);

// ---------------- Scan ----------------
$("#photo").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  photo = await shrink(file);
  $("#preview").src = `data:${photo.type};base64,${photo.base64}`;
  $("#preview").hidden = false;
  $("#capture-hint").hidden = true;
  $("#result").hidden = true;
});

// Resize to ≤1568px JPEG so uploads are fast and the image fits the model's sweet spot.
async function shrink(file, max = 1568) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), type: "image/jpeg" };
}

// ---- Model choice (remembered on this phone) ----
const MODELS = [
  { key: "haiku", name: "Haiku" },
  { key: "sonnet", name: "Sonnet" },
  { key: "opus", name: "Opus" },
];
let model = "haiku";
try { model = localStorage.getItem("model") || "haiku"; } catch {}
function drawModelPick() {
  document.querySelectorAll(".model-pick button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.model === model)));
}
document.querySelectorAll(".model-pick button").forEach((b) =>
  b.addEventListener("click", () => {
    model = b.dataset.model;
    try { localStorage.setItem("model", model); } catch {}
    drawModelPick();
  }),
);
drawModelPick();

let lastInput = null; // { photo, hint } of the most recent lookup, for "search harder"

$("#lookup").addEventListener("click", () => {
  const hint = $("#pn-hint").value.trim();
  if (!photo && !hint) return toast("Take a photo or type a part number first");
  lastInput = { photo, hint };
  runLookup(model);
});

async function runLookup(modelKey, retryOf) {
  const btn = $("#lookup");
  btn.disabled = true;
  const res = $("#result");
  res.hidden = false;
  const name = MODELS.find((m) => m.key === modelKey)?.name;
  res.innerHTML = `<div class="loading"><div class="spinner"></div>Looking it up with ${esc(name)}…</div>`;
  try {
    const { photo: p, hint } = lastInput;
    const { data, error } = await sb.functions.invoke("lookup-cluster", {
      body: {
        image_base64: p?.base64, media_type: p?.type, part_number_hint: hint || undefined,
        model: modelKey, retry_of: retryOf,
      },
    });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    if (data.removed_id) {
      clusters = clusters.filter((c) => c.id !== data.removed_id);
      renderList();
    }
    showResult(data);
  } catch (e) {
    res.innerHTML = `<p><strong>Lookup failed.</strong> ${esc(e.message)}</p>${retryButtons(modelKey, retryOf, "Try with")}`;
    wireRetry(retryOf);
  } finally {
    btn.disabled = false;
  }
}

// Buttons to re-run the same photo with each bigger model than the one just used.
function retryButtons(usedKey, retryOf, verb = "Search harder with") {
  const i = MODELS.findIndex((m) => m.key === usedKey);
  const bigger = MODELS.slice(i + 1);
  if (!bigger.length) return "";
  return `<div class="retry">${bigger.map((m) => `<button type="button" class="btn ghost" data-retry="${m.key}">${verb} ${m.name}</button>`).join("")}</div>`;
}
function wireRetry(retryOf) {
  $("#result").querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => runLookup(b.dataset.retry, retryOf)));
}

function factsHtml(id) {
  if (!id) return "";
  const rows = [
    ["Part #", id.part_number],
    ["Vehicle", [id.make, id.model].filter(Boolean).join(" ")],
    ["Years", id.year_start ? (id.year_end && id.year_end !== id.year_start ? `${id.year_start}–${id.year_end}` : id.year_start) : null],
    ["Confidence", id.confidence],
    ["Why", id.reasoning],
  ].filter(([, v]) => v);
  return rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
}

function showResult(data) {
  const res = $("#result");
  if (data.status === "ambiguous") {
    res.innerHTML = `
      <p class="result-title">Could be one of these</p>
      <p class="result-sub">Pick the right bin, or add it as new.</p>
      <div class="candidates">
        ${data.candidates.map((c) => `<button class="btn ghost" data-pick="${c.id}" style="display:flex;gap:10px;align-items:center;text-align:left">${dot(c.tier, "sm")}<span>${esc(c.label)}</span></button>`).join("")}
        <button class="btn ghost" data-new>None of these — add as E (Unknown)</button>
      </div>
      ${factsHtml(data.identified)}
      ${data.model ? `<p class="muted small" style="margin:0">Not sure? Have a bigger model look:</p>${retryButtons(data.model)}` : ""}`;
    res.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => pickCandidate(b.dataset.pick, data.identified)));
    res.querySelector("[data-new]").addEventListener("click", () => addFromIdentified(data.identified));
    wireRetry();
    return;
  }
  renderClusterResult(data.cluster, data.status === "added", data.identified, data.model);
  upsertLocal(data.cluster);
}

function renderClusterResult(c, isNew, identified, usedModel) {
  const t = tierOf(c.tier);
  const res = $("#result");
  // Offer a bigger model when the first one couldn't find it, or wasn't sure of the match.
  // A new Unknown row is passed along so the retry replaces it instead of duplicating it.
  let retry = "";
  if (usedModel && isNew && c.tier === "E") {
    retry = `<p class="muted small" style="margin:0">Couldn't find it? Search harder:</p>${retryButtons(usedModel)}`;
  } else if (usedModel && !isNew && identified?.confidence && identified.confidence !== "high") {
    retry = `<p class="muted small" style="margin:0">Not the right bin? Search harder:</p>${retryButtons(usedModel)}`;
  }
  res.innerHTML = `
    <div class="result-head">
      ${dot(c.tier)}
      <div>
        <p class="result-title">${esc(t.code)} — ${esc(t.color_name)}</p>
        <p class="result-sub">${esc(c.label)}</p>
        ${isNew ? `<span class="badge new">New — added to database</span>` : `<span class="badge">In database</span>`}
        ${c.tier === "E" && c.unknown_seen > 1 ? `<span class="badge seen">Seen ${c.unknown_seen}×</span>` : ""}
      </div>
    </div>
    <p class="muted small" style="margin:0">${esc(t.description)}</p>
    ${factsHtml(identified)}
    ${usedModel ? `<p class="muted small" style="margin:0">Looked up with ${esc(MODELS.find((m) => m.key === usedModel)?.name)}</p>` : ""}
    ${retry}
    <p class="muted small" style="margin:0">Change tier:</p>
    <div class="tier-picker">${tierButtons(c.tier)}</div>`;
  res.querySelectorAll(".tier-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      const updated = await setTier(c.id, b.dataset.code);
      if (updated) renderClusterResult(updated, isNew, identified, usedModel);
    }),
  );
  wireRetry(isNew && c.tier === "E" ? c.id : undefined);
}

function tierButtons(selected) {
  return tiers.map((t) => `
    <button type="button" class="tier-btn ${t.code === selected ? "selected" : ""}" data-code="${t.code}" title="${esc(t.description)}">
      ${dot(t.code)}<span>${esc(t.color_name)}</span>
    </button>`).join("");
}

async function pickCandidate(id, identified) {
  const c = clusters.find((x) => x.id === id);
  if (!c) return;
  let updated = c;
  const pn = identified?.part_number?.toUpperCase();
  if (pn && !c.part_numbers.includes(pn)) {
    const { data, error } = await sb.from("clusters").update({ part_numbers: [...c.part_numbers, pn] }).eq("id", id).select(FIELDS).single();
    if (error) return toast(error.message);
    updated = data;
    upsertLocal(updated);
  }
  if (updated.tier === "E") {
    const { data } = await sb.rpc("bump_unknown", { p_id: id }).select(FIELDS).maybeSingle();
    if (data) { updated = data; upsertLocal(updated); }
  }
  renderClusterResult(updated, false, identified);
}

async function addFromIdentified(id) {
  const y1 = id?.year_start, y2 = id?.year_end ?? y1;
  const yy = (y) => String(y).slice(-2);
  const label = [y1 ? (y2 && y2 !== y1 ? `${yy(y1)}-${yy(y2)}` : `${y1}`) : "", id?.make, id?.model].filter(Boolean).join(" ")
    || (id?.part_number ? `Part ${id.part_number}` : "Unidentified cluster");
  const { data, error } = await sb.from("clusters").insert({
    label, make: id?.make, models: id?.model, year_start: y1, year_end: y2,
    part_numbers: id?.part_number ? [id.part_number.toUpperCase()] : [],
    tier: "E", notes: id?.description, source: "scan",
    unknown_seen: 1, last_seen_at: new Date().toISOString(),
  }).select(FIELDS).single();
  if (error) return toast(error.message);
  upsertLocal(data);
  renderClusterResult(data, true, id);
}

// ---------------- List ----------------
function renderFilter() {
  const chips = [`<button class="chip ${filterTier ? "" : "active"}" data-t="">All</button>`]
    .concat(tiers.map((t) => {
      const n = clusters.filter((c) => c.tier === t.code).length;
      return `<button class="chip ${filterTier === t.code ? "active" : ""}" data-t="${t.code}"><i style="background:${t.hex}"></i>${t.code} ${esc(t.color_name)}<span class="count">${n}</span></button>`;
    }));
  $("#tier-filter").innerHTML = chips.join("");
  $("#tier-filter").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { filterTier = b.dataset.t || null; renderFilter(); renderList(); }),
  );
}

function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const qn = q.replace(/[^a-z0-9]/g, "");
  const rows = clusters.filter((c) => {
    if (filterTier && c.tier !== filterTier) return false;
    if (!q) return true;
    const hay = [c.label, c.make, c.models, years(c)].join(" ").toLowerCase();
    return hay.includes(q) || (qn.length >= 3 && c.part_numbers.some((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "").includes(qn)));
  });
  // Purple filter = research queue: most-seen unknowns first, then most recent.
  if (filterTier === "E") {
    rows.sort((a, b) => (b.unknown_seen ?? 0) - (a.unknown_seen ?? 0)
      || String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")));
  }
  $("#unknown-hint").hidden = filterTier !== "E" || !rows.length;
  $("#cluster-list").innerHTML = rows.length
    ? rows.map((c) => `
      <li data-id="${c.id}">
        ${dot(c.tier, "sm")}
        <div class="grow">
          <div class="name">${esc(c.label)}</div>
          <div class="meta">${esc([c.make, years(c), c.part_numbers.join(", ")].filter(Boolean).join(" · "))}</div>
        </div>
        ${c.tier === "E" ? seenBadge(c) : ""}
      </li>`).join("")
    : `<li class="muted">No clusters match.</li>`;
  $("#cluster-list").querySelectorAll("li[data-id]").forEach((li) => li.addEventListener("click", () => openEditor(li.dataset.id)));
}
$("#search").addEventListener("input", renderList);

function seenBadge(c) {
  const n = c.unknown_seen ?? 0;
  if (!n) return "";
  const when = c.last_seen_at ? ago(c.last_seen_at) : "";
  return `<span class="seen-col"><span class="badge seen">${n}×</span>${when ? `<span class="small muted">${when}</span>` : ""}</span>`;
}
function ago(ts) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}
$("#add-cluster").addEventListener("click", () => openEditor(null));

// ---------------- Editor ----------------
let editing = null;
let editTier = "E";

function openEditor(id) {
  editing = id ? clusters.find((c) => c.id === id) : null;
  const c = editing || { label: "", make: "", models: "", year_start: null, year_end: null, part_numbers: [], tier: "E", notes: "" };
  editTier = c.tier;
  $("#editor-title").textContent = editing ? "Edit cluster" : "Add cluster";
  $("#ed-label").value = c.label;
  $("#ed-make").value = c.make || "";
  $("#ed-models").value = c.models || "";
  $("#ed-y1").value = c.year_start ?? "";
  $("#ed-y2").value = c.year_end ?? "";
  $("#ed-pns").value = c.part_numbers.join(", ");
  $("#ed-notes").value = c.notes || "";
  drawPicker();
  $("#editor").showModal();
}
function drawPicker() {
  $("#tier-picker").innerHTML = tierButtons(editTier);
  $("#tier-picker").querySelectorAll(".tier-btn").forEach((b) => b.addEventListener("click", () => { editTier = b.dataset.code; drawPicker(); }));
}

$("#editor").addEventListener("close", async () => {
  if ($("#editor").returnValue !== "save") return;
  const num = (v) => (v === "" ? null : parseInt(v, 10));
  const row = {
    label: $("#ed-label").value.trim(),
    make: $("#ed-make").value.trim() || null,
    models: $("#ed-models").value.trim() || null,
    year_start: num($("#ed-y1").value),
    year_end: num($("#ed-y2").value),
    part_numbers: $("#ed-pns").value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    tier: editTier,
    notes: $("#ed-notes").value.trim() || null,
  };
  if (!row.label) return toast("Bin label is required");
  const q = editing
    ? sb.from("clusters").update(row).eq("id", editing.id)
    : sb.from("clusters").insert({ ...row, source: "manual" });
  const { data, error } = await q.select(FIELDS).single();
  if (error) return toast(error.message);
  upsertLocal(data);
  toast("Saved");
});

// ---------------- Misc ----------------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

boot();
