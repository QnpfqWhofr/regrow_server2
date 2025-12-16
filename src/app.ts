// server/src/app.ts
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";

// 기존 라우터
import authRouter from "./routes/auth";
// 새 라우터 추가
import productsRouter from "./routes/products";
import uploadRouter from "./routes/upload";
import chatRouter from "./routes/chat";
import reviewRouter from "./routes/reviews";
// 스케줄러
import { startProductScheduler } from "./utils/productScheduler";

const app = express();

// CORS 설정 — 프리플라이트(OPTIONS) 완전 허용
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://regrow-web.vercel.app",
  "https://disclaimers-conservation-genes-headers.trycloudflare.com",
];

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (!origin || allowedOrigins.includes(origin)) {
    const allowOrigin = origin || allowedOrigins[0];
    res.header("Access-Control-Allow-Origin", allowOrigin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true, // 쿠키/인증 허용
}));


// 바디/쿠키
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// 업로드 파일 정적 제공 (/uploads/파일명 으로 접근)
app.use("/uploads", cors({
  origin: true,
  credentials: true
}));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// 헬스체크
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 실제 라우터
app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/uploads", uploadRouter);
app.use("/api/chat", chatRouter);
app.use("/api/reviews", reviewRouter);

(async () => {
  try {
    // ⚠️ .env 키 이름 확인: 현재 코드는 MONGO_URI 사용
    // 예: MONGO_URI=mongodb://127.0.0.1:27017/krush
    await mongoose.connect(process.env.MONGO_URI!);
    console.log("MongoDB connected");

    // 판매완료 상품 자동 삭제 스케줄러 시작
    startProductScheduler();

    const port = Number(process.env.PORT) || 4000;
    const host = process.env.HOST ?? "0.0.0.0";

    app.listen(port, host, () => {
      console.log(
        `Server running at http://${
          host === "0.0.0.0" ? "127.0.0.1" : host
        }:${port}`
      );
    });
  } catch (err) {
    console.error("Server startup failed:", err);
  }
})();

export default app;
