require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "studyroom-files";
const MAX_FILE_MB = Math.min(20, Math.max(1, Number(process.env.MAX_FILE_MB || 10)));
const COOKIE_NAME = "studyroom_token";

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("ERROR: JWT_SECRET phải có ít nhất 32 ký tự.");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30,
  standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "Thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại." }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 180,
  standardHeaders: "draft-8", legacyHeaders: false
});
app.use("/api", apiLimiter);

function cleanUsername(v) {
  return String(v || "").trim().toLowerCase();
}
function validUsername(v) {
  return /^[a-z0-9_]{3,20}$/.test(v);
}
function validPassword(v) {
  return typeof v === "string" && v.length >= 8 && v.length <= 72;
}
function safeText(v, max = 500) {
  return String(v || "").trim().slice(0, max);
}
function randomRoomCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}
function setToken(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/"
  });
}
function clearToken(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
}
async function auth(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Hãy đăng nhập trước." });
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user, error } = await supabase.from("users")
      .select("id, username, created_at").eq("id", decoded.sub).maybeSingle();
    if (error || !user) {
      clearToken(res);
      return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ. Hãy đăng nhập lại." });
    }
    req.user = user;
    next();
  } catch {
    clearToken(res);
    return res.status(401).json({ error: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại." });
  }
}
async function roomMember(roomId, userId) {
  const { data, error } = await supabase.from("room_members")
    .select("room_id, user_id, role, joined_at")
    .eq("room_id", roomId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
function handleDbError(res, error) {
  console.error("Database/storage error:", error?.message || error);
  return res.status(500).json({ error: "Máy chủ gặp lỗi. Kiểm tra cấu hình Supabase và thử lại." });
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "StudyRoom", time: new Date().toISOString() }));

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = req.body.password;
    if (!validUsername(username)) return res.status(400).json({ error: "Tên tài khoản phải dài 3–20 ký tự, chỉ gồm chữ thường, số và dấu gạch dưới." });
    if (!validPassword(password)) return res.status(400).json({ error: "Mật khẩu phải dài 8–72 ký tự." });
    const { data: exists, error: checkError } = await supabase.from("users").select("id").eq("username", username).maybeSingle();
    if (checkError) return handleDbError(res, checkError);
    if (exists) return res.status(409).json({ error: "Tên tài khoản này đã được sử dụng." });
    const password_hash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase.from("users")
      .insert({ username, password_hash }).select("id, username, created_at").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Tên tài khoản này đã được sử dụng." });
      return handleDbError(res, error);
    }
    setToken(res, user);
    res.status(201).json({ user });
  } catch (e) { handleDbError(res, e); }
});

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = req.body.password;
    if (!username || typeof password !== "string") return res.status(400).json({ error: "Nhập tên tài khoản và mật khẩu." });
    const { data: user, error } = await supabase.from("users")
      .select("id, username, password_hash, created_at").eq("username", username).maybeSingle();
    if (error) return handleDbError(res, error);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Tên tài khoản hoặc mật khẩu không đúng." });
    }
    setToken(res, user);
    delete user.password_hash;
    res.json({ user });
  } catch (e) { handleDbError(res, e); }
});

app.post("/api/logout", (_req, res) => { clearToken(res); res.json({ ok: true }); });
app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));

app.get("/api/rooms", auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("room_members")
      .select("role, joined_at, rooms(id, name, description, code, owner_id, created_at)")
      .eq("user_id", req.user.id).order("joined_at", { ascending: false });
    if (error) return handleDbError(res, error);
    res.json({ rooms: (data || []).map(x => ({ ...x.rooms, role: x.role, joined_at: x.joined_at })).filter(Boolean) });
  } catch (e) { handleDbError(res, e); }
});

