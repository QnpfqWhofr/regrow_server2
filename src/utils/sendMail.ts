// server/src/utils/sendMail.ts
import sgMail from "@sendgrid/mail";

const DEFAULT_FROM = process.env.MAIL_FROM || "dsmhwjh0627@dgsw.hs.kr";
const SENDGRID_API_KEY = "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";

// SendGrid API 키 설정
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
} else {
  console.warn("SendGrid API Key가 설정되지 않았습니다. 메일 전송이 실패할 수 있습니다.");
}

export async function sendMail(to: string | string[], subject: string, html: string) {
  try {
    if (!SENDGRID_API_KEY) {
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
