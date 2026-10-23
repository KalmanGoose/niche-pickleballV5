#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pickler-er Mascot (匹克鵝裁判教練) 3D Asset & Reference Pack Generator (v2 - High Precision)
Generates:
1. models/pickler_er_mascot.glb (Full glTF 2.0 binary with embedded textures, PBR materials, 20-node rig, 5 animations)
2. models/pickler_er_mascot.obj + .mtl (Editable 3D source files)
3. docs/pickler_er_reference_pack/*.png (8 x 2048x2048 transparent PNG orthographic & perspective renders)
4. docs/pickler_er_reference_pack/09_turntable_360_preview.gif (360-degree turntable preview)
"""

import io
import json
import math
import os
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT_MODEL_DIR = os.path.join(os.getcwd(), "models")
OUT_PACK_DIR = os.path.join(os.getcwd(), "docs", "pickler_er_reference_pack")
os.makedirs(OUT_MODEL_DIR, exist_ok=True)
os.makedirs(OUT_PACK_DIR, exist_ok=True)


def load_bold_font(size, cjk=False):
    if cjk:
        cjk_candidates = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "/System/Library/Fonts/HelveticaNeue.ttc",
        ]
        for path in cjk_candidates:
            if os.path.exists(path):
                try:
                    return ImageFont.truetype(path, size)
                except Exception:
                    pass
    font_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    for path in font_candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


# ==============================================================================
# 1. High-Res Texture Generation (2048x2048 / 1024x1024 PNG + RGB Lookup Arrays)
# ==============================================================================
def draw_arched_text(base_img, text, center_x, center_y, font_size, span_px, arch_drop_px=0, flip_x=False):
    """Draws bold gold NCHU text with exact horizontal span_px and optional arch curvature."""
    font = load_bold_font(font_size)
    chars = list(text)
    n = len(chars)
    xs = np.linspace(-span_px * 0.5, span_px * 0.5, n)

    layer = Image.new("RGBA", base_img.size, (0, 0, 0, 0))
    for i, ch in enumerate(chars):
        u = (i / max(1, n - 1)) * 2.0 - 1.0  # -1 .. +1
        dx = xs[i]
        dy = (u * u) * arch_drop_px
        rot_deg = -u * (arch_drop_px * 0.35)

        char_img = Image.new("RGBA", (font_size * 2, font_size * 2), (0, 0, 0, 0))
        cdraw = ImageDraw.Draw(char_img)
        bbox = cdraw.textbbox((0, 0), ch, font=font)
        cw = bbox[2] - bbox[0]
        ch_h = bbox[3] - bbox[1]
        cx = font_size - cw // 2 - bbox[0]
        cy = font_size - ch_h // 2 - bbox[1]

        for ox, oy in [(-4, 4), (4, 4), (0, 5), (-3, -3), (3, -3)]:
            cdraw.text((cx + ox, cy + oy), ch, font=font, fill=(10, 28, 60, 200))
        cdraw.text((cx, cy), ch, font=font, fill=(245, 197, 51, 255))

        rot_char = char_img.rotate(rot_deg, resample=Image.Resampling.BICUBIC, expand=True)
        px = int(center_x + dx - rot_char.width // 2)
        py = int(center_y + dy - rot_char.height // 2)
        layer.alpha_composite(rot_char, (px, py))

    if flip_x:
        # If UV u runs right-to-left on a surface, flip around center_x
        crop_w = int(span_px * 1.6)
        box = (max(0, int(center_x - crop_w)), 0, min(base_img.width, int(center_x + crop_w)), base_img.height)
        sub = layer.crop(box).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        layer.paste((0, 0, 0, 0), box)
        layer.paste(sub, box)

    base_img.alpha_composite(layer)


def create_hoodie_texture():
    W, H = 2048, 2048
    img = Image.new("RGBA", (W, H), (27, 87, 158, 255))  # #1B579E Royal Blue
    draw = ImageDraw.Draw(img)

    # Subtle fabric weave lines
    for y in range(0, H, 6):
        draw.line([(0, y), (W, y)], fill=(31, 93, 166, 255), width=2)

    # Ribbed bottom band (v near 1.0 -> bottom of image y > 1820)
    for y in range(1820, H):
        draw.line([(0, y), (W, y)], fill=(20, 68, 128, 255), width=1)
    for x in range(0, W, 14):
        draw.line([(x, 1820), (x, H)], fill=(15, 52, 102, 255), width=4)

    # Front center is u = 0.25 (x = 512), Back center is u = 0.75 (x = 1536)
    # Chest NCHU: crisp horizontal gold letters spanning 270px across chest
    draw_arched_text(img, "NCHU", 512, 885, 118, span_px=275, arch_drop_px=6)
    # Back upper shoulder NCHU: gently arched gold letters spanning 290px
    draw_arched_text(img, "NCHU", 1536, 700, 112, span_px=290, arch_drop_px=26)

    rgb = img.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return buf.getvalue(), np.asarray(rgb, dtype=np.float32) / 255.0


def create_cap_texture():
    W, H = 1024, 512
    img = Image.new("RGBA", (W, H), (24, 26, 29, 255))  # #181A1D Cap Black
    # Front center is u = 0.25 (x = 256), lower-mid crown is y = 315
    draw_arched_text(img, "NCHU", 256, 315, 68, span_px=165, arch_drop_px=10)
    rgb = img.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return buf.getvalue(), np.asarray(rgb, dtype=np.float32) / 255.0


def create_paddle_texture():
    W, H = 1024, 1024
    img = Image.new("RGBA", (W, H), (29, 91, 158, 255))  # Royal Blue
    draw = ImageDraw.Draw(img)

    # Lower-right yellow diagonal block (#F5C533)
    draw.polygon([(W, 330), (W, H), (260, H)], fill=(245, 197, 51, 255))
    # White diagonal stripe separator
    draw.polygon([(150, H), (W, 215), (W, 285), (220, H)], fill=(247, 248, 250, 255))
    # Bottom-left white accent block
    draw.polygon([(0, 825), (410, 825), (220, H), (0, H)], fill=(247, 248, 250, 255))

    # Diagonal gold NCHU text across upper-left blue region
    txt_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_arched_text(txt_layer, "NCHU", 512, 512, 135, span_px=490, arch_drop_px=0)
    txt_rot = txt_layer.rotate(13, resample=Image.Resampling.BICUBIC, center=(512, 512))
    img.alpha_composite(txt_rot, (-30, -85))

    rgb = img.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return buf.getvalue(), np.asarray(rgb, dtype=np.float32) / 255.0


# ==============================================================================
# 2. Geometry Builders (Seamless Organic Lofts, Sculpted Beak, Cap, Hoodie, Props)
# ==============================================================================
def compute_vertex_normals(positions, indices):
    normals = np.zeros_like(positions, dtype=np.float32)
    tris = indices.reshape(-1, 3)
    v0 = positions[tris[:, 0]]
    v1 = positions[tris[:, 1]]
    v2 = positions[tris[:, 2]]
    fn = np.cross(v1 - v0, v2 - v0)
    np.add.at(normals, tris[:, 0], fn)
    np.add.at(normals, tris[:, 1], fn)
    np.add.at(normals, tris[:, 2], fn)
    lens = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.where(lens > 1e-8, normals / np.maximum(lens, 1e-8), np.array([0.0, 1.0, 0.0], dtype=np.float32))
    return normals.astype(np.float32)


def build_loft_mesh(slices, radial_segs=56):
    num_rings = len(slices)
    pos = []
    uvs = []
    idx = []
    for i, s in enumerate(slices):
        v = 1.0 - (i / max(1, num_rings - 1))  # glTF UV: v=0 top, v=1 bottom
        for j in range(radial_segs + 1):
            u = j / radial_segs
            theta = (u - 0.25) * math.pi * 2.0
            sin_t = math.sin(theta)
            cos_t = math.cos(theta)  # +1 at front (+Z), -1 at back (-Z)
            x = sin_t * s["rx"]
            z = cos_t * s["rz"] + s.get("cz", 0.0)
            y = s["y"] + cos_t * s.get("tilt_z", 0.0)
            if "mod" in s and s["mod"] is not None:
                dx, dy, dz = s["mod"](theta, sin_t, cos_t)
                x += dx
                y += dy
                z += dz
            pos.append([x, y, z])
            uvs.append([u, v])

    ring = radial_segs + 1
    for i in range(num_rings - 1):
        for j in range(radial_segs):
            a = i * ring + j
            b = (i + 1) * ring + j
            c = (i + 1) * ring + j + 1
            d = i * ring + j + 1
            idx.extend([a, b, d, b, c, d])

    pos_arr = np.array(pos, dtype=np.float32)
    uv_arr = np.array(uvs, dtype=np.float32)
    idx_arr = np.array(idx, dtype=np.uint32)
    norm_arr = compute_vertex_normals(pos_arr, idx_arr)
    return {"pos": pos_arr, "norm": norm_arr, "uv": uv_arr, "idx": idx_arr}


def merge_meshes(mesh_list):
    pos_list, norm_list, uv_list, idx_list = [], [], [], []
    offset = 0
    for m in mesh_list:
        pos_list.append(m["pos"])
        norm_list.append(m["norm"])
        uv_list.append(m["uv"])
        idx_list.append(m["idx"] + offset)
        offset += len(m["pos"])
    return {
        "pos": np.vstack(pos_list).astype(np.float32),
        "norm": np.vstack(norm_list).astype(np.float32),
        "uv": np.vstack(uv_list).astype(np.float32),
        "idx": np.concatenate(idx_list).astype(np.uint32),
    }


def transform_mesh(mesh, scale=(1, 1, 1), rot_euler=(0, 0, 0), translate=(0, 0, 0)):
    p = mesh["pos"].copy() * np.array(scale, dtype=np.float32)
    rx, ry, rz = rot_euler
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float32)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float32)
    R = Rz @ Ry @ Rx
    p = p @ R.T + np.array(translate, dtype=np.float32)
    n = compute_vertex_normals(p, mesh["idx"])
    return {"pos": p, "norm": n, "uv": mesh["uv"].copy(), "idx": mesh["idx"].copy()}


def create_capsule_mesh(radius_top, radius_bot, height, seg_r=28, seg_y=18):
    slices = []
    for i in range(seg_y + 1):
        t = i / seg_y
        y = -height * 0.5 + t * height
        if t < 0.22:
            s = math.sin((t / 0.22) * math.pi * 0.5)
            r = radius_bot * s
        elif t > 0.78:
            s = math.sin(((1.0 - t) / 0.22) * math.pi * 0.5)
            r = radius_top * s
        else:
            u = (t - 0.22) / 0.56
            r = radius_bot * (1.0 - u) + radius_top * u
        slices.append({"y": y, "rx": max(0.002, r), "rz": max(0.002, r)})
    return build_loft_mesh(slices, radial_segs=seg_r)


def create_limb_segment(p_start, p_end, r_start, r_end, seg_r=28, seg_y=18):
    """Creates a smooth rounded limb capsule connecting p_start to p_end with hemispherical caps."""
    p0 = np.array(p_start, dtype=np.float32)
    p1 = np.array(p_end, dtype=np.float32)
    diff = p1 - p0
    length = float(np.linalg.norm(diff))
    total_h = length + r_start * 0.85 + r_end * 0.85
    cap = create_capsule_mesh(r_end, r_start, total_h, seg_r=seg_r, seg_y=seg_y)

    # Rotate +Y to align with diff
    up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    d_norm = diff / max(length, 1e-6)
    v = np.cross(up, d_norm)
    c = float(np.dot(up, d_norm))
    s = float(np.linalg.norm(v))
    if s < 1e-6:
        R = np.eye(3, dtype=np.float32) if c > 0 else np.diag([1.0, -1.0, -1.0]).astype(np.float32)
    else:
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]], dtype=np.float32)
        R = np.eye(3, dtype=np.float32) + vx + (vx @ vx) * ((1.0 - c) / (s * s))

    mid = 0.5 * (p0 + p1)
    pos = cap["pos"] @ R.T + mid
    norm = compute_vertex_normals(pos, cap["idx"])
    return {"pos": pos, "norm": norm, "uv": cap["uv"], "idx": cap["idx"]}


def create_torus_mesh(major_r, minor_r, seg_u=48, seg_v=18, scale=(1, 1, 1), tilt_x=0.0):
    pos, uvs, idx = [], [], []
    for i in range(seg_v + 1):
        v = i / seg_v
        phi = v * math.pi * 2.0
        cos_p, sin_p = math.cos(phi), math.sin(phi)
        for j in range(seg_u + 1):
            u = j / seg_u
            theta = (u - 0.25) * math.pi * 2.0
            cos_t, sin_t = math.cos(theta), math.sin(theta)
            r = major_r + minor_r * cos_p
            x = sin_t * r * scale[0]
            y = minor_r * sin_p * scale[1] + cos_t * tilt_x
            z = cos_t * r * scale[2]
            pos.append([x, y, z])
            uvs.append([u, v])
    ring = seg_u + 1
    for i in range(seg_v):
        for j in range(seg_u):
            a = i * ring + j
            b = (i + 1) * ring + j
            c = (i + 1) * ring + j + 1
            d = i * ring + j + 1
            idx.extend([a, b, d, b, c, d])
    pos_arr = np.array(pos, dtype=np.float32)
    idx_arr = np.array(idx, dtype=np.uint32)
    return {
        "pos": pos_arr,
        "norm": compute_vertex_normals(pos_arr, idx_arr),
        "uv": np.array(uvs, dtype=np.float32),
        "idx": idx_arr,
    }


def create_tube_along_curve(pts, radius, seg_len=28, seg_r=14):
    pts = np.array(pts, dtype=np.float32)
    t_in = np.linspace(0, 1, len(pts))
    t_out = np.linspace(0, 1, seg_len + 1)
    curve = np.column_stack([np.interp(t_out, t_in, pts[:, k]) for k in range(3)])

    pos, uvs, idx = [], [], []
    for i in range(seg_len + 1):
        p = curve[i]
        if i < seg_len:
            tang = curve[i + 1] - p
        else:
            tang = p - curve[i - 1]
        tang = tang / (np.linalg.norm(tang) + 1e-8)
        up = np.array([0.0, 0.0, 1.0], dtype=np.float32) if abs(tang[1]) > 0.9 else np.array([0.0, 1.0, 0.0], dtype=np.float32)
        n1 = np.cross(tang, up)
        n1 = n1 / (np.linalg.norm(n1) + 1e-8)
        n2 = np.cross(tang, n1)
        for j in range(seg_r + 1):
            u = j / seg_r
            ang = u * math.pi * 2.0
            pt = p + radius * (math.cos(ang) * n1 + math.sin(ang) * n2)
            pos.append(pt)
            uvs.append([u, i / seg_len])
    ring = seg_r + 1
    for i in range(seg_len):
        for j in range(seg_r):
            a = i * ring + j
            b = (i + 1) * ring + j
            c = (i + 1) * ring + j + 1
            d = i * ring + j + 1
            idx.extend([a, b, d, b, c, d])
    pos_arr = np.array(pos, dtype=np.float32)
    idx_arr = np.array(idx, dtype=np.uint32)
    return {
        "pos": pos_arr,
        "norm": compute_vertex_normals(pos_arr, idx_arr),
        "uv": np.array(uvs, dtype=np.float32),
        "idx": idx_arr,
    }


def build_all_mascot_meshes():
    meshes = {}

    # 1. Mesh_Goose_Body (Plump white lower belly + rounded rump + cute upturned tail)
    # Strictly designed so that above the hoodie hem (y > 0.02 in Pelvis space), it tapers inside the hoodie with ZERO clipping!
    body_slices = []
    for i in range(33):
        t = i / 32.0
        # y from -0.21 (world 0.37) to +0.16 (world 0.74, tucked inside hoodie)
        y = -0.21 + t * 0.37
        base_r = math.sin(t * math.pi)
        # Taper strongly when t > 0.65 (inside the hoodie) so it never pokes through the hoodie back!
        taper_inside = 1.0 if t <= 0.62 else max(0.25, 1.0 - ((t - 0.62) / 0.38) * 0.72)
        rx = (0.02 + 0.365 * (base_r ** 0.72)) * taper_inside
        rz = (0.02 + 0.375 * (base_r ** 0.72)) * taper_inside
        cz = -0.025 * math.sin(t * math.pi) * taper_inside

        def body_mod(theta, sin_t, cos_t, tt=t):
            dx, dy, dz = 0.0, 0.0, 0.0
            # Cute upturned goose tail peeking out BELOW the rear hoodie hem (around tt ∈ [0.28, 0.60])
            if cos_t < -0.30:
                bf = ((-cos_t - 0.30) / 0.70) ** 1.7
                tw = math.exp(-(((tt - 0.45) / 0.14) ** 2))
                dz -= 0.115 * bf * tw
                dy += 0.065 * bf * tw
            return dx, dy, dz

        body_slices.append({"y": y, "rx": rx, "rz": rz, "cz": cz, "mod": body_mod})
    meshes["Mesh_Goose_Body"] = build_loft_mesh(body_slices, 64)

    # 2. Mesh_Hoodie_Torso (Royal blue hoodie wrapping body, angled hem lower in front & higher in back exposing tail)
    hoodie_slices = []
    for i in range(33):
        t = i / 32.0
        y = -0.17 + t * 0.75
        if t < 0.10:
            prof = 0.87 + (t / 0.10) * 0.11
        elif t < 0.45:
            prof = 0.98 + math.sin(((t - 0.10) / 0.35) * math.pi * 0.5) * 0.05
        else:
            u = (t - 0.45) / 0.55
            prof = 1.03 * (1.0 - 0.58 * (u ** 1.45))
        rx = 0.440 * prof
        rz = 0.422 * prof
        tilt_z = -0.052 * ((1.0 - t) ** 1.3)
        cz = 0.015 * math.sin(t * math.pi)

        def hoodie_mod(theta, sin_t, cos_t, tt=t):
            dz = 0.024 * cos_t * math.sin(tt * math.pi) if cos_t > 0 else -0.028 * (-cos_t) * math.sin(tt * math.pi)
            return 0.0, 0.0, dz

        hoodie_slices.append({"y": y, "rx": rx, "rz": rz, "cz": cz, "tilt_z": tilt_z, "mod": hoodie_mod})
    meshes["Mesh_Hoodie_Torso"] = build_loft_mesh(hoodie_slices, 64)

    # 3. Mesh_Hoodie_Pocket (3D Kangaroo front pocket curved onto belly) + Bottom Hem Rib Thickness
    pocket_slices = []
    for i in range(15):
        t = i / 14.0
        y = -0.11 + t * 0.185
        s = math.sin(t * math.pi)
        w = (0.235 * (1.0 - 0.32 * t)) * (s ** 0.18)

        def pocket_mod(theta, sin_t, cos_t):
            # Curve back along the round belly
            bend_z = -0.28 * ((sin_t * 0.22) ** 2)
            return 0.0, 0.0, bend_z

        pocket_slices.append({
            "y": y,
            "rx": max(0.01, w),
            "rz": max(0.005, 0.030 * (s ** 0.3)),
            "cz": 0.432 - 0.035 * (t ** 2),
            "mod": pocket_mod,
        })
    pocket_mesh = build_loft_mesh(pocket_slices, 36)
    hem_ring = create_torus_mesh(0.358, 0.020, 52, 14, scale=(1.01, 1.0, 0.95), tilt_x=-0.052)
    hem_ring = transform_mesh(hem_ring, translate=(0.0, -0.148, 0.012))
    meshes["Mesh_Hoodie_Pocket"] = merge_meshes([pocket_mesh, hem_ring])

    # 4. Mesh_Hoodie_Hood (Plump 3D folded hood collar + rear hood pouch on Spine_02)
    collar_ring = create_torus_mesh(0.215, 0.058, 52, 18, scale=(1.0, 1.05, 1.02), tilt_x=-0.035)
    collar_ring = transform_mesh(collar_ring, translate=(0.0, 0.27, 0.0))
    rear_hood_slices = []
    for i in range(17):
        t = i / 16.0
        s = math.sin(t * math.pi)
        rear_hood_slices.append({
            "y": 0.17 + t * 0.17,
            "rx": 0.03 + 0.210 * (s ** 0.65),
            "rz": 0.02 + 0.150 * (s ** 0.7),
            "cz": -0.115 - 0.055 * math.sin(t * math.pi),
        })
    rear_hood = build_loft_mesh(rear_hood_slices, 36)
    meshes["Mesh_Hoodie_Hood"] = merge_meshes([collar_ring, rear_hood])

    # 5. Mesh_Drawstrings (Two white chest drawstrings sitting cleanly OUTSIDE the front chest surface!)
    str_l = create_tube_along_curve(
        [[-0.052, 0.23, 0.235], [-0.058, 0.15, 0.345], [-0.056, 0.07, 0.405], [-0.052, -0.01, 0.438]],
        0.0115,
    )
    str_r = create_tube_along_curve(
        [[0.052, 0.23, 0.235], [0.058, 0.15, 0.345], [0.056, 0.07, 0.405], [0.052, -0.01, 0.438]],
        0.0115,
    )
    meshes["Mesh_Drawstrings"] = merge_meshes([str_l, str_r])

    # 6. Mesh_Neck_01 & Mesh_Neck_02 (Two-segment articulated upright goose neck)
    n1_slices = [{"y": -0.05 + (i / 14.0) * 0.29, "rx": 0.142 - (i / 14.0) * 0.015, "rz": (0.142 - (i / 14.0) * 0.015) * 0.98, "cz": 0.005 * (i / 14.0)} for i in range(15)]
    meshes["Mesh_Neck_01"] = build_loft_mesh(n1_slices, 36)

    n2_slices = [{"y": -0.04 + (i / 14.0) * 0.27, "rx": 0.127 + ((i / 14.0) ** 2) * 0.026, "rz": (0.127 + ((i / 14.0) ** 2) * 0.026) * 0.98, "cz": 0.01 * (i / 14.0)} for i in range(15)]
    meshes["Mesh_Neck_02"] = build_loft_mesh(n2_slices, 36)

    # 7. Mesh_Goose_Head (Rounded head with cute full cheeks)
    head_slices = []
    for i in range(27):
        t = i / 26.0
        sin_p = math.sin(t * math.pi)
        y = -0.05 + t * 0.36
        cheek = math.exp(-(((t - 0.33) / 0.18) ** 2)) * 0.032
        rx = 0.005 + 0.182 * (sin_p ** 0.68) + cheek
        rz = 0.005 + 0.192 * (sin_p ** 0.68) + cheek * 0.65
        cz = -0.006 + 0.014 * sin_p
        head_slices.append({"y": y, "rx": rx, "rz": rz, "cz": cz})
    meshes["Mesh_Goose_Head"] = build_loft_mesh(head_slices, 48)

    # 8. Mesh_Eyes (Left & Right cute expressive oval black eyes clearly visible on front face)
    eye_base = create_capsule_mesh(0.022, 0.022, 0.044, 20, 12)
    eye_l = transform_mesh(eye_base, scale=(0.92, 1.15, 0.75), rot_euler=(-0.06, 0.20, 0.0), translate=(0.068, 0.132, 0.194))
    eye_r = transform_mesh(eye_base, scale=(0.92, 1.15, 0.75), rot_euler=(-0.06, -0.20, 0.0), translate=(-0.068, 0.132, 0.194))
    meshes["Mesh_Eyes"] = merge_meshes([eye_l, eye_r])

    # 9. Mesh_Beak_Upper & Mesh_Beak_Lower (Sculpted 3D smiling orange goose bill)
    def build_beak_part(is_upper=True):
        seg_z, seg_r = 24, 40
        pos, uvs, idx = [], [], []
        for iz in range(seg_z + 1):
            tz = iz / seg_z
            z = 0.120 + tz * (0.195 if is_upper else 0.168)
            w_prof = (math.cos(tz * math.pi * 0.5) ** 0.54) * (1.0 + (0.15 if is_upper else 0.05) * math.sin(tz * math.pi))
            rx = max(0.004, (0.138 if is_upper else 0.116) * w_prof)
            ry_top = max(0.003, 0.068 * ((1.0 - tz) ** 0.75) + 0.016 * math.sin(tz * math.pi))
            ry_bot = max(0.003, 0.044 * math.sin(tz * math.pi * 0.85 + 0.15))
            base_y = (0.060 - tz * 0.016 + ((1.0 - tz) ** 2.2) * 0.012) if is_upper else (0.042 - math.sin(tz * math.pi * 0.75) * 0.018)

            for ir in range(seg_r + 1):
                u = ir / seg_r
                theta = u * math.pi * 2.0
                cos_t, sin_t = math.cos(theta), math.sin(theta)
                x = cos_t * rx
                smile = (abs(cos_t) ** 1.7) * ((1.0 - tz) ** 1.25) * 0.035
                if is_upper:
                    ridge = ((1.0 - abs(cos_t)) ** 2.2) * sin_t * 0.025 * (1.0 - 0.5 * tz) if sin_t > 0 else 0.0
                    y = base_y + (sin_t * ry_top + ridge if sin_t >= 0 else sin_t * 0.010) + smile
                else:
                    y = base_y + (sin_t * ry_bot if sin_t <= 0 else -sin_t * 0.006) + smile
                pos.append([x, y, z])
                uvs.append([u, tz])
        ring = seg_r + 1
        for iz in range(seg_z):
            for ir in range(seg_r):
                a = iz * ring + ir
                b = (iz + 1) * ring + ir
                c = (iz + 1) * ring + ir + 1
                d = iz * ring + ir + 1
                idx.extend([a, d, b, b, d, c])
        pos_arr = np.array(pos, dtype=np.float32)
        idx_arr = np.array(idx, dtype=np.uint32)
        return {"pos": pos_arr, "norm": compute_vertex_normals(pos_arr, idx_arr), "uv": np.array(uvs, dtype=np.float32), "idx": idx_arr}

    meshes["Mesh_Beak_Upper"] = build_beak_part(True)
    meshes["Mesh_Beak_Lower"] = build_beak_part(False)

    # 10. Mesh_Cap (Black baseball cap with NCHU front, rear semi-circular cutout opening, strap & curved visor brim)
    def build_cap_crown():
        seg_u, seg_v = 64, 24
        pos, uvs, idx = [], [], []
        wall = 0.010
        for layer in range(2):
            is_inner = (layer == 1)
            for iv in range(seg_v + 1):
                v = iv / seg_v
                for iu in range(seg_u + 1):
                    u = iu / seg_u
                    theta = (u - 0.25) * math.pi * 2.0
                    sin_t, cos_t = math.sin(theta), math.cos(theta)
                    cutout = 0.0
                    if cos_t < -0.72:
                        br = min(1.0, (-cos_t - 0.72) / 0.28)
                        arch = math.sqrt(max(0.0, 1.0 - ((1.0 - br) ** 2)))
                        cutout = 0.054 * arch
                    eff_v = cutout / 0.155 + v * (1.0 - cutout / 0.155)
                    phi = eff_v * math.pi * 0.485
                    rb = (0.184 - wall) if is_inner else 0.184
                    rx = (rb + 0.004) * math.cos(phi)
                    rz = (rb + 0.012) * math.cos(phi)
                    y = 0.192 + 0.152 * math.sin(phi)
                    pos.append([sin_t * rx, y, cos_t * rz])
                    uvs.append([u, 1.0 - v])
        ring = seg_u + 1
        off = (seg_v + 1) * ring
        for iv in range(seg_v):
            for iu in range(seg_u):
                a = iv * ring + iu
                b = (iv + 1) * ring + iu
                c = (iv + 1) * ring + iu + 1
                d = iv * ring + iu + 1
                idx.extend([a, b, d, b, c, d])
                ai, bi, ci, di = a + off, b + off, c + off, d + off
                idx.extend([ai, di, bi, bi, di, ci])
        pos_arr = np.array(pos, dtype=np.float32)
        idx_arr = np.array(idx, dtype=np.uint32)
        return {"pos": pos_arr, "norm": compute_vertex_normals(pos_arr, idx_arr), "uv": np.array(uvs, dtype=np.float32), "idx": idx_arr}

    def build_cap_brim_and_strap():
        seg_w, seg_l = 32, 16
        thick = 0.012
        pos, uvs, idx = [], [], []
        for layer in range(2):
            y_off = thick * 0.5 if layer == 0 else -thick * 0.5
            for iv in range(seg_l + 1):
                v = iv / seg_l
                for iu in range(seg_w + 1):
                    u = (iu / seg_w) * 2.0 - 1.0
                    theta = u * 0.92
                    root_r = 0.182
                    fw_scale = math.sqrt(max(0.08, 1.0 - ((u * (0.65 + 0.35 * v)) ** 2)))
                    reach = v * 0.155 * fw_scale
                    x = math.sin(theta) * (root_r + reach * 0.48)
                    z = math.cos(theta) * root_r + reach
                    arch_y = math.cos(u * math.pi * 0.5) * 0.026 * (1.0 - 0.25 * v)
                    droop_y = -0.018 * v - 0.012 * (v ** 2)
                    y = 0.194 + arch_y + droop_y + y_off
                    pos.append([x, y, z])
                    uvs.append([iu / seg_w, v])
        ring = seg_w + 1
        off = (seg_l + 1) * ring
        for iv in range(seg_l):
            for iu in range(seg_w):
                a = iv * ring + iu
                b = (iv + 1) * ring + iu
                c = (iv + 1) * ring + iu + 1
                d = iv * ring + iu + 1
                idx.extend([a, d, b, b, d, c])
                ai, bi, ci, di = a + off, b + off, c + off, d + off
                idx.extend([ai, bi, di, bi, ci, di])
        brim_mesh = {"pos": np.array(pos, dtype=np.float32), "norm": compute_vertex_normals(np.array(pos, dtype=np.float32), np.array(idx, dtype=np.uint32)), "uv": np.array(uvs, dtype=np.float32), "idx": np.array(idx, dtype=np.uint32)}
        strap_mesh = create_tube_along_curve(
            [[-0.095, 0.198, -0.172], [-0.045, 0.196, -0.188], [0.0, 0.196, -0.193], [0.045, 0.196, -0.188], [0.095, 0.198, -0.172]],
            0.011,
        )
        return merge_meshes([brim_mesh, strap_mesh])

    meshes["Mesh_Cap_Crown"] = build_cap_crown()
    meshes["Mesh_Cap_Brim"] = build_cap_brim_and_strap()

    # 11. Sleeves & Hands (Seamless plush upper/forearm sleeves + White 4-Fingered Hands)
    for is_left in [True, False]:
        s = "L" if is_left else "R"
        d = 1.0 if is_left else -1.0
        # Upper sleeve connects Shoulder (0,0,0) to Elbow (d*0.19, -0.15, 0.03) with overlapping spherical caps
        meshes[f"Mesh_Sleeve_Upper_{s}"] = create_limb_segment(
            [-d * 0.03, 0.02, 0.0], [d * 0.19, -0.15, 0.03], 0.122, 0.106, seg_r=28, seg_y=18
        )
        # Forearm sleeve connects Elbow (0,0,0) to Wrist (d*0.14, -0.14, 0.09)
        meshes[f"Mesh_Sleeve_Fore_{s}"] = create_limb_segment(
            [0.0, 0.0, 0.0], [d * 0.14, -0.14, 0.09], 0.105, 0.092, seg_r=28, seg_y=18
        )

        # Hand (Palm + Thumb + 3 Rounded Fingers)
        palm = transform_mesh(create_capsule_mesh(0.068, 0.068, 0.11, 20, 12), scale=(0.95, 0.9, 1.05), translate=(0.0, -0.02, 0.035))
        thumb = transform_mesh(create_capsule_mesh(0.024, 0.024, 0.068, 14, 10), rot_euler=(0.55, 0.0, d * 0.65), translate=(-d * 0.048, 0.022, 0.058))
        fingers = [palm, thumb]
        for f in range(3):
            fy = 0.018 - f * 0.032
            f_mesh = transform_mesh(
                create_capsule_mesh(0.022, 0.022, 0.072, 14, 10),
                rot_euler=(0.22, -d * 0.32, d * 1.18),
                translate=(-d * 0.040, fy, 0.070),
            )
            fingers.append(f_mesh)
        meshes[f"Mesh_Hand_{s}"] = merge_meshes(fingers)

    # 12. Legs & Flat Horizontal Three-Toed Webbed Feet
    for is_left in [True, False]:
        s = "L" if is_left else "R"
        meshes[f"Mesh_Thigh_{s}"] = create_limb_segment([0.0, 0.02, 0.0], [0.0, -0.19, 0.0], 0.045, 0.042, seg_r=20, seg_y=12)
        meshes[f"Mesh_Calf_{s}"] = create_limb_segment([0.0, 0.0, 0.0], [0.0, -0.19, 0.0], 0.041, 0.038, seg_r=20, seg_y=12)

        # Flat Horizontal Webbed Foot planted cleanly on ground (y = -0.02) extending along +Z!
        foot_parts = []
        # Create horizontal webbing fan by lofting along Y (height = thickness 0.028) with X width and Z forward reach
        web_slices = []
        for i in range(9):
            t = i / 8.0
            y = -0.028 + t * 0.030
            s_prof = math.sin(t * math.pi) ** 0.25
            web_slices.append({
                "y": y,
                "rx": max(0.005, 0.125 * s_prof),
                "rz": max(0.005, 0.115 * s_prof),
                "cz": 0.065,
                "mod": lambda theta, sin_t, cos_t: (
                    # Fan out wider in front (cos_t > 0) and narrower at heel (cos_t < 0)
                    sin_t * 0.035 * cos_t,
                    0.0,
                    0.0,
                ),
            })
        foot_parts.append(build_loft_mesh(web_slices, 36))
        # Three distinct horizontal toes radiating forward along +Z
        for ang in [-0.42, 0.0, 0.42]:
            p0 = [math.sin(ang) * 0.02, -0.012, -0.02]
            p1 = [math.sin(ang) * 0.115, -0.014, 0.155 * math.cos(ang * 0.5)]
            foot_parts.append(create_limb_segment(p0, p1, 0.022, 0.018, seg_r=14, seg_y=10))
        meshes[f"Mesh_Foot_{s}"] = merge_meshes(foot_parts)

    # 13. Independent Prop 1: Prop_Pickleball_Paddle (Face + Black Edge Guard + Handle)
    def build_paddle_meshes():
        seg_u, seg_v = 28, 32
        pos, uvs, idx = [], [], []
        W_p, H_p = 0.145, 0.185
        thick = 0.016
        for layer in range(2):
            z_off = thick * 0.5 if layer == 0 else -thick * 0.5
            for iv in range(seg_v + 1):
                v = iv / seg_v
                py = (v * 2.0 - 1.0) * H_p
                max_x = W_p * ((max(0.0, 1.0 - (abs(py / H_p) ** 4.2))) ** (1.0 / 4.2))
                for iu in range(seg_u + 1):
                    u = iu / seg_u
                    px = (u * 2.0 - 1.0) * max_x
                    pos.append([px, 0.31 + py, z_off])
                    u_tex = (px / W_p) * 0.5 + 0.5
                    if layer == 1:
                        u_tex = 1.0 - u_tex
                    uvs.append([u_tex, 1.0 - ((py / H_p) * 0.5 + 0.5)])
        ring = seg_u + 1
        off = (seg_v + 1) * ring
        for iv in range(seg_v):
            for iu in range(seg_u):
                a = iv * ring + iu
                b = (iv + 1) * ring + iu
                c = (iv + 1) * ring + iu + 1
                d = iv * ring + iu + 1
                idx.extend([a, d, b, b, d, c])
                ai, bi, ci, di = a + off, b + off, c + off, d + off
                idx.extend([ai, bi, di, bi, ci, di])
        face_mesh = {
            "pos": np.array(pos, dtype=np.float32),
            "norm": compute_vertex_normals(np.array(pos, dtype=np.float32), np.array(idx, dtype=np.uint32)),
            "uv": np.array(uvs, dtype=np.float32),
            "idx": np.array(idx, dtype=np.uint32),
        }

        pts_perim = []
        for i in range(65):
            ang = (i / 64.0) * math.pi * 2.0
            ca, sa = math.cos(ang), math.sin(ang)
            r_scale = (abs(ca) ** 4.2 + abs(sa) ** 4.2) ** (-1.0 / 4.2)
            pts_perim.append([ca * W_p * r_scale, 0.31 + sa * H_p * r_scale, 0.0])
        edge_tube = create_tube_along_curve(pts_perim, 0.013, seg_len=64, seg_r=12)
        handle_mesh = create_limb_segment([0.0, -0.08, 0.0], [0.0, 0.13, 0.0], 0.025, 0.022, seg_r=16, seg_y=10)
        edge_and_handle = merge_meshes([edge_tube, handle_mesh])

        return face_mesh, edge_and_handle

    paddle_face, paddle_edge = build_paddle_meshes()
    meshes["Prop_Paddle_Face"] = paddle_face
    meshes["Prop_Paddle_Edge"] = paddle_edge

    # 14. Independent Prop 2: Prop_Pickleball_Ball (Blue perforated 26-hole pickleball with flush spherical holes)
    def build_pickleball_meshes():
        radius = 0.090
        fib_n = 26
        gr = (1.0 + math.sqrt(5.0)) / 2.0
        hole_dirs = []
        for i in range(fib_n):
            theta = 2.0 * math.pi * i / gr
            phi = math.acos(1.0 - 2.0 * (i + 0.5) / fib_n)
            hole_dirs.append([math.cos(theta) * math.sin(phi), math.cos(phi), math.sin(theta) * math.sin(phi)])

        slices = []
        for i in range(33):
            t = i / 32.0
            phi = t * math.pi
            y = -radius * math.cos(phi)
            r = max(0.002, radius * math.sin(phi))
            slices.append({"y": y, "rx": r, "rz": r})
        shell = build_loft_mesh(slices, 64)

        # Build 26 flush 3-ring spherical-cap circular dark holes conforming to radius * 1.0035
        hole_discs = []
        r_patch = radius * 1.0035
        max_alpha = math.asin(0.0165 / radius)
        seg_ring = 20
        rings = 3
        for d_vec in hole_dirs:
            n_vec = np.array(d_vec, dtype=np.float32)
            n_vec /= np.linalg.norm(n_vec) + 1e-12
            up = np.array([0.0, 1.0, 0.0], dtype=np.float32) if abs(n_vec[1]) < 0.9 else np.array([1.0, 0.0, 0.0], dtype=np.float32)
            t1 = np.cross(up, n_vec)
            t1 /= np.linalg.norm(t1) + 1e-12
            t2 = np.cross(n_vec, t1)
            pos_d = [n_vec * r_patch]
            norm_d = [n_vec]
            uv_d = [[0.5, 0.5]]
            idx_d = []
            for ir in range(1, rings + 1):
                alpha = max_alpha * (ir / rings)
                ca, sa = math.cos(alpha), math.sin(alpha)
                for k in range(seg_ring):
                    ang = (k / seg_ring) * math.pi * 2.0
                    dir_pt = n_vec * ca + (math.cos(ang) * t1 + math.sin(ang) * t2) * sa
                    pos_d.append(dir_pt * r_patch)
                    norm_d.append(dir_pt)
                    uv_d.append([0.5 + 0.5 * (ir / rings) * math.cos(ang), 0.5 + 0.5 * (ir / rings) * math.sin(ang)])
            # Center fan to ring 1
            for k in range(seg_ring):
                k_next = 1 + ((k + 1) % seg_ring)
                idx_d.extend([0, 1 + k, k_next])
            # Quad strips between rings
            for ir in range(1, rings):
                r0 = 1 + (ir - 1) * seg_ring
                r1 = 1 + ir * seg_ring
                for k in range(seg_ring):
                    kn = (k + 1) % seg_ring
                    a, b, c, d = r0 + k, r1 + k, r1 + kn, r0 + kn
                    idx_d.extend([a, b, c, a, c, d])
            hole_discs.append({
                "pos": np.array(pos_d, dtype=np.float32),
                "norm": np.array(norm_d, dtype=np.float32),
                "uv": np.array(uv_d, dtype=np.float32),
                "idx": np.array(idx_d, dtype=np.uint32),
            })
        core = merge_meshes(hole_discs)
        return shell, core

    ball_shell, ball_core = build_pickleball_meshes()
    meshes["Prop_Ball_Shell"] = ball_shell
    meshes["Prop_Ball_Core"] = ball_core

    return meshes


# ==============================================================================
# 3. Skeleton Hierarchy & Animation Evaluators
# ==============================================================================
BONE_REST = {
    "Root": {"parent": None, "pos": [0.0, 0.0, 0.0]},
    "Pelvis": {"parent": "Root", "pos": [0.0, 0.56, 0.0]},
    "Spine_01": {"parent": "Pelvis", "pos": [0.0, 0.12, 0.0]},
    "Spine_02": {"parent": "Spine_01", "pos": [0.0, 0.28, 0.0]},
    "Neck_01": {"parent": "Spine_02", "pos": [0.0, 0.30, 0.02]},
    "Neck_02": {"parent": "Neck_01", "pos": [0.0, 0.22, 0.01]},
    "Head": {"parent": "Neck_02", "pos": [0.0, 0.21, 0.02]},
    "Shoulder_L": {"parent": "Spine_02", "pos": [0.31, 0.21, 0.0]},
    "Elbow_L": {"parent": "Shoulder_L", "pos": [0.19, -0.15, 0.03]},
    "Wrist_L": {"parent": "Elbow_L", "pos": [0.14, -0.14, 0.09]},
    "Prop_Socket_L": {"parent": "Wrist_L", "pos": [-0.06, 0.01, 0.06]},
    "Shoulder_R": {"parent": "Spine_02", "pos": [-0.31, 0.21, 0.0]},
    "Elbow_R": {"parent": "Shoulder_R", "pos": [-0.19, -0.15, 0.03]},
    "Wrist_R": {"parent": "Elbow_R", "pos": [-0.14, -0.14, 0.09]},
    "Prop_Socket_R": {"parent": "Wrist_R", "pos": [0.0, 0.03, 0.05]},
    "Hip_L": {"parent": "Pelvis", "pos": [0.155, -0.16, 0.0]},
    "Knee_L": {"parent": "Hip_L", "pos": [0.0, -0.19, 0.0]},
    "Ankle_L": {"parent": "Knee_L", "pos": [0.0, -0.19, 0.0]},
    "Hip_R": {"parent": "Pelvis", "pos": [-0.155, -0.16, 0.0]},
    "Knee_R": {"parent": "Hip_R", "pos": [0.0, -0.19, 0.0]},
    "Ankle_R": {"parent": "Knee_R", "pos": [0.0, -0.19, 0.0]},
}


def eval_pose(anim_name, t):
    pose = {k: {"dx": 0.0, "dy": 0.0, "dz": 0.0, "rx": 0.0, "ry": 0.0, "rz": 0.0} for k in BONE_REST}
    # Default reference pose matching image:
    # Right arm holds paddle up at the side with face tilted toward camera!
    pose["Shoulder_R"].update({"rx": -0.18, "ry": 0.15, "rz": 0.22})
    pose["Elbow_R"].update({"rx": -0.68, "ry": 0.0, "rz": 0.35})
    pose["Wrist_R"].update({"rx": 0.58, "ry": 0.12, "rz": -0.25})
    # Left arm curves gently to hold the perforated blue ball against left hip
    pose["Shoulder_L"].update({"rx": 0.08, "ry": -0.12, "rz": -0.18})
    pose["Elbow_L"].update({"rx": -0.45, "ry": 0.35, "rz": 0.42})
    pose["Wrist_L"].update({"rx": 0.10, "ry": 0.20, "rz": 0.12})

    if anim_name == "Anim_Idle":
        w = t * math.pi * 2.0
        b = math.sin(w)
        pose["Pelvis"]["dy"] = b * 0.008
        pose["Spine_01"]["rx"] = b * 0.018
        pose["Spine_02"]["rx"] = -b * 0.015
        pose["Neck_01"]["rx"] = 0.0
        pose["Neck_02"]["rx"] = 0.0
        pose["Head"]["ry"] = math.sin(w * 0.5) * 0.06
    elif anim_name == "Anim_Run":
        w = t * math.pi * 4.0
        sl = math.sin(w)
        sr = math.sin(w + math.pi)
        ll = max(0.0, math.cos(w))
        lr = max(0.0, math.cos(w + math.pi))
        pose["Pelvis"].update({"dy": abs(math.sin(w)) * 0.045 - 0.015, "rx": 0.14, "ry": -sl * 0.14, "rz": sl * 0.06})
        pose["Spine_01"]["ry"] = sl * 0.12
        pose["Spine_02"]["ry"] = sl * 0.14
        pose["Neck_01"]["rx"] = -0.06
        pose["Neck_02"]["rx"] = -0.06
        pose["Hip_L"]["rx"] = -sl * 0.68 - 0.12
        pose["Knee_L"]["rx"] = ll * 0.95 + 0.12
        pose["Ankle_L"]["rx"] = sl * 0.35 - ll * 0.25
        pose["Hip_R"]["rx"] = -sr * 0.68 - 0.12
        pose["Knee_R"]["rx"] = lr * 0.95 + 0.12
        pose["Ankle_R"]["rx"] = sr * 0.35 - lr * 0.25
        pose["Shoulder_R"].update({"rx": sl * 0.55 - 0.20, "ry": 0.15, "rz": 0.28})
        pose["Elbow_R"].update({"rx": -0.95 - max(0.0, -sl) * 0.3, "ry": 0.0, "rz": 0.15})
        pose["Shoulder_L"].update({"rx": sr * 0.55 - 0.15, "ry": -0.15, "rz": -0.25})
        pose["Elbow_L"].update({"rx": -0.85 - max(0.0, -sr) * 0.3, "ry": 0.2, "rz": 0.2})
    elif anim_name == "Anim_Swing":
        phase = (t % 2.0) / 2.0
        if phase < 0.35:
            sv = -math.sin((phase / 0.35) * math.pi * 0.5)
        elif phase < 0.60:
            u = (phase - 0.35) / 0.25
            sv = -1.0 + 2.0 * (u * u * (3.0 - 2.0 * u))
        else:
            sv = math.cos(((phase - 0.60) / 0.40) * math.pi * 0.5)
        pose["Pelvis"].update({"dy": -0.035 * abs(sv), "ry": sv * 0.28})
        pose["Spine_01"]["ry"] = sv * 0.32
        pose["Spine_02"].update({"ry": sv * 0.38, "rx": 0.08 * (1.0 - abs(sv))})
        pose["Neck_01"].update({"ry": -sv * 0.25, "rx": 0.08})
        pose["Neck_02"]["ry"] = -sv * 0.25
        pose["Head"]["ry"] = -sv * 0.20
        pose["Shoulder_R"].update({"rx": -0.35 - sv * 0.75, "ry": -sv * 0.65, "rz": 0.48 - max(0.0, sv) * 0.35})
        pose["Elbow_R"].update({"rx": -0.75 - max(0.0, sv) * 0.55, "ry": sv * 0.35, "rz": 0.20})
        pose["Wrist_R"].update({"rx": sv * 0.35, "ry": sv * 0.45, "rz": -sv * 0.20})
    elif anim_name == "Anim_Referee_Signal":
        w = t * math.pi * 2.0
        hold = 0.85 + 0.15 * math.sin(w)
        pose["Neck_01"]["ry"] = math.sin(w * 0.5) * 0.14
        pose["Neck_02"].update({"ry": math.sin(w * 0.5) * 0.14, "rx": -0.05})
        pose["Shoulder_R"].update({"rx": -2.35 * hold, "ry": 0.15, "rz": 0.22})
        pose["Elbow_R"].update({"rx": -0.22, "ry": 0.0, "rz": 0.08})
    elif anim_name == "Anim_Coach_Point":
        w = t * math.pi * 2.0
        pulse = math.sin(w)
        pose["Pelvis"]["ry"] = -0.22
        pose["Spine_01"].update({"ry": -0.18, "rx": 0.08})
        pose["Spine_02"].update({"ry": -0.15, "rx": 0.08})
        pose["Neck_01"].update({"rx": 0.11, "ry": 0.18})
        pose["Neck_02"].update({"rx": 0.09, "ry": 0.18})
        pose["Shoulder_R"].update({"rx": -1.38 + pulse * 0.04, "ry": -0.28, "rz": 0.12})
        pose["Elbow_R"].update({"rx": -0.12, "ry": 0.0, "rz": 0.0})
    elif anim_name == "Anim_APose":
        pose["Shoulder_R"].update({"rx": 0.0, "ry": 0.0, "rz": 0.28})
        pose["Elbow_R"].update({"rx": -0.08, "ry": 0.0, "rz": 0.08})
        pose["Wrist_R"].update({"rx": 0.0, "ry": 0.0, "rz": 0.0})
        pose["Shoulder_L"].update({"rx": 0.0, "ry": 0.0, "rz": -0.28})
        pose["Elbow_L"].update({"rx": -0.08, "ry": 0.0, "rz": -0.08})
        pose["Wrist_L"].update({"rx": 0.0, "ry": 0.0, "rz": 0.0})
    return pose


def euler_xyz_to_quat(rx, ry, rz):
    cx, sx = math.cos(rx * 0.5), math.sin(rx * 0.5)
    cy, sy = math.cos(ry * 0.5), math.sin(ry * 0.5)
    cz, sz = math.cos(rz * 0.5), math.sin(rz * 0.5)
    qx = sx * cy * cz + cx * sy * sz
    qy = cx * sy * cz - sx * cy * sz
    qz = cx * cy * sz + sx * sy * cz
    qw = cx * cy * cz - sx * sy * sz
    return [qx, qy, qz, qw]


def euler_xyz_to_mat(rx, ry, rz):
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float32)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float32)
    return Rx @ Ry @ Rz


def compute_world_transforms(anim_name="Anim_Idle", t=0.0, root_rot_y=0.0):
    pose = eval_pose(anim_name, t)
    world_mats = {}
    for name, spec in BONE_REST.items():
        mod = pose[name]
        loc_t = np.array([
            spec["pos"][0] + mod["dx"],
            spec["pos"][1] + mod["dy"],
            spec["pos"][2] + mod["dz"],
        ], dtype=np.float32)
        ry = mod["ry"] + (root_rot_y if name == "Root" else 0.0)
        loc_R = euler_xyz_to_mat(mod["rx"], ry, mod["rz"])
        M = np.eye(4, dtype=np.float32)
        M[:3, :3] = loc_R
        M[:3, 3] = loc_t
        if spec["parent"] is None:
            world_mats[name] = M
        else:
            world_mats[name] = world_mats[spec["parent"]] @ M
    return world_mats


# ==============================================================================
# 4. Export Binary glTF 2.0 (.glb) & Editable Wavefront (.obj / .mtl)
# ==============================================================================
def export_glb_and_obj(meshes, tex_data):
    mesh_specs = [
        ("Mesh_Goose_Body", "Pelvis", "Mat_Feather_White"),
        ("Mesh_Hoodie_Torso", "Spine_01", "Mat_Hoodie_RoyalBlue_Textured"),
        ("Mesh_Hoodie_Pocket", "Spine_01", "Mat_Hoodie_RoyalBlue"),
        ("Mesh_Hoodie_Hood", "Spine_02", "Mat_Hoodie_RoyalBlue"),
        ("Mesh_Drawstrings", "Spine_02", "Mat_Feather_White"),
        ("Mesh_Neck_01", "Neck_01", "Mat_Feather_White"),
        ("Mesh_Neck_02", "Neck_02", "Mat_Feather_White"),
        ("Mesh_Goose_Head", "Head", "Mat_Feather_White"),
        ("Mesh_Eyes", "Head", "Mat_Eye_Black"),
        ("Mesh_Beak_Upper", "Head", "Mat_Beak_Orange"),
        ("Mesh_Beak_Lower", "Head", "Mat_Beak_Orange"),
        ("Mesh_Cap_Crown", "Head", "Mat_Cap_Black_NCHU"),
        ("Mesh_Cap_Brim", "Head", "Mat_Cap_Black"),
        ("Mesh_Sleeve_Upper_L", "Shoulder_L", "Mat_Hoodie_RoyalBlue"),
        ("Mesh_Sleeve_Fore_L", "Elbow_L", "Mat_Hoodie_RoyalBlue"),
        ("Mesh_Hand_L", "Wrist_L", "Mat_Feather_White"),
        ("Mesh_Sleeve_Upper_R", "Shoulder_R", "Mat_Hoodie_RoyalBlue"),
        ("Mesh_Sleeve_Fore_R", "Elbow_R", "Mat_Hoodie_RoyalBlue"),
        ("Mesh_Hand_R", "Wrist_R", "Mat_Feather_White"),
        ("Mesh_Thigh_L", "Hip_L", "Mat_Beak_Orange"),
        ("Mesh_Calf_L", "Knee_L", "Mat_Beak_Orange"),
        ("Mesh_Foot_L", "Ankle_L", "Mat_Beak_Orange"),
        ("Mesh_Thigh_R", "Hip_R", "Mat_Beak_Orange"),
        ("Mesh_Calf_R", "Knee_R", "Mat_Beak_Orange"),
        ("Mesh_Foot_R", "Ankle_R", "Mat_Beak_Orange"),
        ("Prop_Paddle_Face", "Prop_Socket_R", "Mat_Paddle_Face"),
        ("Prop_Paddle_Edge", "Prop_Socket_R", "Mat_Cap_Black"),
        ("Prop_Ball_Shell", "Prop_Socket_L", "Mat_Pickleball_Blue"),
        ("Prop_Ball_Core", "Prop_Socket_L", "Mat_Pickleball_HoleDark"),
    ]

    bin_chunks = bytearray()
    buffer_views = []
    accessors = []

    def add_buffer_view(raw_bytes, target=None):
        pad = (4 - (len(bin_chunks) % 4)) % 4
        if pad:
            bin_chunks.extend(b"\x00" * pad)
        offset = len(bin_chunks)
        bin_chunks.extend(raw_bytes)
        bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(raw_bytes)}
        if target is not None:
            bv["target"] = target
        idx = len(buffer_views)
        buffer_views.append(bv)
        return idx

    def add_accessor(bv_idx, comp_type, count, acc_type, min_v=None, max_v=None):
        acc = {
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": comp_type,
            "count": count,
            "type": acc_type,
        }
        if min_v is not None:
            acc["min"] = [float(x) for x in min_v]
        if max_v is not None:
            acc["max"] = [float(x) for x in max_v]
        idx = len(accessors)
        accessors.append(acc)
        return idx

    images = []
    textures = []
    for tex_name in ["hoodie", "cap", "paddle"]:
        png_bytes = tex_data[tex_name]["png"]
        bv_idx = add_buffer_view(png_bytes)
        img_idx = len(images)
        images.append({"name": f"Tex_{tex_name}", "bufferView": bv_idx, "mimeType": "image/png"})
        textures.append({"source": img_idx, "sampler": 0})

    mat_defs = [
        ("Mat_Feather_White", [0.969, 0.973, 0.980, 1.0], 0.46, 0.02, None),
        ("Mat_Beak_Orange", [0.910, 0.443, 0.165, 1.0], 0.36, 0.04, None),
        ("Mat_Eye_Black", [0.071, 0.075, 0.086, 1.0], 0.12, 0.15, None),
        ("Mat_Hoodie_RoyalBlue_Textured", [1.0, 1.0, 1.0, 1.0], 0.72, 0.02, 0),
        ("Mat_Hoodie_RoyalBlue", [0.106, 0.341, 0.620, 1.0], 0.72, 0.02, None),
        ("Mat_Cap_Black_NCHU", [1.0, 1.0, 1.0, 1.0], 0.55, 0.05, 1),
        ("Mat_Cap_Black", [0.094, 0.102, 0.114, 1.0], 0.55, 0.05, None),
        ("Mat_Paddle_Face", [1.0, 1.0, 1.0, 1.0], 0.35, 0.08, 2),
        ("Mat_Pickleball_Blue", [0.145, 0.459, 0.816, 1.0], 0.28, 0.05, None),
        ("Mat_Pickleball_HoleDark", [0.043, 0.145, 0.282, 1.0], 0.85, 0.02, None),
    ]
    mat_index_map = {}
    gltf_materials = []
    for m_name, base_col, rough, metal, tex_idx in mat_defs:
        mat_index_map[m_name] = len(gltf_materials)
        pbr = {"baseColorFactor": base_col, "roughnessFactor": rough, "metallicFactor": metal}
        if tex_idx is not None:
            pbr["baseColorTexture"] = {"index": tex_idx}
        gltf_materials.append({"name": m_name, "pbrMetallicRoughness": pbr, "doubleSided": True})

    nodes = []
    bone_node_idx = {}
    bone_names = list(BONE_REST.keys())
    idle_pose = eval_pose("Anim_Idle", 0.0)

    for b_name in bone_names:
        spec = BONE_REST[b_name]
        mod = idle_pose[b_name]
        idx = len(nodes)
        bone_node_idx[b_name] = idx
        nodes.append({
            "name": b_name,
            "translation": [
                spec["pos"][0] + mod["dx"],
                spec["pos"][1] + mod["dy"],
                spec["pos"][2] + mod["dz"],
            ],
            "rotation": euler_xyz_to_quat(mod["rx"], mod["ry"], mod["rz"]),
            "children": [],
        })

    for b_name, spec in BONE_REST.items():
        if spec["parent"] is not None:
            p_idx = bone_node_idx[spec["parent"]]
            nodes[p_idx]["children"].append(bone_node_idx[b_name])

    gltf_meshes = []
    for m_name, parent_bone, mat_name in mesh_specs:
        m = meshes[m_name]
        bv_pos = add_buffer_view(m["pos"].tobytes(), 34962)
        bv_norm = add_buffer_view(m["norm"].tobytes(), 34962)
        bv_uv = add_buffer_view(m["uv"].tobytes(), 34962)
        bv_idx = add_buffer_view(m["idx"].tobytes(), 34963)

        acc_pos = add_accessor(bv_pos, 5126, len(m["pos"]), "VEC3", np.min(m["pos"], axis=0), np.max(m["pos"], axis=0))
        acc_norm = add_accessor(bv_norm, 5126, len(m["norm"]), "VEC3")
        acc_uv = add_accessor(bv_uv, 5126, len(m["uv"]), "VEC2")
        acc_idx = add_accessor(bv_idx, 5125, len(m["idx"]), "SCALAR")

        mesh_idx = len(gltf_meshes)
        gltf_meshes.append({
            "name": m_name,
            "primitives": [{
                "attributes": {"POSITION": acc_pos, "NORMAL": acc_norm, "TEXCOORD_0": acc_uv},
                "indices": acc_idx,
                "material": mat_index_map[mat_name],
            }],
        })

        node_idx = len(nodes)
        nodes.append({"name": m_name, "mesh": mesh_idx})
        nodes[bone_node_idx[parent_bone]]["children"].append(node_idx)

    for n in nodes:
        if "children" in n and len(n["children"]) == 0:
            del n["children"]

    anim_specs = [
        ("Anim_Idle", 2.0, 30),
        ("Anim_Run", 1.0, 30),
        ("Anim_Swing", 2.0, 30),
        ("Anim_Referee_Signal", 2.0, 30),
        ("Anim_Coach_Point", 2.0, 30),
    ]
    gltf_animations = []
    for a_name, duration, fps in anim_specs:
        n_frames = int(round(duration * fps))
        times = np.linspace(0.0, duration, n_frames + 1, dtype=np.float32)
        bv_time = add_buffer_view(times.tobytes())
        acc_time = add_accessor(bv_time, 5126, len(times), "SCALAR", [times[0]], [times[-1]])

        samplers = []
        channels = []
        for b_name in bone_names:
            spec = BONE_REST[b_name]
            trans_list, rot_list = [], []
            for t_val in times:
                p = eval_pose(a_name, float(t_val))[b_name]
                trans_list.append([spec["pos"][0] + p["dx"], spec["pos"][1] + p["dy"], spec["pos"][2] + p["dz"]])
                rot_list.append(euler_xyz_to_quat(p["rx"], p["ry"], p["rz"]))
            trans_arr = np.array(trans_list, dtype=np.float32)
            rot_arr = np.array(rot_list, dtype=np.float32)

            bv_tr = add_buffer_view(trans_arr.tobytes())
            acc_tr = add_accessor(bv_tr, 5126, len(times), "VEC3")
            bv_rt = add_buffer_view(rot_arr.tobytes())
            acc_rt = add_accessor(bv_rt, 5126, len(times), "VEC4")

            s_tr = len(samplers)
            samplers.append({"input": acc_time, "interpolation": "LINEAR", "output": acc_tr})
            channels.append({"sampler": s_tr, "target": {"node": bone_node_idx[b_name], "path": "translation"}})

            s_rt = len(samplers)
            samplers.append({"input": acc_time, "interpolation": "LINEAR", "output": acc_rt})
            channels.append({"sampler": s_rt, "target": {"node": bone_node_idx[b_name], "path": "rotation"}})

        gltf_animations.append({"name": a_name, "samplers": samplers, "channels": channels})

    gltf_dict = {
        "asset": {"version": "2.0", "generator": "NCHU Pickler-er 3D Studio Pipeline"},
        "scene": 0,
        "scenes": [{"name": "Pickler_Er_Mascot_Scene", "nodes": [bone_node_idx["Root"]]}],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "materials": gltf_materials,
        "textures": textures,
        "images": images,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 33071}],
        "animations": gltf_animations,
        "bufferViews": buffer_views,
        "accessors": accessors,
        "buffers": [{"byteLength": len(bin_chunks)}],
    }

    json_bytes = json.dumps(gltf_dict, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    if json_pad:
        json_bytes += b" " * json_pad
    bin_pad = (4 - (len(bin_chunks) % 4)) % 4
    if bin_pad:
        bin_chunks.extend(b"\x00" * bin_pad)

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_chunks)
    glb_path = os.path.join(OUT_MODEL_DIR, "pickler_er_mascot.glb")
    with open(glb_path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_chunks), 0x004E4942))
        f.write(bin_chunks)

    world_mats = compute_world_transforms("Anim_Idle", 0.0)
    obj_path = os.path.join(OUT_MODEL_DIR, "pickler_er_mascot.obj")
    mtl_path = os.path.join(OUT_MODEL_DIR, "pickler_er_mascot.mtl")
    with open(mtl_path, "w", encoding="utf-8") as mf:
        mf.write("# Pickler-er Mascot Materials\n")
        for m_name, base_col, rough, metal, _ in mat_defs:
            mf.write(f"newmtl {m_name}\nKd {base_col[0]:.4f} {base_col[1]:.4f} {base_col[2]:.4f}\n\n")

    with open(obj_path, "w", encoding="utf-8") as of:
        of.write("mtllib pickler_er_mascot.mtl\n")
        v_offset = 1
        for m_name, parent_bone, mat_name in mesh_specs:
            m = meshes[m_name]
            M = world_mats[parent_bone]
            R, t = M[:3, :3], M[:3, 3]
            wp = m["pos"] @ R.T + t
            wn = m["norm"] @ R.T
            of.write(f"o {m_name}\nusemtl {mat_name}\n")
            for v in wp:
                of.write(f"v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")
            for uv in m["uv"]:
                of.write(f"vt {uv[0]:.5f} {1.0 - uv[1]:.5f}\n")
            for n in wn:
                of.write(f"vn {n[0]:.5f} {n[1]:.5f} {n[2]:.5f}\n")
            tris = m["idx"].reshape(-1, 3) + v_offset
            for tri in tris:
                of.write(f"f {tri[0]}/{tri[0]}/{tri[0]} {tri[1]}/{tri[1]}/{tri[1]} {tri[2]}/{tri[2]}/{tri[2]}\n")
            v_offset += len(wp)

    return glb_path, obj_path


# ==============================================================================
# 5. Per-Pixel UV & Phong Shading Software Z-Buffer Renderer (2048x2048 PNGs)
# ==============================================================================
def render_scene_image(
    meshes,
    tex_data,
    cam_mode="front",
    anim_name="Anim_Idle",
    t=0.0,
    root_rot_y=0.0,
    show_props=True,
    isolate_props=False,
    size=2048,
):
    mesh_specs = [
        ("Mesh_Goose_Body", "Pelvis", "white", None),
        ("Mesh_Hoodie_Torso", "Spine_01", "royal_blue", "hoodie"),
        ("Mesh_Hoodie_Pocket", "Spine_01", "royal_blue", None),
        ("Mesh_Hoodie_Hood", "Spine_02", "royal_blue", None),
        ("Mesh_Drawstrings", "Spine_02", "white", None),
        ("Mesh_Neck_01", "Neck_01", "white", None),
        ("Mesh_Neck_02", "Neck_02", "white", None),
        ("Mesh_Goose_Head", "Head", "white", None),
        ("Mesh_Eyes", "Head", "eye_black", None),
        ("Mesh_Beak_Upper", "Head", "beak_orange", None),
        ("Mesh_Beak_Lower", "Head", "beak_orange", None),
        ("Mesh_Cap_Crown", "Head", "cap_black", "cap"),
        ("Mesh_Cap_Brim", "Head", "cap_black", None),
        ("Mesh_Sleeve_Upper_L", "Shoulder_L", "royal_blue", None),
        ("Mesh_Sleeve_Fore_L", "Elbow_L", "royal_blue", None),
        ("Mesh_Hand_L", "Wrist_L", "white", None),
        ("Mesh_Sleeve_Upper_R", "Shoulder_R", "royal_blue", None),
        ("Mesh_Sleeve_Fore_R", "Elbow_R", "royal_blue", None),
        ("Mesh_Hand_R", "Wrist_R", "white", None),
        ("Mesh_Thigh_L", "Hip_L", "beak_orange", None),
        ("Mesh_Calf_L", "Knee_L", "beak_orange", None),
        ("Mesh_Foot_L", "Ankle_L", "beak_orange", None),
        ("Mesh_Thigh_R", "Hip_R", "beak_orange", None),
        ("Mesh_Calf_R", "Knee_R", "beak_orange", None),
        ("Mesh_Foot_R", "Ankle_R", "beak_orange", None),
    ]
    if show_props:
        mesh_specs.extend([
            ("Prop_Paddle_Face", "Prop_Socket_R", "royal_blue", "paddle"),
            ("Prop_Paddle_Edge", "Prop_Socket_R", "cap_black", None),
            ("Prop_Ball_Shell", "Prop_Socket_L", "ball_blue", None),
            ("Prop_Ball_Core", "Prop_Socket_L", "ball_dark", None),
        ])

    palette = {
        "white": np.array([0.975, 0.980, 0.990], dtype=np.float32),
        "royal_blue": np.array([0.115, 0.355, 0.635], dtype=np.float32),
        "beak_orange": np.array([0.935, 0.455, 0.165], dtype=np.float32),
        "eye_black": np.array([0.055, 0.060, 0.070], dtype=np.float32),
        "cap_black": np.array([0.110, 0.120, 0.138], dtype=np.float32),
        "ball_blue": np.array([0.155, 0.475, 0.835], dtype=np.float32),
        "ball_dark": np.array([0.045, 0.140, 0.275], dtype=np.float32),
    }

    world_mats = compute_world_transforms(anim_name, t, root_rot_y)

    # Camera setup with generous framing (character height 0.0..1.72, centered at y=0.86)
    target = np.array([0.0, 0.86, 0.0], dtype=np.float32)
    if cam_mode == "front":
        cam_pos = np.array([0.0, 0.86, 4.0], dtype=np.float32)
    elif cam_mode == "back":
        cam_pos = np.array([0.0, 0.86, -4.0], dtype=np.float32)
    elif cam_mode == "left":
        cam_pos = np.array([4.0, 0.86, 0.0], dtype=np.float32)
    elif cam_mode == "right":
        cam_pos = np.array([-4.0, 0.86, 0.0], dtype=np.float32)
    elif cam_mode == "persp45":
        cam_pos = np.array([2.25, 1.32, 3.35], dtype=np.float32)
    else:
        cam_pos = np.array([0.0, 0.86, 4.0], dtype=np.float32)

    fwd = target - cam_pos
    fwd /= np.linalg.norm(fwd)
    up_ref = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    right = np.cross(fwd, up_ref)
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)

    zbuf = np.full((size, size), np.inf, dtype=np.float32)
    cbuf = np.zeros((size, size, 4), dtype=np.uint8)

    if isolate_props:
        render_batches = [
            (transform_mesh(meshes["Prop_Paddle_Face"], scale=(1.75, 1.75, 1.75), rot_euler=(0, 0, 0), translate=(-0.55, 0.45, 0.0)), "royal_blue", "paddle"),
            (transform_mesh(meshes["Prop_Paddle_Edge"], scale=(1.75, 1.75, 1.75), rot_euler=(0, 0, 0), translate=(-0.55, 0.45, 0.0)), "cap_black", None),
            (transform_mesh(meshes["Prop_Paddle_Face"], scale=(1.75, 1.75, 1.75), rot_euler=(0, math.pi * 0.5, 0), translate=(-0.05, 0.45, 0.0)), "royal_blue", "paddle"),
            (transform_mesh(meshes["Prop_Paddle_Edge"], scale=(1.75, 1.75, 1.75), rot_euler=(0, math.pi * 0.5, 0), translate=(-0.05, 0.45, 0.0)), "cap_black", None),
            (transform_mesh(meshes["Prop_Ball_Shell"], scale=(2.4, 2.4, 2.4), rot_euler=(0.3, 0.4, 0), translate=(0.45, 0.88, 0.0)), "ball_blue", None),
            (transform_mesh(meshes["Prop_Ball_Core"], scale=(2.4, 2.4, 2.4), rot_euler=(0.3, 0.4, 0), translate=(0.45, 0.88, 0.0)), "ball_dark", None),
        ]
    else:
        render_batches = []
        for m_name, parent_bone, col_key, tex_key in mesh_specs:
            m = meshes[m_name]
            M = world_mats[parent_bone]
            R, tr = M[:3, :3], M[:3, 3]
            wp = m["pos"] @ R.T + tr
            wn = m["norm"] @ R.T
            render_batches.append(({"pos": wp, "norm": wn, "uv": m["uv"], "idx": m["idx"]}, col_key, tex_key))

    key_dir = np.array([0.42, 0.55, 0.72], dtype=np.float32)
    fill_dir = np.array([-0.55, 0.25, 0.78], dtype=np.float32)

    for m, col_key, tex_key in render_batches:
        V = m["pos"]
        N = m["norm"]
        N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-8)
        UV = m["uv"]
        T = m["idx"].reshape(-1, 3)

        rel = V - cam_pos
        vx = rel @ right
        vy = rel @ up
        vz = rel @ fwd

        n_cam_x = N @ right
        n_cam_y = N @ up
        n_cam_z = -(N @ fwd)
        N_cam = np.column_stack([n_cam_x, n_cam_y, n_cam_z])

        diff_key = np.clip(N_cam @ key_dir, 0.0, 1.0)
        diff_fill = np.clip(N_cam @ fill_dir, 0.0, 1.0)
        # Bright studio illumination so white feathers are crisp white and shadows are soft
        hemi = 0.66 + 0.14 * (n_cam_y * 0.5 + 0.5)
        v_shade = np.clip(hemi + 0.34 * diff_key + 0.12 * diff_fill, 0.0, 1.12)

        if cam_mode == "persp45":
            fov_scale = 2.75
            proj_x = (vx / np.maximum(vz, 0.1)) * fov_scale
            proj_y = (vy / np.maximum(vz, 0.1)) * fov_scale + 0.04
        else:
            ortho_scale = 0.82
            proj_x = vx * ortho_scale
            proj_y = vy * ortho_scale

        sx = (proj_x * 0.5 + 0.5) * size
        sy = (0.5 - proj_y * 0.5) * size

        p0x, p0y, p0z = sx[T[:, 0]], sy[T[:, 0]], vz[T[:, 0]]
        p1x, p1y, p1z = sx[T[:, 1]], sy[T[:, 1]], vz[T[:, 1]]
        p2x, p2y, p2z = sx[T[:, 2]], sy[T[:, 2]], vz[T[:, 2]]

        area = (p1x - p0x) * (p2y - p0y) - (p2x - p0x) * (p1y - p0y)
        valid = np.abs(area) > 1e-3
        idxs = np.where(valid)[0]

        base_col = palette[col_key]
        tex_arr = tex_data[tex_key]["rgb"] if tex_key is not None else None
        if tex_arr is not None:
            th, tw, _ = tex_arr.shape

        for ti in idxs:
            i0, i1, i2 = int(T[ti, 0]), int(T[ti, 1]), int(T[ti, 2])
            x0, y0, z0 = float(p0x[ti]), float(p0y[ti]), float(p0z[ti])
            x1, y1, z1 = float(p1x[ti]), float(p1y[ti]), float(p1z[ti])
            x2, y2, z2 = float(p2x[ti]), float(p2y[ti]), float(p2z[ti])

            min_x = max(0, int(math.floor(min(x0, x1, x2))))
            max_x = min(size - 1, int(math.ceil(max(x0, x1, x2))))
            min_y = max(0, int(math.floor(min(y0, y1, y2))))
            max_y = min(size - 1, int(math.ceil(max(y0, y1, y2))))
            if min_x > max_x or min_y > max_y:
                continue

            denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(denom) < 1e-6:
                continue
            inv_d = 1.0 / denom

            ys = np.arange(min_y, max_y + 1, dtype=np.float32)[:, None] + 0.5
            xs = np.arange(min_x, max_x + 1, dtype=np.float32)[None, :] + 0.5

            w0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) * inv_d
            w1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) * inv_d
            w2 = 1.0 - w0 - w1

            mask = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
            if not np.any(mask):
                continue

            z_val = w0 * z0 + w1 * z1 + w2 * z2
            sub_z = zbuf[min_y : max_y + 1, min_x : max_x + 1]
            closer = mask & (z_val < sub_z)
            if not np.any(closer):
                continue

            sub_z[closer] = z_val[closer]
            sub_c = cbuf[min_y : max_y + 1, min_x : max_x + 1]

            # Per-pixel interpolated shading
            sh_pix = w0[closer] * v_shade[i0] + w1[closer] * v_shade[i1] + w2[closer] * v_shade[i2]

            if tex_arr is not None:
                u0, v0_uv = UV[i0]
                u1, v1_uv = UV[i1]
                u2, v2_uv = UV[i2]
                u_pix = w0[closer] * u0 + w1[closer] * u1 + w2[closer] * u2
                v_pix = w0[closer] * v0_uv + w1[closer] * v1_uv + w2[closer] * v2_uv
                ux = np.clip((u_pix % 1.0) * (tw - 1), 0, tw - 1).astype(np.int32)
                vy_idx = np.clip(v_pix * (th - 1), 0, th - 1).astype(np.int32)
                t_rgb = tex_arr[vy_idx, ux]
                rgb_out = np.clip(t_rgb * sh_pix[:, None] * 255.0, 0, 255).astype(np.uint8)
            else:
                rgb_out = np.clip(base_col[None, :] * sh_pix[:, None] * 255.0, 0, 255).astype(np.uint8)

            sub_c[closer, :3] = rgb_out
            sub_c[closer, 3] = 255

    img = Image.fromarray(cbuf)
    return img, world_mats


def annotate_joints_and_palette(base_img, world_mats, size=2048):
    img = base_img.copy()
    draw = ImageDraw.Draw(img)
    font_sm = load_bold_font(24, cjk=True)
    font_title = load_bold_font(34, cjk=True)

    target = np.array([0.0, 0.86, 0.0], dtype=np.float32)
    ortho_scale = 0.82

    for b_name, M in world_mats.items():
        if b_name == "Root":
            continue
        pos = M[:3, 3]
        vx = pos[0] - target[0]
        vy = pos[1] - target[1]
        sx = int((vx * ortho_scale * 0.5 + 0.5) * size)
        sy = int((0.5 - vy * ortho_scale * 0.5) * size)

        spec = BONE_REST[b_name]
        if spec["parent"] and spec["parent"] != "Root":
            p_pos = world_mats[spec["parent"]][:3, 3]
            px = int(((p_pos[0] - target[0]) * ortho_scale * 0.5 + 0.5) * size)
            py = int((0.5 - (p_pos[1] - target[1]) * ortho_scale * 0.5) * size)
            draw.line([(px, py), (sx, sy)], fill=(0, 255, 170, 230), width=5)

        r = 12
        draw.ellipse([(sx - r, sy - r), (sx + r, sy + r)], fill=(0, 255, 170, 255), outline=(15, 23, 42, 255), width=3)
        offset_x = 18 if sx >= size // 2 else -195
        draw.text((sx + offset_x, sy - 14), b_name, font=font_sm, fill=(15, 23, 42, 255))
        draw.text((sx + offset_x - 2, sy - 16), b_name, font=font_sm, fill=(0, 255, 170, 255))

    swatches = [
        ("#1B579E", "Royal Blue (帽T主色)", (27, 87, 158)),
        ("#F5C533", "NCHU Gold (字樣/球拍金)", (245, 197, 51)),
        ("#E8712A", "Goose Orange (立體喙/蹼足)", (232, 113, 42)),
        ("#2575D0", "Pickleball Blue (26孔球)", (37, 117, 208)),
        ("#181A1D", "Cap/Guard Black (棒球帽/護邊)", (24, 26, 29)),
        ("#F7F8FA", "Feather White (鵝毛/抽繩)", (247, 248, 250)),
    ]
    x0, y0 = 50, 95
    draw.rounded_rectangle([(30, 25), (615, 655)], radius=18, fill=(22, 27, 36, 235), outline=(70, 82, 102, 255), width=3)
    draw.text((x0, y0 - 52), "NCHU Pickler-er Rig & Color Spec", font=font_title, fill=(245, 197, 51, 255))
    for i, (hex_code, label, rgb) in enumerate(swatches):
        by = y0 + i * 88
        draw.rounded_rectangle([(x0, by), (x0 + 68, by + 68)], radius=10, fill=rgb + (255,), outline=(255, 255, 255, 220), width=3)
        draw.text((x0 + 86, by + 18), f"{hex_code}  {label}", font=font_sm, fill=(240, 244, 248, 255))

    return img


def main():
    print("1. Generating high-res 2048px textures...")
    hoodie_png, hoodie_rgb = create_hoodie_texture()
    cap_png, cap_rgb = create_cap_texture()
    paddle_png, paddle_rgb = create_paddle_texture()
    tex_data = {
        "hoodie": {"png": hoodie_png, "rgb": hoodie_rgb},
        "cap": {"png": cap_png, "rgb": cap_rgb},
        "paddle": {"png": paddle_png, "rgb": paddle_rgb},
    }

    print("2. Building seamless organic 3D meshes and 20-node skeleton...")
    meshes = build_all_mascot_meshes()

    print("3. Exporting binary glTF 2.0 (.glb) and Wavefront (.obj/.mtl)...")
    glb_path, obj_path = export_glb_and_obj(meshes, tex_data)
    print(f"   -> Saved GLB: {glb_path} ({os.path.getsize(glb_path) / 1024:.1f} KB)")
    print(f"   -> Saved OBJ: {obj_path} ({os.path.getsize(obj_path) / 1024:.1f} KB)")

    print("4. Rendering 2048x2048 transparent PNG orthographic & turnaround reference pack...")
    render_tasks = [
        ("01_front_ortho_2048px.png", "front", "Anim_Idle", True, False),
        ("02_left_ortho_2048px.png", "left", "Anim_Idle", True, False),
        ("03_right_ortho_2048px.png", "right", "Anim_Idle", True, False),
        ("04_back_ortho_2048px.png", "back", "Anim_Idle", True, False),
        ("05_persp45_render_2048px.png", "persp45", "Anim_Idle", True, False),
        ("06_apose_neutral_no_props_2048px.png", "front", "Anim_APose", False, False),
        ("07_props_isolated_2048px.png", "front", "Anim_Idle", True, True),
    ]

    apose_img = None
    apose_mats = None
    for fname, cam, anim, s_props, iso in render_tasks:
        img, w_mats = render_scene_image(
            meshes, tex_data, cam_mode=cam, anim_name=anim, show_props=s_props, isolate_props=iso, size=2048
        )
        out_p = os.path.join(OUT_PACK_DIR, fname)
        img.save(out_p, format="PNG")
        print(f"   -> Rendered {fname} (2048x2048 RGBA)")
        if fname == "06_apose_neutral_no_props_2048px.png":
            apose_img = img
            apose_mats = w_mats

    joint_img = annotate_joints_and_palette(apose_img, apose_mats, size=2048)
    joint_path = os.path.join(OUT_PACK_DIR, "08_joint_hierarchy_palette_2048px.png")
    joint_img.save(joint_path, format="PNG")
    print("   -> Rendered 08_joint_hierarchy_palette_2048px.png (2048x2048 RGBA)")

    print("5. Rendering 360-degree turntable preview animation...")
    frames = []
    n_turntable = 24
    for i in range(n_turntable):
        ang = (i / n_turntable) * math.pi * 2.0
        f_img, _ = render_scene_image(
            meshes, tex_data, cam_mode="front", anim_name="Anim_Idle", t=(i / n_turntable) * 2.0, root_rot_y=ang, size=600
        )
        bg = Image.new("RGBA", (600, 600), (28, 33, 43, 255))
        bg.alpha_composite(f_img)
        frames.append(bg.convert("RGB"))
    gif_path = os.path.join(OUT_PACK_DIR, "09_turntable_360_preview.gif")
    frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=90, loop=0)
    print(f"   -> Saved 360 turntable GIF: {gif_path}")


if __name__ == "__main__":
    main()
