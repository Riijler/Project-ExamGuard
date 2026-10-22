import cv2
import time
import math
import requests
import numpy as np
import serial
import mediapipe as mp
from flask import Flask, Response
import threading

from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision


# ================== PENGATURAN ==================
ESP_PORT = 'COM3'
BAUD = 115200
NUM_FACES = 5

# IP Laptop A / Laptop yang menjalankan Node.js
BACKEND_URL = "http://10.98.166.146:3000/api/detection"

# Server kamera
CAMERA_PORT = 5000

YAW_LIMIT = 25        # derajat menoleh kiri/kanan dari posisi lurus
PITCH_LIMIT = 20      # derajat menunduk dari posisi lurus
HOLD_SEC = 1.5        # lama menoleh/menunduk sebelum alarm
LOST_SEC = 0.5        # lama wajah hilang sebelum alarm
CALIB_SEC = 2.0        # lama kalibrasi
PITCH_DOWN_SIGN = 1   # ganti ke -1 kalau menunduk malah angkanya negatif
SMOOTH = 0.4          # 0-1, makin kecil makin halus
# ================================================


# =================================================
# SERVER CAMERA
# =================================================

app = Flask(__name__)

# Frame kamera terbaru
latest_frame = None

# Supaya akses frame aman antara
# program detector dan Flask
frame_lock = threading.Lock()


def generate_frames():
    """
    Mengirim frame kamera terbaru
    sebagai MJPEG stream.
    """

    global latest_frame

    while True:

        with frame_lock:

            if latest_frame is None:
                time.sleep(0.01)
                continue

            frame = latest_frame.copy()

        success, buffer = cv2.imencode(".jpg", frame)

        if not success:
            continue

        frame_bytes = buffer.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + frame_bytes
            + b"\r\n"
        )


