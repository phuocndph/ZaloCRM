# Kết nối CRM Joliefam với ZCRM

## Tình trạng và phần cần cung cấp

Đã xây phía ZCRM: màn cấu hình, ghép khách, đọc dữ liệu mua hàng, xem đơn/thu tiền/sản xuất/vận chuyển/trả hàng, đơn nháp có sẵn và đặt riêng, kiểm tra giá, gửi duyệt, nhận cập nhật và đối chiếu nền. Kết nối mặc định tắt.

**Chưa có mã nguồn, tài liệu API, tài khoản thử hoặc môi trường thử của `crm.joliefam.vn`. Không coi việc build/test bằng dữ liệu mẫu là nghiệm thu với CRM thật.** Cổng dưới đây là hợp đồng v1 cần phía CRM triển khai hoặc chuyển đổi từ API sẵn có. Không lấy trực tiếp database hay dùng cookie tài khoản quản trị.

Người quản lý CRM cần cung cấp:

1. Repository hoặc mã nguồn; API hiện có và quy trình duyệt đơn.
2. Khóa dịch vụ giới hạn đúng tổ chức, chỉ đọc khách/sản phẩm/đơn, tạo khách và đơn nháp; không có quyền duyệt, thu tiền, giữ kho hay tạo vận chuyển.
3. Mã nhân viên CRM tương ứng mã người dùng ZCRM.
4. Mẫu khách cá nhân, khách sạn nhiều người liên hệ, nhiều địa chỉ; hàng có sẵn, hàng đặt riêng, đơn hỗn hợp.
5. Mẫu đơn cọc nhiều lần, hoàn tiền, giao nhiều đợt, giao thất bại, trả hàng và tiến độ sản xuất/lắp đặt.
6. Dữ liệu thử riêng và xác nhận công thức tổng hợp tiền của CRM.

## Cách dùng

- Cài đặt → **CRM Joliefam**: nhập khóa API, khóa xác nhận cập nhật và ghép mã nhân viên.
- Lưu khi **tắt** → **Kiểm tra kết nối đã lưu** → bật sau khi kiểm tra đạt. Thay khóa hoặc đường dẫn phải kiểm tra lại.
- Trong chat chọn **Mua hàng**; hoặc mở **Hồ sơ → Mua hàng** ở danh sách khách.
- Tìm khách CRM bằng điện thoại/mã/tên khách sạn; kiểm tra hồ sơ, chọn người liên hệ nếu có, xác nhận liên kết. Không tự ghép bằng tên Zalo. Nhiều khách sạn phải được chọn rõ từng lần xem.
- Nhân viên có quyền xem một người liên hệ và quyền `commerce.access` xem được toàn bộ mua hàng của khách sạn đã liên kết. Không trả dữ liệu cuộc chat riêng qua API mua hàng.
- **Tạo đơn nháp** tạo một bản nháp trong ZCRM. Sửa được tự lưu sau 1,5 giây; hiển thị lỗi nếu chưa lưu được; tải lại trang khi chưa lưu có cảnh báo.
- Chọn sản phẩm từ CRM; hàng đặt riêng ghi số đo/đơn vị, chất liệu, màu, kiểu may, phụ kiện, lắp đặt, giá đề xuất và tài liệu. Các trường bổ sung bắt buộc do CRM trả trong `requiredFields`.
- **Kiểm tra giá** lấy bảng tính của CRM; xác nhận nội dung rồi **Gửi CRM chờ duyệt**. Bản nháp chưa giữ kho. CRM duyệt; ZCRM không có chức năng duyệt chính thức.
- Đơn đang gửi/chưa rõ kết quả bị khóa. Kiểm tra trước khi thử lại; thử lại dùng cùng mã yêu cầu. CRM trả lại bổ sung thì chỉnh và gửi lại đúng mã đơn cũ.

## Cài đặt và quyền

1. Sao lưu database và dùng quy trình migration của dự án: `prisma migrate deploy`. Migration mới: `20261029100000_joliefam_commerce`. Sinh Prisma client/build cả frontend/backend như bản phát hành bình thường.
2. Đặt `TOKEN_ENCRYPTION_KEY` gồm 64 ký tự hex; giữ ổn định và sao lưu an toàn. `APP_URL` phải là địa chỉ HTTPS công khai đúng ZCRM để CRM nhận tài liệu.
3. Có sáu bảng mới, bật RLS theo quy tắc tenant hiện tại. Không tự cấp thêm quyền cho các nhóm nhân viên cũ.
4. Cấp quyền trong ma trận hiện có:

