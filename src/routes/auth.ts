// server/src/routes/auth.ts
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import bcrypt from "bcryptjs";

import EmailCode from "../models/EmailCode.js";
import User from "../models/User.js";
import {
  signUser,
  setAuthCookie,
  clearAuthCookie,
  readUserFromReq,
} from "../utils/authToken.js";
import { sendMail } from "../utils/sendMail.js";



/* ---------------------- utils ---------------------- */
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
const mask = (s?: string) => (s ? s.slice(0, 2) + "***" : "(missing)");

/* ---------------------- schema --------------------- */
const sendSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});
const signupSchema = z.object({
  userId: z.string().min(3),
  password: z.string().min(4),
  email: z.string().email(),
});
const loginSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(1),
});

/* -------------------- router ----------------------- */
const router = Router();
const limiter = rateLimit({ windowMs: 60_000, max: 10 });

/**
 * POST /api/auth/send-code
 * body: { email }
 */
router.post("/send-code", limiter, async (req, res) => {
  try {
    const { email } = sendSchema.parse(req.body);

    // 6자리 코드 생성 & 만료 10분
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await EmailCode.findOneAndUpdate(
      { email },
      { code, expiresAt, attempts: 0 },
      { upsert: true, new: true }
    );

    const ok = await sendMail(
      email,
      "ReGrow 이메일 인증코드",
      `<p>인증코드: <b style="font-size:18px;">${code}</b></p><p>10분 이내에 입력해 주세요.</p>`
    );
    if (!ok) {
      return res.status(500).json({ ok: false, error: "메일 전송에 실패했습니다." });
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("send-code error:", e);
    const msg = e?.message || "Failed to send email code";
    return res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * POST /api/auth/verify-code
 * body: { email, code }
 */
router.post("/verify-code", limiter, async (req, res) => {
  try {
    const { email, code } = verifySchema.parse(req.body);

    const doc = await EmailCode.findOne({ email });
    if (!doc) {
      return res
        .status(400)
        .json({ ok: false, error: "코드를 다시 요청하세요." });
    }

    if (doc.expiresAt.getTime() < Date.now()) {
      await doc.deleteOne();
      return res
        .status(400)
        .json({ ok: false, error: "코드가 만료되었습니다." });
    }

    if (doc.attempts >= 5) {
      return res.status(429).json({ ok: false, error: "시도 횟수 초과" });
    }

    if (doc.code !== code) {
      doc.attempts += 1;
      await doc.save();
      return res
        .status(400)
        .json({ ok: false, error: "인증코드가 일치하지 않습니다." });
    }

    // 성공 시 사용 완료 처리
    await EmailCode.deleteOne({ email });
    return res.json({ ok: true, verified: true });
  } catch (e: any) {
    console.error("verify-code error:", e);
    const msg = e?.message || "Failed to verify code";
    return res.status(400).json({ ok: false, error: msg });
  }
});

/**
 * POST /api/auth/signup
 * body: { userId, password, email }
 */
router.post("/signup", limiter, async (req, res) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        ok: false, 
        error: parsed.error.issues[0]?.message || "입력 정보를 확인해주세요." 
      });
    }

    const { userId, password, email } = parsed.data;

    // userId가 비어있거나 null인 경우 명시적으로 체크
    const trimmedUserId = userId.trim();
    if (!trimmedUserId || trimmedUserId.length === 0) {
      return res.status(400).json({ 
        ok: false, 
        error: "아이디를 입력해주세요." 
      });
    }

    // email 중복 체크만 수행 (userId는 중복 허용)
    const trimmedEmail = email.trim();
    const existingByEmail = await User.findOne({ email: trimmedEmail });

    if (existingByEmail) {
      console.log("[SIGNUP] Duplicate email found:", existingByEmail.email);
      return res
        .status(409)
        .json({ ok: false, error: "이미 사용 중인 이메일입니다." });
    }

    // userId 중복 체크: 이미 같은 userId가 있으면 뒤에 '1' 추가
    let finalUserId = trimmedUserId;
    let attempts = 0;
    const maxAttempts = 100; // 무한 루프 방지
    
    while (attempts < maxAttempts) {
      const existingByUserId = await User.findOne({ userId: finalUserId });
      if (!existingByUserId) {
        break; // 중복되지 않으면 종료
      }
      finalUserId = finalUserId + '1';
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      return res.status(409).json({ 
        ok: false, 
        error: "시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요." 
      });
    }
    
    if (finalUserId !== trimmedUserId) {
      console.log("[SIGNUP] UserId changed from", trimmedUserId, "to", finalUserId, "due to duplicate");
    }

    // userId가 null이 되지 않도록 최종 확인
    if (!finalUserId || finalUserId.length === 0) {
      return res.status(400).json({ 
        ok: false, 
        error: "아이디가 유효하지 않습니다." 
      });
    }

    const hash = await bcrypt.hash(password, 10);
    
    // 사용자 생성 (애플리케이션 레벨에서 이미 중복 체크 완료)
    try {
    const user = await User.create({
        userId: finalUserId,
      passwordHash: hash,
        email: trimmedEmail,
        emailVerified: true,
    });
        
      console.log("[SIGNUP] User created successfully:", user.userId);

    return res.json({
      ok: true,
        user: {
          id: String(user._id),
          userId: user.userId,
          email: user.email,
          profileImage: user.profileImage || "",
        },
      });
    } catch (createError: any) {
      // email에 대한 unique 제약 조건 위반 (userId는 이미 체크했으므로 email만 처리)
      if (createError.code === 11000) {
        const keyPattern = createError.keyPattern || {};
        const field = Object.keys(keyPattern)[0] || "필드";
        
        return res.status(409).json({ 
          ok: false, 
          error: `이미 사용 중인 ${field === "email" ? "이메일" : field}입니다.` 
        });
      }
      
      // 다른 에러는 그대로 throw
      throw createError;
    }

  } catch (e: any) {
    console.error("signup error:", e);
    
    // MongoDB duplicate key error 처리 (email만 unique이므로 email 관련 에러만 처리)
    if (e.code === 11000) {
      const keyPattern = e.keyPattern || {};
      const field = Object.keys(keyPattern)[0] || "필드";
      
      return res.status(409).json({ 
        ok: false, 
        error: `이미 사용 중인 ${field === "email" ? "이메일" : field}입니다.`
      });
    }
    
    const msg = e?.message || "Failed to signup";
    return res.status(400).json({ ok: false, error: msg });
  }
});

