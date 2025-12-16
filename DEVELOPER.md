# Developer Documentation – Termin Manager PWA

## Architekturüberblick

### Technologie-Stack
- **Frontend**: Vanilla JavaScript (ES6+), keine Build-Tools, direktes Deployment
- **Styling**: Tailwind CSS (via CDN), dynamische CSS-Variablen für Branding
- **Storage**: IndexedDB (primäre Datenquelle), localStorage (Migration), strukturiertes Backup-System
- **Backend**: Supabase (PostgreSQL + Auth + RLS)
- **PWA**: Service Worker mit versionierten Caches, Offline-Support, Update-Mechanismus

### Design-Prinzipien
1. **Offline-First**: IndexedDB als Source of Truth, alle Änderungen funktionieren offline
2. **Read-after-Write**: Nach jedem Speichern wird der State erneut gelesen zur Validierung
3. **Queue-basierter Sync**: Lokale Änderungen werden in Queue gestellt, später synchronisiert
4. **Multi-Tenant**: Organisationen mit Rollen (Owner/Admin/User), RLS auf DB-Ebene
5. **Progressive Enhancement**: Funktioniert ohne Login (lokal), mit Login (Cloud-Sync)

---

## Projektstruktur

```
workshop-dev/
├── index.html              # Haupt-UI, Modals, Settings
├── app.js                  # Gesamte Anwendungslogik (~1900 Zeilen)
├── service-worker.js       # PWA Caching, Update-Handling
├── manifest.webmanifest    # PWA Manifest (neutral, Branding dynamisch)
├── supabase.sql            # DB Schema + RLS Policies + Functions
├── static/
│   └── icons/              # PWA Icons (verschiedene Größen)
├── README.md               # Benutzer/Setup-Doku
├── DEVELOPER.md            # Diese Datei
├── aktueller_stand.md      # Projekt-Roadmap, Status-Tracking
└── CHANGELOG.md            # Version History
```

---

## Core-Module in app.js

### 1. Storage Layer (Zeilen 100-270)
**Funktionen**: `openDB()`, `getState()`, `saveState()`, `saveSnapshot()`, `loadSnapshots()`

- **IndexedDB Stores**:
  - `state`: Aktueller App-State (slots, meta, user, orgs, activeOrgId)
  - `snapshots`: Rolling Backups (max 10, LIFO)
  - `kv`: Key-Value Cache (z.B. Branding pro Org)
- **Migration**: Beim ersten Start wird localStorage in IndexedDB migriert
- **Validierung**: Read-after-write Check nach jedem `saveState()`

**Wichtige Funktionen**:
```javascript
await storage.getState();           // State laden
await storage.saveState(state);     // State speichern + Snapshot
await storage.saveSnapshot(state);  // Manueller Snapshot
await storage.loadSnapshots();      // Alle Backups abrufen
```

### 2. Sync Engine (Zeilen 300-430)
**Funktionen**: `enqueueSync()`, `flushQueue()`, `pushToServer()`, `pullLatestFromServer()`

- **Queue-basiert**: Änderungen werden debounced (1.2s), dann zur Sync-Queue hinzugefügt
- **Last-Write-Wins**: `updated_at` Timestamps bestimmen Konflikte
- **Retry-Logic**: Queue wird bei fehlgeschlagenem Sync nicht gelöscht
- **Offline-tolerant**: Queue sammelt sich offline, wird bei Online-Wechsel abgearbeitet

**Flow**:
1. User ändert Daten → `updateState(draft => ...)` 
2. State wird in IndexedDB gespeichert
3. `enqueueSync()` wird mit Debounce aufgerufen
4. `flushQueue()` pushed Daten zu Supabase
5. Nach erfolgreichem Push: Cloud-Backup in `backups` Tabelle

### 3. Auth & Organizations (Zeilen 560-640)
**Funktionen**: `handleAuthCallback()`, `loadSession()`, `subscribeAuth()`, `fetchOrgs()`

- **PKCE Flow**: Supabase Magic Links mit `detectSessionInUrl`, `persistSession`, `autoRefreshToken`
- **Session Handling**: `auth.onAuthStateChange()` überwacht Session-Status
- **Org-Loading**: Nach Login werden `org_members` für User geladen
- **Rollen-System**: Owner/Admin/User mit entsprechenden Berechtigungen

**Berechtigungen**:
```javascript
canEditBranding(state)  // Nur Owner/Admin können Branding ändern
canEditState(state)     // Alle Org-Mitglieder können State ändern
```