@app.route("/video_feed")
def video_feed():

    return Response(
        generate_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


@app.route("/")
def camera_home():

    return """
    <h2>ExamGuard Camera Server</h2>
    <p>Camera server aktif.</p>
    <p>
        Buka <b>/video_feed</b> untuk melihat live camera.
    </p>
    """


def start_camera_server():

    app.run(
        host="0.0.0.0",
        port=CAMERA_PORT,
        debug=False,
        threaded=True,
        use_reloader=False
    )


# =================================================
# ESP32
# =================================================

try:

    ser = serial.Serial(
        ESP_PORT,
        BAUD,
        timeout=1
    )

    time.sleep(2)

    print("ESP32 terhubung di", ESP_PORT)

except serial.SerialException as e:

    ser = None

    print(
        "ESP32 tidak terhubung "
        "(mode tes kamera saja):",
        e
    )


alarm_sent = None


def kirim(on):

    global alarm_sent

    if ser and on != alarm_sent:

        try:

            ser.write(
                b'1' if on else b'0'
            )

            alarm_sent = on

        except serial.SerialException as e:

            print(
                "Gagal kirim ke ESP32:",
                e
            )


# =================================================
# KIRIM DETEKSI KE DASHBOARD
# =================================================

def kirim_dashboard(
    objek,
    status,
    reason
):

    try:

        response = requests.post(

            BACKEND_URL,

            json={
                "object": objek,
                "status": status,
                "reason": reason
            },

            timeout=2
        )

        response.raise_for_status()

    except requests.RequestException as e:

        print(
            "Gagal kirim ke dashboard:",
            e
        )


# =================================================
# HEAD ANGLES
# =================================================

def head_angles(M):
    """
    Ambil yaw & pitch
    dari matriks transformasi 4x4.
    """

    R = np.array(M)[:3, :3]

    R = R / np.linalg.norm(
        R,
        axis=0
    )

    sy = math.hypot(
        R[0, 0],
        R[1, 0]
    )

    pitch = math.degrees(
        math.atan2(
            R[2, 1],
            R[2, 2]
        )
    )

    yaw = math.degrees(
        math.atan2(
            -R[2, 0],
            sy
        )
    )

    return yaw, pitch


def wrap(a):

    return (
        (a + 180) % 360
    ) - 180


# =================================================
# MEDIA PIPE
# =================================================

options = vision.FaceLandmarkerOptions(

    base_options=mp_python.BaseOptions(
        model_asset_path='face_landmarker.task'
    ),

    running_mode=vision.RunningMode.VIDEO,

    num_faces=NUM_FACES,

    output_facial_transformation_matrixes=True,
)


landmarker = (
    vision.FaceLandmarker
    .create_from_options(options)
)


# =================================================
# START CAMERA SERVER
# =================================================

server_thread = threading.Thread(
    target=start_camera_server,
    daemon=True
)

server_thread.start()

print(
    f"Camera server berjalan di port {CAMERA_PORT}"
)


# =================================================
# CAMERA
# =================================================

cap = cv2.VideoCapture(0)

if not cap.isOpened():

    print("Kamera tidak dapat dibuka.")

    if ser:
        ser.close()

    raise SystemExit


t0 = time.time()


# =================================================
# VARIABLE DETECTOR
# =================================================

show_landmarks = True

starts = {}
# timer menoleh/menunduk per objek

smooth = {}
# sudut yang sudah dihaluskan per objek

base = {}
# baseline yaw/pitch per objek

last_dashboard_status = {}

calib_count = 0
# jumlah orang saat kalibrasi

max_seen = 0

calibrating_until = 0

calib_samples = {}
# i -> list (yaw, pitch)

calib_counts = []

lost_start = None


# =================================================
# MAIN LOOP
# =================================================

while cap.isOpened():

    ok, frame = cap.read()

    if not ok:
        break


    # -------------------------------------------------
    # MIRROR CAMERA
    # -------------------------------------------------

    frame = cv2.flip(
        frame,
        1
    )


    h, w = frame.shape[:2]

    now = time.time()


    # -------------------------------------------------
    # SIMPAN FRAME UNTUK CAMERA STREAM
    # -------------------------------------------------

    with frame_lock:

        latest_frame = frame.copy()


    # -------------------------------------------------
    # MEDIA PIPE
    # -------------------------------------------------

    rgb = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )


    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=rgb
    )


    res = landmarker.detect_for_video(
        mp_image,
        int((now - t0) * 1000)
    )


    # =================================================
    # AMBIL DATA WAJAH
    # =================================================

    faces = []


    for k, lm in enumerate(
        res.face_landmarks
    ):

        xs = [
            p.x * w
            for p in lm
        ]

        ys = [
            p.y * h
            for p in lm
        ]


        yaw, pitch = head_angles(
            res.facial_transformation_matrixes[k]
        )


        faces.append({

            "lm": lm,

            "yaw": yaw,

            "pitch": pitch,

            "cx": lm[1].x,

            "box": (
                int(min(xs)),
                int(min(ys)),
                int(max(xs)),
                int(max(ys))
            ),

        })


    faces.sort(
        key=lambda f: f["cx"]
    )


    max_seen = max(
        max_seen,
        len(faces)
    )


    # =================================================
    # KALIBRASI
    # =================================================

    calibrating = (
        now < calibrating_until
    )


    if calibrating:

        calib_counts.append(
            len(faces)
        )


        for i, f in enumerate(faces):

            calib_samples.setdefault(
                i,
                []
            ).append(
                (
                    f["yaw"],
                    f["pitch"]
                )
            )


    elif calib_samples:

        for i, s in calib_samples.items():

            arr = np.array(s)

            base[i] = (

                float(
                    arr[:, 0].mean()
                ),

                float(
                    arr[:, 1].mean()
                )

            )


        calib_count = (
            int(np.median(calib_counts))
            if calib_counts
            else 0
        )


        calib_samples = {}
        calib_counts = []


        starts.clear()
        smooth.clear()


        print(
            "Kalibrasi selesai:",
            calib_count,
            "orang"
        )


    # =================================================
    # PENILAIAN PER ORANG
    # =================================================

    any_alarm = False


    for i, f in enumerate(faces):

        by, bp = base.get(
            i,
            (0.0, 0.0)
        )


        dy = wrap(
            f["yaw"] - by
        )


        dp = (
            wrap(
                f["pitch"] - bp
            )
            * PITCH_DOWN_SIGN
        )


        # -------------------------------------------------
        # SMOOTHING
        # -------------------------------------------------

        sy_, sp_ = smooth.get(
            i,
            (dy, dp)
        )


        sy_ = (
            sy_
            + SMOOTH * (dy - sy_)
        )


        sp_ = (
            sp_
            + SMOOTH * (dp - sp_)
        )


        smooth[i] = (
            sy_,
            sp_
        )


        # -------------------------------------------------
        # CEK GERAKAN
        # -------------------------------------------------

        turn = (
            abs(sy_)
            > YAW_LIMIT
        )


        down = (
            sp_
            > PITCH_LIMIT
        )


        suspicious = (
            (turn or down)
            and not calibrating
        )


        elapsed = 0
        alarm = False


        if suspicious and not calibrating:

            starts.setdefault(
                i,
                now
            )


            elapsed = (
                now
                - starts[i]
            )


            alarm = (
                elapsed
                > HOLD_SEC
            )


        else:

            starts.pop(
                i,
                None
            )


        # -------------------------------------------------
        # ALASAN
        # -------------------------------------------------

        reason = (
            "MENOLEH"
            if turn
            else "MENUNDUK"
        )


        # -------------------------------------------------
        # STATUS
        # -------------------------------------------------

        if alarm:

            color = (
                0,
                0,
                255
            )

            status = (
                f"MENCURIGAKAN "
                f"({reason})"
            )

            dashboard_status = (
                "violation"
            )

            any_alarm = True


        elif suspicious:

            color = (
                0,
                165,
                255
            )

            status = (
                f"{reason} "
                f"{elapsed:.1f}/"
                f"{HOLD_SEC}s"
            )

            dashboard_status = (
                "warning"
            )


        else:

            color = (
                0,
                255,
                0
            )

            status = "Normal"

            dashboard_status = (
                "safe"
            )


        # -------------------------------------------------
        # KIRIM STATUS KE DASHBOARD
        # -------------------------------------------------

        current_state = (
            dashboard_status,
            reason
        )


        if (
            last_dashboard_status.get(i)
            != current_state
        ):

            kirim_dashboard(
                i + 1,
                dashboard_status,
                reason
            )


            last_dashboard_status[i] = (
                current_state
            )


        # =================================================
        # LANDMARK
        # =================================================

        if show_landmarks:

            for p in f["lm"]:

                cv2.circle(

                    frame,

                    (
                        int(p.x * w),
                        int(p.y * h)
                    ),

                    1,

                    color,

                    -1
                )


        # =================================================
        # FACE BOX
        # =================================================

        x1, y1, x2, y2 = f["box"]


        cv2.rectangle(

            frame,

            (
                x1,
                y1
            ),

            (
                x2,
                y2
            ),

            color,

            2
        )


        # =================================================
        # OBJECT STATUS
        # =================================================

        cv2.putText(

            frame,

            f"Objek {i+1} | {status}",

            (
                x1,
                max(
                    y1 - 24,
                    15
                )
            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            0.5,

            color,

            2
        )


        # =================================================
        # YAW / PITCH
        # =================================================

        cv2.putText(

            frame,

            f"yaw {sy_:+.0f}  "
            f"pitch {sp_:+.0f}",

            (
                x1,
                max(
                    y1 - 6,
                    30
                )
            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            0.5,

            color,

            1
        )


    # =================================================
    # HAPUS TIMER WAJAH YANG HILANG
    # =================================================

    for k in list(starts):

        if k >= len(faces):

            starts.pop(k)


    # =================================================
    # WAJAH HILANG
    # =================================================

    expected = (
        calib_count
        if calib_count
        else max_seen
    )


    lost = (

        not calibrating

        and expected > 0

        and len(faces) < expected

    )


    if lost:

        lost_start = (
            lost_start
            or now
        )


        lost_elapsed = (
            now
            - lost_start
        )


        if lost_elapsed > LOST_SEC:

            any_alarm = True


            cv2.putText(

                frame,

                (
                    f"WAJAH HILANG "
                    f"({len(faces)}/{expected})"
                ),

                (
                    10,
                    55
                ),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.8,

                (
                    0,
                    0,
                    255
                ),

                2
            )


        else:

            cv2.putText(

                frame,

                (
                    f"Wajah hilang "
                    f"{lost_elapsed:.1f}/"
                    f"{LOST_SEC}s"
                ),

                (
                    10,
                    55
                ),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.7,

                (
                    0,
                    165,
                    255
                ),

                2
            )


    else:

        lost_start = None


    # =================================================
    # KIRIM KE ESP32
    # =================================================

    kirim(
        any_alarm
    )


    # =================================================
    # HUD
    # =================================================

    if calibrating:

        sisa = (
            calibrating_until
            - now
        )


        cv2.putText(

            frame,

            (
                "KALIBRASI... "
                "lihat lurus ke kamera "
                f"({sisa:.1f}s)"
            ),

            (
                10,
                25
            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            0.7,

            (
                255,
                255,
                0
            ),

            2
        )


    else:

        info = (
            "terkalibrasi"
            if base
            else
            "belum kalibrasi "
            "(tekan C)"
        )


        esp_text = (
            "ESP32 OK"
            if ser
            else
            "ESP32 tidak terhubung"
        )


        cv2.putText(

            frame,

            (
                f"{len(faces)} orang | "
                f"{info} | "
                f"{esp_text} | "
                "C kalibrasi, "
                "L landmark, "
                "Q keluar"
            ),

            (
                10,
                25
            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            0.5,

            (
                255,
                255,
                255
            ),

            2
        )


    # =================================================
    # ALARM BORDER
    # =================================================

    if any_alarm:

        cv2.rectangle(

            frame,

            (
                0,
                0
            ),

            (
                w - 1,
                h - 1
            ),

            (
                0,
                0,
                255
            ),

            6
        )


    # =================================================
    # TAMPILKAN CAMERA LOKAL
    # =================================================

    cv2.imshow(
        'ExamGuard',
        frame
    )


    # =================================================
    # KEYBOARD
    # =================================================

    key = (
        cv2.waitKey(1)
        & 0xFF
    )


    if (
        key == 27
        or key == ord('q')
    ):

        break


    elif key == ord('l'):

        show_landmarks = (
            not show_landmarks
        )


    elif key == ord('c'):

        calibrating_until = (
            time.time()
            + CALIB_SEC
        )


        calib_samples = {}
        calib_counts = []


        base = {}


        print(
            "Kalibrasi dimulai..."
        )


# =================================================
# CLEAN UP
# =================================================

kirim(False)


if ser:

    ser.close()


cap.release()

cv2.destroyAllWindows()