| Quyền | Ý nghĩa |
|---|---|
| `commerce.access` | Xem thông tin mua hàng; luôn kiểm tra quyền xem Contact |
| `commerce_link.access` | Tìm hồ sơ CRM để liên kết |
| `commerce_link.edit` | Xác nhận/gỡ liên kết và tạo khách CRM |
| `commerce_draft.access` | Xem nháp, tìm sản phẩm, kiểm tra kết quả |
| `commerce_draft.create` | Tạo nháp |
| `commerce_draft.edit` | Sửa nháp và yêu cầu kiểm tra giá |
| `commerce_draft.approve` | **Gửi chờ duyệt**, không phải duyệt chính thức trong CRM |
| `commerce_connection.access/edit` | Xem/sửa cấu hình; không trả khóa đã lưu |
| `media.create` | Tải ảnh và tài liệu vào kho để gắn vào đơn |

Owner/admin theo quyền toàn hệ thống đang có. Nhóm Sale cần được cấp rõ các quyền mua hàng mong muốn. API attachment chỉ chuyển đúng tài liệu gắn trong một đơn đã gửi; không cho CRM lấy toàn bộ kho. Giới hạn 15 MB/tệp, 10 tệp/dòng, không dùng tài liệu của nick riêng tư.

## Hợp đồng HTTP phía CRM — phiên bản 1

Địa chỉ duy nhất: `https://crm.joliefam.vn`; mặc định `/api/zcrm/v1`. Tất cả request có `Authorization: Bearer <service-token>`, JSON UTF-8; không chuyển hướng. Khóa chỉ nằm ở backend. Timeout 15 giây, phản hồi tối đa 2 MB. Danh sách tối đa 20 bản ghi/trang, dùng `nextCursor` opaque tối đa 500 ký tự. Danh sách rỗng là `items: []`, trang cuối `nextCursor: null`.

| Method / đường dẫn | Yêu cầu / kết quả |
|---|---|
| `GET /capabilities` | `{version:1, capabilities:["customers","products","summary","orders","quotes","draft_orders","idempotency","events","attachments"]}` |
| `GET /customers?q=&cursor=&limit=20` | `{items:Customer[],nextCursor}`; tìm theo điện thoại đã chuẩn hóa, mã, tên; chỉ trả khách của tổ chức được token cấp |
| `GET /customers/:id` | `Customer` |
| `POST /customers` | `{name,phone,kind,source:"ZCRM"}` + `Idempotency-Key`; kiểm tra trùng, trả `Customer`; 409 nếu cần người dùng chọn hồ sơ có sẵn |
| `GET /customers/:id/summary` | `Summary` do CRM tính; loại nháp/hủy, trừ trả hàng theo quy tắc CRM |
| `GET /customers/:id/orders` | Bộ lọc `q,status,from,to,cursor,limit`; `{items:OrderSummary[],nextCursor}`; `from/to` ngày bao gồm hai đầu theo múi giờ kinh doanh CRM |
| `GET /customers/:id/orders/:orderId` | `Order`; CRM phải kiểm tra đúng khách |
| `GET /products?q=&cursor=&limit=20` | `{items:Product[],nextCursor}`; mỗi mã/biến thể/kho là lựa chọn rõ ràng |
| `POST /quotes` | `{draft,fingerprint,actorId,source:"ZCRM"}` → `Quote`; kiểm tra lại mã/biến thể/kho, loại hàng, số lượng, trường quy cách bắt buộc và giá; không tin tên/giá hàng sẵn từ client |
| `POST /draft-orders` | `{draft,quoteToken,fingerprint,actorId,source:"ZCRM",existingOrderId,attachments}` + `Idempotency-Key`; trả `{order:Order,approver?:string}` chỉ khi đã lưu đơn nháp chờ duyệt |
| `GET /requests/:key` | `{found:false}` hoặc `{found:true,order:Order,approver?:string,rejection?:string}`; tra cứu yêu cầu tạo/gửi đơn, không dùng 404 để biểu thị chưa tìm thấy |

Các bộ lọc trạng thái: `active`, `pending_approval`, `production`, `shipping`, `problem`, `completed`, `cancelled`. CRM ánh xạ về quy trình thực tế. Nhãn trạng thái trả về được hiển thị nguyên văn; không đoán từ nội dung chat.