### 4. Branding System (Zeilen 435-520)
**Funktionen**: `loadBrandingForOrg()`, `upsertBranding()`, `applyBranding()`, `saveBrandingCache()`

- **Org-spezifisch**: Jede Organisation hat eigenes Branding in `org_settings`
- **Caching**: Branding wird in IndexedDB gecached (Key: `branding:<org_id>`)
- **Fallback-Kette**: Remote → Org-Cache → Default-Cache → Hardcoded Defaults
- **CSS-Variablen**: `--primary-color`, `--accent-color` werden dynamisch gesetzt
- **UI-Updates**: App-Name, Buttons-Labels werden aus Branding geladen

**Defaults**:
```javascript
const DEFAULT_BRANDING = {
  appName: "Terminbuch",
  primaryColor: "#222",
  accentColor: "#FF7043",
  termsLabel: "Termine",
  bookingsLabel: "Buchungen",
  logoUrl: null,
};
```

### 5. State Management (Zeilen 900-1300)
**Funktionen**: `updateState()`, `addSlot()`, `deleteSlot()`, `toggleArchive()`, `bookSlot()`, `cancelBooking()`

- **Immer Pattern**: `updateState(draft => { draft.slots.push(...) })`
- **Auto-Save**: Jedes `updateState()` speichert in IndexedDB + enqueued Sync
- **Skip-Render**: Manche Updates (z.B. Bulk-Operations) können Rendering überspringen
- **Snapshot-Control**: `skipSnapshot` Option für häufige Updates

**Kritische Operationen**:
```javascript
// Immer mit try/catch und error-logging
await updateState((draft) => {
  draft.slots.push(newSlot);
  draft.meta.lastSaveAt = new Date().toISOString();
});
```

### 6. UI Rendering (Zeilen 1300-1550)
**Funktionen**: `renderAll()`, `renderSlots()`, `renderAuth()`, `renderStatus()`, `renderBrandingUI()`

- **Batch-Rendering**: `renderAll()` rendert alle Sections auf einmal
- **Event Delegation**: Ein Listener pro Container (nicht pro Button)
- **Modal-System**: `openModal()`, `closeModal()` mit ESC + Click-Outside
- **Toast-System**: `showToast(message, type)` für User-Feedback

**Event Delegation Pattern**:
```javascript
slotsContainer?.addEventListener("click", (e) => {
  const btn = e.target.closest(".slot-delete");
  if (btn) {
    const id = btn.dataset.id;
    deleteSlot(id);
  }
});
```

### 7. Backup System (Zeilen 650-800)
**Funktionen**: `downloadBackup()`, `importBackup()`, `createCloudBackup()`, `loadCloudBackups()`, `restoreFromCloud()`

- **Lokale Backups**: Rolling 10 Snapshots in IndexedDB, LIFO-Prinzip
- **Cloud Backups**: Bei jedem erfolgreichen Sync wird Snapshot in `backups` Tabelle gespeichert
- **Export**: JSON-Download (iOS-kompatibel mit Dateien-Dialog)
- **Import**: Validierung + Preview + Bestätigung vor Overwrite
- **Restore**: Cloud-Backups können direkt wiederhergestellt werden

### 8. Auto-Archive (Zeilen 1843-1870)
**Funktion**: `autoArchivePastEvents()`

- **Trigger**: Läuft automatisch beim App-Start in `init()`
- **Logik**: Alle Slots mit `ends_at < now()` werden auf `archived: true` gesetzt
- **Silent**: Keine User-Benachrichtigung, nur Debug-Log
- **Performance**: Nur ein `updateState()` Call für alle Archivierungen

---

## Wichtige Patterns & Best Practices

### 1. Error Handling
```javascript
// Zentrale Error-Logging-Funktion
logError("contextName", error, { additionalData });

// In try/catch blocks verwenden
try {
  await riskyOperation();
} catch (err) {
  logError("riskyOperation", err, { userId, orgId });
  showToast("Fehler: " + err.message, "error");
}
```

### 2. State Updates
```javascript
// IMMER über updateState()
await updateState((draft) => {
  draft.slots.push(newSlot);
  draft.meta.lastSaveAt = new Date().toISOString();
});

// NIEMALS direktes Mutieren
state.slots.push(newSlot); // ❌ FALSCH
```

### 3. Session Validation
```javascript
// Vor kritischen Operations Session prüfen
const { data: { session } } = await supabaseClient.auth.getSession();
if (!session) throw new Error("Keine gültige Session");
```

