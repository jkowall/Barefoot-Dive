# Permissions and data boundary

Barefoot Dive is single-user and local-only. It requests no application-specific network, account, location, health, contacts, camera, microphone, or cloud permissions. The browser/native runtime provides only the storage and bundle capabilities needed by the app.

| Resource | Operation | Boundary |
| --- | --- | --- |
| Static PWA/native bundle | Read | Browser or Capacitor WebView |
| Tank Bank | Read/write/archive/delete | `localStorage`, local UI validation |
| Saved plans | Read/write/archive/delete | `localStorage`, immutable cloned snapshots |
| Calculations | Execute | Local pure TypeScript functions |

There are no server tables, sessions, row-level security, claims, provider tokens, analytics events, subscriptions, or remote calculation calls. Local storage can be cleared by the user or platform and is not a backup.
