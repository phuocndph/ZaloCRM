# Ket noi Hermes cho nghien cuu khach hang

## Da xay trong ZCRM

- Tao dot tim hieu voi `executor: hermes`, khong can model hoac Serper trong ZCRM.
- Hermes lay viec bang API key ZCRM hien co; chi thay viec trong cung to chuc.
- Nhan nguon, tong hop noi dau, viet nhap; duyet van thuc hien trong giao dien ZCRM.
- Nhan viec co ma rieng, het han sau 120 giay neu khong bao tien do; moi viec
  toi da 15 phut, tu dong nhan lai toi da 3 lan. Nguoi dung co the dung/chay lai.
- Trich dan phai khop nguyen van nguon. Bai viet chi duoc tao tu van de da duyet.
- Moi ket qua bat dau la ban nhap. Hermes khong co API duyet trong bo nay.

## Can cai tren may chu Hermes

Neu ban ZCRM da co Ket noi Agent rieng, uu tien dung `ZALOCRM_URL` va
`ZALOCRM_AGENT_KEY` dang dung, bat them quyen `research_execute` cho ket noi do
va quyen `ai_knowledge.edit` cho nhan vien dai dien. Quyen nay khong tu bat.
Xem `ZCRM_HERMES_GITHUB_DEPLOY.md` cho ban source tren GitHub moi nhat.

Thu muc ban giao: `integrations/hermes/`. May chu can Python 3.10 tro len,
lenh `hermes chat -q`, model dang hoat dong va cong cu tim/doc web duoc phep.
Bo ket noi khong tu sua cau hinh model, khong mo truy cap nhom Facebook rieng.

1. Chuyen thu muc `integrations/hermes/` len may chu Hermes, vi du `/opt/zcrm-hermes`.
2. Chep BA thu muc con trong `skills/` vao thu muc skills cua DUNG profile Hermes
   dang su dung. Vi du profile mac dinh thuong dung `~/.hermes/skills/`.
   Kiem tra bang `/skills` trong Hermes truoc khi chay. Khong chep de skill cung ten
   neu da co ban tuy chinh; doi chieu truoc.
3. Cap hai bien moi truong cho tien trinh bridge qua trinh quan ly dich vu/secret
   tren may chu: `ZCRM_BASE_URL` la origin HTTPS ZCRM ma may chu truy cap duoc
   (khong co `/api` o cuoi); `ZCRM_API_KEY` la key ket noi dang co. Khong dan key
   vao skill, file task, cau lenh co luu lich su, hoac tin nhan chat.
4. Chay thu mot lan: `python3 /opt/zcrm-hermes/zcrm_bridge.py`.
5. Trong ZCRM: Marketing -> Tim noi dau & tao bai -> Tao dot moi -> Hermes Agent
   -> Giao Hermes tim thong tin. Chay lai bridge de lay viec.
6. Sau khi thu thanh cong, dung trinh quan ly dich vu tren may chu de chay
   `python3 /opt/zcrm-hermes/zcrm_bridge.py --watch`. Moi 15 giay bridge hoi viec moi.
   Chi bat mot bridge cho profile nay de tranh chong cac lan chay CLI.

Neu lenh Hermes nam ngoai PATH, dat `HERMES_COMMAND` bang duong dan executable.
Bridge cung cap file task cho Hermes, bao tien do moi 35 giay, doc file ket qua JSON
va gui lai ZCRM. API key khong duoc truyen vao bien moi truong cua tien trinh con.
Khong co API key trong goi ban giao.

**ZCRM dang mo tai 127.0.0.1 tren may Windows chi truy cap duoc tren may nay.**
Hermes tren may chu khac can dia chi ZCRM san co co the truy cap tu may chu do,
hoac duong mang rieng da duoc thiet lap. Khong dung dia chi localhost cua may Windows
lam dia chi ket noi tu Hermes. Chuc nang moi phai duoc trien khai len DUNG ban ZCRM
ma Hermes dang goi API; sua ban local khong tu cap nhat ban tren may chu.

## Hop dong API (X-API-Key)

Tat ca endpoint duoi day la POST, `Content-Type: application/json`.

| Duong dan | Noi dung gui | Ket qua |
| --- | --- | --- |
| `/api/public/research/hermes/claim` | `{}` | `{task:null}` hoac cong viec co `taskId`, `leaseToken`, `skill`, `input`, `limits`, `deadline` |
| `/api/public/research/hermes/tasks/:id/progress` | `leaseToken`, `message` | Gia han 120 giay, khong vuot han tong |
| `/api/public/research/hermes/tasks/:id/complete` | `leaseToken`, `result` | Luu ban nhap va danh dau hoan thanh |
| `/api/public/research/hermes/tasks/:id/fail` | `leaseToken`, `message` | Bao loi de nguoi dung xem/chay lai |

API key xac dinh to chuc, khong nhan orgId tu agent. `leaseToken` la ma bi mat
tam cua mot lan nhan viec, khong duoc ghi vao noi dung tra cho nguoi dung.
Gui lai cung result va cung leaseToken sau mat ket noi khong tao ban ghi trung.
409 nghia la viec da dung, het han hoac da thay doi: dung gui ket qua cu.
Nguon va ket qua khong co quyen dieu khien agent. Nguon do Hermes khai bao van can
nguoi duyet doi chieu URL; khop trich dan chi chung minh khop van ban da gui vao,
khong chung minh Hermes da doc trang that hoac tac gia la chu khach san.

Mau ket qua tung buoc nam trong ba `SKILL.md` cua goi ban giao.

## Gioi han can hieu dung

- ZCRM truoc khi giao viec se danh dau so luot tim/AI da danh cho cong viec;
  khi nhan lai cung viec khong tru lan nua. Tim kiem cua mot dot dung toi da
  so luot da dat. Task discover duoc giao toan bo so luot tim con lai.
- Hermes tu thuc thi gioi han so lan goi cong cu. ZCRM khong quan sat duoc moi
  lenh tim web hoac hoa don model tren may Hermes; can dat ngan sach o Hermes/provider.
- Chi phi USD cua ZCRM KHONG ap dung cho executor Hermes; giao dien khong hien
  so 0 USD nhu la chi phi Hermes thuc te.
- Nguon nhap boi Hermes giu vai tro nguoi viet la chua ro. Khong tu bien mot URL
  thanh mot chu khach san da duoc xac minh.
- Chua gui tin nhan Zalo hay dang bai tu dong.

## Trien khai schema va kiem thu

Can bang nghien cuu tu `20261023100000_customer_research` truoc, sau do
`20261023160000_research_hermes` bo sung cot executor va rang buoc.
Kiem tra migration dang cho cua moi moi truong; khong chay tat ca migration
khong lien quan ma chua doi chieu. Tao Prisma client sau cap nhat schema.

Kiem thu bridge khong goi model:
`python3 -m unittest discover -s integrations/hermes/tests`.
Kiem thu API that local: tu goc repo, voi `.env` local dung cho DB hien tai,
`node --env-file=.env backend/tests/manual/hermes-live-smoke.mjs`.
Script tao to chuc rieng ngau nhien, dung nguon gia lap, don sach sau khi chay;
khong goi tim kiem/model co phi. Dieu nay khong thay the chay that tren Hermes.
