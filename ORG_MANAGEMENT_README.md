# Organisation Management - Implementierung

## ✅ Was wurde implementiert

### UI-Features in den Einstellungen:

1. **Aktuelle Organisation anzeigen**
   - Zeigt Name und Rolle (Eigentümer/Administrator/Mitglied)
   - Sichtbar für alle angemeldeten Nutzer

2. **Organisation umbenennen** (nur für Owner/Admin)
   - Button "Umbenennen" neben aktuellem Org-Namen
   - Inline-Formular zum Ändern des Namens
   - Speichert direkt in Supabase und aktualisiert UI

3. **Neue Organisation erstellen**
   - Aufklappbarer Bereich
   - Jeder angemeldete User kann neue Orgs erstellen
   - Automatisch als Owner hinzugefügt

4. **Einladungslinks generieren** (nur für Owner/Admin)
   - Button "Kopieren" generiert 8-stelligen Code
   - Link-Format: `https://deine-app.de/?invite=ABC12345`
   - Code ist 7 Tage gültig
   - Eingeladene werden als "user" hinzugefügt

### Backend-Features:

- **rename_org(p_org_id, p_new_name)** - Organisation umbenennen
- **generate_invite_code(p_org_id)** - 8-stelligen Einladungscode erstellen
- **join_org_by_code(p_invite_code)** - Organisation per Code beitreten
- **Automatische Invite-URL-Erkennung** - Bei App-Start wird URL nach `?invite=` geparst

### Sicherheit:

- Nur Owner/Admin können umbenennen
- Nur Owner/Admin können Einladungen erstellen
- Invite-Codes ablaufen nach 7 Tagen
- Proper RLS-Checks mit `_require_org_role()`

## 📋 Nächste Schritte

### 1. SQL Migration ausführen

Öffne Supabase SQL Editor und führe aus:

```bash
# Datei: migration_org_management.sql
```

Das fügt folgendes hinzu:
- `metadata` JSONB-Spalte zur `orgs` Tabelle (für Invite-Codes)
- Die drei neuen RPC-Funktionen (falls noch nicht in supabase.sql)

**Wichtig:** Die Funktionen `rename_org`, `generate_invite_code`, und `join_org_by_code` wurden bereits in die `supabase.sql` eingefügt (ab Zeile 365). Du kannst entweder:
- Die komplette `supabase.sql` neu ausführen, ODER
- Nur die `migration_org_management.sql` ausführen (fügt nur die metadata-Spalte hinzu)

### 2. Test-Szenario

**Als Owner/Admin:**
1. Öffne Einstellungen → "🏢 Organisation"
2. Klicke "Umbenennen" → Ändere Name → "Speichern"
3. Klicke "📋 Kopieren" bei "Mitglieder einladen"
4. Link wird generiert und in Zwischenablage kopiert

**Als neuer User:**
1. Öffne den Einladungslink: `https://app.de/?invite=ABC12345`
2. Falls nicht angemeldet → Zeigt Info "Bitte melde dich zuerst an"
3. Nach Login → Automatisch der Organisation hinzugefügt
4. Dropdown "Organisation" zeigt neue Org an

**Neue Organisation erstellen:**
1. Einstellungen → "🏢 Organisation"
2. "➕ Neue Organisation erstellen" aufklappen
3. Name eingeben → "Organisation erstellen"
4. Wird automatisch als Owner hinzugefügt
5. Dropdown wechselt zur neuen Org

### 3. Optional: UI-Anpassungen

Du kannst noch folgendes anpassen:

**Weitere Features (optional):**
- Mitglieder-Liste anzeigen (alle Members einer Org)
- Mitglieder entfernen (nur Owner/Admin)
- Organisation verlassen (wenn Member von mehreren Orgs)
- Organisation löschen (nur Owner, wenn keine Members mehr)
- Rolle ändern (Owner kann Admin/User zu Admin machen)