### 4. Offline-Handling
```javascript
// Online-Status prüfen
if (!navigator.onLine) {
  showToast("Offline - wird synchronisiert sobald online", "info");
  return;
}

// isCloudReady Helper nutzen
function isCloudReady(state) {
  return navigator.onLine && supabaseClient && authUser && state.activeOrgId;
}
```

---

## Supabase Schema

### Tabellen
1. **orgs**: Organisationen (id, name, created_at)
2. **org_members**: Mitgliedschaften (org_id, user_id, role: owner/admin/user)
3. **workshop_states**: App-States pro Org (org_id PK, data jsonb, updated_at, updated_by)
4. **backups**: Cloud-Backups (id, org_id, snapshot jsonb, created_at, created_by)
5. **org_settings**: Branding pro Org (org_id PK, app_name, colors, labels, logo_url, updated_at)

### RLS Policies
- **orgs**: Nur Mitglieder können ihre Org sehen
- **org_members**: Mitglieder sehen nur ihre Org, Owner/Admin können Mitglieder verwalten
- **workshop_states**: Mitglieder können lesen/schreiben, nur Owner/Admin können löschen
- **backups**: Mitglieder können lesen/erstellen, nur Owner/Admin können löschen
- **org_settings**: Mitglieder können lesen, nur Owner/Admin können schreiben

### Functions
**set_org_settings(...)**: SECURITY DEFINER RPC für sicheres Branding-Upsert
- Prüft Owner/Admin-Rolle
- Upsert in `org_settings` mit Conflict-Handling
- Returns updated row

---

## Debugging

### Debug-Modus aktivieren
URL-Parameter: `https://your-domain.com/?debug=1`

**Debug-Overlay** (Floating Info-Box unten rechts):
- Wird automatisch eingeblendet bei `?debug=1`
- Zeigt Echtzeit-Informationen:
  - Storage Status (✓/✗)
  - Letzte Speicherung/Sync (DD.MM.YYYY HH:MM)
  - Queue-Länge
  - IndexedDB Version
  - Online-Status (🟢/🔴)
  - User-Email oder "(lokal)"
  - Org-ID oder "(keine)"

**Console-Logging**:
```javascript
// Error-Log abrufen
console.log(errors); // Array aller geloggten Errors

// State inspizieren
const state = await storage.getState();
console.log(state);

// Queue prüfen
const queueLen = await storage.queueLength();
console.log("Queue:", queueLen);
```

### IndexedDB inspizieren
1. Chrome DevTools → Application → Storage → IndexedDB
2. Datenbank: `workshop-app`
3. Stores: `state`, `snapshots`, `kv`

### Service Worker Debugging
1. Chrome DevTools → Application → Service Workers
2. Cache Storage zeigt versionierte Caches
3. "Update on reload" für Entwicklung aktivieren

---

## Deployment

### GitHub Pages Setup
1. Repository erstellen, alle Dateien committen
2. Settings → Pages → Branch `main` / `root` auswählen
3. `window.APP_CONFIG` in `index.html` anpassen:
   ```javascript
   window.APP_CONFIG = {
     SUPABASE_URL: "https://your-project.supabase.co",
     SUPABASE_ANON_KEY: "your-anon-key",
   };
   ```
4. Supabase Redirect URLs konfigurieren: `https://your-username.github.io/repo-name/`

### Cache-Invalidierung
Bei Code-Updates **muss** die `CACHE_VERSION` in `service-worker.js` erhöht werden:
```javascript
const CACHE_VERSION = 'v1.3.1'; // Bei jedem Deployment erhöhen
```

### Branding-Updates
Branding wird **nicht** im Code geändert, sondern über UI:
1. Als Owner/Admin einloggen
2. Einstellungen öffnen
3. Branding-Sektion ausfüllen
4. Speichern → Wird in Supabase `org_settings` gespeichert

---

## Testing

### Manuelle Tests (Critical Path)
1. **Offline → Online → Offline**:
   - Offline: Termin erstellen, bearbeiten, löschen
   - Online gehen → Sync-Status prüfen
   - Offline gehen → Änderungen vornehmen
   - Online gehen → Sync verifizieren

2. **Multi-Device Sync**:
   - Device A: Termin erstellen
   - Device B: Nach Reload sichtbar?
   - Device B: Termin bearbeiten
   - Device A: Reload → Änderung sichtbar?

3. **Auth Flow**:
   - Login → Magic Link → Callback → Session bleibt
   - Reload → Immer noch eingeloggt?
   - Logout → Session gelöscht

