export interface SpreadsheetInvoice {
  number: number;
  status: string;
  orderId?: string;
  timestamp?: string; // Data/Hora na planilha / API
  reason?: string; // Motivo da rejeição
}

export const spreadsheetService = {
  async fetchInvoices(): Promise<SpreadsheetInvoice[]> {
    try {
      console.log('Initiating GestãoClick API real-time invoice fetch instead of Excel...');
      const response = await fetch('/api/gestaoclick/notas_fiscais_produtos');
      
      if (!response.ok) {
        throw new Error(`GestãoClick API error: ${response.status}`);
      }

      const payload = await response.json();
      console.log('GestãoClick invoice data received. Status:', payload.status);

      let apiList: any[] = [];
      if (payload.data) {
        apiList = Array.isArray(payload.data) ? payload.data : [payload.data];
      }

      // Map GestãoClick NFe list to conform with the old spreadsheet format for backward compatibility
      return apiList.map((nfe: any) => {
        const numberNf = nfe.numero_nf || nfe.id || '';
        const parsedNumber = parseInt(numberNf, 10);
        
        return {
          number: isNaN(parsedNumber) ? 0 : parsedNumber,
          status: nfe.situacao_nf || nfe.situacao || 'Pendente',
          orderId: nfe.pedido_id ? String(nfe.pedido_id) : undefined,
          timestamp: nfe.cadastrado_em || nfe.data_emissao || undefined,
          reason: nfe.observacao || nfe.justificativa_cancelamento || undefined
        };
      }).filter(inv => inv.number > 0);
    } catch (error) {
      console.error('Error fetching GestãoClick invoices in spreadsheetService:', error);
      return [];
    }
  }
};
