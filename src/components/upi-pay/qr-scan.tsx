"use client";

import { Camera, CameraOff, ImageUp, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

import { Button } from "@/components/ui/button";

/**
 * "Scan UPI QR" — camera scanning that runs 100% on-device (jsQR in the
 * browser). The image is never uploaded anywhere. A file-upload fallback is
 * provided for denied/missing camera permissions.
 */

interface QrScanProps {
  /** Called with the raw decoded QR text (parent parses + confirms). */
  onResult: (text: string) => void;
}

type CameraState = "idle" | "starting" | "scanning" | "denied" | "unavailable";

const DECODE_INTERVAL_MS = 120;

export function QrScan({ onResult }: QrScanProps) {
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const handleDecode = useCallback(
    (text: string | null) => {
      if (!text) return;
      stopCamera();
      setCameraState("idle");
      onResult(text);
    },
    [onResult, stopCamera]
  );

  const startDecodeLoop = useCallback(() => {
    timerRef.current = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height, { inversionAttempts: "dontInvert" });
      if (code?.data) handleDecode(code.data);
    }, DECODE_INTERVAL_MS);
  }, [handleDecode]);

  const startCamera = useCallback(async () => {
    setUploadError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unavailable");
      return;
    }
    setCameraState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraState("scanning");
      startDecodeLoop();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setCameraState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }, [startDecodeLoop]);

  const decodeFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("no-context");
        context.drawImage(bitmap, 0, 0);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height, {
          inversionAttempts: "attemptBoth",
        });
        bitmap.close?.();
        if (code?.data) {
          onResult(code.data);
        } else {
          setUploadError("No QR code found in that image. Try a sharper photo.");
        }
      } catch {
        setUploadError("Couldn't read that image. Try a different file.");
      }
    },
    [onResult]
  );

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <div className="space-y-3.5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Upload a photo of the UPI QR code"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void decodeFile(file);
          event.target.value = "";
        }}
      />

      {cameraState === "scanning" || cameraState === "starting" ? (
        <div className="relative overflow-hidden rounded-2xl border border-[#e3e8ef] bg-black/90">
          <video
            ref={videoRef}
            playsInline
            muted
            className="aspect-[4/3] w-full object-cover"
            aria-label="Camera preview — point it at the UPI QR code"
          />
          {/* Viewfinder corners */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative size-44 rounded-2xl sm:size-52">
              {["top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-2xl", "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-2xl", "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-2xl", "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-2xl"].map(
                (position) => (
                  <span key={position} className={`absolute size-8 border-white/90 ${position}`} />
                )
              )}
              {cameraState === "starting" && (
                <span className="absolute inset-0 grid place-items-center text-[13px] font-medium text-white/90">
                  Starting camera…
                </span>
              )}
            </div>
          </div>
          <p aria-live="polite" className="sr-only">
            {cameraState === "scanning" ? "Camera active. Point it at the UPI QR code." : "Starting camera."}
          </p>
        </div>
      ) : (
        <div className="grid place-items-center rounded-2xl border border-dashed border-[#e3e8ef] bg-[#f7f9fc] px-4 py-8 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-[#eeedf9] text-[#5140b5]">
            {cameraState === "denied" || cameraState === "unavailable" ? (
              <CameraOff size={20} aria-hidden="true" />
            ) : (
              <ScanLine size={20} aria-hidden="true" />
            )}
          </span>
          <p className="mt-3 max-w-[30ch] text-[13.5px] font-medium text-[#26364a]">
            Point your camera at the payee&rsquo;s UPI QR code
          </p>
          <p className="mt-1 max-w-[38ch] text-[12px] leading-relaxed text-[#65748b]">
            {cameraState === "denied"
              ? "Camera access was denied. Upload a photo of the QR instead."
              : cameraState === "unavailable"
                ? "No camera available here. Upload a photo of the QR instead."
                : "Scanning happens on your device — the image is never uploaded."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            <Button
              type="button"
              onClick={() => void startCamera()}
              className="h-11 gap-2 rounded-full bg-[#635bff] px-5 hover:bg-[#5348f0]"
            >
              <Camera size={16} aria-hidden="true" />
              Start camera
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="h-11 gap-2 rounded-full border-[#e3e8ef] text-[#26364a] hover:bg-white"
            >
              <ImageUp size={16} aria-hidden="true" />
              Upload photo
            </Button>
          </div>
        </div>
      )}

      {cameraState === "scanning" && (
        <div className="flex flex-wrap justify-center gap-2.5">
          <Button type="button" variant="outline" onClick={stopCamera} className="h-10 rounded-full border-[#e3e8ef] text-[#26364a]">
            Stop camera
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            className="h-10 gap-2 rounded-full text-[#65748b]"
          >
            <ImageUp size={15} aria-hidden="true" />
            Upload a photo instead
          </Button>
        </div>
      )}

      {uploadError && (
        <p role="alert" className="text-[12.5px] font-medium text-[#b42318]">
          {uploadError}
        </p>
      )}

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