/** 로그인 */
router.post("/login", limiter, async (req, res) => {
  try {
    const { userId, password } = loginSchema.parse(req.body);

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "아이디 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({
        ok: false,
        error: "아이디 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    const token = signUser({
      id: String(user._id),
      userId: user.userId,
      email: user.email,
    });

    setAuthCookie(res, token);
    return res.json({
      ok: true,
      user: {
        id: String(user._id),
        userId: user.userId,
        email: user.email,
        profileImage: user.profileImage || "",
      },
    });
  } catch (e: any) {
    console.error("login error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "login failed" });
  }
});

/** 내 정보(me) */
router.get("/me", async (req, res) => {
  const u = readUserFromReq(req);
  if (!u) return res.status(401).json({ ok: false, error: "unauthorized" });
  
  const user = await User.findById(u.id);
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });
  
  return res.json({
    ok: true,
    user: {
      id: String(user._id),
      userId: user.userId,
      email: user.email,
      profileImage: user.profileImage || "",
      location: (user as any).location || "대구광역시 수성구 범어동",
      gameCoins: user.gameCoins ?? 200,
      gameLevel: user.gameLevel ?? 1,
      gameProgressPct: user.gameProgressPct ?? 0,
      gameProgressPoints: (() => {
        const points = (user as any).gameProgressPoints;
        if (points !== undefined && points !== null) return points;
        // progressPoints가 없으면 progressPct 기반으로 계산
        const level = user.gameLevel ?? 1;
        const pct = user.gameProgressPct ?? 0;
        return Math.floor((pct / 100) * (level * 100));
      })(),
      gameLastCollectAt: user.gameLastCollectAt
        ? new Date(user.gameLastCollectAt).getTime()
        : null,
      gameLevelUpRewardPending: (user as any).gameLevelUpRewardPending ?? false,
      gameTreesGrown: (user as any).gameTreesGrown ?? 0,
      gameWaterCans: (user as any).gameWaterCans ?? 3,
      gameFertilizers: (user as any).gameFertilizers ?? 2,
      gameGrowthBoosters: (user as any).gameGrowthBoosters ?? 0,
    },
  });
});