app.post("/api/rooms", auth, async (req, res) => {
  try {
    const name = safeText(req.body.name, 60);
    const description = safeText(req.body.description, 250);
    if (name.length < 2) return res.status(400).json({ error: "Tên phòng phải có ít nhất 2 ký tự." });
    let room, error;
    for (let i = 0; i < 5; i++) {
      const code = randomRoomCode();
      const result = await supabase.from("rooms").insert({
        name, description, code, owner_id: req.user.id
      }).select("id, name, description, code, owner_id, created_at").single();
      room = result.data; error = result.error;
      if (!error) break;
      if (error.code !== "23505") return handleDbError(res, error);
    }
    if (!room) return res.status(500).json({ error: "Không tạo được mã phòng, hãy thử lại." });
    const { error: memberError } = await supabase.from("room_members").insert({
      room_id: room.id, user_id: req.user.id, role: "owner"
    });
    if (memberError) return handleDbError(res, memberError);
    res.status(201).json({ room: { ...room, role: "owner" } });
  } catch (e) { handleDbError(res, e); }
});

app.post("/api/rooms/join", auth, async (req, res) => {
  try {
    const code = safeText(req.body.code, 20).toUpperCase();
    if (!/^[A-F0-9]{8}$/.test(code)) return res.status(400).json({ error: "Mã phòng không hợp lệ." });
    const { data: room, error } = await supabase.from("rooms")
      .select("id, name, description, code, owner_id, created_at").eq("code", code).maybeSingle();
    if (error) return handleDbError(res, error);
    if (!room) return res.status(404).json({ error: "Không tìm thấy phòng với mã này." });
    const { error: memberError } = await supabase.from("room_members").upsert({
      room_id: room.id, user_id: req.user.id, role: room.owner_id === req.user.id ? "owner" : "member"
    }, { onConflict: "room_id,user_id", ignoreDuplicates: true });
    if (memberError) return handleDbError(res, memberError);
    res.json({ room });
  } catch (e) { handleDbError(res, e); }
});

app.get("/api/rooms/:id", auth, async (req, res) => {
  try {
    const member = await roomMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: "M chưa tham gia phòng này." });
    const { data: room, error } = await supabase.from("rooms")
      .select("id, name, description, code, owner_id, created_at").eq("id", req.params.id).maybeSingle();
    if (error) return handleDbError(res, error);
    if (!room) return res.status(404).json({ error: "Phòng không tồn tại." });
    const { data: members, error: memErr } = await supabase.from("room_members")
      .select("role, joined_at, users(id, username)").eq("room_id", room.id).order("joined_at");
    if (memErr) return handleDbError(res, memErr);
    res.json({ room, role: member.role, members: (members || []).map(m => ({ ...m.users, role: m.role, joined_at: m.joined_at })) });
  } catch (e) { handleDbError(res, e); }
});

app.get("/api/rooms/:id/messages", auth, async (req, res) => {
  try {
    const member = await roomMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: "M chưa tham gia phòng này." });
    const after = req.query.after ? new Date(req.query.after).toISOString() : null;
    let query = supabase.from("messages")
      .select("id, room_id, user_id, body, created_at, users(username)")
      .eq("room_id", req.params.id).order("created_at", { ascending: true }).limit(100);
    if (after) query = query.gt("created_at", after);
    const { data, error } = await query;
    if (error) return handleDbError(res, error);
    res.json({ messages: (data || []).map(m => ({ id: m.id, room_id: m.room_id, user_id: m.user_id, username: m.users?.username || "Thành viên", body: m.body, created_at: m.created_at })) });
  } catch (e) { handleDbError(res, e); }
});

app.post("/api/rooms/:id/messages", auth, async (req, res) => {
  try {
    const member = await roomMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: "M chưa tham gia phòng này." });
    const body = safeText(req.body.body, 2000);
    if (!body) return res.status(400).json({ error: "Tin nhắn không được để trống." });
    const { data, error } = await supabase.from("messages")
      .insert({ room_id: req.params.id, user_id: req.user.id, body })
      .select("id, room_id, user_id, body, created_at").single();
    if (error) return handleDbError(res, error);
    res.status(201).json({ message: { ...data, username: req.user.username } });
  } catch (e) { handleDbError(res, e); }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "application/pdf", "text/plain", "image/jpeg", "image/png", "image/webp",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip", "application/x-zip-compressed"
    ]);
    if (!allowed.has(file.mimetype)) return cb(new Error("Loại file chưa được hỗ trợ. Hãy dùng PDF, Office, ảnh, TXT hoặc ZIP."));
    cb(null, true);
  }
});

