// src/components/ImageCropModal.jsx
//
// A small, dependency-free crop tool shown before a photo/signature/Aadhaar
// image is uploaded (see ApplicationDocsModal in DealerPortal.jsx). Pure
// <canvas> — no react-easy-crop/cropper.js — since this app doesn't
// otherwise bundle an image library and this only needs pan + zoom + crop.
//
// For signature uploads specifically, an optional "Remove background"
// toggle is offered — a simple luminance-threshold trick (anything close
// to white/paper becomes transparent) rather than true ML background
// removal, which isn't feasible to run client-side here. It works well for
// the common case (dark ink signed on plain white/light paper) but isn't
// perfect for shadowy scans or colored paper — it's offered as a toggle,
// not forced, so the dealer can just skip it if the result looks wrong.
import React, { useEffect, useRef, useState } from "react";
import { Modal, GhostButton, PrimaryButton } from "./UI";

const VIEWPORT = 320; // px, square on-screen crop window

export default function ImageCropModal({ file, aspect = 1, allowBgRemove = false, onCancel, onCropped }) {
  const [imgEl, setImgEl] = useState(null);
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [removeBg, setRemoveBg] = useState(false);
  const dragRef = useRef(null); // { startX, startY, origX, origY } | null
  const canvasRef = useRef(null);

  const viewportW = VIEWPORT;
  const viewportH = Math.round(VIEWPORT / aspect);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Start zoomed so the image fully covers the viewport (like a
      // "cover" background), centered.
      const cover = Math.max(viewportW / img.width, viewportH / img.height);
      setMinScale(cover);
      setScale(cover);
      setOffset({ x: 0, y: 0 });
      setImgEl(img);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const clampOffset = (o, s) => {
    if (!imgEl) return o;
    const w = imgEl.width * s;
    const h = imgEl.height * s;
    const maxX = Math.max(0, (w - viewportW) / 2);
    const maxY = Math.max(0, (h - viewportH) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
  };

  const onPointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }, scale));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const onZoom = (e) => {
    const s = Number(e.target.value);
    setScale(s);
    setOffset((o) => clampOffset(o, s));
  };

  const confirm = () => {
    if (!imgEl) return;
    const outW = 800;
    const outH = Math.round(outW / aspect);
    const canvas = canvasRef.current;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");

    // Map from the on-screen viewport (viewportW x viewportH, showing the
    // image at `scale` centered + offset) to the full-res output canvas.
    const ratio = outW / viewportW;
    const drawW = imgEl.width * scale * ratio;
    const drawH = imgEl.height * scale * ratio;
    const drawX = outW / 2 - drawW / 2 + offset.x * ratio;
    const drawY = outH / 2 - drawH / 2 + offset.y * ratio;
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(imgEl, drawX, drawY, drawW, drawH);

    if (allowBgRemove && removeBg) {
      const imageData = ctx.getImageData(0, 0, outW, outH);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const luminance = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (luminance > 200) d[i + 3] = 0; // near-white paper -> transparent
      }
      ctx.putImageData(imageData, 0, 0);
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const ext = allowBgRemove && removeBg ? "png" : (file.name.split(".").pop() || "jpg");
        const outName = file.name.replace(/\.[^.]+$/, "") + `-cropped.${ext}`;
        onCropped(new File([blob], outName, { type: blob.type }));
      },
      allowBgRemove && removeBg ? "image/png" : "image/jpeg",
      0.92
    );
  };

  return (
    <Modal title="Crop image" onClose={onCancel}>
      <p className="text-xs text-slate-500 dark:text-slate-500 mb-3">Drag to reposition, use the slider to zoom, then confirm.</p>
      <div
        className="mx-auto relative overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 touch-none select-none"
        style={{ width: viewportW, height: viewportH, cursor: dragRef.current ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {imgEl && (
          <img
            src={imgEl.src}
            alt=""
            draggable={false}
            className="absolute top-1/2 left-1/2 pointer-events-none"
            style={{
              width: imgEl.width * scale,
              height: imgEl.height * scale,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-slate-400 dark:text-slate-500">Zoom</span>
        <input
          type="range"
          min={minScale}
          max={minScale * 4}
          step={0.01}
          value={scale}
          onChange={onZoom}
          className="flex-1"
        />
      </div>

      {allowBgRemove && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
          Remove background (best for a signature on plain white paper)
        </label>
      )}

      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-2 mt-4">
        <PrimaryButton onClick={confirm} disabled={!imgEl}>Use this crop</PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </Modal>
  );
}
