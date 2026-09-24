# Đánh giá cơ chế và giao diện — 24/09/2026

## Phạm vi và kết luận

Đã tìm kiếm repository công khai qua GitHub API, kiểm tra cây mã nguồn của
`vanhobmt99/reward`, đối chiếu README/một số module của các dự án tương tự và
đọc các luồng chính trong workspace hiện tại. Đây là khảo sát có chọn lọc,
không phải kiểm toán mọi repository trên GitHub hoặc mọi dòng mã của các repo tham khảo.

Bản trên GitHub chưa chứa các module checkpoint, deadline và popup view model
mới đang có trong workspace. Các phát hiện dưới đây áp dụng cho bản local mới nhất.

Kết luận: cần cải tiến thêm. Ưu tiên tính đúng của Dừng/Khôi phục/Xác nhận kết quả,
sau đó làm giao diện xoay quanh quota còn thiếu. Giữ mô hình extension gọn nhẹ.

## Nguồn đối chiếu

1. [Project hiện tại](https://github.com/vanhobmt99/reward): cây mã nguồn remote để xác định phạm vi và phân biệt với thay đổi local.
2. [AsoStrife/Rewards-Search-Automator](https://github.com/AsoStrife/Rewards-Search-Automator): README mô tả popup cấu hình desktop/mobile, lưu thiết lập và thanh tiến độ. Đây là đối chiếu gần về loại sản phẩm.
3. [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script/tree/v4): README phân biệt dashboard mới và cũ; có trạng thái chạy, log, lịch sử và dữ liệu quota từng nền tảng.
4. [SearchProgress.ts](https://github.com/TheNetsky/Microsoft-Rewards-Script/blob/v4/src/functions/activities/search/SearchProgress.ts): có earned/max/remaining, tổng hợp counter và tách counter được nhận diện là Edge. Đây là một cách xử lý của repo đó, không phải bằng chứng rằng mọi payload Rewards đều phải cộng các counter.
5. [mgrimace/rewards-dashboard](https://github.com/mgrimace/rewards-dashboard): README mô tả trạng thái chạy trực tiếp, lịch sử, lỗi, lần chạy kế tiếp và hiển thị phiên bị crash. Nên học cách trình bày trạng thái; extension này không cần cả hệ thống Docker/API/dashboard riêng.
6. [safarsin/AutoRewarder](https://github.com/safarsin/AutoRewarder): README mô tả lịch sử, thống kê điểm thực và các module riêng; [card.py](https://github.com/safarsin/AutoRewarder/blob/main/src/dailytasks/card.py) phân biệt complete/locked/excluded/incomplete từ DOM.
7. [Chrome: service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): worker có thể bị kết thúc và mất biến toàn cục; dữ liệu cần phục hồi phải được lưu bền vững.

## Phát hiện trong code hiện tại

### P1 — Khóa phiên phải giữ đến hết cleanup

`js/run-coordinator.js:35`, `js/service.js:1600`, `js/service.js:5698`.

`stopCurrentSession()` xóa running/currentSession trước khi việc lưu và đóng tab/window
hoàn tất. `canStartNewRun()` chỉ xét running. Kiểm thử độc lập với chính module này
cho thấy canStartNewRun trả allowed=true khi promise lưu trạng thái Dừng còn đang chờ.

Hậu quả có thể xảy ra: người dùng Start ngay sau Stop trong khi cleanup cũ vẫn xử lý
các trường runtime dùng chung. Phần finally của phiên cũ còn ghi report/checkpoint
và lấy rsaWindowId từ config hiện tại.

Đề xuất: trạng thái stopping/cleaning giữ quyền sở hữu phiên; cleanup nhận tab/window
và sessionId đã chụp riêng. Chỉ phiên sở hữu tài nguyên mới được sửa hoặc đóng chúng.
Nút Dừng vẫn phản hồi ngay, còn Start chỉ bật lại sau cleanup.

### P1 — Checkpoint chưa đủ thông tin để phục hồi chính xác

`js/run-checkpoint.js`, `js/service.js:186`, `js/service.js:5730`.

Checkpoint lưu tổng done+failed và suy ra desktop trước, mobile sau. Dù có phase,
hàm tính remaining không sử dụng phase hoặc tiến độ riêng từng thiết bị.

Đã tái hiện bằng hàm thật: kế hoạch desktop=10/mobile=5, desktop đạt quota sớm sau
2 lượt rồi mobile chạy 3 lượt. Với completed=5, hàm trả desktop=5/mobile=5;
phần việc đúng phải là desktop=0/mobile=2. Preflight quota có thể giảm phần desktop
sau đó nhưng không sửa được phép phân bổ checkpoint ban đầu.

Các giới hạn khác: service không truyền accountKey khi lưu/kiểm tra; resume tạo
session và deadline mới; một phiên kết thúc không thành công vẫn có thể để lại
checkpoint mới đủ điều kiện để bootstrap khôi phục.

Đề xuất: lưu tiến độ/trạng thái kết thúc riêng desktop, mobile, activities;
giữ startedAt/deadline gốc; đánh dấu interrupted khác với stopped/finished;
kiểm tra phiên tài khoản và quota mới trước resume. Chỉ crash thật mới tự phục hồi.

### P1 — Mở liên kết chưa chứng minh nhiệm vụ hoàn thành

`js/service.js:4338` dùng `completed || offer.visitCompletes` để xác nhận.
Nếu solver không xác nhận được nhưng loại offer là visitCompletes, nhiệm vụ vẫn
được ghi thành công. Thuộc tính loại nhiệm vụ không chứng minh trang đã tải hay
server đã ghi nhận.

Đề xuất: xác nhận theo offerId/trạng thái hoàn thành của chính thẻ; nếu chỉ mở trang
thành công thì giữ uncertain và kiểm tra lại có giới hạn. Không lấy tăng tổng số dư
làm bằng chứng duy nhất cho một nhiệm vụ cụ thể.

### P1 — Bộ lọc API và DOM chưa thống nhất

`js/activity-policy.js`, `js/injected-scripts.js:492`, `js/injected-scripts.js:790`.

API có bộ phân loại riêng; hai scanner nhúng có regex riêng và không áp dụng đầy đủ
quy tắc từ chối nhiệm vụ không rõ. Khi không tìm thấy heading, scanner còn có nhánh
quét toàn trang. Readiness trước lượt đầu giảm rủi ro nhưng không bảo đảm DOM chưa đổi
ở lượt sau.

Đề xuất: dùng một chính sách phân loại chung, kiểm tra lại section ở từng lượt;
không nhận diện được vùng/nhiệm vụ thì bỏ qua kèm lý do. Disabled chỉ chứng minh
không thể thao tác, không tự động đồng nghĩa completed.

### P2 — Quota hiện tại là dự tính, chưa phải số lượt chắc chắn

`js/search-credit.js:8`, `js/rewards-metrics.js:71`.

Code dùng mặc định 3 điểm/lượt và chọn một counter đang có room. Cần kiểm chứng
bằng payload thực của tài khoản/market trước khi coi con số này là chính xác hoặc
thay thuật toán bằng cộng toàn bộ counter từ một repo khác.

Đề xuất: lưu quota snapshot cùng thời điểm đọc; phân biệt số điểm xác nhận và
số lượt dự kiến. Giữ giới hạn người dùng, không tự tăng số lượt vì điểm lên chậm.
Khi quota không tăng, lưu thời điểm được thử lại để lịch 5/15 phút không lặp cùng
một vòng phục hồi vô ích. Sau restart đọc lại snapshot trước khi sử dụng.

### P2 — Popup chưa phản ánh cơ chế quota mới

`popup.html`, `js/popup.js:231`, `js/popup-view-model.js:29`.

Màn hình chính vẫn là số lượt và bốn preset; chưa có điểm đã đạt, điểm còn thiếu,
thời điểm cập nhật hay nút làm mới quota. Trạng thái cuối chỉ hiển thị nhãn chung,
không đưa outcomeReason ra cho người dùng. Khi chỉ làm activities, báo cáo có thể
hiển thị 0/0 bước. Thời gian chạy chỉ cập nhật khi render/storage thay đổi.

Đề xuất màn hình chính:

```text
Hôm nay                         Làm mới
Máy tính      144 / 150 điểm     Còn 6
Điện thoại     90 /  90 điểm     Đã đủ
Nhiệm vụ      2 xong · 1 cần kiểm tra

Dự kiến tối đa 2 lượt · cập nhật 10 giây trước
[ Làm phần còn thiếu ]

Lần gần nhất: Cần kiểm tra — điểm chưa cập nhật
Lịch tự động ›             Tùy chọn ›
```

Các số trên chỉ minh họa thiết kế, không phải quota hiện tại của tài khoản.
Chuyển số lượt/preset sang Tùy chọn với nhãn “Giới hạn mỗi lần chạy”; thêm lựa chọn
“Chỉ nhiệm vụ” qua cùng nút Start. Báo cáo tách search và activities, có lý do
dừng/bỏ qua và số lần thử. Đồng hồ chỉ render từ state trong bộ nhớ mỗi giây,
không đọc/ghi storage liên tục. Điều chỉnh chiều cao popup để trạng thái chính
không bị đẩy ra ngoài vùng nhìn thấy.

## Thứ tự triển khai và kiểm thử

1. Khóa Stop/Start và quyền sở hữu tài nguyên; test Stop → Start nhanh, Stop hai lần,
   timeout → cleanup và phiên cũ hoàn tất sau khi phiên mới đã bắt đầu.
2. Checkpoint theo từng pha; test desktop đầy sớm, worker restart giữa mobile,
   đổi tài khoản, checkpoint hết hạn, giữ deadline gốc và không resume phiên kết thúc.
3. Xác nhận activity và chính sách DOM chung; test trang lỗi/redirect, thẻ disabled,
   mất section sau hydrate, nhiệm vụ lạ và điểm từ hoạt động khác.
4. Quota snapshot/cooldown và popup; test counter thiếu/null, nhiều tier, trễ điểm,
   activities-only, layout sáng/tối và thao tác bàn phím trong extension thật.

Lượt đánh giá này không sửa cơ chế chạy. Hai tình huống được tái hiện bằng Node
với module hiện tại, không thao tác tài khoản Rewards. Bộ test đã đạt trước đây
không chứng minh các tình huống thiếu coverage ở trên đã an toàn.

## Triển khai sau đánh giá — 2.3.0

Đã sửa khóa phiên đến hết cleanup; checkpoint v2 lưu tiến độ theo thiết bị,
giữ deadline và kiểm tra hash tài khoản. Phiên kết thúc luôn xóa checkpoint.
API/DOM dùng cùng bộ phân loại; thiếu section thì không click. Nhiệm vụ chỉ được
xác nhận bằng đúng offer đã hoàn thành; claim cần thấy trạng thái hết điểm chờ.
Đã lưu snapshot quota và cooldown từng thiết bị, đưa quota/làm mới lên màn hình
chính, chuyển giới hạn lượt sang Tùy chọn và bổ sung lý do trong báo cáo.

Kiểm thử: 136 ca Node đạt, gồm race Dừng/Chạy, cleanup lỗi, checkpoint sai tài khoản,
quota null/cũ/cooldown, offer chưa hoàn thành và scanner mất section. Đã kiểm tra
popup trên localhost bằng trình duyệt với mock Chrome API. Chưa xác minh lượt kiếm
điểm thật bằng extension đã reload: công cụ không cho truy cập trang quản lý extension.
Không cộng gộp counter nhiều tier khi chưa có bằng chứng payload; số lượt vẫn là
ước tính 3 điểm/lượt. Không tự resume nếu API không cung cấp định danh tài khoản.
