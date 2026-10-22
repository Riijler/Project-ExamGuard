import cv2, time, math, threading
import json
import subprocess
import sys
import queue
import uuid
from urllib.parse import parse_qs, urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
import numpy as np
import serial
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# ================== PENGATURAN ==================
ESP_PORT = 'COM3'
BAUD = 115200
NUM_FACES = 5

YAW_LIMIT = 23        # derajat menoleh kiri/kanan dari posisi lurus
PITCH_LIMIT = 15      # derajat menunduk dari posisi lurus
HOLD_SEC = 1.5        # lama menoleh/menunduk sebelum alarm
LOST_SEC = 0.5        # lama wajah hilang sebelum alarm
CALIB_SEC = 2.0       # lama kalibrasi
PITCH_DOWN_SIGN = 1   # ganti ke -1 kalau menunduk malah angkanya negatif
SMOOTH = 0.4          # 0-1, makin kecil makin halus (kurangi gerakan kecil)
STREAM_HOST = "127.0.0.1"
STREAM_PORT = 5000
# ================================================

latest_jpeg = None
frame_lock = threading.Lock()
control_lock = threading.Lock()
control_state = {
    "landmarks": False,
    "calibrating": False,
    "calibrated": False,
    "esp32Connected": False,
    "cameraRunning": True,
}
calibration_requested = threading.Event()
stop_requested = threading.Event()
restart_requested = threading.Event()
detection_events = queue.Queue()
local_detection_lock = threading.Lock()
local_detection_events = []
next_local_detection_id = 1
student_names = {}

def queue_detection_event(event):
    global next_local_detection_id
    with local_detection_lock:
        local_detection_events.append({
            "id": next_local_detection_id,
            **event,
        })
        next_local_detection_id += 1
        if len(local_detection_events) > 1000:
            del local_detection_events[:-1000]
    detection_events.put(event)

def post_detection_events():
    while True:
        event = detection_events.get()
        try:
            request = Request(
                "http://127.0.0.1:3000/api/detection",
                data=json.dumps(event).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=2) as response:
                response.read()
        except OSError as error:
            print("Gagal mengirim deteksi ke backend:", error)
        finally:
            detection_events.task_done()

threading.Thread(target=post_detection_events, daemon=True).start()

class StreamHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        if path == "/status":
            with control_lock:
                status = dict(control_state)
            self.send_json(200, status)
            return
        if path == "/detections":
            try:
                after_id = int(parse_qs(parsed_path.query).get("after", ["0"])[0])
            except ValueError:
                self.send_json(400, {"error": "Cursor deteksi tidak valid"})
                return
            with local_detection_lock:
                events = [
                    event for event in local_detection_events
                    if event["id"] > after_id
                ]
                latest_id = next_local_detection_id - 1
            self.send_json(200, {
                "events": events,
                "latestId": latest_id,
            })
            return
        if path != "/frame.jpg":
            self.send_error(404)
            return

        with frame_lock:
            image = latest_jpeg

        if image is None:
            self.send_error(503, "Frame kamera belum tersedia")
            return

        self.send_response(200)
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(image)))
        self.end_headers()
        self.wfile.write(image)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/control/student-mappings":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(content_length))
            except (ValueError, json.JSONDecodeError):
                self.send_json(400, {"error": "Pemetaan siswa tidak valid"})
                return

            mappings = payload.get("mappings") if isinstance(payload, dict) else None
            if not isinstance(mappings, dict):
                self.send_json(400, {"error": "Pemetaan siswa tidak valid"})
                return

            normalized_names = {}
            for slot, name in mappings.items():
                if (str(slot) not in {"1", "2", "3", "4", "5"} or
                        not isinstance(name, str) or len(name) > 100):
                    self.send_json(400, {"error": "Label siswa tidak valid"})
                    return
                normalized_names[str(slot)] = name.strip()

            with control_lock:
                student_names.clear()
                student_names.update(normalized_names)
            self.send_json(200, {"message": "Label siswa diperbarui"})
            return

        with control_lock:
            if path == "/control/restart":
                control_state["cameraRunning"] = False
                restart_requested.set()
                stop_requested.set()
                status = dict(control_state)
                status["restarting"] = True
                self.send_json(200, status)
                return

            if not control_state["cameraRunning"]:
                self.send_json(409, {"error": "Kamera tidak berjalan"})
                return

            if path == "/control/calibrate":
                calibration_requested.set()
                control_state["calibrating"] = True
                control_state["calibrated"] = False
            elif path == "/control/landmarks":
                control_state["landmarks"] = not control_state["landmarks"]
            elif path == "/control/stop":
                control_state["cameraRunning"] = False
                stop_requested.set()
            else:
                self.send_error(404)
                return

            status = dict(control_state)
        self.send_json(200, status)

    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return

try:
    ser = serial.Serial(ESP_PORT, BAUD, timeout=1)
    time.sleep(2)
    with control_lock:
        control_state["esp32Connected"] = True
    print("ESP32 terhubung di", ESP_PORT)
