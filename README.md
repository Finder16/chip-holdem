# Chip Hold'em (친구용 칩 텍사스 홀덤)

Cloudflare Workers + Durable Objects로 방(테이블) 상태를 실시간(WebSocket)으로 동기화합니다.

- 현금/환전/도박 기능 없음: 칩만 사용
- 입장: 방 코드 + 닉네임
- 시작 칩: 10,000

## 로컬 실행

```bash
npm run dev
```

실행 후 출력되는 로컬 주소로 접속해서 방 생성/입장하면 됩니다.

## 배포

```bash
npm run deploy
```

배포 전에 `wrangler login`이 필요할 수 있습니다.
