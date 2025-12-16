// server/src/utils/authToken.ts
import jwt, { type SignOptions, type JwtPayload } from "jsonwebtoken";

import type { Request as ExRequest, Response as ExResponse } from "express";
import "cookie-parser";

const secret = process.env.JWT_SECRET || "dev-secret";
const cookieName = process.env.JWT_COOKIE || "krush_token";

export function signUser(payload: {
  id: string;
  userId: string;
  email: string;
}) {
  const raw = process.env.JWT_EXPIRES ?? "7d";
  // SignOptions['expiresIn']에 정확히 맞춤 (string | number)
  const expiresIn: SignOptions["expiresIn"] = /^\d+$/.test(raw)
    ? (Number(raw) as SignOptions["expiresIn"])
    : (raw as SignOptions["expiresIn"]);
  return jwt.sign(payload as JwtPayload, secret, { expiresIn });
}

export function setAuthCookie(res: ExResponse, token: string) {
  const isSecure = true; // HTTPS 터널이면 무조건 true
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "none", // 크로스 도메인에서 필수
    secure: isSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: ExResponse) {
  const isSecure = true;
  res.cookie(cookieName, "", {
    httpOnly: true,
    sameSite: "none",
    secure: isSecure,
    expires: new Date(0),
    path: "/",
  });
}


export function readUserFromReq(req: ExRequest) {
  const token = req.cookies?.[cookieName] as string | undefined;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret) as {
      id: string;
      userId: string;
      email: string;
    };
    return decoded;
  } catch {
    return null;
  }
}
