import React, { useState, useEffect, useRef } from 'react';
import { 
  ScanLine, 
  QrCode, 
  Camera, 
  Check, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Loader2, 
  Volume2, 
  VolumeX, 
  ArrowLeft,
  ChevronRight,
  ClipboardList
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { db } from '../firebase';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';

interface ExternalOrderScannerProps {
  orderId: string;
  onClose: () => void;
}

export const ExternalOrderScanner: React.FC<ExternalOrderScannerProps> = ({ orderId, onClose }) => {
  const isExternalLink = new URLSearchParams(window.location.search).has('scanOrder');
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [manualCode, setManualCode] = useState('');
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [lastScanned, setLastScanned] = useState<any | null>(null);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false);

  // Sound effects generator
  const triggerBeep = (type: 'success' | 'warning' | 'error' = 'success') => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (type === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // Crisp A5
        gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.125);
      } else if (type === 'warning') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(220, audioCtx.currentTime); // Low buzz
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.25);
      } else {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(150, audioCtx.currentTime); // Aggressive error buzz
        gainNode.gain.setValueAtTime(0.25, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.35);
      }
    } catch (err) {
      console.warn("AudioContext block prevented sound.", err);
    }
  };

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => {
      setNotification((current) => current?.msg === msg ? null : current);
    }, 4500);
  };

  // Real-time Firestore subscription to stay 100% in sync
  useEffect(() => {
    setLoading(true);
    setError(null);

    const orderRef = doc(db, 'orders', orderId);
    const unsubscribe = onSnapshot(
      orderRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setOrder({ ...docSnap.data(), id: docSnap.id });
        } else {
          setError(`Pedido #${orderId} não localizado ou excluído do servidor.`);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Firestore loading error:", err);
        setError("Erro ao se conectar ao banco de dados em tempo real.");
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
      stopScannerCleanly();
    };
  }, [orderId]);

  // Main barcode scan processor
  const processScannedCode = async (code: string) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    if (isProcessingRef.current) {
      console.log("Ignorando leitura redundante/rápida:", trimmedCode);
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      // Validar prefixo de pedido de forma rígida
      const requiredPrefix = `ORD${orderId}`.toUpperCase();
      const codeUpper = trimmedCode.trim().toUpperCase();
      if (!codeUpper.startsWith(requiredPrefix)) {
        triggerBeep('error');
        showToast(`Código pertencente a outro pedido! Confirme se está bando o Pedido #${orderId}.`, 'error');
        resetProcessingState();
        return;
      }

      const orderRef = doc(db, 'orders', orderId);
      const orderSnap = await getDoc(orderRef);

      if (!orderSnap.exists()) {
        triggerBeep('error');
        showToast("Pedido correspondente não localizado ou excluído.", 'error');
        resetProcessingState();
        return;
      }

      const orderData = orderSnap.data();
      const labels = orderData.labels || [];
      const items = [...(orderData.items || [])];

      const matchedIdx = labels.findIndex((l: any) => l.id === trimmedCode);
      if (matchedIdx === -1) {
        triggerBeep('error');
        showToast(`Código inválido! Este volume não pertence a este pedido. (${trimmedCode})`, 'error');
        resetProcessingState();
        return;
      }

      const matchedLabel = labels[matchedIdx];

      if (matchedLabel.isScanned) {
        triggerBeep('warning');
        showToast(`Volume #${matchedLabel.labelIndex} já catalogado anteriormente!`, 'info');
        resetProcessingState();
        return;
      }

      // Mark local scanned state
      const updatedLabels = [...labels];
      updatedLabels[matchedIdx] = {
        ...matchedLabel,
        isScanned: true,
        scannedAt: new Date().toISOString()
      };

      const labelQty = Number(matchedLabel.quantity) || 0;
      const itemIdx = items.findIndex((it: any) => it.productId === matchedLabel.productId);

      if (itemIdx !== -1 && items[itemIdx]) {
        const currentFinished = Number(items[itemIdx].finishedQuantity) || 0;
        const newFinished = currentFinished + labelQty;
        items[itemIdx].finishedQuantity = newFinished;

        if (newFinished >= Number(items[itemIdx].quantity || 0)) {
          items[itemIdx].status = 'Expedição';
        }

        const sanitizedItems = items.map(it => ({
          ...it,
          color: it.color || '',
          size: it.size || '',
          printName: it.printName || '',
          isUrgent: !!it.isUrgent,
          unitPrice: it.unitPrice || 0,
          calculatedWeight: it.calculatedWeight || 0,
          status: it.status || 'Pendente',
          finishedQuantity: it.finishedQuantity || 0
        }));

        await updateDoc(orderRef, {
          labels: updatedLabels,
          items: sanitizedItems
        });

        // Sync with production / OP
        const opId = `OP-${orderId}-${itemIdx}`;
        const opRef = doc(db, 'production', opId);
        const opSnap = await getDoc(opRef);
        if (opSnap.exists()) {
          const opData = opSnap.data();
          const opCurrentFinished = Number(opData.finishedQuantity) || 0;
          const opNewFinished = opCurrentFinished + labelQty;
          const opUpdates: any = { finishedQuantity: opNewFinished };
          if (opNewFinished >= Number(opData.quantity || 0)) {
            opUpdates.status = 'Expedição';
          }
          await updateDoc(opRef, opUpdates);
        }
      } else {
        // Fallback update without product match
        await updateDoc(orderRef, { labels: updatedLabels });
      }

      triggerBeep('success');
      setLastScanned({
        ...matchedLabel,
        isScanned: true,
        scannedAt: new Date().toISOString(),
        time: new Date().toLocaleTimeString('pt-BR')
      });
      showToast(`Volume #${matchedLabel.labelIndex} de '${matchedLabel.productName}' catalogado!`, 'success');
      setManualCode('');

      resetProcessingState();
    } catch (err: any) {
      console.error("Scanning process error:", err);
      triggerBeep('error');
      showToast("Falha técnica ao salvar bipagem no banco.", 'error');
      resetProcessingState();
    }
  };

  const resetProcessingState = () => {
    setTimeout(() => {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }, 450);
  };

  const startScanner = async () => {
    setScannerError(null);
    setIsScannerOpen(true);
    setTimeout(async () => {
      try {
        const viewport = document.getElementById("external-mobile-viewport");
        if (!viewport) return;

        if (!html5QrCodeRef.current) {
          html5QrCodeRef.current = new Html5Qrcode("external-mobile-viewport");
        }

        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }

        await html5QrCodeRef.current.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (w, h) => {
              const border = Math.min(w, h) * 0.75;
              return { width: border, height: border };
            }
          },
          (decodedText) => {
            processScannedCode(decodedText);
          },
          () => {}
        );
      } catch (err: any) {
        console.error("Camera startup error:", err);
        setScannerError(err.message || "Acesso de câmera recusado ou não suportado.");
        setIsScannerOpen(false);
      }
    }, 300);
  };

  const stopScannerCleanly = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
      } catch (err) {
        console.warn("Scanner stopped uncleanly:", err);
      }
    }
    setIsScannerOpen(false);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-900 text-white flex flex-col items-center justify-center p-6 z-[99999]">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <p className="font-extrabold text-sm uppercase tracking-widest text-slate-400">Estabelecendo Conexão Direta...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="fixed inset-0 bg-slate-900 text-white flex flex-col items-center justify-center p-6 z-[99999] text-center">
        <AlertCircle className="w-16 h-16 text-rose-500 mb-4 animate-bounce" />
        <h3 className="text-xl font-black mb-2">Conexão Interrompida</h3>
        <p className="text-sm text-slate-400 max-w-sm font-medium mb-6">{error || 'Pedido indisponível'}</p>
        {!isExternalLink && (
          <button 
            onClick={onClose}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-widest rounded-2xl transition-all"
          >
            Voltar ao Sistema
          </button>
        )}
      </div>
    );
  }

  const orderLabelsList = order.labels || [];
  const scannedLabelsList = orderLabelsList.filter((l: any) => l.isScanned);
  const scannedPercentage = orderLabelsList.length > 0 
    ? Math.round((scannedLabelsList.length / orderLabelsList.length) * 100) 
    : 0;

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col z-[99999] select-none font-sans overflow-x-hidden">
      {/* Toast Notifications */}
      {notification && (
        <div className={`fixed top-4 left-4 right-4 p-4 rounded-2xl border text-sm font-extrabold shadow-2xl z-[110000] flex items-center gap-3 animate-slide-in ${
          notification.type === 'success' 
            ? 'bg-emerald-950 border-emerald-500/30 text-emerald-300' 
            : notification.type === 'error'
              ? 'bg-rose-950 border-rose-500/30 text-rose-300'
              : 'bg-indigo-950 border-indigo-500/30 text-indigo-300'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />}
          <span>{notification.msg}</span>
        </div>
      )}

      {/* Header */}
      <header className="px-4 py-4 bg-slate-900 border-b border-slate-800 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isExternalLink && (
            <button 
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <span className="text-[9px] font-black uppercase text-blue-500 tracking-widest leading-none">CONFERÊNCIA COMPARTILHADA</span>
            <h1 className="text-base font-black text-white leading-tight">Pedido #{order.id}</h1>
          </div>
        </div>

        <button 
          onClick={() => {
            const nextSound = !soundEnabled;
            setSoundEnabled(nextSound);
            if (nextSound) triggerBeep('success');
          }}
          className={`p-2.5 rounded-xl transition-all border ${
            soundEnabled 
              ? 'bg-blue-950/40 text-blue-400 border-blue-500/20' 
              : 'bg-slate-800/40 text-slate-500 border-slate-700/20'
          }`}
          title={soundEnabled ? "Desativar Sons" : "Ativar Sons"}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
      </header>

      {/* Mobile Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Client details card */}
        <div className="bg-slate-900/60 rounded-3xl p-5 border border-slate-800/60">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">Destinatário</p>
              <h2 className="text-lg font-black text-slate-100 uppercase tracking-tight">{order.clientName}</h2>
            </div>
            <div className="bg-slate-800 border border-slate-700 px-3 py-1 rounded-full text-[10px] font-black text-slate-400 tracking-wider">
              {orderLabelsList.length} FARDOS
            </div>
          </div>

          <div className="h-px.5 bg-slate-800/60 my-4" />

          {/* Progress bar info */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-slate-400">
              <span>Bipagem geral fardos</span>
              <span className="text-blue-400 font-extrabold">{scannedLabelsList.length} de {orderLabelsList.length} ({scannedPercentage}%)</span>
            </div>
            <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 shadow-inner">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${scannedPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Camera Scanner view container */}
        <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden flex flex-col">
          <div className="p-4 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanLine className="w-5 h-5 text-blue-500" />
              <p className="text-xs font-black uppercase text-slate-300 tracking-widest">Leitor de Câmera</p>
            </div>
            {isScannerOpen && (
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            )}
          </div>

          {/* Camera frame area */}
          {isScannerOpen ? (
            <div className="p-4 flex flex-col items-center">
              <div 
                id="external-mobile-viewport" 
                className="w-full aspect-square max-w-[280px] bg-black rounded-2xl border-2 border-slate-700 overflow-hidden shadow-inner relative"
              />
              {scannerError && (
                <p className="text-xs font-bold text-rose-400 text-center mt-3 bg-rose-950/30 p-2.5 rounded-xl border border-rose-500/20">
                  {scannerError}
                </p>
              )}
              <button 
                onClick={stopScannerCleanly}
                className="mt-4 px-6 h-11 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-black uppercase tracking-widest rounded-full transition-all cursor-pointer flex items-center gap-2"
              >
                <X className="w-4 h-4" /> Desligar Câmera
              </button>
            </div>
          ) : (
            <div className="p-6 text-center space-y-3 flex flex-col items-center">
              <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400 border border-slate-700/60 shadow-lg">
                <Camera className="w-8 h-8" />
              </div>
              <p className="text-xs text-slate-400 font-medium px-4">Utilize a câmera principal do fone para scan linear ou de código QR nos fardos.</p>
              <button 
                onClick={startScanner}
                className="h-12 px-6 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-black uppercase tracking-widest rounded-2xl transition-all cursor-pointer flex items-center gap-2 shrink-0 shadow-lg shadow-blue-900/30"
              >
                <Camera className="w-4 h-4" /> Ligar Câmera do Fone
              </button>
            </div>
          )}
        </div>

        {/* Manual Keyboard Entry */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            processScannedCode(manualCode);
          }}
          className="bg-slate-900 p-4 rounded-3xl border border-slate-800 space-y-3"
        >
          <p className="text-xs font-black uppercase text-slate-400 tracking-widest">Digitação de Volume</p>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="Digite o código da etiqueta (ex: ORD40-...)" 
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 focus:border-blue-500 px-4 h-12 rounded-xl text-xs font-bold text-slate-200 outline-none transition-all placeholder:text-slate-600 shadow-inner uppercase"
            />
            <button 
              type="submit"
              disabled={!manualCode.trim() || isProcessing}
              className="h-12 px-5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-black uppercase tracking-widest rounded-xl transition-all text-blue-400 border border-slate-700 font-bold shrink-0 disabled:opacity-40"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Faturar"}
            </button>
          </div>
        </form>

        {/* Last scanned panel */}
        {lastScanned && (
          <div className="bg-emerald-950/30 border border-emerald-500/20 p-4 rounded-3xl flex items-center gap-4 animate-slide-in">
            <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-400/20 rounded-full flex items-center justify-center shrink-0">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[8px] font-black uppercase tracking-wider text-emerald-400 leading-none">ÚLTIMO DETECTADO • {lastScanned.time}</span>
              <p className="text-xs font-black text-white truncate">{lastScanned.productName}</p>
              <p className="text-[10px] text-slate-400 font-semibold truncate leading-tight">Volume #{lastScanned.labelIndex} • {lastScanned.quantity} un</p>
            </div>
          </div>
        )}

        {/* Active Items progress breakdown */}
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Itens no Pedido</p>
          <div className="space-y-3">
            {(order.items || []).map((item: any, idx: number) => {
              const matchedLabels = orderLabelsList.filter((l: any) => l.productId === item.productId);
              const readBales = matchedLabels.filter((l: any) => l.isScanned).length;
              const totalBales = matchedLabels.length;
              const isFinished = readBales >= totalBales && totalBales > 0;
              const unitsPerPack = item.unitsPerPack || 50;
              const currentPacks = Math.ceil((item.finishedQuantity || 0) / unitsPerPack);
              const totalPacks = Math.ceil(item.quantity / unitsPerPack);

              return (
                <div 
                  key={`item-${idx}`}
                  className={`p-4 rounded-2xl border transition-all ${
                    isFinished 
                      ? 'bg-emerald-950/15 border-emerald-500/20 text-emerald-100' 
                      : totalBales === 0 
                        ? 'bg-slate-900/30 border-slate-800/40 text-slate-500'
                        : 'bg-slate-900 border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div>
                      <p className="font-bold text-xs leading-tight">{item.productName}</p>
                      <p className="text-[9px] text-slate-500 font-bold mt-1 uppercase">Dimen: {item.size || '30x40'} • Pedido: {item.quantity} un</p>
                    </div>
                    {isFinished ? (
                      <span className="bg-emerald-500/10 border border-emerald-400/20 text-emerald-400 font-extrabold text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0">
                        Pronto
                      </span>
                    ) : totalBales > 0 ? (
                      <span className="bg-indigo-500/10 border border-indigo-400/20 text-indigo-400 font-extrabold text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0">
                        Bipando
                      </span>
                    ) : (
                      <span className="bg-slate-800 border border-slate-700 text-slate-500 font-extrabold text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0">
                        Sem Etiquetas
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-800/60 text-[10px] font-bold text-slate-400">
                    <div>
                      <span className="block text-[8px] text-slate-500 uppercase font-black">Em fardos</span>
                      <span className={`${isFinished ? 'text-emerald-400' : 'text-slate-300'} font-extrabold`}>
                        {readBales} de {totalBales} fardos
                      </span>
                    </div>
                    <div>
                      <span className="block text-[8px] text-slate-500 uppercase font-black">Em pacotes</span>
                      <span className={`${isFinished ? 'text-emerald-400' : 'text-slate-300'} font-extrabold`}>
                        {currentPacks} de {totalPacks} pct
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Real-time scanning history registry of all labels */}
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Etiquetas Individuais / Volumes</p>
          {orderLabelsList.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 text-center py-6 rounded-3xl">
              <ClipboardList className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-bold">Nenhuma etiqueta de fardo gerada para este pedido.</p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden divide-y divide-slate-800">
              {orderLabelsList.map((lbl: any, idx: number) => {
                return (
                  <div 
                    key={`lbl-${idx}`}
                    className="p-3 flex items-center justify-between text-xs transition-colors"
                  >
                    <div className="min-w-0 pr-2 space-y-0.5">
                      <p className="font-extrabold text-white text-xs sm:text-sm tracking-tight uppercase leading-snug">
                        {lbl.productName || "PRODUTO SOUPLASTIC"}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-semibold mt-0.5">
                        <span>Volume #{lbl.labelIndex} • {lbl.quantity} un</span>
                        {lbl.packsCount && (
                          <span className="bg-slate-800 border border-slate-700/60 text-slate-400 text-[8px] px-1.5 py-0.5 rounded uppercase font-black">
                            {lbl.packsCount} pct
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {lbl.isScanned ? (
                        <div className="flex items-center gap-1.5 text-emerald-400 font-black text-[10px] bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">
                          <Check className="w-3.5 h-3.5" /> BIPADO
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-slate-500 font-bold text-[10px] border border-slate-800 bg-slate-950 px-2 py-0.5 rounded-full">
                          PENDENTE
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Persistent Bottom Bar */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0 text-slate-400 text-[10px] font-bold">
        <span>SOUPLASTIC v1.0</span>
        <span>Conferência de expedição em tempo real</span>
      </footer>
    </div>
  );
};
