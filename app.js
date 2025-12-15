/* Workshop PWA - offline-first with IndexedDB, Supabase sync, and backups */
(function () {
  "use strict";

  const APP_VERSION = "1.1.0";
  const DB_NAME = "workshop-app";
  const DB_VERSION = 2;
  const MAX_LOCAL_BACKUPS = 10;
  const SYNC_DEBOUNCE_MS = 800;

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

  const supabaseConfig = window.APP_CONFIG || {};
  const supabaseReady =
    window.supabase &&
    supabaseConfig.SUPABASE_URL &&
    supabaseConfig.SUPABASE_ANON_KEY &&
    !String(supabaseConfig.SUPABASE_URL).includes("YOUR-PROJECT");
  const supabaseClient = supabaseReady
    ? window.supabase.createClient(supabaseConfig.SUPABASE_URL, supabaseConfig.SUPABASE_ANON_KEY)
    : null;

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
    activeOrgId: "default",
    user: null,
    serverBackupsEnabled: false,
  };

  let memoryState = null;
  let dbPromise = null;
  let pendingDeleteSlotId = null;
  let syncTimer = null;
  let flushInFlight = false;
  let updateWaitingWorker = null;

  const ctx = { currentSlotId: null, currentBookingId: null, importPreview: null };

  // ----- IndexedDB layer -----
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
      console.warn("Migration failed, falling back to empty state", err);
      return null;
    }
    const migrated = { ...clone(stateDefaults), slots, bookings };
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
      { id: uid(), title: "Schmuck-Workshop", starts_at: s1.toISOString(), ends_at: e1.toISOString(), capacity: 10, archived: false },
      { id: uid(), title: "Schmuck-Workshop", starts_at: s2.toISOString(), ends_at: e2.toISOString(), capacity: 8, archived: false },
    ];
  }

  async function getState() {
    if (memoryState) return clone(memoryState);
    const fromDb = await readStateFromDb();
    if (fromDb) {
      const normalized = {
        ...clone(stateDefaults),
        ...fromDb,
        meta: { ...stateDefaults.meta, ...(fromDb.meta || {}) },
      };
      memoryState = normalized;
      if (!deepEqual(fromDb, normalized)) {
        await saveState(normalized, { skipSnapshot: true });
      }
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
    await writeStateToDb(safe);
    const readback = await readStateFromDb();
    if (!deepEqual(safe, readback)) throw new Error("Read-after-write verification failed");
    memoryState = readback;
    if (!skipSnapshot) await addLocalSnapshot("autosave", safe);
    return clone(readback);
  }

  async function exportBackup() {
    const current = await getState();
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      state: current,
    };
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
      req.onsuccess = () => {
        const res = (req.result || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(res);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function queueSet(state) {
    const payload = { created_at: new Date().toISOString(), state: clone(state), org_id: state.activeOrgId };
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
        if (!list.length) return resolve(null);
        const latest = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        resolve(latest);
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

  const storage = {
    getState,
    saveState,
    exportBackup,
    importBackup,
    listLocalBackups,
    addLocalSnapshot,
    queueSet,
    queueClear,
    queueLength,
    queueGetLatest,
  };

  // ----- Supabase + sync -----
  let authUser = null;

  async function sendMagicLink(email) {
  if (!supabaseClient) throw new Error("Supabase nicht konfiguriert");

  // sorgt dafür, dass der Magic Link IMMER zur App zurückführt
  const redirectTo = `${location.origin}${location.pathname}`;

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: redirectTo
    }
  });

  if (error) throw error;
}


  async function loadSession() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    authUser = data?.session?.user || null;
    return authUser;
  }

  function subscribeAuth() {
    if (!supabaseClient) return;
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      authUser = session?.user || null;
      updateUserInState(authUser);
      renderAuth();
      pullLatestFromServer();
      scheduleSync();
    });
  }

  async function updateUserInState(user) {
    const current = await storage.getState();
    current.user = user ? { id: user.id, email: user.email } : null;
    await storage.saveState(current, { skipSnapshot: true });
    memoryState = current;
    renderDebug();
  }

  async function pullLatestFromServer() {
    if (!supabaseClient || !authUser) return;
    const state = await storage.getState();
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
      await storage.saveState(merged);
      memoryState = merged;
      renderAll();
      showToast("Remote Daten geladen (Server war neuer)", "success");
    }
  }

  async function pushStateToServer(state) {
    if (!supabaseClient || !authUser) return;
    const payload = {
      org_id: state.activeOrgId || "default",
      data: { ...state, meta: { ...state.meta, lastSyncAt: null } },
      updated_at: new Date().toISOString(),
      updated_by: authUser.id,
    };
    const { error } = await supabaseClient.from("workshop_states").upsert(payload, { onConflict: "org_id" });
    if (error) throw error;
    const next = { ...clone(state), meta: { ...state.meta, lastSyncAt: payload.updated_at, lastSyncError: null } };
    await storage.saveState(next, { skipSnapshot: true });
    memoryState = next;
    renderDebug();
    if (next.serverBackupsEnabled) await pushServerBackup(next);
    return payload.updated_at;
  }

  async function pushServerBackup(state) {
    if (!supabaseClient || !authUser) return;
    const snapshot = { org_id: state.activeOrgId || "default", snapshot: clone(state), created_at: new Date().toISOString(), created_by: authUser.id };
    const { error } = await supabaseClient.from("backups").insert(snapshot);
    if (error) console.warn("Server backup failed", error);
  }

  async function fetchServerBackups() {
    if (!supabaseClient || !authUser) return [];
    const state = await storage.getState();
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
    if (!supabaseClient || !authUser) throw new Error("Nicht eingeloggt");
    const { data, error } = await supabaseClient.from("backups").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Backup nicht gefunden");
    await storage.importBackup({ state: data.snapshot });
    memoryState = await storage.getState();
    renderAll();
    await storage.queueSet(memoryState);
    scheduleSync();
  }

  // ----- Sync queue -----
  async function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(flushQueue, SYNC_DEBOUNCE_MS);
  }

  async function flushQueue() {
    if (flushInFlight) return;
    flushInFlight = true;
    try {
      const queued = await storage.queueGetLatest();
      if (!queued) return;
      if (!navigator.onLine) return;
      if (!authUser || !supabaseClient) return;
      await pushStateToServer(queued.state);
      await storage.queueClear();
      showToast("Sync erfolgreich", "success");
    } catch (err) {
      const state = await storage.getState();
      state.meta.lastSyncError = err.message;
      await storage.saveState(state, { skipSnapshot: true });
      memoryState = state;
      showToast("Sync fehlgeschlagen: " + err.message, "error");
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

  // ----- UI helpers -----
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

  // ----- Modal helpers -----
  const modalBooking = qs("#modalBooking");
  const modalSlots = qs("#modalSlots");
  const modalConfirmDelete = qs("#modalConfirmDelete");
  const modalBackupImport = qs("#modalBackupImport");

  function openModal(el) {
    if (!el) return;
    [modalBooking, modalSlots, modalBackupImport].forEach((m) => {
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
    if (e.key === "Escape") {
      [modalBooking, modalSlots, modalConfirmDelete, modalBackupImport].forEach((m) => closeModal(m));
    }
  });

  // ----- Domain helpers -----
  const CATS = ["Schmuck-Workshop", "Kindergeburtstag", "JGA", "Maedelsabend", "Weihnachtsfeier", "Sonstiges"];
  const CHANNELS = ["", "Instagram", "WhatsApp", "E-Mail", "Triviar", "Telefonisch", "Persoenlich"];
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const normalizePhoneDE = (raw) => {
    let d = (raw || "").replace(/\D+/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("0")) d = "49" + d.slice(1);
    return d;
  };

  function slotStatus(slot, state) {
    if (slot.archived) return "archived";
    const booked = sumBooked(slot.id, state);
    const left = slot.capacity - booked;
    const past = new Date(slot.ends_at) < new Date();
    if (past) return "past";
    if (left <= 0) return "full";
    return "open";
  }

  const bookingsBySlot = (slotId, state) => (state.bookings || []).filter((b) => b.slotId === slotId);
  const sumBooked = (slotId, state) => bookingsBySlot(slotId, state).reduce((n, b) => n + Number(b.count || 0), 0);

  function statusBadge(status, left) {
    if (status === "archived") return `<span class="px-2 py-1 rounded-lg bg-slate-300 text-xs">archiv</span>`;
    if (status === "past") return `<span class="px-2 py-1 rounded-lg bg-gray-300 text-xs">vergangen</span>`;
    if (status === "full") return `<span class="px-2 py-1 rounded-lg bg-rose-200 text-xs">voll</span>`;
    const tone = left <= 2 ? "bg-amber-200" : "bg-emerald-200";
    return `<span class="px-2 py-1 rounded-lg ${tone} text-xs">${left} frei</span>`;
  }

  function renderBookingsMini(slotId, state) {
    const list = bookingsBySlot(slotId, state);
    if (!list.length) return `<div class="text-xs text-slate-500 mt-2">Noch keine Buchungen.</div>`;
    return `
      <div class="mt-2 text-sm">
        <div class="font-medium mb-1">Buchungen (Tippen zum Bearbeiten/Loeschen):</div>
        <ul class="space-y-1">
          ${list
            .map((b) => {
              const badge = b.channel ? `<span class="ml-2 text-[11px] px-2 py-[2px] rounded-full bg-gray-100 border border-gray-200 text-slate-600">${b.channel}</span>` : "";
              return `<li class="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 cursor-pointer hover:bg-gray-100"
                       data-booking="${b.id}">
                        <span>${b.name} (${b.count}) - ${b.phone}${b.notes ? " - " + b.notes : ""}${badge}</span>
                        <span class="text-xs text-slate-400">></span>
                      </li>`;
            })
            .join("")}
        </ul>
      </div>`;
  }

  // ----- Render -----
  async function renderAll() {
    const state = await storage.getState();
    render(state);
    renderAuth();
    renderStatus();
    renderLocalBackups();
    renderServerBackups();
    renderDebug();
  }

  async function render(state) {
    memoryState = state;
    const search = (qs("#search")?.value || "").toLowerCase().trim();
    const filter = qs("#filterStatus")?.value || "";
    const all = (state.slots || []).map((s) => ({ archived: false, ...s }));
    let active = all.filter((s) => !s.archived).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    let archived = all.filter((s) => s.archived).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

    if (search) {
      const f = (s) => [s.title, s.starts_at, s.ends_at].join(" ").toLowerCase().includes(search);
      active = active.filter(f);
      archived = archived.filter(f);
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
        ${s.archived ? "" : `<button type="button" class="px-3 py-2 rounded-xl text-sm" style="background:#AF9778;color:white" data-open-booking="${s.id}">Buchung</button>`}
        <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm" data-edit-slot="${s.id}">Termin bearbeiten</button>
        <button type="button" class="px-3 py-2 rounded-xl ${s.archived ? "bg-emerald-100 hover:bg-emerald-200" : "bg-slate-100 hover:bg-slate-200"} text-sm" data-toggle-archive="${s.id}" data-flag="${!s.archived}">${s.archived ? "Aus Archiv holen" : "Archivieren"}</button>
        <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm" data-ics="${s.id}">Kalender (.ics)</button>
        <button type="button" class="px-3 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-sm" data-delete-slot="${s.id}">Termin loeschen</button>
      `;

      return `
        <div class="rounded-2xl p-4 bg-white/85 backdrop-blur border border-gray-200 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm text-slate-500">${statusBadge(status, left)}</div>
              <div class="font-semibold text-[20px] sm:text-base leading-snug break-words" style="color:#AF9778">${s.title}</div>
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

    const collapsedActive = !!state.ui?.collapsedActive;
    const collapsedArchive = !!state.ui?.collapsedArchive;
    const listEl = qs("#list");
    if (!listEl) return;
    listEl.innerHTML = `
      <details id="activeSection" class="mb-6" ${collapsedActive ? "" : "open"}>
        <summary class="list-none cursor-pointer select-none rounded-xl px-3 py-2 bg-slate-200/70 hover:bg-slate-300/70 border border-gray-200 flex items-center justify-between shadow-sm">
          <span class="font-medium">Aktuell (${active.length})</span>
          <span class="text-slate-500 text-sm">${collapsedActive ? "ausklappen" : "einklappen"}</span>
        </summary>
        <div class="mt-3 space-y-3">
          ${
            active.length
              ? active.map(renderCard).join("")
              : `<div class="text-slate-600 bg-white/80 p-4 rounded-2xl border border-gray-200">Keine aktiven Termine.</div>`
          }
        </div>
      </details>
      ${
        archived.length
          ? `<details id="archSection" class="mt-6" ${collapsedArchive ? "" : "open"}>
              <summary class="list-none cursor-pointer select-none rounded-xl px-3 py-2 bg-slate-200/70 hover:bg-slate-300/70 border border-gray-200 flex items-center justify-between shadow-sm">
                <span class="font-medium">Archiv (${archived.length})</span>
                <span class="text-slate-500 text-sm">${collapsedArchive ? "ausklappen" : "einklappen"}</span>
              </summary>
              <div class="mt-3 space-y-3">${archived.map(renderCard).join("")}</div>
            </details>`
          : ""
      }`;

    bindDynamicListHandlers();
  }

  function bindDynamicListHandlers() {
    qsa("[data-open-booking]").forEach((btn) =>
      btn.addEventListener("click", () => openBooking(btn.dataset.openBooking))
    );
    qsa("[data-edit-slot]").forEach((btn) => btn.addEventListener("click", () => editSlot(btn.dataset.editSlot)));
    qsa("[data-toggle-archive]").forEach((btn) =>
      btn.addEventListener("click", () => toggleArchive(btn.dataset.toggleArchive, btn.dataset.flag === "true"))
    );
    qsa("[data-delete-slot]").forEach((btn) => btn.addEventListener("click", () => confirmDeleteSlot(btn.dataset.deleteSlot)));
    qsa("[data-ics]").forEach((btn) => btn.addEventListener("click", () => downloadICS(btn.dataset.ics)));
    qsa("[data-booking]").forEach((li) => li.addEventListener("click", () => editBooking(li.dataset.booking)));

    const act = qs("#activeSection");
    const arch = qs("#archSection");
    if (act) act.addEventListener("toggle", () => updateCollapse("collapsedActive", !act.open));
    if (arch) arch.addEventListener("toggle", () => updateCollapse("collapsedArchive", !arch.open));
  }

  async function updateCollapse(key, value) {
    await updateState(
      (draft) => {
        draft.ui = draft.ui || {};
        draft.ui[key] = value;
      },
      { skipSnapshot: true, skipSync: true }
    );
  }

  // ----- Slots -----
  const formSlot = qs("#formSlot");
  const slCat = qs("#sl_category");
  const rowTitleOther = qs("#row_title_other");
  const slTitleOther = qs("#sl_title_other");

  slCat?.addEventListener("change", () => {
    rowTitleOther.style.display = slCat.value === "Sonstiges" ? "block" : "none";
  });

  qs("#btnManageSlots")?.addEventListener("click", () => openSlotCreate());
  qs("#m_btnManageSlots")?.addEventListener("click", () => {
    closeMobileMenu();
    openSlotCreate();
  });

  function openSlotCreate() {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17);
    const e = new Date(s.getTime() + 2 * 3600 * 1000);
    slCat.value = "Schmuck-Workshop";
    rowTitleOther.style.display = "none";
    slTitleOther.value = "";
    qs("#sl_capacity").value = 10;
    qs("#sl_starts").value = toLocal(s);
    qs("#sl_ends").value = toLocal(e);
    bindCreateSlotHandler();
    openModal(modalSlots);
    setFocus(qs("#sl_capacity"));
  }

  function bindCreateSlotHandler() {
    formSlot.onsubmit = async (ev) => {
      ev.preventDefault();
      const title = slCat.value === "Sonstiges" ? slTitleOther.value.trim() || "Schmuck-Workshop" : slCat.value;
      const slot = {
        id: uid(),
        title,
        capacity: Number(qs("#sl_capacity").value || 0),
        starts_at: new Date(qs("#sl_starts").value).toISOString(),
        ends_at: new Date(qs("#sl_ends").value).toISOString(),
        archived: false,
      };
      if (!slot.capacity || !qs("#sl_starts").value || !qs("#sl_ends").value) {
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
    if (CATS.includes(s.title)) {
      slCat.value = s.title;
      rowTitleOther.style.display = "none";
      slTitleOther.value = "";
    } else {
      slCat.value = "Sonstiges";
      rowTitleOther.style.display = "block";
      slTitleOther.value = s.title;
    }
    qs("#sl_capacity").value = s.capacity;
    qs("#sl_starts").value = toLocal(new Date(s.starts_at));
    qs("#sl_ends").value = toLocal(new Date(s.ends_at));
    formSlot.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await updateState((draft) => {
          const slot = draft.slots.find((x) => x.id === id);
          if (!slot) return;
          slot.title = slCat.value === "Sonstiges" ? slTitleOther.value.trim() || slot.title : slCat.value;
          slot.capacity = Number(qs("#sl_capacity").value || 0);
          slot.starts_at = new Date(qs("#sl_starts").value).toISOString();
          slot.ends_at = new Date(qs("#sl_ends").value).toISOString();
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
    modalConfirmDelete.classList.add("hidden");
    modalConfirmDelete.classList.remove("flex");
    pendingDeleteSlotId = null;
  }

  // ----- Bookings -----
  const formBooking = qs("#formBooking");
  const btnDeleteBooking = qs("#btnDeleteBooking");
  const btnWhatsappShare = qs("#btnWhatsappShare");
  const selChannel = qs("#bk_channel");

  window.openBooking = (slotId) => openBooking(slotId);
  function openBooking(slotId) {
    ctx.currentSlotId = slotId;
    ctx.currentBookingId = null;
    qs("#bk_name").value = "";
    qs("#bk_phone").value = "";
    qs("#bk_notes").value = "";
    qs("#bk_count").value = 1;
    if (selChannel) selChannel.value = "";
    if (qs("#bk_salutation")) qs("#bk_salutation").value = "Liebe/r";
    qs("#modalBookingTitle").textContent = "Buchung hinzufuegen";
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
    qs("#bk_name").value = b.name;
    qs("#bk_phone").value = b.phone;
    qs("#bk_notes").value = b.notes || "";
    qs("#bk_count").value = b.count;
    if (selChannel) selChannel.value = b.channel || "";
    if (qs("#bk_salutation")) qs("#bk_salutation").value = b.salutation || "Liebe/r";
    qs("#modalBookingTitle").textContent = "Buchung bearbeiten";
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
    const booking = {
      id: editing ? old.id : uid(),
      slotId: slot.id,
      salutation: qs("#bk_salutation")?.value || "Liebe/r",
      name: qs("#bk_name").value.trim(),
      phone: qs("#bk_phone").value.trim(),
      notes: qs("#bk_notes").value.trim(),
      count: Number(qs("#bk_count").value || 0),
      channel: selChannel ? selChannel.value : "",
      created_at: editing ? old.created_at : new Date().toISOString(),
    };
    if (!booking.name || !booking.phone || !booking.count) {
      showToast("Bitte Name, Telefon und Personenanzahl angeben.", "error");
      return;
    }
    const normNew = normalizePhoneDE(booking.phone);
    const dup = state.bookings.find(
      (x) => x.slotId === slot.id && (!editing || x.id !== old.id) && normalizePhoneDE(x.phone) === normNew
    );
    if (dup) {
      const proceed = confirm("Achtung: Diese Telefonnummer ist fuer diesen Termin bereits erfasst. Trotzdem speichern?");
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
      const hint = `Workshop ${fmtDate(slot.starts_at)} - ${booking.count} Pers.\n${booking.name} ${booking.phone}\n${booking.notes || ""}`;
      navigator.clipboard?.writeText(hint).catch(() => {});
      ctx.currentBookingId = null;
      closeModal(modalBooking);
      showToast("Buchung gespeichert", "success");
    } catch (err) {
      showToast("Speichern fehlgeschlagen: " + err.message, "error");
    }
  });

  // ----- Export / Backup -----
  qs("#btnExportCsv")?.addEventListener("click", exportCsv);
  qs("#btnBackup")?.addEventListener("click", handleExportBackup);
  qs("#m_btnBackup")?.addEventListener("click", () => {
    closeMobileMenu();
    handleExportBackup();
  });
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
    a.download = "workshops.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleExportBackup() {
    const backup = await storage.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date();
    const name = `seeyou_backup_${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    const state = await storage.getState();
    state.ui.lastBackupDay = todayKey();
    await storage.saveState(state, { skipSnapshot: true });
    memoryState = state;
    renderDebug();
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
          <span>${fmtDate(b.created_at)} - ${b.reason}</span>
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
      el.innerHTML = `<li class="text-sm text-slate-500">Login noetig</li>`;
      return;
    }
    const list = await fetchServerBackups();
    if (!list.length) {
      el.innerHTML = `<li class="text-sm text-slate-500">Noch keine Server-Backups</li>`;
      return;
    }
    el.innerHTML = list
      .map(
        (b) => `<li class="flex items-center justify-between text-sm border-b border-gray-100 py-1">
          <span>${fmtDate(b.created_at || b.inserted_at)}</span>
          <button class="text-xs px-2 py-1 bg-gray-100 rounded" data-restore-server="${b.id}">Wiederherstellen</button>
        </li>`
      )
      .join("");
    qsa("[data-restore-server]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await restoreServerBackup(btn.dataset.restoreServer);
          showToast("Server-Backup importiert", "success");
        } catch (err) {
          showToast("Server-Backup fehlgeschlagen: " + err.message, "error");
        }
      })
    );
  }

  // ----- Search / filter -----
  qs("#search")?.addEventListener("input", async () => render(await storage.getState()));
  qs("#filterStatus")?.addEventListener("change", async () => render(await storage.getState()));

  // ----- Mobile menu -----
  const mobileMenu = qs("#mobileMenu");
  const mobilePanel = qs("#mobilePanel");
  const btnMenu = qs("#btnMenu");
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

  // ----- Archive jump -----
  qs("#btnArchiveView")?.addEventListener("click", () => {
    const el = document.getElementById("archSection");
    if (!el) {
      showToast("Noch nichts im Archiv.", "info");
      return;
    }
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ----- Toast backup reminder -----
  function maybeShowBackupReminder() {
    storage.getState().then((state) => {
      if (state.ui.lastBackupDay === todayKey()) return;
      showToast("Backup faellig - jetzt sichern.", "info", {
        label: "Jetzt sichern",
        onClick: () => {
          handleExportBackup();
          qs("#toast")?.classList.add("hidden");
        },
      });
    });
  }

  // ----- Service worker update -----
  const updateBanner = qs("#updateBanner");
  const updateReloadBtn = qs("#btnReloadUpdate");

  function setupServiceWorkerUpdate() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateWaitingWorker && !updateWaitingWorker.skipWaiting) {
        location.reload();
      }
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

  // ----- Debug -----
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
    ];
    panel.textContent = lines.join(" | ");
  }

  // ----- Status / auth UI -----
  const authForm = qs("#authForm");
  const authStatus = qs("#authStatus");
  const inputEmail = qs("#authEmail");
  const btnLogout = qs("#btnLogout");
  const orgSelect = qs("#orgSelect");
  const syncMeta = qs("#syncMeta");
  const serverBackupToggle = qs("#toggleServerBackups");

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
    if (authStatus) {
      authStatus.textContent = state.user?.email ? `Eingeloggt als ${state.user.email}` : "Nicht eingeloggt";
    }
    if (btnLogout) btnLogout.classList.toggle("hidden", !state.user);
    if (serverBackupToggle) {
      serverBackupToggle.checked = !!state.serverBackupsEnabled;
      serverBackupToggle.disabled = !state.user;
    }
    if (orgSelect) {
      const opts = [state.activeOrgId || "default"];
      orgSelect.innerHTML = opts.map((o) => `<option value="${o}">${o}</option>`).join("");
      orgSelect.value = state.activeOrgId || "default";
    }
    if (syncMeta) syncMeta.textContent = `Zuletzt synchronisiert: ${state.meta.lastSyncAt || "noch nie"}`;
  }

  authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!inputEmail.value) {
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

  btnLogout?.addEventListener("click", async () => {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    await updateUserInState(null);
    showToast("Abgemeldet", "info");
  });

  orgSelect?.addEventListener("change", async (e) => {
    const val = e.target.value || "default";
    await updateState((draft) => {
      draft.activeOrgId = val;
    });
    await pullLatestFromServer();
    renderAll();
  });

  serverBackupToggle?.addEventListener("change", async (e) => {
    await updateState(
      (draft) => {
        draft.serverBackupsEnabled = e.target.checked;
      },
      { skipSnapshot: true, skipSync: true }
    );
  });

  // ----- ICS -----
  function toICSDateUTC(isoStr) {
    const d = new Date(isoStr);
    return (
      d.getUTCFullYear() +
      pad2(d.getUTCMonth() + 1) +
      pad2(d.getUTCDate()) +
      "T" +
      pad2(d.getUTCHours()) +
      pad2(d.getUTCMinutes()) +
      pad2(d.getUTCSeconds()) +
      "Z"
    );
  }
  function downloadICS(slotId) {
    storage.getState().then((state) => {
      const slot = (state.slots || []).find((s) => s.id === slotId || s.id === slotId.id);
      if (!slot) return;
      const dtStart = toICSDateUTC(slot.starts_at);
      const dtEnd = toICSDateUTC(slot.ends_at);
      const uidVal = `${slot.id}@seeyou.workshops`;
      const summary = (slot.title || "").replace(/\n/g, " ");
      const description = `SeeYou Workshop\nKapazitaet: ${slot.capacity}`;
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SeeYou Workshops//DE
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
      const name = `seeyou_${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${summary.replace(/\s+/g, "_")}.ics`;
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // ----- Update state helper -----
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
    render(saved);
    renderDebug();
    return saved;
  }

  // ----- Init -----
  async function init() {
    await storage.getState();
    maybeShowBackupReminder();
    renderAll();
    setupServiceWorkerUpdate();
    renderStatus();
    if (supabaseClient) {
      await loadSession();
      subscribeAuth();
      await pullLatestFromServer();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
