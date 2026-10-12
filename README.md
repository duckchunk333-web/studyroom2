# StudyRoom — web học nhóm

Một repository gồm frontend + backend Node.js/Express. Tính năng:
- Đăng ký/đăng nhập bằng tên tài khoản + mật khẩu (bcrypt).
- Tạo phòng và tham gia bằng mã 8 ký tự.
- Chat trong phòng (polling mỗi 2,5 giây).
- Upload/tải file riêng tư qua Supabase Storage, giới hạn mặc định 10 MB.
- Phân quyền: phải là thành viên phòng mới đọc chat, xem danh sách file hoặc tải file.
- Giao diện responsive cho điện thoại và máy tính.

## Kiến trúc

- **GitHub:** lưu mã nguồn.
- **Render Web Service:** chạy Express, phục vụ giao diện và API.
- **Supabase:** PostgreSQL lưu dữ liệu, Storage lưu file.
- **UptimeRobot:** giám sát `https://TEN-WEB.onrender.com/api/health`.

> UptimeRobot chỉ giám sát và cảnh báo, không phải máy chủ và không đảm bảo Render luôn thức. Gói Render miễn phí có thể ngủ khi không có truy cập. Tài nguyên miễn phí và giới hạn của nhà cung cấp có thể thay đổi.

## A. Tạo Supabase

1. Vào https://supabase.com/ và tạo project.
2. Đặt mật khẩu database mạnh, lưu ở nơi an toàn.
3. Mở **SQL Editor → New query**.
4. Mở file `supabase-schema.sql` trong repo, copy toàn bộ, dán vào SQL Editor rồi bấm **Run**.
5. Vào **Storage → New bucket**.
   - Bucket name: `studyroom-files`
   - **Public bucket: OFF** (bucket riêng tư)
6. Vào **Project Settings → API** (hoặc API Keys tuỳ giao diện):
   - Copy Project URL.
   - Lấy `service_role`/secret key ở phía server. Không bao giờ đưa key này vào HTML, JavaScript frontend, ảnh chụp công khai hay GitHub.
   - Nếu giao diện Supabase chỉ hiện `secret key`, dùng key bí mật dành cho server. Không dùng publishable/anon key thay cho server key.

## B. Đưa code lên GitHub

1. Tải file ZIP và giải nén.
2. Tạo repository mới trên https://github.com/new, ví dụ `studyroom`.
3. Upload toàn bộ file bên trong thư mục `studyroom` lên repo (không upload file `.env`, key hay mật khẩu).
4. Kiểm tra `package.json`, `server.js`, thư mục `public/` và `supabase-schema.sql` nằm ở thư mục gốc repo.

## C. Deploy Render

1. Vào https://render.com/ và đăng nhập bằng GitHub.
2. Chọn **New → Web Service**, kết nối repo `studyroom`.
3. Cấu hình:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance: gói phù hợp (có thể bắt đầu bằng Free nếu tài khoản có lựa chọn này).
4. Trong **Environment**, thêm từng biến:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = một chuỗi ngẫu nhiên bí mật dài ít nhất 32 ký tự (xem lệnh tạo bên dưới)
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = key bí mật server-side từ Supabase
   - `SUPABASE_STORAGE_BUCKET` = `studyroom-files`
   - `MAX_FILE_MB` = `10`
5. Bấm deploy. Khi thành công, mở URL Render được cấp, ví dụ `https://studyroom-xxxx.onrender.com`.
6. Kiểm tra `https://TEN-WEB.onrender.com/api/health` phải hiện JSON có `"ok":true`.

### Tạo JWT_SECRET

Trên máy có Node.js chạy:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Copy kết quả vào Environment của Render. Không đưa giá trị này lên GitHub.

## D. Theo dõi bằng UptimeRobot

1. Vào https://uptimerobot.com/ và tạo tài khoản.
2. Add New Monitor → loại **HTTP(s)**.
3. Friendly Name: `StudyRoom API`.
4. URL: `https://TEN-WEB.onrender.com/api/health`.
5. Chọn khoảng kiểm tra phù hợp với gói hiện tại, cấu hình email cảnh báo rồi tạo monitor.
6. Khi Render free ngủ, lần kiểm tra đầu tiên có thể chậm. Monitor không thay thế hosting luôn bật.

## E. Chạy thử trên máy tính

Cần Node.js 20 trở lên. Sau khi đã điền biến môi trường:
```bash
npm install
npm start
```
Mở `http://localhost:3000`.

Tạo file `.env` bằng cách sao chép `.env.example` rồi điền giá trị thật. File `.env` bị `.gitignore` loại khỏi Git.

## Lưu ý vận hành và bảo mật

- Không bao giờ commit `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` hoặc file `.env`.
- Mật khẩu được băm bằng bcrypt; server cấp JWT trong cookie `HttpOnly`, `SameSite=Lax`, cookie `Secure` khi chạy production HTTPS.
- Không có tính năng đặt lại mật khẩu trong bản đầu tiên; username không phải email nên nếu quên mật khẩu, cần bổ sung quy trình khôi phục an toàn.
- Chat đang dùng polling (tải tin nhắn mới mỗi 2,5 giây), không phải WebSocket; dễ triển khai và phù hợp nhóm nhỏ nhưng dùng nhiều request hơn.
- Bản này giới hạn file ở 10 MB và kiểm tra MIME type phía server. Kiểm tra MIME không thể đảm bảo tuyệt đối nội dung file an toàn; chỉ tải file từ người bạn tin tưởng.
- Supabase Storage và database có quota miễn phí. Theo dõi mức dùng trong dashboard; nếu vượt quota có thể cần nâng cấp.
- Có thể thêm giới hạn thành viên/phòng, xoá file, rời phòng, quản trị viên, chống spam chat và khôi phục mật khẩu ở phiên bản tiếp theo.
