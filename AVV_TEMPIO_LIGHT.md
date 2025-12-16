# Auftragsverarbeitungsvereinbarung (AVV) – Light
## für die Nutzung von TEMPIO (Offline-first Termin- & Buchungsverwaltung)

Stand: Dezember 2025

---

## 1. Parteien

**Auftraggeber (Verantwortlicher)**
- Firma/Name: ____________________________
- Anschrift: _____________________________
- E-Mail: ________________________________

**Auftragnehmer (Auftragsverarbeiter)**
- Software Manufaktur (Inhaber: Roy Heppner)
- Wilhelm-Pieck-Straße 6, 04651 Bad Lausick, Deutschland
- E-Mail: kontakt@diesoftwaremanufaktur.de

---

## 2. Gegenstand und Dauer

(1) Gegenstand dieser Vereinbarung ist die Verarbeitung personenbezogener Daten im Auftrag des Auftraggebers im Zusammenhang mit der Bereitstellung der Anwendung **TEMPIO**.

(2) Die Vereinbarung gilt für die Dauer der Nutzung von TEMPIO durch den Auftraggeber und endet mit Beendigung der Nutzung (Kündigung/Deaktivierung).

---

## 3. Art und Zweck der Verarbeitung

**Zweck**:
- Bereitstellung der App-Funktionalität
- Authentifizierung (Magic-Link Login)
- optionale Cloud-Synchronisation und Datensicherung (Backups)
- Wiederherstellung von Daten bei Bedarf

**Wesentliche Verarbeitungsvorgänge**:
- Speichern/Aktualisieren von Termin- und Buchungsdaten (Cloud optional)
- Erstellen von Sicherungen (Backups)
- Benutzerverwaltung (Organisationen, Mitgliedschaften)

---

## 4. Art der Daten und Kategorien betroffener Personen

**Datenarten** (typisch, abhängig vom Auftraggeber):
- Kontaktdaten (z.B. Name, E-Mail, Telefonnummer)
- Buchungs-/Teilnahmedaten (z.B. Termin, Anzahl Plätze, Notizen)
- Kommunikations-/Organisationsnotizen
- technische Identifikatoren (z.B. User-ID)

**Betroffene Personen**:
- Kundinnen und Kunden des Auftraggebers
- Interessenten/Teilnehmende
- Mitarbeitende des Auftraggebers (Nutzerkonten)

---

## 5. Pflichten und Verantwortlichkeiten

### 5.1 Auftraggeber
- bleibt Verantwortlicher i.S.d. DSGVO für die Daten seiner Kundinnen/Kunden
- stellt sicher, dass eine Rechtsgrundlage für die Verarbeitung besteht
- entscheidet über Inhalt, Umfang und Zwecke der Kundendaten in TEMPIO

### 5.2 Auftragnehmer
- verarbeitet Daten ausschließlich auf dokumentierte Weisung des Auftraggebers (über App-Funktionen)
- stellt angemessene technische und organisatorische Maßnahmen (TOM) bereit
- unterstützt den Auftraggeber bei Betroffenenanfragen im Rahmen der Möglichkeiten

---

## 6. Technische und organisatorische Maßnahmen (TOM) – Kurzüberblick

Der Auftragnehmer setzt u.a. folgende Maßnahmen um:
- Zugriffsschutz durch Authentifizierung (Magic Link)
- Mandantentrennung über Organisationen und Row Level Security (RLS)
- Verschlüsselte Übertragung (HTTPS/TLS)
- Backup-Mechanismen (lokal + optional Cloud)
- Protokollierung/Monitoring auf Systemebene im Rahmen des Hostings

Hinweis: TEMPIO ist offline-first; ein Teil der Datenverarbeitung findet lokal auf dem Endgerät statt. Für Geräteschutz, Passcode und Betriebssystem-Updates ist der Auftraggeber bzw. dessen Nutzer verantwortlich.

---

## 7. Unterauftragsverarbeiter

Für Authentifizierung und optionale Cloud-Sicherung nutzt der Auftragnehmer:
- **Supabase Inc.** (Hosting/DB/Auth), Verarbeitung in der EU (Region Frankfurt)

Weitere Unterauftragnehmer werden nur eingesetzt, wenn dies für den Betrieb erforderlich ist.

---

## 8. Unterstützung bei Betroffenenrechten

Der Auftragnehmer unterstützt den Auftraggeber im Rahmen der technischen Möglichkeiten bei:
- Auskunft, Berichtigung, Löschung, Datenexport
- Wiederherstellung aus Backups (sofern vorhanden)

---

## 9. Meldung von Datenschutzvorfällen

Der Auftragnehmer informiert den Auftraggeber unverzüglich, wenn ihm Verletzungen des Schutzes personenbezogener Daten bekannt werden, die den Auftraggeber betreffen.

---

## 10. Rückgabe/Löschung nach Vertragsende

Nach Ende der Nutzung kann der Auftraggeber:
- Datenexporte/Backups aus der App durchführen (Export-Funktion)
- Die Löschung der Cloud-Daten verlangen, soweit diese beim Auftragnehmer gespeichert sind und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.

---

## 11. Vertraulichkeit

Der Auftragnehmer verpflichtet sich zur Vertraulichkeit. Sofern Mitarbeitende eingesetzt werden, werden diese entsprechend verpflichtet.

---

## 12. Schlussbestimmungen

(1) Änderungen und Ergänzungen bedürfen der Textform.  
(2) Es gilt deutsches Recht.  
(3) Sollten einzelne Bestimmungen unwirksam sein, bleibt der Rest wirksam.

---

## Unterschriften

Ort/Datum: _______________________

**Auftraggeber**: _______________________________

**Auftragnehmer (Software Manufaktur / Roy Heppner)**: _______________________________
