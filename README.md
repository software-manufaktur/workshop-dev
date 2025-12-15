# Workshop App (SeeYou)

Offline-first PWA fuer Termin- und Buchungsverwaltung mit Homescreen-Support, Supabase-Sync und Backups. Funktioniert ohne Build-Tool auf GitHub Pages (reine HTML/JS/CSS).

## Setup GitHub Pages
- Lege `index.html`, `app.js`, `service-worker.js`, `manifest.webmanifest`, `supabase.sql` und den Ordner `static/` in dein Pages-Repository.
- In `index.html` unter `window.APP_CONFIG` deine Werte fuer `SUPABASE_URL` und `SUPABASE_ANON_KEY` eintragen (Anon-Key ist ok, keine Secrets).
- Service Worker ist aktiv, versionierte Caches, Update-Banner mit Button `Neu laden`.
- Start-URL `./`, damit auch Unterpfade auf Pages funktionieren.

## Supabase einrichten
1) **Auth**: Magic Link aktivieren. Optional Redirect-URL auf deine Pages-Domain setzen. PKCE ist im Client aktiviert (persistSession, autoRefreshToken).
2) **Schema**: Datei `supabase.sql` im SQL-Editor ausfuehren. Tabellen:
   - `orgs (id uuid pk, name text, created_at timestamptz)`
   - `org_members (org_id uuid fk, user_id uuid fk -> auth.users, role text in owner/admin/user, pk(org_id,user_id))`
   - `workshop_states (org_id uuid pk fk -> orgs, data jsonb, updated_at timestamptz, updated_by uuid)`
   - `backups (id identity pk, org_id uuid fk, snapshot jsonb, created_at timestamptz, created_by uuid)`
3) **RLS**: In `supabase.sql` enthalten. Zugriff nur, wenn der User Mitglied in `org_members` der Organisation ist. Updates/Deletes nur Owner/Admin. Backups/States nur fuer Mitglieder.
4) **Org anlegen** (einmalig): `insert into orgs (name) values ('Team SeeYou') returning id;` und direkt Membership setzen `insert into org_members (org_id, user_id, role) values (<org_id>, <dein_user_id>, 'owner');`.

## Nutzung
- **Login**: E-Mail eingeben, Magic Link oeffnen. PKCE-Callback wird verarbeitet, Session bleibt (persistSession). Nach Login klappt das Formular ein, Status zeigt `Angemeldet als ...`.
- **Konto/Team**: Wird automatisch aus `org_members` geladen. Wenn nur eine Org, Dropdown wird versteckt. Lokaler Modus bleibt als Fallback (`Lokales Konto`).
- **Speichern & Zuverlaessigkeit**: IndexedDB-first, Migration von localStorage, Read-after-write-Check. Modals schliessen nur bei erfolgreicher Persistenz. Letzte 10 Snapshots lokal.
- **Sync**: Jede Aenderung wird lokal gespeichert, dann in eine Queue gelegt. Online + eingeloggt: Push nach Supabase (Tabelle `workshop_states`, last-write-wins ueber `updated_at`). Statuszeile zeigt Offline/Sync/Zuletzt synchronisiert.
- **Cloud-Sicherung**: Nach erfolgreichem Sync wird automatisch ein Snapshot in `backups` gespeichert. Liste und Wiederherstellung in den Einstellungen.
- **Backup Export/Import**: Button `Backup exportieren` erzeugt JSON-Download (iOS: Dateien-Dialog, iCloud manuell waehlen). Import mit Vorschau/Validierung und Bestaetigung.
- **Debug**: `?debug=1` zeigt IDB-Version, Queue-Laenge, letzte Saves/Syncs, User/Org.

## iOS Hinweise
- PWA neu installieren: In Safari `Teilen` -> `Zum Home-Bildschirm`. Bei Problemen unter Einstellungen -> Safari -> Website-Daten loeschen, dann App neu oeffnen und Backup importieren.
- iCloud: Automatisches Schreiben in einen festen iCloud-Ordner ist im Browser nicht moeglich. Export nutzt den Dateien-Dialog, dort kann der iCloud-Ordner ausgewaehlt werden.
