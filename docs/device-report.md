# Độ chính xác của báo cáo thiết bị

`js/telemetry.js` mô tả những gì trình duyệt cho phép thấy tại thời điểm đọc.
Đây không phải bản kiểm kê đầy đủ phần cứng và không xác minh được danh tính máy.
Không dùng báo cáo này làm bằng chứng duy nhất để chặn người dùng, nhận diện máy ảo
hay gộp nhiều profile thành một thiết bị.

## Dữ liệu và trạng thái

Các trường hiển thị hiện có được giữ, nhưng giá trị thiếu là `Không xác định`.
`dataQuality` bổ sung `status` và `source` cho từng nhóm phép đo:

| Trạng thái    | Ý nghĩa                                                             |
| ------------- | ------------------------------------------------------------------- |
| `reported`    | API đã trả dữ liệu hợp lệ; chưa được đối chiếu phần cứng vật lý.    |
| `estimated`   | Giá trị ước lượng hoặc suy luận từ tín hiệu hạn chế.                |
| `partial`     | Chỉ đọc được một phần thông tin hoặc danh sách được phép thấy.      |
| `unsupported` | Không có API/ngữ cảnh cần thiết.                                    |
| `denied`      | API ngoại vi báo từ chối truy cập.                                  |
| `error`       | Lời gọi lỗi hoặc dữ liệu không hợp lệ, không có fallback dùng được. |
| `unknown`     | Không đủ bằng chứng để kết luận.                                    |

Nếu fallback đọc được dữ liệu, trạng thái mô tả fallback đang dùng. Nhóm `cpu`,
`memory`, `displays`, `storage`, `os`, `battery`, `formFactor`, `peripherals`,
`gpu`, `fonts`, `audio`, `environment`, `automation`, `network`, `theme`, `hdr`
được gắn trạng thái. Ngôn ngữ, múi giờ, kích thước `screen` và tỷ lệ pixel chỉ
mô tả môi trường trình duyệt hiện tại.

## Giới hạn từng nhóm

- **CPU:** tên/kiến trúc và số bộ xử lý logic do API báo cáo, không phải số nhân
  vật lý. `hardwareConcurrency` dự phòng có thể bị trình duyệt giới hạn.
- **RAM:** dùng GiB/MiB đúng với phép chia theo 1024. `deviceMemory` chỉ là
  ước lượng. Dung lượng khả dụng bằng 0 hợp lệ; trường thiếu hoặc sai không thành 0.
- **Laptop/PC:** luôn để không xác định. API pin hoặc màn hình tích hợp không
  chứng minh loại máy. Trạng thái pin chỉ được ghi là trình duyệt báo cáo.
- **Windows:** UA-CH `platformVersion` không phải số build hệ điều hành.
  Giá trị 0 là trước Windows 10; 1–10 thuộc Windows 10; 13 trở lên là Windows 11
  hoặc mới hơn. Giá trị thiếu, sai hoặc ngoài các khoảng đã biết không bị gán
  Windows 10. Khi Client Hints lỗi/thiếu, thử `runtime.getPlatformInfo`; kiến trúc
  chưa biết không mặc định 32-bit hay 64-bit.
- **Màn hình:** `bounds` là pixel logic, `screen` là CSS pixel của màn hình cửa sổ
  hiện tại. Không coi đó là độ phân giải vật lý hoặc tự nhân với DPR để suy đoán
  mọi màn hình. Fallback không tự nhận là màn hình chính.
- **Lưu trữ:** chỉ ghi các đơn vị API liệt kê và dung lượng được báo cáo; `fixed`
  không phân biệt SSD/HDD. Danh sách rỗng khác với API bị lỗi/không có quyền.
- **Ngoại vi:** số mục micro/loa/camera được phép thấy, không phải tổng số thiết bị
  vật lý; có thể gồm mục mặc định hoặc thiết bị ảo. Lỗi/từ chối không được ghi là 0.
- **GPU:** renderer WebGL đang dùng, không phải danh sách mọi GPU hoặc dung lượng
  VRAM. Không có debug extension thì tên GPU có thể không xác định. Giải phóng
  WebGL context sau khi đọc.
- **Máy ảo/tự động hóa:** chỉ ghi dấu hiệu GPU ảo hoặc WebDriver. SwiftShader và
  llvmpipe chỉ cho biết render bằng phần mềm. Không có dấu hiệu không chứng minh
  máy thật hay không có tự động hóa.
- **Font:** chỉ dò 20 font ứng viên theo chiều rộng chữ. Kết quả là ước lượng;
  không dò thấy khác với không có font hoặc không đọc được Canvas.
- **Mạng:** effectiveType/downlink là ước lượng hiệu năng, không xác định Wi-Fi,
  Ethernet hay mạng di động. Không phải phép đo tốc độ mạng thực tế.
- **HDR/theme:** media query mô tả khả năng/ưu tiên trình duyệt đang thấy. Query
  không được hỗ trợ không được suy thành không có HDR hoặc giao diện sáng.
- **Audio/Canvas/hash:** phụ thuộc môi trường trình duyệt; không phải serial máy.
  Audio thiếu mẫu hoặc có NaN/Infinity được ghi là lỗi, không thay bằng số 0.
  Giá trị 0 hợp lệ vẫn được giữ. Khi dọn audio, lỗi giải phóng một node không
  ngăn giải phóng node còn lại. Số đo chiều rộng font thiếu, âm hoặc không hữu
  hạn cũng được ghi là lỗi thay vì suy ra font đã cài.

