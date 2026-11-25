# Panduan Lengkap Buku Workspace
**CMS Kelas Membaca — Single Page Application (SPA)**  
Versi: 2.0.0 • Tanggal: 2026-11-25

Dokumen ini adalah panduan lengkap instalasi, konfigurasi, penggunaan, dan pemeliharaan **Buku Workspace** (CMS Kelas Membaca) berbasis **Blogspot/Blogger (`theme.xml`)**, **Google Apps Script (`code.gs`)**, dan **Google Spreadsheet** sebagai database.

---

## 1. Ringkasan Produk

**Buku Workspace** adalah aplikasi web SPA untuk mengelola kelas membaca dan membangun kebiasaan membaca. Fitur utama:

- **Landing page premium**: sticky navbar, hero, social proof, fitur, kelas pendampingan membaca, membangun kebiasaan membaca, benefits, katalog buku terbaru (gaya Pustaloka), testimoni, pricing, FAQ, CTA, footer.
- **SPA App**: dashboard, katalog buku, detail buku, bab, jurnal baca, diskusi, kuis, pengguna, pengaturan, profil.
- **CRUD penuh**: Buku, Bab, Reading Logs, Diskusi, Kuis, Hasil Kuis, Pengguna, Settings.
- **Upload gambar ke Google Drive**: cover buku, avatar pengguna, logo workspace. Mendukung upload, simpan, tampil, edit/ganti, dan hapus gambar.
- **REST API**: Google Apps Script Web App dengan respons JSON.
- **Database**: Google Spreadsheet multi-sheet.
- **UI/UX**: cerah, bersih, modern, responsif desktop/mobile, tipografi mudah dibaca (minimal 14px), animasi halus, modal bottom-sheet di mobile.

---

## 2. Daftar File (Hanya 3 File)

| File | Fungsi |
|---|---|
| `PANDUAN_LENGKAP_BUKU_WORKSPACE.md` | Dokumen panduan lengkap ini. |
| `code.gs` | Backend REST API Google Apps Script + setup database + upload/hapus gambar Google Drive. |
| `theme.xml` | Frontend Blogger XML SPA: landing page + aplikasi CRUD + konfigurasi API. |

---

## 3. Prasyarat

1. Akun Google (untuk Spreadsheet, Drive, Apps Script).
2. Akun Blogger/Blogspot (untuk memasang `theme.xml`).
3. Browser modern (Chrome/Edge/Firefox/Safari terbaru).
4. Koneksi internet.

> Tidak perlu server berbayar. Backend berjalan di Google Apps Script, data di Spreadsheet, file gambar di Google Drive.

---

## 4. Arsitektur Singkat

```text
[Browser / Blogger theme.xml SPA]
        |
        |  fetch POST (text/plain JSON) / GET
        v
[Google Apps Script Web App - code.gs]
        |
        +--> [Google Spreadsheet]  : data CRUD
        +--> [Google Drive]        : file gambar (cover/avatar/logo)
```

### Alasan POST `text/plain`
Frontend mengirim request POST dengan `Content-Type: text/plain;charset=utf-8` untuk menghindari preflight CORS OPTIONS yang sering bermasalah pada Apps Script Web App.

---

## 5. Instalasi Backend (`code.gs`)

