# Search Auto cho Firefox

Bản Firefox được dựng từ cùng mã nguồn Chrome; không cần duy trì hai bản của lịch chạy, cấu hình, truy vấn và logic nhiệm vụ.

## Dựng và cài

Trên Windows chạy từ thư mục project:

```powershell
npm.cmd run build:firefox
npm.cmd run package:firefox
```

- Thư mục extension: `dist/firefox/`.
- Gói ZIP: `dist/search-auto-firefox-<version>.zip`.
- Yêu cầu Firefox desktop 128 trở lên.

Mỗi lần dựng sẽ thay toàn bộ `dist/firefox/` để loại tệp cũ. Gói extension chỉ chứa mã và tài nguyên chạy, không chép tài liệu phát triển hoặc script fingerprint chỉ dùng trên Chrome. `dist/` và ZIP được bỏ qua trong Git.

Mở `about:debugging#/runtime/this-firefox`, chọn **Load Temporary Add-on…** rồi chọn `dist/firefox/manifest.json`. Có thể chọn gói ZIP đã dựng. Đăng nhập Bing/Rewards trong cùng hồ sơ Firefox, mở Search Auto và chạy.

Cài tạm mất khi đóng Firefox. Muốn phân phối/cài lâu dài phải gửi gói để Mozilla ký, hoặc phát hành qua AMO. ZIP hiện tại chưa ký. Chưa có bước ký hay xuất bản tự động trong project.

## Khác biệt với Chrome

| Phần                                                      | Bản Firefox                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup, lưu cấu hình, lịch, lịch sử, log, dừng/đặt lại     | Dùng chung mã Chrome qua facade Promise/callback                                                                                                              |
| Tìm kiếm Máy tính                                         | Nhập và gửi form bằng script DOM                                                                                                                              |
| Nhiệm vụ Rewards                                          | Dùng chung bộ tìm phần tử/kiểm tra điểm, bấm DOM; trang yêu cầu `isTrusted` cần thao tác thủ công                                                             |
| Điện thoại                                                | Chỉ đổi User-Agent HTTP trên tab Bing đang chạy; không bảo đảm điểm Mobile                                                                                    |
| Giả lập kích thước, cảm ứng, navigator, Client Hints, GPU | Không hỗ trợ; không làm giả hỗ trợ CDP đầy đủ                                                                                                                 |
| Dọn dữ liệu                                               | Chỉ cookie, local storage, indexedDB/service worker theo hostname Bing khi được yêu cầu; bỏ qua cache/cacheStorage/pluginData để tránh xóa cache toàn Firefox |
| Cookie đăng nhập                                          | Dùng API cookie Firefox; chạy trong hồ sơ bình thường, không chọn container riêng cho tab tự động                                                             |

Firefox không triển khai `chrome.debugger`. `js/firefox-api.js` ánh xạ các lệnh mà mã dùng sang API và thao tác DOM; lệnh chưa biết sẽ báo lỗi. Các lệnh chỉ dành cho CDP về emulation/fingerprint/service-worker bypass được bỏ qua có chủ đích. Bản Firefox dùng Manifest V2 và background page để hỗ trợ `tabs.executeScript({code})` với các biểu thức script đã có trong mã nguồn, không cần `eval`, script từ xa hay quyền userScripts riêng. Chrome vẫn dùng Manifest V3 và service worker.

Mã được chuyển từ `chrome.*` sang facade `extension.*` khi dựng, nội dung popup khởi tạo facade trước khi nạp module gốc. Content script dùng callback giữ nguyên API `chrome.runtime`. Facade nền quản lý attachment, dọn trạng thái khi đóng tab và giới hạn bộ thay header ở host Bing.

## Kiểm tra

```powershell
npm.cmd test -- --runInBand
npm.cmd run lint
npm.cmd run test:firefox
```

`test:firefox` chạy Firefox headless với hồ sơ thử nghiệm riêng, cài tạm bản dựng, kiểm tra tiến trình nền/popup và các thao tác với trang fixture. Không dùng tài khoản Microsoft thật. Có thể đặt biến `FIREFOX_BINARY` nếu Firefox nằm ở vị trí khác. Test đóng Firefox và xóa thư mục tạm sau khi chạy, kể cả khi test lỗi; chỉ giữ hồ sơ nếu Firefox chưa thoát hoặc đặt `KEEP_FIREFOX_TEST_PROFILE=1` để chẩn đoán.

Đã kiểm tra trên Firefox 156: nạp extension, khởi tạo cấu hình/alarm, hiển thị phiên bản popup, gửi form tìm kiếm, bấm phần tử, lệnh dừng qua runtime message, đổi/khôi phục User-Agent và xóa cookie/local storage trong phạm vi yêu cầu. Manifest và mã thử nghiệm chỉ thêm quyền localhost vào bản sao trong thư mục tạm; gói phát hành không có quyền localhost.

Để xem log thực tế, mở **Inspect** ở mục Search Auto trong `about:debugging`. Việc Microsoft ghi nhận điểm và các trang nhiệm vụ trực tuyến cần được kiểm tra với tài khoản đã đăng nhập.

## Tài liệu Mozilla

- [Khác biệt Chrome/Firefox, API debugger và Promise](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities)
- [Background page và script](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [tabs.executeScript](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/executeScript)
- [Thay request header](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeSendHeaders)
- [Giới hạn xóa dữ liệu theo hostname](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browsingData/RemovalOptions)
- [Cài tạm trên Firefox](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
