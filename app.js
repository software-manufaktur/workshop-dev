// --- Storage / Keys ---
const LS_SLOTS = "seeyou_slots_v1";
const LS_BOOKINGS = "seeyou_bookings_v1";
const LS_ARCH_COLLAPSED = "seeyou_arch_collapsed_v1";
const LS_ACTIVE_COLLAPSED = "seeyou_active_collapsed_v1";
const LS_LAST_BACKUP = "seeyou_last_backup_v1";

const $ = s => document.querySelector(s);
const listEl = $("#list");
let ctx = { currentSlotId: null, currentBookingId: null };
const modalConfirmDelete = document.getElementById("modalConfirmDelete");
let pendingDeleteSlotId = null;
const todayKey = () => new Date().toISOString().slice(0, 10);

// Confirm-Dialog Termin löschen
function openConfirmDelete(slotId) { pendingDeleteSlotId = slotId; modalConfirmDelete.classList.remove("hidden"); modalConfirmDelete.classList.add("flex"); }
function closeConfirmDelete() { modalConfirmDelete.classList.add("hidden"); modalConfirmDelete.classList.remove("flex"); pendingDeleteSlotId = null; }
document.getElementById("btnCancelDelete").onclick = closeConfirmDelete;
document.getElementById("btnConfirmDelete").onclick = () => {
    if (!pendingDeleteSlotId) return closeConfirmDelete();
    save(LS_SLOTS, load(LS_SLOTS).filter(s => s.id !== pendingDeleteSlotId));
    save(LS_BOOKINGS, load(LS_BOOKINGS).filter(b => b.slotId !== pendingDeleteSlotId));
    closeConfirmDelete(); render();
};

