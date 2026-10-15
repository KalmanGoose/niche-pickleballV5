#!/usr/bin/env python3
import os
import sys
import time
import re

LOG_FILE = "/Users/ethanchen/.gemini/antigravity/brain/8df84d6c-7f46-4df2-ba38-06e471391a6d/.system_generated/tasks/task-377.log"
CHECKPOINT_FILE = "data/v2/checkpoint_v2.json"

TOTAL_VIDEOS = 11

def render_bar(val, max_val=100, width=30):
    if max_val == 0:
        pct = 0
    else:
        pct = min(1.0, val / max_val)
    filled = int(width * pct)
    empty = width - filled
    return f"[{'█' * filled}{'░' * empty}] {pct*100:5.1f}%"

def parse_log():
    if not os.path.exists(LOG_FILE):
        return {"status": "NOT_FOUND", "videos": {}, "current": None, "total_strokes": 0}

    with open(LOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    video_blocks = re.findall(r"🎬 \[v2 提取\]\s*([^\s]+)\s*\[([^\]]+)\]\s*\(總幀數:\s*(\d+)", content)
    stroke_blocks = re.findall(r"🎯 通用偵測器識別出\s*(\d+)\s*次候選揮拍事件", content)
    cached_blocks = re.findall(r"⚡ \[v2 斷點快取生效\]\s*([^\s:]+):\s*秒讀\s*(\d+)\s*筆", content)

    completed_videos = []
    for cname, count in cached_blocks:
        cls_name = "KITCHEN_DINK" if "dink" in cname else ("POWER_DRIVE" if "drive" in cname else "OTHER")
        completed_videos.append({
            "name": cname,
            "class": cls_name,
            "frames": 0,
            "strokes": int(count)
        })

    for i, count in enumerate(stroke_blocks):
        if i < len(video_blocks):
            vname, vcls, vframes = video_blocks[i]
            completed_videos.append({
                "name": vname,
                "class": vcls,
                "frames": int(vframes),
                "strokes": int(count)
            })

    frame_progress = re.findall(r"⏳ 逐幀推論:\s*(\d+)/(\d+)\s*幀\s*\((\d+)%\)", content)
    curr_frame_info = None
    if frame_progress:
        curr_f, total_f, pct = frame_progress[-1]
        curr_frame_info = {
            "current_frame": int(curr_f),
            "total_frames": int(total_f),
            "pct": int(pct)
        }

    current_video = None
    if len(video_blocks) > len(stroke_blocks):
        vname, vcls, vframes = video_blocks[len(stroke_blocks)]
        current_video = {
            "name": vname,
            "class": vcls,
            "frames": int(vframes),
            "frame_info": curr_frame_info
        }

    is_done = "v2 通用偵測器候選事件分佈統計" in content

    return {
        "status": "DONE" if is_done else "RUNNING",
        "completed": completed_videos,
        "current": current_video,
        "total_completed": len(completed_videos),
        "total_strokes": sum(v["strokes"] for v in completed_videos)
    }

def print_dashboard():
    data = parse_log()
    completed_count = data["total_completed"]
    total_strokes = data["total_strokes"]
    current = data["current"]

    # 使用標準 ANSI Escape Code 清畫面，安全且不依賴外部 clear 二進位
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()
    print("=" * 68)
    print("🎾 NCHU 匹克球影片特徵提取 — 終端機即時監測儀表板 (LIVE)")
    print("=" * 68)
    
    overall_pct = (completed_count / TOTAL_VIDEOS) * 100
    bar = render_bar(completed_count, TOTAL_VIDEOS, width=32)
    print(f"整體進度: {bar} ({completed_count}/{TOTAL_VIDEOS} 部影片)")
    print(f"累計萃取真值樣本: 🌟 {total_strokes} 筆揮拍動作")
    print("-" * 68)

    print("📋 已完成影片分析狀態：")
    for v in data["completed"]:
        print(f"  ✅ {v['name']:<18} | {v['class']:<16} | {v['frames']:>4} 幀 | 🎯 {v['strokes']:>3} 次打擊")

    if current:
        print(f"\n⚡ 目前正在推論運算中 (MediaPipe Heavy Turbo):")
        finfo = current.get("frame_info")
        if finfo:
            c_f = finfo["current_frame"]
            t_f = finfo["total_frames"]
            sub_bar = render_bar(c_f, t_f, width=24)
            print(f"  🔄 {current['name']} [{current['class']}] | {sub_bar} ({c_f}/{t_f} 幀)")
        else:
            print(f"  🔄 {current['name']} [{current['class']}] - {current['frames']} 幀")
        
        # 繪製動態波形模擬示意
        pulse = " " * 4 + "⚡ 揮拍速度時序峰值監測:   ▂▄▆█▇▆▄▂ ▂▄▆█▇▆▄▂   ▂▃▅█▅▃ "
        print(pulse)
    elif data["status"] == "DONE":
        print("\n🎉 全量特徵提取已順利完成！資料庫已產出至 data/real_strokes_dataset.json")

    print("-" * 68)
    # 各類別累積長條圖
    class_tally = {}
    for v in data["completed"]:
        cls = v["class"]
        class_tally[cls] = class_tally.get(cls, 0) + v["strokes"]
    
    if class_tally:
        print("📊 各動作類別樣本數分佈圖 (Strokes Distribution):")
        max_strokes = max(class_tally.values()) if class_tally else 1
        for cls, count in class_tally.items():
            bar_len = int(28 * (count / max(max_strokes, 1)))
            bar_str = "█" * bar_len
            print(f"  {cls:<16} | {bar_str:<28} | {count:>3} 次")

    print("=" * 68)
    print("💡 提示：可以在任何終端機視窗執行 `python3 scripts/monitor_progress.py --watch` 即時刷新！")

if __name__ == "__main__":
    if "--watch" in sys.argv:
        try:
            while True:
                print_dashboard()
                time.sleep(2)
        except KeyboardInterrupt:
            print("\n監測結束。")
    else:
        print_dashboard()