4. **Branding**:
   - Als Owner: Branding ändern → Sofort sichtbar
   - Als User: Branding read-only → Fehlermeldung beim Speichern-Versuch
   - Org wechseln → Anderes Branding lädt

5. **Backups**:
   - Export → JSON-Download
   - Import → Validierung + Preview
   - Cloud-Backup → In Supabase `backups` prüfen
   - Restore → State wird überschrieben

### iOS Spezial-Tests
- PWA installieren (Teilen → Zum Home-Bildschirm)
- Offline-Modus testen (Flugmodus)
- Backup-Export → iCloud-Ordner wählen
- Storage-Persistenz nach 7 Tagen prüfen

---

## Performance-Optimierungen

### Implementiert
1. **Debounced Sync**: 1.2s Debounce verhindert excessive API-Calls
2. **Batch-Rendering**: `renderAll()` mit `requestAnimationFrame`
3. **Event Delegation**: Ein Listener pro Container statt pro Element
4. **IndexedDB First**: Keine API-Calls für lokale Operationen
5. **Lazy Branding Load**: Branding nur bei Org-Wechsel neu laden

### Potenzielle Optimierungen (TODO)
- Virtual Scrolling bei >100 Slots
- Service Worker Background Sync für Queue
- Incremental Sync (nur geänderte Slots)
- Compression für große States

---

## Troubleshooting

### "Login erforderlich" trotz gültiger Session
**Ursache**: Session-Token abgelaufen, `autoRefreshToken` fehlgeschlagen
**Lösung**: 
```javascript
const { data: { session } } = await supabaseClient.auth.getSession();
if (!session) {
  await supabaseClient.auth.signOut();
  renderAuth();
}
```

### Sync funktioniert nicht
**Checkliste**:
1. `navigator.onLine` === true?
2. `authUser` gesetzt?
3. `state.activeOrgId` vorhanden?
4. Queue-Länge > 0? → `await storage.queueLength()`
5. Supabase RLS: User in `org_members`?

**Debug-Query** (Supabase SQL Editor):
```sql
SELECT * FROM org_members WHERE user_id = auth.uid();
```

### Branding speichert nicht
**Checkliste**:
1. User ist Owner/Admin? → `canEditBranding(state)`
2. Session noch gültig?
3. `org_settings` Tabelle existiert?
4. RPC `set_org_settings` deployed?

**Test-Query**:
```sql
SELECT * FROM org_settings WHERE org_id = '<your-org-id>';
```

### Service Worker Update hängt
**Lösung**:
1. DevTools → Application → Service Workers
2. "Unregister" klicken
3. Hard Reload (Ctrl+Shift+R)
4. App neu laden

---

## API Reference (Wichtigste Funktionen)

### Storage
```javascript
storage.getState() → Promise<State>
storage.saveState(state, options?) → Promise<void>
storage.saveSnapshot(state) → Promise<void>
storage.loadSnapshots() → Promise<Array<Snapshot>>
storage.queueLength() → Promise<number>
storage.setKV(key, value) → Promise<void>
storage.getKV(key) → Promise<any>
```

### State Management
```javascript
updateState(updateFn, options?) → Promise<void>
addSlot(slot) → Promise<void>
deleteSlot(id) → Promise<void>
toggleArchive(id, archived) → Promise<void>
bookSlot(slotId, participantData) → Promise<void>
cancelBooking(slotId, bookingId) → Promise<void>
```

### Sync
```javascript
enqueueSync() → void
flushQueue() → Promise<void>
pushToServer(state) → Promise<void>
pullLatestFromServer() → Promise<void>
```

### Auth
```javascript
handleAuthCallback() → Promise<void>
loadSession() → Promise<void>
fetchOrgs() → Promise<Array<Org>>
```

### Branding
```javascript
loadBrandingForOrg(orgId?) → Promise<Branding>
upsertBranding(orgId, branding) → Promise<Branding>
applyBranding(branding) → void
renderBrandingUI(branding) → void
```

### UI
```javascript
renderAll() → void
showToast(message, type) → void
openModal(modalElement) → void
closeModal(modalElement) → void
```

---

## Kontakt & Support

**Maintainer**: Software Manufaktur  
**Projekt**: Termin Manager PWA  
**Version**: 1.3.0  
**Stand**: 16. Dezember 2025

Bei Fragen oder Problemen: Siehe `aktueller_stand.md` für aktuelle Roadmap und offene Issues.
