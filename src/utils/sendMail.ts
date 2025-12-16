// server/src/utils/sendMail.ts
import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config();

const DEFAULT_FROM = process.env.MAIL_FROM || "dsmhwjh0627@dgsw.hs.kr";
const SENDGRID_API_KEYEE = process.env.SENDGRID_API_KEY;

// SendGrid API 키 설정
if (SENDGRID_API_KEYEE) {
  sgMail.setApiKey(SENDGRID_API_KEYEE);
} else {
  console.warn("SendGrid API Key가 설정되지 않았습니다. 메일 전송이 실패할 수 있습니다.");
}

export async function sendMail(to: string | string[], subject: string, html: string) {
  try {
    if (!SENDGRID_API_KEYEE) {
      console.error("SendGrid API Key가 없습니다.");
      return false;
    }

    const toAddresses = Array.isArray(to) ? to : [to];

    const msg = {
      to: toAddresses,
      from: {
        email: DEFAULT_FROM,
        name: "ReGrow",
      },
      subject,
      html,
      text: html.replace(/<[^>]*>/g, ""), // HTML 태그 제거해서 텍스트 버전 생성
    };

    const response = await sgMail.send(msg);
    console.log("메일 전송 성공:", response[0].statusCode);
    return true;
  } catch (err: any) {
    console.error("메일 전송 실패:", err);
    
    // SendGrid 에러 상세 정보 출력
    if (err.response) {
      console.error("SendGrid 에러 응답:", err.response.body);
    }
    
    return false;
  }
}