except serial.SerialException as e:
    ser = None
    with control_lock:
        control_state["esp32Connected"] = False
    print("ESP32 tidak terhubung (mode tes kamera saja):", e)

alarm_sent = None
def kirim(on):
    global alarm_sent
    if ser and on != alarm_sent:
        try:
            ser.write(b'1' if on else b'0')
            alarm_sent = on
        except serial.SerialException as e:
            print("Gagal kirim ke ESP32:", e)
            with control_lock:
                control_state["esp32Connected"] = False

def head_angles(M):
    """Ambil yaw & pitch (derajat) dari matriks transformasi 4x4."""
    R = np.array(M)[:3, :3]
    R = R / np.linalg.norm(R, axis=0)
    sy = math.hypot(R[0, 0], R[1, 0])
    pitch = math.degrees(math.atan2(R[2, 1], R[2, 2]))
    yaw = math.degrees(math.atan2(-R[2, 0], sy))
    return yaw, pitch

def wrap(a):
    return (a + 180) % 360 - 180

options = vision.FaceLandmarkerOptions(
    base_options=mp_python.BaseOptions(
        model_asset_path=str(Path(__file__).with_name("face_landmarker.task"))
    ),
    running_mode=vision.RunningMode.VIDEO,
    num_faces=NUM_FACES,
    output_facial_transformation_matrixes=True,
)
landmarker = vision.FaceLandmarker.create_from_options(options)

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    raise RuntimeError("Kamera tidak dapat dibuka. Pastikan kamera tidak sedang dipakai aplikasi lain.")

stream_server = ThreadingHTTPServer((STREAM_HOST, STREAM_PORT), StreamHandler)
threading.Thread(target=stream_server.serve_forever, daemon=True).start()
print(f"Stream frame tersedia di http://{STREAM_HOST}:{STREAM_PORT}/frame.jpg")
t0 = time.time()

starts = {}              # timer menoleh/menunduk per objek
smooth = {}              # sudut yang sudah dihaluskan per objek
base = {}                # baseline (yaw, pitch) per objek hasil kalibrasi
calib_count = 0          # jumlah orang saat kalibrasi
max_seen = 0
calibrating_until = 0
calib_samples = {}       # i -> list (yaw, pitch)
calib_counts = []
lost_start = None
detection_states = {}
incident_ids = {}
incident_reasons = {}
missing_incidents = {}

