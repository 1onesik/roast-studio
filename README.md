# Roast Studio · Popcorn Edition

아이패드 Safari 및 GitHub Pages 환경에 최적화된 팝콘 로스터 계측 웹 앱(PWA)입니다.

## GitHub Pages 배포 방법

1. 이 폴더(`roast-studio`)의 파일들을 GitHub 저장소 루트에 업로드합니다.
2. 저장소의 **Settings → Pages**에서 **Branch: `main` / `/ (root)`**를 선택하고 저장합니다.
3. 생성된 `https://<username>.github.io/<repo>/` 주소로 아이패드 Safari에서 접속합니다.
4. Safari 공유 버튼 → **홈 화면에 추가**를 누르면 전체화면 PWA로 실행됩니다.

## 폴더 구조

- `index.html` — 시맨틱 마크업 및 네이티브 `<dialog>` 모달
- `css/app.css` — Apple 다크 디자인 토큰, 레이아웃, 라이트 리포트 스타일
- `js/state.js` — 로스팅 상태, 프리셋, `localStorage` 자동 복구
- `js/chart.js` — 실시간 BT/RoR/프로파일 차트 및 리포트 차트
- `js/ocr.js` — 후면 카메라 줌, 7-세그먼트 전처리, Tesseract.js OCR
- `js/report.js` — 라이트 테마 PNG 리포트, CSV 로그, Web Share 공유
- `js/app.js` — 타이머, 3자리 자동 입력 키패드, 1초 홀드 배출, `<dialog>` 제어
- `manifest.webmanifest`, `sw.js` — PWA 매니페스트 및 오프라인 캐시
