import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import fs from "fs/promises";
import path from "path";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { readUserFromReq } from "../utils/authToken.js";

const router = Router();
const HISTORY_LIMIT = 50;
const keywordSplitRegex = /[\s,.;:/\\|()+\-_"'!?]+/;

// 이미지 파일 삭제 함수
async function deleteProductImages(images: string[]) {
  for (const img of images) {
    // /uploads/로 시작하는 상대 경로만 삭제
    if (img.startsWith("/uploads/")) {
      try {
        const filePath = path.join(process.cwd(), img);
        await fs.unlink(filePath);
        console.log(`[DELETE] Image deleted: ${filePath}`);
      } catch (err: any) {
        // 파일이 없거나 삭제 실패해도 계속 진행
        console.error(`[DELETE] Failed to delete image ${img}:`, err.message);
      }
    }
  }
}

const addKeywords = (set: Set<string>, title?: string | null) => {
  if (!title) return;
  const words = title
    .toLowerCase()
    .split(keywordSplitRegex)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  words.forEach((word) => set.add(word));
};

const hasKeywordMatch = (title: string | undefined, keywords: Set<string>) => {
  if (!title || keywords.size === 0) return false;
  const lowerTitle = title.toLowerCase();
  for (const keyword of keywords) {
    if (lowerTitle.includes(keyword)) return true;
  }
  return false;
};

/** 등록 */
router.post("/", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  const Body = z.object({
    title: z.string().min(1),
    description: z.string().optional().default(""),
    price: z.number().nonnegative(),
    category: z.string().optional().default("기타"),
    location: z.string().optional().default("미정"),
    images: z
      .array(
        z
          .string()
          .min(1)
          .refine(
            (val) =>
              val.startsWith("http://") ||
              val.startsWith("https://") ||
              val.startsWith("/uploads/"),
            { message: "이미지 경로는 /uploads/ 또는 절대 URL 이어야 합니다." }
          )
      )
      .optional()
      .default([]),
    brand: z.string().optional().default(""),
    condition: z.enum(["상", "중", "하"]).optional().default("중"),
    tradeMethod: z.enum(["비대면", "대면"]).optional().default("비대면"),
    shippingFee: z.enum(["포함", "미포함"]).optional().default("포함"),
    shippingCost: z.number().nonnegative().optional().default(0),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.message });
  }

  const doc = await Product.create({ ...parsed.data, seller: user.id });
  return res.status(201).json({ ok: true, product: doc });
});

/** 목록 (최신순) - 검색 쿼리 지원 */
router.get("/", async (req, res) => {
  const query = req.query.q as string | undefined;
  const category = req.query.category as string | undefined;
  const sort = req.query.sort as string | undefined;

  const filter: Record<string, unknown> = {};
  if (query && query.trim()) {
    filter.title = { $regex: query.trim(), $options: "i" };
  }
  if (category && category.trim()) {
    filter.category = category.trim();
  }

  if (sort === "popular") {
    const pipeline: any[] = [
      { $match: filter },
      {
        $addFields: {
          likeCount: {
            $size: { $ifNull: ["$likedBy", []] },
          },
          shareCount: { $ifNull: ["$shareCount", 0] },
        },
      },
      {
        $addFields: {
          popularityScore: { $add: ["$likeCount", "$shareCount"] },
        },
      },
      {
        $sort: {
          popularityScore: -1,
          likeCount: -1,
          shareCount: -1,
          createdAt: -1,
        },
      },
      { $limit: 200 },
      { $project: { popularityScore: 0 } },
    ];

    const list = await Product.aggregate(pipeline);
    return res.json({ ok: true, products: list });
  }

  const list = await Product.find(filter).sort({ createdAt: -1 }).limit(200);
  return res.json({ ok: true, products: list });
});

/** 내 상품 목록 (인증 필요) - /:id 보다 먼저 정의해야 함 */
router.get("/my", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  const list = await Product.find({ seller: user.id })
    .sort({ createdAt: -1 })
    .limit(200);
  return res.json({ ok: true, products: list });
});

