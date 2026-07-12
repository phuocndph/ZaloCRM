<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- BlankLayout — passthrough không khung. Dùng cho các route TỰ QUẢN chrome riêng
     (vd /m → MobileShell tự lo header/bottom-nav/safe-area). Tránh bị MobileLayout/
     DefaultLayout bọc 2 lớp. -->
<template>
  <slot />
</template>