// --- ICS / Calendar export ---
const pad2 = n => String(n).padStart(2, "0");
const toICSDateUTC = isoStr => {
    const d = new Date(isoStr);
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" +
        pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
};
function downloadICS(slot) {
    const dtStart = toICSDateUTC(slot.starts_at);
    const dtEnd = toICSDateUTC(slot.ends_at);
    const uid = `${slot.id}@seeyou.workshops`;
    const summary = slot.title.replace(/\n/g, " ");
    const description = `SeeYou Workshop\nKapazität: ${slot.capacity}`;
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SeeYou Workshops//DE
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:${uid}
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
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// Kategorien & Kanäle
const CATS = ["Schmuck-Workshop", "Kindergeburtstag", "JGA", "Mädelsabend", "Weihnachtsfeier", "Sonstiges"];
const CHANNELS = ["", "Instagram", "WhatsApp", "E-Mail", "Triviar", "Telefonisch", "Persönlich"];

// --- Hilfen ---
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt = iso => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
const toLocal = d => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// Phone normalisieren (für Duplikat/WhatsApp)
function normalizePhoneDE(raw) {
    let d = (raw || "").replace(/\D+/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("0")) d = "49" + d.slice(1);
    return d; // z.B. 491711234567
}

// Storage helpers
const load = (k, def = []) => JSON.parse(localStorage.getItem(k) || JSON.stringify(def));
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// Beispielslots beim ersten Start
if (!localStorage.getItem(LS_SLOTS)) {
    const now = new Date(); const s1 = new Date(now.getTime() + 24 * 3600 * 1000); s1.setHours(17, 0, 0, 0);
    const e1 = new Date(s1.getTime() + 2 * 3600 * 1000);
    const s2 = new Date(now.getTime() + 3 * 24 * 3600 * 1000); s2.setHours(10, 0, 0, 0);
    const e2 = new Date(s2.getTime() + 2 * 3600 * 1000);
    save(LS_SLOTS, [
        { id: uid(), title: "Schmuck-Workshop", starts_at: s1.toISOString(), ends_at: e1.toISOString(), capacity: 10, archived: false },
        { id: uid(), title: "Schmuck-Workshop", starts_at: s2.toISOString(), ends_at: e2.toISOString(), capacity: 8, archived: false },
    ]);
}
if (!localStorage.getItem(LS_BOOKINGS)) save(LS_BOOKINGS, []);

// --- Berechnungen ---
const bookingsBySlot = id => load(LS_BOOKINGS).filter(b => b.slotId === id);
const sumBooked = id => bookingsBySlot(id).reduce((n, b) => n + Number(b.count || 0), 0);
function slotStatus(slot) {
    if (slot.archived) return "archived";
    const booked = sumBooked(slot.id), left = slot.capacity - booked, past = new Date(slot.ends_at) < new Date();
    if (past) return "past"; if (left <= 0) return "full"; return "open";
}
function statusBadge(status, left) {
    if (status === "archived") return `<span class="px-2 py-1 rounded-lg bg-slate-300 text-xs">archiv</span>`;
    if (status === "past") return `<span class="px-2 py-1 rounded-lg bg-gray-300 text-xs">vergangen</span>`;
    if (status === "full") return `<span class="px-2 py-1 rounded-lg bg-rose-200 text-xs">voll</span>`;
    const tone = left <= 2 ? "bg-amber-200" : "bg-emerald-200";
    return `<span class="px-2 py-1 rounded-lg ${tone} text-xs">${left} frei</span>`;
}

// --- Render ---
async function render() {
    const q = ($("#search")?.value || "").toLowerCase().trim();
    const filter = $("#filterStatus")?.value || "";

    const all = load(LS_SLOTS).map(s => ({ archived: false, ...s }));
    let active = all.filter(s => !s.archived).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    let archived = all.filter(s => s.archived).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

    if (q) { const f = s => [s.title, s.starts_at, s.ends_at].join(" ").toLowerCase().includes(q); active = active.filter(f); archived = archived.filter(f); }
    if (filter) { const f = s => slotStatus(s) === filter; active = active.filter(f); archived = archived.filter(f); }

    const renderCard = (s) => {
        const booked = sumBooked(s.id), left = Math.max(0, s.capacity - booked), status = slotStatus(s);
        const bar = Math.min(100, Math.round(100 * booked / Math.max(1, s.capacity)));
        const barColor = status === "archived" ? "bg-slate-300"
            : status === "past" ? "bg-gray-300"
                : status === "full" ? "bg-rose-400"
                    : left <= 2 ? "bg-amber-400" : "bg-emerald-500";

        const actions = `
      ${s.archived ? `` :
                `<button type="button" class="px-3 py-2 rounded-xl text-sm" style="background:#AF9778;color:white"
                 onclick="openBooking('${s.id}')">Buchung</button>`}
      <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm"
              onclick="editSlot('${s.id}')">Termin bearbeiten</button>
      <button type="button" class="px-3 py-2 rounded-xl ${s.archived ? 'bg-emerald-100 hover:bg-emerald-200' : 'bg-slate-100 hover:bg-slate-200'} text-sm"
              onclick="toggleArchive('${s.id}', ${!s.archived})">${s.archived ? 'Aus Archiv holen' : 'Archivieren'}</button>
      <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm"
              onclick='downloadICS(${JSON.stringify(s)})'>Kalender (.ics)</button>
      <button type="button" class="px-3 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-sm"
              onclick="deleteSlot('${s.id}')">Termin löschen</button>
    `;

        return `
      <div class="rounded-2xl p-4 bg-white/85 backdrop-blur border border-gray-200 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm text-slate-500">${statusBadge(status, left)}</div>
            <div class="font-semibold text-[20px] sm:text-base leading-snug break-words" style="color:#AF9778">${s.title}</div>
            <div class="text-sm">${fmt(s.starts_at)} – ${fmt(s.ends_at)}</div>
            <div class="text-sm mt-1">Kapazität: ${s.capacity} · Gebucht: ${booked} · Frei: ${left}</div>
            <div class="h-2 mt-2 bg-gray-100 rounded-full overflow-hidden"><div class="h-2 ${barColor}" style="width:${bar}%"></div></div>
            ${renderBookingsMini(s.id)}
          </div>
          <div class="hidden sm:flex flex-col gap-2 shrink-0">${actions}</div>
        </div>
        <div class="mt-3 sm:hidden flex flex-wrap gap-2">${actions}</div>
      </div>`;
    };

    const collapsedActive = JSON.parse(localStorage.getItem(LS_ACTIVE_COLLAPSED) || "false");
    const collapsedArchive = JSON.parse(localStorage.getItem(LS_ARCH_COLLAPSED) || "true");

    listEl.innerHTML = `
    <details id="activeSection" class="mb-6" ${collapsedActive ? "" : "open"}>
      <summary class="list-none cursor-pointer select-none rounded-xl px-3 py-2 bg-slate-200/70 hover:bg-slate-300/70 border border-gray-200 flex items-center justify-between shadow-sm">
        <span class="font-medium">Aktuell (${active.length})</span>
        <span class="text-slate-500 text-sm">${collapsedActive ? "ausklappen" : "einklappen"}</span>
      </summary>
      <div class="mt-3 space-y-3">
        ${active.length ? active.map(renderCard).join("") : `<div class="text-slate-600 bg-white/80 p-4 rounded-2xl border border-gray-200">Keine aktiven Termine.</div>`}
      </div>
    </details>
    ${archived.length ? `
      <details id="archSection" class="mt-6" ${collapsedArchive ? "" : "open"}>
        <summary class="list-none cursor-pointer select-none rounded-xl px-3 py-2 bg-slate-200/70 hover:bg-slate-300/70 border border-gray-200 flex items-center justify-between shadow-sm">
          <span class="font-medium">Archiv (${archived.length})</span>
          <span class="text-slate-500 text-sm">${collapsedArchive ? "ausklappen" : "einklappen"}</span>
        </summary>
        <div class="mt-3 space-y-3">${archived.map(renderCard).join("")}</div>
      </details>` : ""}
  `;

    const act = document.getElementById("activeSection");
    const arch = document.getElementById("archSection");
    if (act) act.addEventListener("toggle", () => {
        const collapsed = !act.open; localStorage.setItem(LS_ACTIVE_COLLAPSED, JSON.stringify(collapsed));
        const lbl = act.querySelector("summary span.text-slate-500"); if (lbl) lbl.textContent = collapsed ? "ausklappen" : "einklappen";
    });
    if (arch) arch.addEventListener("toggle", () => {
        const collapsed = !arch.open; localStorage.setItem(LS_ARCH_COLLAPSED, JSON.stringify(collapsed));
        const lbl = arch.querySelector("summary span.text-slate-500"); if (lbl) lbl.textContent = collapsed ? "ausklappen" : "einklappen";
    });

    maybeShowBackupReminder();
}

function renderBookingsMini(slotId) {
    const list = bookingsBySlot(slotId);
    if (!list.length) return `<div class="text-xs text-slate-500 mt-2">Noch keine Buchungen.</div>`;
    return `
    <div class="mt-2 text-sm">
      <div class="font-medium mb-1">Buchungen (Tippen zum Bearbeiten/Löschen):</div>
      <ul class="space-y-1">
        ${list.map(b => {
        const badge = b.channel ? `<span class="ml-2 text-[11px] px-2 py-[2px] rounded-full bg-gray-100 border border-gray-200 text-slate-600">${b.channel}</span>` : "";
        return `<li class="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 cursor-pointer hover:bg-gray-100"
                     onclick="editBooking('${b.id}')">
                    <span>${b.name} (${b.count}) · ${b.phone}${b.notes ? " · " + b.notes : ""}${badge}</span>
                    <span class="text-xs text-slate-400">›</span>
                  </li>`;
    }).join("")}
      </ul>
    </div>`;
}

// --- Slots anlegen/bearbeiten ---
const modalSlots = $("#modalSlots");
const formSlot = $("#formSlot");
const slCat = $("#sl_category"), rowTitleOther = $("#row_title_other"), slTitleOther = $("#sl_title_other");
slCat?.addEventListener("change", () => { rowTitleOther.style.display = (slCat.value === "Sonstiges") ? "block" : "none"; });

// Neuanlage
$("#btnManageSlots").addEventListener("click", () => {
    const now = new Date(); now.setMinutes(0, 0, 0);
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17);
    const e = new Date(s.getTime() + 2 * 3600 * 1000);
    slCat.value = "Schmuck-Workshop"; rowTitleOther.style.display = "none"; slTitleOther.value = "";
    $("#sl_capacity").value = 10; $("#sl_starts").value = toLocal(s); $("#sl_ends").value = toLocal(e);
    bindCreateSlotHandler(); openModal(modalSlots);
});
function bindCreateSlotHandler() {
    formSlot.onsubmit = (ev) => {
        ev.preventDefault();
        const title = (slCat.value === "Sonstiges") ? (slTitleOther.value.trim() || "Schmuck-Workshop") : slCat.value;
        const slot = {
            id: uid(), title, capacity: Number($("#sl_capacity").value || 0),
            starts_at: new Date($("#sl_starts").value).toISOString(),
            ends_at: new Date($("#sl_ends").value).toISOString(), archived: false
        };
        if (!slot.capacity || !$("#sl_starts").value || !$("#sl_ends").value) { alert("Bitte Start, Ende und Kapazität angeben."); return; }
        const slots = load(LS_SLOTS); slots.push(slot); save(LS_SLOTS, slots);
        formSlot.onsubmit = null; closeModal(modalSlots); render();
    };
}

