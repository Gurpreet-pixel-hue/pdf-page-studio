"""Shared code for the section-start model: strip rendering and MobileNetV2 features.

Strip = rows 3%..20% of the page, full width, rendered at 900 px wide, resized to 576x192.
Pixels are scaled with MobileNetV2's preprocess_input (pixel / 127.5 - 1).
"""
import json, os
import cv2, numpy as np
import pymupdf

STRIP_TOP, STRIP_BOTTOM = 0.03, 0.20
STRIP_W, STRIP_H = 576, 192
RENDER_W = 900


def render_strips(pdf_path):
    """Return a list of RGB uint8 arrays (STRIP_H x STRIP_W x 3), one per page."""
    doc = pymupdf.open(pdf_path)
    out = []
    for page in doc:
        scale = RENDER_W / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale))
        img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3]
        h = img.shape[0]
        strip = img[int(h * STRIP_TOP):int(h * STRIP_BOTTOM)]
        out.append(cv2.resize(strip, (STRIP_W, STRIP_H), interpolation=cv2.INTER_AREA))
    return out


def preprocess(strips):
    return np.stack([s.astype(np.float32) / 127.5 - 1.0 for s in strips])


def backbone(alpha):
    import tensorflow as tf
    return tf.keras.applications.MobileNetV2(
        include_top=False, weights='imagenet', alpha=alpha,
        input_shape=(STRIP_H, STRIP_W, 3), pooling='avg')


def load_journals(path=None):
    path = path or os.path.expanduser('~/Documents/page_crop_ground_truth/journals.json')
    return json.load(open(path))
