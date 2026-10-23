# Ket noi Hermes cho nghien cuu khach hang

## Da xay trong ZCRM

- Tao dot tim hieu voi `executor: hermes`, khong can model hoac Serper trong ZCRM.
- Hermes lay viec bang API key ZCRM hien co; chi thay viec trong cung to chuc.
- Nhan nguon, tong hop noi dau, viet nhap; duyet van thuc hien trong giao dien ZCRM.
- Nhan viec co ma rieng, gia han moi khi bao tien do. Khong con tran ngan sach,
  tong so luot, tong so nguon, 15 phut hay 3 lan nhan lai. Nguoi dung co the dung/chay lai.
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
5. Chay `python3 /opt/zcrm-hermes/zcrm_bridge.py --configure-continuous` trong
   DUNG profile Hermes nhan viec. Lenh dat `agent.max_turns=none`,
   `agent.run_budget_seconds=null`, `tool_loop_guardrails.loop_caps.max_web_searches=0`.
   Can ban Hermes ho tro cac khoa nay; neu bao loi thi cap nhat Hermes truoc.
6. Trong ZCRM: Marketing -> Tim noi dau & tao bai -> Tao dot moi -> Hermes Agent
   -> Giao Hermes tim thong tin. Chay lai bridge de lay viec.
7. Sau khi thu thanh cong, dung trinh quan ly dich vu tren may chu de chay
   `python3 /opt/zcrm-hermes/zcrm_bridge.py --watch`. Moi 15 giay bridge hoi viec moi.
   Khi xong mot viec, lay viec tiep theo ngay, khong cho 15 giay.
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
| `/api/public/research/hermes/claim` | `{}` | `{task:null}` hoac cong viec co `taskId`, `leaseToken`, `skill`, `input`, `batch`, `protocolVersion:2`; khong co deadline tong |
| `/api/public/research/hermes/tasks/:id/progress` | `leaseToken`, `message` | Gia han 120 giay; khong co han tong |
| `/api/public/research/hermes/tasks/:id/complete` | `leaseToken`, `batch`, `result` | Luu phan da xong; tra task phan tiep hoac completed |
| `/api/public/research/hermes/tasks/:id/fail` | `leaseToken`, `message` | Bao loi de nguoi dung xem/chay lai |

API key xac dinh to chuc, khong nhan orgId tu agent. `leaseToken` la ma bi mat
tam cua mot lan nhan viec, khong duoc ghi vao noi dung tra cho nguoi dung.
Gui lai cung result va cung leaseToken sau mat ket noi khong tao ban ghi trung.
409 nghia la viec da dung, het han hoac da thay doi: dung gui ket qua cu.
Nguon va ket qua khong co quyen dieu khien agent. Nguon do Hermes khai bao van can
nguoi duyet doi chieu URL; khop trich dan chi chung minh khop van ban da gui vao,
khong chung minh Hermes da doc trang that hoac tac gia la chu khach san.

Mau ket qua tung buoc nam trong ba `SKILL.md` cua goi ban giao.

## Xu ly lien tuc

- ZCRM bo qua cac cot gioi han cu, cho ca dot da tao va dot moi. Khong can sua DB.
  Cong viec da failed boi ban cu: bam Chay lai de tiep tuc.
- Tong hop chia 5 nguon moi phan. API tra `status:running` va `task` tiep theo;
  bridge lap den khi server tra completed. Khong co tran tong so phan.
- Tim nguon co the tra `hasMore:true`, `nextSearch` kem ket qua. ZCRM luu nguon,
  roi bridge tu chay phan tiep. Het pham vi/het nguon doc duoc thi hoan thanh;
  khong tu tao cong viec moi vo tan. Skill phai ghi ro phan da tim de tranh lap.
- Gui lai cung `batch`, result va leaseToken khong luu trung hay nhay qua phan.
  Neu may chu Hermes mat ket noi, viec duoc nhan lai tu phan chua hoan thanh sau
  khi ma nhan viec het han. Worker cu khong duoc ghi de ket qua worker moi.
- Bridge thu gui lai khi mang loi/HTTP 429/5xx, khong dung sau 3 lan. Neu khong
  gia han duoc ma nhan viec thi dung tien trinh con de cho phep nhan lai an toan.
- Chi phi tren ZCRM chi ghi nhan so nha cung cap tra ve cho AI noi bo; khong phai
  hoa don Hermes. Hermes dung tai khoan/model da cai tren may chu Hermes.
- Van giu buoc nguoi dung duyet, quyen truy cap, nut dung va kiem tra bang chung.
  Loi key/model/cong cu thieu can xu ly nguyen nhan; khong phai het ngan sach ZCRM.
- Gioi han kich thuoc moi goi du lieu va toc do API van giu de web hoat dong on dinh.
  Cac muc nay khong gioi han tong cong viec, nguon hay chi phi cua dot nghien cuu.
- Cap nhat ZCRM, bridge VA hai skill tim/tong hop cung ban. Bridge cu khong ho tro
  nhan phan tiep theo. Xem `ZCRM_HERMES_CONTINUOUS.md` de cai dat nhanh.
- Nguon Hermes nhap van giu vai tro tac gia chua ro. Chua gui tin Zalo/dang bai.

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
