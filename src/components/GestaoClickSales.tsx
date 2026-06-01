import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, 
  Plus, 
  Loader2, 
  Search, 
  Filter, 
  ChevronRight, 
  Calendar, 
  Package, 
  User, 
  DollarSign,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Building2,
  Tag,
  ArrowRight,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { gestaoClickService, GestaoClickVenda } from '../services/gestaoClickService';
import { Client, Product, OrderItem, UserProfile } from '../App';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface GestaoClickSalesProps {
  notify: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  formatMoney: (val: number) => string;
  onCreateOrder?: (orderData: {
    clientId: string;
    clientName: string;
    items: OrderItem[];
    sellerName?: string;
    situation?: string;
    deliveryDate?: string;
    salesChannel?: string;
    gestaoClickId?: string;
    quoteId?: string;
  }, skipSyncConfig?: { skipSync?: boolean; customOrderId?: string }) => Promise<void>;
  preselectedClientId?: string | null;
  onClearPreselectedClient?: () => void;
  preselectedItems?: any[] | null;
  onClearPreselectedItems?: () => void;
  preselectedQuoteId?: string | null;
  onClearPreselectedQuoteId?: () => void;
  onRequestClientSelect?: () => void;
  clients?: Client[];
  products?: Product[];
  initialView?: 'list' | 'create';
  onViewChange?: (view: 'list' | 'create') => void;
  currentProfile?: UserProfile | null;
  onSuccessCreated?: () => void;
  onCancel?: () => void;
}

