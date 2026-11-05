# Backend ExamGuard

## Database MySQL di phpMyAdmin

1. Jalankan MySQL dari XAMPP, lalu buka phpMyAdmin.
2. Pilih **Import**, pilih `backend/database.sql`, lalu tekan **Import**.
   Query tersebut membuat database `examguard` dan tabel siswa, log aktivitas,
   pelanggaran, serta status siswa terhubung dan indikasi pelanggaran.
3. Tambahkan siswa ke tabel `students` sebelum memakai pemetaan hingga 10 slot kamera.
   Contoh: `INSERT INTO students (student_number, name) VALUES ('S001', 'Nama Siswa');`
4. Salin `.env.example` menjadi `.env`, lalu sesuaikan kredensial MySQL jika
   konfigurasi lokal berbeda. Kredensial bawaan cocok untuk XAMPP standar
   (user `root`, tanpa password).
5. Jalankan backend dengan `npm start` dari folder `backend`.
6. Untuk 10 siswa contoh, import `backend/seed-students.sql` di phpMyAdmin.

Dashboard membaca jumlah siswa dan pelanggaran hari ini dari MySQL. Siswa
terhubung dihitung dari siswa unik yang sudah dipetakan ke slot kamera.
Setiap indikasi perilaku mencurigakan dihitung per siswa: empat indikasi
pertama berstatus peringatan, lalu indikasi kelima dan seterusnya berstatus
pelanggaran secara permanen. Hitungan tersebut tersimpan di
`student_violation_state` dan tabel itu dibuat otomatis saat backend berjalan.
Deteksi beserta log aktivitasnya disimpan dalam transaksi database.
Tombol **Reset Tampilan** hanya menyembunyikan log lama di browser dan tidak
mengubah database; tombol **Hapus** pada log menghapus record aktivitas dari
tabel `monitoring_logs`.

## Akses webcam

Jalankan `run-examguard.bat`, izinkan akses kamera ketika browser meminta izin,
lalu tekan **Kamera**. Aplikasi menggunakan stream MediaPipe terlebih dahulu;
jika stream itu tidak tersedia, browser akan mencoba membuka webcam secara
langsung. Gunakan `http://localhost:8080` atau `http://127.0.0.1:8080` agar
browser mengizinkan webcam. Jika kamera sedang dipakai aplikasi lain, tutup
aplikasi tersebut lalu coba lagi.

Untuk melihat preview, klik **Cari Webcam**, izinkan browser mengakses kamera,
pilih nama perangkat, lalu klik **Preview Webcam**. Untuk mengganti kamera
deteksi MediaPipe, pilih **Index** pada daftar MediaPipe dan tekan
**Pakai di MediaPipe**. Index 0–5 adalah urutan kamera OpenCV/DirectShow, bukan
nama perangkat browser; aplikasi mencoba memilih kamera dan me-restart deteksi.
Tutup aplikasi lain yang sedang memakai kamera.

Jika proses MediaPipe lama masih berjalan, tutup jendela **ExamGuard - MediaPipe**
sebelum menjalankan ulang `run-examguard.bat`. Proses lama harus ditutup agar
kode dan daftar webcam yang terbaru dimuat.