Kiểu dữ liệu chuẩn nằm tại `backend/src/modules/joliefam/commerce-domain.ts` và kiểm tra trong `commerce-contract.ts`. Không bỏ trường mảng; dùng `[]` khi chưa có lịch sử. Trường tùy chọn chưa biết được bỏ đi; **không thay giá hoặc số tiền chưa biết bằng 0**. Với trường số tiền bắt buộc trong hợp đồng, CRM phải cung cấp giá trị thật hoặc trả lỗi, tránh bản tổng hợp giả.

### Các kiểu chính

```ts
type Customer = {
  id: string; code: string; name: string; kind: 'hotel' | 'individual'; phone?: string;
  contacts: { id: string; name: string; phone?: string }[];
  addresses: { id?: string; name: string; phone: string; address: string }[];
  url?: string; // HTTPS tới hồ sơ CRM
};
type Summary = {
  orderCount: number; netSales: number; collected: number; due: number;
  activeOrderCount: number; currency: 'VND';
};
type Product = {
  id: string; sku: string; name: string; kind: 'stock' | 'custom';
  variant?: string; warehouseId?: string; warehouseName?: string;
  unit: string; price: number | null; available: number | null;
  updatedAt: string; requiredFields: string[];
};
type DraftInput = {
  customerId: string | null; orderedBy: string;
  recipient: { name: string; phone: string; address: string };
  desiredDate: string; notes: string;
  lines: {
    productId: string; name: string; kind: 'stock' | 'custom'; variant?: string;
    warehouseId?: string; quantity: number; unit: string; proposedPrice: number | null;
    specifications: Record<string,string>;
    attachments: { name: string; mediaId: string }[];
  }[];
};
type Quote = {
  token: string; fingerprint: string; expiresAt: string; currency:'VND';
  subtotal: number; discount: number; shipping: number; tax: number; total: number;
  warnings: string[];
  lines: { productId:string; quantity:number; unitPrice:number; total:number }[];
};
```

VND là số nguyên không âm. Số lượng hỗ trợ thập phân. ISO timestamp cho thời điểm, `YYYY-MM-DD` cho ngày. `total = subtotal - discount + shipping + tax`. `fingerprint` là chuỗi SHA256 do ZCRM gửi, CRM giữ trong quote và xác minh cùng nội dung draft. Token quote phải gắn với tổ chức, khách, nhân viên, dữ liệu, giá và hạn dùng. Hàng đặt riêng vẫn là giá đề xuất chờ duyệt; CRM không biến việc có quote thành phê duyệt chính thức.

`OrderSummary` chỉ gồm id/customerId/code/version/updatedAt/currency/total và bốn trạng thái; danh sách không cần tải toàn bộ lịch sử từng đơn.

`Order` có `id,customerId,code,version,updatedAt,currency,total`; bốn trạng thái `approval,processing,payment,delivery` đều `{code,label}`. Kèm `lines` có `unitPrice` thật (phân biệt `proposedPrice`), `amounts` gồm subtotal/discount/shipping/tax/deposit/collected/refunded/due; các mảng `payments,production,shipments,returns`. Từng shipment có sản phẩm/số lượng, hãng/mã vận đơn, URL HTTPS và lịch sử; từng return có sản phẩm/số lượng, trạng thái, số tiền hoàn. Xem kiểu đầy đủ trong source.

Các mã có ý nghĩa điều khiển: `approval.code="returned"` mở lại nháp để bổ sung; `rejected` kết thúc; `processing.code="completed"/"cancelled"` kết thúc đối chiếu định kỳ của đơn. Các mã khác vẫn giữ nhãn CRM. Version tăng theo mỗi thay đổi của đơn.

### Gửi đơn, chống trùng và tài liệu