while cap.isOpened():
    if stop_requested.is_set():
        break

    ok, frame = cap.read()
    if not ok:
        break
    frame = cv2.flip(frame, 1)
    h, w = frame.shape[:2]
    now = time.time()

    if calibration_requested.is_set():
        calibration_requested.clear()
        calibrating_until = now + CALIB_SEC
        calib_samples, calib_counts = {}, []
        base = {}
        starts.clear()
        smooth.clear()
        print("Kalibrasi dimulai...")

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    res = landmarker.detect_for_video(mp_image, int((now - t0) * 1000))

    faces = []
    for k, lm in enumerate(res.face_landmarks):
        yaw, pitch = head_angles(res.facial_transformation_matrixes[k])
        faces.append({
            "lm": lm, "yaw": yaw, "pitch": pitch, "cx": lm[1].x,
        })
    faces.sort(key=lambda f: f["cx"])
    max_seen = max(max_seen, len(faces))

    # ---------- kalibrasi ----------
    calibrating = now < calibrating_until
    if calibrating:
        calib_counts.append(len(faces))
        for i, f in enumerate(faces):
            calib_samples.setdefault(i, []).append((f["yaw"], f["pitch"]))
    elif calib_samples:
        for i, s in calib_samples.items():
            arr = np.array(s)
            base[i] = (float(arr[:, 0].mean()), float(arr[:, 1].mean()))
        calib_count = int(np.median(calib_counts)) if calib_counts else 0
        calib_samples, calib_counts = {}, []
        starts.clear(); smooth.clear()
        with control_lock:
            control_state["calibrating"] = False
            control_state["calibrated"] = bool(base)
        print("Kalibrasi selesai:", calib_count, "orang")
    elif calibrating_until and now >= calibrating_until:
        calibrating_until = 0
        with control_lock:
            control_state["calibrating"] = False

    # ---------- penilaian per orang ----------
    any_alarm = False
    with control_lock:
        show_landmarks = control_state["landmarks"]
        current_student_names = dict(student_names)

    for i, f in enumerate(faces):
        by, bp = base.get(i, (0.0, 0.0))
        dy = wrap(f["yaw"] - by)
        dp = wrap(f["pitch"] - bp) * PITCH_DOWN_SIGN

        # haluskan supaya gerakan kecil tidak bikin loncat
        sy_, sp_ = smooth.get(i, (dy, dp))
        sy_ = sy_ + SMOOTH * (dy - sy_)
        sp_ = sp_ + SMOOTH * (dp - sp_)
        smooth[i] = (sy_, sp_)

        turn = abs(sy_) > YAW_LIMIT
        down = sp_ > PITCH_LIMIT
        suspicious = (turn or down) and not calibrating

        elapsed, alarm = 0, False
        if suspicious and not calibrating:
            starts.setdefault(i, now)
            elapsed = now - starts[i]
            alarm = elapsed > HOLD_SEC
        else:
            starts.pop(i, None)

        reason = "MENOLEH" if turn else "MENUNDUK"
        if alarm:
            color = (0, 0, 255)
            any_alarm = True
        elif suspicious:
            color = (0, 165, 255)
        else:
            color = (0, 255, 0)

        detection_status = "violation" if alarm else "warning" if suspicious else "safe"
        x_coordinates = [point.x for point in f["lm"]]
        y_coordinates = [point.y for point in f["lm"]]
        x1 = max(0, min(w - 1, int(min(x_coordinates) * w)))
        y1 = max(0, min(h - 1, int(min(y_coordinates) * h)))
        x2 = max(0, min(w - 1, int(max(x_coordinates) * w)))
        y2 = max(0, min(h - 1, int(max(y_coordinates) * h)))
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        student_name = current_student_names.get(str(i + 1), "").strip()
        label_name = student_name or f"Siswa {i + 1}"
        status_label = {
            "safe": "Aman",
            "warning": "Peringatan",
            "violation": "Pelanggaran",
        }[detection_status]
        label = f"{label_name} - {status_label}"
        (label_width, label_height), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2
        )
        label_y = y1 if y1 >= label_height + baseline + 8 else min(h - 1, y1 + label_height + baseline + 8)
        label_top = max(0, label_y - label_height - baseline - 8)
        label_right = min(w - 1, x1 + label_width + 8)
        cv2.rectangle(frame, (x1, label_top), (label_right, label_y), color, -1)
        cv2.putText(
            frame,
            label,
            (x1 + 4, label_y - baseline - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

        previous_detection_status = detection_states.get(i, "safe")
        if detection_status != previous_detection_status:
            if detection_status == "warning" and previous_detection_status == "safe":
                incident_ids[i] = str(uuid.uuid4())
            elif detection_status == "violation" and i not in incident_ids:
                incident_ids[i] = str(uuid.uuid4())

            event_id = incident_ids.get(i)
            if event_id:
                if detection_status == "safe":
                    reason = incident_reasons.get(i, "Indikasi selesai")
                    queue_detection_event({
                        "object": i + 1,
                        "status": "safe",
                        "reason": f"Indikasi selesai: {reason}",
                        "event_id": event_id,
                    })
                    incident_ids.pop(i, None)
                    incident_reasons.pop(i, None)
                else:
                    reason = "MENOLEH" if turn else "MENUNDUK"
                    incident_reasons[i] = reason
                    queue_detection_event({
                        "object": i + 1,
                        "status": detection_status,
                        "reason": reason,
                        "event_id": event_id,
                    })
            detection_states[i] = detection_status

        if show_landmarks:
            for p in f["lm"]:
                cv2.circle(frame, (int(p.x * w), int(p.y * h)), 1, color, -1)
    for k in list(starts):
        if k >= len(faces):
            starts.pop(k)
    for k in list(detection_states):
        if k >= len(faces):
            event_id = incident_ids.pop(k, None)
            if event_id:
                reason = incident_reasons.pop(k, "Indikasi selesai")
                queue_detection_event({
                    "object": k + 1,
                    "status": "safe",
                    "reason": f"Indikasi selesai: {reason}",
                    "event_id": event_id,
                })
            detection_states.pop(k, None)

    # ---------- wajah hilang ----------
    expected = calib_count if calib_count else max_seen
    lost = (not calibrating) and expected > 0 and len(faces) < expected
    if lost:
        lost_start = lost_start or now
        lost_elapsed = now - lost_start
        if lost_elapsed > LOST_SEC:
            any_alarm = True
            for missing_index in range(len(faces), expected):
                if missing_index not in missing_incidents:
                    event_id = str(uuid.uuid4())
                    missing_incidents[missing_index] = event_id
                    queue_detection_event({
                        "object": missing_index + 1,
                        "status": "violation",
                        "reason": "MENGHILANG_DARI_KAMERA",
                        "event_id": event_id,
                    })
    else:
        lost_start = None
        for missing_index, event_id in list(missing_incidents.items()):
            queue_detection_event({
                "object": missing_index + 1,
                "status": "safe",
                "reason": "Indikasi selesai: MENGHILANG_DARI_KAMERA",
                "event_id": event_id,
            })
            missing_incidents.pop(missing_index, None)

    # ---------- kirim ke ESP32 ----------
    kirim(any_alarm)

    encoded, buffer = cv2.imencode(".jpg", frame)
    if encoded:
        with frame_lock:
            latest_jpeg = buffer.tobytes()

kirim(False)
if ser:
    ser.close()
cap.release()
if stop_requested.is_set() and not restart_requested.is_set():
    restart_requested.wait()
stream_server.shutdown()
stream_server.server_close()
cv2.destroyAllWindows()

if restart_requested.is_set():
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve())],
        cwd=str(Path(__file__).resolve().parent.parent),
    )