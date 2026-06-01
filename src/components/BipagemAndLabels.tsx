import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ScanLine, 
  QrCode, 
  Printer, 
  CheckCircle2, 
  Volume2, 
  VolumeX, 
  ShoppingCart, 
  Plus, 
  Minus, 
  Info, 
  AlertCircle, 
  Trash2, 
  Camera, 
  Save, 
  Package, 
  Box, 
  Check, 
  Loader2,
  RefreshCw,
  Search,
  Filter,
  Layers,
  Sparkles,
  ChevronRight,
  HelpCircle
} from 'lucide-react';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// Interface matching types from App.tsx
interface Product {
  id: string;
  productCode?: number;
  name: string;
  type: string;
  width: number;
  height: number;
  micra: number;
  color: string;
  weightPerThousand: number;
  gestaoClickId?: string;
  materialType?: string;
}

interface OrderItem {
  productId: string;
  productName: string;
  quantity: number; // packages/units requested
  unitPrice: number;
  calculatedWeight: number;
  scannedQuantity?: number; // current scanned packages
  color?: string;
  size?: string;
}

interface Order {
  id: string;
  clientId: string;
  clientName: string;
  items: OrderItem[];
  totalValue: number;
  totalWeight: number;
  status: 'Pendente' | 'Em Produção' | 'Pronto' | 'Expedição' | 'Entregue';
  date: string;
  gestaoClickId?: string;
}

interface StockItem {
  id: string;
  productId?: string;
  name: string;
  quantity: number;
  minQuantity: number;
  supplier: string;
  category: string;
  unit: string;
}

interface BipagemAndLabelsProps {
  orders: Order[];
  products: Product[];
  stock: StockItem[];
  onUpdateItem: (collectionName: string, id: string, data: any) => Promise<any>;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
  logAction: (category: string, description: string, reference?: string) => Promise<any>;
}

