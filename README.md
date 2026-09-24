# Search Auto

Search Auto là extension Chrome/Edge hỗ trợ chạy tìm kiếm Bing và các tác vụ Microsoft Rewards. Đây là bản cài trực tiếp từ mã nguồn, không cần cài Node.js hoặc chạy lệnh trong Terminal.

## Cài nhanh

1. Trên trang GitHub dự án, chọn **Code** → **Download ZIP**.
2. Giải nén ZIP vào một thư mục cố định, ví dụ `C:\Extensions\Search-Auto`.
3. Không xoá, đổi tên hoặc di chuyển thư mục đó sau khi cài.
4. Mở trình duyệt:
   - Edge: nhập `edge://extensions`.
   - Chrome: nhập `chrome://extensions`.
5. Bật **Developer mode**.
6. Chọn **Load unpacked** và chọn đúng thư mục có file `manifest.json`.
7. Mở menu Extensions (biểu tượng mảnh ghép) và ghim **Search Auto**.

## Thiết lập lần đầu

1. Đăng nhập tài khoản Microsoft trên Bing trước khi mở extension.
2. Mở Search Auto từ thanh công cụ.
3. Bấm **Làm mới** để đọc quota. Trong **Tùy chọn**, đặt giới hạn lượt Máy tính/Điện thoại hoặc chọn **Chỉ làm nhiệm vụ**.
4. Bấm **Làm phần còn thiếu** để chạy thử ở chế độ **Thủ công**.
5. Chỉ sau khi chạy thử thành công mới bật lịch tự động.

## Để chạy ổn định

- Giữ trình duyệt đang mở và không đóng cửa sổ Chrome/Edge trong lúc extension chạy.
- Không để máy ngủ hoặc tắt mạng giữa chừng.
- Không mở nhiều lần Search Auto cùng lúc.
- Đừng bấm nút chạy liên tục; đợi trạng thái chạy hoàn tất hoặc bấm dừng trước.
- Đảm bảo tài khoản Microsoft vẫn đăng nhập trên Bing/Rewards.
- Nếu dùng chế độ **Khi mở trình duyệt**, hãy mở trình duyệt và chờ một lúc trước khi thao tác. Chế độ này có thể không chạy nếu mạng, trang Bing hoặc phiên đăng nhập chưa sẵn sàng.
- Trên Edge, tắt Startup Boost nếu extension không chạy sau khi mở trình duyệt.

## Cập nhật bản mới

1. Tải bản ZIP mới từ GitHub.
2. Giải nén và thay thế toàn bộ nội dung trong thư mục đã cài.
3. Mở `edge://extensions` hoặc `chrome://extensions`.
4. Nhấn nút làm mới trên thẻ Search Auto.

Không cài chồng một thư mục ZIP khác rồi bỏ lại thư mục cũ: trình duyệt sẽ tiếp tục dùng thư mục đã được chọn ban đầu.

## Khi extension không chạy

1. Mở trang Extensions và kiểm tra Search Auto đang bật.
2. Nhấn nút làm mới của extension.
3. Đăng xuất rồi đăng nhập lại Bing/Microsoft Rewards.
4. Mở popup và chạy ở chế độ **Thủ công**.
5. Nếu vẫn lỗi, tắt extension rồi bật lại; sau đó tải lại trang Bing.

## Lưu ý

Việc sử dụng Microsoft Rewards cần tuân theo điều khoản của Microsoft. Extension không bảo đảm điểm thưởng, không nên dùng để xử lý thông tin nhạy cảm và chỉ nên cài từ nguồn bạn tin cậy.

## Cơ chế bản 2.3.0

- Đọc quota thật trước mỗi pha; chỉ tìm phần còn thiếu trong giới hạn đã đặt. Số lượt hiển thị là **ước tính 3 điểm/lượt**, không phải cam kết được cộng điểm. Không tự bù vô hạn khi điểm cập nhật chậm.
- Khi không đọc được quota hoặc điểm ngừng tăng, dừng pha và nghỉ 30 phút theo từng thiết bị. Snapshot lưu số điểm và thời điểm đọc, không lưu danh tính tài khoản.
- Nút Dừng phản hồi ngay; nút Chạy chỉ bật lại khi dọn dẹp xong. Mỗi phiên giữ quyền sở hữu tab/cửa sổ đến hết cleanup.
- Chỉ tự làm nhiệm vụ đơn giản được nhận diện rõ. Không xác định được section/nhiệm vụ thì bỏ qua; mở link không tự được tính là hoàn thành. Xác nhận theo chính offer hoặc trạng thái claim; trường hợp chưa có bằng chứng hiển thị cần kiểm tra.
- Checkpoint tối đa 2 phút, tách tiến độ PC/mobile và giữ deadline gốc. Chỉ tự khôi phục khi nhận diện được cùng tài khoản từ API (lưu hash SHA-256); thiếu danh tính thì không tự khôi phục. Phiên đã dừng/kết thúc không resume.
- Giới hạn thời gian: tìm kiếm 3 phút + 20 giây/lượt (tối đa 25 phút), nhiệm vụ tối đa 12 phút, cả phiên tối đa 35 phút. Lưu tối đa 7 báo cáo, không chứa truy vấn/tài khoản.

## Kiểm thử cho người phát triển

Chạy `npm test` bằng Node.js hỗ trợ `node --test`. Extension không cần cài dependency khi sử dụng.
Kiểm thử tự động dùng dữ liệu mẫu; điểm thực tế và giao diện Rewards có thể thay đổi.
