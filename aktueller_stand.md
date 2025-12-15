# Projekt-Roadmap – Termin Manager (PWA)

Ziel: Offline-first Termin-/Buchungs-App zu einem stabilen, skalierbaren Produkt machen, nutzbar für Solo- und Kleinanbieter (Workshops, Kurse, Events), ohne technische Komplexität für Endnutzer.

---

## PHASE 0 – Ausgangslage & Ziel
- [x] Reales Alltagsproblem identifiziert
- [x] Lösung ist mobil, offline-fähig, schnell
- [x] Fokus auf einfache Nutzung
- [ ] Vision kurz formulieren (1–2 Absätze)
- [ ] Produktversprechen/Pitch ergänzen

---

## PHASE 1 – Technische Stabilität
### 1.1 Offline-First
- [x] IndexedDB als Source of Truth
- [x] Read-after-write Verifikation
- [x] Migration von localStorage
- [x] Lokale Wiederherstellung beim App-Start
- [ ] Schutz gegen iOS Storage-Bereinigung (Persist API prüfen)

### 1.2 Service Worker & PWA
- [x] Nur http/https Requests cachen
- [x] Network-first für HTML/Navigation
- [x] Cache-first für Assets
- [x] Versionierte Caches + Cleanup
- [x] Update-Banner mit Reload
- [ ] Option “Cache leeren” (nur Debug/Admin)

### 1.3 Fehlerresistenz
- [x] Null-sichere DOM-Zugriffe
- [x] try/catch in kritischen Pfaden
- [ ] Zentrale Error-Handling-Funktion
- [ ] Optional Error-Logging (z. B. Sentry)

### 1.4 Auth & Session
- [x] Supabase PKCE (persistSession, autoRefreshToken, detectSessionInUrl)
- [x] Login nur einmal nötig (Session bleibt)
- [ ] Session-Status klar/visuell hervorheben

### 1.5 Logout (kritisch)
- [x] Logout funktioniert offline, toleriert Fehler
- [x] Lokaler Zustand wird zurückgesetzt
- [x] Kein “default”-Fallback
- [ ] Visuelles Feedback/State nach Logout verbessern

---

## PHASE 2 – Daten, Sync & Backups
### 2.1 Organisationen / Multi-Tenant
- [x] Organisationen über Supabase
- [x] org_id nur UUID oder null
- [x] Keine String-Fallbacks
- [x] org_members mit Rollen
- [x] RLS-Policies hinterlegt
- [ ] SECURITY DEFINER/Helpers für Admin-Aktionen (optional)

### 2.2 Sync-Mechanismus
- [x] Sync nur mit User + org_id (isCloudReady)
- [x] UPSERT (idempotent)
- [x] Schutz vor Doppel-Writes
- [x] Exponentielles Backoff
- [x] Konflikt-Logging (intern)

### 2.3 Backups
- Lokal: Rolling (max. 10) [x], automatisch [x], Restore [x]
- Cloud: Snapshot nach Sync [x], org-gebunden [x], Restore [x]
- Export/Import: JSON [x], Vorschau [x], iOS Dateien-Dialog [x]
- [x] Backup-Zeitstempel/Metadaten anzeigen

---

## PHASE 3 – Produkt-Entpersonalisierung & UX
### 3.1 Sprache & Texte
- [x] Branchenspezifische SeeYou/Schmuck-Texte entfernt
- [ ] Vollständig neutrale Begriffe prüfen (Termin/Kurs/Buchung konsistent)
- [ ] Keine Technik-Begriffe im UI (Audit ausstehend)
- [ ] Hilfetexte vereinfachen

### 3.2 Branding
- [x] Standard-Branding neutral (Termin Manager)
- [x] Branding konfigurierbar (Name, Farbe, Logo via APP_CONFIG)
- [ ] Branding pro Organisation speichern (optional)

### 3.3 UX-Vereinfachung
- [x] Hauptansicht + Einstellungen getrennt
- [x] Login-Bereich einklappbar/ausblendbar bei Login
- [x] Orga-Dropdown nur bei >1 Orga
- [x] Statusanzeige “Zuletzt aktualisiert”, “Cloud-Sicherung”
- [ ] Weitere Begriff-Polish für Nicht-Techniker (Audit)

---

## PHASE 4 – Zielgruppe & Positionierung
- [ ] Zielgruppe beschreiben, Alltagssituationen sammeln
- [ ] Schmerzpunkte dokumentieren
- [ ] Abgrenzung zu großen Tools
- [ ] Produktversprechen/Pitch (30 Sekunden, 3 Vorteile)

---

## PHASE 5 – Validierung & Tests
- [ ] Eigene Nutzung mehrtägig (Offline/Online-Wechsel)
- [ ] Externe Tests (1–2 vertraute, 3–5 Zielgruppen-Nutzer)
- [ ] Feedback sammeln, clustern, quick wins umsetzen

---

## PHASE 6 – Preis & Skalierung (Vorbereitung)
- [ ] Kostenübersicht, Break-even
- [ ] Preismodell (Monat/Jahr, ggf. Einrichtungsfee)
- [ ] Invite-Flow planen
- [ ] Rollenmodell finalisieren, Limits/Feature-Gates vorbereiten

---

## PHASE 7 – Dokumentation & Betrieb
- [x] README für Setup
- [ ] Architekturüberblick
- [ ] Datenmodell dokumentieren
- [ ] Backup-/Restore-Howto für Nicht-Techniker
- [ ] Update-/Support-Prozess, Monitoring, Notfallplan

---

## Aktueller Fokus / Nächste sinnvolle Schritte
1) Vision/Produktversprechen kurz niederschreiben und einpflegen (Phase 0).
2) UX-Audit Sprache/Begriffe: Technik-Jargon entfernen, Termin/Kurs/Buchung konsistent (Phase 3.1/3.3).
3) Optional: “Cache leeren” (Debug) und zentrale Error-Handler/Logging prüfen (Phase 1.2/1.3).
4) Doku ergänzen: Architekturüberblick, Backup-/Restore-Howto, Produktpitch (Phasen 0/7).
