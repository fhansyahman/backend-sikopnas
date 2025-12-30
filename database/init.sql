-- Buat database jika belum ada
CREATE DATABASE IF NOT EXISTS sikopna;
USE sikopna;

-- Tabel jam_kerja
CREATE TABLE IF NOT EXISTS jam_kerja (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nama_setting VARCHAR(100) DEFAULT 'Default',
    jam_masuk_standar TIME DEFAULT '08:00:00',
    jam_pulang_standar TIME DEFAULT '17:00:00',
    toleransi_keterlambatan TIME DEFAULT '00:15:00',
    batas_terlambat TIME DEFAULT '09:00:00',
    is_active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel users
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nama VARCHAR(100) NOT NULL,
    tempat_lahir VARCHAR(100),
    tanggal_lahir DATE,
    alamat TEXT,
    jenis_kelamin ENUM('Laki-laki','Perempuan'),
    no_hp VARCHAR(20),
    pendidikan_terakhir VARCHAR(50),
    wilayah_penugasan VARCHAR(100),
    wilayah_id INT,
    jam_kerja_id INT,
    can_remote TINYINT DEFAULT 0,
    jabatan VARCHAR(100),
    status ENUM('Aktif','Nonaktif') DEFAULT 'Aktif',
    is_active TINYINT DEFAULT 1,
    roles ENUM('admin','atasan','pegawai') DEFAULT 'pegawai',
    foto VARCHAR(255),
    username VARCHAR(50) UNIQUE,
    password VARCHAR(255),
    telegram_id VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (jam_kerja_id) REFERENCES jam_kerja(id)
);

-- Tabel hari_libur
CREATE TABLE IF NOT EXISTS hari_libur (
    id INT PRIMARY KEY AUTO_INCREMENT,
    tanggal DATE NOT NULL,
    nama_libur VARCHAR(100) NOT NULL,
    is_tahunan TINYINT DEFAULT 1,
    tahun YEAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_tanggal (tanggal)
);

-- Tabel hari_kerja
CREATE TABLE IF NOT EXISTS hari_kerja (
    id INT PRIMARY KEY AUTO_INCREMENT,
    tanggal DATE NOT NULL,
    is_hari_kerja TINYINT DEFAULT 1,
    keterangan VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_tanggal (tanggal)
);

