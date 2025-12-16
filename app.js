/* Termin Manager - Offline-first PWA mit Cloud-Sicherung */
(function () {
  "use strict";

  const APP_VERSION = "1.3.0";
  const DB_NAME = "workshop-app";
  const DB_VERSION = 3;
  const MAX_LOCAL_BACKUPS = 10;
  const SYNC_DEBOUNCE_MS = 1200;
  const BRANDING_CACHE_PREFIX = "branding:";

  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const clone = (v) => (window.structuredClone ? window.structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  const toLocal = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const pad2 = (n) => String(n).padStart(2, "0");
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const isDebug = new URLSearchParams(location.search).get("debug") === "1";

  // Zentrales Error-Logging
  const errors = [];
  function logError(context, error, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      context,
      message: error?.message || String(error),
      stack: error?.stack,
      data,
    };
    errors.push(entry);
    if (errors.length > 50) errors.shift();
    console.error(`[${context}]`, error, data);
    // Optional: Sentry/externe Logging-API hier integrieren
    // if (window.Sentry) Sentry.captureException(error, { tags: { context }, extra: data });
  }

  const supabaseConfig = window.APP_CONFIG || {};
  const supabaseReady =
    window.supabase &&
    supabaseConfig.SUPABASE_URL &&
    supabaseConfig.SUPABASE_ANON_KEY &&
    !String(supabaseConfig.SUPABASE_URL).includes("YOUR-PROJECT");
  const supabaseClient = supabaseReady
    ? window.supabase.createClient(supabaseConfig.SUPABASE_URL, supabaseConfig.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      })
    : null;

  const DEFAULT_BRANDING = {
    appName: "Terminbuch",
    primaryColor: "#222",
    accentColor: "#FF7043",
    termsLabel: "Termine",
    bookingsLabel: "Buchungen",
    logoUrl: null,
  };

  const stateDefaults = {
    slots: [],
    bookings: [],
    ui: {
      collapsedActive: false,
      collapsedArchive: true,
      lastBackupDay: null,
    },
    meta: {
      lastSyncAt: null,
      lastSaveAt: null,
      lastSyncError: null,
      idbVersion: DB_VERSION,
    },
    activeOrgId: null,
    orgs: [],
    user: null,
  };

  let memoryState = null;
  let dbPromise = null;
  let pendingDeleteSlotId = null;
  let syncTimer = null;
  let flushInFlight = false;
  let syncRetry = 0;
  let updateWaitingWorker = null;
  let authUser = null;
  let currentBranding = { ...DEFAULT_BRANDING };
  const ctx = { currentSlotId: null, currentBookingId: null, importPreview: null };
  const READ_VERIFY = false;

  const isUuid = (val) => typeof val === "string" && /^[0-9a-fA-F-]{36}$/.test(val);
  const brandingKey = (orgId) => `${BRANDING_CACHE_PREFIX}${orgId || "default"}`;
  const getOrgRole = (state, orgId) => (state.orgs || []).find((o) => o.id === (orgId || state.activeOrgId))?.role || null;
  const canEditBranding = (state) => ["owner", "admin"].includes(getOrgRole(state, state.activeOrgId));
  const normalizeActiveOrgId = (id, orgs = []) => {
    if (!isUuid(id)) return null;
    if (orgs.length && !orgs.find((o) => o.id === id)) return orgs[0]?.id || null;
    return id;
  };
  const isCloudReady = (state) => Boolean(supabaseClient && authUser && isUuid(state?.activeOrgId));

  function applyBranding(branding = DEFAULT_BRANDING) {
    currentBranding = { ...DEFAULT_BRANDING, ...(branding || {}) };
    const root = document.documentElement;
    root.style.setProperty("--primary", currentBranding.primaryColor || DEFAULT_BRANDING.primaryColor);
    root.style.setProperty("--accent", currentBranding.accentColor || DEFAULT_BRANDING.accentColor);
    if (currentBranding.bg) root.style.setProperty("--bg", currentBranding.bg);
    if (currentBranding.text) root.style.setProperty("--text", currentBranding.text);

    document.title = currentBranding.appName;
    const titleEl = qs("#brandTitle");
    const logoEl = qs("#brandLogo");
    if (titleEl) {
      titleEl.textContent = currentBranding.appName;
      titleEl.style.color = currentBranding.primaryColor || DEFAULT_BRANDING.primaryColor;
    }
    if (logoEl) {
      if (currentBranding.logoUrl) {
        logoEl.src = currentBranding.logoUrl;
        logoEl.classList.remove("hidden");
      } else {
        logoEl.src = "static/logo.png";
        logoEl.classList.remove("hidden");
      }
    }
    const metaTheme = document.querySelector("meta[name='theme-color']");
    if (metaTheme) metaTheme.setAttribute("content", currentBranding.primaryColor || DEFAULT_BRANDING.primaryColor);
    const appleTitle = document.querySelector("meta[name='apple-mobile-web-app-title']");
    if (appleTitle) appleTitle.setAttribute("content", currentBranding.appName || DEFAULT_BRANDING.appName);
    qsa("[data-label-terms-action]").forEach((el) => (el.textContent = `${currentBranding.termsLabel} anlegen`));
    const modalTerms = qs("[data-label-terms-modal]");
    if (modalTerms) modalTerms.textContent = `${currentBranding.termsLabel} anlegen / bearbeiten`;
    const modalBookingTitle = qs("[data-label-bookings]");
    if (modalBookingTitle) modalBookingTitle.textContent = currentBranding.bookingsLabel;
  }

  /* ---------- IndexedDB Layer ---------- */
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
        if (!db.objectStoreNames.contains("backups")) {
          const b = db.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
          b.createIndex("created_at", "created_at");
        }
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = fn(store, tx);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function readStateFromDb() {
    return withStore("kv", "readonly", (store) => store.get("state")).then((req) => req?.result?.value || null);
  }
  async function writeStateToDb(state) {
    return withStore("kv", "readwrite", (store) => store.put({ key: "state", value: state }));
  }
  async function loadBrandingCache(orgId) {
    try {
      const key = brandingKey(orgId);
      return withStore("kv", "readonly", (store) => store.get(key)).then((req) => req?.result?.value || null);
    } catch (err) {
      logError("loadBrandingCache", err, { orgId });
      return null;
    }
  }
  async function saveBrandingCache(orgId, branding) {
    try {
      const key = brandingKey(orgId);
      await withStore("kv", "readwrite", (store) => store.put({ key, value: branding }));
    } catch (err) {
      logError("saveBrandingCache", err, { orgId });
    }
  }

  async function migrateFromLocalStorage() {
    const slotsRaw = localStorage.getItem("seeyou_slots_v1");
    const bookingsRaw = localStorage.getItem("seeyou_bookings_v1");
    if (!slotsRaw && !bookingsRaw) return null;
    let slots = [];
    let bookings = [];
    try {
      slots = slotsRaw ? JSON.parse(slotsRaw) : [];
      bookings = bookingsRaw ? JSON.parse(bookingsRaw) : [];
    } catch (err) {
      console.warn("Migration failed", err);
      return null;
    }
    const migrated = { ...clone(stateDefaults), slots, bookings, activeOrgId: null };
    await writeStateToDb(migrated);
    memoryState = migrated;
    return migrated;
  }

  function seedSlots() {
    const now = new Date();
    const s1 = new Date(now.getTime() + 24 * 3600 * 1000);
    s1.setHours(17, 0, 0, 0);
    const e1 = new Date(s1.getTime() + 2 * 3600 * 1000);
    const s2 = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
    s2.setHours(10, 0, 0, 0);
    const e2 = new Date(s2.getTime() + 2 * 3600 * 1000);
    return [
      { id: uid(), title: "Workshop Termin", starts_at: s1.toISOString(), ends_at: e1.toISOString(), capacity: 10, archived: false },
      { id: uid(), title: "Workshop Termin", starts_at: s2.toISOString(), ends_at: e2.toISOString(), capacity: 8, archived: false },
    ];
  }
  async function getState() {
    if (memoryState) return clone(memoryState);
    const fromDb = await readStateFromDb();
    if (fromDb) {
      const normalized = { ...clone(stateDefaults), ...fromDb, meta: { ...stateDefaults.meta, ...(fromDb.meta || {}) } };
      normalized.activeOrgId = normalizeActiveOrgId(normalized.activeOrgId, normalized.orgs);
      memoryState = normalized;
      if (!deepEqual(fromDb, normalized)) await saveState(normalized, { skipSnapshot: true });
      return clone(normalized);
    }
    const migrated = await migrateFromLocalStorage();
    if (migrated) {
      await addLocalSnapshot("migration", migrated);
      return clone(migrated);
    }
    const seeded = { ...clone(stateDefaults), slots: seedSlots(), bookings: [] };
    await writeStateToDb(seeded);
    memoryState = seeded;
    await addLocalSnapshot("seed", seeded);
    return clone(seeded);
  }

  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  async function saveState(state, { skipSnapshot = false } = {}) {
    const safe = clone(state);
    safe.activeOrgId = normalizeActiveOrgId(safe.activeOrgId, safe.orgs);
    await writeStateToDb(safe);
    if (READ_VERIFY) {
      try {
        const readback = await readStateFromDb();
        memoryState = readback;
        if (!deepEqual(safe, readback)) console.warn("Read-after-write mismatch");
      } catch (err) {
        console.warn("Read-after-write check failed", err);
        memoryState = safe;
      }
    } else {
      memoryState = safe;
    }
    if (!skipSnapshot) await addLocalSnapshot("autosave", safe);
    return clone(memoryState);
  }

  async function exportBackup() {
    const current = await getState();
    return { version: 1, exported_at: new Date().toISOString(), state: current };
  }

  function validateStateShape(state) {
    return state && Array.isArray(state.slots) && Array.isArray(state.bookings);
  }

  async function importBackup(json) {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    if (!parsed || !validateStateShape(parsed.state || parsed)) throw new Error("Backup schema invalid");
    const nextState = parsed.state || parsed;
    const merged = { ...clone(stateDefaults), ...nextState };
    await saveState(merged);
    await addLocalSnapshot("import", merged);
    return merged;
  }

  async function addLocalSnapshot(reason, snapshotState) {
    const state = snapshotState || (await getState());
    const entry = { created_at: new Date().toISOString(), reason, state: clone(state) };
    await withStore("backups", "readwrite", (store) => store.add(entry));
    await pruneBackups();
  }
  async function pruneBackups() {
    const items = await listLocalBackups();
    if (items.length <= MAX_LOCAL_BACKUPS) return;
    const toDelete = items.slice(MAX_LOCAL_BACKUPS);
    await withStore("backups", "readwrite", (store) => toDelete.forEach((b) => store.delete(b.id)));
  }
  async function listLocalBackups() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("backups", "readonly");
      const store = tx.objectStore("backups");
      const idx = store.index("created_at");
      const req = idx.getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      req.onerror = () => reject(req.error);
    });
  }

  async function queueSet(state) {
    const payload = { created_at: new Date().toISOString(), state: clone(state), org_id: state.activeOrgId || null };
    await withStore("queue", "readwrite", (store) => {
      const clearReq = store.clear();
      clearReq.onsuccess = () => store.add(payload);
    });
  }
  async function queueGetLatest() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("queue", "readonly");
      const store = tx.objectStore("queue");
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        resolve(list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null);
      };
      req.onerror = () => reject(req.error);
    });
  }
  async function queueClear() {
    await withStore("queue", "readwrite", (store) => store.clear());
  }
  async function queueLength() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("queue", "readonly");
      const store = tx.objectStore("queue");
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  const storage = { getState, saveState, exportBackup, importBackup, listLocalBackups, addLocalSnapshot, queueSet, queueClear, queueLength, queueGetLatest };
  /* ---------- Supabase & Sync ---------- */
  async function handleAuthCallback() {
    if (!supabaseClient) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code) {
      await supabaseClient.auth.exchangeCodeForSession(code).catch((err) => console.warn("Auth exchange failed", err));
      url.searchParams.delete("code");
      window.history.replaceState({}, document.title, url.toString());
    } else {
      await supabaseClient.auth.getSession();
    }
  }

  async function sendMagicLink(email) {
    if (!supabaseClient) throw new Error("Supabase nicht konfiguriert");
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }

  async function loadSession() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    authUser = data?.session?.user || null;
    if (authUser) await refreshOrgMembership();
    await updateUserInState(authUser);
    return authUser;
  }

  function subscribeAuth() {
    if (!supabaseClient) return;
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      authUser = session?.user || null;
      await refreshOrgMembership();
      await updateUserInState(authUser);
      renderAuth();
      pullLatestFromServer();
      scheduleSync();
    });
  }

  async function refreshOrgMembership() {
    if (!supabaseClient || !authUser) return;
    const { data, error } = await supabaseClient.from("org_members").select("org_id, role, orgs(name)").eq("user_id", authUser.id);
    if (error) {
      console.warn("org_members fetch failed", error);
      return;
    }
    const orgs = (data || []).map((o) => ({ id: o.org_id, name: o.orgs?.name || "Team", role: o.role || "user" }));
    await updateState(
      (draft) => {
        draft.orgs = orgs;
        if (!orgs.length) {
          draft.activeOrgId = null;
        } else if (!orgs.find((o) => o.id === draft.activeOrgId)) {
          draft.activeOrgId = orgs[0].id;
        } else {
          draft.activeOrgId = normalizeActiveOrgId(draft.activeOrgId, orgs);
        }
      },
      { skipSync: true, skipSnapshot: true }
    );
    await loadBrandingForOrg();
  }

  async function updateUserInState(user) {
    try {
      const current = await storage.getState();
      current.user = user ? { id: user.id, email: user.email } : null;
      current.activeOrgId = normalizeActiveOrgId(current.activeOrgId, current.orgs);
      await storage.saveState(current, { skipSnapshot: true });
      memoryState = current;
    } catch (err) {
      console.warn("updateUserInState failed", err);
    }
    renderDebug();
  }

  const normalizeBrandingRow = (row) => ({
    appName: row?.app_name || null,
    primaryColor: row?.primary_color || null,
    accentColor: row?.accent_color || null,
    logoUrl: row?.logo_url || null,
    termsLabel: row?.terms_label || null,
    bookingsLabel: row?.bookings_label || null,
  });

  async function fetchOrgBranding(orgId) {
    if (!supabaseClient || !authUser || !orgId) return null;
    const { data, error } = await supabaseClient
      .from("org_settings")
      .select("app_name, primary_color, accent_color, logo_url, terms_label, bookings_label, updated_at")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) {
      if (error.code !== "PGRST116") console.warn("Branding fetch failed", error);
      return null;
    }
    return data ? normalizeBrandingRow(data) : null;
  }

  async function loadBrandingForOrg(orgId) {
    const state = await storage.getState();
    const targetOrg = orgId || state.activeOrgId || null;
    let branding = null;
    if (navigator.onLine && supabaseClient && authUser && targetOrg) {
      try {
        const remote = await fetchOrgBranding(targetOrg);
        if (remote) {
          branding = { ...remote };
          await saveBrandingCache(targetOrg, { ...DEFAULT_BRANDING, ...remote });
        }
      } catch (err) {
        console.warn("Branding remote load failed", err);
      }
    }
    if (!branding && targetOrg) branding = await loadBrandingCache(targetOrg);
    if (!branding) branding = await loadBrandingCache(null);
    const merged = { ...DEFAULT_BRANDING, ...(branding || {}) };
    applyBranding(merged);
    await saveBrandingCache(targetOrg, merged);
    renderBrandingUI(merged);
    return merged;
  }

  async function upsertBranding(orgId, branding) {
    if (!supabaseClient || !authUser || !orgId) throw new Error("Login erforderlich");
    const payload = {
      p_org_id: orgId,
      p_app_name: branding.appName || null,
      p_primary_color: branding.primaryColor || null,
      p_accent_color: branding.accentColor || null,
      p_logo_url: branding.logoUrl || null,
      p_terms_label: branding.termsLabel || null,
      p_bookings_label: branding.bookingsLabel || null,
    };
    const { data, error } = await supabaseClient.rpc("set_org_settings", payload);
    if (!error && data) return normalizeBrandingRow(data);
    if (error) console.warn("RPC set_org_settings fehlgeschlagen, fallback auf upsert", error);
    const { data: upserted, error: upsertErr } = await supabaseClient
      .from("org_settings")
      .upsert(
        {
          org_id: orgId,
          app_name: branding.appName || null,
          primary_color: branding.primaryColor || null,
          accent_color: branding.accentColor || null,
          logo_url: branding.logoUrl || null,
          terms_label: branding.termsLabel || null,
          bookings_label: branding.bookingsLabel || null,
        },
        { onConflict: "org_id" }
      )
      .select()
      .maybeSingle();
    if (upsertErr) throw upsertErr;
    return upserted ? normalizeBrandingRow(upserted) : null;
  }

  async function pullLatestFromServer() {
    const state = await storage.getState();
    if (!isCloudReady(state)) return;
    await loadBrandingForOrg(state.activeOrgId);
    const { data, error } = await supabaseClient
      .from("workshop_states")
      .select("*")
      .eq("org_id", state.activeOrgId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("Pull failed", error);
      return;
    }
    if (!data) return;
    const localUpdated = state.meta.lastSyncAt ? new Date(state.meta.lastSyncAt).getTime() : 0;
    const remoteUpdated = data.updated_at ? new Date(data.updated_at).getTime() : 0;
    if (remoteUpdated > localUpdated) {
      const merged = { ...clone(stateDefaults), ...data.data, meta: { ...state.meta, lastSyncAt: data.updated_at, lastSyncError: null } };
      merged.activeOrgId = state.activeOrgId;
      merged.orgs = state.orgs;
      merged.user = state.user;
      await storage.saveState(merged);
      memoryState = merged;
      renderAll();
      showToast("Cloud-Daten wurden geladen", "info");
    } else if (remoteUpdated < localUpdated) {
      console.warn("Remote Daten aelter als lokal, behalte lokal", { remoteUpdated, localUpdated });
    }
  }

  async function pushStateToServer(state) {
    if (!isCloudReady(state)) return;
    const payload = {
      org_id: state.activeOrgId,
      data: { ...state, meta: { ...state.meta, lastSyncAt: null } },
      updated_at: new Date().toISOString(),
      updated_by: authUser.id,
    };
    const { error } = await supabaseClient.from("workshop_states").upsert(payload, { onConflict: "org_id" });
    if (error) throw error;
    const next = { ...clone(state), meta: { ...state.meta, lastSyncAt: payload.updated_at, lastSyncError: null } };
    await storage.saveState(next, { skipSnapshot: true });
    memoryState = next;
    await pushServerBackup(next);
    renderDebug();
    return payload.updated_at;
  }

  async function pushServerBackup(state) {
    if (!isCloudReady(state)) return;
    const snapshot = { org_id: state.activeOrgId, snapshot: clone(state), created_at: new Date().toISOString(), created_by: authUser.id };
    const { error } = await supabaseClient.from("backups").insert(snapshot);
    if (error) console.warn("Server backup failed", error);
  }

  async function fetchServerBackups() {
    const state = await storage.getState();
    if (!isCloudReady(state)) return [];
    const { data, error } = await supabaseClient
      .from("backups")
      .select("*")
      .eq("org_id", state.activeOrgId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) {
      console.warn("Backups fetch failed", error);
      return [];
    }
    return data || [];
  }

  async function restoreServerBackup(id) {
    const state = await storage.getState();
    if (!isCloudReady(state)) throw new Error("Nicht eingeloggt");
    const { data, error } = await supabaseClient.from("backups").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Backup nicht gefunden");
    await storage.importBackup({ state: data.snapshot });
    memoryState = await storage.getState();
    renderAll();
    await storage.queueSet(memoryState);
    scheduleSync();
  }

  async function scheduleSync(delayMs) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(flushQueue, delayMs || SYNC_DEBOUNCE_MS);
  }

  async function flushQueue() {
    if (flushInFlight) return;
    flushInFlight = true;
    try {
      const queued = await storage.queueGetLatest();
      if (!queued) return;
      const state = await storage.getState();
      if (!navigator.onLine) return;
      if (!isCloudReady(state)) return;
      await pushStateToServer(queued.state);
      await storage.queueClear();
      syncRetry = 0;
      showToast("Cloud gesichert", "success");
    } catch (err) {
      const state = await storage.getState();
      state.meta.lastSyncError = err.message;
      await storage.saveState(state, { skipSnapshot: true });
      memoryState = state;
      syncRetry += 1;
      const nextDelay = Math.min(30000, Math.pow(2, syncRetry) * 1000);
      showToast("Cloud-Sicherung fehlgeschlagen: " + err.message, "error");
      scheduleSync(nextDelay);
    } finally {
      flushInFlight = false;
      renderDebug();
    }
  }

  window.addEventListener("online", () => {
    renderStatus();
    scheduleSync();
  });
  window.addEventListener("offline", renderStatus);
  /* ---------- UI Helpers ---------- */
  const toast = qs("#toast");
  const toastMsg = qs("#toastMsg");
  const toastLink = qs("#toastLink");
  function showToast(msg, type = "info", link) {
    if (!toast) return;
    toastMsg.textContent = msg;
    toast.dataset.type = type;
    if (link) {
      toastLink.classList.remove("hidden");
      toastLink.href = link.href || "#";
      toastLink.textContent = link.label || "OK";
      toastLink.onclick = link.onClick
        ? (e) => {
            e.preventDefault();
            link.onClick();
          }
        : null;
    } else {
      toastLink.classList.add("hidden");
    }
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 6000);
  }
  function setFocus(el) {
    if (!el) return;
    requestAnimationFrame(() => el.focus());
  }

  /* ---------- Modal Helpers ---------- */
  const modalBooking = qs("#modalBooking");
  const modalSlots = qs("#modalSlots");
  const modalConfirmDelete = qs("#modalConfirmDelete");
  const modalBackupImport = qs("#modalBackupImport");
  const modalBackupHelp = qs("#modalBackupHelp");
  const modalSettings = qs("#modalSettings");
  function openModal(el) {
    if (!el) return;
    [modalBooking, modalSlots, modalBackupImport, modalBackupHelp, modalSettings].forEach((m) => {
      if (!m) return;
      m.classList.add("hidden");
      m.classList.remove("flex");
    });
    el.classList.remove("hidden");
    el.classList.add("flex");
  }
  function closeModal(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.classList.remove("flex");
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") [modalBooking, modalSlots, modalConfirmDelete, modalBackupImport, modalBackupHelp, modalSettings].forEach((m) => closeModal(m));
  });
  qsa("[data-close='booking']").forEach((b) => b.addEventListener("click", () => closeModal(modalBooking)));
  qsa("[data-close='slots']").forEach((b) => b.addEventListener("click", () => closeModal(modalSlots)));
  qsa("[data-close='backup']").forEach((b) => b.addEventListener("click", () => closeModal(modalBackupImport)));
  qsa("[data-close='backuphelp']").forEach((b) => b.addEventListener("click", () => closeModal(modalBackupHelp)));
  qsa("[data-close='settings']").forEach((b) => b.addEventListener("click", () => closeModal(modalSettings)));
  modalSlots?.addEventListener("click", (e) => {
    if (e.target === modalSlots) closeModal(modalSlots);
  });
  modalBooking?.addEventListener("click", (e) => {
    if (e.target === modalBooking) closeModal(modalBooking);
  });
  modalBackupImport?.addEventListener("click", (e) => {
    if (e.target === modalBackupImport) closeModal(modalBackupImport);
  });
  modalSettings?.addEventListener("click", (e) => {
    if (e.target === modalSettings) closeModal(modalSettings);
  });

  /* ---------- Domain helpers ---------- */
  const CATS = ["Workshop", "Kindergeburtstag", "JGA", "Maedelsabend", "Weihnachtsfeier", "Kurs", "Event", "Seminar", "Private Gruppe", "Sonstiges"];
  const CHANNELS = ["", "Instagram", "WhatsApp", "E-Mail", "Triviar", "Telefonisch", "Persoenlich"];
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const normalizePhoneDE = (raw) => {
    let d = (raw || "").replace(/\D+/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("0")) d = "49" + d.slice(1);
    return d;
  };
  const bookingsBySlot = (slotId, state) => (state.bookings || []).filter((b) => b.slotId === slotId);
  const sumBooked = (slotId, state) => bookingsBySlot(slotId, state).reduce((n, b) => n + Number(b.count || 0), 0);
  function slotStatus(slot, state) {
    if (slot.archived) return "archived";
    const booked = sumBooked(slot.id, state);
    const left = slot.capacity - booked;
    const past = new Date(slot.ends_at) < new Date();
    if (past) return "past";
    if (left <= 0) return "full";
    return "open";
  }

  /* ---------- Rendering ---------- */
  async function renderAll() {
    const state = await storage.getState();
    render(state);
    renderStatus();
    renderAuth();
    await renderBrandingUI();
    renderLocalBackups();
    renderServerBackups();
    renderDebug();
  }

  function statusBadge(status, left) {
    if (status === "archived") return `<span class="px-2 py-1 rounded-lg bg-slate-300 text-xs">archiv</span>`;
    if (status === "past") return `<span class="px-2 py-1 rounded-lg bg-gray-300 text-xs">vergangen</span>`;
    if (status === "full") return `<span class="px-2 py-1 rounded-lg bg-rose-200 text-xs">voll</span>`;
    const tone = left <= 2 ? "bg-amber-200" : "bg-emerald-200";
    return `<span class="px-2 py-1 rounded-lg ${tone} text-xs">${left} frei</span>`;
  }

  function renderBookingsMini(slotId, state) {
    const bookingLabel = currentBranding.bookingsLabel || DEFAULT_BRANDING.bookingsLabel;
    const list = bookingsBySlot(slotId, state);
    if (!list.length) return `<div class="text-xs text-slate-500 mt-2">Noch keine ${bookingLabel}.</div>`;
    return `
      <div class="mt-2 text-sm">
        <div class="font-medium mb-1">${bookingLabel} (Tippen zum Bearbeiten/Loeschen):</div>
        <ul class="space-y-1">
          ${list
            .map((b) => {
              const badge = b.channel ? `<span class="ml-2 text-[11px] px-2 py-[2px] rounded-full bg-gray-100 border border-gray-200 text-slate-600">${b.channel}</span>` : "";
              return `<li class="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 cursor-pointer hover:bg-gray-100" data-booking="${b.id}">
                        <span>${b.name} (${b.count}) - ${b.phone}${b.notes ? " - " + b.notes : ""}${badge}</span>
                        <span class="text-xs text-slate-400">></span>
                      </li>`;
            })
            .join("")}
        </ul>
      </div>`;
  }

  async function render(state) {
    memoryState = state;
    const search = (qs("#search")?.value || "").toLowerCase().trim();
    const filter = qs("#filterStatus")?.value || "";
    const termsLabel = currentBranding.termsLabel || DEFAULT_BRANDING.termsLabel;
    const bookingsLabel = currentBranding.bookingsLabel || DEFAULT_BRANDING.bookingsLabel;
    const all = (state.slots || []).map((s) => ({ archived: false, ...s }));
    let active = all.filter((s) => !s.archived).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    let archived = all.filter((s) => s.archived).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

    const matchSearch = (s) => [s.title, s.starts_at, s.ends_at].join(" ").toLowerCase().includes(search);
    if (search) {
      active = active.filter(matchSearch);
      archived = archived.filter(matchSearch);
    }
    if (filter) {
      const f = (s) => slotStatus(s, state) === filter;
      active = active.filter(f);
      archived = archived.filter(f);
    }

    const renderCard = (s) => {
      const booked = sumBooked(s.id, state);
      const left = Math.max(0, s.capacity - booked);
      const status = slotStatus(s, state);
      const bar = Math.min(100, Math.round((100 * booked) / Math.max(1, s.capacity)));
      const barColor =
        status === "archived"
          ? "bg-slate-300"
          : status === "past"
          ? "bg-gray-300"
          : status === "full"
          ? "bg-rose-400"
          : left <= 2
          ? "bg-amber-400"
          : "bg-emerald-500";
      const actions = `
        ${s.archived ? "" : `<button type="button" class="px-3 py-2 rounded-xl text-sm" style="background:var(--primary);color:white" data-open-booking="${s.id}">${bookingsLabel}</button>`}
        <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm" data-edit-slot="${s.id}">${termsLabel} bearbeiten</button>
        <button type="button" class="px-3 py-2 rounded-xl ${s.archived ? "bg-emerald-100 hover:bg-emerald-200" : "bg-slate-100 hover:bg-slate-200"} text-sm" data-toggle-archive="${s.id}" data-flag="${!s.archived}">${s.archived ? "Aus Archiv holen" : "Archivieren"}</button>
        <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm" data-ics="${s.id}">Kalender (.ics)</button>
        <button type="button" class="px-3 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-sm" data-delete-slot="${s.id}">${termsLabel} loeschen</button>
      `;
      return `
        <div class="rounded-2xl p-4 bg-white/85 backdrop-blur border border-gray-200 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm text-slate-500">${statusBadge(status, left)}</div>
              <div class="font-semibold text-[20px] sm:text-base leading-snug break-words" style="color:var(--primary)">${s.title}</div>
              <div class="text-sm">${fmtDate(s.starts_at)} - ${fmtDate(s.ends_at)}</div>
              <div class="text-sm mt-1">Kapazitaet: ${s.capacity} - Gebucht: ${booked} - Frei: ${left}</div>
              <div class="h-2 mt-2 bg-gray-100 rounded-full overflow-hidden"><div class="h-2 ${barColor}" style="width:${bar}%"></div></div>
              ${renderBookingsMini(s.id, state)}
            </div>
            <div class="hidden sm:flex flex-col gap-2 shrink-0">${actions}</div>
          </div>
          <div class="mt-3 sm:hidden flex flex-wrap gap-2">${actions}</div>
        </div>`;
    };

    const listEl = qs("#list");
    if (!listEl) return;
    try {
      listEl.innerHTML = `
      <details id="activeSection" class="mb-6" ${state.ui?.collapsedActive ? "" : "open"}>
        <summary class="list-none cursor-pointer select-none rounded-xl px-3 py-2 bg-slate-200/70 hover:bg-slate-300/70 border border-gray-200 flex items-center justify-between shadow-sm">
          <span class="font-medium">Aktuell (${active.length})</span>
          <span class="text-slate-500 text-sm">${state.ui?.collapsedActive ? "ausklappen" : "einklappen"}</span>
        </summary>
        <div class="mt-3 space-y-3">
          ${active.length ? active.map(renderCard).join("") : `<div class="text-slate-600 bg-white/80 p-4 rounded-2xl border border-gray-200">Keine aktiven Termine.</div>`}
        </div>
      </details>
      ${
        archived.length
          ? `<details id="archSection" class="mt-6" ${state.ui?.collapsedArchive ? "" : "open"}>
              <summary class="list-none cursor-pointer select-none rounded-xl px-3 py-2 bg-slate-200/70 hover:bg-slate-300/70 border border-gray-200 flex items-center justify-between shadow-sm">
                <span class="font-medium">Archiv (${archived.length})</span>
                <span class="text-slate-500 text-sm">${state.ui?.collapsedArchive ? "ausklappen" : "einklappen"}</span>
              </summary>
              <div class="mt-3 space-y-3">${archived.map(renderCard).join("")}</div>
            </details>`
          : ""
      }`;
    } catch (err) {
      logError("render", err);
    }
    bindDynamicListHandlers();
  }

  let listEventListenerBound = false;
  function bindDynamicListHandlers() {
    const listEl = qs("#list");
    if (!listEl) return;

    // Event-Delegation: Ein Listener für alle Buttons
    if (!listEventListenerBound) {
      listEl.addEventListener("click", (e) => {
        const target = e.target.closest("button, li[data-booking]");
        if (!target) return;

        try {
          if (target.hasAttribute("data-open-booking")) {
            e.preventDefault();
            openBooking(target.dataset.openBooking);
          } else if (target.hasAttribute("data-edit-slot")) {
            e.preventDefault();
            editSlot(target.dataset.editSlot);
          } else if (target.hasAttribute("data-toggle-archive")) {
            e.preventDefault();
            toggleArchive(target.dataset.toggleArchive, target.dataset.flag === "true");
          } else if (target.hasAttribute("data-delete-slot")) {
            e.preventDefault();
            confirmDeleteSlot(target.dataset.deleteSlot);
          } else if (target.hasAttribute("data-ics")) {
            e.preventDefault();
            downloadICS(target.dataset.ics);
          } else if (target.hasAttribute("data-booking")) {
            e.preventDefault();
            editBooking(target.dataset.booking);
          }
        } catch (err) {
          logError("bindDynamicListHandlers", err, { action: target.dataset });
          showToast("Aktion fehlgeschlagen", "error");
        }
      });
      listEventListenerBound = true;
    }

    // Details-Toggle-Listener (werden bei jedem Render neu gebunden)
    const act = qs("#activeSection");
    const arch = qs("#archSection");
    if (act) {
      const newAct = act.cloneNode(true);
      act.replaceWith(newAct);
      const refreshedAct = qs("#activeSection");
      if (refreshedAct) refreshedAct.addEventListener("toggle", () => updateCollapse("collapsedActive", !refreshedAct.open));
    }
    if (arch) {
      const newArch = arch.cloneNode(true);
      arch.replaceWith(newArch);
      const refreshedArch = qs("#archSection");
      if (refreshedArch) refreshedArch.addEventListener("toggle", () => updateCollapse("collapsedArchive", !refreshedArch.open));
    }
  }

  async function updateCollapse(key, value) {
    await updateState(
      (draft) => {
        draft.ui = draft.ui || {};
        draft.ui[key] = value;
      },
      { skipSnapshot: true, skipSync: true, skipRender: true }
    );
  }
  /* ---------- Slots ---------- */
  const formSlot = qs("form#formSlot");
  const slCat = qs("#sl_category");
  const rowTitleOther = qs("#row_title_other");
  const slTitleOther = qs("#sl_title_other");
  slCat?.addEventListener("change", () => {
    if (rowTitleOther) rowTitleOther.style.display = slCat.value === "Sonstiges" ? "block" : "none";
  });
  qs("#btnManageSlots")?.addEventListener("click", () => openSlotCreate());
  qs("#m_btnManageSlots")?.addEventListener("click", () => {
    closeMobileMenu();
    openSlotCreate();
  });
  function openSlotCreate() {
    if (!slCat || !rowTitleOther || !slTitleOther) return;
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17);
    const e = new Date(s.getTime() + 2 * 3600 * 1000);
    if (slCat) slCat.value = "Workshop";
    if (rowTitleOther) rowTitleOther.style.display = "none";
    if (slTitleOther) slTitleOther.value = "";
    const cap = qs("#sl_capacity");
    const st = qs("#sl_starts");
    const en = qs("#sl_ends");
    if (cap) cap.value = 10;
    if (st) st.value = toLocal(s);
    if (en) en.value = toLocal(e);
    bindCreateSlotHandler();
    openModal(modalSlots);
    setFocus(qs("#sl_capacity"));
  }
  function bindCreateSlotHandler() {
    if (!formSlot) return;
    formSlot.onsubmit = async (ev) => {
      ev.preventDefault();
      const title = slCat && slCat.value === "Sonstiges" ? (slTitleOther?.value || "").trim() || "Workshop" : slCat?.value;
      const capEl = qs("#sl_capacity");
      const stEl = qs("#sl_starts");
      const enEl = qs("#sl_ends");
      const slot = {
        id: uid(),
        title,
        capacity: Number(capEl?.value || 0),
        starts_at: stEl ? new Date(stEl.value).toISOString() : new Date().toISOString(),
        ends_at: enEl ? new Date(enEl.value).toISOString() : new Date().toISOString(),
        archived: false,
      };
      if (!slot.capacity || !stEl?.value || !enEl?.value) {
        showToast("Bitte Start, Ende und Kapazitaet angeben.", "error");
        return;
      }
      try {
        await updateState((draft) => {
          draft.slots.push(slot);
          draft.meta.lastSaveAt = new Date().toISOString();
        });
        closeModal(modalSlots);
        showToast("Termin gespeichert", "success");
      } catch (err) {
        showToast("Speichern fehlgeschlagen: " + err.message, "error");
      }
    };
  }
  async function editSlot(id) {
    const state = await storage.getState();
    const s = (state.slots || []).find((x) => x.id === id);
    if (!s) return;
    if (!formSlot) return;
    if (slCat) {
      if (CATS.includes(s.title)) {
        slCat.value = s.title;
        if (rowTitleOther) rowTitleOther.style.display = "none";
        if (slTitleOther) slTitleOther.value = "";
      } else {
        slCat.value = "Sonstiges";
        if (rowTitleOther) rowTitleOther.style.display = "block";
        if (slTitleOther) slTitleOther.value = s.title;
      }
    }
    const cap = qs("#sl_capacity");
    const st = qs("#sl_starts");
    const en = qs("#sl_ends");
    if (cap) cap.value = s.capacity;
    if (st) st.value = toLocal(new Date(s.starts_at));
    if (en) en.value = toLocal(new Date(s.ends_at));
    formSlot.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await updateState((draft) => {
          const slot = draft.slots.find((x) => x.id === id);
          if (!slot) return;
          const titleVal = slCat && slCat.value === "Sonstiges" ? (slTitleOther?.value || "").trim() || slot.title : slCat?.value || slot.title;
          slot.title = titleVal;
          const capEl = qs("#sl_capacity");
          const stEl = qs("#sl_starts");
          const enEl = qs("#sl_ends");
          slot.capacity = Number(capEl?.value || 0);
          if (stEl?.value) slot.starts_at = new Date(stEl.value).toISOString();
          if (enEl?.value) slot.ends_at = new Date(enEl.value).toISOString();
          draft.meta.lastSaveAt = new Date().toISOString();
        });
        closeModal(modalSlots);
        showToast("Termin aktualisiert", "success");
      } catch (err) {
        showToast("Speichern fehlgeschlagen: " + err.message, "error");
      }
    };
    openModal(modalSlots);
    setFocus(qs("#sl_capacity"));
  }
  async function toggleArchive(id, flag) {
    try {
      await updateState((draft) => {
        const s = draft.slots.find((x) => x.id === id);
        if (s) s.archived = !!flag;
        draft.meta.lastSaveAt = new Date().toISOString();
      });
    } catch (err) {
      showToast("Konnte Archiv-Status nicht speichern: " + err.message, "error");
    }
  }

  function confirmDeleteSlot(id) {
    pendingDeleteSlotId = id;
    if (!modalConfirmDelete) return;
    modalConfirmDelete.classList.remove("hidden");
    modalConfirmDelete.classList.add("flex");
  }
  qs("#btnCancelDelete")?.addEventListener("click", () => closeConfirmDelete());
  qs("#btnConfirmDelete")?.addEventListener("click", async () => {
    if (!pendingDeleteSlotId) return closeConfirmDelete();
    try {
      await updateState((draft) => {
        draft.slots = draft.slots.filter((s) => s.id !== pendingDeleteSlotId);
        draft.bookings = draft.bookings.filter((b) => b.slotId !== pendingDeleteSlotId);
        draft.meta.lastSaveAt = new Date().toISOString();
      });
      showToast("Termin geloescht", "success");
    } catch (err) {
      showToast("Loeschen fehlgeschlagen: " + err.message, "error");
    }
    closeConfirmDelete();
  });
  function closeConfirmDelete() {
    if (!modalConfirmDelete) return;
    modalConfirmDelete.classList.add("hidden");
    modalConfirmDelete.classList.remove("flex");
    pendingDeleteSlotId = null;
  }

  /* ---------- Bookings ---------- */
  const formBooking = qs("#formBooking");
  const btnDeleteBooking = qs("#btnDeleteBooking");
  const btnWhatsappShare = qs("#btnWhatsappShare");
  const selChannel = qs("#bk_channel");
  window.openBooking = (slotId) => openBooking(slotId);
  function openBooking(slotId) {
    ctx.currentSlotId = slotId;
    ctx.currentBookingId = null;
    const nameEl = qs("#bk_name");
    const phoneEl = qs("#bk_phone");
    const notesEl = qs("#bk_notes");
    const countEl = qs("#bk_count");
    if (nameEl) nameEl.value = "";
    if (phoneEl) phoneEl.value = "";
    if (notesEl) notesEl.value = "";
    if (countEl) countEl.value = 1;
    if (selChannel) selChannel.value = "";
    const sal = qs("#bk_salutation");
    if (sal) sal.value = "Liebe/r";
    const modalTitle = qs("#modalBookingTitle");
    if (modalTitle) modalTitle.textContent = "Buchung hinzufuegen";
    toggleDeleteButton(false);
    btnWhatsappShare?.classList.add("hidden");
    openModal(modalBooking);
    setFocus(qs("#bk_name"));
  }

  async function editBooking(id) {
    const state = await storage.getState();
    const b = (state.bookings || []).find((x) => x.id === id);
    if (!b) return;
    ctx.currentSlotId = b.slotId;
    ctx.currentBookingId = b.id;
    const nameEl = qs("#bk_name");
    const phoneEl = qs("#bk_phone");
    const notesEl = qs("#bk_notes");
    const countEl = qs("#bk_count");
    if (nameEl) nameEl.value = b.name;
    if (phoneEl) phoneEl.value = b.phone;
    if (notesEl) notesEl.value = b.notes || "";
    if (countEl) countEl.value = b.count;
    if (selChannel) selChannel.value = b.channel || "";
    const sal = qs("#bk_salutation");
    if (sal) sal.value = b.salutation || "Liebe/r";
    const modalTitle = qs("#modalBookingTitle");
    if (modalTitle) modalTitle.textContent = "Buchung bearbeiten";
    toggleDeleteButton(true);
    btnWhatsappShare?.classList.remove("hidden");
    btnWhatsappShare.onclick = () => openWhatsappConfirmation(b);
    btnDeleteBooking.onclick = async () => {
      try {
        await updateState((draft) => {
          draft.bookings = draft.bookings.filter((x) => x.id !== b.id);
          draft.meta.lastSaveAt = new Date().toISOString();
        });
        ctx.currentBookingId = null;
        closeModal(modalBooking);
      } catch (err) {
        showToast("Loeschen fehlgeschlagen: " + err.message, "error");
      }
    };
    openModal(modalBooking);
    setFocus(qs("#bk_name"));
  }
  function toggleDeleteButton(on) {
    if (btnDeleteBooking) btnDeleteBooking.classList.toggle("hidden", !on);
  }
  function openWhatsappConfirmation(b) {
    storage.getState().then((state) => {
      const slot = (state.slots || []).find((s) => s.id === b.slotId);
      if (!slot) return;
      const when = fmtDate(slot.starts_at);
      const salutation = b.salutation || "Liebe/r";
      const plural = Number(b.count) > 1;
      const youAcc = plural ? "euch" : "dich";
      const youDat = plural ? "euch" : "dir";
      const txt = `${salutation} ${b.name},

hiermit bestaetige ich ${youDat} die Teilnahme am ${when}
fuer ${b.count} Person${plural ? "en" : ""}.

Ich freue mich auf ${youAcc} und wuensche ${youDat} bis dahin alles Gute.

Ganz liebe Gruesse
Stefanie`;
      const number = normalizePhoneDE(b.phone);
      const url = `https://wa.me/${number}?text=${encodeURIComponent(txt)}`;
      window.open(url, "_blank");
    });
  }

  formBooking?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const state = await storage.getState();
    const slot = (state.slots || []).find((s) => s.id === ctx.currentSlotId);
    if (!slot) {
      closeModal(modalBooking);
      return;
    }
    const editing = !!ctx.currentBookingId;
    const old = editing ? state.bookings.find((x) => x.id === ctx.currentBookingId) : null;
    const nameEl = qs("#bk_name");
    const phoneEl = qs("#bk_phone");
    const notesEl = qs("#bk_notes");
    const countEl = qs("#bk_count");
    const salEl = qs("#bk_salutation");
    if (!nameEl || !phoneEl || !countEl) {
      showToast("Formular unvollstaendig.", "error");
      return;
    }
    const booking = {
      id: editing && old ? old.id : uid(),
      slotId: slot.id,
      salutation: salEl?.value || "Liebe/r",
      name: nameEl.value.trim(),
      phone: phoneEl.value.trim(),
      notes: notesEl?.value?.trim() || "",
      count: Number(countEl.value || 0),
      channel: selChannel ? selChannel.value : "",
      created_at: editing && old ? old.created_at : new Date().toISOString(),
    };
    if (!booking.name || !booking.phone || !booking.count) {
      showToast("Bitte Name, Telefon und Personenanzahl angeben.", "error");
      return;
    }
    const normNew = normalizePhoneDE(booking.phone);
    const dup = state.bookings.find((x) => x.slotId === slot.id && (!editing || x.id !== old.id) && normalizePhoneDE(x.phone) === normNew);
    if (dup) {
      const proceed = confirm("Telefonnummer bereits erfasst. Trotzdem speichern?");
      if (!proceed) return;
    }
    const already = sumBooked(slot.id, state);
    const bookedExceptThis = editing ? already - Number(old.count || 0) : already;
    const left = slot.capacity - bookedExceptThis;
    if (booking.count > left) {
      showToast(`Es sind nur noch ${left} Plaetze frei.`, "error");
      return;
    }
    try {
      await updateState((draft) => {
        if (editing) {
          const i = draft.bookings.findIndex((x) => x.id === old.id);
          draft.bookings[i] = booking;
        } else {
          draft.bookings.push(booking);
        }
        draft.meta.lastSaveAt = new Date().toISOString();
      });
    const hint = `Termin ${fmtDate(slot.starts_at)} - ${booking.count} Pers.\n${booking.name} ${booking.phone}\n${booking.notes || ""}`;
      navigator.clipboard?.writeText(hint).catch(() => {});
      ctx.currentBookingId = null;
      closeModal(modalBooking);
      showToast("Buchung gespeichert", "success");
    } catch (err) {
      showToast("Speichern fehlgeschlagen: " + err.message, "error");
    }
  });
  /* ---------- Backup / Export ---------- */
  qs("#btnExportCsv")?.addEventListener("click", exportCsv);
  qs("#btnBackup")?.addEventListener("click", handleExportBackup);
  qs("#m_btnBackup")?.addEventListener("click", () => {
    closeMobileMenu();
    handleExportBackup();
  });
  
  /* ---------- Cache Clear / Reset ---------- */
  qs("#btnClearCache")?.addEventListener("click", handleClearCache);
  qs("#m_btnClearCache")?.addEventListener("click", () => {
    closeMobileMenu();
    handleClearCache();
  });
  
  /* ---------- Backup Help ---------- */
  qs("#btnBackupHelp")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openModal(modalBackupHelp);
  });
  
  async function handleClearCache() {
    if (!confirm("⚠️ Speicher zurücksetzen?\n\nAlle lokalen Daten und Einstellungen werden gelöscht.\nNur fortfahren, wenn du ein Backup hast!\n\nOnline gespeicherte Daten bleiben erhalten.")) {
      return;
    }
    try {
      // IndexedDB löschen
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = resolve;
        req.onerror = () => reject(new Error("DB-Löschung fehlgeschlagen"));
      });
      
      // Service Worker Cache löschen
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }
      
      // Service Worker deregistrieren
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
      }
      
      showToast("✅ Speicher gelöscht - Seite wird neu geladen", "success");
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      logError("handleClearCache", err);
      showToast("Fehler beim Zurücksetzen: " + err.message, "error");
    }
  }
  
  qs("#fileRestore")?.addEventListener("change", (e) => openRestorePreview(e.target.files?.[0]));
  qs("#m_fileRestore")?.addEventListener("change", (e) => {
    openRestorePreview(e.target.files?.[0]);
    closeMobileMenu();
  });

  async function exportCsv() {
    const state = await storage.getState();
    const slots = state.slots || [];
    const bks = state.bookings || [];
    let csv = "slot_id;slot_title;starts_at;ends_at;capacity;archived;booking_id;name;phone;notes;count;channel;created_at\n";
    for (const s of slots) {
      const list = bks.filter((b) => b.slotId === s.id);
      if (!list.length) {
        csv += `"${s.id}";"${s.title}";"${s.starts_at}";"${s.ends_at}";"${s.capacity}";"${!!s.archived}";"";"";"";"";"";""\n`;
      } else {
        for (const b of list) {
          csv += `"${s.id}";"${s.title}";"${s.starts_at}";"${s.ends_at}";"${s.capacity}";"${!!s.archived}";"${b.id}";"${b.name}";"${b.phone}";"${(b.notes || "").replace(/"/g, '""')}";"${b.count}";"${b.channel || ""}";"${b.created_at}"\n`;
        }
      }
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "termine.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleExportBackup() {
    const backup = await storage.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date();
    const name = `termin_backup_${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("JSON-Backup heruntergeladen", "success");
  }

  async function openRestorePreview(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || (!parsed.state && (!Array.isArray(parsed.slots) || !Array.isArray(parsed.bookings)))) {
        throw new Error("Format ungueltig");
      }
      const state = parsed.state || parsed;
      ctx.importPreview = { fileName: file.name, slots: state.slots?.length || 0, bookings: state.bookings?.length || 0, payload: state };
      qs("#importFileName").textContent = file.name;
      qs("#importCounts").textContent = `${ctx.importPreview.slots} Termine - ${ctx.importPreview.bookings} Buchungen`;
      openModal(modalBackupImport);
    } catch (err) {
      showToast("Wiederherstellung fehlgeschlagen: " + err.message, "error");
    } finally {
      const f1 = qs("#fileRestore");
      const f2 = qs("#m_fileRestore");
      if (f1) f1.value = "";
      if (f2) f2.value = "";
    }
  }

  qs("#btnConfirmImport")?.addEventListener("click", async () => {
    if (!ctx.importPreview) return;
    try {
      await storage.importBackup({ state: ctx.importPreview.payload });
      memoryState = await storage.getState();
      await storage.queueSet(memoryState);
      scheduleSync();
      renderAll();
      showToast("Backup importiert", "success");
    } catch (err) {
      showToast("Import fehlgeschlagen: " + err.message, "error");
    }
    ctx.importPreview = null;
    closeModal(modalBackupImport);
  });
  qs("#btnCancelImport")?.addEventListener("click", () => {
    ctx.importPreview = null;
    closeModal(modalBackupImport);
  });

  async function renderLocalBackups() {
    const list = await storage.listLocalBackups();
    const el = qs("#localBackups");
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<li class="text-sm text-slate-500">Keine lokalen Snapshots</li>`;
      return;
    }
    el.innerHTML = list
      .map(
        (b) => `<li class="flex items-center justify-between text-sm border-b border-gray-100 py-1">
          <span>${fmtDate(b.created_at)} · ${b.reason} · ${b.state?.slots?.length || 0} Termine / ${b.state?.bookings?.length || 0} Buchungen</span>
          <button class="text-xs px-2 py-1 bg-gray-100 rounded" data-restore-local="${b.id}">Wiederherstellen</button>
        </li>`
      )
      .join("");
    qsa("[data-restore-local]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const item = list.find((b) => String(b.id) === String(btn.dataset.restoreLocal));
        if (!item) return;
        await storage.importBackup({ state: item.state });
        memoryState = await storage.getState();
        renderAll();
      })
    );
  }

  async function renderServerBackups() {
    const el = qs("#serverBackups");
    if (!el) return;
    if (!authUser || !supabaseClient) {
      el.innerHTML = `<li class="text-sm text-slate-500">Nicht angemeldet</li>`;
      return;
    }
    const list = await fetchServerBackups();
    if (!list.length) {
      el.innerHTML = `<li class="text-sm text-slate-500">Noch keine Cloud-Sicherungen</li>`;
      return;
    }
    el.innerHTML = list
      .map(
        (b) => `<li class="flex items-center justify-between text-sm border-b border-gray-100 py-1">
          <span>${fmtDate(b.created_at || b.inserted_at)} · ${b.snapshot?.slots?.length || 0} Termine / ${b.snapshot?.bookings?.length || 0} Buchungen</span>
          <button class="text-xs px-2 py-1 bg-gray-100 rounded" data-restore-server="${b.id}">Wiederherstellen</button>
        </li>`
      )
      .join("");
    qsa("[data-restore-server]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await restoreServerBackup(btn.dataset.restoreServer);
          showToast("Cloud-Backup importiert", "success");
        } catch (err) {
          showToast("Cloud-Backup fehlgeschlagen: " + err.message, "error");
        }
      })
    );
  }
  /* ---------- Search / Filter ---------- */
  qs("#search")?.addEventListener("input", async () => render(await storage.getState()));
  qs("#filterStatus")?.addEventListener("change", async () => render(await storage.getState()));

  /* ---------- Mobile Menu ---------- */
  const mobileMenu = qs("#mobileMenu");
  const mobilePanel = qs("#mobilePanel");
  const btnMenu = qs("#btnMenu");
  const mBtnLogout = qs("#m_btnLogout");
  const mBtnLogin = qs("#m_btnLogin");
  function openMobileMenu() {
    if (!mobileMenu || !mobilePanel) return;
    mobileMenu.classList.remove("hidden");
    requestAnimationFrame(() => mobilePanel.classList.remove("translate-x-full"));
  }
  function closeMobileMenu() {
    if (!mobileMenu || !mobilePanel) return;
    mobilePanel.classList.add("translate-x-full");
    const onDone = () => {
      mobileMenu.classList.add("hidden");
      mobilePanel.removeEventListener("transitionend", onDone);
    };
    mobilePanel.addEventListener("transitionend", onDone);
  }
  btnMenu?.addEventListener("click", openMobileMenu);
  qsa("[data-close='mobilemenu']").forEach((b) => b.addEventListener("click", closeMobileMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileMenu();
  });
  qs("#m_btnExportCsv")?.addEventListener("click", () => {
    closeMobileMenu();
    exportCsv();
  });
  qs("#m_btnArchiveView")?.addEventListener("click", () => {
    closeMobileMenu();
    qs("#btnArchiveView")?.click();
  });
  
  /* ---------- Settings ---------- */
  qs("#btnSettings")?.addEventListener("click", () => openModal(modalSettings));
  qs("#m_btnSettings")?.addEventListener("click", () => {
    closeMobileMenu();
    openModal(modalSettings);
  });
  
  mBtnLogin?.addEventListener("click", () => {
    closeMobileMenu();
    const email = qs("#authEmail");
    if (email) email.focus();
  });
  mBtnLogout?.addEventListener("click", () => {
    closeMobileMenu();
    btnLogout?.click();
  });

  /* ---------- Archive Jump ---------- */
  qs("#btnArchiveView")?.addEventListener("click", () => {
    const el = document.getElementById("archSection");
    if (!el) {
      showToast("Noch nichts im Archiv.", "info");
      return;
    }
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Service Worker Update ---------- */
  const updateBanner = qs("#updateBanner");
  const updateReloadBtn = qs("#btnReloadUpdate");
  function setupServiceWorkerUpdate() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateWaitingWorker && !updateWaitingWorker.skipWaiting) location.reload();
    });
    navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            updateWaitingWorker = newWorker;
            showUpdateBanner();
          }
        });
      });
    });
  }
  function showUpdateBanner() {
    if (!updateBanner) return;
    updateBanner.classList.remove("hidden");
  }
  updateReloadBtn?.addEventListener("click", () => {
    if (updateWaitingWorker) updateWaitingWorker.postMessage({ type: "SKIP_WAITING" });
    showToast("Update geladen, Seite wird neu geladen", "success");
    setTimeout(() => location.reload(), 400);
  });

  /* ---------- Debug ---------- */
  async function renderDebug() {
    if (!isDebug) return;
    const panel = qs("#debugPanel");
    if (!panel) return;
    panel.classList.remove("hidden");
    const state = await storage.getState();
    const qLen = await storage.queueLength();
    const lines = [
      `Storage OK: ${!!state.slots}`,
      `Letzte Speicherung: ${state.meta.lastSaveAt || "-"}`,
      `Letzter Sync: ${state.meta.lastSyncAt || "-"}`,
      `Queue: ${qLen}`,
      `IDB Version: ${state.meta.idbVersion}`,
      `Online: ${navigator.onLine}`,
      `User: ${state.user?.email || "-"}`,
      `Org: ${state.activeOrgId}`,
    ];
    panel.textContent = lines.join(" | ");
  }

  /* ---------- Status / Auth UI ---------- */
  const authForm = qs("#authForm");
  const authStatus = qs("#authStatus");
  const inputEmail = qs("#authEmail");
  const btnLogout = qs("#btnLogout");
  const teamSelect = qs("#teamSelect");
  const syncMeta = qs("#syncMeta");
  const brandingForm = qs("#brandingForm");
  const brandAppNameInput = qs("#brandAppName");
  const brandLogoInput = qs("#brandLogoUrl");
  const brandPrimaryInput = qs("#brandPrimary");
  const brandAccentInput = qs("#brandAccent");
  const brandTermsInput = qs("#brandTermsLabel");
  const brandBookingsInput = qs("#brandBookingsLabel");
  const brandingReadonly = qs("#brandingReadonly");
  const brandingInfo = qs("#brandingInfo");
  const brandingRoleHint = qs("#brandingRoleHint");

  function renderStatus() {
    const online = navigator.onLine;
    const statusDot = qs("#statusDot");
    if (statusDot) {
      statusDot.textContent = online ? "O" : "O";
      statusDot.className = online ? "text-emerald-600" : "text-amber-500";
      statusDot.setAttribute("aria-label", online ? "online" : "offline");
    }
    renderDebug();
  }

  async function renderAuth() {
    const state = await storage.getState();
    
    // Session-Status Badge
    const statusDot = qs("#statusDot");
    if (statusDot) {
      if (!state.user) {
        statusDot.textContent = "⚪";
        statusDot.className = "font-bold text-slate-400";
        statusDot.title = "Offline-Modus";
      } else if (!navigator.onLine) {
        statusDot.textContent = "🟡";
        statusDot.className = "font-bold text-amber-500";
        statusDot.title = "Offline - Sync wartet";
      } else if (isCloudReady(state)) {
        statusDot.textContent = "🟢";
        statusDot.className = "font-bold text-emerald-600";
        statusDot.title = "Online & Sync aktiv";
      } else {
        statusDot.textContent = "🔵";
        statusDot.className = "font-bold text-blue-500";
        statusDot.title = "Angemeldet - lokale Organisation";
      }
    }
    
    // Auth Status Update
    if (authStatus) {
      if (state.user?.email) {
        authStatus.textContent = `✅ ${state.user.email}`;
        authStatus.className = "text-emerald-700 font-medium";
      } else {
        authStatus.textContent = "Nicht angemeldet";
        authStatus.className = "text-slate-600";
      }
    }
    
    if (btnLogout) btnLogout.classList.toggle("hidden", !state.user);
    const mBtnLogout = qs("#m_btnLogout");
    const mBtnLogin = qs("#m_btnLogin");
    mBtnLogout?.classList.toggle("hidden", !state.user);
    mBtnLogin?.classList.toggle("hidden", !!state.user);
    if (authForm) authForm.classList.toggle("hidden", !!state.user);
    
    // Auto-Backup-Status
    const autoBackupStatus = qs("#autoBackupStatus");
    if (autoBackupStatus) {
      if (isCloudReady(state)) {
        autoBackupStatus.textContent = "🔄 Automatisch gesichert (Online)";
        autoBackupStatus.className = "text-xs px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700";
        autoBackupStatus.title = "Deine Daten werden automatisch online gespeichert";
      } else {
        autoBackupStatus.textContent = "💾 Automatisch gesichert (Lokal)";
        autoBackupStatus.className = "text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-700";
        autoBackupStatus.title = "Deine Daten sind auf diesem Gerät gespeichert - Melde dich an für Online-Speicherung";
      }
    }
    
    if (teamSelect) {
      const orgs = state.orgs || [];
      if (orgs.length <= 1) {
        teamSelect.parentElement?.classList.add("hidden");
        if (orgs.length === 1 && orgs[0].id) {
          teamSelect.innerHTML = `<option value="${orgs[0].id}">${orgs[0].name}</option>`;
        } else {
          teamSelect.innerHTML = `<option value="">Lokaler Modus</option>`;
        }
      } else {
        teamSelect.parentElement?.classList.remove("hidden");
        teamSelect.innerHTML = orgs.map((o) => `<option value="${o.id}">${o.name}</option>`).join("");
        teamSelect.value = state.activeOrgId || orgs[0].id;
      }
    }
    if (syncMeta) {
      const offline = navigator.onLine ? "" : " (offline - wird gespeichert sobald online)";
      syncMeta.textContent = `Zuletzt aktualisiert: ${state.meta.lastSyncAt || "noch nie"}${offline}`;
    }
  }

  async function renderBrandingUI(branding = currentBranding) {
    const state = await storage.getState();
    const canEdit = canEditBranding(state);
    const activeBrand = { ...DEFAULT_BRANDING, ...(branding || {}) };
    const fields = [
      [brandAppNameInput, activeBrand.appName],
      [brandLogoInput, activeBrand.logoUrl || ""],
      [brandPrimaryInput, activeBrand.primaryColor],
      [brandAccentInput, activeBrand.accentColor],
      [brandTermsInput, activeBrand.termsLabel],
      [brandBookingsInput, activeBrand.bookingsLabel],
    ];
    fields.forEach(([el, val]) => {
      if (!el) return;
      el.value = val || "";
      el.disabled = !canEdit;
    });
    if (brandingForm) brandingForm.classList.toggle("opacity-60", !canEdit);
    if (brandingRoleHint) brandingRoleHint.textContent = !state.user ? "Login erforderlich" : canEdit ? "Owner/Admin kann aendern" : "Nur Anzeige (Mitglied)";
    if (brandingReadonly) {
      if (canEdit) {
        brandingReadonly.classList.add("hidden");
      } else {
        brandingReadonly.classList.remove("hidden");
        brandingReadonly.innerHTML = `
          <div><strong>App-Name:</strong> ${activeBrand.appName}</div>
          <div><strong>Primärfarbe:</strong> ${activeBrand.primaryColor}</div>
          <div><strong>Akzentfarbe:</strong> ${activeBrand.accentColor}</div>
          <div><strong>Terms Label:</strong> ${activeBrand.termsLabel}</div>
          <div><strong>Bookings Label:</strong> ${activeBrand.bookingsLabel}</div>
          <div><strong>Logo URL:</strong> ${activeBrand.logoUrl || "nicht gesetzt"}</div>
        `;
      }
    }
    if (brandingInfo) brandingInfo.textContent = navigator.onLine ? "" : "Offline: Branding wird nach Online-Status aktualisiert.";
  }

  authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!inputEmail || !inputEmail.value) {
      showToast("Bitte E-Mail eingeben", "error");
      return;
    }
    try {
      await sendMagicLink(inputEmail.value.trim());
      showToast("Magic Link gesendet. Bitte Postfach pruefen.", "success");
    } catch (err) {
      showToast("Login fehlgeschlagen: " + err.message, "error");
    }
  });

  brandingForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const state = await storage.getState();
    if (!state.activeOrgId) {
      showToast("Keine Organisation ausgewaehlt", "error");
      return;
    }
    if (!canEditBranding(state)) {
      showToast("Nur Owner/Admin duerfen Branding aendern", "error");
      return;
    }
    const payload = {
      appName: (brandAppNameInput?.value || "").trim() || DEFAULT_BRANDING.appName,
      primaryColor: (brandPrimaryInput?.value || "").trim() || DEFAULT_BRANDING.primaryColor,
      accentColor: (brandAccentInput?.value || "").trim() || DEFAULT_BRANDING.accentColor,
      termsLabel: (brandTermsInput?.value || "").trim() || DEFAULT_BRANDING.termsLabel,
      bookingsLabel: (brandBookingsInput?.value || "").trim() || DEFAULT_BRANDING.bookingsLabel,
      logoUrl: (brandLogoInput?.value || "").trim() || null,
    };
    try {
      const saved = await upsertBranding(state.activeOrgId, payload);
      const merged = { ...payload, ...(saved || {}) };
      await saveBrandingCache(state.activeOrgId, { ...DEFAULT_BRANDING, ...merged });
      applyBranding(merged);
      renderBrandingUI(merged);
      showToast("Branding gespeichert", "success");
      renderAll();
    } catch (err) {
      showToast("Branding konnte nicht gespeichert werden: " + err.message, "error");
    }
  });

  btnLogout?.addEventListener("click", async () => {
    try {
      await supabaseClient?.auth.signOut();
    } catch (err) {
      console.warn("Logout warning", err);
    }
    authUser = null;
    const state = await storage.getState();
    state.user = null;
    state.orgs = [];
    state.activeOrgId = null;
    state.meta.lastSyncAt = null;
    state.meta.lastSyncError = null;
    try {
      await storage.saveState(state, { skipSnapshot: true });
      await storage.queueClear();
    } catch (err) {
      console.warn("Local logout cleanup failed", err);
    }
    memoryState = state;
    await loadBrandingForOrg(null);
    renderAll();
    renderAuth();
    renderStatus();
    showToast("Abgemeldet", "info");
  });

  teamSelect?.addEventListener("change", async (e) => {
    const val = e.target.value || null;
    await updateState(
      (draft) => {
        draft.activeOrgId = val;
      },
      { skipSnapshot: true }
    );
    await loadBrandingForOrg(val);
    await pullLatestFromServer();
    renderAll();
  });

  /* ---------- ICS ---------- */
  function toICSDateUTC(isoStr) {
    const d = new Date(isoStr);
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
  }
  function downloadICS(slotId) {
    storage.getState().then((state) => {
      const slot = (state.slots || []).find((s) => s.id === slotId || s.id === slotId.id);
      if (!slot) return;
      const dtStart = toICSDateUTC(slot.starts_at);
      const dtEnd = toICSDateUTC(slot.ends_at);
      const uidVal = `${slot.id}@terminmanager.app`;
      const summary = (slot.title || "").replace(/\n/g, " ");
      const description = `${currentBranding.appName || DEFAULT_BRANDING.appName}\nKapazitaet: ${slot.capacity}`;
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Termin Manager//DE
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:${uidVal}
DTSTAMP:${toICSDateUTC(new Date().toISOString())}
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:${summary}
DESCRIPTION:${description}
END:VEVENT
END:VCALENDAR`;
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const a = document.createElement("a");
      const d = new Date(slot.starts_at);
      const name = `termin_${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${summary.replace(/\s+/g, "_")}.ics`;
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  /* ---------- Update State Helper ---------- */
  async function updateState(mutator, options = {}) {
    const state = await storage.getState();
    const next = clone(state);
    mutator(next);
    const saved = await storage.saveState(next, { skipSnapshot: !!options.skipSnapshot });
    memoryState = saved;
    if (!options.skipSync) {
      await storage.queueSet(saved);
      scheduleSync();
    }
    if (!options.skipRender) {
      render(saved);
      renderDebug();
    }
    return saved;
  }

  /* ---------- Init ---------- */
  async function init() {
    applyBranding(DEFAULT_BRANDING);
    await storage.getState();
    await loadBrandingForOrg();
    if (supabaseClient) {
      await handleAuthCallback();
      await loadSession();
      subscribeAuth();
      await pullLatestFromServer();
      await loadBrandingForOrg();
    }
    renderAll();
    setupServiceWorkerUpdate();
    renderStatus();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
