import Product from "../models/Product.js";
import fs from "fs/promises";
import path from "path";

// 이미지 파일 삭제 함수
async function deleteProductImages(images: string[]) {
  for (const img of images) {
    // /uploads/로 시작하는 상대 경로만 삭제
    if (img.startsWith("/uploads/")) {
      try {
        const filePath = path.join(process.cwd(), img);
        await fs.unlink(filePath);
        console.log(`[SCHEDULER] Image deleted: ${filePath}`);
      } catch (err: any) {
        // 파일이 없거나 삭제 실패해도 계속 진행
        console.error(`[SCHEDULER] Failed to delete image ${img}:`, err.message);
      }
    }
  }
}

// 판매완료된 상품 자동 삭제 (1시간 후)
export async function cleanupSoldProducts() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // soldAt이 1시간 이전인 제품 찾기
    const soldProducts = await Product.find({
      status: "sold",
      soldAt: { $lte: oneHourAgo, $ne: null },
    });

    if (soldProducts.length === 0) {
      return;
    }

    console.log(`[SCHEDULER] Found ${soldProducts.length} sold products to delete`);

    for (const product of soldProducts) {
      // 이미지 삭제
      if (product.images && product.images.length > 0) {
        await deleteProductImages(product.images);
      }

      // 제품 삭제
      await Product.findByIdAndDelete(product._id);
      console.log(`[SCHEDULER] Deleted sold product: ${product._id} - ${product.title}`);
    }

    console.log(`[SCHEDULER] Cleanup completed: ${soldProducts.length} products deleted`);
  } catch (err: any) {
    console.error("[SCHEDULER] Error during cleanup:", err.message);
  }
}

// 스케줄러 시작 (5분마다 실행)
export function startProductScheduler() {
  console.log("[SCHEDULER] Product cleanup scheduler started");
  
  // 즉시 한 번 실행
  cleanupSoldProducts();
  
  // 5분마다 실행
  setInterval(() => {
    cleanupSoldProducts();
  }, 5 * 60 * 1000);
}
