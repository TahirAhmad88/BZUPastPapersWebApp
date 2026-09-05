// ============================================================
// app.js — BZU Past Papers (Supabase backend)
// Vanilla JS, Supabase JS v2 (via CDN), no build step.
// ============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET, PRIMARY_ADMIN_EMAIL } from "./supabase-config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// pdf-lib: used for the "compile selected papers into one PDF" feature.
import { PDFDocument } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ------------------------------------------------------------
// Small DOM helpers
// ------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const on = (el, evt, fn, opts) => el && el.addEventListener(evt, fn, opts);

function openModal(id) {
  const el = document.getElementById(id);
  el.hidden = false;
  document.body.style.overflow = "hidden";
  const focusable = el.querySelector("input, select, button, textarea");
  if (focusable) setTimeout(() => focusable.focus(), 50);
}
function closeModal(id) {
  const el = document.getElementById(id);
  el.hidden = true;
  document.body.style.overflow = "";
}
$$("[data-close]").forEach(btn => on(btn, "click", () => closeModal(btn.dataset.close)));
$$(".modal-overlay").forEach(ov => on(ov, "click", (e) => { if (e.target === ov) closeModal(ov.id); }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $$(".modal-overlay").forEach(ov => { if (!ov.hidden) closeModal(ov.id); });
});

// ------------------------------------------------------------
// Toasts
// ------------------------------------------------------------
const toastContainer = $("#toastContainer");
const TOAST_ICONS = {
  success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>',
  error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>'
};
function toast(message, type = "info", timeout = 4200) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span>${message}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

// ------------------------------------------------------------
// Theme (dark mode)
// ------------------------------------------------------------
const themeToggle = $("#themeToggle");
const sunIcon = $("#themeIconSun");
const moonIcon = $("#themeIconMoon");
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  sunIcon.style.display = t === "dark" ? "none" : "block";
  moonIcon.style.display = t === "dark" ? "block" : "none";
  localStorage.setItem("bzu-theme", t);
}
applyTheme(localStorage.getItem("bzu-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
on(themeToggle, "click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  applyTheme(cur === "dark" ? "light" : "dark");
});

// ------------------------------------------------------------
// Mobile nav
// ------------------------------------------------------------
const mobileMenuBtn = $("#mobileMenuBtn");
const mobileNav = $("#mobileNav");
on(mobileMenuBtn, "click", () => {
  const open = mobileNav.classList.toggle("open");
  mobileMenuBtn.classList.toggle("open", open);
  mobileMenuBtn.setAttribute("aria-expanded", String(open));
});
$$("[data-action]").forEach(el => on(el, "click", () => {
  mobileNav.classList.remove("open");
  mobileMenuBtn.classList.remove("open");
}));

// ------------------------------------------------------------
// Global action router (data-action attributes)
// ------------------------------------------------------------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  switch (el.dataset.action) {
    case "open-upload": openModal("uploadModalOverlay"); break;
    case "open-admin": openAdminModal(); break;
    case "show-browse":
    case "scroll-browse":
      viewMode = "approved";
      document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
      renderPapers();
      break;
    case "show-favorites": showFavoritesView(); break;
    case "show-pending": showPendingView(); break;
  }
});

$("#footerYear").textContent = new Date().getFullYear();

// ============================================================
// AUTH
// ============================================================
let currentAdmin = null; // { id, email }

async function refreshAuthUI(session) {
  currentAdmin = session?.user ? { id: session.user.id, email: session.user.email } : null;
  const chip = $("#adminChip");
  const toggleBtn = $("#adminToggleBtn");
  const pendingNavBtns = $$("[data-action='show-pending']");
  if (currentAdmin) {
    chip.hidden = false;
    toggleBtn.hidden = true;
    $("#adminEmailLabel").textContent = currentAdmin.email;
    pendingNavBtns.forEach(b => b.hidden = false);
  } else {
    chip.hidden = true;
    toggleBtn.hidden = false;
    pendingNavBtns.forEach(b => b.hidden = true);
    if (viewMode === "pending") viewMode = "approved";
  }
  await fetchPapers(); // RLS returns a different row set once signed in
}

