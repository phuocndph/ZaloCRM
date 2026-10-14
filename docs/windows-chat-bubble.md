# Windows Chat Bubble

The Windows client connects to https://zcrm.joliefam.vn by default. Users sign
in with their ordinary CRM account. There are no Agent keys, additional Zalo
sessions or local customer databases.

## Build And Run

Install Node.js, then from desktop/ run:

```powershell
npm ci
npm test
npm run test:smoke
npm run dist
```

The installer is generated in desktop/release/. This first release is unsigned:
Windows can show a publisher warning. Production distribution should use a
code-signing certificate. No unsigned auto-update mechanism is included.

For local development only:

```powershell
$env:ZALOCRM_DESKTOP_URL = 'http://127.0.0.1:3080'
npm start
```

The VPS must serve the frontend changes containing the desktop bridge and
/desktop/chat route before notification bubbles work. An older server still
opens the ordinary CRM but cannot produce desktop bubbles. Publishing a Windows
installer alone does not upgrade the VPS.

## Behavior

After login, one draggable floating bubble appears. Eligible incoming messages
increment its badge without opening a window or taking focus. Clicking it opens
a compact conversation workspace, built from the same chat components used by
customer work items. It supports text, attachments, previews, forwarding, rich
drafts and AI subject to existing CRM permissions.

Closing the main CRM window hides it in the system tray; it continues receiving
messages. Right-click the tray/bubble to hide/show the bubble, clear its pending
list, enable Windows startup after installation, open CRM, or quit completely.
The compact chat is always on top and supports minimize/expand/full CRM.

Notifications honor personal and Zalo mute settings through the existing CRM
notification pipeline. Disabling CRM notifications also clears the bubble list.
Muted conversations still receive/store messages. Logout, employee/org changes
and privacy/access events clear the pending list. Opening an authorized chat
marks it read only after its history is available and the window is focused.

The queue is a bounded, in-memory list of notifications received during the
desktop session, not the CRM's total historical unread counter. The native layer
stores identifiers and labels only, never message bodies, avatar URLs or tokens.
Mute changes made on Zalo arrive with the existing minute-based polling; there
can still be a short delay before CRM learns a new mute.

## Security

Remote CRM pages run sandboxed with context isolation and no Node integration.
The preload exposes only fixed-purpose IPC operations. Main-process handlers
check window role, exact top-level frame and configured origin. Ordinary
browser pages cannot invoke this bridge. Login/cookies/storage belong to the
normal Electron CRM session; native code does not read or save credentials.

Navigation stays on the configured CRM origin. External links require explicit
confirmation before opening the system browser. Secondary attachment windows
have no preload privileges. The app never bypasses certificate errors.

Camera/microphone permissions are disabled in this prototype. Text, image/file
selection and attachment viewing use existing CRM behavior; audio recording is
not claimed as supported. The app must be running, connected and logged in to
receive messages. Reconnection uses the CRM socket behavior; historical unread
recovery and signed automatic app updates remain follow-up work.
