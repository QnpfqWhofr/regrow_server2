import { Schema, model } from "mongoose";

const UserSchema = new Schema(
  {
    userId: { type: String, required: true },
    passwordHash: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    emailVerified: { type: Boolean, default: false },
    profileImage: { type: String, default: "" },
    location: { type: String, default: "대구광역시 수성구 범어동" },
    // 게임 정보
    gameCoins: { type: Number, default: 200 },
    gameLevel: { type: Number, default: 1 },
    gameProgressPct: { type: Number, default: 0 }, // 호환성을 위해 유지 (0-100%)
    gameProgressPoints: { type: Number, default: 0 }, // 실제 진행도 포인트
    gameLastCollectAt: { type: Date, default: null },
    gameLevelUpRewardPending: { type: Boolean, default: false }, // 레벨업 보상 대기 중
    gameTreesGrown: { type: Number, default: 0 }, // 키운 나무 수
    gameWaterCans: { type: Number, default: 3 }, // 물뿌리개 개수
    gameFertilizers: { type: Number, default: 2 }, // 비료 개수
    gameGrowthBoosters: { type: Number, default: 0 }, // 성장촉진제 개수
    recentlyViewedProducts: {
      type: [{ type: Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
    sharedProducts: {
      type: [{ type: Schema.Types.ObjectId, ref: "Product" }],
      default: [],
    },
  },
  { timestamps: true }
);

// userId에 대한 일반 인덱스만 생성 (unique 제거, 애플리케이션 레벨에서 중복 체크)
// 성능 향상을 위한 일반 인덱스
UserSchema.index({ userId: 1 });

export default model("User", UserSchema);


