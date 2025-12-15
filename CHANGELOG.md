# Changelog

## 1.2.0
- Multi-Tenant-Schema verankert (orgs/org_members/workshop_states/backups) + RLS-Policies, Supabase PKCE Auth mit persistierter Session.
- UI/UX: Endnutzerfreundliche Texte (Konto/Team, Cloud-Sicherung automatisch), Settings-Bereich mit Cloud-Backups, Login eingeklappt nach Erfolg.
- Storage: Stabiler IndexedDB-Layer mit Migration, Read-after-write, lokaler Queue, automatische Snapshots (lokal + Cloud) und iOS-sichere Modals.
- Sync/Backups: Offline-first, automatische Cloud-Sicherungen nach Login, Konfliktstrategie last-write-wins, Restore aus Cloud-Backups.
- Service Worker: Versionierte Caches, network-first fuer Navigation, cache-first fuer Assets, Update-Banner mit Reload.

## 1.1.0
- Storage komplett auf IndexedDB mit Migration von localStorage, Read-after-write-Check und lokalen Rolling-Backups.
- Backup-Export/-Import mit Vorschau, Snapshot-Liste und optionalen Server-Backups (Supabase).
- Supabase-Auth (Magic Link), Multi-Org-Vorbereitung, Sync-Queue und Status-Anzeige.
- Neuer Service Worker: Network-first fuer Navigation, Cache-first fuer Assets, versionierte Caches und Update-Banner.
- UI/UX: neue Status-/Auth-Leiste, Toasts, Debug-Mode, verbesserte Modals und iOS-kompatible Homescreen-PWA.
