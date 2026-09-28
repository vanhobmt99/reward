# Search Auto

Rewards Search Automator. Tự động tìm kiếm Bing hằng ngày cho Microsoft Rewards.

Nếu thấy project hữu ích, donate để phát triển ứng dụng, hoặc [thêm một sao](https://github.com/vanhobmt99/reward) để mình có động lực phát triển.

## Ủng hộ

Quét mã bên dưới, hoặc chuyển khoản theo số tài khoản.

### Vietcombank

<img src="docs/vietcombank.png" alt="Vietcombank QR" width="140" height="181" />

- Chủ tài khoản: HO VIET VAN
- Số tài khoản: `0231000639001`
- Ngân hàng: Ngân hàng TMCP Ngoại Thương Việt Nam (Vietcombank)

### MoMo

<img src="docs/momo.jpg" alt="MoMo QR" width="140" height="153" />

- Chủ ví: HO VIET VAN
- Số MoMo: `0326363942`

## Hướng dẫn sử dụng

Chạy ổn định trên **Google Chrome**. Trên **Microsoft Edge**, phần tìm kiếm Bing vẫn có thể chạy, nhưng phần tự làm nhiệm vụ (Daily set, Keep earning, Claim) có thể bị Edge chặn. Edge không cho extension điều khiển `https://rewards.bing.com`. Popup sẽ báo trình duyệt đang chặn, tab Rewards được giữ mở để bạn bấm tay. Tải lại trang không gỡ được chặn này.

### Cài trên Chrome

1. Mở `chrome://extensions`.
2. Bật **Chế độ dành cho nhà phát triển**.
3. Bấm **Tải tiện ích đã giải nén** và chọn thư mục project này.
4. Ghim Search Auto lên thanh công cụ.
5. Đăng nhập tài khoản Microsoft trên Bing và Rewards trong chính profile Chrome đó.

### Chạy một lần

1. Mở popup.
2. Chọn số lần **Máy tính** và **Điện thoại**, hoặc bấm một mức có sẵn: `11 · 0`, `21 · 11`, `31 · 21`, `51 · 31`.
3. Bấm **Làm nhiệm vụ**. Extension tự tìm kiếm, rồi tự bấm nhiệm vụ kiếm điểm trong ngày.
4. Dòng dưới nút hiện tiến độ. Muốn dừng, bấm lại nút khi nó đang là **Dừng**.

Giữa mỗi lần tìm, tab đứng yên một lúc. Đó là khoảng chờ đã cấu hình, không phải lỗi.

### Lịch tự động

Mở **Lịch tự động** trong popup, chọn số lần và tần suất, rồi bấm **Đặt lịch**.

| Chế độ                    | Việc extension làm                                |
| ------------------------- | ------------------------------------------------- |
| Thủ công                  | Không tự chạy. **Đặt lịch** chạy ngay một lần.    |
| Khi mở trình duyệt        | Tự chạy một lần mỗi khi mở Chrome.                |
| ~5 phút/lần, ~15 phút/lần | Lặp lại theo chu kỳ, có lệch nhẹ cho đỡ đều.      |
| Hàng ngày lúc…            | Một lần mỗi ngày vào giờ đã chọn, mặc định 08:00. |

Lịch chỉ chạy khi Chrome đang mở. Đến giờ mà Chrome tắt thì lần đó bị bỏ, không chạy bù.

### Nâng cao

Mở **Nâng cao** trong popup.

- **Tối thiểu / Tối đa**: số giây chờ giữa hai lần tìm.
- **Chủ đề tìm kiếm**: mặc định theo chủ đề. Có thể chọn Công nghệ, Thể thao, Ẩm thực, Sức khỏe, Tài chính, Khoa học, Game, Thiên nhiên, Lịch sử hoặc Việt Nam.
- **Tự làm nhiệm vụ sau khi search**: bật thì hết phần tìm kiếm sẽ sang bấm nhiệm vụ.
- **Chỉ làm nhiệm vụ**: nút **Chạy** chỉ làm Daily set và các nhiệm vụ còn lại, không tìm kiếm.
- **Thiết bị giả lập**: điểm điện thoại cần giả lập máy. Nút làm mới chọn lại một thiết bị ngẫu nhiên.
- **Tối ưu điểm Mobile** và **Sao lưu & khôi phục đăng nhập Rewards**: giữ bật nếu muốn điểm điện thoại được tính và không mất đăng nhập sau pha mobile.

Các nút đỏ (xoá dữ liệu duyệt web, xoá lịch sử, đặt lại) không hoàn tác. Bấm lần đầu nút thành «Chắc chắn?», bấm lần nữa trong 3 giây mới chạy. Xoá lịch sử Bing xoá mọi lượt truy cập của các URL đó, không chỉ 24 giờ gần nhất.

Trong popup, **Hướng dẫn sử dụng → Mở** cũng mở bản hướng dẫn này ngay trong extension.
