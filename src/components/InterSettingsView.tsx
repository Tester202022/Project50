import React, { useState, useEffect } from 'react';
import { CreditCard, ShieldCheck, Loader2, RefreshCw } from 'lucide-react';

export interface InterSettings {
  clientId: string;
  clientSecret: string;
  contaCorrente: string;
  cnpj: string;
  certPem: string;
  keyPem: string;
}

interface InterSettingsViewProps {
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const InterSettingsView = ({ notify }: InterSettingsViewProps) => {
  const [localConfig, setLocalConfig] = useState<InterSettings>({
    clientId: '20a2618e-4358-43ec-9ab8-ac0fdd3d92cf',
    clientSecret: '013e76f0-781e-47a2-99ff-347068cafa31',
    contaCorrente: '434508640',
    cnpj: '21.294.666/0001-70',
    certPem: '',
    keyPem: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/inter/config');
      if (response.ok) {
        const data = await response.json();
        setLocalConfig(prev => ({
          ...prev,
          ...data
        }));
      }
    } catch (err) {
      console.error("Erro ao carregar configurações do Banco Inter:", err);
      notify("Erro ao carregar configurações do Banco Inter", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/inter/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localConfig)
      });
      if (response.ok) {
        notify("Configurações do Banco Inter salvas com sucesso!", "success");
      } else {
        const errData = await response.json();
        throw new Error(errData.message || "Erro ao salvar");
      }
    } catch (err: any) {
      notify("Erro: " + err.message, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const response = await fetch('/api/inter/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localConfig)
      });
      const result = await response.json();
      if (response.ok && result.success) {
        notify("Conexão estabelecida com sucesso! Token gerado.", "success");
      } else {
        throw new Error(result.error || result.message || "Falha na autenticação mTLS");
      }
    } catch (err: any) {
      notify("Erro no teste de conexão: " + err.message, "error");
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col justify-center items-center gap-3">
        <Loader2 className="animate-spin text-blue-600" size={32} />
        <span className="text-xs font-black uppercase tracking-widest text-slate-400">Carregando configurações...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Integração Banco Inter</h2>
          <p className="text-sm text-slate-400 font-medium">Emissão de boletos bancários v3 usando chaves e certificados mTLS.</p>
        </div>
        <CreditCard className="text-slate-200" size={40} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm space-y-6">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Credenciais API Cobrança v3</h3>
          
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Nº da Conta Corrente (com dígito)</label>
              <input 
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 text-sm"
                value={localConfig.contaCorrente}
                onChange={e => setLocalConfig({...localConfig, contaCorrente: e.target.value})}
                placeholder="Ex: 434508640"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">CNPJ da Conta Beneficiária</label>
              <input 
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 text-sm"
                value={localConfig.cnpj}
                onChange={e => setLocalConfig({...localConfig, cnpj: e.target.value})}
                placeholder="Ex: 21.294.666/0001-70"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">ID do Cliente (Client ID)</label>
              <input 
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 text-sm"
                value={localConfig.clientId}
                onChange={e => setLocalConfig({...localConfig, clientId: e.target.value})}
                placeholder="Insira o Client ID da API"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Segredo do Cliente (Client Secret)</label>
              <input 
                type="password"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 text-sm"
                value={localConfig.clientSecret}
                onChange={e => setLocalConfig({...localConfig, clientSecret: e.target.value})}
                placeholder="Insira o Client Secret da API"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Certificado Client (.crt / .pem)</label>
                <textarea 
                  rows={6}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs text-slate-700 custom-scrollbar"
                  value={localConfig.certPem}
                  onChange={e => setLocalConfig({...localConfig, certPem: e.target.value})}
                  placeholder="-----BEGIN CERTIFICATE-----\nMIIDXTCCAkSgAwIBAgIJA...\n-----END CERTIFICATE-----"
                />
                <p className="mt-1 text-[10px] text-slate-400 italic">Abra seu arquivo de certificado (.crt ou .pem) num editor de texto e cole o conteúdo acima.</p>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Chave Privada (.key / .pem)</label>
                <textarea 
                  rows={6}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs text-slate-700 custom-scrollbar"
                  value={localConfig.keyPem}
                  onChange={e => setLocalConfig({...localConfig, keyPem: e.target.value})}
                  placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ...\n-----END PRIVATE KEY-----"
                />
                <p className="mt-1 text-[10px] text-slate-400 italic">Abra seu arquivo de chave privada (.key ou .pem) num editor de texto e cole o conteúdo acima.</p>
              </div>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-slate-900 text-white h-14 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-[0.98] shadow-xl shadow-slate-200 flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
              Salvar Configurações
            </button>
            <button 
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-6 h-14 rounded-2xl border-2 border-slate-100 font-black text-[10px] uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
            >
              {isTesting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={14} />}
              Testar Conexão
            </button>
          </div>
        </div>

        <div className="bg-orange-50/50 p-8 rounded-[40px] border border-orange-100 flex flex-col justify-between text-center gap-6">
          <div className="space-y-4">
            <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldCheck size={32} />
            </div>
            <h3 className="text-lg font-black text-orange-900 uppercase tracking-tight">Segurança mTLS</h3>
            <p className="text-sm text-orange-800/80 font-medium leading-relaxed text-left">
              O Banco Inter exige autenticação do tipo mTLS (Mutual TLS). Seus certificados e chaves privadas serão armazenados com segurança no servidor local e nunca serão expostos ao navegador do cliente.
            </p>
            <div className="text-left text-xs text-orange-700 space-y-1 bg-orange-100/30 p-4 rounded-2xl border border-orange-100/50">
              <span className="font-bold block mb-1">Como obter credenciais:</span>
              <p>1. Acesse o Internet Banking do Banco Inter.</p>
              <p>2. Vá em **Conta Digital** &gt; **APIs** e crie uma nova aplicação de Cobrança.</p>
              <p>3. Baixe os certificados e copie as credenciais geradas.</p>
            </div>
          </div>

          <div className="pt-6 border-t border-orange-100">
            <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Status do Serviço</p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <div className={`w-2.5 h-2.5 rounded-full ${localConfig.certPem && localConfig.keyPem ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
              <span className="text-xs font-black text-orange-900 uppercase">
                {localConfig.certPem && localConfig.keyPem ? 'Pronto para Uso' : 'Aguardando Certificados'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