export const GestaoClickSales: React.FC<GestaoClickSalesProps> = ({ 
  notify, 
  formatMoney,
  onCreateOrder,
  preselectedClientId,
  onClearPreselectedClient,
  preselectedItems,
  onClearPreselectedItems,
  preselectedQuoteId,
  onClearPreselectedQuoteId,
  onRequestClientSelect,
  clients = [],
  products = [],
  initialView = 'list',
  onViewChange,
  currentProfile,
  onSuccessCreated,
  onCancel
}) => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    active: boolean;
    percentage: number;
    message: string;
    stage: 'client' | 'items' | 'venda' | 'local' | 'success' | 'error';
    errorDetails?: string;
  }>({
    active: false,
    percentage: 0,
    message: '',
    stage: 'client'
  });
  const [view, setViewInternal] = useState<'list' | 'create'>(initialView);
  const [isPackageSale, setIsPackageSale] = useState<boolean>(false);
  const [unitsPerPackage, setUnitsPerPackage] = useState<number>(50);

  const isClientLocked = !!preselectedClientId;

  const setView = (v: 'list' | 'create') => {
    setViewInternal(v);
    onViewChange?.(v);
    if (v === 'list') {
      onClearPreselectedClient?.();
      onClearPreselectedItems?.();
      onClearPreselectedQuoteId?.();
      setClientSearch('');
      setIsPackageSale(false);
      setUnitsPerPackage(50);
      setNewVenda(prev => ({
        ...prev,
        cliente_id: undefined,
        itens: []
      }));
    }
  };

  useEffect(() => {
    setViewInternal(initialView);
    if (initialView === 'list') {
      onClearPreselectedClient?.();
      onClearPreselectedItems?.();
      onClearPreselectedQuoteId?.();
      setIsPackageSale(false);
      setUnitsPerPackage(50);
    }
  }, [initialView]);

  useEffect(() => {
    if (preselectedClientId) {
      setNewVenda(prev => ({
        ...prev,
        cliente_id: preselectedClientId
      }));
      setViewInternal('create');
    }
  }, [preselectedClientId]);

  useEffect(() => {
    if (preselectedItems && preselectedItems.length > 0) {
      setNewVenda(prev => ({
        ...prev,
        itens: preselectedItems
      }));
      const firstWithPkg = preselectedItems.find(it => it.isConvertedFromPackage);
      if (firstWithPkg) {
        setIsPackageSale(true);
        if (firstWithPkg.unitsPerPackage) {
          setUnitsPerPackage(firstWithPkg.unitsPerPackage);
        }
      } else {
        setIsPackageSale(false);
      }
      setViewInternal('create');
    }
  }, [preselectedItems]);
  const [search, setSearch] = useState('');
  
  // Data from GestãoClick
  const [sales, setSales] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [servicos, setServicos] = useState<any[]>([]);
  const [situacoes, setSituacoes] = useState<any[]>([]);
  const [lojas, setLojas] = useState<any[]>([]);
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [centrosCustos, setCentrosCustos] = useState<any[]>([]);
  const [formasPagamento, setFormasPagamento] = useState<any[]>([]);
  const [planosContas, setPlanosContas] = useState<any[]>([]);

  // Calculate default delivery date (20 days from now)
  const getDefaultDeliveryDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 20);
    return d.toISOString().split('T')[0];
  };

  // Form State
  const [newVenda, setNewVenda] = useState<Partial<GestaoClickVenda>>({
    tipo: 'venda',
    data: new Date().toISOString().split('T')[0],
    prazo_entrega: getDefaultDeliveryDate(),
    condicao_pagamento: 'a_vista',
    tipo_desconto: 'R$',
    valor_desconto: 0,
    itens: [],
    forma_pagamento_id: undefined,
    numero_parcelas: 1,
    intervalo_dias: 30,
    data_primeira_parcela: new Date().toISOString().split('T')[0]
  });

  const [selectedItem, setSelectedItem] = useState<{
    id: number;
    nome: string;
    valor: number;
    tipo: 'produto' | 'servico';
  } | null>(null);

  const [itemQty, setItemQty] = useState<string>('1');
  const [itemValue, setItemValue] = useState<string>('0');
  const [itemDiscount, setItemDiscount] = useState<string>('0');
  const [itemDiscountType, setItemDiscountType] = useState<'R$' | '%'>('R$');

  // Search autocomplete states
  const [itemSearch, setItemSearch] = useState('');
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);
  const [filteredItems, setFilteredItems] = useState<any[]>([]);

  // Client search states
  const [clientSearch, setClientSearch] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [filteredClients, setFilteredClients] = useState<any[]>([]);

  // Fallback payment methods from user request
  const defaultPaymentMethods = [
    { id: 1, nome: "A Combinar" },
    { id: 2, nome: "Boleto Bancário" },
    { id: 3, nome: "Boleto Inter" },
    { id: 4, nome: "Boleto Santander" },
    { id: 5, nome: "Carnê" },
    { id: 6, nome: "Cartão de Crédito" },
    { id: 7, nome: "Cartão de Débito" },
    { id: 8, nome: "Cheque" },
    { id: 9, nome: "Devolução de Mercadorias" },
    { id: 10, nome: "Dinheiro à Vista" },
    { id: 11, nome: "Dinheiro Parcelado" },
    { id: 12, nome: "Duplicata Mercantil" },
    { id: 13, nome: "Pagar na entrega" },
    { id: 14, nome: "PIX" },
    { id: 15, nome: "Transferência Bancária" }
  ];

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    const prods = products || [];
    if (!itemSearch.trim()) {
      // If search is empty, show the 100 most recent items from our catalog
      const sortedProds = [...prods].sort((a, b) => {
        const codeA = Number(a.productCode) || 0;
        const codeB = Number(b.productCode) || 0;
        return codeB - codeA;
      });
      const combinedList: any[] = sortedProds.map(lp => ({
        id: lp.gestaoClickId ? String(lp.gestaoClickId) : `local-${lp.id}`,
        nome: lp.name,
        valor_venda: '0.00',
        tipo: 'produto' as const,
        isLocal: true,
        localId: lp.id
      }));
      setFilteredItems(combinedList.slice(0, 100));
      return;
    }

    // Advanced search normalization
    const normalizeText = (text: any): string => {
      if (!text) return '';
      return text.toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .toLowerCase()
        .replace(/[()\-.,xX/]/g, " ") // Replace parenthesis, dashes, commas, dots, xs, and slashes with space
        .replace(/\s+/g, " ") // Collapse spaces
        .trim();
    };

    const queryNorm = normalizeText(itemSearch);
    const queryTokens = queryNorm.split(' ').filter(Boolean);

    if (queryTokens.length === 0) {
      setFilteredItems([]);
      return;
    }

    const matchedLocalProds = prods.filter(p => {
      // Build a comprehensive indexable/searchable text representation of the product
      const parts: string[] = [
        p.name || '',
        p.productCode ? String(p.productCode) : '',
        p.productCode ? `#${p.productCode}` : '',
        p.color || '',
        p.type || '',
        p.materialType || '',
        p.printDescription || '',
        p.printName || ''
      ];

      if (p.width) parts.push(String(p.width));
      if (p.height) parts.push(String(p.height));
      if (p.micra) {
        parts.push(String(p.micra));
        parts.push(String(p.micra).replace('.', ''));
      }

      // Combinations of dimensions to allow inverted queries (e.g., width x height or height x width)
      if (p.width && p.height) {
        parts.push(`${p.width}x${p.height}`);
        parts.push(`${p.height}x${p.width}`);
      }

      const productTextNorm = normalizeText(parts.join(' '));

      // Every word in query must be present in target searchable text
      return queryTokens.every(qToken => productTextNorm.includes(qToken));
    });

    // Sort matching products:
    // 1. Exact Name/Code match gets priority
    // 2. Otherwise sort by productCode descending (newest first)
    const sortedMatchedList = [...matchedLocalProds].sort((a, b) => {
      const aNameNorm = normalizeText(a.name);
      const bNameNorm = normalizeText(b.name);
      const isExactA = aNameNorm.includes(queryNorm);
      const isExactB = bNameNorm.includes(queryNorm);
      
      if (isExactA && !isExactB) return -1;
      if (!isExactA && isExactB) return 1;

      const codeA = Number(a.productCode) || 0;
      const codeB = Number(b.productCode) || 0;
      return codeB - codeA;
    });

    const combinedList: any[] = sortedMatchedList.map(lp => ({
      id: lp.gestaoClickId ? String(lp.gestaoClickId) : `local-${lp.id}`,
      nome: lp.name,
      valor_venda: '0.00',
      tipo: 'produto' as const,
      isLocal: true,
      localId: lp.id
    }));

    // Allow displaying up to 100 matching items
    setFilteredItems(combinedList.slice(0, 100));
  }, [itemSearch, products]);

  useEffect(() => {
    // Filter local platform clients (clients prop) matching search query with robust normalization
    const normalizeStr = (str: string) => {
      return (str || '')
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    };

    const query = normalizeStr(clientSearch);
    const queryTerms = query.split(/\s+/).filter(Boolean);

    const matchedLocal = clients.filter(c => {
      if (!query) return true;

      const cName = normalizeStr(c.name || '');
      const cFantasy = normalizeStr(c.fantasyName || '');
      const cCnpj = (c.cnpj || '').replace(/\D/g, '');
      const cleanQuery = query.replace(/\D/g, '');

      const textMatch = queryTerms.length > 0 && queryTerms.every(term => 
        cName.includes(term) || 
        cFantasy.includes(term)
      );
      
      const cnpjMatch = !!(cleanQuery && cCnpj.includes(cleanQuery));

      return textMatch || cnpjMatch;
    });

    const combinedList = matchedLocal.map(lc => ({
      id: `local-${lc.id}`,
      nome: lc.fantasyName && lc.fantasyName !== lc.name ? `${lc.name} (${lc.fantasyName})` : lc.name,
      cpf_cnpj: lc.cnpj || '',
      isLocal: true,
      localId: lc.id
    }));

    setFilteredClients(combinedList.slice(0, 15));
  }, [clientSearch, clients]);

  // Automated delivery date calculation (20 days from current sale date)
  useEffect(() => {
    if (newVenda.data) {
      try {
        const parts = newVenda.data.split('-');
        if (parts.length === 3) {
          const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
          d.setDate(d.getDate() + 20);
          const formatted = d.toISOString().split('T')[0];
          setNewVenda(prev => {
            if (prev.prazo_entrega !== formatted) {
               return { ...prev, prazo_entrega: formatted };
            }
            return prev;
          });
        }
      } catch (e) {
        console.error("Error setting automated delivery date:", e);
      }
    }
  }, [newVenda.data]);

  // Match the logged in profile name (Lucas/Veronica/etc.) case-insensitively with GestãoClick's seller names
  useEffect(() => {
    if (funcionarios.length > 0 && currentProfile?.name) {
      const pName = currentProfile.name.toLowerCase().trim();
      const matched = funcionarios.find(f => {
        const fName = f.nome.toLowerCase().trim();
        return fName.includes(pName) || pName.includes(fName);
      });
      if (matched) {
        setNewVenda(prev => {
          if (prev.vendedor_id !== matched.id) {
            return { ...prev, vendedor_id: matched.id };
          }
          return prev;
        });
      }
    }
  }, [funcionarios, currentProfile]);

  // Set default situation to "Em andamento" automatically
  useEffect(() => {
    if (situacoes.length > 0) {
      const matched = situacoes.find(s => s.nome.toLowerCase().includes('andamento'));
      if (matched) {
        setNewVenda(prev => {
          if (prev.situacao_id !== matched.id) {
            return { ...prev, situacao_id: matched.id };
          }
          return prev;
        });
      }
    }
  }, [situacoes]);

  // Set default Cost Center to "Matriz" or "Filial 1" based on selected client's tax regime and company type
  useEffect(() => {
    if (centrosCustos.length > 0) {
      const selectedId = newVenda.cliente_id ? String(newVenda.cliente_id) : '';
      const cleanId = selectedId.startsWith('local-') ? selectedId.replace('local-', '') : selectedId;
      const clientObj = clients.find(c => c.id === cleanId || (c.gestaoClickId && String(c.gestaoClickId) === selectedId));

      const isFilial = clientObj && (
        clientObj.taxRegime === 'Lucro Presumido' || 
        clientObj.taxRegime === 'Real' || 
        clientObj.taxRegime === 'Lucro Real' || 
        clientObj.companyType === 'Filial'
      );

      let matched = null;
      if (isFilial) {
        // Find Filial 1
        matched = centrosCustos.find(cc => (cc.nome || '').toLowerCase().includes('filial'));
      } else {
        // Find Matriz
        matched = centrosCustos.find(cc => (cc.nome || '').toLowerCase().includes('matriz'));
      }

      // Fallback
      if (!matched) {
        matched = centrosCustos.find(cc => (cc.nome || '').toLowerCase().includes('matriz')) || centrosCustos[0];
      }

      if (matched) {
        setNewVenda(prev => {
          if (prev.centro_custo_id !== matched.id) {
            return { ...prev, centro_custo_id: matched.id };
          }
          return prev;
        });
      }
    }
  }, [newVenda.cliente_id, centrosCustos, clients]);

  // Set default store/sales channel (loja) to Matriz, and switch to Filial only if client tax profile is marked as "Filial", Lucro Presumido, or Lucro Real
  useEffect(() => {
    if (lojas.length > 0) {
      const selectedId = newVenda.cliente_id ? String(newVenda.cliente_id) : '';
      const cleanId = selectedId.startsWith('local-') ? selectedId.replace('local-', '') : selectedId;
      const clientObj = clients.find(c => c.id === cleanId || (c.gestaoClickId && String(c.gestaoClickId) === selectedId));
      
      const isFilial = clientObj && (
        clientObj.taxRegime === 'Lucro Presumido' || 
        clientObj.taxRegime === 'Real' || 
        clientObj.taxRegime === 'Lucro Real' || 
        clientObj.companyType === 'Filial'
      );
      
      let targetLoja = null;
      if (isFilial) {
        // Find Filial loja
        targetLoja = lojas.find(l => (l.nome || '').toLowerCase().includes('filial'));
      } else {
        // Find Matriz loja
        targetLoja = lojas.find(l => (l.nome || '').toLowerCase().includes('matriz'));
      }

      // Fallback
      if (!targetLoja) {
        targetLoja = lojas.find(l => (l.nome || '').toLowerCase().includes('matriz')) || lojas[0];
      }

      if (targetLoja) {
        const idToSet = parseInt(targetLoja.id || targetLoja.loja_id);
        if (idToSet && newVenda.loja_id !== idToSet) {
          setNewVenda(prev => ({ ...prev, loja_id: idToSet }));
        }
      }
    }
  }, [newVenda.cliente_id, lojas, clients]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [cliRes, prodRes, servRes, sitRes, lojRes, funcRes, ccRes, fpRes, pcRes] = await Promise.allSettled([
        gestaoClickService.getClientes(),
        gestaoClickService.getProdutos(),
        gestaoClickService.getServicos(),
        gestaoClickService.getSituacoesVendas(),
        gestaoClickService.getLojas(),
        gestaoClickService.getFuncionarios(),
        gestaoClickService.getCentrosCustos(),
        gestaoClickService.getFormasPagamento(),
        gestaoClickService.getPlanosContas()
      ]);

      const getD = (r: any) => r.status === 'fulfilled' ? (r.value.data || []) : [];

      setClientes(getD(cliRes));
      setProdutos(getD(prodRes));
      setServicos(getD(servRes));
      
      const currentSituacoes = getD(sitRes);
      setSituacoes(currentSituacoes);
      
      setLojas(getD(lojRes));
      setFuncionarios(getD(funcRes));
      setCentrosCustos(getD(ccRes));
      
      const ways = getD(fpRes);
      const finalWays = ways.length > 0 ? ways : defaultPaymentMethods;
      setFormasPagamento(finalWays);
      
      const accounts = getD(pcRes);
      setPlanosContas(accounts);

      const salesRes = await fetch('/api/gestaoclick/vendas/');
      if (salesRes.ok) {
        const data = await salesRes.json();
        setSales(data.data || []);
      }

      // Pre-select "Dinheiro à Vista" as default payment method and "Vendas de produtos" as account plan
      const defaultFp = finalWays.find((fp: any) => {
        const item = fp.FormasPagamento || fp;
        const nome = String(item.nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return nome.includes("dinheiro a vista") || nome.includes("dinheiro");
      });

      const defaultPc = accounts.find((pc: any) => 
        String(pc.nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("vendas de produtos") ||
        String(pc.nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("venda de produto") ||
        String(pc.nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("venda")
      );

      let defaultSitId = undefined;
      const foundSit = currentSituacoes.find((s: any) => s.nome?.toLowerCase().includes('andamento'));
      if (foundSit) {
        defaultSitId = foundSit.situacao_id || foundSit.id;
      }

      setNewVenda(prev => {
        let fpId = prev.forma_pagamento_id;
        if (defaultFp) {
          const item = defaultFp.FormasPagamento || defaultFp;
          fpId = Number(item.forma_pagamento_id || item.id);
        }
        return {
          ...prev,
          situacao_id: defaultSitId ? Number(defaultSitId) : prev.situacao_id,
          forma_pagamento_id: fpId || 3013236, // fallback to active 3013236
          plano_contas_id: defaultPc ? Number(defaultPc.plano_contas_id || defaultPc.id) : prev.plano_contas_id
        };
      });
    } catch (error) {
      console.error(error);
      setFormasPagamento(defaultPaymentMethods);
      notify('Alguns dados não puderam ser carregados, usando padrões.', 'info');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    if (!selectedItem) {
      notify('Selecione um produto ou serviço', 'warning');
      return;
    }

    const qtyNum = parseFloat(itemQty);
    const valNum = parseFloat(itemValue);
    const discNum = parseFloat(itemDiscount);

    const newItem = {
      [selectedItem.tipo === 'produto' ? 'produto_id' : 'servico_id']: selectedItem.id,
      quantidade: isNaN(qtyNum) ? 1 : qtyNum,
      valor_unitario: isNaN(valNum) ? 0 : valNum,
      valor_desconto: isNaN(discNum) ? 0 : discNum,
      tipo_desconto: itemDiscountType,
      nome: selectedItem.nome // For UI
    };

    setNewVenda(prev => ({
      ...prev,
      itens: [...(prev.itens || []), newItem as any]
    }));

    setSelectedItem(null);
    setItemQty('1');
    setItemValue('0');
    setItemDiscount('0');
  };

  const handleRemoveItem = (index: number) => {
    setNewVenda(prev => ({
      ...prev,
      itens: (prev.itens || []).filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async () => {
    if (!newVenda.cliente_id || !newVenda.situacao_id || (newVenda.itens || []).length === 0) {
      notify('Preencha os campos obrigatórios (Cliente, Situação e Itens)', 'warning');
      return;
    }

    setSubmitting(true);
    setSyncProgress({
      active: true,
      percentage: 5,
      message: 'Iniciando integração com o GestãoClick...',
      stage: 'client'
    });

    try {
      // Helper to format dates - the GET shows YYYY-MM-DD
      const formatDateStr = (date: string) => {
        if (!date) return "";
        return date;
      };

      // 1. Resolve local/GestãoClick ID for client
      let resolvedClienteId = String(newVenda.cliente_id);
      let clientToUse: Client | undefined = undefined;

      if (resolvedClienteId.startsWith('local-') || !/^\d+$/.test(resolvedClienteId)) {
        const localId = resolvedClienteId.startsWith('local-') ? resolvedClienteId.replace('local-', '') : resolvedClienteId;
        const localClient = clients.find(c => c.id === localId);
        if (!localClient) {
          throw new Error('Cliente local não encontrado nas configurações');
        }
        clientToUse = localClient;

        if (localClient.gestaoClickId) {
          resolvedClienteId = localClient.gestaoClickId;
          setSyncProgress(prev => ({
            ...prev,
            percentage: 15,
            message: `Cliente "${localClient.name}" já resolvido com ID no ERP.`
          }));
        } else {
          setSyncProgress(prev => ({
            ...prev,
            percentage: 10,
            message: `Buscando vínculo para o cliente "${localClient.name}" no GestãoClick...`
          }));
          try {
            const apiRes = await gestaoClickService.getClientes();
            const matchedGC = (apiRes.data || []).find((c: any) => 
              (c.cnpj && localClient.cnpj && c.cnpj.replace(/\D/g, '') === localClient.cnpj.replace(/\D/g, '')) ||
              (c.nome && c.nome.toLowerCase() === localClient.name.toLowerCase())
            );
            
            if (matchedGC) {
              resolvedClienteId = String(matchedGC.id || matchedGC.cliente_id);
              // Save linkage to Firestore for future using static imports
              try {
                await updateDoc(doc(db, 'clients', localClient.id), { gestaoClickId: resolvedClienteId });
              } catch (fsErr) {
                console.error("Failed to persist client gestaoClickId in Firestore:", fsErr);
              }
              setSyncProgress(prev => ({
                ...prev,
                percentage: 18,
                message: `Cliente "${localClient.name}" vinculado com sucesso!`
              }));
            } else {
              // Automatically register client via GestãoClick API!
              setSyncProgress(prev => ({
                ...prev,
                percentage: 12,
                message: `Cadastrando cliente "${localClient.name}" automaticamente no GestãoClick...`
              }));
              
              const cleanedCdpCnpj = (localClient.cnpj || '').replace(/\D/g, '');
              const tipoPessoa = cleanedCdpCnpj.length <= 11 ? 'PF' : 'PJ';
              
              const formatCpf = (val: string) => {
                const d = val.replace(/\D/g, '');
                if (d.length !== 11) return val;
                return `${d.substring(0,3)}.${d.substring(3,6)}.${d.substring(6,9)}-${d.substring(9)}`;
              };
              const formatCnpj = (val: string) => {
                const d = val.replace(/\D/g, '');
                if (d.length !== 14) return val;
                return `${d.substring(0,2)}.${d.substring(2,5)}.${d.substring(5,8)}/${d.substring(8,12)}-${d.substring(12)}`;
              };

              const clientPayload: any = {
                tipo_pessoa: tipoPessoa,
                nome: localClient.name,
                razao_social: localClient.fantasyName || localClient.name,
                cnpj: tipoPessoa === 'PJ' ? formatCnpj(localClient.cnpj || '') : '',
                cpf: tipoPessoa === 'PF' ? formatCpf(localClient.cnpj || '') : '',
                telefone: localClient.phone || '',
                celular: localClient.mobilePhone || '',
                email: localClient.email || '',
                ativo: '1',
              };

              // Address fields if present in localClient
              if (localClient.street || localClient.cep || localClient.zipCode || localClient.city || localClient.state) {
                clientPayload.enderecos = [
                  {
                    endereco: {
                      cep: (localClient.cep || localClient.zipCode || '').replace(/\D/g, ''),
                      logradouro: localClient.street || '',
                      numero: localClient.number || '',
                      complemento: localClient.complement || '',
                      bairro: localClient.neighborhood || '',
                      nome_cidade: localClient.city || '',
                      estado: localClient.state || ''
                    }
                  }
                ];
              }

              console.log("Auto-registering GestaoClick client payload:", clientPayload);
              const createRes = await gestaoClickService.createCliente(clientPayload);
              
              const returnedId = createRes?.data?.id || createRes?.data?.cliente_id || createRes?.id || createRes?.cliente_id;

              if (returnedId) {
                resolvedClienteId = String(returnedId);
                // Save linkage to Firestore with configured static export
                try {
                  await updateDoc(doc(db, 'clients', localClient.id), { gestaoClickId: resolvedClienteId });
                } catch (fsErr) {
                  console.error("Failed to persist created client gestaoClickId in Firestore:", fsErr);
                }
                setSyncProgress(prev => ({
                  ...prev,
                  percentage: 18,
                  message: `Cliente "${localClient.name}" cadastrado no ERP com sucesso!`
                }));
              } else {
                throw new Error("Resposta inválida do cadastro de clientes.");
              }
            }
          } catch (errSearch: any) {
            console.error("Error linking/creating client:", errSearch);
            throw new Error(`Erro ao vincular/cadastrar cliente no GestãoClick: ${errSearch.message || errSearch}`);
          }
        }
      } else {
        clientToUse = clients.find(c => c.gestaoClickId && String(c.gestaoClickId) === resolvedClienteId);
      }

      // 2. Resolve local/GestãoClick IDs for items
      setSyncProgress(prev => ({
        ...prev,
        percentage: 20,
        stage: 'items',
        message: 'Resolvendo vínculos dos produtos no ERP...'
      }));

      const resolvedItens = [];
      const itemArray = newVenda.itens || [];
      const totalItensCount = itemArray.length;

      for (let index = 0; index < totalItensCount; index++) {
        const item = itemArray[index];
        const resolvedItem = { ...item };
        const itemIndexLabel = `(${index + 1}/${totalItensCount})`;

        const basePct = Math.round(20 + (index / totalItensCount) * 55);
        const nextBasePct = Math.round(20 + ((index + 0.5) / totalItensCount) * 55);
        const endPct = Math.round(20 + ((index + 1) / totalItensCount) * 55);

        if (resolvedItem.produto_id && (String(resolvedItem.produto_id).startsWith('local-') || !/^\d+$/.test(String(resolvedItem.produto_id)))) {
          const localProdId = String(resolvedItem.produto_id).startsWith('local-') ? String(resolvedItem.produto_id).replace('local-', '') : String(resolvedItem.produto_id);
          const localProd = products.find(p => p.id === localProdId);
          if (localProd) {
            if (localProd.gestaoClickId) {
              resolvedItem.produto_id = Number(localProd.gestaoClickId);
              setSyncProgress(prev => ({ 
                ...prev, 
                percentage: endPct, 
                message: `Produto "${localProd.name}" já integrado ${itemIndexLabel}.` 
              }));
            } else {
              setSyncProgress(prev => ({ 
                ...prev, 
                percentage: basePct, 
                message: `Buscando vínculo para "${localProd.name}" no GestãoClick ${itemIndexLabel}...` 
              }));
              try {
                const matchedGC = await gestaoClickService.findProduto(localProd.name, localProd.productCode);
                
                if (matchedGC) {
                  const gcId = String(matchedGC.id || matchedGC.produto_id);
                  resolvedItem.produto_id = Number(gcId);
                  // Link in Firestore
                  try {
                    await updateDoc(doc(db, 'products', localProd.id), { gestaoClickId: gcId });
                  } catch (fsErr) {
                    console.error("Failed to persist product gestaoClickId in Firestore:", fsErr);
                  }
                  setSyncProgress(prev => ({ 
                    ...prev, 
                    percentage: endPct, 
                    message: `Produto "${localProd.name}" vinculado no ERP ${itemIndexLabel}!` 
                  }));
                } else {
                  // AUTO-REGISTER if not found on ERP!
                  setSyncProgress(prev => ({ 
                    ...prev, 
                    percentage: nextBasePct, 
                    message: `Produto "${localProd.name}" cadastrando no ERP ${itemIndexLabel}...` 
                  }));
                  const createPayload = {
                    nome: localProd.name,
                    codigo_interno: String(localProd.productCode || localProd.id || Date.now()),
                    ativo: "1",
                    valor_custo: "0.01",
                    valor_venda: String(item.valor_unitario || 0.01),
                    ncm: (localProd.ncm || "39232190").replace(/\D/g, '')
                  };
                  const gcNewProdRes = await gestaoClickService.createProduto(createPayload);
                  const newGcId = String(gcNewProdRes?.data?.id || gcNewProdRes?.data?.produto_id || gcNewProdRes?.id || gcNewProdRes?.data?.produto?.id);
                  if (newGcId && newGcId !== "undefined") {
                    resolvedItem.produto_id = Number(newGcId);
                    try {
                      await updateDoc(doc(db, 'products', localProd.id), { gestaoClickId: newGcId });
                    } catch (fsErr) {
                      console.error("Failed to persist product gestaoClickId in Firestore:", fsErr);
                    }
                    setSyncProgress(prev => ({ 
                      ...prev, 
                      percentage: endPct, 
                      message: `Produto "${localProd.name}" cadastrado e vinculado no ERP ${itemIndexLabel}!` 
                    }));
                  } else {
                    throw new Error(`O produto "${localProd.name}" não pôde ser cadastrado automaticamente. Cadastre no ERP.`);
                  }
                }
              } catch (errSearch: any) {
                console.error("Error searching/creating product in GC:", errSearch);
                throw new Error(`Erro no ERP ao vincular/cadastrar produto "${localProd.name}": ${errSearch.message || errSearch}`);
              }
            }
          } else {
            // This is a custom or temporary product (e.g., "local-custom" or edited text in UI)
            const customName = resolvedItem.nome || "Produto Personalizado";
            setSyncProgress(prev => ({ 
              ...prev, 
              percentage: basePct, 
              message: `Buscando vínculo para item personalizado "${customName}" ${itemIndexLabel}...` 
            }));
            try {
              const matchedGC = await gestaoClickService.findProduto(customName);
              if (matchedGC) {
                const gcId = String(matchedGC.id || matchedGC.produto_id);
                resolvedItem.produto_id = Number(gcId);
                setSyncProgress(prev => ({ 
                  ...prev, 
                  percentage: endPct, 
                  message: `Produto personalizado "${customName}" vinculado com sucesso ${itemIndexLabel}!` 
                }));
              } else {
                setSyncProgress(prev => ({ 
                  ...prev, 
                  percentage: nextBasePct, 
                  message: `Item "${customName}" não localizado. Cadastrando automaticamente ${itemIndexLabel}...` 
                }));
                const createPayload = {
                  nome: customName,
                  codigo_interno: "custom-" + Date.now(),
                  ativo: "1",
                  valor_custo: "0.01",
                  valor_venda: String(resolvedItem.valor_unitario || item.valor_unitario || 0.01),
                  ncm: "39232190" // default plastic bags and sacks NCM since name is SouPlastic
                };
                const gcNewProdRes = await gestaoClickService.createProduto(createPayload);
                const newGcId = String(gcNewProdRes?.data?.id || gcNewProdRes?.data?.produto_id || gcNewProdRes?.id || gcNewProdRes?.data?.produto?.id);
                if (newGcId && newGcId !== "undefined") {
                  resolvedItem.produto_id = Number(newGcId);
                  setSyncProgress(prev => ({ 
                    ...prev, 
                    percentage: endPct, 
                    message: `Produto personalizado "${customName}" cadastrado e vinculado ${itemIndexLabel}!` 
                  }));
                } else {
                  throw new Error(`O produto personalizado "${customName}" não pôde ser cadastrado automaticamente. Cadastre-o no ERP.`);
                }
              }
            } catch (errSearch: any) {
              console.error("Error searching/creating custom product in GC:", errSearch);
              throw new Error(`Erro do ERP ao vincular/cadastrar item "${customName}": ${errSearch.message || errSearch}`);
            }
          }
        }

        if (resolvedItem.servico_id && (String(resolvedItem.servico_id).startsWith('local-') || !/^\d+$/.test(String(resolvedItem.servico_id)))) {
          const serviceName = resolvedItem.nome || '';
          setSyncProgress(prev => ({ 
            ...prev, 
            percentage: basePct, 
            message: `Buscando vínculo para o serviço "${serviceName}" ${itemIndexLabel}...` 
          }));
          try {
            const apiRes = await gestaoClickService.getServicos();
            const matchedGC = (apiRes.data || []).find((s: any) => 
              s.nome && s.nome.toLowerCase() === serviceName.toLowerCase()
            );
            if (matchedGC) {
              resolvedItem.servico_id = Number(matchedGC.id || matchedGC.servico_id);
              setSyncProgress(prev => ({ 
                ...prev, 
                percentage: endPct, 
                message: `Serviço "${serviceName}" resolvido no ERP ${itemIndexLabel}!` 
              }));
            } else {
              throw new Error(`O serviço "${serviceName}" não está cadastrado ou vinculado no GestãoClick. Cadastre-o no ERP primeiro.`);
            }
          } catch (errSearch: any) {
            console.error("Error searching service in GC:", errSearch);
            throw new Error(`Erro ao vincular serviço "${serviceName}": ${errSearch.message || errSearch}`);
          }
        }

        resolvedItens.push(resolvedItem);
      }

      // Create separated structures as per the GET example
      const produtosPayload: any[] = [];
      const servicosPayload: any[] = [];

      resolvedItens.forEach(item => {
        if (item.produto_id) {
          produtosPayload.push({
            produto: {
              produto_id: String(item.produto_id),
              quantidade: String(item.quantidade),
              valor_venda: String(item.valor_unitario),
              tipo_desconto: item.tipo_desconto === '%' ? '%' : 'R$',
              desconto_valor: item.tipo_desconto === 'R$' ? String(item.valor_desconto || 0) : "0.00",
              desconto_porcentagem: item.tipo_desconto === '%' ? String(item.valor_desconto || 0) : "0.00"
            }
          });
        } else if (item.servico_id) {
          servicosPayload.push({
            servico: {
              servico_id: String(item.servico_id),
              quantidade: String(item.quantidade),
              valor_venda: String(item.valor_unitario),
              tipo_desconto: item.tipo_desconto === '%' ? '%' : 'R$',
              desconto_valor: item.tipo_desconto === 'R$' ? String(item.valor_desconto || 0) : "0.00",
              desconto_porcentagem: item.tipo_desconto === '%' ? String(item.valor_desconto || 0) : "0.00"
            }
          });
        }
      });

      // Automatically calculate the next sale number starting from 2300 based on existing sales
      const allCodes = sales.map(s => parseInt(s.codigo)).filter(c => !isNaN(c));
      const nextCode = allCodes.length > 0 ? Math.max(2299, ...allCodes) + 1 : 2300;

      // Clean up the object to match API requirements as per GET example
      const cleanedVenda: any = {
        codigo: String(nextCode),
        cliente_id: String(resolvedClienteId),
        situacao_id: String(newVenda.situacao_id),
        data: formatDateStr(newVenda.data),
        condicao_pagamento: newVenda.condicao_pagamento || 'a_vista',
        situacao_financeiro: "1",
        situacao_estoque: "1",
        produtos: produtosPayload,
        servicos: servicosPayload
      };

      // Global Discount
      if (newVenda.valor_desconto && Number(newVenda.valor_desconto) > 0) {
        cleanedVenda.valor_desconto = String(newVenda.valor_desconto);
        cleanedVenda.tipo_desconto = newVenda.tipo_desconto === '%' ? '%' : 'R$';
      }

      const optNumber = (val: any) => {
        const n = Number(val);
        return !isNaN(n) && n > 0 ? n : null;
      };

      // Map fields to match GET example naming
      if (newVenda.prazo_entrega) cleanedVenda.previsao_entrega = formatDateStr(newVenda.prazo_entrega);
      if (newVenda.observacao) cleanedVenda.observacoes = newVenda.observacao;
      if (newVenda.observacao_interna) cleanedVenda.observacoes_interna = newVenda.observacao_interna;

      const lojId = optNumber(newVenda.loja_id);
      if (lojId) cleanedVenda.loja_id = String(lojId);

      const vendId = optNumber(newVenda.vendedor_id);
      if (vendId) cleanedVenda.vendedor_id = String(vendId);

      const ccId = optNumber(newVenda.centro_custo_id);
      if (ccId) cleanedVenda.centro_custo_id = String(ccId);

      // Payment details - using field names from GET if applicable
      if (newVenda.forma_pagamento_id) {
        cleanedVenda.forma_pagamento_id = String(newVenda.forma_pagamento_id);
        cleanedVenda.numero_parcelas = String(newVenda.numero_parcelas || 1);
        cleanedVenda.intervalo_dias = String(newVenda.intervalo_dias || 30);
        if (newVenda.data_primeira_parcela) {
          cleanedVenda.data_primeira_parcela = formatDateStr(newVenda.data_primeira_parcela);
        }
        cleanedVenda.gerar_financeiro = "sim";
        if (newVenda.plano_contas_id) {
          cleanedVenda.plano_contas_id = String(newVenda.plano_contas_id);
        }
      }

      setSyncProgress(prev => ({ 
        ...prev, 
        percentage: 80, 
        stage: 'venda', 
        message: 'Calculando faturamento e enviando venda para o GestãoClick...' 
      }));

      console.log('Sending Venda to GestãoClick (Nested Mode):', cleanedVenda);
      let response;
      try {
        response = await gestaoClickService.createVenda(cleanedVenda);
      } catch (err: any) {
        const errMsg = String(err.message || "").toLowerCase();
        if (errMsg.includes("cliente_id") || errMsg.includes("id informado") || errMsg.includes("invalido") || errMsg.includes("inválido")) {
          console.warn("Client ID was invalid/stale on GestãoClick. Clearing link and attempting automatic recreation/linkage...");
          if (clientToUse) {
            setSyncProgress(prev => ({ 
              ...prev, 
              percentage: 82, 
              message: 'Código de cliente expirado no ERP. Corrigindo vínculo...' 
            }));
            try {
              // 1. Clear stale link in Firestore
              await updateDoc(doc(db, 'clients', clientToUse.id), { gestaoClickId: "" });
              clientToUse.gestaoClickId = undefined;
            } catch (fsErr) {
              console.error("Error clearing stale gestaoClickId in Firestore:", fsErr);
            }

            // 2. Query GestãoClick for matching client
            const apiRes = await gestaoClickService.getClientes();
            const matchedGC = (apiRes.data || []).find((c: any) => 
              (c.cnpj && clientToUse!.cnpj && c.cnpj.replace(/\D/g, '') === clientToUse!.cnpj.replace(/\D/g, '')) ||
              (c.nome && c.nome.toLowerCase() === clientToUse!.name.toLowerCase())
            );

            let newResolvedId = "";
            if (matchedGC) {
              newResolvedId = String(matchedGC.id || matchedGC.cliente_id);
              try {
                await updateDoc(doc(db, 'clients', clientToUse.id), { gestaoClickId: newResolvedId });
              } catch (fsErr) {
                console.error("Failed to save updated gestaoClickId in Firestore:", fsErr);
              }
              setSyncProgress(prev => ({ 
                ...prev, 
                percentage: 85, 
                message: 'Vínculo do cliente atualizado com sucesso!' 
              }));
            } else {
              // 3. Register client on GestãoClick if not found
              setSyncProgress(prev => ({ 
                ...prev, 
                percentage: 84, 
                message: `Cadastrando cliente "${clientToUse.name}" novamente no GestãoClick...` 
              }));
              const cleanedCdpCnpj = (clientToUse.cnpj || '').replace(/\D/g, '');
              const tipoPessoa = cleanedCdpCnpj.length <= 11 ? 'PF' : 'PJ';
              
              const formatCpf = (val: string) => {
                const d = val.replace(/\D/g, '');
                if (d.length !== 11) return val;
                return `${d.substring(0,3)}.${d.substring(3,6)}.${d.substring(6,9)}-${d.substring(9)}`;
              };
              const formatCnpj = (val: string) => {
                const d = val.replace(/\D/g, '');
                if (d.length !== 14) return val;
                return `${d.substring(0,2)}.${d.substring(2,5)}.${d.substring(5,8)}/${d.substring(8,12)}-${d.substring(12)}`;
              };

              const clientPayload: any = {
                tipo_pessoa: tipoPessoa,
                nome: clientToUse.name,
                razao_social: clientToUse.fantasyName || clientToUse.name,
                cnpj: tipoPessoa === 'PJ' ? formatCnpj(clientToUse.cnpj || '') : '',
                cpf: tipoPessoa === 'PF' ? formatCpf(clientToUse.cnpj || '') : '',
                telefone: clientToUse.phone || '',
                celular: clientToUse.mobilePhone || '',
                email: clientToUse.email || '',
                ativo: '1',
              };

              if (clientToUse.street || clientToUse.cep || clientToUse.zipCode || clientToUse.city || clientToUse.state) {
                clientPayload.enderecos = [
                  {
                    endereco: {
                      cep: (clientToUse.cep || clientToUse.zipCode || '').replace(/\D/g, ''),
                      logradouro: clientToUse.street || '',
                      numero: clientToUse.number || '',
                      complemento: clientToUse.complement || '',
                      bairro: clientToUse.neighborhood || '',
                      nome_cidade: clientToUse.city || '',
                      estado: clientToUse.state || ''
                    }
                  }
                ];
              }

              const createRes = await gestaoClickService.createCliente(clientPayload);
              const returnedId = createRes?.data?.id || createRes?.data?.cliente_id || createRes?.id || createRes?.cliente_id;
              if (returnedId) {
                newResolvedId = String(returnedId);
                try {
                  await updateDoc(doc(db, 'clients', clientToUse.id), { gestaoClickId: newResolvedId });
                } catch (fsErr) {
                  console.error("Failed to persist re-created client id in Firestore:", fsErr);
                }
                setSyncProgress(prev => ({ 
                  ...prev, 
                  percentage: 86, 
                  message: `Cliente cadastrado novamente! ID: ${newResolvedId}` 
                }));
              } else {
                throw new Error("Falha ao recadastrar cliente no ERP.");
              }
            }

            if (newResolvedId) {
              resolvedClienteId = newResolvedId;
              cleanedVenda.cliente_id = String(newResolvedId);
              setSyncProgress(prev => ({ 
                ...prev, 
                percentage: 88, 
                message: 'Reenviando venda atualizada...' 
              }));
              response = await gestaoClickService.createVenda(cleanedVenda);
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      setSyncProgress(prev => ({ 
        ...prev, 
        percentage: 92, 
        message: 'Venda cadastrada com sucesso no GestãoClick!' 
      }));

      if (onCreateOrder) {
        try {
          setSyncProgress(prev => ({ 
            ...prev, 
            percentage: 95, 
            stage: 'local', 
            message: 'Criando pedido local e Ordens de Produção...' 
          }));

          // Find corresponding client in local clients
          const gcClient = clientes.find(c => String(c.id || c.cliente_id || '') === String(resolvedClienteId));
          const localClient = clientToUse || clients.find(c => {
            const vid = String(resolvedClienteId);
            if (vid.startsWith('local-')) {
              return c.id === vid.replace('local-', '');
            }
            return (c.gestaoClickId && String(c.gestaoClickId) === vid) ||
              (c.name && c.name.toLowerCase() === gcClient?.nome?.toLowerCase());
          });

          // Map items
          const orderItems: OrderItem[] = (newVenda.itens || []).map(it => {
            // Find local product to get weights and internal id
            const resolvedItenId = it.produto_id || it.servico_id;
            const rawId = String(resolvedItenId || '');
            const strippedId = rawId.startsWith('local-') ? rawId.replace('local-', '') : rawId;

            const localProd = products.find(p => {
              if (rawId.startsWith('local-')) {
                return p.id === strippedId;
              }
              return (p.gestaoClickId && String(p.gestaoClickId) === strippedId) ||
                (p.name && p.name.toLowerCase() === it.nome?.toLowerCase()) ||
                (p.productCode && String(p.productCode) === strippedId);
            });

            const qty = Number(it.quantidade) || 0;
            const unitPrice = Number(it.valor_unitario) || 0;
            
            // Calculate weight
            const calculatedWeight = localProd ? (qty / 1000) * (localProd.weightPerThousand || 0) : 0;

            return {
              productId: localProd?.id || `GC-${strippedId || 'manual'}`,
              productName: localProd?.name || it.nome || 'Produto Sem Cadastro Local',
              quantity: qty,
              unitPrice: unitPrice,
              calculatedWeight: parseFloat(calculatedWeight.toFixed(2)),
              color: localProd?.color || '',
              size: localProd ? `${localProd.width}x${localProd.height}` : '',
              printName: localProd?.printName || '',
              isUrgent: false,
              status: 'Pendente',
              finishedQuantity: 0,
              isConvertedFromPackage: isPackageSale,
              unitsPerPackage: isPackageSale ? unitsPerPackage : undefined
            };
          });

          // Resolve vendor name
          const gcVendor = funcionarios.find(f => String(f.id) === String(newVenda.vendedor_id));
          const sellerName = gcVendor?.nome || 'ERP Vendedor';

          // Prepare order data for onCreateOrder
          const orderData = {
            clientId: localClient?.id || `GC-CLI-${resolvedClienteId}`,
            clientName: localClient?.name || gcClient?.nome || 'Cliente do ERP',
            items: orderItems,
            sellerName,
            situation: 'Pendente',
            salesChannel: 'ERP',
            gestaoClickId: response?.data?.id ? String(response.data.id) : undefined,
            quoteId: preselectedQuoteId || undefined
          };

          // Call onCreateOrder to insert into Firestore with skipSync option so we don't sync back
          const customOrderId = response.data?.codigo ? String(response.data.codigo) : (response.data?.id ? String(response.data.id) : undefined);
          
          await onCreateOrder(orderData, { 
            skipSync: true, 
            customOrderId 
          });
        } catch (err: any) {
          console.error("Erro ao gerar pedido local a partir da venda:", err);
          // Standard warning, don't throw to disrupt successful erp sale
          notify(`Venda salva no ERP, mas erro ao gerar pedido local: ${err.message}`, 'warning');
        }
      }

      setSyncProgress(prev => ({ 
        ...prev, 
        percentage: 100, 
        stage: 'success', 
        message: 'Sincronização concluída com sucesso!' 
      }));

      setTimeout(() => {
        setSyncProgress(p => ({ ...p, active: false }));
        setView('list');
        fetchInitialData(); // Refresh list
        onSuccessCreated?.();
      }, 1500);

    } catch (error: any) {
      console.error("Error inside sync process:", error);
      const errTxt = error.message || String(error);
      setSyncProgress(prev => ({
        ...prev,
        percentage: 100,
        stage: 'error',
        message: 'Falha durante a sincronização',
        errorDetails: errTxt
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const totalVenda = (newVenda.itens || []).reduce((acc, item) => {
    const sub = item.quantidade * item.valor_unitario;
    const disc = item.tipo_desconto === '%' 
      ? (sub * (item.valor_desconto || 0) / 100) 
      : (item.valor_desconto || 0);
    return acc + (sub - disc);
  }, 0) - (newVenda.tipo_desconto === '%' ? (0) : (newVenda.valor_desconto || 0)); 
  // Global discount logic can be complex, usually it's applied at the end.

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 py-40">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
        <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Conectando ao GestãoClick...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Vendas (ERP)</h2>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mt-1">Integração Direta GestãoClick</p>
        </div>
        
        <div className="flex items-center gap-3">
          {view === 'list' ? (
            <button 
              onClick={() => {
                if (onRequestClientSelect) {
                  onRequestClientSelect();
                } else {
                  setView('create');
                }
              }}
              className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all flex items-center gap-2 active:scale-95"
            >
              <Plus size={18} /> Nova Venda
            </button>
          ) : (
            <button 
              onClick={() => {
                if (onCancel) {
                  onCancel();
                } else {
                  setView('list');
                }
              }}
              className="bg-slate-100 text-slate-600 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
            >
              Voltar para Lista
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <motion.div 
            key="list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-3">
                  <TrendingUp size={20} />
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total de Vendas</p>
                <p className="text-2xl font-black text-slate-900">{sales.length}</p>
              </div>
              <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-3">
                  <DollarSign size={20} />
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Valor Total (Pág. Atual)</p>
                <p className="text-2xl font-black text-slate-900">
                  {formatMoney(sales.reduce((acc, s) => acc + parseFloat(s.valor_total || 0), 0))}
                </p>
              </div>
              <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center mb-3">
                  <Building2 size={20} />
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Empresa Vinculada</p>
                <p className="text-xl font-black text-slate-900 truncate">SouPlastic</p>
              </div>
            </div>

            {/* List Table */}
            <div className="bg-white rounded-[32px] border border-slate-100 shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-50 flex flex-wrap items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Buscar venda por código ou cliente..." 
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm transition-all"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button className="p-3 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all">
                    <Filter size={18} />
                  </button>
                  <button onClick={fetchInitialData} className="p-3 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all">
                    <Loader2 size={18} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50">
                      <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Código</th>
                      <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Cliente</th>
                      <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Data</th>
                      <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Valor</th>
                      <th className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Situação</th>
                      <th className="px-6 py-4 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sales.filter(s => s.codigo?.toString().includes(search) || s.cliente_nome?.toLowerCase().includes(search.toLowerCase())).map(sale => (
                      <tr key={sale.id} className="group hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg text-[10px]">#{sale.codigo}</span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800 text-sm">{sale.cliente_nome}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase">{sale.tipo || 'Venda'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-slate-500 font-bold text-[11px]">
                            <Calendar size={12} />
                            {new Date(sale.data).toLocaleDateString('pt-BR')}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-black text-slate-900">{formatMoney(parseFloat(sale.valor_total))}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                            sale.situacao_id === 1 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {sale.situacao_nome || 'Processada'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button className="text-slate-400 hover:text-blue-600 transition-colors p-2">
                            <ChevronRight size={20} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sales.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-20 text-center">
                          <div className="flex flex-col items-center">
                            <ShoppingCart size={40} className="text-slate-200 mb-4" />
                            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Nenhuma venda encontrada no ERP</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="create"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            className="flex flex-col gap-6"
          >
            {/* Main Form Area */}
            <div className="bg-white rounded-[32px] border border-slate-100 shadow-xl p-8 space-y-10">
              
              {/* Seção Dados Gerais */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                  <Tag className="text-blue-600" size={20} />
                  <h3 className="text-lg font-black text-slate-800 uppercase tracking-tighter">Dados Gerais</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  {/* Cliente */}
                  <div className="md:col-span-2 space-y-1.5 relative">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Cliente *</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input 
                        type="text"
                        placeholder="Buscar cliente..."
                        className={`w-full h-12 pl-11 pr-10 border rounded-2xl outline-none font-bold text-sm transition-all ${
                          isClientLocked 
                            ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed'
                            : 'bg-slate-50 border-slate-100 focus:ring-2 focus:ring-blue-500'
                        }`}
                        disabled={isClientLocked}
                        readOnly={isClientLocked}
                        value={
                          newVenda.cliente_id 
                            ? (
                                clients.find(c => {
                                  const vid = String(newVenda.cliente_id || '');
                                  if (vid.startsWith('local-')) {
                                    return c.id === vid.replace('local-', '');
                                  }
                                  return c.gestaoClickId && String(c.gestaoClickId) === vid;
                                })?.name ||
                                clientes.find(c => String(c.id || c.cliente_id || '') === String(newVenda.cliente_id))?.nome || 
                                ''
                              ) 
                            : clientSearch
                        }
                        onFocus={() => {
                          if (!isClientLocked) setShowClientSuggestions(true);
                        }}
                        onChange={e => {
                          if (!isClientLocked) {
                            if (newVenda.cliente_id) setNewVenda({...newVenda, cliente_id: undefined});
                            setClientSearch(e.target.value);
                            setShowClientSuggestions(true);
                          }
                        }}
                      />
                      {isClientLocked && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" title="Cliente pré-selecionado e travado">
                          <Lock size={16} />
                        </div>
                      )}
                    </div>

                    <AnimatePresence>
                      {showClientSuggestions && !newVenda.cliente_id && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-50 left-0 right-0 top-[calc(100%+4px)] bg-white border border-slate-100 rounded-[24px] shadow-2xl overflow-hidden max-h-60 overflow-y-auto"
                        >
                          {filteredClients.length > 0 ? (
                            filteredClients.map((c, idx) => (
                              <button
                                key={`cli-suggest-${c.id || idx}`}
                                className="w-full px-5 py-4 text-left hover:bg-slate-50 flex flex-col border-b border-slate-50 last:border-0"
                                onClick={() => {
                                  setNewVenda({...newVenda, cliente_id: c.id});
                                  setClientSearch('');
                                  setShowClientSuggestions(false);
                                }}
                              >
                                <span className="font-bold text-slate-800 text-sm">{c.nome}</span>
                                {c.cpf_cnpj && <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{c.cpf_cnpj}</span>}
                              </button>
                            ))
                          ) : (
                            <div className="px-5 py-8 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">
                              Nenhum cliente encontrado
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {showClientSuggestions && (
                      <div 
                        className="fixed inset-0 z-40 bg-transparent" 
                        onClick={() => setShowClientSuggestions(false)}
                      />
                    )}
                  </div>

                  {/* Vendedor */}
                  <div className="space-y-1.5">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Vendedor / Responsável</label>
                    <select 
                      disabled={true}
                      className="w-full h-12 px-4 bg-slate-100 border border-slate-200 rounded-2xl outline-none font-bold text-sm appearance-none text-slate-500 cursor-not-allowed transition-all"
                      value={newVenda.vendedor_id || ''}
                      onChange={e => setNewVenda({...newVenda, vendedor_id: parseInt(e.target.value)})}
                    >
                      <option value="">Selecione...</option>
                      {funcionarios.map((f, idx) => <option key={`func-${f.id || idx}`} value={f.id}>{f.nome}</option>)}
                    </select>
                  </div>

                  {/* Canal de Venda (Loja) */}
                  <div className="space-y-1.5">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Canal de venda *</label>
                    <select 
                      disabled={true}
                      className="w-full h-12 px-4 bg-slate-100 border border-slate-200 rounded-2xl outline-none font-bold text-sm appearance-none text-slate-500 cursor-not-allowed transition-all"
                      value={newVenda.loja_id || ''}
                      onChange={e => setNewVenda({...newVenda, loja_id: parseInt(e.target.value)})}
                    >
                      <option value="">Selecione a Loja...</option>
                      {lojas.map((l, idx) => <option key={`loja-${l.id || idx}`} value={l.id}>{l.nome}</option>)}
                    </select>
                  </div>

                  {/* Data */}
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Data *</label>
                    <input 
                      type="date" 
                      disabled={true}
                      readOnly={true}
                      className="w-full h-12 px-4 bg-slate-100 border border-slate-200 rounded-2xl outline-none font-bold text-sm text-slate-500 cursor-not-allowed transition-all"
                      value={newVenda.data || ''}
                      onChange={e => setNewVenda({...newVenda, data: e.target.value})}
                    />
                  </div>

                  {/* Prazo de Entrega */}
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Prazo de Entrega (+20 dias)</label>
                    <input 
                      type="date" 
                      className="w-full h-12 px-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm transition-all"
                      value={newVenda.prazo_entrega || ''}
                      onChange={e => setNewVenda({...newVenda, prazo_entrega: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              {/* Seção Produtos */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                  <Package className="text-blue-600" size={20} />
                  <h3 className="text-lg font-black text-slate-800 uppercase tracking-tighter">Produtos</h3>
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-6 space-y-6">
                  {/* Item Selector Form (Better like the screenshot) */}
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                    <div className="md:col-span-2 space-y-1.5 relative">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Produto / Serviço *</label>
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                          type="text"
                          placeholder="Digite o nome do produto ou serviço..."
                          className="w-full h-11 pl-11 pr-4 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-xs transition-all"
                          value={selectedItem ? selectedItem.nome : itemSearch}
                          onFocus={() => setShowItemSuggestions(true)}
                          onChange={e => {
                            if (selectedItem) setSelectedItem(null);
                            setItemSearch(e.target.value);
                            setShowItemSuggestions(true);
                          }}
                        />
                      </div>

                      <AnimatePresence>
                        {showItemSuggestions && !selectedItem && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute z-50 left-0 right-0 top-[calc(100%+4px)] bg-white border border-slate-100 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto"
                          >
                            {filteredItems.length > 0 ? (
                              filteredItems.map((item, idx) => (
                                <button
                                  key={`suggestion-${item.id}-${idx}`}
                                  className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0"
                                  onClick={() => {
                                    const val = parseFloat(item.valor_venda || item.valor || 0);
                                    setSelectedItem({
                                      id: item.id,
                                      nome: item.nome,
                                      valor: val,
                                      tipo: item.tipo
                                    });
                                    setItemValue(String(val));
                                    setItemSearch('');
                                    setShowItemSuggestions(false);
                                  }}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-bold text-slate-800 text-xs">{item.nome}</span>
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{item.tipo}</span>
                                  </div>
                                  <span className="font-black text-blue-600 text-xs">{formatMoney(parseFloat(item.valor_venda || item.valor || 0))}</span>
                                </button>
                              ))
                            ) : (
                              <div className="px-4 py-6 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">
                                Nenhum item encontrado
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Click outside to close list */}
                      {showItemSuggestions && (
                        <div 
                          className="fixed inset-0 z-40 bg-transparent" 
                          onClick={() => setShowItemSuggestions(false)}
                        />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Quant.*</label>
                      <input 
                        type="number" 
                        step="any"
                        className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-xs"
                        value={itemQty}
                        onChange={e => setItemQty(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Valor*</label>
                      <input 
                        type="number" 
                        step="any"
                        className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-xs"
                        value={itemValue}
                        onChange={e => setItemValue(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Desconto</label>
                      <div className="flex h-11 bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <input 
                          type="number" 
                          step="any"
                          className="w-full px-4 outline-none font-bold text-xs bg-transparent"
                          value={itemDiscount}
                          onChange={e => setItemDiscount(e.target.value)}
                        />
                        <select 
                          className="bg-slate-100 border-l border-slate-200 px-2 font-bold text-[10px] outline-none"
                          value={itemDiscountType}
                          onChange={e => setItemDiscountType(e.target.value as any)}
                        >
                          <option value="R$">R$</option>
                          <option value="%">%</option>
                        </select>
                      </div>
                    </div>

                    <button 
                      onClick={handleAddItem}
                      className="h-11 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-2 active:scale-95 shadow-md shadow-slate-100"
                    >
                      <Plus size={16} /> Adicionar
                    </button>
                  </div>

                  {/* Tabela de Itens (Similar a screenshot) */}
                  <div className="overflow-x-auto bg-white rounded-xl border border-slate-100 shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50">
                          <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Produto*</th>
                          <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Quant.*</th>
                          <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Valor*</th>
                          <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Desconto</th>
                          <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Subtotal</th>
                          <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-center">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {(newVenda.itens || []).map((item, idx) => {
                          const subtotal = item.quantidade * item.valor_unitario;
                          const discount = item.tipo_desconto === '%' 
                            ? (subtotal * (item.valor_desconto || 0) / 100) 
                            : (item.valor_desconto || 0);
                          return (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-4">
                                <p className="font-bold text-slate-800 text-xs">{(item as any).nome || 'Item do ERP'}</p>
                              </td>
                              <td className="px-4 py-4">
                                <p className="text-xs font-bold text-slate-600">{item.quantidade}</p>
                              </td>
                              <td className="px-4 py-4 font-bold text-xs text-slate-600">
                                {formatMoney(item.valor_unitario)}
                              </td>
                              <td className="px-4 py-4 font-bold text-xs text-red-500">
                                {item.valor_desconto && item.valor_desconto > 0 
                                  ? `${item.tipo_desconto === '%' ? '' : 'R$'}${item.valor_desconto}${item.tipo_desconto === '%' ? '%' : ''}`
                                  : '-'}
                              </td>
                              <td className="px-4 py-4 font-black text-xs text-slate-900 text-right">
                                {formatMoney(subtotal - discount)}
                              </td>
                              <td className="px-4 py-4 text-center">
                                <button 
                                  onClick={() => handleRemoveItem(idx)}
                                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                >
                                  <Plus className="rotate-45" size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {(newVenda.itens || []).length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">
                              Nenhum item adicionado à venda.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Opção Pedido por Pacote */}
                  <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={isPackageSale} 
                        onChange={e => setIsPackageSale(e.target.checked)} 
                      />
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Pedido por Pacote?</span>
                    </label>
                    
                    {isPackageSale && (
                      <div className="space-y-1.5 mt-2 pt-2 border-t border-slate-100 font-sans">
                        <div className="flex items-center justify-between gap-3 text-xs bg-slate-50 p-3 rounded-2xl border border-slate-100">
                          <div className="flex flex-col text-left">
                            <span className="text-slate-700 font-bold uppercase tracking-wide text-[10px]">Unidades por Pacote</span>
                            <span className="text-[9px] text-slate-400 font-medium">Define quantas unidades há em cada pacote de venda para cálculo da ordem de produção</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input 
                              type="number"
                              min="1"
                              className="w-20 p-2 text-center bg-white border border-slate-200 rounded-xl font-black text-slate-800 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
                              value={unitsPerPackage}
                              onChange={e => setUnitsPerPackage(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

               {/* Final Footer with Summary and Confirm */}
              <div className="pt-8 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex flex-col">
                  <div className="flex items-center gap-4 text-slate-500 mb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest">Total S/ Desc.</span>
                    <span className="font-bold">{formatMoney((newVenda.itens || []).reduce((acc, i) => acc + (i.quantidade * i.valor_unitario), 0))}</span>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Geral da Venda</p>
                    <p className="text-4xl font-black text-blue-600 tracking-tighter">{formatMoney(totalVenda)}</p>
                  </div>
                </div>
                
                <div className="flex gap-4 w-full md:w-auto">
                  <button 
                    onClick={() => {
                      if (onCancel) {
                        onCancel();
                      } else {
                        setView('list');
                      }
                    }}
                    className="flex-1 md:flex-none h-14 px-8 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
                  >
                    Descartar
                  </button>
                  <button 
                    onClick={handleSubmit}
                    disabled={submitting || (newVenda.itens || []).length === 0}
                    className="flex-1 md:flex-none h-14 px-12 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={18} className="animate-spin" /> Processando...
                      </>
                    ) : (
                      <>
                        Confirmar Venda <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Synchronization Progress Bar Overlay */}
      <AnimatePresence>
        {syncProgress.active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[999]"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 flex flex-col items-center text-center overflow-hidden"
            >
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 ring-8 ring-blue-50/50">
                {syncProgress.stage === 'success' ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 10 }}
                  >
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </motion.div>
                ) : syncProgress.stage === 'error' ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 10 }}
                  >
                    <XCircle className="w-8 h-8 text-rose-500" />
                  </motion.div>
                ) : (
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                )}
              </div>

              <h3 className="text-lg font-black text-slate-800 tracking-tight mb-1 uppercase">
                {syncProgress.stage === 'success'
                  ? 'Venda Sincronizada!'
                  : syncProgress.stage === 'error'
                  ? 'Sincronização Falhou'
                  : 'Sincronizando com o ERP'}
              </h3>
              
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-4">
                Estágio: {
                  syncProgress.stage === 'client' ? 'Vínculo do Cliente' :
                  syncProgress.stage === 'items' ? 'Vínculo dos Itens' :
                  syncProgress.stage === 'venda' ? 'Faturamento ERP' :
                  syncProgress.stage === 'local' ? 'Geração de Pedido' :
                  syncProgress.stage === 'success' ? 'Concluído' : 'Erro'
                }
              </p>

              {/* Progress Line */}
              <div className="w-full bg-slate-100 rounded-full h-3.5 mb-2 overflow-hidden border border-slate-50 relative">
                <motion.div
                  className={`h-full rounded-full transition-all duration-300 ${
                    syncProgress.stage === 'error' ? 'bg-rose-500 shadow shadow-rose-300' :
                    syncProgress.stage === 'success' ? 'bg-emerald-500 shadow shadow-emerald-300' :
                    'bg-blue-600 shadow shadow-blue-300'
                  }`}
                  style={{ width: `${syncProgress.percentage}%` }}
                />
              </div>

              <div className="flex justify-between w-full px-1 text-slate-400 text-xs font-bold mb-4">
                <span className="truncate max-w-[80%] text-left">{syncProgress.message}</span>
                <span className="text-slate-600 font-black">{syncProgress.percentage}%</span>
              </div>

              {syncProgress.stage === 'error' && (
                <div className="w-full bg-rose-50 rounded-2xl p-4 text-left border border-rose-100 mb-6 max-h-40 overflow-y-auto w-full">
                  <p className="text-xs font-semibold text-rose-800 uppercase tracking-wider mb-1">Detalhes do erro:</p>
                  <p className="text-xs font-semibold font-mono text-rose-600 leading-relaxed break-words">{syncProgress.errorDetails || 'Erro desconhecido.'}</p>
                </div>
              )}

              {syncProgress.stage === 'error' && (
                <button
                  type="button"
                  onClick={() => setSyncProgress(p => ({ ...p, active: false }))}
                  className="w-full h-12 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-rose-100 hover:bg-rose-700 transition-all active:scale-95"
                >
                  Fechar Janela
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
