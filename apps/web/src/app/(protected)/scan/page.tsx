'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { QrCode, Camera, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    const activeStream = videoRef.current?.srcObject as MediaStream | null;
    activeStream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const handleStartFromCode = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push(`/session/${encodeURIComponent(trimmed)}`);
  };

  useEffect(() => {
    let cancelled = false;

    const startScanner = async () => {
      const videoElement = videoRef.current;
      if (!videoElement || !('mediaDevices' in navigator) || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser does not support camera access.');
        return;
      }

      setIsScanning(true);
      setCameraError('');

      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (cancelled) return;

        const codeReader = new BrowserMultiFormatReader();
        const selectedDeviceId = devices[0]?.deviceId;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        videoElement.srcObject = stream;
        await videoElement.play();

        controlsRef.current = await codeReader.decodeFromVideoDevice(selectedDeviceId, videoElement, (result, error, controls) => {
          if (cancelled) return;

          if (result) {
            const scannedCode = result.getText().trim();
            if (scannedCode) {
              controls?.stop();
              stopCamera();
              router.push(`/session/${encodeURIComponent(scannedCode)}`);
            }
          }

          if (error && error.name !== 'NotFoundException') {
            // Ignore repeated no-result frames while scanning.
          }
        });
      } catch (error) {
        if (cancelled) return;

        const message =
          error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
            ? 'Camera access was denied. Please allow camera permissions and try again.'
            : error instanceof Error
              ? error.message
              : 'Unable to access the camera.';

        setIsScanning(false);
        setCameraError(message);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [router]);

  return (
    <div className="mx-auto flex h-full w-full items-center justify-center p-6">
      <Card className="border text-center shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2 text-lg font-semibold text-slate-100">
            <QrCode className="h-5 w-5 text-primary" />
            Scan Charger QR Code
          </CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Point camera at the QR code sticker on the charger connector
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="relative aspect-square overflow-hidden border-2 border-dashed bg-background/50">
            {cameraError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <AlertCircle className="h-10 w-10 text-amber-400" />
                <p className="text-sm text-slate-300">{cameraError}</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()} className="gap-2">
                  <RefreshCw className="h-3.5 w-3.5" /> Try again
                </Button>
              </div>
            ) : (
              <>
                <video ref={videoRef} className="h-full w-full object-cover" playsInline autoPlay muted />
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-4 border-2 border-amber-400/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.8)]" />
                  <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
            <div className="h-px flex-1 bg-border" />
            <span className="px-2">Or enter Station ID manually</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleStartFromCode(manualCode);
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="e.g. STATION-NG-01"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="text-sm font-mono"
            />
            <Button type="submit" className="font-semibold shadow-sm shadow-amber-500/30">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          {!cameraError && (
            <div className="flex items-center justify-center gap-2 text-[11px]">
              <Camera className="h-3.5 w-3.5 text-emerald-400" />
              <span>{isScanning ? 'Scanning...' : 'Preparing camera...'}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
