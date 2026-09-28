const devices = [
  {
    name: "iPhone 15",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/16A148 Safari/605.1.15",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 15 Plus",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/16A148 Safari/605.1.15",
    width: 414,
    height: 896,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 15 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/16A148 Safari/605.1.15",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 15 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/16A148 Safari/605.1.15",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 14",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 14 Plus",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    width: 414,
    height: 896,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 14 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 14 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 13",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 13 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 13 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 12",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "iPhone 12 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S23",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S23 Plus",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 414,
    height: 896,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S23 Ultra",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S22",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S22 Plus",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-S906B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 414,
    height: 896,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S22 Ultra",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S21",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S21 Plus",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-G996B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 414,
    height: 896,
    deviceScaleFactor: 3,
  },
  {
    name: "Samsung Galaxy S21 Ultra",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "OnePlus 11",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; GM1900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "OnePlus 11 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; GM1910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "OnePlus 11R",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; GM1920) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "OnePlus 11T",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; GM1930) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Xiaomi 13",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; MI-13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Xiaomi 13 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; MI-13Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 414,
    height: 896,
    deviceScaleFactor: 3,
  },
  {
    name: "Xiaomi 13 Ultra",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; MI-13Ultra) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Xiaomi 13S",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; MI-13S) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Xiaomi 13S Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; MI-13SPro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Xiaomi 13 Lite",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; MI-13Lite) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 2.5,
  },
  {
    name: "Vivo V27",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2300) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Vivo V27e",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2305) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
  },
  {
    name: "Vivo V27 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2310) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Vivo V27 4G",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; V2340) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
  },
  {
    name: "Vivo X90",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Vivo X90 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Vivo X90 Pro+",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2215) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme GT 5",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; RMX3300) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme GT 5 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; RMX3310) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme Narzo 60",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; RMX3161) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme Narzo 60 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; RMX3163) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme 50",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; RMX3092) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme 50 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; RMX3093) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme 11",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; RMX3561) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme 11 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; RMX3563) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme 11 Pro+",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; RMX3565) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme 10",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; RMX3511) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme 10 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; RMX3513) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme GT 4",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; RMX3200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme GT 4 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; RMX3210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Realme GT 4 Pro Master Edition",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; RMX3215) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO Z7",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2148A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO Z6 Lite 5G",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2115A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO Z6 5G",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2144A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO Z6 Pro 5G",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2145A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO 10",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2231A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO 10 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2232A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO 11",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2331A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "iQOO 11 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; V2332A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Oppo Reno 10",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; CPH2417) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
  },
  {
    name: "Oppo Reno 10 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; CPH2407) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  {
    name: "Oppo Reno 10 Pro+",
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; CPH2405) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
  },
  {
    name: "Oppo F23",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; CPH2427) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
  },
  {
    name: "Oppo F23 Pro",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; CPH2425) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
];
export { devices };