## Định dạng gửi phiên bản 2

Payload có `schemaVersion: 2`, `fingerprintKind: "environment-snapshot-v2"` và
`fingerprintIsStableDeviceId: false`. Hash có thể đổi khi thay đổi ngôn ngữ,
múi giờ, font, màn hình, trình duyệt hoặc kết quả API. Hai máy có đầu vào giống
nhau cho cùng hash. Không so sánh như một định danh máy cố định với hash bản cũ.

`machineIdScope` ghi rõ ID chỉ lưu trong storage của profile, không phải ID
phần cứng. `reportedAt` là thời điểm tạo báo cáo gửi đi; thay cho `installedAt`
trước đây vốn gán nhầm thời điểm gửi thành thời điểm cài đặt. Bên nhận cần đọc
schema mới, không parse chuỗi đơn vị GiB/MiB như GB/MB thập phân.

Endpoint mẫu mặc định vẫn bỏ qua toàn bộ thu thập/gửi. Bản sửa này không bật
endpoint, không thêm quyền và không thêm cơ chế chạy ẩn. Chỉ sử dụng việc gửi
chẩn đoán trong luồng đã thông báo cho người dùng.

Việc mở popup hoặc trang ủng hộ không tự đọc/gửi báo cáo. Trang ủng hộ có phần
**Báo cáo thiết bị (tùy chọn)** mô tả dữ liệu và hiển thị URL nơi nhận. Chỉ nút
**Đồng ý gửi báo cáo thiết bị một lần** mới yêu cầu gửi; bỏ qua không ảnh hưởng
chức năng tiện ích. Khi endpoint vẫn là mẫu, nút bị vô hiệu hóa. Endpoint phải
là HTTPS, không chứa username/password; không gửi cookie và không theo redirect.
Nếu thay endpoint sang tên miền riêng, cần khai báo đúng host permission khi build.

Hàm gửi chỉ chấp nhận `consent: true` đúng kiểu boolean. Chuỗi `"true"`,
`"false"`, số hoặc object không cấp quyền đọc storage, thu thập hay gửi dữ liệu.

Luồng gửi dùng một snapshot chung cho cấu hình và hash: CPU, RAM, màn hình,
lưu trữ, GPU, audio và font không bị đọc lặp trong cùng báo cáo. Mỗi API bất đồng
bộ có hạn chờ 1,5 giây; timeout dùng trạng thái `error` hoặc fallback có nhãn
ước lượng. OS có thể thử thêm API dự phòng nên tối đa hai lượt chờ. Audio nodes
và WebGL context được giải phóng sau đọc. Hạn chờ không cưỡng chế hủy được API
trình duyệt vốn không hỗ trợ hủy, nhưng báo cáo không phải đợi API đó vô hạn.

Web Lock theo profile ngăn hai trang gửi đồng thời; trang không có Web Locks
sẽ không gửi. Trong một trang, các lời gọi đang chồng nhau chia sẻ cùng tác vụ.
Fetch có hạn 7 giây và được abort trong mọi đường kết thúc; timer luôn được dọn.
Chỉ ghi `telemetrySent` khi HTTP thành công. Lỗi hiển thị tại nút, không tự retry.
ID profile mới dùng UUID ngẫu nhiên; giữ nguyên ID đã lưu trước đó.

Đây vẫn **không phải bảo đảm exactly-once**: server có thể đã nhận nhưng phản hồi
bị mất, hoặc ghi storage thất bại sau khi gửi. Bên nhận cần chống trùng bằng
`machineId` cùng `schemaVersion`; cài lại/xóa storage có thể tạo ID mới. Không có
server thật trong repo để kiểm chứng phần đó. Không dùng fingerprint thay ID này.

## Kiểm chứng

Khi dữ liệu API sai định dạng, thông tin CPU hợp lệ không bị mất vì trường
`features` lỗi. Mục màn hình/ổ đĩa lỗi được giữ dưới dạng không xác định, các mục
hợp lệ khác vẫn hiển thị và nhóm được đánh dấu `partial`. Danh sách ngoại vi
sai định dạng trả `error`, không giả thành 0 thiết bị. Ngôn ngữ và múi giờ được
đọc một lần cho cả hash lẫn nội dung báo cáo; lỗi đọc không làm mất cả báo cáo.

Chạy `npm.cmd test -- --runInBand tests/telemetry-test.js tests/telemetry-send-test.js tests/donate-report-test.js`. Các bài kiểm thử dùng
API giả lập và `fetch` giả lập, không đọc thiết bị thật hoặc gửi dữ liệu mạng.
Để xác nhận độ chính xác thực tế cần đối chiếu báo cáo đã được người dùng cho phép
trên các máy/trình duyệt khác nhau. Unit test không thay thế bước này.

## Nguồn API

- [Chrome CPU](https://developer.chrome.com/docs/extensions/reference/api/system/cpu)
- [Chrome RAM](https://developer.chrome.com/docs/extensions/reference/api/system/memory)
- [Chrome Display](https://developer.chrome.com/docs/extensions/reference/api/system/display)
- [Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/system/storage)
- [Chrome PlatformInfo](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-PlatformInfo)
- [Windows Client Hints](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11)
- [Battery Status API](https://www.w3.org/TR/battery-status/)
- [Danh sách thiết bị được phép thấy](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)
- [WebGL renderer](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_debug_renderer_info)
- [Downlink ước lượng](https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/downlink)