**Design-Tweaks:**
- Icons ändern (🏢, 📋, ➕ durch andere ersetzen)
- Farben anpassen (bg-emerald-50 → andere Tailwind-Farbe)
- Abstände/Layouts in index.html optimieren

## 🔧 Technische Details

### Neue HTML-Elemente (index.html, ab Zeile 169):

```html
<section class="border-t border-gray-200 pt-6">
  <h3>🏢 Organisation</h3>
  
  <!-- Aktuelle Org Info -->
  <div id="currentOrgInfo">
    <div id="currentOrgName">Name</div>
    <div id="currentOrgRole">Rolle</div>
    <button id="btnEditOrgName">Umbenennen</button>
  </div>
  
  <!-- Umbenennen-Form -->
  <form id="formRenameOrg" class="hidden">
    <input id="inputOrgNewName" type="text">
    <button type="submit">Speichern</button>
    <button id="btnCancelRenameOrg">Abbrechen</button>
  </form>
  
  <!-- Neue Org erstellen -->
  <details>
    <summary>➕ Neue Organisation erstellen</summary>
    <form id="formCreateOrg">
      <input id="inputOrgName" type="text">
      <button type="submit">Organisation erstellen</button>
    </form>
  </details>
  
  <!-- Einladungslink (nur Owner/Admin) -->
  <div id="inviteSection" class="hidden">
    <input id="inviteLink" readonly>
    <button id="btnCopyInvite">📋 Kopieren</button>
  </div>
</section>
```

### Neue JavaScript-Funktionen (app.js, ab Zeile 1945):

```javascript
// Organisation Management
updateOrgInfo()              // Update UI mit aktuellem Org-Namen/Rolle
renderAuth()                 // Ruft updateOrgInfo() auf
checkInviteCode()           // Prüft URL nach ?invite=CODE beim Start
generateInviteLink()        // RPC: generate_invite_code()
formRenameOrg.submit        // RPC: rename_org()
formCreateOrg.submit        // RPC: create_org()
join_org_by_code()          // RPC: join_org_by_code()
```

### Neue SQL-Funktionen (supabase.sql, ab Zeile 365):

```sql
-- Zeile 365-388: rename_org()
-- Zeile 390-412: generate_invite_code()
-- Zeile 414-451: join_org_by_code()
```

## 🐛 Troubleshooting

**"Fehler beim Umbenennen: permission denied"**
→ User ist nicht Owner/Admin der Organisation

**"Fehler beim Beitreten: invalid invite code"**
→ Code falsch oder abgelaufen (7 Tage)

**Invite-Section wird nicht angezeigt**
→ User ist nicht Owner/Admin → Normal, nur Admin/Owner sehen Invite-Button

**"Organisation umbenennen" Button fehlt**
→ User ist nur "Member" → Nur Owner/Admin können umbenennen

**Nach Erstellen einer Org: "Fehler" oder keine Org sichtbar**
→ Prüfe Browser-Konsole für Fehler
→ Stelle sicher dass `create_org()` RPC-Funktion in Supabase existiert

## 📦 Dateien geändert

- ✅ `index.html` - Neue Organisation-Management UI in Einstellungen (Zeile 169-219)
- ✅ `app.js` - Organisation Management Logik (Zeile 1945-2157, 1815 updateOrgInfo(), 2271 checkInviteCode())
- ✅ `supabase.sql` - Neue RPC-Funktionen (Zeile 365-451)
- ✅ `migration_org_management.sql` - Neue Migration für metadata-Spalte

## ✨ Features im Überblick

| Feature | Owner | Admin | User |
|---------|-------|-------|------|
| Organisation sehen | ✅ | ✅ | ✅ |
| Organisation umbenennen | ✅ | ✅ | ❌ |
| Einladungslink erstellen | ✅ | ✅ | ❌ |
| Neue Organisation erstellen | ✅ | ✅ | ✅ |
| Einladungslink nutzen | ✅ | ✅ | ✅ |
| Organisation wechseln | ✅ | ✅ | ✅ |

Viel Erfolg! 🚀
