// server/src/utils/testSendGrid.ts
import { sendMail } from "./sendMail.js";

export async function testSendGridConnection() {
  console.log("SendGrid 연결 테스트 시작...");
  
  // 환경 변수 확인
  const apiKey = process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY;
  const fromEmail = process.env.MAIL_FROM;
  
  console.log("API Key 존재:", !!apiKey);
  console.log("From Email:", fromEmail);
  
  if (!apiKey) {
    console.error("❌ SENDGRID_API_KEY 환경 변수가 설정되지 않았습니다.");
    return false;
  }
  
  // 테스트 메일 전송
  try {
    const testEmail = "test@example.com"; // 실제 테스트할 이메일로 변경
    const result = await sendMail(
      testEmail,
      "SendGrid 테스트",
      "<h1>SendGrid 연결 테스트</h1><p>이 메일이 도착했다면 SendGrid가 정상적으로 작동하고 있습니다.</p>"
    );
    
    if (result) {
      console.log("✅ SendGrid 테스트 성공!");
      return true;
    } else {
      console.log("❌ SendGrid 테스트 실패");
      return false;
    }
  } catch (error) {
    console.error("❌ SendGrid 테스트 중 오류:", error);
    return false;
  }
}

// 직접 실행 시 테스트
if (import.meta.url === `file://${process.argv[1]}`) {
  testSendGridConnection();
}