/** 특정 사용자의 상품 목록 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 사용자 존재 확인
    const targetUser = await User.findOne({ userId });
    if (!targetUser) {
      return res.status(404).json({ ok: false, error: "사용자를 찾을 수 없습니다." });
    }

    // 해당 사용자의 상품 목록 조회 (판매중인 상품만)
    const list = await Product.find({ 
      seller: String(targetUser._id),
      status: "selling" // 판매중인 상품만 공개
    })
      .sort({ createdAt: -1 })
      .limit(200);
    
    return res.json({ ok: true, products: list });
  } catch (e: any) {
    console.error("Get user products error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "상품 목록 조회 실패" });
  }
});

router.get("/recommend", async (req, res) => {
  const user = readUserFromReq(req);
  const keyword = ((req.query.q as string) || "").trim();
  const limit = 200;
  const keywordFilter: Record<string, unknown> = {};
  if (keyword) {
    keywordFilter.title = { $regex: keyword, $options: "i" };
  }

  const fetchDefaultList = async () => {
    const list = await Product.find(keywordFilter)
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.json({ ok: true, products: list });
  };

  if (!user) {
    if (!keyword) {
      // 신규 고객 - 제약 없이 최신순
      return fetchDefaultList();
    }
    // 로그인하지 않은 경우 키워드가 있는 상품만 반환
    const list = await Product.find(keywordFilter)
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.json({ ok: true, products: list });
  }

  const userDoc = await User.findById(user.id)
    .select("recentlyViewedProducts sharedProducts")
    .lean();

  const likedProducts = await Product.find({ likedBy: user.id })
    .select("category title")
    .limit(40)
    .lean();

  const sharedIds = (userDoc?.sharedProducts || []).slice(0, HISTORY_LIMIT);
  const viewedIds = (userDoc?.recentlyViewedProducts || []).slice(0, HISTORY_LIMIT);

  const sharedProducts = sharedIds.length
    ? await Product.find({ _id: { $in: sharedIds } })
        .select("category title")
        .lean()
    : [];

  const viewedProducts = viewedIds.length
    ? await Product.find({ _id: { $in: viewedIds } })
        .select("category title")
        .lean()
    : [];

  const primarySources = [...likedProducts, ...sharedProducts];
  const secondarySources = viewedProducts;

  if (primarySources.length === 0 && secondarySources.length === 0 && !keyword) {
    return fetchDefaultList();
  }

  const primaryCategories = new Set(
    primarySources
      .map((p) => (p.category || "").trim())
      .filter(Boolean)
  );
  const secondaryCategories = new Set(
    secondarySources
      .map((p) => (p.category || "").trim())
      .filter(Boolean)
  );

  const primaryKeywords = new Set<string>();
  primarySources.forEach((p) => addKeywords(primaryKeywords, p.title));
  const secondaryKeywords = new Set<string>();
  secondarySources.forEach((p) => addKeywords(secondaryKeywords, p.title));

  if (keyword) {
    primaryKeywords.add(keyword.toLowerCase());
    secondaryKeywords.add(keyword.toLowerCase());
  }

  const excludeIds = new Set<string>([
    ...primarySources.map((p: any) => String(p._id)),
    ...secondarySources.map((p: any) => String(p._id)),
  ]);

  const candidates = await Product.find(keywordFilter)
    .sort({ createdAt: -1 })
    .limit(limit * 2)
    .lean();

  const primaryMatches: any[] = [];
  const secondaryMatches: any[] = [];
  const fallbackMatches: any[] = [];

  for (const product of candidates) {
    if (excludeIds.has(String(product._id))) continue;

    const matchesPrimaryCategory =
      !!product.category && primaryCategories.has(product.category);
    const matchesPrimaryKeyword = hasKeywordMatch(product.title, primaryKeywords);
    const matchesSecondaryCategory =
      !!product.category && secondaryCategories.has(product.category);
    const matchesSecondaryKeyword = hasKeywordMatch(
      product.title,
      secondaryKeywords
    );

    if (matchesPrimaryCategory || matchesPrimaryKeyword) {
      primaryMatches.push(product);
    } else if (matchesSecondaryCategory || matchesSecondaryKeyword) {
      secondaryMatches.push(product);
    } else {
      fallbackMatches.push(product);
    }
  }

  const merged = [...primaryMatches, ...secondaryMatches, ...fallbackMatches].slice(
    0,
    limit
  );

  if (merged.length === 0) {
    return fetchDefaultList();
  }

  return res.json({ ok: true, products: merged });
});

/** 좋아요 토글 (인증 필요) - /:id 보다 먼저 정의해야 함 */
router.post("/:id/like", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  const item = await Product.findById(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "not_found" });

  const userId = new Types.ObjectId(user.id);
  const likedBy = item.likedBy || [];
  const isLiked = likedBy.some((id) => String(id) === user.id);

  if (isLiked) {
    // 좋아요 취소
    item.set('likedBy', likedBy.filter((id) => String(id) !== user.id));
  } else {
    // 좋아요 추가
    item.likedBy.push(userId);
  }

  await item.save();

  return res.json({
    ok: true,
    isLiked: !isLiked,
    likeCount: item.likedBy.length,
  });
});