app.get("/api/rooms/:id/files", auth, async (req, res) => {
  try {
    const member = await roomMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: "M chưa tham gia phòng này." });
    const { data, error } = await supabase.from("room_files")
      .select("id, room_id, user_id, original_name, size_bytes, mime_type, storage_path, created_at, users(username)")
      .eq("room_id", req.params.id).order("created_at", { ascending: false }).limit(100);
    if (error) return handleDbError(res, error);
    res.json({ files: (data || []).map(f => ({
      id: f.id, room_id: f.room_id, user_id: f.user_id,
      original_name: f.original_name, size_bytes: f.size_bytes, mime_type: f.mime_type,
      created_at: f.created_at, username: f.users?.username || "Thành viên"
    })) });
  } catch (e) { handleDbError(res, e); }
});

app.post("/api/rooms/:id/files", auth, upload.single("file"), async (req, res) => {
  try {
    const member = await roomMember(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: "M chưa tham gia phòng này." });
    if (!req.file) return res.status(400).json({ error: "Chọn file trước khi gửi." });
    const originalName = path.basename(req.file.originalname).replace(/[^\p{L}\p{N}._() \-]/gu, "_").slice(0, 180) || "tai-lieu";
    const storagePath = `${req.params.id}/${crypto.randomUUID()}-${originalName}`;
    const { error: upError } = await supabase.storage.from(BUCKET).upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype, upsert: false
    });
    if (upError) return res.status(500).json({ error: "Tải file lên kho lưu trữ thất bại. Kiểm tra bucket Supabase." });
    const { data, error } = await supabase.from("room_files").insert({
      room_id: req.params.id, user_id: req.user.id, original_name: originalName,
      size_bytes: req.file.size, mime_type: req.file.mimetype, storage_path: storagePath
    }).select("id, room_id, user_id, original_name, size_bytes, mime_type, created_at").single();
    if (error) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return handleDbError(res, error);
    }
    res.status(201).json({ file: { ...data, username: req.user.username } });
  } catch (e) {
    if (e instanceof multer.MulterError && e.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `File vượt quá ${MAX_FILE_MB} MB.` });
    if (e.message?.startsWith("Loại file")) return res.status(400).json({ error: e.message });
    handleDbError(res, e);
  }
});

app.get("/api/files/:id/download", auth, async (req, res) => {
  try {
    const { data: file, error } = await supabase.from("room_files")
      .select("id, room_id, original_name, storage_path, mime_type").eq("id", req.params.id).maybeSingle();
    if (error) return handleDbError(res, error);
    if (!file) return res.status(404).json({ error: "Không tìm thấy file." });
    const member = await roomMember(file.room_id, req.user.id);
    if (!member) return res.status(403).json({ error: "M không có quyền tải file này." });
    const { data: signed, error: signError } = await supabase.storage.from(BUCKET)
      .createSignedUrl(file.storage_path, 60, { download: file.original_name });
    if (signError || !signed?.signedUrl) return res.status(500).json({ error: "Không tạo được link tải file." });
    res.json({ url: signed.signedUrl });
  } catch (e) { handleDbError(res, e); }
});

app.use((err, _req, res, _next) => {
  console.error(err?.message || err);
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File vượt quá ${MAX_FILE_MB} MB.` });
  }
  if (err.message?.startsWith("Loại file")) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: "Lỗi máy chủ." });
});

app.get("/{*path}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API không tồn tại." });
  res.sendFile(path.join(__dirname, "public", "index.html"), err => { if (err) next(err); });
});

app.listen(PORT, () => console.log(`StudyRoom đang chạy tại cổng ${PORT}`));
