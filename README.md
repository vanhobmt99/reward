# Hướng Dẫn Sử Dụng Search Auto

## 1. Cài extension vào Chrome/Edge

1. Tải hoặc clone repo này về máy.
2. Mở Chrome/Edge và vào trang `chrome://extensions`.
3. Bật `Developer mode`.
4. Chọn `Load unpacked`.
5. Chọn thư mục repo `bingreward`.
6. Pin extension `Search Auto` lên thanh công cụ để dễ mở.

Sau mỗi lần pull code mới từ GitHub, quay lại `chrome://extensions` và bấm nút reload ở extension.

## 2. Chuẩn bị trước khi chạy

1. Đăng nhập tài khoản Microsoft/Bing trong trình duyệt.
2. Mở `https://rewards.bing.com/` một lần để chắc chắn tài khoản đã vào được dashboard.
3. Không mở DevTools cho tab extension khi đang chạy, vì extension dùng Chrome debugger để giả lập mobile.
4. Nên bật log nếu cần xem lỗi: mở extension > `Settings` > bật `Show Advance Logs`, sau đó xem console của service worker trong `chrome://extensions`.

## 3. Chạy search thủ công

1. Mở extension.
2. Vào tab `Search`.
3. Nhập số lượt:
   - `Desktop`: số search desktop.
   - `Mobile`: số search mobile.
4. Chọn delay:
   - `Min. Delay`: thời gian chờ tối thiểu giữa các search.
   - `Max. Delay`: thời gian chờ tối đa giữa các search.
5. Có thể bấm nhanh các mode:
   - `10 - 0`: chỉ desktop nhẹ.
   - `20 - 10`: desktop + mobile vừa.
   - `30 - 20`: mức thường dùng.
   - `50 - 30`: mức cao, nên dùng delay dài hơn.
6. Bấm `Search`.
7. Khi đang chạy, nút sẽ đổi thành `Stop`; bấm lại nếu muốn dừng.

Khuyến nghị: dùng delay `15-30s` hoặc cao hơn nếu chạy nhiều acc để giảm lỗi Bing không ghi nhận điểm.

## 4. Chạy daily set và Keep earning

Có 2 cách chạy:

### Chạy tự động sau search

1. Vào `Settings`.
2. Bật `Automate Activities after searches`.
3. Quay lại tab `Search`.
4. Bấm `Search`.

Sau khi search xong, extension sẽ tự mở Rewards dashboard, click `Daily set`, rồi chuyển sang trang `Keep earning` để xử lý các card còn điểm.

### Chạy riêng activity

1. Vào `Settings`.
2. Bấm `Perform` ở dòng `Perform Activities`.

Cách này dùng khi search đã xong nhưng muốn chạy lại daily set hoặc earning point.

## 5. Chạy mobile points ổn định hơn

Trong `Settings`, nên giữ bật `Enhanced Patch v1.5.8 for Mobile points`. Chế độ này sẽ clear cache Bing khi cần và giả lập thiết bị mobile bằng debugger.

Trước mobile, extension **luôn clear cookie Bing** để mobile points được ghi nhận. Mặc định bật `Backup & restore Rewards login after mobile`: backup cookie Bing/Rewards trước khi clear, restore lại cookie bị thiếu sau mobile search để vẫn chạy được Daily set / Keep earning mà không ghi đè cookie Microsoft khác. Tắt option này nếu chỉ cần mobile points và không cần activity sau đó.

Nếu mobile bị dừng ở vài acc:

1. Bấm `Reset Runtime data`.
2. Bấm `Clear Bing Browsing Data`.
3. Bấm biểu tượng refresh ở dòng device để đổi thiết bị giả lập.
4. Reload extension trong `chrome://extensions`.
5. Chạy lại với delay cao hơn, ví dụ `25-45s`.

## 6. Schedule

1. Vào tab `Schedule`.
2. Nhập số lượt `Desktop`, `Mobile`, `Min. Delay`, `Max. Delay`.
3. Chọn mode:
   - `Manual Only`: không tự chạy.
   - `At Startup`: tự chạy khi mở trình duyệt.
   - `Every ~5 Minutes`: tự chạy lại sau khoảng 5 phút, có random.
   - `Every ~15 Minutes`: tự chạy lại sau khoảng 15 phút, có random.
4. Bấm `Schedule`.

Nếu đang chạy schedule và muốn dừng, mở extension rồi bấm `Stop`.

## 7. Các nút trong Settings

- `User Manual / Open`: mở hướng dẫn cũ nếu có file manual đi kèm.
- `Test Device / refresh`: đổi thiết bị mobile giả lập.
- `Enhanced Patch`: bật/tắt patch hỗ trợ mobile points.
- `Backup & restore Rewards login after mobile`: backup cookie trước mobile clear, restore sau mobile (mặc định bật).
- `Show Advance Logs`: bật log chi tiết để debug.
- `Search Niche`: mặc định là `Theo chủ đề`. Ở chế độ này, extension nạp Google
  Trends và các bài
  Wikipedia được xem nhiều ở nền, cache trong 6 giờ, rồi mở rộng từ khóa bằng
  Bing Suggestions. Nếu các nguồn này không truy cập được, extension tự dùng
  bộ chủ đề tích hợp sẵn.
- `Perform`: chạy daily set và Keep earning ngay.
- `Automate Activities after searches`: tự chạy activity sau khi search xong.
- `Clear Bing Browsing Data`: xóa dữ liệu Bing.
- `Simulate Tab`: bật/tắt giả lập mobile trên tab hiện tại.
- `Download search history(24Hr)`: tải lịch sử search 24 giờ.
- `Delete search history(24Hr)`: xóa lịch sử search 24 giờ.
- `Reset Runtime data`: reset trạng thái đang chạy.
- `Reset Extension`: reset toàn bộ cấu hình extension.

## 8. Khi bị lỗi hoặc tự dừng

Làm theo thứ tự này:

1. Bật `Show Advance Logs`.
2. Vào `chrome://extensions`.
3. Ở extension `Search Auto`, mở `service worker` console.
4. Chạy lại acc bị lỗi.
5. Xem log các dòng có `[QUERY]`, `[PERFORM]`, `[SEARCH]`, `[EMULATION]`, `[ACTIVITY]`.
6. Nếu thấy lỗi content script hoặc mobile emulation, reload extension và chạy lại.
7. Nếu chỉ một vài acc lỗi, tăng delay và clear Bing data trước khi chạy lại.

## 9. Cách cập nhật code mới

Trong thư mục repo:

```powershell
git pull origin main
```

Sau đó mở `chrome://extensions` và bấm reload extension.

## 10. Cách kiểm tra code trước khi dùng

Trong thư mục repo:

```powershell
npm install
npm test -- --runInBand
node tests/check_syntax.js
```

Nếu tất cả pass thì reload extension và chạy thử một acc trước khi chạy nhiều acc.

# reward