// Bearbeiten
window.editSlot = (id) => {
    const slots = load(LS_SLOTS); const s = slots.find(x => x.id === id); if (!s) return;
    if (CATS.includes(s.title)) { slCat.value = s.title; rowTitleOther.style.display = "none"; slTitleOther.value = ""; }
    else { slCat.value = "Sonstiges"; rowTitleOther.style.display = "block"; slTitleOther.value = s.title; }
    $("#sl_capacity").value = s.capacity; $("#sl_starts").value = toLocal(new Date(s.starts_at)); $("#sl_ends").value = toLocal(new Date(s.ends_at));
    formSlot.onsubmit = null;
    formSlot.onsubmit = (ev) => {
        ev.preventDefault();
        s.title = (slCat.value === "Sonstiges") ? (slTitleOther.value.trim() || s.title) : slCat.value;
        s.capacity = Number($("#sl_capacity").value || 0);
        s.starts_at = new Date($("#sl_starts").value).toISOString();
        s.ends_at = new Date($("#sl_ends").value).toISOString();
        save(LS_SLOTS, slots); formSlot.onsubmit = null; closeModal(modalSlots); render();
    };
    openModal(modalSlots);
};

window.toggleArchive = (id, flag) => { const slots = load(LS_SLOTS); const s = slots.find(x => x.id === id); if (!s) return; s.archived = !!flag; save(LS_SLOTS, slots); render(); };
window.deleteSlot = (id) => { openConfirmDelete(id); };