-- Tabel izin
CREATE TABLE IF NOT EXISTS izin (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    tanggal_mulai DATE NOT NULL,
    tanggal_selesai DATE NOT NULL,
    durasi_hari INT,
    jenis ENUM('Sakit', 'Izin', 'Cuti Tahunan', 'Cuti Besar', 'Cuti Sakit', 'Cuti Melahirkan', 'Tugas Luar', 'Dinas Luar') NOT NULL,
    keterangan VARCHAR(255),
    dokumen_pendukung VARCHAR(255),
    status ENUM('Pending', 'Disetujui', 'Ditolak') DEFAULT 'Pending',
    updated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Tabel presensi
CREATE TABLE IF NOT EXISTS presensi (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    izin_id INT,
    tanggal DATE NOT NULL,
    jam_masuk TIME,
    foto_masuk VARCHAR(255),
    latitude_masuk DECIMAL(10, 8),
    longitude_masuk DECIMAL(11, 8),
    jam_pulang TIME,
    foto_pulang VARCHAR(255),
    latitude_pulang DECIMAL(10, 8),
    longitude_pulang DECIMAL(11, 8),
    status_masuk ENUM('Tepat Waktu', 'Terlambat', 'Tanpa Keterangan') DEFAULT 'Tanpa Keterangan',
    status_pulang ENUM('Tepat Waktu', 'Cepat Pulang', 'Lembur', 'Belum Pulang') DEFAULT 'Belum Pulang',
    is_lembur TINYINT DEFAULT 0,
    jam_lembur TIME,
    keterangan VARCHAR(255),
    is_system_generated TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (izin_id) REFERENCES izin(id),
    UNIQUE KEY unique_user_tanggal (user_id, tanggal)
);

-- Tabel aktivitas_pekerja
CREATE TABLE IF NOT EXISTS aktivitas_pekerja (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    tanggal DATE NOT NULL,
    wilayah VARCHAR(100),
    lokasi VARCHAR(255),
    durasi TIME,
    kegiatan TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tabel work_reports
CREATE TABLE IF NOT EXISTS work_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    izin_id INT,
    tanggal DATE NOT NULL,
    ruas_jalan VARCHAR(100),
    kegiatan VARCHAR(100),
    panjang_kr DECIMAL(10, 2),
    panjang_kn DECIMAL(10, 2),
    warna_sket VARCHAR(50),
    sket_image VARCHAR(255),
    foto0 VARCHAR(255),
    foto50 VARCHAR(255),
    foto100 VARCHAR(255),
    status ENUM('Draft', 'Submitted', 'Approved', 'Rejected') DEFAULT 'Draft',
    approved_by INT,
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (izin_id) REFERENCES izin(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Tabel wilayah
CREATE TABLE IF NOT EXISTS wilayah (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nama_wilayah VARCHAR(100) NOT NULL,
    keterangan TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel ruas_jalan
CREATE TABLE IF NOT EXISTS ruas_jalan (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nama_ruas VARCHAR(100) NOT NULL,
    lokasi_awal VARCHAR(255),
    lokasi_akhir VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel kegiatan
CREATE TABLE IF NOT EXISTS kegiatan (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nama_kegiatan VARCHAR(100) NOT NULL,
    deskripsi TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel tugas
CREATE TABLE IF NOT EXISTS tugas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nama_tugas VARCHAR(100) NOT NULL,
    deskripsi TEXT,
    tanggal_tugas DATE NOT NULL,
    deadline DATE,
    priority ENUM('Low', 'Medium', 'High', 'Critical') DEFAULT 'Medium',
    wilayah_id INT,
    link_lokasi VARCHAR(255),
    dibuat_oleh INT,
    status ENUM('Pending', 'In Progress', 'Completed', 'Cancelled') DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wilayah_id) REFERENCES wilayah(id),
    FOREIGN KEY (dibuat_oleh) REFERENCES users(id)
);

-- Tabel system_log
CREATE TABLE IF NOT EXISTS system_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_type VARCHAR(100) NOT NULL,
    description TEXT,
    user_id INT,
    records_affected INT DEFAULT 0,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tabel telegram_sessions
CREATE TABLE IF NOT EXISTS telegram_sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    chat_id BIGINT NOT NULL,
    step VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel pemutihan_presensi
CREATE TABLE IF NOT EXISTS pemutihan_presensi (
    id INT PRIMARY KEY AUTO_INCREMENT,
    absensi_id INT NOT NULL,
    user_id INT NOT NULL,
    admin_id INT NOT NULL,
    tanggal DATE NOT NULL,
    alasan TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (absensi_id) REFERENCES presensi(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (admin_id) REFERENCES users(id)
);

-- Insert data master jam_kerja
INSERT INTO jam_kerja (nama_setting, jam_masuk_standar, jam_pulang_standar, toleransi_keterlambatan, batas_terlambat) VALUES
('Default', '08:00:00', '17:00:00', '00:15:00', '09:00:00'),
('Flexible', '09:00:00', '18:00:00', '00:30:00', '10:00:00'),
('Shift Pagi', '07:00:00', '16:00:00', '00:15:00', '08:00:00'),
('Shift Siang', '13:00:00', '22:00:00', '00:15:00', '14:00:00');

-- Insert data sample users (password: password123)
INSERT INTO users (nama, username, password, jabatan, roles, is_active, jam_kerja_id) VALUES
('Admin SIKOPNAS', 'admin', '$2b$10$U3M0R4dgtJGQ79gIeiw4IebVWWyZ2ykjAc/PmZE6MnaAGmzypweQ2', 'Administrator', 'admin', 1, 1),
('Budi Santoso', 'budi', '$2b$10$U3M0R4dgtJGQ79gIeiw4IebVWWyZ2ykjAc/PmZE6MnaAGmzypweQ2', 'Staff IT', 'pegawai', 1, 1),
('Sari Dewi', 'sari', '$2b$10$U3M0R4dgtJGQ79gIeiw4IebVWWyZ2ykjAc/PmZE6MnaAGmzypweQ2', 'Supervisor', 'atasan', 1, 2),
('Ahmad Fauzi', 'ahmad', '$2b$10$U3M0R4dgtJGQ79gIeiw4IebVWWyZ2ykjAc/PmZE6MnaAGmzypweQ2', 'Operator', 'pegawai', 1, 3);

-- Insert sample hari libur
INSERT INTO hari_libur (tanggal, nama_libur, is_tahunan) VALUES
('2024-01-01', 'Tahun Baru 2024', 1),
('2024-03-11', 'Hari Raya Nyepi', 1),
('2024-04-10', 'Idul Fitri 1445H', 1),
('2024-05-01', 'Hari Buruh', 1),
('2024-05-09', 'Kenaikan Isa Almasih', 1),
('2024-08-17', 'Hari Kemerdekaan RI', 1),
('2024-12-25', 'Hari Raya Natal', 1);

-- Insert sample wilayah
INSERT INTO wilayah (nama_wilayah, keterangan) VALUES
('Wilayah Jakarta Pusat', 'Coverage area Jakarta Pusat'),
('Wilayah Jakarta Selatan', 'Coverage area Jakarta Selatan'),
('Wilayah Jakarta Timur', 'Coverage area Jakarta Timur'),
('Wilayah Jakarta Barat', 'Coverage area Jakarta Barat');

-- Insert sample kegiatan
INSERT INTO kegiatan (nama_kegiatan, deskripsi) VALUES
('Pemeliharaan Jalan', 'Kegiatan perawatan dan pemeliharaan jalan'),
('Pengecatan Marka', 'Pengecatan marka jalan dan rambu-rambu'),
('Pembersihan Saluran', 'Pembersihan saluran air dan gorong-gorong'),
('Penanaman Pohon', 'Kegiatan penghijauan dan penanaman pohon');

-- Buat index untuk performa
CREATE INDEX idx_presensi_user_tanggal ON presensi(user_id, tanggal);
CREATE INDEX idx_presensi_tanggal ON presensi(tanggal);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_izin_user_status ON izin(user_id, status);
CREATE INDEX idx_aktivitas_user_tanggal ON aktivitas_pekerja(user_id, tanggal);