/** 게임 정보 업데이트 */
router.patch("/game", async (req, res) => {
  const u = readUserFromReq(req);
  if (!u) return res.status(401).json({ ok: false, error: "unauthorized" });

  const Body = z.object({
    coins: z.number().int().min(0).optional(),
    level: z.number().int().min(1).optional(),
    progressPct: z.number().min(0).max(100).optional(),
    progressPoints: z.number().int().min(0).optional(),
    lastCollectAt: z.number().nullable().optional(),
    treesGrown: z.number().int().min(0).optional(),
    waterCans: z.number().int().min(0).optional(),
    fertilizers: z.number().int().min(0).optional(),
    growthBoosters: z.number().int().min(0).optional(),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.message });
  }

  const user = await User.findById(u.id);
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

  const previousLevel = user.gameLevel || 1;

  if (parsed.data.coins !== undefined) user.gameCoins = parsed.data.coins;
  if (parsed.data.level !== undefined) {
    // 레벨 4 달성 시 나무 완성 처리
    if (parsed.data.level >= 4) {
      (user as any).gameTreesGrown = ((user as any).gameTreesGrown || 0) + 1;
      user.gameLevel = 1; // 레벨 1로 리셋
      user.gameProgressPct = 0; // 진행도 0으로 리셋
      // 나무 완성 보상 (500 코인)
      user.gameCoins = (user.gameCoins || 0) + 500;
    } else {
      // 일반 레벨업 감지 시 자동으로 코인 지급
      if (parsed.data.level > previousLevel) {
        const levelUpReward = (parsed.data.level - 1) * 100;
        user.gameCoins = (user.gameCoins || 0) + levelUpReward;
      }
      user.gameLevel = parsed.data.level;
    }
  }
  if (parsed.data.progressPct !== undefined && user.gameLevel < 4) {
    user.gameProgressPct = parsed.data.progressPct;
  }
  if (parsed.data.progressPoints !== undefined) {
    (user as any).gameProgressPoints = parsed.data.progressPoints;
  }
  if (parsed.data.lastCollectAt !== undefined) {
    user.gameLastCollectAt = parsed.data.lastCollectAt
      ? new Date(parsed.data.lastCollectAt)
      : null;
  }
  if (parsed.data.treesGrown !== undefined) {
    (user as any).gameTreesGrown = parsed.data.treesGrown;
  }
  if (parsed.data.waterCans !== undefined) {
    (user as any).gameWaterCans = parsed.data.waterCans;
  }
  if (parsed.data.fertilizers !== undefined) {
    (user as any).gameFertilizers = parsed.data.fertilizers;
  }
  if (parsed.data.growthBoosters !== undefined) {
    (user as any).gameGrowthBoosters = parsed.data.growthBoosters;
  }

  await user.save();

  return res.json({
    ok: true,
    game: {
      coins: user.gameCoins,
      level: user.gameLevel,
      progressPct: user.gameProgressPct,
      progressPoints: (user as any).gameProgressPoints || 0,
      lastCollectAt: user.gameLastCollectAt
        ? new Date(user.gameLastCollectAt).getTime()
        : null,
      treesGrown: (user as any).gameTreesGrown || 0,
      waterCans: (user as any).gameWaterCans || 0,
      fertilizers: (user as any).gameFertilizers || 0,
      growthBoosters: (user as any).gameGrowthBoosters || 0,
    },
  });
});

/** 프로필 업데이트 */
router.patch("/profile", async (req, res) => {
  const u = readUserFromReq(req);
  if (!u) return res.status(401).json({ ok: false, error: "unauthorized" });

  const Body = z.object({
    profileImage: z
      .string()
      .min(1)
      .refine(
        (val) =>
          val.startsWith("http://") ||
          val.startsWith("https://") ||
          val.startsWith("/uploads/"),
        { message: "이미지 경로는 /uploads/ 또는 절대 URL이어야 합니다." }
      )
      .optional(),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.message });
  }

  const user = await User.findById(u.id);
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

  if (parsed.data.profileImage !== undefined) {
    user.profileImage = parsed.data.profileImage;
  }

  await user.save();

  return res.json({
    ok: true,
    user: {
      id: String(user._id),
      userId: user.userId,
      email: user.email,
      profileImage: user.profileImage || "",
    },
  });
});

