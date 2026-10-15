# Windows Chat Bubble 0.2.2

The client connects to https://zcrm.joliefam.vn. Employees sign in with their
normal CRM account; no Hermes keys or additional Zalo sessions are involved.
Update the VPS frontend and install this Windows version together. This release
does not publish changes or deploy the VPS automatically.

## Build And Test

Node.js 22.12 or newer is required for desktop tooling. From desktop/:

```powershell
npm ci
npm test
npm run test:smoke
npm --prefix ../frontend run build
npm run test:ui
npm run dist
```

Installer: desktop/release/ZaloCRM-Setup-0.2.2.exe. Build scripts prepare Electron
and reuse its unpacked distribution, avoiding the ZIP temporary-directory rename
failure seen in the first release. The NSIS icon uses a separate 512px brand image.
The installer remains unsigned; Windows can show an unknown-publisher warning.
Production distribution needs a signing certificate. Version 0.2.2 and later can download,
verify SHA-256 and open a newer installer from the CRM update control. Users still confirm
the installation, and the app closes only after Windows accepts the installer launch. Version
0.2.1 and older need one final manual installation of 0.2.2.

## Publish An Update

Installers are not committed to Git. After building and testing, copy the `.exe` to the
VPS and publish it into persistent storage:

```bash
docker cp /tmp/ZaloCRM-Setup-0.2.2.exe zalo-crm-app:/app/ZaloCRM-Setup-0.2.2.exe
docker cp /tmp/desktop-release-notes.txt zalo-crm-app:/app/desktop-release-notes.txt
docker exec zalo-crm-app node scripts/publish-desktop-release.mjs \
  --file /app/ZaloCRM-Setup-0.2.2.exe \
  --version 0.2.2 \
  --notes-file /app/desktop-release-notes.txt
docker exec zalo-crm-app rm -f /app/ZaloCRM-Setup-0.2.2.exe /app/desktop-release-notes.txt
```

The publisher calculates SHA-256, copies the installer to
`/var/lib/zalo-crm/files/desktop-releases`, and only then atomically changes
`latest.json`. The `zalocrm_file_storage` volume preserves releases across Docker
rebuilds. Every signed-in CRM account can see the update control. The installer route
is public because the artifact contains no tenant data and browser downloads cannot
attach the CRM bearer token; metadata still requires authentication.

Local testing only:

```powershell
$env:ZALOCRM_DESKTOP_URL = 'http://127.0.0.1:3080'
npm start
```

## Conversation Inbox

The bubble opens the CRM conversation inbox, not a transient notification queue.
All conversations allowed by CRM access rules are available through the authorized
paginated API. Search, All/Unread tabs, nick filters, avatars, last-message snippets,
timestamps and unread labels are supported. Reading clears unread, not the list
entry. New messages never force a switch away from the selected customer.

Compact windows have list/chat views with a back button; wide windows show both.
Chat reuses ConversationChatWorkspace for text, images/files, rich drafts, forwarding
and AI with existing permissions. Drafts and files survive hide/reopen and customer
switches during the desktop session, not complete app exit. Read marking requires
authorized content to be loaded and the window focused.

The badge restores from all paginated unread CRM conversations at login, reconnect
and every 30 seconds. Personal/Zalo-muted conversations remain in the inbox but do
not contribute to alerts. Private nick conversations are conservatively excluded
from the alert badge; inbox viewing still uses CRM privacy unlock. Conversation
unread keeps CRM's shared-per-nick semantics, not new per-employee unread counters.

Snapshots carry a revision so a late scan cannot overwrite a newer message/read.
Network failure preserves the last valid count. Deduplication prevents duplicate
alerts; burst limits affect sound/previews, not total unread. Counts can be briefly
approximate until the next successful scan. No historical preview burst is replayed
at startup.

## Window Behavior

Chat opens beside the bubble and fits the monitor work area. Clicking outside
hides it after a short debounce; pinning keeps it open. A second bubble click
closes it. Escape returns to the inbox, then hides it, unless a dialog/menu handles
Escape. Native file pickers, confirmation dialogs and focused attachment children
hold chat open. Picker holds time out if cancel events are lost.

New eligible messages show one non-activating toast with customer/group name,
receiving nick and a bounded two-line snippet. Images/files/voice use type labels;
original attachments are not downloaded. Same-customer messages replace the toast.
It expires after six seconds; hover pauses it. Clicking opens the exact conversation;
close dismisses the toast, not unread state. Tray menu provides content/name/off
preview modes, bubble visibility, pin, Windows startup, full CRM and quit.

## Security And Verification

CRM renderers are sandboxed and context-isolated with no Node integration. IPC
checks window role, top-level frame and exact configured origin. Attachment children
have no preload bridge. External links require confirmation; certificates are not
bypassed. Microphone/camera remain disabled in this version.

Previews recheck authorized HTTP visibility after personal mute. Private/redacted
nick notifications contain generic text and no avatar. Text is bounded and rendered
with textContent, never HTML; avatar protocols/credentials are validated. Preview
data stays in bounded process memory, never preferences or a customer database.
Logout, employee changes, privacy/access events and Windows lock clear previews;
lock hides chat/bubble. Changing preview mode removes the old toast.

Tests use synthetic local fixtures, no production login or messages. Unit tests
cover pagination/races, mute/privacy filtering, stale unread scans and notifications.
Electron smoke covers preview, inbox-default, auto-hide/pin, simulated picker holds,
attachment children and logout. Built-frontend UI tests use 65 conversations for
pagination/search/unread and laptop/wide screenshots. Actual Windows picker timing,
real reconnects, physical multiple monitors and publisher signing need pilot checks
on employee machines before broad rollout.