- CRM phải lưu `Idempotency-Key` và nội dung/kết quả **trong cùng giao dịch với việc tạo đơn**; nhiều request đồng thời hoặc gửi lại trả cùng một đơn. Khóa được giữ ít nhất suốt vòng đời đơn, không hết sau 15 giây.
- `/requests/:key` phải đọc dữ liệu đã commit nhất quán. Timeout/mạng lỗi không chứng minh chưa tạo đơn. Không tạo mới theo mã khác chỉ vì thiếu phản hồi.
- 409/422 là từ chối xác định: chưa tạo/cập nhật đơn ở yêu cầu đó. Lỗi/timeout sau commit phải được tìm bằng key, không trả 409/422 để làm ZCRM mở lại gửi đơn khác.
- Gửi lại đơn được trả bổ sung dùng key revision mới và `existingOrderId`; CRM cập nhật đúng đơn cũ, kiểm tra quyền sửa và trạng thái trả lại. Không tạo đơn mới.
- Quote hết hạn: kiểm tra token khi thực thi lần đầu. Retry một key đã có kết quả phải trả kết quả cũ trước khi xét hạn token.
- `attachments` bổ sung URL chuyển tệp do backend ZCRM tạo, ví dụ `https://zcrm.joliefam.vn/api/v1/joliefam/transfer/:org/:draft/:media`. CRM chỉ tải HTTPS từ đúng ZCRM đã cấu hình, dùng bearer service-token, không theo redirect và không tải URL tùy ý từ quy cách.
- CRM phải nhận đủ tài liệu trước khi xác nhận hoàn tất đơn nháp, hoặc báo lỗi xác định; không âm thầm bỏ tài liệu. URL chỉ có tác dụng với tệp đã gắn vào đúng nháp đang gửi/đã gửi.

### Cập nhật từ CRM

CRM gửi `POST https://zcrm.joliefam.vn/api/v1/joliefam/webhook/:orgId`:

```json
{"customerId":"hotel-stable-id","orderId":"order-stable-id","version":3}
```

`orderId` có thể bỏ khi hồ sơ khách thay đổi. Header:

- `X-CRM-Timestamp`: epoch milliseconds.
- `X-CRM-Event-Id`: mã sự kiện duy nhất, giữ nguyên khi thử lại.
- `X-CRM-Signature`: HMAC SHA256 hex của **`timestamp.eventId.rawBody`**, dùng khóa webhook đã lưu.

Sai chữ ký/thời gian lệch quá 5 phút trả 401; dữ liệu sai trả 400; nhận bền vững trả 202. Retry phải ký timestamp mới nhưng giữ event id. ZCRM không tin đơn/tiền từ payload: chủ động đọc lại CRM. Sự kiện trùng được nhận lại an toàn; đơn cũ không ghi đè version mới. Lỗi xử lý giữ lại để đối chiếu sau.

## Kiểm thử và mở chạy

- Chạy nhóm `joliefam-*.test.ts` tại backend và `components/commerce/*.spec.ts` tại frontend; build cả hai.
- Migration được kiểm tra trên Postgres nhúng riêng, gồm RLS và khóa chống trùng. Không dùng dữ liệu thử này làm dữ liệu khách thật.
- Đối chiếu với CRM thật: hồ sơ/số tiền khớp, nhóm người liên hệ cùng khách sạn, nhiều khách sạn phải chọn rõ, trả đơn bổ sung vẫn giữ mã cũ, thu tiền/giao nhiều đợt/hoàn hàng khớp từng dòng.
- Thử timeout sau commit và bấm gửi hai lần: CRM chỉ có một đơn. Sai quyền/khác tenant/biết mã đơn vẫn không xem được.
- Kiểm tra giá đổi, sản phẩm ngừng bán, thiếu số đo và tài liệu quá lớn; không có đơn bị gửi thiếu quy cách.
- Mở trang đổi khách liên tục; phản hồi khách trước không hiện ở khách sau. CRM tắt vẫn xem bản lưu có thời điểm và lưu nháp được.
- Cho một nhóm nhân viên chạy thử, đối chiếu log gửi/nhận với CRM, rồi mở rộng. Tắt kết nối dừng gửi/nhận dữ liệu; chat Zalo vẫn hoạt động.

## Những giới hạn cần biết

- Chưa sửa hoặc triển khai mã phía CRM vì source chưa được cung cấp. Chưa xác minh hợp đồng v1 tồn tại trên CRM thật.
- Chưa bật kết nối hay tạo đơn/khách thật. Không tự mở rộng quyền nhân viên.
- Đổi số điện thoại không đổi liên kết đã xác nhận. Việc gộp/xóa Contact cũ cần kiểm tra lại liên kết ở hồ sơ còn dùng; API chặn Contact đã gộp. Không suy ra tự động khách CRM từ số/tên mới.
- Tự lưu khi đang nhập cần backend hoạt động; trạng thái “chưa lưu”/lỗi được hiển thị. Không cất dữ liệu khách trong localStorage.
- Bộ đối chiếu chạy mỗi 5 phút, trang đang mở làm mới mỗi 60 giây. Kết nối/đơn lỗi được thấy trong màn cấu hình hoặc từng nháp; có nhật ký hành động trong bảng `joliefam_audit`.
