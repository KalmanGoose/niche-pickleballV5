import os
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

os.environ['MPLCONFIGDIR'] = '/tmp/matplotlib'

video_path = "data/videos/serve_legal1.mp4"
model_path = "models/pose_landmarker_heavy.task"

cap = cv2.VideoCapture(video_path)

fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total_frames / fps if fps > 0 else 0

print(f"📹 影片資訊 [{video_path}]:")
print(f"   - 解析度: {width} x {height}")
print(f"   - FPS: {fps:.2f}")
print(f"   - 總幀數: {total_frames} 幀")
print(f"   - 時長: {duration:.2f} 秒")

base_options = python.BaseOptions(model_asset_path=model_path)
options = vision.PoseLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.VIDEO,
    num_poses=1,
    min_pose_detection_confidence=0.5,
    min_pose_presence_confidence=0.5,
    min_tracking_confidence=0.5
)
detector = vision.PoseLandmarker.create_from_options(options)

POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (24, 26), (26, 28),
    (15, 19), (15, 21), (16, 20), (16, 22)
]

os.makedirs("data/previews", exist_ok=True)

frame_idx = 0
detected_count = 0
saved_previews = 0

print(f"🚀 開始使用 Google MediaPipe Heavy (旗艦重裝版) 分析前 200 幀...")

while cap.isOpened() and frame_idx < 200:
    ret, frame = cap.read()
    if not ret:
        break
    
    timestamp_ms = int(frame_idx * (1000.0 / fps))
    frame_idx += 1
    
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    
    detection_result = detector.detect_for_video(mp_image, timestamp_ms)
    
    if detection_result.pose_landmarks and len(detection_result.pose_landmarks) > 0:
        detected_count += 1
        landmarks = detection_result.pose_landmarks[0]
        
        # 存兩張不同擊球時機的骨架預覽圖
        if (frame_idx in [50, 95]) or (saved_previews < 2 and frame_idx > 40):
            annotated = frame.copy()
            # 畫骨架連線
            for p1_idx, p2_idx in POSE_CONNECTIONS:
                p1 = landmarks[p1_idx]
                p2 = landmarks[p2_idx]
                if p1.visibility > 0.4 and p2.visibility > 0.4:
                    pt1 = (int(p1.x * width), int(p1.y * height))
                    pt2 = (int(p2.x * width), int(p2.y * height))
                    cv2.line(annotated, pt1, pt2, (0, 255, 255), 4)
            
            # 畫關鍵關節點
            for idx, lm in enumerate(landmarks):
                if lm.visibility > 0.4:
                    pt = (int(lm.x * width), int(lm.y * height))
                    color = (0, 0, 255) if idx in [15, 16] else (0, 255, 0) # 手腕標紅色
                    cv2.circle(annotated, pt, 7, color, -1)
            
            # 標註資訊
            r_wrist = landmarks[16]
            r_hip = landmarks[24]
            rel_h = (r_hip.y - r_wrist.y) * 1.7 # 大致高度差換算
            status = "LEGAL (Below Waist)" if r_wrist.y > r_hip.y - 0.05 else "CHECKING"
            cv2.putText(annotated, f"Frame: {frame_idx} | State: {status}", (40, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)
            
            preview_out = f"data/previews/preview_frame_{frame_idx}.jpg"
            cv2.imwrite(preview_out, annotated)
            saved_previews += 1
            print(f"📸 已輸出骨架分析預覽圖: {preview_out}")

cap.release()
detector.close()

detect_rate = (detected_count / frame_idx) * 100 if frame_idx > 0 else 0
print(f"🎯 前 {frame_idx} 幀測試人體識別率: {detect_rate:.1f}% ({detected_count}/{frame_idx})")
