# Projekt-Roadmap – Termin Manager (PWA)

**Stand:** 16. Dezember 2025  
**Status:** ✅ **Beta-Reif** – Kernsystem stabil, letzte UX-Feinschliffe ausstehend

Ziel: Offline-first Termin-/Buchungs-App zu einem stabilen, skalierbaren Produkt machen, nutzbar für Solo- und Kleinanbieter (Workshops, Kurse, Events), ohne technische Komplexität für Endnutzer.

---

## PHASE 0 – Ausgangslage & Ziel
- [x] Reales Alltagsproblem identifiziert
- [x] Lösung ist mobil, offline-fähig, schnell
- [x] Fokus auf einfache Nutzung
- [x] Vision kurz formuliert ✅ **ERLEDIGT**
- [x] Produktversprechen/Pitch ergänzt ✅ **ERLEDIGT**

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
- [x] Option "Cache leeren" (nur Debug/Admin)

### 1.3 Fehlerresistenz
- [x] Null-sichere DOM-Zugriffe
- [x] try/catch in kritischen Pfaden
- [x] Zentrale Error-Handling-Funktion
- [ ] Optional Error-Logging (z. B. Sentry)

### 1.4 Auth & Session
- [x] Supabase PKCE (persistSession, autoRefreshToken, detectSessionInUrl)
- [x] Login nur einmal nötig (Session bleibt)
- [x] Session-Status klar/visuell hervorheben

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
- [x] Technik-Begriffe vereinfacht (Sync → Automatisch gespeichert, Cache → Speicher)
- [x] Keine Technik-Begriffe im UI (Audit durchgeführt)
- [x] Hilfetexte hinzugefügt (Backup-Erklärung)

### 3.2 Branding
- [x] Standard-Branding neutral (Termin Manager)
- [x] Branding konfigurierbar (Name, Farbe, Logo via APP_CONFIG)
- [ ] Branding pro Organisation speichern (optional)

### 3.3 UX-Vereinfachung
- [x] Hauptansicht + Einstellungen getrennt
- [x] Login-Bereich einklappbar/ausblendbar bei Login
- [x] Orga-Dropdown nur bei >1 Orga
- [x] Statusanzeige "Zuletzt aktualisiert", "Online-Speicherung", Session-Badge
- [x] Begriffe vereinfacht für Nicht-Techniker

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
- [x] Backup-/Restore-Howto für Nicht-Techniker
- [ ] Update-/Support-Prozess, Monitoring, Notfallplan

---

## PHASE 8 – Version 2: Website-Integration (Zukunft)
### 8.1 API/Webhook-System
- [ ] REST-API für Website-Zugriff auf Termine
- [ ] Webhook-System für bidirektionale Synchronisierung
- [ ] Event-Benachrichtigungen (neue Buchung, Änderung, Stornierung)
- [ ] API-Keys mit Rollen (readonly, readwrite)

### 8.2 Public Booking Widget
- [ ] Einbettbares Widget für Webseiten (iFrame/Web Component)
- [ ] Öffentliche Terminübersicht (nur verfügbare Slots)
- [ ] Buchungsformular mit Validierung
- [ ] Bestätigungs-E-Mails automatisch versenden

### 8.3 Website-to-App Sync
- [ ] Import von Terminen aus Website CMS (WordPress, Webflow, etc.)
- [ ] Automatische Synchronisierung (scheduled)
- [ ] Konfliktbehandlung bei Überschneidungen
- [ ] Website zeigt immer aktuelle Verfügbarkeit aus App

### 8.4 Use Cases
- Anbieter pflegt Termine in App, Website zeigt sie automatisch
- Buchungen über Website landen direkt in der App
- Änderungen in App werden auf Website reflektiert
- Kunden können über Website buchen, ohne separate Plattform

**Ziel:** Nahtlose Integration zwischen interner Terminverwaltung (App) und öffentlicher Präsentation (Website), ohne doppelte Datenpflege.

---

## Aktueller Fokus / Nächste sinnvolle Schritte
1) ✅ Vision/Produktversprechen kurz niederschreiben und einpflegen (Phase 0) – **ERLEDIGT**
2) ✅ Error-Logging System eingebaut (Phase 1.3) – **ERLEDIGT**
3) ✅ Session-Status visuell verbessert (Phase 1.4) – **ERLEDIGT**
4) ✅ Auto-Archivierung vergangener Termine beim App-Start (Phase 4.1) – **ERLEDIGT**
5) 🔴 **KRITISCH:** 7 Tage Selbsttest (Offline/Online-Wechsel) durchführen (Phase 5)
6) ✅ UX-Audit Sprache/Begriffe: Technik-Jargon entfernt (Phase 3.1/3.3) – **ERLEDIGT**
7) ✅ "Cache leeren" (Debug) hinzugefügt (Phase 1.2) – **ERLEDIGT**
8) Doku ergänzen: Architekturüberblick, Backup-/Restore-Howto (Phase 7)
9) 📋 Website-Integration als v2-Feature geplant (Phase 8)
