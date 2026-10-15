# Windows Chat Bubble 0.2.3

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

Installer: desktop/release/ZaloCRM-Setup-0.2.3.exe. Build scripts prepare Electron
and reuse its unpacked distribution, avoiding the ZIP temporary-directory rename
failure seen in the first release. The NSIS icon uses a separate 512px brand image.
The installer remains unsigned; Windows can show an unknown-publisher warning.
Production distribution needs a signing certificate. The Windows application menu and
tray menu always include Update in version 0.2.3, even before deploying the VPS frontend.
This opens a bundled, sandboxed updater with installed/latest version, notes and progress.
It reads the official public phuocndph/ZaloCRM GitHub release, validates its asset URL,
size and SHA-256 digest, then downloads and verifies the installer. Redirects are allowed
only to GitHub's release-assets.githubusercontent.com host. Users confirm before the app
opens the installer and exits. The existing CRM-hosted update API remains available for
browsers and version 0.2.2 clients. Older clients can install 0.2.3 manually from Releases.

## Publish An Update

Installers are not committed to Git. Publish the installer as an asset in the public
GitHub release for the same version. Native 0.2.3+ clients discover it without needing a
VPS release manifest. To also enable web/legacy downloads, publish it on the VPS:

```bash
curl -fL --retry 3 -o /tmp/ZaloCRM-Setup-0.2.3.exe \
  https://github.com/phuocndph/ZaloCRM/releases/download/v0.2.3/ZaloCRM-Setup-0.2.3.exe
docker cp /tmp/ZaloCRM-Setup-0.2.3.exe zalo-crm-app:/app/ZaloCRM-Setup-0.2.3.exe
docker cp desktop/release-notes-0.2.3.txt zalo-crm-app:/app/desktop-release-notes.txt
docker exec zalo-crm-app node scripts/publish-desktop-release.mjs \
  --file /app/ZaloCRM-Setup-0.2.3.exe \
  --version 0.2.3 \
  --notes-file /app/desktop-release-notes.txt
docker exec zalo-crm-app rm -f /app/ZaloCRM-Setup-0.2.3.exe /app/desktop-release-notes.txt
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
The most recent 12 opened customers remain in a separate horizontal strip, independent
of search, nick and unread filters. A read customer stays reachable after leaving Unread.
The strip always shows the receiving nick, with a separate draft icon. Access/privacy invalidation clears it;
it is kept only during the window session and stores no extra content on disk.
Reopening the bubble restores the selected conversation instead of resetting to the list.
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

New eligible messages show up to three non-activating cards with CRM customer/group name,
receiving nick, timestamp, message count and a bounded three-line snippet. Group cards
also name the member sending the message. Contact/friend metadata fills missing sender
names and avatars. Images/files/voice use type labels; original attachments are not downloaded.
Same-customer messages update that card instead of replacing another customer's card.
Cards expire after nine seconds; hover pauses expiry. Clicking opens the exact conversation;
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
Electron smoke covers the native menu/updater without CRM login, multi-customer previews,
inbox-default, auto-hide/pin, simulated picker holds, attachment children and logout.
Built-frontend UI tests use 65 conversations for pagination/search/unread, A/B/A switching
with draft restoration, bubble reopen, and 420px/laptop/wide screenshots. Actual Windows picker timing,
real reconnects, physical multiple monitors and publisher signing need pilot checks
on employee machines before broad rollout.