/** 공유 카운트 증가 (복사 시) */
router.post("/:id/share", async (req, res) => {
  const user = readUserFromReq(req);
  const item = await Product.findById(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "not_found" });

  item.shareCount = (item.shareCount || 0) + 1;
  await item.save();

  if (user) {
    await User.findByIdAndUpdate(user.id, {
      $push: {
        sharedProducts: {
          $each: [item._id],
          $position: 0,
          $slice: HISTORY_LIMIT,
        },
      },
    });
  }

  return res.json({ ok: true, shareCount: item.shareCount });
});

/** 단건 조회 */
router.get("/:id", async (req, res) => {
  const user = readUserFromReq(req);
  const item = await Product.findById(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "not_found" });
  const sellerDoc = await User.findById(item.seller).select("userId profileImage");

  if (user) {
    await User.findByIdAndUpdate(user.id, {
      $push: {
        recentlyViewedProducts: {
          $each: [item._id],
          $position: 0,
          $slice: HISTORY_LIMIT,
        },
      },
    });
  }

  const productData = item.toObject();
  const isLiked = user && item.likedBy?.some((id) => String(id) === user.id);
  const isSeller = user && String(item.seller) === user.id;

  return res.json({
    ok: true,
    product: {
      ...productData,
      seller: String(item.seller),
      sellerUserId: sellerDoc?.userId || "",
      sellerProfileImage: sellerDoc?.profileImage || "",
      isLiked: isLiked || false,
      likeCount: item.likedBy?.length || 0,
      shareCount: item.shareCount || 0,
    },
  });
});

/** 상품 상태 변경 (인증 필요, 본인만) */
router.patch("/:id", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  const Body = z.object({
    status: z.enum(["selling", "reserved", "sold"]).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    price: z.number().nonnegative().optional(),
    category: z.string().optional(),
    location: z.string().optional(),
    images: z
      .array(
        z
          .string()
          .min(1)
          .refine(
            (val) =>
              val.startsWith("http://") ||
              val.startsWith("https://") ||
              val.startsWith("/uploads/"),
            { message: "이미지 경로는 /uploads/ 또는 절대 URL 이어야 합니다." }
          )
      )
      .optional(),
    brand: z.string().optional(),
    condition: z.enum(["상", "중", "하"]).optional(),
    tradeMethod: z.enum(["비대면", "대면"]).optional(),
    shippingFee: z.enum(["포함", "미포함"]).optional(),
    shippingCost: z.number().nonnegative().optional(),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.message });
  }

  const item = await Product.findById(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "not_found" });

  // 본인 상품인지 확인
  if (String(item.seller) !== user.id) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  // 상태가 sold로 변경되면 제품 삭제
  if (parsed.data.status === "sold" && item.status !== "sold") {
    // 이미지 파일 삭제
    await deleteProductImages(item.images || []);
    
    // 제품 삭제
    await Product.findByIdAndDelete(req.params.id);
    
    return res.json({ ok: true, deleted: true });
  }

  Object.assign(item, parsed.data);
  await item.save();

  return res.json({ ok: true, product: item });
});

/** 상품 삭제 (인증 필요, 본인만) */
router.delete("/:id", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  const item = await Product.findById(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "not_found" });

  // 본인 상품인지 확인
  if (String(item.seller) !== user.id) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  // 이미지 파일 삭제
  await deleteProductImages(item.images || []);

  await Product.findByIdAndDelete(req.params.id);
  return res.json({ ok: true });
});

export default router;
