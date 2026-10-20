const h1 = document.querySelector("h1");
const h2 = document.querySelector("h2");
const urlParams = new URLSearchParams(window.location.search);
const type = urlParams.get("type");
const map = {
  clear: {
    h1: "Đang áp dụng bản vá (Nâng cao v1.5.8)",
    h2: "Vui lòng đợi trong khi áp dụng bản vá. Tránh sử dụng bất kỳ dịch vụ Microsoft nào khi đang dùng cài đặt này.",
  },
  attach: {
    h1: "Đang gắn Debugger",
    h2: "Vui lòng đợi trong khi gắn Debugger. Bạn có thể thấy thông báo của trình duyệt rằng extension đã bắt đầu gỡ lỗi trình duyệt.",
  },
  simulate: {
    h1: "Đang chuyển thiết bị giả lập",
    h2: "Vui lòng đợi trong khi chuyển thiết bị giả lập. Bạn có thể thấy thông báo của trình duyệt rằng extension đã bắt đầu gỡ lỗi trình duyệt.",
  },
  detach: {
    h1: "Đang gỡ thiết bị giả lập",
    h2: "Vui lòng đợi trong khi gỡ Debugger. Bạn có thể thấy thông báo của trình duyệt rằng phần gỡ lỗi trình duyệt của extension sẽ được gỡ bỏ.",
  },
  complete: {
    h1: "Đang hoàn tất các tìm kiếm của thiết bị.",
    h2: "Vui lòng đợi trong khi hoàn tất các tìm kiếm của thiết bị đã chỉ định.",
  },
  default: {
    h1: "Chưa chỉ định hành động",
    h2: "Vui lòng chỉ định một hành động để thực hiện.",
  },
};
const patch = map[type] || map.default;
if (h1) h1.innerText = patch.h1;
if (h2) h2.innerText = patch.h2;
const screenWidth = screen.width;
const scale = screenWidth > 720 ? screenWidth / 1920 : 1;
document.body.style.setProperty("--scale", scale);
