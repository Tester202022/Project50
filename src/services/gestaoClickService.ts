const API_BASE_URL = '/api/gestaoclick';

function normalizeSlug(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface GestaoClickVenda {
  tipo?: 'produto' | 'servico' | 'vendas_balcao';
  codigo?: number;
  cliente_id: number;
  situacao_id: number;
  loja_id?: number;
  vendedor_id?: number;
  centro_custo_id?: number;
  data: string; // AAAA-MM-DD
  prazo_entrega?: string; // AAAA-MM-DD
  condicao_pagamento: 'a_vista' | 'parcelado';
  tipo_desconto?: 'R$' | '%';
  valor_desconto?: number;
  observacao?: string;
  observacao_interna?: string;
  itens: {
    produto_id?: number;
    servico_id?: number;
    quantidade: number;
    valor_unitario: number;
    valor_desconto?: number;
    tipo_desconto?: 'R$' | '%';
  }[];
  pagamentos?: {
    forma_pagamento_id: number;
    valor_pagamento: number;
    data_vencimento: string;
  }[];
  // Campos para geração automática
  forma_pagamento_id?: number;
  numero_parcelas?: number;
  intervalo_dias?: number;
  data_primeira_parcela?: string;
  gerar_financeiro?: 'sim' | 'nao';
  plano_contas_id?: number;
}

export const gestaoClickService = {
  async getClientes(params?: Record<string, string>) {
    const finalParams = { limite: '100', ...params };
    const query = '?' + new URLSearchParams(finalParams).toString();
    const response = await fetch(`${API_BASE_URL}/clientes/${query}`);
    if (!response.ok) throw new Error('Erro ao buscar clientes no GestãoClick');
    return await response.json();
  },

  async createCliente(cliente: any) {
    const response = await fetch(`${API_BASE_URL}/clientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cliente)
    });
    if (!response.ok) {
      const error = await response.json();
      const message = error.message || error.error || (error.validation_errors ? Object.values(error.validation_errors).join(', ') : 'Erro ao cadastrar cliente no GestãoClick');
      throw new Error(message);
    }
    return await response.json();
  },

  async updateCliente(clienteId: string | number, cliente: any) {
    const response = await fetch(`${API_BASE_URL}/clientes/${clienteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cliente)
    });
    if (!response.ok) {
      const error = await response.json();
      const message = error.message || error.error || (error.validation_errors ? Object.values(error.validation_errors).join(', ') : 'Erro ao atualizar cliente no GestãoClick');
      throw new Error(message);
    }
    return await response.json();
  },

  async getProdutos(params?: Record<string, string>) {
    const finalParams = { limite: '100', ...params };
    const query = '?' + new URLSearchParams(finalParams).toString();
    const response = await fetch(`${API_BASE_URL}/produtos/${query}`);
    if (!response.ok) throw new Error('Erro ao buscar produtos no GestãoClick');
    return await response.json();
  },

  async findProduto(name?: string, code?: string | number) {
    if (name) {
      try {
        const queryRes = await this.getProdutos({ nome: name.trim() });
        const list = queryRes.data || [];
        const found = list.find((p: any) => 
          p.nome && p.nome.toLowerCase().trim() === name.toLowerCase().trim()
        );
        if (found) return found;

        // Try slug match on direct search results
        const nameSlug = normalizeSlug(name);
        const foundSlug = list.find((p: any) => 
          p.nome && normalizeSlug(p.nome) === nameSlug
        );
        if (foundSlug) return foundSlug;
      } catch (err) {
        console.warn(`Erro ao buscar produto por nome específico "${name}":`, err);
      }
    }

    if (code) {
      try {
        const queryRes = await this.getProdutos({ codigo_interno: String(code).trim() });
        const list = queryRes.data || [];
        let found = list.find((p: any) => 
          (p.codigo && String(p.codigo).trim() === String(code).trim()) ||
          (p.codigo_interno && String(p.codigo_interno).trim() === String(code).trim())
        );
        if (found) return found;

        const queryRes2 = await this.getProdutos({ codigo: String(code).trim() });
        const list2 = queryRes2.data || [];
        found = list2.find((p: any) => 
          (p.codigo && String(p.codigo).trim() === String(code).trim()) ||
          (p.codigo_interno && String(p.codigo_interno).trim() === String(code).trim())
        );
        if (found) return found;
      } catch (err) {
        console.warn(`Erro ao buscar produto por código específico "${code}":`, err);
      }
    }

    // Backup deep-scan: fetch up to 10 pages of products to search by slug or name or code
    try {
      const nameSlug = name ? normalizeSlug(name) : '';
      for (let page = 1; page <= 10; page++) {
        const queryRes = await this.getProdutos({ pagina: String(page), limite: '100' });
        const list = queryRes.data || [];
        if (list.length === 0) break;

        let found = null;
        if (code) {
          found = list.find((p: any) => 
            (p.codigo && String(p.codigo).trim() === String(code).trim()) ||
            (p.codigo_interno && String(p.codigo_interno).trim() === String(code).trim())
          );
        }
        if (!found && name) {
          // Slug comparison match
          found = list.find((p: any) => 
            p.nome && normalizeSlug(p.nome) === nameSlug
          );
          if (!found) {
            // Symmetrical substring or casing comparison list match as fallback
            found = list.find((p: any) => 
              p.nome && p.nome.toLowerCase().trim() === name.toLowerCase().trim()
            );
          }
        }

        if (found) {
          console.log(`findProduto: Produto encontrado no deep-scan (página ${page}):`, found);
          return found;
        }
      }
    } catch (err) {
      console.warn("Erro no fallback de busca paginada de produtos:", err);
    }

    return null;
  },

  async createProduto(produto: any) {
    try {
      const response = await fetch(`${API_BASE_URL}/produtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(produto)
      });
      if (response.ok) {
        return await response.json();
      }

      const error = await response.json();
      const message = error.message || error.error || (error.validation_errors ? Object.values(error.validation_errors).join(', ') : '');
      const defaultMessage = message || 'Erro ao cadastrar produto no GestãoClick';

      // Check if it's a URL slug collision error
      const isUrlCollision = defaultMessage.includes("A URL do produto") || 
                            (error.data && error.data.mensagem && error.data.mensagem.includes("A URL do produto"));

      if (isUrlCollision && !produto._retriedWithUniqueName) {
        console.warn(`Collision detected for "${produto.nome}". Retrying with unique registration name...`);
        const suffix = produto.codigo_interno ? ` (${produto.codigo_interno})` : ` - Ref ${Math.floor(Math.random() * 1000)}`;
        const retriedProduto = {
          ...produto,
          nome: `${produto.nome}${suffix}`.substring(0, 100),
          _retriedWithUniqueName: true
        };
        return await this.createProduto(retriedProduto);
      }

      throw new Error(defaultMessage);
    } catch (err: any) {
      throw err;
    }
  },

  async getServicos(params?: Record<string, string>) {
    const finalParams = { limite: '100', ...params };
    const query = '?' + new URLSearchParams(finalParams).toString();
    const response = await fetch(`${API_BASE_URL}/servicos/${query}`);
    if (!response.ok) throw new Error('Erro ao buscar serviços no GestãoClick');
    return await response.json();
  },

  async getSituacoesVendas() {
    const response = await fetch(`${API_BASE_URL}/situacoes_vendas/`);
    if (!response.ok) throw new Error('Erro ao buscar situações de vendas no GestãoClick');
    return await response.json();
  },

  async getLojas() {
    const response = await fetch(`${API_BASE_URL}/lojas/`);
    if (!response.ok) throw new Error('Erro ao buscar lojas no GestãoClick');
    return await response.json();
  },

  async getFuncionarios() {
    const response = await fetch(`${API_BASE_URL}/funcionarios/`);
    if (!response.ok) throw new Error('Erro ao buscar funcionários no GestãoClick');
    return await response.json();
  },

  async getCentrosCustos() {
    const response = await fetch(`${API_BASE_URL}/centros_custos/`);
    if (!response.ok) throw new Error('Erro ao buscar centros de custos no GestãoClick');
    return await response.json();
  },

  async getFormasPagamento() {
    const response = await fetch(`${API_BASE_URL}/formas_pagamentos/`);
    if (!response.ok) throw new Error('Erro ao buscar formas de pagamento no GestãoClick');
    return await response.json();
  },

  async getPlanosContas() {
    const response = await fetch(`${API_BASE_URL}/planos_contas/`);
    if (!response.ok) throw new Error('Erro ao buscar planos de contas no GestãoClick');
    return await response.json();
  },

  async createVenda(venda: GestaoClickVenda) {
    // Validações básicas antes de enviar
    if (!['a_vista', 'parcelado'].includes(venda.condicao_pagamento)) {
      throw new Error('condicao_pagamento deve ser "a_vista" ou "parcelado"');
    }
    if (venda.valor_desconto && venda.valor_desconto > 0) {
      if (!['R$', '%'].includes(venda.tipo_desconto || '')) {
        throw new Error('tipo_desconto deve ser "R$" ou "%"');
      }
    }

    const response = await fetch(`${API_BASE_URL}/vendas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(venda)
    });

    if (!response.ok) {
      const error = await response.json();
      const message = error.message || error.error || (error.validation_errors ? Object.values(error.validation_errors).join(', ') : 'Erro ao cadastrar venda no GestãoClick');
      throw new Error(message);
    }

    return await response.json();
  },

  async emitNFe(order: any, client: any, products: any[], settings: any) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    
    // Format date DD/MM/YYYY and time HH:MM
    const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // 1. Resolve client GestãoClick ID
    let resolvedClienteId = client.gestaoClickId;
    if (!resolvedClienteId) {
      try {
        const gcClients = await this.getClientes();
        const found = gcClients.data?.find((c: any) => 
          (c.cnpj && c.cnpj.replace(/\D/g, '') === client.cnpj?.replace(/\D/g, '')) || 
          (c.cpf && c.cpf.replace(/\D/g, '') === client.cnpj?.replace(/\D/g, '')) || 
          (c.nome && c.nome.toLowerCase() === client.name?.toLowerCase())
        );
        if (found) {
          resolvedClienteId = found.cliente_id || found.id;
        } else {
          // Auto register client inside emitNFe too
          const cleanedCdfCnpj = (client.cnpj || '').replace(/\D/g, '');
          const tipoPessoa = cleanedCdfCnpj.length <= 11 ? 'PF' : 'PJ';
          
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
            nome: client.name,
            razao_social: client.fantasyName || client.name,
            cnpj: tipoPessoa === 'PJ' ? formatCnpj(client.cnpj || '') : '',
            cpf: tipoPessoa === 'PF' ? formatCpf(client.cnpj || '') : '',
            telefone: client.phone || '',
            celular: client.mobilePhone || '',
            email: client.email || '',
            ativo: '1',
          };

          if (client.street || client.cep || client.zipCode || client.city || client.state) {
            clientPayload.enderecos = [
              {
                endereco: {
                  cep: (client.cep || client.zipCode || '').replace(/\D/g, ''),
                  logradouro: client.street || '',
                  numero: client.number || '',
                  complemento: client.complement || '',
                  bairro: client.neighborhood || '',
                  nome_cidade: client.city || '',
                  estado: client.state || ''
                }
              }
            ];
          }

          console.log("Auto-registering GestaoClick client in emitNFe flow:", clientPayload);
          const createRes = await this.createCliente(clientPayload);
          if (createRes && createRes.data && createRes.data.id) {
            resolvedClienteId = String(createRes.data.id);
            // Link locally if we have DB access
            try {
              const { doc, updateDoc, getFirestore } = await import('firebase/firestore');
              const db = getFirestore();
              await updateDoc(doc(db, 'clients', client.id), { gestaoClickId: resolvedClienteId });
            } catch (fsErr) {
              console.error("Failed to persist user in Firestore within emitNFe:", fsErr);
            }
          }
        }
      } catch (err) {
        console.warn("Could not fetch or create client in GestãoClick:", err);
      }
    }

    if (!resolvedClienteId) {
      throw new Error(`O cliente "${client.name}" não está cadastrado ou vinculado ao GestãoClick. Cadastre-o primeiro.`);
    }

    // 2. Prepare products list
    const produtos = order.items?.map((item: any) => {
      let product = products.find(p => p.id === item.productId);
      if (!product && item.productName) {
        product = products.find(p => String(p.name || '').toLowerCase().trim() === String(item.productName).toLowerCase().trim());
      }
      const gcProdId = product?.gestaoClickId;
      if (!gcProdId) {
        throw new Error(`O produto "${item.productName || product?.name}" não está vinculado ao GestãoClick.`);
      }
      return {
        produto_id: Number(gcProdId),
        quantidade: Number(item.quantity || 1),
        NCM: (product?.ncm || "39232190").replace(/\D/g, ''),
        valor_venda: Number(item.unitPrice || 0)
      };
    }) || [];

    if (produtos.length === 0) {
      throw new Error("O pedido não possui produtos para emissão de nota fiscal.");
    }

    // 3. Prepare payment array
    const vencimentoStr = order.items?.[0]?.deliveryDate 
      ? (() => {
          const d = new Date(order.items[0].deliveryDate);
          return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
        })()
      : dateStr;

    // Use default forma_pagamento_id or standard fallback if none
    let resolvedFormaPagamentoId = settings.formaPagamentoId ? Number(settings.formaPagamentoId) : 3013236;
    try {
      const fps = await this.getFormasPagamento();
      const list = fps.data || [];
      const found = list.find((fp: any) => {
        const item = fp.FormasPagamento || fp;
        const nome = String(item.nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return nome.includes("dinheiro a vista") || nome.includes("dinheiro");
      });
      if (found) {
        const item = found.FormasPagamento || found;
        resolvedFormaPagamentoId = Number(item.forma_pagamento_id || item.id);
      }
    } catch (e) {
      console.error("Erro ao buscar formas de pagamento no fluxo da NFe:", e);
    }

    const pagamento = [
      {
        forma_pagamento_id: resolvedFormaPagamentoId, 
        valor_pagamento: Number(order.totalValue),
        data_vencimento: vencimentoStr
      }
    ];

    // Resolve dynamic loja_id depending on client's tax regime or companyType:
    let resolvedLojaId = settings.lojaId || "294854";
    const isFilial = client?.taxRegime === 'Lucro Presumido' || client?.taxRegime === 'Real' || client?.companyType === 'Filial';
    try {
      const lojas = await this.getLojas();
      const pattern = isFilial ? 'filial' : 'matriz';
      const foundLoja = (lojas.data || []).find((l: any) => 
        (l.nome && l.nome.toLowerCase().includes(pattern)) || 
        (l.razao_social && l.razao_social.toLowerCase().includes(pattern))
      );
      if (foundLoja) {
        resolvedLojaId = String(foundLoja.loja_id || foundLoja.id);
      }
    } catch (e) {
      console.warn("Could not dynamically resolve loja_id in emitNFe:", e);
    }

    const payload = {
      loja_id: String(resolvedLojaId), 
      data_emissao: dateStr,
      hora_emissao: timeStr,
      data_entrada_saida: dateStr,
      hora_entrada_saida: `${timeStr}:00`,
      id_destinatario: Number(resolvedClienteId),
      informacoes_complementares: order.obs || `Referência Pedido #${order.id}`,
      tipo_atendimento: Number(settings.presencaComprador || 1),
      tipo_nf: 1, // Saída
      envio_automatico: 1, // Emitir automaticamente
      indicador_final: 1, // Consumidor final
      produtos,
      pagamento
    };

    console.log("GestãoClick NFe Emit payload:", payload);

    const response = await fetch(`${API_BASE_URL}/notas_fiscais_produtos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      const message = error.message || error.error || (error.validation_errors ? Object.values(error.validation_errors).join(', ') : 'Erro ao cadastrar e emitir nota fiscal no GestãoClick');
      throw new Error(message);
    }

    const resData = await response.json();
    console.log("GestãoClick NFe Emit response:", resData);

    const nfeId = resData.data?.dados || resData.data?.id || String(Date.now());
    return {
      id: String(nfeId),
      uuid: String(nfeId),
      status: 'authorized', 
      external_id: order.id,
      number: String(nfeId) 
    };
  },

  async checkStatus(nfeId: string) {
    const response = await fetch(`${API_BASE_URL}/notas_fiscais_produtos/${nfeId}`);
    if (!response.ok) {
      throw new Error(`Erro ao consultar nota fiscal ${nfeId} no GestãoClick`);
    }
    const resData = await response.json();
    console.log(`GestãoClick NFe status for ${nfeId}:`, resData);
    
    const nfe = resData.data || {};
    
    let normalizedStatus = 'Processando';
    if (nfe.situacao_nf === 'Aprovada' || nfe.situacao_nf === 'Corrigida') {
      normalizedStatus = 'authorized';
    } else if (nfe.situacao_nf === 'Cancelada') {
      normalizedStatus = 'canceled';
    } else if (nfe.situacao_nf === 'Rejeitada' || nfe.situacao_nf === 'Erro') {
      normalizedStatus = 'error';
    }

    return {
      id: String(nfe.id || nfeId),
      uuid: String(nfe.id || nfeId),
      status: normalizedStatus,
      situacao: nfe.situacao_nf,
      number: nfe.numero_nf,
      numero: nfe.numero_nf,
      chave: nfe.chave,
      protocolo: nfe.protocolo,
      link_danfe: nfe.chave ? `https://www.danfeonline.com.br/?chave=${nfe.chave}` : undefined,
      pdf_url: nfe.chave ? `https://www.danfeonline.com.br/?chave=${nfe.chave}` : undefined,
      message: nfe.situacao_nf
    };
  },

  async cancelNFe(nfeId: string, motivo: string) {
    const payload = { motivo: motivo || "Teste de cancelamento via webservice" };
    const response = await fetch(`${API_BASE_URL}/notas_fiscais_produtos/cancelar/${nfeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || error.error || 'Erro ao cancelar nota no GestãoClick');
    }
    return await response.json();
  },

  async deleteNFe(nfeId: string) {
    const response = await fetch(`${API_BASE_URL}/notas_fiscais_produtos/${nfeId}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || error.error || 'Erro ao excluir rascunho de nota no GestãoClick');
    }
    return await response.json();
  },

  async updateNFe(nfeId: string, payload: any) {
    const response = await fetch(`${API_BASE_URL}/notas_fiscais_produtos/${nfeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || error.error || 'Erro ao atualizar nota no GestãoClick');
    }
    return await response.json();
  },

  async emitExistingNFe(nfeId: string) {
    const response = await fetch(`${API_BASE_URL}/notas_fiscais_produtos/emitir/${nfeId}`, {
      method: 'POST'
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || error.error || 'Erro ao enviar comando de emissão no GestãoClick');
    }
    return await response.json();
  }
};