supabase.auth.getSession().then(({ data }) => refreshAuthUI(data.session));
supabase.auth.onAuthStateChange((_event, session) => refreshAuthUI(session));

on($("#adminLoginForm"), "submit", async (e) => {
  e.preventDefault();
  const email = $("#adminEmail").value.trim();
  const password = $("#adminPassword").value;
  const btn = e.submitter;
  const original = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    toast("Signed in as admin.", "success");
    closeModal("adminModalOverlay");
    e.target.reset();
  } catch (err) {
    toast(friendlyAuthError(err), "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

on($("#logoutBtn"), "click", async () => {
  await supabase.auth.signOut();
  toast("Logged out.", "info");
});

function openAdminModal() {
  if (currentAdmin) {
    $("#adminModalTitle").textContent = "Admin panel";
    $("#adminLoginForm").hidden = true;
    $("#adminPanelView").hidden = false;
    $("#adminPanelEmail").textContent = currentAdmin.email;
    $("#createAdminSection").hidden = currentAdmin.email !== PRIMARY_ADMIN_EMAIL;
  } else {
    $("#adminModalTitle").textContent = "Admin sign in";
    $("#adminLoginForm").hidden = false;
    $("#adminPanelView").hidden = true;
  }
  openModal("adminModalOverlay");
}

// Creating a new admin must not sign the *current* admin out. A second,
// non-session-persisting Supabase client handles the sign-up call in
// memory only, so it never touches the localStorage session the
// primary admin is using.
on($("#createAdminForm"), "submit", async (e) => {
  e.preventDefault();
  if (!currentAdmin || currentAdmin.email !== PRIMARY_ADMIN_EMAIL) {
    toast("Only the primary admin can create new admin accounts.", "error");
    return;
  }
  const name = $("#naName").value.trim();
  const email = $("#naEmail").value.trim();
  const pw = $("#naPassword").value;
  const pwConfirm = $("#naPasswordConfirm").value;
  if (pw !== pwConfirm) { toast("Passwords don't match.", "error"); return; }
  if (pw.length < 6) { toast("Password must be at least 6 characters.", "error"); return; }

  const btn = e.submitter;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…';

  const tempClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const { data, error } = await tempClient.auth.signUp({ email, password: pw });
    if (error) throw error;

    // Record the admin profile using the PRIMARY admin's own (still
    // signed-in) session — RLS restricts this insert to their email.
    const { error: insertErr } = await supabase.from("admins").insert({
      user_id: data.user?.id ?? null,
      name, email,
      created_by: currentAdmin.email
    });
    if (insertErr) throw insertErr;

    await tempClient.auth.signOut().catch(() => {});
    toast(`Admin account created for ${name}. If email confirmation is enabled on this project, they'll need to confirm before signing in.`, "success", 6000);
    e.target.reset();
  } catch (err) {
    toast(friendlyAuthError(err), "error");
  } finally {
    btn.disabled = false; btn.textContent = "Create admin account";
  }
});

function friendlyAuthError(err) {
  const msg = err?.message || "";
  if (/invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/user already registered/i.test(msg)) return "That email is already registered.";
  if (/password should be/i.test(msg)) return "Password is too weak — use at least 6 characters.";
  if (/rate limit/i.test(msg)) return "Too many attempts — please wait a moment and try again.";
  return msg || "Something went wrong. Please try again.";
}

// ============================================================
// DATA: papers (fetch + realtime)
// ============================================================
let allPapers = [];
let favorites = new Set(JSON.parse(localStorage.getItem("bzu-favorites") || "[]"));
let selected = new Set();
let viewMode = "approved"; // "approved" | "favorites" | "pending"

function rowToPaper(row) {
  return {
    id: row.id,
    subject: row.subject,
    session: row.session,
    semester: row.semester,
    teacher: row.teacher,
    term: row.term,
    keywords: row.keywords,
    fileName: row.file_name,
    fileURL: row.file_url,
    storagePath: row.storage_path,
    status: row.status,
    downloadCount: row.download_count,
    uploadedAt: row.uploaded_at
  };
}

async function fetchPapers() {
  const { data, error } = await supabase.from("papers").select("*").order("uploaded_at", { ascending: false });
  if (error) {
    console.error(error);
    toast("Couldn't load the archive. Check your Supabase setup.", "error", 6000);
    return;
  }
  allPapers = data.map(rowToPaper);
  updateStats();
  updateSubjectSuggestions();
  renderPapers();
}

// Realtime: refetch whenever the papers table changes (new upload,
// approval, rejection, delete, download-count bump) so every open
// tab — including an admin's review queue — stays in sync.
supabase
  .channel("papers-db-changes")
  .on("postgres_changes", { event: "*", schema: "public", table: "papers" }, () => fetchPapers())
  .subscribe();

fetchPapers();

function approvedPapers() { return allPapers.filter(p => p.status === "approved"); }
function pendingPapers() { return allPapers.filter(p => p.status === "pending"); }

function updateStats() {
  const approved = approvedPapers();
  const totalDownloads = approved.reduce((sum, p) => sum + (p.downloadCount || 0), 0);
  const subjects = new Set(approved.map(p => p.subject));
  animateNumber($("#statTotalPapers"), approved.length);
  animateNumber($("#statTotalDownloads"), totalDownloads);
  animateNumber($("#statTotalSubjects"), subjects.size);
  $$("#pendingCount, #pendingCountMobile").forEach(el => { if (el) el.textContent = pendingPapers().length; });
}
function animateNumber(el, target) {
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) return;
  const duration = 500, startTime = performance.now();
  function step(now) {
    const p = Math.min(1, (now - startTime) / duration);
    el.textContent = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function updateSubjectSuggestions() {
  const dl = $("#subjectSuggestions");
  const subjects = [...new Set(approvedPapers().map(p => titleCase(p.subject)))].sort();
  dl.innerHTML = subjects.map(s => `<option value="${escapeHtml(s)}"></option>`).join("");
}

// ============================================================
// FILTER / SEARCH / SORT
// ============================================================
const filterEls = {
  subject: $("#filterSubject"),
  session: $("#filterSession"),
  semester: $("#filterSemester"),
  teacher: $("#filterTeacher"),
  term: $("#filterTerm")
};
const sortSelect = $("#sortSelect");
let heroKeyword = "";

[...Object.values(filterEls), sortSelect].forEach(el => on(el, "input", debounce(renderPapers, 200)));
Object.values(filterEls).forEach(el => on(el, "change", renderPapers));
on(sortSelect, "change", renderPapers);

on($("#heroSearchForm"), "submit", (e) => {
  e.preventDefault();
  heroKeyword = $("#heroSearchInput").value.trim();
  viewMode = "approved";
  document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
  renderPapers();
});

on($("#clearFiltersBtn"), "click", () => {
  Object.values(filterEls).forEach(el => el.value = "");
  $("#heroSearchInput").value = "";
  heroKeyword = "";
  renderPapers();
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function showFavoritesView() {
  viewMode = "favorites";
  document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
  renderPapers();
}
function showPendingView() {
  if (!currentAdmin) { toast("Sign in as an admin to review pending papers.", "error"); return; }
  viewMode = "pending";
  document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
  renderPapers();
}

function getFilteredPapers() {
  const subjectQ = filterEls.subject.value.trim().toLowerCase();
  const sessionQ = filterEls.session.value.trim().toLowerCase();
  const semesterQ = filterEls.semester.value;
  const teacherQ = filterEls.teacher.value.trim().toLowerCase();
  const termQ = filterEls.term.value;
  const keywordQ = heroKeyword.trim().toLowerCase();

  const base = viewMode === "pending" ? pendingPapers() : approvedPapers();

  let list = base.filter(p => {
    if (viewMode === "favorites" && !favorites.has(p.id)) return false;
    if (subjectQ && !p.subject.toLowerCase().includes(subjectQ)) return false;
    if (sessionQ && !String(p.session).toLowerCase().includes(sessionQ)) return false;
    if (semesterQ && String(p.semester) !== semesterQ) return false;
    if (teacherQ && !(p.teacher || "").toLowerCase().includes(teacherQ)) return false;
    if (termQ && p.term !== termQ) return false;
    if (keywordQ) {
      const hay = [p.subject, p.session, p.semester, p.teacher, p.term, p.keywords]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(keywordQ)) return false;
    }
    return true;
  });

  switch (sortSelect.value) {
    case "downloads": list.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0)); break;
    case "subject": list.sort((a, b) => a.subject.localeCompare(b.subject)); break;
    case "semester": list.sort((a, b) => (a.semester || 0) - (b.semester || 0)); break;
    default: list.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  }
  return list;
}

// ============================================================
// RENDER
// ============================================================
const AVATAR_COLORS = ["#0070f3", "#7c3aed", "#e5484d", "#16a34a", "#f5a623", "#0891b2", "#db2777"];
function colorForSubject(subject) {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = subject.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function initialsFor(subject) {
  const words = subject.trim().split(/\s+/);
  return ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase();
}
function titleCase(s) { return (s || "").replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function fileIsImage(fileName) { return /\.(png|jpe?g)$/i.test(fileName || ""); }
function timeAgo(iso) {
  if (!iso) return "just now";
  const diff = Date.now() / 1000 - new Date(iso).getTime() / 1000;
  const units = [[31536000, "y"], [2592000, "mo"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [s, label] of units) if (diff >= s) return `${Math.floor(diff / s)}${label} ago`;
  return "just now";
}

const skeletonGrid = $("#skeletonGrid");
const paperGrid = $("#paperGrid");
const emptyState = $("#emptyState");

const VIEW_HEADINGS = {
  approved: "Browse papers",
  favorites: "Your favorites",
  pending: "Pending review"
};

function renderPapers() {
  skeletonGrid.hidden = true;
  const list = getFilteredPapers();

  $("#resultsHeading").textContent = VIEW_HEADINGS[viewMode];
  $("#resultsSummary").textContent = list.length
    ? `${list.length} paper${list.length === 1 ? "" : "s"} found`
    : emptyMessageFor(viewMode);

  document.getElementById("browse").classList.toggle("pending-mode", viewMode === "pending");

  if (!list.length) {
    paperGrid.hidden = true;
    emptyState.hidden = false;
    $("#emptyStateMsg").textContent = emptyDetailFor(viewMode);
    updateBatchBar();
    return;
  }
  emptyState.hidden = true;
  paperGrid.hidden = false;

  paperGrid.innerHTML = list.map(p => renderCard(p)).join("");
  updateBatchBar();
}
function emptyMessageFor(mode) {
  if (mode === "favorites") return "You haven't starred any papers yet.";
  if (mode === "pending") return "No papers waiting for review.";
  return "No papers match your filters.";
}
function emptyDetailFor(mode) {
  if (mode === "favorites") return "Star a paper from the archive to see it here.";
  if (mode === "pending") return "New uploads will show up here for you to preview and approve.";
  return "No papers match those filters. Be the first to upload one.";
}

function renderCard(p) {
  const isFav = favorites.has(p.id);
  const isSelected = selected.has(p.id);
  const canDelete = !!currentAdmin && viewMode !== "pending";
  const isPendingCard = p.status === "pending";
  const color = colorForSubject(p.subject);

  return `
  <article class="paper-card ${isPendingCard ? "is-pending" : ""}" data-id="${p.id}">
    ${isPendingCard ? `<span class="card-stamp pending">Pending</span>` : (p.term ? `<span class="card-stamp">${escapeHtml(p.term)}</span>` : "")}
    <div class="card-top">
      ${!isPendingCard ? `<input type="checkbox" class="card-select" data-select="${p.id}" ${isSelected ? "checked" : ""} aria-label="Select ${escapeHtml(titleCase(p.subject))}" />` : ""}
      <div class="card-avatar" style="background:${color}">${initialsFor(p.subject)}</div>
      <div class="card-title-wrap">
        <button class="card-subject" data-preview="${p.id}">${escapeHtml(titleCase(p.subject))}</button>
        <div class="card-meta">${escapeHtml(p.teacher || "Teacher not specified")} · ${timeAgo(p.uploadedAt)}</div>
      </div>
      ${!isPendingCard ? `<button class="card-fav-btn ${isFav ? "active" : ""}" data-fav="${p.id}" aria-label="Toggle favorite" title="Favorite">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="${isFav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 17.3 6.2 21l1.6-6.6L2.5 9.7l6.8-.6L12 3l2.7 6.1 6.8.6-5.3 4.7 1.6 6.6Z"/></svg>
      </button>` : ""}
    </div>

    <div class="card-tags">
      <span class="tag">Session ${escapeHtml(String(p.session))}</span>
      <span class="tag">Sem ${escapeHtml(String(p.semester))}</span>
      ${isPendingCard && p.keywords ? `<span class="tag">${escapeHtml(p.keywords)}</span>` : ""}
    </div>

    <div class="card-footer">
      ${isPendingCard ? `
        <span class="card-downloads">Awaiting review</span>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-preview="${p.id}">Preview</button>
          <button class="btn btn-secondary btn-sm" data-reject="${p.id}">Reject</button>
          <button class="btn btn-primary btn-sm" data-approve="${p.id}">Approve</button>
        </div>
      ` : `
        <span class="card-downloads">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V3M6 10l6 6 6-6"/><path d="M4 21h16"/></svg>
          ${p.downloadCount || 0}
        </span>
        <div class="card-actions">
          <button class="card-icon-btn" data-print="${p.id}" title="Print" aria-label="Print">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>
          </button>
          <button class="card-icon-btn" data-download="${p.id}" title="Download" aria-label="Download">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15V3M6 10l6 6 6-6"/><path d="M4 21h16"/></svg>
          </button>
          <button class="card-icon-btn" data-share="${p.id}" title="Share" aria-label="Share">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5"/></svg>
          </button>
          ${canDelete ? `<button class="card-icon-btn danger" data-delete="${p.id}" title="Delete" aria-label="Delete">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>` : ""}
        </div>
      `}
    </div>
  </article>`;
}

// ------------------------------------------------------------
// Card interactions (event delegation)
// ------------------------------------------------------------
on(paperGrid, "click", async (e) => {
  const t = e.target;
  const previewId = t.closest("[data-preview]")?.dataset.preview;
  const favId = t.closest("[data-fav]")?.dataset.fav;
  const printId = t.closest("[data-print]")?.dataset.print;
  const downloadId = t.closest("[data-download]")?.dataset.download;
  const shareId = t.closest("[data-share]")?.dataset.share;
  const deleteId = t.closest("[data-delete]")?.dataset.delete;
  const approveId = t.closest("[data-approve]")?.dataset.approve;
  const rejectId = t.closest("[data-reject]")?.dataset.reject;
  const selectId = t.matches("[data-select]") ? t.dataset.select : null;

  if (previewId) return openPreview(previewId);
  if (favId) return toggleFavorite(favId);
  if (printId) return handlePrint(printId);
  if (downloadId) return handleDownload(downloadId);
  if (shareId) return handleShare(shareId);
  if (deleteId) return openDeleteConfirm(deleteId);
  if (approveId) return approvePaper(approveId);
  if (rejectId) return openRejectConfirm(rejectId);
  if (selectId) {
    if (t.checked) selected.add(selectId); else selected.delete(selectId);
    updateBatchBar();
  }
});

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
  localStorage.setItem("bzu-favorites", JSON.stringify([...favorites]));
  $("#favCount").textContent = favorites.size;
  $("#favCountMobile").textContent = favorites.size;
  renderPapers();
}
$("#favCount").textContent = favorites.size;
$("#favCountMobile").textContent = favorites.size;

function findPaper(id) { return allPapers.find(p => p.id === id); }

function openPreview(id) {
  const p = findPaper(id);
  if (!p) return;
  $("#previewModalTitle").textContent = titleCase(p.subject) + (p.status === "pending" ? " (pending review)" : "");
  const body = $("#previewBody");
  body.innerHTML = fileIsImage(p.fileName)
    ? `<img src="${p.fileURL}" alt="${escapeHtml(p.subject)} paper preview" />`
    : `<iframe src="${p.fileURL}" title="${escapeHtml(p.subject)} paper preview"></iframe>`;
  $("#previewDownloadBtn").href = p.fileURL;
  $("#previewDownloadBtn").setAttribute("download", p.fileName || "paper");
  $("#previewDownloadBtn").onclick = () => { if (p.status === "approved") registerDownload(id); };
  $("#previewPrintBtn").onclick = () => handlePrint(id);

  // In the pending queue, the preview modal doubles as the review step.
  const existingReviewBar = $("#previewReviewBar");
  if (existingReviewBar) existingReviewBar.remove();
  if (p.status === "pending" && currentAdmin) {
    const bar = document.createElement("div");
    bar.id = "previewReviewBar";
    bar.className = "modal-actions";
    bar.style.justifyContent = "flex-start";
    bar.style.marginTop = "0";
    bar.style.padding = "0 22px 18px";
    bar.innerHTML = `
      <button class="btn btn-secondary" id="previewRejectBtn">Reject</button>
      <button class="btn btn-primary" id="previewApproveBtn">Approve &amp; publish</button>`;
    $("#previewBody").insertAdjacentElement("afterend", bar);
    $("#previewRejectBtn").onclick = () => { closeModal("previewModalOverlay"); openRejectConfirm(id); };
    $("#previewApproveBtn").onclick = async () => { await approvePaper(id); closeModal("previewModalOverlay"); };
  }

  openModal("previewModalOverlay");
}

async function registerDownload(id) {
  try {
    const { error } = await supabase.rpc("increment_download_count", { paper_id: id });
    if (error) throw error;
  } catch (err) { console.error(err); }
}

async function handleDownload(id) {
  const p = findPaper(id);
  if (!p) return;
  const a = document.createElement("a");
  a.href = p.fileURL; a.download = p.fileName || "paper"; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  registerDownload(id);
}

function handlePrint(id) {
  const p = findPaper(id);
  if (!p) return;
  const w = window.open(p.fileURL, "_blank");
  if (w) w.addEventListener("load", () => { try { w.print(); } catch { /* cross-origin, ignore */ } });
}

async function handleShare(id) {
  const p = findPaper(id);
  if (!p) return;
  const shareData = { title: titleCase(p.subject), text: `${titleCase(p.subject)} — ${p.session}, Semester ${p.semester}`, url: p.fileURL };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch { /* user cancelled */ }
  } else {
    await navigator.clipboard.writeText(p.fileURL);
    toast("Link copied to clipboard.", "success");
  }
}

// ------------------------------------------------------------
// Approve / Reject (admin only — enforced again by RLS policies)
// ------------------------------------------------------------
async function approvePaper(id) {
  if (!currentAdmin) { toast("Sign in as an admin to approve papers.", "error"); return; }
  try {
    const { error } = await supabase.from("papers").update({
      status: "approved",
      approved_by: currentAdmin.email,
      approved_at: new Date().toISOString()
    }).eq("id", id);
    if (error) throw error;
    toast("Paper approved and published to the archive.", "success");
  } catch (err) {
    console.error(err);
    toast("Couldn't approve — check that you're still signed in as admin.", "error");
  }
}

let pendingRejectId = null;
function openRejectConfirm(id) {
  if (!currentAdmin) { toast("Sign in as an admin to review papers.", "error"); return; }
  const p = findPaper(id);
  pendingRejectId = id;
  $("#confirmModalTitle").textContent = "Reject this upload?";
  $("#confirmModalMsg").textContent = `"${titleCase(p?.subject || "This paper")}" will be removed and won't be published. This can't be undone.`;
  $("#confirmDeleteBtn").textContent = "Reject & remove";
  openModal("confirmModalOverlay");
}

// ------------------------------------------------------------
// Delete (admin only — enforced again by RLS policies)
// ------------------------------------------------------------
let pendingDeleteId = null;
function openDeleteConfirm(id) {
  if (!currentAdmin) { toast("Sign in as an admin to delete papers.", "error"); return; }
  const p = findPaper(id);
  pendingDeleteId = id;
  $("#confirmModalTitle").textContent = "Delete this paper?";
  $("#confirmModalMsg").textContent = `Delete "${titleCase(p?.subject || "this paper")}"? This can't be undone.`;
  $("#confirmDeleteBtn").textContent = "Delete";
  openModal("confirmModalOverlay");
}

on($("#confirmDeleteBtn"), "click", async () => {
  const id = pendingDeleteId || pendingRejectId;
  const isReject = !!pendingRejectId;
  if (!id) return;
  const p = findPaper(id);
  const btn = $("#confirmDeleteBtn");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${isReject ? "Rejecting…" : "Deleting…"}`;
  try {
    const { error } = await supabase.from("papers").delete().eq("id", id);
    if (error) throw error;
    if (p?.storagePath) {
      const { error: storageErr } = await supabase.storage.from(STORAGE_BUCKET).remove([p.storagePath]);
      if (storageErr) console.warn("Storage file already gone or couldn't be removed:", storageErr);
    }
    toast(isReject ? "Upload rejected and removed." : "Paper deleted.", "success");
    closeModal("confirmModalOverlay");
  } catch (err) {
    console.error(err);
    toast("That didn't go through — check that you're still signed in as admin.", "error");
  } finally {
    btn.disabled = false; btn.textContent = isReject ? "Reject & remove" : "Delete";
    pendingDeleteId = null;
    pendingRejectId = null;
  }
});

// ============================================================
// UPLOAD (with strict duplicate prevention — lands as 'pending')
// ============================================================
const uploadForm = $("#uploadForm");
const dropzone = $("#dropzone");
const fileInput = $("#uFile");
const dzFilename = $("#dzFilename");

on(dropzone, "click", () => fileInput.click());
on(dropzone, "keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
["dragenter", "dragover"].forEach(evt => on(dropzone, evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); }));
["dragleave", "drop"].forEach(evt => on(dropzone, evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
on(dropzone, "drop", (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) { fileInput.files = e.dataTransfer.files; showFileName(file); }
});
on(fileInput, "change", () => { if (fileInput.files[0]) showFileName(fileInput.files[0]); });
function showFileName(file) { dzFilename.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`; }

const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_FILE_MB = 20;

// Raw XHR upload to Supabase Storage's REST endpoint, purely so we can
// show real upload progress — the supabase-js client's storage.upload()
// doesn't expose progress events.
function uploadFileWithProgress(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
    xhr.open("POST", url);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

on(uploadForm, "submit", async (e) => {
  e.preventDefault();

  const subject = $("#uSubject").value.trim();
  const session = $("#uSession").value.trim();
  const semester = parseInt($("#uSemester").value, 10);
  const teacher = $("#uTeacher").value.trim();
  const term = $("#uTerm").value;
  const keywords = $("#uKeywords").value.trim();
  const file = fileInput.files[0];

  if (!subject || !session || !semester) { toast("Please fill in subject, session, and semester.", "error"); return; }
  if (!/^\d{4}(-\d{4})?$/.test(session)) { toast("Session should look like 2024 or 2024-2028.", "error"); return; }
  if (semester < 1 || semester > 8) { toast("Semester must be between 1 and 8.", "error"); return; }
  if (!file) { toast("Please choose a file to upload.", "error"); return; }
  if (!ALLOWED_TYPES.includes(file.type)) { toast("Only PDF, JPG, and PNG files are allowed.", "error"); return; }
  if (file.size > MAX_FILE_MB * 1024 * 1024) { toast(`File is too large — max ${MAX_FILE_MB}MB.`, "error"); return; }

  const submitBtn = $("#uploadSubmitBtn");
  submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner"></span> Checking…';

  try {
    // ---- Strict duplicate check: subject + session + semester (case-insensitive subject) ----
    // Uses the check_duplicate_paper() RPC rather than a plain select —
    // a signed-out visitor's SELECT is restricted by RLS to approved
    // papers only, so a direct query would miss a matching paper still
    // sitting in the pending queue. The RPC checks pending + approved
    // without exposing any pending paper's actual data.
    const subjectLower = subject.toLowerCase();
    const { data: isDuplicate, error: dupErr } = await supabase.rpc("check_duplicate_paper", {
      p_subject: subjectLower, p_session: session, p_semester: semester
    });
    if (dupErr) throw dupErr;
    if (isDuplicate) {
      toast("This paper is already in the database. Upload not allowed.", "warn", 6000);
      submitBtn.disabled = false; submitBtn.textContent = "Submit for review";
      return;
    }

    // ---- Upload file to Storage ----
    submitBtn.innerHTML = '<span class="spinner"></span> Uploading…';
    const sanitizedSubject = subjectLower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const storagePath = `${session}/${semester}/${sanitizedSubject}/${Date.now()}-${sanitizeFileName(file.name)}`;

    $("#uploadProgress").hidden = false;
    await uploadFileWithProgress(storagePath, file, (pct) => {
      $("#uploadProgressBar").style.setProperty("--pct", pct + "%");
      $("#uploadProgressLabel").textContent = `Uploading… ${pct}%`;
    });
    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    const fileURL = urlData.publicUrl;

    // ---- Save metadata to Supabase (lands as 'pending' — see RLS policy) ----
    const { error: insertErr } = await supabase.from("papers").insert({
      subject: subjectLower,
      session, semester, teacher, term, keywords,
      file_name: file.name,
      file_url: fileURL,
      storage_path: storagePath,
      status: "pending",
      download_count: 0
    });
    if (insertErr) throw insertErr;

    toast("Paper submitted! An admin will review it before it appears in the archive.", "success", 6000);
    uploadForm.reset();
    dzFilename.textContent = "";
    closeModal("uploadModalOverlay");
  } catch (err) {
    console.error(err);
    toast("Upload failed. Please try again.", "error");
  } finally {
    $("#uploadProgress").hidden = true;
    $("#uploadProgressBar").style.setProperty("--pct", "0%");
    submitBtn.disabled = false; submitBtn.textContent = "Submit for review";
  }
});

function sanitizeFileName(name) { return name.replace(/[^a-zA-Z0-9.\-_]+/g, "_"); }

// ============================================================
// BATCH SELECT / COMPILE TO SINGLE PDF (approved papers only)
// ============================================================
const batchBar = $("#batchBar");
function updateBatchBar() {
  batchBar.hidden = selected.size === 0 || viewMode === "pending";
  $("#batchCount").textContent = selected.size;
}
on($("#batchClearBtn"), "click", () => { selected.clear(); renderPapers(); });

on($("#batchShareBtn"), "click", async () => {
  if (!selected.size) return;
  const btn = $("#batchShareBtn");
  const original = btn.textContent;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Compiling…';
  try {
    const merged = await PDFDocument.create();
    for (const id of selected) {
      const p = findPaper(id);
      if (!p) continue;
      const bytes = await fetch(p.fileURL).then(r => r.arrayBuffer());
      if (fileIsImage(p.fileName)) {
        const img = /\.png$/i.test(p.fileName) ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
        const page = merged.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      } else {
        const srcDoc = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(pg => merged.addPage(pg));
      }
      registerDownload(id);
    }
    const outBytes = await merged.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "bzu-past-papers-selection.pdf";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast(`Compiled ${selected.size} paper${selected.size === 1 ? "" : "s"} into one PDF.`, "success");
    selected.clear();
    renderPapers();
  } catch (err) {
    console.error(err);
    toast("Couldn't compile the PDF — one of the files may be unreachable.", "error");
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});
