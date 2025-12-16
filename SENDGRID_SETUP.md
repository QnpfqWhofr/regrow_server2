# SendGrid 설정 가이드

## 1. SendGrid 계정 설정

1. [SendGrid 웹사이트](https://sendgrid.com)에서 계정 생성
2. 이메일 인증 완료
3. 무료 플랜으로 시작 (월 100통 무료)

## 2. API Key 생성

1. SendGrid 대시보드 로그인
2. **Settings** > **API Keys** 메뉴로 이동
3. **Create API Key** 클릭
4. **Full Access** 권한 선택 (또는 Mail Send 권한만)
5. API Key 복사 (한 번만 표시됨!)

## 3. Sender Authentication 설정

### 방법 1: Single Sender Verification (간단)
1. **Settings** > **Sender Authentication** 메뉴
2. **Single Sender Verification** 선택
3. 발신자 이메일 주소 입력 (예: noreply@yourdomain.com)
4. 해당 이메일로 온 인증 메일 확인

### 방법 2: Domain Authentication (권장)
1. **Settings** > **Sender Authentication** 메뉴
2. **Domain Authentication** 선택
3. 도메인 입력 (예: yourdomain.com)
4. DNS 레코드 설정 (도메인 관리 패널에서)

## 4. 환경 변수 설정

`.env` 파일에 다음 설정 추가:

```env
# SendGrid 설정
SENDGRID_API_KEY=SG.your_api_key_here
MAIL_FROM=noreply@yourdomain.com  # 인증된 발신자 이메일
```

## 5. 테스트

서버에서 다음 명령으로 테스트:

```bash
# 개발 서버 실행 후
curl -X POST http://localhost:4000/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"your-test-email@gmail.com"}'
```

## 6. 문제 해결

### 일반적인 오류들:

1. **403 Forbidden**
   - API Key 권한 부족
   - API Key가 잘못됨

2. **401 Unauthorized**
   - API Key가 유효하지 않음
   - 환경 변수 설정 확인

3. **400 Bad Request**
   - 발신자 이메일이 인증되지 않음
   - Sender Authentication 설정 필요

4. **550 Unauthenticated senders not allowed**
   - Single Sender Verification 또는 Domain Authentication 필요

### 디버깅 방법:

1. 서버 로그 확인:
   ```bash
   npm run dev
   ```

2. SendGrid Activity Feed 확인:
   - SendGrid 대시보드 > **Activity Feed**

3. 환경 변수 확인:
   ```javascript
   console.log("SENDGRID_API_KEY:", !!process.env.SENDGRID_API_KEY);
   console.log("MAIL_FROM:", process.env.MAIL_FROM);
   ```

## 7. 현재 설정 상태

현재 `.env` 파일 설정:
- ✅ SENDGRID_API_KEY 설정됨
- ✅ MAIL_FROM 설정됨
- ⚠️  발신자 이메일 인증 상태 확인 필요

## 8. 다음 단계

1. SendGrid 대시보드에서 `noreply@regrow.com` 인증
2. 또는 실제 소유한 도메인의 이메일로 변경
3. 테스트 메일 발송 확인

## 참고 링크

- [SendGrid 공식 문서](https://docs.sendgrid.com/)
- [Node.js 가이드](https://docs.sendgrid.com/for-developers/sending-email/nodejs)
- [Sender Authentication](https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication)