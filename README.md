# Workshop App (SeeYou)

Offline-first PWA fuer Termin- und Buchungsverwaltung mit Homescreen-Support und Supabase-Sync.

## Setup (GitHub Pages)
- Stelle sicher, dass `index.html`, `app.js`, `service-worker.js`, `manifest.webmanifest` und der Ordner `static/` auf GitHub Pages veroeffentlicht werden.
- Trage in `index.html` unter `window.APP_CONFIG` deine Werte fuer `SUPABASE_URL` und `SUPABASE_ANON_KEY` ein. Der Anon-Key darf ins Frontend, Secrets nicht.
- Service Worker ist aktiv und cached versioniert; bei Updates erscheint ein Banner mit dem Button `Neu laden`.
- Start-URL ist `./`, damit die App aus jedem Unterpfad von Pages laeuft.

## Supabase Setup
1. **Auth**: Magic Link aktivieren. Optional Redirect-URL auf die GitHub-Pages-Domain setzen.
2. **Tabelle `workshop_states`** (offline Sync, last-write-wins):
   - `org_id` text (PK, unique)
   - `data` jsonb
   - `updated_at` timestamptz (default: `now()`)
   - `updated_by` uuid (nullable)
3. **Tabelle `backups`** (optionale Server-Backups):
   - `id` bigint generated always as identity (PK)
   - `org_id` text
   - `snapshot` jsonb
   - `created_at` timestamptz default now()
   - `created_by` uuid (nullable)
4. **RLS Beispiel** (vereinfachter Multi-Tenant-Startpunkt):
   - Aktivieren auf beiden Tabellen.
   - Policy `allow_owner_write` auf `workshop_states`: `using (auth.role() = 'authenticated') with check (auth.uid() = updated_by or updated_by is null)`.
   - Policy `allow_owner_write` auf `backups`: analog mit `created_by`.
   - Fuer echte Multi-Org solltest du spaeter eine Membership-Tabelle nutzen und in den Policies `org_id` gegen erlaubte Organisationen pruefen.

## Nutzung
- **Anmelden**: E-Mail eingeben, Magic Link oeffnen, danach zeigt die Statuszeile "Eingeloggt als ...".
- **Organisation waehlen**: Dropdown "Organisation"; default ist `default`. Alle Saves und Syncs laufen pro Organisation.
- **Speichern**: Buchungen/Termine landen zunaechst in IndexedDB (mit Read-after-write-Check). Modal schliesst nur bei erfolgreichem Persistieren.
- **Offline/Sync**: Die App funktioniert offline. Bei naechster Online-Phase + Login wird die lokale Queue zu Supabase synchronisiert (last-write-wins ueber `updated_at`).
- **Backup exportieren**: Button "Backup" (JSON-Download).
- **Backup importieren**: "Wiederherstellen" (Datei waehlen) -> Vorschau -> Import.
- **Rolling Backups lokal**: letzte 10 Snapshots unter "Lokale Backups"; per Klick wiederherstellbar.
- **Server-Backups**: Toggle "Server-Backups" einschalten (nur eingeloggt). Nach erfolgreichem Sync wird ein Snapshot in Supabase abgelegt; Liste unter "Server-Backups" mit Restore.
- **CSV**: Exportiert Slots+Buchungen fuer externe Systeme.
- **Debug**: `?debug=1` zeigt IDB-Version, Queue-Laenge, letzte Saves/Syncs.

## iOS Hinweise
- iCloud: Automatisches Schreiben in einen festen iCloud-Ordner ist im Browser nicht moeglich. Beim Backup-Export oeffnet sich der iOS "Dateien"-Dialog; dort kann man manuell einen iCloud-Ordner auswaehlen.
- PWA neu installieren: In Safari "Teilen" -> "Zum Home-Bildschirm". Bei Problemen Safari-Website-Daten loeschen und die App neu installieren, danach Import/Sync nutzen.
