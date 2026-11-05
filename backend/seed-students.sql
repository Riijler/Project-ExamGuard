USE examguard;

INSERT INTO students (student_number, name, class_name)
VALUES
    ('EG-2026-001', 'Alya Putri', 'XII IPA 1'),
    ('EG-2026-002', 'Bima Pratama', 'XII IPA 1'),
    ('EG-2026-003', 'Citra Lestari', 'XII IPA 1'),
    ('EG-2026-004', 'Daffa Ramadhan', 'XII IPA 1'),
    ('EG-2026-005', 'Eka Safitri', 'XII IPA 1'),
    ('EG-2026-006', 'Farhan Akbar', 'XII IPA 2'),
    ('EG-2026-007', 'Gita Maharani', 'XII IPA 2'),
    ('EG-2026-008', 'Hendra Saputra', 'XII IPA 2'),
    ('EG-2026-009', 'Intan Permata', 'XII IPA 2'),
    ('EG-2026-010', 'Joko Firmansyah', 'XII IPA 2')
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    class_name = VALUES(class_name);