// --- Buchungen ---
const modalBooking = $("#modalBooking");
const formBooking = $("#formBooking");
const btnDeleteBooking = $("#btnDeleteBooking");
const btnWhatsappShare = document.getElementById("btnWhatsappShare");
const selChannel = $("#bk_channel");
const showDelete = on => { if (btnDeleteBooking) btnDeleteBooking.classList.toggle("hidden", !on); };

window.openBooking = (slotId) => {
    ctx.currentSlotId = slotId; ctx.currentBookingId = null;
    $("#bk_name").value = ""; $("#bk_phone").value = ""; $("#bk_notes").value = ""; $("#bk_count").value = 1;
    if (selChannel) selChannel.value = "";
    $("#modalBookingTitle").textContent = "Buchung hinzufügen";
    showDelete(false); btnDeleteBooking.onclick = null;
    btnWhatsappShare?.classList.add("hidden");
    openModal(modalBooking);
};

window.editBooking = (id) => {
    const all = load(LS_BOOKINGS); const b = all.find(x => x.id === id); if (!b) return;
    ctx.currentSlotId = b.slotId; ctx.currentBookingId = b.id;
    $("#bk_name").value = b.name; $("#bk_phone").value = b.phone; $("#bk_notes").value = b.notes || ""; $("#bk_count").value = b.count;
    if (selChannel) selChannel.value = b.channel || "";
    if ($("#bk_salutation")) $("#bk_salutation").value = b.salutation || "Liebe/r";
    $("#modalBookingTitle").textContent = "Buchung bearbeiten";
    showDelete(true);

    // WhatsApp-Bestätigung anzeigen
    btnWhatsappShare?.classList.remove("hidden");
    btnWhatsappShare.onclick = () => {
        const slots = load(LS_SLOTS);
        const slot = slots.find(s => s.id === b.slotId);
        if (!slot) return;

        const when = fmt(slot.starts_at);
        const salutation = b.salutation || "Liebe/r";

        // Singular/Plural
        const plural = Number(b.count) > 1;
        const youAcc = plural ? "euch" : "dich"; // Akkusativ
        const youDat = plural ? "euch" : "dir";  // Dativ

        const txt =
            `${salutation} ${b.name},

hiermit bestätige ich ${youDat} die Teilnahme am ${when}
für ${b.count} Person${plural ? "en" : ""}.

Ich freue mich auf ${youAcc} und wünsche ${youDat} bis dahin alles Gute.

Ganz liebe Grüße
Stefanie`;

        const number = normalizePhoneDE(b.phone);
        const url = `https://wa.me/${number}?text=${encodeURIComponent(txt)}`;
        window.open(url, "_blank");
    };







    btnDeleteBooking.onclick = () => {
        if (!confirm("Diese Buchung löschen?")) return;
        save(LS_BOOKINGS, load(LS_BOOKINGS).filter(x => x.id !== b.id));
        ctx.currentBookingId = null; closeModal(modalBooking); render();
    };
    openModal(modalBooking);
};

