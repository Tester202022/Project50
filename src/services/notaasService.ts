/// <reference types="vite/client" />
import { Order, Client, Product } from '../App';

const NOTAAS_PROXY_URL = '/api/notaas';

export const notaasService = {
  async emitNFe(order: any, client: Client, products: Product[], settings: any) {
    const body = {
      referencia: order.id,
      external_id: order.id,
      tipo: "NFE", 
      modelo: 55,
      naturezaOperacao: settings.naturezaOperacao || "Venda de mercadoria",
      finalidadeEmissao: settings.finalidadeEmissao || 1,
      presencaComprador: settings.presencaComprador || 1,
      dataEmissao: new Date().toISOString().replace(/\.[0-9]{3}Z$/, '-03:00'),
      
      // Dados do Emitente configuráveis
      emitente: {
        cnpj: settings.cnpj?.replace(/\D/g, '') || "21294666000170",
        inscricaoEstadual: settings.inscricaoEstadual?.replace(/\D/g, '') || "145991683116",
        inscricaoMunicipal: settings.inscricaoMunicipal?.replace(/\D/g, '') || "51217562",
        crt: Number(settings.crt) || 1 
      },

      dest: {
        nome: client.name,
        ...(() => {
          const doc = client.cnpj?.replace(/\D/g, '') || "";
          return doc.length === 11 ? { cpf: doc } : { cnpj: doc };
        })(),
        indicadorInscricaoEstadual: client.stateRegistration ? 1 : 9,
        indIEDest: client.stateRegistration ? 1 : 9,
        inscricaoEstadual: client.stateRegistration?.replace(/\D/g, ''),
        ie: client.stateRegistration?.replace(/\D/g, ''),
        IE: client.stateRegistration?.replace(/\D/g, ''),
        email: client.email,
        endereco: {
          logradouro: client.street || client.address?.split(',')[0],
          numero: client.number || client.address?.split(',')[1]?.trim() || 'S/N',
          bairro: client.neighborhood || 'Centro',
          cep: (client.cep || client.zipCode)?.replace(/\D/g, ''),
          cidade: client.city?.split('/')[0]?.trim(),
          uf: client.state?.split('/')[0]?.trim()?.toUpperCase()?.slice(0, 2),
          codigoMunicipio: client.ibgeCode || "3550308"
        }
      },

      items: order.items?.map((item: any, index: number) => {
        const product = products.find(p => p.id === item.productId);
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        const totalItem = Number((quantity * unitPrice).toFixed(2));
        
        return {
          numeroItem: index + 1,
          codigo: product?.id?.slice(0, 8) || "001",
          descricao: item.productName || product?.name,
          quantidade: quantity,
          unidade: "UN", 
          valorUnitario: unitPrice,
          valorTotal: totalItem,
          ncm: (product?.ncm || "39232190").replace(/\D/g, ''),
          cfop: (product?.cfop || "5101").replace(/\D/g, ''),
          origem: 0,
          icms: {
            situacaoTributaria: "102",
            origem: 0
          },
          pis: { cst: "07" },
          cofins: { cst: "07" }
        };
      }) || [],

      valorTotal: Number(order.totalValue.toFixed(2)),
      pagamentos: [
        {
          meioPagamento: "99",
          valor: Number(order.totalValue.toFixed(2))
        }
      ],
      indicadorPagamento: 0,
      transporte: {
        modalidadeFrete: 9
      },
      envioEmail: true
    };

    try {
      const response = await fetch(`${NOTAAS_PROXY_URL}/nfe/emitir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('NotaaS Full Error Detail:', JSON.stringify(errorData, null, 2));
        throw new Error(errorData.error || errorData.message || (errorData.errors ? JSON.stringify(errorData.errors) : 'Erro ao emitir nota fiscal no NotaaS'));
      }

      return await response.json();
    } catch (error: any) {
      console.error('NotaaS Error:', error);
      throw error;
    }
  },

  async checkStatus(notaasId: string) {
    try {
      const response = await fetch(`${NOTAAS_PROXY_URL}/nfe/${notaasId}`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error('Erro ao consultar status da nota');
      }

      return await response.json();
    } catch (error) {
      console.error('NotaaS Status Error:', error);
      throw error;
    }
  },

  getDanfeUrl(notaasId: string) {
    return `${NOTAAS_PROXY_URL}/nfe/${notaasId}/danfe`;
  }
};
