import { Schema, model, Types } from "mongoose";

const ReviewSchema = new Schema(
  {
    product: { type: Types.ObjectId, ref: "Product", required: true, index: true },
    author: { type: Types.ObjectId, ref: "User", required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true },
    transactionCompleted: { type: Boolean, default: false }, // 거래 완료 여부
  },
  { timestamps: true }
);

// 한 사용자가 같은 제품에 여러 리뷰를 남기지 못하도록
ReviewSchema.index({ product: 1, author: 1 }, { unique: true });

export default model("Review", ReviewSchema);
