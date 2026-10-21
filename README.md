# Search Auto

Tiện ích mở rộng tự động tìm kiếm Bing và hoàn thành nhiệm vụ Microsoft Rewards hàng ngày.

> Dành cho Firefox: xem [hướng dẫn cho Firefox](docs/firefox.md).

---

## ⚠️ Lưu ý quan trọng (Đọc kỹ trước khi dùng)

- **Giới hạn 1 máy tối đa 6 tài khoản:** Mỗi máy **chỉ được chạy tối đa 6 tài khoản**. Mỗi tài khoản bắt buộc phải chạy trên một **Profile trình duyệt riêng biệt** (Profile 1, Profile 2,...). Chạy quá 6 tài khoản/máy hoặc đăng nhập chung profile sẽ bị Microsoft quét bất thường và khóa (ban) toàn bộ tài khoản Rewards.
- **Khoảng chờ an toàn (Delay):** Trong **Tùy chọn**, nên giữ khoảng nghỉ giữa 2 lần tìm kiếm từ **5 – 15 giây** trở lên. Tuyệt đối không chỉnh delay quá thấp để tránh bị phát hiện dùng bot hoặc bị phạt giam điểm (cooldown).
- **Trình duyệt khuyên dùng:** Nên dùng **Google Chrome**. Trên Microsoft Edge có thể bị hệ thống chặn tính năng tự động bấm làm nhiệm vụ Rewards.
- **Lịch tự động:** Tiện ích chỉ chạy được khi trình duyệt đang mở. Nếu tắt máy hoặc tắt trình duyệt vào giờ hẹn, hệ thống sẽ bỏ qua và không tự chạy bù.

---

## 🚀 Cài đặt nhanh

1. Mở `chrome://extensions` trên Chrome và bật **Chế độ dành cho nhà phát triển** (Developer mode).
2. Bấm **Tải tiện ích đã giải nén** (Load unpacked) rồi chọn thư mục project này.
3. Ghim **Search Auto** lên thanh công cụ.
4. Mở Bing và Rewards đăng nhập tài khoản Microsoft trong profile đó.

---

## 📖 Cách sử dụng

- **Chạy ngay:** Mở popup. Popup hiện số lượt **Máy tính** và **Điện thoại** đã lưu. Bấm **Start**. Khi đang chạy, nút đổi thành **Dừng** và hiện tiến độ.
- **Đổi số lượt, khoảng nghỉ, chủ đề:** Bấm bánh răng **Tùy chọn**. Mẫu nhanh `11 · 0`, `21 · 11`, `31 · 21`, `51 · 31` nằm trong mục **Tìm kiếm**. Thay đổi được lưu tự động.
- **Chỉ làm nhiệm vụ:** Trong **Tùy chọn** → **Tùy chọn khác**, bấm **Chạy nhiệm vụ**.
- **Chạy theo lịch:** Trong **Tùy chọn** → **Lịch chạy**, chọn tần suất. Nút hiện **Chạy một lần** khi đang ở Thủ công, và **Đặt lịch** với các tần suất còn lại. Khi phiên đang chạy, nút đó hiện **Dừng**. Trình duyệt phải đang mở.

---

## 🛠️ Xử lý lỗi thường gặp

- **Không nhận điểm Mobile:** Trong **Tùy chọn**, bật **Tối ưu điểm Mobile** và **Giữ đăng nhập Rewards sau Mobile**. Đăng nhập lại Bing nếu chưa nhận.
- **Tiện ích bị treo hoặc dừng giữa chừng:** Bấm **Dừng** trên popup, rồi chạy lại. Log lỗi tải trong **Tùy chọn** → **Dữ liệu & nhật ký**.
- **Edge không tự bấm nhiệm vụ:** Làm thủ công trên tab Rewards đang mở, hoặc chuyển sang dùng Google Chrome để ổn định nhất.

---

## Báo cáo thiết bị

Trong trang ủng hộ có nút gửi báo cáo thiết bị **tùy chọn**, kèm mô tả dữ liệu
và nơi nhận. Mở popup hoặc cài tiện ích không tự gửi báo cáo. Endpoint mẫu chưa
được cấu hình nên bản mặc định không gửi. Xem [phạm vi, độ chính xác và giới hạn
báo cáo](docs/device-report.md).

## Phát triển và dựng bản

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run format:check
npm.cmd run audit:types
npm.cmd test -- --runInBand
npm.cmd run test:claim
npm.cmd run test:firefox
npm.cmd run build:chrome
npm.cmd run build:firefox
```

JavaScript dùng `clang-format` với cấu hình Google và kiểm tra AST để từ chối
thay đổi cấu trúc chương trình do formatter. JSON/HTML/CSS/Markdown dùng Prettier.
Chạy `npm.cmd run format` để định dạng lại. Quy ước nằm trong
[quy ước JavaScript](docs/google-style.md).
`audit:types` liệt kê các hàm/phương thức thiếu chú thích kiểu; thêm `-- --check`
để trả mã lỗi khi còn thiếu. Công cụ này chưa kiểm chứng tính đúng của từng kiểu.

`test:claim` chạy các fixture cục bộ và bản Chrome trong profile thử riêng;
`test:firefox` cần Firefox đã cài (hoặc biến `FIREFOX_BINARY`). Các bài smoke
không sử dụng tài khoản thật. Chrome cài unpacked từ thư mục project, nơi có
`manifest.json` ở gốc. `npm.cmd run build:chrome` và `npm.cmd run build:firefox` tạo `dist/chrome`
và `dist/firefox`. Firefox cài tạm bằng `dist/firefox/manifest.json`. Bản dựng
chỉ chứa tài nguyên chạy, không chứa test, dependency, bản sao nguồn hay tài liệu
nội bộ.

## ☕ Ủng hộ tác giả

Nếu tiện ích hữu ích cho bạn, hãy [tặng 1 sao trên GitHub](https://github.com/vanhobmt99/reward) hoặc ủng hộ tác giả qua:

|                                              Vietcombank                                               |                                         MoMo                                          |
| :----------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------: |
| <img src="docs/vietcombank.png" alt="Vietcombank" width="180" /><br>**HO VIET VAN**<br>`0231000639001` | <img src="docs/momo.jpg" alt="MoMo" width="180" /><br>**HO VIET VAN**<br>`0326363942` |
