import { Schema, model, Types } from "mongoose";

const ProductSchema = new Schema(
  {
    seller: { type: Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, default: "기타", index: true },
    location: { type: String, default: "미정", index: true },
    images: { type: [String], default: [] }, // 업로드된 이미지 URL 배열
    status: {
      type: String,
      enum: ["selling", "reserved", "sold"],
      default: "selling",
      index: true,
    },
    likedBy: { type: [Types.ObjectId], ref: "User", default: [] }, // 좋아요한 사용자 목록
    shareCount: { type: Number, default: 0 },
    soldAt: { type: Date, default: null, index: true }, // 판매완료 시간
    // 추가 정보
    brand: { type: String, default: "" }, // 브랜드명
    condition: { type: String, enum: ["상", "중", "하"], default: "중" }, // 제품상태
    tradeMethod: { type: String, enum: ["비대면", "대면"], default: "비대면" }, // 거래방식
    shippingFee: { type: String, enum: ["포함", "미포함"], default: "포함" }, // 배송비 포함 여부
    shippingCost: { type: Number, default: 0, min: 0 }, // 배송비 (미포함일 경우)
  },
  { timestamps: true }
);

export default model("Product", ProductSchema);