formBooking.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const slots = load(LS_SLOTS);
    const slot = slots.find(s => s.id === ctx.currentSlotId);
    if (!slot) { closeModal(modalBooking); return; }

    const all = load(LS_BOOKINGS);
    const editing = !!ctx.currentBookingId;
    const old = editing ? all.find(x => x.id === ctx.currentBookingId) : null;

    const booking = {
        id: editing ? old.id : uid(),
        slotId: slot.id,
        salutation: $("#bk_salutation")?.value || "Liebe/r",
        name: $("#bk_name").value.trim(),
        phone: $("#bk_phone").value.trim(),
        notes: $("#bk_notes").value.trim(),
        count: Number($("#bk_count").value || 0),
        channel: selChannel ? selChannel.value : "",
        created_at: editing ? old.created_at : new Date().toISOString()
    };
    if (!booking.name || !booking.phone || !booking.count) { alert("Bitte Name, Telefon und Personenanzahl angeben."); return; }

    // Duplikatschutz
    const normNew = normalizePhoneDE(booking.phone);
    const dup = all.find(x => x.slotId === slot.id && (!editing || x.id !== old.id) && normalizePhoneDE(x.phone) === normNew);
    if (dup) {
        const proceed = confirm("Achtung: Diese Telefonnummer ist für diesen Termin bereits erfasst. Trotzdem speichern?");
        if (!proceed) return;
    }

    const already = sumBooked(slot.id);
    const bookedExceptThis = editing ? (already - Number(old.count || 0)) : already;
    const left = slot.capacity - bookedExceptThis;
    if (booking.count > left) { alert(`Es sind nur noch ${left} Plätze frei.`); return; }

    if (editing) { const i = all.findIndex(x => x.id === old.id); all[i] = booking; } else { all.push(booking); }
    save(LS_BOOKINGS, all);

    const hint = `Workshop ${fmt(slot.starts_at)} – ${booking.count} Pers.\n${booking.name} ${booking.phone}\n${booking.notes || ""}`;
    navigator.clipboard?.writeText(hint).catch(() => { });
    showToast("Buchung gespeichert – bitte Termin auch auf Triviar ergänzen.", "https://triviar.de/");
    ctx.currentBookingId = null; closeModal(modalBooking); render();
});

// --- CSV Export ---
$("#btnExportCsv").addEventListener("click", () => {
    const slots = load(LS_SLOTS), bks = load(LS_BOOKINGS);
    let csv = "slot_id;slot_title;starts_at;ends_at;capacity;archived;booking_id;name;phone;notes;count;channel;created_at\n";
    for (const s of slots) {
        const list = bks.filter(b => b.slotId === s.id);
        if (!list.length) {
            csv += `"${s.id}";"${s.title}";"${s.starts_at}";"${s.ends_at}";"${s.capacity}";"${!!s.archived}";"";"";"";"";"";""\n`;
        } else {
            for (const b of list) {
                csv += `"${s.id}";"${s.title}";"${s.starts_at}";"${s.ends_at}";"${s.capacity}";"${!!s.archived}";"${b.id}";"${b.name}";"${b.phone}";"${(b.notes || "").replace(/"/g, '""')}";"${b.count}";"${b.channel || ""}";"${b.created_at}"\n`;
            }
        }
    }
    const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "workshops.csv"; a.click(); URL.revokeObjectURL(a.href);
});

// --- Backup / Restore ---
$("#btnBackup").addEventListener("click", exportBackup);
async function handleRestoreFile(file) {
    if (!file) return;
    try {
        const text = await file.text(); const json = JSON.parse(text);
        if (!json || !Array.isArray(json.slots) || !Array.isArray(json.bookings)) throw new Error("Format ungültig");
        save(LS_SLOTS, json.slots); save(LS_BOOKINGS, json.bookings);
        alert("Backup erfolgreich wiederhergestellt."); render();
    } catch (err) { alert("Wiederherstellung fehlgeschlagen: " + err.message); }
}
document.getElementById("fileRestore")?.addEventListener("change", (e) => { handleRestoreFile(e.target.files?.[0]); e.target.value = ""; });