export const BipagemAndLabels = ({
  orders,
  products,
  stock,
  onUpdateItem,
  notify,
  logAction
}: BipagemAndLabelsProps) => {
  const [activeSubTab, setActiveSubTab] = useState<'scan' | 'generate'>('scan');
  
  // Audio state
  const [audioFeedback, setAudioFeedback] = useState<boolean>(true);

  // Sound generator
  const playBeepSound = useCallback((type: 'success' | 'warning' | 'error' = 'success') => {
    if (!audioFeedback) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      if (type === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // standard high beep
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.12);
      } else if (type === 'warning') {
        // Double warning beep
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(350, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
        
        setTimeout(() => {
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.type = 'triangle';
          osc2.frequency.setValueAtTime(350, audioCtx.currentTime);
          gain2.gain.setValueAtTime(0.15, audioCtx.currentTime);
          osc2.start();
          osc2.stop(audioCtx.currentTime + 0.1);
        }, 150);
      } else {
        // low error buzz
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(120, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.35);
      }
    } catch (err) {
      console.warn("Failed to generate beep tone:", err);
    }
  }, [audioFeedback]);

  // ==========================================
  // TAB 1: CODE SCANNING & DISPATCH FLIGHTS
  // ==========================================
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [scannedItemsMap, setScannedItemsMap] = useState<{ [productId: string]: number }>({});
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scannerInfo, setScannerInfo] = useState<string>('Nenhuma leitura recente.');
  const [isSavingChanges, setIsSavingChanges] = useState<boolean>(false);
  const [showCelebrationModal, setShowCelebrationModal] = useState<boolean>(false);

  // List filter of active orders (exclude 'Entregue' / fully shipped)
  const activeOrders = orders.filter(o => o.status !== 'Entregue');

  // Load selected order details
  useEffect(() => {
    if (selectedOrderId) {
      const found = orders.find(o => o.id === selectedOrderId);
      if (found) {
        setSelectedOrder(found);
        // Initialize scan progress from what is already saved on DB or default 0
        const initialMap: { [productId: string]: number } = {};
        found.items.forEach(item => {
          initialMap[item.productId] = item.scannedQuantity || 0;
        });
        setScannedItemsMap(initialMap);
        setScannerInfo(`Pedido de ${found.clientName} carregado.`);
      } else {
        setSelectedOrder(null);
        setScannedItemsMap({});
      }
    } else {
      setSelectedOrder(null);
      setScannedItemsMap({});
    }
  }, [selectedOrderId, orders]);

  // HTML5 Camera scanner controls
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const SCANNER_ELEMENT_ID = "qr-scanner-element";

  const stopCameraHandler = useCallback(async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        setScannerInfo("Câmera desligada.");
      } catch (err) {
        console.error("Failed to stop Html5Qrcode helper cleanly:", err);
      }
    }
    setIsScanning(false);
  }, []);

  useEffect(() => {
    // Cleanup scanning element on unmount
    return () => {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        html5QrCodeRef.current.stop().catch(e => console.error(e));
      }
    };
  }, []);

  const handleQRDecode = useCallback(async (decodedText: string) => {
    // Expected format: SOUPLASTIC:PROD:<product_id>:<packages_qty>:<product_name_note>:<optional_serial>
    console.log("Captured QR Code text:", decodedText);
    
    if (!decodedText.startsWith("SOUPLASTIC:PROD:")) {
      playBeepSound('error');
      setScannerInfo("Erro: Código de barras / QR Code inválido ou de outra marca.");
      notify("QR Code não reconhecido como padrão SouPlastic!", "error");
      return;
    }

    try {
      const parts = decodedText.split(":");
      // parts[0] = SOUPLASTIC
      // parts[1] = PROD
      // parts[2] = productId
      // parts[3] = packageQuantity
      // parts[4] = productName
      // parts[5] = optional_serial
      
      const qrProductId = parts[2];
      const qrPackQty = Number(parts[3]) || 20;
      const qrProdName = parts[4] || "Produto";
      const qrSerial = parts[5];

      if (!qrProductId) {
        throw new Error("ID do produto vazio");
      }

      if (!selectedOrder) {
        playBeepSound('warning');
        setScannerInfo(`Lido: ${qrProdName} (${qrPackQty} pct). Selecione um pedido para dar baixa.`);
        notify(`QR Lido (${qrPackQty} pacotes), mas selecione um Pedido primeiro para faturar!`, "info");
        return;
      }

      // Check if this product is in the active order items list
      // Note: check standard ID match or gestaoClickId fallback matching
      const foundItem = selectedOrder.items.find(item => 
        item.productId === qrProductId || 
        (products.find(p => p.id === item.productId)?.id === qrProductId)
      );

      if (!foundItem) {
        playBeepSound('error');
        setScannerInfo(`Produto lido "${qrProdName}" não faz parte deste pedido!`);
        notify(`Atenção: O item "${qrProdName}" não consta no pedido selecionado!`, "error");
        return;
      }

      // EXCLUSIVE REGISTERED QR CODE DUPLICATE VALIDATION
      if (qrSerial) {
        try {
          const docRef = doc(db, 'stock_lot_codes', decodedText);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const lotData = docSnap.data();
            if (lotData.status === 'Bipado' || lotData.status === 'Entregue') {
              playBeepSound('error');
              setScannerInfo(`Fardo DUPLICADO! Serial ${qrSerial} já foi bipado anteriormente!`);
              notify(`Erro: Este fardo de ${qrProdName} (Serial #${qrSerial}) já foi bipado anteriormente e faturado!`, "error");
              return;
            }
            
            // Mark as bipado in database
            await updateDoc(docRef, {
              status: 'Bipado',
              scannedOrderId: selectedOrder.id,
              scannedAt: new Date().toISOString()
            });
            console.log(`Fardo unique QR registrado como Bipado no Firestore: #${qrSerial}`);
          } else {
            playBeepSound('warning');
            notify(`Aviso: Serial #${qrSerial} lido, mas não consta como pré-registrado no lote do sistema.`, "info");
          }
        } catch (dbErr) {
          console.error("Firestore checking lot error:", dbErr);
        }
      }

      const currentBipCount = scannedItemsMap[foundItem.productId] || 0;
      const targetQty = foundItem.quantity;
      const newBipCount = currentBipCount + qrPackQty;

      // Update local state map
      setScannedItemsMap(prev => ({
        ...prev,
        [foundItem.productId]: newBipCount
      }));

      if (newBipCount > targetQty) {
        playBeepSound('warning');
        setScannerInfo(`Bipagem Excedente! Lido +${qrPackQty} de "${foundItem.productName}" (${newBipCount}/${targetQty} pacotes)`);
        notify(`Atenção: Bipagem ultrapassou o volume do pedido (+${newBipCount - targetQty} pacotes)`, "info");
      } else {
        playBeepSound('success');
        setScannerInfo(`Sucesso: Bipado +${qrPackQty} de "${foundItem.productName}" (${newBipCount}/${targetQty} pacotes)`);
        notify(`Registrado: +${qrPackQty} pacotes para "${foundItem.productName}"`, "success");
      }

    } catch (err: any) {
      playBeepSound('error');
      setScannerInfo(`Erro ao decodificar QR Code: ${err.message || err}`);
    }
  }, [selectedOrder, scannedItemsMap, products, notify, playBeepSound]);

  const startCameraHandler = async () => {
    setIsScanning(true);
    setScannerInfo("Inicializando câmera do tablet...");
    
    // Quick timeout delay to allow DOM render of scanner element
    setTimeout(async () => {
      try {
        if (!html5QrCodeRef.current) {
          html5QrCodeRef.current = new Html5Qrcode(SCANNER_ELEMENT_ID);
        }

        await html5QrCodeRef.current.start(
          { facingMode: "environment" }, // prefer back camera
          {
            fps: 10,
            qrbox: (width, height) => {
              const borderSize = Math.min(width, height) * 0.75;
              return { width: borderSize, height: borderSize };
            }
          },
          (decodedText) => {
            handleQRDecode(decodedText);
          },
          (errorMessage) => {
            // quiet feedback loop on scan updates
          }
        );
        setScannerInfo("Câmera ativa. Aponte para o QR Code em cima do fardo.");
      } catch (err: any) {
        console.error("Camera startup error:", err);
        setScannerInfo(`Falha de câmera: ${err.message || "Verifique permissões de vídeo."}`);
        setIsScanning(false);
        notify("Não foi possível acessar a câmera. Verifique as permissões do tablet.", "error");
      }
    }, 250);
  };

  // Back-up Manuel bip helper for tablets without a solid camera
  const triggerManualBip = (itemProdId: string, customAmount: number) => {
    if (!selectedOrder) return;
    const item = selectedOrder.items.find(i => i.productId === itemProdId);
    if (!item) return;

    const currentQty = scannedItemsMap[itemProdId] || 0;
    const target = item.quantity;
    const nextQty = currentQty + customAmount;

    setScannedItemsMap(prev => ({
      ...prev,
      [itemProdId]: nextQty
    }));

    if (nextQty > target) {
      playBeepSound('warning');
      setScannerInfo(`Manual: Lido +${customAmount} de "${item.productName}" (${nextQty}/${target} pacotes)`);
      notify(`Simulação: Passando da meta original (+${nextQty - target} pacotes)`, "info");
    } else {
      playBeepSound('success');
      setScannerInfo(`Manual: Bipado +${customAmount} de "${item.productName}" (${nextQty}/${target} pacotes)`);
      notify(`Registrado bip manual: +${customAmount} pacotes!`, "success");
    }
  };

  const resetBipCounts = () => {
    if (!selectedOrder) return;
    const clearMap: { [productId: string]: number } = {};
    selectedOrder.items.forEach(item => {
      clearMap[item.productId] = 0;
    });
    setScannedItemsMap(clearMap);
    setScannerInfo("Bipagens zeradas para este faturamento.");
    notify("Contagem de fardos bipados resetada!", "info");
    playBeepSound('warning');
  };

  // Dispatch fully confirmed logic
  const handleFinalizeDispatch = async () => {
    if (!selectedOrder) return;
    
    setIsSavingChanges(true);
    try {
      // 1. Double check weights and packages
      const updatedItems = selectedOrder.items.map(item => {
        const bipCount = scannedItemsMap[item.productId] || 0;
        return {
          ...item,
          scannedQuantity: bipCount
        };
      });

      // Show warnings if any items are under biped but offer to save anyway
      const allDone = updatedItems.every(i => (i.scannedQuantity || 0) >= i.quantity);
      
      // 2. Subtract quantities from physical stock
      // For each item where fardagem/bip packages went out, deduct from stockItem corresponding to productId
      let stockExitsLog = [];

      for (const item of updatedItems) {
        const qtyBiped = item.scannedQuantity || 0;
        if (qtyBiped === 0) continue;

        const matchedStock = stock.find(s => s.productId === item.productId);
        if (matchedStock) {
          const originalStockQty = Number(matchedStock.quantity) || 0;
          // Calculate new stock quantity (ensure we do not go below 0 unless inventory says so)
          const newStockQty = Math.max(0, originalStockQty - qtyBiped);
          
          await onUpdateItem('stock', matchedStock.id, {
            quantity: newStockQty
          });
          stockExitsLog.push(`${item.productName}: -${qtyBiped} pacotes (Estoque anterior: ${originalStockQty} -> Novo: ${newStockQty})`);
        } else {
          // If no specific stock card is assigned/made yet for this product code, we can create a general output
          stockExitsLog.push(`${item.productName}: -${qtyBiped} pacotes (Sem cartão de estoque predefinido)`);
        }
      }

      // Determine final status
      const finalStatus = allDone ? 'Entregue' : 'Expedição';

      // 3. Update the Order document in Firestore
      await onUpdateItem('orders', selectedOrder.id, {
        items: updatedItems,
        status: finalStatus
      });

      // Actions logs persistence
      const descr = `Efetuou expedição e baixa de fardagem para o Pedido do Cliente [${selectedOrder.clientName}], status final: [${finalStatus}]. Saídas de material de estoque:\n${stockExitsLog.join('\n')}`;
      await logAction('Expedição', descr, `Pedido: #${selectedOrder.id}`);

      // Stop camera if still on
      await stopCameraHandler();

      // Celebration popup
      setShowCelebrationModal(true);
      playBeepSound('success');

    } catch (err: any) {
      console.error("Failed to commit dispatch records:", err);
      notify(`Erro ao concluir remessa no Firestore: ${err.message || err}`, "error");
      playBeepSound('error');
    } finally {
      setIsSavingChanges(false);
    }
  };


  // ==========================================
  // TAB 2: LABEL GENERATION SHEET SYSTEM
  // ==========================================
  const [labelProductId, setLabelProductId] = useState<string>('');
  const [packagesPerLabel, setPackagesPerLabel] = useState<number>(20);
  const [numberOfLabels, setNumberOfLabels] = useState<number>(6);
  const [customLabelMemo, setCustomLabelMemo] = useState<string>('CONFERIDO NA EXPEDIÇÃO - EVITE PERDAS');
  
  const [generatedSerials, setGeneratedSerials] = useState<string[]>([]);
  const [isRegisteringQrs, setIsRegisteringQrs] = useState<boolean>(false);
  const [registeredCount, setRegisteredCount] = useState<number>(0);
  
  const [labelProductSelected, setLabelProductSelected] = useState<Product | null>(null);

  // Sizing configuration states (Width/Height in cm, safe padding, fonts, and grid columns)
  const [labelWidthCm, setLabelWidthCm] = useState<number>(5.0);
  const [labelHeightCm, setLabelHeightCm] = useState<number>(3.0);
  const [labelColumns, setLabelColumns] = useState<number>(2);
  const [labelPaddingMm, setLabelPaddingMm] = useState<number>(3.0);
  const [labelFontSize, setLabelFontSize] = useState<number>(11);
  const [labelQrSize, setLabelQrSize] = useState<number>(75);

  // Custom data display toggles to control label metadata fields (Description & Code on, others false by default)
  const [showLabelName, setShowLabelName] = useState<boolean>(true);
  const [showLabelCode, setShowLabelCode] = useState<boolean>(true);
  const [showLabelMaterial, setShowLabelMaterial] = useState<boolean>(false);
  const [showLabelWidth, setShowLabelWidth] = useState<boolean>(false);
  const [showLabelHeight, setShowLabelHeight] = useState<boolean>(false);
  const [showLabelMicra, setShowLabelMicra] = useState<boolean>(false);
  const [showLabelColor, setShowLabelColor] = useState<boolean>(false);
  const [showLabelMemo, setShowLabelMemo] = useState<boolean>(true);
  const [showLabelHeader, setShowLabelHeader] = useState<boolean>(true);
  const [showLabelFooter, setShowLabelFooter] = useState<boolean>(true);

  // BarTender CSV integration exporter - generates a CSV spreadsheet layout which can be easily mapped to BarTender (.btw) master designs
  const handleExportCSVForBarTender = () => {
    if (!labelProductSelected) return;
    try {
      const headers = [
        "SOUPLASTIC_BRAND",
        "PRODUCT_CODE",
        "PRODUCT_NAME",
        "MATERIAL_TYPE",
        "PACKAGES_PER_LABEL",
        "TOTAL_LABELS",
        "LABEL_INDEX",
        "LOT_DATE",
        "MEMO",
        "QR_PAYLOAD"
      ];

      const rows = Array.from({ length: numberOfLabels }).map((_, idx) => {
        const payload = `SOUPLASTIC:PROD:${labelProductSelected.id}:${packagesPerLabel}:${labelProductSelected.name}`;
        return [
          "SOUPLASTIC",
          `#${labelProductSelected.productCode || '---'}`,
          labelProductSelected.name,
          labelProductSelected.materialType || 'HD',
          packagesPerLabel.toString(),
          numberOfLabels.toString(),
          `${idx + 1}/${numberOfLabels}`,
          new Date().toLocaleDateString('pt-BR'),
          customLabelMemo,
          payload
        ];
      });

      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(val => `"${val.replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `etiquetas_bartender_${labelProductSelected.productCode || 'prod'}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      logAction('Exportar', `Exportou CSV do BarTender para ${labelProductSelected.name}`, `Produto: #${labelProductSelected.id}`);
      notify("CSV para BarTender (.btw) exportado com sucesso!", "success");
    } catch (err: any) {
      console.error(err);
      notify("Erro ao exportar arquivo de dados", "error");
    }
  };

  // Raw PPLA text generator for direct printing/file printing on Argox OS-214TT thermal engines
  const handleExportPPLA = () => {
    if (!labelProductSelected) return;
    try {
      const lotDate = new Date().toLocaleDateString('pt-BR');
      const payload = `SOUPLASTIC:PROD:${labelProductSelected.id}:${packagesPerLabel}:${labelProductSelected.name}`;
      
      let ppla = `\x02L\r\nH13\r\nD11\r\n`; // Start of format, high-heat, scaling ratios
      ppla += `111100000100020SOUPLASTIC\r\n`;
      ppla += `111100000250020${labelProductSelected.name.substring(0, 30).toUpperCase()}\r\n`;
      ppla += `111100000450020COD: #${labelProductSelected.productCode || '---'}\r\n`;
      ppla += `111100000600020LOTACOES: ${packagesPerLabel} PACOTES\r\n`;
      ppla += `111100000750020LOTE: ${lotDate}\r\n`;
      ppla += `111100000900020${customLabelMemo.substring(0, 32).toUpperCase()}\r\n`;
      ppla += `191100401200250${payload}\r\n`; // raw payload representation
      ppla += `Q0001\r\n`; // Quantity label output
      ppla += `E\r\n`;     // Finish and feed

      const blob = new Blob([ppla], { type: "text/plain;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `codigo_direto_argox_${labelProductSelected.productCode || 'prod'}.txt`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      logAction('Exportar PPLA', `Exportou arquivo de comando PPLA físico para ${labelProductSelected.name}`, `Produto: #${labelProductSelected.id}`);
      notify("Comando PPLA baixado! Pode ser enviado diretamente à porta USB/LPT da impressora Argox.", "success");
    } catch (err: any) {
      console.error(err);
      notify("Erro ao gerar script PPLA", "error");
    }
  };

  // Population hook to automatically generate unique physical batch serial keys
  useEffect(() => {
    if (labelProductSelected && numberOfLabels > 0) {
      const serials = Array.from({ length: numberOfLabels }).map(() => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let res = '';
        for (let j = 0; j < 8; j++) {
          res += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return res;
      });
      setGeneratedSerials(serials);
      setRegisteredCount(0);
    } else {
      setGeneratedSerials([]);
      setRegisteredCount(0);
    }
  }, [labelProductSelected, numberOfLabels, packagesPerLabel]);

  const registerQrsInFirestore = async () => {
    if (!labelProductSelected || generatedSerials.length === 0) return;
    setIsRegisteringQrs(true);
    try {
      let registered = 0;
      for (let i = 0; i < generatedSerials.length; i++) {
        const serial = generatedSerials[i];
        const payload = `SOUPLASTIC:PROD:${labelProductSelected.id}:${packagesPerLabel}:${labelProductSelected.name}:${serial}`;
        
        await setDoc(doc(db, 'stock_lot_codes', payload), {
          qrCode: payload,
          serial: serial,
          productId: labelProductSelected.id,
          productName: labelProductSelected.name,
          productCode: labelProductSelected.productCode || '---',
          packagesQuantity: packagesPerLabel,
          status: 'Aguardando',
          printedAt: new Date().toISOString(),
          scannedOrderId: ''
        });
        registered++;
      }
      setRegisteredCount(registered);
      notify(`${registered} fardos / QR Codes exclusivos registrados no banco!`, "success");
      logAction('Estoque', `Registrou ${registered} QR Codes exclusivos para ${labelProductSelected.name}`, `Produto: #${labelProductSelected.id}`);
    } catch (err: any) {
      console.error(err);
      notify("Erro ao salvar fardos no banco de dados.", "error");
    } finally {
      setIsRegisteringQrs(false);
    }
  };

  useEffect(() => {
    if (labelProductId) {
      const found = products.find(p => p.id === labelProductId);
      setLabelProductSelected(found || null);
    } else {
      setLabelProductSelected(null);
    }
  }, [labelProductId, products]);

  // Hook to render QR Code on canvases
  const labelRefs = useRef<{ [key: string]: HTMLCanvasElement | null }>({});

  useEffect(() => {
    if (activeSubTab === 'generate' && labelProductSelected && generatedSerials.length === numberOfLabels) {
      // Loop over the total labels array and draw clean high def QR Code values
      for (let i = 0; i < numberOfLabels; i++) {
        const canvasId = `label-canvas-${i}`;
        const canvas = labelRefs.current[canvasId];
        if (canvas) {
          const serial = generatedSerials[i] || '00000000';
          // QR Content payload: SOUPLASTIC:PROD:<productId>:<packages_qty>:<productName>:<serial>
          const payload = `SOUPLASTIC:PROD:${labelProductSelected.id}:${packagesPerLabel}:${labelProductSelected.name}:${serial}`;
          QRCode.toCanvas(canvas, payload, {
            width: 130,
            margin: 1,
            color: {
              dark: '#0f172a', // deep slate
              light: '#ffffff'
            }
          }, (err) => {
            if (err) console.error("Error drawing QR on canvas:", err);
          });
        }
      }
    }
  }, [activeSubTab, labelProductSelected, packagesPerLabel, numberOfLabels, generatedSerials]);

  const triggerPrintLabels = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      
      {/* Dynamic inline stylesheet to print only the labels sheet when printing */}
      <style>{`
        @media print {
          /* Setup page dimensions matching the physical Argox label dimensions and columns count */
          @page {
            size: ${labelWidthCm * labelColumns}cm ${labelHeightCm}cm;
            margin: 0 !important;
          }
          
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: ${labelWidthCm * labelColumns}cm !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Hide all general UI blocks of the platform */
          body * {
            visibility: hidden;
            background: transparent !important;
          }

          /* Show only the targeted print element and its children */
          #print-labels-sheet-area, #print-labels-sheet-area * {
            visibility: visible;
          }

          #print-labels-sheet-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: ${labelWidthCm * labelColumns}cm !important;
            display: grid !important;
            grid-template-columns: repeat(${labelColumns}, ${labelWidthCm}cm) !important;
            gap: 0 !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .no-print {
            display: none !important;
          }

          .physical-label-sticker {
            width: ${labelWidthCm}cm !important;
            height: ${labelHeightCm}cm !important;
            padding: ${labelPaddingMm}mm !important;
            box-sizing: border-box !important;
            border: 1px dashed rgba(0,0,0,0.15) !important; /* Soft indicator border */
            background: white !important;
            color: black !important;
            box-shadow: none !important;
            margin: 0 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            position: relative !important;
          }
        }
      `}</style>

      {/* Outer Banner Row */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#111c26] p-6 rounded-3xl text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-blue-400 font-extrabold uppercase text-[10px] tracking-[0.2em] mb-1">
            <Sparkles size={12} />
            <span>Saída de Carga Inteligente</span>
          </div>
          <h2 className="text-xl font-black uppercase tracking-tight">Expedição Pró e Etiquetas QR</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Bipe fardos com a câmera do tablet para abater pedidos automaticamente, controlar inventários e gerar etiquetas de rastreamento de estoque.
          </p>
        </div>

        {/* Audio feedback button */}
        <button
          type="button"
          onClick={() => {
            setAudioFeedback(!audioFeedback);
            playBeepSound('success');
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
            audioFeedback 
              ? 'bg-emerald-600/30 text-emerald-400 ring-2 ring-emerald-500/20' 
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          {audioFeedback ? <Volume2 size={16} /> : <VolumeX size={16} />}
          <span>{audioFeedback ? "Beep Ativo" : "Silenciado"}</span>
        </button>
      </div>

      {/* Tabs Menu Header Row */}
      <div className="flex gap-2 p-1.5 bg-slate-100/80 backdrop-blur rounded-2xl w-fit">
        <button
          onClick={() => {
            stopCameraHandler();
            setActiveSubTab('scan');
          }}
          className={`flex items-center gap-3 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            activeSubTab === 'scan' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <ScanLine size={16} />
          <span>Bipar e dar baixa</span>
        </button>

        <button
          onClick={() => {
            stopCameraHandler();
            setActiveSubTab('generate');
          }}
          className={`flex items-center gap-3 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            activeSubTab === 'generate' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <QrCode size={16} />
          <span>Gerar Etiquetas</span>
        </button>
      </div>


      {/* VIEW 1: EXPEDITION WORKFLOW */}
      {activeSubTab === 'scan' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          
          {/* Active selection of active order */}
          <div className="xl:col-span-8 space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-50 pb-4">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <ShoppingCart size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800">Selecione o faturamento em aberto</h3>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Apenas pedidos pendentes de entrega</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Pedido para Processar</label>
                  <select
                    className="w-full h-12 p-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-xs focus:ring-2 focus:ring-blue-100 outline-none transition-all cursor-pointer"
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                  >
                    <option value="">-- SELECIONE ESTE PEDIDO DE EXPEDIÇÃO --</option>
                    {activeOrders.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.clientName} - Pedido #{o.id} ({o.date}) [R$ {Number(o.totalValue || 0).toFixed(2)}]
                      </option>
                    ))}
                  </select>
                </div>

                {selectedOrder ? (
                  <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-50 flex items-center justify-between text-xs font-bold text-blue-800">
                    <div className="flex gap-2 items-center">
                      <Info size={16} />
                      <span>Progresso atual será deduzido em estoque físico assim que concluir!</span>
                    </div>
                    <button
                      type="button"
                      onClick={resetBipCounts}
                      className="text-red-600 hover:underline hover:text-red-700 bg-transparent text-[10px] uppercase font-black tracking-widest"
                    >
                      Limpar Bips
                    </button>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-100">
                    <HelpCircle size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-xs font-bold">Por favor, escolha um faturamento acima para iniciar a conferência automática da carga.</p>
                  </div>
                )}
              </div>

              {selectedOrder && (
                <div className="space-y-6">
                  {/* Items List inside Pedido */}
                  <div>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-1">Materiais deste pedido</h4>
                    <div className="border border-slate-50 rounded-2xl overflow-hidden shadow-inner">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <th className="p-4">Produto</th>
                            <th className="p-4 text-center">Pedido original</th>
                            <th className="p-4 text-right">Confirmado (Bipado)</th>
                            <th className="p-4 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                          {selectedOrder.items.map(item => {
                            const biped = scannedItemsMap[item.productId] || 0;
                            const target = item.quantity;
                            const isMet = biped >= target;
                            const pct = Math.min(100, Math.round((biped / target) * 100));
                            
                            return (
                              <tr key={item.productId} className="hover:bg-slate-50/50 transition-all">
                                <td className="p-4">
                                  <p className="font-extrabold text-slate-800">{item.productName}</p>
                                  <p className="text-[9px] text-slate-400 font-extrabold tracking-tighter uppercase mb-2">
                                    Cor: {item.color || 'Padrão'} | Embalagem: {item.size || '---'}
                                  </p>
                                  
                                  {/* Progress bar */}
                                  <div className="w-48 bg-slate-100 h-1.5 rounded-full overflow-hidden border border-slate-50">
                                    <div 
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        biped > target ? 'bg-amber-500' :
                                        isMet ? 'bg-emerald-500' : 'bg-blue-600'
                                      }`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </td>
                                
                                <td className="p-4 text-center text-slate-500 font-extrabold">
                                  {target} <span className="text-[9px] font-black text-slate-450 uppercase pl-0.5">pacotes</span>
                                </td>
                                
                                <td className="p-4 text-right bg-slate-50/20">
                                  <span className={`text-sm font-black ${isMet ? 'text-emerald-600' : 'text-blue-600'}`}>
                                    {biped}
                                  </span>
                                  <span className="text-slate-450 text-[10px] ml-1 font-extrabold">/ {target}</span>
                                </td>
                                
                                <td className="p-4 text-center">
                                  {biped > target ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 bg-amber-50 text-amber-700 rounded-full text-[9px] font-black uppercase tracking-wider">
                                      <Info size={10} /> Excesso
                                    </span>
                                  ) : isMet ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 bg-emerald-50 text-emerald-700 rounded-full text-[9px] font-black uppercase tracking-wider">
                                      <CheckCircle2 size={10} /> Ok
                                    </span>
                                  ) : biped > 0 ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 bg-blue-50 text-blue-700 rounded-full text-[9px] font-black uppercase tracking-wider">
                                      Carregando
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2 bg-slate-100 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-wider">
                                      Aguardando bips
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Manual Bypass Board for Tablet Operators */}
                  <div className="bg-slate-50 rounded-3xl p-5 border border-slate-100 space-y-4">
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-slate-500" />
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">Simulador / Bipador manual do tablet</h4>
                    </div>
                    <p className="text-xs text-slate-400 font-semibold leading-relaxed">
                      Caso o sol de fora ou a câmera do seu tablet prejudique a leitura ótica, use os cliques abaixo para dar entrada rápida de fardos (bip manual).
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      {selectedOrder.items.map(item => (
                        <div key={item.productId} className="bg-white rounded-2xl p-3 shadow-sm border border-slate-100 flex flex-col justify-between gap-2.5">
                          <span className="text-xs font-black text-slate-850 truncate max-w-full">{item.productName}</span>
                          <div className="flex gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => triggerManualBip(item.productId, 20)}
                              className="h-8 px-2.5 bg-blue-50 text-blue-600 hover:bg-blue-100 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all"
                            >
                              +20 Pacotes
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerManualBip(item.productId, 50)}
                              className="h-8 px-2.5 bg-slate-900 text-white hover:bg-black text-[10px] font-black uppercase tracking-wider rounded-xl transition-all"
                            >
                              +50 Pacotes
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerManualBip(item.productId, 1)}
                              className="h-8 px-2 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-bold rounded-xl transition-all"
                              title="Adiciona 1 pacote"
                            >
                              +1
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Complete Action Buttons */}
                  <div className="flex gap-4 pt-4 border-t border-slate-50">
                    <button
                      type="button"
                      disabled={isSavingChanges}
                      onClick={handleFinalizeDispatch}
                      className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-100 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                    >
                      {isSavingChanges ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Gravando faturamento...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={18} />
                          <span>Finalizar Expedição & Baixar Estoque</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>


          {/* Tablet Camera scanning view */}
          <div className="xl:col-span-4 space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                <div className="flex items-center gap-2">
                  <Camera size={18} className="text-slate-500" />
                  <h3 className="font-extrabold text-slate-800">Câmera de Bipagem</h3>
                </div>
                
                {isScanning && (
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                  </span>
                )}
              </div>

              {/* Real HTML5 camera preview div inside UI */}
              <div className="relative overflow-hidden bg-[#0d151c] rounded-2xl aspect-square flex items-center justify-center border-4 border-slate-900 shadow-inner">
                <div id={SCANNER_ELEMENT_ID} className="absolute inset-0 w-full h-full object-cover"></div>
                
                {!isScanning && (
                  <div className="relative z-10 text-center p-6 space-y-4">
                    <div className="mx-auto w-14 h-14 bg-slate-800/80 rounded-full flex items-center justify-center border-2 border-slate-700 text-slate-400 animate-pulse">
                      <ScanLine size={24} />
                    </div>
                    <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed font-semibold">
                      Pronto para ler fardos de sacolas via Leitor Ótico.
                    </p>
                    <button
                      type="button"
                      onClick={startCameraHandler}
                      className="h-10 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-[10px] uppercase tracking-wider shadow-lg shadow-blue-900/50 transition-all"
                    >
                      Ligar Câmera do Tablet
                    </button>
                  </div>
                )}

                {isScanning && (
                  <div className="absolute bottom-4 left-4 right-4 z-20 flex justify-center">
                    <button
                      type="button"
                      onClick={stopCameraHandler}
                      className="h-9 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-[10px] uppercase tracking-wider shadow-lg transition-all"
                    >
                      Desligar Câmera
                    </button>
                  </div>
                )}
              </div>

              {/* Feedback status notes */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 font-bold">
                <p className="text-[9px] uppercase font-black text-slate-400 tracking-wider mb-1">Status da Leitura</p>
                <div className="flex items-start gap-2.5">
                  <Info size={14} className="text-indigo-500 mt-0.5" />
                  <p className="text-xs text-slate-700 leading-relaxed font-semibold break-all">
                    {scannerInfo}
                  </p>
                </div>
              </div>

              {/* Instructions memo */}
              <div className="p-4 bg-blue-50/20 text-slate-500 rounded-2xl border border-blue-100/30 text-xs text-[11px] leading-relaxed font-semibold space-y-2">
                <p className="font-extrabold text-blue-800 uppercase text-[9px] tracking-wider">Como funciona o código de alta precisão:</p>
                <p>1. O QR Code das etiquetas fatiadas define que cada leitura representa 20, 50 ou mais sacolas de acordo com o fardo.</p>
                <p>2. Ao bipar, se bater o volume total de fardos, o sistema valida-o em verde. Se passar um pouco, continuará somando e alertará em amarelo.</p>
              </div>
            </div>
          </div>

        </div>
      )}


      {/* VIEW 2: LABELS GENERATION SHEETS DRAWERS */}
      {activeSubTab === 'generate' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          
          {/* Settings panel to write label data */}
          <div className="xl:col-span-4 space-y-6 no-print">
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-50 pb-4">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <Printer size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800">Modelador de Etiquetas</h3>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Ajuste de fardagem para Argox e BarTender</p>
                </div>
              </div>

              <div className="space-y-4 font-bold text-slate-700">
                {/* Product Dropdown Selector */}
                <div className="space-y-1">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Produto Base</label>
                  <select
                    className="w-full h-11 p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:ring-1 focus:ring-blue-500 outline-none transition-all cursor-pointer"
                    value={labelProductId}
                    onChange={(e) => setLabelProductId(e.target.value)}
                  >
                    <option value="">-- SELECIONE O PRODUTO CATALOGADO --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} #{p.productCode} ({p.type})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Multiplying packets counts represent on single tag */}
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Pacotes por QR</label>
                    <input
                      type="number"
                      min={1}
                      className="w-full h-11 p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                      value={packagesPerLabel}
                      onChange={(e) => setPackagesPerLabel(Number(e.target.value) || 20)}
                    />
                  </div>

                  {/* Quantity labels will be printed to stick on packages */}
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1 font-extrabold">Total de Etiquetas</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="w-full h-11 p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                      value={numberOfLabels}
                      onChange={(e) => setNumberOfLabels(Number(e.target.value) || 1)}
                    />
                  </div>
                </div>

                {/* Additional Memo Info lines */}
                <div className="space-y-1">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Inscrição de Expedição (Nota Fiscal/Memo)</label>
                  <input
                    type="text"
                    className="w-full h-11 p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="Ex: CONFERIDO NA EXPEDIÇÃO"
                    value={customLabelMemo}
                    onChange={(e) => setCustomLabelMemo(e.target.value)}
                  />
                </div>

                {/* ADVANCED: PHYSICAL SIZING WORKPLACE FOR ARGOX */}
                <div className="space-y-3 pt-4 border-t border-slate-105 bg-slate-50/50 -mx-6 px-6 py-4 rounded-b-xl">
                  <p className="text-[10px] font-black text-blue-800 tracking-wider uppercase">⚙️ Dimensões Físicas Extrusoras / Argox</p>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Largura (cm)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="2"
                        max="20"
                        className="w-full h-10 p-2 bg-white border border-slate-200 rounded-lg text-xs"
                        value={labelWidthCm}
                        onChange={(e) => setLabelWidthCm(Number(e.target.value) || 5.0)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Altura (cm)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="2"
                        max="20"
                        className="w-full h-10 p-2 bg-white border border-slate-200 rounded-lg text-xs"
                        value={labelHeightCm}
                        onChange={(e) => setLabelHeightCm(Number(e.target.value) || 3.0)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Colunas (Bobina)</label>
                      <select
                        className="w-full h-10 p-2 bg-white border border-slate-200 rounded-lg text-xs"
                        value={labelColumns}
                        onChange={(e) => setLabelColumns(Number(e.target.value) || 2)}
                      >
                        <option value={1}>1 Coluna</option>
                        <option value={2}>2 Colunas (Ex: Argox)</option>
                        <option value={3}>3 Colunas</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Margem Borda (mm)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="10"
                        className="w-full h-10 p-2 bg-white border border-slate-200 rounded-lg text-xs"
                        value={labelPaddingMm}
                        onChange={(e) => setLabelPaddingMm(Number(e.target.value) || 3.0)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest font-extrabold">Tamanho Fonte (px)</label>
                      <input
                        type="number"
                        min="8"
                        max="24"
                        className="w-full h-10 p-2 bg-white border border-slate-200 rounded-lg text-xs"
                        value={labelFontSize}
                        onChange={(e) => setLabelFontSize(Number(e.target.value) || 11)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Tamanho QR (px)</label>
                      <input
                        type="number"
                        step="5"
                        min="40"
                        max="150"
                        className="w-full h-10 p-2 bg-white border border-slate-200 rounded-lg text-xs"
                        value={labelQrSize}
                        onChange={(e) => setLabelQrSize(Number(e.target.value) || 75)}
                      />
                    </div>
                  </div>
                </div>

                {/* ADVANCED: INFORMATIONS TO SHOW IN LABEL (Toggles) */}
                <div className="space-y-3 pt-3 border-t border-slate-100 font-bold">
                  <p className="text-[10px] font-black text-slate-400 tracking-wider uppercase">📋 Informações Contidas na Etiqueta</p>
                  
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-slate-605 text-[11px] font-bold">
                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelName} onChange={e => setShowLabelName(e.target.checked)} className="rounded border-slate-200 text-blue-650 focus:ring-blue-500" />
                      <span>Nome/Descrição</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelCode} onChange={e => setShowLabelCode(e.target.checked)} className="rounded border-slate-200 text-blue-650 focus:ring-blue-500" />
                      <span>Código Prod.</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelMaterial} onChange={e => setShowLabelMaterial(e.target.checked)} className="rounded border-slate-200 text-blue-650 focus:ring-blue-500" />
                      <span>Material (Mat)</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelWidth} onChange={e => setShowLabelWidth(e.target.checked)} className="rounded border-slate-200 text-blue-655 focus:ring-blue-500" />
                      <span>Largura</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelHeight} onChange={e => setShowLabelHeight(e.target.checked)} className="rounded border-slate-200 text-blue-655 focus:ring-blue-500" />
                      <span>Altura</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelMicra} onChange={e => setShowLabelMicra(e.target.checked)} className="rounded border-slate-200 text-blue-655 focus:ring-blue-500" />
                      <span>Micra/Esp.</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelColor} onChange={e => setShowLabelColor(e.target.checked)} className="rounded border-slate-200 text-blue-655 focus:ring-blue-500" />
                      <span>Cor</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelMemo} onChange={e => setShowLabelMemo(e.target.checked)} className="rounded border-slate-200 text-blue-655 focus:ring-blue-500" />
                      <span>Anotação/Memo</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelHeader} onChange={e => setShowLabelHeader(e.target.checked)} className="rounded border-slate-200 text-blue-655 focus:ring-blue-500" />
                      <span>Cabeçalho S.P</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
                      <input type="checkbox" checked={showLabelFooter} onChange={e => setShowLabelFooter(e.target.checked)} className="rounded border-slate-200 text-blue-655 focus:ring-blue-500" />
                      <span>Rodapé Lote</span>
                    </label>
                  </div>
                </div>

                {/* ACTION PRINT AND EXPORT BUTTONS */}
                {labelProductSelected && (
                  <div className="space-y-2 pt-4 border-t border-slate-100">
                    {registeredCount > 0 ? (
                      <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-center border border-emerald-100 flex items-center justify-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-600" />
                        <span className="text-xs font-black uppercase tracking-tight">
                          {registeredCount} QR Codes Registrados!
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={registerQrsInFirestore}
                        disabled={isRegisteringQrs}
                        className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-100 disabled:opacity-50"
                      >
                        {isRegisteringQrs ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>Registrando...</span>
                          </>
                        ) : (
                          <>
                            <QrCode size={16} />
                            <span>Registrar fardos no Sistema</span>
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={triggerPrintLabels}
                      className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-100"
                    >
                      <Printer size={16} />
                      <span>Imprimir Etiquetas (Web)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportCSVForBarTender}
                      className="w-full h-11 bg-slate-800 hover:bg-slate-950 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <QrCode size={16} />
                      <span>Exportar Dados (.btw BarTender)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportPPLA}
                      className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Sparkles size={16} />
                      <span>Exportar PPLA Direto Argox</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>


          {/* Printable layouts of labels sheets grid */}
          <div className="xl:col-span-8 space-y-4">
            <div className="bg-slate-100/50 rounded-3xl p-6 border border-slate-200/50 shadow-inner">
              <div className="flex justify-between items-center mb-4 border-b border-slate-200 pb-3 no-print">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Painel de Calibração e Margens de Segurança</p>
                  <p className="text-[10px] text-slate-500 font-bold mt-0.5">O pontilhado indica a borda física real. A linha vermelha interna representa a margem de segurança configurada.</p>
                </div>
                {labelProductSelected && (
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-extrabold rounded-full px-2.5 py-1">
                    {numberOfLabels} fardos selecionados
                  </span>
                )}
              </div>

              {labelProductSelected ? (
                <div className="overflow-auto max-h-[750px] p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div 
                    id="print-labels-sheet-area" 
                    className="grid gap-3 p-1 bg-white justify-center"
                    style={{
                      gridTemplateColumns: `repeat(${labelColumns}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from({ length: numberOfLabels }).map((_, idx) => (
                      <div
                        key={idx}
                        className="physical-label-sticker bg-white flex flex-col justify-between relative text-slate-900 border"
                        style={{
                          width: `${labelWidthCm}cm`,
                          height: `${labelHeightCm}cm`,
                          padding: `${labelPaddingMm}mm`,
                          fontSize: `${labelFontSize}px`,
                          borderColor: 'rgba(0,0,0,0.18)',
                          borderStyle: 'dashed',
                          boxSizing: 'border-box',
                        }}
                      >
                        {/* Safe edge red alignment box visualization helper for printer calibers in preview (NOT printed thanks to no-print inside CSS or absolute style) */}
                        <div 
                          className="absolute pointer-events-none border border-red-500/25 rounded no-print"
                          style={{
                            top: `${labelPaddingMm}mm`,
                            left: `${labelPaddingMm}mm`,
                            right: `${labelPaddingMm}mm`,
                            bottom: `${labelPaddingMm}mm`,
                          }}
                        />

                        {/* Brand Header */}
                        {showLabelHeader && (
                          <div 
                            className="flex justify-between items-center border-b border-slate-950 pb-0.5 uppercase font-bold"
                            style={{ fontSize: `${Math.max(8, labelFontSize - 3)}px` }}
                          >
                            <div>
                              <span className="font-extrabold tracking-tight text-slate-950">
                                SOUPLASTIC
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-extrabold bg-slate-950 text-white rounded px-1 text-[8px] tracking-wider">
                                F {idx + 1}/{numberOfLabels}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Content details rows of label */}
                        <div className="flex gap-2 items-center flex-1 py-1" style={{ overflow: 'hidden' }}>
                          <div className="flex-1 space-y-0.5 text-xs min-w-0">
                            {showLabelName && (
                              <p 
                                className="font-black uppercase text-slate-900 leading-tight"
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  fontSize: `${labelFontSize}px`,
                                }}
                              >
                                {labelProductSelected.name}
                              </p>
                            )}
                            
                            <div 
                              className="grid grid-cols-1 gap-y-0.5 text-slate-600 font-bold uppercase"
                              style={{ fontSize: `${Math.max(8, labelFontSize - 2.5)}px` }}
                            >
                              {showLabelCode && (
                                <p className="truncate">Cód: <span className="text-slate-950 font-black">#{labelProductSelected.productCode || '---'}</span></p>
                              )}
                              {showLabelMaterial && labelProductSelected.materialType && (
                                <p className="truncate">Mat: <span className="text-slate-950 font-black">{labelProductSelected.materialType}</span></p>
                              )}
                              {showLabelWidth && labelProductSelected.width && (
                                <p className="truncate">Larg: <span className="text-slate-950 font-black">{labelProductSelected.width}cm</span></p>
                              )}
                              {showLabelHeight && labelProductSelected.height && (
                                <p className="truncate">Alt: <span className="text-slate-950 font-black">{labelProductSelected.height}cm</span></p>
                              )}
                              {showLabelMicra && labelProductSelected.micra && (
                                <p className="truncate">Mic: <span className="text-slate-950 font-black">{labelProductSelected.micra}</span></p>
                              )}
                              {showLabelColor && labelProductSelected.color && (
                                <p className="truncate">Cor: <span className="text-slate-950 font-black">{labelProductSelected.color}</span></p>
                              )}
                            </div>
                            
                            {showLabelMemo && customLabelMemo && (
                              <div className="bg-slate-50 border border-slate-200/60 p-0.5 rounded text-left">
                                <p 
                                  className="font-black text-slate-600 tracking-tighter uppercase leading-none truncate" 
                                  style={{ fontSize: `${Math.max(7, labelFontSize - 3.5)}px` }}
                                >
                                  {customLabelMemo}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Generated QR Code pixel canvas block */}
                          <div className="flex flex-col items-center flex-shrink-0">
                            <div className="border border-slate-200 p-0.5 rounded bg-white">
                              <canvas
                                ref={(el) => {
                                  if (el) {
                                    labelRefs.current[`label-canvas-${idx}`] = el;
                                  }
                                }}
                                style={{
                                  width: `${labelQrSize}px`,
                                  height: `${labelQrSize}px`,
                                }}
                              />
                            </div>
                            
                            {/* Elegant and highly legible product details right below the QR code card */}
                            <p 
                              className="font-black text-slate-950 uppercase tracking-tighter text-center leading-[1.05] mt-1 mb-0.5 px-0.5"
                              style={{ 
                                fontSize: `${Math.max(7, labelFontSize - 3.5)}px`,
                                maxInlineSize: `${labelWidthCm ? (labelWidthCm * 0.42) : 2.5}cm`,
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {labelProductSelected.name}
                            </p>

                            <span 
                              className="font-black text-slate-500 uppercase tracking-widest mt-0.5 leading-none"
                              style={{ fontSize: `${Math.max(7, labelFontSize - 4)}px` }}
                            >
                              {packagesPerLabel} PCT
                            </span>
                            <span 
                              className="font-black text-rose-600 uppercase tracking-tight mt-0.5 leading-none"
                              style={{ fontSize: `${Math.max(6, labelFontSize - 4.5)}px` }}
                            >
                              #{generatedSerials[idx] || '---'}
                            </span>
                          </div>
                        </div>

                        {/* Barcode bottom metadata details */}
                        {showLabelFooter && (
                          <div 
                            className="border-t border-slate-950 pt-0.5 flex justify-between items-center font-bold text-slate-500 uppercase leading-none"
                            style={{ fontSize: `${Math.max(7, labelFontSize - 4)}px` }}
                          >
                            <span>LOTE: {new Date().toLocaleDateString('pt-BR')}</span>
                            <span className="text-slate-950 font-black">EXPEDIÇÃO</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-10 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
                  <Printer size={32} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-xs font-bold">A visualização das etiquetas aparecerá aqui após selecionar um produto base no formulário à esquerda.</p>
                </div>
              )}
            </div>
          </div>

        </div>
      )}


      {/* FULL STATE CONGRATULATION MODAL */}
      {showCelebrationModal && selectedOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]" onClick={() => setShowCelebrationModal(false)}>
          <div 
            className="bg-white rounded-[32px] p-8 max-w-sm w-full shadow-2xl border border-slate-100 flex flex-col items-center text-center overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-18 h-18 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center mb-5 ring-12 ring-emerald-500/10">
              <CheckCircle2 className="w-10 h-10 animate-bounce" />
            </div>

            <h3 className="text-xl font-black text-slate-800 tracking-tight mb-2 uppercase">
              Saída Confirmada!
            </h3>
            
            <p className="text-slate-500 text-xs mb-6 leading-relaxed px-1">
              Faturamento concluído com êxito para <strong className="text-slate-800">{selectedOrder.clientName}</strong>. 
              Os saldos das caixas de fardagem foram abatidos corretamente no estoque fisíco da SouPlastic.
            </p>

            <button
              onClick={() => {
                setShowCelebrationModal(false);
                setSelectedOrderId('');
              }}
              className="w-full h-12 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all active:scale-95 cursor-pointer"
            >
              Fechar Expedição
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