/** 사용자 정보 업데이트 */
router.patch("/user-info", async (req, res) => {
  const u = readUserFromReq(req);
  if (!u) return res.status(401).json({ ok: false, error: "unauthorized" });

  const Body = z.object({
    userId: z.string().min(3).optional(),
    email: z.string().email().optional(),
    location: z.string().min(1).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(4).optional(),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.message });
  }

  const user = await User.findById(u.id);
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

  // 비밀번호 변경 시 현재 비밀번호 확인
  if (parsed.data.newPassword) {
    if (!parsed.data.currentPassword) {
      return res.status(400).json({ ok: false, error: "현재 비밀번호를 입력해주세요." });
    }
    const isValid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: "현재 비밀번호가 올바르지 않습니다." });
    }
    user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  }

  // userId 변경 시 중복 체크
  if (parsed.data.userId && parsed.data.userId !== user.userId) {
    const existing = await User.findOne({ userId: parsed.data.userId });
    if (existing) {
      return res.status(409).json({ ok: false, error: "이미 사용 중인 아이디입니다." });
    }
    user.userId = parsed.data.userId;
  }

  // email 변경 시 중복 체크
  if (parsed.data.email && parsed.data.email !== user.email) {
    const existing = await User.findOne({ email: parsed.data.email });
    if (existing) {
      return res.status(409).json({ ok: false, error: "이미 사용 중인 이메일입니다." });
    }
    user.email = parsed.data.email;
  }

  // location 변경
  if (parsed.data.location !== undefined) {
    (user as any).location = parsed.data.location;
  }

  await user.save();

  return res.json({
    ok: true,
    user: {
      id: String(user._id),
      userId: user.userId,
      email: user.email,
      profileImage: user.profileImage || "",
      location: (user as any).location || "대구광역시 수성구 범어동",
    },
  });
});



/** 아이디 찾기 - 이메일로 인증코드 전송 */
router.post("/find-id/send-code", limiter, async (req, res) => {
  try {
    const { email } = sendSchema.parse(req.body);

    // 이메일로 사용자 존재 확인
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ ok: false, error: "해당 이메일로 가입된 계정이 없습니다." });
    }

    // 6자리 코드 생성 & 만료 10분
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await EmailCode.findOneAndUpdate(
      { email },
      { code, expiresAt, attempts: 0 },
      { upsert: true, new: true }
    );

    const ok = await sendMail(
      email,
      "ReGrow 아이디 찾기 인증코드",
      `<p>아이디 찾기 인증코드: <b style="font-size:18px;">${code}</b></p><p>10분 이내에 입력해 주세요.</p>`
    );
    if (!ok) {
      return res.status(500).json({ ok: false, error: "메일 전송에 실패했습니다." });
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("find-id send-code error:", e);
    const msg = e?.message || "Failed to send email code";
    return res.status(500).json({ ok: false, error: msg });
  }
});

/** 아이디 찾기 - 코드 인증 및 아이디 반환 */
router.post("/find-id/verify", limiter, async (req, res) => {
  try {
    const { email, code } = verifySchema.parse(req.body);

    const doc = await EmailCode.findOne({ email });
    if (!doc) {
      return res.status(400).json({ ok: false, error: "코드를 다시 요청하세요." });
    }

    if (doc.expiresAt.getTime() < Date.now()) {
      await doc.deleteOne();
      return res.status(400).json({ ok: false, error: "코드가 만료되었습니다." });
    }

    if (doc.attempts >= 5) {
      return res.status(429).json({ ok: false, error: "시도 횟수 초과" });
    }

    if (doc.code !== code) {
      doc.attempts += 1;
      await doc.save();
      return res.status(400).json({ ok: false, error: "인증코드가 일치하지 않습니다." });
    }

    // 사용자 아이디 조회
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다." });
    }

    // 성공 시 사용 완료 처리
    await EmailCode.deleteOne({ email });
    return res.json({ ok: true, userId: user.userId });
  } catch (e: any) {
    console.error("find-id verify error:", e);
    const msg = e?.message || "Failed to verify code";
    return res.status(400).json({ ok: false, error: msg });
  }
});