function exportBackup() {
    const data = { version: 1, exported_at: new Date().toISOString(), slots: load(LS_SLOTS), bookings: load(LS_BOOKINGS) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date(); const name = `seeyou_backup_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
    localStorage.setItem(LS_LAST_BACKUP, todayKey());
}

// Archiv-Button -> zum Archiv springen
$("#btnArchiveView").addEventListener("click", () => {
    const el = document.getElementById("archSection");
    if (!el) { alert("Noch nichts im Archiv."); return; }
    el.open = true; el.scrollIntoView({ behavior: "smooth", block: "start" });
});

// --- Mobile-Menü (rechts ein-/ausfahren) ---
const mobileMenu = document.getElementById("mobileMenu");
const mobilePanel = document.getElementById("mobilePanel");
const btnMenu = document.getElementById("btnMenu");
function openMobileMenu() { if (!mobileMenu || !mobilePanel) return; mobileMenu.classList.remove("hidden"); requestAnimationFrame(() => mobilePanel.classList.remove("translate-x-full")); }
function closeMobileMenu() { if (!mobileMenu || !mobilePanel) return; mobilePanel.classList.add("translate-x-full"); const onDone = () => { mobileMenu.classList.add("hidden"); mobilePanel.removeEventListener("transitionend", onDone); }; mobilePanel.addEventListener("transitionend", onDone); }
btnMenu?.addEventListener("click", openMobileMenu);
document.querySelectorAll("[data-close='mobilemenu']").forEach(b => b.addEventListener("click", closeMobileMenu));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMobileMenu(); });
document.getElementById("m_btnManageSlots")?.addEventListener("click", () => { closeMobileMenu(); document.getElementById("btnManageSlots")?.click(); });
document.getElementById("m_btnExportCsv")?.addEventListener("click", () => { closeMobileMenu(); document.getElementById("btnExportCsv")?.click(); });
document.getElementById("m_btnBackup")?.addEventListener("click", () => { closeMobileMenu(); document.getElementById("btnBackup")?.click(); });
document.getElementById("m_btnArchiveView")?.addEventListener("click", () => { closeMobileMenu(); document.getElementById("btnArchiveView")?.click(); });
document.getElementById("m_fileRestore")?.addEventListener("change", (e) => { handleRestoreFile(e.target.files?.[0]); e.target.value = ""; closeMobileMenu(); });

// Suche / Filter
$("#search")?.addEventListener("input", render);
$("#filterStatus")?.addEventListener("change", render);

// --- Modals (nur eins offen) ---
function openModal(target) { [modalBooking, modalSlots].forEach(m => { if (!m) return; m.classList.add("hidden"); m.classList.remove("flex"); }); target.classList.remove("hidden"); target.classList.add("flex"); }
function closeModal(target) { target.classList.add("hidden"); target.classList.remove("flex"); }
document.querySelectorAll("[data-close='booking']").forEach(b => b.onclick = () => { formBooking.reset(); ctx.currentBookingId = null; ctx.currentSlotId = null; closeModal(modalBooking); });
document.querySelectorAll("[data-close='slots']").forEach(b => b.onclick = () => { formSlot.reset(); formSlot.onsubmit = null; closeModal(modalSlots); });

// --- Toasts ---
const toast = $("#toast"), toastMsg = $("#toastMsg"), toastLink = $("#toastLink");
function showToast(msg, href, label = "Öffnen") {
    toastMsg.textContent = msg;
    if (href) { toastLink.href = href; toastLink.textContent = label; toastLink.onclick = null; toastLink.classList.remove("hidden"); }
    else { toastLink.classList.add("hidden"); }
    toast.classList.remove("hidden"); setTimeout(() => toast.classList.add("hidden"), 6000);
}
function showToastWithAction(msg, label, onClick) {
    toastMsg.textContent = msg; toastLink.href = "#"; toastLink.textContent = label || "OK";
    toastLink.onclick = (e) => { e.preventDefault(); onClick?.(); };
    toastLink.classList.remove("hidden"); toast.classList.remove("hidden");
}
function maybeShowBackupReminder() {
    const last = localStorage.getItem(LS_LAST_BACKUP); if (last === todayKey()) return;
    showToastWithAction("Backup fällig – jetzt sichern.", "Jetzt sichern", () => { exportBackup(); document.getElementById("toast")?.classList.add("hidden"); });
}

// Start
render();
