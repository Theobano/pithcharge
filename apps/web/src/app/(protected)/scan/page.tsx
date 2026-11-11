'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { QrCode, Camera, ArrowRight, RefreshCw, AlertCircle, SwitchCamera } from 'lucide-react';
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
  const [scanMessage, setScanMessage] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    const activeStream = videoRef.current?.srcObject as MediaStream | null;
    activeStream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleStartFromCode = useCallback((code: string) => {
    const value = code.trim();
    if (!value) return;

    let stationId = value;
    try {
      const url = new URL(value);
      stationId = url.searchParams.get('stationId') ?? '';
      if (!stationId) {
        const match = url.pathname.match(/(?:^|\/)stations\/([^/]+)\/?$/i);
        stationId = match?.[1] ? decodeURIComponent(match[1]) : '';
      }
      if (!stationId) {
        setScanMessage('This QR code does not contain a station ID. Scan a station QR code or enter its ID.');
        return;
      }
    } catch {
      // Station ID text is also accepted directly.
    }

    setScanMessage('');
    stopCamera();
    router.push(`/stations/${encodeURIComponent(stationId)}`);
  }, [router, stopCamera]);

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const currentIndex = cameras.findIndex((camera) => camera.deviceId === selectedCameraId);
    setSelectedCameraId(cameras[(currentIndex + 1) % cameras.length]?.deviceId ?? '');
  };

  useEffect(() => {
    let cancelled = false;

    const findCameras = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser does not support camera access.');
        return;
      }

      setCameraError('');
      try {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        permissionStream.getTracks().forEach((track) => track.stop());
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (cancelled) return;
        if (devices.length === 0) {
          setCameraError('No camera was detected. Enter the station ID below instead.');
          return;
        }
        setCameras(devices);
        setSelectedCameraId(
          devices.find((device) => /back|rear|environment/i.test(device.label))?.deviceId
            ?? devices[0]?.deviceId
            ?? '',
        );
      } catch (error) {
        if (cancelled) return;

        const message =
          error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
            ? 'Camera access was denied. Please allow camera permissions and try again.'
            : error instanceof Error
              ? error.message
              : 'Unable to access the camera.';

        setCameraError(message);
      }
    };

    void findCameras();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !selectedCameraId) return;

    let cancelled = false;
    const codeReader = new BrowserMultiFormatReader();
    setIsScanning(true);
    setCameraError('');

    void codeReader.decodeFromVideoDevice(selectedCameraId, videoElement, (result) => {
      if (cancelled) return;
      if (result) handleStartFromCode(result.getText());
    }).then((controls) => {
      if (cancelled) controls.stop();
      else controlsRef.current = controls;
    }).catch((error: unknown) => {
      if (cancelled) return;
      setIsScanning(false);
      setCameraError(error instanceof Error ? error.message : 'Unable to access the selected camera.');
    });

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [handleStartFromCode, selectedCameraId, stopCamera]);

  return (
    <div className="mx-auto flex h-full w-full items-center justify-center p-6">
      <Card className="border text-center shadow-lg">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <CardTitle className="flex items-center justify-center gap-2 text-lg font-semibold text-slate-100">
              <QrCode className="h-5 w-5 text-primary" />
              Scan Charger QR Code
            </CardTitle>
            {cameras.length > 1 && (
              <Button type="button" variant="outline" size="sm" onClick={switchCamera} className="gap-2">
                <SwitchCamera className="h-4 w-4" />
                Switch camera
              </Button>
            )}
          </div>
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
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCameraError('');
                    setCameras([]);
                    setSelectedCameraId('');
                    window.location.reload();
                  }}
                  className="gap-2"
                >
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

          {scanMessage && <p role="status" className="text-sm text-destructive">{scanMessage}</p>}

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
              aria-label="Station ID"
            />
            <Button type="submit" disabled={!manualCode.trim()} className="font-semibold shadow-sm shadow-amber-500/30">
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