/** 비밀번호 찾기 - 이메일로 인증코드 전송 */
router.post("/find-password/send-code", limiter, async (req, res) => {
  try {
    const { email } = sendSchema.parse(req.body);

    // 이메일로 사용자 존재 확인
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ ok: false, error: "해당 이메일로 가입된 계정이 없습니다." });
    }

    // 6자리 코드 생성 & 만료 10분
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await EmailCode.findOneAndUpdate(
      { email },
      { code, expiresAt, attempts: 0 },
      { upsert: true, new: true }
    );

    const ok = await sendMail(
      email,
      "ReGrow 비밀번호 재설정 인증코드",
      `<p>비밀번호 재설정 인증코드: <b style="font-size:18px;">${code}</b></p><p>10분 이내에 입력해 주세요.</p>`
    );
    if (!ok) {
      return res.status(500).json({ ok: false, error: "메일 전송에 실패했습니다." });
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("find-password send-code error:", e);
    const msg = e?.message || "Failed to send email code";
    return res.status(500).json({ ok: false, error: msg });
  }
});

/** 비밀번호 찾기 - 코드 인증 및 비밀번호 재설정 */
router.post("/find-password/reset", limiter, async (req, res) => {
  try {
    const Body = z.object({
      email: z.string().email(),
      code: z.string().min(4).max(8),
      newPassword: z.string().min(4),
    });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.message });
    }

    const { email, code, newPassword } = parsed.data;

    const doc = await EmailCode.findOne({ email });
    if (!doc) {
      return res.status(400).json({ ok: false, error: "코드를 다시 요청하세요." });
    }

    if (doc.expiresAt.getTime() < Date.now()) {
      await doc.deleteOne();
      return res.status(400).json({ ok: false, error: "코드가 만료되었습니다." });
    }

    if (doc.attempts >= 5) {
      return res.status(429).json({ ok: false, error: "시도 횟수 초과" });
    }

    if (doc.code !== code) {
      doc.attempts += 1;
      await doc.save();
      return res.status(400).json({ ok: false, error: "인증코드가 일치하지 않습니다." });
    }

    // 사용자 비밀번호 업데이트
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다." });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = hash;
    await user.save();

    // 성공 시 사용 완료 처리
    await EmailCode.deleteOne({ email });
    return res.json({ ok: true });
  } catch (e: any) {
    console.error("find-password reset error:", e);
    const msg = e?.message || "Failed to reset password";
    return res.status(400).json({ ok: false, error: msg });
  }
});

/** 게임 상점 - 아이템 구매 */
router.post("/shop/buy", async (req, res) => {
  const u = readUserFromReq(req);
  if (!u) return res.status(401).json({ ok: false, error: "unauthorized" });

  const Body = z.object({
    item: z.enum(["waterCan", "fertilizer", "growthBooster"]),
    quantity: z.number().int().min(1).max(10),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.message });
  }

  const user = await User.findById(u.id);
  if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

  const { item, quantity } = parsed.data;
  
  // 아이템 가격 정의
  const prices = {
    waterCan: 25,
    fertilizer: 50,
    growthBooster: 100,
  };

  const totalCost = prices[item] * quantity;
  
  // 코인 부족 체크
  if ((user.gameCoins || 0) < totalCost) {
    return res.status(400).json({ ok: false, error: "코인이 부족합니다." });
  }

  // 코인 차감 및 아이템 추가
  user.gameCoins = (user.gameCoins || 0) - totalCost;
  
  if (item === "waterCan") {
    (user as any).gameWaterCans = ((user as any).gameWaterCans || 0) + quantity;
  } else if (item === "fertilizer") {
    (user as any).gameFertilizers = ((user as any).gameFertilizers || 0) + quantity;
  } else if (item === "growthBooster") {
    (user as any).gameGrowthBoosters = ((user as any).gameGrowthBoosters || 0) + quantity;
  }

  await user.save();

  return res.json({
    ok: true,
    purchase: {
      item,
      quantity,
      cost: totalCost,
      remainingCoins: user.gameCoins,
    },
    items: {
      waterCans: (user as any).gameWaterCans || 0,
      fertilizers: (user as any).gameFertilizers || 0,
      growthBoosters: (user as any).gameGrowthBoosters || 0,
    },
  });
});

/** 다른 사용자 정보 조회 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다." });
    }

    return res.json({
      ok: true,
      user: {
        id: String(user._id),
        userId: user.userId,
        profileImage: user.profileImage || "",
        location: (user as any).location || "대구광역시 수성구 범어동",
        gameTreesGrown: (user as any).gameTreesGrown ?? 0,
        createdAt: user.createdAt,
      },
    });
  } catch (e: any) {
    console.error("Get user profile error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "사용자 정보 조회 실패" });
  }
});

/** 로그아웃 */
router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

export default router;
