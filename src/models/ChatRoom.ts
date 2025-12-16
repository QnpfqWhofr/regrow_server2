import { Schema, model, Types, InferSchemaType } from "mongoose";

const ChatMessageSchema = new Schema(
  {
    author: { type: Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ChatRoomSchema = new Schema(
  {
    product: { type: Types.ObjectId, ref: "Product", required: true, index: true },
    buyer: { type: Types.ObjectId, ref: "User", required: true, index: true },
    seller: { type: Types.ObjectId, ref: "User", required: true, index: true },
    messages: { type: [ChatMessageSchema], default: [] },
  },
  { timestamps: true }
);

ChatRoomSchema.index({ product: 1, buyer: 1 }, { unique: true });

export type ChatRoomDocument = InferSchemaType<typeof ChatRoomSchema>;

export default model("ChatRoom", ChatRoomSchema);


