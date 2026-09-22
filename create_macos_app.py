#!/usr/bin/env python3
import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFont

def generate_app_icon(output_png_path):
    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # macOS Big Sur+ standard squircle icon base
    # Squircle padding: 92px margin on 1024x1024 canvas
    pad = 88
    x0, y0, x1, y1 = pad, pad, size - pad, size - pad
    corner_radius = 188

    # Background squircle: Warm Alabaster Cream (#fbfaf7)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=corner_radius, fill=(251, 250, 247, 255))
    # Subtle warm stone border (#d5cbbe)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=corner_radius, outline=(213, 203, 190, 255), width=6)

    # Sheet 1: Back sheet (Warm Oat)
    s1_x0, s1_y0, s1_x1, s1_y1 = 280, 220, 680, 780
    draw.rounded_rectangle([s1_x0, s1_y0, s1_x1, s1_y1], radius=24, fill=(235, 228, 213, 255), outline=(213, 203, 190, 255), width=4)

    # Sheet 2: Middle sheet (Soft Linen)
    s2_x0, s2_y0, s2_x1, s2_y1 = 330, 260, 730, 820
    draw.rounded_rectangle([s2_x0, s2_y0, s2_x1, s2_y1], radius=24, fill=(244, 239, 230, 255), outline=(225, 218, 207, 255), width=4)

    # Sheet 3: Front primary document sheet (Crisp Pure White)
    s3_x0, s3_y0, s3_x1, s3_y1 = 380, 300, 780, 860
    draw.rounded_rectangle([s3_x0, s3_y0, s3_x1, s3_y1], radius=24, fill=(255, 255, 255, 255), outline=(220, 212, 198, 255), width=4)

    # Document content lines on front sheet
    # Document title block (Artisanal Terracotta Cognac)
    draw.rounded_rectangle([420, 350, 580, 375], radius=6, fill=(194, 65, 12, 255))
    # Text line placeholders (Warm Granite)
    draw.rounded_rectangle([420, 410, 740, 426], radius=4, fill=(214, 206, 194, 255))
    draw.rounded_rectangle([420, 450, 740, 466], radius=4, fill=(214, 206, 194, 255))
    draw.rounded_rectangle([420, 490, 660, 506], radius=4, fill=(214, 206, 194, 255))

    # Inner image placeholder box on front sheet
    draw.rounded_rectangle([420, 540, 740, 740], radius=12, fill=(248, 245, 240, 255), outline=(214, 206, 194, 255), width=3)
    
    # Mountain/image symbol inside box
    draw.polygon([(460, 700), (530, 610), (590, 680), (640, 630), (700, 700)], fill=(133, 126, 117, 255))
    draw.ellipse([630, 580, 670, 620], fill=(194, 65, 12, 255))

    # Bottom badge: Page Sequence "1 • 2 • 3" Indicator Badge (Deep Roasted Espresso #1c1917)
    b_x0, b_y0, b_x1, b_y1 = 230, 720, 530, 820
    draw.rounded_rectangle([b_x0, b_y0, b_x1, b_y1], radius=20, fill=(28, 25, 23, 255), outline=(50, 45, 41, 255), width=4)

    # Three warm cream dots representing page order
    dot_y = (b_y0 + b_y1) // 2
    for i, dx in enumerate([300, 380, 460]):
        draw.ellipse([dx - 18, dot_y - 18, dx + 18, dot_y + 18], fill=(251, 250, 247, 255))

    img.save(output_png_path, "PNG")
    print(f"Generated 1024x1024 icon: {output_png_path}")

def build_icns(icon_png_path, icns_path):
    iconset_dir = "/tmp/pdf_page_studio.iconset"
    if os.path.exists(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir, exist_ok=True)

    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png")
    ]

    base_img = Image.open(icon_png_path)
    for sz, filename in sizes:
        resized = base_img.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(os.path.join(iconset_dir, filename))

    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", icns_path], check=True)
    shutil.rmtree(iconset_dir)
    print(f"Built macOS ICNS: {icns_path}")

def build_app(target_app_path, icns_path, launcher_script):
    if os.path.exists(target_app_path):
        shutil.rmtree(target_app_path)

    # Use osacompile to create clean native .app bundle
    apple_script = f'do shell script "{launcher_script} > /dev/null 2>&1 &"'
    subprocess.run(["osacompile", "-o", target_app_path, "-e", apple_script], check=True)

    # Replace icon
    resources_dir = os.path.join(target_app_path, "Contents", "Resources")
    os.makedirs(resources_dir, exist_ok=True)
    dest_icns = os.path.join(resources_dir, "applet.icns")
    shutil.copyfile(icns_path, dest_icns)

    # Touch bundle to refresh Finder cache
    subprocess.run(["touch", target_app_path])
    print(f"Successfully installed application: {target_app_path}")

if __name__ == "__main__":
    base_dir = "/Users/shridhartawate/pdf-page-studio"
    icon_png = os.path.join(base_dir, "assets", "app_icon.png")
    icns_file = os.path.join(base_dir, "assets", "app.icns")
    launcher = os.path.join(base_dir, "launch.sh")

    generate_app_icon(icon_png)
    build_icns(icon_png, icns_file)

    desktop_app = "/Users/shridhartawate/Desktop/PDF Page Studio.app"
    build_app(desktop_app, icns_file, launcher)

    # Try Applications folder; if root /Applications needs sudo, use ~/Applications
    apps_dir = "/Applications"
    try:
        app_target = os.path.join(apps_dir, "PDF Page Studio.app")
        build_app(app_target, icns_file, launcher)
    except Exception as e:
        print(f"Could not install to /Applications ({e}), falling back to ~/Applications")
        user_apps = os.path.expanduser("~/Applications")
        os.makedirs(user_apps, exist_ok=True)
        build_app(os.path.join(user_apps, "PDF Page Studio.app"), icns_file, launcher)