### Langkah 5.1 — Buat Spreadsheet
1. Buka [Google Sheets](https://sheets.google.com) dan buat spreadsheet baru.
2. Beri nama, misalnya: **Buku Workspace DB**.
3. Catat Spreadsheet ID dari URL:  
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`

### Langkah 5.2 — Buat Project Apps Script
1. Dari Spreadsheet: **Extensions > Apps Script**.
2. Hapus kode default `Code.gs`.
3. Salin seluruh isi file `code.gs` dari proyek ini ke editor Apps Script.
4. Simpan project, misalnya: **Buku Workspace API**.

### Langkah 5.3 — (Opsional) Set Script Properties
Di Apps Script: **Project Settings > Script properties**, tambahkan bila perlu:

| Property | Wajib | Keterangan |
|---|---:|---|
| `SPREADSHEET_ID` | Opsional* | ID spreadsheet target. *Jika script terikat ke spreadsheet (container-bound), bisa dikosongkan. |
| `DRIVE_FOLDER_ID` | Opsional | ID folder Drive untuk upload gambar. Jika kosong, script akan membuat/mencari folder "Buku Workspace Uploads". |
| `ADMIN_EMAILS` | Opsional | Daftar email admin, dipisah koma. Email ini otomatis dipromosikan menjadi admin saat login. |

### Langkah 5.4 — Jalankan Setup Database
1. Di editor Apps Script, pilih fungsi `setupDatabase`.
2. Klik **Run**.
3. Berikan izin (authorization) saat diminta:
   - Spreadsheet access
   - Drive access
   - Script cache/properties/service
4. Pastikan eksekusi sukses. Script akan membuat sheet dan header:

- `Users`
- `Books`
- `Chapters`
- `ReadingLogs`
- `Discussions`
- `Quizzes`
- `QuizResults`
- `Settings`

Script juga membuat data default:
- Settings default workspace.
- Akun admin awal jika belum ada user:
  - **Email**: `admin@bukuws.id`
  - **PIN**: `123456`

> **Penting:** Segera login dan ganti PIN admin setelah instalasi.

### Langkah 5.5 — Deploy sebagai Web App
1. Klik **Deploy > New deployment**.
2. Pilih type: **Web app**.
3. Isi:
   - Description: `Buku Workspace API v2`
   - Execute as: **Me**
   - Who has access: **Anyone** (atau "Anyone with Google account" sesuai kebutuhan; untuk publik/landing disarankan "Anyone")
4. Klik **Deploy**.
5. Salin **Web app URL** yang berakhiran `/exec`.

Contoh:
```text
https://script.google.com/macros/s/AKfycb.../exec
```

### Langkah 5.6 — Uji API
Buka di browser:
```text
YOUR_WEB_APP_URL?action=health
```
Respons sukses:
```json
{
  "success": true,
  "message": "Buku Workspace API aktif.",
  "data": { "version": "2.0.0", "status": "online", ... }
}
```

---

## 6. Instalasi Frontend (`theme.xml`) di Blogger

### Langkah 6.1 — Siapkan API URL
Buka `theme.xml`, cari bagian konfigurasi:
```js
const CONFIG = {
  API_URL: '', // <-- ISI URL Web App Google Apps Script Anda di sini
  ...
};
```
Isi dengan URL Web App `/exec` Anda:
```js
API_URL: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
```

### Langkah 6.2 — Pasang ke Blogger
1. Buka Blogger Dashboard.
2. Pilih blog tujuan.
3. Masuk ke **Theme**.
4. Klik panah di samping **Customize** > **Edit HTML**.
5. Backup tema lama jika perlu.
6. Hapus seluruh isi editor, lalu paste seluruh isi `theme.xml`.
7. Klik **Save**.

### Langkah 6.3 — Verifikasi
1. Buka URL blog.
2. Landing page Buku Workspace harus tampil.
3. Klik **Masuk** / **Mulai Gratis**.
4. Login dengan admin default (jika masih aktif): `admin@bukuws.id` / `123456`.
5. Setelah login, Anda masuk ke SPA dashboard.

---

## 7. Konfigurasi Google Drive untuk Gambar

Aplikasi mendukung upload gambar ke Google Drive untuk:
- Cover buku
- Avatar pengguna
- Logo workspace

### Cara Kerja
1. Frontend membaca file gambar, memvalidasi tipe/ukuran, dan mengonversi ke Base64.
2. Frontend mengirim payload ke action API (`saveBook`, `saveUser`, `updateSettings`, atau `uploadImage`).
3. `code.gs` mendecode Base64, membuat file di folder Drive.
4. File diset `ANYONE_WITH_LINK` + `VIEW` (agar bisa ditampilkan di `<img>`).
5. API mengembalikan URL tampilan: `https://lh3.googleusercontent.com/d/FILE_ID`.
6. URL dan `file_id` disimpan di Spreadsheet.

### Edit / Ganti Gambar
- Saat mengunggah gambar baru pada data yang sudah punya gambar, backend menghapus/trash file lama (berdasarkan `file_id`) lalu menyimpan file baru.
- Ini memenuhi kebutuhan: **upload, simpan, edit, hapus, update, tampilkan**.

### Hapus Gambar
- Form memiliki tombol "Hapus Gambar".
- Saat disimpan dengan flag remove, backend menghapus file Drive (trash) dan mengosongkan URL/file_id di database.

### Batasan Gambar
- Format: JPG, JPEG, PNG, WEBP, GIF.
- Maksimal ukuran: **4MB** (sesuai validasi backend).
- GIF tidak di-resize agar animasi tetap.

### Troubleshooting Gambar Tidak Tampil
- Pastikan deployment Apps Script memiliki izin Drive.
- Pastikan file sharing tidak diblokir kebijakan organisasi Google Workspace.
- Cek `cover_url` / `avatar_url` di Spreadsheet berisi URL `lh3.googleusercontent.com/d/...`.
- Buka URL gambar langsung di tab browser untuk memastikan akses.

---

## 8. Struktur Database (Google Spreadsheet)

### 8.1 Users
| Kolom | Keterangan |
|---|---|
| id | ID unik user |
| name | Nama |
| email | Email login |
| pin_hash | Hash PIN |
| pin_salt | Salt PIN |
| role | `admin` / `member` |
| avatar_url | URL gambar avatar |
| avatar_file_id | ID file Drive avatar |
| bio | Bio singkat |
| status | `active` / `inactive` |
| created_at | ISO timestamp |
| updated_at | ISO timestamp |

### 8.2 Books
| Kolom | Keterangan |
|---|---|
| id | ID buku |
| title | Judul |
| author | Penulis |
| category | Kategori |
| total_pages | Total halaman |
| cover_url | URL cover |
| cover_file_id | ID file Drive cover |
| synopsis | Sinopsis |
| status | `active` / `upcoming` / `archived` |
| featured | `true` / `false` |
| created_by | User ID pembuat |
| created_at | ISO timestamp |
| updated_at | ISO timestamp |

### 8.3 Chapters
| Kolom | Keterangan |
|---|---|
| id | ID bab |
| book_id | Relasi ke Books.id |
| chapter_number | Nomor bab |
| title | Judul bab |
| content_html | Konten materi (HTML sederhana) |
| discussion_prompt | Pertanyaan pemantik diskusi |
| read_time_mins | Estimasi menit baca |
| created_at | ISO timestamp |
| updated_at | ISO timestamp |

### 8.4 ReadingLogs
| Kolom | Keterangan |
|---|---|
| id | ID log |
| user_id | Relasi ke Users.id |
| book_id | Relasi ke Books.id |
| start_page | Halaman awal |
| end_page | Halaman akhir |
| pages_read | Jumlah halaman |
| duration_mins | Durasi baca |
| quote | Kutipan |
| reflection | Refleksi |
| is_public | `true` / `false` |
| created_at | ISO timestamp |
| updated_at | ISO timestamp |

### 8.5 Discussions
| Kolom | Keterangan |
|---|---|
| id | ID diskusi |
| book_id | Relasi buku (opsional) |
| parent_id | Kosong = topik, terisi = balasan |
| user_id | Pembuat |
| title | Judul topik |
| content | Isi diskusi |
| likes_json | Array JSON user ID yang like |
| is_pinned | `true` / `false` |
| created_at | ISO timestamp |
| updated_at | ISO timestamp |

### 8.6 Quizzes
| Kolom | Keterangan |
|---|---|
| id | ID kuis |
| book_id | Relasi buku |
| title | Judul kuis |
| description | Deskripsi |
| questions_json | Array JSON soal |
| created_at | ISO timestamp |
| updated_at | ISO timestamp |

### 8.7 QuizResults
| Kolom | Keterangan |
|---|---|
| id | ID hasil |
| quiz_id | Relasi kuis |
| user_id | Peserta |
| score | Nilai 0-100 |
| total_questions | Jumlah soal |
| answers_json | Detail jawaban |
| completed_at | ISO timestamp |

### 8.8 Settings
| Kolom | Keterangan |
|---|---|
| key | Nama setting |
| value | Nilai setting |

Setting default meliputi: `workspace_name`, `workspace_tagline`, `workspace_description`, `logo_url`, `hero_image_url`, `announcement`, `allow_registration`, `drive_folder_id`, `contact_email`, `contact_whatsapp`, `instagram_url`, `youtube_url`, `landing_cta_label`, `landing_cta_url`.

---

## 9. REST API Contract

### 9.1 Format Respons
```json
{
  "success": true,
  "message": "Berhasil.",
  "data": {},
  "timestamp": "2026-11-25T00:00:00.000Z"
}
```

Error:
```json
{
  "success": false,
  "message": "Pesan error",
  "code": "ERROR_CODE",
  "data": null,
  "timestamp": "..."
}
```

### 9.2 Endpoint GET
| Action | Parameter | Fungsi |
|---|---|---|
| `health` | - | Cek status API. |
| `publicLanding` | - | Data landing publik (settings, featured books, stats). |
| `initApp` | `token` (opsional) | Bootstrap SPA: settings, books, chapters, discussions, quizzes, user data. |
| `getBookDetail` | `book_id`, `token` opsional | Detail buku + bab + diskusi + kuis. |
| `getUserDashboard` | `user_id`, `token` | Dashboard user tertentu (self/admin). |
| `getAdminStats` | `token` | Statistik admin. |

### 9.3 Endpoint POST (JSON body)
Body umum:
```json
{
  "action": "saveBook",
  "token": "SESSION_TOKEN",
  "data": { ... }
}
```

| Action | Role | Fungsi |
|---|---|---|
| `register` | Publik | Daftar akun baru (jika `allow_registration=true`). |
| `login` | Publik | Login email + PIN 6 digit. |
| `logout` | Login | Invalidasi sesi cache. |
| `saveBook` | Admin | Create/Update buku + upload/ganti/hapus cover. |
| `deleteBook` | Admin | Hapus buku + data terkait (bab, log, diskusi, kuis, hasil kuis). |
| `saveChapter` | Admin | Create/Update bab. |
| `deleteChapter` | Admin | Hapus bab. |
| `saveReadingLog` | Member/Admin | Create/Update jurnal baca. |
| `deleteReadingLog` | Owner/Admin | Hapus jurnal baca. |
| `saveDiscussion` | Member/Admin | Buat/edit topik atau balasan. |
| `toggleLikeDiscussion` | Member/Admin | Like/unlike diskusi. |
| `togglePinDiscussion` | Admin | Pin/unpin topik. |
| `deleteDiscussion` | Owner/Admin | Hapus diskusi/balasan. |
| `saveQuiz` | Admin | Create/Update kuis + soal. |
| `deleteQuiz` | Admin | Hapus kuis + hasil. |
| `submitQuizResult` | Member/Admin | Submit jawaban, skor dihitung server-side. |
| `saveUser` | Admin/Self | Create/Update user + avatar upload/ganti/hapus. |
| `deleteUser` | Admin | Hapus user (kecuali diri sendiri & admin terakhir). |
| `updateSettings` | Admin | Update settings + upload/ganti/hapus logo/hero. |
| `uploadImage` | Login | Upload gambar umum ke Drive. |
| `deleteImage` | Admin/Owner | Hapus gambar Drive. |

---

## 10. Panduan Penggunaan Aplikasi

### 10.1 Peran Pengguna
- **Admin/Mentor**: akses penuh CRUD buku, bab, kuis, pengguna, settings, moderasi diskusi.
- **Member**: baca buku, catat jurnal, diskusi, kerjakan kuis, edit profil sendiri.
- **Publik/Guest**: melihat landing page, katalog publik, register/login.

### 10.2 Login & Register
- Register: nama, email, PIN 6 digit.
- Login: email, PIN 6 digit.
- Sesi disimpan di `localStorage` token + cache data. Token diverifikasi server (CacheService, TTL 6 jam).

### 10.3 CRUD Buku + Gambar Cover
1. Masuk sebagai Admin.
2. Buka **Katalog Buku** > **Tambah Buku**.
3. Isi judul, penulis, kategori, total halaman, status, sinopsis.
4. Unggah cover (opsional) dari perangkat.
5. Simpan. Gambar diupload ke Google Drive, URL tampil di kartu buku.
6. **Edit**: ganti cover atau hapus cover.
7. **Hapus**: menghapus buku dan data terkait.

### 10.4 CRUD Bab
- Dari detail buku, Admin dapat tambah/edit/hapus bab.
- Bab memiliki nomor, judul, konten, estimasi waktu baca, pertanyaan diskusi.

### 10.5 Jurnal Baca (Reading Log)
- Member/Admin dapat mencatat halaman awal/akhir, durasi, kutipan, refleksi.
- Bisa edit/hapus log milik sendiri (admin bisa semua).
- Progres dan streak ditampilkan di dashboard.

### 10.6 Diskusi
- Buat topik, balas, like/unlike.
- Admin dapat pin/unpin topik.
- Owner/Admin dapat edit/hapus.

### 10.7 Kuis
- Admin membuat kuis pilihan ganda per buku.
- Member mengerjakan kuis; skor dihitung di server.
- Hasil tersimpan di `QuizResults`.

### 10.8 Pengguna & Profil
- Admin: tambah/edit/hapus pengguna, set role/status, upload avatar.
- User: edit profil sendiri, ganti avatar, ganti PIN (butuh PIN lama).

### 10.9 Settings
- Admin dapat mengubah nama workspace, tagline, deskripsi, pengumuman, kontak, allow registration, logo.
- Logo dapat diupload/ganti/hapus dari Google Drive.

---

## 11. Keamanan & Validasi

- **Session token**: random token, disimpan di CacheService dengan TTL.
- **Rate limit**: login/register dibatasi untuk mengurangi brute force.
- **LockService**: operasi tulis POST dibungkus lock untuk mencegah race condition.
- **Validasi input**: email, PIN 6 digit, panjang teks, tipe gambar, ukuran gambar.
- **Role check**: aksi admin divalidasi di server (`bwRequireAdmin_`).
- **Sanitasi tampilan**: frontend melakukan escaping HTML saat render data teks.
- **Image sharing**: file Drive diset "Anyone with link can view" agar dapat ditampilkan; jangan unggah dokumen sensitif.

> Catatan: Untuk produksi skala besar, pertimbangkan migrasi ke backend dengan auth yang lebih kuat (OAuth/JWT), audit log, dan kebijakan file Drive organisasi.

---

## 12. Kustomisasi Cepat

### 12.1 Ubah Warna/Tema
Di `theme.xml`, edit variabel CSS `:root`:
- `--primary`: warna utama
- `--bg`: background
- `--mint`, `--amber`, `--rose`: warna status

### 12.2 Ubah Konten Landing Page
Edit section HTML di `theme.xml`:
- Hero: `#home`
- Fitur: `#features`
- Kelas pendampingan: `#kelas`
- Kebiasaan membaca: `#kebiasaan`
- Benefits: `#benefits`
- Katalog: `#katalog`
- Testimoni: `#testimonials`
- Harga: `#harga`
- FAQ: `#faq`
- CTA: `#cta`

### 12.3 Ubah Nama/Brand
- Ubah `CONFIG.APP_NAME` di `theme.xml`.
- Ubah default settings di `code.gs` (`BW.DEFAULT_SETTINGS`).
- Ubah logo melalui menu Settings (upload gambar).

---

## 13. Troubleshooting

### API_URL belum diatur
**Gejala**: toast "API_URL belum diatur..."  
**Solusi**: isi `CONFIG.API_URL` di `theme.xml` dengan URL Web App `/exec`.

### Gagal fetch / CORS / Network Error
- Pastikan deploy Web App aksesnya "Anyone".
- Pastikan URL benar dan berakhiran `/exec`.
- Pastikan tidak ada typo.
- Redeploy jika baru update `code.gs` (buat deployment versi baru).

### Login gagal / sesi habis
- Cek email dan PIN 6 digit.
- Sesi kadaluarsa (6 jam) atau cache server dibersihkan: login ulang.
- Jika rate limit: tunggu beberapa menit.

### Gambar tidak muncul
- Cek ukuran < 4MB dan format didukung.
- Cek izin Drive pada Apps Script.
- Cek URL gambar di Spreadsheet.
- Cek kebijakan sharing Drive domain/organisasi.

### Data tidak berubah setelah update code.gs
- Buat **New deployment** atau **Manage deployments > Edit > New version**.
- URL `/exec` deployment yang sama biasanya tetap, tapi pastikan versi terbaru dipilih.

### Spreadsheet tidak terbuat lengkap
- Jalankan ulang `setupDatabase()`.
- Pastikan script punya izin Spreadsheet.
- Cek `SPREADSHEET_ID` jika menggunakan script standalone.

### Blogger menolak XML
- Pastikan tidak menghapus struktur `<b:skin>` dan `<b:section>`.
- Pastikan file adalah XML valid.
- Jangan menambah karakter ilegal di luar CDATA script/style.

---

## 14. Checklist QA Sebelum Rilis

- [ ] `setupDatabase()` sukses dan semua sheet terbentuk.
- [ ] `?action=health` mengembalikan `success:true`.
- [ ] Login admin default berhasil, PIN diganti.
- [ ] Register member baru berhasil (jika diaktifkan).
- [ ] CRUD Buku: tambah, edit, hapus berhasil.
- [ ] Upload cover buku ke Drive berhasil dan tampil.
- [ ] Ganti cover buku: file baru tampil, file lama tidak dipakai.
- [ ] Hapus cover buku: gambar hilang dari UI dan file ditrash.
- [ ] CRUD Bab: tambah, edit, hapus berhasil.
- [ ] CRUD Jurnal Baca: tambah, edit, hapus berhasil.
- [ ] CRUD Diskusi: topik, balas, like, pin, hapus berhasil.
- [ ] CRUD Kuis: tambah, edit, hapus, submit hasil berhasil.
- [ ] CRUD Pengguna: tambah, edit, hapus, avatar upload berhasil.
- [ ] Settings: update nama/tagline/logo berhasil.
- [ ] Landing page responsif di 360px, 768px, 1024px, 1440px.
- [ ] Tidak ada teks penting < 14px.
- [ ] Modal mobile tampil sebagai bottom sheet, bisa ditutup.
- [ ] Tombol simpan memiliki loading/anti double submit.

---

## 15. Rekomendasi Pengembangan Lanjutan

1. **Pagination / lazy load** untuk data besar.
2. **Indexing** berbasis cache untuk lookup ID agar lebih cepat.
3. **Audit log** perubahan data penting.
4. **Export CSV/PDF** laporan bacaan.
5. **Notifikasi email/WA** untuk pengingat streak.
6. **Role lebih granular** (mentor, moderator, member).
7. **Rich text editor** aman untuk konten bab.
8. **PWA manifest/service worker** jika di-host di luar keterbatasan Blogger.

---

## 16. Kredensial Default (Setelah setupDatabase)

- Email: `admin@bukuws.id`
- PIN: `123456`

**Segera ganti PIN setelah login pertama.**

---

## 17. Catatan Penting

- File gambar disimpan di Google Drive akun yang menjalankan Apps Script.
- Spreadsheet adalah sumber data utama; jangan mengubah nama header kolom secara sembarangan.
- Jika mengubah schema, perbarui `BW.TABLES` di `code.gs` dan sesuaikan frontend.
- Untuk deployment publik, pastikan aturan berbagi Drive sesuai kebijakan privasi komunitas Anda.

---

**Buku Workspace** — Bangun kebiasaan membaca, satu halaman setiap hari.
