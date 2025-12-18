import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import ChatRoom from "../models/ChatRoom.js";
import Product from "../models/Product.js";
import { readUserFromReq } from "../utils/authToken.js";

const router = Router();

const ensureAuth = (req: Parameters<typeof readUserFromReq>[0]) => {
  const user = readUserFromReq(req);
  return user;
};

async function populateRoom(room: any) {
  return room.populate([
    {
      path: "product",
      select: "title price images seller location",
    },
    {
      path: "buyer",
      select: "userId profileImage",
    },
    {
      path: "seller",
      select: "userId profileImage",
    },
    {
      path: "messages.author",
      select: "userId profileImage",
    },
  ]);
}

const serializeUser = (user: any) => {
  if (!user) return null;
  if (typeof user === "string") {
    return { id: user, userId: undefined, profileImage: "" };
  }
  return {
    id: String(user._id),
    userId: user.userId,
    profileImage: user.profileImage || "",
  };
};

const serializeRoom = (room: any, currentUserId?: string) => {
  const product = room.product
    ? {
        id: String(room.product._id),
        title: room.product.title,
        price: room.product.price,
        images: room.product.images ?? [],
        seller: String(room.product.seller),
        location: room.product.location,
      }
    : undefined;
  const buyer = serializeUser(room.buyer);
  const seller = serializeUser(room.seller);

  return {
    id: String(room._id),
    product,
    buyer,
    seller,
    updatedAt: room.updatedAt ? new Date(room.updatedAt).getTime() : null,
    messages: (room.messages || []).map((msg: any) => {
      const author = serializeUser(msg.author);
      const authorId =
        typeof msg.author === "string"
          ? msg.author
          : msg.author?._id
          ? String(msg.author._id)
          : undefined;
      return {
        id: String(msg._id),
        text: msg.text,
        createdAt: new Date(msg.createdAt || Date.now()).getTime(),
        author,
        isMine: currentUserId ? authorId === currentUserId : false,
      };
    }),
  };
};

router.get("/rooms", async (req, res) => {
  try {
    const authUser = ensureAuth(req);
    if (!authUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const { productId } = req.query;
    const filter: any = {
      $or: [{ buyer: authUser.id }, { seller: authUser.id }],
    };
    if (productId && typeof productId === "string") {
      filter.product = productId;
    }

    const rooms = await ChatRoom.find(filter)
      .sort({ updatedAt: -1 })
      .populate([
        { path: "product", select: "title price images seller location" },
        { path: "buyer", select: "userId profileImage" },
        { path: "seller", select: "userId profileImage" },
      ]);

    return res.json({
      ok: true,
      rooms: rooms.map((room) => serializeRoom(room, authUser.id)),
    });
  } catch (error: any) {
    console.error("Chat rooms error:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "채팅방 목록을 불러오는 중 오류가 발생했습니다.",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post("/open", async (req, res) => {
  try {
    const authUser = ensureAuth(req);
    if (!authUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const Body = z.object({
      productId: z.string(),
      buyerId: z.string().optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.message });
    }

    const { productId, buyerId } = parsed.data;

  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ ok: false, error: "상품을 찾을 수 없습니다." });

  const sellerId = String(product.seller);
  const isSeller = sellerId === authUser.id;

  if (!isSeller && buyerId && buyerId !== authUser.id) {
    return res.status(400).json({ ok: false, error: "잘못된 요청입니다." });
  }

  let buyerObjectId: Types.ObjectId | null = null;
  if (isSeller) {
    if (buyerId) {
      buyerObjectId = new Types.ObjectId(buyerId);
    }
  } else {
    buyerObjectId = new Types.ObjectId(authUser.id);
  }

  let room;

  if (buyerObjectId) {
    room = await ChatRoom.findOne({
      product: product._id,
      buyer: buyerObjectId,
    });
  }

  if (!room) {
    if (isSeller) {
      const latestRoom = await ChatRoom.findOne({ product: product._id })
        .sort({ updatedAt: -1 })
        .populate([
          { path: "product", select: "title price images seller location" },
          { path: "buyer", select: "userId profileImage" },
          { path: "seller", select: "userId profileImage" },
        ]);
      if (!latestRoom) {
        return res.status(404).json({ ok: false, error: "채팅 요청이 없습니다." });
      }
      await populateRoom(latestRoom);
      return res.json({ ok: true, room: serializeRoom(latestRoom, authUser.id) });
    } else {
      try {
        room = await ChatRoom.create({
          product: product._id,
          buyer: new Types.ObjectId(authUser.id),
          seller: product.seller,
          messages: [],
        });
      } catch (error: any) {
        // 중복 키 에러 처리 (E11000)
        if (error.code === 11000) {
          // 이미 존재하는 채팅방을 찾아서 반환
          room = await ChatRoom.findOne({
            product: product._id,
            buyer: new Types.ObjectId(authUser.id),
          });
          if (!room) {
            return res.status(500).json({ ok: false, error: "채팅방을 생성할 수 없습니다." });
          }
        } else {
          console.error("ChatRoom creation error:", error);
          return res.status(500).json({ ok: false, error: "채팅방을 생성하는 중 오류가 발생했습니다." });
        }
      }
    }
  }

    await populateRoom(room);
    return res.json({ ok: true, room: serializeRoom(room, authUser.id) });
  } catch (error: any) {
    console.error("Chat open error:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "채팅방을 여는 중 오류가 발생했습니다.",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get("/room/:roomId", async (req, res) => {
  try {
    const authUser = ensureAuth(req);
    if (!authUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const { roomId } = req.params;
    if (!Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ ok: false, error: "roomId가 올바르지 않습니다." });
    }

    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ ok: false, error: "채팅방이 없습니다." });

    const isParticipant =
      String(room.buyer) === authUser.id || String(room.seller) === authUser.id;
    if (!isParticipant) {
      return res.status(403).json({ ok: false, error: "access_denied" });
    }

    await populateRoom(room);
    return res.json({ ok: true, room: serializeRoom(room, authUser.id) });
  } catch (error: any) {
    console.error("Chat room error:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "채팅방을 불러오는 중 오류가 발생했습니다.",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post("/room/:roomId/messages", async (req, res) => {
  try {
    const authUser = ensureAuth(req);
    if (!authUser) return res.status(401).json({ ok: false, error: "unauthorized" });

    const { roomId } = req.params;
    if (!Types.ObjectId.isValid(roomId)) {
      return res.status(400).json({ ok: false, error: "roomId가 올바르지 않습니다." });
    }

    const Body = z.object({
      text: z.string().min(1).max(500),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.message });
    }

    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ ok: false, error: "채팅방이 없습니다." });

    const isParticipant =
      String(room.buyer) === authUser.id || String(room.seller) === authUser.id;
    if (!isParticipant) {
      return res.status(403).json({ ok: false, error: "access_denied" });
    }

    room.messages.push({
      author: new Types.ObjectId(authUser.id),
      text: parsed.data.text.trim(),
      createdAt: new Date(),
    });
    await room.save();
    await populateRoom(room);

    const latestMessage = room.messages[room.messages.length - 1];
    return res.json({
      ok: true,
      message: {
        id: String(latestMessage._id),
        text: latestMessage.text,
        createdAt: new Date(latestMessage.createdAt || Date.now()).getTime(),
        author: serializeUser(latestMessage.author),
        isMine: true,
      },
      room: serializeRoom(room, authUser.id),
    });
  } catch (error: any) {
    console.error("Chat message error:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "메시지를 전송하는 중 오류가 발생했습니다.",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;


