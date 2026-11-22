# 네이버 + Claude 브라우저

네이버(또는 아무 사이트)를 보면서, 지금 보고 있는 페이지 내용을 Claude에게 보내 요약·정리·질문할 수 있는 데스크톱 브라우저입니다. (Electron + Anthropic SDK)

## 실행

```bash
npm install
npm start
```

처음 실행하면 오른쪽 패널에 Anthropic API 키를 입력하세요 (https://console.anthropic.com 에서 발급).
키는 OS 키체인으로 암호화되어 사용자 데이터 폴더의 `config.json`에 저장됩니다. 환경변수 `ANTHROPIC_API_KEY`가 있으면 그것을 우선 사용합니다.

## 사용법

- 주소창: URL을 입력하거나 검색어를 입력하면 네이버 검색으로 이동합니다. `N` 버튼은 네이버 홈.
- **현재 페이지 내용 첨부**를 켜면 페이지 텍스트가 질문과 함께 Claude에게 갑니다.
  페이지에서 텍스트를 드래그해 선택하면 선택한 부분만 보냅니다.
- 블로그·카페처럼 본문이 iframe 안에 있는 페이지도 같은 도메인이면 본문까지 읽습니다.
- 빠른 버튼: 요약 / 표로 정리 / 항목 추출. 대화는 이어지며 `새 대화`로 초기화합니다.

## 구조

| 파일 | 역할 |
|---|---|
| `main.js` | 창 생성, API 키 저장, Claude API 호출(스트리밍) |
| `preload.js` | 화면에 노출하는 안전한 IPC API |
| `renderer.js` | 브라우저 조작, 페이지 텍스트 추출, 채팅 UI |
| `index.html`, `style.css` | 화면 |

모델은 `claude-opus-5-5`이며, 안전 분류기가 거절한 경우 서버가 다른 모델로 자동 재시도하도록(`fallbacks: "default"`) 설정되어 있습니다. 모델 변경은 `main.js`의 `MODEL` 상수에서 할 수 있습니다.
