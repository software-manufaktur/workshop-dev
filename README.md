# Termin Manager (PWA)

Offline-first PWA fuer Termin- und Buchungsverwaltung mit Homescreen-Support, Supabase-Sicherung und Backups. Funktioniert ohne Build-Tool auf GitHub Pages (reine HTML/JS/CSS).

## Setup GitHub Pages
- Lege `index.html`, `app.js`, `service-worker.js`, `manifest.webmanifest`, `supabase.sql` und den Ordner `static/` in dein Pages-Repository.
- In `index.html` unter `window.APP_CONFIG` nur deine Werte fuer `SUPABASE_URL` und `SUPABASE_ANON_KEY` eintragen (Anon-Key ist ok, keine Secrets). Branding kommt dynamisch aus Supabase (siehe unten).
- Service Worker ist aktiv, versionierte Caches, Update-Banner mit Button `Neu laden`.
- Start-URL `./`, damit auch Unterpfade auf Pages funktionieren. Manifest bleibt neutral/generisch.

## Supabase einrichten
1) **Auth**: Magic Link aktivieren. Optional Redirect-URL auf deine Pages-Domain setzen. PKCE ist im Client aktiviert (persistSession, autoRefreshToken).
2) **Schema**: Datei `supabase.sql` im SQL-Editor ausfuehren. Tabellen:
   - `orgs (id uuid pk, name text, created_at timestamptz)`
   - `org_members (org_id uuid fk, user_id uuid fk -> auth.users, role text in owner/admin/user, pk(org_id,user_id))`
   - `workshop_states (org_id uuid pk fk -> orgs, data jsonb, updated_at timestamptz, updated_by uuid)`
   - `backups (id identity pk, org_id uuid fk, snapshot jsonb, created_at timestamptz, created_by uuid)`
   - `org_settings (org_id uuid pk fk -> orgs, app_name, primary_color, accent_color, logo_url, terms_label, bookings_label, updated_at)` fuer Branding je Organisation
   - Function `set_org_settings(...)` als SECURITY DEFINER fuer sicheres Upsert durch Owner/Admin
3) **RLS**: In `supabase.sql` enthalten. Zugriff nur, wenn der User Mitglied in `org_members` der Organisation ist. Updates/Deletes/Branding-Änderungen nur Owner/Admin. Backups/States/Settings nur fuer Mitglieder sichtbar.
4) **Org anlegen** (einmalig): `insert into orgs (name) values ('Team SeeYou') returning id;` und direkt Membership setzen `insert into org_members (org_id, user_id, role) values (<org_id>, <dein_user_id>, 'owner');`.

## Branding pro Organisation
- Neutraler Manifest/Apple-Title, Branding wird nach Login aus `org_settings` geladen (Fallback Default: App-Name "Terminbuch", Primär `#222`, Akzent `#FF7043`, Labels "Termine"/"Buchungen").
- Ladefluss: Nach Login + aktiver Org -> `org_settings` via Supabase holen, mit Defaults mergen, CSS-Variablen und UI-Texte setzen. Branding wird in IndexedDB gecached (pro Org); beim Start wird immer online refreshed, offline wird Cache genutzt.
- UI: In den Einstellungen gibt es Eingabefelder fuer App-Name, Farben, Labels, Logo-URL. Nur Owner/Admin koennen speichern (RPC `set_org_settings` / Upsert), Mitglieder sehen die Werte read-only.
- Org-Dropdown wird ausgeblendet, wenn nur eine Org vorhanden ist. Beim Wechsel werden Branding + Daten neu geladen.

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
