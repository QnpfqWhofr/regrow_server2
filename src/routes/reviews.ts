import { Router } from "express";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import Review from "../models/Review";
import User from "../models/User";
import Product from "../models/Product";
import { readUserFromReq } from "../utils/authToken";

const router = Router();

/** 특정 제품의 리뷰 목록 조회 */
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    
    const reviews = await Review.find({ product: productId })
      .sort({ createdAt: -1 })
      .populate("author", "userId profileImage")
      .lean();

    const formatted = reviews.map((r: any) => ({
      id: String(r._id),
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      transactionCompleted: r.transactionCompleted || false,
      author: {
        id: String(r.author._id),
        userId: r.author.userId,
        profileImage: r.author.profileImage || "",
      },
    }));

    return res.json({ ok: true, reviews: formatted });
  } catch (e: any) {
    console.error("Get reviews error:", e);
    return res.status(500).json({ ok: false, error: e.message || "리뷰 조회 실패" });
  }
});

/** 리뷰 작성 */
router.post("/", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  const Body = z.object({
    productId: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    comment: z.string().min(1).max(500),
  });

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.message });
  }

  try {
    const { productId, rating, comment } = parsed.data;

    // 제품 존재 확인
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ ok: false, error: "제품을 찾을 수 없습니다." });
    }

    // 자신의 제품인지 확인
    if (String(product.seller) === user.id) {
      return res.status(403).json({ ok: false, error: "자신의 제품에는 리뷰를 작성할 수 없습니다." });
    }

    // 이미 리뷰를 작성했는지 확인
    const existing = await Review.findOne({
      product: productId,
      author: user.id,
    });

    if (existing) {
      return res.status(409).json({ ok: false, error: "이미 리뷰를 작성하셨습니다." });
    }

    // 리뷰 생성
    const review = await Review.create({
      product: productId,
      author: user.id,
      rating,
      comment: comment.trim(),
    });

    const populated = await Review.findById(review._id)
      .populate("author", "userId profileImage")
      .lean();

    return res.status(201).json({
      ok: true,
      review: {
        id: String(populated!._id),
        rating: populated!.rating,
        comment: populated!.comment,
        createdAt: populated!.createdAt,
        transactionCompleted: (populated as any).transactionCompleted || false,
        author: {
          id: String((populated!.author as any)._id),
          userId: (populated!.author as any).userId,
          profileImage: (populated!.author as any).profileImage || "",
        },
      },
    });
  } catch (e: any) {
    console.error("Create review error:", e);
    return res.status(500).json({ ok: false, error: e.message || "리뷰 작성 실패" });
  }
});

/** 리뷰 삭제 (본인만) */
router.delete("/:id", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ ok: false, error: "리뷰를 찾을 수 없습니다." });
    }

    // 본인 리뷰인지 확인
    if (String(review.author) !== user.id) {
      return res.status(403).json({ ok: false, error: "본인의 리뷰만 삭제할 수 있습니다." });
    }

    // 거래 완료된 리뷰는 삭제 불가
    if (review.transactionCompleted) {
      return res.status(400).json({ ok: false, error: "거래 완료된 리뷰는 삭제할 수 없습니다." });
    }

    await Review.findByIdAndDelete(req.params.id);
    return res.json({ ok: true });
  } catch (e: any) {
    console.error("Delete review error:", e);
    return res.status(500).json({ ok: false, error: e.message || "리뷰 삭제 실패" });
  }
});

/** 거래 완료 처리 (제품 판매자만) */
router.post("/:id/complete", async (req, res) => {
  const user = readUserFromReq(req);
  if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });

  try {
    const review = await Review.findById(req.params.id).populate("product");
    if (!review) {
      return res.status(404).json({ ok: false, error: "리뷰를 찾을 수 없습니다." });
    }

    const product = review.product as any;
    if (!product) {
      return res.status(404).json({ ok: false, error: "제품을 찾을 수 없습니다." });
    }

    // 제품 판매자인지 확인
    if (String(product.seller) !== user.id) {
      return res.status(403).json({ ok: false, error: "제품 판매자만 거래 완료 처리를 할 수 있습니다." });
    }

    // 이미 거래 완료 처리되었는지 확인
    if (review.transactionCompleted) {
      return res.status(400).json({ ok: false, error: "이미 거래 완료 처리된 리뷰입니다." });
    }

    // 거래 완료 처리
    review.transactionCompleted = true;
    await review.save();

    // 제품 삭제 (이미지 파일도 함께 삭제)
    const productToDelete = await Product.findById(product._id);
    if (productToDelete && productToDelete.images) {
      // 이미지 파일 삭제
      for (const img of productToDelete.images) {
        if (img.startsWith("/uploads/")) {
          try {
            const filePath = path.join(process.cwd(), img);
            await fs.unlink(filePath);
            console.log(`[DELETE] Image deleted: ${filePath}`);
          } catch (err: any) {
            console.error(`[DELETE] Failed to delete image ${img}:`, err.message);
          }
        }
      }
    }
    
    // 제품 삭제
    await Product.findByIdAndDelete(product._id);

    // 게임 프로그레스 업데이트 (별점 기반) - 구매자와 판매자 모두
    const progressIncrease = 25 * (review.rating / 5); // 5점 만점 기준 백분율
    
    // 판매자 프로그레스 업데이트
    const seller = await User.findById(user.id);
    if (seller) {
      const currentProgress = seller.gameProgressPct || 0;
      const newProgress = Math.min(100, currentProgress + progressIncrease);
      
      seller.gameProgressPct = newProgress;
      
      // 100% 달성 시 레벨업
      if (newProgress >= 100 && currentProgress < 100) {
        seller.gameLevel = (seller.gameLevel || 1) + 1;
        seller.gameProgressPct = 0; // 레벨업 후 프로그레스 초기화
        (seller as any).gameLevelUpRewardPending = true; // 레벨업 보상 대기
      }
      
      await seller.save();
    }

    // 구매자(리뷰 작성자) 프로그레스 업데이트
    const buyer = await User.findById(review.author);
    if (buyer) {
      const currentProgress = buyer.gameProgressPct || 0;
      const newProgress = Math.min(100, currentProgress + progressIncrease);
      
      buyer.gameProgressPct = newProgress;
      
      // 100% 달성 시 레벨업
      if (newProgress >= 100 && currentProgress < 100) {
        buyer.gameLevel = (buyer.gameLevel || 1) + 1;
        buyer.gameProgressPct = 0; // 레벨업 후 프로그레스 초기화
        (buyer as any).gameLevelUpRewardPending = true; // 레벨업 보상 대기
      }
      
      await buyer.save();
    }

    return res.json({ 
      ok: true, 
      review: {
        id: String(review._id),
        transactionCompleted: review.transactionCompleted,
      },
      gameProgress: {
        seller: {
          progressPct: seller?.gameProgressPct || 0,
          level: seller?.gameLevel || 1,
          coins: seller?.gameCoins || 0,
        },
        buyer: {
          progressPct: buyer?.gameProgressPct || 0,
          level: buyer?.gameLevel || 1,
          coins: buyer?.gameCoins || 0,
        }
      }
    });
  } catch (e: any) {
    console.error("Complete transaction error:", e);
    return res.status(500).json({ ok: false, error: e.message || "거래 완료 처리 실패" });
  }
});

export default router;
