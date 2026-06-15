# Zalo CRM - Tài Liệu API

**Phiên bản:** 1.0.0  
**Cập nhật lần cuối:** 2026-06-05  
**URL Cơ sở:** `http://localhost:3000` (phát triển) | `https://api.zalocrm.com` (sản xuất)

---

## Mục Lục

1. [Xác Thực](#xác-thực)
2. [Thiết Lập Ban Đầu](#thiết-lập-ban-đầu)
3. [Quản Lý Tài Khoản Zalo](#quản-lý-tài-khoản-zalo)
4. [Chat & Tin Nhắn](#chat--tin-nhắn)
5. [Liên Hệ & CRM](#liên-hệ--crm)
6. [Tự Động Hóa & Marketing](#tự-động-hóa--marketing)
7. [Phân Tích & Báo Cáo](#phân-tích--báo-cáo)
8. [Đội & Tổ Chức](#đội--tổ-chức)
9. [Kiểm Soát Truy Cập Dựa Trên Vai Trò](#kiểm-soát-truy-cập-dựa-trên-vai-trò)
10. [Tìm Kiếm](#tìm-kiếm)
11. [Chấm Điểm & Quản Lý Lead](#chấm-điểm--quản-lý-lead)
12. [Sự Tham Gia](#sự-tham-gia)
13. [Hoạt Động & Dòng Thời Gian](#hoạt-động--dòng-thời-gian)
14. [Thông Báo](#thông-báo)
15. [Tích Hợp](#tích-hợp)
16. [AI & Trợ Lý](#ai--trợ-lý)
17. [Thương Hiệu](#thương-hiệu)
18. [Bảo Mật & Quyền Riêng Tư](#bảo-mật--quyền-riêng-tư)
19. [API Công Khai & Webhook](#api-công-khai--webhook)
20. [Hệ Thống](#hệ-thống)
21. [API Công Khai REST (External — X-API-Key)](#21-api-công-khai-rest-external-api--x-api-key)
22. [Phụ Lục A — Danh Mục Đầy Đủ Endpoint](#22-phụ-lục-a--danh-mục-đầy-đủ-endpoint-jwt-nội-bộ)

---

## Hướng Dẫn Chung

### Xác Thực
- Tất cả các endpoint (ngoại trừ `/api/v1/setup/*` và `/api/v1/auth/login`) yêu cầu xác thực JWT
- Đưa token vào header yêu cầu: `Authorization: Bearer <token>`
- Token hết hạn trong 7 ngày
- Phản hồi xác thực thành công bao gồm đối tượng `token` và `user`

### Giới Hạn Tốc Độ
- **Giới hạn toàn cục:** 500 yêu cầu mỗi phút
- **Theo IP:** Áp dụng cho tất cả các route `/api/*`
- **Header phản hồi:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Phản Hồi Lỗi
```json
{
  "error": "Thông báo lỗi",
  "statusCode": 400
}
```

### Phân Trang
- **Giới hạn mặc định:** 50 mục
- **Giới hạn tối đa:** 100 mục
- **Tham số:** `page`, `limit`, `offset`
- **Phản hồi bao gồm:** `data`, `total`, `page`, `limit`

---

## 1. Xác Thực

### 1.1 Kiểm Tra Trạng Thái Thiết Lập
**GET** `/api/v1/setup/status`

Kiểm tra xem có cần thiết lập ban đầu hay không.

**Phản hồi:**
```json
{
  "setupRequired": true,
  "organizationCount": 0
}
```

---

### 1.2 Thiết Lập Ban Đầu
**POST** `/api/v1/setup`

Tạo tổ chức và tài khoản người dùng chủ sở hữu. Chỉ khả dụng khi hệ thống không có tổ chức nào.

**Thân Yêu Cầu:**
```json
{
  "orgName": "Công Ty Acme",
  "fullName": "Nguyễn Văn A",
  "email": "a@acme.com",
  "password": "MatKhauAn123"
}
```

**Phản hồi:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "a@acme.com",
    "fullName": "Nguyễn Văn A",
    "role": "owner",
    "orgId": "org-123"
  }
}
```

**Mã Trạng Thái:** 201, 400, 409 (nếu thiết lập đã hoàn tất)

---

### 1.3 Đăng Nhập
**POST** `/api/v1/auth/login`

Xác thực người dùng và nhận token JWT.

**Thân Yêu Cầu:**
```json
{
  "email": "a@acme.com",
  "password": "MatKhauAn123"
}
```

**Phản hồi:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "a@acme.com",
    "fullName": "Nguyễn Văn A",
    "role": "admin",
    "orgId": "org-123"
  }
}
```

**Mã Trạng Thái:** 200, 401 (thông tin đăng nhập không hợp lệ)

---

### 1.4 Lấy Hồ Sơ Hiện Tại
**GET** `/api/v1/profile`

Lấy hồ sơ của người dùng được xác thực.

**Header:**
```
Authorization: Bearer <token>
```

**Phản hồi:**
```json
{
  "id": "user-123",
  "email": "a@acme.com",
  "fullName": "Nguyễn Văn A",
  "role": "admin",
  "orgId": "org-123",
  "department": "Bán Hàng",
  "avatar": "https://...",
  "createdAt": "2026-01-15T10:30:00Z",
  "lastLogin": "2026-06-05T14:22:00Z"
}
```

**Mã Trạng Thái:** 200, 401

---

## 2. Thiết Lập Ban Đầu

### 2.1 Tạo Tổ Chức
**POST** `/api/v1/orgs`

Tạo tổ chức mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Công Ty Marketing",
  "industry": "Marketing",
  "website": "https://agency.com",
  "phone": "+84.9.xxxx.xxxx",
  "address": "123 Main St"
}
```

**Phản hồi:** 201
```json
{
  "id": "org-456",
  "name": "Công Ty Marketing",
  "createdAt": "2026-06-05T17:30:00Z"
}
```

---

## 3. Quản Lý Tài Khoản Zalo

### 3.1 Liệt Kê Tài Khoản Zalo
**GET** `/api/v1/zalo-accounts`

Liệt kê tất cả các tài khoản Zalo được kết nối với trạng thái trực tiếp.

**Tham Số Truy Vấn:**
- `status` - Lọc theo trạng thái: `qr_pending`, `connected`, `disconnected`
- `assignedTo` - Lọc theo chủ sở hữu tài khoản
- `search` - Tìm kiếm theo tên hiển thị hoặc số điện thoại

**Phản hồi:**
```json
[
  {
    "id": "acc-001",
    "zaloUid": "1234567890",
    "displayName": "Zalo Chính Thức",
    "avatarUrl": "https://...",
    "phone": "+84.9.xxxx.xxxx",
    "status": "connected",
    "liveStatus": {
      "state": "connected",
      "connectedAt": "2026-06-05T10:00:00Z",
      "lastHeartbeat": "2026-06-05T17:30:00Z"
    },
    "ownerUserId": "user-123",
    "owner": {
      "id": "user-123",
      "fullName": "Nguyễn Văn A",
      "email": "a@acme.com"
    },
    "hasProxy": false,
    "lastConnectedAt": "2026-06-05T10:00:00Z",
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 3.2 Tạo Tài Khoản Zalo
**POST** `/api/v1/zalo-accounts`

Tạo bản ghi tài khoản mới (trước khi đăng nhập QR).

**Thân Yêu Cầu:**
```json
{
  "displayName": "Tài Khoản Kinh Doanh Của Tôi",
  "proxyUrl": null
}
```

**Phản hồi:** 201
```json
{
  "id": "acc-002",
  "displayName": "Tài Khoản Kinh Doanh Của Tôi",
  "status": "qr_pending",
  "createdAt": "2026-06-05T17:30:00Z"
}
```

---

### 3.3 Bắt Đầu Đăng Nhập QR
**POST** `/api/v1/zalo-accounts/:id/login`

Bắt đầu quá trình đăng nhập mã QR. QR được gửi qua Socket.IO.

**Phòng Socket:** `account:{id}`

**Phản hồi:**
```json
{
  "message": "Đã bắt đầu đăng nhập QR — đăng ký phòng socket account:acc-001"
}
```

---

### 3.4 Kết Nối Lại Bắt Buộc
**POST** `/api/v1/zalo-accounts/:id/reconnect`

Kết nối lại bằng dữ liệu phiên được lưu.

**Phản hồi:**
```json
{
  "message": "Đã bắt đầu kết nối lại"
}
```

---

### 3.5 Xóa/Lưu Trữ Tài Khoản
**DELETE** `/api/v1/zalo-accounts/:id`

Lưu trữ tài khoản (xóa mềm). Sử dụng `?purge=true` để xóa dữ liệu phiên.

**Tham Số Truy Vấn:**
- `purge` - Boolean. Nếu true, xóa sessionData và zaloUid để kết nối lại mới

**Phản hồi:** 204 Không Có Nội Dung

---

### 3.6 Lấy Trạng Thái Tài Khoản
**GET** `/api/v1/zalo-accounts/:id/status`

Lấy trạng thái thời gian thực của tài khoản cụ thể.

**Phản hồi:**
```json
{
  "accountId": "acc-001",
  "liveStatus": {
    "state": "connected",
    "connectedAt": "2026-06-05T10:00:00Z",
    "lastHeartbeat": "2026-06-05T17:30:00Z"
  }
}
```

---

### 3.7 Cập Nhật Proxy
**PUT** `/api/v1/zalo-accounts/:id/proxy`

Cập nhật cấu hình proxy cho tài khoản.

**Thân Yêu Cầu:**
```json
{
  "proxyUrl": "http://user:pass@proxy.com:8080"
}
```

**Phản hồi:**
```json
{
  "message": "Proxy đã được cập nhật",
  "hasProxy": true
}
```

---

## 4. Chat & Tin Nhắn

### 4.1 Lấy Số Lượng Cuộc Trò Chuyện
**GET** `/api/v1/conversations/counts`

Lấy số lượng cuộc trò chuyện chưa đọc và chưa trả lời.

**Phản hồi:**
```json
{
  "total": 150,
  "unread": 25,
  "unreplied": 12,
  "archived": 8
}
```

---

### 4.2 Liệt Kê Cuộc Trò Chuyện
**GET** `/api/v1/conversations`

Liệt kê các cuộc trò chuyện/luồng với phân trang.

**Tham Số Truy Vấn:**
- `page` - Số trang (mặc định: 1)
- `limit` - Mục trên mỗi trang (mặc định: 50, tối đa: 100)
- `status` - Lọc: `active`, `archived`, `closed`
- `type` - Lọc: `user`, `group`
- `search` - Tìm kiếm theo tên liên hệ
- `sortBy` - Trường sắp xếp: `lastMessage`, `createdAt` (mặc định: `lastMessage`)
- `direction` - Hướng sắp xếp: `asc`, `desc`

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "conv-001",
      "contactId": "contact-123",
      "contactName": "Nguyễn Văn A",
      "contactAvatar": "https://...",
      "type": "user",
      "zaloAccountId": "acc-001",
      "messageCount": 45,
      "unreadCount": 3,
      "lastMessage": {
        "id": "msg-999",
        "content": "Xin chào!",
        "contentType": "text",
        "senderName": "Nguyễn Văn A",
        "sentAt": "2026-06-05T17:20:00Z"
      },
      "status": "active",
      "createdAt": "2026-03-10T08:00:00Z",
      "lastActivityAt": "2026-06-05T17:20:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 50,
    "pages": 3
  }
}
```

---

### 4.3 Lấy Chi Tiết Cuộc Trò Chuyện
**GET** `/api/v1/conversations/:id`

Lấy cuộc trò chuyện đầy đủ với các tin nhắn.

**Tham Số Truy Vấn:**
- `page` - Trang tin nhắn (mặc định: 1)
- `limit` - Tin nhắn mỗi trang (mặc định: 30)

**Phản hồi:**
```json
{
  "conversation": {
    "id": "conv-001",
    "contactId": "contact-123",
    "contactName": "Nguyễn Văn A",
    "type": "user",
    "zaloAccountId": "acc-001",
    "status": "active",
    "createdAt": "2026-03-10T08:00:00Z"
  },
  "messages": [
    {
      "id": "msg-001",
      "conversationId": "conv-001",
      "content": "Bạn khỏe không?",
      "contentType": "text",
      "senderUid": "1234567890",
      "senderName": "Nguyễn Văn A",
      "isFromZalo": true,
      "isRead": true,
      "isReplied": true,
      "sentAt": "2026-06-05T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "limit": 30
  }
}
```

---

### 4.4 Gửi Tin Nhắn
**POST** `/api/v1/conversations/:id/messages`

Gửi tin nhắn đến cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "content": "Cảm ơn vì đã liên hệ!",
  "contentType": "text",
  "attachments": []
}
```

**Phản hồi:** 201
```json
{
  "id": "msg-1000",
  "conversationId": "conv-001",
  "content": "Cảm ơn vì đã liên hệ!",
  "contentType": "text",
  "senderName": "Nguyễn Văn B",
  "sentAt": "2026-06-05T17:35:00Z",
  "status": "sent"
}
```

---

### 4.5 Lưu Trữ Cuộc Trò Chuyện
**POST** `/api/v1/conversations/:id/archive`

Lưu trữ cuộc trò chuyện.

**Phản hồi:**
```json
{
  "message": "Cuộc trò chuyện đã được lưu trữ"
}
```

---

### 4.6 Tạo Thư Mục Chat
**POST** `/api/v1/chat/folders`

Tạo thư mục để tổ chức các cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "name": "Lead Nóng",
  "color": "#FF5722"
}
```

**Phản hồi:** 201
```json
{
  "id": "folder-001",
  "name": "Lead Nóng",
  "color": "#FF5722",
  "conversationCount": 0,
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 4.7 Liệt Kê Cài Đặt Chat
**GET** `/api/v1/chat/presets`

Liệt kê các mẫu tin nhắn được lưu.

**Phản hồi:**
```json
[
  {
    "id": "preset-001",
    "name": "Lời Chào",
    "content": "Xin chào! Cảm ơn vì đã liên hệ với chúng tôi 👋",
    "category": "greetings",
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 4.8 Tải Lên Tệp Đính Kèm
**POST** `/api/v1/chat/attachments`

Tải lên tệp/hình ảnh/video để gửi.

**Yêu Cầu:** Form-data với trường `file`

**Phản hồi:** 201
```json
{
  "id": "attach-001",
  "filename": "document.pdf",
  "size": 1024000,
  "contentType": "application/pdf",
  "url": "https://api.zalocrm.com/attachments/attach-001",
  "uploadedAt": "2026-06-05T17:35:00Z"
}
```

---

## 5. Liên Hệ & CRM

### 5.1 Liệt Kê Liên Hệ
**GET** `/api/v1/contacts`

Liệt kê các liên hệ với bộ lọc nâng cao.

**Tham Số Truy Vấn:**
- `page` - Số trang (mặc định: 1)
- `limit` - Mục mỗi trang (mặc định: 50)
- `search` - Tìm kiếm theo tên, điện thoại, email
- `source` - Lọc theo nguồn: `zalo`, `facebook`, `manual`, v.v.
- `status` - Lọc theo trạng thái (ví dụ: `lead`, `customer`, `lost`)
- `statusId` - Lọc theo ID trạng thái tùy chỉnh
- `assignedUserId` - Lọc theo người dùng được gán
- `threadType` - Lọc theo loại cuộc trò chuyện: `user`, `group`
- `hasZalo` - Lọc theo kết nối Zalo: `true`, `false`, `unknown`
- `scoreMin` / `scoreMax` - Lọc theo phạm vi điểm số chứng chỉ
- `dateFrom` / `dateTo` - Lọc theo phạm vi ngày hoạt động
- `sortBy` - Trường sắp xếp: `lastActivity`, `createdAt`, `leadScore`
- `direction` - `asc` hoặc `desc`

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "contact-001",
      "name": "Nguyễn Văn A",
      "email": "a@example.com",
      "phone": "+84.9.xxxx.xxxx",
      "source": "zalo",
      "status": "lead",
      "statusId": "status-001",
      "assignedUserId": "user-123",
      "avatar": "https://...",
      "leadScore": 85,
      "hasZalo": true,
      "friends": [
        {
          "zaloUid": "1234567890",
          "displayName": "Nguyễn Văn A",
          "accountId": "acc-001"
        }
      ],
      "notes": "Quan tâm đến gói premium",
      "tags": ["lead-nóng", "vip"],
      "lastActivity": "2026-06-05T16:45:00Z",
      "createdAt": "2026-03-10T08:00:00Z"
    }
  ],
  "pagination": {
    "total": 500,
    "page": 1,
    "limit": 50,
    "pages": 10
  }
}
```

---

### 5.2 Lấy Chi Tiết Liên Hệ
**GET** `/api/v1/contacts/:id`

Lấy đầy đủ thông tin liên hệ.

**Phản hồi:**
```json
{
  "id": "contact-001",
  "name": "Nguyễn Văn A",
  "email": "a@example.com",
  "phone": "+84.9.xxxx.xxxx",
  "source": "zalo",
  "status": "lead",
  "statusId": "status-001",
  "assignedUserId": "user-123",
  "avatar": "https://...",
  "leadScore": 85,
  "hasZalo": true,
  "friends": [
    {
      "zaloUid": "1234567890",
      "displayName": "Nguyễn Văn A",
      "accountId": "acc-001"
    }
  ],
  "conversations": [
    {
      "id": "conv-001",
      "zaloAccountId": "acc-001",
      "messageCount": 45,
      "lastMessageAt": "2026-06-05T16:45:00Z"
    }
  ],
  "notes": [
    {
      "id": "note-001",
      "content": "Quan tâm đến gói premium",
      "createdBy": "user-123",
      "createdAt": "2026-06-01T10:00:00Z"
    }
  ],
  "tags": ["lead-nóng", "vip"],
  "appointments": [
    {
      "id": "apt-001",
      "title": "Cuộc Gọi Demo",
      "scheduledAt": "2026-06-10T14:00:00Z",
      "status": "scheduled"
    }
  ],
  "activities": [
    {
      "type": "message_received",
      "timestamp": "2026-06-05T16:45:00Z",
      "data": "Khách hàng gửi tin nhắn"
    }
  ],
  "createdAt": "2026-03-10T08:00:00Z",
  "updatedAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.3 Tạo Liên Hệ
**POST** `/api/v1/contacts`

Tạo liên hệ mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Trần Thị B",
  "email": "b@example.com",
  "phone": "+84.9.yyyy.yyyy",
  "source": "facebook",
  "status": "lead",
  "statusId": "status-001",
  "assignedUserId": "user-123",
  "notes": "Được giới thiệu bởi khách hàng hiện tại",
  "tags": ["giới-thiệu"]
}
```

**Phản hồi:** 201
```json
{
  "id": "contact-002",
  "name": "Trần Thị B",
  "email": "b@example.com",
  "phone": "+84.9.yyyy.yyyy",
  "source": "facebook",
  "status": "lead",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.4 Cập Nhật Liên Hệ
**PUT** `/api/v1/contacts/:id`

Cập nhật thông tin liên hệ.

**Thân Yêu Cầu:**
```json
{
  "name": "Trần Thị B",
  "email": "b.tran@example.com",
  "status": "customer",
  "assignedUserId": "user-124",
  "tags": ["vip", "giới-thiệu"]
}
```

**Phản hồi:** 200
```json
{
  "id": "contact-002",
  "name": "Trần Thị B",
  "email": "b.tran@example.com",
  "status": "customer",
  "updatedAt": "2026-06-05T17:40:00Z"
}
```

---

### 5.5 Xóa Liên Hệ
**DELETE** `/api/v1/contacts/:id`

Xóa liên hệ.

**Phản hồi:** 204 Không Có Nội Dung

---

### 5.6 Lấy Bạn Bè Liên Hệ
**GET** `/api/v1/contacts/:id/friends`

Lấy kết nối bạn bè Zalo cho liên hệ.

**Phản hồi:**
```json
[
  {
    "id": "friend-001",
    "zaloUid": "1234567890",
    "displayName": "Nguyễn Văn A",
    "accountId": "acc-001",
    "relationshipKind": "friend",
    "addedAt": "2026-03-10T08:00:00Z"
  }
]
```

---

### 5.7 Tạo Cuộc Hẹn
**POST** `/api/v1/appointments`

Lên lịch hẹn với liên hệ.

**Thân Yêu Cầu:**
```json
{
  "contactId": "contact-001",
  "title": "Demo Sản Phẩm",
  "description": "Giới thiệu các tính năng premium",
  "scheduledAt": "2026-06-10T14:00:00Z",
  "duration": 60,
  "type": "meeting",
  "location": "Cuộc Gọi Video",
  "assignedUserId": "user-123"
}
```

**Phản hồi:** 201
```json
{
  "id": "apt-001",
  "contactId": "contact-001",
  "title": "Demo Sản Phẩm",
  "scheduledAt": "2026-06-10T14:00:00Z",
  "status": "scheduled",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 5.8 Liệt Kê Cuộc Hẹn
**GET** `/api/v1/appointments`

Liệt kê tất cả các cuộc hẹn.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `status` - Lọc: `scheduled`, `completed`, `cancelled`
- `contactId` - Lọc theo liên hệ
- `dateFrom` / `dateTo` - Phạm vi ngày

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "apt-001",
      "contactId": "contact-001",
      "contactName": "Nguyễn Văn A",
      "title": "Demo Sản Phẩm",
      "scheduledAt": "2026-06-10T14:00:00Z",
      "status": "scheduled",
      "createdAt": "2026-06-05T17:35:00Z"
    }
  ],
  "pagination": { "total": 25, "page": 1, "limit": 50 }
}
```

---

### 5.9 Thêm Ghi Chú cho Liên Hệ
**POST** `/api/v1/contacts/:id/notes`

Thêm ghi chú/bình luận cho liên hệ.

**Thân Yêu Cầu:**
```json
{
  "content": "Khách hàng quan tâm đến gói hàng năm. Theo dõi vào tuần tới."
}
```

**Phản hồi:** 201
```json
{
  "id": "note-002",
  "contactId": "contact-001",
  "content": "Khách hàng quan tâm đến gói hàng năm...",
  "createdBy": "user-123",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 6. Tự Động Hóa & Marketing

### 6.1 Liệt Kê Quy Tắc Tự Động Hóa
**GET** `/api/v1/automation/rules`

Liệt kê các quy trình tự động hóa.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `status` - Lọc: `draft`, `active`, `paused`
- `type` - Lọc theo loại quy tắc

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "rule-001",
      "name": "Chào Mừng Lead Mới",
      "description": "Gửi tin nhắn chào mừng cho lead mới",
      "type": "sequence",
      "trigger": {
        "type": "contact_created",
        "conditions": [{ "field": "source", "operator": "equals", "value": "zalo" }]
      },
      "actions": [
        {
          "type": "send_message",
          "template": "welcome_message"
        }
      ],
      "status": "active",
      "createdAt": "2026-05-01T10:00:00Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 50 }
}
```

---

### 6.2 Tạo Quy Tắc Tự Động Hóa
**POST** `/api/v1/automation/rules`

Tạo quy trình tự động hóa mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Cảnh Báo Lead Giá Trị Cao",
  "description": "Thông báo cho đội khi lead có giá trị cao được tạo",
  "type": "sequence",
  "trigger": {
    "type": "contact_created",
    "conditions": [
      { "field": "leadScore", "operator": "gte", "value": 80 }
    ]
  },
  "actions": [
    {
      "type": "send_notification",
      "template": "high_value_alert"
    },
    {
      "type": "assign_user",
      "userId": "user-125"
    }
  ]
}
```

**Phản hồi:** 201
```json
{
  "id": "rule-002",
  "name": "Cảnh Báo Lead Giá Trị Cao",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.3 Liệt Kê Mẫu Tin Nhắn
**GET** `/api/v1/automation/templates`

Liệt kê các mẫu tin nhắn đã lưu.

**Phản hồi:**
```json
[
  {
    "id": "tpl-001",
    "name": "Tin Nhắn Chào Mừng",
    "content": "Xin chào {{contactName}}, chào mừng đến dịch vụ của chúng tôi!",
    "category": "greeting",
    "variables": ["contactName"],
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 6.4 Tạo Mẫu Tin Nhắn
**POST** `/api/v1/automation/templates`

Tạo mẫu tin nhắn mới với các biến.

**Thân Yêu Cầu:**
```json
{
  "name": "Ưu Đãi Đặc Biệt",
  "content": "Xin chào {{contactName}}, chúng tôi có ưu đãi đặc biệt cho bạn: {{offerDetails}}",
  "category": "offer",
  "variables": ["contactName", "offerDetails"]
}
```

**Phản hồi:** 201
```json
{
  "id": "tpl-002",
  "name": "Ưu Đãi Đặc Biệt",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.5 Liệt Kê Danh Sách Khách Hàng
**GET** `/api/v1/customer-lists`

Liệt kê các phân đoạn khán giả.

**Phản hồi:**
```json
[
  {
    "id": "list-001",
    "name": "Lead Nóng - Tháng 6",
    "description": "Lead có điểm > 80",
    "contactCount": 150,
    "status": "active",
    "createdAt": "2026-06-01T10:00:00Z"
  }
]
```

---

### 6.6 Tạo Danh Sách Khách Hàng
**POST** `/api/v1/customer-lists`

Tạo khán giả/phân đoạn mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Khách Hàng VIP",
  "description": "Khách hàng có lịch sử mua hàng > 5000 USD",
  "criteria": {
    "filters": [
      { "field": "status", "operator": "equals", "value": "customer" },
      { "field": "leadScore", "operator": "gte", "value": 85 }
    ]
  }
}
```

**Phản hồi:** 201
```json
{
  "id": "list-002",
  "name": "Khách Hàng VIP",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

### 6.7 Liệt Kê Chiến Dịch
**GET** `/api/v1/campaigns`

Liệt kê các chiến dịch marketing.

**Phản hồi:**
```json
[
  {
    "id": "campaign-001",
    "name": "Khuyến Mãi Mùa Hè",
    "type": "email",
    "status": "active",
    "contactCount": 500,
    "sentCount": 350,
    "openRate": 0.42,
    "createdAt": "2026-06-01T10:00:00Z"
  }
]
```

---

### 6.8 Tạo Chiến Dịch
**POST** `/api/v1/campaigns`

Tạo chiến dịch marketing mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Chiến Dịch Bán Hàng Tháng 7",
  "description": "Thông báo bán hàng tháng 7 cho tất cả khách hàng",
  "type": "broadcast",
  "listId": "list-001",
  "templateId": "tpl-001",
  "schedule": "2026-07-01T08:00:00Z",
  "variables": {
    "discount": "30%"
  }
}
```

**Phản hồi:** 201
```json
{
  "id": "campaign-002",
  "name": "Chiến Dịch Bán Hàng Tháng 7",
  "status": "draft",
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 7. Phân Tích & Báo Cáo

### 7.1 Lấy Ph漏斗 Chuyển Đổi
**GET** `/api/v1/analytics/conversion-funnel`

Lấy số liệu ph漏斗 chuyển đổi.

**Tham Số Truy Vấn:**
- `dateFrom` - Ngày bắt đầu
- `dateTo` - Ngày kết thúc
- `groupBy` - Nhóm theo: `day`, `week`, `month`

**Phản hồi:**
```json
{
  "period": {
    "from": "2026-06-01T00:00:00Z",
    "to": "2026-06-05T23:59:59Z"
  },
  "stages": [
    {
      "name": "Lead",
      "count": 500,
      "percentage": 100
    },
    {
      "name": "Đã Xác Thực",
      "count": 350,
      "percentage": 70
    },
    {
      "name": "Đề Xuất",
      "count": 100,
      "percentage": 20
    },
    {
      "name": "Khách Hàng",
      "count": 35,
      "percentage": 7
    }
  ],
  "conversionRate": 0.07
}
```

---

### 7.2 Lấy Hiệu Suất Đội
**GET** `/api/v1/analytics/team-performance`

Lấy số liệu và thống kê đội.

**Tham Số Truy Vấn:**
- `dateFrom` - Ngày bắt đầu
- `dateTo` - Ngày kết thúc
- `departmentId` - Lọc theo phòng ban (tùy chọn)

**Phản hồi:**
```json
{
  "period": { "from": "2026-06-01", "to": "2026-06-05" },
  "team": [
    {
      "userId": "user-123",
      "name": "Nguyễn Văn A",
      "contactsAssigned": 45,
      "messagesReplied": 120,
      "averageResponseTime": 3.5,
      "conversionRate": 0.11,
      "revenueGenerated": 12500
    }
  ],
  "teamTotal": {
    "contactsAssigned": 450,
    "messagesReplied": 1200,
    "conversionRate": 0.08,
    "revenueGenerated": 95000
  }
}
```

---

### 7.3 Lấy Phân Tích Thời Gian Phản Hồi
**GET** `/api/v1/analytics/response-time`

Lấy số liệu thời gian phản hồi.

**Phản hồi:**
```json
{
  "averageFirstResponseTime": 4.2,
  "averageResolutionTime": 24.5,
  "medianResponseTime": 3.1,
  "percentile95": 15.2,
  "percentile99": 45.0,
  "onTimeRate": 0.87
}
```

---

### 7.4 Tạo Báo Cáo Tùy Chỉnh
**POST** `/api/v1/analytics/custom`

Tạo báo cáo phân tích tùy chỉnh.

**Thân Yêu Cầu:**
```json
{
  "name": "Báo Cáo Bán Hàng Q2",
  "metrics": ["revenue", "lead_count", "conversion_rate"],
  "dimensions": ["source", "assignedUser"],
  "dateFrom": "2026-04-01T00:00:00Z",
  "dateTo": "2026-06-30T23:59:59Z",
  "filters": [
    { "field": "status", "operator": "equals", "value": "customer" }
  ]
}
```

**Phản hồi:** 201
```json
{
  "id": "report-001",
  "name": "Báo Cáo Bán Hàng Q2",
  "status": "generating",
  "createdAt": "2026-06-05T17:35:00Z",
  "downloadUrl": "https://api.zalocrm.com/reports/report-001"
}
```

---

## 8. Đội & Tổ Chức

### 8.1 Liệt Kê Người Dùng
**GET** `/api/v1/users`

Liệt kê người dùng tổ chức.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `role` - Lọc theo vai trò
- `department` - Lọc theo phòng ban
- `status` - Lọc: `active`, `inactive`

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "user-123",
      "email": "a@acme.com",
      "fullName": "Nguyễn Văn A",
      "role": "admin",
      "department": "Bán Hàng",
      "phone": "+84.9.xxxx.xxxx",
      "avatar": "https://...",
      "status": "active",
      "createdAt": "2026-01-15T10:30:00Z",
      "lastLogin": "2026-06-05T14:22:00Z"
    }
  ],
  "pagination": { "total": 15, "page": 1, "limit": 50 }
}
```

---

### 8.2 Tạo Người Dùng
**POST** `/api/v1/users`

Tạo thành viên đội mới.

**Thân Yêu Cầu:**
```json
{
  "email": "jane@acme.com",
  "fullName": "Jane Smith",
  "role": "agent",
  "department": "Hỗ Trợ",
  "phone": "+84.9.yyyy.yyyy"
}
```

**Phản hồi:** 201
```json
{
  "id": "user-126",
  "email": "jane@acme.com",
  "fullName": "Jane Smith",
  "role": "agent",
  "createdAt": "2026-06-05T17:35:00Z",
  "invitationSent": true
}
```

---

### 8.3 Cập Nhật Người Dùng
**PUT** `/api/v1/users/:id`

Cập nhật thông tin người dùng.

**Thân Yêu Cầu:**
```json
{
  "fullName": "Jane Smith",
  "role": "team_lead",
  "department": "Bán Hàng"
}
```

**Phản hồi:** 200

---

### 8.4 Xóa Người Dùng
**DELETE** `/api/v1/users/:id`

Vô hiệu hóa người dùng.

**Phản hồi:** 204 Không Có Nội Dung

---

### 8.5 Liệt Kê Đội
**GET** `/api/v1/teams`

Liệt kê các đội trong tổ chức.

**Phản hồi:**
```json
[
  {
    "id": "team-001",
    "name": "Đội Bán Hàng",
    "description": "Đội bán hàng trực tiếp",
    "memberCount": 5,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 8.6 Tạo Đội
**POST** `/api/v1/teams`

Tạo đội mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Bán Hàng Doanh Nghiệp",
  "description": "Đội bán hàng cho khách hàng doanh nghiệp",
  "memberIds": ["user-123", "user-124"]
}
```

**Phản hồi:** 201

---

## 9. Kiểm Soát Truy Cập Dựa Trên Vai Trò

### 9.1 Liệt Kê Phòng Ban
**GET** `/api/v1/departments`

Liệt kê các phòng ban tổ chức.

**Phản hồi:**
```json
[
  {
    "id": "dept-001",
    "name": "Bán Hàng",
    "description": "Phòng bán hàng",
    "memberCount": 8,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

---

### 9.2 Tạo Phòng Ban
**POST** `/api/v1/departments`

Tạo phòng ban mới.

**Thân Yêu Cầu:**
```json
{
  "name": "Marketing",
  "description": "Phòng marketing và chiến dịch"
}
```

**Phản hồi:** 201

---

## 10. Tìm Kiếm

### 10.1 Tìm Kiếm Toàn Cục
**GET** `/api/v1/search`

Thực hiện tìm kiếm toàn văn bản trên các liên hệ, tin nhắn, ghi chú.

**Tham Số Truy Vấn:**
- `q` - Truy vấn tìm kiếm (bắt buộc)
- `type` - Lọc loại: `contacts`, `messages`, `notes` (tùy chọn)
- `limit` - Giới hạn kết quả (mặc định: 20)

**Phản hồi:**
```json
{
  "results": [
    {
      "id": "contact-001",
      "type": "contact",
      "title": "Nguyễn Văn A",
      "subtitle": "a@example.com",
      "url": "/contacts/contact-001"
    },
    {
      "id": "msg-001",
      "type": "message",
      "title": "Xin chào từ Nguyễn Văn A",
      "subtitle": "trong cuộc trò chuyện với Zalo Chính Thức",
      "timestamp": "2026-06-05T16:45:00Z"
    }
  ]
}
```

---

## 11. Chấm Điểm & Quản Lý Lead

### 11.1 Lấy Cấu Hình Chấm Điểm
**GET** `/api/v1/scoring/config`

Lấy cài đặt chấm điểm lead.

**Phản hồi:**
```json
{
  "orgId": "org-123",
  "scoringModel": "weighted",
  "baseScore": 0,
  "maxScore": 100,
  "rules": [
    {
      "id": "rule-001",
      "name": "Tham Gia Tin Nhắn",
      "weight": 0.3,
      "factor": 5
    }
  ],
  "decayRate": 0.01,
  "decayInterval": "daily"
}
```

---

### 11.2 Liệt Kê Quy Tắc Chấm Điểm
**GET** `/api/v1/scoring/rules`

Liệt kê tất cả các quy tắc chấm điểm.

**Phản hồi:**
```json
[
  {
    "id": "rule-001",
    "name": "Tin Nhắn Nhận Được",
    "condition": "message_received",
    "points": 5,
    "weight": 0.3,
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 11.3 Lấy Điểm Liên Hệ
**GET** `/api/v1/contacts/:id/scores`

Lấy phân tích điểm chi tiết cho liên hệ.

**Phản hồi:**
```json
{
  "contactId": "contact-001",
  "totalScore": 85,
  "breakdown": [
    {
      "ruleName": "Tham Gia Tin Nhắn",
      "points": 35,
      "weight": 0.3
    },
    {
      "ruleName": "Tham Dự Cuộc Hẹn",
      "points": 25,
      "weight": 0.25
    }
  ],
  "lastUpdated": "2026-06-05T17:30:00Z"
}
```

---

## 12. Sự Tham Gia

### 12.1 Lấy Bản Đồ Nhiệt Tham Gia
**GET** `/api/v1/engagement/heatmap`

Lấy bản đồ nhiệt tham gia của đội.

**Tham Số Truy Vấn:**
- `dateFrom` - Ngày bắt đầu
- `dateTo` - Ngày kết thúc

**Phản hồi:**
```json
{
  "heatmap": [
    [0, 1, 2, 1, 3, 2, 1],
    [5, 6, 7, 8, 9, 10, 5],
    [15, 16, 17, 18, 19, 20, 15]
  ],
  "metadata": {
    "rows": ["00:00-08:00", "08:00-16:00", "16:00-24:00"],
    "columns": ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"]
  }
}
```

---

## 13. Hoạt Động & Dòng Thời Gian

### 13.1 Lấy Dòng Thời Gian Hoạt Động
**GET** `/api/v1/timeline`

Lấy dòng thời gian hoạt động tổ chức.

**Tham Số Truy Vấn:**
- `limit` - Số hoạt động (mặc định: 50)
- `offset` - Phần bù phân trang
- `type` - Lọc theo loại hoạt động

**Phản hồi:**
```json
{
  "activities": [
    {
      "id": "activity-001",
      "type": "contact_created",
      "actor": {
        "id": "user-123",
        "name": "Nguyễn Văn A"
      },
      "resource": {
        "type": "contact",
        "id": "contact-001",
        "title": "Nguyễn Văn A"
      },
      "description": "Tạo liên hệ mới",
      "timestamp": "2026-06-05T17:35:00Z"
    }
  ],
  "pagination": { "total": 1500, "limit": 50, "offset": 0 }
}
```

---

## 14. Thông Báo

### 14.1 Liệt Kê Thông Báo
**GET** `/api/v1/notifications`

Lấy thông báo người dùng.

**Tham Số Truy Vấn:**
- `page` - Số trang
- `limit` - Mục mỗi trang
- `unreadOnly` - Chỉ hiển thị chưa đọc (mặc định: false)

**Phản hồi:**
```json
{
  "data": [
    {
      "id": "notif-001",
      "type": "high_value_lead",
      "title": "Lead Giá Trị Cao Được Tạo",
      "message": "Nguyễn Văn A - Điểm: 95",
      "resourceId": "contact-001",
      "read": false,
      "createdAt": "2026-06-05T17:35:00Z"
    }
  ],
  "unreadCount": 5
}
```

---

### 14.2 Đánh Dấu Thông Báo Là Đã Đọc
**POST** `/api/v1/notifications/:id/read`

Đánh dấu thông báo là đã đọc.

**Phản hồi:** 200
```json
{
  "message": "Thông báo được đánh dấu là đã đọc"
}
```

---

## 15. Tích Hợp

### 15.1 Liệt Kê Tích Hợp
**GET** `/api/v1/integrations`

Liệt kê các tích hợp có sẵn.

**Phản hồi:**
```json
[
  {
    "id": "int-001",
    "type": "facebook",
    "name": "Quảng Cáo Lead Facebook",
    "status": "connected",
    "config": {
      "pageId": "123456789",
      "formCount": 3
    },
    "lastSync": "2026-06-05T17:30:00Z"
  }
]
```

---

### 15.2 Facebook - Lấy Trang
**GET** `/api/v1/integrations/facebook/pages`

Liệt kê các trang Facebook được kết nối.

**Phản hồi:**
```json
[
  {
    "id": "page-001",
    "name": "Acme Business",
    "followers": 5000,
    "connected": true,
    "formCount": 2
  }
]
```

---

### 15.3 Facebook - Đồng Bộ Lead
**POST** `/api/v1/integrations/facebook/leads/sync`

Đồng bộ lead Facebook theo cách thủ công.

**Thân Yêu Cầu:**
```json
{
  "pageId": "page-001",
  "formId": "form-001"
}
```

**Phản hồi:** 202
```json
{
  "syncId": "sync-001",
  "status": "processing",
  "estimatedCount": 50
}
```

---

## 16. AI & Trợ Lý

### 16.1 Tạo Bản Nháp Phản Hồi
**POST** `/api/v1/ai/reply-draft`

Tạo phản hồi do AI hỗ trợ cho tin nhắn.

**Thân Yêu Cầu:**
```json
{
  "conversationId": "conv-001",
  "messageId": "msg-001",
  "tone": "professional"
}
```

**Phản hồi:**
```json
{
  "draft": "Cảm ơn bạn đã hỏi! Chúng tôi rất vui được giúp bạn với...",
  "confidence": 0.87
}
```

---

### 16.2 Tạo Tóm Tắt
**POST** `/api/v1/ai/summary`

Tạo tóm tắt AI cho cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "conversationId": "conv-001"
}
```

**Phản hồi:**
```json
{
  "summary": "Khách hàng hỏi về giá gói premium. Quan tâm đến so sánh tính năng với các đối thủ cạnh tranh.",
  "keyPoints": [
    "Quan tâm đến gói premium",
    "Muốn so sánh tính năng",
    "Ngân sách khoảng 500 USD/tháng"
  ]
}
```

---

### 16.3 Phân Tích Cảm Xúc
**POST** `/api/v1/ai/sentiment`

Phân tích cảm xúc của tin nhắn/cuộc trò chuyện.

**Thân Yêu Cầu:**
```json
{
  "text": "Tôi thực sự hài lòng với dịch vụ của bạn! Đội hỗ trợ rất tuyệt vời."
}
```

**Phản hồi:**
```json
{
  "sentiment": "positive",
  "score": 0.92,
  "emotions": ["happy", "satisfied"]
}
```

---

## 17. Thương Hiệu

### 17.1 Lấy Cài Đặt Thương Hiệu
**GET** `/api/v1/branding`

Lấy cấu hình thương hiệu tổ chức.

**Phản hồi:**
```json
{
  "logo": "https://...",
  "faviconUrl": "https://...",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FFC107",
  "companyName": "Acme Corporation"
}
```

---

### 17.2 Cập Nhật Thương Hiệu
**PUT** `/api/v1/branding`

Cập nhật cài đặt thương hiệu.

**Thân Yêu Cầu:**
```json
{
  "primaryColor": "#FF5722",
  "secondaryColor": "#2196F3"
}
```

**Phản hồi:** 200

---

## 18. Bảo Mật & Quyền Riêng Tư

### 18.1 Đặt PIN Quyền Riêng Tư
**POST** `/api/v1/privacy/pin/set`

Đặt PIN quyền riêng tư để truy cập dữ liệu nhạy cảm.

**Thân Yêu Cầu:**
```json
{
  "pin": "123456"
}
```

**Phản hồi:**
```json
{
  "message": "PIN quyền riêng tư được đặt thành công"
}
```

---

### 18.2 Xác Minh PIN Quyền Riêng Tư
**POST** `/api/v1/privacy/pin/verify`

Xác minh PIN quyền riêng tư trước khi truy cập dữ liệu nhạy cảm.

**Thân Yêu Cầu:**
```json
{
  "pin": "123456"
}
```

**Phản hồi:**
```json
{
  "verified": true,
  "expiresIn": 3600
}
```

---

## 19. API Công Khai & Webhook

### 19.1 Liệt Kê Cài Đặt Webhook
**GET** `/api/v1/webhook-settings`

Liệt kê các webhook được cấu hình.

**Phản hồi:**
```json
[
  {
    "id": "webhook-001",
    "url": "https://your-app.com/webhooks/zalocrm",
    "events": ["contact.created", "message.received"],
    "active": true,
    "createdAt": "2026-05-01T10:00:00Z"
  }
]
```

---

### 19.2 Tạo Webhook
**POST** `/api/v1/webhook-settings`

Tạo webhook mới.

**Thân Yêu Cầu:**
```json
{
  "url": "https://your-app.com/webhooks/contacts",
  "events": ["contact.created", "contact.updated"],
  "secret": "your-webhook-secret"
}
```

**Phản hồi:** 201
```json
{
  "id": "webhook-002",
  "url": "https://your-app.com/webhooks/contacts",
  "active": true,
  "createdAt": "2026-06-05T17:35:00Z"
}
```

---

## 20. Hệ Thống

### 20.1 Kiểm Tra Sức Khỏe
**GET** `/health`

Kiểm tra sức khỏe hệ thống.

**Phản hồi:**
```json
{
  "status": "ok",
  "db": "connected",
  "timestamp": "2026-06-05T17:35:00Z"
}
```

---

### 20.2 Trạng Thái API
**GET** `/api/v1/status`

Lấy phiên bản API và trạng thái.

**Phản hồi:**
```json
{
  "version": "1.0.0",
  "name": "Zalo CRM",
  "status": "operational"
}
```

---


---

## 21. API Công Khai REST (External API — `X-API-Key`)

API REST dành cho **tích hợp bên ngoài**, xác thực bằng **API key** (không cần JWT). Mọi endpoint có tiền tố `/api/public/`. `orgId` được suy ra tự động từ API key.

### Xác thực

Gửi API key qua header:

```
X-API-Key: <api_key_cua_ban>
```

> Lấy/khởi tạo API key tại **Cài đặt → API & Webhook** (hoặc `POST /api/v1/settings/api-key/generate`). Thiếu hoặc sai key → `401`.

### 21.1 Liệt Kê Liên Hệ
**GET** `/api/public/contacts`

**Tham số truy vấn:** `search` (tìm theo tên/SĐT/email), `status`, `limit` (mặc định 20, tối đa 100).

**Phản hồi:**
```json
{
  "contacts": [
    {
      "id": "contact-123",
      "fullName": "Nguyễn Văn A",
      "phone": "0900000000",
      "email": "a@acme.com",
      "source": "facebook",
      "status": "new",
      "notes": "Quan tâm gói Pro",
      "tags": ["vip"],
      "createdAt": "2026-06-01T03:00:00.000Z",
      "updatedAt": "2026-06-10T07:30:00.000Z"
    }
  ]
}
```

### 21.2 Lấy Chi Tiết Liên Hệ
**GET** `/api/public/contacts/:id`

Trả về liên hệ kèm **5 lịch hẹn gần nhất** và số lượng hội thoại. `404` nếu không tìm thấy.

### 21.3 Tạo Liên Hệ
**POST** `/api/public/contacts`

**Thân yêu cầu:** (cần ít nhất `fullName` **hoặc** `phone`)
```json
{
  "fullName": "Nguyễn Văn A",
  "phone": "0900000000",
  "email": "a@acme.com",
  "source": "website",
  "status": "new",
  "notes": "Đăng ký từ landing",
  "tags": ["lead"]
}
```
**Mã trạng thái:** `201` (tạo thành công), `400` (thiếu fullName & phone).

### 21.4 Cập Nhật Liên Hệ
**PUT** `/api/public/contacts/:id`

Thân yêu cầu giống 21.3 (các trường gửi lên sẽ được cập nhật). `404` nếu không tìm thấy.

### 21.5 Liệt Kê Hội Thoại
**GET** `/api/public/conversations`

**Tham số truy vấn:** `limit` (mặc định 20, tối đa 100).

**Phản hồi:**
```json
{
  "conversations": [
    {
      "id": "conv-123",
      "threadType": "user",
      "externalThreadId": "zalo-uid-xxx",
      "lastMessageAt": "2026-06-10T07:30:00.000Z",
      "unreadCount": 2,
      "isReplied": false,
      "contact": { "id": "contact-123", "fullName": "Nguyễn Văn A", "phone": "0900000000", "avatarUrl": null }
    }
  ]
}
```

### 21.6 Lấy Tin Nhắn Của Hội Thoại
**GET** `/api/public/conversations/:id/messages`

**Tham số truy vấn:** `limit` (mặc định 50, tối đa 200). `404` nếu hội thoại không thuộc tổ chức.

**Phản hồi:**
```json
{
  "messages": [
    {
      "id": "msg-1",
      "senderType": "contact",
      "senderName": "Nguyễn Văn A",
      "content": "Cho mình hỏi giá",
      "contentType": "text",
      "sentAt": "2026-06-10T07:29:00.000Z",
      "attachments": []
    }
  ]
}
```

### 21.7 Liệt Kê Lịch Hẹn
**GET** `/api/public/appointments`

**Tham số truy vấn:** `from`, `to` (ISO date, lọc theo `appointmentDate`). Trả tối đa 100, kèm thông tin liên hệ.

### 21.8 Tạo Lịch Hẹn
**POST** `/api/public/appointments`

**Thân yêu cầu:** (cần `contactId` và `appointmentDate`)
```json
{
  "contactId": "contact-123",
  "appointmentDate": "2026-06-20",
  "appointmentTime": "14:30",
  "type": "call",
  "notes": "Gọi tư vấn gói Pro"
}
```
**Mã trạng thái:** `201`, `400` (thiếu trường), `404` (liên hệ không tồn tại).

### 21.9 Gửi Tin Nhắn Zalo
**POST** `/api/public/messages/send`

Gửi tin nhắn qua một **nick Zalo đang kết nối** của tổ chức.

**Thân yêu cầu:** (cần `zaloAccountId`, `threadId`, `content`)
```json
{
  "zaloAccountId": "zalo-acc-123",
  "threadId": "zalo-uid-hoac-group-id",
  "content": "Xin chào, ZaloCRM đây!",
  "threadType": "user"
}
```
- `threadType`: `"user"` (mặc định) hoặc `"group"`.

**Phản hồi:** `{ "success": true }`

**Mã trạng thái:** `200`, `400` (thiếu trường), `404` (nick không tồn tại), `422` (nick chưa kết nối / không hoạt động trong pool).

---

## 22. Phụ Lục A — Danh Mục Đầy Đủ Endpoint (JWT nội bộ)

> Bổ sung danh mục tham chiếu đầy đủ các endpoint **nội bộ** (xác thực JWT `Authorization: Bearer`). Các endpoint chi tiết (có ví dụ request/response) nằm ở các mục 1–20 phía trên; bảng dưới liệt kê **toàn bộ endpoint còn lại** theo nhóm.


### AI & Trợ lý

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/ai/assistant-config` | Lấy — assistant config |
| `GET` | `/api/v1/ai/config` | Lấy — config |
| `PUT` | `/api/v1/ai/config` | Cập nhật — config |
| `POST` | `/api/v1/ai/format-rich` | Tạo/Thực thi — format rich |
| `GET` | `/api/v1/ai/providers` | Lấy — providers |
| `POST` | `/api/v1/ai/sales-handoff-message` | Tạo/Thực thi — sales handoff message |
| `POST` | `/api/v1/ai/sentiment/:id` | Tạo/Thực thi — theo ID |
| `POST` | `/api/v1/ai/suggest` | Tạo/Thực thi — suggest |
| `POST` | `/api/v1/ai/summarize/:id` | Tạo/Thực thi — theo ID |
| `GET` | `/api/v1/ai/usage` | Lấy — usage |

### Báo cáo

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/reports/appointments` | Lấy — appointments |
| `GET` | `/api/v1/reports/contacts` | Lấy — contacts |
| `GET` | `/api/v1/reports/export` | Lấy — export |
| `GET` | `/api/v1/reports/messages` | Lấy — messages |

### Báo cáo đã lưu

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/saved-reports` | Lấy — saved reports |
| `POST` | `/api/v1/saved-reports` | Tạo/Thực thi — saved reports |
| `DELETE` | `/api/v1/saved-reports/:id` | Xoá — theo ID |
| `GET` | `/api/v1/saved-reports/:id` | Lấy — theo ID |
| `PUT` | `/api/v1/saved-reports/:id` | Cập nhật — theo ID |
| `POST` | `/api/v1/saved-reports/:id/run` | Tạo/Thực thi — run |

### Bạn bè (DB)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/friends-db/all-nicks` | Lấy — all nicks |

### Bạn bè Zalo

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/friends/:friendId/zalo-label` | Tạo/Thực thi — zalo label |
| `PATCH` | `/api/v1/friends/:id` | Cập nhật — theo ID |
| `POST` | `/api/v1/friends/:id/ensure-conversation` | Tạo/Thực thi — ensure conversation |
| `POST` | `/api/v1/friends/:id/promote-to-parent` | Tạo/Thực thi — promote to parent |

### Bể Lead (Lead Pool)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/lead-pool/:id/find-zalo` | Tạo/Thực thi — find zalo |
| `POST` | `/api/v1/lead-pool/:id/note` | Tạo/Thực thi — note |
| `POST` | `/api/v1/lead-pool/:id/open-chat` | Tạo/Thực thi — open chat |
| `GET` | `/api/v1/lead-pool/:id/payload` | Lấy — payload |
| `POST` | `/api/v1/lead-pool/:id/return` | Tạo/Thực thi — return |
| `GET` | `/api/v1/lead-pool/available-nicks` | Lấy — available nicks |
| `GET` | `/api/v1/lead-pool/eligibility` | Lấy — eligibility |
| `GET` | `/api/v1/lead-pool/my-history` | Lấy — my history |
| `POST` | `/api/v1/lead-pool/request` | Tạo/Thực thi — request |
| `GET` | `/api/v1/lead-pool/stats` | Lấy — stats |

### Bộ lọc lưu sẵn

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/filter-presets` | Lấy — filter presets |
| `POST` | `/api/v1/filter-presets` | Tạo/Thực thi — filter presets |

### Chat

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/chat/send-handoff` | Tạo/Thực thi — send handoff |

### Chấm điểm Lead

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `PUT` | `/api/v1/scoring/config` | Cập nhật — config |
| `GET` | `/api/v1/scoring/nba-templates` | Lấy — nba templates |
| `GET` | `/api/v1/scoring/stage-transitions` | Lấy — stage transitions |
| `GET` | `/api/v1/scoring/stuck-thresholds` | Lấy — stuck thresholds |

### Cài đặt (API key/Trạng thái/Webhook)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/settings/api-key` | Lấy — api key |
| `POST` | `/api/v1/settings/api-key/generate` | Tạo/Thực thi — generate |
| `GET` | `/api/v1/settings/statuses` | Lấy — statuses |
| `POST` | `/api/v1/settings/statuses` | Tạo/Thực thi — statuses |
| `DELETE` | `/api/v1/settings/statuses/:id` | Xoá — theo ID |
| `PUT` | `/api/v1/settings/statuses/:id` | Cập nhật — theo ID |
| `POST` | `/api/v1/settings/statuses/reorder` | Tạo/Thực thi — reorder |
| `GET` | `/api/v1/settings/webhook` | Lấy — webhook |
| `PUT` | `/api/v1/settings/webhook` | Cập nhật — webhook |
| `POST` | `/api/v1/settings/webhook/test` | Tạo/Thực thi — test |

### Dashboard

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/dashboard/action-hub/me` | Lấy — me |
| `GET` | `/api/v1/dashboard/action-hub/picker/depts` | Lấy — depts |
| `GET` | `/api/v1/dashboard/action-hub/picker/users` | Lấy — users |
| `GET` | `/api/v1/dashboard/action-hub/system` | Lấy — system |
| `GET` | `/api/v1/dashboard/action-hub/team` | Lấy — team |
| `GET` | `/api/v1/dashboard/appointments` | Lấy — appointments |
| `GET` | `/api/v1/dashboard/kpi` | Lấy — kpi |
| `GET` | `/api/v1/dashboard/message-volume` | Lấy — message volume |
| `GET` | `/api/v1/dashboard/pipeline` | Lấy — pipeline |
| `GET` | `/api/v1/dashboard/sources` | Lấy — sources |

### Dòng thời gian

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/timeline/export` | Lấy — export |

### Ghi chú

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `DELETE` | `/api/v1/notes/:id` | Xoá — theo ID |
| `PATCH` | `/api/v1/notes/:id` | Cập nhật — theo ID |
| `POST` | `/api/v1/notes/:id/ai-parse` | Tạo/Thực thi — ai parse |
| `POST` | `/api/v1/notes/:id/link-appointment` | Tạo/Thực thi — link appointment |
| `POST` | `/api/v1/notes/:id/reactions` | Tạo/Thực thi — reactions |

### Hội thoại & Tin nhắn

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `DELETE` | `/api/v1/conversations/:id` | Xoá — theo ID |
| `POST` | `/api/v1/conversations/:id/card` | Tạo/Thực thi — card |
| `POST` | `/api/v1/conversations/:id/forward` | Tạo/Thực thi — forward |
| `POST` | `/api/v1/conversations/:id/link` | Tạo/Thực thi — link |
| `POST` | `/api/v1/conversations/:id/mark-read` | Tạo/Thực thi — mark read |
| `GET` | `/api/v1/conversations/:id/messages` | Lấy — messages |
| `DELETE` | `/api/v1/conversations/:id/messages/:msgId` | Xoá — theo ID |
| `POST` | `/api/v1/conversations/:id/messages/:msgId/edit` | Tạo/Thực thi — edit |
| `POST` | `/api/v1/conversations/:id/messages/:msgId/undo` | Tạo/Thực thi — undo |
| `POST` | `/api/v1/conversations/:id/pin` | Tạo/Thực thi — pin |
| `DELETE` | `/api/v1/conversations/:id/reactions` | Xoá — reactions |
| `POST` | `/api/v1/conversations/:id/reactions` | Tạo/Thực thi — reactions |
| `POST` | `/api/v1/conversations/:id/restore` | Tạo/Thực thi — restore |
| `POST` | `/api/v1/conversations/:id/send-block` | Tạo/Thực thi — send block |
| `POST` | `/api/v1/conversations/:id/sticker` | Tạo/Thực thi — sticker |
| `PATCH` | `/api/v1/conversations/:id/tab` | Cập nhật — tab |
| `POST` | `/api/v1/conversations/:id/touch-profile` | Tạo/Thực thi — touch profile |
| `POST` | `/api/v1/conversations/:id/typing` | Tạo/Thực thi — typing |
| `POST` | `/api/v1/conversations/:id/unpin` | Tạo/Thực thi — unpin |
| `POST` | `/api/v1/conversations/:id/upload-image` | Tạo/Thực thi — upload image |
| `POST` | `/api/v1/conversations/ensure-by-uid` | Tạo/Thực thi — ensure by uid |
| `GET` | `/api/v1/conversations/event-counts` | Lấy — event counts |
| `GET` | `/api/v1/conversations/sidebar-tags` | Lấy — sidebar tags |

### Khách hàng (timeline/log)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/customers/:id/activity-log` | Lấy — activity log |
| `GET` | `/api/v1/customers/:id/timeline` | Lấy — timeline |

### Lead kẹt

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/leads/stuck` | Lấy — stuck |
| `POST` | `/api/v1/leads/stuck/scan` | Tạo/Thực thi — scan |

### Liên hệ & CRM

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/contacts/:contactId/notes` | Lấy — notes |
| `GET` | `/api/v1/contacts/:id/appointments` | Lấy — appointments |
| `GET` | `/api/v1/contacts/:id/cockpit` | Lấy — cockpit |
| `GET` | `/api/v1/contacts/:id/engagement-timeline` | Lấy — engagement timeline |
| `GET` | `/api/v1/contacts/:id/friendships` | Lấy — friendships |
| `POST` | `/api/v1/contacts/:id/link-parent` | Tạo/Thực thi — link parent |
| `POST` | `/api/v1/contacts/:id/merge-into` | Tạo/Thực thi — merge into |
| `PUT` | `/api/v1/contacts/:id/tags` | Cập nhật — tags |
| `GET` | `/api/v1/contacts/:id/teammates` | Lấy — teammates |
| `POST` | `/api/v1/contacts/:id/unlink-parent` | Tạo/Thực thi — unlink parent |
| `POST` | `/api/v1/contacts/:id/virtual-conversation` | Tạo/Thực thi — virtual conversation |
| `GET` | `/api/v1/contacts/by-zalo-uid/:uid` | Lấy — theo ID |
| `GET` | `/api/v1/contacts/duplicates` | Lấy — duplicates |
| `POST` | `/api/v1/contacts/duplicates/:groupId/dismiss` | Tạo/Thực thi — dismiss |
| `POST` | `/api/v1/contacts/duplicates/:groupId/merge` | Tạo/Thực thi — merge |
| `POST` | `/api/v1/contacts/intelligence/recompute` | Tạo/Thực thi — recompute |
| `GET` | `/api/v1/contacts/parent-candidates` | Lấy — parent candidates |
| `POST` | `/api/v1/contacts/parent-candidates/:id/accept` | Tạo/Thực thi — accept |
| `POST` | `/api/v1/contacts/parent-candidates/:id/dismiss` | Tạo/Thực thi — dismiss |
| `GET` | `/api/v1/contacts/pipeline` | Lấy — pipeline |
| `POST` | `/api/v1/contacts/quick-create` | Tạo/Thực thi — quick create |
| `POST` | `/api/v1/contacts/resolve-by-keys` | Tạo/Thực thi — resolve by keys |
| `GET` | `/api/v1/contacts/stats` | Lấy — stats |

### Lịch hẹn

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `DELETE` | `/api/v1/appointments/:id` | Xoá — theo ID |
| `GET` | `/api/v1/appointments/:id` | Lấy — theo ID |
| `PUT` | `/api/v1/appointments/:id` | Cập nhật — theo ID |
| `PATCH` | `/api/v1/appointments/:id/status` | Cập nhật — status |
| `GET` | `/api/v1/appointments/today` | Lấy — today |
| `GET` | `/api/v1/appointments/upcoming` | Lấy — upcoming |

### Người dùng

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/users/:id/handoff` | Tạo/Thực thi — handoff |
| `PATCH` | `/api/v1/users/:id/max-privacy-nicks` | Cập nhật — max privacy nicks |
| `PUT` | `/api/v1/users/:id/password` | Cập nhật — password |
| `POST` | `/api/v1/users/bulk-assign` | Tạo/Thực thi — bulk assign |

### Nhóm quyền (RBAC)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/permission-groups` | Lấy — permission groups |
| `POST` | `/api/v1/permission-groups` | Tạo/Thực thi — permission groups |
| `DELETE` | `/api/v1/permission-groups/:id` | Xoá — theo ID |
| `GET` | `/api/v1/permission-groups/:id` | Lấy — theo ID |
| `PATCH` | `/api/v1/permission-groups/:id` | Cập nhật — theo ID |
| `GET` | `/api/v1/permission-groups/meta` | Lấy — meta |

### Nhóm thẻ CRM

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/crm-tag-groups` | Lấy — crm tag groups |
| `POST` | `/api/v1/crm-tag-groups` | Tạo/Thực thi — crm tag groups |
| `DELETE` | `/api/v1/crm-tag-groups/:id` | Xoá — theo ID |
| `PATCH` | `/api/v1/crm-tag-groups/:id` | Cập nhật — theo ID |

### Nhật ký kiểm toán

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/audit-logs` | Lấy — audit logs |

### Phòng ban (RBAC)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `DELETE` | `/api/v1/departments/:id` | Xoá — theo ID |
| `PATCH` | `/api/v1/departments/:id` | Cập nhật — theo ID |
| `POST` | `/api/v1/departments/:id/members` | Tạo/Thực thi — members |
| `GET` | `/api/v1/departments/:id/members-tree` | Lấy — members tree |
| `DELETE` | `/api/v1/departments/:id/members/:userId` | Xoá — theo ID |

### Public org branding

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/public/org-branding` | Lấy — org branding |

### Quyền riêng tư & PIN/OTP

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/privacy/lock` | Tạo/Thực thi — lock |
| `GET` | `/api/v1/privacy/my-nicks` | Lấy — my nicks |
| `POST` | `/api/v1/privacy/otp/request` | Tạo/Thực thi — request |
| `GET` | `/api/v1/privacy/otp/status` | Lấy — status |
| `POST` | `/api/v1/privacy/otp/verify` | Tạo/Thực thi — verify |
| `GET` | `/api/v1/privacy/status` | Lấy — status |

### RBAC người dùng

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/rbac/users` | Lấy — users |
| `PATCH` | `/api/v1/rbac/users/:id/permission-group` | Cập nhật — permission group |

### Thông tin user Zalo

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/zalo-user-info/:uid` | Lấy — theo ID |
| `POST` | `/api/v1/zalo-user-info/batch` | Tạo/Thực thi — batch |

### Thư mục tài khoản Zalo

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/account-folders` | Lấy — account folders |
| `POST` | `/api/v1/account-folders` | Tạo/Thực thi — account folders |
| `POST` | `/api/v1/account-folders/reorder` | Tạo/Thực thi — reorder |
| `POST` | `/api/v1/account-folders/sync-by-owner` | Tạo/Thực thi — sync by owner |

### Thẻ CRM

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/crm-tags` | Lấy — crm tags |
| `POST` | `/api/v1/crm-tags` | Tạo/Thực thi — crm tags |
| `DELETE` | `/api/v1/crm-tags/:id` | Xoá — theo ID |
| `PATCH` | `/api/v1/crm-tags/:id` | Cập nhật — theo ID |
| `POST` | `/api/v1/crm-tags/reorder` | Tạo/Thực thi — reorder |

### Tin nhắn

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/messages/:id` | Lấy — theo ID |

### Tài khoản của tôi

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/me/avatar` | Tạo/Thực thi — avatar |
| `GET` | `/api/v1/me/blocks/recent` | Lấy — recent |
| `POST` | `/api/v1/me/change-password` | Tạo/Thực thi — change password |
| `GET` | `/api/v1/me/internal-contact` | Lấy — internal contact |
| `GET` | `/api/v1/me/onboarding` | Lấy — onboarding |
| `POST` | `/api/v1/me/onboarding/dismiss` | Tạo/Thực thi — dismiss |
| `POST` | `/api/v1/me/onboarding/reopen` | Tạo/Thực thi — reopen |
| `POST` | `/api/v1/me/onboarding/skip-step` | Tạo/Thực thi — skip step |
| `GET` | `/api/v1/me/preferences` | Lấy — preferences |
| `DELETE` | `/api/v1/me/preferences/:key` | Xoá — theo ID |
| `GET` | `/api/v1/me/preferences/:key` | Lấy — theo ID |
| `PUT` | `/api/v1/me/preferences/:key` | Cập nhật — theo ID |
| `PATCH` | `/api/v1/me/profile` | Cập nhật — profile |

### Tài khoản Zalo (nâng cao)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/zalo-accounts/:accountId/groups/:groupId/ensure-conversation` | Tạo/Thực thi — ensure conversation |
| `GET` | `/api/v1/zalo-accounts/:id/access` | Lấy — access |
| `GET` | `/api/v1/zalo-accounts/:id/labels` | Lấy — labels |
| `PATCH` | `/api/v1/zalo-accounts/:id/labels/:labelId` | Cập nhật — theo ID |
| `POST` | `/api/v1/zalo-accounts/:id/labels/assign-thread` | Tạo/Thực thi — assign thread |
| `POST` | `/api/v1/zalo-accounts/:id/labels/sync` | Tạo/Thực thi — sync |
| `POST` | `/api/v1/zalo-accounts/:id/labels/touch` | Tạo/Thực thi — touch |
| `PATCH` | `/api/v1/zalo-accounts/:id/privacy-mode` | Cập nhật — privacy mode |
| `POST` | `/api/v1/zalo-accounts/:id/sync-contacts` | Tạo/Thực thi — sync contacts |
| `POST` | `/api/v1/zalo-accounts/:id/sync-history` | Tạo/Thực thi — sync history |
| `GET` | `/api/v1/zalo-accounts/enriched` | Lấy — enriched |
| `GET` | `/api/v1/zalo-accounts/labels-overview` | Lấy — labels overview |
| `GET` | `/api/v1/zalo-accounts/sdk-limits` | Lấy — sdk limits |
| `GET` | `/api/v1/zalo-accounts/stats` | Lấy — stats |
| `GET` | `/zalo-accounts` | Lấy — zalo accounts |

### Tích hợp & Facebook

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/integrations` | Tạo/Thực thi — integrations |
| `DELETE` | `/api/v1/integrations/:id` | Xoá — theo ID |
| `PUT` | `/api/v1/integrations/:id` | Cập nhật — theo ID |
| `GET` | `/api/v1/integrations/:id/logs` | Lấy — logs |
| `POST` | `/api/v1/integrations/:id/sync` | Tạo/Thực thi — sync |
| `DELETE` | `/api/v1/integrations/facebook/:id` | Xoá — theo ID |
| `POST` | `/api/v1/integrations/facebook/:id/rotate-verify-token` | Tạo/Thực thi — rotate verify token |
| `GET` | `/api/v1/integrations/facebook/:id/verify-token` | Lấy — verify token |
| `POST` | `/api/v1/integrations/facebook/connect` | Tạo/Thực thi — connect |
| `PATCH` | `/api/v1/integrations/facebook/pull-config` | Cập nhật — pull config |
| `GET` | `/api/v1/integrations/facebook/pull-status` | Lấy — pull status |
| `GET` | `/api/v1/integrations/facebook/status` | Lấy — status |
| `POST` | `/api/v1/integrations/facebook/system-user-token` | Tạo/Thực thi — system user token |

### Tổ chức

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/organization` | Lấy — organization |
| `GET` | `/api/v1/organization/automation-settings` | Lấy — automation settings |

### Tự động hoá

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `DELETE` | `/api/v1/automation/rules/:id` | Xoá — theo ID |
| `PUT` | `/api/v1/automation/rules/:id` | Cập nhật — theo ID |
| `DELETE` | `/api/v1/automation/templates/:id` | Xoá — theo ID |
| `PUT` | `/api/v1/automation/templates/:id` | Cập nhật — theo ID |
| `POST` | `/api/v1/automation/templates/:id/track-use` | Tạo/Thực thi — track use |
| `GET` | `/api/v1/automation/templates/variables` | Lấy — variables |

### Webhook công khai

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/webhooks/fb-leadads` | Lấy — fb leadads |
| `POST` | `/api/v1/webhooks/fb-leadads` | Tạo/Thực thi — fb leadads |

### Zalo Bank Card

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/zalo-bankcard` | Lấy — zalo bankcard |

### Zalo Sticker

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/zalo-sticker/:catId/:id` | Lấy — theo ID |

### Zalo Sticker

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/zalo-sticker-list` | Lấy — zalo sticker list |

### Đội

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/v1/teams/:id/members` | Lấy — members |

### ⚙️ Quản trị / Bảo trì (nội bộ — không khuyến nghị gọi từ tích hợp ngoài)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/v1/admin/engagement/backfill` | Tạo/Thực thi — backfill |
| `POST` | `/api/v1/admin/engagement/recompute` | Tạo/Thực thi — recompute |
| `POST` | `/api/v1/admin/migrate-status-table` | Tạo/Thực thi — migrate status table |
| `GET` | `/api/v1/admin/privacy/audit` | Lấy — audit |
| `POST` | `/api/v1/admin/privacy/reset-lock/:userId` | Tạo/Thực thi — theo ID |
| `POST` | `/api/v1/admin/rbac/create-test-users` | Tạo/Thực thi — create test users |
| `POST` | `/api/v1/admin/rbac/migrate-legacy-users` | Tạo/Thực thi — migrate legacy users |
| `POST` | `/api/v1/admin/rbac/seed-default-groups` | Tạo/Thực thi — seed default groups |
| `POST` | `/api/v1/admin/run-detector` | Tạo/Thực thi — run detector |
| `POST` | `/api/v1/contacts/backfill-friend-display-name` | Tạo/Thực thi — backfill friend display name |
| `POST` | `/api/v1/contacts/backfill-global-id` | Tạo/Thực thi — backfill global id |
| `POST` | `/api/v1/contacts/backfill-missing-friends` | Tạo/Thực thi — backfill missing friends |
| `POST` | `/api/v1/contacts/backfill-orphan-friends` | Tạo/Thực thi — backfill orphan friends |
| `POST` | `/api/v1/lead-pool/admin/reset-quota` | Tạo/Thực thi — reset quota |
| `GET` | `/api/v1/lead-pool/admin/sale-noted-leads` | Lấy — sale noted leads |
| `POST` | `/api/v1/scoring/recompute-all` | Tạo/Thực thi — recompute all |
| `POST` | `/api/v1/scoring/seed-defaults` | Tạo/Thực thi — seed defaults |

## Sự Kiện WebSocket

### Kết Nối
```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Đã kết nối với máy chủ');
});
```

### Đăng Ký Phòng
```javascript
// Đăng ký sự kiện tài khoản
socket.emit('subscribe', { room: 'account:acc-001' });

// Nghe mã QR
socket.on('account:qr', (data) => {
  console.log('Mã QR:', data.qr);
  displayQRCode(data.qr);
});

// Nghe đăng nhập
socket.on('account:login', (data) => {
  console.log('Tài khoản đã đăng nhập:', data);
});
```

### Sự Kiện Tin Nhắn
```javascript
// Nghe tin nhắn mới
socket.on('message:received', (data) => {
  console.log('Tin nhắn mới:', data);
});

// Nghe chỉ báo đang nhập
socket.on('chat:typing', (data) => {
  console.log(data.senderName + ' đang nhập...');
});
```

---

## Mã Lỗi

| Mã | Ý Nghĩa |
|------|---------|
| 200 | OK |
| 201 | Đã Tạo |
| 202 | Đã Chấp Nhận |
| 204 | Không Có Nội Dung |
| 400 | Yêu Cầu Không Hợp Lệ |
| 401 | Chưa Xác Thực |
| 403 | Cấm Truy Cập |
| 404 | Không Tìm Thấy |
| 409 | Xung Đột |
| 422 | Không Thể Xử Lý Thực Thể |
| 429 | Quá Nhiều Yêu Cầu |
| 500 | Lỗi Máy Chủ Nội Bộ |
| 502 | Gateway Tồi |
| 503 | Dịch Vụ Không Khả Dụng |

---

## Liên Kết Hữu Ích

- **Kho GitHub:** https://github.com/locphamnguyen/zalo-crm
- **Theo Dõi Vấn Đề:** https://github.com/locphamnguyen/zalo-crm/issues
- **Thảo Luận:** https://github.com/locphamnguyen/zalo-crm/discussions

---

*Được tạo vào ngày 2026-06-05 | Phiên bản 1.0.0*
